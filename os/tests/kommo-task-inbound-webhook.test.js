const request = require('supertest');

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
}));

const pool = require('../src/config/database');
const { createTestApp } = require('./helpers/create-test-app');
const kommoRoutes = require('../src/routes/kommoQuotationWebhook');

const app = createTestApp('/api/webhooks', kommoRoutes);

function setupPool({ currentTask, duplicateEvent = null } = {}) {
  pool.query.mockImplementation(async (sql, params = []) => {
    const text = String(sql);
    if (text.startsWith('CREATE TABLE') || text.startsWith('CREATE INDEX')) {
      return { rows: [], rowCount: 0 };
    }
    if (text.includes('SELECT * FROM task_kommo_inbound_events WHERE event_key')) {
      return { rows: duplicateEvent ? [duplicateEvent] : [], rowCount: duplicateEvent ? 1 : 0 };
    }
    if (text.includes('SELECT id, status, ekipa_id')) {
      return { rows: currentTask ? [currentTask] : [], rowCount: currentTask ? 1 : 0 };
    }
    if (text.includes('UPDATE tasks SET') && text.includes("kommo_last_sync_status = 'conflict'")) {
      return { rows: [], rowCount: 1 };
    }
    if (text.includes('UPDATE tasks SET') && text.includes("kommo_last_sync_status = 'inbound_ok'")) {
      return {
        rows: [{
          id: params[params.length - 1],
          status: params[0] || currentTask?.status,
          ekipa_id: params.find((value) => value === 8) || currentTask?.ekipa_id || null,
          oddzial_id: params.find((value) => value === 2) || currentTask?.oddzial_id || null,
          kommo_last_sync_status: 'inbound_ok',
        }],
        rowCount: 1,
      };
    }
    if (text.includes('INSERT INTO task_kommo_inbound_events')) {
      return {
        rows: [{
          event_key: params[0],
          task_id: params[1],
          status: params[2],
          incoming_status: params[3],
          applied_status: params[4],
          conflict_reason: params[5],
        }],
        rowCount: 1,
      };
    }
    return { rows: [], rowCount: 0 };
  });
}

describe('Kommo task inbound webhook', () => {
  beforeEach(() => {
    process.env.KOMMO_QUOTATION_WEBHOOK_SECRET = 'secret';
    process.env.KOMMO_STATUS_MAP_JSON = '{"142":"Zaplanowane","143":"W_Realizacji"}';
    pool.query.mockReset();
  });

  test('applies task.sync idempotently to an open task', async () => {
    setupPool({ currentTask: { id: 101, status: 'Zaplanowane', ekipa_id: 5 } });

    const res = await request(app)
      .post('/api/webhooks/kommo/task-sync')
      .set('x-arbor-webhook-secret', 'secret')
      .send({
        event_id: 'evt-1',
        task: { external_id: 'task:101', status: 'w realizacji', ekipa_id: 8 },
        notes: 'Kommo update',
      });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('applied');
    expect(res.body.task.status).toBe('W_Realizacji');
    expect(pool.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO task_kommo_inbound_events'))).toBe(true);
  });

  test('returns duplicate without updating task when event key already exists', async () => {
    setupPool({
      currentTask: { id: 101, status: 'Zaplanowane', ekipa_id: 5 },
      duplicateEvent: { event_key: 'evt-dup', status: 'applied', task_id: 101 },
    });

    const res = await request(app)
      .post('/api/webhooks/kommo/task-sync')
      .set('x-arbor-webhook-secret', 'secret')
      .send({ event_id: 'evt-dup', task_id: 101, status: 'Zaplanowane' });

    expect(res.status).toBe(200);
    expect(res.body.duplicate).toBe(true);
    expect(pool.query.mock.calls.some(([sql]) => String(sql).includes('UPDATE tasks SET'))).toBe(false);
  });

  test('records conflict when Kommo tries to reopen a closed task', async () => {
    setupPool({ currentTask: { id: 101, status: 'Zakonczone', ekipa_id: 5 } });

    const res = await request(app)
      .post('/api/webhooks/kommo/task-update')
      .set('x-arbor-webhook-secret', 'secret')
      .send({ event_id: 'evt-conflict', task_id: 101, status: 'Anulowane' });

    expect(res.status).toBe(409);
    expect(res.body.status).toBe('conflict');
    const insertCall = pool.query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO task_kommo_inbound_events'));
    expect(insertCall[1][2]).toBe('conflict');
  });

  test('maps Kommo lead fields and status_id into task update', async () => {
    setupPool({ currentTask: { id: 202, status: 'Do_Zatwierdzenia', ekipa_id: null, oddzial_id: 1 } });

    const res = await request(app)
      .post('/api/webhooks/kommo/task-sync')
      .set('x-arbor-webhook-secret', 'secret')
      .send({
        event_id: 'evt-fields',
        status_id: 142,
        task_id: 202,
        lead: {
          id: 991,
          name: 'Nowy klient Kommo',
          phone: '+48123123123',
          email: 'kommo@example.test',
          value: 3450,
        },
        custom_fields_values: [
          { field_name: 'Adres uslugi', values: [{ value: 'Lesna 10' }] },
          { field_name: 'Miasto', values: [{ value: 'Krakow' }] },
          { field_name: 'Zakres prac', values: [{ value: 'Wycinka i frezowanie' }] },
          { field_name: 'Priorytet', values: [{ value: 'Pilne' }] },
        ],
        attachments: [{ url: 'https://kommo.example/file.pdf' }],
        oddzial_id: 2,
      });

    expect(res.status).toBe(200);
    expect(res.body.task.status).toBe('Zaplanowane');
    const updateCall = pool.query.mock.calls.find(([sql]) => (
      String(sql).includes('UPDATE tasks SET') && String(sql).includes("kommo_last_sync_status = 'inbound_ok'")
    ));
    expect(String(updateCall[0])).toContain('klient_nazwa =');
    expect(String(updateCall[0])).toContain('adres =');
    expect(String(updateCall[0])).toContain('typ_uslugi =');
    expect(String(updateCall[0])).toContain('wartosc_planowana =');
    expect(String(updateCall[0])).toContain('oddzial_id =');
    expect(updateCall[1]).toEqual(expect.arrayContaining([
      'Zaplanowane',
      'Nowy klient Kommo',
      '+48123123123',
      'kommo@example.test',
      'Lesna 10',
      'Krakow',
      'Wycinka i frezowanie',
      3450,
      'Pilne',
      2,
    ]));
    expect(updateCall[1].some((value) => String(value).includes('Kommo zalaczniki'))).toBe(true);
  });
});
