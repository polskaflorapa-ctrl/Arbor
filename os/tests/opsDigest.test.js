const {
  DIGEST_TYPE,
  buildDigestText,
  buildOperationalDigest,
  deliverOperationalDigest,
  getDigestRunHistory,
  recordDigestRun,
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
              labor_cost: '900.00',
              threshold_pct: '15.0',
              margin_pct: '10.0',
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

  it('adds Zadarma and operational decision memory to the daily digest', async () => {
    const pool = createPool((sql) => {
      if (sql.includes('AS today_total')) {
        return { rows: [{ today_total: 1, horizon_total: 1, overdue_total: 0, unassigned_total: 0, in_progress_total: 0 }] };
      }
      if (sql.includes('FROM daily_reports r')) return { rows: [{ draft_total: 0, older_drafts: 0 }] };
      if (sql.includes('kommo_last_sync_status')) return { rows: [{ sync_errors: 0 }] };
      if (sql.includes('COUNT(*)::int AS total_actions')) {
        return { rows: [{ total_actions: 3, zadarma_actions: 2, risk_resolution_actions: 1, reason_actions: 0 }] };
      }
      if (sql.includes('FROM ops_action_events e') && sql.includes('GROUP BY e.action_type')) {
        return {
          rows: [
            { action_type: 'risk_queue_call', count: 1 },
            { action_type: 'risk_resend_sms', count: 1 },
          ],
        };
      }
      if (sql.includes('FROM ops_action_events e') && sql.includes('LEFT JOIN tasks t')) {
        return {
          rows: [{
            id: 50,
            task_id: 77,
            action_type: 'risk_queue_call',
            issue_key: 'sms_not_confirmed',
            note: 'Telefon Zadarma',
            created_at: '2026-05-25T08:15:00.000Z',
            numer: 'ARB-77',
            klient_nazwa: 'Klient',
            actor_name: 'Kierownik',
          }],
        };
      }
      return { rows: [] };
    });

    const digest = await buildOperationalDigest(pool, { date: '2026-05-25' });

    expect(digest.summary).toEqual(expect.objectContaining({
      operational_decisions: 3,
      zadarma_actions: 2,
      risk_resolution_actions: 1,
    }));
    expect(digest.alerts.map((a) => a.type)).toContain('zadarma_followups');
    expect(digest.details.operational_action_types[0]).toMatchObject({
      action_type: 'risk_queue_call',
      label: 'Telefon Zadarma z ryzyka',
      count: 1,
    });
    expect(buildDigestText(digest)).toContain('Zadarma/SMS: 2 akcji');
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

  it('records and reads operational digest run history', async () => {
    const pool = createPool((sql) => {
      if (sql.includes('CREATE TABLE IF NOT EXISTS operational_digest_runs')) return { rows: [] };
      if (sql.includes('CREATE INDEX IF NOT EXISTS idx_operational_digest_runs')) return { rows: [] };
      if (sql.includes('INSERT INTO operational_digest_runs')) {
        return { rows: [{ id: 44, created_at: '2026-05-25T06:00:00.000Z' }] };
      }
      if (sql.includes('COUNT(*)::int AS total')) return { rows: [{ total: 1 }] };
      if (sql.includes('FROM operational_digest_runs r') && sql.includes('LEFT JOIN branches')) {
        return {
          rows: [{
            id: 44,
            digest_date: '2026-05-25',
            scope: 'branch',
            branch_id: 7,
            branch_name: 'Krakow',
            status: 'completed',
            summary: { total_alerts: 2 },
            delivery: { recipients: 3 },
            errors: [],
            high_alerts: 1,
            medium_alerts: 1,
            total_alerts: 2,
            recipients: 3,
            notifications_created: 3,
            emails_sent: 1,
            created_at: '2026-05-25T06:00:00.000Z',
          }],
        };
      }
      return { rows: [] };
    });
    const digest = {
      date: '2026-05-25',
      summary: { high_alerts: 1, medium_alerts: 1, total_alerts: 2 },
      errors: [],
    };

    const run = await recordDigestRun(pool, {
      digest,
      delivery: { recipients: 3, notifications_created: 3, emails_sent: 1 },
      scope: 'branch',
      branchId: 7,
      options: { actorUserId: 10, triggerType: 'cron' },
    });
    const history = await getDigestRunHistory(pool, { branchId: 7, scope: 'branch', limit: 10 });

    expect(run.id).toBe(44);
    expect(history.total).toBe(1);
    expect(history.items[0]).toMatchObject({
      id: 44,
      branch_name: 'Krakow',
      emails_sent: 1,
      summary: { total_alerts: 2 },
    });
    expect(pool.query.mock.calls.some(([sql]) => String(sql).includes('trigger_type'))).toBe(true);
  });
});
