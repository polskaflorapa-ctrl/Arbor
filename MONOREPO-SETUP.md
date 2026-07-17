# Arbor — jeden katalog (monorepo)

## Cel

Pod jednym rootem: `mobile/`, `web/`, `os/` (dawniej `arbor-mobile`, `arbor-web`, `arbor-os`).

## Dlaczego automatyczne `Move-Item` się nie udało

Na Windows katalog nie da się przenieść, jeśli **Cursor**, **Expo**, **Metro**, **node** lub inny proces trzyma otwarte pliki w środku.

## Co zrobić (najprościej)

1. **Zatrzymaj** dev serwery (`expo start`, `npm run dev`, itd.).
2. **Zamknij** okno Cursora, które ma workspace w `arbor-mobile` (albo przełącz workspace na inny folder).
3. Otwórz **nowe** okno PowerShell (nie z Cursora) i uruchom skrypt w root monorepo:

```powershell
powershell -ExecutionPolicy Bypass -File "C:\Users\paha1\arbor\move-into-arbor.ps1"
```

Albo ręcznie:

```powershell
$root = "C:\Users\paha1\arbor"
New-Item -ItemType Directory -Path $root -Force | Out-Null
Move-Item -LiteralPath "C:\Users\paha1\arbor-os"    -Destination "$root\os"     -Force
Move-Item -LiteralPath "C:\Users\paha1\arbor-web"   -Destination "$root\web"    -Force
Move-Item -LiteralPath "C:\Users\paha1\arbor-mobile" -Destination "$root\mobile" -Force
```

1. W Cursorze: **File → Open Folder** → `C:\Users\paha1\arbor` (albo tylko `mobile`, jeśli wolisz multi-root).

## Git

- **Opcja A:** jeden nowy repo w `arbor` (historia starych repo znika z roota — można później `git subtree` jeśli potrzebujesz).
- **Opcja B:** zostaw trzy remotes i submoduły — więcej roboty przy codziennej pracy.

Dla małego zespołu zwykle wygrywa **jeden repo** w `arbor`.

### `git push` — HTTP 500 / `RPC failed`

Przy dużym pushu albo chwilowym błędzie GitHuba (`RPC failed`, `HTTP 500`, remote disconnect):

```powershell
git config http.postBuffer 524288000
git push origin master
```

Możesz też przełączyć remote na SSH albo ponowić push po kilku minutach (warto sprawdzić [status GitHuba](https://www.githubstatus.com/)).

## Po przeniesieniu

W katalogu `arbor` uruchom `npm install` (jeśli używasz workspaces z `package.json` w root — dopiero wtedy ma sens).

Skrypty w root `package.json` są przykładowe; dostosuj nazwy skryptów w `web` / `os` / `mobile`, jeśli się różnią.

## Operacyjny zestaw komend (root `arbor`)

```powershell
npm run status        # szybki podgląd stanu (porty + health + sugestia)
npm run doctor        # diagnostyka i konkretne "Next"
npm run up            # uruchamia brakujące serwisy
npm run up:force      # czyści porty 3000/3001/3002 i stawia API+WEB od zera
npm run down          # zatrzymuje lokalny stack (porty 3000/3001/3002)
npm run restart:force # down + up:force (pełny reset)
npm run health        # sprawdza /api/health przez proxy target
```

## platform/ — Platforma Arbor OS (fuzja z repo „Polska Flora")

Kompletna platforma operacyjna: backend Express+Socket.IO (SQLite/PostgreSQL,
RBAC rola+oddział+tenant, portal klienta z tokenami i rewokacją, HR, workflows,
magazyn, faktury, realtime, RODO/retencja, backupy) + 4 panele (biuro, mobilka
HTML, gabinet wyceniającego, portal klienta) + deploy Docker/nginx.

**Celowo POZA workspaces** — własny `package-lock.json` i `node_modules`
(izolacja od hoistingu roota; Express 5 vs Express 4 w os/).

```powershell
npm run platform:install   # jednorazowo
npm run platform:seed      # dane demo (produkcyjnie: ARBOR_ADMIN_PASSWORD=... NODE_ENV=production)
npm run platform           # API :8790 + panele :5175
npm run platform:smoke     # pełny pakiet smoke (wymaga działającego API)
npm run platform:build     # build produkcyjny
npm run platform:backup    # backup bazy (rotacja)
```

Aplikacja mobilna (Expo) łączy się z platformą przez warstwę kompatybilności:
`EXPO_PUBLIC_API_URL=http://<host>:8790` — kontrakt /api/tasks/*, /api/ekipy,
/api/oddzialy itd. jest obsługiwany natywnie (platform/server/mobile-compat.mjs).
Wdrożenie produkcyjne: `platform/DEPLOY.md` (docker compose, nginx, backupy, TLS).
