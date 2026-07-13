const {
  setupSentryErrorHandler,
  shouldCaptureExpressError,
} = require('../src/config/sentry');

describe('Sentry Express integration', () => {
  test('uses the current SDK error-handler API', () => {
    const app = { use: jest.fn() };
    const sentry = { setupExpressErrorHandler: jest.fn() };

    expect(setupSentryErrorHandler(app, sentry)).toBe(true);
    expect(sentry.setupExpressErrorHandler).toHaveBeenCalledWith(
      app,
      expect.objectContaining({ shouldHandleError: shouldCaptureExpressError }),
    );
  });

  test('captures server errors but ignores expected client errors', () => {
    expect(shouldCaptureExpressError(new Error('plain failure'))).toBe(true);
    expect(shouldCaptureExpressError({ status: 503 })).toBe(true);
    expect(shouldCaptureExpressError({ statusCode: 404 })).toBe(false);
  });

  test('is a no-op when Sentry is disabled', () => {
    expect(setupSentryErrorHandler({ use: jest.fn() }, null)).toBe(false);
  });
});
