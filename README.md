# WorkBridge

의뢰인과 프리랜서를 연결하는 프로젝트 중개 플랫폼 (코드잇 풀스택 JavaScript 과제).

> 현재 단계: **이메일 회원가입·로그인(STEP 04-A)**. 화면은 홈·로그인·회원가입·내 프로필(로그인 필요)·404, API는 `GET /api/health`와 인증 5개(`/api/auth/*`)가 있다. 로컬 PostgreSQL에 사용자·프로필·기술 스택·프로젝트 테이블 9개가 있다.
> 기획·설계 문서는 [`planning/`](./planning)에 있다.

## 기술 스택

| 영역         | 사용 기술                                                 |
| ------------ | --------------------------------------------------------- |
| 프론트엔드   | React, Vite, React Router, Axios, TanStack Query, Zustand |
| 백엔드       | Node.js, Express, JavaScript, REST API                    |
| 데이터베이스 | PostgreSQL 18 (로컬), Prisma 7                            |
| 개발 도구    | npm workspaces, ESLint, Prettier, Vitest                  |

> RFP가 언급한 "고정 기술 스택" 목록은 아직 운영진 확인 전이다(`planning/DECISIONS.md` D-02). 위 구성은 잠정안이다.

## 폴더 구조

```text
workbridge/
├─ apps/
│  ├─ api/            # Express API 서버 (src/app.js, src/server.js, test/)
│  │  ├─ prisma/      # DB 스키마(schema.prisma)와 마이그레이션 SQL
│  │  └─ scripts/     # 로컬 DB 준비·점검 스크립트
│  └─ web/            # React + Vite 앱 (src/app, pages, components, lib, stores)
├─ planning/          # 요구사항·ERD·API 명세·결정 기록
├─ .env.example       # 환경 변수 예시 (값은 예시만)
├─ eslint.config.js
└─ package.json       # npm workspaces 루트
```

## 시작하기

필요 환경: Node.js 22.22.2 이상(권장 26), npm 10 이상, PostgreSQL 18(로컬 설치)

```bash
npm install
npm run db:generate -w apps/api   # Prisma Client 코드 생성 (처음 한 번, 스키마가 바뀔 때마다)
npm run dev
```

`.env`가 없으면 아래 [데이터베이스](#데이터베이스-로컬-postgresql) 절차를 먼저 진행한다. DB 없이 화면만 볼 때는 `Copy-Item .env.example .env`로 복사해도 되지만, 이 경우 DB 기능은 동작하지 않는다.

- 프론트엔드: <http://localhost:5173>
- 백엔드 상태 확인: <http://localhost:4000/api/health>
- 개발 중 프론트엔드의 `/api/*` 요청은 Vite가 백엔드로 프록시한다.

## 명령어

| 명령                                      | 설명                                       |
| ----------------------------------------- | ------------------------------------------ |
| `npm run dev`                             | 프론트엔드·백엔드 개발 서버 동시 실행      |
| `npm run dev:api` / `npm run dev:web`     | 한쪽만 실행                                |
| `npm run lint`                            | ESLint 검사 (경고도 실패로 처리)           |
| `npm run format` / `npm run format:check` | Prettier 포맷 적용 / 검사                  |
| `npm run test`                            | 모든 워크스페이스의 Vitest 실행 (DB 없음)  |
| `npm run test:db`                         | 실제 PostgreSQL 통합 테스트 (테스트 DB)    |
| `npm run build`                           | 프론트엔드 프로덕션 빌드 (`apps/web/dist`) |

## 환경 변수

루트의 `.env` 하나를 백엔드와 프론트엔드가 함께 읽는다. 프론트엔드에는 `VITE_`로 시작하는 변수만 노출되므로 비밀 값에는 `VITE_`를 붙이지 않는다. `.env`는 커밋하지 않는다.

## 데이터베이스 (로컬 PostgreSQL)

WorkBridge는 내 PC에 설치된 PostgreSQL 18을 쓴다. 용도별로 DB 3개를 나눠 쓰고, 모두 WorkBridge 전용 계정 `workbridge_app`이 소유한다. 이 계정에는 관리자 권한이 없다.

| DB                  | 용도                                                | `.env` 변수           |
| ------------------- | --------------------------------------------------- | --------------------- |
| `workbridge_dev`    | 개발 서버(`npm run dev`)가 쓰는 DB                  | `DATABASE_URL`        |
| `workbridge_test`   | 자동 테스트(`npm run test:db`) 전용                 | `TEST_DATABASE_URL`   |
| `workbridge_shadow` | Prisma가 마이그레이션 파일을 만들 때만 잠시 쓰는 DB | `SHADOW_DATABASE_URL` |

### 1. DB 준비 (처음 한 번)

1. PostgreSQL 관리자(`postgres`) 비밀번호를 알고 있어야 한다. 잊었다면 [`apps/api/scripts/POSTGRES_RECOVERY.md`](./apps/api/scripts/POSTGRES_RECOVERY.md)를 본다.
2. PowerShell에서 아래 스크립트를 실행한다. 비밀번호는 화면에 보이지 않는 입력 창에서 직접 입력한다. 계정·DB 3개를 만들고 루트 `.env`에 접속 정보를 저장한다. 이미 있는 DB는 지우지 않는다.

   ```powershell
   powershell -ExecutionPolicy Bypass -File apps/api/scripts/setup-local-db.ps1
   ```

3. 연결을 확인한다. 세 DB 모두 `✔`, `superuser=false`, `TimeZone=UTC`가 나와야 한다.

   ```bash
   npm run db:check -w apps/api
   ```

### 2. 마이그레이션 (테이블 만들기)

마이그레이션 파일은 `apps/api/prisma/migrations/`에 있다. 새로 받은 마이그레이션을 내 DB에 적용할 때는 아래 두 명령을 실행한다. 기존 데이터를 지우지 않고, 아직 적용하지 않은 파일만 순서대로 적용한다.

```bash
npm run db:migrate:deploy -w apps/api   # 개발 DB
npm run db:migrate:test -w apps/api     # 테스트 DB
npm run db:migrate:status -w apps/api   # 개발 DB 적용 상태 확인
```

스키마(`schema.prisma`)를 바꿔 새 마이그레이션을 만들 때는 다음 순서를 따른다.

1. `npm run db:validate -w apps/api`: 스키마 문법 검사
2. `npm run db:migrate:create -w apps/api -- --name <변경_이름>`: SQL 파일만 만들고 적용하지 않음
3. 생성된 `migration.sql`을 열어 `DROP`·`TRUNCATE`·컬럼 삭제가 없는지 확인
4. 위의 `db:migrate:deploy`, `db:migrate:test`로 적용
5. `npm run db:generate -w apps/api`: Prisma Client 다시 생성

> `prisma migrate reset`, `prisma db push`는 DB를 초기화하거나 기록 없이 바꿀 수 있어 쓰지 않는다. 테스트 DB 대상으로는 설정 파일이 이 명령들을 막는다.

### 3. 테스트

| 명령                               | 무엇을 검사하나                                                                           | DB 필요 |
| ---------------------------------- | ----------------------------------------------------------------------------------------- | ------- |
| `npm run test`                     | API·화면 단위 테스트                                                                      | 아니요  |
| `npm run test:db`                  | 실제 PostgreSQL에서 테이블·제약·관계·금액(bigint)·날짜 처리, 인증 API (`workbridge_test`) | 예      |
| `npm run test:scripts -w apps/api` | DB 준비 PowerShell 스크립트 정적 검사                                                     | 아니요  |

- DB 테스트는 `workbridge_test`에만 연결한다. 테스트 실행 중에는 개발 DB 연결을 코드가 거부한다.
- DB 테스트는 실행할 때마다 표시를 붙인 테스트용 행만 만들고, 끝나면 그 행만 지운다.

## 인증 (이메일 회원가입·로그인)

| API                      | 설명                                                                     |
| ------------------------ | ------------------------------------------------------------------------ |
| `POST /api/auth/signup`  | 회원가입(이름·이메일·비밀번호·역할 `CLIENT`/`FREELANCER`) 후 바로 로그인 |
| `POST /api/auth/login`   | 로그인                                                                   |
| `POST /api/auth/refresh` | Refresh Token 쿠키로 Access Token 재발급(새로고침 시 세션 복원)          |
| `POST /api/auth/logout`  | 현재 기기의 Refresh Token 무효화                                         |
| `GET /api/auth/me`       | 내 정보(`Authorization: Bearer <accessToken>`)                           |

- Access Token(15분)은 응답 본문으로 받아 브라우저 메모리에만 둔다. Refresh Token(14일)은 `HttpOnly` 쿠키 `wb_rt`로만 오가며, DB에는 해시만 저장된다.
- 화면: `/signup`, `/login`, `/me`(로그인 필요. 로그인하지 않았으면 `/login?returnTo=/me`로 이동하고, 로그인 후 원래 화면으로 돌아온다).
- 환경 변수는 `.env.example`의 '인증' 항목을 본다. `JWT_ACCESS_SECRET`을 비워 두면 개발 서버가 실행마다 임시 키를 만든다(경고 출력). **운영에서는 32자 이상의 키가 없으면 서버가 시작하지 않는다.**
- 상세 명세와 정책 근거: `planning/API_SPEC_v1.md` §3·§3.1, `planning/DECISIONS.md` D-64~D-69.
