const ORIGINAL_ENV = { ...process.env };

function loadVerifier(overrides = {}, validateRequest = jest.fn(() => true)) {
  process.env = {
    ...ORIGINAL_ENV,
    NODE_ENV: 'production',
    JWT_SECRET: 'test-secret-long-enough-for-runtime-only',
    PUBLIC_BASE_URL: 'https://api.example.com',
    TWILIO_AUTH_TOKEN: 'twilio-auth-token',
    TWILIO_SKIP_SIGNATURE_VALIDATION: 'false',
    ...overrides,
  };
  jest.resetModules();
  jest.doMock('twilio', () => ({ validateRequest }));
  return { ...require('../src/services/twilioWebhook'), validateRequest };
}

function fakeRequest({ signature = 'signature', originalUrl = '/api/sms/webhooks/status', body = {} } = {}) {
  return {
    body,
    originalUrl,
    get: jest.fn((name) => (String(name).toLowerCase() === 'x-twilio-signature' ? signature : undefined)),
  };
}

describe('Twilio webhook verification', () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    jest.resetModules();
    jest.dontMock('twilio');
  });

  it('fails closed when provider credentials are not configured', () => {
    const { verifyTwilioWebhookRequest, validateRequest } = loadVerifier({ TWILIO_AUTH_TOKEN: '' });

    expect(verifyTwilioWebhookRequest(fakeRequest())).toEqual(expect.objectContaining({
      ok: false,
      reason: 'provider_not_configured',
    }));
    expect(validateRequest).not.toHaveBeenCalled();
  });

  it('rejects a missing signature without touching the Twilio validator', () => {
    const { verifyTwilioWebhookRequest, validateRequest } = loadVerifier();

    expect(verifyTwilioWebhookRequest(fakeRequest({ signature: '' }))).toEqual(expect.objectContaining({
      ok: false,
      reason: 'signature_missing',
    }));
    expect(validateRequest).not.toHaveBeenCalled();
  });

  it('validates the exact configured callback URL and payload', () => {
    const validateRequest = jest.fn(() => true);
    const { verifyTwilioWebhookRequest } = loadVerifier({}, validateRequest);
    const req = fakeRequest({ body: { MessageSid: 'SM1' } });

    expect(verifyTwilioWebhookRequest(req).ok).toBe(true);
    expect(validateRequest).toHaveBeenCalledWith(
      'twilio-auth-token',
      'signature',
      'https://api.example.com/api/sms/webhooks/status',
      { MessageSid: 'SM1' }
    );
  });

  it('allows the explicit signature bypass only outside production', () => {
    const { verifyTwilioWebhookRequest, validateRequest } = loadVerifier({
      NODE_ENV: 'test',
      TWILIO_AUTH_TOKEN: '',
      PUBLIC_BASE_URL: '',
      TWILIO_SKIP_SIGNATURE_VALIDATION: 'true',
    });

    expect(verifyTwilioWebhookRequest(fakeRequest())).toEqual(expect.objectContaining({
      ok: true,
      skipped: true,
    }));
    expect(validateRequest).not.toHaveBeenCalled();
  });
});
