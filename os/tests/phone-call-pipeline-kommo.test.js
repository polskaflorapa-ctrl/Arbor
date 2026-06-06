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
const { appendCrmMessageForContact } = require('../src/services/crmInbox');
const { syncPhoneCallToKommo } = require('../src/services/kommo');
const { publishPhoneCallArtifacts } = require('../src/services/phone-call-pipeline');

describe('phone call pipeline Kommo publishing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('passes ARBOR CRM call note to Kommo recording sync', async () => {
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
});
