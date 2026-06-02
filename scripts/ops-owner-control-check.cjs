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
  assertIncludes('os/src/routes/ops.js', 'const riskType = cleanText(req.query.risk_type', 'risk_type filter in action history');
  assertIncludes('os/src/routes/ops.js', "COALESCE(e.metadata->>'risk_type', e.issue_key", 'metadata risk_type filter');
  assertIncludes('web/src/pages/KontrolaOperacyjna.js', 'OWNER_ACK_FILTERS', 'owner acknowledgement filters');
  assertIncludes('web/src/pages/KontrolaOperacyjna.js', "action_type: 'risk_acknowledge'", 'risk acknowledgement filter param');
  assertIncludes('web/src/pages/KontrolaOperacyjna.js', 'Rejestr potwierdzen ownerow', 'owner acknowledgement register');
  assertIncludes('web/src/pages/KontrolaOperacyjna.js', 'kommo_sync', 'Kommo owner filter');
  assertIncludes('web/src/pages/KontrolaOperacyjna.js', 'sms_delivery', 'SMS owner filter');
  assertIncludes('web/src/pages/KontrolaOperacyjna.test.js', "risk_type: 'sms_delivery'", 'SMS owner filter test');
  assertIncludes('os/tests/ops-kierownik-today.test.js', 'risk_type=kommo_sync', 'backend risk_type alias test');
  assertIncludes('docs/OPS-ALERT-OWNERSHIP-CONTRACT.md', 'Kontrola operacyjna', 'contract control note');

  console.log('ops owner control check passed');
}

main();
