import { describe, it, expect } from 'vitest';
import { isPublicAddress, publicUrl, resolvePublic } from '../../src/security/url.js';
import { Redactor } from '../../src/security/redact.js';

describe('public network boundary', () => {
  it.each([
    '127.0.0.1',
    '10.0.0.1',
    '172.16.0.1',
    '192.168.1.1',
    '169.254.169.254',
    '100.100.100.200',
    '0.0.0.0',
    '192.0.2.1',
    '198.18.0.1',
    '224.0.0.1',
    '255.255.255.255',
    '::1',
    '::',
    'fe80::1',
    'fc00::1',
    '::ffff:127.0.0.1',
    '::ffff:8.8.8.8',
    '2002:7f00:1::',
    '2001:db8::1',
    '2001::1',
    '3fff::1',
    '64:ff9b::7f00:1',
    '64:ff9b::a9fe:a9fe',
    '64:ff9b::a00:1',
    '64:ff9b:1::808:808',
    'garbage',
  ])('blocks non-public address %s', (address) => expect(isPublicAddress(address)).toBe(false));
  it.each([
    '8.8.8.8',
    '1.1.1.1',
    '2606:4700:4700::1111',
    '2001:4860:4860::8888',
    '64:ff9b::808:808',
  ])('permits global address %s', (address) => expect(isPublicAddress(address)).toBe(true));
  it.each([
    'http://localhost',
    'http://2130706433',
    'http://0x7f000001',
    'http://127.1',
    'http://[::1]',
    'http://[::ffff:127.0.0.1]',
    'http://metadata.google.internal',
    'file:///etc/passwd',
    'ftp://example.com',
    'https://a:b@example.com',
    'https://example.com:8443',
    'https://example.com\\@evil.com',
    'http://instance-data',
    'http://something.local',
    'http://printer',
    'https://example.com/\nfoo',
    'bogus',
  ])('rejects unsafe URL %s', (url) => expect(() => publicUrl(url)).toThrow());
  it('normalizes public URLs and removes fragments', () =>
    expect(publicUrl('https://example.com/path#fragment').href).toBe('https://example.com/path'));
  it('rejects mixed public/private DNS and empty results', async () => {
    await expect(
      resolvePublic('example.com', async () => [
        { address: '8.8.8.8', family: 4 },
        { address: '127.0.0.1', family: 4 },
      ]),
    ).rejects.toThrow();
    await expect(resolvePublic('example.com', async () => [])).rejects.toThrow();
    expect(
      await resolvePublic('example.com', async () => [{ address: '8.8.8.8', family: 4 }]),
    ).toHaveLength(1);
  });
  it('redacts registered secrets, URL credentials and bearer values', () => {
    const redactor = new Redactor();
    redactor.add('test-secret');
    expect(
      redactor.text('test-secret https://user:pass@example.com?key=foo Bearer abc123'),
    ).not.toMatch(/test-secret|user:pass|key=foo|abc123/);
    expect(redactor.value({ error: 'test-secret' })).toEqual({ error: '[REDACTED]' });
  });
});
