import { PROXY_SCHEMES, type ProxyScheme } from '../constants';

export interface ParsedProxy {
  /** Canonical URL (lowercase scheme/host, explicit port, normalized credentials); used for de-duplication. */
  url: string;
  scheme: ProxyScheme;
  host: string;
  port: number;
  username: string | null;
  password: string | null;
}

export type ProxyParseResult = { ok: true; proxy: ParsedProxy } | { ok: false; error: string };

export const MASKED_SECRET = '****';

const DEFAULT_PORTS: Record<ProxyScheme, number> = { http: 80, https: 443, socks5: 1080, socks5h: 1080 };
const SCHEME_PREFIX = /^([a-z][a-z0-9+.-]*):\/\//i;
// host:port or host:port:user:pass. The password may contain ':' and '@'; the username may not,
// which keeps `user:pass@host:port` entries from being misread. IPv6 hosts must be bracketed.
const COLON_FORMAT = /^(\[[0-9a-f:.]+\]|[^:@/[\]]+):(\d{1,5})(?::([^:@]*):(.*))?$/i;
const HOSTNAME = /^[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?(?:\.[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?)*$/;
const BRACKETED_IPV6 = /^\[[0-9a-f:.]+\]$/;

const FORMAT_HINT = 'expected scheme://user:pass@host:port, user:pass@host:port, host:port or host:port:user:pass';

function failure(error: string): ProxyParseResult {
  return { ok: false, error };
}

function isProxyScheme(value: string): value is ProxyScheme {
  return (PROXY_SCHEMES as readonly string[]).includes(value);
}

/**
 * Parses a single proxy written in any supported format and returns its canonical form.
 * Error messages never echo the input, so they are safe to return to clients and to log.
 */
export function parseProxyUrl(input: string, defaultScheme: ProxyScheme = 'http'): ProxyParseResult {
  const value = input.trim();
  if (value === '') return failure('Proxy is empty');
  if (/\s/.test(value)) return failure('Proxy must not contain whitespace');

  const schemeMatch = SCHEME_PREFIX.exec(value);
  if (schemeMatch) {
    const scheme = (schemeMatch[1] ?? '').toLowerCase();
    if (!isProxyScheme(scheme)) {
      return failure('Unsupported proxy scheme (use http, https, socks5 or socks5h)');
    }
    return fromUrl(value, scheme);
  }

  const match = COLON_FORMAT.exec(value);
  if (!match) {
    if (value.includes('@')) return fromUrl(`${defaultScheme}://${value}`, defaultScheme);
    return failure(`Unrecognized proxy format (${FORMAT_HINT})`);
  }
  const [, host = '', port = '', username, password = ''] = match;
  if (username === undefined) return fromUrl(`${defaultScheme}://${host}:${port}`, defaultScheme);
  if (username === '') return failure('Proxy username is empty');
  const auth = `${encodeURIComponent(username)}:${encodeURIComponent(password)}`;
  return fromUrl(`${defaultScheme}://${auth}@${host}:${port}`, defaultScheme);
}

function fromUrl(raw: string, scheme: ProxyScheme): ProxyParseResult {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return failure(`Invalid proxy URL (${FORMAT_HINT})`);
  }
  if ((url.pathname !== '' && url.pathname !== '/') || url.search !== '' || url.hash !== '') {
    return failure('Proxy URL must not contain a path, query string or fragment');
  }

  const host = url.hostname.toLowerCase();
  if (host === '') return failure('Proxy host is missing');
  if (!BRACKETED_IPV6.test(host) && !HOSTNAME.test(host)) return failure('Invalid proxy host');

  const port = url.port === '' ? DEFAULT_PORTS[scheme] : Number(url.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return failure('Invalid proxy port');

  let username: string | null;
  let password: string | null;
  try {
    username = url.username === '' ? null : decodeURIComponent(url.username);
    password = url.password === '' ? null : decodeURIComponent(url.password);
  } catch {
    return failure('Invalid percent-encoding in proxy credentials');
  }
  if (username === null && password !== null) return failure('Proxy password requires a username');

  const proxy: ParsedProxy = { url: '', scheme, host, port, username, password };
  proxy.url = formatProxyUrl(proxy);
  return { ok: true, proxy };
}

export function formatProxyUrl(
  proxy: Pick<ParsedProxy, 'scheme' | 'host' | 'port' | 'username' | 'password'>,
  options: { maskPassword?: boolean } = {},
): string {
  let auth = '';
  if (proxy.username !== null) {
    auth = encodeURIComponent(proxy.username);
    if (proxy.password !== null) {
      auth += `:${options.maskPassword ? MASKED_SECRET : encodeURIComponent(proxy.password)}`;
    }
    auth += '@';
  }
  return `${proxy.scheme}://${auth}${proxy.host}:${proxy.port}`;
}

/** Returns the proxy URL with its password masked, e.g. `http://user:****@1.2.3.4:8080`. */
export function redactProxyUrl(url: string): string {
  const parsed = parseProxyUrl(url);
  return parsed.ok ? formatProxyUrl(parsed.proxy, { maskPassword: true }) : '[invalid proxy URL]';
}
