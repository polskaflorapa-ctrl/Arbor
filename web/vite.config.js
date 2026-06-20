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

const optimizeDepsInclude = [
  '@emotion/react',
  '@emotion/styled',
  '@mui/material',
  '@mui/private-theming',
  '@mui/styled-engine',
  '@mui/system',
  '@mui/utils > react-is',
  '@mui/utils',
  '@sentry/react',
  'axios',
  'html-parse-stringify',
  'i18next',
  'i18next-browser-languagedetector',
  'lucide-react',
  'hoist-non-react-statics',
  'prop-types',
  'react',
  'react-dom',
  'react-dom/client',
  'react-i18next',
  'react-router-dom',
  'void-elements',
  'web-vitals',
  '@mui/icons-material/AccountCircleOutlined',
  '@mui/icons-material/Add',
  '@mui/icons-material/AddCircleOutlineOutlined',
  '@mui/icons-material/AddOutlined',
  '@mui/icons-material/AssessmentOutlined',
  '@mui/icons-material/AssignmentOutlined',
  '@mui/icons-material/AssignmentTurnedIn',
  '@mui/icons-material/AssignmentTurnedInOutlined',
  '@mui/icons-material/AttachMoney',
  '@mui/icons-material/AutoAwesomeOutlined',
  '@mui/icons-material/AutorenewOutlined',
  '@mui/icons-material/BadgeOutlined',
  '@mui/icons-material/BlockOutlined',
  '@mui/icons-material/BoltOutlined',
  '@mui/icons-material/BuildOutlined',
  '@mui/icons-material/BusinessOutlined',
  '@mui/icons-material/CalendarMonthOutlined',
  '@mui/icons-material/CalendarTodayOutlined',
  '@mui/icons-material/CancelOutlined',
  '@mui/icons-material/CheckCircleOutline',
  '@mui/icons-material/CheckCircleOutlineOutlined',
  '@mui/icons-material/ChecklistOutlined',
  '@mui/icons-material/CheckOutlined',
  '@mui/icons-material/ChevronLeft',
  '@mui/icons-material/ChevronLeftOutlined',
  '@mui/icons-material/ChevronRight',
  '@mui/icons-material/ChevronRightOutlined',
  '@mui/icons-material/CloseOutlined',
  '@mui/icons-material/ConstructionOutlined',
  '@mui/icons-material/ContentCopyOutlined',
  '@mui/icons-material/ContentCutOutlined',
  '@mui/icons-material/DeleteOutline',
  '@mui/icons-material/DescriptionOutlined',
  '@mui/icons-material/DirectionsCarOutlined',
  '@mui/icons-material/DownloadOutlined',
  '@mui/icons-material/DriveEtaOutlined',
  '@mui/icons-material/EditOutlined',
  '@mui/icons-material/EmojiEventsOutlined',
  '@mui/icons-material/EventAvailableOutlined',
  '@mui/icons-material/EventOutlined',
  '@mui/icons-material/FiberManualRecord',
  '@mui/icons-material/FileDownloadOutlined',
  '@mui/icons-material/ForestOutlined',
  '@mui/icons-material/GroupsOutlined',
  '@mui/icons-material/HandymanOutlined',
  '@mui/icons-material/HourglassEmptyOutlined',
  '@mui/icons-material/ImageOutlined',
  '@mui/icons-material/Inventory2Outlined',
  '@mui/icons-material/KeyOutlined',
  '@mui/icons-material/LeaderboardOutlined',
  '@mui/icons-material/LinkOutlined',
  '@mui/icons-material/LocalFloristOutlined',
  '@mui/icons-material/LocalOfferOutlined',
  '@mui/icons-material/LocalPhoneOutlined',
  '@mui/icons-material/LocalShippingOutlined',
  '@mui/icons-material/LocationOnOutlined',
  '@mui/icons-material/LockOpenOutlined',
  '@mui/icons-material/LockOutlined',
  '@mui/icons-material/MailOutlineOutlined',
  '@mui/icons-material/ManageAccountsOutlined',
  '@mui/icons-material/MapOutlined',
  '@mui/icons-material/MyLocationOutlined',
  '@mui/icons-material/NavigationOutlined',
  '@mui/icons-material/NotificationsActiveOutlined',
  '@mui/icons-material/NotificationsNoneOutlined',
  '@mui/icons-material/PaidOutlined',
  '@mui/icons-material/PaymentsOutlined',
  '@mui/icons-material/PendingOutlined',
  '@mui/icons-material/People',
  '@mui/icons-material/PersonOutlineOutlined',
  '@mui/icons-material/PhoneIphoneOutlined',
  '@mui/icons-material/PhoneOutlined',
  '@mui/icons-material/PhotoCameraOutlined',
  '@mui/icons-material/PictureAsPdfOutlined',
  '@mui/icons-material/PlaceOutlined',
  '@mui/icons-material/PrintOutlined',
  '@mui/icons-material/PushPinOutlined',
  '@mui/icons-material/RateReviewOutlined',
  '@mui/icons-material/ReceiptLongOutlined',
  '@mui/icons-material/Refresh',
  '@mui/icons-material/RefreshOutlined',
  '@mui/icons-material/Remove',
  '@mui/icons-material/RemoveOutlined',
  '@mui/icons-material/ReportProblemOutlined',
  '@mui/icons-material/RouteOutlined',
  '@mui/icons-material/Save',
  '@mui/icons-material/SaveOutlined',
  '@mui/icons-material/ScheduleOutlined',
  '@mui/icons-material/SearchOutlined',
  '@mui/icons-material/SecurityOutlined',
  '@mui/icons-material/Send',
  '@mui/icons-material/SettingsOutlined',
  '@mui/icons-material/ShieldOutlined',
  '@mui/icons-material/SmartDisplayOutlined',
  '@mui/icons-material/SmsOutlined',
  '@mui/icons-material/SpeedOutlined',
  '@mui/icons-material/SupervisorAccountOutlined',
  '@mui/icons-material/TodayOutlined',
  '@mui/icons-material/TrackChangesOutlined',
  '@mui/icons-material/TrendingDownOutlined',
  '@mui/icons-material/TrendingUpOutlined',
  '@mui/icons-material/VerifiedOutlined',
  '@mui/icons-material/ViewKanbanOutlined',
  '@mui/icons-material/VisibilityOffOutlined',
  '@mui/icons-material/VisibilityOutlined',
  '@mui/icons-material/WarningAmberOutlined',
];

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
    optimizeDeps: {
      entries: [],
      ignoreOutdatedRequests: true,
      include: optimizeDepsInclude,
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
