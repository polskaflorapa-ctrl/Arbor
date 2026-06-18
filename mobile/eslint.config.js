// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*'],
    rules: {
      // Sandbox runs can block parent-directory case checks outside the workspace.
      'import/no-unresolved': ['error', { caseSensitive: false, caseSensitiveStrict: false }],
      // Expo SDK 56 pulls in React Compiler lint rules through react-hooks/recommended.
      // The current app still uses common effect-driven loading/state-sync patterns;
      // keep the existing lint signal while leaving the compiler migration explicit.
      'react-hooks/immutability': 'off',
      'react-hooks/preserve-manual-memoization': 'off',
      'react-hooks/purity': 'off',
      'react-hooks/refs': 'off',
      'react-hooks/set-state-in-effect': 'off',
    },
  },
]);
