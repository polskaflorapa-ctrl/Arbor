jest.mock('../src/config/database', () => ({ query: jest.fn() }));
jest.mock('../src/config/logger', () => ({
  warn: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
}));
jest.mock('../src/config/env', () => ({ env: {} }));
jest.mock('@anthropic-ai/sdk', () => jest.fn());
jest.mock('../src/services/phone-recording-storage', () => ({
  persistPhoneRecording: jest.fn(),
}));
jest.mock('../src/services/crmInbox', () => ({
  appendCrmMessageForContact: jest.fn(),
}));
jest.mock('../src/services/kommo', () => ({
  syncPhoneCallToKommo: jest.fn(),
}));

const logger = require('../src/config/logger');
const pool = require('../src/config/database');
const { appendCrmMessageForContact } = require('../src/services/crmInbox');
const { syncPhoneCallToKommo } = require('../src/services/kommo');
const { publishPhoneCallArtifacts } = require('../src/services/phone-call-pipeline');

describe('phone call pipeline Kommo publishing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    pool.query.mockResolvedValue({ rows: [] });
  });

  test('attaches ARBOR CRM lead to the phone conversation before optional Kommo sync', async () => {
    const crmMessage = {
      id: 55,
      lead_id: 12,
      body: 'Rozmowa i transkrypcja przy kliencie',
    };
    appendCrmMessageForContact.mockResolvedValue(crmMessage);
    syncPhoneCallToKommo.mockResolvedValue({ response: { status: 200 }, bodyText: 'ok' });

    const result = await publishPhoneCallArtifacts({
      callSid: 'zadarma:pbx-call-3',
      clientNumber: '+48500600700',
      transcript: 'Klient chce termin.',
      raport: 'Ustalono kontakt jutro.',
      wskazowki: 'Potwierdzic adres.',
      status: 'analyzed',
      recordingArchiveUrl: 'https://cdn.example/call.mp3',
    });

    expect(result).toBe(crmMessage);
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE phone_call_conversations SET lead_id = $2'),
      ['zadarma:pbx-call-3', 12]
    );
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('SELECT id'),
      [12, '%CallSid: zadarma:pbx-call-3%']
    );
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO crm_lead_activities'),
      expect.arrayContaining([12, expect.stringContaining('CallSid: zadarma:pbx-call-3')])
    );
    expect(syncPhoneCallToKommo).toHaveBeenCalledWith(expect.objectContaining({
      callSid: 'zadarma:pbx-call-3',
      clientNumber: '+48500600700',
      transcript: 'Klient chce termin.',
      raport: 'Ustalono kontakt jutro.',
      crmMessage,
      recordingArchiveUrl: 'https://cdn.example/call.mp3',
    }));
  });

  test('does not fail call processing when Kommo webhook rejects note', async () => {
    const crmMessage = { id: 56, lead_id: 13, body: 'Notatka rozmowy' };
    appendCrmMessageForContact.mockResolvedValue(crmMessage);
    syncPhoneCallToKommo.mockRejectedValue(new Error('Kommo HTTP 500'));

    await expect(publishPhoneCallArtifacts({
      callSid: 'zadarma:pbx-call-4',
      clientNumber: '+48500600701',
      transcript: 'Tres rozmowy',
      status: 'transcribed',
    })).resolves.toBe(crmMessage);

    expect(logger.warn).toHaveBeenCalledWith('phone-call-pipeline kommo sync failed', {
      callSid: 'zadarma:pbx-call-4',
      message: 'Kommo HTTP 500',
    });
  });

  test('does not duplicate phone follow-up task for the same call', async () => {
    appendCrmMessageForContact.mockResolvedValue({ id: 57, lead_id: 14, body: 'Notatka rozmowy' });
    pool.query.mockImplementation(async (sql) => {
      const text = String(sql);
      if (text.includes('SELECT id') && text.includes('crm_lead_activities')) {
        return { rows: [{ id: 900 }] };
      }
      return { rows: [] };
    });

    await expect(publishPhoneCallArtifacts({
      callSid: 'zadarma:pbx-call-5',
      clientNumber: '+48500600702',
      transcript: 'Klient prosi o oferte',
      raport: 'Wyslac oferte jutro.',
      status: 'analyzed',
    })).resolves.toEqual(expect.objectContaining({ lead_id: 14 }));

    expect(pool.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO crm_lead_activities'))).toBe(false);
  });

  test('keeps call processing alive when phone follow-up task fails', async () => {
    appendCrmMessageForContact.mockResolvedValue({ id: 58, lead_id: 15, body: 'Notatka rozmowy' });
    pool.query.mockImplementation(async (sql) => {
      const text = String(sql);
      if (text.includes('INSERT INTO crm_lead_activities')) throw new Error('activity write failed');
      return { rows: [] };
    });

    await expect(publishPhoneCallArtifacts({
      callSid: 'zadarma:pbx-call-6',
      clientNumber: '+48500600703',
      transcript: 'Tres rozmowy',
      status: 'transcribed',
    })).resolves.toEqual(expect.objectContaining({ lead_id: 15 }));

    expect(logger.warn).toHaveBeenCalledWith('phone-call-pipeline followup task failed', {
      callSid: 'zadarma:pbx-call-6',
      leadId: 15,
      message: 'activity write failed',
    });
  });
});
