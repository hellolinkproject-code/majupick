function FieldLabel({ id, label, required }) {
  return (
    <label htmlFor={id}>
      {label}
      {required !== undefined && (
        <span
          className={
            required ? 'form-field__badge form-field__badge--required' : 'form-field__badge'
          }
        >
          {required ? '필수' : '선택'}
        </span>
      )}
    </label>
  );
}

function describedBy(id, error, hint) {
  const ids = [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean);
  return ids.length > 0 ? ids.join(' ') : undefined;
}

function FieldMessages({ id, error, hint }) {
  return (
    <>
      {hint && (
        <p id={`${id}-hint`} className="form-field__hint">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="form-field__error">
          {error}
        </p>
      )}
    </>
  );
}

/**
 * 라벨·입력·오류 메시지를 한 묶음으로 그린다. 오류·도움말은 aria-describedby로 입력과 연결한다.
 * `required`를 주면 라벨에 필수/선택 표시를 붙인다(브라우저 기본 검사는 쓰지 않는다).
 */
export function FormField({ id, label, error, hint, required, ...inputProps }) {
  return (
    <div className="form-field">
      <FieldLabel id={id} label={label} required={required} />
      <input
        id={id}
        name={id}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={describedBy(id, error, hint)}
        {...inputProps}
      />
      <FieldMessages id={id} error={error} hint={hint} />
    </div>
  );
}

export function SelectField({ id, label, error, hint, required, options, placeholder, ...props }) {
  return (
    <div className="form-field">
      <FieldLabel id={id} label={label} required={required} />
      <select
        id={id}
        name={id}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={describedBy(id, error, hint)}
        {...props}
      >
        <option value="">{placeholder}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <FieldMessages id={id} error={error} hint={hint} />
    </div>
  );
}

export function TextAreaField({ id, label, error, hint, required, ...props }) {
  return (
    <div className="form-field">
      <FieldLabel id={id} label={label} required={required} />
      <textarea
        id={id}
        name={id}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={describedBy(id, error, hint)}
        {...props}
      />
      <FieldMessages id={id} error={error} hint={hint} />
    </div>
  );
}
