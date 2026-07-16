import { createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const API = process.env.VITE_ARBOR_API_URL || 'http://127.0.0.1:8790';
const ZADARMA_SECRET = process.env.ZADARMA_SECRET || 'dev-zadarma-secret';

async function request(path, init = {}) {
  const response = await fetch(API + path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(`${response.status} ${path}: ${text}`);
  return data;
}

async function expectStatus(path, status, init = {}) {
  const response = await fetch(API + path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  if (response.status !== status) {
    const text = await response.text();
    throw new Error(`Expected ${status} for ${path}, got ${response.status}: ${text}`);
  }
}

async function requestText(path, init = {}) {
  const response = await fetch(API + path, {
    ...init,
    headers: {
      ...(init.headers || {}),
    },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${response.status} ${path}: ${text}`);
  return text;
}

async function login(login) {
  const data = await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify(typeof login === 'string' ? { login } : login),
  });
  return {
    user: data.user,
    headers: { Authorization: `Bearer ${data.token}` },
  };
}

function signWebhook(body) {
  return createHmac('sha256', ZADARMA_SECRET).update(body).digest('hex');
}

async function main() {
  const bridgeSource = await readFile(new URL('../public/prototypes/prototype-api-bridge.js', import.meta.url), 'utf8');
  if (
    !bridgeSource.includes('function logout()')
    || !bridgeSource.includes("localStorage.setItem(loggedOutKey, 'true')")
    || !bridgeSource.includes('function loggedOutError(message)')
    || !bridgeSource.includes("err.code = 'LOGGED_OUT'")
    || !bridgeSource.includes('throw loggedOutError()')
    || bridgeSource.includes("localStorage.getItem(loginKey) !== defaultLogin")
  ) {
    throw new Error('Prototype bridge auth/logout flow is not protected against silent default re-login');
  }
  await expectStatus('/api/bootstrap', 401);
  await expectStatus('/api/dev/reset', 401, { method: 'POST', body: JSON.stringify({}) });

  const webhookCallId = `smoke-${Date.now()}`;
  const webhookBody = JSON.stringify({
    caller_id: `+48 700 ${String(Date.now()).slice(-3)} ${String(Date.now()).slice(-3)}`,
    direction: 'inbound',
    branchId: 'krk',
    subject: 'Smoke Zadarma lead',
    city: 'Krakow',
    address: 'Smoke webhook 1, Krakow',
    call_id: webhookCallId,
    durationSec: 91,
  });
  await expectStatus('/api/zadarma/webhook', 401, {
    method: 'POST',
    headers: { 'x-zadarma-signature': 'bad-signature' },
    body: webhookBody,
  });
  const webhook = await request('/api/zadarma/webhook', {
    method: 'POST',
    headers: { 'x-zadarma-signature': signWebhook(webhookBody) },
    body: webhookBody,
  });
  if (!webhook.payload?.clientId || !webhook.payload?.orderId || !webhook.payload?.communicationId || !webhook.payload.createdOrder || !webhook.payload.createdCommunication) {
    throw new Error(`Zadarma webhook did not create CRM lead/order: ${JSON.stringify(webhook)}`);
  }
  const recordBody = JSON.stringify({
    event: 'NOTIFY_RECORD',
    branchId: 'krk',
    call_id_with_rec: webhookCallId,
    recordingUrl: '/recordings/demo/zadarma-smoke-notify.mp3',
    promptId: 'prompt-1',
    transcript: [
      { speaker: 'Biuro', text: 'Dzien dobry, Polska Flora, zapisujemy rozmowe z centrali Zadarma.', atSec: 0 },
      { speaker: 'Klient', text: 'Chce umowic termin ogledzin, sa ryzyka przy ogrodzeniu i budynku.', atSec: 16 },
      { speaker: 'Biuro', text: 'Wyslemy SMS z terminem i poprosimy o zdjecia do wyceny.', atSec: 43 },
    ],
  });
  await expectStatus('/api/zadarma/webhook', 200, {
    method: 'POST',
    headers: { 'x-zadarma-signature': signWebhook(recordBody) },
    body: recordBody,
  });

  const roles = {};
  for (const role of ['admin', 'kierownik', 'wycena', 'brygadzista', 'ksiegowa']) {
    const session = await login(role);
    const boot = await request('/api/bootstrap', { headers: session.headers });
    roles[role] = {
      user: boot.currentUserId,
      orders: boot.orders.length,
      valuations: boot.valuations.length,
      invoices: boot.invoices.length,
      channels: boot.realtime.channels,
      session,
      boot,
    };
  }

  if (roles.brygadzista.invoices !== 0) throw new Error('Brygadzista must not see invoices');
  if (roles.ksiegowa.invoices < 1) throw new Error('Księgowa should see invoices');

  if (roles.kierownik.boot.users.some((user) => Object.hasOwn(user, 'passwordHash'))) throw new Error('Bootstrap must not expose passwordHash');
  if ((roles.kierownik.boot.branchScope?.branchIds ?? []).includes('waw')) {
    throw new Error(`Krakow manager must not start with Warsaw branch scope: ${JSON.stringify(roles.kierownik.boot.branchScope)}`);
  }
  if (roles.kierownik.boot.branches.some((branch) => branch.id === 'waw') || roles.kierownik.boot.crews.some((crew) => crew.branchId === 'waw')) {
    throw new Error(`Krakow manager leaked Warsaw data before delegation: ${JSON.stringify({ branches: roles.kierownik.boot.branches, crews: roles.kierownik.boot.crews })}`);
  }

  if (roles.admin.boot.integrationSettings?.tenantId !== 'tenant-pf' || !roles.admin.boot.integrationHealth?.status) {
    throw new Error(`Integration settings missing from admin bootstrap: ${JSON.stringify(roles.admin.boot.integrationSettings)}`);
  }
  const unusedPrompt = await request('/api/ai-prompts', {
    method: 'POST',
    headers: roles.admin.session.headers,
    body: JSON.stringify({
      name: 'Smoke unused prompt',
      kind: 'follow_up',
      status: 'draft',
      body: 'Zwroc JSON: score, summary, intent, strengths, improvements, risks, nextActions dla follow-up.',
      changeNote: 'Smoke create unused prompt',
    }),
  });
  if (unusedPrompt.prompt.tenantId !== 'tenant-pf' || unusedPrompt.activeVersion.version !== 1 || unusedPrompt.prompt.status !== 'draft') {
    throw new Error(`AI prompt create failed: ${JSON.stringify(unusedPrompt)}`);
  }
  const deletedUnusedPrompt = await request(`/api/ai-prompts/${unusedPrompt.prompt.id}`, {
    method: 'DELETE',
    headers: roles.admin.session.headers,
  });
  if (!deletedUnusedPrompt.deleted || deletedUnusedPrompt.archived || deletedUnusedPrompt.prompt !== null) {
    throw new Error(`Unused AI prompt should be deleted: ${JSON.stringify(deletedUnusedPrompt)}`);
  }
  const usedPrompt = await request('/api/ai-prompts', {
    method: 'POST',
    headers: roles.admin.session.headers,
    body: JSON.stringify({
      name: 'Smoke used prompt',
      kind: 'office_call',
      status: 'active',
      body: 'Zwroc JSON: score, summary, intent, strengths, improvements, risks, nextActions oraz coaching dla rozmowy.',
      changeNote: 'Smoke create used prompt',
    }),
  });
  const updatedUsedPrompt = await request(`/api/ai-prompts/${usedPrompt.prompt.id}`, {
    method: 'PATCH',
    headers: roles.admin.session.headers,
    body: JSON.stringify({
      name: 'Smoke used prompt v2',
      status: 'active',
      body: 'Zwroc JSON: score, summary, intent, strengths, improvements, risks, nextActions, missingQuestions i coaching.',
      changeNote: 'Smoke prompt v2',
    }),
  });
  if (updatedUsedPrompt.prompt.version !== 2 || updatedUsedPrompt.activeVersion.version !== 2 || updatedUsedPrompt.prompt.name !== 'Smoke used prompt v2') {
    throw new Error(`AI prompt update/version failed: ${JSON.stringify(updatedUsedPrompt)}`);
  }
  const usedPromptVersions = await request(`/api/ai-prompts/${usedPrompt.prompt.id}/versions`, { headers: roles.admin.session.headers });
  if (usedPromptVersions.versions.length < 2 || !usedPromptVersions.versions.some((version) => version.version === 1)) {
    throw new Error(`AI prompt versions missing history: ${JSON.stringify(usedPromptVersions)}`);
  }
  const testedPrompt = await request(`/api/ai-prompts/${usedPrompt.prompt.id}/test`, {
    method: 'POST',
    headers: roles.admin.session.headers,
    body: JSON.stringify({ sampleTranscript: 'Klient pyta o termin ogledzin, ryzyka przy budynku, zdjecia i kolejny kontakt SMS.' }),
  });
  if (testedPrompt.promptId !== usedPrompt.prompt.id || !['pass', 'review'].includes(testedPrompt.status)) {
    throw new Error(`AI prompt test failed: ${JSON.stringify(testedPrompt)}`);
  }
  const rolledBackPrompt = await request(`/api/ai-prompts/${usedPrompt.prompt.id}/rollback`, {
    method: 'POST',
    headers: roles.admin.session.headers,
    body: JSON.stringify({ version: 1 }),
  });
  if (rolledBackPrompt.prompt.version !== 1 || rolledBackPrompt.activeVersion.version !== 1 || rolledBackPrompt.activeVersion.status !== 'active') {
    throw new Error(`AI prompt rollback failed: ${JSON.stringify(rolledBackPrompt)}`);
  }
  const promptBack = await request('/api/ai-prompts', { headers: roles.admin.session.headers });
  if (!promptBack.some((prompt) => prompt.id === usedPrompt.prompt.id) || promptBack.some((prompt) => prompt.id === unusedPrompt.prompt.id)) {
    throw new Error(`AI prompt list failed: ${JSON.stringify(promptBack)}`);
  }
  const promptCommunication = await request('/api/communications', {
    method: 'POST',
    headers: roles.admin.session.headers,
    body: JSON.stringify({
      type: 'call',
      clientId: 'c-1',
      direction: 'inbound',
      channel: 'manual',
      status: 'completed',
      subject: 'Smoke prompt archive call',
      transcript: [
        { speaker: 'Klient', text: 'Chce termin ogledzin, mam ryzyka przy ogrodzeniu i moge wyslac zdjecia.', atSec: 0 },
        { speaker: 'Biuro', text: 'Potwierdzimy SMS i przygotujemy wycene.', atSec: 25 },
      ],
    }),
  });
  const promptAnalysis = await request(`/api/communications/${promptCommunication.id}/analyze`, {
    method: 'POST',
    headers: roles.admin.session.headers,
    body: JSON.stringify({ promptId: usedPrompt.prompt.id }),
  });
  if (promptAnalysis.communication.analysisPromptId !== usedPrompt.prompt.id || !promptAnalysis.analysis?.score) {
    throw new Error(`AI prompt analysis failed: ${JSON.stringify(promptAnalysis)}`);
  }
  const archivedUsedPrompt = await request(`/api/ai-prompts/${usedPrompt.prompt.id}`, {
    method: 'DELETE',
    headers: roles.admin.session.headers,
  });
  if (!archivedUsedPrompt.archived || archivedUsedPrompt.deleted || archivedUsedPrompt.prompt.status !== 'archived' || !archivedUsedPrompt.prompt.deletedAt) {
    throw new Error(`Used AI prompt should be archived: ${JSON.stringify(archivedUsedPrompt)}`);
  }
  await expectStatus(`/api/communications/${promptCommunication.id}/analyze`, 404, {
    method: 'POST',
    headers: roles.admin.session.headers,
    body: JSON.stringify({ promptId: usedPrompt.prompt.id }),
  });
  const promptBackAfterArchive = await request('/api/ai-prompts', { headers: roles.admin.session.headers });
  if (promptBackAfterArchive.some((prompt) => prompt.id === usedPrompt.prompt.id)) {
    throw new Error(`Archived AI prompt should be hidden: ${JSON.stringify(promptBackAfterArchive)}`);
  }
  const integrationPatch = await request('/api/integrations/settings', {
    method: 'PATCH',
    headers: roles.admin.session.headers,
    body: JSON.stringify({
      zadarma: { recordingRetentionDays: 123 },
      ai: { humanApprovalRequiredBelowScore: 82 },
      messaging: { sendMissedCallFollowups: false },
    }),
  });
  if (
    integrationPatch.settings.zadarma.recordingRetentionDays !== 123
    || integrationPatch.settings.ai.humanApprovalRequiredBelowScore !== 82
    || integrationPatch.settings.messaging.sendMissedCallFollowups !== false
    || !['ready', 'needs_configuration'].includes(integrationPatch.health.status)
  ) {
    throw new Error(`Integration settings patch failed: ${JSON.stringify(integrationPatch)}`);
  }
  const integrationHealth = await request('/api/integrations/health', { headers: roles.admin.session.headers });
  if (
    integrationHealth.settingsId !== integrationPatch.settings.id
    || !Array.isArray(integrationHealth.health.checks)
    || !Array.isArray(integrationHealth.skillCatalog?.rows)
    || !Array.isArray(integrationHealth.readiness?.items)
    || !Array.isArray(integrationHealth.setupPlan?.items)
  ) {
    throw new Error(`Integration health failed: ${JSON.stringify(integrationHealth)}`);
  }
  const integrationSkills = await request('/api/integrations/skills', { headers: roles.admin.session.headers });
  if (
    integrationSkills.skillCatalog.rows.length < 12
    || integrationSkills.readiness.items.length < 8
    || integrationSkills.setupPlan.items.length < 10
    || !integrationSkills.setupPlan.items.some((item) => item.key === 'zadarma' && item.priority === 'P0')
    || !integrationSkills.skillCatalog.rows.some((item) => item.key === 'production_database' && item.required === true)
    || !integrationSkills.skillCatalog.rows.some((item) => item.key === 'domain_webhooks' && item.required === true)
    || !integrationSkills.skillCatalog.rows.some((item) => item.key === 'mobile_release_pipeline')
    || !integrationSkills.skillCatalog.rows.some((item) => item.key === 'backup_ci_cd' && item.required === true)
  ) {
    throw new Error(`Integration skills/setup plan failed: ${JSON.stringify(integrationSkills)}`);
  }
  const setupReport = await request('/api/integrations/setup-report', { headers: roles.admin.session.headers });
  const setupReportMarkdown = await requestText('/api/integrations/setup-report?format=markdown', { headers: roles.admin.session.headers });
  if (
    setupReport.environment?.valuesIncluded !== false
    || setupReport.setupPlan?.items?.length < 10
    || !setupReport.environment.all.some((item) => item.name === 'OPENAI_API_KEY')
    || !setupReport.liveBlockers.some((item) => item.key === 'zadarma')
    || !setupReportMarkdown.includes('# Arbor OS - raport wdrozeniowy integracji')
    || !setupReportMarkdown.includes('ZADARMA_SECRET')
    || setupReportMarkdown.includes('dev-zadarma-secret')
  ) {
    throw new Error(`Integration setup report failed: ${JSON.stringify({ setupReport, setupReportMarkdown: setupReportMarkdown.slice(0, 500) })}`);
  }
  const channelTest = await request('/api/integrations/test-channel', {
    method: 'POST',
    headers: roles.admin.session.headers,
    body: JSON.stringify({ channel: 'zadarma' }),
  });
  if (channelTest.result.channel !== 'zadarma' || channelTest.result.liveReady !== false || !['demo', 'disabled'].includes(channelTest.result.mode)) {
    throw new Error(`Integration channel test failed: ${JSON.stringify(channelTest)}`);
  }
  const runtimeChannelTest = await request('/api/integrations/test-channel', {
    method: 'POST',
    headers: roles.admin.session.headers,
    body: JSON.stringify({ channel: 'postgres_aws' }),
  });
  if (
    runtimeChannelTest.result.channel !== 'postgres_aws'
    || runtimeChannelTest.result.required !== true
    || !runtimeChannelTest.result.requiredEnv.includes('DATABASE_URL')
  ) {
    throw new Error(`Runtime integration channel test failed: ${JSON.stringify(runtimeChannelTest)}`);
  }
  await expectStatus('/api/integrations/test-channel', 400, {
    method: 'POST',
    headers: roles.admin.session.headers,
    body: JSON.stringify({ channel: 'unknown-channel' }),
  });
  const setupTasks = await request('/api/integrations/setup-tasks', {
    method: 'POST',
    headers: roles.admin.session.headers,
    body: JSON.stringify({}),
  });
  const setupTasksAgain = await request('/api/integrations/setup-tasks', {
    method: 'POST',
    headers: roles.admin.session.headers,
    body: JSON.stringify({}),
  });
  if (
    setupTasks.created.length < 8
    || setupTasks.created[0].sourceId?.startsWith('integration_setup:') !== true
    || setupTasksAgain.created.length !== 0
    || setupTasksAgain.skipped.length !== setupTasks.created.length
  ) {
    throw new Error(`Integration setup tasks failed: ${JSON.stringify({ setupTasks, setupTasksAgain })}`);
  }
  const livePreflight = await request('/api/integrations/live-preflight', {
    method: 'POST',
    headers: roles.admin.session.headers,
    body: JSON.stringify({ createTasks: true }),
  });
  if (
    livePreflight.preflight?.allowed !== false
    || livePreflight.preflight?.status !== 'blocked'
    || !livePreflight.preflight.blockers.some((blocker) => blocker.key === 'zadarma')
    || livePreflight.setupTasks.created.length !== 0
    || livePreflight.setupTasks.skipped.length < setupTasks.created.length
    || !Array.isArray(livePreflight.setupTasks.tasks)
  ) {
    throw new Error(`Integration live preflight failed: ${JSON.stringify(livePreflight)}`);
  }
  const retention = await request('/api/zadarma/recordings/smoke-retention', { headers: roles.admin.session.headers });
  if (retention.retentionDays !== 123 || retention.encrypted !== true) {
    throw new Error(`Zadarma recording retention did not use integration settings: ${JSON.stringify(retention)}`);
  }
  const moduleConfigs = await request('/api/module-configs', { headers: roles.admin.session.headers });
  if (!moduleConfigs.some((config) => config.id === 'cfg-crm') || moduleConfigs.some((config) => config.tenantId === 'tenant-other')) {
    throw new Error(`Module config list failed: ${JSON.stringify(moduleConfigs)}`);
  }
  await expectStatus('/api/module-configs', 400, {
    method: 'POST',
    headers: roles.admin.session.headers,
    body: JSON.stringify({ module: 'not-a-module', label: 'Wrong module' }),
  });
  const createdModuleConfig = await request('/api/module-configs', {
    method: 'POST',
    headers: roles.admin.session.headers,
    body: JSON.stringify({
      module: 'fleet',
      label: 'Flota smoke',
      enabled: true,
      customFields: [
        { key: 'registration_number', label: 'Numer rejestracyjny', type: 'text' },
        { key: 'inspection_months', label: 'Okres przegladu', type: 'number' },
      ],
      statuses: ['sprawny', 'serwis', 'zarezerwowany'],
      requiredDocuments: ['OC sprzetu smoke', 'Przeglad smoke'],
    }),
  });
  if (
    createdModuleConfig.tenantId !== 'tenant-pf'
    || createdModuleConfig.module !== 'fleet'
    || createdModuleConfig.customFields.length !== 2
    || !createdModuleConfig.statuses.includes('serwis')
  ) {
    throw new Error(`Module config create failed: ${JSON.stringify(createdModuleConfig)}`);
  }
  await expectStatus('/api/module-configs', 409, {
    method: 'POST',
    headers: roles.admin.session.headers,
    body: JSON.stringify({ module: 'fleet', label: 'Duplicate fleet config' }),
  });
  const updatedModuleConfig = await request(`/api/module-configs/${createdModuleConfig.id}`, {
    method: 'PATCH',
    headers: roles.admin.session.headers,
    body: JSON.stringify({
      label: 'Flota i sprzet smoke',
      enabled: false,
      statuses: ['sprawny', 'serwis', 'wycofany'],
      requiredDocuments: ['OC sprzetu smoke'],
    }),
  });
  if (
    updatedModuleConfig.label !== 'Flota i sprzet smoke'
    || updatedModuleConfig.enabled !== false
    || !updatedModuleConfig.statuses.includes('wycofany')
    || updatedModuleConfig.requiredDocuments.length !== 1
  ) {
    throw new Error(`Module config update failed: ${JSON.stringify(updatedModuleConfig)}`);
  }
  const deletedModuleConfig = await request(`/api/module-configs/${createdModuleConfig.id}`, {
    method: 'DELETE',
    headers: roles.admin.session.headers,
  });
  if (!deletedModuleConfig.archived || deletedModuleConfig.deleted || deletedModuleConfig.config.status !== 'archived') {
    throw new Error(`Module config delete/archive failed: ${JSON.stringify(deletedModuleConfig)}`);
  }
  const moduleConfigsAfterDelete = await request('/api/module-configs', { headers: roles.admin.session.headers });
  if (moduleConfigsAfterDelete.some((config) => config.id === createdModuleConfig.id)) {
    throw new Error(`Archived module config should be hidden: ${JSON.stringify(moduleConfigsAfterDelete)}`);
  }

  const zadarmaCommunication = roles.kierownik.boot.communications.find((communication) => communication.id === webhook.payload.communicationId);
  if (
    !zadarmaCommunication
    || zadarmaCommunication.channel !== 'zadarma'
    || zadarmaCommunication.recordingId !== webhookCallId
    || zadarmaCommunication.recordingStatus !== 'ready'
    || zadarmaCommunication.recordingUrl !== '/recordings/demo/zadarma-smoke-notify.mp3'
    || zadarmaCommunication.transcriptStatus !== 'ready'
    || zadarmaCommunication.transcript.length !== 3
    || zadarmaCommunication.analysisPromptId !== 'prompt-1'
    || zadarmaCommunication.analysis.score < 80
    || zadarmaCommunication.orderId !== webhook.payload.orderId
  ) {
    throw new Error(`Zadarma communication not persisted with recording: ${JSON.stringify(zadarmaCommunication)}`);
  }

  const manager = roles.kierownik.session;
  const admin = roles.admin.session;
  const accountant = roles.ksiegowa.session;
  const workerUser = roles.kierownik.boot.users.find((user) => user.login === 'pracownik');
  if (!workerUser) throw new Error('Worker user missing');
  const workerPassword = `pin${String(Date.now()).slice(-4)}`;
  const passwordChange = await request(`/api/users/${workerUser.id}/password`, {
    method: 'PATCH',
    headers: admin.headers,
    body: JSON.stringify({ password: workerPassword }),
  });
  if (!passwordChange.ok) throw new Error(`Password change failed: ${JSON.stringify(passwordChange)}`);
  await expectStatus('/api/auth/login', 401, {
    method: 'POST',
    body: JSON.stringify({ login: 'pracownik' }),
  });
  await expectStatus('/api/auth/login', 401, {
    method: 'POST',
    body: JSON.stringify({ login: 'pracownik', password: 'wrong-pin' }),
  });
  const workerSession = await login({ login: 'pracownik', password: workerPassword });
  if (workerSession.user.login !== 'pracownik') throw new Error('Password login failed for worker');

  const usersForAdmin = await request('/api/users?includeInactive=true', { headers: admin.headers });
  if (!usersForAdmin.some((user) => user.login === 'admin') || usersForAdmin.some((user) => 'passwordHash' in user)) {
    throw new Error(`admin users list invalid or leaked password hash: ${JSON.stringify(usersForAdmin)}`);
  }
  await expectStatus(`/api/users/${admin.user.id}`, 409, {
    method: 'PATCH',
    headers: admin.headers,
    body: JSON.stringify({ status: 'inactive' }),
  });
  await expectStatus(`/api/users/${admin.user.id}`, 409, {
    method: 'PATCH',
    headers: admin.headers,
    body: JSON.stringify({ role: 'DYREKTOR' }),
  });
  await expectStatus(`/api/users/${admin.user.id}`, 409, {
    method: 'DELETE',
    headers: admin.headers,
  });
  const createdStaffPassword = `staff-${Date.now()}`;
  const createdStaff = await request('/api/users', {
    method: 'POST',
    headers: admin.headers,
    body: JSON.stringify({
      login: `smoke.staff.${Date.now()}`,
      firstName: 'Smoke',
      lastName: 'Operator',
      role: 'PRACOWNIK',
      branchId: admin.user.branchId,
      password: createdStaffPassword,
    }),
  });
  if (createdStaff.status !== 'active' || createdStaff.branchId !== admin.user.branchId || 'passwordHash' in createdStaff) {
    throw new Error(`user create returned unsafe or invalid payload: ${JSON.stringify(createdStaff)}`);
  }
  const createdStaffSession = await login({ login: createdStaff.login, password: createdStaffPassword });
  if (createdStaffSession.user.id !== createdStaff.id) throw new Error(`created staff could not log in: ${JSON.stringify(createdStaffSession.user)}`);
  const inactiveStaff = await request(`/api/users/${createdStaff.id}`, {
    method: 'PATCH',
    headers: admin.headers,
    body: JSON.stringify({ status: 'inactive', role: 'BRYGADZISTA' }),
  });
  if (inactiveStaff.status !== 'inactive' || inactiveStaff.role !== 'BRYGADZISTA') {
    throw new Error(`user inactive update failed: ${JSON.stringify(inactiveStaff)}`);
  }
  await expectStatus('/api/auth/login', 401, {
    method: 'POST',
    body: JSON.stringify({ login: createdStaff.login, password: createdStaffPassword }),
  });
  const usersWithInactive = await request('/api/users?includeInactive=true', { headers: admin.headers });
  if (!usersWithInactive.some((user) => user.id === createdStaff.id) || usersWithInactive.some((user) => 'passwordHash' in user)) {
    throw new Error(`inactive user missing or password hash leaked: ${JSON.stringify(usersWithInactive)}`);
  }
  const activeBootstrap = await request('/api/bootstrap', { headers: admin.headers });
  if ((activeBootstrap.users ?? []).some((user) => user.id === createdStaff.id)) {
    throw new Error(`inactive user should be hidden from bootstrap active users: ${JSON.stringify(activeBootstrap.users)}`);
  }
  const reactivatedStaff = await request(`/api/users/${createdStaff.id}`, {
    method: 'PATCH',
    headers: admin.headers,
    body: JSON.stringify({ status: 'active' }),
  });
  if (reactivatedStaff.status !== 'active') throw new Error(`user reactivation failed: ${JSON.stringify(reactivatedStaff)}`);
  const archivedStaff = await request(`/api/users/${createdStaff.id}`, {
    method: 'DELETE',
    headers: admin.headers,
  });
  if (!archivedStaff.archived || archivedStaff.deleted || archivedStaff.user.status !== 'archived' || !archivedStaff.user.deletedAt || 'passwordHash' in archivedStaff.user) {
    throw new Error(`user archive failed or leaked unsafe data: ${JSON.stringify(archivedStaff)}`);
  }
  await expectStatus('/api/auth/login', 401, {
    method: 'POST',
    body: JSON.stringify({ login: createdStaff.login, password: createdStaffPassword }),
  });
  const usersAfterArchive = await request('/api/users?includeInactive=true', { headers: admin.headers });
  if (usersAfterArchive.some((user) => user.id === createdStaff.id)) {
    throw new Error(`archived user should be hidden from admin list: ${JSON.stringify(usersAfterArchive)}`);
  }

  const rolePermissions = await request('/api/role-permissions', { headers: admin.headers });
  const workerRolePermission = rolePermissions.find((permission) => permission.role === 'PRACOWNIK');
  if (!workerRolePermission || workerRolePermission.locked || workerRolePermission.modules.includes('crm')) {
    throw new Error(`default worker role permission invalid: ${JSON.stringify(workerRolePermission)}`);
  }
  await expectStatus('/api/role-permissions/ADMINISTRATOR', 409, {
    method: 'PATCH',
    headers: admin.headers,
    body: JSON.stringify({ modules: ['dashboard'], writable: [] }),
  });
  await expectStatus('/api/clients', 403, { headers: workerSession.headers });
  const workerCrmRead = await request('/api/role-permissions/PRACOWNIK', {
    method: 'PATCH',
    headers: admin.headers,
    body: JSON.stringify({
      modules: [...workerRolePermission.modules, 'crm'],
      writable: workerRolePermission.writable,
    }),
  });
  if (workerCrmRead.source !== 'tenant' || !workerCrmRead.modules.includes('crm') || workerCrmRead.writable.includes('crm')) {
    throw new Error(`worker CRM read role update failed: ${JSON.stringify(workerCrmRead)}`);
  }
  const workerClients = await request('/api/clients', { headers: workerSession.headers });
  if (!Array.isArray(workerClients) || workerClients.length === 0) {
    throw new Error(`worker should read CRM after role permission update: ${JSON.stringify(workerClients)}`);
  }
  await expectStatus('/api/clients', 403, {
    method: 'POST',
    headers: workerSession.headers,
    body: JSON.stringify({ name: 'Blocked Worker Client', phone: '+48 799 000 333', address: 'No write 1' }),
  });
  const workerCrmWrite = await request('/api/role-permissions/PRACOWNIK', {
    method: 'PATCH',
    headers: admin.headers,
    body: JSON.stringify({
      modules: workerCrmRead.modules,
      writable: [...workerCrmRead.writable, 'crm'],
    }),
  });
  if (!workerCrmWrite.writable.includes('crm')) throw new Error(`worker CRM write role update failed: ${JSON.stringify(workerCrmWrite)}`);
  const workerCreatedClient = await request('/api/clients', {
    method: 'POST',
    headers: workerSession.headers,
    body: JSON.stringify({
      name: 'Worker Permission Client',
      phone: `+48 798 ${String(Date.now()).slice(-3)} 333`,
      email: 'worker-permission@example.test',
      address: 'Permission 1',
    }),
  });
  if (workerCreatedClient.createdBy !== workerSession.user.id || workerCreatedClient.branchId !== workerSession.user.branchId) {
    throw new Error(`worker CRM write did not create scoped client: ${JSON.stringify(workerCreatedClient)}`);
  }
  const workerPermissionReset = await request('/api/role-permissions/PRACOWNIK/reset', {
    method: 'POST',
    headers: admin.headers,
  });
  if (workerPermissionReset.source !== 'default' || workerPermissionReset.modules.includes('crm')) {
    throw new Error(`worker role reset failed: ${JSON.stringify(workerPermissionReset)}`);
  }
  await expectStatus('/api/clients', 403, { headers: workerSession.headers });

  const emptyBranch = await request('/api/branches', {
    method: 'POST',
    headers: admin.headers,
    body: JSON.stringify({
      id: `empty-${Date.now().toString(36)}`,
      name: `Smoke Empty Branch ${Date.now()}`,
      city: 'Testowo',
    }),
  });
  if (emptyBranch.status !== 'active' || emptyBranch.tenantId !== 'tenant-pf') {
    throw new Error(`empty branch create failed: ${JSON.stringify(emptyBranch)}`);
  }
  const deletedEmptyBranch = await request(`/api/branches/${emptyBranch.id}`, {
    method: 'DELETE',
    headers: admin.headers,
  });
  if (!deletedEmptyBranch.deleted || deletedEmptyBranch.archived) {
    throw new Error(`empty branch should hard delete: ${JSON.stringify(deletedEmptyBranch)}`);
  }
  const mainBranch = await request('/api/branches', {
    method: 'POST',
    headers: admin.headers,
    body: JSON.stringify({
      id: `smoke-${Date.now().toString(36)}`,
      name: `Smoke Branch ${Date.now()}`,
      city: 'Nowe Miasto',
    }),
  });
  if (mainBranch.status !== 'active' || mainBranch.tenantId !== 'tenant-pf') {
    throw new Error(`branch create failed: ${JSON.stringify(mainBranch)}`);
  }
  const updatedBranch = await request(`/api/branches/${mainBranch.id}`, {
    method: 'PATCH',
    headers: admin.headers,
    body: JSON.stringify({ city: 'Miasto Po Edycji' }),
  });
  if (updatedBranch.city !== 'Miasto Po Edycji' || updatedBranch.status !== 'active') {
    throw new Error(`branch update failed: ${JSON.stringify(updatedBranch)}`);
  }
  const managerWithoutBranch = await request('/api/bootstrap', { headers: manager.headers });
  if (managerWithoutBranch.branches.some((branch) => branch.id === mainBranch.id) || (managerWithoutBranch.branchScope?.branchIds ?? []).includes(mainBranch.id)) {
    throw new Error(`manager should not see new branch without delegation: ${JSON.stringify(managerWithoutBranch.branchScope)}`);
  }
  const branchStaffPassword = `branch-${Date.now()}`;
  const branchStaff = await request('/api/users', {
    method: 'POST',
    headers: admin.headers,
    body: JSON.stringify({
      login: `branch.staff.${Date.now()}`,
      firstName: 'Branch',
      lastName: 'Worker',
      role: 'PRACOWNIK',
      branchId: mainBranch.id,
      password: branchStaffPassword,
    }),
  });
  if (branchStaff.branchId !== mainBranch.id || branchStaff.status !== 'active') {
    throw new Error(`branch staff create failed: ${JSON.stringify(branchStaff)}`);
  }
  await expectStatus(`/api/branches/${mainBranch.id}`, 409, {
    method: 'DELETE',
    headers: admin.headers,
  });
  const archivedBranchStaff = await request(`/api/users/${branchStaff.id}`, {
    method: 'DELETE',
    headers: admin.headers,
  });
  if (!archivedBranchStaff.archived || archivedBranchStaff.user.status !== 'archived') {
    throw new Error(`branch staff archive failed: ${JSON.stringify(archivedBranchStaff)}`);
  }
  const branchClient = await request('/api/clients', {
    method: 'POST',
    headers: admin.headers,
    body: JSON.stringify({
      name: 'Smoke Branch Client',
      phone: `+48 799 ${String(Date.now()).slice(-3)} 111`,
      email: 'branch-client@example.test',
      address: 'Oddzialowa 1',
      branchId: mainBranch.id,
    }),
  });
  if (branchClient.branchId !== mainBranch.id) throw new Error(`branch client create failed: ${JSON.stringify(branchClient)}`);
  const archivedBranch = await request(`/api/branches/${mainBranch.id}`, {
    method: 'DELETE',
    headers: admin.headers,
  });
  if (!archivedBranch.archived || archivedBranch.deleted || archivedBranch.branch.status !== 'archived' || !archivedBranch.branch.deletedAt || archivedBranch.references.clients < 1) {
    throw new Error(`branch archive failed: ${JSON.stringify(archivedBranch)}`);
  }
  const branchesAfterArchive = await request('/api/branches', { headers: admin.headers });
  if (branchesAfterArchive.some((branch) => branch.id === mainBranch.id)) {
    throw new Error(`archived branch should be hidden from active branch list: ${JSON.stringify(branchesAfterArchive)}`);
  }
  const allBranchesAfterArchive = await request('/api/branches?includeArchived=true', { headers: admin.headers });
  if (!allBranchesAfterArchive.some((branch) => branch.id === mainBranch.id && branch.status === 'archived')) {
    throw new Error(`archived branch missing from includeArchived list: ${JSON.stringify(allBranchesAfterArchive)}`);
  }
  await expectStatus('/api/clients', 403, {
    method: 'POST',
    headers: manager.headers,
    body: JSON.stringify({
      name: 'Blocked Warsaw Before Delegation',
      phone: '+48 799 100 101',
      address: 'Warszawa blocked 1',
      branchId: 'waw',
    }),
  });
  const branchDelegation = await request('/api/branch-delegations', {
    method: 'POST',
    headers: admin.headers,
    body: JSON.stringify({
      userId: manager.user.id,
      fromBranchId: 'krk',
      toBranchId: 'waw',
      reason: 'Smoke zastepstwo kierownika Krakowa w Warszawie',
      startsAt: '2026-07-01T00:00:00.000Z',
      endsAt: '2026-12-31T23:59:59.000Z',
    }),
  });
  if (branchDelegation.tenantId !== 'tenant-pf' || branchDelegation.userId !== manager.user.id || branchDelegation.toBranchId !== 'waw' || branchDelegation.status !== 'active') {
    throw new Error(`branch delegation create failed: ${JSON.stringify(branchDelegation)}`);
  }
  const delegatedManagerBoot = await request('/api/bootstrap', { headers: manager.headers });
  if (!(delegatedManagerBoot.branchScope?.branchIds ?? []).includes('waw')) {
    throw new Error(`delegated manager missing Warsaw scope: ${JSON.stringify(delegatedManagerBoot.branchScope)}`);
  }
  if (!delegatedManagerBoot.branches.some((branch) => branch.id === 'waw') || !delegatedManagerBoot.branchDelegations.some((delegation) => delegation.id === branchDelegation.id)) {
    throw new Error(`delegated manager bootstrap missing Warsaw branch or delegation: ${JSON.stringify({ branches: delegatedManagerBoot.branches, delegations: delegatedManagerBoot.branchDelegations })}`);
  }
  if (!delegatedManagerBoot.crews.some((crew) => crew.branchId === 'waw')) {
    throw new Error(`delegated manager should see Warsaw crews: ${JSON.stringify(delegatedManagerBoot.crews)}`);
  }
  const delegatedWarsawClient = await request('/api/clients', {
    method: 'POST',
    headers: manager.headers,
    body: JSON.stringify({
      name: 'Delegated Warsaw Client',
      phone: `+48 799 ${String(Date.now()).slice(-3)} 777`,
      email: 'delegated-warsaw@example.test',
      address: 'Delegowana 1, Warszawa',
      branchId: 'waw',
    }),
  });
  if (delegatedWarsawClient.branchId !== 'waw' || delegatedWarsawClient.createdBy !== manager.user.id) {
    throw new Error(`delegated manager client create failed: ${JSON.stringify(delegatedWarsawClient)}`);
  }
  const delegatedWarsawCrew = await request('/api/crews', {
    method: 'POST',
    headers: manager.headers,
    body: JSON.stringify({
      branchId: 'waw',
      name: `Smoke delegated crew ${Date.now()}`,
      leaderId: manager.user.id,
      members: ['Delegowany lider'],
      utilization: 33,
    }),
  });
  if (delegatedWarsawCrew.branchId !== 'waw' || delegatedWarsawCrew.leaderId !== manager.user.id) {
    throw new Error(`delegated manager crew create failed: ${JSON.stringify(delegatedWarsawCrew)}`);
  }
  const revokedDelegation = await request(`/api/branch-delegations/${branchDelegation.id}`, {
    method: 'DELETE',
    headers: admin.headers,
  });
  if (!revokedDelegation.revoked || revokedDelegation.delegation.status !== 'revoked' || !revokedDelegation.delegation.deletedAt) {
    throw new Error(`branch delegation revoke failed: ${JSON.stringify(revokedDelegation)}`);
  }
  const managerAfterRevoke = await request('/api/bootstrap', { headers: manager.headers });
  if ((managerAfterRevoke.branchScope?.branchIds ?? []).includes('waw') || managerAfterRevoke.clients.some((client) => client.id === delegatedWarsawClient.id) || managerAfterRevoke.crews.some((crew) => crew.id === delegatedWarsawCrew.id)) {
    throw new Error(`manager kept Warsaw scope after revoke: ${JSON.stringify({ scope: managerAfterRevoke.branchScope, clients: managerAfterRevoke.clients, crews: managerAfterRevoke.crews })}`);
  }
  await expectStatus('/api/clients', 403, {
    method: 'POST',
    headers: manager.headers,
    body: JSON.stringify({
      name: 'Blocked Warsaw After Delegation',
      phone: '+48 799 100 102',
      address: 'Warszawa blocked 2',
      branchId: 'waw',
    }),
  });
  await expectStatus(`/api/crews/${delegatedWarsawCrew.id}`, 404, {
    method: 'PATCH',
    headers: manager.headers,
    body: JSON.stringify({ name: 'Blocked Warsaw crew edit after revoke' }),
  });
  await request(`/api/crews/${delegatedWarsawCrew.id}`, {
    method: 'DELETE',
    headers: admin.headers,
  });
  await expectStatus('/api/clients', 409, {
    method: 'POST',
    headers: admin.headers,
    body: JSON.stringify({
      name: 'Blocked Archived Branch Client',
      phone: '+48 799 000 222',
      address: 'Zamknieta 1',
      branchId: mainBranch.id,
    }),
  });
  await expectStatus('/api/clients', 403, {
    method: 'POST',
    headers: roles.brygadzista.session.headers,
    body: JSON.stringify({ name: 'Blocked client', phone: '+48 000 000 000', address: 'Nowhere' }),
  });
  const crmPhone = `+48 701 ${String(Date.now()).slice(-3)} ${String(Date.now()).slice(-3)}`;
  const crmClient = await request('/api/clients', {
    method: 'POST',
    headers: manager.headers,
    body: JSON.stringify({
      name: 'Smoke CRM Client',
      phone: crmPhone,
      email: 'smoke-crm@example.test',
      address: 'Smoke CRM 12, Krakow',
      tags: ['smoke', 'crm'],
      pipelineStage: 'kontakt',
      customFields: { segment: 'test', source_quality: 'wysoka' },
    }),
  });
  if (!crmClient.id || crmClient.branchId !== 'krk' || crmClient.pipelineStage !== 'kontakt' || crmClient.customFields?.segment !== 'test') {
    throw new Error(`CRM client create failed: ${JSON.stringify(crmClient)}`);
  }
  await expectStatus('/api/clients', 409, {
    method: 'POST',
    headers: manager.headers,
    body: JSON.stringify({ name: 'Duplicate Smoke CRM', phone: crmPhone, address: 'Smoke CRM 13, Krakow' }),
  });
  const updatedCrmClient = await request(`/api/clients/${crmClient.id}`, {
    method: 'PATCH',
    headers: manager.headers,
    body: JSON.stringify({ email: 'updated-smoke-crm@example.test', ltv: 1234, tags: ['smoke', 'updated'], customFields: { segment: 'vip', source_quality: 'wysoka' } }),
  });
  if (updatedCrmClient.email !== 'updated-smoke-crm@example.test' || !updatedCrmClient.tags.includes('updated') || updatedCrmClient.customFields?.segment !== 'vip') {
    throw new Error(`CRM client update failed: ${JSON.stringify(updatedCrmClient)}`);
  }
  const configuredStageClient = await request(`/api/clients/${crmClient.id}`, {
    method: 'PATCH',
    headers: manager.headers,
    body: JSON.stringify({ pipelineStage: 'kwalifikacja' }),
  });
  if (configuredStageClient.pipelineStage !== 'kwalifikacja') {
    throw new Error(`CRM configured pipeline stage failed: ${JSON.stringify(configuredStageClient)}`);
  }
  const pipelineClient = await request(`/api/clients/${crmClient.id}`, {
    method: 'PATCH',
    headers: manager.headers,
    body: JSON.stringify({ pipelineStage: 'negocjacje' }),
  });
  if (pipelineClient.pipelineStage !== 'negocjacje') {
    throw new Error(`CRM pipeline stage update failed: ${JSON.stringify(pipelineClient)}`);
  }
  const managerBootAfterPipeline = await request('/api/bootstrap', { headers: manager.headers });
  if (!managerBootAfterPipeline.clients.some((client) => client.id === crmClient.id && client.pipelineStage === 'negocjacje' && client.customFields?.segment === 'vip')) {
    throw new Error(`CRM pipeline stage did not persist into bootstrap: ${JSON.stringify(managerBootAfterPipeline.clients.find((client) => client.id === crmClient.id))}`);
  }
  await expectStatus(`/api/clients/${crmClient.id}`, 400, {
    method: 'PATCH',
    headers: manager.headers,
    body: JSON.stringify({ pipelineStage: 'bad-stage' }),
  });
  const exportedClients = await requestText('/api/clients/export.csv', { headers: manager.headers });
  if (!exportedClients.includes('Smoke CRM Client') || !exportedClients.includes('pipelineStage') || !exportedClients.startsWith('id,branchId,name,phone')) {
    throw new Error(`CRM CSV export invalid: ${exportedClients.slice(0, 200)}`);
  }
  const importPhone = `+48 702 ${String(Date.now()).slice(-3)} ${String(Date.now()).slice(-3)}`;
  const importCsv = [
    'name,phone,email,address,pipelineStage,tags,customFields',
    `"Smoke Import Client","${importPhone}","import@example.test","Importowa 7, Krakow","oferta","csv|smoke","{""segment"":""CSV""}"`,
    `"Smoke Import Duplicate","${importPhone}","duplicate@example.test","Importowa 8, Krakow","lead","csv","{}"`,
  ].join('\n');
  const importedClients = await request('/api/clients/import.csv', {
    method: 'POST',
    headers: { ...manager.headers, 'Content-Type': 'text/csv' },
    body: importCsv,
  });
  if (importedClients.created.length !== 1 || importedClients.conflicts.length !== 1) {
    throw new Error(`CRM CSV import mismatch: ${JSON.stringify(importedClients)}`);
  }
  if (importedClients.created[0].pipelineStage !== 'oferta') {
    throw new Error(`CRM CSV import pipeline stage mismatch: ${JSON.stringify(importedClients.created[0])}`);
  }
  const crmOrder = await request('/api/orders', {
    method: 'POST',
    headers: manager.headers,
    body: JSON.stringify({
      clientId: crmClient.id,
      type: 'Smoke CRM linked order',
      scheduledAt: '2026-09-22T09:00:00.000Z',
      priority: 'normalny',
      value: 2222,
      source: 'smoke-crm',
    }),
  });
  if (crmOrder.clientId !== crmClient.id) throw new Error(`Order did not use new CRM client: ${JSON.stringify(crmOrder)}`);
  const updatedCrmOrder = await request(`/api/orders/${crmOrder.id}`, {
    method: 'PATCH',
    headers: manager.headers,
    body: JSON.stringify({
      priority: 'wysoki',
      checklist: [{ label: 'Smoke checklist item', done: true }],
      margin: 35,
    }),
  });
  if (
    updatedCrmOrder.priority !== 'wysoki'
    || updatedCrmOrder.margin !== 35
    || !updatedCrmOrder.checklist.some((item) => item.label === 'Smoke checklist item' && item.done)
    || !updatedCrmOrder.timeline.some((item) => item.label === 'Zlecenie zaktualizowane')
  ) {
    throw new Error(`Order update failed: ${JSON.stringify(updatedCrmOrder)}`);
  }
  Object.assign(crmOrder, updatedCrmOrder);
  const manualCommunication = await request('/api/communications', {
    method: 'POST',
    headers: manager.headers,
    body: JSON.stringify({
      type: 'note',
      clientId: crmClient.id,
      orderId: crmOrder.id,
      userId: manager.user.id,
      assignedUserId: manager.user.id,
      direction: 'internal',
      channel: 'manual',
      status: 'completed',
      subject: 'Smoke reczna notatka komunikacji',
      startedAt: '2026-09-22T10:00:00.000Z',
      durationSec: 0,
      transcript: [{ speaker: 'Biuro', text: 'Smoke notatka w karcie klienta i zleceniu.', atSec: 0 }],
      analysis: {
        score: 82,
        summary: 'Smoke notatka CRM.',
        intent: 'Notatka operacyjna',
        strengths: ['Zapis w CRM'],
        improvements: [],
        nextActions: ['Sprawdzic timeline'],
        risks: [],
      },
    }),
  });
  if (manualCommunication.clientId !== crmClient.id || manualCommunication.orderId !== crmOrder.id || manualCommunication.analysisStatus !== 'ready') {
    throw new Error(`Communication create failed: ${JSON.stringify(manualCommunication)}`);
  }
  const patchedCommunication = await request(`/api/communications/${manualCommunication.id}`, {
    method: 'PATCH',
    headers: manager.headers,
    body: JSON.stringify({
      subject: 'Smoke reczna notatka komunikacji v2',
      status: 'completed',
      assignedUserId: admin.user.id,
      transcript: [{ speaker: 'Biuro', text: 'Smoke notatka po edycji z przypisaniem do admina.', atSec: 0 }],
      analysis: {
        score: 74,
        summary: 'Smoke notatka wymaga przegladu.',
        intent: 'Follow-up',
        strengths: ['Jest przypisanie'],
        improvements: ['Doprecyzowac termin'],
        nextActions: ['Oddzwonic'],
        risks: ['Niepelne ustalenia'],
      },
    }),
  });
  if (patchedCommunication.subject !== 'Smoke reczna notatka komunikacji v2' || patchedCommunication.assignedUserId !== admin.user.id || patchedCommunication.analysisStatus !== 'review') {
    throw new Error(`Communication update failed: ${JSON.stringify(patchedCommunication)}`);
  }
  const archivedCommunication = await request(`/api/communications/${manualCommunication.id}`, {
    method: 'DELETE',
    headers: manager.headers,
  });
  if (!archivedCommunication.archived || archivedCommunication.deleted || !archivedCommunication.communication.deletedAt) {
    throw new Error(`Communication archive failed: ${JSON.stringify(archivedCommunication)}`);
  }
  const communicationsAfterArchive = await request('/api/communications', { headers: manager.headers });
  if (communicationsAfterArchive.some((communication) => communication.id === manualCommunication.id)) {
    throw new Error(`Archived communication should be hidden: ${JSON.stringify(communicationsAfterArchive.slice(0, 5))}`);
  }
  const orderToDelete = await request('/api/orders', {
    method: 'POST',
    headers: manager.headers,
    body: JSON.stringify({
      clientId: crmClient.id,
      type: 'Smoke order to delete',
      scheduledAt: '2026-09-23T09:00:00.000Z',
      priority: 'niski',
      value: 111,
      source: 'smoke-delete',
    }),
  });
  const deletedOrder = await request(`/api/orders/${orderToDelete.id}`, {
    method: 'DELETE',
    headers: manager.headers,
  });
  if (!deletedOrder.archived || deletedOrder.deleted || deletedOrder.order.status !== 'ANULOWANE' || !deletedOrder.order.deletedAt) {
    throw new Error(`Order delete/archive failed: ${JSON.stringify(deletedOrder)}`);
  }
  const ordersAfterDelete = await request('/api/orders', { headers: manager.headers });
  if (ordersAfterDelete.some((order) => order.id === orderToDelete.id)) {
    throw new Error(`Deleted order should be hidden: ${JSON.stringify(ordersAfterDelete)}`);
  }
  const emptyClient = await request('/api/clients', {
    method: 'POST',
    headers: manager.headers,
    body: JSON.stringify({
      name: 'Smoke empty client',
      phone: `+48 703 ${String(Date.now()).slice(-3)} ${String(Date.now()).slice(-3)}`,
      email: 'empty@example.test',
      address: 'Pusta 1, Krakow',
    }),
  });
  const deletedEmptyClient = await request(`/api/clients/${emptyClient.id}`, {
    method: 'DELETE',
    headers: manager.headers,
  });
  if (!deletedEmptyClient.deleted || deletedEmptyClient.archived || deletedEmptyClient.client !== null) {
    throw new Error(`Unused client should be deleted: ${JSON.stringify(deletedEmptyClient)}`);
  }
  const usedClient = await request('/api/clients', {
    method: 'POST',
    headers: manager.headers,
    body: JSON.stringify({
      name: 'Smoke used client archive',
      phone: `+48 704 ${String(Date.now()).slice(-3)} ${String(Date.now()).slice(-3)}`,
      email: 'used@example.test',
      address: 'Historia 2, Krakow',
    }),
  });
  const usedClientOrder = await request('/api/orders', {
    method: 'POST',
    headers: manager.headers,
    body: JSON.stringify({
      clientId: usedClient.id,
      type: 'Smoke history order',
      scheduledAt: '2026-09-24T09:00:00.000Z',
      priority: 'normalny',
      value: 222,
    }),
  });
  const archivedUsedClient = await request(`/api/clients/${usedClient.id}`, {
    method: 'DELETE',
    headers: manager.headers,
  });
  if (!usedClientOrder.id || !archivedUsedClient.archived || archivedUsedClient.deleted || !archivedUsedClient.client.deletedAt) {
    throw new Error(`Used client should be archived: ${JSON.stringify({ usedClientOrder, archivedUsedClient })}`);
  }
  const clientsAfterDelete = await request('/api/clients', { headers: manager.headers });
  if (clientsAfterDelete.some((client) => client.id === emptyClient.id || client.id === usedClient.id)) {
    throw new Error(`Deleted/archived clients should be hidden: ${JSON.stringify(clientsAfterDelete)}`);
  }

  const unusedWorkflow = await request('/api/workflows', {
    method: 'POST',
    headers: admin.headers,
    body: JSON.stringify({
      name: 'Smoke unused workflow delete',
      trigger: 'smoke.unused.delete',
      status: 'draft',
      actions: ['Utworz zadanie dla biura'],
    }),
  });
  const deletedUnusedWorkflow = await request(`/api/workflows/${unusedWorkflow.id}`, {
    method: 'DELETE',
    headers: admin.headers,
  });
  if (!deletedUnusedWorkflow.deleted || deletedUnusedWorkflow.archived || deletedUnusedWorkflow.workflow !== null) {
    throw new Error(`Unused workflow should be deleted: ${JSON.stringify(deletedUnusedWorkflow)}`);
  }
  const workflowsAfterUnusedDelete = await request('/api/workflows', { headers: admin.headers });
  if (workflowsAfterUnusedDelete.some((workflow) => workflow.id === unusedWorkflow.id)) {
    throw new Error(`Deleted unused workflow should be hidden: ${JSON.stringify(workflowsAfterUnusedDelete)}`);
  }

  const workflowMessage = await request('/api/workflows', {
    method: 'POST',
    headers: admin.headers,
    body: JSON.stringify({
      name: 'Smoke workflow SMS i email',
      trigger: 'smoke.message',
      status: 'live',
      actions: ['Wyslij SMS do klienta', 'Wyslij email do klienta'],
    }),
  });
  const workflowExecution = await request('/api/workflows/execute', {
    method: 'POST',
    headers: admin.headers,
    body: JSON.stringify({
      trigger: 'smoke.message',
      workflowId: workflowMessage.id,
      event: {
        branchId: 'krk',
        clientId: crmClient.id,
        orderId: crmOrder.id,
        smsBody: 'Smoke SMS z workflow: potwierdzamy termin ogledzin.',
        emailBody: 'Smoke e-mail z workflow: szczegoly terminu i zakresu prac.',
        messageSubject: 'Smoke workflow follow-up',
      },
    }),
  });
  const workflowRun = workflowExecution.results?.[0]?.run;
  if (
    workflowExecution.matched !== 1
    || workflowExecution.summary.success !== 1
    || workflowRun?.effects?.filter((effect) => effect.type === 'communication_created').length !== 2
  ) {
    throw new Error(`Workflow message execution failed: ${JSON.stringify(workflowExecution)}`);
  }
  const workflowTimeline = await request(`/api/clients/${crmClient.id}/timeline`, { headers: admin.headers });
  const workflowMessages = workflowTimeline.events.filter((event) => event.type === 'communication' && event.metadata?.channel && event.orderId === crmOrder.id);
  if (!workflowMessages.some((event) => event.metadata.channel === 'sms') || !workflowMessages.some((event) => event.metadata.channel === 'email')) {
    throw new Error(`Workflow SMS/email missing from client timeline: ${JSON.stringify(workflowTimeline.events.slice(0, 8))}`);
  }
  const workflowRuns = await request(`/api/workflow-runs?workflowId=${workflowMessage.id}`, { headers: admin.headers });
  if (!workflowRuns.some((run) => run.id === workflowRun.id && run.workflowId === workflowMessage.id)) {
    throw new Error(`Workflow runs list missing executed run: ${JSON.stringify(workflowRuns)}`);
  }
  const archivedWorkflow = await request(`/api/workflows/${workflowMessage.id}`, {
    method: 'DELETE',
    headers: admin.headers,
  });
  if (!archivedWorkflow.archived || archivedWorkflow.deleted || archivedWorkflow.workflow.status !== 'archived' || archivedWorkflow.workflow.killSwitch !== true) {
    throw new Error(`Used workflow should be archived with kill switch: ${JSON.stringify(archivedWorkflow)}`);
  }
  const workflowsAfterArchive = await request('/api/workflows', { headers: admin.headers });
  if (workflowsAfterArchive.some((workflow) => workflow.id === workflowMessage.id)) {
    throw new Error(`Archived workflow should be hidden from active list: ${JSON.stringify(workflowsAfterArchive)}`);
  }
  const workflowRunsAfterArchive = await request(`/api/workflow-runs?workflowId=${workflowMessage.id}`, { headers: admin.headers });
  if (!workflowRunsAfterArchive.some((run) => run.id === workflowRun.id)) {
    throw new Error(`Archived workflow run audit should remain visible: ${JSON.stringify(workflowRunsAfterArchive)}`);
  }

  const aiPhone = `+48 703 ${String(Date.now()).slice(-3)} ${String(Date.now()).slice(-3)}`;
  const aiBooking = await request('/api/ai-receptionist/simulate', {
    method: 'POST',
    headers: manager.headers,
    body: JSON.stringify({
      phone: aiPhone,
      clientName: 'Smoke AI Booking Client',
      email: 'ai-booking@example.test',
      address: 'Botaniczna 8, Krakow',
      branchId: 'krk',
      subject: 'Pilna wycena pielegnacji drzewa',
      customerLine: 'Prosze o ogledziny, mam zdjecia i zalezy mi na terminie.',
      receivedAt: '2026-09-21T18:15:00.000Z',
      inspectionAt: '2026-09-22T09:00:00.000Z',
      photosProvided: true,
      durationSec: 188,
    }),
  });
  if (
    aiBooking.decision.shouldTakeOver !== true
    || aiBooking.createdClient !== true
    || aiBooking.createdOrder !== true
    || aiBooking.booking.conflict !== true
    || aiBooking.booking.inspectionAt === '2026-09-22T09:00:00.000Z'
    || aiBooking.booking.estimatorId !== 'u-est'
    || aiBooking.order.inspectionAt !== aiBooking.booking.inspectionAt
    || aiBooking.botSession.bookingStatus !== 'booked'
    || aiBooking.task?.source !== 'ai_receptionist'
    || aiBooking.task?.clientId !== aiBooking.client.id
    || aiBooking.task?.orderId !== aiBooking.order.id
    || !Array.isArray(aiBooking.confirmations)
    || aiBooking.confirmations.filter((communication) => ['sms', 'email'].includes(communication.type)).length < 2
  ) {
    throw new Error(`AI receptionist smart booking failed: ${JSON.stringify(aiBooking)}`);
  }
  const aiBookingTimeline = await request(`/api/clients/${aiBooking.client.id}/timeline`, { headers: manager.headers });
  if (!aiBookingTimeline.events.some((event) => event.taskId === aiBooking.task.id && event.type === 'task')) {
    throw new Error(`AI receptionist task missing from client timeline: ${JSON.stringify(aiBookingTimeline)}`);
  }
  if (!aiBookingTimeline.events.some((event) => ['communication', 'ai'].includes(event.type) && event.metadata?.channel === 'sms' && event.sourceId === aiBooking.confirmations.find((communication) => communication.type === 'sms')?.id)) {
    throw new Error(`AI receptionist SMS confirmation missing from client timeline: ${JSON.stringify(aiBookingTimeline.events.slice(0, 8))}`);
  }
  if (!aiBookingTimeline.events.some((event) => ['communication', 'ai'].includes(event.type) && event.metadata?.channel === 'email' && event.sourceId === aiBooking.confirmations.find((communication) => communication.type === 'email')?.id)) {
    throw new Error(`AI receptionist email confirmation missing from client timeline: ${JSON.stringify(aiBookingTimeline.events.slice(0, 8))}`);
  }
  const aiRepeat = await request('/api/ai-receptionist/simulate', {
    method: 'POST',
    headers: manager.headers,
    body: JSON.stringify({
      phone: aiPhone,
      branchId: 'krk',
      subject: 'Doprecyzowanie rozmowy AI',
      customerLine: 'To ten sam klient, prosze dopisac notatke do CRM.',
      receivedAt: '2026-09-21T19:10:00.000Z',
      photosProvided: false,
    }),
  });
  if (aiRepeat.createdClient !== false || aiRepeat.client.id !== aiBooking.client.id || aiRepeat.order.id !== aiBooking.order.id) {
    throw new Error(`AI receptionist should match existing client/order: ${JSON.stringify(aiRepeat)}`);
  }

  for (const [userId, status] of [['u-admin', 'away'], ['u-dir', 'away'], ['u-manager', 'available']]) {
    await request('/api/softphone/availability', {
      method: 'PATCH',
      headers: admin.headers,
      body: JSON.stringify({ userId, status }),
    });
  }
  const inboundCall = await request('/api/softphone/incoming', {
    method: 'POST',
    headers: manager.headers,
    body: JSON.stringify({
      phone: crmPhone,
      orderId: crmOrder.id,
      subject: 'Smoke inbound softphone call',
    }),
  });
  if (
    inboundCall.communication.status !== 'ringing'
    || inboundCall.communication.clientId !== crmClient.id
    || inboundCall.communication.queueStatus !== 'assigned'
    || inboundCall.communication.assignedUserId !== manager.user.id
    || inboundCall.route.availableAgentCount < 1
  ) {
    throw new Error(`Inbound softphone did not ring on CRM client: ${JSON.stringify(inboundCall)}`);
  }
  const answeredCall = await request(`/api/softphone/${inboundCall.communication.id}/answer`, {
    method: 'POST',
    headers: manager.headers,
  });
  if (answeredCall.status !== 'active' || answeredCall.userId !== manager.user.id) {
    throw new Error(`Softphone answer failed: ${JSON.stringify(answeredCall)}`);
  }
  const busyAvailability = await request('/api/softphone/availability', { headers: manager.headers });
  const busyManager = busyAvailability.agents.find((agent) => agent.user.id === manager.user.id);
  if (busyManager?.presence.status !== 'busy' || busyManager.presence.activeCallId !== inboundCall.communication.id) {
    throw new Error(`Softphone presence did not switch to busy: ${JSON.stringify(busyAvailability)}`);
  }
  const completedCall = await request(`/api/softphone/${inboundCall.communication.id}/complete`, {
    method: 'POST',
    headers: manager.headers,
    body: JSON.stringify({
      durationSec: 214,
      recordingUrl: '/recordings/demo/smoke-inbound-softphone.mp3',
      transcript: [
        { speaker: 'Biuro', text: 'Dzien dobry, Polska Flora, w czym mozemy pomoc?', atSec: 0 },
        { speaker: 'Klient', text: 'Chce potwierdzic termin ogledzin i ryzyka przy ogrodzeniu.', atSec: 18 },
        { speaker: 'Biuro', text: 'Potwierdze termin SMS i poprosze o zdjecia drzewa.', atSec: 52 },
      ],
    }),
  });
  if (
    completedCall.status !== 'completed'
    || completedCall.durationSec !== 214
    || completedCall.recordingUrl !== '/recordings/demo/smoke-inbound-softphone.mp3'
    || completedCall.transcript.length < 3
    || completedCall.analysis.score < 80
  ) {
    throw new Error(`Softphone complete failed: ${JSON.stringify(completedCall)}`);
  }
  const availableAfterCall = await request('/api/softphone/availability', { headers: manager.headers });
  const availableManager = availableAfterCall.agents.find((agent) => agent.user.id === manager.user.id);
  if (availableManager?.presence.status !== 'available') {
    throw new Error(`Softphone presence did not return to available: ${JSON.stringify(availableAfterCall)}`);
  }
  const afterSoftphone = await request('/api/bootstrap', { headers: manager.headers });
  if (!afterSoftphone.communications.some((communication) => communication.id === completedCall.id && communication.clientId === crmClient.id)) {
    throw new Error(`Completed softphone call missing from CRM timeline: ${JSON.stringify(afterSoftphone.communications.slice(0, 3))}`);
  }
  const analyzedCall = await request(`/api/communications/${completedCall.id}/analyze`, {
    method: 'POST',
    headers: manager.headers,
    body: JSON.stringify({ promptId: 'prompt-1' }),
  });
  if (
    analyzedCall.communication.analysisPromptId !== 'prompt-1'
    || analyzedCall.communication.analysisPromptVersion !== 3
    || analyzedCall.analysis.score < 80
    || !analyzedCall.coachingTags.includes('next_step_clear')
  ) {
    throw new Error(`Prompt-driven communication analysis failed: ${JSON.stringify(analyzedCall)}`);
  }
  const recordingImport = await request(`/api/communications/${completedCall.id}/recording`, {
    method: 'POST',
    headers: manager.headers,
    body: JSON.stringify({
      recordingId: 'zadarma-smoke-call-001',
      recordingUrl: '/recordings/demo/smoke-zadarma-recording.mp3',
      recordingSource: 'zadarma',
      recordingConsent: true,
      durationSec: 226,
      promptId: 'prompt-1',
      transcript: [
        'Biuro: Dzien dobry, dopisuje nagranie z centrali i potwierdzam termin ogledzin.',
        'Klient: Prosze uwzglednic ryzyka przy ogrodzeniu i wyslac SMS z terminem.',
        'Biuro: Poprosze jeszcze o zdjecia drzewa, potem przygotujemy wycene i nastepny krok.',
      ].join('\n'),
    }),
  });
  if (
    recordingImport.communication.recordingId !== 'zadarma-smoke-call-001'
    || recordingImport.communication.recordingSource !== 'zadarma'
    || recordingImport.communication.recordingStatus !== 'ready'
    || recordingImport.communication.transcriptStatus !== 'ready'
    || recordingImport.communication.durationSec !== 226
    || recordingImport.communication.transcript.length !== 3
    || recordingImport.communication.analysisPromptId !== 'prompt-1'
    || recordingImport.analysis.score < 80
  ) {
    throw new Error(`Communication recording import failed: ${JSON.stringify(recordingImport)}`);
  }
  const coaching = await request('/api/ai/coaching', { headers: manager.headers });
  if (
    coaching.totalAnalyzed < 1
    || !coaching.users.some((row) => row.userId === manager.user.id && row.callCount >= 1)
    || coaching.averageScore < 70
  ) {
    throw new Error(`AI coaching scorecard failed: ${JSON.stringify(coaching)}`);
  }
  const afterAnalysis = await request('/api/bootstrap', { headers: manager.headers });
  const analyzedOrder = afterAnalysis.orders.find((order) => order.id === crmOrder.id);
  if (!analyzedOrder?.timeline.some((item) => item.label.includes('AI analiza rozmowy'))) {
    throw new Error(`AI analysis timeline missing: ${JSON.stringify(analyzedOrder?.timeline)}`);
  }
  if (!analyzedOrder?.timeline.some((item) => item.label.includes('Komunikacja z klientem zaktualizowana'))) {
    throw new Error(`Recording import timeline missing: ${JSON.stringify(analyzedOrder?.timeline)}`);
  }
  const clientTimeline = await request(`/api/clients/${crmClient.id}/timeline`, { headers: manager.headers });
  const recordedTimelineEvent = clientTimeline.events.find((event) => event.communicationId === completedCall.id);
  if (
    !recordedTimelineEvent
    || recordedTimelineEvent.metadata.recordingSource !== 'zadarma'
    || recordedTimelineEvent.metadata.recordingStatus !== 'ready'
    || recordedTimelineEvent.metadata.transcriptStatus !== 'ready'
  ) {
    throw new Error(`Recording metadata missing from client timeline: ${JSON.stringify(clientTimeline.events.slice(0, 5))}`);
  }
  for (const userId of ['u-admin', 'u-dir', 'u-manager']) {
    await request('/api/softphone/availability', {
      method: 'PATCH',
      headers: admin.headers,
      body: JSON.stringify({ userId, status: 'away' }),
    });
  }
  const overflowPhone = `+48 704 ${String(Date.now()).slice(-3)} ${String(Date.now()).slice(-3)}`;
  const overflowCall = await request('/api/softphone/incoming', {
    method: 'POST',
    headers: manager.headers,
    body: JSON.stringify({
      phone: overflowPhone,
      clientName: 'Smoke Overflow Client',
      branchId: 'krk',
      subject: 'Smoke overflow to AI receptionist',
      customerLine: 'Nikt nie odbiera, prosze zarezerwowac ogledziny.',
      receivedAt: '2026-09-21T10:00:00.000Z',
      photosProvided: true,
    }),
  });
  if (
    overflowCall.communication.status !== 'missed'
    || overflowCall.communication.queueStatus !== 'overflowed'
    || overflowCall.overflow.shouldOverflow !== true
    || overflowCall.overflow.reason !== 'no_available_agents'
    || !overflowCall.aiHandoff?.communication?.id
    || overflowCall.aiHandoff.communication.channel !== 'ai_receptionist'
    || !overflowCall.aiHandoff.order?.id
    || overflowCall.aiHandoff.task?.source !== 'softphone'
    || overflowCall.aiHandoff.task?.orderId !== overflowCall.aiHandoff.order.id
  ) {
    throw new Error(`Softphone overflow to AI failed: ${JSON.stringify(overflowCall)}`);
  }
  const workQueue = await request('/api/operations/work-queue?limit=50', { headers: manager.headers });
  if (
    workQueue.tenantId !== 'tenant-pf'
    || workQueue.summary.total < 2
    || !workQueue.items.some((item) => item.type === 'task' && item.sourceId === aiBooking.task.id)
    || !workQueue.items.some((item) => item.type === 'task' && item.sourceId === overflowCall.aiHandoff.task.id)
    || !workQueue.items.some((item) => item.type === 'communication' && item.sourceId === overflowCall.communication.id && item.action.includes('Oddzwonic'))
  ) {
    throw new Error(`Operations work queue missing live work items: ${JSON.stringify(workQueue)}`);
  }
  await expectStatus(`/api/softphone/${overflowCall.communication.id}/answer`, 409, {
    method: 'POST',
    headers: manager.headers,
  });
  for (const userId of ['u-admin', 'u-dir', 'u-manager']) {
    await request('/api/softphone/availability', {
      method: 'PATCH',
      headers: admin.headers,
      body: JSON.stringify({ userId, status: 'available' }),
    });
  }

  await expectStatus('/api/document-templates/tpl-2', 409, {
    method: 'PATCH',
    headers: manager.headers,
    body: JSON.stringify({ name: 'Global template edit must stay blocked' }),
  });
  const tenantOfferTemplate = await request('/api/document-templates', {
    method: 'POST',
    headers: manager.headers,
    body: JSON.stringify({
      basedOnTemplateId: 'tpl-2',
      name: 'Smoke tenant offer template',
      status: 'active',
      body: 'Oferta smoke dla {{clientName}}: {{orderType}}, brutto {{grossValue}}, wazna {{validUntil}}, opiekun {{branch}}.',
    }),
  });
  if (
    tenantOfferTemplate.tenantId !== 'tenant-pf'
    || tenantOfferTemplate.clonedFromTemplateId !== 'tpl-2'
    || !tenantOfferTemplate.fields.includes('clientName')
    || !tenantOfferTemplate.fields.includes('branch')
  ) {
    throw new Error(`Document template create failed: ${JSON.stringify(tenantOfferTemplate)}`);
  }
  const previewTemplate = await request(`/api/document-templates/${tenantOfferTemplate.id}/preview`, {
    method: 'POST',
    headers: manager.headers,
    body: JSON.stringify({ subjectType: 'order', subjectId: crmOrder.id }),
  });
  if (!previewTemplate.content.includes('Smoke CRM Client') || previewTemplate.missingFields.length) {
    throw new Error(`Document template preview failed: ${JSON.stringify(previewTemplate)}`);
  }
  const updatedTemplate = await request(`/api/document-templates/${tenantOfferTemplate.id}`, {
    method: 'PATCH',
    headers: manager.headers,
    body: JSON.stringify({
      body: 'Oferta smoke v2 dla {{clientName}}: {{orderType}}, brutto {{grossValue}}, oddzial {{branch}}, termin {{validUntil}}.',
      fields: ['clientName', 'orderType', 'grossValue', 'branch', 'validUntil'],
    }),
  });
  if (updatedTemplate.version !== 2 || !updatedTemplate.body.includes('v2') || !updatedTemplate.fields.includes('branch')) {
    throw new Error(`Document template update failed: ${JSON.stringify(updatedTemplate)}`);
  }
  const generatedFromTenantTemplate = await request('/api/documents/generate', {
    method: 'POST',
    headers: manager.headers,
    body: JSON.stringify({ templateId: tenantOfferTemplate.id, subjectType: 'order', subjectId: crmOrder.id }),
  });
  if (
    generatedFromTenantTemplate.templateId !== tenantOfferTemplate.id
    || generatedFromTenantTemplate.status !== 'ready'
    || !generatedFromTenantTemplate.content?.includes('Oferta smoke v2')
  ) {
    throw new Error(`Tenant template document generation failed: ${JSON.stringify(generatedFromTenantTemplate)}`);
  }
  const archivedTemplate = await request(`/api/document-templates/${tenantOfferTemplate.id}`, {
    method: 'DELETE',
    headers: manager.headers,
  });
  if (!archivedTemplate.archived || archivedTemplate.deleted || archivedTemplate.template.status !== 'archived') {
    throw new Error(`Used document template should be archived: ${JSON.stringify(archivedTemplate)}`);
  }
  const unusedTemplate = await request('/api/document-templates', {
    method: 'POST',
    headers: manager.headers,
    body: JSON.stringify({
      name: 'Smoke unused template',
      kind: 'consent',
      scope: 'client',
      status: 'draft',
      fields: ['clientName'],
      body: 'Zgoda smoke dla {{clientName}}.',
    }),
  });
  const deletedUnusedTemplate = await request(`/api/document-templates/${unusedTemplate.id}`, {
    method: 'DELETE',
    headers: manager.headers,
  });
  if (!deletedUnusedTemplate.deleted || deletedUnusedTemplate.archived || deletedUnusedTemplate.template !== null) {
    throw new Error(`Unused document template should be deleted: ${JSON.stringify(deletedUnusedTemplate)}`);
  }

  const orderOffer = await request('/api/documents/generate', {
    method: 'POST',
    headers: manager.headers,
    body: JSON.stringify({ templateId: 'tpl-2', subjectType: 'order', subjectId: crmOrder.id }),
  });
  if (
    orderOffer.status !== 'ready'
    || !orderOffer.content?.includes('Smoke CRM Client')
    || !orderOffer.content?.includes('Smoke CRM linked order')
    || (orderOffer.missingFields ?? []).length
    || !orderOffer.fileName?.includes('offer-order')
  ) {
    throw new Error(`Order document rendering failed: ${JSON.stringify(orderOffer)}`);
  }
  const signedOffer = await request(`/api/generated-documents/${orderOffer.id}/sign`, {
    method: 'POST',
    headers: manager.headers,
    body: JSON.stringify({
      signerName: 'Smoke CRM Client',
      signerEmail: 'smoke-client@example.com',
      method: 'electronic',
      note: 'Smoke signature for production document workflow',
    }),
  });
  if (
    signedOffer.document.status !== 'signed'
    || signedOffer.document.signedBy !== manager.user.id
    || signedOffer.document.signerName !== 'Smoke CRM Client'
    || signedOffer.document.signatureMethod !== 'electronic'
    || !signedOffer.document.signatureHash
    || signedOffer.signature.signatureHash !== signedOffer.document.signatureHash
  ) {
    throw new Error(`Document signing failed: ${JSON.stringify(signedOffer)}`);
  }
  await expectStatus(`/api/generated-documents/${orderOffer.id}/sign`, 409, {
    method: 'POST',
    headers: manager.headers,
    body: JSON.stringify({ signerName: 'Duplicate signer' }),
  });
  const signedDocumentTimeline = await request(`/api/clients/${crmClient.id}/timeline`, { headers: manager.headers });
  const signedDocumentEvent = signedDocumentTimeline.events.find((event) => (
    event.documentId === orderOffer.id && event.status === 'signed' && event.metadata?.signatureHash === signedOffer.document.signatureHash
  ));
  if (!signedDocumentEvent) {
    throw new Error(`Signed document missing from client timeline: ${JSON.stringify(signedDocumentTimeline.events.slice(0, 8))}`);
  }

  const employeeContract = await request('/api/documents/generate', {
    method: 'POST',
    headers: manager.headers,
    body: JSON.stringify({ templateId: 'tpl-1', subjectType: 'employee', subjectId: 'u-lead' }),
  });
  if (
    employeeContract.status !== 'ready'
    || !employeeContract.content?.includes('Piotr Wrona')
    || !employeeContract.content?.includes('Brygadzista arborystyczny')
    || (employeeContract.missingFields ?? []).length
    || !employeeContract.fileName?.includes('contract-employee')
  ) {
    throw new Error(`Employee document rendering failed: ${JSON.stringify(employeeContract)}`);
  }
  const createdPosition = await request('/api/job-positions', {
    method: 'POST',
    headers: manager.headers,
    body: JSON.stringify({
      basedOnPositionId: 'pos-1',
      title: 'Smoke operator podnosnika',
      department: 'field',
      contractType: 'employment',
      rate: '9600 PLN brutto',
      responsibilities: ['Prowadzenie podnosnika', 'Dokumentacja zdjeciowa', 'BHP przed praca'],
      requiredDocuments: ['Smoke badania wysokosciowe', 'Smoke uprawnienia podnosnika'],
      requiredTraining: ['Smoke szkolenie podnosnikowe'],
      warningDays: 60,
      renewEveryMonths: 12,
    }),
  });
  if (
    createdPosition.position.tenantId !== 'tenant-pf'
    || createdPosition.position.title !== 'Smoke operator podnosnika'
    || createdPosition.requirements.length !== 2
    || !createdPosition.requirements.every((requirement) => requirement.requiredFor === createdPosition.position.id && requirement.scope === 'employee')
  ) {
    throw new Error(`Job position create failed: ${JSON.stringify(createdPosition)}`);
  }
  const updatedPosition = await request(`/api/job-positions/${createdPosition.position.id}`, {
    method: 'PATCH',
    headers: manager.headers,
    body: JSON.stringify({
      rate: '9900 PLN brutto',
      requiredDocuments: ['Smoke badania wysokosciowe', 'Smoke uprawnienia podnosnika', 'Smoke karta operatora'],
      requiredTraining: ['Smoke szkolenie podnosnikowe', 'Smoke rescue refresh'],
      warningDays: 45,
    }),
  });
  if (
    updatedPosition.position.rate !== '9900 PLN brutto'
    || !updatedPosition.position.requiredDocuments.includes('Smoke karta operatora')
    || !updatedPosition.requirements.some((requirement) => requirement.name === 'Smoke karta operatora' && requirement.warningDays === 45)
  ) {
    throw new Error(`Job position update failed: ${JSON.stringify(updatedPosition)}`);
  }
  await expectStatus('/api/document-requirements/req-1', 409, {
    method: 'PATCH',
    headers: manager.headers,
    body: JSON.stringify({ warningDays: 99 }),
  });
  const manualRequirement = await request('/api/document-requirements', {
    method: 'POST',
    headers: manager.headers,
    body: JSON.stringify({
      scope: 'employee',
      name: 'Smoke manual requirement',
      requiredFor: createdPosition.position.id,
      renewEveryMonths: 18,
      warningDays: 50,
    }),
  });
  if (
    manualRequirement.tenantId !== 'tenant-pf'
    || manualRequirement.scope !== 'employee'
    || manualRequirement.requiredFor !== createdPosition.position.id
    || manualRequirement.warningDays !== 50
  ) {
    throw new Error(`Document requirement create failed: ${JSON.stringify(manualRequirement)}`);
  }
  const updatedRequirement = await request(`/api/document-requirements/${manualRequirement.id}`, {
    method: 'PATCH',
    headers: manager.headers,
    body: JSON.stringify({
      name: 'Smoke manual requirement v2',
      warningDays: 55,
    }),
  });
  if (updatedRequirement.name !== 'Smoke manual requirement v2' || updatedRequirement.warningDays !== 55) {
    throw new Error(`Document requirement update failed: ${JSON.stringify(updatedRequirement)}`);
  }
  const unusedRequirement = await request('/api/document-requirements', {
    method: 'POST',
    headers: manager.headers,
    body: JSON.stringify({
      scope: 'company',
      name: 'Smoke unused requirement',
      requiredFor: 'all',
      warningDays: 20,
    }),
  });
  const deletedUnusedRequirement = await request(`/api/document-requirements/${unusedRequirement.id}`, {
    method: 'DELETE',
    headers: manager.headers,
  });
  if (!deletedUnusedRequirement.deleted || deletedUnusedRequirement.archived || deletedUnusedRequirement.requirement !== null) {
    throw new Error(`Unused document requirement should be deleted: ${JSON.stringify(deletedUnusedRequirement)}`);
  }
  const positionBack = await request('/api/job-positions', { headers: manager.headers });
  if (!positionBack.some((position) => position.id === createdPosition.position.id && position.tenantId === 'tenant-pf')) {
    throw new Error(`Created job position missing from list: ${JSON.stringify(positionBack)}`);
  }
  const unusedPosition = await request('/api/job-positions', {
    method: 'POST',
    headers: manager.headers,
    body: JSON.stringify({
      title: 'Smoke stanowisko do usuniecia',
      department: 'office',
      contractType: 'employment',
      rate: '7200 PLN brutto',
      requiredDocuments: ['Smoke unused position document'],
      requiredTraining: ['Smoke unused position training'],
    }),
  });
  const deletedUnusedPosition = await request(`/api/job-positions/${unusedPosition.position.id}`, {
    method: 'DELETE',
    headers: manager.headers,
  });
  if (!deletedUnusedPosition.deleted || deletedUnusedPosition.archived || deletedUnusedPosition.position !== null) {
    throw new Error(`Unused job position should be deleted: ${JSON.stringify(deletedUnusedPosition)}`);
  }
  const positionsAfterUnusedDelete = await request('/api/job-positions', { headers: manager.headers });
  if (positionsAfterUnusedDelete.some((position) => position.id === unusedPosition.position.id)) {
    throw new Error(`Deleted unused job position should be hidden: ${JSON.stringify(positionsAfterUnusedDelete)}`);
  }
  const usedArchivePosition = await request('/api/job-positions', {
    method: 'POST',
    headers: manager.headers,
    body: JSON.stringify({
      title: 'Smoke stanowisko archiwizowane',
      department: 'sales',
      contractType: 'b2b',
      rate: '8300 PLN netto',
      requiredDocuments: ['Smoke archived position document'],
      requiredTraining: ['Smoke archived position training'],
    }),
  });
  const usedArchiveContract = await request('/api/hr/contracts', {
    method: 'POST',
    headers: manager.headers,
    body: JSON.stringify({
      employeeId: admin.user.id,
      positionId: usedArchivePosition.position.id,
      startDate: '2026-09-01',
      endDate: '2027-08-31',
      generateDocument: false,
      replaceExisting: false,
    }),
  });
  const archivedUsedPosition = await request(`/api/job-positions/${usedArchivePosition.position.id}`, {
    method: 'DELETE',
    headers: manager.headers,
  });
  if (!archivedUsedPosition.archived || archivedUsedPosition.deleted || archivedUsedPosition.position.status !== 'archived') {
    throw new Error(`Used job position should be archived: ${JSON.stringify(archivedUsedPosition)}`);
  }
  const positionsAfterArchive = await request('/api/job-positions', { headers: manager.headers });
  if (positionsAfterArchive.some((position) => position.id === usedArchivePosition.position.id)) {
    throw new Error(`Archived used job position should be hidden: ${JSON.stringify(positionsAfterArchive)}`);
  }
  const contractsAfterPositionArchive = await request('/api/hr/contracts', { headers: manager.headers });
  if (!contractsAfterPositionArchive.some((contract) => contract.id === usedArchiveContract.contract.id)) {
    throw new Error(`Archiving a used position must not hide its contract: ${JSON.stringify(contractsAfterPositionArchive)}`);
  }
  const customPositionContract = await request('/api/hr/contracts', {
    method: 'POST',
    headers: manager.headers,
    body: JSON.stringify({
      employeeId: admin.user.id,
      positionId: createdPosition.position.id,
      startDate: '2026-08-01',
      endDate: '2027-07-31',
      generateDocument: true,
      replaceExisting: false,
    }),
  });
  if (
    customPositionContract.contract.employeeId !== admin.user.id
    || customPositionContract.contract.positionId !== createdPosition.position.id
    || customPositionContract.contract.rate !== '9900 PLN brutto'
    || !customPositionContract.document?.content?.includes('Smoke operator podnosnika')
    || !customPositionContract.compliance.items.some((item) => item.name === 'Smoke karta operatora' && item.status === 'missing')
    || !customPositionContract.compliance.items.some((item) => item.requirementId === updatedRequirement.id && item.status === 'missing')
  ) {
    throw new Error(`Custom position contract/compliance failed: ${JSON.stringify(customPositionContract)}`);
  }
  const contractsBack = await request('/api/hr/contracts', { headers: manager.headers });
  if (!contractsBack.some((contract) => contract.id === customPositionContract.contract.id)) {
    throw new Error(`Created HR contract missing from list: ${JSON.stringify(contractsBack)}`);
  }
  const updatedCustomContract = await request(`/api/hr/contracts/${customPositionContract.contract.id}`, {
    method: 'PATCH',
    headers: manager.headers,
    body: JSON.stringify({
      status: 'ending',
      endDate: '2027-08-31',
      rate: '10100 PLN brutto',
      generateDocument: false,
    }),
  });
  if (
    updatedCustomContract.contract.status !== 'ending'
    || updatedCustomContract.contract.endDate !== '2027-08-31'
    || updatedCustomContract.contract.rate !== '10100 PLN brutto'
    || updatedCustomContract.document !== null
  ) {
    throw new Error(`HR contract update failed: ${JSON.stringify(updatedCustomContract)}`);
  }
  const attachedManualRequirement = await request('/api/documents/attach', {
    method: 'POST',
    headers: manager.headers,
    body: JSON.stringify({
      subjectType: 'employee',
      subjectId: admin.user.id,
      requirementId: updatedRequirement.id,
      summary: 'Smoke manual requirement attachment',
      fileName: 'smoke-manual-requirement.pdf',
      fileUrl: '/documents/smoke/manual-requirement.pdf',
    }),
  });
  if (!attachedManualRequirement.compliance.items.some((item) => item.requirementId === updatedRequirement.id && item.fulfilled)) {
    throw new Error(`Manual requirement attachment did not satisfy compliance: ${JSON.stringify(attachedManualRequirement)}`);
  }
  const archivedRequirement = await request(`/api/document-requirements/${updatedRequirement.id}`, {
    method: 'DELETE',
    headers: manager.headers,
  });
  if (!archivedRequirement.archived || archivedRequirement.deleted || archivedRequirement.requirement.status !== 'archived') {
    throw new Error(`Used document requirement should be archived: ${JSON.stringify(archivedRequirement)}`);
  }
  const archivedCustomContract = await request(`/api/hr/contracts/${updatedCustomContract.contract.id}`, {
    method: 'DELETE',
    headers: manager.headers,
  });
  if (!archivedCustomContract.archived || archivedCustomContract.deleted || archivedCustomContract.contract.status !== 'archived') {
    throw new Error(`HR contract delete should archive: ${JSON.stringify(archivedCustomContract)}`);
  }
  const contractsAfterArchiveDelete = await request('/api/hr/contracts', { headers: manager.headers });
  if (contractsAfterArchiveDelete.some((contract) => contract.id === updatedCustomContract.contract.id)) {
    throw new Error(`Archived HR contract should be hidden: ${JSON.stringify(contractsAfterArchiveDelete)}`);
  }
  const automatedContract = await request('/api/hr/contracts', {
    method: 'POST',
    headers: manager.headers,
    body: JSON.stringify({
      employeeId: manager.user.id,
      positionId: 'pos-2',
      startDate: '2026-07-01',
      endDate: '2027-06-30',
      rate: '13500 PLN netto',
      templateId: 'tpl-1',
      generateDocument: true,
      replaceExisting: false,
    }),
  });
  if (
    automatedContract.contract.employeeId !== manager.user.id
    || automatedContract.contract.positionId !== 'pos-2'
    || automatedContract.contract.type !== 'b2b'
    || automatedContract.contract.status !== 'active'
    || automatedContract.contract.rate !== '13500 PLN netto'
    || !automatedContract.contract.generatedDocumentId
    || automatedContract.document?.id !== automatedContract.contract.generatedDocumentId
    || automatedContract.document?.requirementId !== 'req-3'
    || !automatedContract.document?.content?.includes('Wyceniający terenowy')
    || !automatedContract.compliance.items.some((item) => item.requirementId === 'req-3' && item.fulfilled && item.documentId === automatedContract.document.id)
  ) {
    throw new Error(`HR contract automation failed: ${JSON.stringify(automatedContract)}`);
  }
  const employeeComplianceBefore = await request('/api/documents/compliance?subjectType=employee&subjectId=u-lead', {
    headers: manager.headers,
  });
  if (employeeComplianceBefore.required < 2 || !employeeComplianceBefore.items.some((item) => item.requirementId === 'req-3' && item.status === 'missing')) {
    throw new Error(`Employee compliance should show missing requirement: ${JSON.stringify(employeeComplianceBefore)}`);
  }
  const attachedBhpDocument = await request('/api/documents/attach', {
    method: 'POST',
    headers: manager.headers,
    body: JSON.stringify({
      subjectType: 'employee',
      subjectId: 'u-lead',
      requirementId: 'req-2',
      summary: 'Smoke uploaded BHP certificate',
      fileName: 'bhp-smoke-u-lead.pdf',
      fileUrl: '/documents/smoke/bhp-smoke-u-lead.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 24576,
      status: 'signed',
      signerName: 'Piotr Wrona',
      method: 'mobile',
      expiresAt: '2027-06-30',
    }),
  });
  if (
    attachedBhpDocument.document.status !== 'signed'
    || attachedBhpDocument.document.source !== 'upload'
    || attachedBhpDocument.document.requirementId !== 'req-2'
    || attachedBhpDocument.document.fileUrl !== '/documents/smoke/bhp-smoke-u-lead.pdf'
    || attachedBhpDocument.document.expiresAt !== '2027-06-30'
    || attachedBhpDocument.document.signatureMethod !== 'mobile'
    || !attachedBhpDocument.document.signatureHash
    || !attachedBhpDocument.compliance.items.some((item) => (
      item.requirementId === 'req-2'
      && item.fulfilled
      && item.documentStatus === 'signed'
      && item.expiresAt === '2027-06-30'
    ))
  ) {
    throw new Error(`Manual document attachment failed: ${JSON.stringify(attachedBhpDocument)}`);
  }
  const fulfilledRequirement = await request('/api/document-requirements/req-1/fulfill', {
    method: 'POST',
    headers: manager.headers,
    body: JSON.stringify({
      subjectType: 'employee',
      subjectId: 'u-lead',
      templateId: 'tpl-1',
      summary: 'Smoke fulfillment for high work medical exam',
    }),
  });
  if (
    fulfilledRequirement.document.requirementId !== 'req-1'
    || fulfilledRequirement.document.tenantId !== 'tenant-pf'
    || !fulfilledRequirement.compliance.items.some((item) => item.requirementId === 'req-1' && item.fulfilled)
  ) {
    throw new Error(`Document requirement fulfillment failed: ${JSON.stringify(fulfilledRequirement)}`);
  }
  const hrCompliance = await request('/api/hr/compliance?days=90', { headers: manager.headers });
  if (
    hrCompliance.tenantId !== 'tenant-pf'
    || hrCompliance.summary.expirations < 2
    || !hrCompliance.expirations.some((item) => item.kind === 'contract' && item.owner.id === 'u-est')
    || !hrCompliance.missingDocuments.some((item) => item.subjectId === 'u-est')
  ) {
    throw new Error(`HR compliance report failed: ${JSON.stringify(hrCompliance)}`);
  }

  // Daty względem "dziś" — zahardkodowane daty psuły test po ich przekroczeniu w kalendarzu
  // (due_soon = okno 30 dni przed expiresAt, valid = dalej niż okno).
  const isoInDays = (days) => new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const training = await request('/api/hr/trainings', {
    method: 'POST',
    headers: manager.headers,
    body: JSON.stringify({
      employeeId: 'u-lead',
      name: 'Smoke szkolenie ratownictwo drzewne',
      completedAt: isoInDays(-40),
      expiresAt: isoInDays(14),
    }),
  });
  if (training.employeeId !== 'u-lead' || training.status !== 'due_soon') {
    throw new Error(`Training create failed: ${JSON.stringify(training)}`);
  }
  const updatedTraining = await request(`/api/hr/trainings/${training.id}`, {
    method: 'PATCH',
    headers: manager.headers,
    body: JSON.stringify({
      name: 'Smoke szkolenie ratownictwo drzewne v2',
      expiresAt: isoInDays(370),
    }),
  });
  if (updatedTraining.name !== 'Smoke szkolenie ratownictwo drzewne v2' || updatedTraining.status !== 'valid') {
    throw new Error(`Training update failed: ${JSON.stringify(updatedTraining)}`);
  }
  const medicalExam = await request('/api/hr/medical-exams', {
    method: 'POST',
    headers: manager.headers,
    body: JSON.stringify({
      employeeId: 'u-lead',
      type: 'height',
      issuedAt: isoInDays(-50),
      expiresAt: isoInDays(9),
    }),
  });
  if (medicalExam.employeeId !== 'u-lead' || medicalExam.type !== 'height' || medicalExam.status !== 'due_soon') {
    throw new Error(`Medical exam create failed: ${JSON.stringify(medicalExam)}`);
  }
  const updatedMedicalExam = await request(`/api/hr/medical-exams/${medicalExam.id}`, {
    method: 'PATCH',
    headers: manager.headers,
    body: JSON.stringify({ type: 'occupational', expiresAt: isoInDays(375) }),
  });
  if (updatedMedicalExam.type !== 'occupational' || updatedMedicalExam.status !== 'valid') {
    throw new Error(`Medical exam update failed: ${JSON.stringify(updatedMedicalExam)}`);
  }
  const certification = await request('/api/hr/certifications', {
    method: 'POST',
    headers: manager.headers,
    body: JSON.stringify({
      employeeId: 'u-lead',
      name: 'Smoke certyfikat pilarkowy',
      issuer: 'Smoke Safety',
      issuedAt: isoInDays(-180),
      expiresAt: isoInDays(15),
    }),
  });
  if (certification.employeeId !== 'u-lead' || certification.status !== 'due_soon') {
    throw new Error(`Certification create failed: ${JSON.stringify(certification)}`);
  }
  const updatedCertification = await request(`/api/hr/certifications/${certification.id}`, {
    method: 'PATCH',
    headers: manager.headers,
    body: JSON.stringify({ issuer: 'Smoke Safety Updated', expiresAt: isoInDays(365) }),
  });
  if (updatedCertification.issuer !== 'Smoke Safety Updated' || updatedCertification.status !== 'valid') {
    throw new Error(`Certification update failed: ${JSON.stringify(updatedCertification)}`);
  }
  const archivedTraining = await request(`/api/hr/trainings/${training.id}`, {
    method: 'DELETE',
    headers: manager.headers,
  });
  const archivedMedicalExam = await request(`/api/hr/medical-exams/${medicalExam.id}`, {
    method: 'DELETE',
    headers: manager.headers,
  });
  const archivedCertification = await request(`/api/hr/certifications/${certification.id}`, {
    method: 'DELETE',
    headers: manager.headers,
  });
  if (!archivedTraining.archived || archivedTraining.training.status !== 'archived') {
    throw new Error(`Training archive failed: ${JSON.stringify(archivedTraining)}`);
  }
  if (!archivedMedicalExam.archived || archivedMedicalExam.exam.status !== 'archived') {
    throw new Error(`Medical exam archive failed: ${JSON.stringify(archivedMedicalExam)}`);
  }
  if (!archivedCertification.archived || archivedCertification.certification.status !== 'archived') {
    throw new Error(`Certification archive failed: ${JSON.stringify(archivedCertification)}`);
  }
  const hrListsAfterArchive = await Promise.all([
    request('/api/hr/trainings', { headers: manager.headers }),
    request('/api/hr/medical-exams', { headers: manager.headers }),
    request('/api/hr/certifications', { headers: manager.headers }),
  ]);
  if (hrListsAfterArchive[0].some((item) => item.id === training.id)) {
    throw new Error(`Archived training should be hidden: ${JSON.stringify(hrListsAfterArchive[0])}`);
  }
  if (hrListsAfterArchive[1].some((item) => item.id === medicalExam.id)) {
    throw new Error(`Archived medical exam should be hidden: ${JSON.stringify(hrListsAfterArchive[1])}`);
  }
  if (hrListsAfterArchive[2].some((item) => item.id === certification.id)) {
    throw new Error(`Archived certification should be hidden: ${JSON.stringify(hrListsAfterArchive[2])}`);
  }

  await expectStatus('/api/crews', 403, {
    method: 'POST',
    headers: roles.brygadzista.session.headers,
    body: JSON.stringify({ name: 'Smoke forbidden crew', leaderId: 'u-lead', members: ['Piotr Wrona'] }),
  });
  const crewName = `Smoke ekipa ${Date.now()}`;
  const createdCrew = await request('/api/crews', {
    method: 'POST',
    headers: manager.headers,
    body: JSON.stringify({
      branchId: 'krk',
      name: crewName,
      leaderId: manager.user.id,
      members: ['Smoke Lider', 'Smoke Operator'],
      utilization: 41,
    }),
  });
  if (createdCrew.branchId !== 'krk' || createdCrew.name !== crewName || createdCrew.status !== 'active') {
    throw new Error(`Crew create failed: ${JSON.stringify(createdCrew)}`);
  }
  await expectStatus('/api/crews', 409, {
    method: 'POST',
    headers: manager.headers,
    body: JSON.stringify({ branchId: 'krk', name: crewName, leaderId: manager.user.id, members: ['Duplicate'], utilization: 12 }),
  });
  const updatedCrew = await request(`/api/crews/${createdCrew.id}`, {
    method: 'PATCH',
    headers: manager.headers,
    body: JSON.stringify({
      name: `${crewName} v2`,
      members: ['Smoke Lider', 'Smoke Arborysta', 'Smoke Kierowca'],
      utilization: 58,
    }),
  });
  if (updatedCrew.name !== `${crewName} v2` || updatedCrew.members.length !== 3 || updatedCrew.utilization !== 58) {
    throw new Error(`Crew update failed: ${JSON.stringify(updatedCrew)}`);
  }
  const deletedUnusedCrew = await request(`/api/crews/${createdCrew.id}`, {
    method: 'DELETE',
    headers: manager.headers,
  });
  if (!deletedUnusedCrew.deleted || deletedUnusedCrew.archived) {
    throw new Error(`Unused crew should be deleted: ${JSON.stringify(deletedUnusedCrew)}`);
  }
  const crewsAfterUnusedDelete = await request('/api/crews', { headers: manager.headers });
  if (crewsAfterUnusedDelete.some((crew) => crew.id === createdCrew.id)) {
    throw new Error(`Deleted unused crew should be hidden: ${JSON.stringify(crewsAfterUnusedDelete)}`);
  }
  const usedCrew = await request('/api/crews', {
    method: 'POST',
    headers: manager.headers,
    body: JSON.stringify({
      branchId: 'krk',
      name: `${crewName} archive`,
      leaderId: manager.user.id,
      members: ['Smoke History'],
      utilization: 20,
    }),
  });
  const crewOrder = await request('/api/orders', {
    method: 'POST',
    headers: manager.headers,
    body: JSON.stringify({
      clientId: crmClient.id,
      branchId: 'krk',
      teamId: usedCrew.id,
      type: 'Smoke crew archive order',
      scheduledAt: '2026-09-24T09:00:00.000Z',
      priority: 'normalny',
      value: 1234,
    }),
  });
  if (crewOrder.teamId !== usedCrew.id) {
    throw new Error(`Crew order assignment failed: ${JSON.stringify(crewOrder)}`);
  }
  const archivedCrew = await request(`/api/crews/${usedCrew.id}`, {
    method: 'DELETE',
    headers: manager.headers,
  });
  if (!archivedCrew.archived || archivedCrew.deleted || archivedCrew.crew.status !== 'archived' || !archivedCrew.crew.deletedAt) {
    throw new Error(`Used crew should be archived: ${JSON.stringify(archivedCrew)}`);
  }
  const crewsAfterArchive = await request('/api/crews', { headers: manager.headers });
  if (crewsAfterArchive.some((crew) => crew.id === usedCrew.id)) {
    throw new Error(`Archived crew should be hidden: ${JSON.stringify(crewsAfterArchive)}`);
  }

  const equipmentBoot = await request('/api/bootstrap', { headers: manager.headers });
  const availableEquipment = equipmentBoot.equipment.find((item) => item.status !== 'serwis');
  if (!availableEquipment) throw new Error('No equipment available for reservation smoke');
  const createdEquipment = await request('/api/equipment', {
    method: 'POST',
    headers: manager.headers,
    body: JSON.stringify({
      name: 'Smoke pilarka testowa',
      type: 'pilarka',
      status: 'serwis',
      risk: 'sredni',
      branchId: 'krk',
      reviewDue: '2027-01-15',
    }),
  });
  if (
    createdEquipment.branchId !== 'krk'
    || createdEquipment.type !== 'pilarka'
    || createdEquipment.status !== 'serwis'
    || createdEquipment.reviewDue !== '2027-01-15'
  ) {
    throw new Error(`Equipment create failed: ${JSON.stringify(createdEquipment)}`);
  }
  const updatedEquipment = await request(`/api/equipment/${createdEquipment.id}`, {
    method: 'PATCH',
    headers: manager.headers,
    body: JSON.stringify({
      name: 'Smoke pilarka po przegladzie',
      status: 'dostepny',
      risk: 'wysoki',
      reviewDue: '2027-02-01',
    }),
  });
  if (
    updatedEquipment.name !== 'Smoke pilarka po przegladzie'
    || updatedEquipment.status !== 'dostepny'
    || updatedEquipment.risk !== 'wysoki'
    || updatedEquipment.reviewDue !== '2027-02-01'
  ) {
    throw new Error(`Equipment update failed: ${JSON.stringify(updatedEquipment)}`);
  }
  const deletedUnusedEquipment = await request(`/api/equipment/${createdEquipment.id}`, {
    method: 'DELETE',
    headers: manager.headers,
  });
  if (!deletedUnusedEquipment.deleted || deletedUnusedEquipment.archived || deletedUnusedEquipment.equipment !== null) {
    throw new Error(`Unused equipment should be deleted: ${JSON.stringify(deletedUnusedEquipment)}`);
  }
  const equipmentAfterUnusedDelete = await request('/api/equipment', { headers: manager.headers });
  if (equipmentAfterUnusedDelete.some((item) => item.id === createdEquipment.id)) {
    throw new Error(`Deleted unused equipment should be hidden: ${JSON.stringify(equipmentAfterUnusedDelete)}`);
  }
  const reservationBody = {
    orderId: crmOrder.id,
    startsAt: '2026-09-22T08:00:00.000Z',
    endsAt: '2026-09-22T16:00:00.000Z',
  };
  const reservation = await request(`/api/equipment/${availableEquipment.id}/reservations`, {
    method: 'POST',
    headers: manager.headers,
    body: JSON.stringify(reservationBody),
  });
  if (reservation.equipmentId !== availableEquipment.id || reservation.orderId !== crmOrder.id) {
    throw new Error(`Equipment reservation failed: ${JSON.stringify(reservation)}`);
  }
  await expectStatus(`/api/equipment/${availableEquipment.id}/reservations`, 409, {
    method: 'POST',
    headers: manager.headers,
    body: JSON.stringify(reservationBody),
  });
  const updatedReservation = await request(`/api/equipment-reservations/${reservation.id}`, {
    method: 'PATCH',
    headers: manager.headers,
    body: JSON.stringify({
      startsAt: '2026-09-22T09:00:00.000Z',
      endsAt: '2026-09-22T17:00:00.000Z',
    }),
  });
  if (
    updatedReservation.id !== reservation.id
    || updatedReservation.startsAt !== '2026-09-22T09:00:00.000Z'
    || updatedReservation.endsAt !== '2026-09-22T17:00:00.000Z'
    || updatedReservation.status !== 'active'
    || !updatedReservation.updatedAt
  ) {
    throw new Error(`Equipment reservation update failed: ${JSON.stringify(updatedReservation)}`);
  }
  const reservationList = await request('/api/equipment-reservations', { headers: manager.headers });
  if (!reservationList.some((item) => item.id === reservation.id && item.startsAt === updatedReservation.startsAt)) {
    throw new Error(`Equipment reservation list missing updated reservation: ${JSON.stringify(reservationList)}`);
  }
  await expectStatus(`/api/equipment/${availableEquipment.id}/reservations`, 409, {
    method: 'POST',
    headers: manager.headers,
    body: JSON.stringify({
      orderId: crmOrder.id,
      startsAt: '2026-09-22T16:30:00.000Z',
      endsAt: '2026-09-22T18:00:00.000Z',
    }),
  });
  await expectStatus(`/api/equipment/${availableEquipment.id}`, 409, {
    method: 'DELETE',
    headers: manager.headers,
  });
  const cancelledReservation = await request(`/api/equipment-reservations/${reservation.id}`, {
    method: 'DELETE',
    headers: manager.headers,
  });
  if (cancelledReservation.status !== 'cancelled') throw new Error(`Equipment reservation cancel failed: ${JSON.stringify(cancelledReservation)}`);
  const archivedEquipment = await request(`/api/equipment/${availableEquipment.id}`, {
    method: 'DELETE',
    headers: manager.headers,
  });
  if (!archivedEquipment.archived || archivedEquipment.deleted || archivedEquipment.equipment.status !== 'archived') {
    throw new Error(`Used equipment should be archived: ${JSON.stringify(archivedEquipment)}`);
  }
  const equipmentAfterArchive = await request('/api/equipment', { headers: manager.headers });
  if (equipmentAfterArchive.some((item) => item.id === availableEquipment.id)) {
    throw new Error(`Archived equipment should be hidden: ${JSON.stringify(equipmentAfterArchive)}`);
  }

  await expectStatus('/api/warehouse', 403, { headers: roles.brygadzista.session.headers });
  const warehouseItemName = `Smoke sorbent ${Date.now()}`;
  const warehouseItem = await request('/api/warehouse/items', {
    method: 'POST',
    headers: manager.headers,
    body: JSON.stringify({
      name: warehouseItemName,
      unit: 'szt',
      stock: 12,
      minStock: 4,
      supplier: 'Smoke Supplier',
    }),
  });
  if (!warehouseItem.id || warehouseItem.stock !== 12 || warehouseItem.branchId !== 'krk') {
    throw new Error(`Warehouse item create failed: ${JSON.stringify(warehouseItem)}`);
  }
  await expectStatus('/api/warehouse/items', 409, {
    method: 'POST',
    headers: manager.headers,
    body: JSON.stringify({ name: warehouseItemName, unit: 'szt', stock: 1, minStock: 1 }),
  });
  const updatedWarehouseItem = await request(`/api/warehouse/items/${warehouseItem.id}`, {
    method: 'PATCH',
    headers: manager.headers,
    body: JSON.stringify({
      name: `${warehouseItemName} v2`,
      stock: 14,
      minStock: 5,
      supplier: 'Smoke Supplier Updated',
    }),
  });
  if (
    updatedWarehouseItem.name !== `${warehouseItemName} v2`
    || updatedWarehouseItem.stock !== 14
    || updatedWarehouseItem.minStock !== 5
    || updatedWarehouseItem.supplier !== 'Smoke Supplier Updated'
  ) {
    throw new Error(`Warehouse item update failed: ${JSON.stringify(updatedWarehouseItem)}`);
  }
  const unusedWarehouseItem = await request('/api/warehouse/items', {
    method: 'POST',
    headers: manager.headers,
    body: JSON.stringify({
      name: `Smoke unused material ${Date.now()}`,
      unit: 'kg',
      stock: 2,
      minStock: 1,
    }),
  });
  const deletedUnusedWarehouseItem = await request(`/api/warehouse/items/${unusedWarehouseItem.id}`, {
    method: 'DELETE',
    headers: manager.headers,
  });
  if (!deletedUnusedWarehouseItem.deleted || deletedUnusedWarehouseItem.archived || deletedUnusedWarehouseItem.item !== null) {
    throw new Error(`Unused warehouse item should be deleted: ${JSON.stringify(deletedUnusedWarehouseItem)}`);
  }
  const warehouseAfterUnusedDelete = await request('/api/warehouse', { headers: manager.headers });
  if (warehouseAfterUnusedDelete.items.some((item) => item.id === unusedWarehouseItem.id)) {
    throw new Error(`Deleted unused warehouse item should be hidden: ${JSON.stringify(warehouseAfterUnusedDelete)}`);
  }
  const warehouseMovement = await request('/api/warehouse/movements', {
    method: 'POST',
    headers: manager.headers,
    body: JSON.stringify({
      itemId: warehouseItem.id,
      type: 'out',
      qty: 9,
      orderId: crmOrder.id,
      note: 'Smoke issue to crew',
    }),
  });
  if (warehouseMovement.item.stock !== 5 || warehouseMovement.movement.type !== 'out') {
    throw new Error(`Warehouse movement failed: ${JSON.stringify(warehouseMovement)}`);
  }
  await expectStatus('/api/warehouse/movements', 409, {
    method: 'POST',
    headers: manager.headers,
    body: JSON.stringify({ itemId: warehouseItem.id, type: 'out', qty: 99 }),
  });
  const archivedWarehouseItem = await request(`/api/warehouse/items/${warehouseItem.id}`, {
    method: 'DELETE',
    headers: manager.headers,
  });
  if (!archivedWarehouseItem.archived || archivedWarehouseItem.deleted || archivedWarehouseItem.item.status !== 'archived') {
    throw new Error(`Used warehouse item should be archived: ${JSON.stringify(archivedWarehouseItem)}`);
  }
  const warehouseAfterArchive = await request('/api/warehouse', { headers: manager.headers });
  if (warehouseAfterArchive.items.some((item) => item.id === warehouseItem.id)) {
    throw new Error(`Archived warehouse item should be hidden: ${JSON.stringify(warehouseAfterArchive)}`);
  }
  await expectStatus('/api/reports/overview', 403, { headers: roles.brygadzista.session.headers });
  const report = await request('/api/reports/overview', { headers: manager.headers });
  if (!report.kpis || report.kpis.orders < 1 || report.kpis.revenueNet < crmOrder.value) {
    throw new Error(`Report KPIs are invalid: ${JSON.stringify(report)}`);
  }
  if (!report.scope?.orderIds?.includes(crmOrder.id)) {
    throw new Error(`Report scope does not include CRM order ${crmOrder.id}: ${JSON.stringify(report.scope)}`);
  }
  if (!report.crewPerformance || !Array.isArray(report.revenueByMonth)) {
    throw new Error(`Report sections are missing: ${JSON.stringify(report)}`);
  }

  const valuationCrudOrder = await request('/api/orders', {
    method: 'POST',
    headers: manager.headers,
    body: JSON.stringify({
      clientId: crmClient.id,
      type: 'Smoke valuation CRUD order',
      scheduledAt: '2026-09-25T09:00:00.000Z',
      inspectionAt: '2026-09-24T11:00:00.000Z',
      priority: 'normalny',
      value: 6100,
      margin: 31,
    }),
  });
  const createdValuation = await request('/api/valuations', {
    method: 'POST',
    headers: manager.headers,
    body: JSON.stringify({
      orderId: valuationCrudOrder.id,
      estimatorId: 'u-est',
      status: 'do_potwierdzenia',
      totalNet: 6100,
      margin: 31,
      notes: 'Smoke valuation create',
      media: ['smoke-photo'],
      items: [{ name: 'Smoke valuation item', qty: 1, unit: 'usl.', price: 6100, cost: 3900 }],
    }),
  });
  if (createdValuation.orderId !== valuationCrudOrder.id || createdValuation.estimatorId !== 'u-est' || createdValuation.totalNet !== 6100) {
    throw new Error(`Valuation create failed: ${JSON.stringify(createdValuation)}`);
  }
  await expectStatus('/api/valuations', 409, {
    method: 'POST',
    headers: manager.headers,
    body: JSON.stringify({
      orderId: valuationCrudOrder.id,
      replaceExisting: false,
      totalNet: 6200,
    }),
  });
  const patchedValuation = await request(`/api/valuations/${createdValuation.id}`, {
    method: 'PATCH',
    headers: manager.headers,
    body: JSON.stringify({
      status: 'zatwierdzona',
      totalNet: 6400,
      margin: 35,
      notes: 'Smoke valuation patched',
      media: ['smoke-photo', 'smoke-map'],
      items: [{ name: 'Smoke valuation patched item', qty: 2, unit: 'szt', price: 3200, cost: 1900 }],
    }),
  });
  if (
    patchedValuation.status !== 'zatwierdzona'
    || patchedValuation.totalNet !== 6400
    || patchedValuation.margin !== 35
    || patchedValuation.media.length !== 2
    || patchedValuation.items[0]?.qty !== 2
  ) {
    throw new Error(`Valuation patch failed: ${JSON.stringify(patchedValuation)}`);
  }
  const archivedValuation = await request(`/api/valuations/${createdValuation.id}`, {
    method: 'DELETE',
    headers: manager.headers,
  });
  if (!archivedValuation.archived || archivedValuation.deleted || !archivedValuation.valuation.deletedAt) {
    throw new Error(`Valuation archive failed: ${JSON.stringify(archivedValuation)}`);
  }
  const valuationsAfterArchive = await request('/api/valuations', { headers: manager.headers });
  if (valuationsAfterArchive.some((valuation) => valuation.id === createdValuation.id)) {
    throw new Error(`Archived valuation should be hidden: ${JSON.stringify(valuationsAfterArchive)}`);
  }
  const reactivatedValuation = await request('/api/valuations', {
    method: 'POST',
    headers: manager.headers,
    body: JSON.stringify({
      orderId: valuationCrudOrder.id,
      estimatorId: 'u-est',
      totalNet: 6500,
      margin: 36,
      notes: 'Smoke valuation reactivated',
      media: ['smoke-reactivated'],
      items: [{ name: 'Smoke reactivated item', qty: 1, unit: 'usl.', price: 6500, cost: 4100 }],
    }),
  });
  if (reactivatedValuation.id !== createdValuation.id || reactivatedValuation.deletedAt || reactivatedValuation.totalNet !== 6500) {
    throw new Error(`Valuation reactivation failed: ${JSON.stringify(reactivatedValuation)}`);
  }

  const seedTrees = await request('/api/tree-assets', { headers: manager.headers });
  if (!seedTrees.some((tree) => tree.id === 'tree-parkowa-1') || seedTrees.some((tree) => tree.tenantId === 'tenant-other')) {
    throw new Error(`Seed tree assets missing or leaked: ${JSON.stringify(seedTrees)}`);
  }
  const createdTree = await request('/api/tree-assets', {
    method: 'POST',
    headers: manager.headers,
    body: JSON.stringify({
      clientId: crmClient.id,
      orderId: valuationCrudOrder.id,
      valuationId: reactivatedValuation.id,
      species: 'Tilia cordata',
      commonName: 'Lipa drobnolistna',
      heightM: 12.4,
      diameterCm: 38,
      condition: 'fair',
      riskLevel: 'medium',
      workRecommendation: 'Redukcja suszu i monitoring po wichurach.',
      gpsLat: 50.061,
      gpsLng: 19.938,
      photos: ['/photos/smoke/tree-before.jpg'],
      notes: 'Smoke tree inventory create',
      lastInspectionAt: '2026-09-24T11:15:00.000Z',
    }),
  });
  if (
    createdTree.tenantId !== 'tenant-pf'
    || createdTree.clientId !== crmClient.id
    || createdTree.orderId !== valuationCrudOrder.id
    || createdTree.valuationId !== reactivatedValuation.id
    || createdTree.status !== 'active'
  ) {
    throw new Error(`Tree asset create failed: ${JSON.stringify(createdTree)}`);
  }
  const patchedTree = await request(`/api/tree-assets/${createdTree.id}`, {
    method: 'PATCH',
    headers: manager.headers,
    body: JSON.stringify({
      condition: 'poor',
      riskLevel: 'high',
      workRecommendation: 'Pilna korekta korony i zabezpieczenie strefy pracy.',
      photos: ['/photos/smoke/tree-before.jpg', '/photos/smoke/tree-map.jpg'],
    }),
  });
  if (patchedTree.condition !== 'poor' || patchedTree.riskLevel !== 'high' || patchedTree.photos.length !== 2) {
    throw new Error(`Tree asset patch failed: ${JSON.stringify(patchedTree)}`);
  }
  const treeTimeline = await request(`/api/clients/${crmClient.id}/timeline`, { headers: manager.headers });
  if (!treeTimeline.events.some((event) => event.type === 'tree' && event.sourceId === patchedTree.id)) {
    throw new Error(`Tree asset missing from client timeline: ${JSON.stringify(treeTimeline.events.slice(0, 8))}`);
  }
  const archivedTree = await request(`/api/tree-assets/${createdTree.id}`, {
    method: 'DELETE',
    headers: manager.headers,
  });
  if (!archivedTree.archived || archivedTree.deleted || archivedTree.tree.status !== 'archived' || !archivedTree.tree.deletedAt) {
    throw new Error(`Tree asset archive failed: ${JSON.stringify(archivedTree)}`);
  }
  const activeTreesAfterArchive = await request(`/api/tree-assets?clientId=${crmClient.id}`, { headers: manager.headers });
  if (activeTreesAfterArchive.some((tree) => tree.id === createdTree.id)) {
    throw new Error(`Archived tree should be hidden: ${JSON.stringify(activeTreesAfterArchive)}`);
  }
  const allTreesAfterArchive = await request(`/api/tree-assets?clientId=${crmClient.id}&includeArchived=true`, { headers: manager.headers });
  if (!allTreesAfterArchive.some((tree) => tree.id === createdTree.id && tree.status === 'archived')) {
    throw new Error(`Archived tree should be visible with includeArchived: ${JSON.stringify(allTreesAfterArchive)}`);
  }

  const order = await request('/api/orders', {
    method: 'POST',
    headers: manager.headers,
    body: JSON.stringify({
      clientId: 'c-2',
      type: 'Smoke core flow',
      scheduledAt: '2026-09-21T09:00:00.000Z',
      priority: 'normalny',
      value: 8888,
      source: 'smoke-core',
    }),
  });

  await request(`/api/orders/${order.id}/status`, {
    method: 'PATCH',
    headers: manager.headers,
    body: JSON.stringify({ status: 'ZAKONCZONE' }),
  });

  const afterClose = await request('/api/bootstrap', { headers: manager.headers });
  const invoice = afterClose.invoices.find((next) => next.orderId === order.id);
  if (!invoice) throw new Error(`Invoice was not created for ${order.id}`);
  const updatedInvoice = await request(`/api/invoices/${invoice.id}`, {
    method: 'PATCH',
    headers: accountant.headers,
    body: JSON.stringify({
      net: invoice.net + 123,
      dueAt: '2026-10-15',
      status: 'wyslana',
    }),
  });
  if (updatedInvoice.net !== invoice.net + 123 || updatedInvoice.dueAt !== '2026-10-15' || updatedInvoice.status !== 'wyslana') {
    throw new Error(`Invoice update failed: ${JSON.stringify(updatedInvoice)}`);
  }
  const invoiceArchiveOrder = await request('/api/orders', {
    method: 'POST',
    headers: manager.headers,
    body: JSON.stringify({
      clientId: crmClient.id,
      type: 'Smoke invoice archive order',
      scheduledAt: '2026-10-02T09:00:00.000Z',
      priority: 'normalny',
      value: 444,
    }),
  });
  const invoiceToArchive = await request('/api/invoices', {
    method: 'POST',
    headers: accountant.headers,
    body: JSON.stringify({
      orderId: invoiceArchiveOrder.id,
      net: 444,
      dueAt: '2026-10-20',
      status: 'szkic',
    }),
  });
  const archivedInvoice = await request(`/api/invoices/${invoiceToArchive.id}`, {
    method: 'DELETE',
    headers: accountant.headers,
  });
  if (!archivedInvoice.archived || archivedInvoice.deleted || !archivedInvoice.invoice.deletedAt) {
    throw new Error(`Invoice archive failed: ${JSON.stringify(archivedInvoice)}`);
  }
  const invoicesAfterArchive = await request('/api/invoices', { headers: accountant.headers });
  if (invoicesAfterArchive.some((next) => next.id === invoiceToArchive.id)) {
    throw new Error(`Archived invoice should be hidden: ${JSON.stringify(invoicesAfterArchive)}`);
  }
  if (!afterClose.orders.some((next) => next.id === webhook.payload.orderId)) {
    throw new Error(`Webhook order ${webhook.payload.orderId} is not visible to manager`);
  }

  await expectStatus('/api/portal', 401, {
    method: 'PATCH',
    body: JSON.stringify({ accepted: true }),
  });
  const portalLink = await request(`/api/orders/${order.id}/portal-link`, { headers: manager.headers });
  if (!portalLink.token || portalLink.orderId !== order.id) throw new Error(`Invalid portal link: ${JSON.stringify(portalLink)}`);
  const portalHeaders = { 'x-arbor-portal-token': portalLink.token };
  const portalBefore = await request('/api/portal', { headers: portalHeaders });
  if (portalBefore.orderId !== order.id) throw new Error(`Portal points to wrong order: ${JSON.stringify(portalBefore)}`);
  const portalAfterPatch = await request('/api/portal', {
    method: 'PATCH',
    headers: portalHeaders,
    body: JSON.stringify({ accepted: true, paid: true, rating: 5 }),
  });
  if (!portalAfterPatch.accepted || !portalAfterPatch.paid || portalAfterPatch.rating !== 5) {
    throw new Error(`Portal patch failed: ${JSON.stringify(portalAfterPatch)}`);
  }
  const portalAfterMessage = await request('/api/portal/message', {
    method: 'POST',
    headers: portalHeaders,
    body: JSON.stringify({ message: 'Smoke portal message' }),
  });
  if (!portalAfterMessage.messages.some((message) => message.includes('Smoke portal message'))) {
    throw new Error(`Portal message missing: ${JSON.stringify(portalAfterMessage)}`);
  }
  const afterPortalPayment = await request('/api/bootstrap', { headers: manager.headers });
  const paidInvoice = afterPortalPayment.invoices.find((next) => next.orderId === order.id);
  if (paidInvoice?.status !== 'oplacona') throw new Error(`Portal payment did not mark invoice paid: ${JSON.stringify(paidInvoice)}`);

  const estimator = roles.wycena.session;
  const estimatorBoot = await request('/api/bootstrap', { headers: estimator.headers });
  const valuationOrder = estimatorBoot.orders.find((next) => next.id !== order.id);
  if (valuationOrder) {
    const valuation = await request('/api/valuations', {
      method: 'POST',
      headers: estimator.headers,
      body: JSON.stringify({
        orderId: valuationOrder.id,
        status: 'do_potwierdzenia',
        totalNet: 4321,
        margin: 33,
        notes: 'Smoke valuation',
        media: ['smoke'],
        items: [{ name: 'Smoke item', qty: 1, unit: 'szt', price: 4321, cost: 2600 }],
      }),
    });
    if (valuation.status !== 'do_potwierdzenia') throw new Error('Valuation status mismatch');

    const mobileMeeting = await request('/api/mobile/meeting-recordings', {
      method: 'POST',
      headers: estimator.headers,
      body: JSON.stringify({
        orderId: valuationOrder.id,
        recordingId: 'mobile-smoke-meeting-001',
        recordingUrl: '/recordings/demo/smoke-mobile-field-meeting.m4a',
        promptId: 'prompt-3',
        durationSec: 1260,
        proposedValuation: {
          totalNet: 5200,
          margin: 36,
          items: [{ name: 'Smoke field item', qty: 1, unit: 'usl.', price: 5200, cost: 3200 }],
        },
        transcript: [
          { speaker: 'Wyceniajacy', text: 'Jestesmy na miejscu, potwierdzam lokalizacje, dojazd sprzetu i ryzyka przy budynku.', atSec: 8 },
          { speaker: 'Klient', text: 'Prosze doliczyc wywoz galezi, zdjecia dosle SMS-em i zalezy mi na szybkim terminie ogledzin.', atSec: 45 },
          { speaker: 'Wyceniajacy', text: 'Przygotuje wycene z zakresem, terminem, kosztami i nastepnym krokiem do potwierdzenia.', atSec: 94 },
        ],
      }),
    });
    if (
      mobileMeeting.communication.channel !== 'mobile_meeting'
      || mobileMeeting.communication.recordingSource !== 'mobile_meeting'
      || mobileMeeting.communication.recordingStatus !== 'ready'
      || mobileMeeting.communication.transcriptStatus !== 'ready'
      || mobileMeeting.communication.analysisPromptId !== 'prompt-3'
      || mobileMeeting.communication.analysis.score < 80
      || mobileMeeting.valuation.id !== valuation.id
      || mobileMeeting.valuation.totalNet !== 5200
    ) {
      throw new Error(`Mobile field meeting recording failed: ${JSON.stringify(mobileMeeting)}`);
    }
    const mobileMeetingTimeline = await request(`/api/clients/${mobileMeeting.communication.clientId}/timeline`, { headers: estimator.headers });
    const mobileMeetingEvent = mobileMeetingTimeline.events.find((event) => event.communicationId === mobileMeeting.communication.id);
    if (
      !mobileMeetingEvent
      || mobileMeetingEvent.metadata.recordingSource !== 'mobile_meeting'
      || mobileMeetingEvent.metadata.transcriptStatus !== 'ready'
      || mobileMeetingEvent.metadata.recordingStatus !== 'ready'
    ) {
      throw new Error(`Mobile field meeting missing from client timeline: ${JSON.stringify(mobileMeetingTimeline.events.slice(0, 6))}`);
    }
  }

  const lead = roles.brygadzista.session;
  const leadBoot = await request('/api/bootstrap', { headers: lead.headers });
  const leadOrder = leadBoot.orders[0];
  if (leadOrder) {
    const sync = await request('/api/sync/mutations', {
      method: 'POST',
      headers: lead.headers,
      body: JSON.stringify({
        mutations: [
          { id: 'smoke-status', type: 'order.status', payload: { orderId: leadOrder.id, status: 'W_REALIZACJI' } },
          { id: 'smoke-check', type: 'order.checklist', payload: { orderId: leadOrder.id, label: leadOrder.checklist[0]?.label || 'BHP przed pracą', done: true } },
        ],
      }),
    });
    if (sync.conflicts.length) throw new Error(`Mobile sync conflicts: ${JSON.stringify(sync.conflicts)}`);
  }

  console.log(JSON.stringify({
    ok: true,
    roles: Object.fromEntries(Object.entries(roles).map(([role, value]) => [role, {
      user: value.user,
      orders: value.orders,
      valuations: value.valuations,
      invoices: value.invoices,
    }])),
    closedOrder: order.id,
    crmClient: crmClient.id,
    crmOrder: crmOrder.id,
    equipmentReservation: reservation.id,
    warehouseItem: warehouseItem.id,
    reportRevenue: report.kpis.revenueNet,
    invoice: invoice.number,
    webhookOrder: webhook.payload.orderId,
    portalOrder: portalLink.orderId,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
