import { defineConfig, loadEnv, transformWithEsbuild } from 'vite';
import react from '@vitejs/plugin-react';

function numberEnv(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function legacyDefine(env, key, viteKey = key.replace(/^REACT_APP_/, 'VITE_')) {
  return {
    [`process.env.${key}`]: JSON.stringify(env[key] ?? env[viteKey] ?? ''),
  };
}

function jsxInJsPlugin() {
  return {
    name: 'arbor-jsx-in-js',
    enforce: 'pre',
    transform(code, id) {
      if (!/src[\\/].*\.js(?:\?.*)?$/.test(id)) return null;
      return transformWithEsbuild(code, id, {
        loader: 'jsx',
        jsx: 'automatic',
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const proxyTarget =
    env.ARBOR_API_PROXY_TARGET ||
    env.REACT_APP_DEV_PROXY_TARGET ||
    env.VITE_DEV_PROXY_TARGET ||
    'http://localhost:3001';

  return {
    plugins: [jsxInJsPlugin(), react({ include: /\.(js|jsx|ts|tsx)$/ })],
    publicDir: 'public',
    esbuild: {
      loader: 'jsx',
      include: /src[\\/].*\.js$/,
      exclude: [],
    },
    optimizeDeps: {
      esbuildOptions: {
        loader: {
          '.js': 'jsx',
        },
      },
    },
    build: {
      outDir: 'build',
      assetsDir: 'static/assets',
      emptyOutDir: true,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) return undefined;
            if (id.includes('@mui') || id.includes('@emotion')) return 'vendor-mui';
            if (id.includes('react') || id.includes('react-router')) return 'vendor-react';
            if (id.includes('i18next')) return 'vendor-i18n';
            if (id.includes('axios')) return 'vendor-http';
            return 'vendor';
          },
        },
      },
    },
    server: {
      host: '0.0.0.0',
      port: numberEnv(env.PORT, 3002),
      strictPort: false,
      proxy: {
        '/api': {
          target: proxyTarget,
          changeOrigin: true,
        },
      },
    },
    preview: {
      host: '0.0.0.0',
      port: numberEnv(env.PORT, 4173),
    },
    test: {
      css: true,
      environment: 'jsdom',
      globals: true,
      include: [
        'src/**/__tests__/**/*.{js,jsx,ts,tsx}',
        'src/**/*.{spec,test}.{js,jsx,ts,tsx}',
      ],
      setupFiles: './src/setupTests.js',
    },
    define: {
      'process.env.NODE_ENV': JSON.stringify(mode),
      ...legacyDefine(env, 'REACT_APP_API_URL'),
      ...legacyDefine(env, 'REACT_APP_KOMMO_APP_URL'),
      ...legacyDefine(env, 'REACT_APP_SHOW_DEMO_LOGINS'),
      ...legacyDefine(env, 'REACT_APP_TEST_MODE'),
    },
  };
});
