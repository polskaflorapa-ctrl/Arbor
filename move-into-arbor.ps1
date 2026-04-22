# Uruchom PO zamknięciu Cursora/Expo/Metro i innych procesów trzymających pliki w tych folderach.
# Kolejność: najpierw mniej często blokowane, mobile na końcu (często workspace w Cursorze).
$ErrorActionPreference = "Continue"
$root = "C:\Users\paha1\arbor"
New-Item -ItemType Directory -Path $root -Force | Out-Null

$map = @(
    @{ From = "C:\Users\paha1\arbor-web";    To = Join-Path $root "web" },
    @{ From = "C:\Users\paha1\arbor-os";     To = Join-Path $root "os" },
    @{ From = "C:\Users\paha1\arbor-mobile"; To = Join-Path $root "mobile" }
)

$ok = 0
foreach ($m in $map) {
    if (-not (Test-Path -LiteralPath $m.From)) {
        Write-Warning "Pomijam (brak zrodla): $($m.From)"
        continue
    }
    if (Test-Path -LiteralPath $m.To) {
        Write-Warning "Cel juz istnieje: $($m.To)"
        continue
    }
    Write-Host "Przenosze $($m.From) -> $($m.To)"
    try {
        Move-Item -LiteralPath $m.From -Destination $m.To -ErrorAction Stop
        $ok++
        Write-Host "  OK"
    }
    catch {
        Write-Host "  BLAD: $($_.Exception.Message)"
    }
}

Write-Host "--- Struktura $root ---"
Get-ChildItem $root -Directory -ErrorAction SilentlyContinue | ForEach-Object { $_.Name }
Write-Host "Przeniesiono pomyslnie: $ok / $($map.Count)"
