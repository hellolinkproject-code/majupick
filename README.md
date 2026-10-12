# WorkBridge

의뢰인과 프리랜서를 연결하는 프로젝트 중개 플랫폼 (코드잇 풀스택 JavaScript 과제).

> 현재 단계: **개발 환경 구축(STEP 03-A)**. 화면은 홈·404, API는 `GET /api/health`만 있다.
> 기획·설계 문서는 [`planning/`](./planning)에 있다.

## 기술 스택

| 영역                     | 사용 기술                                                 |
| ------------------------ | --------------------------------------------------------- |
| 프론트엔드               | React, Vite, React Router, Axios, TanStack Query, Zustand |
| 백엔드                   | Node.js, Express, JavaScript, REST API                    |
| 데이터베이스 (다음 단계) | PostgreSQL, Prisma                                        |
| 개발 도구                | npm workspaces, ESLint, Prettier, Vitest                  |

> RFP가 언급한 "고정 기술 스택" 목록은 아직 운영진 확인 전이다(`planning/DECISIONS.md` D-02). 위 구성은 잠정안이다.

## 폴더 구조

```text
workbridge/
├─ apps/
│  ├─ api/            # Express API 서버 (src/app.js, src/server.js, test/)
│  └─ web/            # React + Vite 앱 (src/app, pages, components, lib, stores)
├─ planning/          # 요구사항·ERD·API 명세·결정 기록
├─ .env.example       # 환경 변수 예시 (값은 예시만)
├─ eslint.config.js
└─ package.json       # npm workspaces 루트
```

## 시작하기

필요 환경: Node.js 22.22.2 이상, npm 10 이상

```bash
npm install
cp .env.example .env    # Windows PowerShell: Copy-Item .env.example .env
npm run dev
```

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
| `npm run test`                            | 모든 워크스페이스의 Vitest 실행            |
| `npm run build`                           | 프론트엔드 프로덕션 빌드 (`apps/web/dist`) |

## 환경 변수

루트의 `.env` 하나를 백엔드와 프론트엔드가 함께 읽는다. 프론트엔드에는 `VITE_`로 시작하는 변수만 노출되므로 비밀 값에는 `VITE_`를 붙이지 않는다. `.env`는 커밋하지 않는다.
