import { useState, type ReactNode } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { TOOL_PREFIX_MODES, slugify, type ProviderDto, type ToolFilterMode } from '@mcproute/shared';
import { Search, Server } from 'lucide-react';
import { Controller, useFieldArray, useForm, useWatch, type Control } from 'react-hook-form';
import { Link } from 'react-router';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldContent, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { applyApiIssues } from '@/lib/forms';
import { pluralize } from '@/lib/format';
import { TOOL_FILTER_LABELS, TOOL_PREFIX_LABELS, TRANSPORT_SHORT_LABELS } from '@/lib/labels';
import { cn } from '@/lib/utils';
import { useProviders } from '@/queries/providers';
import { ENDPOINT_FORM_FIELDS, endpointFormSchema, type EndpointFormOutput, type EndpointFormValues } from './endpoint-form-schema';

function Section({ title, description, children }: { title: string; description: ReactNode; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

interface ToolChecklistProps {
  provider: ProviderDto;
  mode: Exclude<ToolFilterMode, 'all'>;
  value: string[];
  onChange: (names: string[]) => void;
}

function ToolChecklist({ provider, mode, value, onChange }: ToolChecklistProps) {
  const [search, setSearch] = useState('');
  const cached = provider.cachedTools ?? [];
  const known = new Set(cached.map((tool) => tool.name));
  // Names that are not in the cache (renamed upstream tools, prefixed names) stay visible so they are not lost.
  const items = [
    ...cached.map((tool) => ({ name: tool.name, hint: tool.title ?? tool.description ?? '', stale: false })),
    ...value.filter((name) => !known.has(name)).map((name) => ({ name, hint: 'Not in the cached tool list', stale: true })),
  ];
  const selected = new Set(value);
  const needle = search.trim().toLowerCase();
  const visible = items.filter((item) => item.name.toLowerCase().includes(needle));

  if (items.length === 0) {
    return (
      <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
        {provider.cachedTools === null ? 'Tools have not been fetched for this provider yet. ' : 'This provider has no tools. '}
        <Link to={`/providers/${provider.id}?tab=tools`} className="underline underline-offset-4 hover:text-foreground">
          Refresh its tools
        </Link>{' '}
        to choose them here.
      </p>
    );
  }

  function toggle(name: string, checked: boolean) {
    onChange(checked ? [...value, name] : value.filter((current) => current !== name));
  }

  return (
    <div className="rounded-lg border bg-background">
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <span className="text-sm text-muted-foreground">
          {selected.size} of {items.length} {mode === 'allowlist' ? 'exposed' : 'hidden'}
        </span>
        <div className="ml-auto flex items-center gap-1">
          {items.length > 8 && (
            <InputGroup className="h-7 w-40">
              <InputGroupAddon>
                <Search />
              </InputGroupAddon>
              <InputGroupInput placeholder="Filter" aria-label="Filter tools" value={search} onChange={(event) => setSearch(event.target.value)} />
            </InputGroup>
          )}
          <Button type="button" size="xs" variant="ghost" onClick={() => onChange(items.map((item) => item.name))}>
            All
          </Button>
          <Button type="button" size="xs" variant="ghost" onClick={() => onChange([])}>
            None
          </Button>
        </div>
      </div>
      <div className="max-h-64 overflow-auto p-1">
        {visible.map((item) => (
          <label key={item.name} className="flex cursor-pointer items-start gap-2.5 rounded-md px-2 py-1.5 hover:bg-muted">
            <Checkbox
              className="mt-0.5"
              checked={selected.has(item.name)}
              onCheckedChange={(checked) => toggle(item.name, checked === true)}
              aria-label={item.name}
            />
            <span className="min-w-0">
              <code className={cn('font-mono text-xs', item.stale && 'text-amber-600 dark:text-amber-400')}>{item.name}</code>
              {item.hint && <span className="block truncate text-xs text-muted-foreground">{item.hint}</span>}
            </span>
          </label>
        ))}
        {visible.length === 0 && <p className="px-2 py-3 text-center text-sm text-muted-foreground">No tools match.</p>}
      </div>
    </div>
  );
}

function LinkSettings({ control, index, provider }: { control: Control<EndpointFormValues>; index: number; provider: ProviderDto }) {
  const mode = useWatch({ control, name: `providers.${index}.toolFilterMode` }) ?? 'all';
  const toolNames = useWatch({ control, name: `providers.${index}.toolNames` }) ?? [];
  return (
    <div className="space-y-3 border-t px-3 py-3 sm:pl-10">
      <Controller
        control={control}
        name={`providers.${index}.toolFilterMode`}
        render={({ field }) => (
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={field.value ?? 'all'}
            onValueChange={(value) => value && field.onChange(value)}
            aria-label={`Tool filter for ${provider.name}`}
            className="flex-wrap"
          >
            {(['all', 'allowlist', 'denylist'] as const).map((value) => (
              <ToggleGroupItem
                key={value}
                value={value}
                className="data-[state=on]:border-primary data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
              >
                {TOOL_FILTER_LABELS[value]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        )}
      />
      {mode !== 'all' && (
        <>
          <Controller
            control={control}
            name={`providers.${index}.toolNames`}
            render={({ field }) => (
              <ToolChecklist provider={provider} mode={mode} value={field.value ?? []} onChange={field.onChange} />
            )}
          />
          {mode === 'allowlist' && toolNames.length === 0 && (provider.cachedTools?.length ?? 0) > 0 && (
            <p className="text-sm text-amber-600 dark:text-amber-400">No tools selected: this provider will expose no tools.</p>
          )}
        </>
      )}
    </div>
  );
}

interface EndpointFormProps {
  mode: 'create' | 'edit';
  defaultValues: EndpointFormValues;
  submitLabel: string;
  onSubmit: (values: EndpointFormOutput) => Promise<void>;
  onCancel: () => void;
}

export function EndpointForm({ mode, defaultValues, submitLabel, onSubmit, onCancel }: EndpointFormProps) {
  const providers = useProviders();
  const {
    control,
    register,
    handleSubmit,
    setValue,
    setError,
    formState: { errors, isSubmitting, isSubmitted },
  } = useForm<EndpointFormValues, unknown, EndpointFormOutput>({ resolver: zodResolver(endpointFormSchema), defaultValues });
  const links = useFieldArray({ control, name: 'providers' });
  const linkValues = useWatch({ control, name: 'providers' });
  // New endpoints derive the slug from the name until the slug is edited by hand.
  const [slugEdited, setSlugEdited] = useState(mode === 'edit');

  async function submit(values: EndpointFormOutput) {
    try {
      await onSubmit(values);
    } catch (error) {
      applyApiIssues(error, setError, ENDPOINT_FORM_FIELDS);
    }
  }

  return (
    <form onSubmit={handleSubmit(submit)} noValidate className="space-y-6">
      <Section title="General" description="The endpoint is served at /mcp/{slug}.">
        <FieldGroup>
          <div className="grid gap-5 md:grid-cols-2">
            <Field data-invalid={!!errors.name}>
              <FieldLabel htmlFor="endpoint-name">Name</FieldLabel>
              <Input
                id="endpoint-name"
                placeholder="Research"
                aria-invalid={!!errors.name}
                {...register('name', {
                  onChange: (event: { target: { value: string } }) => {
                    if (!slugEdited) setValue('slug', slugify(event.target.value), { shouldValidate: isSubmitted });
                  },
                })}
              />
              <FieldError errors={[errors.name]} />
            </Field>
            <Field data-invalid={!!errors.slug}>
              <FieldLabel htmlFor="endpoint-slug">Slug</FieldLabel>
              <Input
                id="endpoint-slug"
                placeholder="research"
                className="font-mono"
                aria-invalid={!!errors.slug}
                {...register('slug', { onChange: () => setSlugEdited(true) })}
              />
              <FieldDescription>Lowercase letters, digits and hyphens. Changing it changes the URL.</FieldDescription>
              <FieldError errors={[errors.slug]} />
            </Field>
          </div>
          <Field data-invalid={!!errors.description}>
            <FieldLabel htmlFor="endpoint-description">Description</FieldLabel>
            <Textarea id="endpoint-description" rows={2} placeholder="Optional" {...register('description')} />
            <FieldError errors={[errors.description]} />
          </Field>
          <Field orientation="horizontal">
            <Controller
              control={control}
              name="enabled"
              render={({ field }) => <Switch id="endpoint-enabled" checked={field.value} onCheckedChange={field.onChange} />}
            />
            <FieldContent>
              <FieldLabel htmlFor="endpoint-enabled">Enabled</FieldLabel>
              <FieldDescription>Disabled endpoints answer 404 to MCP clients.</FieldDescription>
            </FieldContent>
          </Field>
        </FieldGroup>
      </Section>

      <Section title="Tools and transport" description="How the tools of several providers are combined.">
        <FieldGroup>
          <Field>
            <FieldLabel>Tool names</FieldLabel>
            <Controller
              control={control}
              name="toolPrefixMode"
              render={({ field }) => (
                <RadioGroup value={field.value} onValueChange={field.onChange} className="grid gap-3 md:grid-cols-2">
                  {TOOL_PREFIX_MODES.map((value) => (
                    <FieldLabel key={value} htmlFor={`prefix-${value}`}>
                      <Field orientation="horizontal">
                        <RadioGroupItem value={value} id={`prefix-${value}`} />
                        <FieldContent>
                          <span className="font-medium">{TOOL_PREFIX_LABELS[value].label}</span>
                          <FieldDescription>{TOOL_PREFIX_LABELS[value].description}</FieldDescription>
                        </FieldContent>
                      </Field>
                    </FieldLabel>
                  ))}
                </RadioGroup>
              )}
            />
          </Field>
          <Field orientation="horizontal">
            <Controller
              control={control}
              name="enableSse"
              render={({ field }) => <Switch id="endpoint-sse" checked={field.value} onCheckedChange={field.onChange} />}
            />
            <FieldContent>
              <FieldLabel htmlFor="endpoint-sse">Legacy SSE transport</FieldLabel>
              <FieldDescription>Also serve /mcp/{'{slug}'}/sse for clients that only speak the old HTTP + SSE transport.</FieldDescription>
            </FieldContent>
          </Field>
        </FieldGroup>
      </Section>

      <Section
        title="Linked providers"
        description="Choose the providers this endpoint aggregates and, per provider, which of its tools to expose."
      >
        {providers.isPending ? (
          <div className="space-y-2">
            <Skeleton className="h-14" />
            <Skeleton className="h-14" />
          </div>
        ) : !providers.data || providers.data.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-6 text-center">
            <Server className="size-6 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">There are no providers yet. Create one first, then link it here.</p>
            <Button asChild variant="outline" size="sm">
              <Link to="/providers/new">New provider</Link>
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            {providers.data.map((provider) => {
              const index = linkValues.findIndex((link) => link.providerId === provider.id);
              const linked = index >= 0;
              return (
                <div key={provider.id} className={cn('rounded-lg border transition-colors', linked && 'border-primary/30 bg-muted/30')}>
                  <label className="flex cursor-pointer items-center gap-3 p-3">
                    <Checkbox
                      checked={linked}
                      aria-label={`Link ${provider.name}`}
                      onCheckedChange={(checked) => {
                        if (checked === true && !linked) links.append({ providerId: provider.id, toolFilterMode: 'all', toolNames: [] });
                        else if (checked !== true && linked) links.remove(index);
                      }}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{provider.name}</span>
                      <span className="block truncate font-mono text-xs text-muted-foreground">{provider.slug}</span>
                    </span>
                    {!provider.enabled && <Badge variant="outline">Disabled</Badge>}
                    <Badge variant="secondary">{TRANSPORT_SHORT_LABELS[provider.transport]}</Badge>
                    <span className="hidden text-xs text-muted-foreground sm:inline">
                      {provider.cachedTools ? pluralize(provider.cachedTools.length, 'tool') : 'tools unknown'}
                    </span>
                  </label>
                  {linked && <LinkSettings control={control} index={index} provider={provider} />}
                </div>
              );
            })}
          </div>
        )}
        <FieldError className="mt-2">{errors.providers?.message ?? errors.providers?.root?.message}</FieldError>
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
