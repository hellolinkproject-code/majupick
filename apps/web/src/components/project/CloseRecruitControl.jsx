import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { projectApplicationsKey } from '../../lib/applicationApi.js';
import { parseApiError } from '../../lib/authApi.js';
import { closeProject } from '../../lib/projectApi.js';

/**
 * STAT-01 수동 모집 마감. 확인을 한 번 더 받은 뒤 서버가 성공하면 결과(자동 거절·알림 수)를 보여 준다.
 * 마감 후에는 재모집을 지원하지 않는다(D-09). 버튼은 서버가 준 availableActions에 CLOSE가 있을 때만 그린다.
 * onClosed(message): 성공 문구를 부모가 보여 준다(마감 후 이 버튼은 사라진다).
 */
export function CloseRecruitControl({ project, onClosed }) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const close = useMutation({
    mutationFn: () => closeProject(project.id),
    onSuccess: (result) => {
      setConfirming(false);
      onClosed?.(closeResultMessage(result));
      return Promise.all([
        queryClient.invalidateQueries({ queryKey: ['project', String(project.id)] }),
        queryClient.invalidateQueries({ queryKey: projectApplicationsKey(project.id) }),
        queryClient.invalidateQueries({ queryKey: ['my-projects'] }),
        queryClient.invalidateQueries({ queryKey: ['project-search'] }),
      ]);
    },
  });

  if (!confirming) {
    return (
      <button type="button" className="button button--ghost" onClick={() => setConfirming(true)}>
        모집 마감
      </button>
    );
  }
  const titleId = `close-confirm-title-${project.id}`;
  return (
    <div className="confirm-box confirm-box--accept" role="alertdialog" aria-labelledby={titleId}>
      <p id={titleId}>
        <strong>‘{project.title}’ 모집을 지금 마감할까요?</strong>
      </p>
      <p>
        검토 대기 중인 지원은 모두 자동으로 거절되고, 지원자 전원에게 마감 알림이 갑니다. 마감
        후에는 다시 모집할 수 없습니다.
      </p>
      {close.isError && (
        <p className="form-field__error" role="alert">
          {parseApiError(close.error).message}
        </p>
      )}
      <div className="funnel-actions">
        <button
          type="button"
          className="button button--ghost"
          onClick={() => setConfirming(false)}
          disabled={close.isPending}
        >
          취소
        </button>
        <button
          type="button"
          className="button"
          onClick={() => close.mutate()}
          disabled={close.isPending}
        >
          {close.isPending ? '마감하는 중…' : '마감 확인'}
        </button>
      </div>
    </div>
  );
}

/** 마감 성공 문구. 서버가 실제로 처리한 숫자만 보여 준다. */
function closeResultMessage({ rejectedCount, notifiedCount }) {
  const parts = ['모집을 마감했습니다.'];
  if (rejectedCount > 0) parts.push(`검토 대기 지원 ${rejectedCount}건을 자동으로 거절했습니다.`);
  if (notifiedCount > 0) parts.push(`지원자 ${notifiedCount}명에게 마감 알림을 보냈습니다.`);
  return parts.join(' ');
}
