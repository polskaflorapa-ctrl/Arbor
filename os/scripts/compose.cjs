#!/usr/bin/env node
/**
 * Uruchamia `docker compose` z katalogu głównego repo.
 * Na Windowsie, gdy `docker` nie jest w PATH, próbuje typowej ścieżki Docker Desktop.
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const repoRoot = path.join(__dirname, '..');

function resolveDockerExecutable() {
    const tryRun = (cmd, args) => {
        const r = spawnSync(cmd, args, { stdio: 'ignore', encoding: 'utf8' });
        return !r.error && r.status === 0;
    };

    if (tryRun('docker', ['version'])) {
        return 'docker';
    }

    if (process.platform === 'win32') {
        const bases = [
            process.env.ProgramFiles,
            process.env['ProgramFiles(x86)'],
            'C:\\Program Files',
            'C:\\Program Files (x86)',
        ].filter(Boolean);

        for (const base of bases) {
            const candidates = [
                path.join(base, 'Docker', 'Docker', 'resources', 'bin', 'docker.exe'),
                path.join(base, 'Docker', 'Docker', 'Resources', 'bin', 'docker.exe'),
            ];
            for (const p of candidates) {
                if (fs.existsSync(p)) {
                    return p;
                }
            }
        }
    }

    return 'docker';
}

const docker = resolveDockerExecutable();
const composeArgs = process.argv.slice(2);
const r = spawnSync(docker, ['compose', ...composeArgs], {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: false,
});

if (r.error && r.error.code === 'ENOENT') {
    console.error(
        'Nie znaleziono Docker CLI. Zainstaluj Docker Desktop (Windows) lub dodaj `docker` do PATH, potem: npm run db:up',
    );
}

process.exit(r.status === null ? 1 : r.status ?? 1);
