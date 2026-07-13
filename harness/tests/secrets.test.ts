import { describe, expect, it } from 'vitest';
import { redactSecrets } from '../src/secrets.js';

describe('redactSecrets', () => {
  it('masks credential-looking assignments', () => {
    const out = redactSecrets('API_KEY=sk-abc123def456ghi789\nnormal line');
    expect(out).not.toContain('sk-abc123def456ghi789');
    expect(out).toContain('[REDACTED]');
    expect(out).toContain('normal line');
  });

  it('masks private key blocks', () => {
    const out = redactSecrets(
      'before\n-----BEGIN RSA PRIVATE KEY-----\nMIIEow...\n-----END RSA PRIVATE KEY-----\nafter',
    );
    expect(out).not.toContain('MIIEow');
    expect(out).toContain('before');
    expect(out).toContain('after');
  });

  it('masks bare token-shaped strings', () => {
    const out = redactSecrets('used ghp-0123456789abcdef0123 to auth');
    expect(out).not.toContain('ghp-0123456789abcdef0123');
  });

  it('leaves ordinary test output alone', () => {
    const text = '✔ 12 passed\nℹ duration_ms 134\nnpm test exit 0';
    expect(redactSecrets(text)).toBe(text);
  });
});
