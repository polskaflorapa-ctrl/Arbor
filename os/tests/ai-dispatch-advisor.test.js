const request = require('supertest');
const jwt = require('jsonwebtoken');

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  testConnection: jest.fn().mockResolvedValue(true),
}));

jest.mock('../src/services/aiProviders', () => ({
  generateAiText: jest.fn(),
  getAiConfigurationStatus: jest.fn(() => ({ textAvailable: false })),
  isAiAuthError: jest.fn(() => false),
}));

const pool = require('../src/config/database');
const { generateAiText, getAiConfigurationStatus } = require('../src/services/aiProviders');
const { analyzeTaskQuality, buildDispatchAdvisor } = require('../src/services/aiDispatchAdvisor');
const { createApp } = require('../src/app');
const { env } = require('../src/config/env');

const app = createApp();

const token = (payload = {}) =>
  jwt.sign({ id: 1, rola: 'Kierownik', oddzial_id: 7, imie: 'Jan', nazwisko: 'Test', ...payload }, env.JWT_SECRET);

const taskRow = (overrides = {}) => ({
  id: 10,
  numer: 'ARB-10',
  klient_nazwa: 'Anna Klient',
  klient_telefon: '501501501',
  adres: 'Lesna 1',
  miasto: 'Warszawa',
  status: 'Zaplanowane',
  data_planowana: '2026-05-25T09:00:00.000Z',
  ekipa_id: 3,
  ekipa_nazwa: 'Ekipa A',
  wartosc_planowana: 2400,
  czas_planowany_godziny: 4,
  opis_pracy: 'Pielęgnacja korony',
  pin_lat: 52.1,
  pin_lng: 21.1,
  photo_total: 2,
  equipment_reserved_count: 1,
  ...overrides,
});

describe('AI dispatch advisor', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getAiConfigurationStatus.mockReturnValue({ textAvailable: false });
  });

  it('scores task quality and exposes blocking issues', () => {
    const result = analyzeTaskQuality(taskRow({
      klient_telefon: '',
      ekipa_id: null,
      ekipa_nazwa: null,
      wartosc_planowana: null,
      photo_total: 0,
    }), { today: '2026-05-25' });

    expect(result.ready_for_dispatch).toBe(false);
    expect(result.blocker_count).toBeGreaterThanOrEqual(3);
    expect(result.issues.map((issue) => issue.key)).toEqual(
      expect.arrayContaining(['client_phone', 'price', 'team', 'photos'])
    );
    expect(result.quality_score).toBeLessThan(70);
  });

  it('builds deterministic dispatch recommendations', () => {
    const advisor = buildDispatchAdvisor({
      date: '2026-05-25',
      today: '2026-05-25',
      teamsCount: 2,
      tasks: [
        taskRow(),
        taskRow({ id: 11, numer: 'ARB-11', klient_telefon: '', ekipa_id: null, ekipa_nazwa: null }),
      ],
    });

    expect(advisor.metrics.tasks_total).toBe(2);
    expect(advisor.metrics.blocked).toBe(1);
    expect(advisor.recommendations[0].priority).toBe('high');
    expect(advisor.top_tasks[0].task_id).toBe(11);
  });

  it('GET /api/ai/dispatch-brief returns rules brief scoped to manager branch', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [taskRow({ id: 12, klient_telefon: '' })] })
      .mockResolvedValueOnce({ rows: [{ teams_count: 4 }] });

    const res = await request(app)
      .get('/api/ai/dispatch-brief?date=2026-05-25')
      .set('Authorization', `Bearer ${token()}`);

    expect(res.status).toBe(200);
    expect(res.body.source).toBe('rules');
    expect(res.body.metrics).toEqual(expect.objectContaining({
      tasks_total: 1,
      teams_available: 4,
      blocked: 1,
    }));
    expect(res.body.top_tasks[0].issues[0]).toEqual(expect.objectContaining({ key: 'client_phone' }));
    expect(pool.query.mock.calls[0][0]).toContain('t.oddzial_id = $3');
    expect(pool.query.mock.calls[0][1]).toEqual(['2026-05-25', 1, 7]);
  });

  it('GET /api/ai/dispatch-brief can use AI summary without changing factual metrics', async () => {
    getAiConfigurationStatus.mockReturnValue({ textAvailable: true });
    generateAiText.mockResolvedValue({
      provider: 'huggingface',
      model: 'test/model',
      text: JSON.stringify({
        summary: 'Najpierw napraw kontakt w ARB-12.',
        recommendations: [{ priority: 'high', title: 'Kontakt', rationale: 'Brak telefonu', suggested_action: 'Dzwon do klienta', risk: 'high' }],
      }),
    });
    pool.query
      .mockResolvedValueOnce({ rows: [taskRow({ id: 12, numer: 'ARB-12', klient_telefon: '' })] })
      .mockResolvedValueOnce({ rows: [{ teams_count: 4 }] });

    const res = await request(app)
      .get('/api/ai/dispatch-brief?date=2026-05-25')
      .set('Authorization', `Bearer ${token({ rola: 'Dyrektor', oddzial_id: null })}`);

    expect(res.status).toBe(200);
    expect(res.body.source).toBe('ai');
    expect(res.body.provider).toBe('huggingface');
    expect(res.body.metrics.tasks_total).toBe(1);
    expect(res.body.summary).toBe('Najpierw napraw kontakt w ARB-12.');
    expect(generateAiText).toHaveBeenCalledWith(expect.objectContaining({ maxTokens: 900 }));
  });

  it('GET /api/ai/dispatch-brief rejects crew roles', async () => {
    const res = await request(app)
      .get('/api/ai/dispatch-brief?date=2026-05-25')
      .set('Authorization', `Bearer ${token({ rola: 'Brygadzista' })}`);

    expect(res.status).toBe(403);
    expect(pool.query).not.toHaveBeenCalled();
  });
});
