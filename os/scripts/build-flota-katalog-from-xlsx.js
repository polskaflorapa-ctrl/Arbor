/**
 * Buduje data/flota-pojazdy-katalog.json z pliku Excel (arkusze = oddziały / lokalizacje).
 * Użycie: node scripts/build-flota-katalog-from-xlsx.js "C:/ścieżka/Данные по машинам.xlsx"
 */
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const xlsxPath = process.argv[2] || path.join(__dirname, '..', '..', 'Downloads', 'Данные по машинам.xlsx');

function parseMarkaModel(str) {
  const s = String(str || '')
    .trim()
    .replace(/\s+/g, ' ');
  if (!s) return { marka: '?', model: '-' };
  const parts = s.split(' ');
  if (parts.length === 1) return { marka: parts[0], model: '-' };
  return { marka: parts[0], model: parts.slice(1).join(' ').trim() || '-' };
}

function main() {
  if (!fs.existsSync(xlsxPath)) {
    console.error('Brak pliku:', xlsxPath);
    process.exit(1);
  }
  const wb = XLSX.readFile(xlsxPath);
  const byPlate = new Map();

  for (const arkusz of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[arkusz], { header: 1, defval: '' });
    for (let i = 2; i < rows.length; i++) {
      const r = rows[i];
      const plate = String(r[2] || '')
        .trim()
        .replace(/\s+/g, ' ')
        .toUpperCase();
      if (!plate) continue;
      const { marka, model } = parseMarkaModel(r[1]);
      const vin = r[3] !== '' && r[3] != null ? String(r[3]).trim() : null;
      const notatki = String(r[5] || '').trim() || null;
      if (byPlate.has(plate)) continue;
      byPlate.set(plate, {
        arkusz,
        lp: r[0],
        marka,
        model,
        nr_rejestracyjny: plate,
        vin,
        notatki,
      });
    }
  }

  const items = [...byPlate.values()].sort((a, b) =>
    `${a.marka} ${a.model}`.localeCompare(`${b.marka} ${b.model}`, 'pl')
  );
  const outDir = path.join(__dirname, '..', 'data');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'flota-pojazdy-katalog.json');
  const payload = {
    zrodlo_pliku: path.basename(xlsxPath),
    wygenerowano: new Date().toISOString(),
    liczba: items.length,
    arkusze: [...new Set(items.map((i) => i.arkusz))].sort((a, b) => a.localeCompare(b, 'pl')),
    items,
  };
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf8');
  console.log('Zapisano', outPath, '—', items.length, 'pozycji');
}

main();
