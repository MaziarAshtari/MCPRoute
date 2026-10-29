import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ADMIN_SESSION } from './fixtures';
import { mockApi, renderApp } from './utils';

const UNAUTHORIZED = { status: 401, body: { statusCode: 401, error: 'Unauthorized', message: 'Authentication required' } };

describe('login', () => {
  it('redirects to the login page when the API answers 401', async () => {
    mockApi({ 'GET /api/auth/me': () => UNAUTHORIZED });
    const { router } = renderApp('/providers');

    expect(await screen.findByLabelText('Username')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
    expect(router.state.location.search).toBe('?next=%2Fproviders');
  });

  it('signs in with the shared schema and returns to the requested page', async () => {
    let signedIn = false;
    const api = mockApi({
      'GET /api/auth/me': () => (signedIn ? { body: ADMIN_SESSION } : UNAUTHORIZED),
      'POST /api/auth/login': () => {
        signedIn = true;
        return { body: ADMIN_SESSION };
      },
      'GET /api/providers': [],
    });
    const user = userEvent.setup();
    const { router } = renderApp('/login?next=%2Fproviders');

    await user.click(await screen.findByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Username is required')).toBeInTheDocument();
    expect(screen.getByText('Password is required')).toBeInTheDocument();
    expect(api.requestsTo('POST', '/api/auth/login')).toHaveLength(0);

    await user.type(screen.getByLabelText('Username'), 'admin');
    await user.type(screen.getByLabelText('Password'), 'correct-horse');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('No providers yet')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/providers');
    expect(api.requestsTo('POST', '/api/auth/login')[0]?.body).toEqual({ username: 'admin', password: 'correct-horse' });
    expect(screen.getByRole('button', { name: 'User menu' })).toHaveTextContent('admin');
  });

  it('shows the error message for invalid credentials', async () => {
    mockApi({
      'GET /api/auth/me': () => UNAUTHORIZED,
      'POST /api/auth/login': () => ({
        status: 401,
        body: { statusCode: 401, error: 'Unauthorized', message: 'Invalid username or password' },
      }),
    });
    const user = userEvent.setup();
    const { router } = renderApp('/login');

    await user.type(await screen.findByLabelText('Username'), 'admin');
    await user.type(screen.getByLabelText('Password'), 'wrong-password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(screen.getAllByText('Invalid username or password').length).toBeGreaterThan(0));
    expect(router.state.location.pathname).toBe('/login');
  });
});
