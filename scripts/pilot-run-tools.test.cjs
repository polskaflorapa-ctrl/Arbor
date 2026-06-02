const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createPilotRunReport,
  defaultGatesReport,
  parseArgs: parseReportArgs,
  usage: reportUsage,
} = require('./create-pilot-run-report.cjs');
const {
  gateCommand,
  parseArgs: parsePrepareArgs,
  preparePilotRun,
  usage: prepareUsage,
} = require('./prepare-pilot-run.cjs');
const {
  CORE_GATES,
  FULL_GATES,
  parseArgs: parseGateArgs,
  runPilotGates,
  usage: gatesUsage,
  writeReport,
} = require('./run-pilot-gates.cjs');

const root = path.resolve(__dirname, '..');
const runsDir = path.join(root, 'docs', 'pilot-runs');
const decisionReportPath = path.join(runsDir, 'PILOT-GO-NO-GO-2099-12-31.md');
const gateReportPath = path.join(runsDir, 'PILOT-AUTOMATED-GATES-2099-12-31.md');

function cleanup() {
  for (const file of [decisionReportPath, gateReportPath]) {
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
}

test('pilot run report generator creates a dated decision artifact', () => {
  cleanup();
  try {
    const outputPath = createPilotRunReport({ date: '2099-12-31', force: false });
    const text = fs.readFileSync(outputPath, 'utf8');

    assert.equal(outputPath, decisionReportPath);
    assert.match(text, /# Pilot GO \/ NO-GO decision - 2099-12-31/);
    assert.match(text, /- Data: 2099-12-31/);
    assert.match(text, /- Automatyczne bramki: docs\/pilot-runs\/PILOT-AUTOMATED-GATES-2099-12-31\.md/);
    assert.match(text, /Arbor OS URL:/);
    assert.throws(
      () => createPilotRunReport({ date: '2099-12-31', force: false }),
      /Report already exists/,
    );
  } finally {
    cleanup();
  }
});

test('pilot run report parser accepts date and force flags', () => {
  assert.deepEqual(parseReportArgs(['--date', '2099-12-31', '--force']), {
    date: '2099-12-31',
    force: true,
    gatesReport: 'docs/pilot-runs/PILOT-AUTOMATED-GATES-2099-12-31.md',
    help: false,
  });
  assert.deepEqual(parseReportArgs(['--date=2099-12-31', '--gates-report', 'custom.md']), {
    date: '2099-12-31',
    force: false,
    gatesReport: 'custom.md',
    help: false,
  });
  assert.equal(parseReportArgs(['--help']).help, true);
  assert.match(reportUsage(), /pilot:run:new/);
  assert.throws(() => parseReportArgs(['--date', '31-12-2099']), /YYYY-MM-DD/);
});

test('pilot run report default gates report matches the selected date', () => {
  assert.equal(
    defaultGatesReport('2099-12-31'),
    'docs/pilot-runs/PILOT-AUTOMATED-GATES-2099-12-31.md',
  );
});

test('pilot prepare command creates decision artifact and points to gates command', () => {
  cleanup();
  try {
    const result = preparePilotRun({
      date: '2099-12-31',
      force: false,
      runGates: false,
      dryRun: false,
      full: true,
      continueOnFail: true,
    });
    const text = fs.readFileSync(result.decisionPath, 'utf8');

    assert.equal(result.decisionPath, decisionReportPath);
    assert.equal(result.gatesReport, 'docs/pilot-runs/PILOT-AUTOMATED-GATES-2099-12-31.md');
    assert.equal(result.gatesCommand, 'npm run pilot:gates:run -- --date 2099-12-31 --full --continue-on-fail');
    assert.match(text, /PILOT-AUTOMATED-GATES-2099-12-31\.md/);
  } finally {
    cleanup();
  }
});

test('pilot prepare parser and gate command support execution flags', () => {
  const options = parsePrepareArgs(['--date=2099-12-31', '--force', '--run-gates', '--dry-run', '--full', '--stop-on-fail']);
  assert.deepEqual(options, {
    date: '2099-12-31',
    force: true,
    runGates: true,
    dryRun: true,
    full: true,
    continueOnFail: false,
    help: false,
  });
  assert.equal(gateCommand(options), 'npm run pilot:gates:run -- --date 2099-12-31 --full');
  assert.equal(parsePrepareArgs(['--help']).help, true);
  assert.match(prepareUsage(), /pilot:run:prepare/);
  assert.throws(() => parsePrepareArgs(['--date=nope']), /YYYY-MM-DD/);
});

test('pilot gates parser supports dry-run, full and continue-on-fail flags', () => {
  assert.deepEqual(parseGateArgs(['--date=2099-12-31', '--dry-run', '--full', '--continue-on-fail']), {
    date: '2099-12-31',
    dryRun: true,
    full: true,
    continueOnFail: true,
    help: false,
  });
  assert.equal(parseGateArgs(['--help']).help, true);
  assert.match(gatesUsage(), /pilot:gates:run/);
  assert.throws(() => parseGateArgs(['--date', 'tomorrow']), /YYYY-MM-DD/);
});

test('pilot gates dry-run reports planned core and full gate counts', () => {
  const core = runPilotGates({ date: '2099-12-31', dryRun: true, full: false, continueOnFail: false });
  const full = runPilotGates({ date: '2099-12-31', dryRun: true, full: true, continueOnFail: false });

  assert.equal(core.ok, true);
  assert.equal(core.planned, CORE_GATES.length);
  assert.equal(full.ok, true);
  assert.equal(full.planned, CORE_GATES.length + FULL_GATES.length);
});

test('pilot gates writer creates markdown PASS/FAIL evidence', () => {
  cleanup();
  try {
    const outputPath = writeReport(
      { date: '2099-12-31', full: false, continueOnFail: true },
      [
        { command: 'npm run status:json:strict', status: 'PASS', exitCode: 0, durationMs: 12, output: 'ok' },
        { command: 'npm run check', status: 'FAIL', exitCode: 1, durationMs: 34, output: 'broken' },
      ],
    );
    const text = fs.readFileSync(outputPath, 'utf8');

    assert.equal(outputPath, gateReportPath);
    assert.match(text, /# Pilot automated gates - 2099-12-31/);
    assert.match(text, /\| `npm run status:json:strict` \| PASS \| 0 \| 12 \|/);
    assert.match(text, /\| `npm run check` \| FAIL \| 1 \| 34 \|/);
    assert.match(text, /### FAIL - npm run check/);
  } finally {
    cleanup();
  }
});
