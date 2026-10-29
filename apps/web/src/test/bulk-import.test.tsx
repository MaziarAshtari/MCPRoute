import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ADMIN_SESSION, apiKeyDto, providerDto } from './fixtures';
import { mockApi, renderApp } from './utils';

const PROVIDER = providerDto();
const BASE = `/api/providers/${PROVIDER.id}`;

const BULK_TEXT = [
  'sk-live-0001',
  '# comment lines are ignored',
  'sk-live-0002|socks5://user:pass@203.0.113.10:1080|Backup',
  'sk-live-0001',
  'sk-live-0003|not a proxy',
].join('\n');

describe('bulk key import', () => {
  it('sends the pasted lines and shows the created / skipped / errors result', async () => {
    let imported = false;
    const api = mockApi({
      'GET /api/auth/me': ADMIN_SESSION,
      [`GET ${BASE}`]: PROVIDER,
      [`GET ${BASE}/keys`]: () => ({ body: imported ? [apiKeyDto({ label: 'Backup' })] : [] }),
      'GET /api/proxies': [],
      [`POST ${BASE}/keys/bulk`]: () => {
        imported = true;
        return {
          body: { created: 2, skipped: 1, proxiesCreated: 1, errors: [{ line: 5, message: 'Invalid proxy: Unrecognized proxy format' }] },
        };
      },
    });
    const user = userEvent.setup();
    renderApp(`/providers/${PROVIDER.id}`);

    await user.click((await screen.findAllByRole('button', { name: 'Add keys' }))[0] as HTMLElement);
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('tab', { name: 'Bulk import' }));

    const textarea = within(dialog).getByLabelText('Keys');
    await user.click(textarea);
    await user.paste(BULK_TEXT);
    expect(within(dialog).getByText('4 entries')).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Import 4 keys' }));

    const result = await within(dialog).findByRole('status', { name: 'Import result' });
    expect(within(result).getByText('2 created')).toBeInTheDocument();
    expect(within(result).getByText('1 skipped')).toBeInTheDocument();
    expect(within(result).getByText('1 error')).toBeInTheDocument();
    expect(within(result).getByText('1 new proxy')).toBeInTheDocument();
    const errorRow = within(result).getByText('Invalid proxy: Unrecognized proxy format').closest('tr') as HTMLElement;
    expect(within(errorRow).getByText('5')).toBeInTheDocument();

    expect(api.requestsTo('POST', `${BASE}/keys/bulk`)[0]?.body).toEqual({ text: BULK_TEXT, defaultProxyScheme: 'http' });
    // Lines with errors are kept so they can be fixed and imported again.
    expect(textarea).toHaveValue(BULK_TEXT);
    // The key list is refreshed behind the dialog.
    expect(await screen.findByText('Backup')).toBeInTheDocument();
  });
});
