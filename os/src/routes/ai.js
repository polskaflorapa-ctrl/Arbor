const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const logger = require('../config/logger');
const { authMiddleware } = require('../middleware/auth');
const { validateBody } = require('../middleware/validate');
const { z } = require('zod');
const {
  generateAiText,
  getAiConfigurationStatus,
  isAiAuthError,
} = require('../services/aiProviders');

const aiChatSchema = z.object({
  messages: z.array(z.object({
    role: z.string(),
    content: z.string(),
  })).min(1, 'Brak wiadomosci'),
  context: z.string().max(2000).optional(),
});

const aiPhotoSchema = z.object({
  imageBase64: z.string().min(1, 'Brak zdjecia'),
  mediaType: z.string().max(80).optional().default('image/jpeg'),
  adres: z.string().max(500).optional(),
  miasto: z.string().max(200).optional(),
});

const aiTodayPlanSchema = z.object({
  horizon_days: z.coerce.number().int().min(1).max(14).optional().default(3),
});

const SYSTEM_PROMPT = `Jesteś asystentem AI wbudowanym w system ARBOR-OS — oprogramowanie do zarządzania firmą arborystyczną (wycinka i pielęgnacja drzew, frezowanie pni, usługi alpinistyczne).

Twoje zadania:
- Odpowiadasz na pytania pracowników dotyczące zleceń, ekip, wycen, harmonogramu, raportów
- Pomagasz planować pracę i analizować dane z systemu
- Sugerujesz optymalizacje i odpowiadasz na pytania operacyjne
- Mówisz WYŁĄCZNIE po polsku
- Jesteś zwięzły, konkretny i pomocny
- Jeśli dostaniesz dane kontekstowe (zlecenia, ekipy, statystyki) — używaj ich w odpowiedzi
- Nie wymyślaj danych których nie masz — mów "sprawdź w systemie" jeśli nie masz danych

Format odpowiedzi: krótkie akapity, używaj list tylko gdy naprawdę potrzeba.`;

const sendAiError = (req, res, error, fallbackKey) => {
  if (error?.configuration) {
    return res.status(503).json({ error: req.t('errors.ai.providerNotConfigured') });
  }
  if (isAiAuthError(error)) {
    const key = error.provider === 'huggingface'
      ? 'errors.ai.huggingFaceKeyInvalid'
      : 'errors.ai.anthropicKeyInvalid';
    return res.status(500).json({ error: req.t(key) });
  }
  return res.status(500).json({ error: error.message || req.t(fallbackKey) });
};

// ── POST /api/ai/chat ───────────────────────────────────────────────────────
router.post('/chat', authMiddleware, validateBody(aiChatSchema), async (req, res) => {
  try {
    const { messages, context } = req.body;

    // Pobierz kontekst z bazy danych
    let dbContext = '';
    try {
      const [tasksRes, teamsRes] = await Promise.all([
        pool.query(`SELECT status, COUNT(*) as count FROM tasks GROUP BY status`),
        pool.query(`SELECT t.nazwa, COUNT(tm.user_id) as czlonkowie FROM teams t LEFT JOIN team_members tm ON tm.team_id = t.id GROUP BY t.id, t.nazwa LIMIT 10`),
      ]);

      const taskStats = tasksRes.rows.map(r => `${r.status}: ${r.count}`).join(', ');
      const teams = teamsRes.rows.map(r => `${r.nazwa} (${r.czlonkowie} os.)`).join(', ');

      dbContext = `\n\n--- Dane z systemu (aktualne) ---\nZlecenia: ${taskStats}\nEkipy: ${teams}\nZalogowany użytkownik: ${req.user.imie} ${req.user.nazwisko}, rola: ${req.user.rola}`;

      // Dodatkowy kontekst przekazany z frontendu (np. aktualna strona)
      if (context) dbContext += `\nKontekst strony: ${context}`;
    } catch (e) {
      logger.error('Blad pobierania kontekstu AI', { message: e.message, requestId: req.requestId });
    }

    const systemWithContext = SYSTEM_PROMPT + dbContext;

    // Konwertuj wiadomosci do wspolnego formatu providerow.
    const anthropicMessages = messages.map(m => ({
      role: m.role === 'user' ? 'user' : 'assistant',
      content: m.content,
    }));

    const aiResult = await generateAiText({
      system: systemWithContext,
      messages: anthropicMessages,
      maxTokens: 1024,
    });

    res.json({ reply: aiResult.text, provider: aiResult.provider, model: aiResult.model });
  } catch (e) {
    logger.error('AI chat error', { message: e.message, requestId: req.requestId });
    return sendAiError(req, res, e, 'errors.ai.genericAi');
  }
});

// ── POST /api/ai/analyze-photo ─────────────────────────────────────────────
// Analizuje zdjęcie terenu i sugeruje zakres prac + cenę
router.post('/analyze-photo', authMiddleware, validateBody(aiPhotoSchema), async (req, res) => {
  try {
    const { imageBase64, mediaType = 'image/jpeg', adres, miasto } = req.body;

    const lokalizacja = [adres, miasto].filter(Boolean).join(', ');

    const prompt = `Analizujesz zdjęcie terenu dla firmy arborystycznej${lokalizacja ? ` przy ${lokalizacja}` : ''}.

Na podstawie zdjęcia określ:
1. **Rodzaj prac** (wycinka, pielęgnacja, frezowanie pniaków, karczowanie, itp.)
2. **Zakres i trudność** (wielkość drzew, dostęp, ryzyko)
3. **Szacunkowy czas** realizacji (w godzinach)
4. **Szacunkowa cena** (PLN) — orientacyjnie dla firmy w Polsce
5. **Zalecenia** (sprzęt, ekipa, uwagi bezpieczeństwa)

Odpowiedz po polsku, konkretnie i zwięźle. Format JSON:
{
  "typ_uslugi": "nazwa głównej usługi",
  "opis_zakresu": "2-3 zdania opisu",
  "trudnosc": "niska|srednia|wysoka",
  "czas_godziny": liczba,
  "cena_min": liczba,
  "cena_max": liczba,
  "zalecenia": "krótkie uwagi"
}`;

    const anthropicMessages = [{
      role: 'user',
      content: [
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: mediaType,
            data: imageBase64,
          },
        },
        { type: 'text', text: prompt },
      ],
    }];
    const huggingFaceMessages = [{
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: `data:${mediaType};base64,${imageBase64}` } },
      ],
    }];

    const aiResult = await generateAiText({
      messages: anthropicMessages,
      huggingFaceMessages,
      maxTokens: 800,
      requiresVision: true,
    });

    const text = aiResult.text;

    // Spróbuj sparsować JSON z odpowiedzi
    let parsed = null;
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
    } catch { /* zostaw parsed = null */ }

    res.json({ raw: text, parsed, provider: aiResult.provider, model: aiResult.model });
  } catch (e) {
    logger.error('AI photo error', { message: e.message, requestId: req.requestId });
    return sendAiError(req, res, e, 'errors.ai.imageAnalysisFailed');
  }
});

router.post('/today-plan', authMiddleware, validateBody(aiTodayPlanSchema), async (req, res) => {
  try {
    const horizon = Number(req.body.horizon_days || 3);
    const oddzialId = req.user.rola === 'Kierownik' ? req.user.oddzial_id : null;
    const params = [];
    const where = [];
    if (oddzialId) {
      params.push(oddzialId);
      where.push(`oddzial_id = $${params.length}`);
    }
    const scope = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const [overdueRes, todayRes, reportsRes] = await Promise.all([
      pool.query(
        `SELECT id, klient_nazwa, status, data_planowana
         FROM tasks
         ${scope ? `${scope} AND` : 'WHERE'} status NOT IN ('Zakonczone') AND data_planowana < NOW()
         ORDER BY data_planowana ASC
         LIMIT 8`,
        params
      ),
      pool.query(
        `SELECT id, klient_nazwa, status, data_planowana
         FROM tasks
         ${scope ? `${scope} AND` : 'WHERE'} data_planowana::date <= CURRENT_DATE + $${params.length + 1}::int
         ORDER BY data_planowana ASC
         LIMIT 12`,
        [...params, horizon]
      ),
      pool.query(
        `SELECT COUNT(*)::int AS draft_reports
         FROM daily_reports
         ${scope ? `${scope} AND` : 'WHERE'} status = 'Roboczy'`,
        params
      ),
    ]);

    const deterministicPlan = [
      {
        priority: 'high',
        title: 'Domknij zaległe zlecenia',
        rationale: `Zaległe zlecenia: ${overdueRes.rows.length}.`,
        suggested_action: 'Przypisz zasoby do najstarszych 2 pozycji i potwierdź klientom nowy termin.',
        risk: overdueRes.rows.length > 3 ? 'high' : 'medium',
      },
      {
        priority: 'medium',
        title: 'Zamknij raporty robocze',
        rationale: `Raporty robocze: ${reportsRes.rows[0]?.draft_reports || 0}.`,
        suggested_action: 'Wymuś wysyłkę raportów z ostatnich 24h i uzupełnij braki podpisów.',
        risk: 'medium',
      },
    ];

    if (!getAiConfigurationStatus().textAvailable) {
      return res.json({
        source: 'rules',
        horizon_days: horizon,
        tasks_considered: todayRes.rows.length,
        overdue: overdueRes.rows,
        recommendations: deterministicPlan,
      });
    }

    const prompt = `Zbuduj plan dnia dla menedzera operacyjnego ARBOR-OS.
Mamy dane:
- Zalegle zlecenia: ${JSON.stringify(overdueRes.rows)}
- Zlecenia na najblizsze ${horizon} dni: ${JSON.stringify(todayRes.rows)}
- Raporty robocze: ${reportsRes.rows[0]?.draft_reports || 0}

Zwroc JSON:
{"recommendations":[{"priority":"high|medium|low","title":"...","rationale":"...","suggested_action":"...","risk":"high|medium|low"}]}
Maksymalnie 5 rekomendacji, konkretnie, po polsku.`;

    try {
      const aiResult = await generateAiText({
        messages: [{ role: 'user', content: prompt }],
        maxTokens: 900,
      });
      const raw = aiResult.text || '';
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      let parsed = null;
      if (jsonMatch) {
        try {
          parsed = JSON.parse(jsonMatch[0]);
        } catch {
          parsed = null;
        }
      }

      return res.json({
        source: 'ai',
        provider: aiResult.provider,
        model: aiResult.model,
        horizon_days: horizon,
        tasks_considered: todayRes.rows.length,
        overdue: overdueRes.rows,
        recommendations: parsed?.recommendations || deterministicPlan,
        raw,
      });
    } catch (aiError) {
      logger.warn('AI today-plan provider failed; using rules', {
        message: aiError.message,
        provider: aiError.provider,
        requestId: req.requestId,
      });
      return res.json({
        source: 'rules',
        provider_error: true,
        horizon_days: horizon,
        tasks_considered: todayRes.rows.length,
        overdue: overdueRes.rows,
        recommendations: deterministicPlan,
      });
    }
  } catch (e) {
    logger.error('AI today-plan error', { message: e.message, requestId: req.requestId });
    res.status(500).json({ error: e.message || req.t('errors.ai.genericAi') });
  }
});

module.exports = router;
