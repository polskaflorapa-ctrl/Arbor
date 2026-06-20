const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function read(file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

function assertIncludes(file, needles) {
  const text = read(file);
  const missing = needles.filter((needle) => !text.includes(needle));
  if (missing.length) throw new Error(`${file} missing: ${missing.join(', ')}`);
}

assertIncludes('os/src/routes/flota.js', [
  "router.get('/rezerwacje'",
  "router.post('/rezerwacje'",
  "'/rezerwacje/:id/status'",
  "status: z.enum(['Zarezerwowane', 'Wydane', 'Zwrócone', 'Anulowane'])",
  'res.status(201).json({ id: ins.rows[0].id })',
  'rezerwacja_kolizja_sprzet',
  'brak_dostepu_oddzial',
]);

assertIncludes('os/tests/flota-rezerwacje.test.js', [
  'returns 401 without auth for GET',
  'POST requires explicit reservation status for mobile contract',
  'POST returns 409 on overlapping active reservation',
  'POST inserts and returns id',
  'expect(res.status).toBe(201)',
  'PUT status applies branch filter for Kierownik',
]);

assertIncludes('mobile/utils/sprzet-rezerwacje.ts', [
  "REZERWACJA_STATUSY = ['Zarezerwowane', 'Wydane', 'Zwrócone', 'Anulowane']",
  "`${API_URL}/flota/rezerwacje?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`",
  'status: RezerwacjaStatus;',
  "method: 'POST'",
  "method: 'PUT'",
  'notImplemented: true',
]);

assertIncludes('mobile/docs/checklist-rezerwacje.md', [
  '- [x] Tabela (lub kolekcja) z polami zgodnymi z mobile',
  '- [x] Statusy dokladnie jak w aplikacji',
  '- [x] Query: `from`, `to` w formacie `YYYY-MM-DD`',
  '- [x] Odpowiedz: **tablica** JSON',
  '- [x] `POST /flota/rezerwacje` oraz `PUT /flota/rezerwacje/:id/status`',
  '`npm run verify:mobile-reservations-api`',
]);

assertIncludes('docs/PILOT-ONE-BRANCH-CHECKLIST.md', [
  'verify:mobile-reservations-api',
  'rezerwacje sprzetu mobile/API',
]);

assertIncludes('package.json', [
  'verify:mobile-reservations-api',
]);

console.log('mobile reservations API contract check passed');
