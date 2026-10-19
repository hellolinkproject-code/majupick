# WorkBridge 배포 체크리스트 (STEP 12-A → 12-B)

체크는 STEP 12-B에서 사용자가 수행한다. 12-A에서는 코드·문서·CI만 준비했다.

## A. 계정·키 준비 (결제 전 확인)

- [ ] GitHub 계정·빈 저장소(또는 기존 remote)
- [ ] Vercel Hobby 계정 (GitHub 연동)
- [ ] Render 계정 (Free Web Service)
- [ ] Neon 프로젝트·Postgres connection string (`sslmode=require`)
- [ ] Supabase 프로젝트(Storage용, 12-B 이미지 연동 시)
- [ ] Google Cloud OAuth 웹 클라이언트
- [ ] Google 테스트 사용자에 시연용 Gmail 등록
- [ ] (선택) 토스 **테스트** 키만 — live 키 없음
- [ ] OpenAI 키 **운영에 넣지 않음**

## B. 로컬 검증 (12-A에서 수행)

- [x] `npm run lint`
- [x] `npm run format:check`
- [x] `npm run test`
- [x] `npm run test:db` (로컬 `workbridge_test`)
- [x] `npm run build`
- [x] `npm run test:scripts -w apps/api`
- [x] Git에 `.env`·업로드 파일·시크릿 미포함
- [x] `PG_MODE=mock`, AI billable off 유지
- [ ] 브라우저 종단간(프리랜서 리뷰 버튼 포함) — 아래 E 참고

## C. 인프라 생성 (승인 후)

- [ ] GitHub push / PR / `main` 병합
- [ ] Neon DB 생성 (로컬 DB와 분리)
- [ ] `ALLOW_REMOTE_DATABASE=true` + `DATABASE_URL`을 Render에만 설정
- [ ] `npm run db:migrate:deploy -w apps/api` (운영 URL 대상, **reset 금지**)
- [ ] `npm run db:seed:tech-stacks -w apps/api`
- [ ] Render Web Service 배포, `GET /api/health` = ok
- [ ] Vercel 배포 + `/api` rewrite → Render
- [ ] 프론트 URL로 SPA·API 프록시 확인

## D. 인증·보안

- [ ] `JWT_ACCESS_SECRET` 32자+ (운영 전용, 로컬과 다름)
- [ ] `CORS_ORIGIN` = Vercel URL
- [ ] `COOKIE_SECURE=true`, `COOKIE_SAME_SITE=lax` (rewrite)
- [ ] `TRUST_PROXY=true`
- [ ] Google Redirect URI = `https://<vercel>/api/auth/oauth/google/callback`
- [ ] 승인된 JS 원본에 Vercel URL 추가
- [ ] 이메일 회원가입·로그인·새로고침 세션 복원·로그아웃
- [ ] Google 로그인·동일 이메일 연결
- [ ] 시크릿이 GitHub 코드·Actions 로그에 없는지 확인

## E. 종단간 시연 시나리오

테스트/운영 DB에 시연 전용 계정을 쓴다. **로컬 `workbridge_dev` 데이터를 지우지 않는다.**

1. [ ] 의뢰인 회원가입·프로필
2. [ ] 프로젝트 등록
3. [ ] 프리랜서 회원가입·지원
4. [ ] 의뢰인 선정
5. [ ] 금액 제안 → 프리랜서 동의
6. [ ] 계약서 생성 → 양측 서명
7. [ ] Fake PG 결제 → `IN_PROGRESS`
8. [ ] 프리랜서 납품 → 의뢰인 완료 승인
9. [ ] 모의 정산 → `COMPLETED`
10. [ ] 의뢰인 리뷰 (브라우저)
11. [ ] 프리랜서 리뷰 (브라우저 버튼 제출)
12. [ ] 공개 프로필 별점·리뷰 목록

### 12-A 브라우저 검증 기록

| 항목                                 | 결과                                                             |
| ------------------------------------ | ---------------------------------------------------------------- |
| API·DB 통합 테스트로 리뷰 흐름       | 검증(STEP 11)                                                    |
| 브라우저에서 프리랜서 리뷰 버튼 제출 | **미검증** (12-A에서 실브라우저 E2E 미실행, 테스트 DB 보존 정책) |
| 배포 URL 전체 시나리오               | **미검증** (배포 전)                                             |

## F. 이미지·스케줄러·안전

- [ ] (임시) local 업로드 경고 인지 — 재배포 시 이미지 소실
- [ ] (권장) Supabase Storage 어댑터 연결
- [ ] Render 콜드스타트 후 모집 마감 따라잡기 확인(또는 시연 전 health ping)
- [ ] `PG_MODE=mock`, `TOSS_ENABLE_TEST_CALLS=false`
- [ ] `AI_ESTIMATE_MODE=mock`, `AI_ENABLE_BILLABLE_CALLS=false`, budget `0`

## G. 장애 시

- [ ] Render/Vercel 직전 배포로 롤백
- [ ] DB reset/DROP 하지 않음
- [ ] 이슈 재현 시 `/api/health`·Render 로그·Vercel 함수/rewrite 로그만 공유 (시크릿 제외)
