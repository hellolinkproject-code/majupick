/** 프로필 폼 저장 결과(실패는 alert, 성공은 status). */
export function SaveFeedback({ formError, notice }) {
  return (
    <>
      {formError && (
        <p className="form-alert" role="alert">
          {formError}
        </p>
      )}
      {notice && (
        <p className="form-success" role="status">
          {notice}
        </p>
      )}
    </>
  );
}
