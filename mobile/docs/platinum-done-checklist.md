# Platinum Done Checklist (Mobile)

Finalna lista wdrożeniowa dla rolloutu Platinum v2.

## 1) UI consistency

- [x] Główne CTA ekranów operacyjnych używają `PlatinumCTA`.
- [x] Karty i sekcje są spójne z tokenami motywu (`cardBg`, `cardBorder`, `surface*`).
- [x] Modal overlay jest ujednolicony do stylu platinum dark.
- [x] Header i tabbar utrzymują jeden język wizualny.

## 2) Interaction quality

- [x] Kluczowe akcje mają haptics (`light`, `success`, `warning`, `error`).
- [x] Akcje zapisu/wysyłki mają czytelne stany `loading` i `disabled`.
- [x] Alerty i fallback offline są spójne z flow użytkownika.

## 3) Core flow coverage

- [x] `dashboard`, `wyceniajacy-hub`, `login`.
- [x] `ogledziny`, `wycena-kalendarz`, `zatwierdz-wyceny`.
- [x] `nowe-zlecenie`, `raport-dzienny`, `zlecenie/[id]`.
- [x] `rezerwacje-sprzetu`, `wycena-rysuj`, `blokady-kalendarza`.
- [x] Ekrany pomocnicze: `powiadomienia`, `api-diagnostyka`, `pomocnik`, `explore`.

## 4) Quality gate

- [x] Brak nowych błędów lintera na zmienionych ekranach.
- [x] Dokumentacja standardu: `mobile/docs/platinum-ui-guidelines.md`.
- [x] Dokumentacja UAT: `mobile/docs/uat-platinum-checklist.md`.

## 5) Release note

Platinum v2 jest wdrożony end-to-end dla głównych i pomocniczych ekranów mobilnych.
Kolejne zmiany UI powinny bazować wyłącznie na komponentach i zasadach opisanych w dokumentacji Platinum.

