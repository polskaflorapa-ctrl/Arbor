const PDFDocument = require('pdfkit');

const formatDate = (d) => {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleDateString('pl-PL');
  } catch {
    return '—';
  }
};

const formatDt = () =>
  new Date().toLocaleString('pl-PL', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });

function parseTowary(c) {
  const t = c.towary;
  if (Array.isArray(t)) return t;
  if (typeof t === 'string') {
    try {
      const p = JSON.parse(t);
      return Array.isArray(p) ? p : [];
    } catch {
      return [];
    }
  }
  return [];
}

function parsePlat(c) {
  const p = c.platnosci;
  if (p && typeof p === 'object' && !Array.isArray(p)) return p;
  if (typeof p === 'string') {
    try {
      const o = JSON.parse(p);
      return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
    } catch {
      return {};
    }
  }
  return {};
}

/**
 * @param {object} c — wiersz CMR (po enrich), pola jak w OS
 * @returns {Promise<Buffer>}
 */
function buildCmrPdfBuffer(c) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    doc.on('data', (d) => chunks.push(d));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const towary = parseTowary(c);
    const plat = parsePlat(c);
    const platTxt = Object.entries(plat)
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}: ${v}`)
      .join('   ');

    doc.fontSize(14).fillColor('#111').font('Helvetica-Bold').text('Lista przewozowa (CMR)', { align: 'center' });
    doc.fontSize(10).font('Helvetica').fillColor('#4B5563').text(`Numer: ${c.numer || '—'}   Status: ${c.status || '—'}`, { align: 'center' });
    doc.fontSize(8).fillColor('#6B7280').text(`Wygenerowano: ${formatDt()}`, { align: 'center' });
    doc.moveDown(1);

    doc.fontSize(9).font('Helvetica-Bold').text('Nadawca');
    doc.font('Helvetica').fontSize(8).fillColor('#374151');
    doc.text(c.nadawca_nazwa || '—');
    doc.text(c.nadawca_adres || '—');
    doc.text(`Kraj: ${c.nadawca_kraj || 'PL'}`);
    doc.moveDown(0.5);

    doc.font('Helvetica-Bold').fontSize(9).text('Odbiorca');
    doc.font('Helvetica').fontSize(8);
    doc.text(c.odbiorca_nazwa || '—');
    doc.text(c.odbiorca_adres || '—');
    doc.text(`Kraj: ${c.odbiorca_kraj || 'PL'}`);
    doc.moveDown(0.5);

    doc.font('Helvetica-Bold').fontSize(9).text('Załadunek / rozładunek');
    doc.font('Helvetica').fontSize(8);
    doc.text(`Miejsce załadunku: ${c.miejsce_zaladunku || '—'}`);
    doc.text(`Miejsce rozładunku: ${c.miejsce_rozladunku || '—'}`);
    doc.text(`Data załadunku: ${formatDate(c.data_zaladunku)}   Data rozładunku: ${formatDate(c.data_rozladunku)}`);
    doc.moveDown(0.5);

    doc.font('Helvetica-Bold').fontSize(9).text('Zlecenie / pojazd');
    doc.font('Helvetica').fontSize(8);
    doc.text(`Zlecenie #${c.task_id || '—'}   Klient: ${c.task_klient_nazwa || '—'}`);
    doc.text(`Nr rej.: ${c.nr_rejestracyjny || c.pojazd_nr_rejestracyjny || '—'}   Naczepa: ${c.nr_naczepy || '—'}   Kierowca: ${c.kierowca || '—'}`);
    doc.moveDown(0.5);

    doc.font('Helvetica-Bold').fontSize(9).text('Przewoźnik');
    doc.font('Helvetica').fontSize(8);
    doc.text(c.przewoznik_nazwa || '—');
    doc.text(c.przewoznik_adres || '—');
    doc.text(`Kraj: ${c.przewoznik_kraj || '—'}`);
    if (c.kolejni_przewoznicy) {
      doc.moveDown(0.3);
      doc.font('Helvetica-Bold').text('Kolejni przewoźnicy');
      doc.font('Helvetica').text(c.kolejni_przewoznicy);
    }
    doc.moveDown(0.5);

    doc.font('Helvetica-Bold').fontSize(9).text('Towary');
    doc.font('Helvetica').fontSize(8);
    (towary.length ? towary : [{}]).forEach((row, i) => {
      doc.text(
        `${i + 1}. ${row.nazwa || row.znak || '—'} | ilość: ${row.ilosc ?? '—'} | opak.: ${row.opakowanie ?? '—'} | masa: ${row.masa_kg ?? '—'} kg | m³: ${row.objetosc_m3 ?? '—'}`
      );
    });
    doc.moveDown(0.5);

    doc.font('Helvetica-Bold').fontSize(9).text('Instrukcje / umowy / uwagi');
    doc.font('Helvetica').fontSize(8);
    doc.text(`Instrukcje nadawcy: ${c.instrukcje_nadawcy || '—'}`);
    doc.text(`Umowy szczególne: ${c.umowy_szczegolne || '—'}`);
    doc.text(`Uwagi (celne): ${c.uwagi_do_celnych || '—'}`);
    doc.text(`Załączniki: ${c.zalaczniki || '—'}`);
    if (platTxt) {
      doc.moveDown(0.3);
      doc.text(`Płatności: ${platTxt}`);
    }
    doc.moveDown(0.8);
    doc.fontSize(7).fillColor('#9CA3AF').text('ARBOR (wersja demonstracyjna / lokalna) — uzupełnij formalny dokument CMR wg konwencji przy transporcie międzynarodowym.', {
      align: 'center',
    });
    doc.end();
  });
}

module.exports = { buildCmrPdfBuffer };
