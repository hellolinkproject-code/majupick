import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { parseApiError } from '../../lib/authApi.js';
import { validateImageFile } from '../../lib/profileForm.js';
import { profileImageSrc, removeProfileImage, uploadProfileImage } from '../../lib/profileApi.js';

/** PROF-04. 고른 파일은 미리보기로 먼저 보여 주고, 업로드를 눌러야 저장한다. */
export function ProfileImageField({ user }) {
  const inputRef = useRef(null);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (!preview) return undefined;
    return () => URL.revokeObjectURL?.(preview);
  }, [preview]);

  function resetSelection() {
    setFile(null);
    setPreview('');
    if (inputRef.current) inputRef.current.value = '';
  }

  const onError = (requestError) => {
    setNotice('');
    setError(parseApiError(requestError).message);
  };
  const upload = useMutation({
    mutationFn: uploadProfileImage,
    onSuccess: () => {
      resetSelection();
      setNotice('프로필 이미지를 저장했습니다.');
    },
    onError: (requestError) => {
      resetSelection();
      onError(requestError);
    },
  });
  const remove = useMutation({
    mutationFn: removeProfileImage,
    onSuccess: () => setNotice('프로필 이미지를 삭제했습니다.'),
    onError,
  });
  const busy = upload.isPending || remove.isPending;

  function handleChoose(event) {
    const chosen = event.target.files?.[0];
    setNotice('');
    setError('');
    if (!chosen) {
      resetSelection();
      return;
    }
    const message = validateImageFile(chosen);
    if (message) {
      resetSelection();
      setError(message);
      return;
    }
    setFile(chosen);
    setPreview(URL.createObjectURL?.(chosen) ?? '');
  }

  const src = preview || profileImageSrc(user.profileImageUrl);

  return (
    <div className="profile-image">
      {src ? (
        <img
          className="profile-image__avatar"
          src={src}
          alt={preview ? '선택한 이미지 미리보기' : '프로필 이미지'}
        />
      ) : (
        <div
          className="profile-image__avatar profile-image__placeholder"
          role="img"
          aria-label="기본 프로필 이미지"
        >
          {user.name.trim().charAt(0) || '?'}
        </div>
      )}
      <div className="profile-image__body">
        <div className="form-field">
          <label htmlFor="profileImage">
            프로필 이미지<span className="form-field__badge">선택</span>
          </label>
          <input
            ref={inputRef}
            id="profileImage"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            aria-describedby="profileImage-hint"
            onChange={handleChoose}
            disabled={busy}
          />
          <p id="profileImage-hint" className="form-field__hint">
            JPG, PNG, WebP · 5MB 이하. 저장할 때 512px 이하 WebP로 바꾸고 위치 정보 등은 지웁니다.
          </p>
        </div>
        <div className="profile-image__actions">
          {file ? (
            <>
              <button
                type="button"
                className="button button--small"
                onClick={() => upload.mutate(file)}
                disabled={busy}
              >
                {upload.isPending ? '올리는 중…' : '이미지 저장'}
              </button>
              <button
                type="button"
                className="button button--small button--ghost"
                onClick={resetSelection}
                disabled={busy}
              >
                선택 취소
              </button>
            </>
          ) : (
            user.profileImageUrl && (
              <button
                type="button"
                className="button button--small button--ghost"
                onClick={() => remove.mutate()}
                disabled={busy}
              >
                {remove.isPending ? '삭제하는 중…' : '이미지 삭제'}
              </button>
            )
          )}
        </div>
        {error && (
          <p className="form-field__error" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="form-success" role="status">
            {notice}
          </p>
        )}
      </div>
    </div>
  );
}
