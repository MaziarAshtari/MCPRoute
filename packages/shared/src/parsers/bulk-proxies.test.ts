import { describe, expect, it } from 'vitest';
import { parseBulkProxies } from './bulk-proxies';
import { parseProxyUrl, redactProxyUrl } from './proxy-url';

function urls(text: string, defaultScheme?: 'http' | 'socks5'): string[] {
  const { entries, errors } = parseBulkProxies(text, defaultScheme);
  expect(errors).toEqual([]);
  return entries.map((e) => e.proxy.url);
}

describe('parseBulkProxies', () => {
  it('accepts full URLs for every supported scheme', () => {
    expect(
      urls(
        [
          'http://user:pass@1.2.3.4:8080',
          'https://proxy.example.com:8443',
          'socks5://user:pass@5.6.7.8:1080',
          'socks5h://gate.example.net:7000',
        ].join('\n'),
      ),
    ).toEqual([
      'http://user:pass@1.2.3.4:8080',
      'https://proxy.example.com:8443',
      'socks5://user:pass@5.6.7.8:1080',
      'socks5h://gate.example.net:7000',
    ]);
  });

  it('applies the selectable default scheme to host:port and host:port:user:pass', () => {
    const text = '1.2.3.4:8080\n5.6.7.8:1080:alice:s3cret';
    expect(urls(text)).toEqual(['http://1.2.3.4:8080', 'http://alice:s3cret@5.6.7.8:1080']);
    expect(urls(text, 'socks5')).toEqual(['socks5://1.2.3.4:8080', 'socks5://alice:s3cret@5.6.7.8:1080']);
  });

  it('accepts user:pass@host:port without a scheme', () => {
    expect(urls('bob:pw@proxy.local:3128', 'socks5')).toEqual(['socks5://bob:pw@proxy.local:3128']);
  });

  it('returns structured proxy details', () => {
    const { entries } = parseBulkProxies('9.9.9.9:8000:user-session-1:p@ss:word');
    expect(entries).toEqual([
      {
        line: 1,
        proxy: {
          url: 'http://user-session-1:p%40ss%3Aword@9.9.9.9:8000',
          scheme: 'http',
          host: '9.9.9.9',
          port: 8000,
          username: 'user-session-1',
          password: 'p@ss:word',
        },
      },
    ]);
  });

  it('normalizes case, default ports and credential encoding so equivalent entries match', () => {
    expect(
      urls(
        [
          'HTTP://User:P%61ss@Proxy.Example.COM',
          'SOCKS5://Host.Example.com',
          'https://secure.example.com',
          'http://u:p%40ss@h.example.com:8080/',
        ].join('\n'),
      ),
    ).toEqual([
      'http://User:Pass@proxy.example.com:80',
      'socks5://host.example.com:1080',
      'https://secure.example.com:443',
      'http://u:p%40ss@h.example.com:8080',
    ]);
    expect(parseProxyUrl('h.example.com:8080:u:p@ss')).toMatchObject({
      ok: true,
      proxy: { url: 'http://u:p%40ss@h.example.com:8080' },
    });
  });

  it('supports bracketed IPv6 hosts', () => {
    expect(urls('[2001:db8::1]:8080\nsocks5://u:p@[::1]:1080\n[2001:db8::2]:3128:u:p')).toEqual([
      'http://[2001:db8::1]:8080',
      'socks5://u:p@[::1]:1080',
      'http://u:p@[2001:db8::2]:3128',
    ]);
  });

  it('skips blank lines and comments and reports 1-based line numbers', () => {
    const { entries, errors } = parseBulkProxies('# pool A\n\n1.1.1.1:80\r\n  \r\nbogus\n2.2.2.2:81');
    expect(entries.map((e) => [e.line, e.proxy.url])).toEqual([
      [3, 'http://1.1.1.1:80'],
      [6, 'http://2.2.2.2:81'],
    ]);
    expect(errors).toEqual([{ line: 5, message: expect.stringMatching(/^Unrecognized proxy format/) }]);
  });

  it('rejects invalid entries with descriptive errors', () => {
    const cases: [string, RegExp][] = [
      ['ftp://1.2.3.4:21', /Unsupported proxy scheme/],
      ['socks4://1.2.3.4:1080', /Unsupported proxy scheme/],
      ['http://1.2.3.4:99999', /Invalid proxy URL/],
      ['1.2.3.4:0', /Invalid proxy port/],
      ['http://1.2.3.4:8080/path', /must not contain a path/],
      ['http://1.2.3.4:8080?x=1', /must not contain a path/],
      ['1.2.3.4', /Unrecognized proxy format/],
      ['1.2.3.4:8080:user', /Unrecognized proxy format/],
      ['1.2.3.4:8080::pass', /username is empty/],
      ['socks5://:pass@1.2.3.4:1080', /requires a username/],
      ['http://bad_host!:8080', /Invalid proxy (URL|host)/],
      ['http://u:%E0%A4%A@1.2.3.4:80', /percent-encoding/],
      ['two words:80', /whitespace/],
    ];
    const { entries, errors } = parseBulkProxies(cases.map(([line]) => line).join('\n'));
    expect(entries).toEqual([]);
    expect(errors).toHaveLength(cases.length);
    cases.forEach(([, pattern], index) => {
      expect(errors[index]).toEqual({ line: index + 1, message: expect.stringMatching(pattern) });
    });
  });

  it('does not de-duplicate (the import service does)', () => {
    expect(urls('1.1.1.1:80\nhttp://1.1.1.1:80')).toEqual(['http://1.1.1.1:80', 'http://1.1.1.1:80']);
  });

  it('never echoes proxy passwords in error messages', () => {
    const { errors } = parseBulkProxies('ftp://user:hunter2@1.2.3.4:21\nhttp://user:hunter3@1.2.3.4:8080/x');
    expect(errors).toHaveLength(2);
    for (const error of errors) expect(error.message).not.toContain('hunter');
  });
});

describe('redactProxyUrl', () => {
  it('masks the password but keeps the rest of the URL', () => {
    expect(redactProxyUrl('socks5://alice:s3cret@1.2.3.4:1080')).toBe('socks5://alice:****@1.2.3.4:1080');
    expect(redactProxyUrl('http://1.2.3.4:8080')).toBe('http://1.2.3.4:8080');
    expect(redactProxyUrl('not a url')).toBe('[invalid proxy URL]');
  });
});
