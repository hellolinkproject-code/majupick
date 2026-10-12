# 로컬 PostgreSQL 관리자 비밀번호·인증 설정 복구 안내

WorkBridge 로컬 DB를 준비할 때 사용하는 스크립트와, 문제가 생겼을 때 직접 따라 할 수 있는 복구 절차를 정리한다.
기준 환경: Windows, PostgreSQL 18 (서비스 `postgresql-x64-18`, 데이터 폴더 `C:\Program Files\PostgreSQL\18\data`).

| 스크립트                      | 언제                                     | 권한                                           |
| ----------------------------- | ---------------------------------------- | ---------------------------------------------- |
| `setup-local-db.ps1`          | WorkBridge 계정·DB 준비 (다시 실행 가능) | 일반 PowerShell                                |
| `reset-postgres-password.ps1` | 관리자(`postgres`) 비밀번호 확인·재설정  | [1] 확인: 일반 / [2] 재설정: 관리자 PowerShell |
| `restore-pg-hba.ps1`          | 재설정 도중 창이 닫히는 등 비정상 종료   | `-CheckOnly`: 일반 / 복구: 관리자 PowerShell   |

> 관리자 PowerShell 여는 법: 시작 메뉴에서 **Windows PowerShell**을 마우스 오른쪽 버튼으로 눌러 **관리자 권한으로 실행**.
> 모든 명령은 먼저 `cd C:\Users\jun\Desktop\workbridge` 로 프로젝트 폴더에 들어간 뒤 실행한다.
> 비밀번호는 채팅·메모장·명령줄에 적지 않는다. 스크립트가 화면에 표시하지 않는 방식으로 묻는다.

## A. 관리자 비밀번호를 알고 있는 경우 (인증 설정 변경 없음)

1. 일반 PowerShell에서 실행한다.

   ```powershell
   powershell -ExecutionPolicy Bypass -File apps\api\scripts\setup-local-db.ps1
   ```

2. 직접 입력하는 항목
   - `postgres` 비밀번호 (화면 표시 없음)
   - 점검 결과 확인 후 `y`
   - `workbridge_app` 새 비밀번호 2회 (psql이 묻는다, 화면 표시 없음)
   - 같은 비밀번호 1회 더 (`.env` 저장 전 실제 로그인 확인용)
3. 확인: `npm run db:check -w apps/api` → 3줄 모두 ✔, `superuser=false`, `TimeZone=UTC`

스크립트가 보장하는 최소 권한

- `workbridge_app`: 로그인만 가능. superuser·createdb·createrole·replication·bypassrls 없음, 다른 역할에 소속 없음.
- DB 3개(`workbridge_dev`, `workbridge_test`, `workbridge_shadow`)의 소유자. 다른 계정의 접속 권한(PUBLIC)은 회수한다.
- WorkBridge 외의 사용자·DB 권한은 조회만 하고 바꾸지 않는다. 같은 이름의 DB가 다른 계정 소유이면 멈춘다.
- 비밀번호는 SQL 문에 넣지 않는다(psql `\password`가 해시로 바꿔 전송). 서버 로그에 평문이 남지 않는다.
- 중간에 멈춰도 다시 실행하면 이어서 진행한다. `.env`는 로그인 확인 후에만 저장하고, 기존 `.env`는 `.env.backup-날짜`로 먼저 백업한다.

비밀번호를 정확히 알고 있는지 확인만 하고 싶다면 `reset-postgres-password.ps1` 을 실행해 **[1]** 을 고른다. 아무 설정도 바꾸지 않는다.

## B. 관리자 비밀번호를 잊은 경우

### B-0. 먼저 시도할 것 (설정 변경 없음)

- 설치 때 남긴 메모, 비밀번호 관리자를 확인한다.
- pgAdmin에 비밀번호가 저장돼 있어 접속된다면: pgAdmin → 서버 → Login/Group Roles → `postgres` → Properties → Definition 에서 새 비밀번호를 정한다. 인증 설정 파일을 건드리지 않아 가장 안전하다.

### B-1. 재설정 스크립트

1. 준비
   - 비밀번호 입력 단계에서 **창을 닫지 않을 수 있는 시간**에 진행한다(제한 시간 기본 5분).
   - 서비스는 재시작하지 않으므로 다른 프로젝트의 DB 연결은 끊기지 않는다.
2. 관리자 PowerShell에서 실행하고 **[2]** 를 고른다.

   ```powershell
   powershell -ExecutionPolicy Bypass -File apps\api\scripts\reset-postgres-password.ps1
   ```

3. 스크립트가 하는 일
   1. 실행 중인 서비스의 데이터 폴더·실행 파일 폴더가 스크립트 설정과 같은지, `hba_file`·`include` 설정이 없는지 확인한다.
   2. `pg_hba.conf` 를 `pg_hba.conf.workbridge-backup-날짜` 로 백업하고, SHA-256 해시를 `….sha256` 에 저장한다. 미완료 작업 기록 `pg_hba.conf.workbridge-pending` 을 남긴다.
   3. 파일 **맨 위**에 아래 4줄을 추가한다. PostgreSQL은 위에서부터 처음 맞는 규칙을 쓰므로, 이 PC 안에서 `postgres` 사용자로 `postgres` DB에 접속할 때만 비밀번호를 묻지 않는다.

      ```text
      # >>> WORKBRIDGE-TEMP-TRUST BEGIN (temporary rule for postgres password reset - delete this block if found)
      host    postgres        postgres        127.0.0.1/32            trust
      host    postgres        postgres        ::1/128                 trust
      # <<< WORKBRIDGE-TEMP-TRUST END
      ```

      Windows에서는 `pg_hba.conf` 변경이 이후 새 연결에 바로 적용된다(PostgreSQL 공식 문서 20.1). 그래서 재시작·reload를 하지 않는다.

   4. 실행 중인 서버가 실제로 이 파일을 쓰는지(`hba_file`, `data_directory`) 확인한 뒤, psql `\password` 로 새 비밀번호를 두 번 입력받는다.
   5. 원본 바이트로 되돌리고 ① 해시가 원본과 같은지 ② 비밀번호 없는 접속이 127.0.0.1·::1 모두 거부되는지 확인한다. 확인되면 미완료 기록을 지운다(백업은 남긴다).
   6. (선택) 새 비밀번호로 접속해 `pg_hba_file_rules` 에 오류·trust 규칙이 없는지 보여 준다.

4. 결과 읽는 법
   - `완료되었습니다` → 끝. 이어서 A 절차.
   - 노란 글씨 `비밀번호는 바뀌지 않았고, 인증 설정은 원래대로 확인됐습니다` → 안전한 상태. 다시 실행 가능.
   - 빨간 **[보안 경고]** 상자 → 아래 C 절차를 즉시 진행.

### 임시 인증 설정의 보안 위험

- 임시 규칙이 있는 동안에는 이 PC에서 실행되는 어떤 프로그램이든 `postgres` 관리자로 비밀번호 없이 접속할 수 있다. 외부 PC는 해당 규칙이 없으므로 접속할 수 없다.
- **자동 복원은 스크립트 안의 오류와 Ctrl+C 에서만 동작한다.** PowerShell 창을 닫거나, 작업 관리자로 종료하거나, 전원이 꺼지거나, PC가 멈추면 복원되지 않는다. 서비스가 자동 시작이라 재부팅 후에도 임시 규칙이 유지된다.
- 그래서 작업 후 반드시 결과를 확인하고, 의심되면 C-1의 `-CheckOnly` 로 점검한다.

## C. 비정상 종료 후 복구

### C-1. 복구 스크립트 (권장)

```powershell
# 1) 점검만 (일반 PowerShell, 아무것도 바꾸지 않음)
powershell -ExecutionPolicy Bypass -File apps\api\scripts\restore-pg-hba.ps1 -CheckOnly

# 2) 복구 (관리자 PowerShell)
powershell -ExecutionPolicy Bypass -File apps\api\scripts\restore-pg-hba.ps1
```

- 임시 규칙 블록만 정확히 지운다. 블록 밖의 내용은 바이트 단위로 그대로 둔다.
- 블록이 손상돼 정확히 지울 수 없으면, 해시가 검증된 백업으로 되돌릴지 묻는다.
- 마지막에 비밀번호 없는 관리자 접속이 거부되는지 확인한다. 확인되지 않으면 [보안 경고]와 함께 종료 코드 2로 끝난다.

### C-2. 수동 복구 (스크립트를 쓸 수 없을 때)

1. 시작 메뉴에서 **메모장**을 마우스 오른쪽 버튼 → **관리자 권한으로 실행**.
2. 파일 → 열기 → `C:\Program Files\PostgreSQL\18\data\pg_hba.conf` (파일 형식: 모든 파일).
3. `# >>> WORKBRIDGE-TEMP-TRUST BEGIN` 줄부터 `# <<< WORKBRIDGE-TEMP-TRUST END` 줄까지 4줄을 지우고 저장한다. 다른 줄은 건드리지 않는다.
   - 파일이 깨져 보이면, 같은 폴더의 가장 최근 `pg_hba.conf.workbridge-backup-날짜` 파일 내용으로 전체를 바꾼다.
4. 저장하면 새 연결부터 바로 적용된다. 확실히 하고 싶다면 관리자 PowerShell에서 `Restart-Service postgresql-x64-18` (다른 프로젝트 연결이 잠시 끊김).

### C-3. 복원 확인 (모든 경우 공통)

```powershell
$d = 'C:\Program Files\PostgreSQL\18\data'
# 1) 임시 규칙 표시가 없어야 한다 (아무것도 출력되지 않으면 정상)
Select-String -Path "$d\pg_hba.conf" -Pattern 'WORKBRIDGE-TEMP-TRUST'
# 2) 원본 백업과 해시 비교 (같으면 True)
$b = Get-ChildItem $d -Filter 'pg_hba.conf.workbridge-backup-*' | Where-Object Name -notlike '*.sha256' | Sort-Object Name | Select-Object -Last 1
(Get-FileHash "$d\pg_hba.conf").Hash -eq (Get-FileHash $b.FullName).Hash
# 3) 비밀번호 없이 접속하면 실패해야 한다
& 'C:\Program Files\PostgreSQL\18\bin\psql.exe' -h 127.0.0.1 -U postgres -d postgres -w -c 'select 1'
```

3번에서 `no password supplied` 류의 오류가 나면 정상이다. `1` 이 출력되면 아직 비밀번호 없이 접속되는 상태이므로 C-1 또는 C-2를 다시 진행한다.
비밀번호로 접속할 수 있다면 `SELECT line_number, address, auth_method, error FROM pg_hba_file_rules;` 로 `error` 가 비어 있는지도 확인한다.

## 남는 위험과 한계

- 자동 복원은 전원 차단·창 닫기·강제 종료를 보장하지 않는다(위 C 절차 필요).
- PostgreSQL 기본값에 따라 모든 계정은 PUBLIC 접속 권한이 회수되지 않은 다른 DB(예: `postgres`)에 **접속은** 할 수 있다. 테이블 권한은 없다. 완전히 막으려면 `pg_hba.conf` 에서 계정별 DB를 제한해야 하며, 이 스크립트들은 그 변경을 하지 않는다.
- 스크립트 동작은 정적 검사·순수 함수 단위 테스트(`npm run test:scripts -w apps/api`)로 확인했다. 실제 PostgreSQL 대상 실행은 사용자가 직접 실행할 때 처음 이뤄진다.
