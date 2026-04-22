#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * POST /api/automations/run-daily — do crona (GitHub Actions, Render Cron, lokalnie).
 *
 * URL: pierwszy argument lub PROD_URL lub BASE_URL
 * Token: drugi argument lub ADMIN_TOKEN lub SMOKE_TOKEN
 */
const baseUrl = process.argv[2] || process.env.PROD_URL || process.env.BASE_URL;
const token = process.argv[3] || process.env.ADMIN_TOKEN || process.env.SMOKE_TOKEN;

if (!baseUrl || !token) {
  console.error(
    'Usage: node scripts/trigger-daily-automations.js <BASE_URL> <ADMIN_BEARER_TOKEN>\n' +
      '   or: PROD_URL=... ADMIN_TOKEN=... node scripts/trigger-daily-automations.js\n' +
      '   or: BASE_URL=... SMOKE_TOKEN=... node scripts/trigger-daily-automations.js'
  );
  process.exit(2);
}

const normalized = baseUrl.replace(/\/+$/, '');

(async () => {
  const res = await fetch(`${normalized}/api/automations/run-daily`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: '{}',
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`FAIL status=${res.status}`);
    console.error(text.slice(0, 800));
    process.exit(1);
  }
  console.log('OK automation run-daily');
  try {
    console.log(JSON.stringify(JSON.parse(text), null, 2));
  } catch {
    console.log(text);
  }
})();
