const crypto = require('crypto');

describe('Zadarma webhook signatures', () => {
  const previousEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...previousEnv };
    jest.resetModules();
  });

  function loadZadarmaWithEnv(overrides = {}) {
    process.env = {
      ...previousEnv,
      NODE_ENV: 'test',
      ZADARMA_API_SECRET: 'zadarma-secret',
      ZADARMA_SKIP_SIGNATURE_VALIDATION: 'false',
      ...overrides,
    };
    jest.resetModules();
    return require('../src/services/zadarma');
  }

  function sign(source) {
    return crypto.createHmac('sha1', 'zadarma-secret').update(source).digest('base64');
  }

  it('accepts SMS status webhook signature built from message id and status fields', () => {
    const { verifySmsStatusWebhookSignature } = loadZadarmaWithEnv();
    const body = {
      message_id: 'ZD_123',
      status: 'delivered',
      error_code: '',
      error_message: '',
    };

    expect(verifySmsStatusWebhookSignature(body, sign('ZD_123delivered'))).toBe(true);
  });

  it('accepts official SMS notification result signature when result is present', () => {
    const { verifySmsStatusWebhookSignature } = loadZadarmaWithEnv();
    const body = {
      event: 'SMS',
      result: '{"caller_id":"+48123123123","caller_did":"+48500500500","text":"OK"}',
    };

    expect(verifySmsStatusWebhookSignature(body, sign(body.result))).toBe(true);
  });

  it('rejects SMS status webhook signature when no non-empty signature source exists', () => {
    const { verifySmsStatusWebhookSignature } = loadZadarmaWithEnv();

    expect(verifySmsStatusWebhookSignature({ status: 'delivered' }, sign(''))).toBe(false);
  });
});
