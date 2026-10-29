import type { EndpointDto } from '@mcproute/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { PageHeader } from '@/components/page-header';
import { PageSkeleton, QueryError } from '@/components/states';
import { useDialogTarget } from '@/hooks/use-dialog-target';
import { errorMessage } from '@/lib/api';
import { createEndpoint, setEndpointProviders, updateEndpoint, useEndpoint } from '@/queries/endpoints';
import { queryKeys } from '@/queries/query-keys';
import { EndpointForm } from './endpoint-form';
import { defaultEndpointValues, endpointToFormValues, type EndpointFormOutput } from './endpoint-form-schema';
import { TokenDialog, type IssuedToken } from './token-dialog';

export function EndpointCreatePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const tokenDialog = useDialogTarget<IssuedToken>();

  async function create({ providers, ...config }: EndpointFormOutput) {
    let created;
    try {
      created = await createEndpoint(config);
    } catch (error) {
      toast.error('Could not create the endpoint', { description: errorMessage(error) });
      throw error;
    }
    let endpoint: EndpointDto = created;
    if (providers.length > 0) {
      try {
        endpoint = await setEndpointProviders(created.id, { providers });
      } catch (error) {
        toast.error('The endpoint was created, but its providers could not be linked', { description: errorMessage(error) });
      }
    }
    await queryClient.invalidateQueries({ queryKey: queryKeys.endpoints });
    toast.success(`Endpoint "${created.name}" created`);
    tokenDialog.show({ endpoint, token: created.accessToken });
  }

  return (
    <>
      <PageHeader
        back={{ to: '/endpoints', label: 'Endpoints' }}
        title="New endpoint"
        description="An MCP server that aggregates the providers you link. You get its access token after creating it."
      />
      <EndpointForm
        mode="create"
        defaultValues={defaultEndpointValues()}
        submitLabel="Create endpoint"
        onCancel={() => navigate('/endpoints')}
        onSubmit={create}
      />
      <TokenDialog
        issued={tokenDialog.target}
        open={tokenDialog.open}
        onOpenChange={(open) => {
          tokenDialog.onOpenChange(open);
          if (!open && tokenDialog.target) navigate(`/endpoints/${tokenDialog.target.endpoint.id}`, { replace: true });
        }}
      />
    </>
  );
}

export function EndpointEditPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const endpoint = useEndpoint(id);

  async function save({ providers, ...config }: EndpointFormOutput) {
    try {
      await updateEndpoint(id, config);
      await setEndpointProviders(id, { providers });
    } catch (error) {
      toast.error('Could not save the endpoint', { description: errorMessage(error) });
      throw error;
    } finally {
      await queryClient.invalidateQueries({ queryKey: queryKeys.endpoints });
    }
    toast.success(`Endpoint "${config.name}" saved`);
    navigate(`/endpoints/${id}`);
  }

  if (endpoint.isPending) return <PageSkeleton />;
  if (endpoint.isError) {
    return (
      <>
        <PageHeader back={{ to: '/endpoints', label: 'Endpoints' }} title="Edit endpoint" />
        <QueryError title="Could not load the endpoint" error={endpoint.error} onRetry={() => void endpoint.refetch()} />
      </>
    );
  }

  return (
    <>
      <PageHeader
        back={{ to: `/endpoints/${id}`, label: endpoint.data.name }}
        title={`Edit ${endpoint.data.name}`}
        description="Changes apply to new MCP sessions."
      />
      <EndpointForm
        key={endpoint.data.id}
        mode="edit"
        defaultValues={endpointToFormValues(endpoint.data)}
        submitLabel="Save changes"
        onCancel={() => navigate(`/endpoints/${id}`)}
        onSubmit={save}
      />
    </>
  );
}
