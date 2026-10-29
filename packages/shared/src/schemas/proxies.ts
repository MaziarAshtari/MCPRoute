import { z } from 'zod';
import { DEFAULT_PROXY_SCHEMES, LABEL_MAX_LENGTH } from '../constants';
import { parseProxyUrl } from '../parsers/proxy-url';
import { bulkTextSchema, nullableText } from './common';

/** Accepts any supported proxy format and outputs the canonical proxy URL. */
export const proxyUrlSchema = z
  .string()
  .trim()
  .min(1, 'Proxy URL is required')
  .max(2048)
  .transform((value, ctx) => {
    const parsed = parseProxyUrl(value);
    if (parsed.ok) return parsed.proxy.url;
    // `input` stays undefined so a proxy password can never surface in validation output.
    ctx.issues.push({ code: 'custom', message: parsed.error, input: undefined });
    return z.NEVER;
  });

const proxyLabelSchema = nullableText(LABEL_MAX_LENGTH);

/** POST /api/proxies */
export const proxyCreateSchema = z.object({
  url: proxyUrlSchema,
  label: proxyLabelSchema.optional(),
  enabled: z.boolean().default(true),
});
export type ProxyCreateInput = z.input<typeof proxyCreateSchema>;

/** PATCH /api/proxies/:id. Changing the URL resets the health status. */
export const proxyUpdateSchema = z.object({
  url: proxyUrlSchema.optional(),
  label: proxyLabelSchema.optional(),
  enabled: z.boolean().optional(),
});
export type ProxyUpdateInput = z.input<typeof proxyUpdateSchema>;

/**
 * POST /api/proxies/bulk. One proxy per line: `scheme://user:pass@host:port`, `user:pass@host:port`,
 * `host:port` or `host:port:user:pass`; entries without a scheme use `defaultScheme`.
 */
export const bulkProxiesImportSchema = z.object({
  text: bulkTextSchema,
  defaultScheme: z.enum(DEFAULT_PROXY_SCHEMES).default('http'),
});
export type BulkProxiesImportInput = z.input<typeof bulkProxiesImportSchema>;
