/**
 * Shim dla `expo-router/_ctx` (iOS): ten sam regex co w `node_modules/expo-router/_ctx.ios.js`,
 * ale katalog `app` jako literał — omija Babel / `process.env.EXPO_ROUTER_APP_ROOT` w monorepo.
 */
export const ctx = require.context(
  '../app',
  true,
  /^(?:\.\/)(?!(?:(?:(?:.*\+api)|(?:\+html)|(?:\+middleware)))\.[tj]sx?$).*(?:\.android|\.web)?\.[tj]sx?$/,
  'sync'
);
