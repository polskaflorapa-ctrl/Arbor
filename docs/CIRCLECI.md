# CircleCI

Projekt ma pipeline CircleCI w `.circleci/config.yml`.

## Co uruchamia CircleCI

Workflow `verify` działa na zwykłych branchach i pull requestach:

- `scripts`: testy skryptów repo przez `npm run verify:scripts`.
- `mobile`: typecheck i lint aplikacji mobilnej przez `npm run verify:mobile`, plus `expo-doctor`.
- `web`: testy Vitest z raportem JUnit, potem produkcyjny build weba.
- `os`: lint backendu przez `npm run verify:os`.
- `os-tests`: testy backendu Jest z raportem JUnit.
- `verify-green`: końcowy status zbiorczy po przejściu wszystkich jobów weryfikacyjnych.

Workflow `deploy-ready` działa tylko na `main` i `master`:

- `deploy-ready`: deploy preflight, build weba i typecheck mobile.
- `deploy-ready-green`: końcowy status zbiorczy dla preflightu deployu.

## Podłączenie repo w CircleCI

1. Wejdź w CircleCI: `https://app.circleci.com/projects`.
2. Wybierz GitHub organization z repo `polskaflorapa-ctrl/Arbor`.
3. Kliknij `Set Up Project`.
4. Wybierz opcję użycia istniejącej konfiguracji z repo.
5. Upewnij się, że CircleCI wskazuje `.circleci/config.yml`.
6. Uruchom pierwszy pipeline na branchu `master`.

## GitHub Branch Protection

Jako wymagany status dla pull requestów ustaw:

- `verify-green`

Nie ustawiaj `deploy-ready-green` jako wymaganego statusu dla każdego PR. Ten workflow działa tylko na `main` i `master`, więc feature branche mogą czekać na status, który nigdy nie powstanie.

`deploy-ready-green` można traktować jako osobny status dla głównej gałęzi albo release flow.

## Checklista Pierwszego Runu

Przed podpięciem albo po zmianach w `.circleci/config.yml` odpal lokalnie:

```powershell
npm run verify:circleci
```

Po pierwszym uruchomieniu sprawdź:

- CircleCI wykrył `.circleci/config.yml`.
- `npm ci` przechodzi na obrazie Node `22.12`.
- Job `web` pokazuje wyniki Vitest w zakładce `Tests`.
- Job `os-tests` pokazuje wyniki Jest w zakładce `Tests`.
- `expo-doctor` przechodzi w linuxowym środowisku CircleCI.
- `deploy-ready` uruchamia się na `main` albo `master`.
- `deploy-ready` nie uruchamia się na feature branchach.

## Jak Czytać Awarie

Jeśli pada `scripts`, najpierw odpal lokalnie:

```powershell
npm run verify:scripts
```

Jeśli pada `mobile`, odpal:

```powershell
npm run verify:mobile
cd mobile
npx expo-doctor
```

Jeśli pada `web`, odpal:

```powershell
npm test -w arbor-web
npm run verify:web
```

Jeśli pada `os`, odpal:

```powershell
npm run verify:os
```

Jeśli pada `os-tests`, odpal:

```powershell
npm run verify:os:test
```

## Raporty Testów

CircleCI zbiera JUnit XML z:

- `test-results/vitest/results.xml`
- `test-results/jest/results.xml`

Jeśli zakładka `Tests` jest pusta, sprawdź artifacts joba i upewnij się, że te pliki istnieją.

## Cache

Pipeline cache'uje `~/.npm`, nie `node_modules`.

To jest celowe: `npm ci` usuwa `node_modules` przed instalacją, więc cache całego drzewa zależności zwykle zwiększa transfer bez realnego zysku.

Klucz cache uwzględnia lockfile'e:

- `package-lock.json`
- `web/package-lock.json`
- `os/package-lock.json`
- `mobile/package-lock.json`

Jeśli instalacja zależności jest wolna, najpierw sprawdź czasy `restore_cache`, `npm ci` i `save_cache` w CircleCI. Dopiero potem zmieniaj strategię cache.

## Po Pierwszych Pipeline'ach

Po 2-3 runach sprawdź najwolniejsze joby:

- jeśli wolny jest `web`, rozważ split testów Vitest;
- jeśli wolny jest `npm ci`, przeanalizuj cache albo workspace;
- jeśli wolny lub niestabilny jest `mobile`, rozważ przeniesienie `expo-doctor` do osobnego joba;
- jeśli `deploy-ready` jest zbyt ciężki, zostaw go tylko dla głównej gałęzi, tak jak obecnie.
