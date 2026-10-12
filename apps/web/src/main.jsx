import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { routes } from './app/routes.js';
import { createQueryClient } from './app/queryClient.js';
import './styles.css';

const router = createBrowserRouter(routes);
const queryClient = createQueryClient();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
