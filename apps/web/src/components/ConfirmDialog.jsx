import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * 되돌릴 수 없는 동작의 확인 창(D-50). 열리면 안전한 쪽(돌아가기) 버튼으로 포커스를 옮기고,
 * Tab·Shift+Tab은 창 안에서만 돈다. 요청 중이 아니면 Escape로 닫힌다. 닫히면 연 버튼으로 포커스를 돌려주고,
 * 그 버튼이 사라졌으면(처리 후 동작이 없어진 경우) 본문(#main-content)으로 옮긴다.
 * 요청 중에는 두 버튼을 모두 잠가 중복 제출을 막는다. 배경 화면은 그대로 두며 창은 body에 그린다.
 */
export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  pendingLabel,
  cancelLabel = '취소',
  pending = false,
  error = '',
  danger = false,
  onConfirm,
  onCancel,
}) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef(null);
  const cancelRef = useRef(null);
  const openerRef = useRef(null);
  // pending이 화면에 반영되기 전 같은 순간의 두 번째 클릭도 막는다. 요청이 끝나면(실패 후 재시도) 다시 연다.
  const submitted = useRef(false);

  useEffect(() => {
    if (!pending) submitted.current = false;
  }, [pending]);

  // 주소창 등에서 Tab으로 다시 들어와 배경으로 간 포커스도 창 안으로 되돌린다.
  // 아래 효과보다 먼저 선언해야 닫힐 때 이 감시가 먼저 풀려, 연 버튼으로 포커스를 돌려줄 수 있다.
  useEffect(() => {
    function keepFocusInside(event) {
      const dialog = dialogRef.current;
      if (!dialog || dialog.contains(event.target)) return;
      const cancel = cancelRef.current;
      (cancel && !cancel.disabled ? cancel : dialog).focus();
    }
    document.addEventListener('focusin', keepFocusInside);
    return () => document.removeEventListener('focusin', keepFocusInside);
  }, []);

  useEffect(() => {
    openerRef.current = document.activeElement;
    cancelRef.current?.focus();
    return () => {
      const opener = openerRef.current;
      const target =
        opener instanceof HTMLElement &&
        opener !== document.body &&
        opener.isConnected &&
        !opener.hasAttribute('disabled')
          ? opener
          : document.getElementById('main-content');
      target?.focus?.();
    };
  }, []);

  // 요청 중에는 눌렀던 버튼이 잠기면서 포커스가 창 밖(body)으로 빠지지 않게 창에 둔다.
  useEffect(() => {
    if (pending && !dialogRef.current?.contains(document.activeElement)) {
      dialogRef.current?.focus();
    }
  }, [pending]);

  function handleKeyDown(event) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      if (!pending) onCancel();
      return;
    }
    if (event.key !== 'Tab') return;
    const items = [...dialogRef.current.querySelectorAll(FOCUSABLE)];
    if (items.length === 0) {
      event.preventDefault();
      dialogRef.current.focus();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const inside = items.includes(document.activeElement);
    if (event.shiftKey && (document.activeElement === first || !inside)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !inside)) {
      event.preventDefault();
      first.focus();
    }
  }

  return createPortal(
    <div className="dialog-backdrop">
      <div
        ref={dialogRef}
        className="dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        aria-busy={pending}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <h2 id={titleId} className="dialog__title">
          {title}
        </h2>
        <div id={descriptionId} className="dialog__body">
          {children}
        </div>
        {error && (
          <p className="form-field__error" role="alert">
            {error}
          </p>
        )}
        <div className="funnel-actions">
          <button
            ref={cancelRef}
            type="button"
            className="button button--ghost"
            onClick={onCancel}
            disabled={pending}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className={danger ? 'button button--danger' : 'button'}
            onClick={() => {
              if (pending || submitted.current) return;
              submitted.current = true;
              onConfirm();
            }}
            disabled={pending}
          >
            {pending ? pendingLabel : confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
