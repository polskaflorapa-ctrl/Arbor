# Platinum UI Guidelines (Mobile)

Ten dokument jest źródłem prawdy dla stylu "Platinum" w aplikacji mobilnej Arbor.
Celem jest utrzymanie spójnego, premium wyglądu na wszystkich ekranach.

## 1) Zasady nadrzędne

- Używaj wyłącznie tokenów z `mobile/constants/theme.ts`.
- Nie używaj twardych kolorów (`#fff`, `#000`, custom `rgba(...)`) w stylach UI.
- Nie używaj `boxShadow`; stosuj tokenowe cienie (`shadow*`, `elevation`) lub `elevationCard()`.
- Overlaye modalowe mają wspólny styl platinum dark:
  - `backgroundColor: 'rgba(5,8,15,0.88-0.90)'`
- Typografia ma być czytelna i "clean tech":
  - nagłówki: mocne (`700/800`), drobny `letterSpacing` tam gdzie potrzebne,
  - tekst pomocniczy: `theme.textSub` / `theme.textMuted`.

## 2) Tokeny i kolory

- Główne tło: `theme.bg`
- Karty i sekcje: `theme.surface` / `theme.cardBg`
- Warstwy pomocnicze: `theme.surface2`, `theme.surface3`
- Obramowania: `theme.border`, `theme.cardBorder`, `theme.inputBorder`
- Tekst:
  - główny: `theme.text`
  - wtórny: `theme.textSub`
  - pomocniczy: `theme.textMuted`
- Akcent Platinum:
  - `theme.accent` (złoty akcent)
  - `theme.accentText` (tekst na akcencie)
  - `theme.accentLight` (subtelne tło akcentowe)

## 3) Karty, sekcje, cienie

- Karty:
  - promień: zgodnie z tokenami `radiusMd/radiusLg/radiusXl`
  - obrys: `borderWidth: 1`, `borderColor: theme.cardBorder` lub `theme.border`
- Cienie:
  - preferowane: `...elevationCard(theme)`
  - alternatywnie: `shadowColor`, `shadowOpacity`, `shadowRadius`, `shadowOffset`, `elevation` z tokenów

## 4) Header, tabbar, nawigacja

- Header:
  - `backgroundColor: theme.headerBg`
  - tekst: `theme.headerText`
  - podtytuł: `theme.headerSub`
  - dolny border: `theme.border`
- Tabbar:
  - tło: `theme.navBg`
  - aktywne: `theme.navActive`
  - nieaktywne: `theme.navInactive`
  - border top: `theme.navBorder`
  - subtelny cień zgodny z tokenami

## 5) Formularze i CTA

- Input:
  - `backgroundColor: theme.inputBg`
  - `borderColor: theme.inputBorder`
  - `color: theme.inputText`
  - `placeholder: theme.inputPlaceholder`
- Główne CTA:
  - `backgroundColor: theme.accent`
  - tekst: `theme.accentText`
  - narożniki minimum `radiusMd`
- Drugorzędne akcje:
  - tło neutralne (`surface2`) i wyraźny border

## 6) Statusy i badge/chipy

- Success: `theme.success` + `theme.successBg`
- Warning: `theme.warning` + `theme.warningBg`
- Danger: `theme.danger` + `theme.dangerBg`
- Info: `theme.info` + `theme.infoBg`
- Badge/chipy:
  - bez twardych kolorów
  - tekst zawsze kontrastowy względem tła

## 7) Modale i overlaye

- Overlay:
  - `backgroundColor: 'rgba(5,8,15,0.88-0.90)'`
- Sheet/modal:
  - `backgroundColor: theme.surface` lub `theme.cardBg`
  - górne rogi zaokrąglone (`radiusXl` lub większe)
  - górny border akcentowany tokenem

## 8) Anti-patterny (zakazane)

- `boxShadow: ...`
- Twarde kolory w stylach ekranów (poza paletami rysowania/canvas, gdzie to uzasadnione)
- Mieszanie starych overlayów (`rgba(0,0,0,...)`, `rgba(2,6,23,...)`)
- Niespójne promienie i niestandardowe CTA bez uzasadnienia

## 9) Definition of Done (UI)

Zmiana UI jest gotowa, gdy:

- przechodzi lint + typecheck,
- nie wprowadza twardych kolorów ani `boxShadow`,
- zachowuje spójność z tokenami theme,
- działa wizualnie na Android + iOS (minimum smoke),
- nie obniża kontrastu i czytelności.

