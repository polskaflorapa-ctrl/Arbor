/**
 * Shim dla `expo-router/_ctx` (Android) — jak `node_modules/expo-router/_ctx.android.js`.
 */
export const ctx = require.context(
  '../app',
  true,
  /^(?:\.\/)(?!(?:(?:(?:.*\+api)|(?:\+html)|(?:\+middleware)))\.[tj]sx?$).*(?:\.ios|\.web)?\.[tj]sx?$/,
  'sync'
);
