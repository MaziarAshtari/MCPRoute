import { API_KEY_MAX_LENGTH, LABEL_MAX_LENGTH, type ProxyScheme } from '../constants';
import { splitBulkLines, type BulkLineError } from './lines';
import { parseProxyUrl, type ParsedProxy } from './proxy-url';

/** Printable ASCII without spaces: keys end up in HTTP headers, query strings and env vars. */
export const API_KEY_PATTERN = /^[\x21-\x7e]+$/;

export interface BulkKeyEntry {
  line: number;
  key: string;
  proxy: ParsedProxy | null;
  label: string | null;
}

export interface BulkKeysParseResult {
  entries: BulkKeyEntry[];
  errors: BulkLineError[];
}

export interface BulkKeysParseOptions {
  /** Scheme used for inline proxies written without one (`host:port`, `host:port:user:pass`). */
  defaultProxyScheme?: ProxyScheme;
}

/**
 * Parses one key per line: `key`, `key|proxyUrl` or `key|proxyUrl|label`.
 * The proxy field may be empty (`key||label`); everything after the second `|` is the label.
 * Blank lines and `#` comments are ignored. Error messages never include the key or proxy credentials.
 * De-duplication is left to the caller.
 */
export function parseBulkKeys(text: string, options: BulkKeysParseOptions = {}): BulkKeysParseResult {
  const defaultScheme = options.defaultProxyScheme ?? 'http';
  const result: BulkKeysParseResult = { entries: [], errors: [] };

  for (const { line, value } of splitBulkLines(text)) {
    const [rawKey = '', rawProxy = '', ...labelParts] = value.split('|');
    const key = rawKey.trim();
    const proxyText = rawProxy.trim();
    const label = labelParts.join('|').trim();

    if (key === '') {
      result.errors.push({ line, message: 'Key is empty' });
      continue;
    }
    if (key.length > API_KEY_MAX_LENGTH) {
      result.errors.push({ line, message: `Key is longer than ${API_KEY_MAX_LENGTH} characters` });
      continue;
    }
    if (!API_KEY_PATTERN.test(key)) {
      result.errors.push({ line, message: 'Key must contain only printable ASCII characters without spaces' });
      continue;
    }
    if (label.length > LABEL_MAX_LENGTH) {
      result.errors.push({ line, message: `Label is longer than ${LABEL_MAX_LENGTH} characters` });
      continue;
    }

    let proxy: ParsedProxy | null = null;
    if (proxyText !== '') {
      const parsed = parseProxyUrl(proxyText, defaultScheme);
      if (!parsed.ok) {
        result.errors.push({ line, message: `Invalid proxy: ${parsed.error}` });
        continue;
      }
      proxy = parsed.proxy;
    }

    result.entries.push({ line, key, proxy, label: label === '' ? null : label });
  }

  return result;
}
