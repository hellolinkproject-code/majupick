import { describe, expect, it } from 'vitest';
import { requestKey } from './mockApi.js';

describe('requestKey', () => {
  it('normalizes method, baseURL prefix, and query string', () => {
    expect(requestKey({ method: 'get', url: '/me/projects', params: { page: 1 } })).toBe(
      'GET /me/projects',
    );
    expect(requestKey({ method: 'GET', url: '/me/projects?page=1', baseURL: '/api' })).toBe(
      'GET /me/projects',
    );
    expect(requestKey({ method: 'post', url: '/api/auth/refresh', baseURL: '/api' })).toBe(
      'POST /auth/refresh',
    );
  });
});
