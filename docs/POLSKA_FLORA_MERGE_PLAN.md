# Polska Flora - plan polaczenia projektow

## Co jest glownym projektem

Glowny projekt dziala z katalogu `C:\Users\paha1\arbor` i jest wiekszy niz demo z pulpitu. Zawiera gotowe moduly, ktore pasuja do procesu Polska Flora:

- `web/src/pages/Telefonia.js` - telefonia, SMS, webhook agentki Ania / Polska Flora, intake rozmow.
- `web/src/pages/Ogledziny.js` - obsluga bezplatnych ogledzin terenowych.
- `web/src/pages/Crm*.js` - CRM, pipeline i praca z leadami.
- `web/src/pages/Zlecenia.js` - przejscie od zgloszenia przez ogledziny do ekip.
- `web/src/pages/Integracje.js` - integracje, Kommo, logi i diagnostyka.

## Co zostalo przeniesione w pierwszym etapie

- Widoczny branding aplikacji zmieniony na `Polska Flora` w tytule strony, manifestach, loginie i sidebarze.
- Panel logowania opisuje proces Polska Flora: zgloszenia, bezplatne ogledziny, trasy, CRM i agentke Anie.
- Modul telefonii uzywa nazwy Polska Flora w komunikatach zamiast starego ARBOR-OS.
- Naprawiono miejsca, gdzie wczesniejsze kodowanie rozbilo operator `??`; build weba przechodzi.

## Co dopieto w drugim etapie

- Usunieto widoczne resztki ARBOR/ARBOR-OS z glownych etykiet web i mobile: naglowkow, loginu, privacy lock, dashboardu, zlecen, diagnostyki API, odprawy brygady i tlumaczen CRM.
- Demo/test-mode komunikacji pokazuje teraz `Polska Flora` w nadawcach i ofertach zamiast ARBOR.
- `Kommo -> ARBOR` w panelu Integracje zmieniono na `Kommo -> Polska Flora`.
- Pozostawiono techniczne nazwy env/API, komentarze CSS, stare sandboxy designu, hasla demo oraz zawod `Arborysta`, bo nie sa to resztki brandingu produktu.

## Co dopieto w trzecim etapie

- Dashboard Polska Flora prowadzi teraz od razu przez domyslna sciezke: `Telefon / Ania -> CRM -> Ogledziny -> Wycena -> Ekipa`.
- Glowne akcje pierwszego ekranu kieruja do przyjecia telefonu i CRM, a nie do ogolnego tworzenia zlecenia.
- Dane demo w test mode pokazuja realne uslugi Polska Flora: wycinka i pielegnacja drzew, mycie/malowanie dachow, czyszczenie kostki/elewacji oraz ogrody.

## Nastepne konkretne kroki

Brak otwartych punktow z tego merge planu. Aktualna bramka gotowosci to:

```bash
npm run verify:polska-flora-ready
```

Checklist wdrozeniowy oddzialu Malopolskie jest w `docs/POLSKA_FLORA_MALOPOLSKIE_GO_LIVE.md`.
