# WorkBridge

의뢰인과 프리랜서를 연결하는 프로젝트 중개 플랫폼 (코드잇 풀스택 JavaScript 과제).

> 현재 단계: **Google 로그인·역할 선택(STEP 04-B)**. 이메일 회원가입·로그인(STEP 04-A)도 그대로 동작한다. 화면은 홈·로그인·회원가입·Google 완료·계정 연결·역할 선택·내 프로필·404. 로컬 PostgreSQL에 사용자·프로필·기술 스택·프로젝트·OAuth 상태 테이블이 있다.
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

## 인증 (이메일·Google)

| API                                   | 설명                                                                     |
| ------------------------------------- | ------------------------------------------------------------------------ |
| `POST /api/auth/signup`               | 회원가입(이름·이메일·비밀번호·역할 `CLIENT`/`FREELANCER`) 후 바로 로그인 |
| `POST /api/auth/login`                | 이메일 로그인                                                            |
| `POST /api/auth/refresh`              | Refresh Token 쿠키로 Access Token 재발급(새로고침 시 세션 복원)          |
| `POST /api/auth/logout`               | 현재 기기의 Refresh Token 무효화                                         |
| `GET /api/auth/me`                    | 내 정보(`Authorization: Bearer <accessToken>`)                           |
| `GET /api/auth/oauth/google/status`   | Google 로그인 사용 가능 여부만 반환(비밀 없음)                           |
| `GET /api/auth/oauth/google`          | Google 로그인 시작(302)                                                  |
| `GET /api/auth/oauth/google/callback` | Google이 돌려보내는 인가 코드 처리                                       |
| `POST /api/auth/oauth/link`           | 기존 이메일 계정에 Google 연결(비밀번호 확인)                            |
| `PATCH /api/auth/role`                | 최초 Google 가입 후 역할 선택(`CLIENT` / `FREELANCER`)                   |

- Access Token(15분)은 응답 본문으로 받아 브라우저 메모리에만 둔다. Refresh Token(14일)은 `HttpOnly` 쿠키 `wb_rt`로만 오가며, DB에는 해시만 저장된다. Google 로그인 뒤에도 같은 토큰을 쓴다. Google 토큰을 Refresh Token 대신 쓰지 않는다.
- 화면: `/signup`, `/login`, `/oauth/complete`, `/oauth/link`, `/select-role`, `/me`.
- 처음 Google로 가입하면 역할을 고른 뒤 내 프로필로 간다. 상세 프로필은 이 단계에서 요구하지 않는다. 이미 역할이 있으면 바꾸지 못한다.
- 같은 이메일의 계정이 있어도 자동으로 연결하지 않는다. 기존 비밀번호로 확인한 뒤에만 연결한다.
- 환경 변수는 `.env.example`의 '인증', 'Google 로그인' 항목을 본다. `JWT_ACCESS_SECRET`을 비워 두면 개발 서버가 실행마다 임시 키를 만든다(경고 출력). **운영에서는 32자 이상의 키가 없으면 서버가 시작하지 않는다.**
- 상세 명세와 정책 근거: `planning/API_SPEC_v1.md` §3·§3.1·§3.2, `planning/DECISIONS.md` D-64~D-74.

### Google Cloud 설정

Google 로그인 버튼은 `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`가 모두 있을 때만 동작한다. 없으면 로그인 화면에 설정 안내가 나오고, 임의의 키를 만들어 두지 않는다. Client Secret은 `.env`에만 두고 Git에 커밋하지 않는다.

1. [Google Cloud Console](https://console.cloud.google.com/)에서 프로젝트를 만들거나 고른다.
2. **API 및 서비스 → OAuth 동의 화면**에서 사용자 유형을 외부(테스트)로 두고, 앱 이름과 지원 이메일을 입력한다. 로그인에 쓸 Google 계정을 **테스트 사용자**로 넣는다.
3. **API 및 서비스 → 사용자 인증 정보 → 사용자 인증 정보 만들기 → OAuth 클라이언트 ID**에서 애플리케이션 유형을 **웹 애플리케이션**으로 한다.
4. **승인된 JavaScript 원본**에 `http://localhost:5173` 을 넣는다.
5. **승인된 리디렉션 URI**에 아래 주소를 한 글자도 다르지 않게 넣는다.

   `http://localhost:5173/api/auth/oauth/google/callback`

   로컬 개발 서버(Vite)가 `/api`를 API로 프록시하므로, 브라우저는 `localhost:5173`에 머문 채 콜백 쿠키를 받는다. `localhost:4000`으로 두면 프론트와 쿠키 출처가 달라진다.

6. 발급된 클라이언트 ID와 클라이언트 보안 비밀번호를 프로젝트 루트 `.env`에 적는다.

   ```
   GOOGLE_CLIENT_ID=발급된 클라이언트 ID
   GOOGLE_CLIENT_SECRET=발급된 클라이언트 보안 비밀번호
   GOOGLE_REDIRECT_URI=http://localhost:5173/api/auth/oauth/google/callback
   ```

7. API 서버를 다시 시작한다. `GET /api/auth/oauth/google/status`가 `{ "data": { "enabled": true } }`이면 로그인·회원가입 화면에 **Google로 계속하기**가 나타난다.
