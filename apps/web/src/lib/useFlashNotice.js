import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';

/**
 * 이동할 때 `state.notice`로 넘긴 한 번짜리 안내. 화면에 보여 준 뒤 기록(history state)에서 지워
 * 새로고침하거나 뒤로 왔을 때 같은 안내가 다시 뜨지 않게 한다. notice 외의 state(예: from)는 남긴다.
 */
export function useFlashNotice() {
  const location = useLocation();
  const navigate = useNavigate();
  const incoming = location.state?.notice ?? null;
  const [flash, setFlash] = useState({ key: location.key, notice: incoming });
  if (incoming && flash.key !== location.key) setFlash({ key: location.key, notice: incoming });

  useEffect(() => {
    if (!incoming) return;
    const { notice: _notice, ...rest } = location.state;
    navigate(`${location.pathname}${location.search}${location.hash}`, {
      replace: true,
      state: Object.keys(rest).length > 0 ? rest : null,
    });
  }, [incoming, location, navigate]);

  return flash.notice;
}
