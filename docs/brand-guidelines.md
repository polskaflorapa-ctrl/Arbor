# Polska Flora — zasady identyfikacji wizualnej

Ten dokument jest źródłem prawdy dla identyfikacji wizualnej produktu. Oryginalne, zatwierdzone zasoby znajdują się w `assets/brand/polska-flora/`, warstwa maszynowa w `assets/design-tokens.json`, a odpowiadające jej zmienne CSS w `assets/design-tokens.css`.

## Charakter marki

Identyfikacja łączy znak drzewa z literą „F” i formą domu. System wizualny ma być naturalny, rzeczowy i wyrazisty: ciemny brąz buduje stabilność, zielenie odpowiadają za główną energię marki, a pomarańczowo-brązowy jest akcentem. Należy używać oryginalnych plików — znaku nie wolno odtwarzać ręcznie.

## Logo

### Warianty

Każda kombinacja ma cztery zatwierdzone wersje: `black`, `white`, `color-light-background` i `color-dark-background`.

| Układ | Z deskryptorem | Bez deskryptora |
| --- | --- | --- |
| Poziomy | `assets/brand/polska-flora/logos/with-descriptor/horizontal/` | `assets/brand/polska-flora/logos/without-descriptor/horizontal/` |
| Pionowy | `assets/brand/polska-flora/logos/with-descriptor/vertical/` | `assets/brand/polska-flora/logos/without-descriptor/vertical/` |

- Na jasnym lub białym tle używaj `color-light-background.svg`.
- Na ciemnym tle używaj `color-dark-background.svg`.
- Wersje `black.svg` i `white.svg` są przeznaczone wyłącznie do zastosowań monochromatycznych.
- Układ poziomy jest podstawowy dla nagłówków i szerokich pól. Układ pionowy stosuj w polach wysokich lub zbliżonych do kwadratu.
- Gdy format pozwala zachować pełną czytelność, stosuj wersję z deskryptorem. Poniżej granicy czytelności wybierz zatwierdzoną wersję bez deskryptora, zamiast usuwać dopisek samodzielnie.

### Minimalny rozmiar i pole ochronne

| Układ | Minimalna szerokość w druku |
| --- | ---: |
| Pionowy | 25 mm |
| Poziomy | 56 mm |

W środowisku cyfrowym przelicz wartości na piksele z uwzględnieniem rzeczywistej gęstości docelowego ekranu i sprawdź czytelność. Nie ustalaj mniejszego rozmiaru tylko na podstawie szerokości CSS.

Pole ochronne po każdej stronie logo wynosi co najmniej `1,5 × x`, gdzie `x` jest odległością pomiędzy symbolem a częścią typograficzną znaku. W polu ochronnym nie mogą znajdować się tekst, krawędzie kontenera ani inne elementy graficzne.

### Niedozwolone modyfikacje

- rozciąganie, ściskanie lub zmiana proporcji;
- obracanie, pochylanie i przestawianie elementów;
- zmiana kolorów poza dostarczonymi wariantami;
- dodawanie obrysu, gradientu, cienia, poświaty lub przezroczystości;
- kadrowanie jakiejkolwiek części logo;
- umieszczanie na tle o niewystarczającym kontraście lub na ruchliwym fragmencie zdjęcia;
- samodzielne oddzielanie symbolu, napisu albo deskryptora;
- odtwarzanie logo tekstem, ikoną lub zrzutem ekranu.

## Kolorystyka

| Nazwa | HEX | RGB | Pantone | Rola |
| --- | --- | --- | --- | --- |
| Ciemny brąz | `#3B2A18` | 59, 42, 24 | Black 4 C | tekst, ciemne powierzchnie, nawigacja, aktywne stany |
| Jasny brąz | `#766440` | 118, 100, 64 | 7532 C | kolor wspierający, obramowania, tekst drugorzędny |
| Zieleń podstawowa | `#A0AF14` | 160, 175, 20 | 383 C | główne akcje, akcent marki, aktywne elementy |
| Jasna zieleń | `#B4C232` | 180, 194, 50 | 583 C | wariant wspierający, hover, pola wyróżnione |
| Pomarańczowo-brązowy | `#BD701E` | 189, 112, 30 | 723 C | oszczędny akcent i element ilustracyjny |

Biel jest dozwolonym tłem i kolorem wersji odwróconej logo. W komponentach nie wprowadzaj nowych surowych kolorów. Używaj kolejno tokenów komponentowych, semantycznych i dopiero w definicji systemu — prymitywów marki.

### Dostępność koloru

Poniższe wartości obliczono według WCAG z dokładnych wartości HEX.

| Para | Kontrast | Zastosowanie |
| --- | ---: | --- |
| ciemny brąz / zieleń podstawowa | 5,64:1 | tekst zwykły AA; zalecana para dla zielonych CTA |
| ciemny brąz / jasna zieleń | 6,99:1 | tekst zwykły AA |
| biel / ciemny brąz | 13,72:1 | tekst zwykły AAA |
| biel / jasny brąz | 5,73:1 | tekst zwykły AA |
| biel / zieleń podstawowa | 2,43:1 | nie używać dla tekstu ani istotnych kontrolek |
| ciemny brąz / pomarańczowo-brązowy | 3,59:1 | tylko duży tekst, grafika lub kontrolki; nie dla tekstu zwykłego |
| biel / pomarańczowo-brązowy | 3,82:1 | tylko duży tekst, grafika lub kontrolki; nie dla tekstu zwykłego |

Podstawowy przycisk na zielonym tle musi mieć ciemnobrązowy tekst. Nie wolno polegać wyłącznie na kolorze przy komunikowaniu stanu — dodaj etykietę, ikonę lub opis. Obramowanie fokusu ma być ciemnobrązowe na jasnym tle i białe na tle ciemnym.

## Typografia

Jedyną podstawową rodziną typograficzną jest **Road UA**. Pliki OTF wszystkich dostarczonych grubości znajdują się w `assets/brand/polska-flora/fonts/road-ua/`.

| Poziom | Krój | Rozmiar z brand booka | Odpowiednik cyfrowy przy 96 dpi |
| --- | --- | ---: | ---: |
| Nagłówek pierwszego poziomu | Road UA ExtraBold (800) | 48 pt | 64 px / 4 rem |
| Nagłówek drugiego poziomu | Road UA Bold (700) | 24 pt | 32 px / 2 rem |
| Tekst podstawowy | Road UA Regular (400) | 12 pt | 16 px / 1 rem |

W interfejsie można responsywnie zmniejszyć nagłówki, ale należy zachować ich wagę, hierarchię i proporcję. Tekst podstawowy powinien mieć co najmniej 16 px, interlinię 1,5 oraz kontrast minimum 4,5:1. Dla dłuższych tekstów zalecana szerokość wiersza to 65–75 znaków. Nie stosuj bardzo cienkich odmian dla małego tekstu.

## Elementy identyfikacji

### Wzór

Sześć oryginalnych, bezszwowych wariantów znajduje się w `assets/brand/polska-flora/identity/pattern/`. Wzór może wypełniać tło lub geometryczny kontener. Skaluje się go proporcjonalnie; nie wolno go rozciągać ani samodzielnie zmieniać kolorów.

### Pattern tree

Trzy wydłużone warianty znajdują się w `assets/brand/polska-flora/identity/pattern-tree/`. Są przeznaczone do pionowych lub wysokich kompozycji i mogą tworzyć przejście pomiędzy fotografią a polem koloru.

### Tree

Pięć wariantów samodzielnego motywu drzewa znajduje się w `assets/brand/polska-flora/identity/tree/`. W odróżnieniu od logo motyw identyfikacyjny może być powiększany i częściowo wychodzić poza kadr, zgodnie z przykładami z brand booka. Nadal należy zachować proporcje i używać wyłącznie dostarczonych wersji kolorystycznych.

### Kompozycja

- Stosuj zdecydowane pola koloru i proste figury geometryczne jako kontenery treści.
- Wprowadzaj duży motyw drzewa w przestrzeń zdjęcia lub sekcji, zachowując czytelność tekstu.
- W pojedynczym komponencie ogranicz liczbę aktywnych kolorów; pomarańczowo-brązowy pozostaje akcentem.
- Fotografia i treść nie mogą naruszać pola ochronnego logo.
- Nie traktuj patternu ani motywu drzewa jako zamiennika logo.

## Architektura tokenów

Tokeny mają trzy warstwy:

1. `primitive` — wyłącznie surowe wartości zatwierdzonej palety, Road UA, skala odstępów, promienie i czasy;
2. `semantic` — role takie jak `primary`, `foreground`, `border`, typografia i odstępy;
3. `component` — kontrakty przycisku, karty, pola formularza, nawigacji, badge'a i logo.

Kod komponentów powinien odwoływać się do warstwy `component`. Zmiana motywu odbywa się przez aliasy semantyczne; nie przez nadpisywanie prymitywów. W CSS ciemny motyw jest aktywowany atrybutem `[data-theme="dark"]`.

## Kontrola przed publikacją

- wybrano poprawny, oryginalny wariant logo dla tła i formatu;
- zachowano minimalny rozmiar, pole ochronne i proporcje;
- użyto wyłącznie zatwierdzonej palety oraz Road UA;
- zwykły tekst osiąga minimum 4,5:1, a fokus i kontrolki minimum 3:1;
- zielone CTA mają ciemnobrązową etykietę;
- elementy identyfikacji pochodzą z katalogu `assets/brand/polska-flora/identity/` i nie zostały przekolorowane;
- w kodzie komponentów nie ma surowych wartości HEX ani własnych kopii logo.
