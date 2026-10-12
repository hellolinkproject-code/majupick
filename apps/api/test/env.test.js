import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config/env.js';

describe('loadConfig', () => {
  it('uses defaults when variables are missing', () => {
    const config = loadConfig({});

    expect(config).toEqual({
      nodeEnv: 'development',
      port: 4000,
      corsOrigins: ['http://localhost:5173'],
    });
  });

  it('parses port and comma-separated origins', () => {
    const config = loadConfig({
      API_PORT: '5000',
      CORS_ORIGIN: 'http://a.test, http://b.test',
    });

    expect(config.port).toBe(5000);
    expect(config.corsOrigins).toEqual(['http://a.test', 'http://b.test']);
  });

  it('rejects an invalid port', () => {
    expect(() => loadConfig({ API_PORT: 'abc' })).toThrow(/API_PORT/);
  });
});
