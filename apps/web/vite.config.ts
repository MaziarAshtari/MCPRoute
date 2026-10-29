import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  // The API server port comes from the repository-level .env shared with apps/server.
  const env = loadEnv(mode, fileURLToPath(new URL('../..', import.meta.url)), '');
  const apiTarget = `http://127.0.0.1:${env.PORT || '3000'}`;

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    server: {
      port: 5173,
      proxy: {
        '/api': apiTarget,
        '/mcp': apiTarget,
        '/healthz': apiTarget,
      },
    },
  };
});
