import { z } from 'zod';
import { TOOL_FILTER_MODES, TOOL_PREFIX_MODES } from '../constants';
import { idSchema, nameSchema, nullableText, slugSchema, slugify } from './common';

const endpointConfigObject = z.object({
  name: nameSchema,
  slug: slugSchema,
  description: nullableText(1000),
  toolPrefixMode: z.enum(TOOL_PREFIX_MODES),
  enableSse: z.boolean(),
  enabled: z.boolean(),
});
export type EndpointConfig = z.output<typeof endpointConfigObject>;

/** POST /api/endpoints. The slug is derived from the name when omitted. */
export const endpointCreateSchema = z
  .object({
    name: nameSchema,
    slug: slugSchema.optional(),
    description: nullableText(1000).optional(),
    toolPrefixMode: z.enum(TOOL_PREFIX_MODES).default('none'),
    enableSse: z.boolean().default(false),
    enabled: z.boolean().default(true),
  })
  .transform(
    (input): EndpointConfig => ({
      ...input,
      slug: input.slug ?? slugify(input.name),
      description: input.description ?? null,
    }),
  )
  .pipe(endpointConfigObject);
export type EndpointCreateInput = z.input<typeof endpointCreateSchema>;

/** PATCH /api/endpoints/:id */
export const endpointUpdateSchema = endpointConfigObject.partial();
export type EndpointUpdateInput = z.input<typeof endpointUpdateSchema>;

export const endpointProviderLinkSchema = z.object({
  providerId: idSchema,
  toolFilterMode: z.enum(TOOL_FILTER_MODES).default('all'),
  toolNames: z
    .array(z.string().trim().min(1).max(256))
    .max(1000)
    .default(() => [])
    .transform((names) => [...new Set(names)]),
});

/** PUT /api/endpoints/:id/providers. Replaces all linked providers and their tool filters. */
export const setEndpointProvidersSchema = z
  .object({
    providers: z.array(endpointProviderLinkSchema).max(100),
  })
  .superRefine((value, ctx) => {
    const seen = new Set<string>();
    value.providers.forEach((link, index) => {
      if (seen.has(link.providerId)) {
        ctx.addIssue({ code: 'custom', path: ['providers', index, 'providerId'], message: 'Duplicate provider' });
      }
      seen.add(link.providerId);
    });
  });
export type SetEndpointProvidersInput = z.input<typeof setEndpointProvidersSchema>;
