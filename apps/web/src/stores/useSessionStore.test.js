import { beforeEach, describe, expect, it } from 'vitest';
import { useSessionStore } from './useSessionStore.js';

describe('useSessionStore', () => {
  beforeEach(() => {
    useSessionStore.getState().clearSession();
  });

  it('starts without a session', () => {
    expect(useSessionStore.getState()).toMatchObject({ accessToken: null, user: null });
  });

  it('sets and clears the session', () => {
    useSessionStore.getState().setSession({ accessToken: 'token', user: { id: 1 } });
    expect(useSessionStore.getState()).toMatchObject({ accessToken: 'token', user: { id: 1 } });

    useSessionStore.getState().clearSession();
    expect(useSessionStore.getState()).toMatchObject({ accessToken: null, user: null });
  });
});
