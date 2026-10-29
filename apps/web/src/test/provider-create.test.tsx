import { screen, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { defaultFailureRules } from '@mcproute/shared';
import { describe, expect, it } from 'vitest';
import { ADMIN_SESSION, providerDto } from './fixtures';
import { mockApi, renderApp, type MockRequest } from './utils';

const CREATED_ID = 'c56a4180-65aa-42ec-a945-5fd21dec0538';

function providerApi() {
  return mockApi({
    'GET /api/auth/me': ADMIN_SESSION,
    'GET /api/providers': [],
    'POST /api/providers': ({ body }: MockRequest) => ({
      status: 201,
      body: providerDto({ ...(body as object), id: CREATED_ID }),
    }),
    [`GET /api/providers/${CREATED_ID}`]: providerDto({ id: CREATED_ID, name: 'Created' }),
    [`GET /api/providers/${CREATED_ID}/keys`]: [],
    'GET /api/proxies': [],
  });
}

async function choosePreset(user: UserEvent, label: string) {
  await user.click(await screen.findByRole('combobox', { name: 'Start from' }));
  await user.click(await screen.findByRole('option', { name: label }));
}

describe('provider creation with a preset', () => {
  it('pre-fills the Tavily preset and creates the provider', async () => {
    const api = providerApi();
    const user = userEvent.setup();
    const { router } = renderApp('/providers/new');

    await choosePreset(user, 'Tavily');
    expect(screen.getByLabelText('Name')).toHaveValue('Tavily');
    expect(screen.getByLabelText('URL')).toHaveValue('https://mcp.tavily.com/mcp/?tavilyApiKey={{API_KEY}}');
    expect(screen.getByRole('combobox', { name: 'Auth mode' })).toHaveTextContent('URL placeholder');

    // Preset values stay editable.
    await user.clear(screen.getByLabelText('Name'));
    await user.type(screen.getByLabelText('Name'), 'Tavily EU');
    await user.click(screen.getByRole('button', { name: 'Create provider' }));

    await screen.findByText('Add API keys to start using it.');
    expect(router.state.location.pathname).toBe(`/providers/${CREATED_ID}`);
    expect(api.requestsTo('POST', '/api/providers')[0]?.body).toEqual({
      name: 'Tavily EU',
      slug: 'tavily-eu',
      description: null,
      enabled: true,
      transport: 'streamable_http',
      url: 'https://mcp.tavily.com/mcp/?tavilyApiKey={{API_KEY}}',
      command: null,
      args: null,
      env: null,
      authMode: 'url_placeholder',
      authHeaderName: 'Authorization',
      authValueTemplate: 'Bearer {{API_KEY}}',
      authQueryParam: null,
      rotationStrategy: 'round_robin',
      failoverEnabled: true,
      cooldownSeconds: 300,
      failureRules: defaultFailureRules(),
    });
  });

  it('switches to stdio fields for the Brave Search preset', async () => {
    const api = providerApi();
    const user = userEvent.setup();
    renderApp('/providers/new');

    await choosePreset(user, 'Brave Search');
    expect(screen.queryByLabelText('URL')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Command')).toHaveValue('npx');
    expect(screen.getByLabelText('Variable 1 name')).toHaveValue('BRAVE_API_KEY');
    expect(screen.getByLabelText('Variable 1 value')).toHaveValue('{{API_KEY}}');

    await user.click(screen.getByRole('button', { name: 'Create provider' }));

    await screen.findByText('Add API keys to start using it.');
    expect(api.requestsTo('POST', '/api/providers')[0]?.body).toMatchObject({
      name: 'Brave Search',
      transport: 'stdio',
      url: null,
      command: 'npx',
      args: ['-y', '@brave/brave-search-mcp-server'],
      env: { BRAVE_API_KEY: '{{API_KEY}}' },
      authMode: 'env',
    });
  });

  it('validates with the shared provider schema before calling the API', async () => {
    const api = providerApi();
    const user = userEvent.setup();
    renderApp('/providers/new');

    await choosePreset(user, 'Firecrawl');
    const url = screen.getByLabelText('URL');
    expect(url).toHaveValue('https://mcp.firecrawl.dev/v2/mcp');
    expect(screen.getByLabelText('Value template')).toHaveValue('Bearer {{API_KEY}}');

    await user.clear(screen.getByLabelText('Value template'));
    await user.type(screen.getByLabelText('Value template'), 'Bearer static');
    await user.click(screen.getByRole('button', { name: 'Create provider' }));

    const field = (await screen.findByText('authValueTemplate must contain {{API_KEY}}')).closest('[role="group"]');
    expect(field).not.toBeNull();
    expect(within(field as HTMLElement).getByLabelText('Value template')).toHaveAttribute('aria-invalid', 'true');
    expect(api.requestsTo('POST', '/api/providers')).toHaveLength(0);
  });
});
