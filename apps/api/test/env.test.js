import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config/env.js';

describe('loadConfig', () => {
  it('uses defaults when variables are missing', () => {
    const config = loadConfig({});

    expect(config).toEqual({
      nodeEnv: 'development',
      host: '0.0.0.0',
      port: 4000,
      corsOrigins: ['http://localhost:5173'],
      trustProxy: false,
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

  it('prefers platform PORT over API_PORT and enables trust proxy in production', () => {
    const config = loadConfig({
      NODE_ENV: 'production',
      PORT: '10000',
      API_PORT: '4000',
      HOST: '127.0.0.1',
    });

    expect(config).toMatchObject({
      nodeEnv: 'production',
      host: '127.0.0.1',
      port: 10000,
      trustProxy: true,
    });
  });

  it('rejects an invalid port', () => {
    expect(() => loadConfig({ API_PORT: 'abc' })).toThrow(/API_PORT/);
    expect(() => loadConfig({ PORT: '0' })).toThrow(/PORT/);
  });
});
