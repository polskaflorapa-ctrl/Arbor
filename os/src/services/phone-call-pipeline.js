const pool = require('../config/database');
const logger = require('../config/logger');
const { env } = require('../config/env');
const Anthropic = require('@anthropic-ai/sdk');
const { persistPhoneRecording } = require('./phone-recording-storage');

let _tableEnsured = false;

async function ensurePhoneCallsTable() {
  if (_tableEnsured) return;
  _tableEnsured = true;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS phone_call_conversations (
      id SERIAL PRIMARY KEY,
      twilio_call_sid VARCHAR(64) UNIQUE NOT NULL,
      twilio_recording_sid VARCHAR(64),
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
      staff_number VARCHAR(40),
      client_number VARCHAR(40),
      recording_url TEXT,
      recording_duration_sec INTEGER,
      recording_archive_backend VARCHAR(16),
      recording_archive_ref TEXT,
      recording_archive_url TEXT,
      transcript TEXT,
      raport TEXT,
      wskazowki_specjalisty TEXT,
      status VARCHAR(40) DEFAULT 'in_progress',
      error_message TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `).catch((e) => {
    if (e.code !== '42P07') throw e;
  });
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_phone_calls_user_created ON phone_call_conversations(user_id, created_at DESC)`
  ).catch(() => {});
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_phone_calls_task ON phone_call_conversations(task_id)`
  ).catch(() => {});
  const archiveAlters = [
    `ALTER TABLE phone_call_conversations ADD COLUMN IF NOT EXISTS recording_archive_backend VARCHAR(16)`,
    `ALTER TABLE phone_call_conversations ADD COLUMN IF NOT EXISTS recording_archive_ref TEXT`,
    `ALTER TABLE phone_call_conversations ADD COLUMN IF NOT EXISTS recording_archive_url TEXT`,
    `ALTER TABLE phone_call_conversations ADD COLUMN IF NOT EXISTS wskazowki_specjalisty TEXT`,
  ];
  for (const sql of archiveAlters) {
    await pool.query(sql).catch((e) => {
      if (e.code !== '42701') throw e;
    });
  }
}

/**
 * Zapis / aktualizacja wiersza po odebraniu TwiML (mamy CallSid).
 */
async function upsertCallLegFromTwiml({ callSid, userId, taskId, staffNumber, clientNumber }) {
  await ensurePhoneCallsTable();
  await pool.query(
    `INSERT INTO phone_call_conversations (
      twilio_call_sid, user_id, task_id, staff_number, client_number, status, updated_at
    ) VALUES ($1, $2, $3, $4, $5, 'in_progress', NOW())
    ON CONFLICT (twilio_call_sid) DO UPDATE SET
      user_id = COALESCE(phone_call_conversations.user_id, EXCLUDED.user_id),
      task_id = COALESCE(phone_call_conversations.task_id, EXCLUDED.task_id),
      staff_number = COALESCE(NULLIF(EXCLUDED.staff_number, ''), phone_call_conversations.staff_number),
      client_number = COALESCE(NULLIF(EXCLUDED.client_number, ''), phone_call_conversations.client_number),
      updated_at = NOW()`,
    [callSid, userId || null, taskId || null, staffNumber || null, clientNumber || null]
  );
}

/**
 * Po zakończeniu nagrania — aktualizacja URL i asynchroniczna obróbka.
 */
async function markRecordingReady({ callSid, recordingSid, recordingUrl, durationSec }) {
  await ensurePhoneCallsTable();
  const dur = durationSec != null && durationSec !== '' ? parseInt(String(durationSec), 10) : null;
  const d = Number.isFinite(dur) ? dur : null;
  await pool.query(
    `INSERT INTO phone_call_conversations (
      twilio_call_sid, twilio_recording_sid, recording_url, recording_duration_sec, status, updated_at
    ) VALUES ($1, $2, $3, $4, 'recording_ready', NOW())
    ON CONFLICT (twilio_call_sid) DO UPDATE SET
      twilio_recording_sid = COALESCE(EXCLUDED.twilio_recording_sid, phone_call_conversations.twilio_recording_sid),
      recording_url = COALESCE(EXCLUDED.recording_url, phone_call_conversations.recording_url),
      recording_duration_sec = COALESCE(EXCLUDED.recording_duration_sec, phone_call_conversations.recording_duration_sec),
      status = 'recording_ready',
      error_message = NULL,
      updated_at = NOW()`,
    [callSid, recordingSid || null, recordingUrl || null, d]
  );
}

async function downloadTwilioRecording(recordingUrl) {
  const sid = env.TWILIO_ACCOUNT_SID;
  const token = env.TWILIO_AUTH_TOKEN;
  if (!sid || !token || !recordingUrl) throw new Error('Brak konfiguracji Twilio lub URL nagrania');
  const auth = Buffer.from(`${sid}:${token}`).toString('base64');
  const res = await fetch(recordingUrl, {
    headers: { Authorization: `Basic ${auth}` },
    redirect: 'follow',
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Pobieranie nagrania HTTP ${res.status}: ${t.slice(0, 200)}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const ct = res.headers.get('content-type') || 'audio/mpeg';
  return { buffer: buf, contentType: ct };
}

async function transcribeWithOpenAI(buffer, contentType) {
  if (!env.OPENAI_API_KEY) return null;
  const ext = contentType.includes('wav') ? 'wav' : contentType.includes('webm') ? 'webm' : 'mp3';
  const form = new FormData();
  form.append('model', 'whisper-1');
  form.append('language', 'pl');
  form.append('file', new Blob([buffer], { type: contentType || 'audio/mpeg' }), `recording.${ext}`);
  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` },
    body: form,
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Whisper HTTP ${res.status}: ${t.slice(0, 300)}`);
  }
  const data = await res.json();
  return typeof data.text === 'string' ? data.text : '';
}

/**
 * @returns {{ raport: string | null, wskazowki_specjalisty: string | null }}
 */
function parseAiConversationPayload(raw) {
  if (!raw || typeof raw !== 'string') return { raport: null, wskazowki_specjalisty: null };
  let cleaned = raw.trim();
  const fence = cleaned.match(/^```(?:json)?\s*([\s\S]*?)```$/im);
  if (fence) cleaned = fence[1].trim();
  try {
    const o = JSON.parse(cleaned);
    const raport = typeof o.raport === 'string' ? o.raport.trim() : null;
    const w = typeof o.wskazowki_specjalisty === 'string' ? o.wskazowki_specjalisty.trim() : '';
    return {
      raport: raport && raport.length ? raport : null,
      wskazowki_specjalisty: w.length ? w : null,
    };
  } catch {
    return { raport: cleaned.length ? cleaned.slice(0, 12000) : null, wskazowki_specjalisty: null };
  }
}

/**
 * Raport operacyjny + wskazówki coachingowe dla osoby prowadzącej rozmowy z klientem.
 * @returns {{ raport: string | null, wskazowki_specjalisty: string | null } | null}
 */
async function summarizeTranscriptPolish(transcript, meta) {
  if (!env.ANTHROPIC_API_KEY) return null;
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const clip = transcript.slice(0, 48000);
  const prompt = `Poniżej transkrypt rozmowy telefonicznej pracownika firmy usług arborystycznych z klientem (język polski).

Kontekst techniczny: numer klienta: ${meta.client_number || 'nieznany'}, CallSid: ${meta.call_sid || ''}.

--- TRANSSKRYPT ---
${clip || '(pusty)'}
---

Odpowiedz WYŁĄCZNIE jednym obiektem JSON (bez markdown, bez komentarzy przed/po), dokładnie w postaci:
{"raport":"...","wskazowki_specjalisty":"..."}

Zasady treści:
- "raport": zwięzły raport operacyjny (maks. ok. 900 znaków), pola: o czym rozmowa (1–2 zdania), ustalenia/obietnice, następne kroki lub braki informacji, ton i ewentualne ryzyko.
- "wskazowki_specjalisty": osobny tekst dla specjalisty, który rozmawia z klientami — konkretnie **na co zwracać uwagę przy kolejnych rozmowach** (maks. ok. 1400 znaków). Użyj numerowanych punktów lub krótkich akapitów; obejmij m.in.: co powiedzieć/zapytać lepiej, typowe błędy lub luki jeśli widać z transkryptu, sygnały napięcia lub niezdecydowania klienta, co poszło dobrze i warto powtórzyć, jedno zdanie „pamiętaj na następną rozmowę”.

Oba pola muszą być poprawnymi stringami JSON (znaki specjalne i cudzysłowy wewnątrz — escapuj według JSON).

Jeśli transkrypt jest pusty lub nieczytelny:
{"raport":"Transkrypt pusty lub nieczytelny — brak treści do analizy.","wskazowki_specjalisty":"Brak danych z rozmowy; przy kolejnej rozmowie upewnij się, że nagranie i mikrofon działają oraz że pytasz o konkretny zakres prac i termin."}`;

  const response = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 1600,
    messages: [{ role: 'user', content: prompt }],
  });
  const block = response.content?.[0];
  const text = block && block.type === 'text' ? block.text : null;
  if (!text) return null;
  return parseAiConversationPayload(text);
}

async function setStatusError(callSid, message) {
  await pool.query(
    `UPDATE phone_call_conversations SET status = 'error', error_message = $2, updated_at = NOW() WHERE twilio_call_sid = $1`,
    [callSid, message.slice(0, 2000)]
  );
}

/**
 * Pełna obróbka nagrania po webhooku Twilio (wywołaj z setImmediate).
 */
async function processRecordingPipeline(callSid) {
  await ensurePhoneCallsTable();
  const { rows } = await pool.query(
    `SELECT id, twilio_call_sid, twilio_recording_sid, recording_url, client_number FROM phone_call_conversations WHERE twilio_call_sid = $1`,
    [callSid]
  );
  if (!rows.length || !rows[0].recording_url) {
    logger.warn('phone-call-pipeline: brak wiersza lub URL nagrania', { callSid });
    return;
  }
  const row = rows[0];
  try {
    await pool.query(
      `UPDATE phone_call_conversations SET status = 'transcribing', updated_at = NOW() WHERE twilio_call_sid = $1`,
      [callSid]
    );

    const { buffer, contentType } = await downloadTwilioRecording(row.recording_url);

    try {
      const arch = await persistPhoneRecording({
        buffer,
        contentType,
        callSid,
        recordingSid: row.twilio_recording_sid || null,
      });
      if (arch) {
        await pool.query(
          `UPDATE phone_call_conversations SET
            recording_archive_backend = $1,
            recording_archive_ref = $2,
            recording_archive_url = $3,
            updated_at = NOW()
          WHERE twilio_call_sid = $4`,
          [arch.backend, arch.ref, arch.url, callSid]
        );
      }
    } catch (archErr) {
      logger.warn('Zapis archiwum nagrania nieudany', { callSid, message: archErr.message });
    }

    let transcript = null;
    if (env.OPENAI_API_KEY) {
      transcript = await transcribeWithOpenAI(buffer, contentType);
    }

    if (transcript == null) {
      await pool.query(
        `UPDATE phone_call_conversations SET
          transcript = NULL,
          raport = NULL,
          wskazowki_specjalisty = NULL,
          status = 'needs_transcription',
          error_message = 'Brak OPENAI_API_KEY — dodaj klucz aby uruchomic transkrypcje Whisper',
          updated_at = NOW()
        WHERE twilio_call_sid = $1`,
        [callSid]
      );
      return;
    }

    await pool.query(
      `UPDATE phone_call_conversations SET transcript = $2, status = 'transcribed', updated_at = NOW() WHERE twilio_call_sid = $1`,
      [callSid, transcript]
    );

    const summary = await summarizeTranscriptPolish(transcript, {
      client_number: row.client_number,
      call_sid: callSid,
    });

    if (summary && (summary.raport || summary.wskazowki_specjalisty)) {
      await pool.query(
        `UPDATE phone_call_conversations SET raport = $2, wskazowki_specjalisty = $3, status = 'analyzed', updated_at = NOW() WHERE twilio_call_sid = $1`,
        [callSid, summary.raport, summary.wskazowki_specjalisty]
      );
    } else {
      await pool.query(
        `UPDATE phone_call_conversations SET
          raport = NULL,
          wskazowki_specjalisty = NULL,
          status = 'transcribed',
          error_message = COALESCE(error_message, 'Brak ANTHROPIC_API_KEY — raport AI pominiety'),
          updated_at = NOW()
        WHERE twilio_call_sid = $1`,
        [callSid]
      );
    }
  } catch (e) {
    logger.error('phone-call-pipeline blad', { callSid, message: e.message });
    await setStatusError(callSid, e.message || 'Blad przetwarzania');
  }
}

module.exports = {
  ensurePhoneCallsTable,
  upsertCallLegFromTwiml,
  markRecordingReady,
  processRecordingPipeline,
};
