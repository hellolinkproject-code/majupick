import { useEffect, useState } from 'react';
import { Link, Navigate, Outlet, useLocation, useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { logout, restoreSession } from '../lib/authApi.js';
import { safeReturnTo } from '../lib/returnTo.js';
import { useSessionStore } from '../stores/useSessionStore.js';
import { NotificationBell } from './NotificationBell.jsx';

// 역할 선택 전에는 인증 화면만 열고, 그 외에는 역할 선택으로 보낸다.
const ROLE_EXEMPT = new Set(['/select-role', '/oauth/complete', '/oauth/link']);

// 역할별 메뉴. 메뉴를 숨겨도 각 화면과 API가 역할을 다시 확인한다.
function AuthNav() {
  const status = useSessionStore((state) => state.status);
  const user = useSessionStore((state) => state.user);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  if (status === 'idle' || status === 'restoring') {
    return <nav className="layout__nav" aria-label="계정" aria-busy="true" />;
  }

  if (status !== 'authenticated' || !user) {
    return (
      <nav className="layout__nav" aria-label="계정">
        <Link to="/login">로그인</Link>
        <Link to="/signup" className="button button--small">
          회원가입
        </Link>
      </nav>
    );
  }

  async function handleLogout() {
    setIsLoggingOut(true);
    try {
      await logout();
    } catch {
      // 서버 무효화에 실패해도 이 브라우저의 로그인 상태는 이미 해제되었다.
    } finally {
      setIsLoggingOut(false);
      queryClient.removeQueries({ queryKey: ['me'] });
      queryClient.removeQueries({ queryKey: ['notifications'] });
      navigate('/', { replace: true });
    }
  }

  return (
    <nav className="layout__nav" aria-label="계정">
      <span className="layout__user">{user.name}님</span>
      {user.role === 'CLIENT' && (
        <>
          <Link to="/projects/new">프로젝트 등록</Link>
          <Link to="/me/projects">내 프로젝트</Link>
        </>
      )}
      {user.role === 'FREELANCER' && <Link to="/me/applications">내 지원 현황</Link>}
      {user.role && <NotificationBell userId={user.id} />}
      <Link to="/me">내 프로필</Link>
      <button
        type="button"
        className="button button--small button--ghost"
        onClick={handleLogout}
        disabled={isLoggingOut}
      >
        로그아웃
      </button>
    </nav>
  );
}

function roleSelectionPath(location) {
  const current = `${location.pathname}${location.search}${location.hash}`;
  const returnTo = safeReturnTo(current, '');
  return returnTo && returnTo !== '/'
    ? `/select-role?returnTo=${encodeURIComponent(returnTo)}`
    : '/select-role';
}

export function Layout() {
  const location = useLocation();
  const status = useSessionStore((state) => state.status);
  const user = useSessionStore((state) => state.user);
  const needsRole =
    status === 'authenticated' && user && !user.role && !ROLE_EXEMPT.has(location.pathname);

  useEffect(() => {
    restoreSession();
  }, []);

  return (
    <div className="layout">
      <header className="layout__header">
        <Link to="/" className="layout__logo">
          WorkBridge
        </Link>
        <span className="layout__badge">개발 환경</span>
        <nav className="layout__menu" aria-label="주요 메뉴">
          <Link to="/projects">프로젝트 찾기</Link>
        </nav>
        <AuthNav />
      </header>
      <main className="layout__main">
        {needsRole ? <Navigate to={roleSelectionPath(location)} replace /> : <Outlet />}
      </main>
      <footer className="layout__footer">© WorkBridge</footer>
    </div>
  );
}
