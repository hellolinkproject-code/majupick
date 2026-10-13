const OAUTH_ERROR_MESSAGES = Object.freeze({
  OAUTH_FAILED: 'Google 로그인에 실패했습니다. 다시 시도해 주세요.',
  OAUTH_EMAIL_UNVERIFIED: 'Google 계정의 이메일이 인증되지 않아 로그인할 수 없습니다.',
  OAUTH_CANCELLED: 'Google 로그인을 취소했습니다.',
  OAUTH_EXPIRED: 'Google 로그인 요청 시간이 지났습니다. 다시 시도해 주세요.',
  OAUTH_LINK_UNAVAILABLE:
    '이 계정은 비밀번호로 소유를 확인할 수 없어 Google 계정을 연결할 수 없습니다. 기존 로그인 방법을 이용해 주세요.',
});

/** 콜백이 넘긴 오류 코드만 문구로 바꾼다. 알 수 없는 값은 그대로 화면에 넣지 않는다. */
export function oauthErrorMessage(code) {
  return OAUTH_ERROR_MESSAGES[code] ?? '';
}
