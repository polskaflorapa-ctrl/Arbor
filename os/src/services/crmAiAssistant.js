const pool = require('../config/database');
const { generateAiText, getAiConfigurationStatus } = require('./aiProviders');

function parseJson(text) {
  const match = String(text || '').match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

function compactRows(rows, mapper) {
  return (rows || []).slice(0, 24).map(mapper);
}

function ruleBasedAssistant({ lead, messages, activities }) {
  const lastMessage = messages[0];
  const hasOutbound = messages.some((m) => m.direction === 'outbound');
  const hasInbound = messages.some((m) => m.direction === 'inbound');
  const openTask = activities.find((a) => a.type === 'task' && !a.completed_at);
  const stale = lastMessage?.created_at
    ? (Date.now() - new Date(lastMessage.created_at).getTime()) > 24 * 60 * 60 * 1000
    : false;
  const nextAction = openTask
    ? `Domknij zadanie: ${openTask.text}`
    : stale && hasOutbound && !hasInbound
      ? 'Wyślij follow-up lub zadzwoń, bo klient nie odpowiedział od ponad 24h.'
      : 'Ustal kolejny krok i zapisz go jako zadanie follow-up.';

  return {
    source: 'rules',
    summary: `${lead.title || 'Lead'}: etap ${lead.stage || 'Lead'}, wartość ${Number(lead.value || 0)} PLN. Wiadomości: ${messages.length}, aktywności: ${activities.length}.`,
    next_best_action: nextAction,
    suggested_reply: hasInbound
      ? 'Dzień dobry, dziękujemy za wiadomość. Potwierdzamy temat i wrócimy z konkretnym następnym krokiem.'
      : 'Dzień dobry, czy możemy potwierdzić kolejny krok w sprawie zgłoszenia?',
    lead_score: Math.max(10, Math.min(90, 40 + (hasInbound ? 20 : 0) + (Number(lead.value || 0) > 0 ? 15 : 0) - (stale ? 10 : 0))),
    risk: stale ? 'medium' : 'low',
  };
}

async function collectLeadContext(leadId) {
  const [leadRes, messagesRes, activitiesRes] = await Promise.all([
    pool.query(
      `SELECT l.*, o.imie as owner_imie, o.nazwisko as owner_nazwisko, o.login as owner_login
       FROM crm_leads l
       LEFT JOIN users o ON o.id = l.owner_user_id
       WHERE l.id = $1`,
      [leadId]
    ),
    pool.query(
      `SELECT channel, direction, sender_name, sender_handle, recipient_handle, subject, body, status, created_at
       FROM crm_lead_messages
       WHERE lead_id = $1
       ORDER BY created_at DESC
       LIMIT 24`,
      [leadId]
    ),
    pool.query(
      `SELECT type, text, due_at, completed_at, created_at
       FROM crm_lead_activities
       WHERE lead_id = $1
       ORDER BY created_at DESC
       LIMIT 24`,
      [leadId]
    ),
  ]);
  return {
    lead: leadRes.rows[0] || null,
    messages: messagesRes.rows || [],
    activities: activitiesRes.rows || [],
  };
}

async function generateLeadAssistant({ leadId }) {
  const context = await collectLeadContext(leadId);
  if (!context.lead) return null;
  const fallback = ruleBasedAssistant(context);
  if (!getAiConfigurationStatus().textAvailable) return fallback;

  const lead = context.lead;
  const ownerName = lead.owner_user_id
    ? [lead.owner_imie, lead.owner_nazwisko].filter(Boolean).join(' ').trim() || lead.owner_login
    : null;
  const payload = {
    lead: {
      id: lead.id,
      title: lead.title,
      stage: lead.stage,
      source: lead.source,
      value: Number(lead.value || 0),
      phone: lead.phone,
      email: lead.email,
      owner_name: ownerName,
      notes: lead.notes,
      next_action_at: lead.next_action_at,
      close_reason: lead.close_reason,
    },
    messages: compactRows(context.messages, (m) => ({
      channel: m.channel,
      direction: m.direction,
      status: m.status,
      subject: m.subject,
      body: m.body,
      created_at: m.created_at,
    })),
    activities: compactRows(context.activities, (a) => ({
      type: a.type,
      text: a.text,
      due_at: a.due_at,
      completed_at: a.completed_at,
      created_at: a.created_at,
    })),
  };

  const prompt = `Jestes asystentem CRM ARBOR-OS. Przeanalizuj leada i zwroc tylko JSON:
{
  "summary": "2 zdania po polsku",
  "next_best_action": "konkretna nastepna akcja",
  "suggested_reply": "krotka odpowiedz do klienta po polsku",
  "lead_score": 0-100,
  "risk": "low|medium|high"
}

Dane:
${JSON.stringify(payload)}`;

  const aiResult = await generateAiText({
    system: 'Odpowiadasz wylacznie poprawnym JSON bez Markdown. Nie wymyslaj faktow poza danymi.',
    messages: [{ role: 'user', content: prompt }],
    maxTokens: 700,
  });
  const parsed = parseJson(aiResult.text);
  return {
    ...fallback,
    ...(parsed && typeof parsed === 'object' ? parsed : { summary: aiResult.text }),
    source: 'ai',
    provider: aiResult.provider,
    model: aiResult.model,
  };
}

module.exports = {
  collectLeadContext,
  generateLeadAssistant,
  ruleBasedAssistant,
};
