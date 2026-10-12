import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { routes } from './routes.js';

vi.mock('../lib/apiClient.js', () => ({
  fetchHealth: vi.fn(async () => ({ status: 'ok' })),
}));

function renderAt(path) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

afterEach(cleanup);

describe('routes', () => {
  it('renders the home page inside the layout', async () => {
    renderAt('/');

    expect(screen.getByRole('heading', { level: 1, name: 'WorkBridge' })).toBeTruthy();
    expect(screen.getByText('개발 환경')).toBeTruthy();
    expect(await screen.findByText('정상 (ok)')).toBeTruthy();
  });

  it('renders the 404 page for unknown paths', () => {
    renderAt('/no-such-page');

    expect(screen.getByRole('heading', { name: '404' })).toBeTruthy();
    expect(screen.getByRole('link', { name: '홈으로 돌아가기' }).getAttribute('href')).toBe('/');
  });
});
