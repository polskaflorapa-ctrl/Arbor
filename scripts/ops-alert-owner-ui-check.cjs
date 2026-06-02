const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function assertIncludes(file, needle, label = needle) {
  const text = read(file);
  if (!text.includes(needle)) {
    throw new Error(`${file} missing ${label}`);
  }
}

function main() {
  assertIncludes('os/src/routes/tasks.js', 'kommoSyncOwnerMeta', 'Kommo owner metadata');
  assertIncludes('os/src/routes/tasks.js', 'req.query.oddzial_id', 'Kommo branch filter');
  assertIncludes('os/src/routes/sms.js', 'smsDeliveryOwnerMeta', 'SMS owner metadata');
  assertIncludes('os/src/routes/sms.js', 'oddzial_id: z.coerce.number', 'SMS branch filter schema');

  assertIncludes('web/src/pages/Integracje.js', 'Filtr oddzialu Kommo', 'Kommo branch filter UI');
  assertIncludes('web/src/pages/Integracje.js', "risk_type: riskType", 'Kommo acknowledge risk type');
  assertIncludes('web/src/pages/Integracje.js', "api.post('/ops/risk-report/actions'", 'Kommo acknowledge action');
  assertIncludes('web/src/pages/Integracje.js', 'owner_label', 'Kommo owner label UI');

  assertIncludes('web/src/pages/Telefonia.js', 'Filtr oddzialu SMS', 'SMS branch filter UI');
  assertIncludes('web/src/pages/Telefonia.js', "risk_type: 'sms_delivery'", 'SMS acknowledge risk type');
  assertIncludes('web/src/pages/Telefonia.js', "api.post('/ops/risk-report/actions'", 'SMS acknowledge action');
  assertIncludes('web/src/pages/Telefonia.js', 'owner_label', 'SMS owner label UI');

  assertIncludes('docs/OPS-ALERT-OWNERSHIP-CONTRACT.md', 'Panel Integracje', 'Integracje contract note');
  assertIncludes('docs/OPS-ALERT-OWNERSHIP-CONTRACT.md', 'Panel Telefonia', 'Telefonia contract note');

  console.log('ops alert owner UI check passed');
}

main();
