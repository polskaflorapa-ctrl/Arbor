# =============================================================================
# Generuje silne sekrety do wklejenia w Render dashboard.
# Uruchomienie:  .\generate-secrets.ps1
# =============================================================================

function NewSecret([int]$bytes = 48) {
  $b = New-Object byte[] $bytes
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
  return [Convert]::ToBase64String($b)
}

Write-Host ''
Write-Host '┌──────────────────────────────────────────────────────────────────────────┐'
Write-Host '│  Sekrety do wklejenia w Render → Service → Environment                    │'
Write-Host '│  Generowane lokalnie (RNG), nigdzie nie wysylane.                         │'
Write-Host '└──────────────────────────────────────────────────────────────────────────┘'
Write-Host ''

Write-Host 'TRUST_PROXY' -ForegroundColor Cyan
Write-Host '  1' -ForegroundColor White
Write-Host '  (numer hopów reverse-proxy. Render = 1.)' -ForegroundColor DarkGray
Write-Host ''

Write-Host 'KOMMO_QUOTATION_WEBHOOK_SECRET' -ForegroundColor Cyan
Write-Host ('  ' + (NewSecret 48)) -ForegroundColor White
Write-Host '  (ten sam string ustaw w Kommo jako naglowek X-Arbor-Webhook-Secret)' -ForegroundColor DarkGray
Write-Host ''

Write-Host 'METRICS_TOKEN' -ForegroundColor Cyan
Write-Host ('  ' + (NewSecret 48)) -ForegroundColor White
Write-Host '  (tylko jesli METRICS_ENABLED=true; uzywaj jako ?token=<...> lub Bearer)' -ForegroundColor DarkGray
Write-Host ''

Write-Host '─────────────────────────────────────────────────────────────────────────────'
Write-Host '  ZAPISZ JE W BEZPIECZNYM MIEJSCU (np. password manager) PRZED DEPLOYEM.'
Write-Host '─────────────────────────────────────────────────────────────────────────────'
Write-Host ''
