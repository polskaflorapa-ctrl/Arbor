#!/usr/bin/env node
/**
 * GET /api/automations/team-league/tick - weekly Telegram team league.
 *
 * URL: first argument or PROD_URL or BASE_URL
 * Secret: second argument or OPS_CRON_SECRET
 */
const baseUrl = process.argv[2] || process.env.PROD_URL || process.env.BASE_URL;
const secret = process.argv[3] || process.env.OPS_CRON_SECRET;

if (!baseUrl || !secret) {
  console.error(
    'Usage: node scripts/trigger-weekly-team-league.js <BASE_URL> <OPS_CRON_SECRET>\n' +
      '   or: PROD_URL=... OPS_CRON_SECRET=... node scripts/trigger-weekly-team-league.js'
  );
  process.exit(2);
}

const normalized = baseUrl.replace(/\/+$/, '');
const params = new URLSearchParams({ secret });
if (process.env.TEAM_LEAGUE_AS_OF) params.set('as_of', process.env.TEAM_LEAGUE_AS_OF);
if (process.env.TEAM_LEAGUE_ODDZIAL_ID) params.set('oddzial_id', process.env.TEAM_LEAGUE_ODDZIAL_ID);
if (process.env.TEAM_LEAGUE_DRY_RUN === '1' || process.env.TEAM_LEAGUE_DRY_RUN === 'true') {
  params.set('dry_run', '1');
}

(async () => {
  const res = await fetch(`${normalized}/api/automations/team-league/tick?${params.toString()}`);
  const text = await res.text();
  if (!res.ok) {
    console.error(`FAIL status=${res.status}`);
    console.error(text.slice(0, 800));
    process.exit(1);
  }
  console.log('OK team league weekly report');
  try {
    console.log(JSON.stringify(JSON.parse(text), null, 2));
  } catch {
    console.log(text);
  }
})();
