import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchGoogleStatus, googleLoginHref } from '../lib/authApi.js';

/** 로그인·회원가입 화면의 Google 로그인. 설정이 없으면 동작하지 않는 버튼 대신 안내를 보여 준다. */
export function GoogleAuthSection({ returnTo }) {
  const [starting, setStarting] = useState(false);
  const status = useQuery({
    queryKey: ['google-oauth-status'],
    queryFn: fetchGoogleStatus,
    staleTime: 60_000,
    retry: false,
  });

  return (
    <div className="oauth-section">
      <p className="oauth-divider">또는</p>
      {status.isLoading && <p className="page-status">Google 로그인 확인 중…</p>}
      {status.isError && (
        <p className="form-alert" role="alert">
          Google 로그인 상태를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.
        </p>
      )}
      {status.data?.enabled === false && (
        <p className="oauth-notice">
          Google 로그인을 쓰려면 프로젝트 루트 .env에 GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET,
          GOOGLE_REDIRECT_URI를 설정하세요. 값은 README의 Google Cloud 설정 안내를 따른 뒤 서버를
          다시 시작해야 합니다.
        </p>
      )}
      {status.data?.enabled && (
        <a
          className="button button--block button--google"
          href={googleLoginHref(returnTo)}
          aria-disabled={starting || undefined}
          onClick={(event) => {
            if (starting) {
              event.preventDefault();
              return;
            }
            setStarting(true);
          }}
        >
          {starting ? 'Google로 이동 중…' : 'Google로 계속하기'}
        </a>
      )}
    </div>
  );
}
