# WorkBridge 기술 스택 검토

> 근거: RFP 1부(풀스택 JavaScript, 발표 목차의 '고정 기술 스택 내 자율 결정 영역', 배포 URL 예시 Vercel), 2부 §5 외부 시스템 연동, §7 비기능 요구사항
> 원칙: 22일 안에 A(기본 필수)·B(심화 필수)를 끝낼 수 있는 단순한 구성을 고른다. RFP 1부는 "아키텍처 고도화, 성능 최적화, 인프라 설계에 시간을 과도하게 투자하지 말 것"을 명시한다.

## 1. RFP 제약 확인

| RFP 문장·제약 | 위치 | 검토 대상 스택과의 관계 |
|---|---|---|
| "풀스택 JavaScript로 직접 설계 및 구현" | 1부 01.1 | React/Vite + Express + Prisma 모두 JavaScript로 작성 가능. **TypeScript는 쓰지 않는다**(과제명과 어긋날 여지를 없앰) |
| "고정 기술 스택 내에서 자율 결정한 영역(상태 관리, 배포 방식, 외부 API 클라이언트 등)" | 1부 발표 목차 5 | 고정 스택이 있다는 뜻이지만 **목록은 RFP에 없다.** 운영진 공지로 확인해야 한다(D-02). 확인 전까지 이 문서의 선택은 잠정안 |
| 배포 URL "(Vercel 등)" | 1부 산출물 | 프론트엔드 Vercel과 일치. 예시이므로 다른 호스팅도 가능 |
| FE·BE 모두 GitHub 연동 자동 배포 | 2부 7.2 | Vercel·Render 모두 GitHub 연동 자동 배포 지원 |
| OAuth 1종 이상, LLM 구조화 JSON, PG sandbox, 클라우드 스토리지 1종 | 2부 §5 | §4 연동 계획 |
| 비밀 값은 환경 변수, `.env.example` 제공 | 2부 7.1 | §5 환경 변수 목록 |
| 발표 예시 "OpenAI 응답 파싱", "PG 콜백 검증", "OAuth 흐름" | 1부 발표 목차 7 | OpenAI 사용을 강제하지는 않지만 예시와 맞춘다 |

**결론:** React/Vite, Express, PostgreSQL/Prisma 조합은 RFP와 충돌하지 않는다. 단, '고정 기술 스택' 목록이 공지되면 그 목록을 우선한다.

### 1.1 검토 대상 스택 채택 판단

기존 구조 확인 결과: 현재 작업 폴더(`C:\Users\jun\Desktop\workbridge`)에는 빈 Git 저장소(`.git`, 커밋 없음)만 있고 소스 코드가 없다. 따라서 기존 코드에 맞춰야 할 제약은 없다. 이전 세션에서 같은 스택(npm workspaces + React/Vite + Express + Prisma)으로 인증·프로필·프로젝트 API 일부를 만들어 테스트를 통과한 적이 있어, 이 조합이 이 과제에 동작한다는 점은 확인되어 있다.

| 검토 대상 | 판단 | 근거 (RFP·코드잇 과정 기준) |
|---|---|---|
| JavaScript | 채택 (TypeScript 미사용) | 과제명이 "풀스택 JavaScript로 직접 설계 및 구현"이다. 비개발자·학습자 기준으로 타입 설정 부담을 줄인다 |
| React + Vite | 채택 | 코드잇 프론트엔드 커리큘럼과 일치. Vite는 설정이 거의 없고, 배포 예시인 Vercel에서 바로 빌드된다 |
| Node.js + Express | 채택 | 미들웨어 구조가 단순해 인증·역할·프로필 완성 검사(A-08, A-13)를 한 줄씩 붙일 수 있다. 자료가 가장 많다 |
| PostgreSQL | 채택 | 수락 시 자동 거절·결제 승인처럼 여러 행을 한 번에 바꾸는 규칙에 트랜잭션과 행 잠금이 필요하다. 무료 호스팅(Supabase, Neon, Render)이 많다 |
| Prisma | 채택 | `schema.prisma`가 곧 ERD 초안이 되어 제출물(ERD)과 코드를 맞추기 쉽다. 마이그레이션·시드·트랜잭션을 지원한다 |
| REST API | 채택 | RFP 기능이 "리소스 + 상태 변경 액션"(지원, 수락, 서명, 결제 승인) 구조라 REST 경로로 자연스럽게 표현된다. 제출물 API 명세(Swagger/Postman)와 잘 맞는다. GraphQL은 22일 안에 학습·도입 부담이 크다 |
| JWT + OAuth 2.0 | 채택 | RFP 3.1.1이 Access/Refresh Token 이중 구조를, 3.1.2가 OAuth 2.0 소셜 로그인 1종 이상을 직접 요구한다. 세션 방식은 RFP 요구와 맞지 않는다. 토큰 보관 방식은 D-25 |

> 위 판단은 잠정안이다. D-02(고정 기술 스택 목록)가 공지되면 다시 확인한다.

---

## 2. 추천 스택

### 2.1 프론트엔드 (`apps/web`)

| 영역 | 추천 | 선정 근거 | 대안 |
|---|---|---|---|
| 빌드·개발 서버 | Vite | 설정이 거의 없고 빠름. 검토 대상 스택 | - |
| UI | React | 검토 대상 스택. 코드잇 커리큘럼과 일치 | - |
| 라우팅 | React Router | SPA 라우팅 표준. 보호 라우트·`returnTo` 처리에 충분 | - |
| 서버 상태 | TanStack Query | API 캐시, 목록 필터 쿼리 키, 알림 미확인 수 폴링(`refetchInterval`)을 직접 구현하지 않아도 됨 | useEffect + fetch(중복 코드 증가) |
| HTTP | Axios | 인터셉터로 "401 → Refresh → 원 요청 재시도"(A-03)를 한 곳에서 처리 | fetch 래퍼 직접 작성 |
| 클라이언트 상태 | Zustand (로그인 사용자·Access Token만) | 크기가 작고, Axios 인터셉터처럼 React 밖에서도 `getState()`로 토큰을 읽을 수 있음 | React Context(인터셉터 연결이 번거로움) |
| 스타일 | 팀 결정 (D-45) | CSS Modules는 추가 의존성 없음, Tailwind는 빠른 화면 제작 | - |
| 폼 | 기본은 직접 상태 관리, 필요 시 React Hook Form | 3단계 퍼널 정도는 직접 관리로 충분 | React Hook Form + zod |

### 2.2 백엔드 (`apps/api`)

| 영역 | 추천 | 선정 근거 | 대안 |
|---|---|---|---|
| 런타임 | Node.js LTS | 설정 시점의 Active LTS로 고정(`engines`, `.nvmrc`) | - |
| 웹 프레임워크 | Express | 검토 대상 스택. 미들웨어 구조가 단순하고 자료가 많음 | - |
| ORM | Prisma | 스키마 파일이 곧 ERD 초안이 되고, 마이그레이션·시드·트랜잭션(`$transaction`) 지원 | - |
| DB | PostgreSQL | 트랜잭션·행 잠금(`FOR UPDATE`)·부분 유니크 인덱스·배열 컬럼 지원. 자동 거절·결제 무결성에 필요 | - |
| 입력 검증 | zod | 요청 검증과 LLM 응답 JSON 검증(B-01)에 같은 도구 사용 | express-validator |
| 인증 | jsonwebtoken, bcrypt(또는 bcryptjs), cookie-parser | JWT 발급, 비밀번호 해싱(N-01), Refresh 쿠키 | - |
| 보안 기본 | helmet, cors, express-rate-limit | 보안 헤더, FE 출처 허용, 로그인·AI 호출 제한 | - |
| 스케줄러 | node-cron + 요청 시 상태 동기화 | 모집 시작·마감 자동 전환(A-24). 무료 서버가 잠들어 cron을 놓쳐도 조회 시점에 보정(D-08) | 외부 스케줄러(GitHub Actions cron)로 내부 엔드포인트 호출 |
| 파일 업로드 | multer(메모리, 용량 제한) | 이미지를 서버가 받아 검증한 뒤 스토리지로 전송 | presigned URL 직접 업로드 |
| 외부 API 호출 | Node 내장 fetch, OpenAI SDK | PG·OAuth는 REST 호출로 충분 | - |

**계층 구성:** `router`(경로·인증·검증) → `service`(비즈니스 규칙·트랜잭션·알림 생성) → Prisma. 별도 repository 계층은 두지 않는다. 자동 거절, 일괄 마감, 결제 승인처럼 부수 효과가 있는 로직은 service 한 함수 안에서 한 트랜잭션으로 처리한다.

### 2.3 품질·협업 도구

| 영역 | 추천 | 비고 |
|---|---|---|
| 모노레포 | npm workspaces | 추가 도구(Turborepo, Nx) 없이 `apps/web`, `apps/api` 관리 |
| 테스트 | Vitest + Supertest(API) | 핵심 규칙(상태 전환, 자동 거절, 결제 검증, 정산, 리뷰 1회) 위주. FE는 순수 함수 위주로 최소 |
| 린트·포맷 | ESLint + Prettier | 커밋 전 통일 |
| CI | GitHub Actions | PR마다 lint + test |
| 협업 | GitHub Projects(칸반), PR 리뷰 | N-11, N-12 |
| API 명세 | Swagger(OpenAPI) 또는 Postman | 제출물 O-05. 팀 선택 |
| ERD 제출 | dbdiagram.io | 제출물 O-04 |

---

## 3. 모노레포 구성 (초안)

```text
workbridge/
├─ apps/
│  ├─ web/                    # React + Vite
│  │  ├─ src/
│  │  │  ├─ app/              # 라우터, 레이아웃(로그인 상태별 헤더)
│  │  │  ├─ pages/            # 화면 단위
│  │  │  ├─ features/         # auth, projects, applications, contracts, payments ...
│  │  │  ├─ lib/              # API 클라이언트(Axios 인터셉터), 공통 유틸
│  │  │  └─ stores/           # Zustand (세션)
│  │  └─ .env.example
│  └─ api/                    # Express + Prisma
│     ├─ prisma/
│     │  ├─ schema.prisma
│     │  ├─ migrations/
│     │  └─ seed.js           # 기술 스택 옵션 + 시연 데이터
│     ├─ src/
│     │  ├─ routes/ 또는 modules/<도메인>/   # router + service
│     │  ├─ middlewares/      # 인증, 역할, 프로필 완성, 에러 처리
│     │  ├─ integrations/     # oauth, llm, pg, storage 어댑터
│     │  └─ jobs/             # 상태 동기화 cron
│     └─ .env.example
├─ docs/
├─ .github/workflows/ci.yml
└─ package.json               # workspaces
```

- 공용 패키지(`packages/shared`)는 처음에는 만들지 않는다. 상태 라벨처럼 FE·BE가 함께 쓰는 상수가 늘어나면 그때 추가한다.

---

## 4. 외부 연동 계획

모든 외부 연동은 **어댑터**(`integrations/`) 뒤에 두고, 개발·테스트용 **mock 구현**을 함께 만든다. 실제 키가 없어도 로컬과 CI에서 전체 흐름을 돌릴 수 있게 하기 위해서다. 이번 단계에서는 어떤 서비스 키도 발급·연결하지 않는다.

### 4.1 OAuth 2.0 (A-05~A-07)

| 항목 | Google (추천) | Kakao |
|---|---|---|
| 이메일 확보 | 기본 scope(`openid email profile`)로 이메일과 `email_verified` 제공 | 이메일 동의 항목 사용 조건을 콘솔에서 확인해야 함. 이메일을 못 받으면 A-06(같은 이메일 연동)을 충족할 수 없음 |
| 로컬 개발 | `http://localhost` 리다이렉트 URI 등록 가능 | 가능 |
| 국내 사용자 친숙도 | 보통 | 높음 |

- **추천: Google 1종(D-23).** RFP 필수인 "동일 이메일 연동"을 가장 확실하게 충족한다. 제공자 정책은 설정 시점에 콘솔에서 다시 확인한다.
- 흐름(Authorization Code):
  1. FE의 소셜 버튼 → `GET /api/auth/oauth/google` → 서버가 `state`를 쿠키에 저장하고 제공자 인증 페이지로 302
  2. 제공자 → `GET /api/auth/oauth/google/callback?code&state` → 서버가 `state`를 확인하고 code를 토큰으로 교환해 사용자 정보 조회
  3. `oauthId`로 찾고, 없으면 검증된 이메일로 기존 계정을 찾아 연동(D-24), 그래도 없으면 `role=null`로 생성
  4. Refresh 쿠키를 설정하고 FE `/auth/callback`으로 302 → FE가 refresh로 Access Token을 받음 → `role`이 없으면 역할 선택 화면
- 환경 변수: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`

### 4.2 AI 단가 분석 (B-01~B-03)

- **추천: OpenAI API(D-27).** 발표 예시와 맞고, JSON 스키마를 지정한 구조화 응답을 지원한다. 모델은 구현 시점에 비용이 낮은 모델로 정한다.
- 처리 순서:
  1. 입력: 제목, 설명, 카테고리, 기술 스택(등록 퍼널에서 입력한 값)
  2. 출력 스키마: `items[{ name, description, estimatedAmount, rationale }]`, `totalAmount`, `assumptions` (API_SPEC AI-01. 내부 초안명의 `estimatedPrice`/`totalPrice`와 동일 의미)
  3. 서버가 응답을 스키마로 검증한다(STEP 08-A: 수동 검증. zod는 쓰지 않음). 형식이 틀리면 1회 재시도 후 실패 응답을 준다.
  4. **총액은 서버가 항목 단가의 합으로 다시 계산한다.** LLM이 낸 합계를 그대로 믿지 않는다.
  5. '예산 반영'은 FE가 총액을 예산 입력값에 넣는 동작이다. 저장은 기존 등록·수정 API로 한다(B-03).
- mock 모드: `AI_ESTIMATE_MODE=mock`이면 입력에 따라 항상 같은 결과를 돌려준다(개발·테스트·키 없는 시연 대비). STEP 08-A 기본값.
- OpenAI 모드: `AI_ESTIMATE_MODE=openai` provider 골격만 두고, STEP 08-A에서는 외부 호출 없이 503을 낸다(STEP 08-B에서 연결).
- 비용 보호: 사용자별 호출 제한(express-rate-limit), 요청 타임아웃(실제 OpenAI 연결 시).
- 환경 변수: `AI_ESTIMATE_MODE`, `AI_ESTIMATE_RATE_LIMIT_MAX`, `AI_ESTIMATE_RATE_LIMIT_WINDOW_MINUTES`, `OPENAI_API_KEY`, `OPENAI_MODEL`

### 4.3 PG sandbox 결제 (B-09~B-11)

- **추천: 토스페이먼츠 테스트 환경(D-16).** 사업자 등록 없이 테스트 키를 발급받을 수 있고, 한국어 문서와 "결제창 → 리다이렉트 → 서버 승인" 흐름이 RFP의 "결제 요청 → PG 결제창 → 콜백 검증"과 그대로 맞는다. 대안은 포트원.
- 흐름:
  1. 의뢰인이 계약서 상세에서 '결제하기' → `POST /api/contracts/:id/payments` → 서버가 `orderId`와 금액(계약 합의 금액)으로 `READY` 결제를 만들고 반환
  2. FE가 토스 SDK로 결제창을 연다(테스트 클라이언트 키, `successUrl`·`failUrl` 지정)
  3. 성공 리다이렉트로 받은 `paymentKey`, `orderId`, `amount`를 FE가 `POST /api/payments/confirm`으로 전달
  4. 서버가 DB 금액과 대조 → 토스 승인 API 호출(시크릿 키) → 응답 금액·상태 재확인 → 한 트랜잭션에서 결제 `PAID`·에스크로 `HELD`·계약과 프로젝트 `IN_PROGRESS`
  5. 실패 리다이렉트는 사유를 기록하고 재시도 버튼을 보여 준다.
- **실결제 방지 장치:** 서버 시작 시 시크릿 키가 테스트 키 접두어가 아니면 기동을 거부한다(N-04). 키는 환경 변수로만 둔다.
- mock 어댑터: 테스트에서는 승인 API 호출을 가짜로 바꿔 금액 위변조, 중복 승인 같은 규칙을 검증한다.
- 환경 변수: `TOSS_CLIENT_KEY`(FE: `VITE_TOSS_CLIENT_KEY`), `TOSS_SECRET_KEY`

### 4.4 이미지 저장소 (A-09)

- **추천: Supabase Storage(D-29).** DB도 Supabase Postgres를 쓰면 계정과 대시보드가 하나로 줄어든다. 대안은 Cloudinary(이미지 변환 기능이 강함), AWS S3.
- 흐름: FE가 이미지를 `POST /api/uploads/images`(multipart)로 보냄 → 서버가 형식·용량을 검사(제한값은 D-29) → 서비스 키로 스토리지에 업로드 → 공개 URL을 돌려줌 → FE가 `PATCH /users/me`로 `profileImageUrl` 저장.
- 서비스 키는 서버에만 둔다. 브라우저에 노출하지 않는다.
- 환경 변수: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `STORAGE_BUCKET`

### 4.5 배포 (N-06, N-07)

| 대상 | 추천 | 근거 | 주의 |
|---|---|---|---|
| 프론트엔드 | Vercel | RFP 예시, GitHub 자동 배포, 미리보기 배포 | SPA 라우팅 rewrite 설정 |
| 백엔드 | Render (Web Service) | GitHub 자동 배포, Express 그대로 실행 | 무료 플랜은 유휴 시 잠들어 첫 요청이 느림. cron 누락 가능 → 요청 시 상태 동기화로 보완(D-08) |
| DB | Supabase Postgres | 스토리지와 같은 곳에서 관리 | 무료 프로젝트 일시 중지 정책 확인. 대안 Neon |

- **쿠키 문제 회피:** Vercel에서 `/api/*`를 Render로 rewrite하면 브라우저 입장에서 FE와 API가 같은 출처가 된다. Refresh 쿠키를 `SameSite=Lax` 1st-party 쿠키로 쓸 수 있어 서드파티 쿠키 차단 문제를 피한다(D-43).
- 배포 골격(헬스 체크 엔드포인트 + 자동 배포)은 페이즈 1에 먼저 만든다. 마지막에 배포하면 쿠키·OAuth 리다이렉트·환경 변수 문제가 한꺼번에 터지기 때문이다.

---

## 5. 환경 변수 목록 (`.env.example` 초안, 값 없음)

| 위치 | 변수 | 용도 |
|---|---|---|
| api | `NODE_ENV`, `PORT` | 실행 환경 |
| api | `DATABASE_URL` | PostgreSQL 접속 |
| api | `APP_ORIGIN` | CORS 허용 출처, OAuth 완료 후 이동할 FE 주소 |
| api | `JWT_ACCESS_SECRET`, `JWT_ACCESS_EXPIRES_IN`, `REFRESH_TOKEN_EXPIRES_DAYS` | 토큰 |
| api | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` | OAuth |
| api | `AI_ESTIMATE_MODE`, `AI_ESTIMATE_RATE_LIMIT_MAX`, `AI_ESTIMATE_RATE_LIMIT_WINDOW_MINUTES`, `OPENAI_API_KEY`, `OPENAI_MODEL` | AI 단가 분석 (D-115) |
| api | `TOSS_SECRET_KEY` | PG 승인(테스트 키만) |
| api | `PLATFORM_FEE_RATE` | 수수료율(기본 10%) |
| api | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `STORAGE_BUCKET` | 이미지 저장소 |
| api | `CRON_SECRET` | 외부 스케줄러가 내부 동기화 엔드포인트를 호출할 때(선택) |
| web | `VITE_API_BASE_URL` | API 주소(기본 `/api`) |
| web | `VITE_TOSS_CLIENT_KEY` | 결제창(테스트 클라이언트 키) |

- 실제 값은 각자 로컬 `.env`와 배포 플랫폼의 환경 변수 설정에만 넣는다. `.env`는 `.gitignore`에 포함한다.

---

## 6. 버전 결정 방법

- 패키지 버전은 이번 문서에서 고정하지 않는다. 개발 환경 설정 단계에서 `npm view <패키지> version`으로 최신 안정 버전을 확인해 고정하고, 메이저 버전 차이로 생기는 API 변경(예: Express 5, Prisma 최신 버전의 설정 방식)은 그때 공식 문서로 확인한다.
- Node.js 버전은 Vercel·Render가 지원하는 LTS 중에서 고른다.

---

## 7. STEP 03-B 구현 결과: 데이터베이스 (2026-10-12)

| 항목 | 실제 구성 | 비고 |
|---|---|---|
| DB 서버 | 로컬 PostgreSQL 18.6 (Windows 서비스 `postgresql-x64-18`) | Docker·Supabase는 쓰지 않는다. 배포용 DB(§4.5)는 배포 단계에서 정한다 |
| DB 분리 | `workbridge_dev`(개발), `workbridge_test`(자동 테스트), `workbridge_shadow`(Prisma 마이그레이션 생성용) | 세 DB 모두 앱 전용 계정 `workbridge_app` 소유. 시간대 UTC, `PUBLIC` 권한 회수 |
| 앱 계정 | `workbridge_app` | superuser·createdb·createrole 권한 없음. 생성 스크립트: `apps/api/scripts/setup-local-db.ps1` |
| ORM | Prisma 7.10.0 (`prisma`, `@prisma/client`) | 버전 고정(`^` 없음) |
| 드라이버 | `@prisma/adapter-pg` 7.10.0 + `pg` 8.x | Prisma 7은 드라이버 어댑터로 연결한다 |
| 클라이언트 생성 | `prisma-client` 생성기 → `apps/api/src/generated/prisma` (ESM, Git 제외) | Node 26이 생성된 `.ts` 파일을 타입 제거 방식으로 바로 불러온다. 프로젝트 코드는 JavaScript 그대로다 |
| 연결 설정 | `apps/api/prisma.config.js` | 루트 `.env`를 읽고 `src/config/database.js`로 검증한 URL만 Prisma CLI에 넘긴다 |
| 테스트 | Vitest 2종 설정: `vitest.config.js`(단위, DB 없음), `vitest.db.config.js`(실제 PostgreSQL, `workbridge_test`만) | 테스트 실행 중에는 개발 DB 연결을 코드에서 거부한다 |

### 7.1 §5 환경 변수 목록과 다른 점

| §5 초안 | 실제 | 이유 |
|---|---|---|
| `DATABASE_URL` 1개 | `DATABASE_URL`, `TEST_DATABASE_URL`, `SHADOW_DATABASE_URL`, `ALLOW_REMOTE_DATABASE` | 테스트가 개발 데이터를 지우거나 만들지 못하게 DB를 분리했다. 원격 DB는 `ALLOW_REMOTE_DATABASE=true`일 때만 연결해 운영 DB 오접속을 막는다 |

### 7.2 알려진 사항

- `npm audit`이 high 4건을 보고한다. 모두 개발용 `prisma` CLI의 하위 의존성(`@prisma/config` 경유)이다. 제안된 자동 수정은 Prisma 6으로 내리는 것이라 적용하지 않았다. 런타임 의존성(`@prisma/client`, `@prisma/adapter-pg`, `pg`)과는 무관하다.
- npm이 `prisma`, `@prisma/engines`의 설치 스크립트에 대해 경고를 표시할 수 있다. 동작에는 영향이 없다.
