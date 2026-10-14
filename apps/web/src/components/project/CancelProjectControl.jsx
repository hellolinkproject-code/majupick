import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ConfirmDialog } from '../ConfirmDialog.jsx';
import { projectApplicationsKey } from '../../lib/applicationApi.js';
import { parseApiError } from '../../lib/authApi.js';
import { cancelProject } from '../../lib/projectApi.js';

/**
 * STAT-02 프로젝트 취소(계약 체결 전만, A-27). 삭제와 다른 동작이다: 프로젝트는 '취소' 상태로 남고
 * 대기 지원은 '프로젝트 취소'로 거절되며, 선정·거절 이력은 그대로 둔다. 버튼은 availableActions에 CANCEL이 있을 때만 그린다.
 * onCancelled(message): 성공 문구를 부모가 보여 준다(취소 후 이 버튼은 사라진다).
 */
export function CancelProjectControl({ project, onCancelled }) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['project', String(project.id)] }),
      queryClient.invalidateQueries({ queryKey: projectApplicationsKey(project.id) }),
      queryClient.invalidateQueries({ queryKey: ['my-projects'] }),
      queryClient.invalidateQueries({ queryKey: ['project-search'] }),
      queryClient.invalidateQueries({ queryKey: ['project-recommendations'] }),
    ]);
  // 새 목록을 받은 뒤 창을 닫는다. 이 버튼이 목록에서 사라지면 창이 포커스를 본문으로 옮긴다.
  const cancel = useMutation({
    mutationFn: () => cancelProject(project.id),
    onSuccess: async (result) => {
      onCancelled?.(cancelResultMessage(result));
      await refresh();
      setConfirming(false);
    },
  });
  // 실패하면 오류 문구를 창에 남기고, 창을 닫을 때 서버 상태(다른 탭의 취소·선정)로 다시 그린다.
  const closeDialog = () => {
    setConfirming(false);
    if (cancel.isError) refresh();
  };

  const pendingCount = project.pendingApplicantCount ?? 0;
  return (
    <>
      <button
        type="button"
        className="button button--ghost button--danger-text"
        onClick={() => {
          cancel.reset();
          setConfirming(true);
        }}
      >
        프로젝트 취소
      </button>
      {confirming && (
        <ConfirmDialog
          title={`‘${project.title}’ 프로젝트를 취소할까요?`}
          cancelLabel="돌아가기"
          confirmLabel="프로젝트 취소 확정"
          pendingLabel="취소하는 중…"
          danger
          pending={cancel.isPending}
          error={cancel.isError ? parseApiError(cancel.error).message : ''}
          onCancel={closeDialog}
          onConfirm={() => cancel.mutate()}
        >
          <p>
            취소하면 새 지원을 받지 않고, 다시 모집하거나 수정·삭제할 수 없습니다. 프로젝트 기록은
            &lsquo;취소&rsquo; 상태로 남습니다.
          </p>
          <p>
            {pendingCount > 0
              ? `검토 대기 중인 지원 ${pendingCount}건은 ‘프로젝트 취소’ 사유로 자동 거절됩니다.`
              : '검토 대기 중인 지원은 없습니다.'}
          </p>
          {project.status === 'CONTRACTING' && (
            <p>
              아직 계약이 체결되지 않아 취소할 수 있습니다. 이미 선정한 지원자의 선정 이력은 그대로
              남고, 지원자 화면에 프로젝트 취소가 함께 표시됩니다.
            </p>
          )}
          <p className="form-field__hint">
            지원자에게 별도 취소 알림은 보내지 않습니다. 지원자는 내 지원 현황에서 취소 사실을
            확인합니다.
          </p>
        </ConfirmDialog>
      )}
    </>
  );
}

/** 취소 성공 문구. 서버가 실제로 처리한 숫자만 보여 준다. */
function cancelResultMessage({ rejectedCount, keptAcceptedCount }) {
  const parts = ['프로젝트를 취소했습니다.'];
  if (rejectedCount > 0) parts.push(`검토 대기 지원 ${rejectedCount}건을 자동으로 거절했습니다.`);
  if (keptAcceptedCount > 0) parts.push('선정한 지원자의 선정 이력은 그대로 남습니다.');
  return parts.join(' ');
}
