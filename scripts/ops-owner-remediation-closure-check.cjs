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
  assertIncludes('os/src/routes/ops.js', "/owner-alerts/resolve", 'owner remediation resolve endpoint');
  assertIncludes('os/src/routes/ops.js', "actionType: 'risk_owner_resolve'", 'risk_owner_resolve audit event');
  assertIncludes('os/src/routes/ops.js', "follow_up: true", 'follow-up metadata');
  assertIncludes('os/src/routes/ops.js', "resolution_status: 'resolved'", 'resolved metadata');
  assertIncludes('os/src/routes/ops.js', "action: 'ops.owner_alert.resolve'", 'audit log action');
  assertIncludes('os/src/services/opsDigest.js', 'risk_owner_resolve', 'digest resolve exclusion');
  assertIncludes('os/src/services/opsDigest.js', "ack.action_type IN ('risk_acknowledge', 'risk_owner_resolve')", 'resolved alerts excluded from unresolved digest');
  assertIncludes('web/src/pages/KontrolaOperacyjna.js', '/ops/owner-alerts/resolve', 'resolve API call in control UI');
  assertIncludes('web/src/pages/KontrolaOperacyjna.js', 'ownerResolveAction', 'resolve loading state');
  assertIncludes('web/src/pages/KontrolaOperacyjna.js', 'Oznacz rozwiazane', 'resolve button');
  assertIncludes('web/src/pages/KontrolaOperacyjna.js', 'owner_unresolved_after_remediation', 'digest unresolved details');
  assertIncludes('web/src/api.js', '/ops/owner-alerts/resolve', 'test-mode resolve endpoint');
  assertIncludes('web/src/api.js', "['risk_acknowledge', 'risk_owner_resolve']", 'test-mode open alert exclusion');
  assertIncludes('os/tests/ops-kierownik-today.test.js', 'stores audited owner remediation follow-up resolution', 'backend resolve test');
  assertIncludes('os/tests/opsDigest.test.js', "expect(sql).toContain('risk_owner_resolve')", 'digest resolve exclusion test');
  assertIncludes('web/src/pages/KontrolaOperacyjna.test.js', "source: 'control'", 'control resolve UI test');
  assertIncludes('web/src/pages/KontrolaOperacyjna.test.js', "source: 'digest'", 'digest resolve UI test');
  assertIncludes('docs/OPS-OWNER-REMEDIATION-CLOSURE-CONTRACT.md', 'EPIC 9.14', 'closure contract');
  assertIncludes('docs/OPS-ALERT-OWNERSHIP-CONTRACT.md', '/ops/owner-alerts/resolve', 'ownership contract resolve endpoint');
  assertIncludes('docs/PILOT-ONE-BRANCH-CHECKLIST.md', 'verify:ops-owner-remediation-closure', 'pilot checklist verifier');
  assertIncludes('docs/ARBOR-full-scope-implementation-backlog.md', 'ops owner remediation closure', 'backlog done item');
  assertIncludes('package.json', 'verify:ops-owner-remediation-closure', 'package verifier script');

  console.log('ops owner remediation closure check passed');
}

main();
