const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '..');

const config = getDefaultConfig(projectRoot);

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Monorepo: Metro widzi pakiety z katalogu nadrzędnego. Wymuś **jedną** kopię RN z `mobile/`
// (postinstall patchuje VirtualView tutaj) + zablokuj drugą kopię w `arbor/node_modules`, bo
// hoisting nadal potrafi wczytać pliki z roota i babel/codegen się rozjeżdża.
config.watchFolders = [monorepoRoot];

const mobileRn = path.join(projectRoot, 'node_modules', 'react-native');
if (require('fs').existsSync(mobileRn)) {
  config.resolver = {
    ...config.resolver,
    extraNodeModules: {
      ...(config.resolver.extraNodeModules || {}),
      'react-native': mobileRn,
    },
  };
}

const rootRnAbs = path.join(monorepoRoot, 'node_modules', 'react-native');
if (require('fs').existsSync(rootRnAbs)) {
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
