// Bezpieczeństwo / RODO dla Arbor OS.
//  - encryptField/decryptField: szyfrowanie at-rest (AES-256-GCM) dla danych wrażliwych
//    (nagrania, dokumenty pracowników) — klucz z ARBOR_ENCRYPTION_KEY (fallback do JWT secret).
//  - pseudonymizeTranscript: usuwa PII (telefony, e-maile, nazwy/adresy klientów) z transkryptu
//    PRZED wysłaniem do zewnętrznego LLM (wymóg RODO z ANALIZA-ROZMOW-AI.md).
//  - applyRetention: czyści dane starsze niż okno retencji (audyt, powiadomienia, outbox).
import { createCipheriv, createDecipheriv, randomBytes, createHash, scryptSync } from 'node:crypto';

const RAW_KEY = process.env.ARBOR_ENCRYPTION_KEY || process.env.ARBOR_JWT_SECRET || 'dev-only-arbor-secret-change-me';
// Stabilny klucz 32-bajtowy wyprowadzony z sekretu (działa nawet dla krótkich sekretów).
const KEY = createHash('sha256').update(RAW_KEY).digest();
const PREFIX = 'enc:v1';

// Hasła: scrypt z losową solą, format `scrypt:<salt b64url>:<hash b64url>`.
// Współdzielone przez serwer (index.mjs) i seed (bootstrap haseł z env przy wdrożeniu).
export function hashPassword(password) {
  const salt = randomBytes(16).toString('base64url');
  const hash = scryptSync(String(password), salt, 32).toString('base64url');
  return `scrypt:${salt}:${hash}`;
}

// Szyfruje string. Format: enc:v1.<iv b64>.<tag b64>.<ciphertext b64>
export function encryptField(plaintext) {
  if (plaintext == null) return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', KEY, iv);
  const enc = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [PREFIX, iv.toString('base64'), tag.toString('base64'), enc.toString('base64')].join('.');
}

// Odszyfrowuje. Wartości niezaszyfrowane zwraca bez zmian (kompatybilność wstecz).
export function decryptField(payload) {
  if (typeof payload !== 'string' || !payload.startsWith(PREFIX + '.')) return payload;
  try {
    const [, ivB, tagB, dataB] = payload.split('.');
    const decipher = createDecipheriv('aes-256-gcm', KEY, Buffer.from(ivB, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(dataB, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Pseudonimizacja transkryptu przed wysłaniem do zewnętrznego LLM (RODO).
// Zamienia e-maile, telefony oraz znane nazwy i adresy klientów na placeholdery.
export function pseudonymizeTranscript(text, clients = []) {
  let out = String(text ?? '');
  // znane dane klientów najpierw (dłuższe → krótsze, by nie ciąć fragmentów)
  const named = (Array.isArray(clients) ? clients : [])
    .flatMap((c) => [
      c?.name && c.name.length > 2 ? { v: c.name, r: '[KLIENT]' } : null,
      c?.address && c.address.length > 4 ? { v: c.address, r: '[ADRES]' } : null,
      c?.email ? { v: c.email, r: '[EMAIL]' } : null,
      c?.phone ? { v: c.phone, r: '[TELEFON]' } : null,
    ])
    .filter(Boolean)
    .sort((a, b) => b.v.length - a.v.length);
  for (const { v, r } of named) out = out.replace(new RegExp(escapeRegExp(v), 'gi'), r);
  // ogólne wzorce
  out = out.replace(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi, '[EMAIL]');
  out = out.replace(/(?:\+?\d[\d\s-]{7,}\d)/g, '[TELEFON]');
  return out;
}

// Czyści dane starsze niż okno retencji. Zwraca liczby usuniętych wpisów.
export function applyRetention(db, days = Number(process.env.ARBOR_RETENTION_DAYS || 90)) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const old = (iso) => { const t = Date.parse(iso); return Number.isFinite(t) && t < cutoff; };
  const counts = { auditEvents: 0, notifications: 0, outbox: 0 };
  if (Array.isArray(db.auditEvents)) {
    const before = db.auditEvents.length;
    db.auditEvents = db.auditEvents.filter((e) => !old(e.at));
    counts.auditEvents = before - db.auditEvents.length;
  }
  if (Array.isArray(db.notifications)) {
    const before = db.notifications.length;
    db.notifications = db.notifications.filter((n) => !old(n.createdAt));
    counts.notifications = before - db.notifications.length;
  }
  if (Array.isArray(db.outbox)) {
    const before = db.outbox.length;
    db.outbox = db.outbox.filter((o) => !old(o.createdAt));
    counts.outbox = before - db.outbox.length;
  }
  // Nagrania/transkrypty rozmów: deklarowana klientom retencja (RECORDING_RETENTION_DAYS,
  // domyślnie 90 dni) musi być faktycznie egzekwowana — anonimizujemy pola wrażliwe,
  // metadane rozmowy (kto/kiedy/status) zostają dla ciągłości CRM.
  const recordingDays = Number(process.env.RECORDING_RETENTION_DAYS || days);
  const recordingCutoff = Date.now() - recordingDays * 24 * 60 * 60 * 1000;
  const oldRecording = (iso) => { const t = Date.parse(iso); return Number.isFinite(t) && t < recordingCutoff; };
  counts.communicationRecordings = 0;
  if (Array.isArray(db.communications)) {
    for (const comm of db.communications) {
      if (!oldRecording(comm.createdAt ?? comm.at)) continue;
      if (comm.transcript == null && comm.recordingUrl == null && comm.recordingId == null && comm.analysis == null) continue;
      comm.transcript = null;
      comm.recordingUrl = null;
      comm.recordingId = null;
      comm.analysis = null;
      comm.retentionAppliedAt = new Date().toISOString();
      counts.communicationRecordings += 1;
    }
  }
  return counts;
}
