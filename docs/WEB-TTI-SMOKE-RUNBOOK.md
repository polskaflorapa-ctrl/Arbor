# Web TTI smoke runbook

Cel: miec szybki, powtarzalny pomiar czasu dojscia panelu web do uzywalnego ekranu. Minimalny prog dla pilota: TTI <= 3000 ms na referencyjnym laptopie/desktopie.

Ten smoke mierzy praktyczny TTI proxy dla SPA: przejscie na trase, wyrenderowanie sensownej tresci, brak ekranu ladowania i gotowy glowny layout. Nie jest to pelny Lighthouse lab score, tylko szybka bramka regresji.

## 1. Komendy

W jednym terminalu uruchom web:

```powershell
cd C:\Users\paha1\arbor
npm run web
```

W drugim terminalu uruchom smoke:

```powershell
cd C:\Users\paha1\arbor
npm run smoke:web:tti -- http://127.0.0.1:5173 --threshold 3000
```

Jesli web dziala na porcie smoke routes:

```powershell
$env:ARBOR_WEB_TTI_BASE="http://127.0.0.1:5174"
npm run smoke:web:tti
```

## 2. Zakres tras

Domyslny zestaw krytyczny:

- `/dashboard`
- `/zlecenia`
- `/kierownik`
- `/harmonogram`
- `/bi`
- `/telefonia`
- `/integracje`

Wlasny zestaw:

```powershell
npm run smoke:web:tti -- http://127.0.0.1:5173 --routes /dashboard,/zlecenia,/bi --threshold 3000
```

Mobile viewport dla tras krytycznych:

```powershell
npm run smoke:web:tti -- http://127.0.0.1:5173 --mobile --threshold 3000
```

## 3. Warunki PASS

PASS:

- Kazda trasa ma `tti_ms <= 3000`.
- Strona nie pokazuje loginu w test-mode.
- `text_length >= 40`.
- Brak stalego `Loading` / `Ladowanie`.
- Brak poziomego overflow.
- Brak bledow konsoli i odpowiedzi sieciowych >= 400 poza ignorowanymi favicon/mock fallback.

FAIL:

- Dowolna trasa przekracza prog.
- Ekran jest pusty albo zostaje w loaderze.
- Trasa wraca na login.
- Pojawia sie framework error overlay.
- Pojawia sie poziomy overflow na desktop albo mobile.

## 4. Artefakty

Skrypt zapisuje JSON:

```text
output/playwright/web-tti-smoke-results.json
```

Do wpisu QA zapisz:

- data i operator;
- base URL;
- threshold;
- viewport;
- lista tras;
- najwolniejsza trasa i `tti_ms`;
- czy smoke byl uruchomiony po buildzie, deployu czy lokalnym dev serverze;
- follow-up, jesli TTI > 3000 ms.

## 5. GO / NO-GO

GO:

- `npm run verify:web-tti` przechodzi.
- `npm run smoke:web:tti -- http://127.0.0.1:5173 --threshold 3000` przechodzi na referencyjnym srodowisku.
- Najwolniejsza krytyczna trasa jest opisana w artefakcie JSON.
- Po zmianie duzych ekranow web smoke zostal powtorzony.

NO-GO:

- Brakuje Chrome/Chromium albo `CHROME_PATH`.
- Web app nie jest osiagalny pod `ARBOR_WEB_TTI_BASE`.
- TTI krytycznej trasy > 3000 ms bez zaakceptowanego wyjatku.
- Smoke route pokazuje pusty ekran, login, loader albo error overlay.
