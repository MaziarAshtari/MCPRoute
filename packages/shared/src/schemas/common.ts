import { z } from 'zod';
import { BULK_IMPORT_MAX_LINES, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '../constants';
import { splitBulkLines } from '../parsers/lines';

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const SLUG_MAX_LENGTH = 64;

export const idSchema = z.uuid({ error: 'Invalid ID' });
export const idParamsSchema = z.object({ id: idSchema });

export const nameSchema = z.string().trim().min(1, 'Name is required').max(100);

export const slugSchema = z
  .string()
  .trim()
  .min(1, 'Slug is required')
  .max(SLUG_MAX_LENGTH)
  .regex(SLUG_PATTERN, 'Slug may only contain lowercase letters, digits and single hyphens');

/** Optional free text: trims input and stores empty strings as `null`. */
export function nullableText(max: number) {
  return z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((value) => (value === '' ? null : value));
}

/** Derives a URL-safe slug from a display name ("Exa Search" -> "exa-search"). */
export function slugify(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX_LENGTH)
    .replace(/-+$/g, '');
}

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});
export type PaginationQuery = z.output<typeof paginationQuerySchema>;

/** Multi-line text for bulk imports. */
export const bulkTextSchema = z
  .string()
  .max(5_000_000, 'Import text is too large')
  .refine((text) => splitBulkLines(text).length <= BULK_IMPORT_MAX_LINES, {
    message: `Too many entries (max ${BULK_IMPORT_MAX_LINES} per import)`,
  });
