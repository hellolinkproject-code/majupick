import { describe, expect, it } from 'vitest';
import { apiClient } from './apiClient.js';

describe('apiClient', () => {
  it('targets the same-origin /api path and sends cookies', () => {
    expect(apiClient.defaults.baseURL).toBe('/api');
    expect(apiClient.defaults.withCredentials).toBe(true);
  });
});
