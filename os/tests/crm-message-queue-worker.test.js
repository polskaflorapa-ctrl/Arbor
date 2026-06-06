jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  connect: jest.fn(),
}));

jest.mock('../src/services/smsGateway', () => ({
  activeSmsProvider: jest.fn(async () => null),
  sendSmsGateway: jest.fn(),
}));

jest.mock('../src/services/systemEmail', () => ({
  sendSystemEmailOptional: jest.fn(),
}));

const pool = require('../src/config/database');
const { activeSmsProvider, sendSmsGateway } = require('../src/services/smsGateway');
const { sendSystemEmailOptional } = require('../src/services/systemEmail');
const { getMessageProviderStatus, processMessageQueue } = require('../src/services/crmMessageQueue');

function queuedMessage(overrides = {}) {
  return {
    id: 501,
    lead_id: 22,
    lead_title: 'Oferta ogrodu',
    lead_phone: '+48500100200',
    lead_email: 'jan@example.test',
    channel: 'sms',
    direction: 'outbound',
    recipient_handle: '+48500100200',
    subject: null,
    body: 'Dzien dobry, wracam z oferta.',
    status: 'queued',
    metadata: {},
    retry_count: 0,
    last_error: null,
    ...overrides,
  };
}

describe('CRM message queue worker', () => {
  beforeEach(() => {
    pool.query.mockReset();
    activeSmsProvider.mockReset();
    activeSmsProvider.mockResolvedValue(null);
    sendSmsGateway.mockReset();
    sendSystemEmailOptional.mockReset();
  });

  it('sends queued SMS messages through the SMS gateway', async () => {
    sendSmsGateway.mockResolvedValue({ ok: true, provider: 'twilio', sid: 'SM123' });
    pool.query.mockImplementation((sql) => {
      const text = String(sql);
      if (text.includes('CREATE TABLE') || text.includes('CREATE INDEX') || text.includes('ALTER TABLE')) {
        return Promise.resolve({ rows: [] });
      }
      if (text.includes('WHERE m.direction = \'outbound\'') && text.includes('m.status = \'queued\'')) {
        return Promise.resolve({ rows: [queuedMessage()] });
      }
      if (text.includes('SET status = \'sent\'')) {
        return Promise.resolve({ rows: [queuedMessage({ status: 'sent', external_message_id: 'SM123' })] });
      }
      return Promise.resolve({ rows: [] });
    });

    const out = await processMessageQueue({ limit: 5 });

    expect(out).toEqual(expect.objectContaining({ processed: 1, sent: 1, failed: 0 }));
    expect(sendSmsGateway).toHaveBeenCalledWith({
      to: '+48500100200',
      body: 'Dzien dobry, wracam z oferta.',
      taskId: null,
      oddzialId: null,
    });
    const updateCall = pool.query.mock.calls.find(([sql]) => String(sql).includes('SET status = \'sent\''));
    expect(updateCall[1][1]).toBe('SM123');
  });

  it('marks email messages failed when SMTP is not configured', async () => {
    sendSystemEmailOptional.mockResolvedValue({ sent: false, skipped: 'no_smtp' });
    pool.query.mockImplementation((sql) => {
      const text = String(sql);
      if (text.includes('CREATE TABLE') || text.includes('CREATE INDEX') || text.includes('ALTER TABLE')) {
        return Promise.resolve({ rows: [] });
      }
      if (text.includes('WHERE m.direction = \'outbound\'') && text.includes('m.status = \'queued\'')) {
        return Promise.resolve({ rows: [queuedMessage({ channel: 'email', recipient_handle: 'jan@example.test', subject: 'Oferta' })] });
      }
      if (text.includes('SET status = \'failed\'')) {
        return Promise.resolve({ rows: [queuedMessage({ channel: 'email', status: 'failed', last_error: 'no_smtp' })] });
      }
      return Promise.resolve({ rows: [] });
    });

    const out = await processMessageQueue({ limit: 5 });

    expect(out).toEqual(expect.objectContaining({ processed: 1, sent: 0, failed: 1 }));
    expect(sendSystemEmailOptional).toHaveBeenCalledWith({
      to: 'jan@example.test',
      subject: 'Oferta',
      text: 'Dzien dobry, wracam z oferta.',
    });
    const updateCall = pool.query.mock.calls.find(([sql]) => String(sql).includes('SET status = \'failed\''));
    expect(updateCall[1][1]).toBe('no_smtp');
  });

  it('describes provider readiness for CRM channels', async () => {
    activeSmsProvider.mockResolvedValue('zadarma');

    const status = await getMessageProviderStatus();

    expect(status.channels).toEqual(expect.arrayContaining([
      expect.objectContaining({ channel: 'sms', ready: true, provider: 'zadarma' }),
      expect.objectContaining({ channel: 'email', ready: expect.any(Boolean) }),
      expect.objectContaining({ channel: 'whatsapp', ready: false, provider: null }),
    ]));
  });
});
