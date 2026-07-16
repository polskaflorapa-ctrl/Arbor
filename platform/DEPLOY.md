# Arbor OS — wdrożenie produkcyjne

Front (host prototypów + prototypy) buduje się przez Vite do `dist/` i jest serwowany przez **nginx**,
który proxuje `/api` i `/socket.io` do kontenera **api** (Express + Socket.IO). Ten sam origin → bez CORS,
działa WebSocket. Baza domyślnie **SQLite** (wolumen), opcjonalnie **PostgreSQL**.

## 1. Konfiguracja

```bash
cp .env.example .env
# Uzupełnij WYMAGANE sekrety (wygeneruj losowo, np. openssl rand -hex 32):
#   ARBOR_JWT_SECRET=...
#   ARBOR_PORTAL_SECRET=...
#   ARBOR_ENCRYPTION_KEY=...     # szyfrowanie at-rest (RODO)
# WYMAGANE do zalogowania się w produkcji (konta bez hasła są zablokowane):
#   ARBOR_ADMIN_PASSWORD=...     # hasło konta 'admin' nadawane przy seedzie
#   ARBOR_USERS_PASSWORD=...     # (opcjonalnie) wspólne hasło startowe pozostałych kont
# Integracje (opcjonalne; bez nich tryb demo):
#   ZADARMA_KEY / ZADARMA_SECRET / ZADARMA_SIP
#   DEEPGRAM_API_KEY (lub OPENAI_API_KEY) + OPENAI_API_KEY do scoringu rozmów
```

## 2. Uruchomienie

```bash
docker compose up -d --build
# Front:   http://localhost:8080
# Health:  http://localhost:8080/api/health
```

Pierwsze uruchomienie — zaseeduj dane startowe (jednorazowo):

```bash
docker compose exec api node server/seed-db.mjs
# Seed nadaje hasła z ARBOR_ADMIN_PASSWORD / ARBOR_USERS_PASSWORD (env kontenera api).
# Potem zaloguj się jako 'admin' i pozmieniaj hasła/konta:
#   Kadry → dodaj realnych pracowników;  PATCH /api/users/:id/password zmienia hasła.
```

> **Uwaga (produkcja):** API działa z `NODE_ENV=production` — konta bez hasła **nie mogą się
> logować**, a serwer nie wystartuje ze słabym `ARBOR_JWT_SECRET`. Jeśli seed odpalisz bez
> `ARBOR_ADMIN_PASSWORD`, log API wypisze ostrzeżenie o zablokowanych kontach.

## 3. PostgreSQL zamiast SQLite (opcjonalnie)

1. Odkomentuj usługę `db` w `docker-compose.yml`.
2. W `.env`:
   ```
   DB_DRIVER=postgres
   DATABASE_URL=postgresql://arbor:TWOJE_HASLO@db:5432/arbor_os
   POSTGRES_PASSWORD=TWOJE_HASLO
   ```
3. `docker compose up -d --build` → app wybierze sterownik `postgres-db.mjs` (log: `[db] sterownik: PostgreSQL`).

Selektor sterownika: `server/db.mjs` (czyta `DB_DRIVER`) — kod biznesowy bez zmian.

## 4. Backup (OBOWIĄZKOWY na żywej instancji)

Cały stan firmy (klienci, zlecenia, faktury, HR) żyje w jednej bazie. Skonfiguruj cron
na hoście (np. co 6 h):

```bash
docker compose exec api node server/backup-db.mjs
# SQLite → atomowy snapshot VACUUM INTO; Postgres → zrzut dokumentu stanu do JSON.
# Kopie: /app/server/data/backups (wolumen arbor_data), rotacja ARBOR_BACKUP_KEEP (domyślnie 14).
```

Kopiuj katalog backups poza host (S3/rsync). **Restore (SQLite):** zatrzymaj api,
podmień `arbor-os.sqlite` na wybraną kopię w wolumenie, uruchom api.

Dodatkowe bezpieczniki: `server/seed-db.mjs` odmawia nadpisania niepustej produkcyjnej
bazy bez `ARBOR_FORCE_RESET=1`; `ARBOR_ENABLE_DEV_RESET=1` w produkcji blokuje start API.

## 5. Seed produkcyjny vs demo

W `NODE_ENV=production` seed jest **minimalny** (firma, oddziały, konta startowe,
konfiguracja — zero fikcyjnych klientów/zleceń). Pełne dane demo: ustaw `ARBOR_SEED_DEMO=1`.

## 6. Webhooki / integracje

- Zadarma PBX webhook → `https://TWOJ-HOST/api/zadarma/webhook` (walidacja `zd_echo` obsłużona).
- Bez kluczy integracje działają w trybie demo (deterministyczny wynik) — aplikacja jest w pełni używalna.

## 7. Status weryfikacji

- ✅ `npm run build` (tsc + vite) — front buduje się czysto do `dist/`.
- ✅ **PostgreSQL zweryfikowany w runtime**: pełny `smoke:all` (core/tenant/realtime/branch/ui)
  przechodzi na realnym PG (sterownik `postgres-db.mjs`: retry przy starcie, serializacja zapisów,
  persist-przed-cache, obsługa błędów puli). Smoke na PG: uruchom API z `ARBOR_ENABLE_DEV_RESET=1`
  + `ARBOR_DEV_RESET_SECRET`, potem `VITE_ARBOR_API_URL=... ARBOR_DEV_RESET_SECRET=... npm run smoke:all`
  (reset musi iść przez API — patrz uwaga single-writer w `postgres-db.mjs`).
- ✅ Tryb produkcyjny zweryfikowany lokalnie: `NODE_ENV=production` + seed minimalny +
  `ARBOR_ADMIN_PASSWORD` → logowanie hasłem działa, konta bez hasła odrzucane.
- ⚠️ `docker compose up` — **nieuruchomione w tym środowisku** (silnik Docker Desktop nie wstaje);
  pliki są kompletne i zgodne ze specyfikacją. Zweryfikuj `docker compose build` w docelowym środowisku.
- 🔒 Sekrety tylko po stronie serwera (api). Nginx nie eksponuje `.env`. Wolumen `arbor_data` trzyma bazę SQLite.

## 8. Reverse proxy / HTTPS (produkcja)

Postaw przed `web` terminację TLS (Traefik / Caddy / nginx z certbotem) i kieruj ruch na port `8080`.
Front używa origin przeglądarki do wołań API (`window.location.origin`), więc działa pod dowolnym hostem/HTTPS.
