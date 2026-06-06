jest.mock('../src/config/database', () => ({
  query: jest.fn(),
}));

const mockEnv = {
  ZADARMA_CALLER_ID: '',
  TWILIO_ACCOUNT_SID: '',
  TWILIO_AUTH_TOKEN: '',
  TWILIO_PHONE: '',
  PUBLIC_BASE_URL: '',
};

jest.mock('../src/config/env', () => ({
  env: mockEnv,
}));

jest.mock('../src/services/zadarma', () => ({
  isZadarmaConfigured: jest.fn(() => true),
  isZadarmaConfiguredAsync: jest.fn(async () => true),
  sendSms: jest.fn(),
}));

const mockTwilioCreate = jest.fn();

jest.mock('twilio', () => jest.fn(() => ({
  messages: { create: mockTwilioCreate },
})));

const pool = require('../src/config/database');
const { isZadarmaConfigured, isZadarmaConfiguredAsync, sendSms } = require('../src/services/zadarma');
const { sendSmsGateway, resolveBranchSmsSender } = require('../src/services/smsGateway');

describe('smsGateway branch senders', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockEnv.ZADARMA_CALLER_ID = '';
    mockEnv.TWILIO_ACCOUNT_SID = '';
    mockEnv.TWILIO_AUTH_TOKEN = '';
    mockEnv.TWILIO_PHONE = '';
    mockEnv.PUBLIC_BASE_URL = '';
    isZadarmaConfigured.mockReturnValue(true);
    isZadarmaConfiguredAsync.mockResolvedValue(true);
    sendSms.mockResolvedValue({ ok: true, message_id: 'ZD_1', cost: 0.12, currency: 'PLN' });
    mockTwilioCreate.mockResolvedValue({ sid: 'SM_1' });
  });

  it('uses oddzial sms_sender_id for Zadarma SMS', async () => {
    pool.query.mockImplementation(async (sql, params = []) => {
      const text = String(sql);
      if (text.startsWith('ALTER TABLE') || text.startsWith('CREATE TABLE')) return { rows: [], rowCount: 0 };
      if (text.includes('FROM branches WHERE id = $1')) {
        expect(params).toEqual([2]);
        return { rows: [{ sms_sender_id: '+48221234567', telefon: '+48220000000' }], rowCount: 1 };
      }
      if (text.includes('INSERT INTO sms_history')) return { rows: [], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });

    const result = await sendSmsGateway({
      to: '+48500111222',
      body: 'Test oddzialowy',
      taskId: 77,
      oddzialId: 2,
    });

    expect(result.ok).toBe(true);
    expect(sendSms).toHaveBeenCalledWith(expect.objectContaining({
      to: '+48500111222',
      body: 'Test oddzialowy',
      senderId: '+48221234567',
    }));
    const insertCall = pool.query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO sms_history'));
    expect(insertCall[1]).toEqual(expect.arrayContaining([2, '+48221234567']));
  });

  it('falls back to branch phone when sms_sender_id is empty', async () => {
    pool.query.mockImplementation(async (sql) => {
      const text = String(sql);
      if (text.startsWith('ALTER TABLE')) return { rows: [], rowCount: 0 };
      if (text.includes('FROM branches WHERE id = $1')) {
        return { rows: [{ sms_sender_id: null, telefon: '+48123456789' }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    await expect(resolveBranchSmsSender({ oddzialId: 3 })).resolves.toBe('+48123456789');
  });

  it('resolves sender through task branch when oddzialId is not passed', async () => {
    pool.query.mockImplementation(async (sql, params = []) => {
      const text = String(sql);
      if (text.startsWith('ALTER TABLE')) return { rows: [], rowCount: 0 };
      if (text.includes('FROM tasks t')) {
        expect(params).toEqual([88]);
        return { rows: [{ sms_sender_id: 'ARBOR-KRK', telefon: '+48123123123' }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    await expect(resolveBranchSmsSender({ taskId: 88 })).resolves.toBe('ARBOR-KRK');
  });

  it('uses branch phone as Twilio from number when Zadarma is not configured', async () => {
    isZadarmaConfigured.mockReturnValue(false);
    isZadarmaConfiguredAsync.mockResolvedValue(false);
    mockEnv.TWILIO_ACCOUNT_SID = 'AC123';
    mockEnv.TWILIO_AUTH_TOKEN = 'token';
    mockEnv.TWILIO_PHONE = '+48999000111';

    pool.query.mockImplementation(async (sql) => {
      const text = String(sql);
      if (text.startsWith('ALTER TABLE') || text.startsWith('CREATE TABLE')) return { rows: [], rowCount: 0 };
      if (text.includes('FROM branches WHERE id = $1')) {
        return { rows: [{ sms_sender_id: null, telefon: '+48221234567' }], rowCount: 1 };
      }
      if (text.includes('INSERT INTO sms_history')) return { rows: [], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });

    const result = await sendSmsGateway({
      to: '500111222',
      body: 'Test Twilio oddzial',
      oddzialId: 2,
    });

    expect(result).toEqual(expect.objectContaining({ ok: true, provider: 'twilio', sid: 'SM_1' }));
    expect(mockTwilioCreate).toHaveBeenCalledWith(expect.objectContaining({
      from: '+48221234567',
      to: '+48500111222',
    }));
    const insertCall = pool.query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO sms_history'));
    expect(insertCall[1]).toEqual(expect.arrayContaining([2, '+48221234567']));
  });
});
