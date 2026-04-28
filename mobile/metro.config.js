const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;

const config = getDefaultConfig(projectRoot);

// Monorepo / Xcode: czasem `_ctx.*.js` z paczki nie przechodzi przez Babel → zostaje
// `process.env.EXPO_ROUTER_APP_ROOT`. Przekierowujemy `expo-router/_ctx` na lokalne shims
// z literalnym `require.context('../app', ...)`.
const origResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const normalized = String(moduleName).replace(/\\/g, '/');
  const isCtxBare = normalized === 'expo-router/_ctx' || normalized.endsWith('/expo-router/_ctx');
  const isCtxIosFile = /[/\\]expo-router[/\\]_ctx\.ios\.js$/.test(normalized);
  const isCtxAndroidFile = /[/\\]expo-router[/\\]_ctx\.android\.js$/.test(normalized);
  const isCtxWebFile = /[/\\]expo-router[/\\]_ctx\.web\.js$/.test(normalized);

  if (isCtxBare) {
    let shim = path.join(projectRoot, 'shims/expo-router-ctx.ios.js');
    if (platform === 'android') {
      shim = path.join(projectRoot, 'shims/expo-router-ctx.android.js');
    } else if (platform === 'web') {
      shim = path.join(projectRoot, 'shims/expo-router-ctx.web.js');
    }
    return { type: 'sourceFile', filePath: shim };
  }
  if (isCtxIosFile) {
    return { type: 'sourceFile', filePath: path.join(projectRoot, 'shims/expo-router-ctx.ios.js') };
  }
  if (isCtxAndroidFile) {
    return { type: 'sourceFile', filePath: path.join(projectRoot, 'shims/expo-router-ctx.android.js') };
  }
  if (isCtxWebFile) {
    return { type: 'sourceFile', filePath: path.join(projectRoot, 'shims/expo-router-ctx.web.js') };
  }
  if (typeof origResolveRequest === 'function') {
    return origResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
