# Equipment cards contract

Cel: Kierownik widzi w `#/flota` operacyjne karty pojazdow i sprzetu, ktore pokazuja gotowosc zasobow przed planowaniem dnia. Karta ma od razu odpowiadac, czy przeglad, OC albo status zasobu moga zablokowac start ekipy.

## Zakres UI

- `#/flota` pobiera dane z `GET /api/flota/pojazdy` i `GET /api/flota/sprzet`.
- Panel `Karty zasobow` pokazuje tylko zasoby wymagajace uwagi: przeterminowane, zblizajace sie w ciagu 30 dni albo z brakujaca data.
- Karty pojazdow pokazuja `data_przegladu`, `data_ubezpieczenia`, status, oddzial, ekipe i metryke przebiegu.
- Karty sprzetu pokazuja `data_przegladu`, status, oddzial, ekipe, numer seryjny, `koszt_motogodziny` oraz najblizsza rezerwacje, jesli backend ja zwroci.
- KPI `Alerty zasobow` liczy przeglady i OC po terminie albo w horyzoncie 30 dni.
- KPI `Po terminie` liczy zasoby, ktore maja co najmniej jeden przeterminowany termin.
- Przycisk `Kalendarz zasobow` prowadzi do `#/kalendarz-zasobow?tab=equipment&equipment=ID&modal=0` dla sprzetu.

## Alerty

- `Przeglad po terminie`: `data_przegladu` jest starsza niz dzisiaj.
- `OC po terminie`: `data_ubezpieczenia` pojazdu jest starsza niz dzisiaj.
- `Przeglad za X dni` albo `OC za X dni`: termin jest w horyzoncie 30 dni.
- `Brak daty`: karta wymaga uzupelnienia danych, ale nie podbija licznika alertow terminowych.
- `Rezerwacja YYYY-MM-DD`: sprzet ma najblizsza rezerwacje z `next_reservation_from` i kontekstem zlecenia/ekipy.

## Zrodla prawdy

- Backend: `vehicles.data_przegladu`, `vehicles.data_ubezpieczenia`, `equipment_items.data_przegladu`, `equipment_items.koszt_motogodziny`, `equipment_reservations`.
- BI/digest: alerty z EPIC 4.4 nadal sa kontrola dyrektorska.
- Flota: ten kontrakt jest warstwa operacyjna EPIC 3.4 powiazana z zasobami EPIC 6.

## GO

- Kierownik widzi osobna karte dla pojazdu z przeterminowanym przegladem i OC.
- Kierownik widzi osobna karte dla sprzetu z przeterminowanym przegladem.
- Kierownik widzi najblizsza rezerwacje sprzetu, gdy istnieje aktywna rezerwacja w przyszlosci.
- Przycisk karty sprzetu otwiera kalendarz zasobow z parametrem `equipment`.
- `npm run verify:equipment-cards` i test `Flota.test.js` przechodza.

## NO-GO

- Przeterminowane OC pojazdu nie jest widoczne jako alert.
- Sprzet po terminie przegladu nie pojawia sie w kartach zasobow.
- Liczniki nie odrozniaja alertow terminowych od samego braku daty.
- Karta sprzetu nie ma przejscia do kalendarza zasobow.
- Najblizsza rezerwacja sprzetu znika mimo aktywnej rezerwacji w backendzie.
