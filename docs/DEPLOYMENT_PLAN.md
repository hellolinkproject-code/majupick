# WorkBridge 배포 계획 (STEP 12-A)

> 상태: **준비 완료 · 실제 배포 미실행**. 외부 계정 생성·유료 결제·GitHub push·운영 DB 생성은 사용자 승인(STEP 12-B) 후에만 진행한다.  
> 기준 브랜치: `feat/deployment-readiness` · 기준 커밋: STEP 11 `2ed2a70` 이후 배포 준비 커밋.

## 1. 추천 배포 조합

| 역할        | 서비스                      | 용도                                                 | 비용(공개 무료 플랜 기준, 변동 가능)                        |
| ----------- | --------------------------- | ---------------------------------------------------- | ----------------------------------------------------------- |
| 프론트엔드  | **Vercel Hobby**            | Vite 정적 빌드 + SPA 라우팅 + `/api` reverse rewrite | $0 (개인 Hobby 한도 내)                                     |
| 백엔드      | **Render Free Web Service** | Express(`apps/api`) Node 프로세스                    | $0 (월 750 instance-hours, 유휴 15분 잠듦)                  |
| PostgreSQL  | **Neon Free**               | 운영 데이터(Prisma migrate deploy)                   | $0 (프로젝트당 저장·컴퓨트 한도, scale-to-zero)             |
| 이미지 저장 | **Supabase Storage Free**   | 프로필 이미지 영구 보관(STEP 12-B 어댑터 연결)       | $0 (파일 저장 약 1GB, 비활성 1주 시 프로젝트 일시정지 주의) |
| 소스·CI     | **GitHub** + Actions        | 저장소, 자동 lint/test/build                         | $0 (공개 저장소 기준)                                       |
| OAuth       | **Google Cloud**            | Google 로그인                                        | $0 (OAuth 클라이언트)                                       |
| PG          | Fake / 토스 **테스트** 키만 | 시연 결제                                            | Fake=$0, 테스트 키=$0 (live 키 금지)                        |
| AI          | Mock 유지                   | 단가 분석                                            | $0 (`AI_ENABLE_BILLABLE_CALLS=false`)                       |

**선정 이유**

1. RFP의 “실제 URL + FE/BE GitHub 자동 배포 + PostgreSQL + 이미지 스토리지 + OAuth + PG 샌드박스”를 무료 범위에서 충족한다.
2. D-43의 Vercel `/api` rewrite로 **같은 출처 쿠키(`SameSite=Lax`)** 를 유지해 인증 구조를 거의 바꾸지 않는다.
3. Render 무료 Postgres는 **생성 후 30일 만료**라 과제 시연에 부적합 → Neon을 쓴다.
4. Supabase Free DB는 **1주 비활성 시 일시정지**라 DB는 Neon, 이미지만 Supabase Storage로 나눈다(D-29·D-76).
5. Express·Prisma·주기 작업은 장기 실행 Node 프로세스가 필요해 Vercel Serverless보다 Render가 맞다.

**대안(기각 또는 보류)**

| 대안                 | 이유                                            |
| -------------------- | ----------------------------------------------- |
| Railway              | 체험 크레딧 후 유료 전환 가능 → 승인 전 비추천  |
| Render Free Postgres | 30일 만료                                       |
| Supabase Postgres만  | 1주 pause → 시연 전 수동 재개 필요              |
| Cloudflare R2        | 계정·결제수단 요구 가능 → Supabase Storage 우선 |
| FE·BE 모두 Render    | 가능하나 FE는 Vercel이 CDN·미리보기에 유리      |

## 2. 필요한 외부 계정 (사용자 준비 · STEP 12-B)

| #   | 계정         | 유료 결제 필요?   | 비고                                                                 |
| --- | ------------ | ----------------- | -------------------------------------------------------------------- |
| 1   | GitHub       | 아니오            | private/public 저장소, Actions                                       |
| 2   | Vercel       | 아니오(Hobby)     | GitHub 연동                                                          |
| 3   | Render       | 아니오(Free)      | GitHub 연동. 카드 등록은 선택(한도 초과 시 청구 가능 → 등록 시 주의) |
| 4   | Neon         | 아니오(Free)      | 프로젝트 1개 + connection string                                     |
| 5   | Supabase     | 아니오(Free)      | Storage 버킷만 사용해도 됨                                           |
| 6   | Google Cloud | 아니오            | OAuth 웹 클라이언트 + 테스트 사용자                                  |
| 7   | 토스페이먼츠 | 아니오(테스트 키) | STEP 12-B 이후 샌드박스만. **live 키 금지**                          |
| 8   | OpenAI       | **사용 안 함**    | Mock 유지                                                            |

⚠️ 이 단계에서는 위 계정에 **로그인·생성·결제를 하지 않았다.**

## 3. 아키텍처

```text
브라우저
  └─ https://<vercel-app>          (apps/web dist)
        ├─ /               → 정적 SPA
        └─ /api/*  rewrite → https://<render-api>/api/*
                                ├─ Express + Prisma
                                ├─ Neon PostgreSQL (SSL)
                                ├─ 로컬 디스크 이미지(임시) → 이후 Supabase Storage
                                └─ recruit sync setInterval (잠들면 깨어날 때 따라잡기)
```

같은 출처 rewrite가 있으면:

- `VITE_API_BASE_URL` 비움(`/api`)
- `CORS_ORIGIN=https://<vercel-app>`
- `GOOGLE_REDIRECT_URI=https://<vercel-app>/api/auth/oauth/google/callback`
- `COOKIE_SAME_SITE=lax`, `COOKIE_SECURE=true`

크로스 사이트(API를 브라우저가 직접 호출)로 바꿀 때만 `COOKIE_SAME_SITE=none` + `VITE_API_BASE_URL=https://<render-api>/api`.

## 4. 환경 변수 목록

비밀 값은 문서·로그·Git에 넣지 않는다. 호스트 대시보드에만 설정한다.

### 4.1 프론트엔드 (Vercel)

| 변수                            | 필수                 | 예시/설명                         |
| ------------------------------- | -------------------- | --------------------------------- |
| (없음 또는) `VITE_API_BASE_URL` | rewrite 사용 시 비움 | 크로스 사이트일 때만 API 절대 URL |
| `VITE_TOSS_CLIENT_KEY`          | 아니오               | 서버 prepare의 clientKey 우선     |

### 4.2 백엔드 (Render)

| 영역      | 변수                                                                                          | 운영 권장                                  |
| --------- | --------------------------------------------------------------------------------------------- | ------------------------------------------ |
| 런타임    | `NODE_ENV=production`, `HOST=0.0.0.0`, `PORT`(플랫폼 주입), `TRUST_PROXY=true`                | 필수                                       |
| URL       | `CORS_ORIGIN=https://<vercel>`                                                                | 필수                                       |
| DB        | `DATABASE_URL`(Neon, `sslmode=require`), `ALLOW_REMOTE_DATABASE=true`                         | 필수. `TEST_`/`SHADOW_`는 운영에 두지 않음 |
| JWT       | `JWT_ACCESS_SECRET`(32자+), TTL·bcrypt는 기본값 가능                                          | 필수                                       |
| Cookie    | `COOKIE_SECURE=true`, `COOKIE_SAME_SITE=lax`(rewrite) 또는 `none`                             | 필수                                       |
| Google    | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`                             | OAuth 쓸 때                                |
| 업로드    | `STORAGE_DRIVER=local`(임시), `UPLOAD_DIR` 선택                                               | 12-B에서 supabase로 교체                   |
| 마감 작업 | `RECRUIT_SYNC_INTERVAL_MS=60000` (또는 `0`+외부 cron)                                         | 권장                                       |
| PG        | `PG_MODE=mock`, `TOSS_ENABLE_TEST_CALLS=false`                                                | **12-A/시연 기본**                         |
| AI        | `AI_ESTIMATE_MODE=mock`, `AI_ENABLE_BILLABLE_CALLS=false`, `AI_ESTIMATE_MONTHLY_BUDGET_USD=0` | **필수 안전**                              |

로컬·테스트·운영 분리는 `.env`(로컬, gitignore) / CI secrets / 호스트 env로 한다. 운영에 `TEST_DATABASE_URL`을 넣지 않는다.

## 5. 데이터베이스

1. Neon에서 빈 DB 생성 → connection string 복사(`sslmode=require`).
2. Render env에 `DATABASE_URL`, `ALLOW_REMOTE_DATABASE=true`.
3. **한 번** release/one-off로:

   ```bash
   npm run db:migrate:deploy -w apps/api
   npm run db:seed:tech-stacks -w apps/api
   ```

4. **금지:** `prisma migrate reset`, `db push`, `DROP`/`TRUNCATE` 수동 실행, 로컬 `workbridge_dev`를 운영 URL로 덮어쓰기.
5. 백업: Neon 대시보드 포인트인타임/브랜치(플랜별). 과제 범위에서는 시연 전 `pg_dump` 선택.
6. 로컬 `workbridge_dev` / `workbridge_test`는 그대로 보존한다.

마이그레이션은 `apps/api/prisma/migrations/`에 순서대로 12개가 있으며, 빈 DB에 `migrate deploy`로 적용 가능하다(로컬 테스트 DB로 비파괴 검증).

## 6. 배포 순서 (STEP 12-B)

1. GitHub 저장소 생성·push(사용자 승인).
2. Neon DB 생성 → migrate deploy → seed.
3. Render Web Service 연결(루트 monorepo, `render.yaml` 참고) → env 설정 → health `GET /api/health`.
4. Vercel 프로젝트: Root `apps/web`, `vercel.json.example`을 참고해 rewrite destination을 Render URL로 설정 → 배포.
5. Google Cloud에 운영 Redirect URI·JS origin 추가(테스트 사용자 유지 가능).
6. (선택) Supabase Storage 버킷 + 어댑터 코드 연결 후 `STORAGE_DRIVER` 전환.
7. 종단간 시연(체크리스트 참고).
8. PG 테스트 키는 별도 승인 후 `PG_MODE=toss` + `TOSS_ENABLE_TEST_CALLS=true`.

## 7. 도메인·OAuth

- Vercel 기본 `*.vercel.app` HTTPS로 충분하다(커스텀 도메인은 선택).
- Google OAuth 동의 화면이 **테스트**이면 시연 계정을 테스트 사용자로 등록해야 한다.
- Redirect URI는 프론트 출처 + `/api/auth/oauth/google/callback` (Vite/Vercel 프록시와 동일).

## 8. 이미지 스토리지 계획

| 단계 | 상태                                                                             |
| ---- | -------------------------------------------------------------------------------- |
| 지금 | `STORAGE_DRIVER=local`, `createLocalImageStorage` — 재배포·잠듦 시 파일 소실     |
| 12-B | Supabase Storage 어댑터(`save`/`remove` 동일 인터페이스), 공개 URL 또는 서명 URL |
| 유지 | MIME·magic bytes·sharp 512px WebP·EXIF 제거·5MB·무작위 파일명                    |

계정 생성·유료 결제는 하지 않는다.

## 9. 자동 마감 작업

- 구현: 서버 시작 시 1회 + `RECRUIT_SYNC_INTERVAL_MS` 주기, 중복 실행 스킵, CLI `job:sync-project-status`.
- Render Free는 **15분 유휴 시 잠듦** → 잠든 동안 마감 반영·알림이 늦고, 깨어날 때 따라잡는다.
- 시연 직전 health를 한 번 호출해 깨워 두면 충분하다.
- 외부 cron/STAT-03 HTTP는 **아직 만들지 않음**(D-113). 필요 시 12-B에서 `RECRUIT_SYNC_INTERVAL_MS=0` + 외부에서 CLI/일회성 실행을 검토.

## 10. PG·OpenAI 안전

운영 시연 기본값:

```text
PG_MODE=mock
TOSS_ENABLE_TEST_CALLS=false
AI_ESTIMATE_MODE=mock
AI_ENABLE_BILLABLE_CALLS=false
AI_ESTIMATE_MONTHLY_BUDGET_USD=0
```

- live PG 키·실결제·OpenAI 유료 호출 금지.
- 과거 로컬 원장·키는 보존하되 문서에 값을 적지 않는다.

## 11. 장애·롤백

| 증상               | 대응                                                             |
| ------------------ | ---------------------------------------------------------------- |
| API 502/콜드스타트 | 1분 대기 후 `/api/health` 재시도. Vercel rewrite 타임아웃 주의   |
| 로그인 쿠키 유실   | rewrite·CORS·Secure·SameSite·도메인 일치 확인                    |
| 마이그레이션 실패  | Render 로그 확인. reset 금지. SQL 수정은 새 migration으로        |
| 잘못된 배포        | Render/Vercel 이전 배포 롤백(Free는 최근 배포 제한 있을 수 있음) |
| 이미지 404         | local 디스크 소실 → Storage 전환 전까지 재업로드                 |

## 12. GitHub 연동 방법(요약)

1. 원격 저장소 생성 후 `feat/deployment-readiness` push → PR → `main`.
2. Vercel: Import repo → Root Directory `apps/web` → rewrite 설정.
3. Render: Blueprint(`render.yaml`) 또는 수동 Web Service → Build/Start 명령.
4. Actions: `.github/workflows/ci.yml`이 push/PR에서 lint·format·unit·build·scripts·DB 통합 실행.

## 13. 예상 비용 요약

| 항목                                                            | 월 예상                              |
| --------------------------------------------------------------- | ------------------------------------ |
| Vercel Hobby + Render Free + Neon Free + Supabase Free + GitHub | **$0** (한도 내)                     |
| Render/Vercel 한도 초과·카드 등록 후 초과분                     | 과금 가능 → 대시보드에서 사용량 확인 |
| 토스 테스트·Google OAuth·Mock AI                                | $0                                   |
| OpenAI / live PG                                                | **사용 안 함**                       |

가격·한도는 제공사 정책 변경에 따라 달라질 수 있다. STEP 12-B 직전에 각 콘솔에서 한 번 더 확인한다.
