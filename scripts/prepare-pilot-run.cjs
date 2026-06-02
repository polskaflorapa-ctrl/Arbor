const path = require('node:path');

const { createPilotRunReport, defaultGatesReport } = require('./create-pilot-run-report.cjs');
const { runPilotGates } = require('./run-pilot-gates.cjs');

const root = path.resolve(__dirname, '..');

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function parseArgs(argv) {
  const options = {
    date: todayIso(),
    force: false,
    runGates: false,
    dryRun: false,
    full: false,
    continueOnFail: true,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--force') {
      options.force = true;
    } else if (arg === '--run-gates') {
      options.runGates = true;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--full') {
      options.full = true;
    } else if (arg === '--stop-on-fail') {
      options.continueOnFail = false;
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

function gateCommand(options) {
  const args = ['npm run pilot:gates:run --', `--date ${options.date}`];
  if (options.full) args.push('--full');
  if (options.continueOnFail) args.push('--continue-on-fail');
  return args.join(' ');
}

function preparePilotRun(options = parseArgs(process.argv.slice(2))) {
  const decisionPath = createPilotRunReport({
    date: options.date,
    force: options.force,
    gatesReport: defaultGatesReport(options.date),
  });
  const relativeDecisionPath = path.relative(root, decisionPath);
  const gatesReport = defaultGatesReport(options.date);

  console.log(`[pilot-run] decision report: ${relativeDecisionPath}`);
  console.log(`[pilot-run] gates report: ${gatesReport}`);
  console.log(`[pilot-run] gates command: ${gateCommand(options)}`);

  if (options.runGates || options.dryRun) {
    const result = runPilotGates({
      date: options.date,
      dryRun: options.dryRun,
      full: options.full,
      continueOnFail: options.continueOnFail,
    });
    return { decisionPath, gatesReport, gatesResult: result };
  }

  return { decisionPath, gatesReport, gatesCommand: gateCommand(options) };
}

if (require.main === module) {
  try {
    preparePilotRun();
  } catch (error) {
    console.error(`[pilot-run] FAILED: ${error.message}`);
    process.exit(1);
  }
}

module.exports = {
  gateCommand,
  parseArgs,
  preparePilotRun,
};
