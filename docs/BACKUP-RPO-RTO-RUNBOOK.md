# Backup RPO/RTO runbook

Cel: miec mierzalna polityke backupu i odtwarzania dla ARBOR, zanim platforma trafi do realnego uzycia oddzialu.

Ten dokument nie zawiera sekretow. Wszystkie hasla, connection stringi i klucze szyfrowania ustawiaj w terminalu, panelu hostingu albo managerze sekretow.

## 1. Cele RPO/RTO

Minimalne cele na pilot i pierwsza produkcje:

- Standardowa praca dzienna: RPO <= 24h, RTO <= 4h.
- Po migracji, imporcie danych, bootstrapie admina albo duzej zmianie produkcyjnej: RPO <= 15 min, czyli backup od razu po zmianie.
- Restore drill: minimum raz w miesiacu na swiezej albo swiadomie replaceable bazie.
- Retencja: `BACKUP_RETAIN_DAYS=14` minimum, 30 dni dla stabilnej produkcji.
- Szyfrowanie: `BACKUP_ENCRYPT_KEY` zalecane dla backupow przenoszonych poza lokalna maszyne/operatora.

## 2. Lokalna bramka

```powershell
cd C:\Users\paha1\arbor
npm run verify:backup-rpo
npm run backup:db:check
npm run backup:db
npm run restore:db:check
```

`backup:db:check` i `restore:db:check` sa bezpieczne jako bramka gotowosci. Prawdziwy `restore:db` wolno uruchomic tylko na bazie wymiennej albo po decyzji wlasciciela incydentu.

## 3. Harmonogram operacyjny

- Przed pierwszym realnym uzyciem: migracje, bootstrap admina, `backup:db`, `restore:db:check`.
- W pilocie: backup po kazdym imporcie, migracji, masowej zmianie statusow albo zmianie konfiguracji integracji.
- Codziennie: backup raz na dobe po zakonczeniu dnia operacyjnego.
- Co miesiac: restore drill na replaceable bazie i zapis dowodow.
- Po incydencie P1/P0: backup po naprawie, nawet jesli byl robiony tego samego dnia.

## 4. Zmienne i narzedzia

Wymagane:

- `DATABASE_URL` albo komplet `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`.
- `PG_DUMP_BIN`, jesli `pg_dump` nie jest w PATH.
- `PG_RESTORE_BIN`, jesli `pg_restore` nie jest w PATH.

Zalecane:

- `BACKUP_RETAIN_DAYS=14` albo `30`.
- `BACKUP_ENCRYPT_KEY=<long-private-passphrase>`.
- `BACKUP_DIR=<path>` przy zewnetrznym katalogu backupow.

Restore:

- `RESTORE_FILE=<path>` albo `-- --file "<path>"`.
- `RESTORE_CLEAN=1` tylko gdy chcesz restore z `--clean --if-exists`.
- `CONFIRM_RESTORE=YES` jest wymagane przy prawdziwym restore.

## 5. Backup po zmianie produkcyjnej

```powershell
$env:DATABASE_URL="postgresql://<user>:<password>@<host>/<db>?sslmode=require"
$env:BACKUP_RETAIN_DAYS="14"
$env:BACKUP_ENCRYPT_KEY="<long-private-passphrase>"
npm run backup:db:check
npm run backup:db
npm run restore:db:check
```

Oczekiwany artefakt:

- `C:\Users\paha1\arbor\os\backups\latest.dump`
- albo `C:\Users\paha1\arbor\os\backups\latest.dump.enc`

## 6. Restore drill na replaceable bazie

Nigdy nie uzywaj tego kroku na produkcyjnej bazie bez decyzji wlasciciela incydentu.

```powershell
$env:RESTORE_FILE="C:\Users\paha1\arbor\os\backups\latest.dump"
$env:DATABASE_URL="postgresql://<user>:<password>@<replaceable-host>/<replaceable-db>?sslmode=require"
npm run restore:db:check -- --file "C:\Users\paha1\arbor\os\backups\latest.dump"
```

Jesli dry-run jest zielony:

```powershell
$env:CONFIRM_RESTORE="YES"
npm run restore:db -- --file "C:\Users\paha1\arbor\os\backups\latest.dump"
npm run deploy:prod:doctor
npm run smoke:render -- https://<arbor-os-url>
```

Restore z czyszczeniem istniejacych obiektow:

```powershell
$env:RESTORE_CLEAN="1"
$env:CONFIRM_RESTORE="YES"
npm run restore:db -- --file "C:\Users\paha1\arbor\os\backups\latest.dump"
```

## 7. Dowody wykonania

Do wpisu operacyjnego albo incydentu zapisz:

- `started_at`, `finished_at`, operator, cel: backup albo restore drill.
- RPO: czas od ostatniej zmiany danych do powstania backupu.
- RTO: czas od startu restore drill do zielonego `smoke:render`.
- Sciezka pliku backupu, rozmiar MB, `latest.dump` albo `latest.dump.enc`.
- Czy `BACKUP_ENCRYPT_KEY` byl uzyty.
- Docelowa baza restore oznaczona jako replaceable.
- Wynik `restore:db:check`, `deploy:prod:doctor` i `smoke:render`.
- Follow-upy, jesli RPO > 24h, RTO > 4h albo restore dry-run nie przechodzi.

## 8. GO / NO-GO

GO:

- `npm run verify:backup-rpo` przechodzi.
- `backup:db:check`, `backup:db` i `restore:db:check` sa zielone.
- Najnowszy plik istnieje jako `latest.dump` albo `latest.dump.enc`.
- Retencja jest ustawiona przez `BACKUP_RETAIN_DAYS`.
- Restore drill byl wykonany na replaceable bazie w ostatnim miesiacu.
- Po drill `deploy:prod:doctor` i `smoke:render` przechodza.

NO-GO:

- Brakuje `pg_dump` albo `pg_restore`.
- Brakuje aktualnego `latest.dump` / `latest.dump.enc`.
- `restore:db:check` nie czyta najnowszego dumpa.
- Ktos probuje restore na produkcji bez decyzji wlasciciela incydentu.
- Prawdziwy restore jest uruchamiany bez `CONFIRM_RESTORE=YES`.
- Produkcja na Render uzywa `UPLOAD_STORAGE=local` dla realnych zalacznikow.
- Brakuje wlasciciela, timestampow albo artefaktow potwierdzenia.
