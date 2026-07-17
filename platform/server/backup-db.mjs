// Backup bazy Arbor OS (cały stan firmy!). Uruchamiaj cyklicznie (cron / harmonogram):
//   npm run db:backup                     — lokalnie
//   docker compose exec api node server/backup-db.mjs   — w kontenerze (wolumen arbor_data)
// SQLite: atomowy snapshot przez VACUUM INTO (bezpieczny przy działającym API).
// PostgreSQL: zrzut dokumentu stanu do JSON (architektura trzyma stan w jednym wierszu JSONB);
//             pełny pg_dump rób dodatkowo na poziomie serwera PG.
// Rotacja: trzymamy ostatnich ARBOR_BACKUP_KEEP kopii (domyślnie 14).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, readdirSync, unlinkSync, writeFileSync, statSync } from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const driver = (process.env.DB_DRIVER || 'sqlite') === 'postgres' ? 'postgres' : 'sqlite';
const backupDir = process.env.ARBOR_BACKUP_DIR || path.join(__dirname, 'data', 'backups');
mkdirSync(backupDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const keep = Math.max(1, Number(process.env.ARBOR_BACKUP_KEEP || 14));

let target;
if (driver === 'sqlite') {
  const { DatabaseSync } = await import('node:sqlite');
  const source = path.join(__dirname, 'data', 'arbor-os.sqlite');
  target = path.join(backupDir, `arbor-backup-${stamp}.sqlite`);
  const db = new DatabaseSync(source);
  try {
    // VACUUM INTO tworzy spójny snapshot nawet przy równoległych zapisach.
    db.exec(`VACUUM INTO '${target.replaceAll('\\', '/').replaceAll("'", "''")}'`);
  } finally {
    db.close();
  }
} else {
  const pg = (await import('pg')).default;
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const result = await pool.query('SELECT doc FROM arbor_state WHERE id = 1');
    if (!result.rows[0]) throw new Error('Brak stanu w arbor_state — nie ma czego backupować');
    target = path.join(backupDir, `arbor-backup-${stamp}.json`);
    writeFileSync(target, JSON.stringify(result.rows[0].doc));
  } finally {
    await pool.end();
  }
}

// Rotacja starych kopii.
const backups = readdirSync(backupDir)
  .filter((name) => name.startsWith('arbor-backup-'))
  .sort();
for (const name of backups.slice(0, Math.max(0, backups.length - keep))) {
  unlinkSync(path.join(backupDir, name));
}

const sizeKb = Math.round(statSync(target).size / 1024);
console.log(`[backup] zapisano ${target} (${sizeKb} kB), kopii w rotacji: ${Math.min(backups.length, keep)}`);
