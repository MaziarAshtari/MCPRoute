import { z } from 'zod';
import {
  API_KEY_PLACEHOLDER,
  AUTH_MODES,
  PROVIDER_DEFAULTS,
  ROTATION_STRATEGIES,
  TRANSPORTS,
  defaultFailureRules,
  type AuthMode,
  type Transport,
} from '../constants';
import { nameSchema, nullableText, slugSchema, slugify } from './common';

const HEADER_NAME_PATTERN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
export const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const QUERY_PARAM_PATTERN = /^[^\s&=#?]+$/;

function isValidRegex(source: string): boolean {
  try {
    new RegExp(source, 'i');
    return true;
  } catch {
    return false;
  }
}

/** True when the value is an http(s) URL once `{{API_KEY}}` placeholders are substituted. */
export function isHttpUrlTemplate(value: string): boolean {
  try {
    const url = new URL(value.replaceAll(API_KEY_PLACEHOLDER, 'placeholder'));
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Auth mode used when a provider is created without one. */
export function inferAuthMode(transport: Transport, url: string | null | undefined): AuthMode {
  if (transport === 'stdio') return 'env';
  if (url?.includes(API_KEY_PLACEHOLDER)) return 'url_placeholder';
  return 'header';
}

export const failureRulesSchema = z.object({
  httpStatuses: z.array(z.number().int().min(100).max(599)).max(50),
  messagePatterns: z
    .array(z.string().min(1).max(500).refine(isValidRegex, 'Invalid regular expression'))
    .max(50),
});

const argsSchema = z.array(z.string().max(4096)).max(100).nullable();
const envSchema = z
  .record(z.string().regex(ENV_NAME_PATTERN, 'Invalid environment variable name'), z.string().max(8192))
  .nullable();
const authHeaderNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(256)
  .regex(HEADER_NAME_PATTERN, 'Invalid HTTP header name');
const authValueTemplateSchema = z.string().trim().min(1).max(1024);
const authQueryParamSchema = nullableText(256).refine(
  (value) => value === null || QUERY_PARAM_PATTERN.test(value),
  'Invalid query parameter name',
);
const cooldownSecondsSchema = z.number().int().min(0).max(604_800);

const providerConfigObject = z.object({
  name: nameSchema,
  slug: slugSchema,
  description: nullableText(1000),
  transport: z.enum(TRANSPORTS),
  url: nullableText(2048),
  command: nullableText(1024),
  args: argsSchema,
  env: envSchema,
  authMode: z.enum(AUTH_MODES),
  authHeaderName: authHeaderNameSchema,
  authValueTemplate: authValueTemplateSchema,
  authQueryParam: authQueryParamSchema,
  rotationStrategy: z.enum(ROTATION_STRATEGIES),
  failoverEnabled: z.boolean(),
  cooldownSeconds: cooldownSecondsSchema,
  failureRules: failureRulesSchema,
  enabled: z.boolean(),
});

/** Complete, validated provider configuration (cross-field rules included). */
export type ProviderConfig = z.output<typeof providerConfigObject>;

export const providerConfigSchema = providerConfigObject.superRefine((cfg, ctx) => {
  const issue = (path: keyof ProviderConfig, message: string) =>
    ctx.addIssue({ code: 'custom', path: [path], message });
  const placeholder = API_KEY_PLACEHOLDER;

  if (cfg.transport === 'stdio') {
    if (!cfg.command) issue('command', 'command is required for the stdio transport');
    if (cfg.authMode !== 'env') {
      issue('authMode', 'stdio providers must use authMode "env"');
    } else {
      const inEnv = Object.values(cfg.env ?? {}).some((value) => value.includes(placeholder));
      const inArgs = (cfg.args ?? []).some((arg) => arg.includes(placeholder));
      if (!inEnv && !inArgs) {
        issue('env', `authMode "env" requires ${placeholder} in at least one env value or argument`);
      }
    }
    return;
  }

  if (!cfg.url) issue('url', `url is required for the ${cfg.transport} transport`);
  else if (!isHttpUrlTemplate(cfg.url)) issue('url', 'url must be a valid http(s) URL');

  switch (cfg.authMode) {
    case 'env':
      issue('authMode', 'authMode "env" is only supported for stdio providers');
      break;
    case 'header':
      if (!cfg.authValueTemplate.includes(placeholder)) {
        issue('authValueTemplate', `authValueTemplate must contain ${placeholder}`);
      }
      break;
    case 'query':
      if (!cfg.authQueryParam) issue('authQueryParam', 'authQueryParam is required when authMode is "query"');
      break;
    case 'url_placeholder':
      if (cfg.url && !cfg.url.includes(placeholder)) {
        issue('url', `url must contain ${placeholder} when authMode is "url_placeholder"`);
      }
      break;
  }
});

/** POST /api/providers. Omitted fields get defaults; slug and authMode are derived when omitted. */
export const providerCreateSchema = z
  .object({
    name: nameSchema,
    slug: slugSchema.optional(),
    description: nullableText(1000).optional(),
    transport: z.enum(TRANSPORTS).default(PROVIDER_DEFAULTS.transport),
    url: nullableText(2048).optional(),
    command: nullableText(1024).optional(),
    args: argsSchema.optional(),
    env: envSchema.optional(),
    authMode: z.enum(AUTH_MODES).optional(),
    authHeaderName: authHeaderNameSchema.default(PROVIDER_DEFAULTS.authHeaderName),
    authValueTemplate: authValueTemplateSchema.default(PROVIDER_DEFAULTS.authValueTemplate),
    authQueryParam: authQueryParamSchema.optional(),
    rotationStrategy: z.enum(ROTATION_STRATEGIES).default(PROVIDER_DEFAULTS.rotationStrategy),
    failoverEnabled: z.boolean().default(PROVIDER_DEFAULTS.failoverEnabled),
    cooldownSeconds: cooldownSecondsSchema.default(PROVIDER_DEFAULTS.cooldownSeconds),
    failureRules: failureRulesSchema.default(defaultFailureRules),
    enabled: z.boolean().default(true),
  })
  .transform(
    (input): ProviderConfig => ({
      ...input,
      slug: input.slug ?? slugify(input.name),
      description: input.description ?? null,
      url: input.url ?? null,
      command: input.command ?? null,
      args: input.args ?? null,
      env: input.env ?? null,
      authMode: input.authMode ?? inferAuthMode(input.transport, input.url),
      authQueryParam: input.authQueryParam ?? null,
    }),
  )
  .pipe(providerConfigSchema);
export type ProviderCreateInput = z.input<typeof providerCreateSchema>;

/**
 * PATCH /api/providers/:id. The server merges the patch over the stored provider and
 * validates the result with `providerConfigSchema`.
 */
export const providerUpdateSchema = providerConfigObject.partial();
export type ProviderUpdateInput = z.input<typeof providerUpdateSchema>;
