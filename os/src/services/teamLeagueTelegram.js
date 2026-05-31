const { env } = require('../config/env');
const { getTeamRankings } = require('./teamRankings');

function number(value) {
  return Number(value || 0);
}

function formatInt(value) {
  return Math.round(number(value)).toLocaleString('pl-PL');
}

function formatMoney(value) {
  return `${formatInt(value)} PLN`;
}

function formatHours(value) {
  return `${number(value).toLocaleString('pl-PL', { maximumFractionDigits: 1 })} h`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function lineTeam(row) {
  const crew = row.brygadzista_nazwa ? `${row.ekipa_nazwa} (${row.brygadzista_nazwa})` : row.ekipa_nazwa;
  return [
    `${row.rank}. ${crew}`,
    `${formatInt(row.score)} pkt`,
    `${formatInt(row.completed_tasks)}/${formatInt(row.total_tasks)} zlecen`,
    `${formatHours(row.logged_hours || row.planned_hours)}`,
    formatMoney(row.revenue),
  ].join(' | ');
}

function lineBranch(row) {
  return [
    `${row.rank}. ${row.oddzial_nazwa}`,
    `${formatInt(row.score)} pkt`,
    `${formatInt(row.teams_count)} ekip`,
    `${formatInt(row.completed_tasks)}/${formatInt(row.total_tasks)} zlecen`,
    formatMoney(row.revenue),
  ].join(' | ');
}

function buildWeeklyTeamLeagueMessage(ranking, options = {}) {
  const week = ranking?.periods?.week || {};
  const teams = Array.isArray(week.items) ? week.items : [];
  const branches = Array.isArray(ranking?.branches?.week) ? ranking.branches.week : [];
  const topTeams = teams.slice(0, Number(options.limit || 5));
  const topBranches = branches.slice(0, Number(options.branchLimit || 6));
  const reportCount = teams.reduce((sum, row) => sum + number(row.reports_count), 0);
  const taskCount = teams.reduce((sum, row) => sum + number(row.total_tasks), 0);
  const completedCount = teams.reduce((sum, row) => sum + number(row.completed_tasks), 0);
  const revenue = teams.reduce((sum, row) => sum + number(row.revenue), 0);
  const hours = teams.reduce((sum, row) => sum + number(row.logged_hours || row.planned_hours), 0);

  const lines = [
    '<b>Liga brygad - raport tygodniowy</b>',
    `${escapeHtml(week.from || '')} - ${escapeHtml(week.to || '')}`,
    '',
    `<b>Podsumowanie:</b> ${formatInt(reportCount)} raportow, ${formatInt(completedCount)}/${formatInt(taskCount)} zlecen, ${formatHours(hours)}, ${formatMoney(revenue)}`,
  ];

  if (topTeams.length) {
    lines.push('', '<b>TOP brygady:</b>');
    for (const row of topTeams) lines.push(escapeHtml(lineTeam(row)));
  } else {
    lines.push('', 'Brak raportow dziennych w tym tygodniu.');
  }

  if (topBranches.length) {
    lines.push('', '<b>Oddzialy:</b>');
    for (const row of topBranches) lines.push(escapeHtml(lineBranch(row)));
  }

  return `${lines.join('\n')}\n`;
}

async function sendTelegramMessage(text, options = {}) {
  const token = options.token || env.TELEGRAM_BOT_TOKEN;
  const chatId = options.chatId || env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    throw new Error('Brak konfiguracji Telegram: TELEGRAM_BOT_TOKEN i TELEGRAM_CHAT_ID');
  }

  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: options.parseMode || env.TELEGRAM_PARSE_MODE || 'HTML',
      disable_web_page_preview: true,
    }),
  });
  const body = await res.text();
  if (!res.ok) {
    throw new Error(`Telegram sendMessage failed: ${res.status} ${body.slice(0, 300)}`);
  }
  try {
    return JSON.parse(body);
  } catch {
    return { ok: true, raw: body };
  }
}

async function buildWeeklyTeamLeague(pool, user, options = {}) {
  const ranking = await getTeamRankings(pool, user, { as_of: options.as_of, oddzial_id: options.oddzial_id });
  return {
    ranking,
    text: buildWeeklyTeamLeagueMessage(ranking, options),
  };
}

async function publishWeeklyTeamLeague(pool, user, options = {}) {
  const payload = await buildWeeklyTeamLeague(pool, user, options);
  if (options.dryRun) return { ...payload, telegram: null, dryRun: true };
  const telegram = await sendTelegramMessage(payload.text, options.telegram || {});
  return { ...payload, telegram, dryRun: false };
}

module.exports = {
  buildWeeklyTeamLeague,
  buildWeeklyTeamLeagueMessage,
  publishWeeklyTeamLeague,
  sendTelegramMessage,
};
