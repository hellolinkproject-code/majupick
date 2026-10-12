import { useQuery } from '@tanstack/react-query';
import { fetchHealth } from '../lib/apiClient.js';
import { useSessionStore } from '../stores/useSessionStore.js';

function ApiStatus() {
  const { data, isPending, isError } = useQuery({ queryKey: ['health'], queryFn: fetchHealth });

  if (isPending) return <span className="status status--pending">확인 중…</span>;
  if (isError) return <span className="status status--error">연결 실패</span>;
  return <span className="status status--ok">정상 ({data.status})</span>;
}

export function HomePage() {
  const isLoggedIn = useSessionStore((state) => state.accessToken !== null);

  return (
    <section className="home">
      <h1>WorkBridge</h1>
      <p className="home__lead">의뢰인과 프리랜서를 연결하는 프로젝트 중개 플랫폼</p>

      <h2>개발 환경 확인</h2>
      <dl className="checklist">
        <div>
          <dt>프론트엔드</dt>
          <dd>
            <span className="status status--ok">React + Vite 실행 중</span>
          </dd>
        </div>
        <div>
          <dt>백엔드 API (GET /api/health)</dt>
          <dd>
            <ApiStatus />
          </dd>
        </div>
        <div>
          <dt>세션 상태 (Zustand)</dt>
          <dd>{isLoggedIn ? '로그인됨' : '로그인 전'}</dd>
        </div>
      </dl>
    </section>
  );
}
