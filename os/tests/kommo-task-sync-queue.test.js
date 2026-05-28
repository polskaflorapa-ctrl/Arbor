const {
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
            status: params[2] || row.status,
            retry_count: params[3] ?? row.retry_count,
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
  test('records failed task.sync with retry counter and payload snapshot', async () => {
    const pool = mockPoolReturningQueueRows();

    const row = await recordKommoTaskSyncFailure(pool, {
      taskId: 77,
      payload: { event: 'task.sync', task: { id: 77 } },
      actor: { id: 9 },
      httpStatus: 502,
      error: 'HTTP 502',
      retryCount: 0,
    });

    expect(row.status).toBe('failed');
    expect(row.retry_count).toBe(1);
    const insertCall = pool.query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO task_kommo_sync_queue'));
    expect(insertCall[1]).toEqual(expect.arrayContaining([77, 'task.sync', 'failed', 1, 10, 502]));
    expect(insertCall[1][7]).toContain('"task"');
    expect(insertCall[1][8]).toContain('"id":9');
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
    const insertCall = pool.query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO task_kommo_sync_queue'));
    expect(insertCall[1]).toEqual(expect.arrayContaining([88, 'task.sync', 'dead_letter', 3]));
  });

  test('marks task.sync as sent and clears retry metadata', async () => {
    const pool = mockPoolReturningQueueRows([{ status: 'sent', retry_count: 0 }]);

    const row = await markKommoTaskSyncSuccess(pool, 99);

    expect(row.status).toBe('sent');
    expect(row.retry_count).toBe(0);
    const insertCall = pool.query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO task_kommo_sync_queue'));
    expect(insertCall[1]).toEqual([99, 'task.sync']);
    expect(String(insertCall[0])).toContain("status = 'sent'");
  });
});
