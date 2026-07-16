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

async function login(login, password) {
  const data = await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify(password ? { login, password } : { login }),
  });
  return {
    user: data.user,
    headers: { Authorization: `Bearer ${data.token}` },
  };
}

function ids(rows = []) {
  return rows.map((row) => row.id).sort();
}

function assertIncludes(label, actual, expected) {
  const missing = expected.filter((id) => !actual.includes(id));
  if (missing.length) throw new Error(`${label} missing ${missing.join(', ')}; got ${actual.join(', ')}`);
}

function assertExcludes(label, actual, blocked) {
  const leaked = blocked.filter((id) => actual.includes(id));
  if (leaked.length) throw new Error(`${label} leaked ${leaked.join(', ')}; got ${actual.join(', ')}`);
}

async function main() {
  const admin = await login('admin');
  const manager = await login('kierownik');

  const managerBoot = await request('/api/bootstrap', { headers: manager.headers });
  assertIncludes('Krakow manager branch scope', ids(managerBoot.branches), ['krk']);
  assertExcludes('Krakow manager branch scope', ids(managerBoot.branches), ['waw', 'oth']);
  assertExcludes('Krakow manager users', ids(managerBoot.users), ['u-other-admin']);
  assertExcludes('Krakow manager crews', ids(managerBoot.crews), ['team-b1']);

  await expectStatus('/api/users', 403, {
    method: 'POST',
    headers: manager.headers,
    body: JSON.stringify({
      login: `waw.blocked.${Date.now()}`,
      firstName: 'Blocked',
      lastName: 'Warszawa',
      role: 'PRACOWNIK',
      branchId: 'waw',
      password: 'test1234',
    }),
  });

  const managerWorkerPassword = `worker-${Date.now()}`;
  const managerWorker = await request('/api/users', {
    method: 'POST',
    headers: manager.headers,
    body: JSON.stringify({
      login: `krk.worker.${Date.now()}`,
      firstName: 'Krakow',
      lastName: 'Worker',
      role: 'PRACOWNIK',
      branchId: 'krk',
      teamId: 'team-a1',
      password: managerWorkerPassword,
    }),
  });
  if (managerWorker.branchId !== 'krk' || managerWorker.teamId !== 'team-a1') {
    throw new Error(`manager worker create failed: ${JSON.stringify(managerWorker)}`);
  }

  const updatedManagerWorker = await request(`/api/users/${managerWorker.id}`, {
    method: 'PATCH',
    headers: manager.headers,
    body: JSON.stringify({
      firstName: 'Krakow',
      lastName: 'Worker Updated',
      login: managerWorker.login,
      role: 'BRYGADZISTA',
      branchId: 'krk',
      teamId: 'team-a2',
      status: 'inactive',
    }),
  });
  if (updatedManagerWorker.role !== 'BRYGADZISTA' || updatedManagerWorker.teamId !== 'team-a2' || updatedManagerWorker.status !== 'inactive') {
    throw new Error(`manager worker update failed: ${JSON.stringify(updatedManagerWorker)}`);
  }

  const archivedManagerWorker = await request(`/api/users/${managerWorker.id}`, {
    method: 'DELETE',
    headers: manager.headers,
  });
  if (!archivedManagerWorker.archived || archivedManagerWorker.user.status !== 'archived') {
    throw new Error(`manager worker archive failed: ${JSON.stringify(archivedManagerWorker)}`);
  }

  const emptyBranchId = `smoke-empty-${Date.now()}`;
  const emptyBranch = await request('/api/branches', {
    method: 'POST',
    headers: admin.headers,
    body: JSON.stringify({
      id: emptyBranchId,
      name: `Smoke pusty ${Date.now()}`,
      city: 'Test',
      status: 'active',
    }),
  });
  if (emptyBranch.id !== emptyBranchId) throw new Error(`admin branch create failed: ${JSON.stringify(emptyBranch)}`);

  const managerAfterBranchCreate = await request('/api/bootstrap', { headers: manager.headers });
  assertExcludes('Krakow manager new branch scope', ids(managerAfterBranchCreate.branches), [emptyBranchId]);

  const deletedEmptyBranch = await request(`/api/branches/${emptyBranchId}`, {
    method: 'DELETE',
    headers: admin.headers,
  });
  if (!deletedEmptyBranch.deleted || deletedEmptyBranch.archived) {
    throw new Error(`empty branch hard delete failed: ${JSON.stringify(deletedEmptyBranch)}`);
  }

  const linkedBranchId = `smoke-linked-${Date.now()}`;
  await request('/api/branches', {
    method: 'POST',
    headers: admin.headers,
    body: JSON.stringify({
      id: linkedBranchId,
      name: `Smoke powiazany ${Date.now()}`,
      city: 'Test',
      status: 'active',
    }),
  });
  const linkedClient = await request('/api/clients', {
    method: 'POST',
    headers: admin.headers,
    body: JSON.stringify({
      name: 'Smoke klient oddzialu',
      phone: `+48${Date.now()}`,
      email: 'smoke.branch@example.test',
      address: 'Testowa 1',
      branchId: linkedBranchId,
    }),
  });
  if (linkedClient.branchId !== linkedBranchId) throw new Error(`linked client create failed: ${JSON.stringify(linkedClient)}`);
  const archivedLinkedBranch = await request(`/api/branches/${linkedBranchId}`, {
    method: 'DELETE',
    headers: admin.headers,
  });
  if (!archivedLinkedBranch.archived || archivedLinkedBranch.deleted || archivedLinkedBranch.references?.clients < 1) {
    throw new Error(`linked branch archive failed: ${JSON.stringify(archivedLinkedBranch)}`);
  }

  const password = `rop-${Date.now()}`;
  const ropUser = await request('/api/users', {
    method: 'POST',
    headers: admin.headers,
    body: JSON.stringify({
      login: `rop.${Date.now()}`,
      firstName: 'Regionalny',
      lastName: 'Operacyjny',
      role: 'ROP',
      branchId: 'krk',
      password,
    }),
  });
  if (ropUser.role !== 'ROP' || ropUser.branchId !== 'krk') throw new Error(`ROP user create failed: ${JSON.stringify(ropUser)}`);

  const rop = await login(ropUser.login, password);
  const ropBoot = await request('/api/bootstrap', { headers: rop.headers });
  assertIncludes('ROP branch scope', ids(ropBoot.branches), ['krk', 'waw']);
  assertIncludes('ROP user scope', ids(ropBoot.users), ['u-manager', 'u-est']);

  await expectStatus('/api/branches', 403, {
    method: 'POST',
    headers: rop.headers,
    body: JSON.stringify({
      id: `rop-branch-${Date.now()}`,
      name: 'ROP must not create branches',
      city: 'Test',
    }),
  });

  const delegation = await request('/api/branch-delegations', {
    method: 'POST',
    headers: rop.headers,
    body: JSON.stringify({
      userId: 'u-est',
      fromBranchId: 'krk',
      toBranchId: 'waw',
      startsAt: new Date(Date.now() - 60_000).toISOString(),
      endsAt: new Date(Date.now() + 86_400_000).toISOString(),
      reason: 'Smoke ROP zastepstwo Warszawa',
      status: 'active',
    }),
  });
  if (delegation.userId !== 'u-est' || delegation.toBranchId !== 'waw') throw new Error(`delegation create failed: ${JSON.stringify(delegation)}`);

  const estimator = await login('wycena');
  const estimatorBoot = await request('/api/bootstrap', { headers: estimator.headers });
  assertIncludes('Delegated estimator branch scope', ids(estimatorBoot.branchScope.branchIds.map((id) => ({ id }))), ['krk', 'waw']);

  const crew = await request('/api/crews', {
    method: 'POST',
    headers: rop.headers,
    body: JSON.stringify({
      name: `Smoke delegowana ekipa ${Date.now()}`,
      branchId: 'krk',
      leaderId: 'u-est',
      members: ['Tomasz Lis'],
      utilization: 15,
    }),
  });
  if (crew.branchId !== 'krk') throw new Error(`crew create failed: ${JSON.stringify(crew)}`);

  const movedCrew = await request(`/api/crews/${crew.id}`, {
    method: 'PATCH',
    headers: rop.headers,
    body: JSON.stringify({
      name: crew.name,
      branchId: 'waw',
      leaderId: 'u-est',
      members: ['Tomasz Lis'],
      utilization: 25,
    }),
  });
  if (movedCrew.branchId !== 'waw' || movedCrew.leaderId !== 'u-est') {
    throw new Error(`ROP crew move failed: ${JSON.stringify(movedCrew)}`);
  }

  await request(`/api/crews/${crew.id}`, { method: 'DELETE', headers: rop.headers });
  await request(`/api/branch-delegations/${delegation.id}`, { method: 'DELETE', headers: rop.headers });
  await request(`/api/users/${ropUser.id}`, { method: 'DELETE', headers: admin.headers });

  console.log(JSON.stringify({
    ok: true,
    managerBranches: ids(managerBoot.branches),
    ropBranches: ids(ropBoot.branches),
    delegatedEstimatorBranches: estimatorBoot.branchScope.branchIds,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
