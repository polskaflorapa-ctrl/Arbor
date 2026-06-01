const request = require('supertest');
const jwt = require('jsonwebtoken');

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
}));

const pool = require('../src/config/database');
const payrollRoutes = require('../src/routes/payroll');
const { createTestApp } = require('./helpers/create-test-app');
const { env } = require('../src/config/env');

describe('Payroll worklog timesheet', () => {
  const app = createTestApp('/api/payroll', payrollRoutes);
  const token = (payload = {}) =>
    jwt.sign({ id: 10, rola: 'Kierownik', oddzial_id: 3, ...payload }, env.JWT_SECRET, { expiresIn: '1h' });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('builds manager scoped ECP from work_logs with overtime summary', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [
        {
          user_id: 22,
          user_imie: 'Jan',
          user_nazwisko: 'Kowalski',
          hours_total: '10.00',
          hours_regular: '8.00',
          hours_overtime: '2.00',
          hours_night: '0.00',
          days: [{ date: '2026-06-02', hours_total: 10 }],
        },
      ],
    });

    const res = await request(app)
      .get('/api/payroll/worklog-timesheet?month=2026-06')
      .set('Authorization', `Bearer ${token()}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      source: 'work_logs',
      month: '2026-06',
      items: [expect.objectContaining({ user_id: 22, hours_overtime: '2.00' })],
    });
    expect(res.body.overtime_rule).toContain('weryfikacji prawnej');
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('FROM work_logs wl'), ['2026-06-01', 3]);
    expect(pool.query.mock.calls[0][0]).toContain('t.oddzial_id = $2');
  });

  it('allows director to filter ECP by team without branch clamp', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .get('/api/payroll/worklog-timesheet?month=2026-06&team_id=7')
      .set('Authorization', `Bearer ${token({ rola: 'Dyrektor', oddzial_id: 1 })}`);

    expect(res.status).toBe(200);
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('t.ekipa_id = $2'), ['2026-06-01', 7]);
    expect(pool.query.mock.calls[0][0]).not.toContain('t.oddzial_id = $3');
  });

  it('blocks field team roles from management ECP endpoint', async () => {
    const res = await request(app)
      .get('/api/payroll/worklog-timesheet?month=2026-06')
      .set('Authorization', `Bearer ${token({ rola: 'Brygadzista', ekipa_id: 7 })}`);

    expect(res.status).toBe(403);
    expect(pool.query).not.toHaveBeenCalled();
  });
});
