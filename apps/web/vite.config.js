import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

const envDir = '../..';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, envDir, '');
  const apiPort = env.API_PORT || '4000';

  return {
    envDir,
    plugins: [react()],
    server: {
      port: 5173,
      strictPort: true,
      proxy: {
        '/api': `http://localhost:${apiPort}`,
      },
    },
    test: {
      environment: 'jsdom',
      // Parallel jsdom workers can exceed Vitest's worker start timeout on slower machines.
      fileParallelism: false,
    },
  };
});
