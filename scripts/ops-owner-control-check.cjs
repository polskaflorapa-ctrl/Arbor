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
  assertIncludes('os/src/services/opsDigest.js', 'kommo_owner_acknowledgements', 'Kommo owner acknowledgement digest KPI');
  assertIncludes('os/src/services/opsDigest.js', 'sms_owner_acknowledgements', 'SMS owner acknowledgement digest KPI');
  assertIncludes('os/src/routes/ops.js', 'owner_ack_status', 'CSV owner acknowledgement status');
  assertIncludes('os/src/routes/ops.js', "/owner-alerts/open", 'open owner alerts endpoint');
  assertIncludes('os/src/routes/ops.js', "/owner-alerts/actions", 'bulk owner alerts action endpoint');
  assertIncludes('os/src/routes/ops.js', 'risk_owner_escalate', 'owner alert escalation audit');
  assertIncludes('os/src/routes/ops.js', 'ownerAlertSla', 'owner alert SLA aging');
  assertIncludes('os/tests/ops-kierownik-today.test.js', 'reports unacknowledged Kommo/SMS owner alerts with SLA aging', 'open owner alerts backend test');
  assertIncludes('os/tests/ops-kierownik-today.test.js', 'stores audited bulk owner alert actions', 'bulk owner alerts backend test');
  assertIncludes('web/src/pages/KontrolaOperacyjna.js', 'Niedomkniete alerty ownerow', 'open owner alerts UI');
  assertIncludes('web/src/pages/KontrolaOperacyjna.js', 'Potwierdz widoczne', 'bulk acknowledge owner alerts UI');
  assertIncludes('web/src/pages/KontrolaOperacyjna.js', 'Eskaluj widoczne', 'bulk escalate owner alerts UI');
  assertIncludes('web/src/api.js', '/ops/owner-alerts/open', 'test-mode open owner alerts API');
  assertIncludes('web/src/api.js', '/ops/owner-alerts/actions', 'test-mode bulk owner alerts API');
  assertIncludes('web/src/pages/KontrolaOperacyjna.test.js', 'ARB-OPEN-KOMMO', 'open owner alerts UI test');
  assertIncludes('web/src/pages/KontrolaOperacyjna.test.js', "action: 'bulk_acknowledge'", 'bulk acknowledge UI test');
  assertIncludes('web/src/pages/KontrolaOperacyjna.test.js', "action: 'bulk_escalate'", 'bulk escalate UI test');
  assertIncludes('os/tests/opsDigest.test.js', 'Potwierdzenia ownerow: 3 domkniete', 'digest acknowledgement text test');
  assertIncludes('os/tests/ops-kierownik-today.test.js', 'Status potwierdzenia', 'CSV acknowledgement status test');
  assertIncludes('docs/OPS-ALERT-OWNERSHIP-CONTRACT.md', 'Kontrola operacyjna', 'contract control note');

  console.log('ops owner control check passed');
}

main();
