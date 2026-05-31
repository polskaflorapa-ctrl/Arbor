const request = require('supertest');
const jwt = require('jsonwebtoken');

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
}));

jest.mock('../src/services/crmInbox', () => ({
  appendCrmLeadMessage: jest.fn(),
  appendCrmMessageForContact: jest.fn(),
}));

jest.mock('../src/services/smsGateway', () => ({
  sendSmsGateway: jest.fn(),
}));

const pool = require('../src/config/database');
const { appendCrmLeadMessage, appendCrmMessageForContact } = require('../src/services/crmInbox');
const { sendSmsGateway } = require('../src/services/smsGateway');
const telephonyRoutes = require('../src/routes/telephony');
const { createTestApp } = require('./helpers/create-test-app');
const { env } = require('../src/config/env');

describe('Telephony routes', () => {
  const app = createTestApp('/api/telephony', telephonyRoutes);

  const token = (overrides = {}) =>
    jwt.sign(
      { id: 7, login: 'tester', rola: 'Dyrektor', oddzial_id: 1, ...overrides },
      env.JWT_SECRET,
      { expiresIn: '1h' },
    );

  beforeEach(() => {
    jest.clearAllMocks();
    env.VOICE_AGENT_WEBHOOK_SECRET = 'voice-secret';
    sendSmsGateway.mockResolvedValue({ ok: true, provider: 'mock-sms', sid: 'SM-VOICE-1' });
    pool.query.mockImplementation(async (sql, params = []) => {
      const text = String(sql);
      if (text.includes('CREATE TABLE') || text.includes('CREATE INDEX')) {
        return { rows: [], rowCount: 0 };
      }
      if (text.includes('SELECT * FROM telephony_callbacks WHERE id = $1')) {
        return {
          rows: [{
            id: params[0],
            oddzial_id: 1,
            phone: '+48123456789',
            status: 'open',
          }],
          rowCount: 1,
        };
      }
      if (text.includes('UPDATE telephony_callbacks')) {
        return {
          rows: [{
            id: params[3],
            status: params[0],
            updated_by: params[1],
            closed_at: params[2],
          }],
          rowCount: 1,
        };
      }
      if (text.includes('INSERT INTO telephony_call_logs')) {
        return {
          rows: [{
            id: 11,
            oddzial_id: params[0],
            phone: params[1],
            call_type: params[2],
            status: params[3],
            duration_sec: params[4],
            task_id: params[5],
            lead_name: params[6],
            notes: params[7],
            created_by: params[8],
          }],
          rowCount: 1,
        };
      }
      if (text.includes('SELECT id, nazwa, miasto, telefon, sms_sender_id FROM branches WHERE id = $1')) {
        return {
          rows: [{ id: params[0], nazwa: 'Krakow', miasto: 'Krakow', telefon: '+48111111111', sms_sender_id: '+48221234567' }],
          rowCount: 1,
        };
      }
      if (text.includes('SELECT id, nazwa, miasto, telefon, sms_sender_id FROM branches WHERE COALESCE')) {
        return {
          rows: [{ id: 1, nazwa: 'Krakow', miasto: 'Krakow', telefon: '+48111111111', sms_sender_id: '+48221234567' }],
          rowCount: 1,
        };
      }
      if (text.includes('INSERT INTO crm_leads')) {
        return {
          rows: [{
            id: 101,
            title: params[0],
            oddzial_id: params[1],
            stage: params[2],
            source: params[3],
            phone: params[4],
            notes: params[5],
            tags: JSON.parse(params[6]),
            next_action_at: params[7],
            client_id: params[8],
          }],
          rowCount: 1,
        };
      }
      if (text.includes('SELECT id FROM klienci')) {
        return { rows: [], rowCount: 0 };
      }
      if (text.includes('INSERT INTO klienci')) {
        return { rows: [{ id: 501 }], rowCount: 1 };
      }
      if (text.includes('UPDATE klienci')) {
        return { rows: [], rowCount: 1 };
      }
      if (text.includes('INSERT INTO ogledziny')) {
        return { rows: [{ id: 601 }], rowCount: 1 };
      }
      if (text.includes('COUNT(*)::int AS all_count')) {
        return {
          rows: [{
            all_count: 4,
            needs_review: 1,
            sms_missing: 2,
            sms_error: 0,
            scheduled: 3,
          }],
          rowCount: 1,
        };
      }
      if (text.includes('SELECT COUNT(*)::int AS total') && text.includes('FROM voice_agent_intakes v')) {
        return { rows: [{ total: 1 }], rowCount: 1 };
      }
      if (text.includes('SELECT') && text.includes('v.id,') && text.includes('FROM voice_agent_intakes v')) {
        return {
          rows: [{
            id: 303,
            agent_id: 'polska-flora-ania',
            provider: 'test-agent',
            oddzial_id: 2,
            crm_lead_id: 101,
            klient_id: 501,
            caller_phone: '+48500111222',
            customer_name: 'Jan Flora',
            inspection_address: '',
            city: 'Krakow',
            service_type: 'ogrod',
            appointment_at: null,
            source: 'telefon_przychodzacy',
            raw_payload: {},
          }],
          rowCount: 1,
        };
      }
      if (text.includes('SELECT v.*') && text.includes('FROM voice_agent_intakes v') && text.includes('v.id = $1')) {
        if (Number(params[0]) === 304) {
          return {
            rows: [{
              id: params[0],
              agent_id: 'polska-flora-ania',
              provider: 'test-agent',
              oddzial_id: 2,
              crm_lead_id: 101,
              klient_id: 501,
              caller_phone: '+48500111222',
              customer_name: 'Jan Flora',
              service_type: 'ogrod',
              source: 'telefon_przychodzacy',
            }],
            rowCount: 1,
          };
        }
        return {
          rows: [{
            id: params[0],
            agent_id: 'polska-flora-ania',
            provider: 'test-agent',
            oddzial_id: 2,
            crm_lead_id: 101,
            klient_id: 501,
            caller_phone: '+48500111222',
            customer_name: 'Jan Flora',
            inspection_address: 'ul. Lesna 4',
            city: 'Krakow',
            service_type: 'ogrod',
            appointment_at: '2026-06-03T09:00:00.000Z',
            source: 'telefon_przychodzacy',
            ogledziny_id: 601,
            raw_payload: {
              last_sms_confirmation_at: '2026-06-02T09:00:00.000Z',
              last_sms_confirmation_id: 'SM-CONF-1',
              last_sms_reminder_at: '2026-06-02T18:00:00.000Z',
              last_sms_reminder_id: 'SM-REM-1',
              last_sms_reminder_for: '2026-06-03',
            },
          }],
          rowCount: 1,
        };
      }
      if (text.includes('SELECT v.*') && text.includes('FROM voice_agent_intakes v')) {
        if (params[1] === 'dupe-call' || params[2] === 'CA-DUPE') {
          return {
            rows: [{
              id: 303,
              agent_id: 'polska-flora-ania',
              provider: params[0],
              external_id: params[1],
              call_sid: params[2],
              oddzial_id: 2,
              crm_lead_id: 101,
              klient_id: 501,
              ogledziny_id: 601,
              stage: 'OglÄ™dziny',
              next_action_at: '2026-06-01T08:00:00.000Z',
            }],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      }
      if (text.includes('INSERT INTO voice_agent_intakes')) {
        if (text.includes('ON CONFLICT DO NOTHING') && (params[1] === 'dupe-call' || params[2] === 'CA-DUPE')) {
          return { rows: [], rowCount: 0 };
        }
        return { rows: [{ id: 303, crm_lead_id: params[4], ogledziny_id: params[5], oddzial_id: params[3] }], rowCount: 1 };
      }
      if (text.includes('UPDATE voice_agent_intakes')) {
        return { rows: [{ id: params[0], crm_lead_id: params[1], ogledziny_id: params[2] }], rowCount: 1 };
      }
      if (text.includes('UPDATE crm_leads')) {
        return { rows: [], rowCount: 1 };
      }
      if (text.includes('SELECT *') && text.includes('FROM voice_agent_integrations') && text.includes('oddzial_id = $1')) {
        return { rows: [], rowCount: 0 };
      }
      if (text.includes('SELECT *') && text.includes('FROM voice_agent_integrations') && text.includes('webhook_secret = $1')) {
        if (params[0] === 'db-secret') {
          return {
            rows: [{ id: 55, agent_id: 'polska-flora-ania', oddzial_id: 2, webhook_secret: 'db-secret', status: 'active' }],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      }
      if (text.includes('INSERT INTO voice_agent_integrations')) {
        return {
          rows: [{
            id: 55,
            agent_id: 'polska-flora-ania',
            oddzial_id: params[0],
            provider: params[1],
            provider_account_id: params[2],
            provider_api_key_masked: params[3],
            webhook_secret: params[4],
            status: params[5],
            updated_by: params[6],
            webhook_url: '/api/telephony/voice-agent/polska-flora/intake',
          }],
          rowCount: 1,
        };
      }
      if (text.includes('UPDATE voice_agent_integrations')) {
        return { rows: [], rowCount: 1 };
      }
      if (text.includes('INSERT INTO telephony_callbacks')) {
        return {
          rows: [{
            id: 22,
            oddzial_id: params[0],
            phone: params[1],
            task_id: params[2],
            lead_name: params[3],
            priority: params[4],
            due_at: params[5],
            status: 'open',
            notes: params[6],
            assigned_user_id: params[7],
            created_by: params[8],
          }],
          rowCount: 1,
        };
      }
      if (text.includes('FROM telephony_call_logs c') && text.includes('UNION ALL')) {
        return {
          rows: [
            { id: 1, oddzial_id: 2, phone: '+48111111111', status: 'answered', created_at: '2026-05-27T10:00:00.000Z' },
            { id: 2, oddzial_id: 2, phone: '+48222222222', status: 'missed', created_at: '2026-05-27T09:00:00.000Z' },
            { id: 3, oddzial_id: 2, phone: '+48333333333', status: 'answered', created_at: '2026-05-27T08:00:00.000Z' },
          ],
          rowCount: 3,
        };
      }
      if (text.includes('SELECT COUNT(*)::int AS c FROM telephony_callbacks')) {
        return { rows: [{ c: 2 }], rowCount: 1 };
      }
      if (text.includes('FROM telephony_callbacks c') && text.includes('ORDER BY COALESCE')) {
        return {
          rows: [
            { id: 44, oddzial_id: 2, phone: '+48123456789', status: 'open' },
            { id: 45, oddzial_id: 2, phone: '+48987654321', status: 'open' },
          ],
          rowCount: 2,
        };
      }
      return { rows: [], rowCount: 0 };
    });
  });

  it('lists calls with manager branch and status filters before in-memory pagination', async () => {
    const res = await request(app)
      .get('/api/telephony/calls?oddzial_id=2&status=answered&limit=2&offset=1')
      .set('Authorization', `Bearer ${token()}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ total: 3, limit: 2, offset: 1 });
    expect(res.body.items).toHaveLength(2);

    const selectCall = pool.query.mock.calls.find(([sql]) => String(sql).includes('FROM telephony_call_logs c'));
    expect(selectCall[0]).toContain('WHERE x.oddzial_id = $1 AND x.status = $2');
    expect(selectCall[1]).toEqual([2, 'answered']);
  });

  it('scopes call listing to branch users own branch', async () => {
    const res = await request(app)
      .get('/api/telephony/calls?status=missed')
      .set('Authorization', `Bearer ${token({ rola: 'Brygadzista', oddzial_id: 5 })}`);

    expect(res.status).toBe(200);
    const selectCall = pool.query.mock.calls.find(([sql]) => String(sql).includes('FROM telephony_call_logs c'));
    expect(selectCall[0]).toContain('WHERE x.oddzial_id = $1 AND x.status = $2');
    expect(selectCall[1]).toEqual([5, 'missed']);
  });

  it('lists callbacks with paginated branch and status filters', async () => {
    const res = await request(app)
      .get('/api/telephony/callbacks?oddzial_id=2&status=open&limit=10&offset=0')
      .set('Authorization', `Bearer ${token()}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ total: 2, limit: 10, offset: 0 });
    expect(res.body.items).toHaveLength(2);

    const countCall = pool.query.mock.calls.find(([sql]) => String(sql).includes('COUNT(*)::int AS c FROM telephony_callbacks'));
    const listCall = pool.query.mock.calls.find(([sql]) => String(sql).includes('LIMIT $3 OFFSET $4'));
    expect(countCall[0]).toContain('WHERE c.oddzial_id = $1 AND c.status = $2');
    expect(countCall[1]).toEqual([2, 'open']);
    expect(listCall[1]).toEqual([2, 'open', 10, 0]);
  });

  it('scopes callback listing to branch users own branch', async () => {
    const res = await request(app)
      .get('/api/telephony/callbacks?status=open&limit=5&offset=1')
      .set('Authorization', `Bearer ${token({ rola: 'Brygadzista', oddzial_id: 5 })}`);

    expect(res.status).toBe(200);
    const countCall = pool.query.mock.calls.find(([sql]) => String(sql).includes('COUNT(*)::int AS c FROM telephony_callbacks'));
    const listCall = pool.query.mock.calls.find(([sql]) => String(sql).includes('LIMIT $3 OFFSET $4'));
    expect(countCall[0]).toContain('WHERE c.oddzial_id = $1 AND c.status = $2');
    expect(countCall[1]).toEqual([5, 'open']);
    expect(listCall[1]).toEqual([5, 'open', 5, 1]);
  });

  it('creates call logs with coerced numeric payload', async () => {
    const res = await request(app)
      .post('/api/telephony/calls')
      .set('Authorization', `Bearer ${token()}`)
      .send({
        oddzial_id: '3',
        phone: '+48111222333',
        call_type: 'inbound',
        status: 'answered',
        duration_sec: '125',
        task_id: '55',
        lead_name: 'Jan Testowy',
        notes: 'notatka',
      });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      id: 11,
      oddzial_id: 3,
      duration_sec: 125,
      task_id: 55,
      created_by: 7,
    });
    const insertCall = pool.query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO telephony_call_logs'));
    expect(insertCall[1]).toEqual([
      3,
      '+48111222333',
      'inbound',
      'answered',
      125,
      55,
      'Jan Testowy',
      'notatka',
      7,
    ]);
    expect(appendCrmMessageForContact).toHaveBeenCalledWith(expect.objectContaining({
      oddzialId: 3,
      phone: '+48111222333',
      channel: 'phone',
      direction: 'inbound',
      senderName: 'Jan Testowy',
      senderHandle: '+48111222333',
      body: expect.stringContaining('Call inbound: answered'),
      status: 'received',
      externalMessageId: 'telephony_call_11',
      createdBy: 7,
    }));
  });

  it('blocks branch users from creating calls for another branch', async () => {
    const res = await request(app)
      .post('/api/telephony/calls')
      .set('Authorization', `Bearer ${token({ rola: 'Brygadzista', oddzial_id: 1 })}`)
      .send({
        oddzial_id: 9,
        phone: '+48111222333',
      });

    expect(res.status).toBe(403);
    expect(pool.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO telephony_call_logs'))).toBe(false);
  });

  it('creates callback queue entries with open default status', async () => {
    const res = await request(app)
      .post('/api/telephony/callbacks')
      .set('Authorization', `Bearer ${token()}`)
      .send({
        oddzial_id: '2',
        phone: '+48999111222',
        task_id: '77',
        lead_name: 'Maria Callback',
        priority: 'high',
        due_at: '2026-05-28T09:30',
        notes: 'oddzwonic',
        assigned_user_id: '8',
      });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      id: 22,
      oddzial_id: 2,
      task_id: 77,
      priority: 'high',
      status: 'open',
      assigned_user_id: 8,
      created_by: 7,
    });
    const insertCall = pool.query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO telephony_callbacks'));
    expect(insertCall[1]).toEqual([
      2,
      '+48999111222',
      77,
      'Maria Callback',
      'high',
      '2026-05-28T09:30',
      'oddzwonic',
      8,
      7,
    ]);
    expect(appendCrmMessageForContact).toHaveBeenCalledWith(expect.objectContaining({
      oddzialId: 2,
      phone: '+48999111222',
      channel: 'phone',
      direction: 'outbound',
      recipientHandle: '+48999111222',
      body: expect.stringContaining('Callback request (high)'),
      status: 'queued',
      externalMessageId: 'telephony_callback_22',
      templateKey: 'callback',
      createdBy: 7,
    }));
  });

  it('marks callback as done and closes it', async () => {
    const res = await request(app)
      .patch('/api/telephony/callbacks/44/status')
      .set('Authorization', `Bearer ${token()}`)
      .send({ status: 'done' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 44, status: 'done', updated_by: 7 });
    expect(res.body.closed_at).toEqual(expect.any(String));

    const updateCall = pool.query.mock.calls.find(([sql]) => String(sql).includes('UPDATE telephony_callbacks'));
    expect(updateCall[1][0]).toBe('done');
    expect(updateCall[1][1]).toBe(7);
    expect(updateCall[1][2]).toEqual(expect.any(String));
    expect(updateCall[1][3]).toBe(44);
  });

  it('keeps callback open without closed_at when status returns to open', async () => {
    const res = await request(app)
      .patch('/api/telephony/callbacks/44/status')
      .set('Authorization', `Bearer ${token()}`)
      .send({ status: 'open' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 44, status: 'open', updated_by: 7, closed_at: null });
    const updateCall = pool.query.mock.calls.find(([sql]) => String(sql).includes('UPDATE telephony_callbacks'));
    expect(updateCall[1]).toEqual(['open', 7, null, 44]);
  });

  it('blocks branch users from updating callbacks outside their branch', async () => {
    pool.query.mockImplementation(async (sql, params = []) => {
      const text = String(sql);
      if (text.includes('CREATE TABLE') || text.includes('CREATE INDEX')) {
        return { rows: [], rowCount: 0 };
      }
      if (text.includes('SELECT * FROM telephony_callbacks WHERE id = $1')) {
        return { rows: [{ id: params[0], oddzial_id: 9, status: 'open' }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    const res = await request(app)
      .patch('/api/telephony/callbacks/44/status')
      .set('Authorization', `Bearer ${token({ rola: 'Brygadzista', oddzial_id: 1 })}`)
      .send({ status: 'done' });

    expect(res.status).toBe(403);
    expect(pool.query.mock.calls.some(([sql]) => String(sql).includes('UPDATE telephony_callbacks'))).toBe(false);
  });

  it('returns Polska Flora voice agent config for selected branch', async () => {
    const res = await request(app)
      .get('/api/telephony/voice-agent/polska-flora/config?oddzial_id=2')
      .set('Authorization', `Bearer ${token()}`);

    expect(res.status).toBe(200);
    expect(res.body.agent).toMatchObject({ id: 'polska-flora-ania', name: 'Ania', locale: 'pl-PL' });
    expect(res.body.branch).toMatchObject({ id: 2, sms_sender_id: '+48221234567' });
    expect(res.body.system_prompt).toContain('Polska Flora');
    expect(res.body.required_crm_fields).toContain('appointment_at');
  });

  it('creates one-click voice agent integration for a branch', async () => {
    const res = await request(app)
      .post('/api/telephony/voice-agent/polska-flora/integration')
      .set('Authorization', `Bearer ${token()}`)
      .send({
        oddzial_id: 2,
        provider: 'vapi',
        provider_account_id: 'assistant-1',
        provider_api_key: 'secret-token-1234',
      });

    expect(res.status).toBe(201);
    expect(res.body.integration).toMatchObject({
      agent_id: 'polska-flora-ania',
      oddzial_id: 2,
      provider: 'vapi',
      provider_account_id: 'assistant-1',
      provider_api_key_masked: '****1234',
      status: 'active',
    });
    expect(res.body.integration.webhook_secret).toMatch(/^vf_/);
    expect(res.body.config.system_prompt).toContain('Polska Flora');
  });

  it('lists voice agent intakes with server-side operational filters', async () => {
    const res = await request(app)
      .get('/api/telephony/voice-agent/polska-flora/intakes?oddzial_id=2&filter=needs_review&limit=50')
      .set('Authorization', `Bearer ${token({ oddzial_id: 2 })}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      total: 1,
      limit: 50,
      filter: 'needs_review',
      summary: {
        all: 4,
        needs_review: 1,
        sms_missing: 2,
        sms_error: 0,
        scheduled: 3,
      },
    });
    expect(res.body.items[0]).toMatchObject({
      id: 303,
      quality_status: 'needs_review',
    });
    const countSql = String(pool.query.mock.calls.find(([sql]) => String(sql).includes('COUNT(*)::int AS total'))?.[0] || '');
    expect(countSql).toContain("v.agent_id = 'polska-flora-ania'");
    expect(countSql).toContain('v.oddzial_id = $1');
    expect(countSql).toContain('v.appointment_at IS NULL');
  });

  it('allows voice agent intake with branch integration secret from panel', async () => {
    env.VOICE_AGENT_WEBHOOK_SECRET = '';
    appendCrmLeadMessage.mockResolvedValue({ id: 202 });

    const res = await request(app)
      .post('/api/telephony/voice-agent/polska-flora/intake')
      .set('x-voice-agent-secret', 'db-secret')
      .send({
        caller_phone: '+48500111222',
        customer_name: 'Maria Panel',
        service_type: 'dach',
      });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ ok: true, oddzial_id: 2, crm_lead_id: 101, klient_id: 501 });
    const leadInsert = pool.query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO crm_leads'));
    expect(leadInsert[1]).toEqual(expect.arrayContaining([2, 'Lead', 'voice_agent', '+48500111222']));
  });

  it('accepts voice agent intake and creates CRM lead plus call log', async () => {
    appendCrmLeadMessage.mockResolvedValue({ id: 202 });

    const res = await request(app)
      .post('/api/telephony/voice-agent/polska-flora/intake')
      .set('x-voice-agent-secret', 'voice-secret')
      .send({
        provider: 'test-agent',
        external_id: 'call-1',
        call_sid: 'CA123',
        oddzial_id: 2,
        caller_phone: '+48500111222',
        customer_name: 'Jan Flora',
        inspection_address: 'ul. Testowa 1',
        city: 'Krakow',
        service_type: 'wycinka drzew',
        appointment_at: '2026-06-01T10:00:00+02:00',
        notes: 'Dwa drzewa w ogrodzie',
        transcript: 'Klient chce umowic ogledziny.',
      });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      ok: true,
      agent_id: 'polska-flora-ania',
      oddzial_id: 2,
      crm_lead_id: 101,
      klient_id: 501,
      ogledziny_id: 601,
      call_log_id: 11,
      intake_id: 303,
      stage: 'Oględziny',
    });
    const leadInsert = pool.query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO crm_leads'));
    expect(leadInsert[1]).toEqual(expect.arrayContaining([
      expect.stringContaining('Jan Flora'),
      2,
      'Oględziny',
      'voice_agent',
      '+48500111222',
    ]));
    expect(appendCrmLeadMessage).toHaveBeenCalledWith(expect.objectContaining({
      leadId: 101,
      channel: 'phone',
      direction: 'inbound',
      senderName: 'Jan Flora',
      senderHandle: '+48500111222',
      templateKey: 'polska_flora_voice_agent',
      metadata: expect.objectContaining({ ogledziny_id: 601 }),
    }));
    expect(pool.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO ogledziny'))).toBe(true);
  });

  it('returns existing voice agent intake without duplicating CRM records', async () => {
    appendCrmLeadMessage.mockResolvedValue({ id: 202 });

    const res = await request(app)
      .post('/api/telephony/voice-agent/polska-flora/intake')
      .set('x-voice-agent-secret', 'voice-secret')
      .send({
        provider: 'test-agent',
        external_id: 'dupe-call',
        call_sid: 'CA-DUPE',
        oddzial_id: 2,
        caller_phone: '+48500111222',
        customer_name: 'Jan Flora',
      });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      duplicate: true,
      crm_lead_id: 101,
      klient_id: 501,
      ogledziny_id: 601,
      intake_id: 303,
    });
    expect(pool.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO crm_leads'))).toBe(false);
    expect(pool.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO klienci'))).toBe(false);
    expect(pool.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO ogledziny'))).toBe(false);
    expect(appendCrmLeadMessage).not.toHaveBeenCalled();
  });

  it('allows manager to fix voice agent intake and create missing inspection', async () => {
    const res = await request(app)
      .patch('/api/telephony/voice-agent/polska-flora/intakes/304')
      .set('Authorization', `Bearer ${token({ oddzial_id: 2 })}`)
      .send({
        inspection_address: 'ul. Naprawiona 4',
        city: 'Krakow',
        appointment_at: '2026-06-03T11:00:00+02:00',
        notes: 'Uzupelniono dane po rozmowie.',
        create_missing_inspection: true,
      });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      intake: expect.objectContaining({
        id: 304,
        crm_lead_id: 101,
        klient_id: 501,
      }),
    });
    expect(pool.query.mock.calls.some(([sql]) => String(sql).includes('UPDATE crm_leads'))).toBe(true);
    expect(pool.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO ogledziny'))).toBe(true);
    expect(pool.query.mock.calls.some(([sql]) => String(sql).includes('UPDATE voice_agent_intakes'))).toBe(true);
  });

  it('sends branch-scoped SMS confirmation for voice agent inspection', async () => {
    appendCrmLeadMessage.mockResolvedValue({ id: 909 });

    const res = await request(app)
      .post('/api/telephony/voice-agent/polska-flora/intakes/303/sms')
      .set('Authorization', `Bearer ${token({ oddzial_id: 2 })}`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      provider: 'mock-sms',
      sid: 'SM-VOICE-1',
    });
    expect(res.body.text).toContain('potwierdzamy bezplatne ogledziny');
    expect(sendSmsGateway).toHaveBeenCalledWith(expect.objectContaining({
      to: '+48500111222',
      oddzialId: 2,
    }));
    expect(appendCrmLeadMessage).toHaveBeenCalledWith(expect.objectContaining({
      leadId: 101,
      channel: 'sms',
      direction: 'outbound',
      recipientHandle: '+48500111222',
      templateKey: 'polska_flora_ogledziny_confirmation',
      metadata: expect.objectContaining({
        source: 'voice_agent.sms_confirmation',
        intake_id: 303,
        ogledziny_id: 601,
      }),
    }));
  });

  it('exposes SMS status from voice agent intake payload', async () => {
    const res = await request(app)
      .patch('/api/telephony/voice-agent/polska-flora/intakes/303')
      .set('Authorization', `Bearer ${token({ oddzial_id: 2 })}`)
      .send({
        notes: 'Bez zmian.',
      });

    expect(res.status).toBe(200);
    expect(res.body.intake.sms_status).toMatchObject({
      confirmation_at: '2026-06-02T09:00:00.000Z',
      confirmation_id: 'SM-CONF-1',
      reminder_at: '2026-06-02T18:00:00.000Z',
      reminder_id: 'SM-REM-1',
      reminder_for: '2026-06-03',
    });
  });

  it('rejects voice agent intake with invalid secret', async () => {
    const res = await request(app)
      .post('/api/telephony/voice-agent/polska-flora/intake')
      .set('x-voice-agent-secret', 'bad')
      .send({
        oddzial_id: 2,
        caller_phone: '+48500111222',
      });

    expect(res.status).toBe(401);
    expect(pool.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO crm_leads'))).toBe(false);
  });
});
