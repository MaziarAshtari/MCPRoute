import type { ProxyScheme } from '../constants';
import { splitBulkLines, type BulkLineError } from './lines';
import { parseProxyUrl, type ParsedProxy } from './proxy-url';

export interface BulkProxyEntry {
  line: number;
  proxy: ParsedProxy;
}

export interface BulkProxiesParseResult {
  entries: BulkProxyEntry[];
  errors: BulkLineError[];
}

/**
 * Parses one proxy per line. Accepted formats:
 * `scheme://user:pass@host:port`, `user:pass@host:port`, `host:port`, `host:port:user:pass`.
 * Entries without a scheme use `defaultScheme`. Blank lines and `#` comments are ignored.
 * De-duplication is left to the caller.
 */
export function parseBulkProxies(text: string, defaultScheme: ProxyScheme = 'http'): BulkProxiesParseResult {
  const result: BulkProxiesParseResult = { entries: [], errors: [] };
  for (const { line, value } of splitBulkLines(text)) {
    const parsed = parseProxyUrl(value, defaultScheme);
    if (parsed.ok) result.entries.push({ line, proxy: parsed.proxy });
    else result.errors.push({ line, message: parsed.error });
  }
  return result;
}
