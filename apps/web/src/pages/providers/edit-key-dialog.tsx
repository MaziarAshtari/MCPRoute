import { zodResolver } from '@hookform/resolvers/zod';
import { apiKeyUpdateSchema, type ApiKeyDto } from '@mcproute/shared';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { NO_PROXY, ProxySelect } from '@/components/proxy-select';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { applyApiIssues } from '@/lib/forms';
import { useUpdateKey } from '@/queries/keys';
import { useProxies } from '@/queries/proxies';

const editKeySchema = z
  .object({
    label: z.string(),
    weight: z.number({ error: 'Enter a weight between 1 and 1000' }),
    proxyId: z.string(),
  })
  .transform((values): z.input<typeof apiKeyUpdateSchema> => ({
    label: values.label,
    weight: values.weight,
    proxyId: values.proxyId === NO_PROXY ? null : values.proxyId,
  }))
  .pipe(apiKeyUpdateSchema);

type EditKeyValues = z.input<typeof editKeySchema>;
type EditKeyInput = z.output<typeof editKeySchema>;

function EditKeyForm({ apiKey, onDone }: { apiKey: ApiKeyDto; onDone: () => void }) {
  const proxies = useProxies();
  const updateKey = useUpdateKey();
  const {
    control,
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<EditKeyValues, unknown, EditKeyInput>({
    resolver: zodResolver(editKeySchema),
    defaultValues: { label: apiKey.label, weight: apiKey.weight, proxyId: apiKey.proxyId ?? NO_PROXY },
  });

  async function submit(input: EditKeyInput) {
    try {
      const saved = await updateKey.mutateAsync({ id: apiKey.id, input });
      toast.success(`Key "${saved.label}" updated`);
      onDone();
    } catch (error) {
      applyApiIssues(error, setError, ['label', 'weight', 'proxyId']);
    }
  }

  return (
    <form onSubmit={handleSubmit(submit)} noValidate>
      <FieldGroup>
        <Field data-invalid={!!errors.label}>
          <FieldLabel htmlFor="edit-label">Label</FieldLabel>
          <Input id="edit-label" aria-invalid={!!errors.label} {...register('label')} />
          <FieldError errors={[errors.label]} />
        </Field>
        <Field data-invalid={!!errors.weight}>
          <FieldLabel htmlFor="edit-weight">Weight</FieldLabel>
          <Input
            id="edit-weight"
            type="number"
            min={1}
            max={1000}
            className="sm:w-32"
            aria-invalid={!!errors.weight}
            {...register('weight', { valueAsNumber: true })}
          />
          <FieldDescription>Relative share of new sessions (1–1000).</FieldDescription>
          <FieldError errors={[errors.weight]} />
        </Field>
        <Field data-invalid={!!errors.proxyId}>
          <FieldLabel htmlFor="edit-proxy">Proxy</FieldLabel>
          <Controller
            control={control}
            name="proxyId"
            render={({ field }) => (
              <ProxySelect id="edit-proxy" value={field.value} onChange={field.onChange} proxies={proxies.data ?? []} />
            )}
          />
          <FieldDescription>Keys assigned to a disabled proxy are skipped, never sent directly.</FieldDescription>
          <FieldError errors={[errors.proxyId]} />
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

interface EditKeyDialogProps {
  apiKey: ApiKeyDto | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EditKeyDialog({ apiKey, open, onOpenChange }: EditKeyDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit key</DialogTitle>
          <DialogDescription>
            <code className="font-mono">{apiKey?.maskedKey}</code>
          </DialogDescription>
        </DialogHeader>
        {apiKey && <EditKeyForm key={apiKey.id} apiKey={apiKey} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}
