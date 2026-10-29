import { lazy } from 'react';
import type { RouteObject } from 'react-router';
import { AppLayout } from '@/components/layout/app-layout';
import { LoginPage } from '@/pages/login';

// Pages are split into their own chunks; the login page and the shell stay in the entry bundle.
const DashboardPage = lazy(() => import('@/pages/dashboard').then((m) => ({ default: m.DashboardPage })));
const ProvidersPage = lazy(() => import('@/pages/providers/providers-page').then((m) => ({ default: m.ProvidersPage })));
const ProviderCreatePage = lazy(() =>
  import('@/pages/providers/provider-form-page').then((m) => ({ default: m.ProviderCreatePage })),
);
const ProviderEditPage = lazy(() =>
  import('@/pages/providers/provider-form-page').then((m) => ({ default: m.ProviderEditPage })),
);
const ProviderDetailPage = lazy(() =>
  import('@/pages/providers/provider-detail-page').then((m) => ({ default: m.ProviderDetailPage })),
);
const ProxiesPage = lazy(() => import('@/pages/proxies/proxies-page').then((m) => ({ default: m.ProxiesPage })));
const EndpointsPage = lazy(() => import('@/pages/endpoints/endpoints-page').then((m) => ({ default: m.EndpointsPage })));
const EndpointCreatePage = lazy(() =>
  import('@/pages/endpoints/endpoint-form-page').then((m) => ({ default: m.EndpointCreatePage })),
);
const EndpointEditPage = lazy(() =>
  import('@/pages/endpoints/endpoint-form-page').then((m) => ({ default: m.EndpointEditPage })),
);
const EndpointDetailPage = lazy(() =>
  import('@/pages/endpoints/endpoint-detail-page').then((m) => ({ default: m.EndpointDetailPage })),
);
const SessionsPage = lazy(() => import('@/pages/sessions-page').then((m) => ({ default: m.SessionsPage })));
const LogsPage = lazy(() => import('@/pages/logs-page').then((m) => ({ default: m.LogsPage })));
const NotFoundPage = lazy(() => import('@/pages/not-found').then((m) => ({ default: m.NotFoundPage })));

export const routes: RouteObject[] = [
  { path: '/login', element: <LoginPage /> },
  {
    path: '/',
    element: <AppLayout />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'providers', element: <ProvidersPage /> },
      { path: 'providers/new', element: <ProviderCreatePage /> },
      { path: 'providers/:id', element: <ProviderDetailPage /> },
      { path: 'providers/:id/edit', element: <ProviderEditPage /> },
      { path: 'endpoints', element: <EndpointsPage /> },
      { path: 'endpoints/new', element: <EndpointCreatePage /> },
      { path: 'endpoints/:id', element: <EndpointDetailPage /> },
      { path: 'endpoints/:id/edit', element: <EndpointEditPage /> },
      { path: 'proxies', element: <ProxiesPage /> },
      { path: 'sessions', element: <SessionsPage /> },
      { path: 'logs', element: <LogsPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];
