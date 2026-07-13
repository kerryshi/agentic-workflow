import { describe, expect, it } from 'vitest';
import { localIso, runId, slugify } from '../src/ids.js';

describe('slugify', () => {
  it('lowercases and dashes non-alphanumerics', () => {
    expect(slugify('Fix the NavBar test!')).toBe('fix-the-navbar-test');
  });
  it('truncates without a trailing dash', () => {
    const slug = slugify('a'.repeat(30) + ' ' + 'b'.repeat(30));
    expect(slug.length).toBeLessThanOrEqual(48);
    expect(slug.endsWith('-')).toBe(false);
  });
  it('never returns empty', () => {
    expect(slugify('!!!')).toBe('task');
  });
});

describe('runId', () => {
  it('matches the v1 scripts id format', () => {
    const id = runId('Fix navbar', new Date(2026, 6, 10, 19, 59));
    expect(id).toBe('2026-07-10_1959_fix-navbar');
    expect(id).toMatch(/^\d{4}-\d{2}-\d{2}_\d{4}_[a-z0-9-]+$/);
  });
});

describe('localIso', () => {
  it('includes a numeric offset, not Z', () => {
    expect(localIso(new Date())).toMatch(/[+-]\d{2}:\d{2}$/);
  });
});
