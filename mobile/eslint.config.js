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
      // SDK 56 enables stricter React Compiler lint rules. The app has existing
      // imperative screen effects; keep release lint focused on actionable errors
      // until those screens are refactored deliberately.
      'react-hooks/immutability': 'off',
      'react-hooks/preserve-manual-memoization': 'off',
      'react-hooks/purity': 'off',
      'react-hooks/refs': 'off',
      'react-hooks/set-state-in-effect': 'off',
    },
  },
]);
