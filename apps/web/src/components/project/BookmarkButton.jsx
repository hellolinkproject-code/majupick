import { useRef, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { parseApiError } from '../../lib/authApi.js';
import { addBookmark, applyBookmarkChange, removeBookmark } from '../../lib/bookmarkApi.js';
import { loginPathFor } from '../../lib/returnTo.js';
import { useSessionStore } from '../../stores/useSessionStore.js';

/**
 * 프로젝트 상세의 북마크(BMK-01·02). 프리랜서만 쓰며, 비로그인은 로그인 후 이 상세로 돌아오고,
 * 의뢰인·역할 미선택에게는 보이지 않는다(API도 막는다). 지원 영역과는 따로 동작한다.
 * 요청 중에는 버튼을 잠가 빠른 연속 클릭이 반대 상태를 만들지 않게 한다.
 */
export function BookmarkButton({ project }) {
  const status = useSessionStore((state) => state.status);
  const user = useSessionStore((state) => state.user);
  const location = useLocation();
  const queryClient = useQueryClient();
  const [message, setMessage] = useState(null);
  const inFlight = useRef(false);

  const toggle = useMutation({
    mutationFn: (next) => (next ? addBookmark(project.id) : removeBookmark(project.id)),
    onSettled: () => {
      inFlight.current = false;
    },
    onSuccess: (_data, next) => {
      applyBookmarkChange(queryClient, user.id, project.id, next);
      setMessage({ kind: 'success', saved: next });
    },
    onError: (error) => {
      const apiError = parseApiError(error);
      setMessage({ kind: 'error', text: apiError.message });
      if (apiError.code === 'NOT_FOUND') {
        queryClient.invalidateQueries({ queryKey: ['project', String(project.id)] });
      }
    },
  });

  if (status === 'idle' || status === 'restoring' || project.isOwner) return null;

  if (status !== 'authenticated' || !user) {
    return (
      <div className="bookmark-control">
        <Link to={loginPathFor(location)} className="button button--small button--ghost">
          ☆ 로그인하고 북마크하기
        </Link>
      </div>
    );
  }

  if (user.role !== 'FREELANCER' || typeof project.isBookmarked !== 'boolean') return null;

  const saved = project.isBookmarked;
  let label = saved ? '★ 북마크됨' : '☆ 북마크하기';
  if (toggle.isPending) label = toggle.variables ? '저장하는 중…' : '해제하는 중…';

  return (
    <div className="bookmark-control">
      <button
        type="button"
        className={`button button--small bookmark-button${saved ? ' bookmark-button--on' : ' button--ghost'}`}
        aria-pressed={saved}
        disabled={toggle.isPending}
        onClick={() => {
          if (inFlight.current) return;
          inFlight.current = true;
          setMessage(null);
          toggle.mutate(!saved);
        }}
      >
        {label}
      </button>
      {message?.kind === 'success' && (
        <p className="bookmark-control__status" role="status">
          {message.saved ? (
            <>
              북마크에 저장했습니다. <Link to="/me/bookmarks">내 북마크 보기</Link>
            </>
          ) : (
            '북마크를 해제했습니다.'
          )}
        </p>
      )}
      {message?.kind === 'error' && (
        <p className="form-field__error" role="alert">
          {message.text}
        </p>
      )}
    </div>
  );
}
