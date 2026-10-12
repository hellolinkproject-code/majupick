#Requires -Version 5.1
<#
.SYNOPSIS
  reset-postgres-password.ps1 이 남긴 임시 인증 규칙을 찾아 제거하고, 비밀번호 인증이 다시 적용되는지 확인한다.

.DESCRIPTION
  reset-postgres-password.ps1 과 독립적으로 동작한다. 그 스크립트가 창 닫기·전원 차단·강제 종료 등으로
  끝까지 실행되지 못했을 때 사용한다.

  -CheckOnly : 아무것도 바꾸지 않고 상태만 점검한다(관리자 권한 불필요).
  기본 동작  : 관리자 권한으로 실행. pg_hba.conf 에서 WORKBRIDGE-TEMP-TRUST 블록만 정확히 제거한다.
               블록이 손상돼 정확히 제거할 수 없으면, 해시가 검증된 백업으로 되돌릴지 묻는다.
  어느 경우에도 서비스는 재시작하지 않는다. Windows에서는 pg_hba.conf 변경이 새 연결에 바로 적용된다.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File apps\api\scripts\restore-pg-hba.ps1 -CheckOnly
  (관리자 PowerShell) powershell -ExecutionPolicy Bypass -File apps\api\scripts\restore-pg-hba.ps1
#>
param(
  [string]$DataDir = 'C:\Program Files\PostgreSQL\18\data',
  [string]$BinDir = 'C:\Program Files\PostgreSQL\18\bin',
  [int]$Port = 5432,
  [string]$AdminUser = 'postgres',
  [switch]$CheckOnly
)

$ErrorActionPreference = 'Stop'

$HbaPath = Join-Path $DataDir 'pg_hba.conf'
$PendingPath = "$HbaPath.workbridge-pending"
$Psql = Join-Path $BinDir 'psql.exe'
$PgIsReady = Join-Path $BinDir 'pg_isready.exe'

function Write-Step([string]$Message) { Write-Host "`n▶ $Message" -ForegroundColor Cyan }
function Write-Ok([string]$Message) { Write-Host "  ✔ $Message" -ForegroundColor Green }
function Write-Warn([string]$Message) { Write-Host "  ! $Message" -ForegroundColor Yellow }

function Write-SecurityAlert([string[]]$Lines) {
  $bar = '!' * 72
  Write-Host "`n$bar" -ForegroundColor Red
  Write-Host '  [보안 경고] pg_hba.conf 복원이 확인되지 않았습니다.' -ForegroundColor Red
  Write-Host '  이 PC에서 postgres 관리자로 비밀번호 없이 접속될 수 있습니다.' -ForegroundColor Red
  foreach ($line in $Lines) { Write-Host "  - $line" -ForegroundColor Red }
  Write-Host '  apps\api\scripts\POSTGRES_RECOVERY.md 의 "수동 복구" 절차를 즉시 따라 주세요.' -ForegroundColor Red
  Write-Host $bar -ForegroundColor Red
}

function Get-BytesSha256([byte[]]$Bytes) {
  $sha = [Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($sha.ComputeHash($Bytes)) -replace '-', '') }
  finally { $sha.Dispose() }
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

function Get-RecoveryPlan([byte[]]$CurrentBytes, [byte[]]$BackupBytes) {
  $scan = Remove-TempTrustBlock $CurrentBytes
  $hasBackup = $null -ne $BackupBytes
  switch ($scan.Status) {
    'absent' {
      $same = (-not $hasBackup) -or ((Get-BytesSha256 $CurrentBytes) -eq (Get-BytesSha256 $BackupBytes))
      return @{ Action = 'none'; Bytes = $null; MatchesBackup = $same; HasBackup = $hasBackup }
    }
    'removed' {
      $same = (-not $hasBackup) -or ((Get-BytesSha256 $scan.Bytes) -eq (Get-BytesSha256 $BackupBytes))
      return @{ Action = 'remove-block'; Bytes = $scan.Bytes; MatchesBackup = $same; HasBackup = $hasBackup }
    }
    default {
      if ($hasBackup) { return @{ Action = 'restore-backup'; Bytes = $BackupBytes; MatchesBackup = $true; HasBackup = $true } }
      return @{ Action = 'manual'; Bytes = $null; MatchesBackup = $false; HasBackup = $false }
    }
  }
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

function Test-PasswordAuthEnforced {
  $problems = @()
  if (-not (Test-ServerReady $PgIsReady '127.0.0.1' $Port)) {
    return @('PostgreSQL 서버가 응답하지 않아 인증 규칙을 확인하지 못했습니다(서비스 상태 확인 필요)')
  }
  foreach ($address in @('127.0.0.1', '::1')) {
    if (Test-PostgresLogin $Psql $address $Port $AdminUser $null) {
      $problems += "$address 에서 $AdminUser 계정이 비밀번호 없이 접속됩니다"
    }
  }
  return $problems
}

function Get-VerifiedBackup {
  $candidates = @()
  if (Test-Path -LiteralPath $PendingPath) {
    try {
      $pending = [IO.File]::ReadAllText($PendingPath) | ConvertFrom-Json
      if ($pending.backupPath) { $candidates += [string]$pending.backupPath }
    }
    catch { Write-Warn "작업 기록 파일을 읽지 못했습니다: $PendingPath" }
  }
  $candidates += @(Get-ChildItem -LiteralPath $DataDir -Filter 'pg_hba.conf.workbridge-backup-*' -File |
      Where-Object { $_.Name -notlike '*.sha256' } | Sort-Object Name -Descending |
      ForEach-Object { $_.FullName })

  foreach ($path in ($candidates | Select-Object -Unique)) {
    $hashFile = "$path.sha256"
    if (-not (Test-Path -LiteralPath $path) -or -not (Test-Path -LiteralPath $hashFile)) { continue }
    $bytes = [IO.File]::ReadAllBytes($path)
    $expected = (([IO.File]::ReadAllText($hashFile)).Trim() -split '\s+')[0]
    $latin1 = [Text.Encoding]::GetEncoding(28591)
    if ((Get-BytesSha256 $bytes) -eq $expected -and -not $latin1.GetString($bytes).Contains('WORKBRIDGE-TEMP-TRUST')) {
      return @{ Path = $path; Bytes = $bytes; Hash = $expected }
    }
    Write-Warn "해시가 맞지 않거나 임시 규칙이 들어 있는 백업은 사용하지 않습니다: $path"
  }
  return $null
}

# ---------------------------------------------------------------------------
Write-Host 'pg_hba.conf 임시 인증 규칙 점검·복구' -ForegroundColor White

if (-not (Test-Path -LiteralPath $HbaPath)) {
  Write-Host "✖ pg_hba.conf 를 찾을 수 없습니다: $HbaPath (-DataDir 확인)" -ForegroundColor Red
  exit 1
}

Write-Step '현재 상태'
$currentBytes = [IO.File]::ReadAllBytes($HbaPath)
$backup = Get-VerifiedBackup
$plan = Get-RecoveryPlan $currentBytes $(if ($backup) { $backup.Bytes } else { $null })
$pendingExists = Test-Path -LiteralPath $PendingPath

$blockState = switch ($plan.Action) {
  'none' { '없음' }
  'remove-block' { '있음 (정확히 제거 가능)' }
  'restore-backup' { '손상됨 (백업으로 복원 필요)' }
  default { '손상됨 (백업 없음, 수동 복구 필요)' }
}
Write-Host "  - 임시 규칙 블록  : $blockState"
Write-Host "  - 미완료 작업 기록: $(if ($pendingExists) { "있음 ($PendingPath)" } else { '없음' })"
Write-Host "  - 검증된 백업     : $(if ($backup) { $backup.Path } else { '없음' })"
if ($plan.Action -eq 'none' -and $backup -and -not $plan.MatchesBackup) {
  Write-Warn '현재 파일이 백업과 다릅니다. 백업 이후 직접 수정했다면 정상일 수 있습니다(자동으로 되돌리지 않음).'
}

if ($CheckOnly) {
  $problems = @(Test-PasswordAuthEnforced)
  if ($plan.Action -ne 'none') { $problems += 'pg_hba.conf 에 WORKBRIDGE-TEMP-TRUST 블록이 남아 있습니다' }
  if ($problems.Count -gt 0) {
    Write-SecurityAlert ($problems + '관리자 PowerShell에서 -CheckOnly 없이 이 스크립트를 실행하세요')
    exit 2
  }
  Write-Ok '임시 규칙 없음, 비밀번호 없는 관리자 접속 거부 확인'
  if ($pendingExists) { Write-Warn '미완료 작업 기록이 남아 있습니다. -CheckOnly 없이 실행하면 확인 후 정리합니다.' }
  exit 0
}

$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Host "✖ 관리자 권한이 필요합니다. 'Windows PowerShell'을 마우스 오른쪽 버튼 → '관리자 권한으로 실행'으로 연 뒤 다시 실행하세요." -ForegroundColor Red
  exit 1
}

switch ($plan.Action) {
  'manual' {
    Write-SecurityAlert @('임시 규칙 블록이 손상됐고 검증된 백업도 없어 자동으로 고칠 수 없습니다')
    exit 2
  }
  'none' {
    Write-Ok '고칠 내용이 없습니다(pg_hba.conf 는 그대로 둡니다)'
  }
  default {
    $description = if ($plan.Action -eq 'remove-block') {
      'pg_hba.conf 에서 WORKBRIDGE-TEMP-TRUST 블록만 제거합니다(다른 줄은 그대로).'
    }
    else {
      "pg_hba.conf 를 검증된 백업으로 되돌립니다: $($backup.Path)"
    }
    Write-Host "`n  $description"
    if ($plan.Action -eq 'remove-block' -and $plan.HasBackup -and -not $plan.MatchesBackup) {
      Write-Warn '제거 결과가 백업과 다릅니다. 백업 이후의 다른 수정 사항은 보존됩니다.'
    }
    $answer = Read-Host '  진행할까요? (y/N)'
    if ($answer -notmatch '^(y|yes)$') { Write-Warn '취소했습니다. 아무것도 바꾸지 않았습니다.'; exit 1 }

    Write-Step 'pg_hba.conf 수정'
    [IO.File]::WriteAllBytes($HbaPath, $plan.Bytes)
    $written = [IO.File]::ReadAllBytes($HbaPath)
    if ((Get-BytesSha256 $written) -ne (Get-BytesSha256 $plan.Bytes)) {
      Write-SecurityAlert @('수정한 파일을 다시 읽어 비교했지만 내용이 일치하지 않습니다')
      exit 2
    }
    Write-Ok '파일 수정 및 재확인 완료'
  }
}

Write-Step '비밀번호 인증 적용 확인'
$finalBytes = [IO.File]::ReadAllBytes($HbaPath)
$problems = @(Test-PasswordAuthEnforced)
if ([Text.Encoding]::GetEncoding(28591).GetString($finalBytes).Contains('WORKBRIDGE-TEMP-TRUST')) {
  $problems += 'pg_hba.conf 에 임시 규칙 표시가 아직 남아 있습니다'
}
if ($problems.Count -gt 0) {
  Write-SecurityAlert $problems
  exit 2
}
Write-Ok '임시 규칙 없음, 비밀번호 없는 관리자 접속이 거부됨'
if ($backup) {
  if ((Get-BytesSha256 $finalBytes) -eq $backup.Hash) { Write-Ok '현재 파일이 백업(원본)과 해시까지 일치' }
  else { Write-Warn '현재 파일이 백업과 다릅니다(백업 이후의 다른 수정이 남아 있을 수 있음).' }
}

if ($pendingExists) {
  Remove-Item -LiteralPath $PendingPath
  Write-Ok '미완료 작업 기록을 정리했습니다(백업 파일은 남겨 둡니다)'
}
Write-Host "`n복구 확인이 끝났습니다." -ForegroundColor Green
exit 0
