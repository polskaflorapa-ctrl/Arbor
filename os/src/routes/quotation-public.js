/**
 * Publiczne endpointy wyceny (akceptacja klienta — F1.12) bez JWT.
 *
 * GET  /quotations/:token         — brandowana strona oferty dla klienta (Polska Flora)
 * POST /quotations/:token/choice  — akceptacja / odrzucenie oferty
 */
const express = require('express');
const pool = require('../config/database');
const logger = require('../config/logger');
const { env } = require('../config/env');
const { postKommoWebhook, kommoWebhookConfigured } = require('../services/kommo');
const { validateBody, validateParams } = require('../middleware/validate');
const {
  quotationChoiceBodySchema,
  quotationTokenParamsSchema,
} = require('../schemas/quotation-public');

const router = express.Router();

// ─── Marka Polska Flora — kolory i dane z firmowej strony wycinka-drzewpl.pl ────
const BRAND = {
  name: 'Polska Flora',
  tagline: 'Profesjonalna pielęgnacja Twoich drzew',
  logoUrl: 'https://wycinka-drzewpl.pl/wp-content/uploads/2023/10/wycinka-drzewpl.png',
  phone: '+48 573-569-929',
  email: 'kontakt@wycinka-drzewpl.pl',
  site: 'wycinka-drzewpl.pl',
  // kolory marki (z firmowej strony)
  ink: '#2c2722',
  green: '#507d30',
  greenDeep: '#34501f',
  greenSoft: '#64b375',
  cream: '#f6f8f3',
  line: '#e2e8dc',
  muted: '#6b7a6f',
};

/** Znak firmowy — logo w białym kafelku (na stronie i ekranach statusu). */
function logoMark() {
  if (BRAND.logoUrl) {
    return `<span class="logo-chip"><img src="${escapeHtml(BRAND.logoUrl)}" alt="${escapeHtml(BRAND.name)}"/></span>`;
  }
  return `<span class="leaf">🌿</span>`;
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtMoney(n, { decimals = 0 } = {}) {
  if (n == null || n === '' || Number.isNaN(Number(n))) return '—';
  return Number(n).toLocaleString('pl-PL', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function fmtDate(d) {
  if (!d) return '';
  try {
    return new Date(d).toLocaleDateString('pl-PL', { year: 'numeric', month: '2-digit', day: '2-digit' });
  } catch {
    return String(d).slice(0, 10);
  }
}

function absUrl(u, base) {
  if (!u) return '';
  const s = String(u);
  if (s.startsWith('http')) return s;
  return base ? `${base}${s}` : s;
}

/** Wspólny <head> + style dla wszystkich stron oferty. */
function pageHead(title) {
  return `<!DOCTYPE html><html lang="pl"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,shrink-to-fit=no"/>
<meta name="robots" content="noindex,nofollow"/>
<title>${escapeHtml(title)}</title>
<style>
  :root{
    --ink:${BRAND.ink}; --green:${BRAND.green}; --green-deep:${BRAND.greenDeep};
    --green-soft:${BRAND.greenSoft}; --cream:${BRAND.cream}; --line:${BRAND.line}; --muted:${BRAND.muted};
  }
  *{box-sizing:border-box}
  body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
    color:var(--ink);background:var(--cream);-webkit-font-smoothing:antialiased;line-height:1.5}
  a{color:inherit}
  .wrap{max-width:680px;margin:0 auto;padding:0 18px}
  .brandbar{display:flex;align-items:center;gap:10px;font-weight:800;letter-spacing:-.02em}
  .leaf{width:30px;height:30px;border-radius:9px;background:var(--green-soft);display:flex;
    align-items:center;justify-content:center;color:#fff;font-size:17px}
  .logo-chip{background:#fff;border-radius:10px;padding:5px 8px;display:inline-flex;align-items:center;
    box-shadow:0 2px 8px rgba(0,0,0,.12)}
  .logo-chip img{height:30px;width:auto;display:block}
  /* HERO */
  .hero{background:linear-gradient(160deg,var(--green-deep),var(--green));color:#fff;
    padding:26px 0 34px;border-radius:0 0 26px 26px}
  .hero h1{font-size:26px;line-height:1.15;margin:18px 0 6px;letter-spacing:-.02em}
  .hero .sub{opacity:.85;font-size:14px;margin:0 0 22px}
  .stats{display:grid;grid-template-columns:1fr 1fr;gap:10px}
  .stat{background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.18);
    border-radius:14px;padding:12px 14px}
  .stat .k{font-size:11px;text-transform:uppercase;letter-spacing:.04em;opacity:.8}
  .stat .v{font-size:17px;font-weight:700;margin-top:2px}
  .stat.full{grid-column:1 / -1}
  /* SECTIONS */
  section{padding:26px 0}
  h2{font-size:20px;letter-spacing:-.02em;margin:0 0 14px}
  h2 small{display:block;font-size:13px;font-weight:500;color:var(--green);margin-bottom:2px;
    text-transform:uppercase;letter-spacing:.05em}
  /* PHOTOS */
  .gallery{display:flex;gap:10px;overflow-x:auto;padding-bottom:6px;-webkit-overflow-scrolling:touch}
  .gallery img{height:150px;border-radius:14px;object-fit:cover;flex:0 0 auto;border:1px solid var(--line)}
  /* ITEMS */
  .item{background:#fff;border:1px solid var(--line);border-radius:16px;padding:16px;margin-bottom:12px;
    box-shadow:0 1px 2px rgba(15,61,32,.04)}
  .item-top{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}
  .item-name{font-weight:700;font-size:16px}
  .item-price{font-weight:800;color:var(--green);white-space:nowrap;font-size:16px}
  .chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}
  .chip{font-size:12px;background:var(--cream);border:1px solid var(--line);border-radius:999px;
    padding:4px 10px;color:var(--muted)}
  /* PRICE CARD */
  .price-card{background:var(--green-deep);color:#fff;border-radius:20px;padding:22px;text-align:center}
  .price-card .label{opacity:.8;font-size:13px;text-transform:uppercase;letter-spacing:.05em}
  .price-card .big{font-size:40px;font-weight:800;letter-spacing:-.02em;margin:6px 0 2px}
  .price-card .note{opacity:.78;font-size:13px;margin-top:8px}
  /* STEPS */
  .step{display:flex;gap:14px;align-items:flex-start;margin-bottom:16px}
  .step .n{flex:0 0 auto;width:30px;height:30px;border-radius:50%;background:var(--green-soft);color:#fff;
    display:flex;align-items:center;justify-content:center;font-weight:800;font-size:14px}
  .step .t{font-weight:700}
  .step .d{font-size:14px;color:var(--muted)}
  /* CONTACT */
  .contact{background:#fff;border:1px solid var(--line);border-radius:18px;padding:20px}
  .contact .row{display:flex;justify-content:space-between;gap:12px;padding:9px 0;border-top:1px solid var(--line);font-size:14px}
  .contact .row:first-child{border-top:0}
  .contact .row .k{color:var(--muted)}
  .contact .row .v{font-weight:700;text-align:right}
  /* CTA / FORM */
  .actions{display:grid;gap:12px;margin:8px 0 4px}
  .btn{display:block;width:100%;text-align:center;padding:16px;border-radius:14px;border:0;
    font-size:16px;font-weight:800;cursor:pointer;text-decoration:none}
  .btn-accept{background:var(--green);color:#fff;box-shadow:0 6px 18px rgba(31,122,61,.32)}
  .btn-reject{background:#fff;color:#9a2b2b;border:1.5px solid #e7cccc}
  .btn-pdf{background:rgba(255,255,255,.16);color:#fff;border:1px solid rgba(255,255,255,.35);
    display:inline-block;width:auto;padding:12px 22px;font-size:14px}
  .legal{color:var(--muted);font-size:12px;text-align:center;padding:18px 0 40px}
  .msg{max-width:520px;margin:14vh auto;padding:32px;background:#fff;border:1px solid var(--line);
    border-radius:20px;text-align:center}
  .msg .leaf{margin:0 auto 14px;width:46px;height:46px;font-size:24px;border-radius:14px}
  .msg .logo-chip{margin:0 auto 14px}
  .msg .logo-chip img{height:48px}
  .msg h1{font-size:22px;margin:0 0 8px}
  .msg p{color:var(--muted);margin:0}
</style></head><body>`;
}

/** Mała, brandowana strona statusu (oferta już rozpatrzona / nieznaleziona / podziękowanie). */
function statusPage(title, heading, body) {
  return `${pageHead(title)}
<div class="msg">
  ${logoMark()}
  <h1>${heading}</h1>
  <p>${body}</p>
  <p style="margin-top:14px;font-weight:700;color:var(--green)">${escapeHtml(BRAND.name)}</p>
</div></body></html>`;
}

router.get('/quotations/:token', validateParams(quotationTokenParamsSchema), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT q.*, b.nazwa AS oddzial_nazwa,
              u.imie AS wyc_imie, u.nazwisko AS wyc_nazwisko, u.telefon AS wyc_telefon
       FROM quotations q
       LEFT JOIN branches b ON b.id = q.oddzial_id
       LEFT JOIN users u ON u.id = q.wyceniajacy_id
       WHERE q.client_acceptance_token = $1`,
      [req.params.token]
    );
    const q = rows[0];
    if (!q) {
      return res.status(404).type('html').send(
        statusPage('Oferta nie znaleziona', 'Nie znaleziono oferty', 'Link może być nieaktualny. Skontaktuj się z nami, a wyślemy nową wycenę.')
      );
    }
    if (['Zaakceptowana', 'Odrzucona', 'Wygasla'].includes(q.status)) {
      const label = q.status === 'Zaakceptowana' ? 'Oferta została już zaakceptowana'
        : q.status === 'Odrzucona' ? 'Oferta została odrzucona'
        : 'Oferta wygasła';
      return res.type('html').send(
        statusPage('Status oferty', label, 'Dziękujemy. W razie pytań prosimy o kontakt — chętnie przygotujemy aktualną wycenę.')
      );
    }

    const base = (env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
    const token = req.params.token;

    const items = (
      await pool.query(`SELECT * FROM quotation_items WHERE quotation_id = $1 ORDER BY kolejnosc, id`, [q.id])
    ).rows;

    const photos = (
      await pool.query(
        `SELECT * FROM annotated_photos
         WHERE (parent_object_type = 'quotation' AND parent_object_id = $1)
            OR (parent_object_type = 'quotation_item' AND parent_object_id IN (
              SELECT id FROM quotation_items WHERE quotation_id = $1
            ))
         ORDER BY id`,
        [q.id]
      )
    ).rows;

    // ── Wyliczenia ──────────────────────────────────────────────────────────
    const totalRaw =
      q.wartosc_zaproponowana != null
        ? Number(q.wartosc_zaproponowana)
        : items.reduce((s, it) => s + (Number(it.cena_pozycji) || 0), 0);
    const totalMin = items.reduce((s, it) => s + (Number(it.czas_planowany_min) || 0), 0);
    const totalHours = totalMin ? Math.round((totalMin / 60) * 10) / 10 : 0;
    const adres = [q.adres, q.miasto].filter(Boolean).join(', ');

    // ── PDF ─────────────────────────────────────────────────────────────────
    const pdfHref = absUrl(q.pdf_url, base);
    const pdfBtn = pdfHref
      ? `<a class="btn btn-pdf" target="_blank" rel="noopener" href="${escapeHtml(pdfHref)}">Pobierz PDF</a>`
      : '';

    // ── HERO stat tiles ───────────────────────────────────────────────────────
    const stats = [
      adres ? `<div class="stat full"><div class="k">Adres</div><div class="v">${escapeHtml(adres)}</div></div>` : '',
      items.length
        ? `<div class="stat"><div class="k">Zakres</div><div class="v">${items.length} ${items.length === 1 ? 'pozycja' : 'pozycji'}</div></div>`
        : '',
      totalHours
        ? `<div class="stat"><div class="k">Czas pracy</div><div class="v">~${fmtMoney(totalHours, { decimals: 0 })} h</div></div>`
        : '',
    ].filter(Boolean).join('');

    // ── Galeria ───────────────────────────────────────────────────────────────
    const photoUrls = photos
      .map((p) => absUrl(p.rendered_png_url || p.annotated_preview_url || p.original_url, base))
      .filter(Boolean)
      .slice(0, 10);
    const gallery = photoUrls.length
      ? `<section class="wrap"><h2><small>Dokumentacja</small>Zdjęcia z wizji lokalnej</h2>
         <div class="gallery">${photoUrls
           .map((u) => `<img loading="lazy" src="${escapeHtml(u)}" alt="Zdjęcie z wizji"/>`)
           .join('')}</div></section>`
      : '';

    // ── Pozycje (zakres prac) ─────────────────────────────────────────────────
    const itemsHtml = items
      .map((it, i) => {
        const name = escapeHtml(it.gatunek || it.typ_pracy || `Pozycja ${i + 1}`);
        const chips = [
          it.typ_pracy && it.gatunek ? it.typ_pracy : '',
          it.wysokosc_pas ? `Wys. ${it.wysokosc_pas}` : '',
          it.piersnica_pas ? `Pierśnica ${it.piersnica_pas}` : '',
          it.warunki_dojazdu ? it.warunki_dojazdu : '',
          it.czas_planowany_min ? `~${Math.round(Number(it.czas_planowany_min) / 60 * 10) / 10} h` : '',
        ]
          .filter(Boolean)
          .map((c) => `<span class="chip">${escapeHtml(c)}</span>`)
          .join('');
        const price = it.cena_pozycji != null
          ? `<div class="item-price">${fmtMoney(it.cena_pozycji, { decimals: 0 })} zł</div>`
          : '';
        return `<div class="item">
          <div class="item-top"><div class="item-name">${name}</div>${price}</div>
          ${chips ? `<div class="chips">${chips}</div>` : ''}
        </div>`;
      })
      .join('');
    const zakres = items.length
      ? `<section class="wrap"><h2><small>Co wykonamy</small>Zakres prac</h2>${itemsHtml}</section>`
      : '';

    // ── Karta ceny ────────────────────────────────────────────────────────────
    const priceCard = `<section class="wrap">
      <div class="price-card">
        <div class="label">Wartość oferty</div>
        <div class="big">${fmtMoney(totalRaw, { decimals: 0 })} zł</div>
        <div class="note">Cena za kompleksową usługę — z dojazdem i uprzątnięciem terenu.${
          q.waznosc_do ? ` Oferta ważna do ${fmtDate(q.waznosc_do)}.` : ''
        }</div>
      </div>
    </section>`;

    // ── Etapy ─────────────────────────────────────────────────────────────────
    const steps = [
      ['Wizja lokalna i pomiar', 'Oceniamy zakres, warunki dojazdu i bezpieczeństwo — wszystko widać na zdjęciach powyżej.'],
      ['Zabezpieczenie terenu', 'Zabezpieczamy otoczenie, instalacje i nasadzenia przed rozpoczęciem prac.'],
      ['Realizacja prac', 'Wykonujemy uzgodniony zakres sprzętem profesjonalnym, zgodnie ze sztuką ogrodniczą.'],
      ['Uprzątnięcie i wywóz', 'Sprzątamy teren i wywozimy urobek — zostawiamy porządek.'],
    ]
      .map(
        ([t, d], i) =>
          `<div class="step"><div class="n">${i + 1}</div><div><div class="t">${t}</div><div class="d">${d}</div></div></div>`
      )
      .join('');

    // ── Kontakt ───────────────────────────────────────────────────────────────
    const estName = [q.wyc_imie, q.wyc_nazwisko].filter(Boolean).join(' ');
    const contactRows = [
      estName ? `<div class="row"><span class="k">Wycenę przygotował</span><span class="v">${escapeHtml(estName)}</span></div>` : '',
      q.wyc_telefon ? `<div class="row"><span class="k">Telefon</span><span class="v"><a href="tel:${escapeHtml(q.wyc_telefon)}">${escapeHtml(q.wyc_telefon)}</a></span></div>` : '',
      q.oddzial_nazwa ? `<div class="row"><span class="k">Oddział</span><span class="v">${escapeHtml(q.oddzial_nazwa)}</span></div>` : '',
      BRAND.phone ? `<div class="row"><span class="k">Biuro</span><span class="v"><a href="tel:${escapeHtml(BRAND.phone.replace(/\s/g, ''))}">${escapeHtml(BRAND.phone)}</a></span></div>` : '',
      BRAND.email ? `<div class="row"><span class="k">E-mail</span><span class="v"><a href="mailto:${escapeHtml(BRAND.email)}">${escapeHtml(BRAND.email)}</a></span></div>` : '',
      q.waznosc_do ? `<div class="row"><span class="k">Ważność oferty</span><span class="v">${fmtDate(q.waznosc_do)}</span></div>` : '',
      `<div class="row"><span class="k">Nr wyceny</span><span class="v">#${q.id}</span></div>`,
    ].filter(Boolean).join('');

    // ── Strona ────────────────────────────────────────────────────────────────
    res.type('html').send(`${pageHead(`Wycena dla ${q.klient_nazwa || 'klienta'} — ${BRAND.name}`)}
<div class="hero"><div class="wrap">
  <div class="brandbar">${logoMark()} ${escapeHtml(BRAND.name)}</div>
  <h1>Wycena prac<br>dla ${escapeHtml(q.klient_nazwa || 'Państwa')}</h1>
  <p class="sub">${escapeHtml(BRAND.tagline)}</p>
  <div class="stats">${stats}</div>
  ${pdfBtn ? `<div style="margin-top:18px">${pdfBtn}</div>` : ''}
</div></div>

${gallery}
${zakres}
${priceCard}

<section class="wrap"><h2><small>Jak pracujemy</small>Zakres usługi</h2>${steps}</section>

<section class="wrap"><h2><small>Decyzja</small>Akceptacja oferty</h2>
  <form method="post" action="/api/public/quotations/${encodeURIComponent(token)}/choice" class="actions">
    <input type="hidden" name="action" id="act" value="accept"/>
    <button type="submit" class="btn btn-accept" onclick="document.getElementById('act').value='accept'">✓ Akceptuję ofertę</button>
    <button type="submit" class="btn btn-reject" onclick="document.getElementById('act').value='reject'">Odrzucam</button>
  </form>
  <p class="legal">Po akceptacji skontaktujemy się z Państwem w sprawie terminu realizacji.</p>
</section>

<section class="wrap"><h2><small>Kontakt</small>Masz pytania?</h2>
  <div class="contact">${contactRows}</div>
</section>

<div class="legal">${escapeHtml(BRAND.name)} · ${escapeHtml(BRAND.site)} · Oferta #${q.id}</div>
</body></html>`);
  } catch (e) {
    logger.error('quotation-public get', { message: e.message });
    res.status(500).send('Błąd');
  }
});

router.post(
  '/quotations/:token/choice',
  express.urlencoded({ extended: true }),
  validateParams(quotationTokenParamsSchema),
  validateBody(quotationChoiceBodySchema),
  async (req, res) => {
    const action = req.body.action; // już zwalidowany do 'accept' | 'reject'
    const token = req.params.token;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(`SELECT * FROM quotations WHERE client_acceptance_token = $1 FOR UPDATE`, [token]);
    const q = rows[0];
    if (!q) {
      await client.query('ROLLBACK');
      return res.status(404).send('Nie znaleziono');
    }
    if (q.status !== 'Wyslana_Klientowi') {
      await client.query('ROLLBACK');
      return res.status(400).send(`Nieprawidłowy status: ${q.status}`);
    }
    if (action === 'reject') {
      await client.query(`UPDATE quotations SET status = 'Odrzucona', updated_at = NOW() WHERE id = $1`, [q.id]);
      await client.query('COMMIT');
      return res.type('html').send(
        statusPage('Dziękujemy', 'Oferta odrzucona', 'Dziękujemy za poświęcony czas. W razie zmiany decyzji jesteśmy do dyspozycji.')
      );
    }
    if (action !== 'accept') {
      await client.query('ROLLBACK');
      return res.status(400).send('Brak akcji');
    }

    const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString().slice(0, 64);
    await client.query(
      `UPDATE quotations SET status = 'Zaakceptowana', klient_akceptacja_at = NOW(), klient_akceptacja_ip = $1, updated_at = NOW() WHERE id = $2`,
      [ip, q.id]
    );

    const plan = new Date();
    plan.setDate(plan.getDate() + 7);
    const opisLines = (
      await client.query(`SELECT gatunek, typ_pracy, wysokosc_pas FROM quotation_items WHERE quotation_id = $1 ORDER BY id`, [q.id])
    ).rows.map((it, i) => `${i + 1}. ${it.gatunek || ''} — ${it.typ_pracy || ''} (${it.wysokosc_pas || ''})`);
    const opis = [`Z wyceny terenowej #${q.id}`, ...opisLines].join('\n');

    const taskIns = await client.query(
      `INSERT INTO tasks (
        klient_nazwa, klient_telefon, adres, miasto,
        typ_uslugi, priorytet, wartosc_planowana,
        data_planowana,
        notatki_wewnetrzne, status,
        oddzial_id, wyceniajacy_id, pin_lat, pin_lng, opis, source_quotation_id
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'Nowe',$10,$11,$12,$13,$14,$15)
      RETURNING id`,
      [
        q.klient_nazwa || 'Klient',
        q.klient_telefon || null,
        q.adres || '',
        q.miasto || '',
        'Wycinka z wyceny',
        q.priorytet || 'Normalny',
        q.wartosc_zaproponowana,
        plan.toISOString(),
        `E-akceptacja klienta. Wycena #${q.id}`,
        q.oddzial_id,
        q.wyceniajacy_id,
        q.lat,
        q.lng,
        opis,
        q.id,
      ]
    );
    const taskId = taskIns.rows[0].id;
    await client.query('COMMIT');

    if (kommoWebhookConfigured('crm')) {
      const taskRow = (await pool.query(`SELECT * FROM tasks WHERE id = $1`, [taskId])).rows[0];
      try {
        const payload = {
          source: 'arbor-os',
          event: 'quotation.accepted',
          sent_at: new Date().toISOString(),
          quotation: { id: q.id },
          task: { id: taskId, status: taskRow.status },
        };
        await postKommoWebhook(payload, 'crm');
      } catch (e) {
        logger.warn('kommo quotation.accepted', { message: e.message });
      }
    }

    return res.type('html').send(
      statusPage(
        'Dziękujemy!',
        'Oferta zaakceptowana',
        `Zlecenie #${taskId} zostało utworzone. Skontaktujemy się z Państwem w sprawie terminu realizacji.`
      )
    );
  } catch (e) {
    await client.query('ROLLBACK');
    logger.error('quotation-public choice', { message: e.message });
    res.status(500).send('Błąd serwera');
  } finally {
    client.release();
  }
});

module.exports = router;
