# WorkBridge REST API 명세 v1

> 상태: STEP 04-A에서 **AUTH-01~05 검증**, STEP 04-B에서 **AUTH-06~09 검증**(Google API는 Mock, 실제 PostgreSQL 테스트 통과). 실제 Google 계정으로 신규 가입·역할 선택·세션 유지·로그아웃·재로그인을 브라우저에서 확인했다(2026-10-13). 기존 이메일 계정 연결(AUTH-08)의 실제 브라우저 흐름은 미검증이다. 나머지 행은 표에 적힌 상태 그대로다.
> 근거: [REQUIREMENTS.md](./REQUIREMENTS.md), [ERD_v1.md](./ERD_v1.md), [DECISIONS.md](./DECISIONS.md)
> 제출용 API 명세(O-05)는 구현 단계에서 이 문서를 Swagger(OpenAPI) 또는 Postman으로 옮겨 만든다.

## 0. 초안 대비 변경 사항

| # | 이전 문서 | v1 | 근거 |
|---|---|---|---|
| 1 | REQUIREMENTS의 금액 동의·거부 경로 `POST /contracts/:id/agree`, `/decline` | `POST /applications/:id/offer/agree`, `/offer/decline` | 동의하기 전에는 계약서가 없다. 계약서는 동의 시점에 생성된다(B-06) |
| 2 | OAuth: 같은 이메일이면 콜백에서 바로 연동 | 콜백에서 **연동 확인 단계**를 거친다(`POST /auth/oauth/link`, 기존 비밀번호 확인) | STEP 02 결정: 이메일 검증 + 계정 소유 확인 필수(D-24) |
| 3 | 북마크 `PUT·DELETE` | 유지 | 같은 요청을 반복해도 결과가 같다 |
| 4 | 로그인 전 화면용 옵션 목록 없음 | `GET /meta/options` 추가 | 카테고리·사업 분야·리뷰 태그를 FE와 BE가 따로 관리하지 않게 한다(공용 패키지를 두지 않으므로) |
| 5 | 프로필 완성 여부 별도 조회 없음 | `GET /auth/me` 응답에 `profileCompletion` 포함 | 프로필 유도(A-13)를 화면이 미리 판단할 수 있게 한다 |
| 6 | (v1 최초) 금액을 JSON 숫자로 주고받음 | **금액은 응답에서 10진수 문자열**, 요청은 문자열 권장(안전 정수 숫자도 허용) (STEP 03-A 변경) | D-51: DB 금액이 `bigint`가 되어 JS `number`로는 정밀도가 손실될 수 있다. 대상 필드: `budget`, `hourlyRate`, `proposedAmount`, `offerAmount`, `agreedAmount`, `amount`, `feeAmount`, `payoutAmount`, `estimatedAmount`, `totalAmount` 등 금액 필드 전부. ID·별점·개수·기간(일)은 숫자 그대로 |

---

## 1. 공통 규칙

### 1.1 기본

| 항목 | 규칙 |
|---|---|
| Base URL | `/api` (배포 시 FE 도메인의 `/api/*`를 BE로 rewrite해 같은 출처로 호출, D-43) |
| 형식 | JSON (`Content-Type: application/json`), 파일 업로드만 `multipart/form-data` |
| 인증 | `Authorization: Bearer <accessToken>`. Access Token 유효 15분 |
| Refresh Token | httpOnly 쿠키 `wb_rt` (`Secure`, `SameSite=Lax`, `Path=/api/auth`). 응답 본문에 넣지 않는다(D-25). `Secure`는 운영에서만 붙인다(로컬 `http://localhost` 개발, D-66) |
| 날짜 | 모집 시작·마감일은 `YYYY-MM-DD`(KST 날짜). 그 외 시각은 ISO 8601 UTC(`2026-10-12T05:00:00.000Z`) |
| 금액 | 원 단위 정수. 0 이하 거부, 정책 상한 없음(D-42). **응답에서는 10진수 문자열**(예: `"3000000"`)로 보낸다. DB가 `bigint`이므로 JS `number`로 바꾸면 큰 값에서 정밀도가 손실될 수 있다(D-51). 요청에서는 숫자만으로 된 문자열을 권장하고, 안전 정수 범위(`Number.isSafeInteger`)의 JSON 숫자도 받는다. FE는 표시할 때 `BigInt(value).toLocaleString('ko-KR')`로 포맷한다 |
| ID | 정수 |

### 1.2 응답 형식

```json
// 성공 (단건)
{ "data": { ... } }

// 성공 (목록)
{ "data": [ ... ], "pagination": { "page": 1, "pageSize": 10, "totalCount": 37, "totalPages": 4 } }

// 실패
{ "error": { "code": "PROFILE_INCOMPLETE", "message": "프로필을 먼저 완성해 주세요.", "details": { "missingFields": ["companyName"] } } }
```

### 1.3 권한 표기

| 표기 | 뜻 |
|---|---|
| 공개 | 로그인 없이 호출 가능 |
| 로그인 | 유효한 Access Token 필요 (역할 미선택 사용자는 `AUTH-09`, `AUTH-05`, `AUTH-04`만 가능. 그 외 보호 API는 403 `ROLE_REQUIRED`) |
| CLIENT / FREELANCER | 해당 역할만 |
| 소유자 | 리소스를 만든 사용자만 |
| 당사자 | 계약의 의뢰인 또는 프리랜서 |
| +프로필 | 역할별 필수 프로필 완성 필요(A-13, 필수 항목은 D-05) |

- 공개 리소스(프로젝트, 공개 프로필)에 권한 없이 쓰기를 시도하면 **403**, 비공개 리소스(지원서, 계약, 결제, 알림)에 권한 없이 접근하면 존재를 숨기기 위해 **404**로 응답한다.

### 1.4 오류 코드

| HTTP | code | 뜻 |
|---|---|---|
| 400 | `VALIDATION_ERROR` | 입력 형식 오류. `details.fields`에 항목별 메시지 |
| 400 | `PAYMENT_AMOUNT_MISMATCH` | 결제 금액이 서버 금액과 다름 |
| 400 | `INVALID_IMAGE` | JPG·PNG·WebP 서명은 맞지만 이미지로 읽을 수 없음(손상·위장 파일) (STEP 04-B-2) |
| 401 | `UNAUTHENTICATED` | 토큰 없음·잘못됨 |
| 401 | `TOKEN_EXPIRED` | Access Token 만료 → FE가 `AUTH-03` 호출 후 재시도 |
| 401 | `INVALID_CREDENTIALS` | 이메일·비밀번호 불일치 |
| 401 | `INVALID_REFRESH_TOKEN` | Refresh Token 없음·만료·무효화 |
| 401 | `OAUTH_LINK_EXPIRED` | 계정 연동 확인 시간(10분) 초과 |
| 403 | `FORBIDDEN` | 권한 없음(역할·소유자) |
| 403 | `ROLE_REQUIRED` | 역할 미선택 사용자 |
| 403 | `PROFILE_INCOMPLETE` | 필수 프로필 미완성. `details.missingFields` 포함 |
| 403 | `OAUTH_EMAIL_UNVERIFIED` | 제공자가 이메일 인증을 확인하지 않음 |
| 409 | `OAUTH_LINK_UNAVAILABLE` | 비밀번호가 없거나 다른 Google 계정이 이미 연결되어 소유를 확인할 수 없음 (STEP 04-B) |
| 503 | `OAUTH_NOT_CONFIGURED` | Google OAuth 환경 변수가 없음 (STEP 04-B) |
| 404 | `NOT_FOUND` | 리소스 없음(또는 숨김) |
| 409 | `EMAIL_ALREADY_EXISTS` | 가입된 이메일 |
| 409 | `ROLE_ALREADY_SET` | 이미 역할 선택 완료 |
| 409 | `ALREADY_APPLIED` | 중복 지원 |
| 409 | `INVALID_STATE_TRANSITION` | 현재 상태에서 불가능한 동작. `details.currentStatus` 포함 |
| 409 | `FIELD_LOCKED` | 지원자가 있어 예산·마감일 변경 불가, 또는 거래 단계 진입 후 수정 불가 |
| 409 | `ALREADY_SIGNED` | 이미 서명함 |
| 409 | `ALREADY_REVIEWED` | 이미 리뷰 작성 |
| 409 | `CONFLICT` | 같은 자원이 동시에 바뀌어 처리하지 못함. 다시 시도하면 된다(프로필 이미지 교체, STEP 04-B-2) |
| 413 | `FILE_TOO_LARGE` | 업로드 용량 초과(D-29) |
| 415 | `UNSUPPORTED_FILE_TYPE` | 허용하지 않는 파일 형식 |
| 429 | `RATE_LIMITED` | 호출 제한 초과(로그인, AI) |
| 502 | `PG_ERROR` | PG 승인 실패·통신 오류 |
| 502 | `AI_INVALID_RESPONSE` | LLM 응답 검증 실패(재시도 후) |
| 503 | `AI_UNAVAILABLE` | LLM 호출 불가 |
| 500 | `INTERNAL_ERROR` | 기타 서버 오류(내부 정보 노출 안 함) |

### 1.5 공통 객체

| 객체 | 필드 |
|---|---|
| `UserMe` | `id, email, name, role, profileImageUrl, bio, hasPassword, socialProviders[], clientProfile?, freelancerProfile?, profileCompletion: { isComplete, missingFields[] }` |
| `PublicUser` | `id, name, role, profileImageUrl, bio, profileComplete, clientProfile(companyName, businessField, businessFieldEtc, websiteUrl) \| null, freelancerProfile(mainCategory, techStacks[{ id, name }], careerYears, portfolioUrl) \| null` (이메일·시간당 단가 제외, D-87. `ratingSummary: { average, count }`는 리뷰 단계 B-19에서 추가. STEP 05-C 구현 기준, §4.2) |
| `ProjectSummary` | `id, title, category, budget, recruitStartDate, recruitEndDate, publicStatus, techStacks[], applicantCount, isBookmarked?, createdAt` |
| `ProjectDetail` | `ProjectSummary + description, client(PublicUser 요약), status?(소유자만 7개 상태), myApplication?(프리랜서 본인 지원 상태)` |
| `Application` | `id, projectId, project(요약), freelancer(PublicUser 요약), coverLetter, proposedAmount, proposedDurationDays, status, rejectReason, offerAmount, offerStatus, contractId?, createdAt` |
| `Contract` | `id, projectId, projectTitle, agreedAmount, durationDays, terms, parties{client, freelancer}, status, displayStatus, clientSignedAt, freelancerSignedAt, signedAt, workStartedAt, delivery{note, url, requestedAt}, completedAt, availableActions[]` |
| `Payment` | `id, contractId, orderId, amount, status, method, paidAt, escrowStatus, feeAmount, payoutAmount, releasedAt` |
| `Review` | `id, contractId, reviewer(요약), reviewee(요약), rating, content, tags[], createdAt` |
| `Notification` | `id, type, title, message, linkUrl, projectId, applicationId, isRead, readAt, createdAt` (STEP 06-C 구현 기준, §10.1) |

- `publicStatus`: 외부 노출용 3개 값 `SCHEDULED`, `RECRUITING`, `CLOSED`. 거래 단계(`CONTRACTING` 이후)는 `CLOSED`로 내려준다(A-26).
- `availableActions`: 현재 사용자가 지금 할 수 있는 동작(`SIGN`, `PAY`, `REQUEST_DELIVERY`, `APPROVE`, `WRITE_REVIEW`, `CANCEL`). 버튼 표시를 FE가 직접 계산하지 않게 한다.

---

## 2. 엔드포인트 요약

| # | 분류 | 개수 | ID 범위 |
|---|---|---|---|
| 1 | 인증 및 사용자 | 9 | AUTH-01~09 |
| 2 | 프로필 관리 | 7 | PROF-01~07 |
| 3 | 프로젝트 CRUD | 5 | PRJ-01~05 |
| 4 | 프로젝트 검색·필터 | 3 | SRCH-01~03 |
| 5 | 지원서 제출 및 관리 | 4 | APP-01~04 |
| 6 | 지원자 수락·거절 | 2 | DEC-01~02 |
| 7 | 프로젝트 상태 관리 | 3 | STAT-01~03 |
| 8 | 알림 | 4 | NOTI-01~04 |
| 9 | 북마크 | 3 | BMK-01~03 |
| 10 | AI 단가 분석 | 1 | AI-01 |
| 11 | 계약·전자 서명 (금액 합의 포함) | 5 | CTR-01~05 |
| 12 | PG Sandbox 결제 및 검증 | 5 | PAY-01~05 |
| 13 | 에스크로 정산 | 3 | ESC-01~03 |
| 14 | 상호 리뷰 | 3 | REV-01~03 |
| - | 공통(헬스 체크) | 1 | SYS-01 |
| | **합계** | **58** | (기본 필수 영역 40, 심화 필수 영역 17, 공통 1) |

---

## 3. 인증 및 사용자 (AUTH)

| ID | Method | URL | 권한 | 요구사항 | 상태 |
|---|---|---|---|---|---|
| AUTH-01 | POST | `/auth/signup` | 공개 | A-01, A-02, N-01 | 검증 |
| AUTH-02 | POST | `/auth/login` | 공개 | A-02 | 검증 |
| AUTH-03 | POST | `/auth/refresh` | 쿠키 `wb_rt` | A-03 | 검증 |
| AUTH-04 | POST | `/auth/logout` | 쿠키 `wb_rt` | A-04, D-26 | 검증 |
| AUTH-05 | GET | `/auth/me` | 로그인 | A-08, A-13 | 검증 |
| AUTH-06 | GET | `/auth/oauth/google` | 공개 | A-05 | 검증 |
| AUTH-07 | GET | `/auth/oauth/google/callback` | 공개(Google 리다이렉트) | A-05, A-06, A-07 | 검증 |
| AUTH-08 | POST | `/auth/oauth/link` | 연동 확인 쿠키 `wb_link` | A-06, D-24 | 검증 |
| AUTH-09 | PATCH | `/auth/role` | 로그인(역할 미선택) | A-07 | 검증 |

**AUTH-01 회원가입**
- 요청: `{ "name": "홍길동", "email": "a@b.com", "password": "********", "role": "CLIENT" }`
- 응답 201: `{ data: { accessToken, user: UserMe } }` + `Set-Cookie: wb_rt`
- 처리: 이메일 소문자 정규화, bcrypt 해싱. 프로필 입력은 요구하지 않는다(A-13, D-56)
- 오류: 400 `VALIDATION_ERROR`(비밀번호 규칙은 D-60), 409 `EMAIL_ALREADY_EXISTS`

**AUTH-02 로그인**
- 요청: `{ email, password }` → 응답 200: `{ data: { accessToken, user } }` + `Set-Cookie: wb_rt`
- 오류: 400, 401 `INVALID_CREDENTIALS`(이메일 존재 여부를 구분하지 않음), 429 `RATE_LIMITED`
- 소셜 전용 계정(비밀번호 없음)도 `INVALID_CREDENTIALS`로 응답한다

**AUTH-03 토큰 재발급**
- 요청: 본문 없음(쿠키 사용) → 응답 200: `{ data: { accessToken, user } }` + 새 `wb_rt`(기존 토큰은 무효화, 교체 방식)
- 오류: 401 `INVALID_REFRESH_TOKEN`. 이미 무효화된 토큰이 다시 오면 해당 사용자 토큰 전체 무효화
- 새로고침 시 세션 복원에도 이 API를 쓴다

**AUTH-04 로그아웃**
- 응답 204 + 쿠키 삭제. DB의 Refresh Token에 `revoked_at` 기록. 토큰이 없어도 204(멱등)

**AUTH-05 내 정보**
- 응답 200: `{ data: UserMe }` (`profileCompletion` 포함)
- 오류: 401

**AUTH-06 Google 로그인 시작**
- `GET /auth/oauth/google/status` → 200 `{ data: { enabled } }`. Client Secret·토큰은 포함하지 않는다. 설정이 없으면 FE는 버튼 대신 환경 변수 안내를 보여 준다
- `GET /auth/oauth/google` 응답 302 → Google 인증 페이지. 권한은 `openid email profile`만 요청한다
- CSRF용 `state`, PKCE `code_verifier`, OIDC `nonce`를 서버에 10분 저장한다. 쿠키 `wb_oauth`(httpOnly, `Path=/api/auth/oauth`)에는 `state` 원문만 두고, DB에는 SHA-256 해시와 verifier·nonce를 둔다. 콜백에서 한 번 쓰면 행을 지운다
- 쿼리 `returnTo`(선택): 로그인 후 돌아갈 FE 경로. 외부 URL·`//`·로그인 화면 자신은 무시한다
- 설정이 없으면 503 `OAUTH_NOT_CONFIGURED` (Google로 리다이렉트하지 않음)

**AUTH-07 Google 콜백**
- 브라우저 최상위 이동(GET)이라 `trustedOrigin`의 POST 출처 검사를 타지 않는다. `SameSite=Lax` 쿠키는 이 이동에 실린다
- 처리: 쿠키 `state`와 쿼리 `state` 비교 → 저장된 요청을 일회 소비 → 서버에서 인가 코드 교환(PKCE) → ID Token 서명·`iss`·`aud`·`exp`·`nonce` 검증 → `email_verified = true` 확인. 사용자 식별은 Google `sub`
  - 연동된 소셜 계정 있음 → WorkBridge 세션 발급, 302 `{프론트}/oauth/complete`
  - 같은 이메일 사용자 없음 → 사용자 생성(역할 NULL) + 소셜 계정 연결 → 302 `{프론트}/select-role`
  - **같은 이메일 사용자 있음, 미연동, 비밀번호 있음** → 10분짜리 연동 확인 토큰을 httpOnly 쿠키 `wb_link`에 저장 → 302 `{프론트}/oauth/link`(마스킹된 이메일). 이메일만 같다고 자동 연결하지 않는다
  - 비밀번호가 없거나 다른 Google 계정이 이미 연결됨 → 302 `{프론트}/login?error=OAUTH_LINK_UNAVAILABLE`
- 세션은 기존 Refresh Token 쿠키 `wb_rt`로만 만든다. Google Access Token·ID Token은 URL·쿠키·응답·로그에 넣지 않는다. FE는 `/oauth/complete`에서 `AUTH-03`으로 Access Token을 받는다
- 역할이 없으면 역할 선택을 마친 뒤에만 `returnTo`로 간다. 역할이 있으면 `/oauth/complete` 다음 `returnTo`(없으면 홈)
- 오류(302 `{프론트}/login?error=`): `OAUTH_EMAIL_UNVERIFIED`, `OAUTH_FAILED`, `OAUTH_CANCELLED`(사용자가 취소), `OAUTH_EXPIRED`(저장된 요청 만료)

**AUTH-08 기존 계정 연동 확인** (계정 소유 확인)
- 요청: `{ "password": "********" }` (기존 이메일 계정의 비밀번호)
- 처리: `wb_link` 검증 → 비밀번호 확인 → 소셜 계정 연결 → 로그인. 이후에는 Google로 바로 로그인된다. 잘못된 비밀번호는 토큰을 지우지 않아 10분 안에 다시 시도할 수 있다
- 응답 200: `{ data: { accessToken, user } }` + `wb_rt`, `wb_link` 삭제
- 오류: 401 `OAUTH_LINK_EXPIRED`, 401 `INVALID_CREDENTIALS`, 409 `OAUTH_LINK_UNAVAILABLE`, 429 `RATE_LIMITED`(로그인 실패와 같은 제한)

**AUTH-09 역할 선택** (소셜 최초 가입)
- 요청: `{ "role": "FREELANCER" }` → 응답 200: `{ data: UserMe }`
- 이미 역할이 있으면 409 `ROLE_ALREADY_SET`. 프로필 수정 API로 역할을 바꾸지 않는다
- 역할이 없는 사용자는 로그인 상태이지만, 역할이 필요한 API는 403 `ROLE_REQUIRED`. 화면은 `/select-role`로 보낸 뒤, 선택이 끝나면 `returnTo`가 있으면 그 경로로, 없으면 내 프로필(`/me`)로 간다
- 오류: 400, 409 `ROLE_ALREADY_SET`

### 3.1 STEP 04-A 구현 내용과 명세 대비 차이 (AUTH-01~05)

구현: `apps/api/src/modules/auth/`, `apps/api/src/middlewares/authenticate.js`, `trustedOrigin.js`. 테스트: `apps/api/test/auth.unit.test.js`(단위), `apps/api/test/db/auth.integration.test.js`(실제 테스트 DB).

| # | 항목 | 명세 | 구현 | 근거 |
|---|---|---|---|---|
| 1 | Refresh Token 형식 | 정하지 않음 | 무작위 32바이트(base64url), DB에는 SHA-256 해시만 저장. 유효 14일 | D-64 |
| 2 | 쿠키 `Secure` | 항상 | 운영 또는 `COOKIE_SECURE=true`일 때만 | 로컬 HTTP 개발(D-66) |
| 3 | 출처 검사 | 없음 | `/api/auth`의 POST에 `Origin` 헤더가 있고 `CORS_ORIGIN`에 없으면 403 `FORBIDDEN` | CSRF 보완(D-66) |
| 4 | 캐시 | 없음 | `/api/auth` 응답에 `Cache-Control: no-store` | 토큰·개인정보가 캐시에 남지 않게 함 |
| 5 | 비밀번호 상한 | 없음 | 72바이트 초과는 400(회원가입). 로그인에서는 `INVALID_CREDENTIALS` | bcrypt가 72바이트 뒤를 무시함(D-67) |
| 6 | 재발급 실패 | 401 | 401 `INVALID_REFRESH_TOKEN` + 쿠키 삭제 | 브라우저에 쓸모없는 쿠키를 남기지 않음 |
| 7 | 호출 제한 | 로그인 429 | 로그인 실패 10회/15분/IP 초과 시 429 `RATE_LIMITED`(성공은 세지 않음) | D-68 |
| 8 | 회원가입 응답 | 201 + 토큰 | 같음. 가입하면 바로 로그인된다 | 프로필 입력을 강제하지 않음(D-56) |
| 9 | 이름 | 형식 미정 | 앞뒤 공백 제거 후 1~50자 | ERD `users.name varchar(50)` |
| 10 | 이메일 | 소문자 정규화 | 앞뒤 공백 제거 + 소문자, 255자 이하. 같은 이메일 동시 가입은 DB UNIQUE로 1건만 성공하고 나머지는 409 | ERD `users.email` UNIQUE |

- 오류 응답 예: 400 `{ "error": { "code": "VALIDATION_ERROR", "message": "입력값을 확인해 주세요.", "details": { "fields": { "email": "올바른 이메일 형식이 아닙니다." } } } }`
- `TOKEN_EXPIRED`(만료)와 `UNAUTHENTICATED`(없음·위조·형식 오류)를 구분한다. FE는 두 경우 모두 `AUTH-03`을 한 번 시도한다(D-69).
- `user`(`UserMe`)에는 비밀번호 해시가 들어가지 않고, 비밀번호 유무만 `hasPassword`로 준다. `hourlyRate`는 문자열(D-51).

### 3.2 STEP 04-B 구현 내용과 명세 대비 차이 (AUTH-06~09)

구현: `apps/api/src/modules/auth/googleOAuth.js`, `oauth.service.js`, `apps/api/src/middlewares/requireRole.js`. Google 프로토콜(인가 코드 교환, PKCE, ID Token 서명·`iss`·`aud`·`exp`)은 `google-auth-library`를 쓴다. 테스트의 Google 호출은 Mock이다.

| # | 항목 | 명세 | 구현 | 근거 |
|---|---|---|---|---|
| 1 | `state` 저장 | httpOnly 쿠키만 | 쿠키 `wb_oauth` + DB `oauth_transactions`(해시, PKCE verifier, nonce, 10분, 사용 후 삭제) | 일회용·PKCE·nonce를 서버만 갖게 함(D-71) |
| 2 | 로그인 가능 여부 | 시작 URL만 | `GET /auth/oauth/google/status`가 `{ enabled }`만 반환 | 설정이 없을 때 깨진 버튼 대신 안내(D-74) |
| 3 | 콜백 오류 | `OAUTH_EMAIL_UNVERIFIED`, `OAUTH_FAILED` | 추가로 `OAUTH_CANCELLED`, `OAUTH_EXPIRED`, `OAUTH_LINK_UNAVAILABLE` | 취소·만료·소유 확인 불가를 구분 |
| 4 | 소유 확인 불가 | 401만 열거 | 409 `OAUTH_LINK_UNAVAILABLE`. 비밀번호가 없거나 다른 Google 계정이 이미 연결된 경우 연결하지 않음 | D-72 |
| 5 | 잘못된 비밀번호 | 토큰 처리 미정 | 연동 토큰을 유지하고 401. 만료·연결 불가일 때만 쿠키를 지움 | 10분 안에 다시 입력 |
| 6 | 리다이렉트 대상 | 상대 경로 | `CORS_ORIGIN`의 첫 출처(로컬은 Redirect URI와 같은 `http://localhost:5173`)로만 이동 | 외부 URL 차단(D-74) |
| 7 | 역할 없는 사용자 | AUTH-09·05·04만 허용 | `requireRole`이 그 외 보호 API에 403 `ROLE_REQUIRED`. 화면은 `/select-role` | A-07 |
| 8 | 역할 선택 후 이동 | 명세는 응답만 | `returnTo`가 있으면 그 내부 경로, 없으면 `/me` | 신규 가입은 프로필, 깊은 링크는 원래 목적지 |
| 9 | Google 토큰 | 미정 | WorkBridge Access/Refresh와 분리. Google 토큰은 교환 직후 폐기 | D-70 |

- 실제 Google Cloud 자격 증명이 없으면 상태 API는 `enabled: false`이고, 로그인 시작은 503이다. Mock 테스트 통과를 실제 Google 로그인 성공으로 보지 않는다.

---

## 4. 프로필 관리 (PROF)

| ID | Method | URL | 권한 | 요구사항 | 상태 |
|---|---|---|---|---|---|
| PROF-01 | PATCH | `/users/me` | 로그인 | A-09 | 검증 |
| PROF-02 | PUT | `/users/me/client-profile` | CLIENT | A-10 | 검증 |
| PROF-03 | PUT | `/users/me/freelancer-profile` | FREELANCER | A-11 | 검증 |
| PROF-04 | POST | `/uploads/profile-image` | 로그인 | A-09, D-29 | 검증(로컬 저장소) |
| PROF-05 | GET | `/users/:userId` | 공개 | A-14, B-19 | 검증(A-14). 별점·리뷰(B-19)는 설계 |
| PROF-06 | GET | `/tech-stacks` | 공개 | A-11, A-12, A-21 | 검증 |
| PROF-07 | POST | `/tech-stacks` | 로그인 | A-11 | 검증 |

- 내 프로필 조회는 별도 API 없이 `AUTH-05`(`GET /auth/me`)를 쓴다. 완성 여부도 `profileCompletion`으로 함께 받는다.
- 대상 사용자는 언제나 Access Token의 사용자다. 요청 본문에 `userId`·`role`이 있어도 쓰지 않는다.

**PROF-01 공통 프로필 수정**
- 요청(부분 수정): `{ name?, bio?, profileImageUrl?: null }` → 응답 200: `{ data: UserMe }`
- 이메일·역할은 바꿀 수 없다(로그인 식별자, 소셜 연동 기준). 보내면 400
- `profileImageUrl`은 `null`(이미지 삭제)만 받는다. 이미지 설정은 `PROF-04`로만 한다(임의 외부 URL 저장 방지)

**PROF-02 의뢰인 프로필 저장** (없으면 생성, 있으면 전체 교체)
- 요청: `{ companyName, businessField, businessFieldEtc?, websiteUrl? }` (필수 항목은 D-05)
- 검증: `businessField = ETC`일 때만 `businessFieldEtc` 허용(그때는 필수)
- 응답 200: `{ data: UserMe }` (갱신된 `profileCompletion` 포함)
- 오류: 400, 403 `FORBIDDEN`(프리랜서), 403 `ROLE_REQUIRED`

**PROF-03 프리랜서 프로필 저장** (없으면 생성, 있으면 전체 교체)
- 요청: `{ mainCategory, techStackIds: number[], careerYears, hourlyRate, portfolioUrl? }` (필수 항목은 D-05)
- `techStackIds`는 1~20개, 중복 불가. 기존 연결은 요청 목록으로 통째로 바뀐다
- 응답 200: `{ data: UserMe }`
- 오류: 400(존재하지 않는 기술 스택 ID·중복 포함), 403 `FORBIDDEN`(의뢰인), 403 `ROLE_REQUIRED`

**PROF-04 프로필 이미지 업로드**
- 요청: `multipart/form-data`, 필드 `file` 하나 (jpg/png/webp, 5MB 이하, D-29 제안값)
- 처리: 파일 앞부분 바이트로 실제 형식 판별 → 디코딩 검증 → 512px 이하 WebP로 다시 인코딩(EXIF 제거) → 무작위 파일 이름으로 저장 → 사용자 이미지로 바로 설정, 이전 파일 삭제(D-76)
- 응답 201: `{ data: UserMe }` (`profileImageUrl` = `/api/uploads/profile-images/<32자리 hex>.webp`)
- 오류: 400 `VALIDATION_ERROR`(파일 없음), 400 `INVALID_IMAGE`, 401, 403 `ROLE_REQUIRED`, 409 `CONFLICT`, 413 `FILE_TOO_LARGE`, 415 `UNSUPPORTED_FILE_TYPE`(SVG·실행 파일 등)
- 이미지 제공: `GET /uploads/profile-images/:fileName` (공개). 저장소가 만든 이름 형식만 열고 그 외는 404. `Content-Type: image/webp`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'`

**PROF-05 공개 프로필**
- 로그인 없이 읽는다. Access Token이 있어도 없어도(잘못된 토큰 포함) 같은 응답이다. 본인 여부·수정 가능 여부는 담지 않는다
- 응답 200: `{ data: PublicUser }` (평균 별점·리뷰 수는 B-19에서 추가, 리뷰 목록은 `REV-03`)
- 오류: 404 `NOT_FOUND` — 없는 사용자, 역할을 고르지 않은 사용자, 숫자가 아니거나 범위(1~2147483647)를 벗어난 ID(`me` 포함)를 구분하지 않는다(D-88)
- `Cache-Control: no-store`. DB에 쓰지 않는다(D-83과 같은 원칙)
- 화면 주소: `/users/:userId`. 프로젝트 상세의 `client.id`로 연결한다. STEP 06 지원자 목록도 같은 응답·화면을 쓴다(D-89)

**PROF-06 기술 스택 검색**
- 쿼리: `q`(선택, 부분 일치), `limit`(기본 20)
- 응답 200: `{ data: [{ id, name, isCustom }] }`

**PROF-07 커스텀 기술 스택 추가**
- 요청: `{ "name": "Svelte" }`
- 응답: 새로 만들면 201, 정규화 이름이 같은 항목이 있으면 200으로 기존 항목 반환 → `{ data: { id, name, isCustom } }`

### 4.1 STEP 04-B-2 구현 내용과 명세 대비 차이 (PROF-01~04, 06, 07, SRCH-03)

구현: `apps/api/src/modules/profiles/`, `uploads/`, `techStacks/`, `apps/api/src/routes/meta.js`, `apps/api/src/middlewares/requireCompleteProfile.js`. 테스트: `apps/api/test/profile.unit.test.js`(단위), `apps/api/test/db/profiles.integration.test.js`(실제 테스트 DB). 스키마 변경(마이그레이션) 없음.

| # | 항목 | 명세 | 구현 | 근거 |
|---|---|---|---|---|
| 1 | PROF-02·03 요청 | 모든 항목 선택(`?`) | D-05 필수 항목을 받아야 저장. 없으면 400. 저장은 전체 교체(PUT) | 반쯤 채운 프로필이 "저장됨"으로 보이지 않게 함(D-77) |
| 2 | 권한 확인 순서 | 미정 | 로그인 → 역할 선택(`ROLE_REQUIRED`) → 역할 일치(`FORBIDDEN`) → 입력 검사 | 다른 역할에는 입력 오류 대신 403을 줌 |
| 3 | 동시 저장 | 미정 | 사용자 행을 `FOR UPDATE`로 잠그고 트랜잭션 안에서 저장 | 기술 스택 연결이 섞이지 않게 함(D-77) |
| 4 | PROF-01 `profileImageUrl` | 문자열 | `null`(삭제)만 허용 | 임의 외부 URL 저장 방지(D-76) |
| 5 | PROF-04 응답 | 201 `{ url }` → FE가 PROF-01로 저장 | 201 `UserMe`. 업로드가 곧바로 사용자 이미지를 바꾸고 이전 파일을 지움 | 저장되지 않은 고아 파일·외부 URL 방지(D-76) |
| 6 | 이미지 오류 | 400, 413, 415 | 추가로 400 `INVALID_IMAGE`, 409 `CONFLICT` | 손상 파일·동시 교체 구분 |
| 7 | 이미지 저장소 | Supabase Storage 제안(D-29) | 로컬 디스크(`apps/api/uploads/profile-images`, `UPLOAD_DIR`로 변경). 외부 유료 서비스 연결 안 함 | 사용자 승인 전(D-76) |
| 8 | 입력 상한 | 미정 | 이름 50자, 자기소개 2,000자, 회사명·기타 사업 분야 100자, URL 500자(http/https만), 경력 0~80년, 기술 스택 20개, 단가 1~bigint 최대 | DB 열 길이·현실 범위(D-77) |
| 9 | 응답 캐시 | 없음 | `/api/users` 응답에 `Cache-Control: no-store` | 개인정보 캐시 방지 |
| 10 | 필수 프로필 검사 | `+프로필` 표기만 | `requireCompleteProfile` 미들웨어(403 `PROFILE_INCOMPLETE` + `missingFields`). 프로젝트 등록·지원 API를 만들 때 붙인다. 아직 연결된 라우트 없음 | D-78 |
| 11 | SRCH-03 | `reviewTags` 포함 | `projectCategories`, `businessFields`만(값·한국어 이름). 리뷰 태그는 리뷰 단계에서 추가 | D-20 미확정 |
| 12 | PROF-06 검색 | 부분 일치 | 이름(대소문자 무시) 또는 정규화 이름 부분 일치. `limit` 최대 100. 기본 항목 먼저, 이름순 | `Node.js`·`nodejs` 모두 찾기 |
| 13 | 기본 기술 스택 | 미정 | 27개 기본 항목을 멱등 시드(`npm run db:seed:tech-stacks -w apps/api`) | D-75 |

- 응답의 `UserMe`에는 비밀번호 해시·Refresh Token·Google `sub`가 들어가지 않는다(DB 테스트로 확인).
- 프로필이 미완성이어도 로그인·재발급·`/auth/me`·프로필 저장은 그대로 된다(A-13, D-56).

### 4.2 STEP 05-C 구현 내용과 명세 대비 차이 (PROF-05, A-14)

구현: `apps/api/src/modules/profiles/publicProfile.js`(ID 해석·조회), `apps/api/src/modules/users/publicUser.js`(Prisma `select`·응답 DTO), `users.router.js`의 `GET /:userId`. 화면: `apps/web/src/pages/PublicProfilePage.jsx`, `components/profile/PublicProfileView.jsx`·`ProfileAvatar.jsx`. 테스트: `apps/api/test/public-profile.unit.test.js`, `apps/api/test/db/public-profile.integration.test.js`, `apps/web/src/app/publicProfile.test.jsx`. 스키마 변경(마이그레이션) 없음.

**항목별 공개 여부** (RFP 요구는 "다른 사용자가 볼 수 있는 공개 프로필"뿐이고 항목 목록은 없다. 그래서 RFP 프로필 항목(3.1.3) 중 다른 사용자가 상대를 판단하는 데 필요한 것만 공개하고, 범위가 불분명한 개인정보는 공개하지 않는다. D-87)

| 대상 | 항목 | 공개 | 근거 |
|---|---|---|---|
| 공통 | `id` | O | 링크·재사용용 식별자. 이미 프로젝트 상세 `client.id`로 공개됨 |
| 공통 | `name` (표시 이름) | O | 프로젝트 상세에 이미 공개됨 |
| 공통 | `role` | O | 화면 구성(의뢰인·프리랜서)을 정하는 데 필요 |
| 공통 | `profileImageUrl` | O (형식 검사) | PROF-04 저장소가 만든 `/api/uploads/profile-images/<32 hex>.webp`일 때만. 그 외 값은 `null`. 서버 디렉터리 경로는 노출하지 않음 |
| 공통 | `bio` (공개용 소개·자기소개) | O | 사용자가 소개용으로 직접 쓴 글 |
| 공통 | `profileComplete` | O (참/거짓만) | 화면의 "작성 중" 안내용. 어떤 항목이 비었는지(`missingFields`)는 알리지 않음 |
| 의뢰인 | `companyName`, `businessField`, `businessFieldEtc` | O | 거래 상대 판단에 필요(3.1.3). 회사명은 프로젝트 상세에 이미 공개됨 |
| 의뢰인 | `websiteUrl` | O | 회사 공개 웹사이트. http/https만 링크로 연다 |
| 프리랜서 | `mainCategory`, `techStacks[{ id, name }]`, `careerYears` | O | 지원자 판단에 필요(3.1.3, STEP 06 지원자 목록) |
| 프리랜서 | `portfolioUrl` | O | 포트폴리오는 보여 주려고 등록하는 값. http/https만 링크로 연다 |
| 프리랜서 | `hourlyRate` (희망 단가) | **X** | RFP에 공개 범위가 없고 거래 조건이라 민감. 지원 시 제안 금액(APP)으로 따로 전달된다(D-87) |
| 비공개 | `email`, `passwordHash`·`hasPassword`, `socialAccounts`(`providerUserId` = Google `sub`, `emailAtLink`)·`socialProviders`, Access/Refresh Token·토큰 해시, `oauthTransactions`, `createdAt`·`updatedAt`, `missingFields`, 기술 스택 `normalizedName`·`isCustom`·`createdById` | **X** | 로그인·보안·운영 정보. 쿼리에서 아예 읽지 않는다(`publicUserSelect`) |
| 해당 없음 | 전화번호 | - | 저장하지 않는 항목 |

| # | 항목 | 명세 | 구현 | 근거 |
|---|---|---|---|---|
| 1 | `PublicUser.hourlyRate` | 포함 | 제외. DB 값은 그대로이고 완성 여부 계산에만 읽는다 | D-87 |
| 2 | `ratingSummary` | 포함 | 리뷰 테이블이 없어 아직 없음. B-19에서 추가 | 리뷰 단계 |
| 3 | `businessFieldEtc`, `profileComplete` | 없음 | 추가 | 사업 분야 '기타' 표시, 미완성 안내 |
| 4 | 역할 없는 사용자·잘못된 ID | 404 | 없는 사용자와 같은 404 | D-88 |
| 5 | 역할과 다른 프로필 행 | 미정 | 역할에 맞는 프로필만 싣고 다른 쪽은 `null` | 역할 변경 데이터가 남아도 섞이지 않게 |
| 6 | 조회 쿼리 | 미정 | Prisma 중첩 `select` 한 번. 관계 단계마다 SELECT 1개(최대 5개)이며 기술 스택 수와 무관(N+1 없음, DB 테스트로 확인) | - |
| 7 | 쓰기 시도 | 공개 리소스 쓰기는 403(§1) | `/users/:userId`에는 쓰기 라우트가 없어 404. 수정은 `/users/me`(본인 토큰)로만 가능 | 다른 사용자 수정 경로가 없음 |
| 8 | 프로젝트 목록 | - | 검색 결과(SRCH-01)에는 의뢰인 정보를 넣지 않음(변경 없음). 링크는 상세의 `client.id`만 사용 | 목록 응답에 개인정보 추가 없음 |

---

## 5. 프로젝트 CRUD (PRJ)

| ID | Method | URL | 권한 | 요구사항 | 상태 |
|---|---|---|---|---|---|
| PRJ-01 | POST | `/projects` | CLIENT +프로필 | A-15, A-24 | 구현 (STEP 05-A) |
| PRJ-02 | GET | `/projects/:projectId` | 공개 | A-18, A-26 | 구현 (STEP 05-A) |
| PRJ-03 | PATCH | `/projects/:projectId` | 소유자 | A-16, B-03 | 구현 (STEP 05-A) |
| PRJ-04 | DELETE | `/projects/:projectId` | 소유자 | A-17 | 구현 (STEP 05-A) |
| PRJ-05 | GET | `/me/projects` | CLIENT | A-28 | 구현 (STEP 05-A) |

**PRJ-01 프로젝트 등록** (3단계 퍼널의 마지막에 한 번 호출)
- 요청: `{ title, description, category, recruitStartDate?: "2026-10-20", recruitEndDate: "2026-11-05", budget: "3000000", techStackIds: [1, 5] }`
- 처리: 시작일 없음·오늘이면 `RECRUITING`, 미래면 `SCHEDULED`(KST 기준)
- 응답 201: `{ data: ProjectDetail }` → FE는 상세로 이동
- 오류: 400(마감일 < 시작일, 과거 시작일은 D-47), 403 `FORBIDDEN`, 403 `PROFILE_INCOMPLETE`

**PRJ-02 프로젝트 상세**
- 응답 200: `{ data: ProjectDetail }`. 비소유자에게는 `publicStatus`만, 소유자에게는 7개 상태 `status`도 준다. 로그인한 프리랜서에게는 `isBookmarked`, `myApplication` 포함
- 오류: 404(삭제됨·없음. 취소된 프로젝트는 소유자·지원자만 조회 가능)

**PRJ-03 프로젝트 수정** (예산 반영 B-03 포함)
- 요청(부분 수정): `{ title?, description?, category?, recruitStartDate?, recruitEndDate?, budget?, techStackIds? }`
- 처리: 시작일 변경 시 `SCHEDULED`/`RECRUITING` 재계산
- 오류: 400, 403, 404, 409 `FIELD_LOCKED`(대기·수락 지원이 있을 때 예산·마감일 변경 D-06, 거래 단계 이후 수정 D-55), 409 `INVALID_STATE_TRANSITION`

**PRJ-04 프로젝트 삭제** (소프트 삭제)
- 처리: `deleted_at` 기록, 대기 지원 `REJECTED(PROJECT_DELETED)`(D-07 제안). 삭제 가능 상태는 D-07
- 응답 204
- 오류: 403, 404, 409 `INVALID_STATE_TRANSITION`

**PRJ-05 내 프로젝트** (의뢰인)
- 쿼리: `status`(7개 상태 중 선택), `page`
- 응답 200: 목록 + `pagination`. 각 항목에 7개 상태와 계약 세부 상태(`contractStatus`, 화면 표시용 `displayStatus` 예: "결제 대기") 포함

### 5.1 STEP 05-A 구현 내용과 명세 대비 차이 (PRJ-01~05)

구현: `apps/api/src/modules/projects/`(`project.validation.js`, `project.service.js`, `projectStatus.js`, `projects.router.js`), `apps/api/src/middlewares/authenticate.js`(`createOptionalAuthenticate`). 화면: `apps/web/src/pages/Project*Page.jsx`, `MyProjectsPage.jsx`. 테스트: `apps/api/test/project.unit.test.js`(단위), `apps/api/test/db/projects.integration.test.js`(실제 테스트 DB), `apps/web/src/app/projectFlow.test.jsx`(화면). 마이그레이션 1개(ERD_v1 §7.5).

| # | 항목 | 명세 | 구현 | 근거 |
|---|---|---|---|---|
| 1 | PRJ-01 중복 등록 | 미정 | `Idempotency-Key` 헤더(UUID) 필수, 없으면 400. 같은 의뢰인이 같은 키로 다시 보내면 새로 만들지 않고 200으로 기존 프로젝트 반환(처음은 201). 동시 요청도 `(client_id, idempotency_key)` UNIQUE로 1건만 생성. 그 키의 프로젝트가 삭제됐으면 409 `CONFLICT` | D-79 |
| 2 | PRJ-01 확인 순서 | `+프로필` | 로그인(401) → 역할 선택(`ROLE_REQUIRED`) → 의뢰인(403 `FORBIDDEN`) → 프로필 완성(403 `PROFILE_INCOMPLETE` + `missingFields`) → 키·입력 검사(400) | D-78 |
| 3 | 입력 범위 | 미정 | 제목 1~100자, 설명 1~5,000자, 카테고리 enum, 날짜 `YYYY-MM-DD`(실제 있는 날짜, KST), 예산 1~bigint 최대(숫자 문자열 또는 안전 정수, D-51), 기술 스택 1~20개(중복·없는 ID 400). 등록 시 과거 시작일·과거 마감일·마감일 < 시작일은 400 | D-47, D-77과 같은 기준 |
| 4 | `ProjectDetail` | 소유자에게 `status` | 모든 사용자에게 `isOwner`. 소유자에게만 `status`, `availableActions`(`EDIT`·`DELETE`), `lockedFields`. 화면은 이 값으로 버튼을 보이고 숨긴다(최종 판단은 서버) | 권한 계산을 FE와 BE에 두 번 두지 않음 |
| 5 | 아직 없는 값 | `applicantCount`, `isBookmarked`, `myApplication`, 추천 섹션 | `applicantCount`는 항상 0. 나머지는 응답에 넣지 않음. **STEP 06-A 변경:** `applicantCount`는 실제 지원 수, 프리랜서에게 `myApplication`(§7.1 #10). **STEP 07-A 변경:** 프리랜서에게 `isBookmarked`(§11.1 #8), 추천은 별도 API SRCH-02(§6.2) | 지원·북마크·추천 테이블이 아직 없음(해당 단계에서 추가) |
| 6 | PRJ-02 인증 | 공개 | 토큰이 없으면 공개 응답. 토큰이 있는데 틀렸거나 만료면 401(조용히 공개 응답으로 바꾸지 않음) | FE 재발급 인터셉터가 동작하도록 |
| 7 | PRJ-03 수정 가능 상태 | D-55 | `SCHEDULED`·`RECRUITING`·`CLOSED`만. `CONTRACTING` 이후 409 `FIELD_LOCKED`, `CANCELLED` 409 `INVALID_STATE_TRANSITION`. `CLOSED`에서 모집일 변경은 409 `FIELD_LOCKED` + `lockedFields` | D-80, D-09 |
| 8 | PRJ-03 요청 | 부분 수정 | 바뀐 항목만 받음. 빈 요청 400, `status` 400(상태는 STAT API로만), `recruitEndDate: null` 400, `clientId` 무시. 날짜 검사는 바뀐 값에만 적용(이미 지난 기존 시작일은 그대로 둘 수 있음). 시작일을 바꾸면 `SCHEDULED`/`RECRUITING` 재계산. 기술 스택은 통째로 교체. 비소유자 403 `FORBIDDEN`, 삭제됨 404. 행을 `FOR UPDATE`로 잠그고 트랜잭션 안에서 저장 | D-80 |
| 9 | 지원자 관련 제한 | D-06(예산·마감일), D-07(대기 지원 거절) | 아직 적용할 대상 없음. **STEP 06-A 변경:** 둘 다 적용(§7.1 #11·#12) | 지원 테이블이 아직 없음. 지원 기능 단계에서 같은 서비스 함수에 추가 |
| 10 | PRJ-04 삭제 가능 상태 | D-07 | `SCHEDULED`·`RECRUITING`·`CLOSED`만. 그 밖은 409 `INVALID_STATE_TRANSITION`. 삭제 후 상세·수정·삭제·내 목록 모두 404/제외, DB 행은 남음 | D-80, D-53 |
| 11 | PRJ-05 쿼리·항목 | `status`, `page`, `contractStatus`, `displayStatus` | `page`만(기본 1, 10개, 최신 등록순). 각 항목은 요약 + `status`·`availableActions`·`lockedFields`. 계약 세부 상태는 없음. 의뢰인이 아니면 403 `FORBIDDEN` | 상태 필터는 STEP 05-B, 계약 세부 상태는 계약 단계 |
| 12 | 상태 자동 전환 | D-08 | 상세·수정·삭제·내 목록 조회 직전에 조건부 `UPDATE`로 보정(시작일 도래 → `RECRUITING`, 마감일 경과 → `CLOSED` + `closed_at`). 여러 번 실행해도 결과가 같다. 마감 시 대기 지원 일괄 거절(A-34)은 지원 단계에서 추가. **STEP 05-B 변경:** 조회(상세·내 목록·검색)는 DB에 쓰지 않고 날짜로 계산한 상태를 보여 준다. 저장 보정은 수정·삭제(행 잠금) 때만 한다(§6.1 #2) | D-81 → D-83(제안) |
| 13 | 응답 캐시 | 없음 | `/api/projects`, `/api/me/projects` 응답에 `Cache-Control: no-store` | 소유자 전용 필드가 캐시되지 않게 |

- 예산은 DB `bigint`, 응답은 문자열이다. `9007199254740993`(2^53 + 1)을 화면에서 등록해 DB·응답·화면 모두 같은 값임을 확인했다.
- 날짜는 KST 달력 날짜(`YYYY-MM-DD`)로 주고받는다. "오늘"은 서버가 UTC + 9시간으로 계산한다(D-41, D-58).

---

## 6. 프로젝트 검색·필터 (SRCH)

| ID | Method | URL | 권한 | 요구사항 | 상태 |
|---|---|---|---|---|---|
| SRCH-01 | GET | `/projects` | 공개 | A-19~A-23, A-26 | 구현 (STEP 05-B, §6.1) |
| SRCH-02 | GET | `/projects/:projectId/recommendations` | 공개 | A-41, D-30 | 구현 (STEP 07-A, §6.2) |
| SRCH-03 | GET | `/meta/options` | 공개 | A-10, A-11, B-16, B-17 | 일부 검증(리뷰 태그 제외, §4.1) |

**SRCH-01 프로젝트 목록**
- 쿼리

| 이름 | 예 | 설명 |
|---|---|---|
| `q` | `쇼핑몰` | 제목·설명 부분 일치 |
| `category` | `WEB` | |
| `budgetMin`, `budgetMax` | `1000000` | 원 |
| `techStackIds` | `1,5` | 하나라도 포함(OR) |
| `deadline` | `2026-11-30` | 이 날짜까지 마감(D-32) |
| `status` | `RECRUITING` | `SCHEDULED`, `RECRUITING`, `CLOSED`(거래 단계 포함) |
| `sort` | `latest` | `latest`(최신순), `deadline`(마감임박순), `budget`(예산 높은순). 같은 값은 최신순(D-33) |
| `page` | `1` | 페이지당 10개 고정(RFP 3.2.2) |

- 응답 200: `{ data: ProjectSummary[], pagination }`. 삭제·취소된 프로젝트는 제외
- ~~조회 직전에 상태 보정(시작일·마감일 경과분)을 실행한다(D-08)~~ → 조회는 DB에 쓰지 않고 날짜로 상태를 계산한다(D-83 제안, §6.1)
- 오류: 400(잘못된 쿼리 값)

### 6.1 STEP 05-B 구현 내용과 명세 대비 차이 (SRCH-01)

구현: `apps/api/src/modules/projects/projectSearch.js`(쿼리 검사·조건·정렬), `project.service.js`(`searchProjects`), `projectStatus.js`(`effectiveStatus`·`publicStatusWhere`), `apps/api/src/utils/like.js`. 화면: `apps/web/src/pages/ProjectSearchPage.jsx`, `components/project/ProjectSearchFilters.jsx`·`ProjectCard.jsx`, `lib/projectSearch.js`. 테스트: `apps/api/test/project-search.unit.test.js`(단위), `apps/api/test/db/project-search.integration.test.js`(실제 테스트 DB), `apps/web/src/app/projectSearch.test.jsx`(화면). 스키마 변경(마이그레이션)·인덱스 추가 없음(EXPLAIN 결과는 DECISIONS §4.8 #4).

| # | 항목 | 명세 | 구현 | 근거 |
|---|---|---|---|---|
| 1 | 공개 범위 | 삭제·취소 제외 | `deleted_at IS NULL` + `status <> CANCELLED`. 항목은 `ProjectSummary` + `descriptionPreview`(공백 정리, 120자 + "…")뿐. `clientId`·의뢰인 정보·7개 상태 `status`·`availableActions`·`idempotencyKey`는 넣지 않음 | A-26, 개인정보 |
| 2 | 상태 보정 | 조회 직전 보정(D-08) | **조회는 DB에 쓰지 않는다.** 응답 `publicStatus`와 `status` 필터는 저장된 상태와 KST 오늘 날짜로 계산(마감일 지남 → `CLOSED`, 시작일 도래한 `SCHEDULED` → `RECRUITING`). 상세(PRJ-02)·내 목록(PRJ-05)도 같은 방식으로 바꿈. 저장 상태는 수정·삭제(행 잠금) 때 맞춤 | D-83(제안) |
| 3 | `q` | 제목·설명 부분 일치 | 앞뒤 공백 제거, 공백으로 단어를 나눠 **모든 단어**가 제목 또는 설명에 있어야 함(대소문자 무시). 100자·5단어 초과 400. `%`·`_`·`\`는 글자 그대로 찾음(LIKE 이스케이프). SQL은 Prisma 매개변수로만 전달 | D-85(제안) |
| 4 | `category` | enum | D-59 7개 값만. 그 밖은 400 | |
| 5 | `budgetMin`·`budgetMax` | 원 | 0 이상 정수 문자열, bigint 최대 이하(그 이상 400). 경계 포함(`gte`·`lte`). 최소 > 최대 400(`fields.budgetMax`). Number로 바꾸지 않음 | D-51 |
| 6 | `techStackIds` | 하나라도 포함(OR) | 쉼표로 구분한 ID(1~2147483647), 중복 제거, 최대 20개(초과 400). 없는 ID는 오류가 아니라 결과 0건 | 공유 링크의 오래된 ID |
| 7 | `deadline` | 이 날짜까지 마감 | `recruit_end_date <= deadline`(KST 날짜, 당일 포함). 실제 없는 날짜 400 | D-32, D-41 |
| 8 | `status` | 3개 공개 상태 | `SCHEDULED`·`RECRUITING`·`CLOSED`(거래 단계 포함)만. 7개 내부 상태 값은 400 | A-26 |
| 9 | 필터 조합 | 미정 | 서로 다른 필터는 AND, 기술 스택끼리는 OR, 검색어 단어끼리는 AND | A-21 |
| 10 | `sort` | `latest`·`deadline`·`budget` | 그 밖은 400. 같은 값이면 최신 등록순, 그래도 같으면 `id` 내림차순(페이지가 바뀌어도 순서 고정). **마감임박순**은 아직 모집 중·예정인 프로젝트를 마감일 가까운 순으로 먼저, 마감된 프로젝트는 그 뒤에 최근 마감순 | D-33, D-84(제안) |
| 11 | `page`·`pagination` | 10개 고정 | `page` 1~100,000(그 밖 400). `pagination: { page, pageSize: 10, totalCount, totalPages }`. 범위를 넘는 페이지는 400이 아니라 200 + 빈 `data`(화면은 "마지막 페이지로" 안내). 결과 0건이면 `totalPages: 0` | 뒤로 가기·공유 링크로 오는 경우 |
| 12 | 개수와 목록 일치 | 미정 | `count`와 `findMany`를 같은 조건으로 REPEATABLE READ 트랜잭션 하나에서 읽음 | 동시 등록·삭제 중 개수 불일치 방지 |
| 13 | 쿼리 형식 | 미정 | 같은 이름을 여러 번 보내면 400. 알 수 없는 쿼리 이름은 무시. 오류는 400 `VALIDATION_ERROR` + `details.fields` | |
| 14 | 응답 캐시 | 없음 | `Cache-Control: no-store`(라우터 공통) | 상태가 날짜에 따라 바뀜 |
| 15 | PROF-06 `ids` | 없음 | `GET /tech-stacks?ids=1,5`(최대 20개)로 이름을 돌려줌. 주소에서 복원한 기술 스택 칩 이름 표시용. `q` 검색도 `%`·`_`를 글자로 찾도록 수정 | |

- 화면 `/projects`(비로그인 가능): 검색어(300ms 지연), 카테고리·예산(500ms 지연)·기술 스택·마감일·모집 상태 필터, 정렬, 총 개수, 카드, 페이지 번호, 조건 초기화, 불러오는 중·오류(다시 시도)·빈 결과·범위 밖 페이지 안내. 모든 조건은 주소 쿼리에 있어 새로고침·뒤로 가기·공유 링크에서 복원된다. 조건이 바뀌면 1페이지로 돌아간다. 768px 이하에서는 필터를 "필터 펼치기" 버튼으로 접는다.
- TanStack Query 키는 정규화한 조건(`['project-search', criteria]`)이라 늦게 도착한 이전 응답이 현재 결과를 덮지 않는다. 화면이 다시 그려지기 전에 조건이 연달아 바뀌어도(입력 지연 타이머와 클릭 등) 앞선 변경을 잃지 않는다.
- 지원·북마크·계약·결제 버튼은 카드·상세에 없다(해당 기능 단계에서 추가). **STEP 06-A 변경:** 상세에 지원 영역 추가(§7.1). **STEP 07-A 변경:** 상세에 북마크 버튼(§11.1)과 하단 추천 영역(§6.2) 추가. 검색 카드에는 아직 북마크 표시가 없다.

**SRCH-02 추천 프로젝트**
- 응답 200: `{ data: ProjectSummary[] }` (최대 4개, 같은 카테고리 + 기술 스택 겹침 순, 모집 중만, 자기 자신 제외. D-30 제안)

### 6.2 STEP 07-A 구현 내용과 명세 대비 차이 (SRCH-02)

구현: `apps/api/src/modules/projects/projectRecommendations.js`(순위 SQL), `project.service.js`(`recommendProjects`), `projects.router.js`. 화면: `apps/web/src/components/project/RecommendedProjects.jsx`(상세 하단), `ProjectCard.jsx`(`note`). 테스트: `apps/api/test/bookmark.unit.test.js`, `apps/api/test/db/bookmarks.integration.test.js`, `apps/web/src/app/bookmarks.test.jsx`. 새 테이블·인덱스 없음.

| # | 항목 | 명세 | 구현 | 근거 |
|---|---|---|---|---|
| 1 | 후보 | 같은 카테고리 + 기술 겹침, 모집 중, 자기 제외 | 공개 범위(삭제·취소 제외) + 오늘(KST) 실제 모집 중(검색 `status=RECRUITING`과 같은 조건) + 자기 제외 + (같은 카테고리 **또는** 기술 스택 1개 이상 겹침) | D-105(제안) |
| 2 | 순위 | 겹침 순 | 같은 카테고리 → 겹치는 기술 스택 수 → 최근 등록 → `id` 내림차순. 무작위 없음(같은 데이터면 같은 순서) | D-105 |
| 3 | 개수 | 최대 4 | 최대 4. 후보가 적으면 그만큼, 없으면 `{ data: [] }` | |
| 4 | 응답 항목 | `ProjectSummary` | 검색 카드와 같은 공개 요약(`descriptionPreview` 포함) + `match: { sameCategory, sharedTechStackCount }`. 의뢰인 정보·7개 상태·`isBookmarked`·개인 정보 없음. 금액은 문자열 | A-26, D-51 |
| 5 | 기준 프로젝트 | 미정 | 삭제·취소·없음·잘못된 ID → 404 `NOT_FOUND`. 마감된 프로젝트는 200(상세가 공개이므로) | 상세 공개 범위 |
| 6 | 로그인 | 공개 | 토큰을 보지 않는다. 누구에게나 같은 결과 | D-105 |
| 7 | DB 쓰기 | - | 없음. 상태는 날짜로 계산만 한다(D-83). 순위와 본문은 같은 REPEATABLE READ 스냅샷에서 읽는다 | D-83 |
| 8 | 응답 캐시 | - | `Cache-Control: no-store`(라우터 공통). 화면 TanStack Query 키 `['project-recommendations', id]`, 30초 신선 | |

- 화면: 상세 맨 아래 "이 프로젝트와 비슷한 모집 중 프로젝트" 영역. 카드(검색 카드 재사용)에 추천 이유("같은 카테고리 · 기술 스택 2개 일치")를 덧붙인다. 불러오는 중·오류(다시 시도)·빈 결과("지금은 비슷한 조건으로 모집 중인 프로젝트가 없습니다." + 프로젝트 찾기)·404(영역 숨김). 카드를 눌러 다른 상세로 가면 맨 위로 스크롤한다. 480px 이하에서는 한 줄에 카드 하나.

**SRCH-03 옵션 목록**
- 응답 200: `{ data: { projectCategories[], businessFields[], reviewTags: { forFreelancer[], forClient[] } } }` (값 목록은 D-59, D-20)

---

## 7. 지원서 제출 및 관리 (APP)

| ID | Method | URL | 권한 | 요구사항 | 상태 |
|---|---|---|---|---|---|
| APP-01 | POST | `/projects/:projectId/applications` | FREELANCER +프로필 | A-29, A-36① | 구현 (STEP 06-A, 알림 ①은 06-C) |
| APP-02 | GET | `/projects/:projectId/applications` | 프로젝트 소유자 | A-31 | 구현 (STEP 06-B) |
| APP-03 | GET | `/applications/:applicationId` | 작성자 또는 프로젝트 소유자 | A-31, A-35 | 구현 (STEP 06-A 작성자, 06-B 소유자) |
| APP-04 | GET | `/me/applications` | FREELANCER | A-30, A-35 | 구현 (STEP 06-A) |

**APP-01 지원서 제출**
- 요청: `{ coverLetter, proposedAmount: "2500000", proposedDurationDays: 30 }`
- 처리: 프로젝트가 `RECRUITING`인지 확인(D-34) → 지원 생성 → 의뢰인 알림 ① (한 트랜잭션)
- 응답 201: `{ data: Application }` → FE는 내 지원 현황으로 이동(A-30)
- 오류: 400, 403 `FORBIDDEN`(의뢰인), 403 `PROFILE_INCOMPLETE`, 404, 409 `ALREADY_APPLIED`, 409 `INVALID_STATE_TRANSITION`(모집 중 아님)

**APP-02 지원자 목록**
- 쿼리: `status`(선택), `page`
- 응답 200: `{ data: Application[], pagination }` (지원자 공개 프로필 요약 포함)
- 오류: 403, 404

**APP-03 지원서 단건**
- 응답 200: `{ data: Application }`. 오류: 404(권한 없음 포함)

**APP-04 내 지원 현황**
- 쿼리: `status`(선택), `page`
- 응답 200: 목록. 각 항목에 지원 결과(검토중·수락·거절), 거절 사유, 제안 금액·제안 상태, 계약 ID(있으면) 포함. 삭제된 프로젝트의 지원도 남는다(A-35)

### 7.1 STEP 06-A 구현 내용과 명세 대비 차이 (APP-01, APP-03 일부, APP-04)

구현: `apps/api/src/modules/applications/`(`application.validation.js`, `application.service.js`, `applications.router.js`), `projects/project.service.js`(PRJ-02 `myApplication`·`applicantCount`, D-06·D-07). 화면: `apps/web/src/components/application/ApplyPanel.jsx`(상세의 지원 영역), `pages/MyApplicationsPage.jsx`(`/me/applications`). 테스트: `apps/api/test/application.unit.test.js`(단위), `apps/api/test/db/applications.integration.test.js`(실제 테스트 DB), `apps/web/src/app/applicationFlow.test.jsx`(화면). 마이그레이션 1개(ERD_v1 §7.6).

| # | 항목 | 명세 | 구현 | 근거 |
|---|---|---|---|---|
| 1 | APP-01 요청 | `{ coverLetter, proposedAmount, proposedDurationDays }` | 같음. 세 항목 모두 필수. 자기소개 1~2,000자(앞뒤 공백 제거), 예상 단가 1~bigint 최대(문자열 권장), 기간 1~3,650일 정수. `freelancerId`·`projectId`·`status`·`rejectReason`·`decidedAt`을 보내면 400(지원자는 토큰의 사용자) | D-90 |
| 2 | APP-01 확인 순서 | `FREELANCER +프로필` | 로그인 401 → 역할 `ROLE_REQUIRED` → 프리랜서 403 `FORBIDDEN` → 프로필 403 `PROFILE_INCOMPLETE` + `missingFields` → 프로젝트 404(없음·삭제·취소) → 모집 상태 409 → 중복 409 → 입력 400 | D-78, D-91 |
| 3 | APP-01 모집 상태 | `RECRUITING`인지 확인(D-34) | 저장값이 아니라 `effectiveStatus`(D-83)로 판단. 마감일 당일 KST 23:59:59.999까지 가능, 다음 날 00:00부터 409 `INVALID_STATE_TRANSITION`. `details.currentStatus`는 공개 상태(`SCHEDULED`·`CLOSED`)만. 저장값 `RECRUITING`이어도 마감일이 지났으면 거부(cron 여부와 무관). 요청은 DB의 프로젝트 상태를 바꾸지 않음 | D-34, D-83, D-91 |
| 4 | APP-01 중복 | 409 `ALREADY_APPLIED` | 같음 + `details.applicationId`. 동시 요청 5건 → 201 1건 + 409 4건(UNIQUE 위반 P2002 변환) | ERD_v1 §5 #1 |
| 5 | APP-01 동시성 | 미정 | 프로젝트 행 `FOR SHARE` 잠금 트랜잭션. 수정·삭제·(이후)수락·마감은 `FOR UPDATE`라 서로 기다린 뒤 최신 상태로 판단. 삭제·계약 단계 전환과 동시에 들어온 지원은 404/409 | D-91 |
| 6 | APP-01 알림 ① | 지원 생성과 한 트랜잭션 | **미구현.** `notifications` 테이블이 없음. 06-C에서 같은 트랜잭션 안에 추가(코드에 위치 표시). 이전 지원에 소급 생성하지 않음 | D-94 |
| 7 | `Application` 응답 | `id, projectId, project, freelancer, coverLetter, proposedAmount, proposedDurationDays, status, rejectReason, offerAmount, offerStatus, contractId?, createdAt` | `id, projectId, project{ id, title, category, budget, recruitStartDate, recruitEndDate, publicStatus, isDeleted }, coverLetter, proposedAmount, proposedDurationDays, status, rejectReason, decidedAt, createdAt, updatedAt`. `freelancer`는 본인이라 생략(APP-02에서 추가), `offer*`·`contractId`는 수락·계약 단계. 의뢰인 정보·이메일·`freelancerId` 없음. 삭제된 프로젝트는 `isDeleted: true`, `publicStatus: CLOSED` | D-93 |
| 8 | APP-03 | 작성자 또는 소유자 | **작성자만.** 남의 지원·의뢰인(소유자 포함)·형식 오류는 모두 404. STEP 06-B에서 소유자 응답 추가(§8.1 #3) | D-93, §1.3 |
| 9 | APP-04 쿼리 | `status`, `page` | 같음. `status`는 `PENDING`·`ACCEPTED`·`REJECTED`(그 밖 400), `page` 1부터, 10개씩 최신 지원순. 범위 밖 페이지는 200 + 빈 목록. 개수와 목록은 REPEATABLE READ 한 스냅샷. 의뢰인 403 `FORBIDDEN` | PRJ-05와 같은 규칙 |
| 10 | PRJ-02 | `myApplication?` | 로그인한 프리랜서에게만 `myApplication: { id, status, rejectReason, createdAt } \| null`. 비로그인·의뢰인에게는 키가 없음. `applicantCount`는 결과와 무관한 전체 지원 수. 취소된 프로젝트는 소유자와 그 지원자만 200 | D-93 |
| 11 | PRJ-03 | 409 `FIELD_LOCKED`(D-06) | 대기·수락 지원이 있으면 예산·마감일을 바꾸면 409 `FIELD_LOCKED`(같은 값은 허용). 소유자 응답의 `lockedFields`에 `budget`·`recruitEndDate` 추가 | D-06, D-92 |
| 12 | PRJ-04 | 대기 지원 `REJECTED(PROJECT_DELETED)` | 같음. 삭제와 같은 트랜잭션에서 `decided_at` 기록. 지원자의 내 지원 현황에는 남음 | D-07, D-92 |
| 13 | 철회 | 없음(D-35) | 철회 API·버튼 없음. 확인 화면에서 "수정·철회할 수 없다"고 안내 | D-35 |
| 14 | 응답 캐시 | 없음 | 지원 API 모두 `Cache-Control: no-store` | 사용자별 응답 |

- 화면: 상세(`/projects/:id`)의 "프로젝트 지원" 영역. 비로그인은 "로그인하고 지원하기"(로그인 후 같은 상세로 복귀), 의뢰인·소유자에게는 지원 영역이 없음, 프로필 미완성 프리랜서는 남은 항목과 `/me?returnTo=/projects/:id` 링크, 모집 예정·마감은 안내만, 이미 지원했으면 지원 상태와 내 지원 현황 링크. 입력 → 확인 → "지원 확정" 순서이고 요청 중에는 버튼이 잠긴다. 서버 성공 응답을 받은 뒤에만 `/me/applications`로 이동해 성공 안내를 띄운다(A-30).
- 화면 `/me/applications`(로그인 필요, 프리랜서 전용): 지원 상태·프로젝트 공개 상태 배지, 지원일, 프로젝트 제목(상세 링크, 삭제된 프로젝트는 링크 없음), 예산·모집 기간, 내 제안 금액·기간, 거절 사유, 제출한 자기소개 펼쳐 보기. 불러오는 중·오류(다시 시도)·빈 목록(프로젝트 찾기 링크)·페이지 이동. 헤더에 프리랜서용 "내 지원 현황" 메뉴.

---

## 8. 지원자 수락·거절 (DEC)

| ID | Method | URL | 권한 | 요구사항 | 상태 |
|---|---|---|---|---|---|
| DEC-01 | POST | `/applications/:applicationId/accept` | 프로젝트 소유자 | A-25, A-32, A-33, A-36②③, B-04 | 구현 (STEP 06-B 선정·자동 거절. 합의 금액 제시는 계약 단계, 알림 ②③은 06-C) |
| DEC-02 | POST | `/applications/:applicationId/reject` | 프로젝트 소유자 | A-32, A-36④ | 구현 (STEP 06-B, 알림 ④는 06-C) |

**DEC-01 지원 수락 + 합의 금액 제시**
- 요청: `{ "offerAmount": "2800000" }` (기본값은 지원서의 예상 단가, D-12 제안)
- 처리(한 트랜잭션, D-54):
  1. 프로젝트 행 잠금 → `RECRUITING` 확인
  2. 대상 지원 `PENDING` 확인 → `ACCEPTED`, `offer_status = PENDING`
  3. 같은 프로젝트의 나머지 `PENDING` → `REJECTED(OTHER_ACCEPTED)`
  4. 프로젝트 → `CONTRACTING`, `closed_at` 기록
  5. 알림 ②(수락된 프리랜서), ③(자동 거절된 프리랜서 각각) 생성
- 응답 200: `{ data: { application, autoRejectedCount } }`
- 오류: 400, 403, 404, 409 `INVALID_STATE_TRANSITION`(이미 처리된 지원, 모집 중 아님, 동시 수락 경합)

**DEC-02 지원 거절**
- 요청: 본문 없음 → 처리: `PENDING` → `REJECTED(MANUAL)` + 알림 ④ (한 트랜잭션)
- 응답 200: `{ data: Application }`
- 오류: 403, 404, 409 `INVALID_STATE_TRANSITION`

### 8.1 STEP 06-B 구현 내용과 명세 대비 차이 (APP-02, APP-03 소유자, DEC-01·02)

구현: `apps/api/src/modules/applications/`(`application.service.js`의 `listForOwner`·`getForViewer`·`accept`·`reject`, `application.validation.js`의 `parseDecisionBody`, `applications.router.js`). 화면: `apps/web/src/components/application/ApplicantsPanel.jsx`(프로젝트 상세의 "지원자 관리"), `pages/MyProjectsPage.jsx`("지원자 N명 관리" 링크), `pages/MyApplicationsPage.jsx`·`components/application/ApplyPanel.jsx`(프리랜서 결과 표시). 테스트: `apps/api/test/application.unit.test.js`, `apps/api/test/db/applicationDecisions.integration.test.js`(실제 PostgreSQL 동시성 포함), `apps/web/src/app/applicantManagement.test.jsx`, `applicationFlow.test.jsx`. 마이그레이션 1개(ERD_v1 §7.7). 모든 항목은 제안(D-95~D-98)이며 확정되지 않았다.

| # | 항목 | 명세 | 구현 | 근거 |
|---|---|---|---|---|
| 1 | APP-02 권한 | 프로젝트 소유자 | 로그인 401 → 역할 `ROLE_REQUIRED` → 프리랜서 403 `FORBIDDEN` → 프로젝트 없음·삭제 404 → 남의 프로젝트 403 `FORBIDDEN`(남의 **취소된** 프로젝트는 PRJ-02처럼 404). 취소된 내 프로젝트는 읽기만 가능 | D-96, §1.3 |
| 2 | APP-02 응답 | `{ data: Application[], pagination }` | 같음 + `counts: { total, PENDING, ACCEPTED, REJECTED }`(필터와 무관한 프로젝트 전체 개수). 항목은 §7.1 #7의 `Application` + `freelancer`(PublicUser, 이메일·희망 단가 없음) + `availableActions`(`ACCEPT`·`REJECT` 또는 빈 배열). 10개씩, 최신 지원순 + `id` 내림차순(같은 시각도 순서 고정). 개수와 목록은 REPEATABLE READ 한 스냅샷. `status` 오류 400, 범위 밖 페이지 200 + 빈 목록 | D-96 |
| 3 | APP-03 소유자 | 작성자 또는 소유자 | 작성자는 §7.1과 같은 응답, 소유자는 APP-02 항목과 같은 응답. 남의 프로젝트 의뢰인·다른 프리랜서·삭제된 프로젝트(소유자)는 404 | D-93, D-96 |
| 4 | DEC 요청 본문 | DEC-01 `{ offerAmount }`(D-12) | **본문 없음.** `offerAmount`를 보내면 400 `VALIDATION_ERROR`("합의 금액 제시는 계약 단계에서 제공합니다."), 그 밖의 키도 400. 지원서의 `proposedAmount`는 계약 금액이 아니며 이번 단계에서 금액을 확정하지 않는다. `offer_*` 열은 아직 없다 | D-97, D-11, D-12 |
| 5 | DEC 확인 순서 | 미정 | 로그인 401 → 역할 → 의뢰인 403 `FORBIDDEN` → 소유자(아니면 404, 존재를 숨김) → 프로젝트 유효(삭제 404) → 선정 가능 상태 409 → 지원이 그 프로젝트 소속(404) → `PENDING` 409 → (선정) 기존 선정 없음 409 → 본문 400 | D-95 |
| 6 | 선정 가능 상태 | `RECRUITING` 확인 | 저장값이 아니라 `effectiveStatus`(D-83)가 `RECRUITING`일 때만. 마감일 당일 KST 23:59:59.999까지 가능, 다음 날 00:00부터 409. 저장값 `SCHEDULED`라도 시작일이 지났으면 가능. 마감 후 대기 지원은 06-C의 일괄 거절(A-34)에서 처리 | D-34(사용자가 RFP안 선택, 제안 유지), D-95 |
| 7 | 409 `details` | `currentStatus` | 소유자에게만 보내는 오류라 내부 상태를 그대로 준다: 프로젝트 상태 문제는 `projectStatus`(`CANCELLED`·`CONTRACTING`·`IN_PROGRESS`·`COMPLETED`·`SCHEDULED`·`CLOSED`), 지원 상태 문제는 `applicationStatus`(`ACCEPTED`·`REJECTED`), 기존 선정은 `acceptedApplicationId` | D-95 |
| 8 | DEC-01 처리 | 프로젝트 잠금 → 대상 `ACCEPTED` → 나머지 `REJECTED(OTHER_ACCEPTED)` → `CONTRACTING`·`closed_at` → 알림 | 같은 순서, 한 트랜잭션. 조건부 갱신(`WHERE status = 'PENDING'`)이라 이미 거절된 지원의 사유·`decided_at`은 바뀌지 않는다. `offer_status`는 없음(#4). 알림 ②③은 STEP 06-C에서 `afterDecision` 훅 기본값으로 구현(§10.1) | D-54, D-98 |
| 9 | DEC-01 응답 | `{ data: { application, autoRejectedCount } }` | 같음. `application`은 소유자용 응답(#2 항목) | - |
| 10 | DEC-02 처리 | `PENDING` → `REJECTED(MANUAL)` + 알림 ④ | 같음. 사유 입력은 받지 않는다(D-49 `MANUAL` 고정). 다른 지원과 프로젝트 상태는 바꾸지 않는다. 선정된 지원 거절 409, 같은 지원 다시 거절 409. 알림 ④는 STEP 06-C에서 구현(§10.1) | D-49, D-98 |
| 11 | 동시성 | "동시 수락 경합 409" | 프로젝트 행 `FOR UPDATE` 후 판단. 같은 프로젝트의 두 지원 동시 선정 → 200 1건 + 409 1건, 5건 동시 → 선정 1·거절 4. 선정과 지원(APP-01 `FOR SHARE`)이 겹치면 대기 지원이 남지 않는다. 잠금을 거치지 않는 쓰기가 생겨도 부분 UNIQUE 인덱스(프로젝트당 `ACCEPTED` 1건)가 막고, 위반(P2002)은 409로 바꾼다 | D-54, ERD_v1 §7.7 |
| 12 | 선정 후 | A-25 `CONTRACTING` | 새 지원 409, 다른 지원 선정·거절 409, 예산·마감일 등 수정 409 `FIELD_LOCKED`, 삭제 409, 공개 상태 `CLOSED`(검색·상세). 프로젝트 저장 상태는 `CONTRACTING`만 사용(새 상태 없음) | A-25, A-26, D-03 |
| 13 | 응답 캐시·GET | - | 모든 API `Cache-Control: no-store`. APP-02·APP-03은 DB를 바꾸지 않는다(D-83) | D-83 |

- 화면: 프로젝트 상세(`/projects/:id`)의 "지원자 관리"(소유자에게만, `#applicants`로 바로 이동). 총 지원자·상태별 개수, 상태 필터(전체·검토 대기·선정됨·거절됨), 지원자 카드(공개 프로필 링크, 상태 배지와 소유자용 처리 사유, 경력·기술, 제안 금액·예상 기간·지원일·처리일, 자기소개 펼쳐 보기), "제안 금액은 … 최종 계약 금액이 아닙니다" 안내, 10개씩 페이지 이동. 버튼은 `availableActions`로만 그린다.
- 선정·거절은 확인 단계를 거친다. 선정 확인에는 "이 지원자를 선정하면 다른 대기 지원은 자동으로 거절됩니다."와 지금 대기 중인 다른 지원 수를 보여 준다. 요청 중에는 모든 처리 버튼이 잠기고(더블 클릭 방지), 서버 200을 받은 뒤에만 "○○님을 선정했습니다. 다른 대기 지원 N건은 자동으로 거절되었습니다."를 띄운다. 성공·실패 모두 목록·상세·내 프로젝트·검색 캐시를 새로 받아 새로고침해도 서버 결과가 그대로 보인다.
- 내 프로젝트 목록 각 항목에 "지원자 N명 관리" 링크.

---

## 9. 프로젝트 상태 관리 (STAT)

| ID | Method | URL | 권한 | 요구사항 | 상태 |
|---|---|---|---|---|---|
| STAT-01 | POST | `/projects/:projectId/close` | 소유자 | A-24, A-34, A-36⑤ | 구현(STEP 06-C, §9.1) |
| STAT-02 | POST | `/projects/:projectId/cancel` | 소유자 | A-27, D-13 | 구현(STEP 07-B, §9.2) |
| STAT-03 | POST | `/internal/jobs/sync-project-status` | 내부 키(헤더 `X-Job-Secret`) | A-24, A-34, D-08 | 미구현(선택). 같은 작업을 서버 내부 주기 실행과 CLI 스크립트로 제공(§9.1 #6~7). 07-B 판단: 기본 필수에는 CLI로 충분(§9.2 #12) |

**STAT-01 수동 모집 마감**
- 처리(한 트랜잭션): `RECRUITING` → `CLOSED`, 대기 지원 일괄 `REJECTED(PROJECT_CLOSED)`, 지원자 전원 알림 ⑤
- 응답 200: `{ data: { project, rejectedCount } }`
- 오류: 403, 404, 409 `INVALID_STATE_TRANSITION`

**STAT-02 프로젝트 취소**
- 허용: `SCHEDULED`, `RECRUITING`, `CLOSED`, `CONTRACTING`(단, 계약이 `SIGNED` 이전, 즉 체결 전)
- 처리(한 트랜잭션): 프로젝트 `CANCELLED`, 대기 지원·제안 중 지원 `REJECTED(PROJECT_CANCELLED)`, 서명 전 계약 `CANCELLED`
- 응답 200: `{ data: ProjectDetail }`
- 오류: 403, 404, 409 `INVALID_STATE_TRANSITION`(계약 체결 후: "정상 완료 또는 환불 흐름을 거쳐야 합니다")

**STAT-03 상태 자동 전환 실행** (외부 스케줄러용, 선택)
- 서버 내부 cron과 같은 함수를 호출한다. 무료 서버가 잠들어 cron을 놓칠 때 GitHub Actions 등에서 호출
- 응답 200: `{ data: { started, closed, rejectedApplications } }`. 같은 시점에 두 번 호출해도 결과가 같다
- 오류: 401(키 불일치)

### 9.1 STEP 06-C 구현 내용과 명세 대비 차이 (STAT-01, 자동 마감)

구현: `apps/api/src/modules/projects/projectClosure.js`(`closeLockedProject`·`syncLockedProject`·`runRecruitStatusSync`), `project.service.js`의 `closeProject`, `projects.router.js`, `apps/api/src/jobs/recruitStatusScheduler.js`, `apps/api/scripts/sync-project-status.js`. 화면: `apps/web/src/components/project/CloseRecruitControl.jsx`(내 프로젝트 목록·프로젝트 상세 "프로젝트 관리"). 테스트: `apps/api/test/db/notifications.integration.test.js`, `apps/api/test/notification.unit.test.js`, `apps/web/src/app/notifications.test.jsx`. 새 결정은 모두 제안(D-99~D-104)이다.

| # | 항목 | 명세 | 구현 | 근거 |
|---|---|---|---|---|
| 1 | STAT-01 확인 순서 | 403, 404, 409 | 로그인 401 → 역할 `ROLE_REQUIRED` → 의뢰인 403 `FORBIDDEN` → 없음·삭제 404 → 남의 프로젝트 403 → 실제 상태(`effectiveStatus`)가 `RECRUITING`이 아니면 409 `INVALID_STATE_TRANSITION`(`details.currentStatus`). 문구: 모집 예정 "모집이 시작되지 않은 프로젝트는 마감할 수 없습니다.", 이미 마감(저장값 또는 마감일 경과) "이미 모집이 마감된 프로젝트입니다.", 계약 단계 "이미 지원자를 선정한 프로젝트는 모집을 마감할 수 없습니다.", 취소 "취소된 프로젝트는 마감할 수 없습니다." 본문은 쓰지 않는다 | PRJ-03·04와 같은 소유자 규칙, D-100 |
| 2 | STAT-01 처리 | 한 트랜잭션 | 프로젝트 행 `FOR UPDATE` → 확인 → `CLOSED` + `closed_at` → `PENDING` 지원 전부 `REJECTED(PROJECT_CLOSED)` + `decided_at`(= `closed_at`) → 지원자 전원 알림 ⑤. 이미 `REJECTED`인 지원은 사유·시각을 바꾸지 않고 알림만 받는다. `ACCEPTED`는 있을 수 없고(선정 시 `CONTRACTING`) 조건에도 걸리지 않는다. 지원자 0명도 200. 알림 저장이 실패하면 전체 롤백 | A-24, A-34, D-94, D-101 |
| 3 | STAT-01 응답 | `{ project, rejectedCount }` | `{ data: { project(소유자용 ProjectDetail), rejectedCount, notifiedCount } }`. 같은 요청을 다시 보내면 409("이미 마감")라 알림이 중복되지 않는다 | - |
| 4 | 소유자 `availableActions` | - | 실제 상태가 `RECRUITING`이면 `CLOSE`를 추가한다(`['EDIT','DELETE','CLOSE']`). 모집 예정·마감·계약 단계·취소에는 없다 | D-100 |
| 5 | 자동 마감 처리 | cron + STAT-03 | 프로젝트마다 별도 트랜잭션: `FOR UPDATE` → 다시 판단 → 시작일 도래 `SCHEDULED → RECRUITING`, 마감일 경과 `SCHEDULED/RECRUITING → CLOSED` + #2와 같은 일괄 거절·알림 ⑤(문구만 "모집 기간이 끝나"). 06-C 이전에 `CLOSED`로만 저장되고 대기 지원이 남은 프로젝트도 같은 방식으로 정리(`closed_at`은 그대로). 계약 단계·취소·삭제 프로젝트는 대상이 아니다. 한 프로젝트가 실패하면 그 프로젝트만 롤백되고 다음 실행에서 다시 시도 | A-24, A-34, D-36, D-94 |
| 6 | 실행 방식 | 서버 내부 cron(D-08 node-cron) + STAT-03 | 새 의존성 없이 API 프로세스 안에서 **시작 직후 1회(재시작 따라잡기) + `RECRUIT_SYNC_INTERVAL_MS`마다(기본 60초, `0`이면 끔, 5초~24시간)**. 이전 실행이 끝나지 않았으면 그 차례는 건너뛴다. 바뀐 것이 있거나 실패했을 때만 로그 | D-99 |
| 7 | 외부 실행 | STAT-03 HTTP | HTTP 엔드포인트 대신 CLI `npm run job:sync-project-status -w apps/api`(`--target=test` 가능). 결과 JSON 출력, 실패 프로젝트가 있으면 종료 코드 1. 배포 시 플랫폼 예약 작업·cron이 이 명령을 부르게 한다. **운영 스케줄러는 아직 설치되지 않았다** | D-99 |
| 8 | 날짜 경계 | KST | 마감일 당일 23:59:59.999(KST)까지 모집 중, 다음 날 00:00(KST)부터 마감. 시작일 00:00(KST)부터 모집 중. 실제 반영은 경계 후 최대 한 주기 늦을 수 있으나, 그동안에도 조회·검색은 날짜로 계산한 상태를 보여 주고 새 지원·선정·거절은 409로 막는다 | D-41, D-83 |
| 9 | 동시성 | - | 지원(`FOR SHARE`)·선정·거절·수정·삭제·마감(`FOR UPDATE`)이 모두 프로젝트 행을 먼저 잠근다. 수동 마감 vs 새 지원: 대기 지원이 남지 않는다. 마감 vs 선정: 한쪽만 성공. 주기 작업 두 개 동시 실행·서버 여러 대: 프로젝트별 잠금 + 조건부 갱신 + 알림 `event_key` UNIQUE로 한 번만 반영 | D-54, D-102 |
| 10 | 수정·삭제 전 동기화 | - | PRJ-03·04가 행을 잠근 뒤 같은 동기화(#5)를 먼저 한다. 따라서 마감일이 지난 프로젝트를 삭제하면 대기 지원은 `PROJECT_DELETED`가 아니라 `PROJECT_CLOSED`(+ 알림 ⑤)가 된다. 요청이 실패하면 동기화도 롤백된다 | D-83, D-94 |

### 9.2 STEP 07-B 구현 내용과 명세 대비 차이 (STAT-02 프로젝트 취소)

구현: `apps/api/src/modules/projects/projectCancellation.js`(`cancelLockedProject`, 계약 확인 자리 `NO_CONTRACT_MODULE`), `project.service.js`의 `cancelProject`·`countApplications`·`ownerViewer`, `projects.router.js`, `projectStatus.js`의 `CANCELLABLE_STATUSES`. 화면: `apps/web/src/components/project/CancelProjectControl.jsx`(내 프로젝트 목록·프로젝트 상세 "프로젝트 관리"), 공통 확인 창 `components/ConfirmDialog.jsx`. 테스트: `apps/api/test/db/projectCancel.integration.test.js`(24), `apps/api/test/project.unit.test.js`의 `cancelLockedProject`, `apps/web/src/app/projectCancel.test.jsx`. **DB 변경 없음**(`CANCELLED` 상태·`cancelled_at`·`PROJECT_CANCELLED` 사유는 ERD_v1에 이미 있음). 새 결정은 모두 제안(D-109~D-114)이다.

| # | 항목 | 명세 | 구현 | 근거 |
|---|---|---|---|---|
| 1 | 확인 순서 | 403, 404, 409 | 로그인 401 → 역할 `ROLE_REQUIRED` → 의뢰인 403 `FORBIDDEN` → 없음·삭제 404 → 남의 프로젝트: 취소된 프로젝트면 404(취소된 프로젝트는 공개 범위 밖), 아니면 403 → 행 잠금 후 자동 마감 동기화 → 실제 상태 → 계약 확인 → 처리 | PRJ-03·04·STAT-01과 같은 소유자 규칙, D-109 |
| 2 | 허용 상태 | `SCHEDULED`·`RECRUITING`·`CLOSED`·`CONTRACTING`(체결 전) | 같음. `IN_PROGRESS`·`COMPLETED` 409 "계약이 체결된 프로젝트는 취소할 수 없습니다. 정상 완료 또는 환불 절차를 거쳐야 합니다."(`details.currentStatus`). 이미 취소 409 "이미 취소된 프로젝트입니다."(멱등 200이 아님, 중복 클릭은 한 번만 반영) | A-27, D-13, D-110 |
| 3 | 계약 확인 | 서명 전 계약 `CANCELLED` | 계약·전자서명 테이블이 아직 없다(STEP 10 예정). 서비스가 `contractPolicy { findBlockingContract, cancelOpenContracts }`를 주입받고, 지금 기본값은 "체결된 계약 없음·정리할 계약 0건"이다. **계약 데이터를 가정하거나 더미값을 만들지 않는다**: 지금 구조에서는 서명이 일어날 수 없어 `CONTRACTING`은 항상 체결 전이다. 계약 모듈을 만들 때 이 두 함수만 바꾸면 `SIGNED` 이후 409, 서명 전 계약 정리가 같은 트랜잭션에 들어간다(테스트에서 가짜 정책으로 409·롤백 확인) | D-13, D-110 |
| 4 | 지원 처리 | 대기·제안 중 지원 `REJECTED(PROJECT_CANCELLED)` | `PENDING` → `REJECTED(PROJECT_CANCELLED)` + `decided_at`(= `cancelled_at`). 이미 `REJECTED`인 지원은 사유·처리 시각을 바꾸지 않는다. **`ACCEPTED`(선정된 지원)는 그대로 둔다**: 선정 이력을 지우지 않고, 지원자 화면에서 "선정됐지만 프로젝트가 취소되어 계약이 진행되지 않습니다"로 보인다. 금액·기간·자기소개는 바꾸지 않는다. '제안 중' 상태는 아직 없다(B-04 금액 합의 미구현) | D-111 |
| 5 | 처리 | 한 트랜잭션 | 프로젝트 행 `FOR UPDATE` → `syncLockedProject`(마감일이 지났으면 먼저 `CLOSED` + `PROJECT_CLOSED` 거절 + 알림 ⑤, 수정·삭제와 같음) → 허용 상태 확인 → 계약 확인 → 대기 지원 거절 → 서명 전 계약 정리 → `CANCELLED` + `cancelled_at`. 어느 단계든 실패하면 전부 롤백 | D-102 |
| 6 | 알림 | - | **보내지 않는다.** 필수 5종에 취소 알림이 없고, 마감 알림 ⑤로 보내면 문구가 사실과 달라진다. 지원자는 내 지원 현황·상세에서 취소를 확인한다. 별도 취소 알림은 선택 기능으로 제안만 한다 | A-36, D-112 |
| 7 | 응답 | `{ data: ProjectDetail }` | `{ data: { project(소유자용 ProjectDetail), rejectedCount, keptAcceptedCount } }` — 화면이 "검토 대기 지원 N건을 자동으로 거절했습니다"를 서버가 실제 처리한 숫자로 보여 준다 | STAT-01 응답과 같은 모양 |
| 8 | 소유자 필드 | - | `availableActions`에 `CANCEL`(허용 상태일 때). `pendingApplicantCount`(확인 창의 "검토 대기 N건" 안내), `cancelledAt`. 모든 보는 사람에게 `isCancelled`(취소된 프로젝트는 소유자·그 프로젝트 지원자만 상세를 볼 수 있고, 공개 상태는 계속 `CLOSED`) | D-109 |
| 9 | 지원 현황 | - | APP-04의 `project`에 `isCancelled` 추가. 화면은 공개 상태 대신 '취소' 배지와 "취소된 프로젝트" 표시 | A-35 |
| 10 | 취소 후 | - | 검색·추천·북마크 목록에서 제외(기존 `PUBLIC_PROJECT_WHERE`), 북마크 행은 남김(D-107). 새 지원·선정·거절·수정·삭제·마감 409/404. 자동 마감 작업·조회(GET)로 상태가 돌아가지 않음(작업 대상이 `SCHEDULED`·`RECRUITING`·`CLOSED`뿐, GET은 DB에 쓰지 않음) | D-83, D-107 |
| 11 | 동시성 | - | 취소도 프로젝트 행을 `FOR UPDATE`로 먼저 잠근다. 취소 vs 새 지원(`FOR SHARE`)·선정·직접 거절·수동 마감·자동 마감 작업: 한쪽이 먼저 끝나고 다른 쪽은 바뀐 상태를 보고 409(또는 취소가 남은 대기 지원을 거절). 취소 5건 동시: 1건만 200. 대기 지원이 남지 않는다(DB 테스트) | D-54, D-102 |
| 12 | STAT-03 필요성 | 선택 | 기본 필수(A-24)의 자동 전환은 서버 내부 주기 작업 + CLI로 동작한다. HTTP 엔드포인트는 서버가 잠드는 호스팅에서 외부 스케줄러가 깨울 때만 필요하므로 **배포 환경을 정할 때 다시 판단**한다(지금은 미구현 유지, 운영 스케줄러 미연결) | D-99, D-113 |

---

## 10. 알림 (NOTI)

| ID | Method | URL | 권한 | 요구사항 | 상태 |
|---|---|---|---|---|---|
| NOTI-01 | GET | `/notifications` | 로그인 | A-36, A-38 | 구현(STEP 06-C, §10.1) |
| NOTI-02 | GET | `/notifications/unread-count` | 로그인 | A-37 | 구현(STEP 06-C) |
| NOTI-03 | PATCH | `/notifications/:notificationId/read` | 수신자 | A-37 | 구현(STEP 06-C) |
| NOTI-04 | PATCH | `/notifications/read-all` | 로그인 | A-38 | 구현(STEP 06-C) |

- NOTI-01: 쿼리 `unreadOnly`(선택), `page` → `{ data: Notification[], pagination }`
- NOTI-02: `{ data: { count } }`. FE가 30초마다 호출(D-37 제안)
- NOTI-03: 응답 200 `{ data: Notification }`. 이미 읽은 알림이어도 200(멱등). 오류 404
- NOTI-04: 응답 200 `{ data: { updatedCount } }`

### 10.1 STEP 06-C 구현 내용과 명세 대비 차이 (NOTI-01~04, 알림 5종)

구현: `apps/api/src/modules/notifications/`(`notificationEvents.js` 문구·이동 경로·중복 키·저장, `notification.service.js`, `notifications.router.js`). 화면: `apps/web/src/components/NotificationBell.jsx`(머리글), `pages/NotificationsPage.jsx`(`/notifications`), `lib/notificationApi.js`, `lib/notificationLinks.js`. 마이그레이션 1개(ERD_v1 §7.8).

| # | 항목 | 명세 | 구현 | 근거 |
|---|---|---|---|---|
| 1 | 알림 5종과 연결 | A-36 ①~⑤ | ① 지원(APP-01) → 의뢰인, ② 선정(DEC-01) → 선정 프리랜서, ③ 다른 지원자 선정으로 자동 거절(DEC-01) → 각 프리랜서, ④ 직접 거절(DEC-02) → 해당 프리랜서, ⑤ 모집 마감(STAT-01 수동·자동) → 그 프로젝트 지원자 전원(대기였던 지원 + 이전에 거절된 지원). ①은 `afterApply`, ②③④는 06-B의 `afterDecision` 훅 기본값, ⑤는 `closeLockedProject`의 `afterClose`. 모두 상태 변경과 같은 트랜잭션이며 실제로 바뀐 지원에만 보낸다 | D-36, D-94, D-98 |
| 2 | 원자성 | - | 알림 저장 실패(DB 거부 포함) 시 지원·선정·자동 거절·직접 거절·마감·프로젝트 상태가 모두 롤백된다. 화면은 서버 200을 받은 뒤에만 결과를 보여 준다 | D-94 |
| 3 | 중복 방지 | - | `event_key` UNIQUE(`{TYPE}:application:{applicationId}`). 저장은 `ON CONFLICT DO NOTHING`. 같은 지원의 같은 유형 알림은 재시도·동시 실행에도 1건 | D-103 |
| 4 | `Notification` 객체 | `id, type, message, linkUrl, isRead, readAt, createdAt` | 같음 + `title`, `projectId`, `applicationId`. `linkUrl`은 허용 목록(`/projects/{id}`, `/projects/{id}#applicants`, `/me/applications`, `/me/projects`)을 통과한 값만, 아니면 `null`. 지원 내용·금액·이메일·토큰은 저장도 응답도 하지 않는다 | D-104 |
| 5 | 이동 경로 | D-36(② 계약서 상세) | ① `/projects/{id}#applicants`(지원자 관리), ②③④⑤ `/me/applications`. ②는 계약 화면이 아직 없어 내 지원 현황으로 보낸다(계약 단계에서 바꾼다) | D-36, D-104 |
| 6 | NOTI-01 | `unreadOnly`, `page` | 20개씩, `created_at DESC, id DESC`(같은 시각도 순서 고정). 응답에 `unreadCount`를 함께 준다. 개수·목록은 REPEATABLE READ 한 스냅샷. `unreadOnly`는 `true`/`false`만(그 밖 400), 잘못된 `page` 400. **조회는 읽음 처리하지 않는다** | D-83 |
| 7 | NOTI-03 | 수신자, 404 | 본인 알림만. 남의 알림·없는 알림·잘못된 ID 모두 404(존재를 숨김). 이미 읽은 알림은 처음 읽은 시각을 유지하고 200 | - |
| 8 | NOTI-04 | `{ updatedCount }` | 이번에 바뀐 개수(다시 보내면 0). 남의 알림은 바뀌지 않는다 | - |
| 9 | 권한 | 로그인 | 로그인 401 → 역할 `ROLE_REQUIRED`. 모든 응답 `Cache-Control: no-store` | §1.3 |
| 10 | 새로 고침 | 30초 폴링(D-37) | 머리글 개수를 30초마다와 창으로 돌아올 때 다시 받는다. 알림 화면 목록도 30초 폴링. WebSocket 없음 → 새 알림은 최대 약 30초 늦게 보인다. 캐시 키에 사용자 ID를 넣고 로그아웃 시 알림 캐시를 지운다 | D-37 |
| 11 | 보관 | - | 삭제·만료 없이 보관(읽음 여부와 관계없이). 정리 정책은 미정 | D-104 |

---

## 11. 북마크 (BMK)

| ID | Method | URL | 권한 | 요구사항 | 상태 |
|---|---|---|---|---|---|
| BMK-01 | PUT | `/projects/:projectId/bookmark` | FREELANCER(D-31) | A-39 | 구현 (STEP 07-A, §11.1) |
| BMK-02 | DELETE | `/projects/:projectId/bookmark` | FREELANCER | A-39 | 구현 (STEP 07-A, §11.1) |
| BMK-03 | GET | `/me/bookmarks` | FREELANCER | A-40 | 구현 (STEP 07-A, §11.1) |

- BMK-01: 응답 204. 이미 있어도 204. 오류 403, 404(삭제된 프로젝트)
- BMK-02: 응답 204. 없어도 204
- BMK-03: 쿼리 `page` → `{ data: ProjectSummary[], pagination }` (삭제된 프로젝트 제외)

### 11.1 STEP 07-A 구현 내용과 명세 대비 차이 (BMK-01~03, PRJ-02 `isBookmarked`)

구현: `apps/api/src/modules/bookmarks/`(`bookmark.service.js`, `bookmarks.router.js`, `/api` 바로 아래), `project.service.js`(`getProject`의 `isBookmarked`). 화면: `apps/web/src/components/project/BookmarkButton.jsx`(상세), `pages/MyBookmarksPage.jsx`(`/me/bookmarks`), `lib/bookmarkApi.js`, `components/Layout.jsx`(메뉴·로그아웃). 테이블은 ERD_v1 §7.9.

| # | 항목 | 명세 | 구현 | 근거 |
|---|---|---|---|---|
| 1 | 확인 순서 | 403 | 로그인(401) → 역할 선택(403 `ROLE_REQUIRED`) → 프리랜서(403 `FORBIDDEN`) → (추가만) 프로젝트 공개 범위(404). 프로필 완성은 요구하지 않음 | D-31, D-106(제안) |
| 2 | 추가 대상 | 삭제 404 | 삭제·**취소**·없음·잘못된 ID 404(상세와 같은 공개 범위). 마감·계약 단계 프로젝트는 저장 가능 | D-107(제안) |
| 3 | 멱등 | 이미 있어도 204 | `ON CONFLICT DO NOTHING`. 이미 있으면 저장 시각을 바꾸지 않는다. 동시 요청 6건도 1행(DB 테스트). 확인과 저장 사이 프로젝트 행 `FOR SHARE` 잠금 | D-107 |
| 4 | 해제 | 없어도 204 | 본인 행만 삭제. 프로젝트가 삭제됐어도 204. 응답 본문 없음 | D-107 |
| 5 | 목록 범위 | 삭제 제외 | 삭제 + 취소 제외(개수 포함). **행은 지우지 않는다** | D-107 |
| 6 | 목록 항목 | `ProjectSummary` | 검색 카드와 같은 공개 요약(`descriptionPreview` 포함) + `isBookmarked: true`, `bookmarkedAt`, `myApplication: { id, status } \| null`(본인 지원). 상태는 오늘(KST) 기준 공개 상태(마감일 지나면 `CLOSED`). 의뢰인 정보·7개 상태 없음 | D-108(제안) |
| 7 | 정렬·페이지 | `page` | 최근 저장순(`created_at DESC, project_id DESC`), 페이지당 10개, 개수와 목록은 같은 REPEATABLE READ 스냅샷. 범위 밖 페이지는 200 + 빈 `data`, `page` 형식 오류 400 | D-108 |
| 8 | PRJ-02 `isBookmarked` | 로그인한 프리랜서 | 로그인한 프리랜서(소유자가 아닌)에게만 `true`/`false`. 비로그인·의뢰인 응답에는 키 자체가 없다 | |
| 9 | 다른 사용자 | - | 사용자 ID를 받는 API가 없다(쿼리 `userId`는 무시). 목록·상세 모두 토큰의 사용자 기준 | |
| 10 | DB 쓰기 | - | GET(목록·상세·추천)은 쓰지 않는다. 쓰기는 PUT·DELETE의 `bookmarks` 행뿐(프로젝트·지원·알림 불변, DB 테스트) | D-83 |

- 상세 화면: 머리말 아래 북마크 버튼. 프리랜서는 "☆ 북마크하기"/"★ 북마크됨"(`aria-pressed`), 요청 중에는 "저장하는 중…"/"해제하는 중…"으로 잠긴다. 성공하면 상세 캐시를 바로 바꾸고 내 북마크 목록을 다시 받는다("내 북마크 보기" 링크). 실패하면 서버 메시지를 보여 주고 404면 상세를 다시 받는다. 비로그인은 "☆ 로그인하고 북마크하기"(로그인 후 같은 상세로 돌아옴). 의뢰인·소유자·역할 미선택에게는 없다. 지원 영역과는 따로 동작한다.
- 세션: 상세는 세션 복원이 끝난 뒤에만 요청하고(06-A와 같음) 캐시 키에 사용자 ID가 있어 다른 사용자의 북마크 상태가 보이지 않는다. 내 북마크 키는 `['bookmarks', userId, page]`. 로그아웃하면 `['bookmarks']`, `['my-applications']`, `['my-projects']`, 그 사용자의 상세 캐시를 지운다.
- 내 북마크 화면(`/me/bookmarks`, 로그인 필요, 프리랜서 메뉴 "내 북마크"): 카드마다 상태·카테고리·저장일·제목(상세 링크)·예산·마감일·기술 스택, 지원 안내(D-108), "북마크 해제". 불러오는 중·오류(다시 시도)·빈 목록(프로젝트 찾기)·페이지 이동. 의뢰인에게는 "프리랜서 전용 화면입니다"(API를 부르지 않음).
- 검색 목록(SRCH-01) 카드의 `isBookmarked`는 아직 없다(공개 응답이라 토큰을 보지 않음).

---

## 12. AI 단가 분석 (AI)

| ID | Method | URL | 권한 | 요구사항 | 상태 |
|---|---|---|---|---|---|
| AI-01 | POST | `/ai/price-analyses` | CLIENT | B-01, B-02 | 구현 (STEP 08-A·08-B-1, §12.1) |

**AI-01 단가 분석 요청**
- 요청: `{ title, description, category?, techStackIds? }` (등록 전 퍼널 입력값으로도 호출 가능하도록 프로젝트 ID를 받지 않음)
- 처리: mock이면 로컬 산정(스키마 실패 시 1회 재시도). openai이면 **유료 게이트(D-117)** → 예산 예약 → OpenAI Responses(Structured Outputs) → 스키마 검증(**API 재시도 없음**) → usage 정산 → 서버가 총액을 항목 합으로 **다시 계산**
- 응답 200: STEP 08-A와 동일 DTO(`items`, `totalAmount`, `assumptions`, `isMock`)

```json
{
  "data": {
    "items": [
      { "name": "회원가입·로그인", "description": "이메일·소셜 로그인", "estimatedAmount": "800000", "rationale": "OAuth 연동 포함 약 4일" }
    ],
    "totalAmount": "800000",
    "assumptions": ["모의(mock) 산정이며 실제 견적이 아닙니다."],
    "isMock": true
  }
}
```

- 예산 반영(B-03): 등록 전에는 FE가 퍼널의 예산 칸에 `totalAmount`를 채운다. 등록된 프로젝트는 `PRJ-03`으로 `budget`을 바꾼다(D-06 제한 적용)
- 견적 결과 본문은 저장하지 않는다(D-27). 사용량·비용 메타만 `ai_usage_ledger`에 기록(D-117)
- 오류: 400, 403, 429 `RATE_LIMITED` / `AI_BUDGET_EXCEEDED` / `AI_CONCURRENCY_LIMITED` / `AI_PROVIDER_RATE_LIMITED`, 502 `AI_INVALID_RESPONSE`, 503 `AI_UNAVAILABLE`·`AI_BILLABLE_DISABLED`·`AI_KEY_MISSING`·`AI_PRICING_UNCONFIGURED`·`AI_AUTH_FAILED`·`AI_MODEL_UNAVAILABLE`·`AI_PROVIDER_QUOTA`·`AI_TIMEOUT`·`AI_NETWORK`

### 12.1 STEP 08-A / 08-B-1 구현 내용과 명세 대비 차이 (AI-01)

| # | 항목 | 명세 | 구현 | 근거 |
|---|---|---|---|---|
| 1 | 모드 환경 변수 | TECH_STACK의 `LLM_PROVIDER` | `AI_ESTIMATE_MODE=mock\|openai` (기본 `mock`) | D-115 |
| 2 | OpenAI | 실제 API 호출 | 코드 구현 + **기본 유료 차단**(D-117). Fake Client로만 검증. 실호출 미검증 | STEP 08-B-1 |
| 3 | 응답 검증 | zod | 수동 스키마(`estimate.schema.js`). OpenAI JSON Schema `functions`→`items` 매핑 | D-02 |
| 4 | 응답 필드 | `items`, `totalAmount`, `isMock` | + `assumptions` | mock·실모드 공통 DTO |
| 5 | 호출 제한 | 사용자당(D-27) | 사용자 RPM + 전역 RPM + DB 동시 예약 + 월간 예산 | D-116, D-117 |
| 6 | 권한 | CLIENT | 로그인 → 역할 → 의뢰인만 | AI-01 |
| 7 | 화면 | 등록 퍼널 2단계 | 등록·수정 패널. 외부 전송 안내 문구 추가 | D-28, B-03 |
| 8 | DB | 결과 저장 없음 | 견적 본문 없음. `ai_budget_months`·`ai_usage_ledger`만 | D-27, D-117 |

---

## 13. 계약·전자 서명 (CTR)

| ID | Method | URL | 권한 | 요구사항 | 상태 |
|---|---|---|---|---|---|
| OFFER-01 | POST | `/applications/:applicationId/offer` | 프로젝트 소유자 | B-04 | 구현 (STEP 09-A). 선정 이후 합의 금액 1회 제안(D-118) |
| CTR-01 | POST | `/applications/:applicationId/offer/agree` | 지원 작성 프리랜서 | B-04, B-06 | 구현 (STEP 09-A). 동의+계약 생성, 전자서명 제외 |
| CTR-02 | POST | `/applications/:applicationId/offer/decline` | 지원 작성 프리랜서 | B-04, B-05 | 구현 (STEP 09-A, D-10) |
| CTR-03 | GET | `/me/contracts` | 로그인 | B-08 | 설계 |
| CTR-04 | GET | `/contracts/:contractId` | 당사자 | B-06, B-08 | 구현 (STEP 09-A 미리보기). 목록·서명은 이후 |
| CTR-05 | POST | `/contracts/:contractId/sign` | 당사자 | B-07 | 설계 (STEP 09-B) |

**CTR-01 합의 금액 동의 → 계약서 자동 생성**
- 요청: 본문 없음
- 처리(한 트랜잭션): 지원 `ACCEPTED` + `offer_status = PENDING` 확인 → `AGREED` → 계약 생성(`agreed_amount = offer_amount`, 기간 = 예상 기간, 당사자 스냅샷, 본문 자동 생성, `SIGNATURE_PENDING`)
- 응답 201: `{ data: Contract }`
- 오류: 404, 409 `INVALID_STATE_TRANSITION`

**CTR-02 합의 금액 거부 → 결렬**
- 처리(한 트랜잭션): `offer_status = DECLINED`, 지원 `REJECTED(NEGOTIATION_FAILED)`, 프로젝트 → 마감일 전이면 `RECRUITING`, 지났으면 `CLOSED`(D-10 제안). 이미 자동 거절된 지원은 그대로
- 응답 200: `{ data: Application }`
- 오류: 404, 409

**CTR-03 내 계약 목록**
- 쿼리: `status`(선택), `page` → `{ data: Contract[](요약), pagination }`. 의뢰인·프리랜서 모두 자기 계약만

**CTR-04 계약서 상세**
- 응답 200: `{ data: Contract }` (`displayStatus` 예: 서명 대기 / 결제 대기 / 작업 중 / 납품 확인 대기 / 완료, `availableActions` 포함)
- 오류: 404

**CTR-05 서명** (체크박스 동의)
- 요청: `{ "agreed": true }`
- 처리: 본인 서명 시각 기록. 양측 모두 서명하면 `signed_at` 기록, `SIGNED`(결제 대기) = **계약 체결**(D-13)
- 응답 200: `{ data: Contract }`
- 오류: 400(`agreed` 누락), 404, 409 `ALREADY_SIGNED`, 409 `INVALID_STATE_TRANSITION`(취소된 계약)

---

## 14. PG Sandbox 결제 및 검증 (PAY)

PG는 토스페이먼츠 sandbox 추천(D-16 제안). 흐름: `PAY-01` 결제 준비 → FE가 PG 결제창 호출 → PG가 FE 성공·실패 URL로 리다이렉트 → FE가 `PAY-02`·`PAY-03` 호출 → 서버가 PG 승인 API 호출·검증.

| ID | Method | URL | 권한 | 요구사항 | 상태 |
|---|---|---|---|---|---|
| PAY-01 | POST | `/contracts/:contractId/payments` | 계약 의뢰인 | B-09, B-11 | 설계 |
| PAY-02 | POST | `/payments/confirm` | 계약 의뢰인 | B-09, B-11, N-04 | 설계 |
| PAY-03 | POST | `/payments/fail` | 계약 의뢰인 | B-09 | 설계 |
| PAY-04 | GET | `/me/payments` | 로그인 | B-10 | 설계 |
| PAY-05 | GET | `/payments/:paymentId` | 결제자 또는 계약 프리랜서 | B-10 | 설계 |

**PAY-01 결제 준비**
- 요청: 본문 없음 (금액은 서버가 결정)
- 처리: 계약 `SIGNED` 확인 → `READY` 결제가 있으면 재사용, 없으면 `order_id` 생성·`amount = agreed_amount`로 생성
- 응답 201: `{ data: { paymentId, orderId, orderName, amount, customerName } }` (PG 클라이언트 키는 FE 환경 변수에 둔다)
- 오류: 404, 409 `INVALID_STATE_TRANSITION`(서명 전·이미 결제됨)

**PAY-02 결제 승인 검증** (PG 성공 리다이렉트 후)
- 요청: `{ paymentKey, orderId, amount }`
- 처리:
  1. `orderId`로 결제 조회, 요청자 = 결제자 확인
  2. **요청 금액 = DB 금액** 확인(다르면 `FAILED` 기록 + 400)
  3. 이미 `PAID`이고 같은 `paymentKey`면 기존 결과 그대로 반환(멱등)
  4. PG 승인 API 호출(시크릿 키는 서버 환경 변수, sandbox 키만 허용)
  5. 승인 응답의 상태·금액 재확인
  6. 한 트랜잭션: 결제 `PAID`·`HELD`(조건부 UPDATE `status = 'READY'`), 계약 `IN_PROGRESS`·`work_started_at`, 프로젝트 `IN_PROGRESS`
- 응답 200: `{ data: { payment: Payment, contractId } }` → FE는 계약서 상세로 이동
- 오류: 400 `PAYMENT_AMOUNT_MISMATCH`, 404, 409 `INVALID_STATE_TRANSITION`, 502 `PG_ERROR`(결제는 `FAILED` 기록, 재시도 가능)

**PAY-03 결제 실패 기록** (PG 실패 리다이렉트 후)
- 요청: `{ orderId, code, message }` → 결제 `FAILED`, 실패 사유 기록. 계약은 `SIGNED` 유지(다시 결제 가능)
- 응답 200: `{ data: Payment }`

**PAY-04 결제 내역**
- 응답: 의뢰인은 자신이 결제한 내역, 프리랜서는 자기 계약의 결제·정산 내역 → `{ data: Payment[], pagination }`

**PAY-05 결제 단건**
- 응답 200: `{ data: Payment }`. 오류 404

---

## 15. 에스크로 정산 (ESC)

| ID | Method | URL | 권한 | 요구사항 | 상태 |
|---|---|---|---|---|---|
| ESC-01 | POST | `/contracts/:contractId/delivery` | 계약 프리랜서 | B-12 | 설계 |
| ESC-02 | POST | `/contracts/:contractId/approve` | 계약 의뢰인 | B-13, B-14 | 설계 |
| ESC-03 | GET | `/contracts/:contractId/settlement` | 당사자 | B-14 | 설계 |

**ESC-01 납품 요청**
- 요청: `{ note, url? }`
- 처리: 계약 `IN_PROGRESS` 확인 → `DELIVERY_REQUESTED`, 납품 정보 기록(1회, D-19 제안)
- 응답 200: `{ data: Contract }`. 오류: 404, 409

**ESC-02 완료 승인 → 수수료 차감 지급 처리**
- 요청: 본문 없음
- 처리(한 트랜잭션): 계약 `DELIVERY_REQUESTED` 확인 → 계약 `COMPLETED`, 결제 `RELEASED`·`fee_amount = amount / 10n`(BigInt, 버림)·`payout_amount = amount - fee_amount`·`released_at`, 프로젝트 `COMPLETED`. 실제 이체는 하지 않는다
- 응답 200: `{ data: { contract: Contract, settlement: { amount, feeAmount, payoutAmount, releasedAt } } }`
- 오류: 404, 409 `INVALID_STATE_TRANSITION`(납품 요청 전, 이미 승인됨)

**ESC-03 정산 정보**
- 응답 200: `{ data: { amount, feeRate: 0.1, feeAmount, payoutAmount, escrowStatus, paidAt, releasedAt } }` (지급 전이면 수수료·지급액은 예상값으로 표시하고 `escrowStatus = HELD`)

---

## 16. 상호 리뷰 (REV)

| ID | Method | URL | 권한 | 요구사항 | 상태 |
|---|---|---|---|---|---|
| REV-01 | POST | `/contracts/:contractId/reviews` | 당사자 | B-15~B-18 | 설계 |
| REV-02 | GET | `/contracts/:contractId/reviews` | 당사자 | B-15 | 설계 |
| REV-03 | GET | `/users/:userId/reviews` | 공개 | B-19 | 설계 |

**REV-01 리뷰 작성**
- 요청: `{ rating: 5, content: "...", tags: ["책임감", "소통"] }`
- 처리: 계약 `COMPLETED` 확인, 대상(`reviewee`)은 서버가 계약의 상대방으로 결정, 태그는 작성자 역할의 태그 목록에서만 허용(D-20)
- 응답 201: `{ data: Review }`
- 오류: 400(별점 범위, 허용되지 않은 태그), 404, 409 `INVALID_STATE_TRANSITION`(완료 전), 409 `ALREADY_REVIEWED`
- 수정·삭제 API는 만들지 않는다(B-18)

**REV-02 계약의 리뷰 현황**
- 응답 200: `{ data: { myReview: Review | null, counterpartReview: Review | null } }` (공개 시점은 D-21. 추천안은 즉시 공개)

**REV-03 사용자가 받은 리뷰**
- 쿼리: `page` → `{ data: Review[], pagination, summary: { average: 4.3, count: 12 } }` (평균은 소수 첫째 자리, D-22 제안)

---

## 17. 공통 (SYS)

| ID | Method | URL | 권한 | 요구사항 | 상태 |
|---|---|---|---|---|---|
| SYS-01 | GET | `/health` | 공개 | N-07 | 설계 |

- 응답 200: `{ data: { status: "ok", db: "ok" } }` (배포 확인용, 버전·환경 변수 값은 노출하지 않음)
