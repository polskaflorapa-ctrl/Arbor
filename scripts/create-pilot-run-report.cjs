const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const templatePath = path.join(root, 'docs', 'PILOT-GO-NO-GO-DECISION-TEMPLATE.md');
const runsDir = path.join(root, 'docs', 'pilot-runs');

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function defaultGatesReport(date) {
  return `docs/pilot-runs/PILOT-AUTOMATED-GATES-${date}.md`;
}

function usage() {
  return [
    'Usage: npm run pilot:run:new -- --date YYYY-MM-DD [--force] [--gates-report path]',
    '',
    'Creates docs/pilot-runs/PILOT-GO-NO-GO-YYYY-MM-DD.md from the pilot decision template.',
    '',
    'Options:',
    '  --date YYYY-MM-DD       Pilot run date.',
    '  --force                 Overwrite an existing decision report.',
    '  --gates-report path     Link a custom automated gates report path.',
    '  --help                  Show this help.',
  ].join('\n');
}

function parseArgs(argv) {
  const options = { date: todayIso(), force: false, gatesReport: null, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--force') {
      options.force = true;
    } else if (arg === '--gates-report') {
      options.gatesReport = argv[index + 1];
      index += 1;
    } else if (arg.startsWith('--gates-report=')) {
      options.gatesReport = arg.slice('--gates-report='.length);
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
  if (!options.gatesReport) options.gatesReport = defaultGatesReport(options.date);
  return options;
}

function createPilotRunReport(options = parseArgs(process.argv.slice(2))) {
  if (!fs.existsSync(templatePath)) {
    throw new Error('Missing docs/PILOT-GO-NO-GO-DECISION-TEMPLATE.md');
  }
  const gatesReport = options.gatesReport || defaultGatesReport(options.date);

  fs.mkdirSync(runsDir, { recursive: true });
  const outputPath = path.join(runsDir, `PILOT-GO-NO-GO-${options.date}.md`);
  if (fs.existsSync(outputPath) && !options.force) {
    throw new Error(`Report already exists: ${path.relative(root, outputPath)}. Use --force to overwrite.`);
  }

  const template = fs.readFileSync(templatePath, 'utf8');
  const content = template
    .replace('# Pilot GO / NO-GO decision template', `# Pilot GO / NO-GO decision - ${options.date}`)
    .replace('Ten plik jest szablonem; po probie skopiuj go do artefaktu z data, np. `docs/pilot-runs/PILOT-GO-NO-GO-2026-06-02.md`.', `Artefakt utworzony z szablonu w dniu ${options.date}.`)
    .replace('- Data:', `- Data: ${options.date}`)
    .replace('- Automatyczne bramki:', `- Automatyczne bramki: ${gatesReport}`);

  fs.writeFileSync(outputPath, content);
  return outputPath;
}

if (require.main === module) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      console.log(usage());
      process.exit(0);
    }
    const outputPath = createPilotRunReport(options);
    console.log(`Created ${path.relative(root, outputPath)}`);
  } catch (error) {
    console.error(`[pilot-run-report] FAILED: ${error.message}`);
    process.exit(1);
  }
}

module.exports = {
  createPilotRunReport,
  defaultGatesReport,
  parseArgs,
  usage,
};
