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
    },
  },
]);
