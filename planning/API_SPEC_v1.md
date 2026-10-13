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
| `PublicUser` | `id, name, role, profileImageUrl, bio, clientProfile?(companyName, businessField, websiteUrl), freelancerProfile?(mainCategory, techStacks[], careerYears, hourlyRate, portfolioUrl), ratingSummary: { average, count }` (이메일 제외) |
| `ProjectSummary` | `id, title, category, budget, recruitStartDate, recruitEndDate, publicStatus, techStacks[], applicantCount, isBookmarked?, createdAt` |
| `ProjectDetail` | `ProjectSummary + description, client(PublicUser 요약), status?(소유자만 7개 상태), myApplication?(프리랜서 본인 지원 상태)` |
| `Application` | `id, projectId, project(요약), freelancer(PublicUser 요약), coverLetter, proposedAmount, proposedDurationDays, status, rejectReason, offerAmount, offerStatus, contractId?, createdAt` |
| `Contract` | `id, projectId, projectTitle, agreedAmount, durationDays, terms, parties{client, freelancer}, status, displayStatus, clientSignedAt, freelancerSignedAt, signedAt, workStartedAt, delivery{note, url, requestedAt}, completedAt, availableActions[]` |
| `Payment` | `id, contractId, orderId, amount, status, method, paidAt, escrowStatus, feeAmount, payoutAmount, releasedAt` |
| `Review` | `id, contractId, reviewer(요약), reviewee(요약), rating, content, tags[], createdAt` |
| `Notification` | `id, type, message, linkUrl, isRead, readAt, createdAt` |

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
| PROF-05 | GET | `/users/:userId` | 공개 | A-14, B-19 | 설계 |
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
- 응답 200: `{ data: PublicUser }` (평균 별점·리뷰 수 포함, 리뷰 목록은 `REV-03`)
- 오류: 404

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

---

## 5. 프로젝트 CRUD (PRJ)

| ID | Method | URL | 권한 | 요구사항 | 상태 |
|---|---|---|---|---|---|
| PRJ-01 | POST | `/projects` | CLIENT +프로필 | A-15, A-24 | 설계 |
| PRJ-02 | GET | `/projects/:projectId` | 공개 | A-18, A-26 | 설계 |
| PRJ-03 | PATCH | `/projects/:projectId` | 소유자 | A-16, B-03 | 설계 |
| PRJ-04 | DELETE | `/projects/:projectId` | 소유자 | A-17 | 설계 |
| PRJ-05 | GET | `/me/projects` | CLIENT | A-28 | 설계 |

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

---

## 6. 프로젝트 검색·필터 (SRCH)

| ID | Method | URL | 권한 | 요구사항 | 상태 |
|---|---|---|---|---|---|
| SRCH-01 | GET | `/projects` | 공개 | A-19~A-23, A-26 | 설계 |
| SRCH-02 | GET | `/projects/:projectId/recommendations` | 공개 | A-41, D-30 | 설계 |
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
- 조회 직전에 상태 보정(시작일·마감일 경과분)을 실행한다(D-08)
- 오류: 400(잘못된 쿼리 값)

**SRCH-02 추천 프로젝트**
- 응답 200: `{ data: ProjectSummary[] }` (최대 4개, 같은 카테고리 + 기술 스택 겹침 순, 모집 중만, 자기 자신 제외. D-30 제안)

**SRCH-03 옵션 목록**
- 응답 200: `{ data: { projectCategories[], businessFields[], reviewTags: { forFreelancer[], forClient[] } } }` (값 목록은 D-59, D-20)

---

## 7. 지원서 제출 및 관리 (APP)

| ID | Method | URL | 권한 | 요구사항 | 상태 |
|---|---|---|---|---|---|
| APP-01 | POST | `/projects/:projectId/applications` | FREELANCER +프로필 | A-29, A-36① | 설계 |
| APP-02 | GET | `/projects/:projectId/applications` | 프로젝트 소유자 | A-31 | 설계 |
| APP-03 | GET | `/applications/:applicationId` | 작성자 또는 프로젝트 소유자 | A-31, A-35 | 설계 |
| APP-04 | GET | `/me/applications` | FREELANCER | A-30, A-35 | 설계 |

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

---

## 8. 지원자 수락·거절 (DEC)

| ID | Method | URL | 권한 | 요구사항 | 상태 |
|---|---|---|---|---|---|
| DEC-01 | POST | `/applications/:applicationId/accept` | 프로젝트 소유자 | A-25, A-32, A-33, A-36②③, B-04 | 설계 |
| DEC-02 | POST | `/applications/:applicationId/reject` | 프로젝트 소유자 | A-32, A-36④ | 설계 |

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

---

## 9. 프로젝트 상태 관리 (STAT)

| ID | Method | URL | 권한 | 요구사항 | 상태 |
|---|---|---|---|---|---|
| STAT-01 | POST | `/projects/:projectId/close` | 소유자 | A-24, A-34, A-36⑤ | 설계 |
| STAT-02 | POST | `/projects/:projectId/cancel` | 소유자 | A-27, D-13 | 설계 |
| STAT-03 | POST | `/internal/jobs/sync-project-status` | 내부 키(헤더 `X-Job-Secret`) | A-24, A-34, D-08 | 설계(선택) |

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

---

## 10. 알림 (NOTI)

| ID | Method | URL | 권한 | 요구사항 | 상태 |
|---|---|---|---|---|---|
| NOTI-01 | GET | `/notifications` | 로그인 | A-36, A-38 | 설계 |
| NOTI-02 | GET | `/notifications/unread-count` | 로그인 | A-37 | 설계 |
| NOTI-03 | PATCH | `/notifications/:notificationId/read` | 수신자 | A-37 | 설계 |
| NOTI-04 | PATCH | `/notifications/read-all` | 로그인 | A-38 | 설계 |

- NOTI-01: 쿼리 `unreadOnly`(선택), `page` → `{ data: Notification[], pagination }`
- NOTI-02: `{ data: { count } }`. FE가 30초마다 호출(D-37 제안)
- NOTI-03: 응답 200 `{ data: Notification }`. 이미 읽은 알림이어도 200(멱등). 오류 404
- NOTI-04: 응답 200 `{ data: { updatedCount } }`

---

## 11. 북마크 (BMK)

| ID | Method | URL | 권한 | 요구사항 | 상태 |
|---|---|---|---|---|---|
| BMK-01 | PUT | `/projects/:projectId/bookmark` | FREELANCER(D-31) | A-39 | 설계 |
| BMK-02 | DELETE | `/projects/:projectId/bookmark` | FREELANCER | A-39 | 설계 |
| BMK-03 | GET | `/me/bookmarks` | FREELANCER | A-40 | 설계 |

- BMK-01: 응답 204. 이미 있어도 204. 오류 403, 404(삭제된 프로젝트)
- BMK-02: 응답 204. 없어도 204
- BMK-03: 쿼리 `page` → `{ data: ProjectSummary[], pagination }` (삭제된 프로젝트 제외)

---

## 12. AI 단가 분석 (AI)

| ID | Method | URL | 권한 | 요구사항 | 상태 |
|---|---|---|---|---|---|
| AI-01 | POST | `/ai/price-analyses` | CLIENT | B-01, B-02 | 설계 |

**AI-01 단가 분석 요청**
- 요청: `{ title, description, category?, techStackIds? }` (등록 전 퍼널 입력값으로도 호출 가능하도록 프로젝트 ID를 받지 않음)
- 처리: LLM 어댑터 호출(실제 또는 mock) → 응답 JSON을 스키마로 검증(실패 시 1회 재시도) → 서버가 총액을 항목 합으로 **다시 계산**
- 응답 200:

```json
{
  "data": {
    "items": [
      { "name": "회원가입·로그인", "description": "이메일·소셜 로그인", "estimatedAmount": "800000", "rationale": "OAuth 연동 포함 약 4일" }
    ],
    "totalAmount": "800000",
    "isMock": false
  }
}
```

- 예산 반영(B-03): 등록 전에는 FE가 퍼널의 예산 칸에 `totalAmount`를 채운다. 등록된 프로젝트는 `PRJ-03`으로 `budget`을 바꾼다(D-06 제한 적용)
- 결과는 저장하지 않는다(D-27 제안)
- 오류: 400, 403, 429 `RATE_LIMITED`(횟수는 D-27), 502 `AI_INVALID_RESPONSE`, 503 `AI_UNAVAILABLE`

---

## 13. 계약·전자 서명 (CTR)

| ID | Method | URL | 권한 | 요구사항 | 상태 |
|---|---|---|---|---|---|
| CTR-01 | POST | `/applications/:applicationId/offer/agree` | 지원 작성 프리랜서 | B-04, B-06 | 설계 |
| CTR-02 | POST | `/applications/:applicationId/offer/decline` | 지원 작성 프리랜서 | B-04, B-05 | 설계 |
| CTR-03 | GET | `/me/contracts` | 로그인 | B-08 | 설계 |
| CTR-04 | GET | `/contracts/:contractId` | 당사자 | B-06, B-08 | 설계 |
| CTR-05 | POST | `/contracts/:contractId/sign` | 당사자 | B-07 | 설계 |

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
