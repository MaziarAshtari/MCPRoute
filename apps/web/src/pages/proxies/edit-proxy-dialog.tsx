import { zodResolver } from '@hookform/resolvers/zod';
import { proxyUpdateSchema, type ProxyDto } from '@mcproute/shared';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, FieldContent, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { applyApiIssues } from '@/lib/forms';
import { useUpdateProxy } from '@/queries/proxies';

/** An empty URL keeps the stored one, which is never sent back with its password. */
const editProxySchema = z
  .object({ label: z.string(), url: z.string(), enabled: z.boolean() })
  .transform(
    (values): z.input<typeof proxyUpdateSchema> => ({
      label: values.label,
      enabled: values.enabled,
      ...(values.url.trim() ? { url: values.url } : {}),
    }),
  )
  .pipe(proxyUpdateSchema);

type EditProxyValues = z.input<typeof editProxySchema>;
type EditProxyInput = z.output<typeof editProxySchema>;

function EditProxyForm({ proxy, onDone }: { proxy: ProxyDto; onDone: () => void }) {
  const updateProxy = useUpdateProxy();
  const {
    control,
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<EditProxyValues, unknown, EditProxyInput>({
    resolver: zodResolver(editProxySchema),
    defaultValues: { label: proxy.label ?? '', url: '', enabled: proxy.enabled },
  });

  async function submit(input: EditProxyInput) {
    try {
      await updateProxy.mutateAsync({ id: proxy.id, input });
      toast.success('Proxy updated', { description: input.url ? 'Its health status was reset.' : undefined });
      onDone();
    } catch (error) {
      applyApiIssues(error, setError, ['label', 'url', 'enabled']);
    }
  }

  return (
    <form onSubmit={handleSubmit(submit)} noValidate>
      <FieldGroup>
        <Field data-invalid={!!errors.label}>
          <FieldLabel htmlFor="proxy-label">Label</FieldLabel>
          <Input id="proxy-label" placeholder="Optional, e.g. Frankfurt 1" aria-invalid={!!errors.label} {...register('label')} />
          <FieldError errors={[errors.label]} />
        </Field>
        <Field data-invalid={!!errors.url}>
          <FieldLabel htmlFor="proxy-url">Replace URL</FieldLabel>
          <Input
            id="proxy-url"
            placeholder={proxy.url}
            autoComplete="off"
            className="font-mono text-xs"
            aria-invalid={!!errors.url}
            {...register('url')}
          />
          <FieldDescription>Leave empty to keep the current URL. A new URL must include the password again.</FieldDescription>
          <FieldError errors={[errors.url]} />
        </Field>
        <Field orientation="horizontal">
          <Controller
            control={control}
            name="enabled"
            render={({ field }) => <Switch id="proxy-enabled" checked={field.value} onCheckedChange={field.onChange} />}
          />
          <FieldContent>
            <FieldLabel htmlFor="proxy-enabled">Enabled</FieldLabel>
            <FieldDescription>Keys on a disabled proxy are skipped instead of connecting directly.</FieldDescription>
          </FieldContent>
        </Field>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting && <Spinner data-icon="inline-start" />}
            Save
          </Button>
        </DialogFooter>
      </FieldGroup>
    </form>
  );
}

interface EditProxyDialogProps {
  proxy: ProxyDto | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EditProxyDialog({ proxy, open, onOpenChange }: EditProxyDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit proxy</DialogTitle>
          <DialogDescription className="font-mono text-xs break-all">{proxy?.url}</DialogDescription>
        </DialogHeader>
        {proxy && <EditProxyForm key={proxy.id} proxy={proxy} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}
