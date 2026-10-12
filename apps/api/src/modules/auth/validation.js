import { HttpError } from '../../utils/httpError.js';

export const USER_ROLES = Object.freeze(['CLIENT', 'FREELANCER']);
export const NAME_MAX_LENGTH = 50;
export const EMAIL_MAX_LENGTH = 255;
// D-60(제안): 8자 이상만 요구한다. 72바이트 상한은 정책이 아니라 bcrypt가 그 뒤를 무시하는 기술적 한계다.
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_BYTES = 72;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function passwordByteLength(value) {
  return Buffer.byteLength(value, 'utf8');
}

function validationError(fields) {
  return new HttpError(400, 'VALIDATION_ERROR', '입력값을 확인해 주세요.', { fields });
}

function checkEmail(email, fields) {
  if (!email) fields.email = '이메일을 입력해 주세요.';
  else if (email.length > EMAIL_MAX_LENGTH || !EMAIL_PATTERN.test(email)) {
    fields.email = '올바른 이메일 형식이 아닙니다.';
  }
}

/** AUTH-01 요청 검증. 통과하면 정규화된 값을 돌려준다. */
export function validateSignup(body) {
  const input = body ?? {};
  const fields = {};

  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name) fields.name = '이름을 입력해 주세요.';
  else if (name.length > NAME_MAX_LENGTH)
    fields.name = `이름은 ${NAME_MAX_LENGTH}자 이하로 입력해 주세요.`;

  const email = normalizeEmail(input.email);
  checkEmail(email, fields);

  const password = typeof input.password === 'string' ? input.password : '';
  if (!password) fields.password = '비밀번호를 입력해 주세요.';
  else if (password.length < PASSWORD_MIN_LENGTH) {
    fields.password = `비밀번호는 ${PASSWORD_MIN_LENGTH}자 이상이어야 합니다.`;
  } else if (passwordByteLength(password) > PASSWORD_MAX_BYTES) {
    fields.password = `비밀번호가 너무 깁니다(최대 ${PASSWORD_MAX_BYTES}바이트).`;
  }

  if (!USER_ROLES.includes(input.role)) fields.role = '의뢰인 또는 프리랜서를 선택해 주세요.';

  if (Object.keys(fields).length > 0) throw validationError(fields);
  return { name, email, password, role: input.role };
}

/** AUTH-02 요청 검증. 비밀번호 규칙은 검사하지 않는다(가입 때 검사함). */
export function validateLogin(body) {
  const input = body ?? {};
  const fields = {};

  const email = normalizeEmail(input.email);
  checkEmail(email, fields);
  const password = typeof input.password === 'string' ? input.password : '';
  if (!password) fields.password = '비밀번호를 입력해 주세요.';

  if (Object.keys(fields).length > 0) throw validationError(fields);
  return { email, password };
}
