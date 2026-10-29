import {
  AUTH_MODES,
  ENV_NAME_PATTERN,
  PROVIDER_DEFAULTS,
  ROTATION_STRATEGIES,
  TRANSPORTS,
  defaultFailureRules,
  providerConfigSchema,
  slugify,
  type ProviderDto,
} from '@mcproute/shared';
import { z } from 'zod';

const envRowsSchema = z.array(z.object({ key: z.string(), value: z.string() })).superRefine((rows, ctx) => {
  const seen = new Set<string>();
  rows.forEach((row, index) => {
    const key = row.key.trim();
    if (key === '' && row.value === '') return;
    let message: string | null = null;
    if (key === '') message = 'Enter a variable name';
    else if (!ENV_NAME_PATTERN.test(key)) message = 'Use letters, digits and underscores, not starting with a digit';
    else if (seen.has(key)) message = 'Duplicate variable';
    seen.add(key);
    if (message) ctx.addIssue({ code: 'custom', path: [index, 'key'], message });
  });
});

/** Form state: plain strings and arrays, so every input is controlled. */
const providerFormFields = z.object({
  name: z.string(),
  slug: z.string(),
  description: z.string(),
  enabled: z.boolean(),
  transport: z.enum(TRANSPORTS),
  url: z.string(),
  command: z.string(),
  args: z.array(z.string()),
  env: envRowsSchema,
  authMode: z.enum(AUTH_MODES),
  authHeaderName: z.string(),
  authValueTemplate: z.string(),
  authQueryParam: z.string(),
  rotationStrategy: z.enum(ROTATION_STRATEGIES),
  failoverEnabled: z.boolean(),
  cooldownSeconds: z.number({ error: 'Enter a number of seconds' }),
  failureRules: z.object({
    httpStatuses: z.array(z.number()),
    messagePatterns: z.array(z.string().refine((value) => value.trim() !== '', 'Enter a pattern or remove this row')),
  }),
});

export type ProviderFormValues = z.input<typeof providerFormFields>;

/**
 * Converts the form state into a provider configuration and validates it with the shared schema, so the
 * form enforces exactly the API's rules. Fields that do not apply to the chosen transport or auth mode
 * are cleared (or reset to their defaults) instead of being validated.
 */
export const providerFormSchema = providerFormFields
  .transform((values): z.input<typeof providerConfigSchema> => {
    const stdio = values.transport === 'stdio';
    const header = values.authMode === 'header';
    const args = values.args.filter((arg) => arg !== '');
    const env = values.env.filter((row) => row.key.trim() !== '' || row.value !== '');
    return {
      name: values.name,
      slug: values.slug.trim() || slugify(values.name),
      description: values.description,
      enabled: values.enabled,
      transport: values.transport,
      url: stdio ? null : values.url,
      command: stdio ? values.command : null,
      args: stdio && args.length > 0 ? args : null,
      env: stdio && env.length > 0 ? Object.fromEntries(env.map((row) => [row.key.trim(), row.value])) : null,
      authMode: values.authMode,
      authHeaderName: header ? values.authHeaderName : PROVIDER_DEFAULTS.authHeaderName,
      authValueTemplate: header ? values.authValueTemplate : PROVIDER_DEFAULTS.authValueTemplate,
      authQueryParam: values.authMode === 'query' ? values.authQueryParam : null,
      rotationStrategy: values.rotationStrategy,
      failoverEnabled: values.failoverEnabled,
      cooldownSeconds: values.cooldownSeconds,
      failureRules: values.failureRules,
    };
  })
  .pipe(providerConfigSchema);

export const PROVIDER_FORM_FIELDS = Object.keys(providerFormFields.shape);

export function defaultProviderValues(): ProviderFormValues {
  return {
    name: '',
    slug: '',
    description: '',
    enabled: true,
    transport: PROVIDER_DEFAULTS.transport,
    url: '',
    command: '',
    args: [],
    env: [],
    authMode: 'header',
    authHeaderName: PROVIDER_DEFAULTS.authHeaderName,
    authValueTemplate: PROVIDER_DEFAULTS.authValueTemplate,
    authQueryParam: '',
    rotationStrategy: PROVIDER_DEFAULTS.rotationStrategy,
    failoverEnabled: PROVIDER_DEFAULTS.failoverEnabled,
    cooldownSeconds: PROVIDER_DEFAULTS.cooldownSeconds,
    failureRules: defaultFailureRules(),
  };
}

export function providerToFormValues(provider: ProviderDto): ProviderFormValues {
  return {
    name: provider.name,
    slug: provider.slug,
    description: provider.description ?? '',
    enabled: provider.enabled,
    transport: provider.transport,
    url: provider.url ?? '',
    command: provider.command ?? '',
    args: provider.args ?? [],
    env: Object.entries(provider.env ?? {}).map(([key, value]) => ({ key, value })),
    authMode: provider.authMode,
    authHeaderName: provider.authHeaderName,
    authValueTemplate: provider.authValueTemplate,
    authQueryParam: provider.authQueryParam ?? '',
    rotationStrategy: provider.rotationStrategy,
    failoverEnabled: provider.failoverEnabled,
    cooldownSeconds: provider.cooldownSeconds,
    failureRules: {
      httpStatuses: [...provider.failureRules.httpStatuses],
      messagePatterns: [...provider.failureRules.messagePatterns],
    },
  };
}
