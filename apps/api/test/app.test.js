import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config/env.js';

const app = createApp(loadConfig({ CORS_ORIGIN: 'http://localhost:5173' }));

describe('GET /api/health', () => {
  it('returns 200 with status ok', async () => {
    const res = await request(app).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: 'ok', service: 'workbridge-api' });
    expect(Number.isNaN(Date.parse(res.body.data.timestamp))).toBe(false);
  });

  it('allows the configured frontend origin with credentials', async () => {
    const res = await request(app).get('/api/health').set('Origin', 'http://localhost:5173');

    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  it('does not allow other origins', async () => {
    const res = await request(app).get('/api/health').set('Origin', 'http://evil.example');

    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('error handling', () => {
  it('returns 404 NOT_FOUND for unknown routes', async () => {
    const res = await request(app).get('/api/does-not-exist');

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('returns 400 VALIDATION_ERROR for malformed JSON', async () => {
    const res = await request(app)
      .post('/api/health')
      .set('Content-Type', 'application/json')
      .send('{"broken":');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});
