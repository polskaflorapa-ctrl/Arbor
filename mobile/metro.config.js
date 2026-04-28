// Wymusza pipeline Expo (Babel + plugin expo-router), żeby `process.env.EXPO_ROUTER_APP_ROOT`
// w `expo-router/_ctx.*.js` było zastępowane literałem — inaczej Metro zgłasza błąd require.context.
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

module.exports = config;
