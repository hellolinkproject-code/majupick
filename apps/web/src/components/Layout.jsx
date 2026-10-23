import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { logout, restoreSession } from '../lib/authApi.js';
import { safeReturnTo } from '../lib/returnTo.js';
import { useSessionStore } from '../stores/useSessionStore.js';
import { NotificationBell } from './NotificationBell.jsx';
import { BRAND_NAME_EN, BRAND_NAME_KO } from '../lib/brand.js';

// 역할 선택 전에는 인증 화면만 열고, 그 외에는 역할 선택으로 보낸다.
const ROLE_EXEMPT = new Set(['/select-role', '/oauth/complete', '/oauth/link']);

// 역할별 주요 메뉴. 메뉴를 숨겨도 각 화면과 API가 역할을 다시 확인한다.
const ROLE_MENUS = {
  CLIENT: [
    { to: '/projects/new', label: '프로젝트 등록' },
    { to: '/me/projects', label: '내 프로젝트' },
    { to: '/me/contracts', label: '내 계약' },
    { to: '/me/payments', label: '내 결제' },
  ],
  FREELANCER: [
    { to: '/me/applications', label: '내 지원 현황' },
    { to: '/me/contracts', label: '내 계약' },
    { to: '/me/payments', label: '내 결제' },
    { to: '/me/bookmarks', label: '내 북마크' },
  ],
};

function MainNav({ role }) {
  return (
    <nav className="layout__menu" aria-label="주요 메뉴">
      <NavLink to="/projects" end>
        프로젝트 찾기
      </NavLink>
      {(ROLE_MENUS[role] ?? []).map((item) => (
        <NavLink key={item.to} to={item.to} end>
          {item.label}
        </NavLink>
      ))}
    </nav>
  );
}

// 세션 복원 중에는 비어 있는 자리만 둬서 비로그인 메뉴가 잠깐 보였다 사라지지 않게 한다.
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
        <NavLink to="/login">로그인</NavLink>
        <NavLink to="/signup" className="button button--small">
          회원가입
        </NavLink>
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
      queryClient.removeQueries({ queryKey: ['bookmarks'] });
      queryClient.removeQueries({ queryKey: ['my-applications'] });
      queryClient.removeQueries({ queryKey: ['my-projects'] });
      queryClient.removeQueries({ queryKey: ['my-contracts'] });
      queryClient.removeQueries({ queryKey: ['my-payments'] });
      // 상세 캐시 중 이 사용자 몫(지원 여부·북마크·소유자 필드)만 지운다. 비로그인 응답은 남겨도 된다.
      queryClient.removeQueries({
        predicate: (query) => query.queryKey[0] === 'project' && query.queryKey[2] === user.id,
      });
      navigate('/', { replace: true });
    }
  }

  return (
    <nav className="layout__nav" aria-label="계정">
      <span className="layout__user">{user.name}님</span>
      {user.role ? (
        <NavLink to="/me" end>
          내 프로필
        </NavLink>
      ) : (
        <NavLink to="/select-role">역할 선택</NavLink>
      )}
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

// 로그인·가입 화면에서 막 로그인했다면 그 화면이 받은 returnTo로 돌아가야 한다.
const AUTH_PAGES = new Set(['/login', '/signup']);

function roleSelectionPath(location) {
  const current = AUTH_PAGES.has(location.pathname)
    ? new URLSearchParams(location.search).get('returnTo')
    : `${location.pathname}${location.search}${location.hash}`;
  const returnTo = safeReturnTo(current, '');
  return returnTo && returnTo !== '/'
    ? `/select-role?returnTo=${encodeURIComponent(returnTo)}`
    : '/select-role';
}

export function Layout() {
  const location = useLocation();
  const status = useSessionStore((state) => state.status);
  const user = useSessionStore((state) => state.user);
  // 좁은 화면 메뉴는 연 화면·로그인 상태에서만 열려 있다. 이동하거나 로그아웃하면 저절로 닫힌다.
  const menuKey = `${location.pathname}${location.search}|${status}|${user?.role ?? ''}`;
  const [openFor, setOpenFor] = useState(null);
  const menuOpen = openFor === menuKey;
  const toggleRef = useRef(null);
  const signedIn = status === 'authenticated' && Boolean(user);
  const needsRole = signedIn && !user.role && !ROLE_EXEMPT.has(location.pathname);

  useEffect(() => {
    restoreSession();
  }, []);

  function handleMenuKeyDown(event) {
    if (event.key === 'Escape' && menuOpen) {
      setOpenFor(null);
      toggleRef.current?.focus();
    }
  }

  return (
    <div className="layout">
      <a className="skip-link" href="#main-content">
        본문으로 건너뛰기
      </a>
      <header className="layout__header" onKeyDown={handleMenuKeyDown}>
        <div className="layout__bar">
          <Link to="/" className="layout__logo" aria-label={`${BRAND_NAME_KO} ${BRAND_NAME_EN}`}>
            {BRAND_NAME_KO}
          </Link>
          {import.meta.env.MODE !== 'production' ? (
            <span className="layout__badge">개발 환경</span>
          ) : null}
          <div className="layout__quick">
            {signedIn && user.role && <NotificationBell userId={user.id} />}
            <button
              ref={toggleRef}
              type="button"
              className="layout__toggle button button--small button--ghost"
              aria-expanded={menuOpen}
              aria-controls="site-menu"
              onClick={() => setOpenFor(menuOpen ? null : menuKey)}
            >
              {menuOpen ? '메뉴 닫기' : '메뉴'}
            </button>
          </div>
        </div>
        <div id="site-menu" className={`layout__panel${menuOpen ? ' is-open' : ''}`}>
          <MainNav role={signedIn ? user.role : null} />
          <AuthNav />
        </div>
      </header>
      <main id="main-content" className="layout__main" tabIndex={-1}>
        {needsRole ? <Navigate to={roleSelectionPath(location)} replace /> : <Outlet />}
      </main>
      <footer className="layout__footer">
        © {BRAND_NAME_KO} ({BRAND_NAME_EN})
      </footer>
    </div>
  );
}
