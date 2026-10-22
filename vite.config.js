import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiPort = Number(process.env.VITE_API_PORT || process.env.PORT || env.PORT || 3003);
  return {
    plugins: [react()],
    server: { proxy: { '/api': `http://localhost:${apiPort}` } },
  };
});
