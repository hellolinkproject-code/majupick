import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { refreshSession } from '../lib/apiClient.js';
import { safeReturnTo } from '../lib/returnTo.js';

/** Google 로그인 직후 Refresh 쿠키로 세션을 복원한 다음 목적지로 이동한다. */
export function OAuthCompletePage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const returnTo = safeReturnTo(searchParams.get('returnTo'));
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    refreshSession()
      .then((session) => {
        if (cancelled) return;
        if (!session.user.role) {
          navigate(
            returnTo !== '/'
              ? `/select-role?returnTo=${encodeURIComponent(returnTo)}`
              : '/select-role',
            { replace: true },
          );
          return;
        }
        navigate(returnTo, { replace: true });
      })
      .catch(() => {
        if (!cancelled) setError('로그인을 마치지 못했습니다. 다시 시도해 주세요.');
      });
    return () => {
      cancelled = true;
    };
  }, [navigate, returnTo]);

  return (
    <section className="auth-card">
      <h1>로그인 처리 중</h1>
      {error ? (
        <>
          <p className="form-alert" role="alert">
            {error}
          </p>
          <p className="auth-card__footer">
            <Link to="/login">로그인으로 돌아가기</Link>
          </p>
        </>
      ) : (
        <p className="page-status">Google 로그인 결과를 확인하고 있습니다…</p>
      )}
    </section>
  );
}
