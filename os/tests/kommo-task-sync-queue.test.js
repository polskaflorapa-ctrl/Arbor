const {
  kommoTaskSyncIdempotencyKey,
  kommoPhoneCallIdempotencyKey,
  buildKommoPhoneCallPayload,
  markKommoTaskSyncSuccess,
  recordKommoTaskSyncFailure,
} = require('../src/services/kommo');

function mockPoolReturningQueueRows(rows = []) {
  const pool = {
    query: jest.fn(async (sql, params = []) => {
      const text = String(sql);
      if (text.startsWith('CREATE TABLE') || text.startsWith('CREATE INDEX')) {
        return { rows: [], rowCount: 0 };
      }
      if (text.includes('INSERT INTO task_kommo_sync_queue')) {
        const row = rows.shift() || {};
        return {
          rows: [{
            task_id: params[0],
            event: params[1],
            idempotency_key: params[2] || row.idempotency_key,
            status: params[3] || row.status,
            retry_count: params[4] ?? row.retry_count,
            ...row,
          }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    }),
  };
  return pool;
}

describe('Kommo task sync queue', () => {
  const OLD_ENV = process.env;
  const OLD_FETCH = global.fetch;

  afterEach(() => {
    process.env = OLD_ENV;
    global.fetch = OLD_FETCH;
    jest.resetModules();
  });

  test('records failed task.sync with retry counter and payload snapshot', async () => {
    const pool = mockPoolReturningQueueRows();
    const payload = { event: 'task.sync', task: { id: 77, sync_meta: { idempotency_key: 'arbor:task.sync:task:77' } } };

    const row = await recordKommoTaskSyncFailure(pool, {
      taskId: 77,
      payload,
      actor: { id: 9 },
      httpStatus: 502,
      error: 'HTTP 502',
      retryCount: 0,
    });

    expect(row.status).toBe('failed');
    expect(row.retry_count).toBe(1);
    expect(row.idempotency_key).toBe('arbor:task.sync:task:77');
    const insertCall = pool.query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO task_kommo_sync_queue'));
    expect(insertCall[1]).toEqual(expect.arrayContaining([77, 'task.sync', 'arbor:task.sync:task:77', 'failed', 1, 10, 502]));
    expect(insertCall[1][8]).toContain('"task"');
    expect(insertCall[1][9]).toContain('"id":9');
  });

  test('moves task.sync to dead_letter after retry limit', async () => {
    const pool = mockPoolReturningQueueRows();

    const row = await recordKommoTaskSyncFailure(pool, {
      taskId: 88,
      payload: { event: 'task.sync' },
      error: 'still failing',
      retryCount: 2,
      maxRetries: 3,
    });

    expect(row.status).toBe('dead_letter');
    expect(row.retry_count).toBe(3);
    expect(row.idempotency_key).toBe('arbor:task.sync:task:88');
    const insertCall = pool.query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO task_kommo_sync_queue'));
    expect(insertCall[1]).toEqual(expect.arrayContaining([88, 'task.sync', 'arbor:task.sync:task:88', 'dead_letter', 3]));
  });

  test('marks task.sync as sent and clears retry metadata', async () => {
    const pool = mockPoolReturningQueueRows([{ status: 'sent', retry_count: 0, idempotency_key: 'arbor:task.sync:task:99' }]);

    const row = await markKommoTaskSyncSuccess(pool, 99);

    expect(row.status).toBe('sent');
    expect(row.retry_count).toBe(0);
    expect(row.idempotency_key).toBe('arbor:task.sync:task:99');
    const insertCall = pool.query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO task_kommo_sync_queue'));
    expect(insertCall[1]).toEqual([99, 'task.sync', 'arbor:task.sync:task:99']);
    expect(String(insertCall[0])).toContain("status = 'sent'");
  });

  test('posts outbound task.sync with stable idempotency headers', async () => {
    process.env = { ...OLD_ENV, KOMMO_CRM_WEBHOOK_URL: 'https://kommo.example/hook' };
    jest.resetModules();
    const { postKommoWebhook: freshPostKommoWebhook } = require('../src/services/kommo');
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => 'ok',
    }));

    const payload = {
      event: 'task.sync',
      task: { id: 77, sync_meta: { idempotency_key: 'arbor:task.sync:task:77' } },
    };

    const result = await freshPostKommoWebhook(payload, 'crm');

    expect(result.response.status).toBe(200);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://kommo.example/hook',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'idempotency-key': 'arbor:task.sync:task:77',
          'x-idempotency-key': 'arbor:task.sync:task:77',
        }),
      })
    );
  });

  test('builds stable task.sync idempotency key', () => {
    expect(kommoTaskSyncIdempotencyKey(123)).toBe('arbor:task.sync:task:123');
  });

  test('builds phone call recording payload for Kommo lead note', () => {
    const payload = buildKommoPhoneCallPayload({
      callSid: 'zadarma:pbx-call-1',
      clientNumber: '+48 500 600 700',
      transcript: 'Klient pyta o wycinke.',
      raport: 'Ustalono ogledziny.',
      wskazowki: 'Dopytac o dojazd.',
      status: 'analyzed',
      crmMessage: { id: 42, lead_id: 9, body: 'Gotowa notatka rozmowy' },
      recordingArchiveUrl: 'https://cdn.example/recording.mp3',
    });

    expect(payload.event).toBe('phone_call.recording');
    expect(payload.idempotency_key).toBe('arbor:phone_call.recording:call:zadarma:pbx-call-1');
    expect(payload.kommo.note).toEqual(expect.objectContaining({
      entity_type: 'lead',
      note_type: 'common',
      text: 'Gotowa notatka rozmowy',
    }));
    expect(payload.kommo.note.match).toEqual({
      phone: '+48 500 600 700',
      arbor_lead_id: 9,
    });
    expect(payload.phone_call).toEqual(expect.objectContaining({
      provider: 'zadarma',
      crm_message_id: 42,
      crm_lead_id: 9,
      recording_archive_url: 'https://cdn.example/recording.mp3',
    }));
  });

  test('posts phone_call.recording to Kommo with stable idempotency headers', async () => {
    process.env = { ...OLD_ENV, KOMMO_CRM_WEBHOOK_URL: 'https://kommo.example/hook' };
    jest.resetModules();
    const { syncPhoneCallToKommo } = require('../src/services/kommo');
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => 'ok',
    }));

    const result = await syncPhoneCallToKommo({
      callSid: 'zadarma:pbx-call-2',
      clientNumber: '+48500600700',
      transcript: 'Tres rozmowy',
      crmMessage: { id: 43, lead_id: 10, body: 'Notatka do leadu' },
    });

    expect(result.response.status).toBe(200);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://kommo.example/hook',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'idempotency-key': 'arbor:phone_call.recording:call:zadarma:pbx-call-2',
          'x-idempotency-key': 'arbor:phone_call.recording:call:zadarma:pbx-call-2',
        }),
      })
    );
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.event).toBe('phone_call.recording');
    expect(body.kommo.note.text).toBe('Notatka do leadu');
  });

  test('builds stable phone call recording idempotency key', () => {
    expect(kommoPhoneCallIdempotencyKey('zadarma:abc')).toBe('arbor:phone_call.recording:call:zadarma:abc');
  });
});
