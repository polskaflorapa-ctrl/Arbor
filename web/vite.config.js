import { defineConfig, loadEnv, transformWithOxc } from 'vite';
import react from '@vitejs/plugin-react';
import { sentryVitePlugin } from '@sentry/vite-plugin';
import { execSync } from 'node:child_process';

function numberEnv(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function legacyDefine(env, key, viteKey = key.replace(/^REACT_APP_/, 'VITE_')) {
  const runtimeEnv = process.env || {};
  return {
    [`process.env.${key}`]: JSON.stringify(runtimeEnv[key] ?? runtimeEnv[viteKey] ?? env[key] ?? env[viteKey] ?? ''),
  };
}

function resolveBuildVersion(env) {
  const runtimeEnv = process.env || {};
  const explicit = runtimeEnv.VITE_APP_VERSION || runtimeEnv.REACT_APP_VERSION || env.VITE_APP_VERSION || env.REACT_APP_VERSION;
  if (explicit) return explicit;
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return 'local-dev';
  }
}

function buildMetadataPlugin(env) {
  const appVersion = resolveBuildVersion(env);
  const apiUrl = process.env.VITE_API_URL || env.VITE_API_URL || process.env.REACT_APP_API_URL || env.REACT_APP_API_URL || '';
  return {
    name: 'arbor-build-metadata',
    transformIndexHtml(html) {
      const tags = [
        `    <meta name="arbor-web-build" content="${appVersion}" />`,
        `    <meta name="arbor-web-api" content="${apiUrl}" />`,
      ].join('\n');
      return html.replace('    <title>Polska Flora</title>', `${tags}\n    <title>Polska Flora</title>`);
    },
  };
}

function jsxInJsPlugin() {
  return {
    name: 'arbor-jsx-in-js',
    enforce: 'pre',
    transform(code, id) {
      if (!/src[\\/].*\.js(?:\?.*)?$/.test(id)) return null;
      return transformWithOxc(code, id, {
        lang: 'jsx',
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
    'http://localhost:3000';

  return {
    plugins: [
      jsxInJsPlugin(),
      buildMetadataPlugin(env),
      react({ include: /\.(js|jsx|ts|tsx)$/ }),
      sentryVitePlugin({
        org: process.env.SENTRY_ORG,
        project: process.env.SENTRY_PROJECT,
        authToken: process.env.SENTRY_AUTH_TOKEN,
        telemetry: false,
      }),
    ],
    publicDir: 'public',
    build: {
      outDir: 'build',
      assetsDir: 'static/assets',
      emptyOutDir: true,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) return undefined;
            const normalizedId = id.replace(/\\/g, '/');
            if (/[\/]node_modules[\/](react|react-dom|react-router|react-router-dom|scheduler)[\/]/.test(normalizedId)) {
              return 'vendor-react';
            }
            if (normalizedId.includes('/node_modules/@remix-run/router/')) return 'vendor-react';
            if (normalizedId.includes('/node_modules/@mui/') || normalizedId.includes('/node_modules/@emotion/')) {
              return 'vendor-mui';
            }
            if (id.includes('i18next')) return 'vendor-i18n';
            if (id.includes('axios')) return 'vendor-http';
            return undefined;
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
