import { describe, expect, it } from 'vitest';
import { parseBulkKeys } from './bulk-keys';

describe('parseBulkKeys', () => {
  it('parses all three line formats', () => {
    const result = parseBulkKeys(
      ['sk-plain-key-0001', 'sk-with-proxy-0002|http://1.2.3.4:8080', 'sk-full-0003|socks5://u:p@5.6.7.8:1080|Primary'].join('\n'),
    );

    expect(result.errors).toEqual([]);
    expect(result.entries).toEqual([
      { line: 1, key: 'sk-plain-key-0001', proxy: null, label: null },
      {
        line: 2,
        key: 'sk-with-proxy-0002',
        proxy: { url: 'http://1.2.3.4:8080', scheme: 'http', host: '1.2.3.4', port: 8080, username: null, password: null },
        label: null,
      },
      {
        line: 3,
        key: 'sk-full-0003',
        proxy: { url: 'socks5://u:p@5.6.7.8:1080', scheme: 'socks5', host: '5.6.7.8', port: 1080, username: 'u', password: 'p' },
        label: 'Primary',
      },
    ]);
  });

  it('allows an empty proxy field and labels containing the separator', () => {
    const { entries, errors } = parseBulkKeys('key-a||Team A\nkey-b|  |x|y');
    expect(errors).toEqual([]);
    expect(entries.map(({ key, proxy, label }) => ({ key, proxy, label }))).toEqual([
      { key: 'key-a', proxy: null, label: 'Team A' },
      { key: 'key-b', proxy: null, label: 'x|y' },
    ]);
  });

  it('trims whitespace, skips blank lines and comments, and keeps physical line numbers', () => {
    const text = '\r\n# exported keys\r\n  key-1  \r\n\r\n\tkey-2 | 10.0.0.1:3128 | Backup \r\n';
    const { entries, errors } = parseBulkKeys(text);
    expect(errors).toEqual([]);
    expect(entries.map((e) => [e.line, e.key, e.proxy?.url ?? null, e.label])).toEqual([
      [3, 'key-1', null, null],
      [5, 'key-2', 'http://10.0.0.1:3128', 'Backup'],
    ]);
  });

  it('accepts every proxy format inline and applies the default proxy scheme', () => {
    const text = [
      'k1|1.1.1.1:1080',
      'k2|2.2.2.2:1080:user:pa:ss',
      'k3|user:secret@3.3.3.3:1080',
      'k4|http://4.4.4.4:8080',
    ].join('\n');
    const { entries, errors } = parseBulkKeys(text, { defaultProxyScheme: 'socks5' });
    expect(errors).toEqual([]);
    expect(entries.map((e) => e.proxy?.url)).toEqual([
      'socks5://1.1.1.1:1080',
      'socks5://user:pa%3Ass@2.2.2.2:1080',
      'socks5://user:secret@3.3.3.3:1080',
      'http://4.4.4.4:8080',
    ]);
  });

  it('does not de-duplicate (the import service does)', () => {
    const { entries } = parseBulkKeys('same-key\nsame-key');
    expect(entries.map((e) => e.key)).toEqual(['same-key', 'same-key']);
  });

  it('reports invalid lines with line numbers and keeps parsing', () => {
    const text = [
      'good-key-1',
      '|http://1.2.3.4:8080',
      'has space|1.2.3.4:80',
      'secret-key-xyz|ftp://user:hunter2@1.2.3.4:21',
      `${'k'.repeat(4097)}`,
      `good-key-2||${'l'.repeat(101)}`,
      'good-key-3|not a proxy',
      'good-key-4',
    ].join('\n');

    const { entries, errors } = parseBulkKeys(text);

    expect(entries.map((e) => [e.line, e.key])).toEqual([
      [1, 'good-key-1'],
      [8, 'good-key-4'],
    ]);
    expect(errors.map((e) => e.line)).toEqual([2, 3, 4, 5, 6, 7]);
    expect(errors[0]?.message).toBe('Key is empty');
    expect(errors[1]?.message).toMatch(/printable ASCII/);
    expect(errors[2]?.message).toMatch(/^Invalid proxy: Unsupported proxy scheme/);
    expect(errors[3]?.message).toMatch(/longer than 4096/);
    expect(errors[4]?.message).toMatch(/Label is longer than 100/);
    expect(errors[5]?.message).toMatch(/^Invalid proxy:/);
  });

  it('never echoes keys or proxy passwords in error messages', () => {
    const { errors } = parseBulkKeys('sk-live-SECRET|http://user:hunter2@host:99999\nsk-live-SECRET2|socks4://u:hunter3@h:1');
    expect(errors).toHaveLength(2);
    for (const error of errors) {
      expect(error.message).not.toMatch(/SECRET|hunter/);
    }
  });

  it('returns nothing for empty input', () => {
    expect(parseBulkKeys('')).toEqual({ entries: [], errors: [] });
    expect(parseBulkKeys('\n\n# only comments\n')).toEqual({ entries: [], errors: [] });
  });
});
