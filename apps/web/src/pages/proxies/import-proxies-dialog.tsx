import { useMemo, useState, type FormEvent } from 'react';
import {
  DEFAULT_PROXY_SCHEMES,
  bulkProxiesImportSchema,
  splitBulkLines,
  type BulkProxiesImportResult,
  type DefaultProxyScheme,
} from '@mcproute/shared';
import { toast } from 'sonner';
import { ImportResult } from '@/components/import-result';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { formatNumber, pluralize } from '@/lib/format';
import { useBulkImportProxies } from '@/queries/proxies';

const PLACEHOLDER = [
  'socks5://user:pass@203.0.113.10:1080',
  'user:pass@203.0.113.11:8080',
  '203.0.113.12:3128',
  '203.0.113.13:8080:user:pass',
].join('\n');

function ImportProxiesForm({ onDone }: { onDone: () => void }) {
  const bulkImport = useBulkImportProxies();
  const [text, setText] = useState('');
  const [scheme, setScheme] = useState<DefaultProxyScheme>('http');
  const [result, setResult] = useState<BulkProxiesImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const entries = useMemo(() => splitBulkLines(text).length, [text]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = bulkProxiesImportSchema.safeParse({ text, defaultScheme: scheme });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Invalid input');
      return;
    }
    setError(null);
    try {
      const imported = await bulkImport.mutateAsync(parsed.data);
      setResult(imported);
      if (imported.errors.length === 0) setText('');
      const details = `${formatNumber(imported.skipped)} skipped · ${pluralize(imported.errors.length, 'error')}`;
      if (imported.created > 0) toast.success(`Imported ${pluralize(imported.created, 'proxy', 'proxies')}`, { description: details });
      else if (imported.errors.length > 0) toast.error('No proxies imported', { description: details });
      else toast.info('No new proxies', { description: 'All proxies are already in the pool.' });
    } catch {
      // Reported by the mutation cache.
    }
  }

  return (
    <form onSubmit={submit} noValidate>
      <FieldGroup>
        <Field data-invalid={!!error}>
          <FieldLabel htmlFor="proxy-import">Proxies</FieldLabel>
          <Textarea
            id="proxy-import"
            rows={8}
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={PLACEHOLDER}
            spellCheck={false}
            autoComplete="off"
            className="max-h-72 font-mono text-xs"
            aria-invalid={!!error}
          />
          <FieldDescription>
            One proxy per line: <code className="font-mono">scheme://user:pass@host:port</code>,{' '}
            <code className="font-mono">user:pass@host:port</code>, <code className="font-mono">host:port</code> or{' '}
            <code className="font-mono">host:port:user:pass</code>. Duplicates are skipped.
          </FieldDescription>
          <FieldError>{error}</FieldError>
        </Field>
        <FieldSet>
          <FieldLegend variant="label">Default scheme</FieldLegend>
          <FieldDescription>Used for lines written without a scheme.</FieldDescription>
          <RadioGroup value={scheme} onValueChange={(value) => setScheme(value as DefaultProxyScheme)} className="flex gap-6">
            {DEFAULT_PROXY_SCHEMES.map((value) => (
              <Field key={value} orientation="horizontal" className="w-auto">
                <RadioGroupItem value={value} id={`scheme-${value}`} />
                <FieldLabel htmlFor={`scheme-${value}`} className="font-mono font-normal">
                  {value}
                </FieldLabel>
              </Field>
            ))}
          </RadioGroup>
        </FieldSet>
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
              Import {entries > 0 ? pluralize(entries, 'proxy', 'proxies') : 'proxies'}
            </Button>
          </div>
        </DialogFooter>
      </FieldGroup>
    </form>
  );
}

export function ImportProxiesDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Import proxies</DialogTitle>
          <DialogDescription>Add HTTP, HTTPS or SOCKS5 proxies to the pool. Passwords are never shown again.</DialogDescription>
        </DialogHeader>
        <ImportProxiesForm onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}
