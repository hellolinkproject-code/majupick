#Requires -Version 5.1
# DB 준비·복구 PowerShell 스크립트의 정적 검사와 순수 함수 단위 테스트.
# - 대상 스크립트 본문은 실행하지 않고, PostgreSQL·서비스·pg_hba.conf 에 접근하지 않는다.
# - 파서(AST)로 추출한 순수 함수(파일·DB 접근 없음)만 이 프로세스에 정의해 시험한다.
#   npm run test:scripts -w apps/api
$ErrorActionPreference = 'Stop'
$ScriptsDir = Split-Path -Parent $PSScriptRoot
$Targets = @('setup-local-db.ps1', 'reset-postgres-password.ps1', 'restore-pg-hba.ps1')

$script:Passed = 0
$script:Failures = @()
# 매개변수 이름은 테스트 본문의 변수($name 등)와 겹치지 않게 둔다(PowerShell 변수는 대소문자 구분 없음).
function Test-Case([string]$CaseTitle, [scriptblock]$CaseBody) {
  try {
    & $CaseBody
    $script:Passed++
    Write-Host "  ✔ $CaseTitle" -ForegroundColor Green
  }
  catch {
    $script:Failures += "$CaseTitle :: $($_.Exception.Message)"
    Write-Host "  ✖ $CaseTitle :: $($_.Exception.Message)" -ForegroundColor Red
  }
}
function Assert-True($Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
function Assert-Equal($Expected, $Actual, [string]$Message) {
  if ($Expected -cne $Actual) { throw "$Message (expected '$Expected', got '$Actual')" }
}
function Get-Hex([byte[]]$Bytes) { ([BitConverter]::ToString($Bytes)) }

# ---------------------------------------------------------------------------
Write-Host "`n[1] 문법 검사 (Parser API)" -ForegroundColor Cyan
$Parsed = @{}
foreach ($name in $Targets) {
  $path = Join-Path $ScriptsDir $name
  $tokens = $null
  $errors = $null
  $ast = [Management.Automation.Language.Parser]::ParseFile($path, [ref]$tokens, [ref]$errors)
  $Parsed[$name] = @{ Ast = $ast; Tokens = $tokens; Path = $path }
  Test-Case "$name 문법 오류 없음" { Assert-Equal 0 $errors.Count ($errors | ForEach-Object { "$($_.Extent.StartLineNumber): $($_.Message)" }) }
  Test-Case "$name UTF-8 BOM (Windows PowerShell 5.1 한글 처리)" {
    $head = [IO.File]::ReadAllBytes($path)[0..2]
    Assert-Equal 'EF-BB-BF' (Get-Hex $head) 'BOM'
  }
}

function Get-FunctionText([string]$Script, [string]$Name) {
  $fn = $Parsed[$Script].Ast.Find({
      param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $Name
    }, $true)
  if (-not $fn) { throw "$Script 에 $Name 함수가 없습니다" }
  return $fn.Extent.Text
}

# 주석을 뺀 코드 토큰 텍스트
function Get-CodeText([string]$Script) {
  ($Parsed[$Script].Tokens | Where-Object { $_.Kind -ne 'Comment' } | ForEach-Object { $_.Text }) -join ' '
}
function Get-StringTokens([string]$Script) {
  $Parsed[$Script].Tokens | Where-Object { $_ -is [Management.Automation.Language.StringToken] } | ForEach-Object { $_.Value }
}

# ---- 검출기: 위반 목록을 돌려준다(빈 목록 = 통과). 아래 [2-1]에서 일부러 만든 위반 코드로 검출 능력을 확인한다.
function Find-DangerousCommands($Tokens) {
  $code = ($Tokens | Where-Object { $_.Kind -ne 'Comment' } | ForEach-Object { $_.Text }) -join ' '
  @('\bDROP\b', '\bTRUNCATE\b', 'Restart-Service', 'Stop-Service', 'Set-Service', 'ALTER\s+SYSTEM', 'pg_ctl', 'migrate\s+reset', 'Remove-Item\s+-Recurse') |
    Where-Object { $code -match $_ }
}
function Find-PlainPasswordReads($Ast) {
  $Ast.FindAll({ param($node) $node -is [Management.Automation.Language.CommandAst] }, $true) |
    Where-Object { $_.GetCommandName() -eq 'Read-Host' -and $_.Extent.Text -match '비밀번호|password' -and $_.Extent.Text -notmatch '-AsSecureString' } |
    ForEach-Object { $_.Extent.Text }
}
function Find-SecretExposure($Ast) {
  foreach ($command in $Ast.FindAll({ param($node) $node -is [Management.Automation.Language.CommandAst] }, $true)) {
    $commandName = $command.GetCommandName()
    $isOutput = $commandName -match '^Write-(Host|Output|Warning|Error|Verbose)$|^Write-(Ok|Warn|Step)$|^Stop-(Setup|Reset)$'
    $isNative = ($command.InvocationOperator -eq 'Ampersand') -or $commandName -in @('Start-Process', 'git', 'psql', 'psql.exe')
    if (-not ($isOutput -or $isNative)) { continue }
    $vars = $command.FindAll({ param($node) $node -is [Management.Automation.Language.VariableExpressionAst] }, $true)
    # 비밀 값을 담는 변수: ...Password, ...Secure, passwordPart (passwordSet·PasswordTimeoutSeconds 등은 제외)
    if ($vars | Where-Object { $_.VariablePath.UserPath -match '(?i)(password|secure|passwordPart)$' }) { $command.Extent.Text }
  }
}
function Find-BroadTrust([string[]]$Strings) {
  foreach ($s in $Strings) {
    foreach ($line in ($s -split "`r?`n")) {
      if ($line -match '^\s*host\b.*\btrust\b' -and $line -notmatch '^\s*host\s+postgres\s+postgres\s+(127\.0\.0\.1/32|::1/128)\s+trust\s*$') { $line }
    }
  }
}
function Find-PlaintextPasswordSql([string[]]$Strings) {
  $Strings | Where-Object { $_ -match "PASSWORD\s+'" }
}
function ConvertTo-SampleParse([string]$Code) {
  $tokens = $null
  $errors = $null
  $ast = [Management.Automation.Language.Parser]::ParseInput($Code, [ref]$tokens, [ref]$errors)
  return @{ Ast = $ast; Tokens = $tokens; Strings = @($tokens | Where-Object { $_ -is [Management.Automation.Language.StringToken] } | ForEach-Object { $_.Value }) }
}

# ---------------------------------------------------------------------------
Write-Host "`n[2] 위험 명령·비밀번호 노출 정적 검사" -ForegroundColor Cyan
foreach ($name in $Targets) {
  Test-Case "$name : DROP·TRUNCATE·서비스 재시작·ALTER SYSTEM·pg_ctl 없음" {
    $found = @(Find-DangerousCommands $Parsed[$name].Tokens)
    Assert-Equal 0 $found.Count "금지 패턴: $($found -join ', ')"
  }
  Test-Case "$name : 비밀번호를 묻는 Read-Host 는 모두 -AsSecureString" {
    $found = @(Find-PlainPasswordReads $Parsed[$name].Ast)
    Assert-Equal 0 $found.Count "평문 입력: $($found -join ' / ')"
  }
  Test-Case "$name : 비밀번호 변수를 화면 출력·명령줄 인수로 쓰지 않음" {
    $found = @(Find-SecretExposure $Parsed[$name].Ast)
    Assert-Equal 0 $found.Count "노출: $($found -join ' / ')"
  }
}

Write-Host "`n[2-1] 검출기 자체 검증 (일부러 만든 위반 코드를 잡아내는지)" -ForegroundColor Cyan
Test-Case '검출기: 위험 명령(DROP DATABASE, Restart-Service)을 잡아냄' {
  $sample = ConvertTo-SampleParse "Invoke-AdminSql 'DROP DATABASE x'; Restart-Service postgresql-x64-18"
  Assert-Equal 2 @(Find-DangerousCommands $sample.Tokens).Count '검출 개수'
  $comment = ConvertTo-SampleParse "# DROP 은 주석이면 허용`nWrite-Host 'ok'"
  Assert-Equal 0 @(Find-DangerousCommands $comment.Tokens).Count '주석은 제외'
}
Test-Case '검출기: 평문 비밀번호 입력(Read-Host)을 잡아냄' {
  $sample = ConvertTo-SampleParse "`$a = Read-Host '비밀번호 입력'; `$b = Read-Host '비밀번호' -AsSecureString"
  Assert-Equal 1 @(Find-PlainPasswordReads $sample.Ast).Count '검출 개수'
}
Test-Case '검출기: 비밀번호 화면 출력·psql 인수 전달을 잡아냄, 무관한 변수는 통과' {
  $sample = ConvertTo-SampleParse "Write-Host `"pw=`$appPassword`"; & `$Psql -c `$AdminPassword; Start-Process psql -ArgumentList `$knownPassword"
  Assert-Equal 3 @(Find-SecretExposure $sample.Ast).Count '검출 개수'
  $benign = ConvertTo-SampleParse "Write-Host `"`$PasswordTimeoutSeconds `$passwordSet`"; & `$Psql -U `$AdminUser"
  Assert-Equal 0 @(Find-SecretExposure $benign.Ast).Count '오탐 없음'
}
Test-Case '검출기: 넓은 trust 규칙과 평문 PASSWORD SQL을 잡아냄' {
  $sample = ConvertTo-SampleParse "`$x = 'host all all 127.0.0.1/32 trust'; `$y = 'host postgres postgres 0.0.0.0/0 trust'; `$z = 'host postgres postgres ::1/128 trust'"
  Assert-Equal 2 @(Find-BroadTrust $sample.Strings).Count 'trust 검출 개수'
  $sql = ConvertTo-SampleParse "`$s = `"CREATE ROLE r LOGIN PASSWORD '`$pw'`""
  Assert-Equal 1 @(Find-PlaintextPasswordSql $sql.Strings).Count 'PASSWORD 검출'
}

Test-Case 'setup : SQL 에 평문 비밀번호(PASSWORD 절) 없음, psql \password 사용' {
  $strings = @(Get-StringTokens 'setup-local-db.ps1')
  $found = @(Find-PlaintextPasswordSql $strings)
  Assert-Equal 0 $found.Count "평문 비밀번호 SQL: $($found -join ' / ')"
  Assert-True (($strings | Where-Object { $_ -match '\\password \$AppRole' }).Count -ge 1) '\password 사용 없음'
}
Test-Case 'setup : GRANT 없음, 변경 SQL 은 WorkBridge 계정·DB 만 대상' {
  foreach ($s in Get-StringTokens 'setup-local-db.ps1') {
    Assert-True ($s -notmatch '\bGRANT\b') "GRANT 발견: $s"
    if ($s -match '\b(CREATE|ALTER|REVOKE)\s+(ROLE|DATABASE|ALL)\b') {
      Assert-True ($s -match '\$AppRole|\$db\b') "WorkBridge 외 대상 가능성: $s"
    }
  }
}
Test-Case 'setup : 계정 생성 시 관리자 권한 명시적 거부' {
  $create = Get-StringTokens 'setup-local-db.ps1' | Where-Object { $_ -match 'CREATE ROLE' }
  Assert-Equal 1 @($create).Count 'CREATE ROLE 문 개수'
  foreach ($flag in @('NOSUPERUSER', 'NOCREATEDB', 'NOCREATEROLE', 'NOREPLICATION', 'NOBYPASSRLS')) {
    Assert-True ($create -match $flag) "$flag 없음"
  }
}
Test-Case 'reset/restore : trust 규칙은 postgres 사용자·postgres DB·루프백만' {
  foreach ($name in @('reset-postgres-password.ps1', 'restore-pg-hba.ps1')) {
    $found = @(Find-BroadTrust @(Get-StringTokens $name))
    Assert-Equal 0 $found.Count "$name 허용 범위를 벗어난 trust: $($found -join ' / ')"
  }
}
Test-Case 'reset : 복원 실패 시 보안 경고 + 종료 코드 2, 서비스 데이터 폴더 확인' {
  $code = Get-CodeText 'reset-postgres-password.ps1'
  Assert-True ($code -match 'Write-SecurityAlert') '보안 경고 호출 없음'
  Assert-True ($code -match 'exit\s+2') '종료 코드 2 없음'
  Assert-True ($code -match "current_setting\('hba_file'\)") '실행 중 서버의 hba_file 확인 없음'
  Assert-True ($code -match 'Get-ServicePaths') '서비스 경로 확인 없음'
  $try = $Parsed['reset-postgres-password.ps1'].Ast.FindAll({ param($n) $n -is [Management.Automation.Language.TryStatementAst] -and $n.Finally }, $true) |
    Where-Object { $_.Finally.Extent.Text -match 'WriteAllBytes\(\$HbaPath, \$originalBytes\)' }
  Assert-True (@($try).Count -eq 1) 'finally 블록에서 원본 복원 없음'
}
Test-Case 'reset/restore : 공용 함수 구현이 서로 같음' {
  foreach ($fn in @('Get-BytesSha256', 'Remove-TempTrustBlock', 'Test-ServerReady', 'Test-PostgresLogin', 'Write-SecurityAlert')) {
    Assert-Equal (Get-FunctionText 'reset-postgres-password.ps1' $fn) (Get-FunctionText 'restore-pg-hba.ps1' $fn) "$fn 불일치"
  }
}

# ---------------------------------------------------------------------------
Write-Host "`n[3] setup-local-db.ps1 순수 함수" -ForegroundColor Cyan
foreach ($fn in @('ConvertTo-PostgresUrl', 'Set-EnvValue', 'ConvertFrom-PsqlRow', 'Get-SetupPlan')) {
  . ([scriptblock]::Create((Get-FunctionText 'setup-local-db.ps1' $fn)))
}

$SpecialPasswords = @('p@ss:w/rd', 'a#b?c&d=e', '100%!*()''"', 'sp ace+plus', '한글비밀번호', 'back\slash`$dollar', 'semi;colon,comma[x]{y}|z<>^~')
Test-Case 'URL 인코딩: 특수문자 비밀번호 왕복(.NET)' {
  foreach ($pw in $SpecialPasswords) {
    $url = ConvertTo-PostgresUrl 'workbridge_app' $pw 'localhost' 5432 'workbridge_dev'
    $uri = [Uri]$url
    $encodedPassword = $uri.UserInfo.Substring($uri.UserInfo.IndexOf(':') + 1)
    Assert-Equal $pw ([Uri]::UnescapeDataString($encodedPassword)) "왕복 실패"
    Assert-Equal 'workbridge_dev' $uri.AbsolutePath.TrimStart('/') 'DB 이름'
    Assert-True ($url -notmatch '[#\s"]') ".env 값으로 위험한 문자 포함: $url"
  }
}
$node = Get-Command node -ErrorAction SilentlyContinue
if ($node) {
  Test-Case 'URL 인코딩: Node URL·pg-connection-string 이 같은 비밀번호로 해석' {
    $cases = @($SpecialPasswords | ForEach-Object { @{ url = (ConvertTo-PostgresUrl 'workbridge_app' $_ 'localhost' 5432 'workbridge_dev'); password = $_ } })
    $json = ConvertTo-Json -InputObject $cases -Compress
    $tmp = Join-Path ([IO.Path]::GetTempPath()) "wb-url-cases-$PID.json"
    [IO.File]::WriteAllText($tmp, $json, (New-Object Text.UTF8Encoding($false)))
    try {
      $apiDir = Split-Path -Parent $ScriptsDir
      $checker = "const fs=require('fs');const {parse}=require('pg-connection-string');" +
        "const cases=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));let bad=0;" +
        "for(const c of cases){const u=new URL(c.url);const p=parse(c.url);" +
        "if(decodeURIComponent(u.password)!==c.password||p.password!==c.password||p.database!=='workbridge_dev'||p.user!=='workbridge_app')bad++;}" +
        "console.log(bad===0?'OK':'BAD '+bad);"
      Push-Location $apiDir
      try { $out = & node -e $checker $tmp 2>&1 } finally { Pop-Location }
      Assert-Equal 'OK' (($out | ForEach-Object { "$_" }) -join ' ').Trim() 'Node 해석 결과'
    }
    finally { Remove-Item -LiteralPath $tmp -ErrorAction SilentlyContinue }
  }
}
else {
  Write-Host '  - (미검증) node 를 찾지 못해 Node 해석 교차 검사를 건너뜀' -ForegroundColor Yellow
}

Test-Case '.env 갱신: 다른 변수 보존, 대상 키만 교체, 비슷한 이름 키 보호' {
  $before = "NODE_ENV=development`nAPI_PORT=4000`nDATABASE_URL=postgresql://workbridge_app:<password>@localhost:5432/workbridge_dev`nTEST_DATABASE_URL=keep-me`nCUSTOM=1`n"
  $after = Set-EnvValue $before 'DATABASE_URL' 'NEW'
  Assert-Equal "NODE_ENV=development`nAPI_PORT=4000`nDATABASE_URL=NEW`nTEST_DATABASE_URL=keep-me`nCUSTOM=1`n" $after '결과'
}
Test-Case '.env 갱신: 없는 키 추가, CRLF 유지, 주석 처리된 자리 재사용' {
  Assert-Equal "A=1`r`nB=2`r`n" (Set-EnvValue "A=1`r`n" 'B' '2') 'CRLF 추가'
  Assert-Equal "A=1`nB=2`n" (Set-EnvValue 'A=1' 'B' '2') '줄바꿈 없는 끝'
  Assert-Equal "B=2`n" (Set-EnvValue '' 'B' '2') '빈 파일'
  Assert-Equal "X=1`nSHADOW_DATABASE_URL=s`n" (Set-EnvValue "X=1`n# SHADOW_DATABASE_URL=old`n" 'SHADOW_DATABASE_URL' 's') '주석 자리'
}
Test-Case '.env 갱신: 치환 값의 $ 문자를 정규식 치환 기호로 해석하지 않음' {
  Assert-Equal 'K=a$1b$&c' (Set-EnvValue 'K=old' 'K' 'a$1b$&c') '치환'
}
Test-Case 'psql 결과 행 파싱' {
  $row = ConvertFrom-PsqlRow 'f|f|t|0|' @('a', 'b', 'c', 'd', 'e')
  Assert-Equal 't' $row.c 'c'
  Assert-Equal '' $row.e '빈 마지막 열'
  $failed = $false
  try { ConvertFrom-PsqlRow 'only|two' @('a', 'b', 'c') | Out-Null } catch { $failed = $true }
  Assert-True $failed '열 개수 불일치 감지'
}

function New-Role([hashtable]$Overrides) {
  $role = @{ rolsuper = 'f'; rolcreatedb = 'f'; rolcreaterole = 'f'; rolreplication = 'f'; rolbypassrls = 'f'; rolcanlogin = 't'; has_password = 't'; memberships = '0'; other_databases = '' }
  foreach ($key in $Overrides.Keys) { $role[$key] = $Overrides[$key] }
  return $role
}
function New-Db([hashtable]$Overrides) {
  $db = @{ owner = 'workbridge_app'; encoding = 'UTF8'; extra_grantees = '' }
  foreach ($key in $Overrides.Keys) { $db[$key] = $Overrides[$key] }
  return $db
}
function New-DbStates($Dev, $Test, $Shadow) {
  $states = [ordered]@{}
  $states['workbridge_dev'] = $Dev
  $states['workbridge_test'] = $Test
  $states['workbridge_shadow'] = $Shadow
  return $states
}

Test-Case '계획: 처음 실행 → 계정·DB 3개 생성, 새 비밀번호' {
  $plan = Get-SetupPlan $null (New-DbStates $null $null $null) 'workbridge_app'
  Assert-Equal $null $plan.StopReason '중단 사유'
  Assert-True $plan.CreateRole '계정 생성'
  Assert-Equal 'workbridge_dev,workbridge_test,workbridge_shadow' ($plan.CreateDatabases -join ',') '생성 DB'
  Assert-Equal 'new' $plan.PasswordMode '비밀번호'
}
Test-Case '계획: 기존 계정·DB 모두 정상 → 재사용, 비밀번호 선택' {
  $plan = Get-SetupPlan (New-Role @{}) (New-DbStates (New-Db @{}) (New-Db @{}) (New-Db @{})) 'workbridge_app'
  Assert-Equal $null $plan.StopReason '중단 사유'
  Assert-True (-not $plan.CreateRole) '계정 생성 안 함'
  Assert-Equal 0 @($plan.CreateDatabases).Count '생성 DB 없음'
  Assert-Equal 'choose' $plan.PasswordMode '비밀번호'
}
Test-Case '계획: 이전 실행 중단(계정만 있고 비밀번호 없음, DB 일부만 생성) → 이어서 진행' {
  $plan = Get-SetupPlan (New-Role @{ has_password = 'f' }) (New-DbStates (New-Db @{}) $null $null) 'workbridge_app'
  Assert-Equal $null $plan.StopReason '중단 사유'
  Assert-True (-not $plan.CreateRole) '계정 재사용'
  Assert-Equal 'workbridge_test,workbridge_shadow' ($plan.CreateDatabases -join ',') '남은 DB만 생성'
  Assert-Equal 'new' $plan.PasswordMode '비밀번호 설정 필요'
}
$StopCases = @(
  @{ Name = 'superuser 계정'; Role = (New-Role @{ rolsuper = 't' }); Dbs = (New-DbStates $null $null $null); Expect = '관리자 권한' }
  @{ Name = 'createdb 계정'; Role = (New-Role @{ rolcreatedb = 't' }); Dbs = (New-DbStates $null $null $null); Expect = 'rolcreatedb' }
  @{ Name = 'NOLOGIN 계정'; Role = (New-Role @{ rolcanlogin = 'f' }); Dbs = (New-DbStates $null $null $null); Expect = 'NOLOGIN' }
  @{ Name = '다른 역할 소속'; Role = (New-Role @{ memberships = '1' }); Dbs = (New-DbStates $null $null $null); Expect = '소속' }
  @{ Name = 'WorkBridge 외 DB 소유'; Role = (New-Role @{ other_databases = 'other_app' }); Dbs = (New-DbStates $null $null $null); Expect = 'other_app' }
  @{ Name = '다른 소유자의 같은 이름 DB'; Role = $null; Dbs = (New-DbStates (New-Db @{ owner = 'someone' }) $null $null); Expect = 'someone' }
  @{ Name = 'UTF8 아닌 DB'; Role = (New-Role @{}); Dbs = (New-DbStates (New-Db @{}) (New-Db @{ encoding = 'SQL_ASCII' }) $null); Expect = 'SQL_ASCII' }
  @{ Name = '다른 계정 권한이 있는 DB'; Role = (New-Role @{}); Dbs = (New-DbStates (New-Db @{}) (New-Db @{}) (New-Db @{ extra_grantees = 'intruder' })); Expect = 'intruder' }
)
foreach ($case in $StopCases) {
  Test-Case "계획: $($case.Name) → 아무것도 바꾸지 않고 중단" {
    $plan = Get-SetupPlan $case.Role $case.Dbs 'workbridge_app'
    Assert-True ($plan.StopReason -and $plan.StopReason.Contains($case.Expect)) "중단 사유: $($plan.StopReason)"
  }
}

# ---------------------------------------------------------------------------
Write-Host "`n[4] reset / restore 순수 함수" -ForegroundColor Cyan
foreach ($fn in @('Get-BytesSha256', 'New-TempTrustContent', 'Remove-TempTrustBlock', 'ConvertTo-WindowsServicePath', 'Get-ServicePaths', 'Test-SamePath')) {
  . ([scriptblock]::Create((Get-FunctionText 'reset-postgres-password.ps1' $fn)))
}
. ([scriptblock]::Create((Get-FunctionText 'restore-pg-hba.ps1' 'Get-RecoveryPlan')))

$latin1 = [Text.Encoding]::GetEncoding(28591)
$SampleCrlf = [byte[]]$latin1.GetBytes("# comment`r`nlocal   all   all   scram-sha-256`r`nhost    all   all   127.0.0.1/32   scram-sha-256`r`n")
$SampleLf = [byte[]]([Text.Encoding]::UTF8.GetBytes("# 한글 주석`nhost all all ::1/128 scram-sha-256"))

Test-Case '임시 규칙: 추가 후 제거하면 원본 바이트와 정확히 같음 (CRLF / LF·한글·끝 줄바꿈 없음)' {
  foreach ($sample in @($SampleCrlf, $SampleLf)) {
    $modified = New-TempTrustContent $sample
    Assert-True ($modified -is [byte[]]) 'byte[] 반환'
    $result = Remove-TempTrustBlock $modified
    Assert-Equal 'removed' $result.Status '상태'
    Assert-Equal (Get-BytesSha256 $sample) (Get-BytesSha256 $result.Bytes) '원본 복원'
  }
}
Test-Case '임시 규칙: 파일 맨 위, postgres/postgres/루프백 2줄, 원본 줄바꿈 사용' {
  $text = $latin1.GetString((New-TempTrustContent $SampleCrlf))
  $lines = $text -split "`r`n"
  Assert-True ($lines[0] -like '# >>> WORKBRIDGE-TEMP-TRUST BEGIN*') '시작 표시'
  Assert-True ($lines[1] -match '^host\s+postgres\s+postgres\s+127\.0\.0\.1/32\s+trust$') 'IPv4 규칙'
  Assert-True ($lines[2] -match '^host\s+postgres\s+postgres\s+::1/128\s+trust$') 'IPv6 규칙'
  Assert-True ($lines[3] -like '# <<< WORKBRIDGE-TEMP-TRUST END*') '끝 표시'
  Assert-Equal '# comment' $lines[4] '원본 첫 줄이 바로 뒤에 옴'
}
Test-Case '임시 규칙: 이미 블록이 있으면 다시 추가하지 않음 (중복 실행 방지)' {
  $failed = $false
  try { New-TempTrustContent (New-TempTrustContent $SampleCrlf) | Out-Null } catch { $failed = $true }
  Assert-True $failed '중복 추가 거부'
}
Test-Case '임시 규칙 제거: 블록 없음 / 손상(끝 표시 없음) / 블록 안에 다른 규칙 → 임의로 지우지 않음' {
  Assert-Equal 'absent' (Remove-TempTrustBlock $SampleCrlf).Status '없음'
  $modifiedText = $latin1.GetString((New-TempTrustContent $SampleCrlf))
  $truncated = [byte[]]$latin1.GetBytes($modifiedText.Substring(0, 60))
  Assert-Equal 'partial' (Remove-TempTrustBlock $truncated).Status '잘린 파일'
  $injected = [byte[]]$latin1.GetBytes($modifiedText.Replace("::1/128                 trust", "::1/128 trust`r`nhost all all 0.0.0.0/0 trust"))
  Assert-Equal 'partial' (Remove-TempTrustBlock $injected).Status '다른 규칙 포함'
}
Test-Case '복구 계획: 블록 있음 → 블록만 제거(백업과 일치)' {
  $plan = Get-RecoveryPlan (New-TempTrustContent $SampleCrlf) $SampleCrlf
  Assert-Equal 'remove-block' $plan.Action '동작'
  Assert-True $plan.MatchesBackup '백업과 일치'
}
Test-Case '복구 계획: 백업 이후 다른 수정이 있으면 그 수정은 보존' {
  $edited = [byte[]]($SampleCrlf + $latin1.GetBytes("host all all 10.0.0.0/8 scram-sha-256`r`n"))
  $plan = Get-RecoveryPlan (New-TempTrustContent $edited) $SampleCrlf
  Assert-Equal 'remove-block' $plan.Action '동작'
  Assert-True (-not $plan.MatchesBackup) '백업과 다름을 알림'
  Assert-Equal (Get-BytesSha256 $edited) (Get-BytesSha256 $plan.Bytes) '수정 보존'
}
Test-Case '복구 계획: 손상된 블록 → 백업 있으면 백업 복원, 없으면 수동 복구' {
  $truncated = [byte[]]$latin1.GetBytes($latin1.GetString((New-TempTrustContent $SampleCrlf)).Substring(0, 60))
  Assert-Equal 'restore-backup' (Get-RecoveryPlan $truncated $SampleCrlf).Action '백업 있음'
  Assert-Equal 'manual' (Get-RecoveryPlan $truncated $null).Action '백업 없음'
}
Test-Case '복구 계획: 블록 없음 → 아무것도 하지 않음 (중복 실행 안전)' {
  Assert-Equal 'none' (Get-RecoveryPlan $SampleCrlf $SampleCrlf).Action '동작'
  Assert-Equal 'none' (Get-RecoveryPlan $SampleCrlf $null).Action '백업 없음'
}
Test-Case '서비스 경로 파싱: 실제 PathName 형식, 경로 비교(대소문자·끝 \·/ 무시)' {
  $paths = Get-ServicePaths '"C:\Program Files\PostgreSQL\18\bin\pg_ctl.exe" runservice -N "postgresql-x64-18" -D "C:\Program Files\PostgreSQL\18\data" -w'
  Assert-Equal 'C:\Program Files\PostgreSQL\18\data' $paths.DataDir '데이터 폴더'
  Assert-Equal 'C:\Program Files\PostgreSQL\18\bin' $paths.BinDir '실행 파일 폴더'
  Assert-True (Test-SamePath 'c:\program files\postgresql\18\DATA\' 'C:\Program Files\PostgreSQL\18\data') '대소문자·끝 \'
  Assert-True (Test-SamePath 'C:/Program Files/PostgreSQL/18/data/pg_hba.conf' 'C:\Program Files\PostgreSQL\18\data\pg_hba.conf') '서버가 돌려주는 / 경로'
  Assert-True (-not (Test-SamePath 'C:\Program Files\PostgreSQL\17\data' 'C:\Program Files\PostgreSQL\18\data')) '다른 버전'
  Assert-True (-not (Test-SamePath $null 'C:\x')) '빈 값'
}
Test-Case '서비스 경로 정규화: Windows 드라이브 경로만 백슬래시로 맞추고 POSIX 경로는 유지' {
  Assert-Equal 'C:\Program Files\PostgreSQL\18\bin' (ConvertTo-WindowsServicePath 'C:/Program Files/PostgreSQL/18/bin') '슬래시 Windows 경로'
  Assert-Equal 'C:\Program Files\PostgreSQL\18\bin' (ConvertTo-WindowsServicePath 'C:\Program Files\PostgreSQL\18\bin') '기존 Windows 경로'
  Assert-Equal '/usr/lib/postgresql/18/bin' (ConvertTo-WindowsServicePath '/usr/lib/postgresql/18/bin') 'POSIX 경로'
  Assert-Equal '/opt/postgresql/bin' (ConvertTo-WindowsServicePath '/opt/postgresql/bin') '다른 POSIX 경로'
}

# ---------------------------------------------------------------------------
Write-Host "`n결과: 통과 $script:Passed, 실패 $($script:Failures.Count)" -ForegroundColor $(if ($script:Failures.Count) { 'Red' } else { 'Green' })
if ($script:Failures.Count) { exit 1 }
exit 0
