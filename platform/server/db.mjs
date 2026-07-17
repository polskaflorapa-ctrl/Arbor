// Wybór sterownika bazy danych w runtime.
// Domyślnie SQLite (node:sqlite). Ustaw DB_DRIVER=postgres (+ DATABASE_URL=postgresql://...),
// aby przełączyć aplikację na PostgreSQL — bez zmian w kodzie modułów biznesowych.
const driver = (process.env.DB_DRIVER || 'sqlite').toLowerCase();
const isPostgres = driver === 'postgres' || driver === 'postgresql' || driver === 'pg';

const mod = isPostgres
  ? await import('./postgres-db.mjs')
  : await import('./sqlite-db.mjs');

console.log(`[db] sterownik: ${isPostgres ? 'PostgreSQL' : 'SQLite'}`);

export const loadDb = mod.loadDb;
export const saveDb = mod.saveDb;
export const resetDb = mod.resetDb;
export const ensureSeeded = mod.ensureSeeded ?? (() => {});
