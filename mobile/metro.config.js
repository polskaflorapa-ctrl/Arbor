const path = require('path');
const fs = require('fs');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '..');

const config = getDefaultConfig(projectRoot);

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Monorepo: keep Expo defaults and add the root node_modules folder.
// nodeModulesPaths still prefers mobile dependencies before root dependencies.
const mobileNodeModules = path.join(projectRoot, 'node_modules');
const rootNodeModules = path.join(monorepoRoot, 'node_modules');
config.watchFolders = [...new Set([...(config.watchFolders || []), rootNodeModules])].filter((folder) =>
  fs.existsSync(folder),
);
config.resolver = {
  ...config.resolver,
  nodeModulesPaths: [mobileNodeModules, rootNodeModules].filter((p) => fs.existsSync(p)),
};

const mobileRn = path.join(projectRoot, 'node_modules', 'react-native');
const rootRnAbs = path.join(rootNodeModules, 'react-native');
const reactNativePath = fs.existsSync(mobileRn) ? mobileRn : rootRnAbs;

if (fs.existsSync(reactNativePath)) {
  config.resolver = {
    ...config.resolver,
    extraNodeModules: {
      ...(config.resolver.extraNodeModules || {}),
      'react-native': reactNativePath,
    },
  };
}

if (fs.existsSync(mobileRn) && fs.existsSync(rootRnAbs)) {
  const blockRootRn = new RegExp(
    '^' + escapeRegExp(monorepoRoot) + '[\\\\/]node_modules[\\\\/]react-native[\\\\/].*',
  );
  const prev = config.resolver.blockList;
  const list = [];
  if (Array.isArray(prev)) list.push(...prev);
  else if (prev != null) list.push(prev);
  list.push(blockRootRn);
  config.resolver.blockList = list;
}

module.exports = config;
