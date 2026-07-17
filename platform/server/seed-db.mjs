import { loadDb, resetDb } from './db.mjs';

// Bezpiecznik: seed ZASTĘPUJE całą bazę. Na niepustej bazie z realnymi danymi
// (produkcja) wymagamy jawnego ARBOR_FORCE_RESET=1, żeby literówka w komendzie
// nie skasowała danych firmy.
const force = process.env.ARBOR_FORCE_RESET === '1';
if (process.env.NODE_ENV === 'production' && !force) {
  const db = loadDb();
  const hasData = (db.orders ?? []).length || (db.clients ?? []).length || (db.invoices ?? []).length;
  if (hasData) {
    console.error('[seed] ODMOWA: produkcyjna baza zawiera dane (zlecenia/klienci/faktury).');
    console.error('[seed] Seed zastępuje CAŁĄ bazę. Jeśli na pewno tego chcesz: ARBOR_FORCE_RESET=1.');
    process.exit(1);
  }
}

// resetDb() jest synchroniczne dla SQLite i asynchroniczne dla PostgreSQL — await działa dla obu.
await resetDb();
const mode = process.env.NODE_ENV !== 'production' || process.env.ARBOR_SEED_DEMO === '1' ? 'demo' : 'produkcyjny (minimalny)';
console.log(`Database seeded (${process.env.DB_DRIVER || 'sqlite'}, seed ${mode}).`);
