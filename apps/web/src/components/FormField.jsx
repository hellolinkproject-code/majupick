/** 라벨·입력·오류 메시지를 한 묶음으로 그린다. 오류는 aria-describedby로 입력과 연결한다. */
export function FormField({ id, label, error, ...inputProps }) {
  const errorId = `${id}-error`;
  return (
    <div className="form-field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        name={id}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={error ? errorId : undefined}
        {...inputProps}
      />
      {error && (
        <p id={errorId} className="form-field__error">
          {error}
        </p>
      )}
    </div>
  );
}
