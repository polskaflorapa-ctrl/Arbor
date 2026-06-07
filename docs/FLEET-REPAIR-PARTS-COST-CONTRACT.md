# Fleet repair parts cost contract

Cel: czesci dodawane do naprawy floty maja byc osobnym skladnikiem kosztu, a nie cicha nadpisywac bazowy koszt naprawy.

## Zakres

- `GET /api/flota/naprawy` zwraca dla kazdej naprawy `czesci_count` oraz `czesci_kwota`.
- `POST /api/flota/naprawy/:naprawaId/czesci` zapisuje pozycje czesci z `kwota_laczna`.
- Dodanie czesci nie zmienia `repair.koszt`; koszt bazowy zostaje wartoscia wpisana przy naprawie lub pochodzaca z faktur.
- UI Floty sumuje koszt naprawy jako faktury albo koszt bazowy plus `czesci_kwota`.
- CSV napraw eksportuje `czesci_kwota` i `czesci_count`.

## GO

- Lista napraw pokazuje liczbe i sume czesci.
- Szczegol zasobu i podsumowania floty doliczaja czesci do calkowitego kosztu.
- Dodanie czesci nie podbija automatycznie `repair.koszt`.
- `npm run verify:fleet-repair-parts-cost` przechodzi.

## NO-GO

- `POST /api/flota/naprawy/:naprawaId/czesci` ustawia `repair.koszt` na kwote czesci.
- UI liczy czesci podwojnie: raz w `repair.koszt`, drugi raz w `czesci_kwota`.
- Eksport CSV pomija `czesci_kwota` albo `czesci_count`.

## Smoke

```powershell
npm run verify:fleet-repair-parts-cost
npm run verify:fleet-repair-due-controls
npm run verify:web
```
