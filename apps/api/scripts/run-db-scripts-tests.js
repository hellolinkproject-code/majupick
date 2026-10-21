// Windows(`powershell`/`pwsh`)·Linux CI(`pwsh`)에서 동일한 PowerShell 검사 스크립트를 실행한다.
// 검사 로직(db-scripts.tests.ps1)은 바꾸지 않는다.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const apiDir = fileURLToPath(new URL('..', import.meta.url));
const scriptPath = path.join(apiDir, 'scripts', 'tests', 'db-scripts.tests.ps1');

/** @returns {string | null} */
function resolvePowerShell() {
  // Windows는 Windows PowerShell 5.1(`powershell`)이 기본. Linux/macOS Actions는 `pwsh`만 있다.
  const candidates =
    process.platform === 'win32'
      ? ['powershell.exe', 'powershell', 'pwsh']
      : ['pwsh', 'powershell'];

  for (const command of candidates) {
    const probe = spawnSync(command, ['-NoProfile', '-Command', 'exit 0'], {
      encoding: 'utf8',
      windowsHide: true,
    });
    if (!probe.error && probe.status === 0) return command;
  }
  return null;
}

const shell = resolvePowerShell();
if (!shell) {
  console.error(
    '[test:scripts] Neither pwsh nor powershell was found. Install PowerShell 7+ (pwsh) for Linux CI, or use Windows PowerShell locally.',
  );
  process.exit(1);
}

console.log(`[test:scripts] using ${shell}`);
const result = spawnSync(shell, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath], {
  cwd: apiDir,
  stdio: 'inherit',
  windowsHide: true,
  env: process.env,
});

if (result.error) {
  console.error(`[test:scripts] failed to start ${shell}: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
