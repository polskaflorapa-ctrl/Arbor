const API = process.env.VITE_ARBOR_API_URL || 'http://127.0.0.1:8790';

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

function ids(rows) {
  return rows.map((row) => row.id);
}

function assertOnly(label, actual, expected) {
  const actualSorted = [...actual].sort();
  const expectedSorted = [...expected].sort();
  if (actualSorted.join(',') !== expectedSorted.join(',')) {
    throw new Error(`${label} mismatch. Expected ${expectedSorted.join(',')}, got ${actualSorted.join(',')}`);
  }
}

function assertNoTenantLeak(label, rows, blockedTenantId) {
  const leaked = rows.filter((row) => row.tenantId === blockedTenantId);
  if (leaked.length) throw new Error(`${label} leaked ${blockedTenantId}: ${JSON.stringify(leaked)}`);
}

function assertIncludes(label, actual, expected) {
  const missing = expected.filter((id) => !actual.includes(id));
  if (missing.length) throw new Error(`${label} missing ${missing.join(',')}. Got ${actual.join(',')}`);
}

async function main() {
  const admin = await login('admin');
  const otherAdmin = await login('other-admin');

  const adminBoot = await request('/api/bootstrap', { headers: admin.headers });
  const otherBoot = await request('/api/bootstrap', { headers: otherAdmin.headers });

  assertOnly('admin tenants', ids(adminBoot.tenants), ['tenant-pf']);
  assertOnly('other tenants', ids(otherBoot.tenants), ['tenant-other']);
  assertOnly('admin ai prompts', ids(adminBoot.aiPrompts), ['prompt-1', 'prompt-2', 'prompt-3']);
  assertOnly('other ai prompts', ids(otherBoot.aiPrompts), ['prompt-other-1']);
  assertOnly('admin prompt versions', ids(adminBoot.aiPromptVersions), ['prompt-1-v3', 'prompt-2-v1', 'prompt-3-v2']);
  assertOnly('other prompt versions', ids(otherBoot.aiPromptVersions), ['prompt-other-1-v1']);
  assertIncludes('admin workflows', ids(adminBoot.workflows), ['wf-1', 'wf-2']);
  assertOnly('other workflows', ids(otherBoot.workflows), ['wf-other-1']);
  assertOnly('admin module configs', ids(adminBoot.moduleConfigs), ['cfg-crm', 'cfg-orders']);
  assertOnly('other module configs', ids(otherBoot.moduleConfigs), ['cfg-other-crm']);
  assertNoTenantLeak('admin tree assets', adminBoot.treeAssets ?? [], 'tenant-other');
  assertNoTenantLeak('other tree assets', otherBoot.treeAssets ?? [], 'tenant-pf');
  assertNoTenantLeak('admin tasks', adminBoot.tasks, 'tenant-other');
  assertNoTenantLeak('other tasks', otherBoot.tasks, 'tenant-pf');
  assertNoTenantLeak('admin workflows', adminBoot.workflows, 'tenant-other');
  assertNoTenantLeak('other workflows', otherBoot.workflows, 'tenant-pf');

  if (adminBoot.aiReceptionistSettings?.tenantId !== 'tenant-pf') {
    throw new Error(`admin AI receptionist settings not scoped: ${JSON.stringify(adminBoot.aiReceptionistSettings)}`);
  }
  if (otherBoot.aiReceptionistSettings?.tenantId !== 'tenant-other') {
    throw new Error(`other AI receptionist settings not scoped: ${JSON.stringify(otherBoot.aiReceptionistSettings)}`);
  }
  if (adminBoot.integrationSettings?.tenantId !== 'tenant-pf') {
    throw new Error(`admin integration settings not scoped: ${JSON.stringify(adminBoot.integrationSettings)}`);
  }
  if (otherBoot.integrationSettings?.tenantId !== 'tenant-other') {
    throw new Error(`other integration settings not scoped: ${JSON.stringify(otherBoot.integrationSettings)}`);
  }
  if ((adminBoot.billingPayments ?? []).some((payment) => payment.tenantId !== 'tenant-pf')) {
    throw new Error(`admin billing leaked: ${JSON.stringify(adminBoot.billingPayments)}`);
  }
  if ((otherBoot.billingPayments ?? []).some((payment) => payment.tenantId !== 'tenant-other')) {
    throw new Error(`other billing leaked: ${JSON.stringify(otherBoot.billingPayments)}`);
  }
  const otherBranch = await request('/api/branches', {
    method: 'POST',
    headers: otherAdmin.headers,
    body: JSON.stringify({
      id: `oth-${Date.now().toString(36)}`,
      name: `Other tenant smoke branch ${Date.now()}`,
      city: 'Gdynia',
    }),
  });
  if (otherBranch.tenantId !== 'tenant-other' || otherBranch.status !== 'active') {
    throw new Error(`other tenant branch not scoped: ${JSON.stringify(otherBranch)}`);
  }
  await expectStatus(`/api/branches/${otherBranch.id}`, 404, {
    method: 'PATCH',
    headers: admin.headers,
    body: JSON.stringify({ city: 'Admin must not edit other tenant branch' }),
  });
  await expectStatus(`/api/branches/${otherBranch.id}`, 404, {
    method: 'DELETE',
    headers: admin.headers,
  });
  const adminBranchesAfterOtherCreate = await request('/api/branches?includeArchived=true', { headers: admin.headers });
  if (adminBranchesAfterOtherCreate.some((branch) => branch.id === otherBranch.id || branch.tenantId === 'tenant-other')) {
    throw new Error(`other tenant branch leaked to admin: ${JSON.stringify(adminBranchesAfterOtherCreate)}`);
  }
  const otherBranchesAfterCreate = await request('/api/branches?includeArchived=true', { headers: otherAdmin.headers });
  if (!otherBranchesAfterCreate.some((branch) => branch.id === otherBranch.id)) {
    throw new Error(`other tenant branch missing from own list: ${JSON.stringify(otherBranchesAfterCreate)}`);
  }
  const deletedOtherBranch = await request(`/api/branches/${otherBranch.id}`, {
    method: 'DELETE',
    headers: otherAdmin.headers,
  });
  if (!deletedOtherBranch.deleted || deletedOtherBranch.archived) {
    throw new Error(`unused other tenant branch should hard delete: ${JSON.stringify(deletedOtherBranch)}`);
  }
  const otherUserPassword = `other-user-${Date.now()}`;
  const otherUser = await request('/api/users', {
    method: 'POST',
    headers: otherAdmin.headers,
    body: JSON.stringify({
      login: `other.staff.${Date.now()}`,
      firstName: 'Other',
      lastName: 'Worker',
      role: 'PRACOWNIK',
      branchId: 'oth',
      password: otherUserPassword,
    }),
  });
  if (otherUser.branchId !== 'oth' || otherUser.status !== 'active' || 'passwordHash' in otherUser) {
    throw new Error(`other tenant user not scoped or leaked password hash: ${JSON.stringify(otherUser)}`);
  }
  const otherUserSession = await login({ login: otherUser.login, password: otherUserPassword });
  if (otherUserSession.user.id !== otherUser.id) throw new Error(`other tenant user could not log in: ${JSON.stringify(otherUserSession.user)}`);
  const adminWorker = await login('pracownik');
  await expectStatus('/api/clients', 403, { headers: adminWorker.headers });
  await expectStatus('/api/clients', 403, { headers: otherUserSession.headers });
  const otherRolePermissions = await request('/api/role-permissions', { headers: otherAdmin.headers });
  const otherWorkerPermission = otherRolePermissions.find((permission) => permission.role === 'PRACOWNIK');
  if (!otherWorkerPermission || otherWorkerPermission.modules.includes('crm')) {
    throw new Error(`other worker default role permission invalid: ${JSON.stringify(otherWorkerPermission)}`);
  }
  const otherWorkerCrmRead = await request('/api/role-permissions/PRACOWNIK', {
    method: 'PATCH',
    headers: otherAdmin.headers,
    body: JSON.stringify({
      modules: [...otherWorkerPermission.modules, 'crm'],
      writable: otherWorkerPermission.writable,
    }),
  });
  if (otherWorkerCrmRead.tenantId !== 'tenant-other' || !otherWorkerCrmRead.modules.includes('crm')) {
    throw new Error(`other tenant worker role update failed: ${JSON.stringify(otherWorkerCrmRead)}`);
  }
  const otherWorkerClients = await request('/api/clients', { headers: otherUserSession.headers });
  if (!otherWorkerClients.some((client) => client.branchId === 'oth')) {
    throw new Error(`other worker should see own tenant CRM after role update: ${JSON.stringify(otherWorkerClients)}`);
  }
  await expectStatus('/api/clients', 403, { headers: adminWorker.headers });
  const adminRolePermissions = await request('/api/role-permissions', { headers: admin.headers });
  const adminWorkerPermission = adminRolePermissions.find((permission) => permission.role === 'PRACOWNIK');
  if (!adminWorkerPermission || adminWorkerPermission.modules.includes('crm') || adminRolePermissions.some((permission) => permission.tenantId === 'tenant-other')) {
    throw new Error(`other role permission leaked to admin tenant: ${JSON.stringify(adminRolePermissions)}`);
  }
  const otherWorkerReset = await request('/api/role-permissions/PRACOWNIK/reset', {
    method: 'POST',
    headers: otherAdmin.headers,
  });
  if (otherWorkerReset.source !== 'default' || otherWorkerReset.modules.includes('crm')) {
    throw new Error(`other worker role reset failed: ${JSON.stringify(otherWorkerReset)}`);
  }
  await expectStatus('/api/clients', 403, { headers: otherUserSession.headers });
  await expectStatus(`/api/users/${otherUser.id}`, 404, {
    method: 'PATCH',
    headers: admin.headers,
    body: JSON.stringify({ status: 'inactive' }),
  });
  await expectStatus(`/api/users/${otherUser.id}`, 404, {
    method: 'DELETE',
    headers: admin.headers,
  });
  const adminUsersAfterOtherCreate = await request('/api/users?includeInactive=true', { headers: admin.headers });
  if (adminUsersAfterOtherCreate.some((user) => user.id === otherUser.id || user.branchId === 'oth' || 'passwordHash' in user)) {
    throw new Error(`other tenant user leaked to admin: ${JSON.stringify(adminUsersAfterOtherCreate)}`);
  }
  const otherUsersAfterCreate = await request('/api/users?includeInactive=true', { headers: otherAdmin.headers });
  if (!otherUsersAfterCreate.some((user) => user.id === otherUser.id) || otherUsersAfterCreate.some((user) => 'passwordHash' in user)) {
    throw new Error(`other tenant user missing or leaked password hash: ${JSON.stringify(otherUsersAfterCreate)}`);
  }
  const inactiveOtherUser = await request(`/api/users/${otherUser.id}`, {
    method: 'PATCH',
    headers: otherAdmin.headers,
    body: JSON.stringify({ status: 'inactive' }),
  });
  if (inactiveOtherUser.status !== 'inactive') throw new Error(`other tenant user inactive update failed: ${JSON.stringify(inactiveOtherUser)}`);
  await expectStatus('/api/auth/login', 401, {
    method: 'POST',
    body: JSON.stringify({ login: otherUser.login, password: otherUserPassword }),
  });
  const reactivatedOtherUser = await request(`/api/users/${otherUser.id}`, {
    method: 'PATCH',
    headers: otherAdmin.headers,
    body: JSON.stringify({ status: 'active' }),
  });
  if (reactivatedOtherUser.status !== 'active') throw new Error(`other tenant user reactivation failed: ${JSON.stringify(reactivatedOtherUser)}`);
  const archivedOtherUser = await request(`/api/users/${otherUser.id}`, {
    method: 'DELETE',
    headers: otherAdmin.headers,
  });
  if (!archivedOtherUser.archived || archivedOtherUser.user.status !== 'archived' || 'passwordHash' in archivedOtherUser.user) {
    throw new Error(`other tenant user archive failed or leaked unsafe data: ${JSON.stringify(archivedOtherUser)}`);
  }
  await expectStatus('/api/auth/login', 401, {
    method: 'POST',
    body: JSON.stringify({ login: otherUser.login, password: otherUserPassword }),
  });
  const otherUsersAfterArchive = await request('/api/users?includeInactive=true', { headers: otherAdmin.headers });
  if (otherUsersAfterArchive.some((user) => user.id === otherUser.id)) {
    throw new Error(`archived other tenant user should be hidden: ${JSON.stringify(otherUsersAfterArchive)}`);
  }
  if ((otherBoot.employeeContracts ?? []).some((contract) => contract.branchId !== 'oth')) {
    throw new Error(`other HR contracts leaked: ${JSON.stringify(otherBoot.employeeContracts)}`);
  }
  if ((otherBoot.documentRequirements ?? []).some((requirement) => requirement.tenantId !== 'tenant-other')) {
    throw new Error(`other document requirements leaked: ${JSON.stringify(otherBoot.documentRequirements)}`);
  }

  await expectStatus('/api/ai-prompts/prompt-other-1', 404, {
    method: 'PATCH',
    headers: admin.headers,
    body: JSON.stringify({ body: 'Cross tenant prompt update must stay blocked for tenant isolation smoke.' }),
  });
  await expectStatus('/api/ai-prompts/prompt-other-1/versions', 404, {
    method: 'GET',
    headers: admin.headers,
  });
  await expectStatus('/api/ai-prompts/prompt-other-1/test', 404, {
    method: 'POST',
    headers: admin.headers,
    body: JSON.stringify({ sampleTranscript: 'Klient chce sprawdzic cudzego tenanta.' }),
  });
  await expectStatus('/api/ai-prompts/prompt-other-1', 404, {
    method: 'DELETE',
    headers: admin.headers,
  });
  await expectStatus('/api/workflows/wf-other-1/toggle', 404, {
    method: 'POST',
    headers: admin.headers,
  });
  await expectStatus('/api/workflows/wf-other-1', 404, {
    method: 'DELETE',
    headers: admin.headers,
  });
  await expectStatus('/api/communications/com-1/analyze', 404, {
    method: 'POST',
    headers: otherAdmin.headers,
    body: JSON.stringify({ promptId: 'prompt-other-1' }),
  });
  await expectStatus('/api/communications/com-1/recording', 404, {
    method: 'POST',
    headers: otherAdmin.headers,
    body: JSON.stringify({
      recordingId: 'cross-tenant-recording',
      transcript: 'Klient: ta rozmowa nie moze przejsc do innego tenanta.',
    }),
  });
  await expectStatus('/api/mobile/meeting-recordings', 403, {
    method: 'POST',
    headers: otherAdmin.headers,
    body: JSON.stringify({
      orderId: adminBoot.orders[0]?.id,
      recordingId: 'cross-tenant-mobile-meeting',
      transcript: 'Wyceniajacy: nagranie spotkania nie moze wejsc do zlecenia innego tenanta.',
    }),
  });
  await expectStatus('/api/generated-documents/doc-1/sign', 404, {
    method: 'POST',
    headers: otherAdmin.headers,
    body: JSON.stringify({
      signerName: 'Cross Tenant Signer',
      method: 'electronic',
    }),
  });
  const otherClient = await request('/api/clients', {
    method: 'POST',
    headers: otherAdmin.headers,
    body: JSON.stringify({
      name: 'Other tenant smoke client',
      phone: '+48 790 000 301',
      email: 'other-smoke-client@example.test',
      address: 'Other Street 1, Other City',
      branchId: 'oth',
    }),
  });
  if (otherClient.branchId !== 'oth') {
    throw new Error(`other client not tenant scoped: ${JSON.stringify(otherClient)}`);
  }
  const otherOrder = await request('/api/orders', {
    method: 'POST',
    headers: otherAdmin.headers,
    body: JSON.stringify({
      clientId: otherClient.id,
      branchId: 'oth',
      type: 'Other tenant smoke order',
      scheduledAt: '2026-10-01T09:00:00.000Z',
      priority: 'normalny',
      value: 333,
    }),
  });
  if (otherOrder.branchId !== 'oth' || otherOrder.clientId !== otherClient.id) {
    throw new Error(`other order not tenant scoped: ${JSON.stringify(otherOrder)}`);
  }
  const otherValuation = await request('/api/valuations', {
    method: 'POST',
    headers: otherAdmin.headers,
    body: JSON.stringify({
      orderId: otherOrder.id,
      estimatorId: otherAdmin.user.id,
      status: 'do_potwierdzenia',
      totalNet: 333,
      margin: 22,
      notes: 'Other tenant smoke valuation',
      items: [{ name: 'Other tenant item', qty: 1, unit: 'usl.', price: 333, cost: 200 }],
    }),
  });
  if (otherValuation.clientId !== otherClient.id || otherValuation.orderId !== otherOrder.id) {
    throw new Error(`other valuation not tenant scoped: ${JSON.stringify(otherValuation)}`);
  }
  const otherTree = await request('/api/tree-assets', {
    method: 'POST',
    headers: otherAdmin.headers,
    body: JSON.stringify({
      clientId: otherClient.id,
      orderId: otherOrder.id,
      valuationId: otherValuation.id,
      species: 'Tenant other tree',
      commonName: 'Other tenant smoke tree',
      condition: 'fair',
      riskLevel: 'medium',
      workRecommendation: 'Other tenant tree inventory smoke.',
      photos: ['/photos/other/tree-smoke.jpg'],
    }),
  });
  if (otherTree.tenantId !== 'tenant-other' || otherTree.clientId !== otherClient.id || otherTree.orderId !== otherOrder.id) {
    throw new Error(`other tree asset not tenant scoped: ${JSON.stringify(otherTree)}`);
  }
  const otherCommunication = await request('/api/communications', {
    method: 'POST',
    headers: otherAdmin.headers,
    body: JSON.stringify({
      type: 'note',
      clientId: otherClient.id,
      orderId: otherOrder.id,
      userId: otherAdmin.user.id,
      assignedUserId: otherAdmin.user.id,
      direction: 'internal',
      channel: 'manual',
      status: 'completed',
      subject: 'Other tenant smoke communication',
      transcript: [{ speaker: 'Other tenant', text: 'This communication must stay isolated.', atSec: 0 }],
    }),
  });
  if (otherCommunication.clientId !== otherClient.id || otherCommunication.orderId !== otherOrder.id) {
    throw new Error(`other communication not tenant scoped: ${JSON.stringify(otherCommunication)}`);
  }
  const otherInvoice = await request('/api/invoices', {
    method: 'POST',
    headers: otherAdmin.headers,
    body: JSON.stringify({
      orderId: otherOrder.id,
      net: 333,
      dueAt: '2026-10-14',
      status: 'szkic',
    }),
  });
  if (otherInvoice.clientId !== otherClient.id || otherInvoice.orderId !== otherOrder.id) {
    throw new Error(`other invoice not tenant scoped: ${JSON.stringify(otherInvoice)}`);
  }
  await expectStatus('/api/crews', 403, {
    method: 'POST',
    headers: otherAdmin.headers,
    body: JSON.stringify({
      branchId: 'oth',
      name: 'Other tenant blocked cross leader crew',
      leaderId: 'u-manager',
      members: ['Cross tenant leader'],
      utilization: 10,
    }),
  });
  const otherCrew = await request('/api/crews', {
    method: 'POST',
    headers: otherAdmin.headers,
    body: JSON.stringify({
      branchId: 'oth',
      name: 'Other tenant smoke crew',
      leaderId: otherAdmin.user.id,
      members: ['Other tenant worker'],
      utilization: 44,
    }),
  });
  if (otherCrew.branchId !== 'oth' || otherCrew.leaderId !== otherAdmin.user.id || otherCrew.status !== 'active') {
    throw new Error(`other crew not tenant scoped: ${JSON.stringify(otherCrew)}`);
  }
  const otherTraining = await request('/api/hr/trainings', {
    method: 'POST',
    headers: otherAdmin.headers,
    body: JSON.stringify({
      employeeId: otherAdmin.user.id,
      name: 'Other tenant smoke training',
      completedAt: '2026-06-01',
      expiresAt: '2027-06-01',
    }),
  });
  const otherMedicalExam = await request('/api/hr/medical-exams', {
    method: 'POST',
    headers: otherAdmin.headers,
    body: JSON.stringify({
      employeeId: otherAdmin.user.id,
      type: 'occupational',
      issuedAt: '2026-06-02',
      expiresAt: '2027-06-02',
    }),
  });
  const otherCertification = await request('/api/hr/certifications', {
    method: 'POST',
    headers: otherAdmin.headers,
    body: JSON.stringify({
      employeeId: otherAdmin.user.id,
      name: 'Other tenant smoke certification',
      issuer: 'Other Tenant Authority',
      issuedAt: '2026-06-03',
      expiresAt: '2027-06-03',
    }),
  });
  if (
    otherTraining.employeeId !== otherAdmin.user.id
    || otherMedicalExam.employeeId !== otherAdmin.user.id
    || otherCertification.employeeId !== otherAdmin.user.id
  ) {
    throw new Error(`other HR compliance records not tenant scoped: ${JSON.stringify({ otherTraining, otherMedicalExam, otherCertification })}`);
  }
  await expectStatus('/api/hr/trainings', 404, {
    method: 'POST',
    headers: otherAdmin.headers,
    body: JSON.stringify({
      employeeId: 'u-manager',
      name: 'Cross tenant blocked training',
      completedAt: '2026-06-01',
      expiresAt: '2027-06-01',
    }),
  });
  await expectStatus(`/api/clients/${otherClient.id}`, 404, {
    method: 'DELETE',
    headers: admin.headers,
  });
  await expectStatus(`/api/orders/${otherOrder.id}`, 404, {
    method: 'PATCH',
    headers: admin.headers,
    body: JSON.stringify({ priority: 'pilny' }),
  });
  await expectStatus(`/api/orders/${otherOrder.id}`, 404, {
    method: 'DELETE',
    headers: admin.headers,
  });
  await expectStatus(`/api/valuations/${otherValuation.id}`, 404, {
    method: 'PATCH',
    headers: admin.headers,
    body: JSON.stringify({ status: 'zatwierdzona' }),
  });
  await expectStatus(`/api/valuations/${otherValuation.id}`, 404, {
    method: 'DELETE',
    headers: admin.headers,
  });
  await expectStatus(`/api/tree-assets/${otherTree.id}`, 404, {
    method: 'PATCH',
    headers: admin.headers,
    body: JSON.stringify({ riskLevel: 'critical' }),
  });
  await expectStatus(`/api/tree-assets/${otherTree.id}`, 404, {
    method: 'DELETE',
    headers: admin.headers,
  });
  await expectStatus(`/api/communications/${otherCommunication.id}`, 404, {
    method: 'PATCH',
    headers: admin.headers,
    body: JSON.stringify({ subject: 'Admin must not edit other tenant communication' }),
  });
  await expectStatus(`/api/communications/${otherCommunication.id}`, 404, {
    method: 'DELETE',
    headers: admin.headers,
  });
  await expectStatus(`/api/invoices/${otherInvoice.id}`, 404, {
    method: 'PATCH',
    headers: admin.headers,
    body: JSON.stringify({ status: 'wyslana' }),
  });
  await expectStatus(`/api/invoices/${otherInvoice.id}`, 404, {
    method: 'DELETE',
    headers: admin.headers,
  });
  await expectStatus(`/api/crews/${otherCrew.id}`, 404, {
    method: 'PATCH',
    headers: admin.headers,
    body: JSON.stringify({ name: 'Admin must not edit other tenant crew' }),
  });
  await expectStatus(`/api/crews/${otherCrew.id}`, 404, {
    method: 'DELETE',
    headers: admin.headers,
  });
  await expectStatus(`/api/hr/trainings/${otherTraining.id}`, 404, {
    method: 'PATCH',
    headers: admin.headers,
    body: JSON.stringify({ name: 'Admin must not edit other tenant training' }),
  });
  await expectStatus(`/api/hr/medical-exams/${otherMedicalExam.id}`, 404, {
    method: 'DELETE',
    headers: admin.headers,
  });
  await expectStatus(`/api/hr/certifications/${otherCertification.id}`, 404, {
    method: 'PATCH',
    headers: admin.headers,
    body: JSON.stringify({ issuer: 'Admin must not edit other tenant certification' }),
  });
  const adminClientsAfterOtherCreate = await request('/api/clients', { headers: admin.headers });
  const adminOrdersAfterOtherCreate = await request('/api/orders', { headers: admin.headers });
  const adminValuationsAfterOtherCreate = await request('/api/valuations', { headers: admin.headers });
  const adminTreesAfterOtherCreate = await request('/api/tree-assets', { headers: admin.headers });
  const adminCommunicationsAfterOtherCreate = await request('/api/communications', { headers: admin.headers });
  const adminInvoicesAfterOtherCreate = await request('/api/invoices', { headers: admin.headers });
  const adminCrewsAfterOtherCreate = await request('/api/crews', { headers: admin.headers });
  const [adminTrainingsAfterOtherCreate, adminMedicalAfterOtherCreate, adminCertsAfterOtherCreate] = await Promise.all([
    request('/api/hr/trainings', { headers: admin.headers }),
    request('/api/hr/medical-exams', { headers: admin.headers }),
    request('/api/hr/certifications', { headers: admin.headers }),
  ]);
  if (adminClientsAfterOtherCreate.some((client) => client.id === otherClient.id || client.branchId === 'oth')) {
    throw new Error(`client leaked to admin tenant: ${JSON.stringify(adminClientsAfterOtherCreate)}`);
  }
  if (adminOrdersAfterOtherCreate.some((order) => order.id === otherOrder.id || order.branchId === 'oth')) {
    throw new Error(`order leaked to admin tenant: ${JSON.stringify(adminOrdersAfterOtherCreate)}`);
  }
  if (adminValuationsAfterOtherCreate.some((valuation) => valuation.id === otherValuation.id || valuation.orderId === otherOrder.id)) {
    throw new Error(`valuation leaked to admin tenant: ${JSON.stringify(adminValuationsAfterOtherCreate)}`);
  }
  if (adminTreesAfterOtherCreate.some((tree) => tree.id === otherTree.id || tree.tenantId === 'tenant-other' || tree.branchId === 'oth')) {
    throw new Error(`tree asset leaked to admin tenant: ${JSON.stringify(adminTreesAfterOtherCreate)}`);
  }
  if (adminCommunicationsAfterOtherCreate.some((communication) => communication.id === otherCommunication.id || communication.orderId === otherOrder.id)) {
    throw new Error(`communication leaked to admin tenant: ${JSON.stringify(adminCommunicationsAfterOtherCreate)}`);
  }
  if (adminInvoicesAfterOtherCreate.some((invoice) => invoice.id === otherInvoice.id || invoice.orderId === otherOrder.id)) {
    throw new Error(`invoice leaked to admin tenant: ${JSON.stringify(adminInvoicesAfterOtherCreate)}`);
  }
  if (adminCrewsAfterOtherCreate.some((crew) => crew.id === otherCrew.id || crew.branchId === 'oth')) {
    throw new Error(`crew leaked to admin tenant: ${JSON.stringify(adminCrewsAfterOtherCreate)}`);
  }
  if (adminTrainingsAfterOtherCreate.some((item) => item.id === otherTraining.id || item.employeeId === otherAdmin.user.id)) {
    throw new Error(`training leaked to admin tenant: ${JSON.stringify(adminTrainingsAfterOtherCreate)}`);
  }
  if (adminMedicalAfterOtherCreate.some((item) => item.id === otherMedicalExam.id || item.employeeId === otherAdmin.user.id)) {
    throw new Error(`medical exam leaked to admin tenant: ${JSON.stringify(adminMedicalAfterOtherCreate)}`);
  }
  if (adminCertsAfterOtherCreate.some((item) => item.id === otherCertification.id || item.employeeId === otherAdmin.user.id)) {
    throw new Error(`certification leaked to admin tenant: ${JSON.stringify(adminCertsAfterOtherCreate)}`);
  }
  await expectStatus('/api/document-templates/tpl-2', 409, {
    method: 'DELETE',
    headers: admin.headers,
  });
  const otherTemplate = await request('/api/document-templates', {
    method: 'POST',
    headers: otherAdmin.headers,
    body: JSON.stringify({
      name: 'Other tenant smoke contract template',
      kind: 'contract',
      scope: 'employee',
      status: 'active',
      fields: ['employeeName'],
      body: 'Other tenant contract for {{employeeName}}.',
    }),
  });
  if (otherTemplate.tenantId !== 'tenant-other') {
    throw new Error(`other document template not tenant scoped: ${JSON.stringify(otherTemplate)}`);
  }
  await expectStatus(`/api/document-templates/${otherTemplate.id}`, 404, {
    method: 'PATCH',
    headers: admin.headers,
    body: JSON.stringify({ name: 'Admin must not edit other tenant template' }),
  });
  await expectStatus(`/api/document-templates/${otherTemplate.id}/preview`, 404, {
    method: 'POST',
    headers: admin.headers,
    body: JSON.stringify({ sampleContext: { employeeName: 'Leak' } }),
  });
  await expectStatus('/api/documents/attach', 404, {
    method: 'POST',
    headers: otherAdmin.headers,
    body: JSON.stringify({
      subjectType: 'employee',
      subjectId: 'u-lead',
      requirementId: 'req-2',
      fileName: 'cross-tenant-bhp.pdf',
      fileUrl: '/documents/other/cross-tenant-bhp.pdf',
    }),
  });
  await expectStatus('/api/hr/contracts', 404, {
    method: 'POST',
    headers: otherAdmin.headers,
    body: JSON.stringify({
      employeeId: 'u-lead',
      positionId: 'pos-1',
      startDate: '2026-07-01',
      generateDocument: true,
    }),
  });
  await expectStatus('/api/job-positions/pos-1', 409, {
    method: 'PATCH',
    headers: admin.headers,
    body: JSON.stringify({ rate: 'Cross tenant global edit must be blocked' }),
  });
  await expectStatus('/api/document-requirements/req-1', 409, {
    method: 'PATCH',
    headers: admin.headers,
    body: JSON.stringify({ warningDays: 99 }),
  });
  await expectStatus('/api/document-requirements/req-1', 409, {
    method: 'DELETE',
    headers: admin.headers,
  });
  const otherPosition = await request('/api/job-positions', {
    method: 'POST',
    headers: otherAdmin.headers,
    body: JSON.stringify({
      title: 'Other tenant smoke position',
      department: 'office',
      contractType: 'employment',
      rate: '7000 PLN brutto',
      requiredDocuments: ['Other tenant document only'],
      requiredTraining: ['Other tenant onboarding'],
    }),
  });
  if (otherPosition.position.tenantId !== 'tenant-other' || otherPosition.requirements.some((requirement) => requirement.tenantId !== 'tenant-other')) {
    throw new Error(`other job position not tenant scoped: ${JSON.stringify(otherPosition)}`);
  }
  await expectStatus(`/api/job-positions/${otherPosition.position.id}`, 404, {
    method: 'PATCH',
    headers: admin.headers,
    body: JSON.stringify({ rate: 'Admin must not edit other tenant position' }),
  });
  await expectStatus(`/api/job-positions/${otherPosition.position.id}`, 404, {
    method: 'DELETE',
    headers: admin.headers,
  });
  const otherContract = await request('/api/hr/contracts', {
    method: 'POST',
    headers: otherAdmin.headers,
    body: JSON.stringify({
      employeeId: otherAdmin.user.id,
      positionId: otherPosition.position.id,
      startDate: '2026-08-01',
      endDate: '2027-07-31',
      generateDocument: false,
      replaceExisting: false,
    }),
  });
  if (
    otherContract.contract.tenantId !== 'tenant-other'
    || otherContract.contract.branchId !== 'oth'
    || otherContract.contract.positionId !== otherPosition.position.id
  ) {
    throw new Error(`other contract not tenant scoped: ${JSON.stringify(otherContract)}`);
  }
  await expectStatus(`/api/hr/contracts/${otherContract.contract.id}`, 404, {
    method: 'PATCH',
    headers: admin.headers,
    body: JSON.stringify({ rate: 'Admin must not edit other tenant contract' }),
  });
  await expectStatus(`/api/hr/contracts/${otherContract.contract.id}`, 404, {
    method: 'DELETE',
    headers: admin.headers,
  });
  const adminContractsAfterOtherCreate = await request('/api/hr/contracts', { headers: admin.headers });
  if (adminContractsAfterOtherCreate.some((contract) => contract.id === otherContract.contract.id || contract.tenantId === 'tenant-other')) {
    throw new Error(`HR contract leaked to admin tenant: ${JSON.stringify(adminContractsAfterOtherCreate)}`);
  }
  const otherRequirement = await request('/api/document-requirements', {
    method: 'POST',
    headers: otherAdmin.headers,
    body: JSON.stringify({
      scope: 'employee',
      name: 'Other tenant smoke requirement',
      requiredFor: otherPosition.position.id,
      renewEveryMonths: 24,
      warningDays: 45,
    }),
  });
  if (
    otherRequirement.tenantId !== 'tenant-other'
    || otherRequirement.requiredFor !== otherPosition.position.id
    || otherRequirement.scope !== 'employee'
  ) {
    throw new Error(`other document requirement not tenant scoped: ${JSON.stringify(otherRequirement)}`);
  }
  await expectStatus(`/api/document-requirements/${otherRequirement.id}`, 404, {
    method: 'PATCH',
    headers: admin.headers,
    body: JSON.stringify({ warningDays: 5 }),
  });
  await expectStatus(`/api/document-requirements/${otherRequirement.id}`, 404, {
    method: 'DELETE',
    headers: admin.headers,
  });
  const adminRequirementsAfterOtherCreate = await request('/api/document-requirements', { headers: admin.headers });
  if (adminRequirementsAfterOtherCreate.some((requirement) => requirement.id === otherRequirement.id || requirement.tenantId === 'tenant-other')) {
    throw new Error(`document requirement leaked to admin tenant: ${JSON.stringify(adminRequirementsAfterOtherCreate)}`);
  }
  await expectStatus('/api/documents/compliance?subjectType=employee&subjectId=u-lead', 404, {
    method: 'GET',
    headers: otherAdmin.headers,
  });
  await expectStatus('/api/document-requirements/req-1/fulfill', 404, {
    method: 'POST',
    headers: otherAdmin.headers,
    body: JSON.stringify({ subjectType: 'employee', subjectId: 'u-lead' }),
  });
  await expectStatus('/api/module-configs/cfg-other-crm', 404, {
    method: 'PATCH',
    headers: admin.headers,
    body: JSON.stringify({ enabled: false }),
  });
  const otherModuleConfig = await request('/api/module-configs', {
    method: 'POST',
    headers: otherAdmin.headers,
    body: JSON.stringify({
      module: 'mobile',
      label: 'Other tenant mobile config',
      enabled: true,
      customFields: [{ key: 'offline_route', label: 'Offline route', type: 'text' }],
      statuses: ['tenant-other-mobile'],
      requiredDocuments: ['Tenant other mobile doc'],
    }),
  });
  if (otherModuleConfig.tenantId !== 'tenant-other' || otherModuleConfig.module !== 'mobile') {
    throw new Error(`other module config not tenant scoped: ${JSON.stringify(otherModuleConfig)}`);
  }
  await expectStatus(`/api/module-configs/${otherModuleConfig.id}`, 404, {
    method: 'PATCH',
    headers: admin.headers,
    body: JSON.stringify({ enabled: false }),
  });
  await expectStatus(`/api/module-configs/${otherModuleConfig.id}`, 404, {
    method: 'DELETE',
    headers: admin.headers,
  });
  const adminModuleConfigsAfterOtherCreate = await request('/api/module-configs', { headers: admin.headers });
  if (adminModuleConfigsAfterOtherCreate.some((config) => config.id === otherModuleConfig.id || config.tenantId === 'tenant-other')) {
    throw new Error(`module config leaked to admin tenant: ${JSON.stringify(adminModuleConfigsAfterOtherCreate)}`);
  }
  const otherEquipment = await request('/api/equipment', {
    method: 'POST',
    headers: otherAdmin.headers,
    body: JSON.stringify({
      name: 'Other tenant smoke equipment',
      type: 'rebak',
      status: 'dostepny',
      risk: 'niski',
      branchId: 'oth',
      reviewDue: '2027-04-01',
    }),
  });
  if (otherEquipment.branchId !== 'oth' || otherEquipment.type !== 'rebak') {
    throw new Error(`other equipment not tenant scoped: ${JSON.stringify(otherEquipment)}`);
  }
  await expectStatus(`/api/equipment/${otherEquipment.id}`, 404, {
    method: 'PATCH',
    headers: admin.headers,
    body: JSON.stringify({ status: 'serwis' }),
  });
  await expectStatus(`/api/equipment/${otherEquipment.id}`, 404, {
    method: 'DELETE',
    headers: admin.headers,
  });
  const adminEquipmentAfterOtherCreate = await request('/api/equipment', { headers: admin.headers });
  if (adminEquipmentAfterOtherCreate.some((item) => item.id === otherEquipment.id || item.branchId === 'oth')) {
    throw new Error(`equipment leaked to admin tenant: ${JSON.stringify(adminEquipmentAfterOtherCreate)}`);
  }
  const otherReservation = await request(`/api/equipment/${otherEquipment.id}/reservations`, {
    method: 'POST',
    headers: otherAdmin.headers,
    body: JSON.stringify({
      orderId: otherOrder.id,
      startsAt: '2026-11-02T08:00:00.000Z',
      endsAt: '2026-11-02T12:00:00.000Z',
    }),
  });
  if (otherReservation.equipmentId !== otherEquipment.id || otherReservation.orderId !== otherOrder.id || otherReservation.branchId !== 'oth') {
    throw new Error(`other equipment reservation not tenant scoped: ${JSON.stringify(otherReservation)}`);
  }
  await expectStatus(`/api/equipment-reservations/${otherReservation.id}`, 404, {
    method: 'PATCH',
    headers: admin.headers,
    body: JSON.stringify({ startsAt: '2026-11-02T09:00:00.000Z' }),
  });
  await expectStatus(`/api/equipment-reservations/${otherReservation.id}`, 404, {
    method: 'DELETE',
    headers: admin.headers,
  });
  const adminReservationsAfterOtherCreate = await request('/api/equipment-reservations', { headers: admin.headers });
  if (adminReservationsAfterOtherCreate.some((reservation) => reservation.id === otherReservation.id || reservation.branchId === 'oth')) {
    throw new Error(`equipment reservation leaked to admin tenant: ${JSON.stringify(adminReservationsAfterOtherCreate)}`);
  }
  const updatedOtherReservation = await request(`/api/equipment-reservations/${otherReservation.id}`, {
    method: 'PATCH',
    headers: otherAdmin.headers,
    body: JSON.stringify({
      startsAt: '2026-11-02T09:00:00.000Z',
      endsAt: '2026-11-02T13:00:00.000Z',
    }),
  });
  if (updatedOtherReservation.startsAt !== '2026-11-02T09:00:00.000Z' || updatedOtherReservation.status !== 'active') {
    throw new Error(`other equipment reservation update failed: ${JSON.stringify(updatedOtherReservation)}`);
  }
  const cancelledOtherReservation = await request(`/api/equipment-reservations/${otherReservation.id}`, {
    method: 'DELETE',
    headers: otherAdmin.headers,
  });
  if (cancelledOtherReservation.status !== 'cancelled' || !cancelledOtherReservation.updatedAt) {
    throw new Error(`other equipment reservation cancel failed: ${JSON.stringify(cancelledOtherReservation)}`);
  }
  const otherWarehouseItem = await request('/api/warehouse/items', {
    method: 'POST',
    headers: otherAdmin.headers,
    body: JSON.stringify({
      name: 'Other tenant smoke warehouse item',
      unit: 'szt',
      stock: 8,
      minStock: 2,
      branchId: 'oth',
      supplier: 'Other tenant supplier',
    }),
  });
  if (otherWarehouseItem.branchId !== 'oth' || otherWarehouseItem.stock !== 8) {
    throw new Error(`other warehouse item not tenant scoped: ${JSON.stringify(otherWarehouseItem)}`);
  }
  await expectStatus(`/api/warehouse/items/${otherWarehouseItem.id}`, 404, {
    method: 'PATCH',
    headers: admin.headers,
    body: JSON.stringify({ stock: 1 }),
  });
  await expectStatus(`/api/warehouse/items/${otherWarehouseItem.id}`, 404, {
    method: 'DELETE',
    headers: admin.headers,
  });
  const adminWarehouseAfterOtherCreate = await request('/api/warehouse', { headers: admin.headers });
  if (
    adminWarehouseAfterOtherCreate.items.some((item) => item.id === otherWarehouseItem.id || item.branchId === 'oth')
    || adminWarehouseAfterOtherCreate.movements.some((movement) => movement.itemId === otherWarehouseItem.id || movement.branchId === 'oth')
  ) {
    throw new Error(`warehouse item leaked to admin tenant: ${JSON.stringify(adminWarehouseAfterOtherCreate)}`);
  }

  const otherIntegrationPatch = await request('/api/integrations/settings', {
    method: 'PATCH',
    headers: otherAdmin.headers,
    body: JSON.stringify({ zadarma: { enabled: false, recordingRetentionDays: 77 } }),
  });
  if (
    otherIntegrationPatch.settings.tenantId !== 'tenant-other'
    || otherIntegrationPatch.settings.zadarma.recordingRetentionDays !== 77
    || otherIntegrationPatch.settings.zadarma.enabled !== false
  ) {
    throw new Error(`other integration patch not tenant scoped: ${JSON.stringify(otherIntegrationPatch)}`);
  }
  const adminIntegrationAfterOtherPatch = await request('/api/integrations/settings', { headers: admin.headers });
  if (
    adminIntegrationAfterOtherPatch.settings.tenantId !== 'tenant-pf'
    || adminIntegrationAfterOtherPatch.settings.zadarma.recordingRetentionDays === 77
    || adminIntegrationAfterOtherPatch.settings.zadarma.enabled !== true
  ) {
    throw new Error(`admin integration settings changed by other tenant: ${JSON.stringify(adminIntegrationAfterOtherPatch)}`);
  }

  const ownPrompt = await request('/api/ai-prompts/prompt-other-1', {
    method: 'PATCH',
    headers: otherAdmin.headers,
    body: JSON.stringify({ body: `Tenant other prompt update allowed ${Date.now()} for isolation smoke.` }),
  });
  if (ownPrompt.prompt.tenantId !== 'tenant-other' || ownPrompt.prompt.id !== 'prompt-other-1' || ownPrompt.activeVersion.status !== 'active') {
    throw new Error(`own prompt update returned wrong prompt: ${JSON.stringify(ownPrompt)}`);
  }
  const ownPromptVersions = await request('/api/ai-prompts/prompt-other-1/versions', {
    headers: otherAdmin.headers,
  });
  if (ownPromptVersions.versions.length < 2 || ownPromptVersions.versions[0].status !== 'active' || ownPromptVersions.versions[0].version !== 2) {
    throw new Error(`prompt version history failed: ${JSON.stringify(ownPromptVersions)}`);
  }
  const promptTest = await request('/api/ai-prompts/prompt-other-1/test', {
    method: 'POST',
    headers: otherAdmin.headers,
    body: JSON.stringify({ sampleTranscript: 'Klient pyta o wycinke drzewa, termin ogledzin i ryzyka przy ogrodzeniu.' }),
  });
  if (promptTest.promptId !== 'prompt-other-1' || !['pass', 'review'].includes(promptTest.status) || promptTest.sampleChars < 10) {
    throw new Error(`prompt test failed: ${JSON.stringify(promptTest)}`);
  }
  const rollback = await request('/api/ai-prompts/prompt-other-1/rollback', {
    method: 'POST',
    headers: otherAdmin.headers,
    body: JSON.stringify({ version: 1 }),
  });
  if (rollback.prompt.version !== 1 || rollback.activeVersion.version !== 1 || rollback.activeVersion.status !== 'active') {
    throw new Error(`prompt rollback failed: ${JSON.stringify(rollback)}`);
  }
  const otherCreatedPrompt = await request('/api/ai-prompts', {
    method: 'POST',
    headers: otherAdmin.headers,
    body: JSON.stringify({
      name: 'Other tenant smoke prompt',
      kind: 'complaint',
      status: 'draft',
      body: 'Zwroc JSON: score, summary, intent, strengths, improvements, risks, nextActions dla reklamacji klienta.',
      changeNote: 'Tenant isolation create prompt',
    }),
  });
  if (otherCreatedPrompt.prompt.tenantId !== 'tenant-other' || otherCreatedPrompt.activeVersion.promptId !== otherCreatedPrompt.prompt.id) {
    throw new Error(`other tenant prompt create failed: ${JSON.stringify(otherCreatedPrompt)}`);
  }
  await expectStatus(`/api/ai-prompts/${otherCreatedPrompt.prompt.id}`, 404, {
    method: 'PATCH',
    headers: admin.headers,
    body: JSON.stringify({ body: 'Admin must not edit other tenant prompt body.' }),
  });
  await expectStatus(`/api/ai-prompts/${otherCreatedPrompt.prompt.id}`, 404, {
    method: 'DELETE',
    headers: admin.headers,
  });
  const adminPromptListAfterOtherCreate = await request('/api/ai-prompts', { headers: admin.headers });
  if (adminPromptListAfterOtherCreate.some((prompt) => prompt.id === otherCreatedPrompt.prompt.id || prompt.tenantId === 'tenant-other')) {
    throw new Error(`AI prompt leaked to admin tenant: ${JSON.stringify(adminPromptListAfterOtherCreate)}`);
  }
  const deletedOtherCreatedPrompt = await request(`/api/ai-prompts/${otherCreatedPrompt.prompt.id}`, {
    method: 'DELETE',
    headers: otherAdmin.headers,
  });
  if (!deletedOtherCreatedPrompt.deleted || deletedOtherCreatedPrompt.archived || deletedOtherCreatedPrompt.prompt !== null) {
    throw new Error(`unused other tenant prompt should be deleted: ${JSON.stringify(deletedOtherCreatedPrompt)}`);
  }

  const ownWorkflow = await request('/api/workflows/wf-other-1/test', {
    method: 'POST',
    headers: otherAdmin.headers,
  });
  if (ownWorkflow.workflow.tenantId !== 'tenant-other' || ownWorkflow.run.tenantId !== 'tenant-other') {
    throw new Error(`own workflow test not tenant scoped: ${JSON.stringify(ownWorkflow)}`);
  }

  const ownConfig = await request('/api/module-configs/cfg-other-crm', {
    method: 'PATCH',
    headers: otherAdmin.headers,
    body: JSON.stringify({ enabled: true, requiredDocuments: ['Tenant other document', 'Smoke tenant doc'] }),
  });
  if (ownConfig.tenantId !== 'tenant-other' || !ownConfig.requiredDocuments.includes('Smoke tenant doc')) {
    throw new Error(`own module config update failed: ${JSON.stringify(ownConfig)}`);
  }

  const ownSettings = await request('/api/ai-receptionist/settings', {
    method: 'PATCH',
    headers: otherAdmin.headers,
    body: JSON.stringify({ enabled: true, overflowAfterSec: 55 }),
  });
  if (ownSettings.tenantId !== 'tenant-other' || ownSettings.overflowAfterSec !== 55) {
    throw new Error(`own AI settings update failed: ${JSON.stringify(ownSettings)}`);
  }

  const duplicatePhoneBooking = await request('/api/ai-receptionist/simulate', {
    method: 'POST',
    headers: admin.headers,
    body: JSON.stringify({
      phone: '+48 700 000 999',
      clientName: 'Polska Flora duplicate phone smoke',
      branchId: 'krk',
      subject: 'Tenant isolation AI booking',
      customerLine: 'Ten sam numer co drugi tenant, ale klient ma byc osobny.',
      receivedAt: '2026-09-21T18:20:00.000Z',
      photosProvided: true,
    }),
  });
  if (
    duplicatePhoneBooking.createdClient !== true
    || duplicatePhoneBooking.client.id === 'c-other-1'
    || duplicatePhoneBooking.client.branchId !== 'krk'
    || duplicatePhoneBooking.createdOrder !== true
  ) {
    throw new Error(`AI receptionist phone isolation failed: ${JSON.stringify(duplicatePhoneBooking)}`);
  }
  const duplicateSoftphone = await request('/api/softphone/incoming', {
    method: 'POST',
    headers: admin.headers,
    body: JSON.stringify({
      phone: '+48 700 000 999',
      clientName: 'Polska Flora duplicate softphone smoke',
      branchId: 'krk',
      subject: 'Tenant isolation softphone call',
    }),
  });
  if (
    duplicateSoftphone.createdClient !== false
    || duplicateSoftphone.client.id === 'c-other-1'
    || duplicateSoftphone.client.branchId !== 'krk'
    || duplicateSoftphone.communication.clientId !== duplicatePhoneBooking.client.id
  ) {
    throw new Error(`Softphone phone isolation failed: ${JSON.stringify(duplicateSoftphone)}`);
  }
  await expectStatus(`/api/softphone/${duplicateSoftphone.communication.id}/answer`, 404, {
    method: 'POST',
    headers: otherAdmin.headers,
  });

  const adminWorkflowRun = await request('/api/workflows/wf-1/test', {
    method: 'POST',
    headers: admin.headers,
  });
  if (adminWorkflowRun.run.tenantId !== 'tenant-pf') {
    throw new Error(`admin workflow run missing tenant: ${JSON.stringify(adminWorkflowRun)}`);
  }

  const builtWorkflow = await request('/api/workflows', {
    method: 'POST',
    headers: admin.headers,
    body: JSON.stringify({
      name: 'Smoke workflow builder',
      trigger: 'lead.created',
      status: 'draft',
      conditions: [{ field: 'priority', operator: 'equals', value: 'pilny' }],
      actions: ['Utworz zadanie', 'Powiadom kierownika'],
      delays: [{ amount: 15, unit: 'minutes' }],
      approvalRequired: true,
      rollbackStrategy: 'manual',
      description: 'Workflow builder smoke test without UI changes.',
    }),
  });
  if (builtWorkflow.tenantId !== 'tenant-pf' || builtWorkflow.status !== 'draft' || builtWorkflow.rollbackStrategy !== 'manual') {
    throw new Error(`workflow builder create failed: ${JSON.stringify(builtWorkflow)}`);
  }
  const adminWorkflowsList = await request('/api/workflows', { headers: admin.headers });
  const otherWorkflowsList = await request('/api/workflows', { headers: otherAdmin.headers });
  if (!adminWorkflowsList.some((workflow) => workflow.id === builtWorkflow.id)) {
    throw new Error(`workflow list missing created workflow: ${JSON.stringify(adminWorkflowsList)}`);
  }
  if (otherWorkflowsList.some((workflow) => workflow.id === builtWorkflow.id || workflow.tenantId === 'tenant-pf')) {
    throw new Error(`workflow list leaked to other tenant: ${JSON.stringify(otherWorkflowsList)}`);
  }
  await expectStatus(`/api/workflows/${builtWorkflow.id}`, 404, {
    method: 'PATCH',
    headers: otherAdmin.headers,
    body: JSON.stringify({ status: 'live' }),
  });
  await expectStatus(`/api/workflows/${builtWorkflow.id}`, 404, {
    method: 'DELETE',
    headers: otherAdmin.headers,
  });
  const failedWorkflowRun = await request(`/api/workflows/${builtWorkflow.id}/test`, {
    method: 'POST',
    headers: admin.headers,
    body: JSON.stringify({ sample: { priority: 'normalny' } }),
  });
  if (failedWorkflowRun.run.status !== 'failed' || !failedWorkflowRun.run.log.some((entry) => entry.includes('FAIL'))) {
    throw new Error(`workflow condition dry run should fail: ${JSON.stringify(failedWorkflowRun)}`);
  }
  const approvalWorkflowRun = await request(`/api/workflows/${builtWorkflow.id}/test`, {
    method: 'POST',
    headers: admin.headers,
    body: JSON.stringify({ sample: { priority: 'pilny' } }),
  });
  if (approvalWorkflowRun.run.status !== 'waiting_approval') {
    throw new Error(`workflow approval dry run should wait: ${JSON.stringify(approvalWorkflowRun)}`);
  }
  const approvalLiveWorkflow = await request(`/api/workflows/${builtWorkflow.id}`, {
    method: 'PATCH',
    headers: admin.headers,
    body: JSON.stringify({ status: 'live', approvalRequired: true }),
  });
  if (approvalLiveWorkflow.status !== 'live' || approvalLiveWorkflow.approvalRequired !== true) {
    throw new Error(`workflow approval live update failed: ${JSON.stringify(approvalLiveWorkflow)}`);
  }
  const approvalExecution = await request('/api/workflows/execute', {
    method: 'POST',
    headers: admin.headers,
    body: JSON.stringify({
      workflowId: builtWorkflow.id,
      trigger: 'lead.created',
      event: { priority: 'pilny', branchId: 'krk', clientId: 'c-1', orderId: 'Z-1025' },
    }),
  });
  if (approvalExecution.summary.waitingApproval !== 1 || approvalExecution.results[0].run.status !== 'waiting_approval' || approvalExecution.summary.actionsExecuted !== 0) {
    throw new Error(`workflow approval execution should wait without actions: ${JSON.stringify(approvalExecution)}`);
  }
  const approvalRunId = approvalExecution.results[0].run.id;
  await expectStatus(`/api/workflow-runs/${approvalRunId}/approve`, 404, {
    method: 'POST',
    headers: otherAdmin.headers,
    body: JSON.stringify({ comment: 'tenant isolation should block approval' }),
  });
  const approvedRun = await request(`/api/workflow-runs/${approvalRunId}/approve`, {
    method: 'POST',
    headers: admin.headers,
    body: JSON.stringify({ comment: 'Smoke approval accepted' }),
  });
  if (
    approvedRun.run.status !== 'success'
    || approvedRun.run.actionsExecuted !== 2
    || approvedRun.run.approvedBy !== admin.user.id
    || !approvedRun.run.completedAt
  ) {
    throw new Error(`workflow approval did not execute actions: ${JSON.stringify(approvedRun)}`);
  }
  await expectStatus(`/api/workflow-runs/${approvalRunId}/approve`, 409, {
    method: 'POST',
    headers: admin.headers,
  });
  const approvedBootstrap = await request('/api/bootstrap', { headers: admin.headers });
  const approvedTask = (approvedBootstrap.tasks ?? []).find((task) => task.workflowRunId === approvalRunId);
  if (!approvedTask || approvedTask.workflowId !== builtWorkflow.id || approvedTask.source !== 'workflow') {
    throw new Error(`workflow approval did not create task action: ${JSON.stringify({ approvedRun, tasks: approvedBootstrap.tasks })}`);
  }
  const rejectionExecution = await request('/api/workflows/execute', {
    method: 'POST',
    headers: admin.headers,
    body: JSON.stringify({
      workflowId: builtWorkflow.id,
      trigger: 'lead.created',
      event: { priority: 'pilny', branchId: 'krk', clientId: 'c-1', orderId: 'Z-1025' },
    }),
  });
  const rejectedRun = await request(`/api/workflow-runs/${rejectionExecution.results[0].run.id}/reject`, {
    method: 'POST',
    headers: admin.headers,
    body: JSON.stringify({ comment: 'Smoke approval rejected' }),
  });
  if (rejectedRun.run.status !== 'rejected' || rejectedRun.run.rejectedBy !== admin.user.id || Number(rejectedRun.run.actionsExecuted ?? 0) !== 0) {
    throw new Error(`workflow rejection failed: ${JSON.stringify(rejectedRun)}`);
  }
  const updatedWorkflow = await request(`/api/workflows/${builtWorkflow.id}`, {
    method: 'PATCH',
    headers: admin.headers,
    body: JSON.stringify({
      status: 'live',
      approvalRequired: false,
      delays: [],
      actions: ['Utworz zadanie', 'Powiadom kierownika', 'Zapisz audyt'],
    }),
  });
  if (updatedWorkflow.status !== 'live' || updatedWorkflow.approvalRequired !== false || updatedWorkflow.actions.length !== 3) {
    throw new Error(`workflow builder update failed: ${JSON.stringify(updatedWorkflow)}`);
  }
  const passedWorkflowRun = await request(`/api/workflows/${builtWorkflow.id}/test`, {
    method: 'POST',
    headers: admin.headers,
    body: JSON.stringify({ sample: { priority: 'pilny' } }),
  });
  if (passedWorkflowRun.run.status !== 'success' || passedWorkflowRun.workflow.tenantId !== 'tenant-pf') {
    throw new Error(`workflow builder success dry run failed: ${JSON.stringify(passedWorkflowRun)}`);
  }
  const execution = await request('/api/workflows/execute', {
    method: 'POST',
    headers: admin.headers,
    body: JSON.stringify({
      workflowId: builtWorkflow.id,
      trigger: 'lead.created',
      event: { priority: 'pilny', branchId: 'krk', clientId: 'c-1', orderId: 'Z-1025' },
    }),
  });
  if (execution.summary.success !== 1 || execution.summary.actionsExecuted !== 3 || execution.results[0].run.status !== 'success') {
    throw new Error(`workflow live execution failed: ${JSON.stringify(execution)}`);
  }
  const builtWorkflowRuns = await request(`/api/workflow-runs?workflowId=${builtWorkflow.id}`, { headers: admin.headers });
  if (!builtWorkflowRuns.some((run) => run.id === execution.results[0].run.id && run.workflowId === builtWorkflow.id)) {
    throw new Error(`workflow run list missing live execution: ${JSON.stringify(builtWorkflowRuns)}`);
  }
  const otherBuiltWorkflowRuns = await request(`/api/workflow-runs?workflowId=${builtWorkflow.id}`, { headers: otherAdmin.headers });
  if (otherBuiltWorkflowRuns.length) {
    throw new Error(`workflow run list leaked to other tenant: ${JSON.stringify(otherBuiltWorkflowRuns)}`);
  }
  const automaticWorkflow = await request('/api/workflows', {
    method: 'POST',
    headers: admin.headers,
    body: JSON.stringify({
      name: 'Smoke automatic client workflow',
      trigger: 'client.created',
      status: 'live',
      conditions: [{ field: 'name', operator: 'contains', value: 'Auto Workflow' }],
      actions: ['Utworz zadanie'],
      approvalRequired: false,
      rollbackStrategy: 'manual',
      description: 'Automatic workflow smoke test triggered by a real CRM event.',
    }),
  });
  const automaticClient = await request('/api/clients', {
    method: 'POST',
    headers: admin.headers,
    body: JSON.stringify({
      name: 'Smoke Auto Workflow Client',
      phone: '+48100999881',
      email: 'auto-workflow@smoke.pl',
      address: 'Testowa 1, Krakow',
      branchId: admin.user.branchId,
    }),
  });
  const otherTenantAutomaticClient = await request('/api/clients', {
    method: 'POST',
    headers: otherAdmin.headers,
    body: JSON.stringify({
      name: 'Smoke Auto Workflow Client',
      phone: '+48100999881',
      email: 'auto-workflow-other@smoke.pl',
      address: 'Testowa 1, Wroclaw',
      branchId: otherAdmin.user.branchId,
    }),
  });
  const automaticBootstrap = await request('/api/bootstrap', { headers: admin.headers });
  const automaticRun = (automaticBootstrap.workflowRuns ?? []).find((run) => (
    run.workflowId === automaticWorkflow.id
    && run.automatic === true
    && run.sourceEventName === 'client.created'
  ));
  if (!automaticRun || automaticRun.status !== 'success' || automaticRun.actionsExecuted !== 1 || !automaticRun.sourceEventId) {
    throw new Error(`automatic workflow did not run from client.created: ${JSON.stringify({ automaticWorkflow, automaticClient, automaticRun })}`);
  }
  const automaticTask = (automaticBootstrap.tasks ?? []).find((task) => task.workflowRunId === automaticRun.id);
  if (
    !automaticTask
    || automaticTask.workflowId !== automaticWorkflow.id
    || automaticTask.clientId !== automaticClient.id
    || automaticTask.source !== 'workflow'
    || automaticTask.status !== 'open'
  ) {
    throw new Error(`automatic workflow did not create a tenant task: ${JSON.stringify({ automaticRun, automaticTask, tasks: automaticBootstrap.tasks })}`);
  }
  const otherAutomaticBootstrap = await request('/api/bootstrap', { headers: otherAdmin.headers });
  if ((otherAutomaticBootstrap.workflowRuns ?? []).some((run) => run.workflowId === automaticWorkflow.id || run.sourceEventId === automaticRun.sourceEventId)) {
    throw new Error(`automatic workflow leaked across tenants: ${JSON.stringify({ otherTenantAutomaticClient, runs: otherAutomaticBootstrap.workflowRuns })}`);
  }
  if ((otherAutomaticBootstrap.tasks ?? []).some((task) => task.id === automaticTask.id || task.workflowRunId === automaticRun.id)) {
    throw new Error(`automatic workflow task leaked across tenants: ${JSON.stringify({ otherTenantAutomaticClient, tasks: otherAutomaticBootstrap.tasks })}`);
  }
  const adminWorkQueue = await request('/api/operations/work-queue?limit=100', { headers: admin.headers });
  const otherWorkQueue = await request('/api/operations/work-queue?limit=100', { headers: otherAdmin.headers });
  if (adminWorkQueue.tenantId !== 'tenant-pf' || !adminWorkQueue.items.some((item) => item.type === 'task' && item.sourceId === automaticTask.id)) {
    throw new Error(`admin work queue missing automatic task: ${JSON.stringify(adminWorkQueue)}`);
  }
  if (otherWorkQueue.tenantId !== 'tenant-other' || otherWorkQueue.items.some((item) => item.sourceId === automaticTask.id || item.sourceId === automaticRun.sourceEventId)) {
    throw new Error(`work queue leaked automatic task across tenants: ${JSON.stringify(otherWorkQueue)}`);
  }
  const sideEffectWorkflow = await request('/api/workflows', {
    method: 'POST',
    headers: admin.headers,
    body: JSON.stringify({
      name: 'Smoke workflow side effects',
      trigger: 'order.side_effects',
      status: 'live',
      actions: ['Wygeneruj dokument', 'Zmien status'],
      approvalRequired: false,
      rollbackStrategy: 'manual',
      description: 'Workflow side effects smoke test for documents and statuses.',
    }),
  });
  const sideEffectExecution = await request('/api/workflows/execute', {
    method: 'POST',
    headers: admin.headers,
    body: JSON.stringify({
      workflowId: sideEffectWorkflow.id,
      trigger: 'order.side_effects',
      event: {
        branchId: 'krk',
        clientId: 'c-2',
        orderId: 'Z-1025',
        documentTemplateId: 'tpl-2',
        documentSubjectType: 'order',
        documentSubjectId: 'Z-1025',
        targetStatus: 'ZAPLANOWANE',
      },
    }),
  });
  if (sideEffectExecution.summary.success !== 1 || sideEffectExecution.summary.actionsExecuted !== 2) {
    throw new Error(`workflow side effects execution failed: ${JSON.stringify(sideEffectExecution)}`);
  }
  if ((sideEffectExecution.results[0].run.effects ?? []).length !== 2) {
    throw new Error(`workflow side effects did not record rollback effects: ${JSON.stringify(sideEffectExecution.results[0].run.effects)}`);
  }
  const sideEffectBoot = await request('/api/bootstrap', { headers: admin.headers });
  const sideEffectDocument = (sideEffectBoot.generatedDocuments ?? []).find((document) => (
    document.templateId === 'tpl-2'
    && document.subjectType === 'order'
    && document.subjectId === 'Z-1025'
    && document.summary.includes('automatycznie')
  ));
  const sideEffectOrder = (sideEffectBoot.orders ?? []).find((order) => order.id === 'Z-1025');
  if (!sideEffectDocument || sideEffectDocument.status !== 'ready' || sideEffectOrder?.status !== 'ZAPLANOWANE') {
    throw new Error(`workflow side effects did not update document/order: ${JSON.stringify({ sideEffectDocument, sideEffectOrder })}`);
  }
  await expectStatus(`/api/workflow-runs/${sideEffectExecution.results[0].run.id}/rollback`, 404, {
    method: 'POST',
    headers: otherAdmin.headers,
    body: JSON.stringify({ comment: 'tenant isolation should block rollback' }),
  });
  const rollbackResult = await request(`/api/workflow-runs/${sideEffectExecution.results[0].run.id}/rollback`, {
    method: 'POST',
    headers: admin.headers,
    body: JSON.stringify({ comment: 'Smoke rollback side effects' }),
  });
  if (
    rollbackResult.rolledBack !== 2
    || !rollbackResult.run.rolledBackAt
    || rollbackResult.run.rolledBackBy !== admin.user.id
    || !rollbackResult.results.every((result) => result.status === 'rolled_back')
  ) {
    throw new Error(`workflow rollback failed: ${JSON.stringify(rollbackResult)}`);
  }
  const rollbackBoot = await request('/api/bootstrap', { headers: admin.headers });
  const rollbackOrder = (rollbackBoot.orders ?? []).find((order) => order.id === 'Z-1025');
  if (
    rollbackOrder?.status !== 'NOWE'
    || (rollbackBoot.generatedDocuments ?? []).some((document) => document.id === sideEffectDocument.id)
  ) {
    throw new Error(`workflow rollback did not restore order/remove document: ${JSON.stringify({ rollbackOrder, documents: rollbackBoot.generatedDocuments })}`);
  }
  await expectStatus(`/api/workflow-runs/${sideEffectExecution.results[0].run.id}/rollback`, 409, {
    method: 'POST',
    headers: admin.headers,
  });
  const otherSideEffectExecution = await request('/api/workflows/execute', {
    method: 'POST',
    headers: otherAdmin.headers,
    body: JSON.stringify({
      workflowId: sideEffectWorkflow.id,
      trigger: 'order.side_effects',
      event: { branchId: 'krk', orderId: 'Z-1025', documentTemplateId: 'tpl-2', targetStatus: 'ZAPLANOWANE' },
    }),
  });
  if (otherSideEffectExecution.matched !== 0 || otherSideEffectExecution.summary.actionsExecuted !== 0) {
    throw new Error(`workflow side effects leaked across tenants: ${JSON.stringify(otherSideEffectExecution)}`);
  }
  const delayedWorkflow = await request('/api/workflows', {
    method: 'POST',
    headers: admin.headers,
    body: JSON.stringify({
      name: 'Smoke delayed workflow',
      trigger: 'client.delayed_followup',
      status: 'live',
      actions: ['Utworz zadanie'],
      delays: [{ amount: 1, unit: 'minutes' }],
      approvalRequired: false,
      rollbackStrategy: 'manual',
      description: 'Delayed workflow smoke test.',
    }),
  });
  const delayedExecution = await request('/api/workflows/execute', {
    method: 'POST',
    headers: admin.headers,
    body: JSON.stringify({
      workflowId: delayedWorkflow.id,
      trigger: 'client.delayed_followup',
      event: { branchId: 'krk', clientId: 'c-1', priority: 'wysoki' },
    }),
  });
  const delayedRun = delayedExecution.results[0].run;
  if (
    delayedExecution.summary.scheduled !== 1
    || delayedExecution.summary.actionsExecuted !== 0
    || delayedRun.status !== 'scheduled'
    || !delayedRun.scheduledFor
  ) {
    throw new Error(`delayed workflow did not schedule run: ${JSON.stringify(delayedExecution)}`);
  }
  const earlyProcessing = await request('/api/workflow-runs/process-due', {
    method: 'POST',
    headers: admin.headers,
    body: JSON.stringify({ now: new Date(new Date(delayedRun.scheduledFor).getTime() - 1000).toISOString() }),
  });
  if (earlyProcessing.matched !== 0 || earlyProcessing.summary.processed !== 0) {
    throw new Error(`delayed workflow processed too early: ${JSON.stringify(earlyProcessing)}`);
  }
  const otherDelayedProcessing = await request('/api/workflow-runs/process-due', {
    method: 'POST',
    headers: otherAdmin.headers,
    body: JSON.stringify({ now: new Date(new Date(delayedRun.scheduledFor).getTime() + 60000).toISOString() }),
  });
  if (otherDelayedProcessing.matched !== 0) {
    throw new Error(`delayed workflow processing leaked across tenants: ${JSON.stringify(otherDelayedProcessing)}`);
  }
  const delayedProcessed = await request('/api/workflow-runs/process-due', {
    method: 'POST',
    headers: admin.headers,
    body: JSON.stringify({ now: new Date(new Date(delayedRun.scheduledFor).getTime() + 60000).toISOString() }),
  });
  if (
    delayedProcessed.matched !== 1
    || delayedProcessed.summary.processed !== 1
    || delayedProcessed.summary.actionsExecuted !== 1
    || delayedProcessed.results[0].run.status !== 'success'
  ) {
    throw new Error(`delayed workflow due processing failed: ${JSON.stringify(delayedProcessed)}`);
  }
  const delayedBoot = await request('/api/bootstrap', { headers: admin.headers });
  const delayedTask = (delayedBoot.tasks ?? []).find((task) => task.workflowRunId === delayedRun.id);
  if (!delayedTask || delayedTask.workflowId !== delayedWorkflow.id || delayedTask.source !== 'workflow') {
    throw new Error(`delayed workflow did not create task after due processing: ${JSON.stringify({ delayedProcessed, tasks: delayedBoot.tasks })}`);
  }
  const manualTask = await request('/api/tasks', {
    method: 'POST',
    headers: admin.headers,
    body: JSON.stringify({
      title: 'Smoke manual task',
      priority: 'high',
      clientId: automaticClient.id,
      branchId: admin.user.branchId,
      assignedUserId: 'u-manager',
      dueAt: '2026-09-08T10:00:00.000Z',
      notes: 'Manual task API smoke test.',
    }),
  });
  if (manualTask.tenantId !== 'tenant-pf' || manualTask.status !== 'open' || manualTask.source !== 'manual') {
    throw new Error(`manual task create failed: ${JSON.stringify(manualTask)}`);
  }
  const completedManualTask = await request(`/api/tasks/${manualTask.id}`, {
    method: 'PATCH',
    headers: admin.headers,
    body: JSON.stringify({ status: 'done' }),
  });
  if (completedManualTask.status !== 'done' || !completedManualTask.completedAt || completedManualTask.completedBy !== admin.user.id) {
    throw new Error(`manual task completion failed: ${JSON.stringify(completedManualTask)}`);
  }
  await expectStatus(`/api/tasks/${manualTask.id}`, 404, {
    method: 'PATCH',
    headers: otherAdmin.headers,
    body: JSON.stringify({ status: 'done' }),
  });
  await expectStatus(`/api/tasks/${manualTask.id}`, 404, {
    method: 'DELETE',
    headers: otherAdmin.headers,
  });
  const clientTimeline = await request(`/api/clients/${automaticClient.id}/timeline`, { headers: admin.headers });
  if (
    clientTimeline.client.id !== automaticClient.id
    || clientTimeline.summary.tasks < 2
    || !clientTimeline.events.some((event) => event.taskId === automaticTask.id)
    || !clientTimeline.events.some((event) => event.taskId === manualTask.id && event.status === 'done')
  ) {
    throw new Error(`client 360 timeline missing task history: ${JSON.stringify(clientTimeline)}`);
  }
  await expectStatus(`/api/clients/${automaticClient.id}/timeline`, 404, {
    headers: otherAdmin.headers,
  });
  const deletedManualTask = await request(`/api/tasks/${manualTask.id}`, {
    method: 'DELETE',
    headers: admin.headers,
  });
  if (!deletedManualTask.archived || deletedManualTask.deleted || deletedManualTask.task.status !== 'cancelled' || !deletedManualTask.task.deletedAt) {
    throw new Error(`manual task delete/archive failed: ${JSON.stringify(deletedManualTask)}`);
  }
  const tasksAfterManualDelete = await request('/api/tasks', { headers: admin.headers });
  if (tasksAfterManualDelete.some((task) => task.id === manualTask.id)) {
    throw new Error(`deleted manual task should be hidden: ${JSON.stringify(tasksAfterManualDelete)}`);
  }
  const otherTenantExecution = await request('/api/workflows/execute', {
    method: 'POST',
    headers: otherAdmin.headers,
    body: JSON.stringify({
      trigger: 'lead.created',
      event: { priority: 'pilny', branchId: 'krk', clientId: 'c-1', orderId: 'Z-1025' },
    }),
  });
  if (otherTenantExecution.matched !== 0 || otherTenantExecution.summary.actionsExecuted !== 0) {
    throw new Error(`workflow execution leaked across tenants: ${JSON.stringify(otherTenantExecution)}`);
  }
  const killSwitchWorkflow = await request(`/api/workflows/${builtWorkflow.id}/kill-switch`, {
    method: 'POST',
    headers: admin.headers,
  });
  if (killSwitchWorkflow.killSwitch !== true || killSwitchWorkflow.status !== 'paused') {
    throw new Error(`workflow kill switch did not pause execution: ${JSON.stringify(killSwitchWorkflow)}`);
  }
  const killSwitchExecution = await request('/api/workflows/execute', {
    method: 'POST',
    headers: admin.headers,
    body: JSON.stringify({
      workflowId: builtWorkflow.id,
      trigger: 'lead.created',
      event: { priority: 'pilny', branchId: 'krk', clientId: 'c-1', orderId: 'Z-1025' },
    }),
  });
  if (killSwitchExecution.summary.waitingApproval !== 1 || killSwitchExecution.summary.actionsExecuted !== 0) {
    throw new Error(`workflow kill switch execution should wait: ${JSON.stringify(killSwitchExecution)}`);
  }

  const paused = await request('/api/billing/subscription', {
    method: 'PATCH',
    headers: admin.headers,
    body: JSON.stringify({ plan: 'enterprise', status: 'paused' }),
  });
  if (paused.tenant.status !== 'paused' || paused.subscription.status !== 'paused') {
    throw new Error(`tenant pause failed: ${JSON.stringify(paused)}`);
  }
  const pausedBoot = await request('/api/bootstrap', { headers: admin.headers });
  if (pausedBoot.tenants[0].status !== 'paused') {
    throw new Error(`paused tenant bootstrap should remain readable: ${JSON.stringify(pausedBoot.tenants)}`);
  }
  await expectStatus('/api/orders', 402, {
    method: 'POST',
    headers: admin.headers,
    body: JSON.stringify({ clientId: 'c-1', type: 'Blocked while paused', scheduledAt: '2026-09-24T09:00:00.000Z' }),
  });
  await expectStatus('/api/ai-prompts/prompt-1', 402, {
    method: 'PATCH',
    headers: admin.headers,
    body: JSON.stringify({ body: 'This valid tenant prompt update must be blocked while subscription is paused.' }),
  });
  const reactivated = await request('/api/billing/checkout', {
    method: 'POST',
    headers: admin.headers,
    body: JSON.stringify({ plan: 'enterprise' }),
  });
  if (reactivated.tenant.status !== 'active' || reactivated.subscription.status !== 'active' || reactivated.payment.status !== 'paid') {
    throw new Error(`tenant reactivation failed: ${JSON.stringify(reactivated)}`);
  }

  const adminSync = await request('/api/sync', { headers: admin.headers });
  const otherSync = await request('/api/sync', { headers: otherAdmin.headers });
  assertNoTenantLeak('admin sync', adminSync.events, 'tenant-other');
  assertNoTenantLeak('other sync', otherSync.events, 'tenant-pf');
  if (!adminSync.events.some((event) => event.eventName === 'workflow.executed' && event.payload?.runId === execution.results[0].run.id)) {
    throw new Error(`admin sync missing workflow execution event: ${JSON.stringify(adminSync.events)}`);
  }
  if (!adminSync.events.some((event) => event.eventName === 'workflow.task_created' && event.payload?.runId === execution.results[0].run.id)) {
    throw new Error(`admin sync missing workflow action event: ${JSON.stringify(adminSync.events)}`);
  }
  if (!adminSync.events.some((event) => event.eventName === 'workflow.approved' && event.payload?.runId === approvalRunId)) {
    throw new Error(`admin sync missing workflow approval event: ${JSON.stringify(adminSync.events)}`);
  }
  if (!adminSync.events.some((event) => event.eventName === 'workflow.rejected' && event.payload?.runId === rejectedRun.run.id)) {
    throw new Error(`admin sync missing workflow rejection event: ${JSON.stringify(adminSync.events)}`);
  }
  if (!adminSync.events.some((event) => (
    event.eventName === 'workflow.document_requested'
    && event.payload?.runId === sideEffectExecution.results[0].run.id
    && event.payload?.documentId === sideEffectDocument.id
  ))) {
    throw new Error(`admin sync missing workflow document side effect event: ${JSON.stringify(adminSync.events)}`);
  }
  if (!adminSync.events.some((event) => (
    event.eventName === 'workflow.status_change_requested'
    && event.payload?.runId === sideEffectExecution.results[0].run.id
    && event.payload?.statusTarget === 'order'
    && event.payload?.nextStatus === 'ZAPLANOWANE'
  ))) {
    throw new Error(`admin sync missing workflow status side effect event: ${JSON.stringify(adminSync.events)}`);
  }
  if (!adminSync.events.some((event) => (
    event.eventName === 'workflow.rolled_back'
    && event.payload?.runId === sideEffectExecution.results[0].run.id
    && event.payload?.rolledBack === 2
  ))) {
    throw new Error(`admin sync missing workflow rollback event: ${JSON.stringify(adminSync.events)}`);
  }
  if (!adminSync.events.some((event) => (
    event.eventName === 'workflow.scheduled'
    && event.payload?.runId === delayedRun.id
    && event.payload?.scheduledFor === delayedRun.scheduledFor
  ))) {
    throw new Error(`admin sync missing delayed workflow scheduled event: ${JSON.stringify(adminSync.events)}`);
  }
  if (!adminSync.events.some((event) => (
    event.eventName === 'workflow.executed'
    && event.payload?.runId === delayedRun.id
    && event.payload?.scheduled === true
  ))) {
    throw new Error(`admin sync missing delayed workflow executed event: ${JSON.stringify(adminSync.events)}`);
  }
  if (!adminSync.events.some((event) => (
    event.eventName === 'workflow.executed'
    && event.payload?.runId === automaticRun.id
    && event.payload?.automatic === true
    && event.payload?.sourceEventName === 'client.created'
  ))) {
    throw new Error(`admin sync missing automatic workflow execution event: ${JSON.stringify(adminSync.events)}`);
  }
  if (otherSync.events.some((event) => (
    event.payload?.workflowId === builtWorkflow.id
    || event.payload?.id === automaticWorkflow.id
    || event.payload?.runId === execution.results[0].run.id
    || event.payload?.runId === approvalRunId
    || event.payload?.runId === rejectedRun.run.id
    || event.payload?.runId === sideEffectExecution.results[0].run.id
    || event.payload?.documentId === sideEffectDocument.id
    || event.payload?.runId === delayedRun.id
    || event.payload?.taskId === delayedTask.id
    || event.payload?.runId === automaticRun.id
    || event.payload?.sourceEventId === automaticRun.sourceEventId
  ))) {
    throw new Error(`workflow execution event leaked to other sync: ${JSON.stringify(otherSync.events)}`);
  }

  const afterAdmin = await request('/api/bootstrap', { headers: admin.headers });
  const afterOther = await request('/api/bootstrap', { headers: otherAdmin.headers });
  assertNoTenantLeak('admin notifications', afterAdmin.notifications, 'tenant-other');
  assertNoTenantLeak('other notifications', afterOther.notifications, 'tenant-pf');
  assertNoTenantLeak('admin audit', afterAdmin.auditEvents, 'tenant-other');
  assertNoTenantLeak('other audit', afterOther.auditEvents, 'tenant-pf');
  assertNoTenantLeak('admin prompt versions', afterAdmin.aiPromptVersions, 'tenant-other');
  assertNoTenantLeak('other prompt versions', afterOther.aiPromptVersions, 'tenant-pf');
  assertNoTenantLeak('admin tasks after', afterAdmin.tasks, 'tenant-other');
  assertNoTenantLeak('other tasks after', afterOther.tasks, 'tenant-pf');
  if (
    !ids(afterAdmin.workflows).includes(builtWorkflow.id)
    || !ids(afterAdmin.workflows).includes(automaticWorkflow.id)
    || !ids(afterAdmin.workflows).includes(sideEffectWorkflow.id)
    || !ids(afterAdmin.workflows).includes(delayedWorkflow.id)
  ) {
    throw new Error(`admin bootstrap missing built workflow: ${JSON.stringify(afterAdmin.workflows)}`);
  }
  if (
    ids(afterOther.workflows).includes(builtWorkflow.id)
    || ids(afterOther.workflows).includes(automaticWorkflow.id)
    || ids(afterOther.workflows).includes(sideEffectWorkflow.id)
    || ids(afterOther.workflows).includes(delayedWorkflow.id)
  ) {
    throw new Error(`built workflow leaked to other tenant: ${JSON.stringify(afterOther.workflows)}`);
  }
  if ((afterOther.generatedDocuments ?? []).some((document) => document.id === sideEffectDocument.id || document.subjectId === 'Z-1025')) {
    throw new Error(`workflow generated document leaked to other bootstrap: ${JSON.stringify(afterOther.generatedDocuments)}`);
  }
  if ((afterOther.workflowRuns ?? []).some((run) => run.workflowId === automaticWorkflow.id || run.id === automaticRun.id)) {
    throw new Error(`automatic workflow run leaked to other bootstrap: ${JSON.stringify(afterOther.workflowRuns)}`);
  }
  if ((afterOther.tasks ?? []).some((task) => task.id === automaticTask.id || task.workflowRunId === automaticRun.id)) {
    throw new Error(`automatic workflow task leaked to other bootstrap: ${JSON.stringify(afterOther.tasks)}`);
  }
  if ((afterOther.tasks ?? []).some((task) => task.id === delayedTask.id || task.workflowRunId === delayedRun.id)) {
    throw new Error(`delayed workflow task leaked to other bootstrap: ${JSON.stringify(afterOther.tasks)}`);
  }
  const archivedBuiltWorkflow = await request(`/api/workflows/${builtWorkflow.id}`, {
    method: 'DELETE',
    headers: admin.headers,
  });
  if (
    !archivedBuiltWorkflow.archived
    || archivedBuiltWorkflow.deleted
    || archivedBuiltWorkflow.workflow.status !== 'archived'
    || archivedBuiltWorkflow.workflow.killSwitch !== true
    || !archivedBuiltWorkflow.workflow.deletedAt
  ) {
    throw new Error(`used workflow archive failed: ${JSON.stringify(archivedBuiltWorkflow)}`);
  }
  const workflowsAfterArchive = await request('/api/workflows', { headers: admin.headers });
  if (workflowsAfterArchive.some((workflow) => workflow.id === builtWorkflow.id)) {
    throw new Error(`archived workflow should be hidden from active list: ${JSON.stringify(workflowsAfterArchive)}`);
  }
  const archivedWorkflowRuns = await request(`/api/workflow-runs?workflowId=${builtWorkflow.id}`, { headers: admin.headers });
  if (!archivedWorkflowRuns.some((run) => run.id === execution.results[0].run.id)) {
    throw new Error(`archived workflow run audit should remain visible: ${JSON.stringify(archivedWorkflowRuns)}`);
  }

  console.log(JSON.stringify({
    ok: true,
    admin: {
      tenant: adminBoot.tenants[0].id,
      prompts: ids(afterAdmin.aiPrompts),
      workflows: ids(afterAdmin.workflows),
      configs: ids(afterAdmin.moduleConfigs),
      syncEvents: adminSync.events.length,
    },
    other: {
      tenant: otherBoot.tenants[0].id,
      prompts: ids(afterOther.aiPrompts),
      workflows: ids(afterOther.workflows),
      configs: ids(afterOther.moduleConfigs),
      syncEvents: otherSync.events.length,
    },
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
