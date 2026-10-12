import { describe, expect, it } from 'vitest';
import { loginPathFor, safeReturnTo } from './returnTo.js';

describe('safeReturnTo', () => {
  it('keeps internal paths with query and hash', () => {
    expect(safeReturnTo('/me')).toBe('/me');
    expect(safeReturnTo('/projects?page=2#top')).toBe('/projects?page=2#top');
  });

  it.each([
    ['external URL', 'https://evil.example/phish'],
    ['protocol-relative URL', '//evil.example'],
    ['backslash trick', '/\\evil.example'],
    ['javascript scheme', 'javascript:alert(1)'],
    ['control character', '/\t/evil.example'],
    ['relative path', 'me'],
    ['login page loop', '/login?returnTo=/me'],
    ['signup page', '/signup'],
    ['missing value', null],
  ])('falls back for %s', (_label, value) => {
    expect(safeReturnTo(value)).toBe('/');
  });
});

describe('loginPathFor', () => {
  it('encodes the current location as returnTo', () => {
    expect(loginPathFor({ pathname: '/me', search: '?tab=1', hash: '' })).toBe(
      '/login?returnTo=%2Fme%3Ftab%3D1',
    );
    expect(loginPathFor({ pathname: '/', search: '', hash: '' })).toBe('/login');
  });
});
