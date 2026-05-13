# =============================================================================
# Arbor — pre-deploy verification + commit + push helper
# Uruchomienie:   .\deploy.ps1                           (pełny flow)
#                 .\deploy.ps1 -SkipTests                (pomiń testy)
#                 .\deploy.ps1 -DryRun                   (bez git push)
#                 .\deploy.ps1 -Branch production        (push na inny branch)
# =============================================================================

[CmdletBinding()]
param(
  [string]$RepoRoot = 'C:\Users\paha1\arbor',
  [string]$Branch = 'main',
  [switch]$SkipTests,
  [switch]$SkipLint,
  [switch]$SkipMobile,
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$startedAt = Get-Date

function Step($title) {
  Write-Host ''
  Write-Host ('━' * 78) -ForegroundColor DarkGray
  Write-Host (' ' + $title) -ForegroundColor Cyan
  Write-Host ('━' * 78) -ForegroundColor DarkGray
}

function Fail($msg) {
  Write-Host ''
  Write-Host '  X  ' -ForegroundColor Red -NoNewline
  Write-Host $msg -ForegroundColor Red
  Write-Host ''
  Write-Host 'Deploy ZATRZYMANY. Napraw bład i odpal ponownie.' -ForegroundColor Yellow
  exit 1
}

function Ok($msg) {
  Write-Host '  OK ' -ForegroundColor Green -NoNewline
  Write-Host $msg
}

function Run($cmd, $cwd) {
  Write-Host '  >  ' -ForegroundColor DarkGray -NoNewline
  Write-Host "($cwd) $cmd" -ForegroundColor DarkGray
  Push-Location $cwd
  try {
    Invoke-Expression $cmd
    if ($LASTEXITCODE -ne 0) { Fail "Komenda zwrocila kod $LASTEXITCODE: $cmd" }
  }
  finally { Pop-Location }
}

# ─── 0. Sanity ───────────────────────────────────────────────────────────────
Step '0/6  Sanity: ścieżki, git, node, npm'
if (-not (Test-Path $RepoRoot)) { Fail "Brak folderu: $RepoRoot" }
if (-not (Test-Path "$RepoRoot\.git")) { Fail "$RepoRoot nie jest repo gita." }
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Fail 'git nie znaleziony w PATH.' }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Fail 'node nie znaleziony w PATH.' }
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { Fail 'npm nie znaleziony w PATH.' }
Ok "Repo: $RepoRoot, branch docelowy: $Branch"
Ok ('node ' + (node -v) + ', npm ' + (npm -v))

# ─── 1. Status repo ──────────────────────────────────────────────────────────
Step '1/6  Status repo'
Push-Location $RepoRoot
try {
  $currentBranch = (git rev-parse --abbrev-ref HEAD).Trim()
  Ok "Aktualny branch: $currentBranch"
  if ($currentBranch -ne $Branch) {
    Write-Host ''
    Write-Host "  !  Jestes na '$currentBranch', a deployujesz '$Branch'." -ForegroundColor Yellow
    $ans = Read-Host '     Kontynuowac? (przelaczy gita)  [y/N]'
    if ($ans -ne 'y') { Fail 'Anulowane.' }
    git switch $Branch
    if ($LASTEXITCODE -ne 0) { Fail "git switch $Branch nie powiodl sie." }
  }
  $dirty = git status --porcelain
  if (-not $dirty) {
    Write-Host ''
    Write-Host '  i  Brak zmian do scommitowania. Nic do deployu.' -ForegroundColor Yellow
    Write-Host ''
    $ans = Read-Host 'Mimo to wymusic push (np. zeby Render zredeployowal)? [y/N]'
    if ($ans -ne 'y') { exit 0 }
  } else {
    Write-Host ''
    Write-Host '  Zmienione pliki:' -ForegroundColor White
    $dirty | ForEach-Object { Write-Host ('    ' + $_) -ForegroundColor Gray }
  }
}
finally { Pop-Location }

# ─── 2. Backend: install + lint + test ───────────────────────────────────────
Step '2/6  Backend (os): npm install + lint + test'
Run 'npm install --no-audit --no-fund' "$RepoRoot\os"
if (-not $SkipLint) { Run 'npm run lint' "$RepoRoot\os" } else { Write-Host '  ~  Lint pominiety' -ForegroundColor Yellow }
if (-not $SkipTests) { Run 'npm test' "$RepoRoot\os" } else { Write-Host '  ~  Testy pominiete' -ForegroundColor Yellow }
Ok 'Backend: zielone'

# ─── 3. Mobile: install + typecheck + lint ───────────────────────────────────
if (-not $SkipMobile) {
  Step '3/6  Mobile: npm install + typecheck + lint'
  Run 'npm install --no-audit --no-fund' "$RepoRoot\mobile"
  Run 'npm run typecheck' "$RepoRoot\mobile"
  if (-not $SkipLint) { Run 'npm run lint' "$RepoRoot\mobile" }
  Ok 'Mobile: zielone'
} else {
  Write-Host '  ~  Krok mobile pominiety (-SkipMobile)' -ForegroundColor Yellow
}

# ─── 4. ENV preflight ────────────────────────────────────────────────────────
Step '4/6  ENV preflight (PRZECZYTAJ)'
Write-Host ''
Write-Host '  Te ENV-y MUSZA byc ustawione w Render dashboard PRZED deployem' -ForegroundColor Yellow
Write-Host '  inaczej cos sie zepsuje:' -ForegroundColor Yellow
Write-Host ''
Write-Host '    TRUST_PROXY = 1' -ForegroundColor White
Write-Host '    KOMMO_QUOTATION_WEBHOOK_SECRET = <silny string >=32 znakow>' -ForegroundColor White
Write-Host '       (bez tego webhook Kommo zacznie zwracac 401)' -ForegroundColor DarkGray
Write-Host '    METRICS_TOKEN = <silny string >=32 znakow>  (jesli METRICS_ENABLED=true)' -ForegroundColor White
Write-Host '       (bez tego /api/metrics zwroci 401 w prod)' -ForegroundColor DarkGray
Write-Host ''
$ans = Read-Host 'Potwierdzasz, ze ENV-y sa ustawione w Render dashboard? [y/N]'
if ($ans -ne 'y') { Fail 'Najpierw ustaw ENV-y, potem deploy. Inaczej kommo + metrics padna.' }

# ─── 5. Commit ───────────────────────────────────────────────────────────────
Step '5/6  Git commit'
Push-Location $RepoRoot
try {
  git add -A
  $defaultMsg = @'
fix: hardening + cleanup po diagnostyce

Backend (os):
- trust proxy z konfiguracja przez ENV (rate-limitery widza prawdziwe IP)
- /api/db-test wymaga JWT w prod
- /api/metrics wymaga METRICS_TOKEN w prod
- kommoQuotationWebhook: fail-closed checkSecret + crypto.timingSafeEqual
- routes/quotation-public: walidacja Zod (action + token)
- routes/auth: login limiter na express-rate-limit zamiast in-memory Map()
- middleware/rate-limit: dodany loginLimiter
- package.json: eslint v10 (nie istnieje) -> v9, main: src/server.js, engines.node

Mobile:
- babel.config.js: dodany react-native-worklets/plugin (Reanimated 4 fix)
- app.json: bundleIdentifier + android.package = com.arbor.mobile
- package.json: lodash 4.18 (nie istnieje) -> 4.17.21, usuniete pdfkit / @types/react-native
- app/(tabs)/_layout.tsx: usuniete 5 fantomowych Tabs.Screen, zostaly index + explore
- app/dashboard.tsx: stan loadError + banner zamiast cichego catch{}
- app/modal.tsx: redirect zamiast martwej templatki
'@
  Write-Host ''
  Write-Host '  Domyslny commit message:' -ForegroundColor White
  Write-Host ($defaultMsg.Split([Environment]::NewLine) | ForEach-Object { '    ' + $_ }) -ForegroundColor Gray
  Write-Host ''
  $msg = Read-Host 'Enter = uzyj domyslnego, albo wpisz wlasny one-liner'
  if (-not $msg) { $msg = $defaultMsg }
  $tmpFile = [System.IO.Path]::GetTempFileName()
  try {
    Set-Content -Path $tmpFile -Value $msg -Encoding UTF8
    git commit --file=$tmpFile
    if ($LASTEXITCODE -ne 0) { Fail 'git commit nie powiodl sie.' }
  } finally { Remove-Item $tmpFile -ErrorAction SilentlyContinue }
  Ok 'Commit OK'
}
finally { Pop-Location }

# ─── 6. Push ─────────────────────────────────────────────────────────────────
Step '6/6  Git push (Render auto-deploy)'
Push-Location $RepoRoot
try {
  if ($DryRun) {
    Write-Host '  ~  DryRun: pomijam git push' -ForegroundColor Yellow
  } else {
    git push origin $Branch
    if ($LASTEXITCODE -ne 0) { Fail 'git push nie powiodl sie.' }
    Ok 'Push OK -- Render zaczyna deploy'
  }
}
finally { Pop-Location }

Write-Host ''
Write-Host ('═' * 78) -ForegroundColor Green
Write-Host ' DEPLOY WYWOLANY' -ForegroundColor Green
Write-Host ('═' * 78) -ForegroundColor Green
$elapsed = (Get-Date) - $startedAt
Write-Host ('  Czas: ' + [int]$elapsed.TotalSeconds + 's') -ForegroundColor DarkGray
Write-Host ''
Write-Host '  Po 2-4 min sprawdz w przegladarce:' -ForegroundColor White
Write-Host '    https://arbor-os-dvf7.onrender.com/api/health' -ForegroundColor Cyan
Write-Host '       -> wersja: 2.1.0' -ForegroundColor DarkGray
Write-Host '    https://arbor-os-dvf7.onrender.com/api/payroll/rates/user/34' -ForegroundColor Cyan
Write-Host '       -> 401 (route istnieje, brak JWT)  [byl 404 = stary deploy]' -ForegroundColor DarkGray
Write-Host ''
Write-Host '  Jesli cos padlo: Render dashboard -> Manual Deploy -> wybierz poprzedni commit.' -ForegroundColor Yellow
Write-Host ''
