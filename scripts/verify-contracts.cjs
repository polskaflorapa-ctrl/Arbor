#!/usr/bin/env node
const { spawnSync } = require('node:child_process');

const CONTRACT_SCRIPTS = [
  'verify:backup-rpo',
  'verify:competency-expiry-monitoring',
  'verify:dispatcher-adr',
  'verify:dispatcher-day-plan',
  'verify:dispatcher-competency-consistency',
  'verify:env-runbook',
  'verify:equipment-cards',
  'verify:equipment-usage-rules',
  'verify:fleet-repair-due-controls',
  'verify:fleet-repair-parts-cost',
  'verify:incident-runbook',
  'verify:integrations-release',
  'verify:kommo-idempotency-retry',
  'verify:kommo-sms-drill',
  'verify:machine-cards-crud',
  'verify:mobile-before-after-photo',
  'verify:mobile-material-cost-flow',
  'verify:mobile-offline-conflicts',
  'verify:mobile-photo-enforcement',
  'verify:mobile-problem-flow',
  'verify:mobile-start-stop-edge',
  'verify:mobile-today-cache',
  'verify:money-flow',
  'verify:observability',
  'verify:ops-alert-owner-ui',
  'verify:ops-alert-ownership',
  'verify:ops-owner-control',
  'verify:ops-owner-remediation-closure',
  'verify:pilot-hardening',
  'verify:planning-map',
  'verify:polska-flora-ready',
  'verify:rbac-scope',
  'verify:render-unified',
  'verify:resource-calendar-dnd',
  'verify:resource-calendar-week',
  'verify:scale-readiness',
  'verify:team-competency-assignment-block',
  'verify:warehouse-materials',
  'verify:warehouse-mobile-usage',
  'verify:web-tti',
  'verify:worklog-timesheet',
];

function runNpmScript(script) {
  const command = process.platform === 'win32' ? 'cmd.exe' : 'npm';
  const args = process.platform === 'win32'
    ? ['/d', '/s', '/c', `npm run ${script}`]
    : ['run', script];

  console.log(`\n[verify-contracts] ${script}`);
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.status !== 0) {
    throw new Error(`${script} failed`);
  }
}

function main() {
  for (const script of CONTRACT_SCRIPTS) {
    runNpmScript(script);
  }
  console.log('\n[verify-contracts] OK');
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`[verify-contracts] FAILED: ${error.message}`);
    process.exit(1);
  }
}

module.exports = {
  CONTRACT_SCRIPTS,
  runNpmScript,
};
