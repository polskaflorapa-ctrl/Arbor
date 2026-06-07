const request = require('supertest');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
}));

jest.mock('../src/config/env', () => {
  const real = jest.requireActual('../src/config/env');
  const overlay = {
    PUBLIC_BASE_URL: 'https://telefon-test.example.com',
    TWILIO_ACCOUNT_SID: 'ACtest_sid',
    TWILIO_AUTH_TOKEN: 'test_auth_token',
    TWILIO_PHONE: '+48111222333',
    TWILIO_SKIP_SIGNATURE_VALIDATION: true,
  };
  return {
    env: new Proxy(real.env, {
      get(target, prop) {
        if (Object.prototype.hasOwnProperty.call(overlay, prop)) return overlay[prop];
        return target[prop];
      },
    }),
  };
});

jest.mock('twilio', () => {
  const create = jest.fn().mockResolvedValue({ sid: 'CA_mock_call_sid' });
  const factory = jest.fn(() => ({ calls: { create } }));
  factory.__callsCreate = create;
  return factory;
});

jest.mock('../src/services/zadarma', () => ({
  isZadarmaConfiguredAsync: jest.fn(async () => false),
  requestCallback: jest.fn().mockResolvedValue({ status: 'success', request_id: 'ZD_callback_1' }),
}));

jest.mock('../src/services/phone-call-pipeline', () => ({
  ensurePhoneCallsTable: jest.fn().mockResolvedValue(undefined),
  processRecordingPipeline: jest.fn().mockResolvedValue(undefined),
  upsertCallLegFromTwiml: jest.fn().mockResolvedValue(undefined),
  publishPhoneCallArtifacts: jest.fn().mockResolvedValue({ id: 501, lead_id: 301 }),
}));

const pool = require('../src/config/database');
const { env } = require('../src/config/env');
const { isZadarmaConfiguredAsync, requestCallback } = require('../src/services/zadarma');
const { processRecordingPipeline, publishPhoneCallArtifacts, upsertCallLegFromTwiml } = require('../src/services/phone-call-pipeline');
const telefonRoutes = require('../src/routes/telefon');
const { createTestApp } = require('./helpers/create-test-app');

describe('Telefon (Twilio Voice)', () => {
  const app = createTestApp('/api/telefon', telefonRoutes);

  const bearer = () =>
    jwt.sign({ id: 1, login: 'tester', rola: 'Brygadzista', oddzial_id: 1 }, env.JWT_SECRET, { expiresIn: '1h' });

  const bearerKierownik = () =>
    jwt.sign({ id: 10, login: 'kier1', rola: 'Kierownik', oddzial_id: 2 }, env.JWT_SECRET, { expiresIn: '1h' });

  const bearerDyrektor = () =>
    jwt.sign({ id: 2, login: 'dyr', rola: 'Dyrektor', oddzial_id: 1 }, env.JWT_SECRET, { expiresIn: '1h' });

  beforeEach(() => {
    jest.clearAllMocks();
    isZadarmaConfiguredAsync.mockResolvedValue(false);
    publishPhoneCallArtifacts.mockResolvedValue({ id: 501, lead_id: 301 });
    processRecordingPipeline.mockResolvedValue(undefined);
    upsertCallLegFromTwiml.mockResolvedValue(undefined);
  });

  it('POST /polacz-do-klienta returns 401 without token', async () => {
    const res = await request(app).post('/api/telefon/polacz-do-klienta').send({ do: '791234567' });
    expect(res.status).toBe(401);
  });

  it('POST /polacz-do-klienta returns 403 for Brygadzista', async () => {
    const res = await request(app)
      .post('/api/telefon/polacz-do-klienta')
      .set('Authorization', `Bearer ${bearer()}`)
      .send({ do: '791234567' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('TELEFON_TEAM_ROLE_FORBIDDEN');
  });

  it('POST /polacz-do-klienta returns 400 when staff has no phone', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ telefon: null }] });
    const res = await request(app)
      .post('/api/telefon/polacz-do-klienta')
      .set('Authorization', `Bearer ${bearerKierownik()}`)
      .send({ do: '791234567' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('TELEFON_STAFF_PHONE_MISSING');
  });

  it('POST /polacz-do-klienta returns 200 and calls Twilio', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ telefon: '+48600111222' }] });
    const res = await request(app)
      .post('/api/telefon/polacz-do-klienta')
      .set('Authorization', `Bearer ${bearerKierownik()}`)
      .send({ do: '791333444' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual(
      expect.objectContaining({ success: true, sid: 'CA_mock_call_sid' })
    );
    const twilioFactory = require('twilio');
    const create = twilioFactory.__callsCreate;
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0].to).toBe('+48600111222');
    expect(create.mock.calls[0][0].from).toBe('+48111222333');
    expect(create.mock.calls[0][0].url).toContain('/api/telefon/twiml/dial?t=');
  });

  it('POST /polacz-do-klienta prefers Zadarma callback when configured', async () => {
    isZadarmaConfiguredAsync.mockResolvedValue(true);
    pool.query.mockResolvedValueOnce({ rows: [{ telefon: '+48600111222' }] });

    const res = await request(app)
      .post('/api/telefon/polacz-do-klienta')
      .set('Authorization', `Bearer ${bearerKierownik()}`)
      .send({ do: '791333444' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(
      expect.objectContaining({
        success: true,
        provider: 'zadarma',
        result: expect.objectContaining({ request_id: 'ZD_callback_1' }),
      })
    );
    expect(requestCallback).toHaveBeenCalledWith({ from: '+48600111222', to: '+48791333444' });
    const twilioFactory = require('twilio');
    expect(twilioFactory.__callsCreate).not.toHaveBeenCalled();
  });

  it('GET /twiml/dial returns TwiML with Dial for valid token', async () => {
    const token = jwt.sign(
      { typ: 'twilio-dial', do: '+48791234567', task_id: null, user_id: 1 },
      env.JWT_SECRET,
      { expiresIn: '5m', audience: 'twilio-twiml' }
    );
    pool.query.mockResolvedValue({ rows: [] });
    const res = await request(app)
      .get('/api/telefon/twiml/dial')
      .query({ t: token, CallSid: 'CA_test_call_sid', From: '+48111222333' });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/xml/);
    expect(res.text).toContain('<Dial');
    expect(res.text).toContain('+48791234567');
    expect(res.text).toContain('record-from-answer-dual');
    expect(res.text).toContain('/api/telefon/webhooks/recording');
    expect(upsertCallLegFromTwiml).toHaveBeenCalledWith(expect.objectContaining({
      callSid: 'CA_test_call_sid',
      userId: 1,
      clientNumber: '+48791234567',
    }));
  });

  it('GET /twiml/dial returns reject TwiML for invalid token', async () => {
    const res = await request(app).get('/api/telefon/twiml/dial').query({ t: 'not-a-jwt' });
    expect(res.status).toBe(200);
    expect(res.text).toContain('odrzucone');
  });

  it('GET /rozmowy COUNT has no user filter for Kierownik (jak dyrektor)', async () => {
    pool.query.mockImplementation(async (sql) => {
      const s = String(sql);
      if (s.includes('phone_call_conversations') && s.includes('COUNT')) {
        return { rows: [{ c: 0 }] };
      }
      if (s.includes('phone_call_conversations') && s.includes('ORDER BY')) {
        return { rows: [] };
      }
      return { rows: [] };
    });
    const res = await request(app)
      .get('/api/telefon/rozmowy?limit=5&offset=0')
      .set('Authorization', `Bearer ${bearerKierownik()}`);
    expect(res.status).toBe(200);
    const countSql = pool.query.mock.calls.map((c) => String(c[0])).find((s) => s.includes('COUNT(*)') && s.includes('phone_call_conversations'));
    expect(countSql).not.toMatch(/JOIN users u/i);
    expect(countSql).not.toMatch(/WHERE p\.user_id/i);
  });

  it('GET /rozmowy COUNT has no user/oddzial filter for Dyrektor', async () => {
    pool.query.mockImplementation(async (sql) => {
      const s = String(sql);
      if (s.includes('phone_call_conversations') && s.includes('COUNT')) {
        return { rows: [{ c: 0 }] };
      }
      if (s.includes('phone_call_conversations') && s.includes('ORDER BY')) {
        return { rows: [] };
      }
      return { rows: [] };
    });
    const res = await request(app)
      .get('/api/telefon/rozmowy?limit=5&offset=0')
      .set('Authorization', `Bearer ${bearerDyrektor()}`);
    expect(res.status).toBe(200);
    const countSql = pool.query.mock.calls.map((c) => String(c[0])).find((s) => s.includes('COUNT(*)') && s.includes('phone_call_conversations'));
    expect(countSql).not.toMatch(/JOIN users u/i);
    expect(countSql).not.toMatch(/WHERE p\.user_id/i);
  });

  it('GET /diagnostics returns phone pipeline readiness and blockers', async () => {
    isZadarmaConfiguredAsync.mockResolvedValue(true);
    pool.query.mockImplementation(async (sql) => {
      const text = String(sql);
      if (text.includes('COUNT(*)::int AS total') && text.includes('phone_call_conversations')) {
        return {
          rows: [{
            total: 5,
            last_24h: 4,
            recording_ready: 1,
            transcribing: 0,
            needs_transcription: 2,
            transcribed: 1,
            analyzed: 1,
            error: 1,
            with_recording: 4,
            with_transcript: 2,
            linked_to_crm: 1,
            last_update_at: '2026-06-07T10:00:00.000Z',
          }],
        };
      }
      return { rows: [] };
    });

    const res = await request(app)
      .get('/api/telefon/diagnostics')
      .set('Authorization', `Bearer ${bearerDyrektor()}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({
      ok: true,
      counts: expect.objectContaining({
        total: 5,
        needs_transcription: 2,
        error: 1,
        linked_to_crm: 1,
      }),
      config: expect.objectContaining({
        zadarma_configured: true,
        openai_configured: false,
      }),
    }));
    expect(res.body.issues).toEqual(expect.arrayContaining([
      expect.stringContaining('OPENAI_API_KEY missing'),
      expect.stringContaining('2 call(s) waiting for transcription'),
      expect.stringContaining('1 phone recording pipeline error'),
    ]));
  });

  it('POST /pipeline/retry schedules stuck recording pipelines', async () => {
    pool.query.mockImplementation(async (sql) => {
      const text = String(sql);
      if (text.includes("p.status IN ('recording_ready', 'needs_transcription', 'error')")) {
        return {
          rows: [
            { id: 11, twilio_call_sid: 'zadarma:pbx-11', status: 'needs_transcription' },
            { id: 12, twilio_call_sid: 'zadarma:pbx-12', status: 'error' },
          ],
        };
      }
      return { rows: [] };
    });

    const res = await request(app)
      .post('/api/telefon/pipeline/retry')
      .set('Authorization', `Bearer ${bearerDyrektor()}`)
      .send({});

    expect(res.status).toBe(202);
    expect(res.body).toEqual(expect.objectContaining({
      ok: true,
      retried: 2,
      items: expect.arrayContaining([
        expect.objectContaining({ id: 11, call_sid: 'zadarma:pbx-11' }),
        expect.objectContaining({ id: 12, call_sid: 'zadarma:pbx-12' }),
      ]),
    }));
    await new Promise((resolve) => setImmediate(resolve));
    expect(processRecordingPipeline).toHaveBeenCalledWith('zadarma:pbx-11');
    expect(processRecordingPipeline).toHaveBeenCalledWith('zadarma:pbx-12');
  });

  it('POST /test-flow blocks users from other branches before publishing artifacts', async () => {
    const res = await request(app)
      .post('/api/telefon/test-flow')
      .set('Authorization', `Bearer ${bearerKierownik()}`)
      .send({ oddzial_id: 7, phone: '+48600111222' });

    expect(res.status).toBe(403);
    expect(publishPhoneCallArtifacts).not.toHaveBeenCalled();
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('GET /rozmowy/:id/nagranie returns 401 without token', async () => {
    const res = await request(app).get('/api/telefon/rozmowy/1/nagranie');
    expect(res.status).toBe(401);
  });

  it('GET /rozmowy/:id/nagranie returns 404 when conversation missing', async () => {
    pool.query.mockImplementation(async (sql) => {
      if (String(sql).includes('WHERE p.id = $1')) {
        return { rows: [] };
      }
      return { rows: [] };
    });
    const res = await request(app)
      .get('/api/telefon/rozmowy/99/nagranie')
      .set('Authorization', `Bearer ${bearerKierownik()}`);
    expect(res.status).toBe(404);
  });

  it('GET /rozmowy/:id/nagranie returns 404 when archive missing', async () => {
    pool.query.mockImplementation(async (sql) => {
      if (String(sql).includes('WHERE p.id = $1')) {
        return {
          rows: [
            {
              id: 1,
              user_id: 1,
              recording_archive_backend: null,
              recording_archive_ref: null,
            },
          ],
        };
      }
      return { rows: [] };
    });
    const res = await request(app)
      .get('/api/telefon/rozmowy/1/nagranie')
      .set('Authorization', `Bearer ${bearerKierownik()}`);
    expect(res.status).toBe(404);
  });

  it('GET /rozmowy/:id/nagranie streams local file when archived', async () => {
    const recRoot = path.join(__dirname, '..', 'private', 'phone-recordings-telefon-test');
    const rel = '2099-01/ca_test_re1.mp3';
    const full = path.join(recRoot, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, Buffer.from([0xff, 0xfb, 0x90, 0x00]));

    pool.query.mockImplementation(async (sql) => {
      if (String(sql).includes('WHERE p.id = $1')) {
        return {
          rows: [
            {
              id: 2,
              user_id: 1,
              recording_archive_backend: 'local',
              recording_archive_ref: rel,
            },
          ],
        };
      }
      return { rows: [] };
    });

    const { env } = require('../src/config/env');
    const prevDir = env.PHONE_RECORDINGS_DIR;
    env.PHONE_RECORDINGS_DIR = recRoot;
    try {
      const res = await request(app)
        .get('/api/telefon/rozmowy/2/nagranie')
        .set('Authorization', `Bearer ${bearerKierownik()}`);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/audio\/mpeg/);
    } finally {
      env.PHONE_RECORDINGS_DIR = prevDir;
      fs.rmSync(recRoot, { recursive: true, force: true });
    }
  });

  it('POST /test-flow creates a synthetic recording flow and CRM lead link', async () => {
    pool.query.mockImplementation(async (sql, params) => {
      const text = String(sql);
      if (text.includes('INSERT INTO phone_call_conversations')) {
        return {
          rows: [{
            id: 901,
            twilio_call_sid: params[0],
            client_number: params[2],
            status: 'analyzed',
            created_at: '2026-06-07T06:00:00.000Z',
          }],
        };
      }
      return { rows: [] };
    });

    const res = await request(app)
      .post('/api/telefon/test-flow')
      .set('Authorization', `Bearer ${bearerKierownik()}`)
      .send({
        oddzial_id: 2,
        phone: '500100200',
        transcript: 'Klient pyta o wycinke drzewa.',
        raport: 'Oddzwonic jutro.',
      });

    expect(res.status).toBe(201);
    expect(res.body).toEqual(expect.objectContaining({
      ok: true,
      lead_id: 301,
      crm_message_id: 501,
    }));
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO phone_call_conversations'),
      expect.arrayContaining([expect.stringContaining('arbor-test:'), 10, '+48500100200'])
    );
    expect(publishPhoneCallArtifacts).toHaveBeenCalledWith(expect.objectContaining({
      clientNumber: '+48500100200',
      transcript: 'Klient pyta o wycinke drzewa.',
      raport: 'Oddzwonic jutro.',
      oddzialId: 2,
      status: 'analyzed',
    }));
  });

  it('POST /test-flow blocks branch users from testing another branch', async () => {
    const res = await request(app)
      .post('/api/telefon/test-flow')
      .set('Authorization', `Bearer ${bearerKierownik()}`)
      .send({ oddzial_id: 9, phone: '500100200' });

    expect(res.status).toBe(403);
    expect(publishPhoneCallArtifacts).not.toHaveBeenCalled();
  });
});
