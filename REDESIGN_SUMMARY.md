# Połączenie Arbor OS z projektem Polska Flora

## Źródła projektu

- układ ekranów: eksporty HTML z katalogu `C:\Users\paha1\OneDrive\Desktop\export`,
- identyfikacja wizualna: `Brand book Polska Flora.pdf`,
- dane, logika biznesowa i API: istniejąca aplikacja Arbor OS.

Projekt został połączony jako jedna aplikacja. Widoki nie korzystają z `iframe` ani z osobnej, statycznej kopii interfejsu.

## Aktywne powierzchnie

- `/dashboard` — panel Arbor OS zgodny z eksportem „Arbor OS”, z prawdziwymi danymi i akcjami,
- `/wyceniajacy-hub` — Gabinet Wyceniającego zgodny z eksportem, zasilany istniejącą kolejką `/ogledziny`,
- `/portal-klienta` — publiczny widok demonstracyjny Portalu Klienta,
- `/portal-klienta/:token` — publiczny portal z danymi istniejącego endpointu `/track/:token`,
- aplikacja mobilna — nagłówek, historie, „Misja dnia”, „Wycena terenowa” i szybkie akcje zgodne z eksportem „Arbor Mobile”.

## Zasady integracji

- używane są zatwierdzone warianty logo, kolory i font Road UA z brand booka,
- przykładowe wartości z eksportów nie zastępują danych z API,
- istniejące uprawnienia, nawigacja i publiczny tracking zostały zachowane,
- style ekranów są izolowane, aby starsze globalne selektory nie nadpisywały nowych szablonów,
- responsywne wersje zachowują pełną szerokość ekranu bez poziomego przewijania.

## Celowe różnice względem statycznych eksportów

- treść kart, liczniki i statusy odpowiadają danym aplikacji, a nie przykładowym rekordom z makiety,
- placeholdery logo z eksportów zastąpiono oficjalnymi plikami Polska Flora z brand booka,
- portal tokenowy pokazuje wyłącznie dane bezpiecznie udostępnione przez istniejący endpoint publiczny.
