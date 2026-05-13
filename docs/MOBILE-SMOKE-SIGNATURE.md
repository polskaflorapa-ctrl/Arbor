# Mobile Smoke: Podpis klienta + protokół PDF

Cel: potwierdzić, że flow działa stabilnie na urządzeniu (online i offline), a dokument trafia do PDF.

## 1) Smoke automatyczny (API, lokalnie)

Wymagania:
- uruchomiony `arbor-os` pod `SMOKE_BASE_URL` (domyślnie `http://127.0.0.1:3000`)
- istniejący użytkownik (`SMOKE_LOGIN`, `SMOKE_PASSWORD`)
- przynajmniej jedno dostępne zlecenie

Komenda:

```bash
npm run smoke:signature -w arbor-os
```

Pozytywny wynik:
- log kończy się `SMOKE_SIGNATURE_PROTOCOL_OK`
- endpoint podpisu zapisuje dane
- endpoint krótkiego linku zwraca URL
- PDF pobiera się przez `access_token` i ma poprawny nagłówek `%PDF-`

## 2) Smoke manualny (telefon, online)

1. Otwórz `Zlecenie` -> sekcja `Podpis klienta`.
2. Wprowadź imię i nazwisko klienta.
3. Narysuj podpis palcem/rysikiem.
4. Kliknij `Zapisz`.
5. Sprawdź, że:
   - pojawia się status "Podpis dodany",
   - automatycznie otwiera się protokół PDF,
   - PDF zawiera sekcję "Podpis klienta (mobilny)".
6. Wróć do zlecenia i kliknij `Otwórz protokół PDF` ponownie (ręczny retry).

## 3) Smoke manualny (telefon, offline -> online)

1. Wyłącz internet w urządzeniu.
2. Wejdź w `Podpis klienta`, narysuj podpis, zapisz.
3. Oczekiwane:
   - komunikat o zapisie lokalnym,
   - brak crasha,
   - wpis trafia do kolejki offline.
4. Włącz internet.
5. Poczekaj na flush kolejki.
6. Otwórz protokół PDF i potwierdź, że podpis jest widoczny w dokumencie.

## Kryteria akceptacji

- Brak błędów UI i crashy.
- Podpis odręczny zapisuje się poprawnie.
- PDF otwiera się automatycznie po zapisie podpisu.
- PDF da się otworzyć także ręcznie ze zlecenia.
- Flow działa po odzyskaniu połączenia (offline queue).
