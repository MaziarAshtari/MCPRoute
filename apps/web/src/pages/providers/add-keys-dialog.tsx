import { useMemo, useState, type FormEvent } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  DEFAULT_PROXY_SCHEMES,
  apiKeyCreateSchema,
  bulkKeysImportSchema,
  splitBulkLines,
  type BulkKeysImportResult,
  type DefaultProxyScheme,
  type ProviderDto,
} from '@mcproute/shared';
import { Eye, EyeOff } from 'lucide-react';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { ImportResult } from '@/components/import-result';
import { NO_PROXY, ProxySelect } from '@/components/proxy-select';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/components/ui/input-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { ApiError } from '@/lib/api';
import { applyApiIssues } from '@/lib/forms';
import { formatNumber, pluralize } from '@/lib/format';
import { useBulkImportKeys, useCreateKey } from '@/queries/keys';
import { useProxies } from '@/queries/proxies';

const singleKeySchema = z
  .object({
    key: z.string(),
    label: z.string(),
    proxyId: z.string(),
    weight: z.number({ error: 'Enter a weight between 1 and 1000' }),
  })
  .transform((values): z.input<typeof apiKeyCreateSchema> => ({
    key: values.key,
    label: values.label.trim() || undefined,
    proxyId: values.proxyId === NO_PROXY ? null : values.proxyId,
    weight: values.weight,
    enabled: true,
  }))
  .pipe(apiKeyCreateSchema);

type SingleKeyValues = z.input<typeof singleKeySchema>;
type SingleKeyInput = z.output<typeof singleKeySchema>;

function SingleKeyForm({ provider, onDone }: { provider: ProviderDto; onDone: () => void }) {
  const proxies = useProxies();
  const createKey = useCreateKey(provider.id);
  const [reveal, setReveal] = useState(false);
  const {
    control,
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<SingleKeyValues, unknown, SingleKeyInput>({
    resolver: zodResolver(singleKeySchema),
    defaultValues: { key: '', label: '', proxyId: NO_PROXY, weight: 1 },
  });

  async function submit(input: SingleKeyInput) {
    try {
      const key = await createKey.mutateAsync(input);
      toast.success(`Key "${key.label}" added`);
      onDone();
    } catch (error) {
      applyApiIssues(error, setError, ['key', 'label', 'proxyId', 'weight']);
      if (error instanceof ApiError && error.status === 409) setError('key', { type: 'server', message: error.message });
    }
  }

  return (
    <form onSubmit={handleSubmit(submit)} noValidate>
      <FieldGroup>
        <Field data-invalid={!!errors.key}>
          <FieldLabel htmlFor="single-key">API key</FieldLabel>
          <InputGroup>
            <InputGroupInput
              id="single-key"
              type={reveal ? 'text' : 'password'}
              autoComplete="off"
              data-1p-ignore
              data-lpignore="true"
              className="font-mono"
              aria-invalid={!!errors.key}
              {...register('key')}
            />
            <InputGroupAddon align="inline-end">
              <InputGroupButton size="icon-xs" aria-label={reveal ? 'Hide key' : 'Show key'} onClick={() => setReveal((value) => !value)}>
                {reveal ? <EyeOff /> : <Eye />}
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
          <FieldDescription>Stored encrypted; afterwards only a masked form is shown.</FieldDescription>
          <FieldError errors={[errors.key]} />
        </Field>
        <div className="grid gap-5 sm:grid-cols-[1fr_8rem]">
          <Field data-invalid={!!errors.label}>
            <FieldLabel htmlFor="single-label">Label</FieldLabel>
            <Input id="single-label" placeholder="Defaults to the masked key" aria-invalid={!!errors.label} {...register('label')} />
            <FieldError errors={[errors.label]} />
          </Field>
          <Field data-invalid={!!errors.weight}>
            <FieldLabel htmlFor="single-weight">Weight</FieldLabel>
            <Input
              id="single-weight"
              type="number"
              min={1}
              max={1000}
              aria-invalid={!!errors.weight}
              {...register('weight', { valueAsNumber: true })}
            />
            <FieldError errors={[errors.weight]} />
          </Field>
        </div>
        <Field data-invalid={!!errors.proxyId}>
          <FieldLabel htmlFor="single-proxy">Proxy</FieldLabel>
          <Controller
            control={control}
            name="proxyId"
            render={({ field }) => (
              <ProxySelect id="single-proxy" value={field.value} onChange={field.onChange} proxies={proxies.data ?? []} />
            )}
          />
          <FieldError errors={[errors.proxyId]} />
        </Field>
        <DialogFooter>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting && <Spinner data-icon="inline-start" />}
            Add key
          </Button>
        </DialogFooter>
      </FieldGroup>
    </form>
  );
}

const BULK_PLACEHOLDER = [
  'sk-live-0001',
  'sk-live-0002|socks5://user:pass@203.0.113.10:1080',
  'sk-live-0003|203.0.113.11:8080:user:pass|Backup key',
  'sk-live-0004||Label without proxy',
].join('\n');

function BulkKeysForm({ provider, onDone }: { provider: ProviderDto; onDone: () => void }) {
  const bulkImport = useBulkImportKeys(provider.id);
  const [text, setText] = useState('');
  const [scheme, setScheme] = useState<DefaultProxyScheme>('http');
  const [result, setResult] = useState<BulkKeysImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const entries = useMemo(() => splitBulkLines(text).length, [text]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = bulkKeysImportSchema.safeParse({ text, defaultProxyScheme: scheme });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Invalid input');
      return;
    }
    setError(null);
    try {
      const imported = await bulkImport.mutateAsync(parsed.data);
      setResult(imported);
      // Keep the text when lines failed so they can be fixed; imported keys are skipped on a retry.
      if (imported.errors.length === 0) setText('');
      const details = `${formatNumber(imported.skipped)} skipped · ${pluralize(imported.errors.length, 'error')}`;
      if (imported.created > 0) toast.success(`Imported ${pluralize(imported.created, 'key')}`, { description: details });
      else if (imported.errors.length > 0) toast.error('No keys imported', { description: details });
      else toast.info('No new keys', { description: 'All keys already exist for this provider.' });
    } catch {
      // Reported by the mutation cache.
    }
  }

  return (
    <form onSubmit={submit} noValidate>
      <FieldGroup>
        <Field data-invalid={!!error}>
          <FieldLabel htmlFor="bulk-keys">Keys</FieldLabel>
          <Textarea
            id="bulk-keys"
            rows={8}
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={BULK_PLACEHOLDER}
            spellCheck={false}
            autoComplete="off"
            className="max-h-72 font-mono text-xs"
            aria-invalid={!!error}
          />
          <FieldDescription>
            One entry per line: <code className="font-mono">key</code>, <code className="font-mono">key|proxyUrl</code> or{' '}
            <code className="font-mono">key|proxyUrl|label</code>. Blank lines and lines starting with # are ignored.
          </FieldDescription>
          <FieldError>{error}</FieldError>
        </Field>
        <Field>
          <FieldLabel htmlFor="bulk-scheme">Scheme for proxies without one</FieldLabel>
          <Select value={scheme} onValueChange={(value) => setScheme(value as DefaultProxyScheme)}>
            <SelectTrigger id="bulk-scheme" className="w-full sm:w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DEFAULT_PROXY_SCHEMES.map((value) => (
                <SelectItem key={value} value={value}>
                  {value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        {result && <ImportResult {...result} />}
        <DialogFooter className="items-center sm:justify-between">
          <span className="text-sm text-muted-foreground">{pluralize(entries, 'entry', 'entries')}</span>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            {result && (
              <Button type="button" variant="outline" onClick={onDone}>
                Done
              </Button>
            )}
            <Button type="submit" disabled={entries === 0 || bulkImport.isPending}>
              {bulkImport.isPending && <Spinner data-icon="inline-start" />}
              Import {entries > 0 ? pluralize(entries, 'key') : 'keys'}
            </Button>
          </div>
        </DialogFooter>
      </FieldGroup>
    </form>
  );
}

interface AddKeysDialogProps {
  provider: ProviderDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddKeysDialog({ provider, open, onOpenChange }: AddKeysDialogProps) {
  const close = () => onOpenChange(false);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Add API keys to {provider.name}</DialogTitle>
          <DialogDescription>Keys are encrypted at rest and never shown in full again.</DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="single">
          <TabsList className="w-full">
            <TabsTrigger value="single">Single key</TabsTrigger>
            <TabsTrigger value="bulk">Bulk import</TabsTrigger>
          </TabsList>
          <TabsContent value="single" className="mt-4">
            <SingleKeyForm provider={provider} onDone={close} />
          </TabsContent>
          <TabsContent value="bulk" className="mt-4">
            <BulkKeysForm provider={provider} onDone={close} />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
