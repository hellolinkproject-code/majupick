import { Navigate, Outlet, useLocation } from 'react-router';
import { loginPathFor } from '../lib/returnTo.js';
import { useSessionStore } from '../stores/useSessionStore.js';

/** 로그인한 사용자만 하위 화면을 본다. 비로그인이면 현재 경로를 returnTo로 붙여 로그인 화면으로 보낸다. */
export function RequireAuth() {
  const status = useSessionStore((state) => state.status);
  const location = useLocation();

  if (status === 'idle' || status === 'restoring') {
    return <p className="page-status">로그인 상태를 확인하는 중…</p>;
  }
  if (status !== 'authenticated') {
    return <Navigate to={loginPathFor(location)} replace />;
  }
  return <Outlet />;
}
