// Monorepo npm: `expo-router` zwykle jest tylko w `mobile/node_modules`, a `babel-preset-expo`
// leży pod `arbor/node_modules/expo`. Wtedy `hasModule('expo-router')` wewnątrz presetu zwraca
// false i plugin podstawiający `EXPO_ROUTER_APP_ROOT` w `expo-router/_ctx.*.js` się nie ładuje —
// Metro zostaje z `require.context(process.env.EXPO_ROUTER_APP_ROOT, ...)`.
const { expoRouterBabelPlugin } = require('babel-preset-expo/build/expo-router-plugin');

module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [expoRouterBabelPlugin],
  };
};
