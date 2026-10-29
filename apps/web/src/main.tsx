import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { AppProviders } from './app-providers';
import { connectUnauthorizedHandler, createQueryClient } from './lib/query-client';
import { routes } from './routes';
import './index.css';

const root = document.getElementById('root');
if (!root) throw new Error('Root element #root not found');

const queryClient = createQueryClient();
connectUnauthorizedHandler(queryClient);
const router = createBrowserRouter(routes);

createRoot(root).render(
  <StrictMode>
    <AppProviders queryClient={queryClient}>
      <RouterProvider router={router} />
    </AppProviders>
  </StrictMode>,
);
