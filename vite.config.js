import { defineConfig, loadEnv } from 'vite';
import { configDefaults } from 'vitest/config';

function parsePort(value, fallback) {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const editorHost = env.GRAPHEDITOR_HOST || '127.0.0.1';
  const editorPort = parsePort(env.GRAPHEDITOR_PORT, 9000);
  const graphApiHost = env.GRAPHAPI_HOST || '127.0.0.1';
  const graphApiPort = parsePort(env.GRAPHAPI_PORT, 8000);

  return {
    resolve: {
      dedupe: ['react', 'react-dom'],
    },
    server: {
      host: editorHost,
      port: editorPort,
      proxy: {
        '/api': {
          target: `http://${graphApiHost}:${graphApiPort}`,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, ''),
        },
      },
    },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: './src/test/setup.js',
      server: {
        deps: {
          inline: ['@graphrapids/graph-yaml-editor'],
        },
      },
      exclude: [...configDefaults.exclude, 'e2e/**', 'playwright.config.ts'],
      coverage: {
        provider: 'v8',
        reporter: ['text', 'lcov'],
        include: ['src/App.jsx'],
        exclude: ['src/main.jsx'],
        thresholds: {
          lines: 83,
          functions: 90,
          branches: 60,
          statements: 83,
        },
      },
    },
  };
});
