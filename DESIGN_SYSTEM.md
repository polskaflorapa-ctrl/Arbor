# Polska Flora — system projektowy Arbor OS

Aktywnym i jedynym źródłem identyfikacji wizualnej Arbor OS jest oficjalny brand book Polska Flora. Szczegółowe reguły znajdują się w [docs/brand-guidelines.md](docs/brand-guidelines.md), a tokeny maszynowe w [assets/design-tokens.json](assets/design-tokens.json) i [assets/design-tokens.css](assets/design-tokens.css).

## Fundament marki

| Rola | Wartość |
| --- | --- |
| Ciemny brąz | `#3B2A18` |
| Jasny brąz | `#766440` |
| Zieleń podstawowa | `#A0AF14` |
| Jasna zieleń | `#B4C232` |
| Pomarańczowo-brązowy | `#BD701E` |
| Krój | Road UA |
| H1 | Road UA ExtraBold, 48 pt w materiałach / responsywny odpowiednik cyfrowy |
| H2 | Road UA Bold, 24 pt w materiałach / responsywny odpowiednik cyfrowy |
| Tekst | Road UA Regular, 12 pt w materiałach / minimum 16 px w UI |

Nie należy wprowadzać nowej palety produktowej ani zastępować Road UA fontami Inter, Hanken Grotesk, Fira Sans, Manrope lub fontami zewnętrznymi.

## Logo

- Używamy wyłącznie oryginalnych wariantów z `assets/brand/polska-flora/logos/`.
- Poziomy znak ma minimalną szerokość 56 mm, pionowy 25 mm. Przy małych rozmiarach stosujemy wersję bez deskryptora.
- Pole ochronne wynosi co najmniej `1.5×` odstępu między symbolem i logotypem.
- Wersję `color-light-background` stosujemy na jasnym tle, a `color-dark-background` na ciemnym.
- Nie wolno rozciągać, obracać, przekolorowywać, przestawiać elementów ani dodawać efektów do znaku.

## Kontrakty interfejsu

- Podstawowe CTA: tło `#A0AF14`, tekst `#3B2A18`; kontrast 5,64:1.
- Nawigacja: ciemny brąz z białym tekstem; aktywna pozycja może używać zieleni z ciemnobrązowym tekstem.
- Powierzchnie: biel lub ciemny brąz, z subtelnymi tintami budowanymi z tokenów i przezroczystości.
- Pomarańczowo-brązowy służy jako oszczędny akcent. Funkcjonalne kolory błędu i statusu mogą pozostać poza paletą marki, jeśli są potrzebne dla czytelności i dostępności.
- Wzory i motyw drzewa pochodzą wyłącznie z `assets/brand/polska-flora/identity/`; zachowują proporcje i nie zastępują logo.
- Kolor nie może być jedynym nośnikiem stanu. Kontrolki mają etykietę lub ikonę, widoczny fokus i czytelny stan disabled.

## Architektura tokenów

Tokeny mają trzy warstwy:

1. `primitive` — zatwierdzone wartości marki, typografia, skale i czasy;
2. `semantic` — role: tło, tekst, primary, secondary, border, focus i motywy;
3. `component` — kontrakty przycisku, karty, pola, nawigacji, badge'a i logo.

Komponent korzysta z tokenu komponentowego lub semantycznego, a nie z nowego surowego koloru. Ciemny wariant zmienia aliasy semantyczne, nie prymitywy marki.

## Integracja

- Web: `web/src/components/BrandLogo.js`, `web/src/styles/polska-flora-brand.css`, zasoby w `web/public/brand/`.
- Mobile: `mobile/constants/brand.ts`, `mobile/components/ui/brand-logo.tsx`, zasoby w `mobile/assets/brand/`.
- Favicony, PWA, ikony Expo, adaptive icon, notification icon i splash są mechanicznie przygotowane z zatwierdzonego znaku, bez jego przerysowania.
- Raporty e-mail korzystają z tej samej palety i bezpiecznie escapują dane użytkownika.

## Dostępność i responsywność

- Zwykły tekst: kontrast minimum 4,5:1; elementy UI i fokus: minimum 3:1.
- Białego tekstu nie używamy na zieleni podstawowej — ta para ma tylko 2,43:1.
- Minimalny cel dotykowy: 44 × 44 px.
- Układ nie może powodować poziomego przewijania przy 375 px, 768 px ani 1440 px.
- Każda strona ma widoczny landmark `main`, logiczną hierarchię nagłówków, opisane logo i obsługę klawiatury.
- Czysty wynik automatycznego skanera nie zastępuje ręcznej kontroli fokusu i czytnika ekranu.

## Walidacja

```powershell
node scripts/brand-contract-check.cjs
node --test scripts/brand-contract-check.test.cjs
npm test --workspace arbor-web
npm run build --workspace arbor-web
npm run typecheck --workspace arbor-mobile
npm run lint --workspace arbor-mobile
```

Kontrakt marki sprawdza dokładną paletę, Road UA, komplet oryginalnych plików, zgodność SHA-256 kopii web/mobile, warianty logo oraz ciemnobrązowy tekst zielonych CTA.
