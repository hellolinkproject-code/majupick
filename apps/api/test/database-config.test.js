import { describe, expect, it } from 'vitest';
import {
  DatabaseConfigError,
  describeDatabase,
  getDatabaseConfig,
} from '../src/config/database.js';

const base = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgresql://app:secret@localhost:5432/workbridge_dev',
  TEST_DATABASE_URL: 'postgresql://app:secret@localhost:5432/workbridge_test',
  SHADOW_DATABASE_URL: 'postgresql://app:secret@localhost:5432/workbridge_shadow',
};

describe('getDatabaseConfig', () => {
  it('returns the parsed development database without exposing credentials in the description', () => {
    const info = getDatabaseConfig('development', base);

    expect(info.database).toBe('workbridge_dev');
    expect(describeDatabase(info)).toBe('workbridge_dev@localhost:5432');
    expect(describeDatabase(info)).not.toContain('secret');
  });

  it('fails with a clear message when the URL is missing', () => {
    expect(() => getDatabaseConfig('development', { NODE_ENV: 'development' })).toThrow(
      /DATABASE_URL is not set/,
    );
    expect(getDatabaseConfig('development', { NODE_ENV: 'development' }, { optional: true })).toBe(
      null,
    );
  });

  it('rejects DATABASE_URL pointing to the test database even when only the test DB is requested', () => {
    const env = { ...base, DATABASE_URL: base.TEST_DATABASE_URL };

    expect(() => getDatabaseConfig('test', env)).toThrow(DatabaseConfigError);
  });

  it('enforces database name suffixes so tests cannot target the development database', () => {
    expect(() =>
      getDatabaseConfig('test', {
        ...base,
        TEST_DATABASE_URL: base.DATABASE_URL.replace('workbridge_dev', 'workbridge'),
      }),
    ).toThrow(/must end with "_test"/);
    expect(() =>
      getDatabaseConfig('development', { ...base, DATABASE_URL: base.SHADOW_DATABASE_URL }),
    ).toThrow(DatabaseConfigError);
  });

  it('refuses the development database inside the test runtime', () => {
    expect(() => getDatabaseConfig('development', { ...base, NODE_ENV: 'test' })).toThrow(
      /Tests must not use DATABASE_URL/,
    );
    // Prisma generate는 URL이 필수가 아니므로 optional이면 연결 없이 null만 허용한다.
    expect(
      getDatabaseConfig('development', { ...base, NODE_ENV: 'test' }, { optional: true }),
    ).toBe(null);
    expect(getDatabaseConfig('test', { ...base, NODE_ENV: 'test' }).database).toBe(
      'workbridge_test',
    );
  });

  it('rejects non-local hosts unless explicitly allowed, and non-postgres URLs', () => {
    const remote = {
      ...base,
      DATABASE_URL: 'postgresql://app:secret@db.example.com:5432/workbridge_dev',
    };

    expect(() => getDatabaseConfig('development', remote)).toThrow(/non-local host/);
    expect(
      getDatabaseConfig('development', { ...remote, ALLOW_REMOTE_DATABASE: 'true' }).host,
    ).toBe('db.example.com');
    expect(() =>
      getDatabaseConfig('development', {
        ...base,
        DATABASE_URL: 'mysql://localhost/workbridge_dev',
      }),
    ).toThrow(/postgresql:\/\//);
  });

  it('never includes the password in error messages', () => {
    const env = { ...base, TEST_DATABASE_URL: 'postgresql://app:secret@localhost:5432/other' };

    try {
      getDatabaseConfig('test', env);
      expect.unreachable();
    } catch (error) {
      expect(error.message).not.toContain('secret');
    }
  });
});
