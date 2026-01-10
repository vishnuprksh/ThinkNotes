import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    server: {
      port: 3000,
      host: '0.0.0.0',
      proxy: {
        '/api/copilot': {
          target: 'https://getcopilotresponse-c4w26t43sa-uc.a.run.app',
          changeOrigin: true,
          rewrite: (path) => '',
        },
        '/fpl': {
          target: 'https://fantasy.premierleague.com/api',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/fpl/, ''),
        }
      },
    },
    plugins: [react()],
    define: {
      // API Key removed, now using Cloud Functions
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      }
    }
  };
});
