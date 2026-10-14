import { describe, expect, it } from 'vitest';
import { notificationKeys } from './notificationApi.js';
import { badgeText, formatNotificationTime, safeNotificationPath } from './notificationLinks.js';

describe('safeNotificationPath', () => {
  it('keeps only the internal pages notifications point to', () => {
    for (const path of [
      '/projects/41#applicants',
      '/projects/41',
      '/me/applications',
      '/me/projects',
    ]) {
      expect(safeNotificationPath(path)).toBe(path);
    }
  });

  it('refuses external, protocol-relative and manipulated paths', () => {
    for (const value of [
      'https://evil.example',
      '//evil.example',
      '/\\evil.example',
      'javascript:alert(1)',
      '/projects/41/../../logout',
      '/me/applications?returnTo=//evil.example',
      '/projects/abc',
      ' /me/applications',
      null,
      undefined,
    ]) {
      expect(safeNotificationPath(value)).toBeNull();
    }
  });
});

describe('notification display helpers', () => {
  it('shortens large badge counts and formats times in KST', () => {
    expect(badgeText(3)).toBe('3');
    expect(badgeText(100)).toBe('99+');
    expect(formatNotificationTime('2026-10-14T15:30:00.000Z')).toMatch(/2026.*10.*15.*00:30/);
  });

  it('keys the cache by user so another account never sees cached notifications', () => {
    expect(notificationKeys.list(7, 1)).not.toEqual(notificationKeys.list(8, 1));
    expect(notificationKeys.unreadCount(7).slice(0, 2)).toEqual(notificationKeys.all(7));
  });
});
