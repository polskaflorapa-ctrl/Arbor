const { withProjectBuildGradle } = require('expo/config-plugins');

const START_MARKER = '// @generated begin arbor-react-native-node-modules-dir';
const END_MARKER = '// @generated end arbor-react-native-node-modules-dir';

function createGradleBlock() {
  return [
    START_MARKER,
    'def arborRootReactNativeDir = file("$rootDir/../../node_modules/react-native")',
    'def localReactNativeDir = file("$rootDir/../node_modules/react-native")',
    'ext.REACT_NATIVE_NODE_MODULES_DIR = arborRootReactNativeDir.exists() ? arborRootReactNativeDir : localReactNativeDir',
    END_MARKER,
  ].join('\n');
}

function withReactNativeNodeModulesDir(config) {
  return withProjectBuildGradle(config, (modConfig) => {
    if (modConfig.modResults.language !== 'groovy') {
      return modConfig;
    }

    const block = createGradleBlock();
    const contents = modConfig.modResults.contents;
    const markerPattern = new RegExp(`${START_MARKER}[\\s\\S]*?${END_MARKER}`);

    if (markerPattern.test(contents)) {
      modConfig.modResults.contents = contents.replace(markerPattern, block);
      return modConfig;
    }

    modConfig.modResults.contents = `${block}\n\n${contents}`;
    return modConfig;
  });
}

module.exports = withReactNativeNodeModulesDir;
