const expoBabelPreset = require.resolve('babel-preset-expo');
const { expoRouterBabelPlugin } = require('babel-preset-expo/build/plugins/expo-router-plugin');

module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      [
        expoBabelPreset,
        {
          // RN 0.81+ VirtualView and react-compiler can throw
          // "Unable to determine event arguments" in some runtime paths.
          'react-compiler': false,
        },
      ],
    ],
    plugins: [
      expoRouterBabelPlugin,
      // react-native-worklets/plugin must be the final plugin.
      'react-native-worklets/plugin',
    ],
  };
};
