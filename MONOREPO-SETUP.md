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
