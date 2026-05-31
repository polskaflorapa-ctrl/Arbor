# ARBOR database backup and restore

This is the safety net for the free Render + Neon setup. Photos and PDFs should
live in R2/S3, while PostgreSQL data is protected with `pg_dump`.

## Requirements

- PostgreSQL client tools installed locally: `pg_dump` and `pg_restore`.
- `DATABASE_URL` set to the Neon pooled connection string, or local `DB_*` envs.
- Optional `BACKUP_ENCRYPT_KEY` for encrypted `.dump.enc` files.

If tools are not in PATH, set full paths:

```powershell
$env:PG_DUMP_BIN="C:\Program Files\PostgreSQL\16\bin\pg_dump.exe"
$env:PG_RESTORE_BIN="C:\Program Files\PostgreSQL\16\bin\pg_restore.exe"
```

## Check backup readiness

```powershell
$env:DATABASE_URL="postgresql://<user>:<password>@<neon-pooler-host>/<db>?sslmode=require"
npm run backup:db:check
```

## Create a backup

```powershell
$env:DATABASE_URL="postgresql://<user>:<password>@<neon-pooler-host>/<db>?sslmode=require"
$env:BACKUP_RETAIN_DAYS="14"
npm run backup:db
```

Default output goes to `C:\Users\paha1\arbor\os\backups` and is ignored by git.
The script also writes `latest.dump` for quick checks.

Encrypted backup:

```powershell
$env:BACKUP_ENCRYPT_KEY="<long-private-passphrase>"
npm run backup:db
```

Encrypted output uses `latest.dump.enc`.

## RPO/RTO targets

Operational RPO/RTO is defined in `docs/BACKUP-RPO-RTO-RUNBOOK.md`.
Minimum pilot targets are RPO <= 24h and RTO <= 4h. After migration, import,
admin bootstrap or other major production change, take a backup within 15 min
and verify it with a restore dry-run. Run a monthly restore drill on a fresh or
intentionally replaceable database and record the evidence.

## Verify a backup before restore

```powershell
npm run restore:db:check
npm run restore:db:check -- --file "C:\Users\paha1\arbor\os\backups\arbor_2026-05-18-10-30.dump"
```

For encrypted files, set the same key first:

```powershell
$env:BACKUP_ENCRYPT_KEY="<long-private-passphrase>"
npm run restore:db:check -- --file "C:\Users\paha1\arbor\os\backups\latest.dump.enc"
```

## Restore

Use restore on a fresh or intentionally replaceable database. The command refuses
to run until `CONFIRM_RESTORE=YES` is set.

```powershell
$env:DATABASE_URL="postgresql://<user>:<password>@<target-host>/<target-db>?sslmode=require"
$env:CONFIRM_RESTORE="YES"
npm run restore:db -- --file "C:\Users\paha1\arbor\os\backups\latest.dump"
```

To clean existing objects before restore:

```powershell
$env:RESTORE_CLEAN="1"
$env:CONFIRM_RESTORE="YES"
npm run restore:db -- --file "C:\Users\paha1\arbor\os\backups\latest.dump"
```

## Operating rule

- Before first real use: create backup after migration and admin bootstrap.
- During pilot: backup after each import or major production change.
- Daily company use: backup at least once per day, keep 14-30 days.
- Monthly: run `restore:db:check` against the newest backup so we know the file is readable.
