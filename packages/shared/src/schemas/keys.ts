import { z } from 'zod';
import {
  API_KEY_MAX_LENGTH,
  BULK_IMPORT_MAX_LINES,
  DEFAULT_PROXY_SCHEMES,
  KEY_STATUSES,
  LABEL_MAX_LENGTH,
  PROXY_ASSIGN_MODES,
} from '../constants';
import { API_KEY_PATTERN } from '../parsers/bulk-keys';
import { bulkTextSchema, idSchema } from './common';

export const apiKeyValueSchema = z
  .string()
  .trim()
  .min(1, 'Key is required')
  .max(API_KEY_MAX_LENGTH)
  .regex(API_KEY_PATTERN, 'Key must contain only printable ASCII characters without spaces');

export const keyLabelSchema = z.string().trim().min(1, 'Label must not be empty').max(LABEL_MAX_LENGTH);
export const keyWeightSchema = z.number().int().min(1).max(1000);

/** POST /api/providers/:id/keys. The label defaults to the masked key. */
export const apiKeyCreateSchema = z.object({
  key: apiKeyValueSchema,
  label: keyLabelSchema.optional(),
  proxyId: idSchema.nullable().optional(),
  enabled: z.boolean().default(true),
  weight: keyWeightSchema.default(1),
});
export type ApiKeyCreateInput = z.input<typeof apiKeyCreateSchema>;

/** PATCH /api/keys/:id. Setting `status` to "active" clears any cooldown. */
export const apiKeyUpdateSchema = z.object({
  key: apiKeyValueSchema.optional(),
  label: keyLabelSchema.optional(),
  proxyId: idSchema.nullable().optional(),
  enabled: z.boolean().optional(),
  weight: keyWeightSchema.optional(),
  status: z.enum(KEY_STATUSES).optional(),
});
export type ApiKeyUpdateInput = z.input<typeof apiKeyUpdateSchema>;

/** POST /api/providers/:id/keys/bulk. One entry per line: `key`, `key|proxyUrl` or `key|proxyUrl|label`. */
export const bulkKeysImportSchema = z.object({
  text: bulkTextSchema,
  defaultProxyScheme: z.enum(DEFAULT_PROXY_SCHEMES).default('http'),
});
export type BulkKeysImportInput = z.input<typeof bulkKeysImportSchema>;

/** POST /api/providers/:id/keys/assign-proxies. Without `proxyIds`, all enabled proxies are used. */
export const assignProxiesSchema = z.object({
  mode: z.enum(PROXY_ASSIGN_MODES),
  proxyIds: z.array(idSchema).max(BULK_IMPORT_MAX_LINES).optional(),
  onlyUnassigned: z.boolean(),
});
export type AssignProxiesInput = z.input<typeof assignProxiesSchema>;
