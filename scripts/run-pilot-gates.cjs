const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const runsDir = path.join(root, 'docs', 'pilot-runs');

const CORE_GATES = [
  ['npm', ['run', 'status:json:strict']],
  ['npm', ['run', 'verify:pilot-closure']],
  ['npm', ['run', 'verify:pilot-execution']],
  ['npm', ['run', 'verify:pilot-hardening']],
  ['npm', ['run', 'verify:rbac-scope']],
  ['npm', ['run', 'verify:kommo-idempotency-retry']],
  ['npm', ['run', 'verify:kommo-sms-drill']],
  ['npm', ['run', 'verify:backup-rpo']],
  ['npm', ['run', 'verify:observability']],
  ['npm', ['run', 'verify:web-tti']],
  ['npm', ['run', 'smoke:critical-path']],
];

const FULL_GATES = [
  ['npm', ['run', 'check']],
  ['npm', ['run', 'smoke:operational']],
  ['npm', ['run', 'smoke:demo:e2e']],
];

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function usage() {
  return [
    'Usage: npm run pilot:gates:run -- --date YYYY-MM-DD [--dry-run] [--full] [--continue-on-fail]',
    '',
    'Runs automated pilot gates and writes docs/pilot-runs/PILOT-AUTOMATED-GATES-YYYY-MM-DD.md.',
    '',
    'Options:',
    '  --date YYYY-MM-DD       Pilot run date.',
    '  --dry-run               Print planned gates without running them.',
    '  --full                  Include slower full gates: check, operational smoke and demo e2e.',
    '  --continue-on-fail      Keep running gates after a failure.',
    '  --help                  Show this help.',
  ].join('\n');
}

function parseArgs(argv) {
  const options = {
    date: todayIso(),
    dryRun: false,
    full: false,
    continueOnFail: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--full') {
      options.full = true;
    } else if (arg === '--continue-on-fail') {
      options.continueOnFail = true;
    } else if (arg === '--date') {
      options.date = argv[index + 1];
      index += 1;
    } else if (arg.startsWith('--date=')) {
      options.date = arg.slice('--date='.length);
    }
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(options.date)) {
    throw new Error(`Invalid --date value "${options.date}". Use YYYY-MM-DD.`);
  }

  return options;
}

function formatCommand([command, args]) {
  return [command, ...args].join(' ');
}

function runGate(gate) {
  const startedAt = Date.now();
  const result = spawnSync(gate[0], gate[1], {
    cwd: root,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  const durationMs = Date.now() - startedAt;
  const output = `${result.stdout || ''}${result.stderr || ''}`.trim();

  return {
    command: formatCommand(gate),
    status: result.status === 0 ? 'PASS' : 'FAIL',
    exitCode: result.status,
    durationMs,
    output,
  };
}

function writeReport(options, results) {
  fs.mkdirSync(runsDir, { recursive: true });
  const reportPath = path.join(runsDir, `PILOT-AUTOMATED-GATES-${options.date}.md`);
  const lines = [
    `# Pilot automated gates - ${options.date}`,
    '',
    `Mode: ${options.full ? 'full' : 'core'}`,
    `Continue on fail: ${options.continueOnFail ? 'yes' : 'no'}`,
    '',
    '| Gate | Result | Exit | Duration ms |',
    '| --- | --- | --- | --- |',
    ...results.map((result) => `| \`${result.command}\` | ${result.status} | ${result.exitCode ?? ''} | ${result.durationMs} |`),
    '',
    '## Logs',
    '',
    ...results.flatMap((result) => [
      `### ${result.status} - ${result.command}`,
      '',
      '```text',
      result.output.slice(-6000),
      '```',
      '',
    ]),
  ];
  fs.writeFileSync(reportPath, `${lines.join('\n')}\n`);
  return reportPath;
}

function runPilotGates(options = parseArgs(process.argv.slice(2))) {
  const gates = options.full ? [...CORE_GATES, ...FULL_GATES] : CORE_GATES;
  if (options.dryRun) {
    console.log(`[pilot-gates] dry run (${options.full ? 'full' : 'core'})`);
    gates.forEach((gate) => console.log(`- ${formatCommand(gate)}`));
    return { ok: true, dryRun: true, planned: gates.length };
  }

  const results = [];
  for (const gate of gates) {
    console.log(`[pilot-gates] ${formatCommand(gate)}`);
    const result = runGate(gate);
    console.log(`[pilot-gates] ${result.status} (${result.durationMs} ms)`);
    results.push(result);
    if (result.status === 'FAIL' && !options.continueOnFail) break;
  }

  const reportPath = writeReport(options, results);
  const ok = results.every((result) => result.status === 'PASS') && results.length === gates.length;
  console.log(`[pilot-gates] report: ${path.relative(root, reportPath)}`);
  if (!ok) process.exitCode = 1;
  return { ok, reportPath, results };
}

if (require.main === module) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      console.log(usage());
      process.exit(0);
    }
    runPilotGates(options);
  } catch (error) {
    console.error(`[pilot-gates] FAILED: ${error.message}`);
    process.exit(1);
  }
}

module.exports = {
  CORE_GATES,
  FULL_GATES,
  parseArgs,
  runPilotGates,
  usage,
  writeReport,
};
