import { useState, type ReactNode } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  API_KEY_PLACEHOLDER,
  ROTATION_STRATEGIES,
  TRANSPORTS,
  slugify,
  type AuthMode,
  type ProviderConfig,
  type Transport,
} from '@mcproute/shared';
import { ExternalLink, Plus, X } from 'lucide-react';
import { Controller, useFieldArray, useForm, useWatch } from 'react-hook-form';
import { ListEditor, StatusCodesInput } from '@/components/form-controls';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldSet,
  FieldLegend,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { applyApiIssues } from '@/lib/forms';
import { AUTH_MODE_LABELS, ROTATION_DESCRIPTIONS, ROTATION_LABELS, TRANSPORT_LABELS } from '@/lib/labels';
import { PROVIDER_PRESETS } from './presets';
import {
  PROVIDER_FORM_FIELDS,
  defaultProviderValues,
  providerFormSchema,
  type ProviderFormValues,
} from './provider-form-schema';

const KEY = API_KEY_PLACEHOLDER;
const HTTP_AUTH_MODES: AuthMode[] = ['header', 'query', 'url_placeholder'];

const TRANSPORT_HELP: Record<Transport, string> = {
  streamable_http: 'The current MCP HTTP transport. Use this for hosted MCP servers.',
  sse: 'Only for older servers that still speak the legacy HTTP + SSE transport.',
  stdio: 'Spawns a command inside the MCPRoute server (in Docker: node and npx are available).',
};

const AUTH_HELP: Record<AuthMode, ReactNode> = {
  header: 'The bound key is sent in an HTTP header built from the template below.',
  query: 'The bound key is appended to the URL as a query parameter.',
  url_placeholder: (
    <>
      Put <code className="font-mono">{KEY}</code> in the URL; it is replaced with the bound key.
    </>
  ),
  env: (
    <>
      Put <code className="font-mono">{KEY}</code> in an environment value or an argument of the command.
    </>
  ),
};

function Section({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <FieldGroup>{children}</FieldGroup>
      </CardContent>
    </Card>
  );
}

interface ProviderFormProps {
  mode: 'create' | 'edit';
  defaultValues: ProviderFormValues;
  submitLabel: string;
  onSubmit: (config: ProviderConfig) => Promise<void>;
  onCancel: () => void;
}

export function ProviderForm({ mode, defaultValues, submitLabel, onSubmit, onCancel }: ProviderFormProps) {
  const {
    control,
    register,
    handleSubmit,
    setValue,
    getValues,
    reset,
    setError,
    formState: { errors, isSubmitting, isSubmitted },
  } = useForm<ProviderFormValues, unknown, ProviderConfig>({ resolver: zodResolver(providerFormSchema), defaultValues });
  const envRows = useFieldArray({ control, name: 'env' });
  const [presetId, setPresetId] = useState('');
  const name = useWatch({ control, name: 'name' });
  const transport = useWatch({ control, name: 'transport' });
  const authMode = useWatch({ control, name: 'authMode' });
  const stdio = transport === 'stdio';
  const preset = PROVIDER_PRESETS.find((candidate) => candidate.id === presetId);

  function applyPreset(id: string) {
    const next = PROVIDER_PRESETS.find((candidate) => candidate.id === id);
    if (!next) return;
    setPresetId(id);
    reset({ ...defaultProviderValues(), ...next.values });
  }

  function changeTransport(next: Transport) {
    const options = { shouldDirty: true, shouldValidate: isSubmitted };
    setValue('transport', next, options);
    if (next === 'stdio') setValue('authMode', 'env', options);
    else if (getValues('authMode') === 'env') {
      setValue('authMode', getValues('url').includes(KEY) ? 'url_placeholder' : 'header', options);
    }
  }

  async function submit(config: ProviderConfig) {
    try {
      await onSubmit(config);
    } catch (error) {
      applyApiIssues(error, setError, PROVIDER_FORM_FIELDS);
    }
  }

  const envError = errors.env?.message ?? errors.env?.root?.message;

  return (
    <form onSubmit={handleSubmit(submit)} noValidate className="space-y-6">
      {mode === 'create' && (
        <Section title="Preset" description="Pre-fill the form for a known MCP server. Every field stays editable.">
          <Field>
            <FieldLabel htmlFor="preset">Start from</FieldLabel>
            <Select value={presetId} onValueChange={applyPreset}>
              <SelectTrigger id="preset" className="w-full sm:w-72">
                <SelectValue placeholder="Choose a preset…" />
              </SelectTrigger>
              <SelectContent>
                {PROVIDER_PRESETS.map((candidate) => (
                  <SelectItem key={candidate.id} value={candidate.id}>
                    {candidate.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {preset && (
              <FieldDescription>
                {preset.description}{' '}
                {preset.docsUrl && (
                  <a href={preset.docsUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5">
                    Documentation
                    <ExternalLink className="size-3" />
                  </a>
                )}
              </FieldDescription>
            )}
          </Field>
        </Section>
      )}

      <Section title="General" description="How the provider is named in the admin UI and in prefixed tool names.">
        <div className="grid gap-5 md:grid-cols-2">
          <Field data-invalid={!!errors.name}>
            <FieldLabel htmlFor="name">Name</FieldLabel>
            <Input id="name" placeholder="Exa Search" aria-invalid={!!errors.name} {...register('name')} />
            <FieldError errors={[errors.name]} />
          </Field>
          <Field data-invalid={!!errors.slug}>
            <FieldLabel htmlFor="slug">Slug</FieldLabel>
            <Input
              id="slug"
              placeholder={slugify(name) || 'derived-from-the-name'}
              className="font-mono"
              aria-invalid={!!errors.slug}
              {...register('slug')}
            />
            <FieldDescription>Used as the tool prefix. Leave empty to derive it from the name.</FieldDescription>
            <FieldError errors={[errors.slug]} />
          </Field>
        </div>
        <Field data-invalid={!!errors.description}>
          <FieldLabel htmlFor="description">Description</FieldLabel>
          <Textarea id="description" rows={2} placeholder="Optional" {...register('description')} />
          <FieldError errors={[errors.description]} />
        </Field>
        <Field orientation="horizontal">
          <Controller
            control={control}
            name="enabled"
            render={({ field }) => <Switch id="enabled" checked={field.value} onCheckedChange={field.onChange} />}
          />
          <FieldContent>
            <FieldLabel htmlFor="enabled">Enabled</FieldLabel>
            <FieldDescription>Disabled providers are left out of every endpoint.</FieldDescription>
          </FieldContent>
        </Field>
      </Section>

      <Section title="Connection" description="Where the upstream MCP server lives.">
        <Field data-invalid={!!errors.transport}>
          <FieldLabel htmlFor="transport">Transport</FieldLabel>
          <Controller
            control={control}
            name="transport"
            render={({ field }) => (
              <Select value={field.value} onValueChange={(value) => changeTransport(value as Transport)}>
                <SelectTrigger id="transport" className="w-full sm:w-72">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TRANSPORTS.map((value) => (
                    <SelectItem key={value} value={value}>
                      {TRANSPORT_LABELS[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
          <FieldDescription>{TRANSPORT_HELP[transport]}</FieldDescription>
        </Field>

        {!stdio ? (
          <Field data-invalid={!!errors.url}>
            <FieldLabel htmlFor="url">URL</FieldLabel>
            <Input
              id="url"
              type="url"
              placeholder="https://mcp.example.com/mcp"
              className="font-mono text-xs"
              aria-invalid={!!errors.url}
              {...register('url')}
            />
            <FieldError errors={[errors.url]} />
          </Field>
        ) : (
          <>
            <Field data-invalid={!!errors.command}>
              <FieldLabel htmlFor="command">Command</FieldLabel>
              <Input id="command" placeholder="npx" className="font-mono text-xs" aria-invalid={!!errors.command} {...register('command')} />
              <FieldError errors={[errors.command]} />
            </Field>
            <Field data-invalid={!!errors.args}>
              <FieldLabel htmlFor="args">Arguments</FieldLabel>
              <Controller
                control={control}
                name="args"
                render={({ field }) => (
                  <ListEditor
                    id="args"
                    value={field.value}
                    onChange={field.onChange}
                    addLabel="Add argument"
                    placeholder="-y"
                    emptyText="No arguments."
                    errorAt={(index) => errors.args?.[index]?.message}
                  />
                )}
              />
            </Field>
            <FieldSet data-invalid={!!envError}>
              <FieldLegend variant="label">Environment variables</FieldLegend>
              <FieldDescription>
                The process only gets a minimal environment plus these variables.
              </FieldDescription>
              <div className="space-y-2">
                {envRows.fields.map((row, index) => {
                  const keyError = errors.env?.[index]?.key?.message;
                  return (
                    <div key={row.id} className="space-y-1">
                      <div className="flex items-center gap-2">
                        <Input
                          aria-label={`Variable ${index + 1} name`}
                          placeholder="NAME"
                          className="w-2/5 font-mono text-xs"
                          aria-invalid={!!keyError}
                          {...register(`env.${index}.key`)}
                        />
                        <Input
                          aria-label={`Variable ${index + 1} value`}
                          placeholder={KEY}
                          className="flex-1 font-mono text-xs"
                          {...register(`env.${index}.value`)}
                        />
                        <Button type="button" variant="ghost" size="icon" aria-label="Remove variable" onClick={() => envRows.remove(index)}>
                          <X />
                        </Button>
                      </div>
                      {keyError && <p className="text-sm text-destructive">{keyError}</p>}
                    </div>
                  );
                })}
                <Button type="button" variant="outline" size="sm" onClick={() => envRows.append({ key: '', value: '' })}>
                  <Plus data-icon="inline-start" />
                  Add variable
                </Button>
              </div>
              <FieldError>{envError}</FieldError>
            </FieldSet>
          </>
        )}
      </Section>

      <Section title="Authentication" description="How the API key bound to a session reaches the upstream server.">
        <Field data-invalid={!!errors.authMode}>
          <FieldLabel htmlFor="authMode">Auth mode</FieldLabel>
          <Controller
            control={control}
            name="authMode"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange} disabled={stdio}>
                <SelectTrigger id="authMode" className="w-full sm:w-72">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(stdio ? (['env'] as AuthMode[]) : HTTP_AUTH_MODES).map((value) => (
                    <SelectItem key={value} value={value}>
                      {AUTH_MODE_LABELS[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
          <FieldDescription>{AUTH_HELP[authMode]}</FieldDescription>
          <FieldError errors={[errors.authMode]} />
        </Field>
        {authMode === 'header' && (
          <div className="grid gap-5 md:grid-cols-2">
            <Field data-invalid={!!errors.authHeaderName}>
              <FieldLabel htmlFor="authHeaderName">Header name</FieldLabel>
              <Input id="authHeaderName" className="font-mono text-xs" aria-invalid={!!errors.authHeaderName} {...register('authHeaderName')} />
              <FieldError errors={[errors.authHeaderName]} />
            </Field>
            <Field data-invalid={!!errors.authValueTemplate}>
              <FieldLabel htmlFor="authValueTemplate">Value template</FieldLabel>
              <Input
                id="authValueTemplate"
                className="font-mono text-xs"
                aria-invalid={!!errors.authValueTemplate}
                {...register('authValueTemplate')}
              />
              <FieldDescription>
                Must contain <code className="font-mono">{KEY}</code>.
              </FieldDescription>
              <FieldError errors={[errors.authValueTemplate]} />
            </Field>
          </div>
        )}
        {authMode === 'query' && (
          <Field data-invalid={!!errors.authQueryParam}>
            <FieldLabel htmlFor="authQueryParam">Query parameter</FieldLabel>
            <Input
              id="authQueryParam"
              placeholder="apiKey"
              className="font-mono text-xs sm:w-72"
              aria-invalid={!!errors.authQueryParam}
              {...register('authQueryParam')}
            />
            <FieldError errors={[errors.authQueryParam]} />
          </Field>
        )}
      </Section>

      <Section title="Rotation and failover" description="How keys are picked for new sessions and what counts as a key failure.">
        <div className="grid gap-5 md:grid-cols-2">
          <Field data-invalid={!!errors.rotationStrategy}>
            <FieldLabel htmlFor="rotationStrategy">Rotation strategy</FieldLabel>
            <Controller
              control={control}
              name="rotationStrategy"
              render={({ field }) => (
                <>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="rotationStrategy" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ROTATION_STRATEGIES.map((value) => (
                        <SelectItem key={value} value={value}>
                          {ROTATION_LABELS[value]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FieldDescription>{ROTATION_DESCRIPTIONS[field.value]}</FieldDescription>
                </>
              )}
            />
          </Field>
          <Field data-invalid={!!errors.cooldownSeconds}>
            <FieldLabel htmlFor="cooldownSeconds">Cooldown (seconds)</FieldLabel>
            <Input
              id="cooldownSeconds"
              type="number"
              min={0}
              step={1}
              aria-invalid={!!errors.cooldownSeconds}
              {...register('cooldownSeconds', { valueAsNumber: true })}
            />
            <FieldDescription>How long a failed key rests before it is used again. 0 disables cooldowns.</FieldDescription>
            <FieldError errors={[errors.cooldownSeconds]} />
          </Field>
        </div>
        <Field orientation="horizontal">
          <Controller
            control={control}
            name="failoverEnabled"
            render={({ field }) => <Switch id="failoverEnabled" checked={field.value} onCheckedChange={field.onChange} />}
          />
          <FieldContent>
            <FieldLabel htmlFor="failoverEnabled">Failover</FieldLabel>
            <FieldDescription>When a key fails, rebind the session to another key and retry the call.</FieldDescription>
          </FieldContent>
        </Field>
        <FieldSet>
          <FieldLegend variant="label">Failure rules</FieldLegend>
          <FieldDescription>Responses matching any rule count as a key failure (error count, cooldown, failover).</FieldDescription>
          <Field data-invalid={!!errors.failureRules?.httpStatuses}>
            <FieldLabel htmlFor="httpStatuses">HTTP status codes</FieldLabel>
            <Controller
              control={control}
              name="failureRules.httpStatuses"
              render={({ field }) => (
                <StatusCodesInput
                  id="httpStatuses"
                  value={field.value}
                  onChange={field.onChange}
                  invalid={!!errors.failureRules?.httpStatuses}
                />
              )}
            />
            <FieldError errors={[errors.failureRules?.httpStatuses]} />
          </Field>
          <Field data-invalid={!!errors.failureRules?.messagePatterns}>
            <FieldLabel htmlFor="messagePatterns">Error message patterns</FieldLabel>
            <Controller
              control={control}
              name="failureRules.messagePatterns"
              render={({ field }) => (
                <ListEditor
                  id="messagePatterns"
                  value={field.value}
                  onChange={field.onChange}
                  addLabel="Add pattern"
                  placeholder="rate limit|quota"
                  emptyText="No patterns."
                  errorAt={(index) => errors.failureRules?.messagePatterns?.[index]?.message}
                />
              )}
            />
            <FieldDescription>Case-insensitive regular expressions, matched against error messages.</FieldDescription>
            <FieldError>{errors.failureRules?.messagePatterns?.message}</FieldError>
          </Field>
        </FieldSet>
      </Section>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting && <Spinner data-icon="inline-start" />}
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
