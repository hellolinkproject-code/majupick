import { afterEach } from 'vitest';
import { cleanup, configure } from '@testing-library/react';
import { resetRefreshStateForTests } from '../lib/apiClient.js';
import { useSessionStore } from '../stores/useSessionStore.js';

// 세션 복원(POST /auth/refresh) + 첫 목록/상세 요청이 기본 1000ms를 넘기는 경우가 있다.
// STEP 08-A: 부하 시 ~1.6s. STEP 10-B/11: jsdom·전체 스위트에서 3s를 넘기는 경우가 있어
// 대기만 맞춘다(단언 기준은 그대로).
configure({ asyncUtilTimeout: 8_000 });

// Layout의 restoreSession이 테스트 경계를 넘어 세션을 덮어쓰지 않게 공통으로 정리한다.
afterEach(() => {
  resetRefreshStateForTests();
  useSessionStore.setState({ status: 'idle', accessToken: null, user: null });
  cleanup();
});
