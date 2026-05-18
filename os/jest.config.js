module.exports = {
  testEnvironment: 'node',
  clearMocks: true,
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/config/**',    // env/logger config — not testable in isolation
    '!src/scripts/**',
  ],
  coverageThreshold: {
    global: {
      lines:     28,
      functions: 22,
      branches:  13,
    },
  },
  // Slow tests (DB-heavy): 30 s timeout
  testTimeout: 30_000,
};
