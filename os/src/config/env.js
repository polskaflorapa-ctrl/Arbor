require('dotenv').config();
const { z } = require('zod');

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  JWT_SECRET: z.string().optional(),
  DATABASE_URL: z.string().optional(),
  DB_HOST: z.string().optional(),
  DB_PORT: z.coerce.number().int().positive().optional(),
  DB_NAME: z.string().optional(),
  DB_USER: z.string().optional(),
  DB_PASSWORD: z.string().optional(),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_PHONE: z.string().optional(),
  /** Publiczny URL aplikacji (HTTPS), bez końcowego slasha — Twilio pobiera TwiML z /api/telefon/twiml/dial. Na Render: fallback z RENDER_EXTERNAL_URL. */
  PUBLIC_BASE_URL: z.preprocess((v) => {
    const manual = v != null && String(v).trim() !== '' ? String(v).trim().replace(/\/+$/, '') : '';
    if (manual) return manual;
    const render = process.env.RENDER_EXTERNAL_URL;
    if (render != null && String(render).trim() !== '') return String(render).trim().replace(/\/+$/, '');
    return undefined;
  }, z.string().optional()),
  SMTP_HOST: z.string().default('smtp.gmail.com'),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  /** Transkrypcja nagrań (OpenAI Whisper) — opcjonalnie; bez klucza status `needs_transcription` */
  OPENAI_API_KEY: z.string().optional(),
  /** Dev/test: pomiń walidację podpisu Twilio na webhookach (nie używaj w produkcji) */
  TWILIO_SKIP_SIGNATURE_VALIDATION: z
    .string()
    .optional()
    .default('false')
    .transform((s) => s === 'true' || s === '1'),
  PHONE_RECORDING_STORAGE: z
    .string()
    .optional()
    .transform((s) => {
      const v = (s || 'local').trim().toLowerCase();
      if (['none', 'local', 's3', 'gdrive'].includes(v)) return v;
      return 'local';
    }),
  PHONE_RECORDINGS_DIR: z.string().optional(),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_ENDPOINT: z.string().optional(),
  S3_PUBLIC_BASE_URL: z.string().optional(),
  S3_FORCE_PATH_STYLE: z
    .string()
    .optional()
    .default('false')
    .transform((s) => s === 'true' || s === '1'),
  GOOGLE_SERVICE_ACCOUNT_JSON: z.string().optional(),
  GOOGLE_DRIVE_FOLDER_ID: z.string().optional(),
  CORS_ORIGINS: z.string().optional(),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().optional(),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().optional(),
  METRICS_ENABLED: z
    .string()
    .optional()
    .default('false')
    .transform((s) => s === 'true' || s === '1'),
  WEBHOOK_URL: z
    .preprocess((v) => (v != null && String(v).trim() !== '' ? String(v).trim() : undefined), z.string().optional()),
  JUWENTUS_GPS_API_URL: z
    .preprocess((v) => (v != null && String(v).trim() !== '' ? String(v).trim() : undefined), z.string().optional()),
  JUWENTUS_GPS_API_TOKEN: z
    .preprocess((v) => (v != null && String(v).trim() !== '' ? String(v).trim() : undefined), z.string().optional()),
  /** Sekret webhooka Kommo → lead „Do wyceny” (POST /api/webhooks/kommo/quotation-lead) */
  KOMMO_QUOTATION_WEBHOOK_SECRET: z.string().optional(),
  /** Cron: GET /api/ops/quotation-sla-tick?secret=… */
  OPS_CRON_SECRET: z.string().optional(),
  /** F11.8 — opcjonalnie Bearer do Expo Push API (wyższe limity); https://expo.dev/accounts/[account]/settings/access-tokens */
  EXPO_ACCESS_TOKEN: z.string().optional(),
  /** F11.8 — `0` / `false` wyłącza wysyłkę push przy zatwierdzeniu raportu dnia (in-app zostaje) */
  PAYROLL_PUSH_ENABLED: z
    .string()
    .optional()
    .default('1')
    .transform((s) => !(s === '0' || s === 'false' || s === 'off')),
  /** F11.7 — HMAC-SHA256 kanonicznego JSON manifestu w ZIP (`payroll_*_manifest.json`) */
  PAYROLL_ZIP_MANIFEST_HMAC_SECRET: z
    .preprocess((v) => (v != null && String(v).trim() !== '' ? String(v).trim() : undefined), z.string().optional()),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const missing = parsed.error.issues.map((issue) => issue.path.join('.')).join(', ');
  throw new Error(`Niepoprawna konfiguracja srodowiska: ${missing}`);
}

const env = parsed.data;

if (!env.JWT_SECRET) {
  if (env.NODE_ENV === 'production') {
    throw new Error('Niepoprawna konfiguracja srodowiska: JWT_SECRET');
  }
  env.JWT_SECRET = 'dev-insecure-secret';
}

module.exports = { env };
