#Requires -Version 5.1
<#
.SYNOPSIS
  WorkBridge 로컬 PostgreSQL 준비 스크립트 (사용자가 직접 실행, 중간에 멈춰도 다시 실행 가능)

.DESCRIPTION
  - 앱 전용 계정 workbridge_app 과 DB 3개(workbridge_dev, workbridge_test, workbridge_shadow)를 준비한다.
  - 계정에는 로그인 외의 관리자 권한(superuser, createdb, createrole, replication, bypassrls)을 주지 않는다.
  - 기존 계정·DB는 삭제하거나 초기화하지 않는다. 소유자·권한이 예상과 다르면 아무것도 바꾸지 않고 멈춘다.
  - WorkBridge 계정·DB 외의 사용자·DB 권한은 바꾸지 않는다.
  - 비밀번호는 SQL 문에 넣지 않는다. 계정은 비밀번호 없이 만들고, psql \password 로 설정한다
    (psql이 해시로 바꿔 보내므로 평문이 서버·로그에 전달되지 않는다).
  - 새 비밀번호로 3개 DB에 실제 로그인되는 것을 확인한 뒤에만 루트 .env 에 저장한다.
  - 기존 .env 는 먼저 백업하고, 다른 변수는 그대로 둔다. .env 가 Git에서 제외되는지 먼저 확인한다.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File apps\api\scripts\setup-local-db.ps1
#>
param(
  [string]$BinDir = 'C:\Program Files\PostgreSQL\18\bin',
  [string]$PgHost = 'localhost',
  [int]$Port = 5432,
  [string]$AdminUser = 'postgres'
)

$ErrorActionPreference = 'Stop'

$AppRole = 'workbridge_app'
$Databases = [ordered]@{
  DATABASE_URL        = 'workbridge_dev'
  TEST_DATABASE_URL   = 'workbridge_test'
  SHADOW_DATABASE_URL = 'workbridge_shadow'
}
$Psql = Join-Path $BinDir 'psql.exe'
$PgIsReady = Join-Path $BinDir 'pg_isready.exe'
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$EnvPath = Join-Path $RepoRoot '.env'
$EnvExamplePath = Join-Path $RepoRoot '.env.example'
$RerunHint = '지금까지 만든 계정·DB는 그대로 남아 있으며, 이 스크립트를 다시 실행하면 이어서 진행합니다.'

function Write-Step([string]$Message) { Write-Host "`n▶ $Message" -ForegroundColor Cyan }
function Write-Ok([string]$Message) { Write-Host "  ✔ $Message" -ForegroundColor Green }
function Write-Warn([string]$Message) { Write-Host "  ! $Message" -ForegroundColor Yellow }
function Stop-Setup([string]$Message) {
  Write-Host "`n✖ $Message" -ForegroundColor Red
  Write-Host '  아무것도 삭제하거나 초기화하지 않았습니다.' -ForegroundColor Yellow
  exit 1
}

function ConvertTo-PlainText([Security.SecureString]$Secure) {
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Secure)
  try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}

function ConvertTo-PostgresUrl([string]$User, [string]$Password, [string]$HostName, [int]$PortNumber, [string]$Database) {
  $userPart = [Uri]::EscapeDataString($User)
  $passwordPart = [Uri]::EscapeDataString($Password)
  $databasePart = [Uri]::EscapeDataString($Database)
  return "postgresql://${userPart}:${passwordPart}@${HostName}:${PortNumber}/${databasePart}"
}

function Set-EnvValue([string]$Content, [string]$Key, [string]$Value) {
  $regex = New-Object Text.RegularExpressions.Regex "(?m)^[ \t]*#?[ \t]*$([regex]::Escape($Key))=[^\r\n]*"
  $line = "$Key=$Value"
  if ($regex.IsMatch($Content)) {
    $evaluator = [Text.RegularExpressions.MatchEvaluator] { param($m) $line }
    return $regex.Replace($Content, $evaluator, 1)
  }
  $newline = if ($Content.Contains("`r`n")) { "`r`n" } else { "`n" }
  if ($Content -and -not $Content.EndsWith("`n")) { $Content += $newline }
  return $Content + $line + $newline
}

function ConvertFrom-PsqlRow([string]$Line, [string[]]$Names) {
  $values = $Line -split '\|', $Names.Count
  if ($values.Count -ne $Names.Count) { throw "unexpected psql row: $($values.Count) columns" }
  $row = @{}
  for ($i = 0; $i -lt $Names.Count; $i++) { $row[$Names[$i]] = $values[$i] }
  return $row
}

# 조회 결과($Role: 없으면 $null, $DatabaseStates: DB 이름 → 없으면 $null)로 실행 계획을 정한다.
function Get-SetupPlan($Role, $DatabaseStates, [string]$RoleName) {
  $plan = @{ StopReason = $null; CreateRole = $false; CreateDatabases = @(); ExistingDatabases = @(); PasswordMode = 'new' }
  if ($Role) {
    $adminFlags = @('rolsuper', 'rolcreatedb', 'rolcreaterole', 'rolreplication', 'rolbypassrls') | Where-Object { $Role[$_] -eq 't' }
    if ($adminFlags) { $plan.StopReason = "기존 $RoleName 계정에 관리자 권한($($adminFlags -join ', '))이 있습니다."; return $plan }
    if ($Role.rolcanlogin -ne 't') { $plan.StopReason = "기존 $RoleName 계정이 로그인할 수 없는 상태(NOLOGIN)입니다."; return $plan }
    if ($Role.memberships -ne '0') { $plan.StopReason = "기존 $RoleName 계정이 다른 역할에 소속돼 있습니다($($Role.memberships)개)."; return $plan }
    if ($Role.other_databases) { $plan.StopReason = "기존 $RoleName 계정이 WorkBridge 외 DB($($Role.other_databases))를 소유하고 있습니다."; return $plan }
    if ($Role.has_password -eq 't') { $plan.PasswordMode = 'choose' }
  }
  else {
    $plan.CreateRole = $true
  }
  foreach ($name in $DatabaseStates.Keys) {
    $state = $DatabaseStates[$name]
    if (-not $state) { $plan.CreateDatabases += $name; continue }
    if ($state.owner -ne $RoleName) { $plan.StopReason = "DB $name 가 이미 있고 소유자가 $($state.owner) 입니다(다른 프로젝트 DB일 수 있음)."; return $plan }
    if ($state.encoding -ne 'UTF8') { $plan.StopReason = "DB $name 의 인코딩이 $($state.encoding) 입니다(UTF8 필요)."; return $plan }
    if ($state.extra_grantees) { $plan.StopReason = "DB $name 에 다른 계정($($state.extra_grantees))의 권한이 있습니다. 직접 확인이 필요합니다."; return $plan }
    $plan.ExistingDatabases += $name
  }
  return $plan
}

function Test-ServerReady {
  $ErrorActionPreference = 'Continue'
  $null = & $PgIsReady -h $PgHost -p $Port -t 5 2>&1
  return ($LASTEXITCODE -eq 0)
}

# SQL은 표준 입력으로 넘기고, 비밀번호는 이 호출 동안만 환경 변수로 전달한다(명령줄·기록에 남지 않음).
function Invoke-Psql([string]$User, [string]$Database, [string]$Password, [string]$Sql) {
  $ErrorActionPreference = 'Continue'
  $previous = $env:PGPASSWORD
  try {
    $env:PGPASSWORD = $Password
    $psqlArgs = @('-h', $PgHost, '-p', $Port, '-U', $User, '-d', $Database, '-w', '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-f', '-')
    $output = $Sql | & $Psql @psqlArgs 2>&1
    $exitCode = $LASTEXITCODE
  }
  finally {
    if ($null -eq $previous) { Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue } else { $env:PGPASSWORD = $previous }
  }
  $text = (@($output) | ForEach-Object { "$_" } | Where-Object { $_.Trim() -ne '' }) -join "`n"
  return @{ ExitCode = $exitCode; Output = $text.Trim() }
}

function Invoke-AdminSql([string]$Sql) {
  $result = Invoke-Psql $AdminUser 'postgres' $script:AdminPassword $Sql
  if ($result.ExitCode -ne 0) { Stop-Setup "SQL 실행 실패: $($result.Output)`n  $RerunHint" }
  return $result.Output
}

# psql \password: 새 비밀번호를 화면 표시 없이 두 번 입력받아, 해시로 바꾼 뒤 서버에 보낸다.
function Invoke-SetAppPassword {
  $ErrorActionPreference = 'Continue'
  $previous = $env:PGPASSWORD
  try {
    $env:PGPASSWORD = $script:AdminPassword
    & $Psql -h $PgHost -p $Port -U $AdminUser -d postgres -w -X -c "\password $AppRole" | Out-Host
    return ($LASTEXITCODE -eq 0)
  }
  finally {
    if ($null -eq $previous) { Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue } else { $env:PGPASSWORD = $previous }
  }
}

function Test-AppLogin([string]$Password) {
  foreach ($db in $Databases.Values) {
    $sql = "SELECT current_user || '|' || current_database() || '|' || (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)::text || '|' || current_setting('TimeZone');"
    $result = Invoke-Psql $AppRole $db $Password $sql
    if ($result.ExitCode -ne 0 -or $result.Output -ne "$AppRole|$db|false|UTC") { return $false }
  }
  return $true
}

function Assert-EnvIgnoredByGit {
  $ErrorActionPreference = 'Continue'
  $git = Get-Command git -ErrorAction SilentlyContinue
  if (-not $git) {
    $gitignore = Join-Path $RepoRoot '.gitignore'
    if (-not (Test-Path $gitignore) -or -not ((Get-Content -Raw $gitignore) -match '(?m)^\.env\s*$')) {
      Stop-Setup '.gitignore 에 .env 가 없어 비밀번호가 Git에 올라갈 수 있습니다.'
    }
    return
  }
  foreach ($name in @('.env', '.env.backup-check', '.env.tmp-check')) {
    $null = & git -C $RepoRoot check-ignore -q -- $name 2>&1
    if ($LASTEXITCODE -ne 0) { Stop-Setup "$name 가 .gitignore 로 제외되지 않습니다. 비밀번호가 Git에 올라갈 수 있어 중단합니다." }
  }
  $tracked = & git -C $RepoRoot ls-files -- .env 2>&1
  if ($tracked) { Stop-Setup '.env 가 이미 Git에 추적되고 있습니다. 먼저 Git 추적에서 빼야 합니다.' }
}

function Save-EnvFile($Urls) {
  if (Test-Path -LiteralPath $EnvPath) {
    $original = [IO.File]::ReadAllBytes($EnvPath)
    $backupPath = "$EnvPath.backup-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
    [IO.File]::WriteAllBytes($backupPath, $original)
    Write-Ok "기존 .env 백업: $(Split-Path -Leaf $backupPath)"
    $content = [IO.File]::ReadAllText($EnvPath)
  }
  elseif (Test-Path -LiteralPath $EnvExamplePath) {
    $content = [IO.File]::ReadAllText($EnvExamplePath)
    Write-Host '  - .env 가 없어 .env.example 을 바탕으로 만듭니다'
  }
  else {
    $content = ''
  }
  foreach ($key in $Urls.Keys) { $content = Set-EnvValue $content $key $Urls[$key] }

  $tempPath = "$EnvPath.tmp-$PID"
  [IO.File]::WriteAllText($tempPath, $content, (New-Object Text.UTF8Encoding($false)))
  if (Test-Path -LiteralPath $EnvPath) { [IO.File]::Replace($tempPath, $EnvPath, [NullString]::Value) }
  else { [IO.File]::Move($tempPath, $EnvPath) }

  $saved = [IO.File]::ReadAllText($EnvPath)
  foreach ($key in $Urls.Keys) {
    if (-not $saved.Contains("$key=$($Urls[$key])")) { Stop-Setup ".env 저장 확인 실패($key)" }
  }
}

# ---------------------------------------------------------------------------
Write-Host 'WorkBridge 로컬 PostgreSQL 준비' -ForegroundColor White
$script:AdminPassword = $null
$appPassword = $null
$savedPassFile = $env:PGPASSFILE
$savedTimeout = $env:PGCONNECT_TIMEOUT

try {
  $env:PGPASSFILE = Join-Path ([IO.Path]::GetTempPath()) "workbridge-no-pgpass-$PID"
  $env:PGCONNECT_TIMEOUT = '10'

  # ---- 0. 사전 점검 (DB 접속 전) ----
  Write-Step '사전 점검'
  foreach ($path in @($Psql, $PgIsReady)) {
    if (-not (Test-Path -LiteralPath $path)) { Stop-Setup "파일을 찾을 수 없습니다: $path (-BinDir 로 경로 지정)" }
  }
  Assert-EnvIgnoredByGit
  Write-Ok '.env 와 백업 파일이 Git에서 제외됨'
  if (-not (Test-ServerReady)) { Stop-Setup "PostgreSQL 서버($PgHost`:$Port)가 응답하지 않습니다. 서비스가 실행 중인지 확인해 주세요." }
  Write-Ok 'PostgreSQL 서버 응답'

  # ---- 1. 관리자 접속 ----
  Write-Step "관리자 계정($AdminUser)으로 접속"
  $adminSecure = Read-Host "  '$AdminUser' 비밀번호를 입력하세요 (화면에 표시되지 않음)" -AsSecureString
  $script:AdminPassword = ConvertTo-PlainText $adminSecure
  $check = Invoke-Psql $AdminUser 'postgres' $script:AdminPassword 'SELECT rolsuper FROM pg_roles WHERE rolname = current_user;'
  if ($check.ExitCode -ne 0) {
    Stop-Setup "관리자 로그인에 실패했습니다: $($check.Output)`n  비밀번호를 모르면 reset-postgres-password.ps1 을 사용하세요."
  }
  if ($check.Output -ne 't') { Stop-Setup "'$AdminUser' 계정에 관리자(superuser) 권한이 없습니다." }
  Write-Ok '관리자 접속 성공'

  # ---- 2. 현재 상태 점검 (변경 없음) ----
  Write-Step '현재 상태 점검 (변경 없음)'
  $dbList = ($Databases.Values | ForEach-Object { "'$_'" }) -join ', '
  $roleLine = Invoke-AdminSql @"
SELECT a.rolsuper, a.rolcreatedb, a.rolcreaterole, a.rolreplication, a.rolbypassrls, a.rolcanlogin,
       a.rolpassword IS NOT NULL,
       (SELECT count(*) FROM pg_auth_members m WHERE m.member = a.oid),
       COALESCE((SELECT string_agg(d.datname, ',') FROM pg_database d WHERE d.datdba = a.oid AND d.datname NOT IN ($dbList)), '')
  FROM pg_authid a WHERE a.rolname = '$AppRole';
"@
  $role = $null
  if ($roleLine) {
    $role = ConvertFrom-PsqlRow $roleLine @('rolsuper', 'rolcreatedb', 'rolcreaterole', 'rolreplication', 'rolbypassrls', 'rolcanlogin', 'has_password', 'memberships', 'other_databases')
  }
  $dbStates = [ordered]@{}
  foreach ($db in $Databases.Values) {
    $dbLine = Invoke-AdminSql @"
SELECT pg_get_userbyid(d.datdba), pg_encoding_to_char(d.encoding),
       COALESCE((SELECT string_agg(DISTINCT pg_get_userbyid(a.grantee), ',')
                   FROM aclexplode(COALESCE(d.datacl, acldefault('d', d.datdba))) a
                  WHERE a.grantee NOT IN (0, d.datdba)), '')
  FROM pg_database d WHERE d.datname = '$db';
"@
    $dbStates[$db] = $null
    if ($dbLine) { $dbStates[$db] = ConvertFrom-PsqlRow $dbLine @('owner', 'encoding', 'extra_grantees') }
  }

  $plan = Get-SetupPlan $role $dbStates $AppRole
  if ($plan.StopReason) { Stop-Setup $plan.StopReason }

  if ($plan.CreateRole) { Write-Host "  - 계정 $AppRole : 없음 → 비밀번호 없이 만든 뒤 psql 로 비밀번호 설정" }
  elseif ($plan.PasswordMode -eq 'new') { Write-Host "  - 계정 $AppRole : 있음, 비밀번호 미설정(이전 실행 중단) → 비밀번호 설정" }
  else { Write-Host "  - 계정 $AppRole : 있음 (관리자 권한 없음, 다른 역할 소속 없음)" }
  foreach ($db in $Databases.Values) {
    if ($plan.CreateDatabases -contains $db) { Write-Host "  - DB $db : 없음 → 새로 만듭니다 (소유자 $AppRole)" }
    else { Write-Host "  - DB $db : 있음 (소유자 $AppRole, UTF8, 다른 계정 권한 없음) → 재사용" }
  }

  $passwordMode = $plan.PasswordMode
  if ($passwordMode -eq 'choose') {
    Write-Host @"

  기존 $AppRole 계정의 비밀번호
    [1] 알고 있다 → 입력해서 확인합니다
    [2] 모른다    → psql 로 새 비밀번호를 설정합니다 ($AppRole 계정에만 적용)
"@
    $pick = Read-Host '  선택 (1/2)'
    if ($pick -eq '1') { $passwordMode = 'existing' } elseif ($pick -eq '2') { $passwordMode = 'new' } else { Stop-Setup '취소했습니다.' }
  }

  $answer = Read-Host "`n  위 내용대로 진행할까요? (y/N)"
  if ($answer -notmatch '^(y|yes)$') { Stop-Setup '사용자가 취소했습니다.' }

  # ---- 3. 계정·DB 준비 (WorkBridge 대상만) ----
  Write-Step '계정·DB 준비'
  if ($plan.CreateRole) {
    Invoke-AdminSql "CREATE ROLE $AppRole LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;" | Out-Null
    Write-Ok "계정 $AppRole 생성 (관리자 권한 없음, 비밀번호는 다음 단계에서 설정)"
  }
  foreach ($db in $plan.CreateDatabases) {
    Invoke-AdminSql "CREATE DATABASE $db OWNER $AppRole ENCODING 'UTF8' TEMPLATE template0;" | Out-Null
    Write-Ok "DB $db 생성"
  }
  foreach ($db in $Databases.Values) {
    Invoke-AdminSql "REVOKE ALL ON DATABASE $db FROM PUBLIC; ALTER DATABASE $db SET timezone TO 'UTC';" | Out-Null
  }
  $publicGrants = Invoke-AdminSql @"
SELECT count(*) FROM pg_database d, aclexplode(COALESCE(d.datacl, acldefault('d', d.datdba))) a
 WHERE d.datname IN ($dbList) AND a.grantee = 0;
"@
  $roleFlags = Invoke-AdminSql "SELECT (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)::text FROM pg_roles WHERE rolname = '$AppRole';"
  if ($publicGrants -ne '0' -or $roleFlags -ne 'false') { Stop-Setup "권한 확인 실패(PUBLIC 권한 $publicGrants, 관리자 권한 $roleFlags). $RerunHint" }
  Write-Ok 'DB 3개: 다른 계정 접속 차단(PUBLIC 권한 없음), 기본 시간대 UTC, 계정 관리자 권한 없음 확인'

  # ---- 4. 비밀번호 설정 ----
  if ($passwordMode -eq 'new') {
    Write-Step "$AppRole 비밀번호 설정 (psql)"
    Write-Host "  아래에 $AppRole 의 새 비밀번호를 두 번 입력하세요. 화면에는 표시되지 않습니다."
    Write-Host '  (영문·숫자·특수문자 모두 사용 가능. 이 비밀번호는 .env 에만 저장되며 다시 볼 일이 거의 없습니다)'
    $passwordChanged = $false
    for ($attempt = 1; $attempt -le 3 -and -not $passwordChanged; $attempt++) {
      $passwordChanged = Invoke-SetAppPassword
      if (-not $passwordChanged) { Write-Warn '설정하지 못했습니다(두 입력이 다르면 실패합니다). 다시 시도합니다.' }
    }
    if (-not $passwordChanged) { Stop-Setup "비밀번호를 설정하지 못했습니다. $RerunHint" }
    Write-Ok '비밀번호 설정 완료 (평문은 서버로 전송되지 않음)'
  }

  # ---- 5. 로그인 확인 ----
  Write-Step "$AppRole 로그인 확인"
  $verified = $false
  for ($attempt = 1; $attempt -le 3 -and -not $verified; $attempt++) {
    $prompt = if ($passwordMode -eq 'new') { "  방금 정한 $AppRole 비밀번호를 한 번 더 입력하세요 (.env 저장용, 화면 표시 안 됨)" }
    else { "  기존 $AppRole 비밀번호를 입력하세요 (화면 표시 안 됨)" }
    $appSecure = Read-Host $prompt -AsSecureString
    $appPassword = ConvertTo-PlainText $appSecure
    if ($appPassword -and (Test-AppLogin $appPassword)) { $verified = $true }
    else { $appPassword = $null; Write-Warn '로그인하지 못했습니다. 다시 입력해 주세요.' }
  }
  if (-not $verified) {
    Stop-Setup ".env 는 저장하지 않았습니다. 비밀번호를 모르면 다시 실행해 [2] 새로 설정을 선택하세요. $RerunHint"
  }
  Write-Ok '3개 DB 모두 로그인 성공 (superuser 아님, 시간대 UTC)'

  # ---- 6. .env 저장 ----
  Write-Step '루트 .env 에 연결 정보 저장'
  $urls = [ordered]@{}
  foreach ($key in $Databases.Keys) { $urls[$key] = ConvertTo-PostgresUrl $AppRole $appPassword $PgHost $Port $Databases[$key] }
  Save-EnvFile $urls
  $urls = $null
  Write-Ok '.env 저장 완료 (DATABASE_URL, TEST_DATABASE_URL, SHADOW_DATABASE_URL). 값은 표시하지 않습니다.'

  Write-Host "`n완료되었습니다. 확인: npm run db:check -w apps/api" -ForegroundColor Green
  Write-Host "Cursor 채팅에 '설정 완료'라고 알려 주세요." -ForegroundColor Green
}
finally {
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
  if ($null -eq $savedPassFile) { Remove-Item Env:PGPASSFILE -ErrorAction SilentlyContinue } else { $env:PGPASSFILE = $savedPassFile }
  if ($null -eq $savedTimeout) { Remove-Item Env:PGCONNECT_TIMEOUT -ErrorAction SilentlyContinue } else { $env:PGCONNECT_TIMEOUT = $savedTimeout }
  $script:AdminPassword = $null
  $appPassword = $null
}
