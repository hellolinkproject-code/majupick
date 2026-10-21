#Requires -Version 5.1
<#
.SYNOPSIS
  로컬 PostgreSQL 관리자(postgres) 비밀번호를 확인하거나, 잊었을 때 재설정한다 (사용자가 직접 실행).

.DESCRIPTION
  [1] 비밀번호를 알고 있는 경우: 인증 설정을 바꾸지 않고 접속만 확인한다(관리자 권한 불필요).
  [2] 비밀번호를 모르는 경우(관리자 권한 필요):
      1) 실제 서비스의 데이터 폴더·실행 파일 경로가 이 스크립트 설정과 같은지 확인한다.
      2) pg_hba.conf 를 SHA-256 해시 파일과 함께 백업하고, 미완료 작업 기록을 남긴다.
      3) 파일 맨 위에 임시 규칙 2줄을 추가한다.
         postgres 사용자 + postgres DB + 127.0.0.1/32, ::1/128 에서만 비밀번호 없이 접속(trust).
         Windows에서는 pg_hba.conf 변경이 새 연결에 바로 적용되므로 서비스를 재시작하지 않는다.
      4) psql \password 로 새 비밀번호를 입력받는다(화면 표시 없음, 제한 시간 있음).
      5) 원본 바이트로 복원하고, 해시 일치와 "비밀번호 없는 접속 거부"를 확인한다.
         확인에 실패하면 완료로 처리하지 않고 보안 경고를 표시한다(종료 코드 2).

  자동 복원은 스크립트 안의 오류와 Ctrl+C 에서만 동작한다. 창 닫기, 프로세스 강제 종료, 전원 차단,
  시스템 중단에서는 복원되지 않는다. 그때는 restore-pg-hba.ps1 또는 POSTGRES_RECOVERY.md 의 수동 절차를 따른다.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File apps\api\scripts\reset-postgres-password.ps1
#>
param(
  [string]$ServiceName = 'postgresql-x64-18',
  [string]$DataDir = 'C:\Program Files\PostgreSQL\18\data',
  [string]$BinDir = 'C:\Program Files\PostgreSQL\18\bin',
  [int]$Port = 5432,
  [string]$AdminUser = 'postgres',
  [ValidateRange(60, 900)]
  [int]$PasswordTimeoutSeconds = 300
)

$ErrorActionPreference = 'Stop'

$HbaPath = Join-Path $DataDir 'pg_hba.conf'
$PendingPath = "$HbaPath.workbridge-pending"
$Psql = Join-Path $BinDir 'psql.exe'
$PgIsReady = Join-Path $BinDir 'pg_isready.exe'
$RecoveryHint = '관리자 PowerShell에서 apps\api\scripts\restore-pg-hba.ps1 를 실행하세요 (자세한 절차: apps\api\scripts\POSTGRES_RECOVERY.md)'

function Write-Step([string]$Message) { Write-Host "`n▶ $Message" -ForegroundColor Cyan }
function Write-Ok([string]$Message) { Write-Host "  ✔ $Message" -ForegroundColor Green }
function Write-Warn([string]$Message) { Write-Host "  ! $Message" -ForegroundColor Yellow }
function Stop-Reset([string]$Message) {
  Write-Host "`n✖ $Message" -ForegroundColor Red
  exit 1
}

function Write-SecurityAlert([string[]]$Lines) {
  $bar = '!' * 72
  Write-Host "`n$bar" -ForegroundColor Red
  Write-Host '  [보안 경고] pg_hba.conf 복원이 확인되지 않았습니다.' -ForegroundColor Red
  Write-Host '  이 PC에서 postgres 관리자로 비밀번호 없이 접속될 수 있습니다.' -ForegroundColor Red
  foreach ($line in $Lines) { Write-Host "  - $line" -ForegroundColor Red }
  Write-Host '  apps\api\scripts\POSTGRES_RECOVERY.md 의 "수동 복구" 절차를 즉시 따라 주세요.' -ForegroundColor Red
  Write-Host $bar -ForegroundColor Red
}

function ConvertTo-PlainText([Security.SecureString]$Secure) {
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Secure)
  try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}

function Get-BytesSha256([byte[]]$Bytes) {
  $sha = [Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($sha.ComputeHash($Bytes)) -replace '-', '') }
  finally { $sha.Dispose() }
}

function New-TempTrustContent([byte[]]$OriginalBytes) {
  $latin1 = [Text.Encoding]::GetEncoding(28591)
  $text = $latin1.GetString($OriginalBytes)
  if ($text.Contains('WORKBRIDGE-TEMP-TRUST')) { throw 'pg_hba.conf already contains a WORKBRIDGE-TEMP-TRUST block' }
  $newline = if ($text.Contains("`r`n")) { "`r`n" } else { "`n" }
  $block = @(
    '# >>> WORKBRIDGE-TEMP-TRUST BEGIN (temporary rule for postgres password reset - delete this block if found)'
    'host    postgres        postgres        127.0.0.1/32            trust'
    'host    postgres        postgres        ::1/128                 trust'
    '# <<< WORKBRIDGE-TEMP-TRUST END'
  ) -join $newline
  $result = [byte[]]($latin1.GetBytes($block + $newline) + $OriginalBytes)
  return , $result
}

function Remove-TempTrustBlock([byte[]]$Bytes) {
  # latin1(28591)은 바이트와 문자가 1:1이므로, 블록 밖의 바이트는 그대로 보존된다.
  $latin1 = [Text.Encoding]::GetEncoding(28591)
  $text = $latin1.GetString($Bytes)
  $pattern = '(?m)^# >>> WORKBRIDGE-TEMP-TRUST BEGIN[^\r\n]*\r?\n' +
    '(?:host[ \t]+postgres[ \t]+postgres[ \t]+(?:127\.0\.0\.1/32|::1/128)[ \t]+trust[ \t]*\r?\n){1,2}' +
    '# <<< WORKBRIDGE-TEMP-TRUST END[^\r\n]*(?:\r?\n|$)'
  $removed = ([regex]::Matches($text, $pattern)).Count
  $result = [regex]::Replace($text, $pattern, '')
  if ($result.Contains('WORKBRIDGE-TEMP-TRUST')) { return @{ Status = 'partial'; Bytes = $null; Removed = $removed } }
  if ($removed -eq 0) { return @{ Status = 'absent'; Bytes = $Bytes; Removed = 0 } }
  return @{ Status = 'removed'; Bytes = [byte[]]$latin1.GetBytes($result); Removed = $removed }
}

# Linux pwsh의 Split-Path는 드라이브 경로의 '\'만 '/'로 바꾼다.
# 드라이브 문자로 시작하는 Windows 경로만 되돌린다. '/'로 시작하는 POSIX 경로는 그대로 둔다.
function ConvertTo-WindowsServicePath([string]$Path) {
  if (-not $Path) { return $Path }
  if ($Path -match '^[A-Za-z]:') { return ($Path -replace '/', '\') }
  return $Path
}

function Get-ServicePaths([string]$PathName) {
  $exe = $null
  $data = $null
  if ($PathName -match '^\s*"([^"]+)"') { $exe = $Matches[1] } elseif ($PathName -match '^\s*(\S+)') { $exe = $Matches[1] }
  if ($PathName -match '\s-D\s+"([^"]+)"') { $data = $Matches[1] } elseif ($PathName -match '\s-D\s+([^\s"]+)') { $data = $Matches[1] }
  $bin = $null
  if ($exe) { $bin = ConvertTo-WindowsServicePath (Split-Path -Parent $exe) }
  return @{ BinDir = $bin; DataDir = $data }
}

function Test-SamePath([string]$A, [string]$B) {
  if (-not $A -or -not $B) { return $false }
  $left = [IO.Path]::GetFullPath($A).TrimEnd('\', '/')
  $right = [IO.Path]::GetFullPath($B).TrimEnd('\', '/')
  return [string]::Equals($left, $right, [StringComparison]::OrdinalIgnoreCase)
}

function Test-ServerReady([string]$PgIsReadyPath, [string]$HostAddress, [int]$PortNumber) {
  $ErrorActionPreference = 'Continue'
  $null = & $PgIsReadyPath -h $HostAddress -p $PortNumber -t 5 2>&1
  return ($LASTEXITCODE -eq 0)
}

# Password가 비어 있으면 비밀번호 없이 접속을 시도한다(.pgpass도 쓰지 않음). 성공하면 $true.
function Test-PostgresLogin([string]$PsqlPath, [string]$HostAddress, [int]$PortNumber, [string]$User, [string]$Password) {
  $ErrorActionPreference = 'Continue'
  $saved = @{ PGPASSWORD = $env:PGPASSWORD; PGPASSFILE = $env:PGPASSFILE; PGCONNECT_TIMEOUT = $env:PGCONNECT_TIMEOUT }
  try {
    if ($Password) { $env:PGPASSWORD = $Password } else { Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue }
    $env:PGPASSFILE = Join-Path ([IO.Path]::GetTempPath()) "workbridge-no-pgpass-$PID"
    $env:PGCONNECT_TIMEOUT = '5'
    $null = & $PsqlPath -h $HostAddress -p $PortNumber -U $User -d postgres -w -X -t -A -c 'SELECT 1' 2>&1
    return ($LASTEXITCODE -eq 0)
  }
  finally {
    foreach ($key in $saved.Keys) {
      if ($null -eq $saved[$key]) { Remove-Item "Env:$key" -ErrorAction SilentlyContinue }
      else { Set-Item "Env:$key" $saved[$key] }
    }
  }
}

# 비밀이 들어 있지 않은 조회만 실행한다. Password가 비어 있으면 비밀번호 없이 접속한다.
function Invoke-PsqlQuery([string]$Sql, [string]$Password) {
  $ErrorActionPreference = 'Continue'
  $saved = @{ PGPASSWORD = $env:PGPASSWORD; PGPASSFILE = $env:PGPASSFILE }
  try {
    if ($Password) { $env:PGPASSWORD = $Password } else { Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue }
    $env:PGPASSFILE = Join-Path ([IO.Path]::GetTempPath()) "workbridge-no-pgpass-$PID"
    $output = & $Psql -h 127.0.0.1 -p $Port -U $AdminUser -d postgres -w -X -t -A -c $Sql 2>&1
    $exitCode = $LASTEXITCODE
  }
  finally {
    foreach ($key in $saved.Keys) {
      if ($null -eq $saved[$key]) { Remove-Item "Env:$key" -ErrorAction SilentlyContinue }
      else { Set-Item "Env:$key" $saved[$key] }
    }
  }
  $text = (@($output) | ForEach-Object { "$_" } | Where-Object { $_.Trim() -ne '' }) -join "`n"
  return @{ ExitCode = $exitCode; Output = $text.Trim() }
}

# 임시 규칙으로 접속해 psql \password 를 실행한다. 제한 시간이 지나면 psql을 끝내고 실패로 처리한다.
function Invoke-PasswordPrompt {
  $saved = @{ PGPASSWORD = $env:PGPASSWORD; PGPASSFILE = $env:PGPASSFILE }
  try {
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
    $env:PGPASSFILE = Join-Path ([IO.Path]::GetTempPath()) "workbridge-no-pgpass-$PID"
    $argumentLine = "-h 127.0.0.1 -p $Port -U $AdminUser -d postgres -w -X -c `"\password $AdminUser`""
    $process = Start-Process -FilePath $Psql -ArgumentList $argumentLine -NoNewWindow -PassThru
    $null = $process.Handle
    if (-not $process.WaitForExit($PasswordTimeoutSeconds * 1000)) {
      try { $process.Kill() } catch { Write-Verbose 'psql already exited' }
      throw "제한 시간(${PasswordTimeoutSeconds}초) 안에 입력이 끝나지 않아 중단했습니다."
    }
    $process.WaitForExit()
    return ($process.ExitCode -eq 0)
  }
  finally {
    foreach ($key in $saved.Keys) {
      if ($null -eq $saved[$key]) { Remove-Item "Env:$key" -ErrorAction SilentlyContinue }
      else { Set-Item "Env:$key" $saved[$key] }
    }
  }
}

# ---------------------------------------------------------------------------
Write-Host 'PostgreSQL 관리자 비밀번호 확인·재설정' -ForegroundColor White
Write-Host @"

  비밀번호를 알고 있다면 인증 설정(pg_hba.conf)을 바꿀 필요가 없습니다.
    [1] 비밀번호를 알고 있다   → 설정 변경 없이 접속만 확인합니다
    [2] 비밀번호를 모른다      → 임시 인증 규칙으로 재설정합니다 (관리자 권한 필요)
    [Q] 취소
  pgAdmin에 비밀번호가 저장돼 있어 접속된다면, pgAdmin에서 바꾸는 방법이 더 안전합니다(POSTGRES_RECOVERY.md 참고).
"@
$choice = Read-Host '  선택 (1/2/Q)'

foreach ($path in @($Psql, $PgIsReady)) {
  if (-not (Test-Path -LiteralPath $path)) { Stop-Reset "파일을 찾을 수 없습니다: $path (-BinDir 확인)" }
}

if ($choice -eq '1') {
  Write-Step '설정 변경 없이 접속 확인'
  if (-not (Test-ServerReady $PgIsReady '127.0.0.1' $Port)) {
    Stop-Reset 'PostgreSQL 서버가 응답하지 않습니다. 서비스가 실행 중인지 확인해 주세요.'
  }
  $knownSecure = Read-Host "  '$AdminUser' 비밀번호를 입력하세요 (화면에 표시되지 않음)" -AsSecureString
  $knownPassword = ConvertTo-PlainText $knownSecure
  try {
    $loginOk = $knownPassword -and (Test-PostgresLogin $Psql '127.0.0.1' $Port $AdminUser $knownPassword)
  }
  finally { $knownPassword = $null }
  if (-not $loginOk) {
    Stop-Reset '접속하지 못했습니다. 아무 설정도 바꾸지 않았습니다. 다시 실행해 비밀번호를 확인하거나 [2]를 선택하세요.'
  }
  Write-Ok '접속 성공. 인증 설정은 바꾸지 않았습니다.'
  Write-Host "`n이제 일반 PowerShell에서 setup-local-db.ps1 을 실행하세요." -ForegroundColor Green
  exit 0
}
if ($choice -ne '2') { Stop-Reset '취소했습니다. 아무것도 바꾸지 않았습니다.' }

# ---- 사전 점검 (아무것도 바꾸지 않음) ----
Write-Step '사전 점검 (변경 없음)'
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Stop-Reset "관리자 권한이 필요합니다. 'Windows PowerShell'을 마우스 오른쪽 버튼 → '관리자 권한으로 실행'으로 연 뒤 다시 실행하세요."
}
if (-not (Test-Path -LiteralPath $HbaPath)) { Stop-Reset "pg_hba.conf 를 찾을 수 없습니다: $HbaPath" }

$service = Get-CimInstance Win32_Service -Filter "Name='$ServiceName'"
if (-not $service) { Stop-Reset "서비스를 찾을 수 없습니다: $ServiceName" }
if ($service.State -ne 'Running') { Stop-Reset "서비스가 실행 중이 아닙니다($($service.State)). 이 스크립트는 서비스를 시작·재시작하지 않습니다." }
$servicePaths = Get-ServicePaths $service.PathName
if (-not (Test-SamePath $servicePaths.DataDir $DataDir)) {
  Stop-Reset "서비스의 데이터 폴더($($servicePaths.DataDir))가 -DataDir($DataDir)와 다릅니다."
}
if (-not (Test-SamePath $servicePaths.BinDir $BinDir)) {
  Stop-Reset "서비스의 실행 파일 폴더($($servicePaths.BinDir))가 -BinDir($BinDir)와 다릅니다."
}
Write-Ok "서비스 $ServiceName 실행 중, 데이터 폴더 일치"

foreach ($conf in @('postgresql.conf', 'postgresql.auto.conf')) {
  $confPath = Join-Path $DataDir $conf
  if (-not (Test-Path -LiteralPath $confPath)) { continue }
  $overrides = @(Get-Content -LiteralPath $confPath | Where-Object { $_ -match '^\s*(hba_file|include|include_if_exists|include_dir)\b' })
  if ($overrides.Count -gt 0) {
    Stop-Reset "$conf 에 hba_file 또는 include 설정이 있어 실제 인증 파일 위치를 확정할 수 없습니다: $($overrides -join ' / ')"
  }
}
Write-Ok '인증 파일 위치 변경 설정 없음 (pg_hba.conf 사용)'

if (Test-Path -LiteralPath $PendingPath) {
  Stop-Reset "이전 재설정 작업이 끝나지 않은 기록이 있습니다: $PendingPath`n  $RecoveryHint"
}
$originalBytes = [IO.File]::ReadAllBytes($HbaPath)
if ([Text.Encoding]::GetEncoding(28591).GetString($originalBytes).Contains('WORKBRIDGE-TEMP-TRUST')) {
  Stop-Reset "pg_hba.conf 에 이전 임시 규칙이 남아 있습니다.`n  $RecoveryHint"
}
if (-not (Test-ServerReady $PgIsReady '127.0.0.1' $Port)) { Stop-Reset 'PostgreSQL 서버가 응답하지 않습니다.' }
if (Test-PostgresLogin $Psql '127.0.0.1' $Port $AdminUser $null) {
  Stop-Reset "이미 비밀번호 없이 '$AdminUser' 접속이 가능합니다. 설정을 직접 점검해야 하므로 아무것도 바꾸지 않고 멈춥니다."
}
Write-Ok '이전 작업 흔적 없음, 현재 비밀번호 인증 적용 중'

Write-Host @"

  진행 내용
  1) pg_hba.conf 백업 (+ SHA-256 해시 파일, 미완료 작업 기록)
  2) 파일 맨 위에 임시 규칙 2줄 추가
       host  postgres  postgres  127.0.0.1/32  trust
       host  postgres  postgres  ::1/128       trust
     → 이 PC 안에서 postgres 사용자로 postgres DB에 접속할 때만 비밀번호를 묻지 않습니다.
     → Windows에서는 새 연결에 바로 적용되므로 서비스를 재시작하지 않습니다(다른 연결 영향 없음).
  3) psql 로 새 비밀번호를 두 번 입력 (제한 시간 ${PasswordTimeoutSeconds}초)
  4) 원본으로 복원 → 해시 비교 → 비밀번호 없는 접속이 거부되는지 확인

  주의
  - 임시 규칙이 있는 동안에는 이 PC의 프로그램이 postgres 관리자로 비밀번호 없이 접속할 수 있습니다.
  - 오류·Ctrl+C 에서는 자동으로 복원합니다. 창을 닫거나, 전원이 꺼지거나, PC가 멈추면 복원되지 않습니다.
    그 경우: $RecoveryHint
"@
$answer = Read-Host '  진행할까요? (y/N)'
if ($answer -notmatch '^(y|yes)$') { Stop-Reset '취소했습니다. 아무것도 바꾸지 않았습니다.' }

# ---- 백업 ----
Write-Step 'pg_hba.conf 백업'
$originalHash = Get-BytesSha256 $originalBytes
if ((Get-BytesSha256 ([IO.File]::ReadAllBytes($HbaPath))) -ne $originalHash) {
  Stop-Reset 'pg_hba.conf 가 점검 도중 바뀌었습니다. 아무것도 바꾸지 않았습니다.'
}
$backupPath = "$HbaPath.workbridge-backup-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
[IO.File]::WriteAllBytes($backupPath, $originalBytes)
[IO.File]::WriteAllText("$backupPath.sha256", "$originalHash  pg_hba.conf`n", [Text.Encoding]::ASCII)
if ((Get-BytesSha256 ([IO.File]::ReadAllBytes($backupPath))) -ne $originalHash) {
  Stop-Reset '백업 파일 검증에 실패했습니다. 아무것도 바꾸지 않았습니다.'
}
$pending = @{ backupPath = $backupPath; sha256 = $originalHash; hbaPath = $HbaPath; createdAt = (Get-Date).ToString('o') }
[IO.File]::WriteAllText($PendingPath, ($pending | ConvertTo-Json), (New-Object Text.UTF8Encoding($false)))
Write-Ok "백업: $backupPath"
Write-Ok "해시: $backupPath.sha256"

# ---- 임시 규칙 적용 → 비밀번호 변경 → 복원 ----
$touched = $false
$passwordSet = $false
try {
  Write-Step '임시 규칙 추가'
  $modifiedBytes = New-TempTrustContent $originalBytes
  $touched = $true
  [IO.File]::WriteAllBytes($HbaPath, $modifiedBytes)
  if ((Get-BytesSha256 ([IO.File]::ReadAllBytes($HbaPath))) -ne (Get-BytesSha256 $modifiedBytes)) {
    throw '임시 규칙을 쓴 파일을 다시 읽어 비교했지만 일치하지 않습니다.'
  }

  $trustActive = $false
  for ($i = 0; $i -lt 5 -and -not $trustActive; $i++) {
    if (Test-PostgresLogin $Psql '127.0.0.1' $Port $AdminUser $null) { $trustActive = $true } else { Start-Sleep -Seconds 1 }
  }
  if (-not $trustActive) { throw '임시 규칙이 새 연결에 적용되지 않았습니다(서비스는 재시작하지 않았습니다).' }

  $settings = Invoke-PsqlQuery "SELECT current_setting('hba_file') || '|' || current_setting('data_directory')" $null
  $parts = $settings.Output -split '\|'
  if ($settings.ExitCode -ne 0 -or $parts.Count -ne 2 -or -not (Test-SamePath $parts[0] $HbaPath) -or -not (Test-SamePath $parts[1] $DataDir)) {
    throw '실행 중인 서버가 사용하는 인증 파일·데이터 폴더가 예상과 다릅니다.'
  }
  Write-Ok '임시 규칙 적용 확인 (서버가 이 pg_hba.conf 를 사용 중)'

  Write-Step "새 '$AdminUser' 비밀번호 입력"
  Write-Host '  새 비밀번호를 두 번 입력하세요. 화면에는 표시되지 않습니다. 안전한 곳에 기록해 두세요.'
  Write-Host '  psql 이 비밀번호를 해시로 바꿔 서버에 보내므로, 평문 비밀번호는 서버 로그에 남지 않습니다.'
  $passwordSet = Invoke-PasswordPrompt
  if (-not $passwordSet) { throw '비밀번호를 바꾸지 못했습니다(두 입력이 다르거나 입력을 취소한 경우).' }
  Write-Ok '비밀번호 변경 완료'
}
catch {
  Write-Host "`n✖ $($_.Exception.Message)" -ForegroundColor Red
}
finally {
  if ($touched) {
    Write-Step '원래 설정으로 복원'
    $problems = @()
    try { [IO.File]::WriteAllBytes($HbaPath, $originalBytes) }
    catch { $problems += "파일 쓰기 실패: $($_.Exception.Message)" }
    try {
      $restoredBytes = [IO.File]::ReadAllBytes($HbaPath)
      if ((Get-BytesSha256 $restoredBytes) -ne $originalHash) { $problems += '복원한 파일의 해시가 원본과 다릅니다' }
    }
    catch { $problems += "복원한 파일을 읽지 못했습니다: $($_.Exception.Message)" }

    if (-not (Test-ServerReady $PgIsReady '127.0.0.1' $Port)) {
      $problems += 'PostgreSQL 서버가 응답하지 않아 인증 규칙을 확인하지 못했습니다'
    }
    else {
      foreach ($address in @('127.0.0.1', '::1')) {
        if (Test-PostgresLogin $Psql $address $Port $AdminUser $null) {
          $problems += "$address 에서 비밀번호 없이 접속됩니다"
        }
      }
    }

    if ($problems.Count -gt 0) {
      Write-SecurityAlert ($problems + "백업: $backupPath" + $RecoveryHint)
      exit 2
    }
    Remove-Item -LiteralPath $PendingPath -ErrorAction SilentlyContinue
    Write-Ok '원본 해시 일치, 비밀번호 없는 접속 거부 확인 (백업 파일은 남겨 둡니다)'
  }
  else {
    Remove-Item -LiteralPath $PendingPath -ErrorAction SilentlyContinue
  }
}

if (-not $passwordSet) {
  Write-Host "`n비밀번호는 바뀌지 않았고, 인증 설정은 원래대로 확인됐습니다. 다시 실행할 수 있습니다." -ForegroundColor Yellow
  exit 1
}

# ---- 새 비밀번호와 인증 규칙 확인 ----
Write-Step '새 비밀번호로 접속 확인'
$confirmSecure = Read-Host '  확인을 위해 새 비밀번호를 한 번 더 입력하세요 (건너뛰려면 Enter)' -AsSecureString
if ($confirmSecure.Length -eq 0) {
  Write-Warn '확인을 건너뛰었습니다. setup-local-db.ps1 실행 시 새 비밀번호로 접속되는지 확인됩니다.'
}
else {
  $confirmPassword = ConvertTo-PlainText $confirmSecure
  try {
    $rules = Invoke-PsqlQuery "SELECT count(*) FILTER (WHERE error IS NOT NULL) || '|' || count(*) FILTER (WHERE auth_method = 'trust') FROM pg_hba_file_rules" $confirmPassword
  }
  finally { $confirmPassword = $null }
  if ($rules.ExitCode -ne 0) {
    Write-Warn '새 비밀번호로 접속하지 못했습니다. 입력 실수일 수 있습니다. 인증 설정은 이미 원래대로 확인됐으므로 다시 실행해도 됩니다.'
    exit 1
  }
  $counts = $rules.Output -split '\|'
  Write-Ok '새 비밀번호로 접속 성공'
  if ($counts[0] -ne '0') { Write-Warn "pg_hba.conf 에 오류가 있는 줄이 $($counts[0])개 있습니다(pg_hba_file_rules 확인)." }
  else { Write-Ok 'pg_hba_file_rules: 오류 없음' }
  if ($counts[1] -ne '0') { Write-Warn "원본 pg_hba.conf 에 원래 있던 trust 규칙이 $($counts[1])개 있습니다(이번 작업에서 추가한 규칙 아님)." }
  else { Write-Ok 'pg_hba_file_rules: trust 규칙 없음' }
}

Write-Host "`n완료되었습니다. 이제 일반 PowerShell에서 setup-local-db.ps1 을 실행해 새 비밀번호를 입력하세요." -ForegroundColor Green
exit 0
