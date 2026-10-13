import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { parseApiError } from '../../lib/authApi.js';

/**
 * 프로필 폼 공통 저장 흐름: 화면 검사 → 저장(중복 제출 방지) → 성공/실패 안내.
 * 서버 VALIDATION_ERROR의 항목별 메시지는 각 입력 아래에 보여 준다.
 */
export function useProfileSave({ save, validate, onSaved }) {
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [notice, setNotice] = useState('');

  const mutation = useMutation({
    mutationFn: save,
    onSuccess: (user) => {
      onSaved?.(user);
      setNotice('저장했습니다.');
    },
    onError: (error) => {
      const apiError = parseApiError(error);
      if (apiError.code === 'VALIDATION_ERROR' && Object.keys(apiError.fields).length > 0) {
        setErrors(apiError.fields);
      } else {
        setFormError(apiError.message);
      }
    },
  });

  function submit(form, payload) {
    if (mutation.isPending) return;
    setFormError('');
    setNotice('');
    const nextErrors = validate(form);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      setFormError('입력한 내용을 확인해 주세요.');
      return;
    }
    mutation.mutate(payload());
  }

  /** 입력을 바꾸면 이전 저장 결과 안내를 지운다. */
  function touched() {
    if (notice) setNotice('');
  }

  return { errors, formError, notice, isSaving: mutation.isPending, submit, touched };
}
