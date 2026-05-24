const {
  DIGEST_TYPE,
  buildDigestText,
  buildOperationalDigest,
  deliverOperationalDigest,
} = require('../src/services/opsDigest');

function createPool(resolver) {
  return {
    query: jest.fn((sql, params = []) => Promise.resolve(resolver(String(sql), params))),
  };
}

describe('opsDigest service', () => {
  it('builds operational alerts from task, fleet, reporting and finance data', async () => {
    const pool = createPool((sql) => {
      if (sql.includes('AS today_total')) {
        return {
          rows: [
            {
              today_total: 6,
              horizon_total: 14,
              overdue_total: 2,
              unassigned_total: 3,
              in_progress_total: 1,
            },
          ],
        };
      }
      if (sql.includes('AND t.data_planowana < $1::date')) {
        return {
          rows: [
            { id: 101, klient_nazwa: 'Kowalski', status: 'Nowe', data_planowana: '2026-05-20' },
          ],
        };
      }
      if (sql.includes('AND t.ekipa_id IS NULL')) {
        return {
          rows: [
            { id: 202, klient_nazwa: 'Nowak', status: 'Nowe', data_planowana: '2026-05-25' },
          ],
        };
      }
      if (sql.includes('FROM daily_reports r')) {
        return { rows: [{ draft_total: 4, older_drafts: 1 }] };
      }
      if (sql.includes('FROM vehicles') && sql.includes('UNION ALL')) {
        return {
          rows: [
            {
              kind: 'vehicle',
              id: 7,
              label: 'KR 123',
              due_type: 'ubezpieczenie',
              due_date: '2026-05-30',
            },
          ],
        };
      }
      if (sql.includes('equipment_reservations r1')) {
        return { rows: [{ sprzet_id: 9, sprzet_nazwa: 'Rebak', conflict_pairs: 1 }] };
      }
      if (sql.includes('WITH settled AS')) {
        return {
          rows: [
            {
              id: 303,
              klient_nazwa: 'Firma ABC',
              revenue: '1000.00',
              labor_cost: '850.00',
              margin_pct: '15.0',
            },
          ],
        };
      }
      if (sql.includes('kommo_last_sync_status')) {
        return { rows: [{ sync_errors: 1 }] };
      }
      return { rows: [] };
    });

    const digest = await buildOperationalDigest(pool, {
      date: '2026-05-25',
      branchId: 4,
      horizonDays: 3,
    });

    expect(digest.summary).toEqual(
      expect.objectContaining({
        today_tasks: 6,
        overdue_tasks: 2,
        unassigned_tasks: 3,
        draft_reports: 4,
        fleet_due: 1,
        reservation_conflicts: 1,
        margin_risks: 1,
        kommo_sync_errors: 1,
      })
    );
    expect(digest.alerts.map((a) => a.type)).toEqual(
      expect.arrayContaining([
        'tasks_overdue',
        'tasks_unassigned',
        'draft_reports',
        'fleet_due',
        'equipment_reservation_conflicts',
        'margin_risks',
        'kommo_sync_errors',
      ])
    );
    expect(buildDigestText(digest)).toContain('Poranny digest ARBOR - 2026-05-25');
    expect(buildDigestText(digest)).toContain('Najstarsze zalegle: #101 Kowalski');
  });

  it('delivers one idempotent notification per recipient', async () => {
    const pool = createPool(() => ({ rows: [{ id: 1 }], rowCount: 1 }));
    const digest = {
      date: '2026-05-25',
      branch_id: null,
      horizon_days: 3,
      summary: {
        high_alerts: 0,
        medium_alerts: 0,
        today_tasks: 0,
        horizon_tasks: 0,
        query_errors: 0,
      },
      alerts: [],
      details: {
        overdue_tasks: [],
        unassigned_tasks: [],
        fleet_due: [],
        margin_risks: [],
      },
    };

    const result = await deliverOperationalDigest(
      pool,
      digest,
      [
        { id: 1, email: null },
        { id: 2, email: null },
      ],
      { emailEnabled: false }
    );

    expect(result.notifications_created).toBe(2);
    expect(pool.query).toHaveBeenCalledTimes(2);
    expect(pool.query.mock.calls[0][0]).toContain('WHERE NOT EXISTS');
    expect(pool.query.mock.calls[0][1][1]).toBe(DIGEST_TYPE);
  });
});
