import { useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { PageHeader } from '@/components/page-header';
import { PageSkeleton, QueryError } from '@/components/states';
import { useCreateProvider, useProvider, useUpdateProvider } from '@/queries/providers';
import { ProviderForm } from './provider-form';
import { defaultProviderValues, providerToFormValues } from './provider-form-schema';

export function ProviderCreatePage() {
  const navigate = useNavigate();
  const createProvider = useCreateProvider();
  return (
    <>
      <PageHeader
        back={{ to: '/providers', label: 'Providers' }}
        title="New provider"
        description="Connect an upstream MCP server. You add its API keys after creating it."
      />
      <ProviderForm
        mode="create"
        defaultValues={defaultProviderValues()}
        submitLabel="Create provider"
        onCancel={() => navigate('/providers')}
        onSubmit={async (config) => {
          const provider = await createProvider.mutateAsync(config);
          toast.success(`Provider "${provider.name}" created`, { description: 'Add API keys to start using it.' });
          navigate(`/providers/${provider.id}`);
        }}
      />
    </>
  );
}

export function ProviderEditPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const provider = useProvider(id);
  const updateProvider = useUpdateProvider();

  if (provider.isPending) return <PageSkeleton />;
  if (provider.isError) {
    return (
      <>
        <PageHeader back={{ to: '/providers', label: 'Providers' }} title="Edit provider" />
        <QueryError title="Could not load the provider" error={provider.error} onRetry={() => void provider.refetch()} />
      </>
    );
  }

  return (
    <>
      <PageHeader
        back={{ to: `/providers/${id}`, label: provider.data.name }}
        title={`Edit ${provider.data.name}`}
        description="Changes apply to new upstream connections."
      />
      <ProviderForm
        key={provider.data.id}
        mode="edit"
        defaultValues={providerToFormValues(provider.data)}
        submitLabel="Save changes"
        onCancel={() => navigate(`/providers/${id}`)}
        onSubmit={async (config) => {
          const saved = await updateProvider.mutateAsync({ id, input: config });
          toast.success(`Provider "${saved.name}" saved`);
          navigate(`/providers/${id}`);
        }}
      />
    </>
  );
}
