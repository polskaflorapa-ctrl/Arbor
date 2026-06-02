const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { createPilotRunReport, parseArgs: parseReportArgs } = require('./create-pilot-run-report.cjs');
const { CORE_GATES, FULL_GATES, parseArgs: parseGateArgs, runPilotGates, writeReport } = require('./run-pilot-gates.cjs');

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
  });
  assert.deepEqual(parseReportArgs(['--date=2099-12-31']), {
    date: '2099-12-31',
    force: false,
  });
  assert.throws(() => parseReportArgs(['--date', '31-12-2099']), /YYYY-MM-DD/);
});

test('pilot gates parser supports dry-run, full and continue-on-fail flags', () => {
  assert.deepEqual(parseGateArgs(['--date=2099-12-31', '--dry-run', '--full', '--continue-on-fail']), {
    date: '2099-12-31',
    dryRun: true,
    full: true,
    continueOnFail: true,
  });
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
