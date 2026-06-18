const expoBabelPreset = require.resolve('babel-preset-expo');

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
      // react-native-worklets/plugin must be the final plugin.
      'react-native-worklets/plugin',
    ],
  };
};
