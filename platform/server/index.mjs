import cors from 'cors';
import express from 'express';
import { createHash, createHmac, scryptSync, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { loadDb, resetDb, saveDb } from './db.mjs';
import { pseudonymizeTranscript, applyRetention, hashPassword } from './security.mjs';
import { registerMobileCompat, mobileUser } from './mobile-compat.mjs';

// Monitoring błędów: Sentry aktywny tylko gdy ustawiono SENTRY_DSN (bez DSN zero narzutu).
let sentry = null;
if (process.env.SENTRY_DSN) {
  try {
    sentry = await import('@sentry/node');
    sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.NODE_ENV || 'development',
      tracesSampleRate: 0,
    });
    console.log('[sentry] monitoring błędów aktywny');
  } catch (err) {
    sentry = null;
    console.error('[sentry] inicjalizacja nieudana — kontynuuję bez monitoringu:', err.message);
  }
}

const port = Number(process.env.ARBOR_API_PORT ?? 8790);
const jwtSecret = process.env.ARBOR_JWT_SECRET || 'dev-only-arbor-secret-change-me';
const tokenTtlSeconds = Number(process.env.ARBOR_TOKEN_TTL_SECONDS ?? 60 * 60 * 8);
const zadarmaSecret = process.env.ZADARMA_SECRET || (process.env.NODE_ENV === 'production' ? '' : 'dev-zadarma-secret');
const portalSecret = process.env.ARBOR_PORTAL_SECRET || jwtSecret;
const devResetEnabled = process.env.ARBOR_ENABLE_DEV_RESET === '1';
const devResetSecret = process.env.ARBOR_DEV_RESET_SECRET || '';

if (process.env.NODE_ENV === 'production') {
  const weakSecret = (value) => !value || /change|dev-only|secret-change/i.test(value);
  if (weakSecret(process.env.ARBOR_JWT_SECRET)) {
    console.error('[arbor] FATAL: w produkcji wymagany jest silny ARBOR_JWT_SECRET (openssl rand -hex 32).');
    process.exit(1);
  }
  if (devResetEnabled) {
    // Nieuwierzytelniony endpoint kasujący CAŁĄ bazę nie ma prawa istnieć na żywej instancji.
    console.error('[arbor] FATAL: ARBOR_ENABLE_DEV_RESET=1 jest niedozwolone w produkcji (reset kasuje wszystkie dane firmy).');
    process.exit(1);
  }
}

const roleAccess = {
  ADMINISTRATOR: '*',
  DYREKTOR: ['dashboard', 'orders', 'communications', 'valuations', 'estimator', 'schedule', 'crm', 'automation', 'documents', 'map', 'offers', 'invoices', 'teams', 'fleet', 'warehouse', 'reports', 'hr', 'audit', 'settings', 'mobile', 'portal'],
  ROP: ['dashboard', 'orders', 'communications', 'valuations', 'estimator', 'schedule', 'crm', 'automation', 'documents', 'map', 'offers', 'invoices', 'teams', 'fleet', 'warehouse', 'reports', 'hr', 'mobile', 'portal'],
  KIEROWNIK: ['dashboard', 'orders', 'communications', 'valuations', 'estimator', 'schedule', 'crm', 'automation', 'documents', 'map', 'offers', 'invoices', 'teams', 'fleet', 'warehouse', 'reports', 'hr', 'mobile', 'portal'],
  WYCENIAJACY: ['dashboard', 'orders', 'communications', 'valuations', 'estimator', 'schedule', 'crm', 'documents', 'map', 'offers', 'fleet', 'mobile'],
  BRYGADZISTA: ['dashboard', 'orders', 'map', 'teams', 'mobile'],
  PRACOWNIK: ['dashboard', 'orders', 'mobile'],
  KSIEGOWA: ['dashboard', 'orders', 'documents', 'invoices', 'reports', 'teams', 'hr', 'mobile', 'portal'],
};

const writeAccess = {
  ADMINISTRATOR: '*',
  DYREKTOR: ['orders', 'communications', 'valuations', 'schedule', 'crm', 'automation', 'documents', 'offers', 'invoices', 'teams', 'fleet', 'warehouse', 'hr', 'settings'],
  ROP: ['orders', 'communications', 'valuations', 'schedule', 'crm', 'automation', 'documents', 'offers', 'teams', 'fleet', 'warehouse', 'hr'],
  KIEROWNIK: ['orders', 'communications', 'valuations', 'schedule', 'crm', 'automation', 'documents', 'offers', 'teams', 'fleet', 'warehouse', 'hr'],
  WYCENIAJACY: ['valuations', 'estimator', 'offers', 'mobile'],
  BRYGADZISTA: ['orders', 'mobile'],
  PRACOWNIK: [],
  KSIEGOWA: ['documents', 'invoices'],
};

const orderStatuses = new Set(['NOWE', 'ZAPLANOWANE', 'W_REALIZACJI', 'ZAKONCZONE', 'ANULOWANE']);
const orderPriorities = new Set(['niski', 'normalny', 'wysoki', 'pilny']);
const clientPipelineStages = new Set(['lead', 'kontakt', 'oferta', 'negocjacje', 'wygrane']);
const valuationStatuses = new Set(['do_potwierdzenia', 'zatwierdzona', 'przydzielona', 'odrzucona']);
const invoiceStatuses = new Set(['szkic', 'wyslana', 'oplacona', 'po_terminie']);
const taskStatuses = new Set(['open', 'in_progress', 'done', 'cancelled']);
const taskPriorities = new Set(['low', 'normal', 'high', 'urgent']);
const taskSources = new Set(['manual', 'workflow', 'ai_receptionist', 'softphone', 'field_meeting', 'system']);
const treeConditions = new Set(['excellent', 'good', 'fair', 'poor', 'critical']);
const treeRiskLevels = new Set(['low', 'medium', 'high', 'critical']);
const treeAssetStatuses = new Set(['active', 'archived']);
const branchStatuses = new Set(['active', 'archived']);
const branchDelegationStatuses = new Set(['active', 'revoked', 'expired', 'archived']);
const userStatuses = new Set(['active', 'inactive', 'archived']);
const userRoles = new Set(Object.keys(roleAccess));
const moduleKeys = new Set([
  'dashboard', 'orders', 'communications', 'valuations', 'estimator', 'schedule', 'crm', 'automation', 'documents', 'map', 'offers',
  'invoices', 'teams', 'fleet', 'warehouse', 'reports', 'hr', 'audit', 'settings', 'mobile', 'portal',
]);
const equipmentTypes = new Set(['pojazd', 'podnosnik', 'rebak', 'kosiarka', 'pilarka', 'frezarka']);
const equipmentStatuses = new Set(['dostepny', 'zarezerwowany', 'serwis', 'w_terenie']);
const equipmentRisks = new Set(['niski', 'sredni', 'wysoki']);

function tokenFor(user) {
  const payload = {
    sub: user.id,
    role: user.role,
    branchId: user.branchId,
    teamId: user.teamId,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + tokenTtlSeconds,
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${encoded}.${signTokenPayload(encoded)}`;
}

function decodeToken(value) {
  if (!value) return null;
  try {
    const token = String(value).replace(/^Bearer\s+/i, '');
    const [encoded, signature] = token.split('.');
    if (!encoded || !signature || !safeEqual(signature, signTokenPayload(encoded))) return null;
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

function signTokenPayload(encoded) {
  return createHmac('sha256', jwtSecret).update(encoded).digest('base64url');
}

// Nowe hasła: scrypt z losową solą (implementacja współdzielona w security.mjs —
// seed używa tej samej przy bootstrapie haseł z env). Stare hashe (HMAC-SHA256
// bez soli) są nadal weryfikowalne, więc istniejące konta działają bez migracji.
const passwordHash = hashPassword;

function verifyPassword(user, password) {
  // Konta demo bez hasła: dozwolone tylko poza produkcją.
  if (!user.passwordHash) return process.env.NODE_ENV !== 'production';
  if (!password) return false;
  if (user.passwordHash.startsWith('scrypt:')) {
    const [, salt, stored] = user.passwordHash.split(':');
    if (!salt || !stored) return false;
    return safeEqual(stored, scryptSync(String(password), salt, 32).toString('base64url'));
  }
  return safeEqual(user.passwordHash, createHmac('sha256', jwtSecret).update(String(password)).digest('base64url'));
}

function publicUser(user) {
  const { passwordHash: _passwordHash, ...safeUser } = user;
  return safeUser;
}

function userStatus(user) {
  return user?.status ?? 'active';
}

function userIsActive(user) {
  return Boolean(user) && !user.deletedAt && userStatus(user) === 'active';
}

function signPortalPayload(encoded) {
  return createHmac('sha256', portalSecret).update(encoded).digest('base64url');
}

// Linki portalu klienta wygasają po ARBOR_PORTAL_TOKEN_TTL_DAYS (domyślnie 90) —
// wyciek starego linku (forward maila, historia przeglądarki) nie daje trwałego dostępu.
const portalTokenTtlDays = Number(process.env.ARBOR_PORTAL_TOKEN_TTL_DAYS || 90);

function portalTokenFor(order) {
  const payload = {
    orderId: order.id,
    clientId: order.clientId,
    branchId: order.branchId,
    exp: Math.floor(Date.now() / 1000) + portalTokenTtlDays * 24 * 60 * 60,
    // Wersja per zlecenie: inkrementacja (rewokacja) unieważnia wszystkie starsze linki.
    v: Number(order.portalTokenVersion ?? 1),
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${encoded}.${signPortalPayload(encoded)}`;
}

function decodePortalToken(value) {
  if (!value) return null;
  try {
    const [encoded, signature] = String(value).split('.');
    if (!encoded || !signature || !safeEqual(signature, signPortalPayload(encoded))) return null;
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    // Stare tokeny (sprzed wprowadzenia exp) pozostają ważne — brak pola = brak terminu.
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
}

function webhookSignature(req) {
  return req.get('x-zadarma-signature') || req.get('x-arbor-signature') || req.query.signature || '';
}

function webhookSignedPayload(req) {
  if (req.method === 'GET') {
    const params = new URLSearchParams();
    Object.entries(req.query)
      .filter(([key]) => key !== 'signature')
      .sort(([left], [right]) => left.localeCompare(right))
      .forEach(([key, value]) => params.set(key, String(value)));
    return params.toString();
  }
  return req.rawBody || JSON.stringify(req.body ?? {});
}

function signWebhookPayload(payload) {
  return createHmac('sha256', zadarmaSecret).update(payload).digest('hex');
}

function verifyZadarmaWebhook(req) {
  if (!zadarmaSecret) return { ok: false, status: 503, error: 'Brak ZADARMA_SECRET po stronie serwera' };
  const provided = webhookSignature(req);
  if (!provided) return { ok: false, status: 401, error: 'Brak podpisu webhooka' };
  const expected = signWebhookPayload(webhookSignedPayload(req));
  return safeEqual(provided, expected)
    ? { ok: true }
    : { ok: false, status: 401, error: 'Nieprawidłowy podpis webhooka' };
}

function integrationActor(db, branchId) {
  return db.users.find((user) => user.role === 'ADMINISTRATOR' && user.branchId === branchId)
    || db.users.find((user) => user.branchId === branchId)
    || db.users[0]
    || { id: 'integration-zadarma', firstName: 'Integracja', lastName: 'Zadarma', role: 'ADMINISTRATOR', branchId };
}

function can(role, module, mode = 'read') {
  const matrix = mode === 'write' ? writeAccess : roleAccess;
  return matrix[role] === '*' || matrix[role]?.includes(module);
}

function normalizeModules(value, fallback = []) {
  const input = Array.isArray(value) ? value : fallback;
  const seen = new Set();
  return input
    .map((module) => String(module ?? '').trim())
    .filter((module) => moduleKeys.has(module) && !seen.has(module) && seen.add(module));
}

function invalidModules(value) {
  if (!Array.isArray(value)) return [];
  return value.map((module) => String(module ?? '').trim()).filter((module) => !moduleKeys.has(module));
}

function modulesForRole(role, mode = 'read') {
  const matrix = mode === 'write' ? writeAccess : roleAccess;
  if (matrix[role] === '*') return [...moduleKeys];
  return [...(matrix[role] ?? [])];
}

function rolePermissionRow(db, user, role) {
  const tenantId = tenantIdForUser(db, user);
  return (db.rolePermissions ?? []).find((row) => row.tenantId === tenantId && row.role === role && row.status !== 'archived') ?? null;
}

function effectiveRolePermission(db, user, role) {
  const defaultModules = modulesForRole(role);
  const defaultWritable = modulesForRole(role, 'write');
  if (role === 'ADMINISTRATOR') {
    return {
      id: `role-system-${role}`,
      tenantId: tenantIdForUser(db, user),
      role,
      modules: defaultModules,
      writable: defaultWritable,
      locked: true,
      source: 'system',
      status: 'active',
    };
  }
  const row = rolePermissionRow(db, user, role);
  if (!row) {
    return {
      id: `role-default-${role}`,
      tenantId: tenantIdForUser(db, user),
      role,
      modules: defaultModules,
      writable: defaultWritable,
      locked: false,
      source: 'default',
      status: 'active',
    };
  }
  const modules = normalizeModules(row.modules, defaultModules);
  const writable = normalizeModules(row.writable, defaultWritable).filter((module) => modules.includes(module));
  return {
    ...row,
    modules,
    writable,
    locked: false,
    source: 'tenant',
  };
}

function canRole(db, user, role, module, mode = 'read') {
  const permission = effectiveRolePermission(db, user, role);
  const modules = mode === 'write' ? permission.writable : permission.modules;
  return modules.includes(module);
}

function canUser(db, user, module, mode = 'read') {
  return Boolean(user) && canRole(db, user, user.role, module, mode);
}

// Role, których nie może nadać/edytować ktoś bez pełnego dostępu do ustawień (ochrona przed eskalacją uprawnień).
const privilegedUserRoles = new Set(['ADMINISTRATOR', 'DYREKTOR', 'ROP']);
function canManageUserRole(db, user, role) {
  if (canUser(db, user, 'settings', 'write')) return true; // administrator: pelna kontrola nad kontami
  return !privilegedUserRoles.has(role); // kierownik/dyrektor HR: bez tworzenia kont uprzywilejowanych
}

// Polityka haseł: konta uprzywilejowane (dostępne z internetu na żywej instancji) wymagają
// pełnego hasła; role terenowe mogą mieć krótki PIN (praca w rękawicach, ekran telefonu).
function passwordPolicyError(role, password) {
  const min = privilegedUserRoles.has(role) ? 8 : 4;
  if (String(password).length < min) return `Hasło dla roli ${role} musi mieć co najmniej ${min} znaków`;
  return null;
}

function accessPayloadForUser(db, user) {
  const permission = effectiveRolePermission(db, user, user.role);
  return {
    role: user.role,
    modules: permission.modules,
    writable: permission.writable,
  };
}

function visibleRolePermissions(db, user) {
  return Object.keys(roleAccess).map((role) => effectiveRolePermission(db, user, role));
}

function rolePermissionPayload(db, user, role, body = {}) {
  const normalizedRole = String(role ?? '').trim().toUpperCase();
  if (!userRoles.has(normalizedRole)) return { error: 'Nieprawidłowa rola', status: 400 };
  if (normalizedRole === 'ADMINISTRATOR') return { error: 'Rola administratora jest systemowa i nie może być edytowana', status: 409 };

  const current = effectiveRolePermission(db, user, normalizedRole);
  const modulesInput = Object.hasOwn(body, 'modules') ? body.modules : (Object.hasOwn(body, 'read') ? body.read : current.modules);
  const writableInput = Object.hasOwn(body, 'writable') ? body.writable : (Object.hasOwn(body, 'write') ? body.write : current.writable);
  if (!Array.isArray(modulesInput) || !Array.isArray(writableInput)) return { error: 'modules i writable muszą być tablicami', status: 400 };
  const invalid = [...invalidModules(modulesInput), ...invalidModules(writableInput)];
  if (invalid.length) return { error: 'Nieprawidłowe moduły uprawnień', status: 400, invalidModules: [...new Set(invalid)] };

  const modules = normalizeModules(modulesInput);
  const writable = normalizeModules(writableInput).filter((module) => modules.includes(module));
  const tenantId = tenantIdForUser(db, user);
  const now = new Date().toISOString();
  return {
    permission: {
      id: current.source === 'tenant' ? current.id : `role-${tenantId ?? 'default'}-${normalizedRole.toLowerCase()}`,
      tenantId,
      role: normalizedRole,
      modules,
      writable,
      status: 'active',
      createdAt: current.source === 'tenant' ? current.createdAt : now,
      createdBy: current.source === 'tenant' ? current.createdBy : user.id,
      updatedAt: now,
      updatedBy: user.id,
    },
  };
}

function tenantIdForUser(db, user) {
  return db.branches.find((branch) => branch.id === user.branchId)?.tenantId ?? db.tenants?.[0]?.id ?? null;
}

function defaultTenantId(db) {
  return db.tenants?.[0]?.id ?? null;
}

function tenantIdForActor(db, actorId) {
  const actor = db.users.find((user) => user.id === actorId);
  return actor ? tenantIdForUser(db, actor) : defaultTenantId(db);
}

function rowTenantId(db, row) {
  return row?.tenantId ?? tenantIdForActor(db, row?.actorId) ?? defaultTenantId(db);
}

function tenantRows(db, user, rows = []) {
  const tenantId = tenantIdForUser(db, user);
  return rows.filter((row) => rowTenantId(db, row) === tenantId);
}

function tenantBranchIds(db, user) {
  const tenantId = tenantIdForUser(db, user);
  return new Set(db.branches.filter((branch) => (branch.tenantId ?? tenantId) === tenantId).map((branch) => branch.id));
}

function sameTenantBranch(db, user, branchId) {
  return tenantBranchIds(db, user).has(branchId);
}

function elevatedBranchRole(user) {
  return ['ADMINISTRATOR', 'DYREKTOR', 'ROP'].includes(user?.role);
}

function branchDelegationIsActive(delegation, now = new Date()) {
  if (!delegation || delegation.deletedAt || delegation.status !== 'active') return false;
  const start = new Date(String(delegation.startsAt ?? ''));
  if (!Number.isFinite(start.getTime()) || start > now) return false;
  if (!delegation.endsAt) return true;
  const end = new Date(String(delegation.endsAt));
  return Number.isFinite(end.getTime()) && end >= now;
}

function visibleBranchDelegations(db, user, options = {}) {
  const tenantId = tenantIdForUser(db, user);
  const rows = tenantRows(db, user, db.branchDelegations ?? []).filter((delegation) => {
    if (!options.includeArchived && (delegation.deletedAt || delegation.status === 'archived')) return false;
    const userInTenant = (db.users ?? []).some((next) => next.id === delegation.userId && sameTenantBranch(db, user, next.branchId));
    const branchesInTenant = sameTenantBranch(db, user, delegation.fromBranchId) && sameTenantBranch(db, user, delegation.toBranchId);
    return (delegation.tenantId ?? tenantId) === tenantId && userInTenant && branchesInTenant;
  });
  if (elevatedBranchRole(user) || canUser(db, user, 'settings')) return rows;
  return rows.filter((delegation) => delegation.userId === user.id);
}

function userDelegatedBranchIds(db, user, now = new Date()) {
  const tenantId = tenantIdForUser(db, user);
  return new Set((db.branchDelegations ?? [])
    .filter((delegation) => (
      (delegation.tenantId ?? tenantId) === tenantId
      && delegation.userId === user.id
      && branchDelegationIsActive(delegation, now)
      && sameTenantBranch(db, user, delegation.toBranchId)
    ))
    .map((delegation) => delegation.toBranchId));
}

function scopedBranchIds(db, user) {
  const tenantIds = tenantBranchIds(db, user);
  if (elevatedBranchRole(user)) return tenantIds;
  const ids = new Set();
  if (user.branchId) ids.add(user.branchId);
  userDelegatedBranchIds(db, user).forEach((id) => ids.add(id));
  return new Set([...ids].filter((id) => tenantIds.has(id)));
}

function canAccessBranch(db, user, branchId) {
  return scopedBranchIds(db, user).has(branchId);
}

function branchStatus(branch) {
  return branch?.status ?? 'active';
}

function branchIsActive(branch) {
  return Boolean(branch) && !branch.deletedAt && branchStatus(branch) === 'active';
}

function visibleBranches(db, user, options = {}) {
  const branchIds = scopedBranchIds(db, user);
  return db.branches.filter((branch) => {
    if (!branchIds.has(branch.id)) return false;
    if (!options.includeArchived && (branch.deletedAt || branchStatus(branch) === 'archived')) return false;
    return true;
  });
}

function activeTenantBranches(db, user, excludeId) {
  return visibleBranches(db, user, { includeArchived: true })
    .filter((branch) => branch.id !== excludeId && branchIsActive(branch));
}

function branchActiveUsers(db, branchId) {
  return (db.users ?? []).filter((user) => user.branchId === branchId && userIsActive(user));
}

function branchReferenceSummary(db, branchId) {
  return {
    users: (db.users ?? []).filter((user) => user.branchId === branchId).length,
    clients: (db.clients ?? []).filter((client) => client.branchId === branchId).length,
    crews: (db.crews ?? []).filter((crew) => crew.branchId === branchId).length,
    orders: (db.orders ?? []).filter((order) => order.branchId === branchId).length,
    treeAssets: (db.treeAssets ?? []).filter((tree) => tree.branchId === branchId).length,
    equipment: (db.equipment ?? []).filter((item) => item.branchId === branchId).length,
    equipmentReservations: (db.equipmentReservations ?? []).filter((reservation) => reservation.branchId === branchId).length,
    warehouseItems: (db.warehouseItems ?? []).filter((item) => item.branchId === branchId).length,
    warehouseMovements: (db.warehouseMovements ?? []).filter((movement) => movement.branchId === branchId).length,
    softphonePresence: (db.softphonePresence ?? []).filter((presence) => presence.branchId === branchId).length,
    branchDelegations: (db.branchDelegations ?? []).filter((delegation) => (
      !delegation.deletedAt
      && delegation.status === 'active'
      && (delegation.fromBranchId === branchId || delegation.toBranchId === branchId)
    )).length,
  };
}

function branchHasReferences(db, branchId) {
  return Object.values(branchReferenceSummary(db, branchId)).some((count) => count > 0);
}

function branchArchiveBlock(db, user, branch) {
  if (branch.id === user.branchId) return { error: 'Nie można archiwizować własnego aktywnego oddziału', status: 409 };
  if (activeTenantBranches(db, user, branch.id).length === 0) return { error: 'Nie można archiwizować ostatniego aktywnego oddziału', status: 409 };
  const activeUsers = branchActiveUsers(db, branch.id);
  if (activeUsers.length) {
    return {
      error: 'Oddział ma aktywnych pracowników. Najpierw przenieś albo dezaktywuj użytkowników.',
      status: 409,
      activeUserIds: activeUsers.map((next) => next.id),
    };
  }
  const activeDelegations = (db.branchDelegations ?? []).filter((delegation) => (
    !delegation.deletedAt
    && delegation.status === 'active'
    && (delegation.fromBranchId === branch.id || delegation.toBranchId === branch.id)
  ));
  if (activeDelegations.length) {
    return {
      error: 'Oddział ma aktywne delegacje lub zastępstwa. Najpierw je odwołaj.',
      status: 409,
      activeDelegationIds: activeDelegations.map((next) => next.id),
    };
  }
  return null;
}

function normalizeBranchId(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 28);
}

function branchPayload(db, user, body = {}, existing = null) {
  const tenantId = tenantIdForUser(db, user);
  const requestedId = normalizeBranchId(body.id);
  const id = existing?.id ?? (requestedId || `br-${crypto.randomUUID().slice(0, 8)}`);
  if (!existing && (db.branches ?? []).some((branch) => branch.id === id)) return { error: 'Id oddziału jest już zajęte', status: 409 };

  const name = optionalText(body.name ?? existing?.name);
  const city = optionalText(body.city ?? existing?.city);
  if (!name || !city) return { error: 'Nazwa i miasto oddziału są wymagane', status: 400 };

  const duplicateName = (db.branches ?? []).find((branch) => (
    branch.id !== existing?.id
    && (branch.tenantId ?? tenantId) === tenantId
    && String(branch.name).trim().toLowerCase() === name.toLowerCase()
  ));
  if (duplicateName) return { error: 'Oddział o tej nazwie już istnieje w tej firmie', status: 409, duplicateId: duplicateName.id };

  const status = optionalText(body.status ?? existing?.status ?? 'active');
  if (!branchStatuses.has(status)) return { error: 'Nieprawidłowy status oddziału', status: 400 };

  const now = new Date().toISOString();
  return {
    branch: {
      ...(existing ?? {}),
      id,
      tenantId,
      name,
      city,
      status,
      createdAt: existing?.createdAt ?? now,
      createdBy: existing?.createdBy ?? user.id,
      updatedAt: now,
      updatedBy: user.id,
      deletedAt: status === 'archived' ? (existing?.deletedAt ?? now) : undefined,
      deletedBy: status === 'archived' ? (existing?.deletedBy ?? user.id) : undefined,
    },
  };
}

function canManageBranchDelegations(db, user) {
  return elevatedBranchRole(user) || canUser(db, user, 'settings', 'write');
}

function parseBranchDelegationDate(value, fieldName, fallback) {
  const text = optionalText(value ?? fallback);
  if (!text) return { value: undefined };
  const date = new Date(text);
  if (!Number.isFinite(date.getTime())) return { error: `${fieldName} ma nieprawidłowy format daty`, status: 400 };
  return { value: date.toISOString() };
}

function branchDelegationPayload(db, user, body = {}, existing = null) {
  const tenantId = tenantIdForUser(db, user);
  const targetUserId = optionalText(body.userId ?? existing?.userId);
  const targetUser = (db.users ?? []).find((next) => (
    next.id === targetUserId
    && sameTenantBranch(db, user, next.branchId)
    && userStatus(next) !== 'archived'
    && !next.deletedAt
  ));
  if (!targetUser) return { error: 'Nie znaleziono użytkownika w tym tenancie', status: 400 };
  if (!userIsActive(targetUser)) return { error: 'Użytkownik delegowany musi być aktywny', status: 409 };

  const fromBranchId = optionalText(body.fromBranchId ?? existing?.fromBranchId ?? targetUser.branchId);
  const toBranchId = optionalText(body.toBranchId ?? existing?.toBranchId);
  if (!fromBranchId || !toBranchId) return { error: 'Oddział źródłowy i docelowy są wymagane', status: 400 };
  if (fromBranchId === toBranchId) return { error: 'Delegacja musi prowadzić do innego oddziału', status: 409 };
  if (!sameTenantBranch(db, user, fromBranchId) || !sameTenantBranch(db, user, toBranchId)) {
    return { error: 'Delegacja poza tenantem', status: 403 };
  }
  const fromBranch = db.branches.find((branch) => branch.id === fromBranchId);
  const toBranch = db.branches.find((branch) => branch.id === toBranchId);
  if (!branchIsActive(fromBranch) || !branchIsActive(toBranch)) return { error: 'Delegacja wymaga aktywnych oddziałów', status: 409 };

  const now = new Date().toISOString();
  const startsAt = parseBranchDelegationDate(body.startsAt ?? existing?.startsAt ?? now, 'startsAt');
  if (startsAt.error) return startsAt;
  const requestedEndsAt = Object.hasOwn(body, 'endsAt') ? body.endsAt : existing?.endsAt;
  const endsAt = parseBranchDelegationDate(requestedEndsAt, 'endsAt');
  if (endsAt.error) return endsAt;
  if (endsAt.value && new Date(endsAt.value) < new Date(startsAt.value)) {
    return { error: 'Koniec delegacji nie może być przed startem', status: 400 };
  }

  const status = optionalText(body.status ?? existing?.status ?? 'active');
  if (!branchDelegationStatuses.has(status)) return { error: 'Nieprawidłowy status delegacji', status: 400 };
  const reason = optionalText(body.reason ?? existing?.reason);
  if (!reason || reason.length < 3) return { error: 'Powod delegacji jest wymagany', status: 400 };
  const roleScope = optionalText(body.roleScope ?? existing?.roleScope);

  const duplicate = (db.branchDelegations ?? []).find((delegation) => (
    delegation.id !== existing?.id
    && delegation.userId === targetUser.id
    && delegation.toBranchId === toBranchId
    && branchDelegationIsActive(delegation)
  ));
  if (duplicate && status === 'active') {
    return { error: 'Użytkownik ma już aktywną delegację do tego oddziału', status: 409, duplicateId: duplicate.id };
  }

  return {
    delegation: {
      ...(existing ?? {}),
      id: existing?.id ?? `bd-${crypto.randomUUID().slice(0, 8)}`,
      tenantId,
      userId: targetUser.id,
      fromBranchId,
      toBranchId,
      roleScope: roleScope || undefined,
      reason,
      startsAt: startsAt.value,
      endsAt: endsAt.value,
      status,
      createdAt: existing?.createdAt ?? now,
      createdBy: existing?.createdBy ?? user.id,
      updatedAt: now,
      updatedBy: user.id,
      deletedAt: status === 'archived' ? (existing?.deletedAt ?? now) : undefined,
      deletedBy: status === 'archived' ? (existing?.deletedBy ?? user.id) : undefined,
    },
  };
}

function visibleUsers(db, user, options = {}) {
  const branchIds = scopedBranchIds(db, user);
  return db.users.filter((next) => {
    if (!branchIds.has(next.branchId)) return false;
    if (!options.includeArchived && (next.deletedAt || userStatus(next) === 'archived')) return false;
    if (!options.includeInactive && userStatus(next) === 'inactive') return false;
    return true;
  });
}

function activeTenantAdmins(db, user, excludeId) {
  return visibleUsers(db, user, { includeInactive: true })
    .filter((next) => next.id !== excludeId && next.role === 'ADMINISTRATOR' && userIsActive(next));
}

function normalizeLogin(value) {
  return String(value ?? '').trim().toLowerCase().replace(/\s+/g, '.');
}

function userPayload(db, user, body = {}, existing = null) {
  const login = normalizeLogin(body.login ?? existing?.login);
  if (login.length < 3) return { error: 'Login musi mieć co najmniej 3 znaki', status: 400 };
  const duplicateLogin = (db.users ?? []).find((next) => next.id !== existing?.id && String(next.login).toLowerCase() === login);
  if (duplicateLogin) return { error: 'Login jest już zajęty', status: 409, duplicateId: duplicateLogin.id };

  const firstName = optionalText(body.firstName ?? existing?.firstName);
  const lastName = optionalText(body.lastName ?? existing?.lastName);
  if (!firstName || !lastName) return { error: 'Imie i nazwisko sa wymagane', status: 400 };
  const role = optionalText(body.role ?? existing?.role ?? 'PRACOWNIK');
  if (!userRoles.has(role)) return { error: 'Nieprawidłowa rola użytkownika', status: 400 };
  const status = optionalText(body.status ?? existing?.status ?? 'active');
  if (!userStatuses.has(status) || status === 'archived') return { error: 'Status użytkownika musi być active albo inactive', status: 400 };
  const branchId = optionalText(body.branchId ?? existing?.branchId ?? user.branchId);
  if (!sameTenantBranch(db, user, branchId)) return { error: 'Oddział użytkownika poza tenantem', status: 403 };
  const branch = db.branches.find((next) => next.id === branchId);
  if (!branchIsActive(branch)) return { error: 'Oddział użytkownika jest zarchiwizowany', status: 409 };
  if (!elevatedBranchRole(user) && !canAccessBranch(db, user, branchId)) {
    return { error: 'Brak dostępu do oddziału użytkownika. Dodaj delegację albo wybierz własny oddział.', status: 403 };
  }

  const teamId = optionalText(body.teamId ?? existing?.teamId);
  if (teamId) {
    const team = visibleCrews(db, user).find((crew) => crew.id === teamId);
    if (!team || team.branchId !== branchId) return { error: 'Ekipa użytkownika poza oddziałem lub tenantem', status: 403 };
  }

  const now = new Date().toISOString();
  return {
    user: {
      ...(existing ?? {}),
      id: existing?.id ?? (optionalText(body.id) || `u-${crypto.randomUUID().slice(0, 8)}`),
      login,
      firstName,
      lastName,
      role,
      branchId,
      teamId: teamId || undefined,
      status,
      createdAt: existing?.createdAt ?? now,
      createdBy: existing?.createdBy ?? user.id,
      updatedAt: now,
      updatedBy: user.id,
    },
  };
}

function visibleTenants(db, user) {
  const tenantId = tenantIdForUser(db, user);
  return (db.tenants ?? []).filter((tenant) => tenant.id === tenantId);
}

function visibleTenantSubscriptions(db, user) {
  const tenantId = tenantIdForUser(db, user);
  return (db.tenantSubscriptions ?? []).filter((subscription) => subscription.tenantId === tenantId);
}

function visibleBillingPayments(db, user) {
  const tenantId = tenantIdForUser(db, user);
  return (db.billingPayments ?? []).filter((payment) => payment.tenantId === tenantId);
}

function tenantSubscription(db, user) {
  return visibleTenantSubscriptions(db, user)[0] ?? null;
}

function currentTenant(db, user) {
  const tenantId = tenantIdForUser(db, user);
  return (db.tenants ?? []).find((tenant) => tenant.id === tenantId) ?? null;
}

function tenantWriteStatus(db, user) {
  const tenant = currentTenant(db, user);
  const subscription = tenantSubscription(db, user);
  const subscriptionStatus = subscription?.status ?? null;
  if (tenant?.status === 'paused') return { blocked: true, status: tenant.status, reason: 'tenant_paused' };
  if (['past_due', 'paused', 'cancelled'].includes(subscriptionStatus)) {
    return { blocked: true, status: subscriptionStatus, reason: 'subscription_not_active' };
  }
  return { blocked: false, status: subscriptionStatus ?? tenant?.status ?? 'active', reason: null };
}

function planLimit(db, plan) {
  return (db.planLimits ?? []).find((next) => next.plan === plan) ?? null;
}

function nextMonthlyPeriod(now = new Date()) {
  const start = new Date(now);
  const end = new Date(now);
  end.setUTCMonth(end.getUTCMonth() + 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

function visibleOrders(db, user) {
  const rows = (db.orders ?? []).filter((order) => !order.deletedAt);
  const branchIds = scopedBranchIds(db, user);
  if (elevatedBranchRole(user)) return rows.filter((order) => branchIds.has(order.branchId));
  if (['BRYGADZISTA', 'PRACOWNIK'].includes(user.role)) {
    const delegatedBranchIds = userDelegatedBranchIds(db, user);
    return rows.filter((order) => order.teamId === user.teamId || delegatedBranchIds.has(order.branchId));
  }
  return rows.filter((order) => branchIds.has(order.branchId));
}

function visibleClients(db, user) {
  const rows = (db.clients ?? []).filter((client) => !client.deletedAt);
  const branchIds = scopedBranchIds(db, user);
  if (elevatedBranchRole(user)) return rows.filter((client) => branchIds.has(client.branchId ?? user.branchId));
  return rows.filter((client) => branchIds.has(client.branchId ?? user.branchId));
}

function visibleCommunications(db, user) {
  const clientIds = new Set(visibleClients(db, user).map((client) => client.id));
  return (db.communications ?? []).filter((item) => !item.deletedAt && (clientIds.has(item.clientId) || item.userId === user.id));
}

function canTreeAssets(db, user, mode = 'read') {
  return ['crm', 'orders', 'valuations', 'mobile'].some((module) => canUser(db, user, module, mode));
}

function requireTreeAccess(mode = 'read') {
  return (req, res, next) => {
    if (!req.user || !canTreeAssets(req.db, req.user, mode)) return res.status(403).json({ error: 'Brak uprawnień', module: 'treeAssets', mode });
    return next();
  };
}

function visibleTreeAssets(db, user, options = {}) {
  const tenantId = tenantIdForUser(db, user);
  const branchIds = scopedBranchIds(db, user);
  const orders = visibleOrders(db, user);
  const orderIds = new Set(orders.map((order) => order.id));
  const orderClientIds = new Set(orders.map((order) => order.clientId));
  const valuations = visibleValuations(db, user);
  const valuationIds = new Set(valuations.map((valuation) => valuation.id));
  const crmClientIds = canUser(db, user, 'crm')
    ? new Set(visibleClients(db, user).map((client) => client.id))
    : new Set();
  return (db.treeAssets ?? []).filter((tree) => {
    if (!options.includeArchived && (tree.deletedAt || tree.status === 'archived')) return false;
    if ((tree.tenantId ?? tenantId) !== tenantId) return false;
    if (!branchIds.has(tree.branchId)) return false;
    if (crmClientIds.has(tree.clientId)) return true;
    if (tree.orderId && orderIds.has(tree.orderId)) return true;
    if (tree.valuationId && valuationIds.has(tree.valuationId)) return true;
    return orderClientIds.has(tree.clientId) && Boolean(tree.orderId);
  });
}

function treeAssetPayload(db, user, body = {}, existing = null) {
  const clientId = body.clientId ?? existing?.clientId;
  const client = (db.clients ?? []).find((next) => next.id === clientId);
  if (!client) return { error: 'Nie znaleziono klienta dla drzewa', status: 400 };

  const orderId = Object.hasOwn(body, 'orderId') ? body.orderId : existing?.orderId;
  const order = orderId ? (db.orders ?? []).find((next) => next.id === orderId) : null;
  if (orderId && !order) return { error: 'Nie znaleziono zlecenia dla drzewa', status: 400 };
  if (order && order.clientId !== client.id) return { error: 'Zlecenie jest przypisane do innego klienta', status: 409 };
  if (order && !visibleOrders(db, user).some((next) => next.id === order.id)) return { error: 'Zlecenie poza zakresem roli lub tenantem', status: 403 };

  const valuationId = Object.hasOwn(body, 'valuationId') ? body.valuationId : existing?.valuationId;
  const valuation = valuationId ? (db.valuations ?? []).find((next) => next.id === valuationId) : null;
  if (valuationId && !valuation) return { error: 'Nie znaleziono wyceny dla drzewa', status: 400 };
  if (valuation && valuation.clientId !== client.id) return { error: 'Wycena jest przypisana do innego klienta', status: 409 };
  if (valuation && order && valuation.orderId !== order.id) return { error: 'Wycena jest przypisana do innego zlecenia', status: 409 };
  if (valuation && !visibleValuations(db, user).some((next) => next.id === valuation.id)) return { error: 'Wycena poza zakresem roli lub tenantem', status: 403 };

  const clientVisible = canUser(db, user, 'crm') && visibleClients(db, user).some((next) => next.id === client.id);
  if (!clientVisible && !order && !valuation) return { error: 'Klient poza zakresem roli lub tenantem', status: 403 };
  const branchId = order?.branchId ?? client.branchId ?? user.branchId;
  if (body.branchId && body.branchId !== branchId) return { error: 'Oddział drzewa musi zgadzać się z klientem lub zleceniem', status: 409 };
  const branch = branchForWrite(db, user, branchId);
  if (branch.error) return branch;

  const species = optionalText(body.species ?? existing?.species);
  if (species.length < 2) return { error: 'Gatunek drzewa jest wymagany', status: 400 };
  const condition = optionalText(body.condition ?? existing?.condition ?? 'good');
  if (!treeConditions.has(condition)) return { error: 'Nieprawidłowy stan drzewa', status: 400 };
  const riskLevel = optionalText(body.riskLevel ?? existing?.riskLevel ?? 'medium');
  if (!treeRiskLevels.has(riskLevel)) return { error: 'Nieprawidłowy poziom ryzyka drzewa', status: 400 };
  const status = optionalText(body.status ?? existing?.status ?? 'active');
  if (!treeAssetStatuses.has(status)) return { error: 'Nieprawidłowy status drzewa', status: 400 };

  const heightM = Object.hasOwn(body, 'heightM') ? Number(body.heightM) : existing?.heightM;
  const diameterCm = Object.hasOwn(body, 'diameterCm') ? Number(body.diameterCm) : existing?.diameterCm;
  if (heightM != null && (!Number.isFinite(heightM) || heightM < 0)) return { error: 'Wysokość drzewa jest nieprawidłowa', status: 400 };
  if (diameterCm != null && (!Number.isFinite(diameterCm) || diameterCm < 0)) return { error: 'Średnica drzewa jest nieprawidłowa', status: 400 };

  const gpsLat = Object.hasOwn(body, 'gpsLat') ? Number(body.gpsLat) : existing?.gpsLat;
  const gpsLng = Object.hasOwn(body, 'gpsLng') ? Number(body.gpsLng) : existing?.gpsLng;
  if (gpsLat != null && (!Number.isFinite(gpsLat) || gpsLat < -90 || gpsLat > 90)) return { error: 'Szerokość GPS jest nieprawidłowa', status: 400 };
  if (gpsLng != null && (!Number.isFinite(gpsLng) || gpsLng < -180 || gpsLng > 180)) return { error: 'Długość GPS jest nieprawidłowa', status: 400 };

  const photosInput = Object.hasOwn(body, 'photos') ? body.photos : (existing?.photos ?? []);
  if (!Array.isArray(photosInput)) return { error: 'Zdjęcia drzewa muszą być tablicą', status: 400 };
  const photos = [...new Set(photosInput.map((photo) => optionalText(photo)).filter(Boolean))];
  const lastInspectionInput = body.lastInspectionAt ?? existing?.lastInspectionAt;
  const lastInspectionAt = lastInspectionInput ? parseOptionalDate(lastInspectionInput)?.toISOString() : undefined;
  if (lastInspectionInput && !lastInspectionAt) return { error: 'Data oględzin drzewa jest nieprawidłowa', status: 400 };

  const now = new Date().toISOString();
  return {
    tree: {
      ...(existing ?? {}),
      id: existing?.id ?? body.id ?? `tree-${crypto.randomUUID().slice(0, 8)}`,
      tenantId: tenantIdForUser(db, user),
      branchId,
      clientId: client.id,
      orderId: order?.id,
      valuationId: valuation?.id,
      species,
      commonName: optionalText(body.commonName ?? existing?.commonName) || undefined,
      heightM: heightM == null ? undefined : Math.round(heightM * 10) / 10,
      diameterCm: diameterCm == null ? undefined : Math.round(diameterCm),
      condition,
      riskLevel,
      workRecommendation: optionalText(body.workRecommendation ?? existing?.workRecommendation),
      gpsLat: gpsLat == null ? undefined : Number(gpsLat),
      gpsLng: gpsLng == null ? undefined : Number(gpsLng),
      photos,
      notes: optionalText(body.notes ?? existing?.notes) || undefined,
      status,
      lastInspectionAt,
      createdAt: existing?.createdAt ?? now,
      createdBy: existing?.createdBy ?? user.id,
      updatedAt: now,
      updatedBy: user.id,
      deletedAt: status === 'archived' ? (existing?.deletedAt ?? now) : undefined,
      deletedBy: status === 'archived' ? (existing?.deletedBy ?? user.id) : undefined,
    },
    client,
    order,
    valuation,
  };
}

function visibleAiBotSessions(db, user) {
  const clientIds = new Set(visibleClients(db, user).map((client) => client.id));
  return (db.aiBotSessions ?? []).filter((session) => clientIds.has(session.clientId));
}

function visibleAiPrompts(db, user, options = {}) {
  return tenantRows(db, user, db.aiPrompts ?? []).filter((prompt) => (
    options.includeArchived || prompt.status !== 'archived'
  ));
}

function visibleAiPromptVersions(db, user) {
  return tenantRows(db, user, db.aiPromptVersions ?? []);
}

const aiPromptKinds = new Set(['office_call', 'estimator_call', 'field_meeting', 'complaint', 'follow_up', 'ai_receptionist']);
const aiPromptStatuses = new Set(['draft', 'active']);

function aiPromptPayload(db, user, body = {}, existing = null) {
  const name = optionalText(body.name ?? existing?.name);
  if (name.length < 3) return { error: 'Nazwa promptu musi mieć co najmniej 3 znaki', status: 400 };
  const kind = optionalText(body.kind ?? existing?.kind);
  if (!aiPromptKinds.has(kind)) return { error: 'Nieprawidłowy typ promptu AI', status: 400 };
  const status = optionalText(body.status ?? existing?.status ?? 'draft');
  if (!aiPromptStatuses.has(status)) return { error: 'Status promptu musi być draft albo active', status: 400 };
  const bodyText = optionalText(body.body ?? existing?.body);
  if (bodyText.length < 20) return { error: 'Prompt musi mieć co najmniej 20 znaków', status: 400 };
  const now = new Date().toISOString();
  return {
    prompt: {
      ...(existing ?? {}),
      id: existing?.id ?? `prompt-${crypto.randomUUID().slice(0, 8)}`,
      tenantId: tenantIdForUser(db, user),
      name,
      kind,
      version: Number(existing?.version ?? 0) || 1,
      status,
      body: bodyText,
      updatedAt: now,
      updatedBy: user.id,
    },
  };
}

function ensurePromptVersionHistory(db, user, prompt) {
  db.aiPromptVersions ??= [];
  const tenantId = tenantIdForUser(db, user);
  const rows = db.aiPromptVersions.filter((version) => rowTenantId(db, version) === tenantId && version.promptId === prompt.id);
  if (rows.length) return rows;
  const initial = {
    id: `${prompt.id}-v${prompt.version ?? 1}`,
    tenantId,
    promptId: prompt.id,
    version: Number(prompt.version ?? 1),
    status: 'active',
    body: prompt.body,
    changeNote: 'Historia utworzona automatycznie z aktywnego promptu',
    createdAt: prompt.updatedAt ?? new Date().toISOString(),
    createdBy: prompt.updatedBy ?? user.id,
  };
  db.aiPromptVersions.unshift(initial);
  return [initial];
}

function promptTestResult(prompt, sampleTranscript) {
  const text = String(sampleTranscript ?? '').trim();
  const lowerPrompt = String(prompt.body ?? '').toLowerCase();
  const required = ['score', 'summary', 'intent', 'strengths', 'improvements', 'risks', 'nextActions'];
  const presentFields = required.filter((field) => lowerPrompt.includes(field.toLowerCase()));
  const score = Math.min(100, 70 + (text.length % 23) + presentFields.length);
  return {
    id: `prompt-test-${crypto.randomUUID().slice(0, 8)}`,
    promptId: prompt.id,
    version: prompt.version,
    score,
    status: score >= 80 ? 'pass' : 'review',
    sampleChars: text.length,
    checks: [
      `Wymagane pola JSON: ${presentFields.length}/${required.length}`,
      text.length >= 40 ? 'Próbka rozmowy wystarczająca do testu' : 'Próbka rozmowy krótka - wymaga ręcznego przeglądu',
      lowerPrompt.includes('ryzyk') || lowerPrompt.includes('risks') ? 'Prompt sprawdza ryzyka' : 'Brak jawnej sekcji ryzyk',
    ],
    preview: {
      summary: text
        ? `Test promptu "${prompt.name}" na próbce ${text.length} znaków.`
        : `Test promptu "${prompt.name}" bez próbki rozmowy.`,
      nextActions: score >= 80 ? ['Można użyć jako aktywnej wersji'] : ['Przejrzeć prompt przed aktywacją'],
    },
  };
}

function visibleAiReceptionistSettings(db, user) {
  const settings = Array.isArray(db.aiReceptionistSettings)
    ? db.aiReceptionistSettings
    : db.aiReceptionistSettings
      ? [db.aiReceptionistSettings]
      : [];
  return tenantRows(db, user, settings);
}

function currentAiReceptionistSettings(db, user) {
  const tenantId = tenantIdForUser(db, user);
  const current = visibleAiReceptionistSettings(db, user)[0];
  if (current) return current;
  return {
    id: `ai-rec-${tenantId ?? 'default'}`,
    tenantId,
    enabled: true,
    mode: 'after_hours',
    businessHours: [],
    overflowAfterSec: 25,
    bookingWindowDays: 21,
    escalationRules: [],
    qualificationQuestions: [],
    language: 'pl',
    updatedAt: new Date().toISOString(),
    updatedBy: user.id,
  };
}

function replaceAiReceptionistSettings(db, user, nextSettings) {
  const settings = Array.isArray(db.aiReceptionistSettings)
    ? db.aiReceptionistSettings
    : db.aiReceptionistSettings
      ? [db.aiReceptionistSettings]
      : [];
  const tenantId = tenantIdForUser(db, user);
  const next = { ...nextSettings, tenantId };
  const index = settings.findIndex((item) => rowTenantId(db, item) === tenantId);
  if (index >= 0) settings[index] = next;
  else settings.unshift(next);
  db.aiReceptionistSettings = settings;
  return next;
}

function defaultIntegrationSettings(db, user) {
  const tenantId = tenantIdForUser(db, user);
  return {
    id: `int-${tenantId ?? 'default'}`,
    tenantId,
    zadarma: {
      enabled: true,
      autoCreateCommunication: true,
      autoAttachRecordings: true,
      autoAnalyzeRecordings: true,
      recordingRetentionDays: 90,
      requireRecordingConsent: true,
    },
    ai: {
      provider: 'openai',
      speechToText: 'deepgram',
      autoTranscribe: true,
      autoAnalyze: true,
      redactPii: true,
      humanApprovalRequiredBelowScore: 75,
    },
    messaging: {
      smsProvider: 'smsapi',
      emailProvider: 'aws_ses',
      sendBookingConfirmations: true,
      sendMissedCallFollowups: true,
    },
    maps: {
      provider: 'google_maps',
      routeOptimization: true,
    },
    monitoring: {
      sentryEnabled: true,
      auditRetentionDays: 365,
    },
    updatedAt: new Date().toISOString(),
    updatedBy: user.id,
  };
}

function visibleIntegrationSettings(db, user) {
  return tenantRows(db, user, db.integrationSettings ?? []);
}

function currentIntegrationSettings(db, user) {
  return visibleIntegrationSettings(db, user)[0] ?? defaultIntegrationSettings(db, user);
}

function replaceIntegrationSettings(db, user, nextSettings) {
  db.integrationSettings ??= [];
  const tenantId = tenantIdForUser(db, user);
  const next = { ...nextSettings, tenantId };
  const index = db.integrationSettings.findIndex((item) => rowTenantId(db, item) === tenantId);
  if (index >= 0) db.integrationSettings[index] = next;
  else db.integrationSettings.unshift(next);
  return next;
}

function visibleWorkflows(db, user, options = {}) {
  return tenantRows(db, user, db.workflows ?? []).filter((workflow) => (
    options.includeArchived || (!workflow.deletedAt && workflow.status !== 'archived')
  ));
}

function visibleWorkflowRuns(db, user) {
  return tenantRows(db, user, db.workflowRuns ?? []);
}

function visibleTasks(db, user) {
  const rows = tenantRows(db, user, db.tasks ?? []).filter((task) => !task.deletedAt);
  const branchIds = scopedBranchIds(db, user);
  if (elevatedBranchRole(user)) {
    return rows.filter((task) => branchIds.has(task.branchId ?? user.branchId));
  }
  const visibleOrderIds = new Set(visibleOrders(db, user).map((order) => order.id));
  if (['BRYGADZISTA', 'PRACOWNIK'].includes(user.role)) {
    return rows.filter((task) => (
      task.assignedUserId === user.id
      || (task.teamId && task.teamId === user.teamId)
      || (task.orderId && visibleOrderIds.has(task.orderId))
    ));
  }
  return rows.filter((task) => (
    task.assignedUserId === user.id
    || branchIds.has(task.branchId)
    || (task.orderId && visibleOrderIds.has(task.orderId))
  ));
}

function visibleSoftphonePresence(db, user) {
  return tenantRows(db, user, db.softphonePresence ?? []);
}

function visibleModuleConfigs(db, user) {
  return tenantRows(db, user, db.moduleConfigs ?? []).filter((config) => config.status !== 'archived');
}

function visibleDocumentRequirements(db, user) {
  return tenantRows(db, user, db.documentRequirements ?? []).filter((requirement) => requirement.status !== 'archived');
}

function visibleDocumentTemplates(db, user) {
  const tenantId = tenantIdForUser(db, user);
  return (db.documentTemplates ?? []).filter((template) => !template.tenantId || rowTenantId(db, template) === tenantId);
}

function visibleEmployeeContracts(db, user) {
  const branchIds = scopedBranchIds(db, user);
  return (db.employeeContracts ?? []).filter((contract) => (
    !contract.deletedAt
    && contract.status !== 'archived'
    && branchIds.has(contract.branchId)
  ));
}

function visibleEmployeeIds(db, user) {
  return new Set(visibleUsers(db, user).map((next) => next.id));
}

function visibleTrainings(db, user) {
  const employeeIds = visibleEmployeeIds(db, user);
  return (db.trainings ?? []).filter((item) => !item.deletedAt && item.status !== 'archived' && employeeIds.has(item.employeeId));
}

function visibleMedicalExams(db, user) {
  const employeeIds = visibleEmployeeIds(db, user);
  return (db.medicalExams ?? []).filter((item) => !item.deletedAt && item.status !== 'archived' && employeeIds.has(item.employeeId));
}

function visibleCertifications(db, user) {
  const employeeIds = visibleEmployeeIds(db, user);
  return (db.certifications ?? []).filter((item) => !item.deletedAt && item.status !== 'archived' && employeeIds.has(item.employeeId));
}

function visibleJobPositions(db, user, options = {}) {
  const contracts = visibleEmployeeContracts(db, user);
  const positionIds = new Set(contracts.map((contract) => contract.positionId));
  return (db.jobPositions ?? []).filter((position) => {
    const inScope = !position.tenantId || rowTenantId(db, position) === tenantIdForUser(db, user) || positionIds.has(position.id);
    if (!inScope) return false;
    const archived = Boolean(position.deletedAt) || position.status === 'archived';
    return !archived || (options.includeArchivedReferenced && positionIds.has(position.id));
  });
}

function generatedDocumentVisible(db, user, document) {
  if (document.tenantId && document.tenantId !== tenantIdForUser(db, user)) return false;
  if (document.subjectType === 'client') return visibleClients(db, user).some((client) => client.id === document.subjectId);
  if (document.subjectType === 'order') return visibleOrders(db, user).some((order) => order.id === document.subjectId);
  if (document.subjectType === 'employee') {
    return visibleUsers(db, user).some((next) => next.id === document.subjectId)
      || visibleEmployeeContracts(db, user).some((contract) => contract.id === document.subjectId || contract.employeeId === document.subjectId);
  }
  if (document.subjectType === 'equipment') return visibleEquipment(db, user).some((item) => item.id === document.subjectId);
  if (document.subjectType === 'company') return Boolean(currentTenant(db, user));
  return false;
}

function visibleGeneratedDocuments(db, user) {
  return (db.generatedDocuments ?? []).filter((document) => generatedDocumentVisible(db, user, document));
}

function dateDiffDays(dateValue, now = new Date()) {
  const date = new Date(String(dateValue ?? ''));
  if (!Number.isFinite(date.getTime())) return null;
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const end = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return Math.ceil((end - start) / (24 * 60 * 60 * 1000));
}

function complianceStatus(daysLeft, warningDays = 30) {
  if (daysLeft == null) return 'missing';
  if (daysLeft < 0) return 'expired';
  if (daysLeft <= Number(warningDays ?? 30)) return 'due_soon';
  return 'valid';
}

function visibleNotifications(db, user) {
  const tenantId = tenantIdForUser(db, user);
  return (db.notifications ?? []).filter((notification) => (
    (notification.role === 'ALL' || notification.role === user.role)
    && rowTenantId(db, notification) === tenantId
  ));
}

function visibleAuditEvents(db, user) {
  return tenantRows(db, user, db.auditEvents ?? []);
}

function visibleOutbox(db, user) {
  return tenantRows(db, user, db.outbox ?? []);
}

function branchName(db, branchId) {
  const branch = db.branches.find((item) => item.id === branchId);
  return branch ? `${branch.name}, ${branch.city}` : '';
}

function normalizePhone(value) {
  return String(value ?? '').replace(/[^\d+]/g, '');
}

function branchForWrite(db, user, requestedBranchId) {
  const branchId = elevatedBranchRole(user)
    ? requestedBranchId ?? user.branchId
    : requestedBranchId ?? user.branchId;
  const branch = db.branches.find((next) => next.id === branchId);
  if (!branch) return { error: 'Nie znaleziono oddziału', status: 400 };
  if (!sameTenantBranch(db, user, branchId)) return { error: 'Oddział poza tenantem użytkownika', status: 403 };
  if (!branchIsActive(branch)) return { error: 'Oddział jest zarchiwizowany', status: 409 };
  if (!elevatedBranchRole(user) && !canAccessBranch(db, user, branchId)) {
    return { error: 'Oddział poza zakresem roli', status: 403 };
  }
  return { branchId };
}

function moduleConfiguredStatuses(db, user, module, fallback = []) {
  const statuses = new Set([...fallback].map((status) => optionalText(status)).filter(Boolean));
  visibleModuleConfigs(db, user)
    .filter((config) => config.module === module && config.enabled !== false)
    .forEach((config) => {
      (config.statuses ?? []).forEach((status) => {
        const normalized = optionalText(status);
        if (normalized) statuses.add(normalized);
      });
    });
  return statuses;
}

function clientPayload(db, user, body, existing) {
  const branch = branchForWrite(db, user, body.branchId ?? existing?.branchId);
  if (branch.error) return branch;
  const name = String(body.name ?? existing?.name ?? '').trim();
  const phone = String(body.phone ?? existing?.phone ?? '').trim();
  const email = String(body.email ?? existing?.email ?? '').trim();
  const address = String(body.address ?? existing?.address ?? '').trim();
  if (!name) return { error: 'Nazwa klienta jest wymagana', status: 400 };
  if (!phone) return { error: 'Telefon klienta jest wymagany', status: 400 };
  if (!address) return { error: 'Adres klienta jest wymagany', status: 400 };
  const duplicate = db.clients.find((client) => (
    client.id !== existing?.id
    && client.branchId === branch.branchId
    && String(client.phone ?? '').replace(/\s+/g, '') === phone.replace(/\s+/g, '')
  ));
  if (duplicate) return { error: 'Klient z tym telefonem już istnieje', status: 409, duplicateId: duplicate.id };
  const tags = Array.isArray(body.tags ?? existing?.tags)
    ? (body.tags ?? existing?.tags).map((tag) => String(tag).trim()).filter(Boolean)
    : [];
  const customFields = body.customFields && typeof body.customFields === 'object'
    ? body.customFields
    : existing?.customFields ?? {};
  const ltv = Number(body.ltv ?? existing?.ltv ?? 0);
  const pipelineStage = optionalText(body.pipelineStage ?? existing?.pipelineStage ?? 'lead');
  if (!moduleConfiguredStatuses(db, user, 'crm', clientPipelineStages).has(pipelineStage)) return { error: 'Nieprawidłowy etap lejka klienta', status: 400 };
  return {
    branchId: branch.branchId,
    name,
    phone,
    email,
    address,
    ltv: Number.isFinite(ltv) && ltv >= 0 ? Math.round(ltv) : 0,
    tags,
    customFields,
    pipelineStage,
  };
}

function orderPayload(db, user, body = {}, existing = null) {
  const clientId = body.clientId ?? existing?.clientId;
  const client = db.clients.find((next) => next.id === clientId);
  if (!client) return { error: 'Nie znaleziono klienta', status: 400 };
  if (!visibleClients(db, user).some((next) => next.id === client.id)) return { error: 'Klient poza zakresem roli lub tenantem', status: 403 };
  const orderBranch = branchForWrite(db, user, body.branchId ?? existing?.branchId ?? client.branchId ?? user.branchId);
  if (orderBranch.error) return orderBranch;
  const teamId = Object.hasOwn(body, 'teamId') ? body.teamId : existing?.teamId;
  if (teamId) {
    const crew = visibleCrews(db, user).find((next) => next.id === teamId);
    if (!crew) return { error: 'Ekipa poza zakresem roli lub tenantem', status: 403 };
    if (crew.branchId !== orderBranch.branchId) return { error: 'Ekipa jest w innym oddziale niż zlecenie', status: 409 };
  }
  const estimatorId = Object.hasOwn(body, 'estimatorId') ? body.estimatorId : existing?.estimatorId;
  if (estimatorId) {
    const estimator = visibleUsers(db, user).find((next) => next.id === estimatorId);
    if (!estimator || !sameTenantBranch(db, user, estimator.branchId)) return { error: 'Wyceniający poza tenantem', status: 403 };
  }
  const status = optionalText(body.status ?? existing?.status ?? 'NOWE');
  if (!orderStatuses.has(status)) return { error: 'Nieprawidłowy status zlecenia', status: 400 };
  const priority = optionalText(body.priority ?? existing?.priority ?? 'normalny');
  if (!orderPriorities.has(priority)) return { error: 'Nieprawidłowy priorytet zlecenia', status: 400 };
  const scheduledAt = (parseOptionalDate(body.scheduledAt ?? body.inspectionAt ?? existing?.scheduledAt) ?? new Date()).toISOString();
  const inspectionAtInput = body.inspectionAt ?? existing?.inspectionAt;
  const inspectionAt = inspectionAtInput ? parseOptionalDate(inspectionAtInput)?.toISOString() : undefined;
  if (inspectionAtInput && !inspectionAt) return { error: 'Nieprawidłowy termin oględzin', status: 400 };
  const value = Number(body.value ?? existing?.value ?? 0);
  const margin = Number(body.margin ?? existing?.margin ?? 30);
  if (!Number.isFinite(value) || value < 0) return { error: 'Wartość zlecenia jest nieprawidłowa', status: 400 };
  if (!Number.isFinite(margin) || margin < 0) return { error: 'Marża zlecenia jest nieprawidłowa', status: 400 };
  const now = new Date().toISOString();
  return {
    branchId: orderBranch.branchId,
    clientId: client.id,
    teamId: teamId || undefined,
    estimatorId: estimatorId || undefined,
    address: optionalText(body.address ?? existing?.address ?? client.address.split(',')[0]),
    city: optionalText(body.city ?? existing?.city ?? client.address.split(',').at(-1)) || '',
    type: optionalText(body.type ?? existing?.type ?? 'Nowe zapytanie'),
    status,
    priority,
    scheduledAt,
    inspectionAt,
    value: Math.round(value),
    margin: Math.round(margin),
    timeline: Array.isArray(body.timeline)
      ? body.timeline
      : (existing?.timeline ?? [{ label: body.source === 'zadarma' ? 'Telefon i kwalifikacja' : 'Nowe zapytanie', at: now, by: actorName(user) }]),
    checklist: Array.isArray(body.checklist)
      ? body.checklist
      : (existing?.checklist ?? [{ label: 'BHP przed pracą', done: false }, { label: 'Zdjęcia przed', done: false }, { label: 'Podpis klienta', done: false }]),
  };
}

function taskPayload(db, user, body, existing) {
  const branch = branchForWrite(db, user, body.branchId ?? existing?.branchId ?? user.branchId);
  if (branch.error) return branch;
  const title = String(body.title ?? existing?.title ?? '').trim();
  if (!title) return { error: 'Tytul zadania jest wymagany', status: 400 };
  const status = String(body.status ?? existing?.status ?? 'open');
  if (!taskStatuses.has(status)) return { error: 'Nieprawidłowy status zadania', status: 400 };
  const priority = String(body.priority ?? existing?.priority ?? 'normal');
  if (!taskPriorities.has(priority)) return { error: 'Nieprawidłowy priorytet zadania', status: 400 };
  const source = String(body.source ?? existing?.source ?? 'manual');
  if (!taskSources.has(source)) return { error: 'Nieprawidłowe źródło zadania', status: 400 };

  const clientId = body.clientId ?? existing?.clientId;
  if (clientId && !visibleClients(db, user).some((client) => client.id === clientId)) {
    return { error: 'Klient poza zakresem roli lub tenantem', status: 403 };
  }
  const orderId = body.orderId ?? existing?.orderId;
  const order = orderId ? visibleOrders(db, user).find((next) => next.id === orderId) : null;
  if (orderId && !order) return { error: 'Zlecenie poza zakresem roli lub tenantem', status: 403 };

  const assignedUserId = body.assignedUserId ?? existing?.assignedUserId;
  if (assignedUserId) {
    const assignee = visibleUsers(db, user).find((next) => next.id === assignedUserId);
    if (!assignee || !sameTenantBranch(db, user, assignee.branchId)) return { error: 'Użytkownik poza tenantem', status: 403 };
  }

  return {
    tenantId: tenantIdForUser(db, user),
    title,
    status,
    priority,
    source,
    sourceId: body.sourceId ?? existing?.sourceId,
    workflowId: body.workflowId ?? existing?.workflowId,
    workflowRunId: body.workflowRunId ?? existing?.workflowRunId,
    clientId,
    orderId,
    branchId: order?.branchId ?? branch.branchId,
    assignedUserId,
    teamId: body.teamId ?? existing?.teamId ?? order?.teamId,
    dueAt: body.dueAt ?? existing?.dueAt,
    notes: body.notes ?? existing?.notes,
  };
}

function createOperationalTask(db, user, options) {
  db.tasks ??= [];
  const branchId = options.branchId && sameTenantBranch(db, user, options.branchId) ? options.branchId : user.branchId;
  const now = options.createdAt ?? new Date().toISOString();
  const priority = taskPriorities.has(options.priority) ? options.priority : 'normal';
  const source = taskSources.has(options.source) ? options.source : 'system';
  const task = {
    id: options.id ?? nextSequenceId('task', db.tasks),
    tenantId: tenantIdForUser(db, user),
    title: String(options.title ?? 'Zadanie operacyjne').trim(),
    status: options.status && taskStatuses.has(options.status) ? options.status : 'open',
    priority,
    source,
    sourceId: options.sourceId,
    workflowId: options.workflowId,
    workflowRunId: options.workflowRunId,
    clientId: options.clientId,
    orderId: options.orderId,
    branchId,
    assignedUserId: options.assignedUserId ?? workflowTaskAssignee(db, user, options, branchId),
    teamId: options.teamId,
    dueAt: options.dueAt,
    notes: options.notes,
    createdAt: now,
    createdBy: options.createdBy ?? user.id,
  };
  db.tasks.unshift(task);
  return task;
}

function messageProviderForType(settings, type) {
  if (type === 'sms') return settings.messaging.smsProvider === 'smsapi' ? 'smsapi' : 'manual';
  if (type === 'email') return settings.messaging.emailProvider === 'aws_ses' ? 'aws_ses' : 'manual';
  return 'system';
}

function messageDeliveryStatus(provider) {
  return provider === 'manual' ? 'manual' : 'queued';
}

function createOutgoingCommunication(db, user, options) {
  const type = options.type === 'email' ? 'email' : 'sms';
  const client = options.client
    ?? (options.clientId ? visibleClients(db, user).find((next) => next.id === options.clientId) : null);
  if (!client) return { skipped: 'client_not_found' };
  const order = options.order
    ?? (options.orderId ? visibleOrders(db, user).find((next) => next.id === options.orderId) : null);
  const settings = options.integrationSettings ?? currentIntegrationSettings(db, user);
  const provider = options.provider ?? messageProviderForType(settings, type);
  const now = options.createdAt ?? new Date().toISOString();
  const body = String(options.body ?? '').trim();
  if (!body) return { skipped: 'empty_message' };
  const communication = {
    id: `com-${crypto.randomUUID().slice(0, 8)}`,
    type,
    clientId: client.id,
    orderId: order?.id ?? options.orderId,
    userId: options.userId ?? user.id,
    direction: 'outbound',
    channel: type,
    status: 'completed',
    subject: options.subject ?? (type === 'sms' ? 'SMS do klienta' : 'E-mail do klienta'),
    startedAt: now,
    durationSec: 0,
    aiHandled: Boolean(options.aiHandled),
    messageBody: body,
    deliveryStatus: options.deliveryStatus ?? messageDeliveryStatus(provider),
    deliveryProvider: provider,
    relatedCommunicationId: options.relatedCommunicationId,
    transcript: [{ speaker: type === 'sms' ? 'SMS' : 'E-mail', text: body, atSec: 0 }],
    analysis: {
      score: 100,
      summary: `${type === 'sms' ? 'SMS' : 'E-mail'} zapisany w CRM jako komunikacja wychodząca.`,
      intent: options.intent ?? (type === 'sms' ? 'Potwierdzenie SMS' : 'Potwierdzenie e-mail'),
      strengths: ['Komunikacja zapisana w karcie klienta'],
      improvements: [],
      nextActions: options.nextActions ?? [],
      risks: [],
    },
  };
  db.communications ??= [];
  db.communications.unshift(communication);
  if (order) {
    order.timeline.push({
      label: `${type === 'sms' ? 'SMS' : 'E-mail'} do klienta: ${communication.subject}`,
      at: now,
      by: options.actorLabel ?? actorName(user),
    });
  }
  pushEvent(db, user, `branch:${client.branchId ?? user.branchId}:communications`, `${type}.queued`, {
    id: communication.id,
    clientId: client.id,
    orderId: communication.orderId,
    provider: communication.deliveryProvider,
    deliveryStatus: communication.deliveryStatus,
    subject: communication.subject,
    source: options.source,
  });
  return { communication };
}

function communicationPayload(db, user, body = {}, existing = null) {
  const clientId = body.clientId ?? existing?.clientId;
  const client = visibleClients(db, user).find((next) => next.id === clientId);
  if (!client) return { error: 'Klient poza zakresem roli lub tenantem', status: 404 };
  const orderId = Object.hasOwn(body, 'orderId') ? body.orderId : existing?.orderId;
  const order = orderId ? visibleOrders(db, user).find((next) => next.id === orderId) : null;
  if (orderId && !order) return { error: 'Zlecenie poza zakresem roli lub tenantem', status: 404 };
  if (order && order.clientId !== client.id) return { error: 'Zlecenie nie nalezy do wskazanego klienta', status: 409 };
  const type = optionalText(body.type ?? existing?.type ?? 'note');
  if (!['call', 'meeting', 'sms', 'email', 'note'].includes(type)) return { error: 'Nieprawidłowy typ komunikacji', status: 400 };
  const channel = optionalText(body.channel ?? existing?.channel ?? (type === 'sms' || type === 'email' ? type : 'manual'));
  if (!['web_softphone', 'zadarma', 'ai_receptionist', 'mobile_meeting', 'manual', 'sms', 'email'].includes(channel)) return { error: 'Nieprawidłowy kanał komunikacji', status: 400 };
  const direction = optionalText(body.direction ?? existing?.direction ?? (['sms', 'email'].includes(type) ? 'outbound' : 'internal'));
  if (!['inbound', 'outbound', 'internal'].includes(direction)) return { error: 'Nieprawidłowy kierunek komunikacji', status: 400 };
  const status = optionalText(body.status ?? existing?.status ?? 'completed');
  if (!communicationStatuses.has(status)) return { error: 'Nieprawidłowy status komunikacji', status: 400 };
  const subject = optionalText(body.subject ?? existing?.subject);
  if (!subject) return { error: 'Temat komunikacji jest wymagany', status: 400 };
  const startedAt = (parseOptionalDate(body.startedAt ?? existing?.startedAt) ?? new Date()).toISOString();
  const durationSec = Number(body.durationSec ?? existing?.durationSec ?? 0);
  if (!Number.isFinite(durationSec) || durationSec < 0) return { error: 'Czas komunikacji jest nieprawidłowy', status: 400 };
  const userId = optionalText(body.userId ?? existing?.userId ?? user.id);
  const owner = userId ? visibleUsers(db, user).find((next) => next.id === userId) : null;
  if (userId && !owner) return { error: 'Użytkownik komunikacji poza tenantem', status: 403 };
  const assignedUserId = optionalText(body.assignedUserId ?? existing?.assignedUserId);
  if (assignedUserId) {
    const assignee = visibleUsers(db, user).find((next) => next.id === assignedUserId);
    if (!assignee || !canRole(db, user, assignee.role, 'communications', 'write')) return { error: 'Przypisany agent poza tenantem lub bez uprawnień', status: 403 };
  }
  const transcript = Object.hasOwn(body, 'transcript')
    ? normalizeTranscriptLines(body.transcript)
    : normalizeTranscriptLines(existing?.transcript ?? body.messageBody ?? body.notes ?? body.subject);
  const recordingSourceResult = communicationRecordingSource(body.recordingSource ?? existing?.recordingSource, { channel });
  if (recordingSourceResult.error) return { ...recordingSourceResult, status: 400 };
  const recordingUrl = optionalText(body.recordingUrl ?? existing?.recordingUrl);
  const recordingId = optionalText(body.recordingId ?? existing?.recordingId);
  const recordingStatusResult = communicationRecordingStatus(body.recordingStatus ?? existing?.recordingStatus, recordingUrl || recordingId);
  if (recordingStatusResult.error) return { ...recordingStatusResult, status: 400 };
  const transcriptStatusResult = communicationTranscriptStatus(body.transcriptStatus ?? existing?.transcriptStatus, transcript.length);
  if (transcriptStatusResult.error) return { ...transcriptStatusResult, status: 400 };
  const hasAnalysisInput = Object.hasOwn(body, 'analysis');
  const providedAnalysis = normalizeProvidedAnalysis(body.analysis, subject);
  const analysis = providedAnalysis ?? existing?.analysis ?? demoCallAnalysis(transcript.length ? transcript : [{ speaker: 'CRM', text: subject, atSec: 0 }], subject);
  const requestedAnalysisStatus = Object.hasOwn(body, 'analysisStatus') ? optionalText(body.analysisStatus) : '';
  const existingAnalysisStatus = optionalText(existing?.analysisStatus);
  const now = new Date().toISOString();
  return {
    ...(existing ?? {}),
    type,
    clientId: client.id,
    orderId: order?.id,
    userId: owner?.id,
    direction,
    channel,
    status,
    subject,
    startedAt,
    durationSec: Math.round(durationSec),
    aiHandled: Boolean(body.aiHandled ?? existing?.aiHandled),
    queueStatus: body.queueStatus ?? existing?.queueStatus,
    assignedUserId: assignedUserId || undefined,
    assignedAt: assignedUserId ? (existing?.assignedAt ?? now) : undefined,
    overflowAt: body.overflowAt ?? existing?.overflowAt,
    overflowReason: optionalText(body.overflowReason ?? existing?.overflowReason) || undefined,
    routingLog: Array.isArray(body.routingLog ?? existing?.routingLog) ? (body.routingLog ?? existing.routingLog).map((item) => optionalText(item)).filter(Boolean) : undefined,
    analysisPromptId: optionalText(body.analysisPromptId ?? existing?.analysisPromptId) || undefined,
    analysisPromptVersion: Number.isFinite(Number(body.analysisPromptVersion ?? existing?.analysisPromptVersion)) ? Number(body.analysisPromptVersion ?? existing?.analysisPromptVersion) : undefined,
    analysisModel: optionalText(body.analysisModel ?? existing?.analysisModel) || undefined,
    analysisUpdatedAt: providedAnalysis ? now : existing?.analysisUpdatedAt,
    analysisStatus: ['ready', 'review'].includes(requestedAnalysisStatus)
      ? requestedAnalysisStatus
      : hasAnalysisInput
        ? (analysis.score >= 80 ? 'ready' : 'review')
        : ['ready', 'review'].includes(existingAnalysisStatus)
          ? existingAnalysisStatus
          : (analysis.score >= 80 ? 'ready' : 'review'),
    coachingTags: Array.isArray(body.coachingTags ?? existing?.coachingTags) ? (body.coachingTags ?? existing.coachingTags).map((item) => optionalText(item)).filter(Boolean) : [],
    messageBody: optionalText(body.messageBody ?? existing?.messageBody) || undefined,
    deliveryStatus: ['queued', 'sent', 'failed', 'manual'].includes(optionalText(body.deliveryStatus ?? existing?.deliveryStatus)) ? optionalText(body.deliveryStatus ?? existing?.deliveryStatus) : existing?.deliveryStatus,
    deliveryProvider: ['smsapi', 'aws_ses', 'manual', 'system'].includes(optionalText(body.deliveryProvider ?? existing?.deliveryProvider)) ? optionalText(body.deliveryProvider ?? existing?.deliveryProvider) : existing?.deliveryProvider,
    relatedCommunicationId: optionalText(body.relatedCommunicationId ?? existing?.relatedCommunicationId) || undefined,
    workflowId: optionalText(body.workflowId ?? existing?.workflowId) || undefined,
    workflowRunId: optionalText(body.workflowRunId ?? existing?.workflowRunId) || undefined,
    recordingUrl: recordingUrl || undefined,
    recordingId: recordingId || undefined,
    recordingSource: recordingSourceResult.source,
    recordingStatus: recordingStatusResult.status,
    recordingReceivedAt: body.recordingReceivedAt ?? existing?.recordingReceivedAt,
    recordingConsent: body.recordingConsent == null ? existing?.recordingConsent : Boolean(body.recordingConsent),
    transcriptStatus: transcriptStatusResult.status,
    transcript,
    analysis,
    createdAt: existing?.createdAt ?? now,
    createdBy: existing?.createdBy ?? user.id,
    updatedAt: now,
    updatedBy: user.id,
  };
}

function emitTaskCreated(db, user, task) {
  pushEvent(db, user, workflowEventChannel(db, user, task), 'task.created', {
    id: task.id,
    title: task.title,
    status: task.status,
    priority: task.priority,
    source: task.source,
    clientId: task.clientId,
    orderId: task.orderId,
    branchId: task.branchId,
    assignedUserId: task.assignedUserId,
  });
}

function clientTimeline(db, user, client) {
  const tenantId = tenantIdForUser(db, user);
  const orders = visibleOrders(db, user).filter((order) => order.clientId === client.id);
  const orderIds = new Set(orders.map((order) => order.id));
  const events = [];
  const push = (event) => {
    if (!event?.at) return;
    events.push({ tenantId, clientId: client.id, ...event });
  };

  push({
    id: `client-${client.id}`,
    type: 'client',
    title: `Klient 360: ${client.name}`,
    at: new Date(0).toISOString(),
    status: client.tags?.[0] ?? 'aktywny',
    summary: client.address,
    sourceId: client.id,
    metadata: { phone: client.phone, email: client.email, ltv: client.ltv },
  });

  orders.forEach((order) => {
    push({
      id: `order-${order.id}`,
      type: 'order',
      title: `Zlecenie ${order.id}: ${order.type}`,
      at: order.scheduledAt,
      status: order.status,
      summary: `${order.address}, ${order.city}`,
      sourceId: order.id,
      orderId: order.id,
      metadata: { priority: order.priority, value: order.value, margin: order.margin },
    });
    (order.timeline ?? []).forEach((item, index) => push({
      id: `order-${order.id}-timeline-${index}`,
      type: 'order',
      title: item.label,
      at: item.at,
      actor: item.by,
      sourceId: order.id,
      orderId: order.id,
      status: order.status,
    }));
  });

  visibleValuations(db, user)
    .filter((valuation) => valuation.clientId === client.id || orderIds.has(valuation.orderId))
    .forEach((valuation) => push({
      id: `valuation-${valuation.id}`,
      type: 'valuation',
      title: `Wycena ${valuation.id}`,
      at: valuation.inspectionAt,
      status: valuation.status,
      summary: valuation.notes,
      sourceId: valuation.id,
      orderId: valuation.orderId,
      metadata: { totalNet: valuation.totalNet, margin: valuation.margin },
    }));

  if (canTreeAssets(db, user)) {
    visibleTreeAssets(db, user)
      .filter((tree) => tree.clientId === client.id || (tree.orderId && orderIds.has(tree.orderId)))
      .forEach((tree) => push({
        id: `tree-${tree.id}`,
        type: 'tree',
        title: `Drzewo: ${tree.commonName || tree.species}`,
        at: tree.lastInspectionAt ?? tree.updatedAt ?? tree.createdAt,
        actor: tree.updatedBy ?? tree.createdBy,
        status: `${tree.condition}/${tree.riskLevel}`,
        summary: tree.workRecommendation || tree.notes,
        sourceId: tree.id,
        orderId: tree.orderId,
        metadata: {
          species: tree.species,
          heightM: tree.heightM,
          diameterCm: tree.diameterCm,
          gpsLat: tree.gpsLat,
          gpsLng: tree.gpsLng,
          valuationId: tree.valuationId,
          photos: tree.photos?.length ?? 0,
        },
      }));
  }

  if (canUser(db, user, 'communications')) {
    visibleCommunications(db, user)
      .filter((communication) => communication.clientId === client.id || (communication.orderId && orderIds.has(communication.orderId)))
      .forEach((communication) => push({
        id: `communication-${communication.id}`,
        type: communication.aiHandled ? 'ai' : 'communication',
        title: communication.subject,
        at: communication.startedAt,
        actor: communication.userId,
        status: communication.status,
        summary: communication.analysis?.summary,
        score: communication.analysis?.score,
        sourceId: communication.id,
        communicationId: communication.id,
        orderId: communication.orderId,
        metadata: {
          channel: communication.channel,
          direction: communication.direction,
          durationSec: communication.durationSec,
          recording: Boolean(communication.recordingUrl),
          recordingStatus: communication.recordingStatus,
          recordingSource: communication.recordingSource,
          transcriptStatus: communication.transcriptStatus,
        },
      }));

    visibleAiBotSessions(db, user)
      .filter((session) => session.clientId === client.id)
      .forEach((session) => push({
        id: `ai-session-${session.id}`,
        type: 'ai',
        title: `AI recepcjonista: ${session.mode}`,
        at: session.startedAt,
        status: session.status,
        summary: session.outcome,
        sourceId: session.id,
        orderId: session.orderId,
        metadata: {
          bookingStatus: session.bookingStatus,
          escalationRequired: Boolean(session.escalationRequired),
        },
      }));
  }

  if (canUser(db, user, 'documents')) {
    visibleGeneratedDocuments(db, user)
      .filter((document) => document.subjectType === 'client'
        ? document.subjectId === client.id
        : document.subjectType === 'order' && orderIds.has(document.subjectId))
      .forEach((document) => {
        push({
          id: `document-${document.id}`,
          type: 'document',
          title: document.summary,
          at: document.createdAt,
          actor: document.createdBy,
          status: document.status,
          sourceId: document.id,
          documentId: document.id,
          orderId: document.subjectType === 'order' ? document.subjectId : undefined,
          metadata: {
            templateId: document.templateId,
            fileName: document.fileName,
            signedAt: document.signedAt,
            signedBy: document.signedBy,
            signerName: document.signerName,
            signatureMethod: document.signatureMethod,
          },
        });
        if (document.signedAt) {
          push({
            id: `document-${document.id}-signed`,
            type: 'document',
            title: `Podpisano: ${document.summary}`,
            at: document.signedAt,
            actor: document.signedBy,
            status: 'signed',
            sourceId: document.id,
            documentId: document.id,
            orderId: document.subjectType === 'order' ? document.subjectId : undefined,
            metadata: {
              templateId: document.templateId,
              fileName: document.fileName,
              signerName: document.signerName,
              signatureMethod: document.signatureMethod,
              signatureHash: document.signatureHash,
            },
          });
        }
      });
  }

  visibleTasks(db, user)
    .filter((task) => task.clientId === client.id || (task.orderId && orderIds.has(task.orderId)))
    .forEach((task) => push({
      id: `task-${task.id}`,
      type: 'task',
      title: task.title,
      at: task.createdAt,
      actor: task.createdBy,
      status: task.status,
      summary: task.notes,
      sourceId: task.sourceId ?? task.id,
      taskId: task.id,
      orderId: task.orderId,
      metadata: {
        priority: task.priority,
        source: task.source,
        assignedUserId: task.assignedUserId,
        dueAt: task.dueAt,
      },
    }));

  if (canUser(db, user, 'invoices')) {
    visibleInvoices(db, user)
      .filter((invoice) => invoice.clientId === client.id || orderIds.has(invoice.orderId))
      .forEach((invoice) => push({
        id: `invoice-${invoice.id}`,
        type: 'invoice',
        title: `Faktura ${invoice.number}`,
        at: invoice.dueAt,
        status: invoice.status,
        sourceId: invoice.id,
        orderId: invoice.orderId,
        metadata: { net: invoice.net },
      }));
  }

  return events.sort((left, right) => new Date(right.at).getTime() - new Date(left.at).getTime());
}

function csvCell(value) {
  const text = value == null ? '' : String(value);
  return /[",\n\r;]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function clientsToCsv(clients) {
  const columns = ['id', 'branchId', 'name', 'phone', 'email', 'address', 'ltv', 'pipelineStage', 'tags', 'customFields'];
  const rows = clients.map((client) => [
    client.id,
    client.branchId,
    client.name,
    client.phone,
    client.email,
    client.address,
    client.ltv,
    client.pipelineStage ?? 'lead',
    (client.tags ?? []).join('|'),
    JSON.stringify(client.customFields ?? {}),
  ]);
  return [columns, ...rows].map((row) => row.map(csvCell).join(',')).join('\n');
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (quoted) {
      if (char === '"' && next === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (char !== '\r') {
      cell += char;
    }
  }
  row.push(cell);
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}

function clientsFromCsv(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const headers = rows[0].map((header) => header.trim());
  return rows.slice(1).filter((row) => row.some((cell) => cell.trim())).map((row) => {
    const record = Object.fromEntries(headers.map((header, index) => [header, row[index] ?? '']));
    return {
      id: record.id || undefined,
      branchId: record.branchId || undefined,
      name: record.name,
      phone: record.phone,
      email: record.email,
      address: record.address,
      ltv: record.ltv ? Number(record.ltv) : undefined,
      pipelineStage: record.pipelineStage || undefined,
      tags: record.tags ? record.tags.split('|').map((tag) => tag.trim()).filter(Boolean) : [],
      customFields: record.customFields ? JSON.parse(record.customFields) : {},
    };
  });
}

function visibleCrews(db, user) {
  const branchIds = scopedBranchIds(db, user);
  const rows = (db.crews ?? []).filter((crew) => !crew.deletedAt && crew.status !== 'archived');
  if (elevatedBranchRole(user)) return rows.filter((crew) => branchIds.has(crew.branchId));
  return rows.filter((crew) => branchIds.has(crew.branchId) || crew.id === user.teamId);
}

function crewPayload(db, user, body = {}, existing = null) {
  const branch = branchForWrite(db, user, body.branchId ?? existing?.branchId);
  if (branch.error) return branch;
  const name = optionalText(body.name ?? existing?.name);
  if (!name) return { error: 'Nazwa ekipy jest wymagana', status: 400 };
  const duplicate = (db.crews ?? []).find((crew) => (
    crew.id !== existing?.id
    && !crew.deletedAt
    && crew.status !== 'archived'
    && crew.branchId === branch.branchId
    && String(crew.name).trim().toLowerCase() === name.toLowerCase()
  ));
  if (duplicate) return { error: 'Ekipa o tej nazwie już istnieje w oddziale', status: 409, duplicateId: duplicate.id };
  const leaderId = optionalText(body.leaderId ?? existing?.leaderId);
  const leader = leaderId ? db.users.find((next) => next.id === leaderId) : null;
  if (!leader) return { error: 'Lider ekipy jest wymagany', status: 400 };
  if (!sameTenantBranch(db, user, leader.branchId)) return { error: 'Lider ekipy jest poza tenantem', status: 403 };
  if (leader.branchId !== branch.branchId && !userDelegatedBranchIds(db, leader).has(branch.branchId)) {
    return { error: 'Lider ekipy nie ma dostępu do oddziału ekipy. Dodaj delegację albo przenieś użytkownika.', status: 403 };
  }
  const membersInput = body.members ?? existing?.members ?? [];
  if (!Array.isArray(membersInput)) return { error: 'Lista członków ekipy musi być tablicą', status: 400 };
  const members = membersInput.map((member) => String(member ?? '').trim()).filter(Boolean);
  const utilization = Number(body.utilization ?? existing?.utilization ?? 0);
  if (!Number.isFinite(utilization) || utilization < 0 || utilization > 100) {
    return { error: 'Wykorzystanie ekipy musi być w zakresie 0-100', status: 400 };
  }
  const now = new Date().toISOString();
  return {
    ...(existing ?? {}),
    branchId: branch.branchId,
    name,
    leaderId: leader.id,
    members,
    utilization: Math.round(utilization),
    status: 'active',
    createdAt: existing?.createdAt ?? now,
    createdBy: existing?.createdBy ?? user.id,
    updatedAt: now,
    updatedBy: user.id,
  };
}

function visibleEquipment(db, user) {
  const branchIds = scopedBranchIds(db, user);
  const rows = (db.equipment ?? []).filter((item) => item.status !== 'archived');
  if (elevatedBranchRole(user)) return rows.filter((item) => branchIds.has(item.branchId));
  return rows.filter((item) => branchIds.has(item.branchId));
}

function visibleEquipmentReservations(db, user) {
  const equipmentIds = new Set(visibleEquipment(db, user).map((item) => item.id));
  return (db.equipmentReservations ?? []).filter((reservation) => equipmentIds.has(reservation.equipmentId));
}

function visibleWarehouseItems(db, user) {
  const branchIds = scopedBranchIds(db, user);
  const rows = (db.warehouseItems ?? []).filter((item) => item.status !== 'archived');
  if (elevatedBranchRole(user)) return rows.filter((item) => branchIds.has(item.branchId));
  return rows.filter((item) => branchIds.has(item.branchId));
}

function visibleWarehouseMovements(db, user) {
  const itemIds = new Set(visibleWarehouseItems(db, user).map((item) => item.id));
  return (db.warehouseMovements ?? []).filter((movement) => itemIds.has(movement.itemId));
}

function warehouseItemPayload(db, user, body, existing = null) {
  const branch = body.branchId || !existing
    ? branchForWrite(db, user, body.branchId ?? existing?.branchId)
    : { branchId: existing.branchId };
  if (branch.error) return branch;
  const name = optionalText(body.name ?? existing?.name);
  const unit = optionalText(body.unit ?? existing?.unit);
  if (!name) return { error: 'Nazwa materiału jest wymagana', status: 400 };
  if (!unit) return { error: 'Jednostka materiału jest wymagana', status: 400 };
  const stock = Number(body.stock ?? existing?.stock ?? 0);
  const minStock = Number(body.minStock ?? existing?.minStock ?? 0);
  if (!Number.isFinite(stock) || stock < 0) return { error: 'Stan nie może być ujemny', status: 400 };
  if (!Number.isFinite(minStock) || minStock < 0) return { error: 'Stan minimalny nie może być ujemny', status: 400 };
  const now = new Date().toISOString();
  return {
    ...(existing ?? {}),
    branchId: branch.branchId,
    name,
    unit,
    stock: Math.round(stock),
    minStock: Math.round(minStock),
    supplier: optionalText(body.supplier ?? existing?.supplier),
    status: 'active',
    createdAt: existing?.createdAt ?? now,
    createdBy: existing?.createdBy ?? user.id,
    updatedAt: now,
    updatedBy: user.id,
  };
}

function applyWarehouseMovement(item, type, qty) {
  if (type === 'in') return item.stock + qty;
  if (type === 'out') return item.stock - qty;
  if (type === 'adjust') return qty;
  return Number.NaN;
}

function parseDateRange(body, fallbackStart) {
  const startsAt = new Date(body.startsAt ?? fallbackStart ?? Date.now());
  const endsAt = new Date(body.endsAt ?? startsAt.getTime() + 1000 * 60 * 60 * 8);
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) return { error: 'Nieprawidłowy termin rezerwacji', status: 400 };
  if (endsAt <= startsAt) return { error: 'Koniec rezerwacji musi być po starcie', status: 400 };
  return { startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() };
}

function reservationsOverlap(left, right) {
  return new Date(left.startsAt) < new Date(right.endsAt) && new Date(right.startsAt) < new Date(left.endsAt);
}

function equipmentReservationConflict(db, equipmentId, range, exceptId) {
  return (db.equipmentReservations ?? []).find((reservation) => (
    reservation.id !== exceptId
    && reservation.equipmentId === equipmentId
    && reservation.status !== 'cancelled'
    && reservationsOverlap(reservation, range)
  ));
}

function equipmentReservationPayload(db, user, body = {}, existing = null) {
  const equipmentId = optionalText(body.equipmentId ?? existing?.equipmentId);
  const item = (db.equipment ?? []).find((next) => next.id === equipmentId);
  if (!item) return { error: 'Nie znaleziono sprzętu', status: 404 };
  if (!visibleEquipment(db, user).some((next) => next.id === item.id)) return { error: 'Sprzęt poza zakresem roli lub oddziału', status: 403 };
  if (item.status === 'serwis') return { error: 'Sprzęt jest w serwisie', status: 409 };

  const orderId = optionalText(body.orderId ?? existing?.orderId);
  const order = (db.orders ?? []).find((next) => next.id === orderId);
  if (!order) return { error: 'Nie znaleziono zlecenia', status: 400 };
  if (!visibleOrders(db, user).some((next) => next.id === order.id)) return { error: 'Zlecenie poza zakresem roli lub oddziału', status: 403 };
  if (order.branchId !== item.branchId) return { error: 'Sprzęt i zlecenie są w różnych oddziałach', status: 409 };

  const range = parseDateRange(body ?? {}, existing?.startsAt ?? order.scheduledAt);
  if (range.error) return range;
  const conflict = equipmentReservationConflict(db, item.id, range, existing?.id);
  if (conflict) return { error: 'Sprzęt jest już zarezerwowany w tym terminie', status: 409, conflict };
  const status = optionalText(body.status ?? existing?.status ?? 'active');
  if (!['active', 'cancelled'].includes(status)) return { error: 'Nieprawidłowy status rezerwacji', status: 400 };
  const now = new Date().toISOString();
  return {
    item,
    order,
    reservation: {
      ...(existing ?? {}),
      id: existing?.id ?? `er-${crypto.randomUUID().slice(0, 8)}`,
      equipmentId: item.id,
      orderId: order.id,
      branchId: item.branchId,
      startsAt: range.startsAt,
      endsAt: range.endsAt,
      status,
      createdBy: existing?.createdBy ?? user.id,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      updatedBy: user.id,
    },
  };
}

function refreshEquipmentReservationStatus(db, item) {
  if (!item || item.status === 'archived' || item.status === 'serwis') return;
  const active = (db.equipmentReservations ?? []).some((next) => next.equipmentId === item.id && next.status !== 'cancelled');
  item.status = active ? 'zarezerwowany' : 'dostepny';
}

function visibleValuations(db, user) {
  const orderIds = new Set(visibleOrders(db, user).map((order) => order.id));
  const rows = (db.valuations ?? []).filter((valuation) => !valuation.deletedAt && orderIds.has(valuation.orderId));
  if (user.role === 'WYCENIAJACY') return rows.filter((valuation) => valuation.estimatorId === user.id);
  return rows;
}

function valuationPayload(db, user, body = {}, existing = null) {
  const orderId = body.orderId ?? existing?.orderId;
  const order = db.orders.find((next) => next.id === orderId);
  if (!order) return { error: 'Nie znaleziono zlecenia', status: 400 };
  if (!visibleOrders(db, user).some((next) => next.id === order.id)) return { error: 'Poza zakresem roli lub oddziału', status: 403 };
  const estimatorId = optionalText(body.estimatorId ?? existing?.estimatorId ?? user.id);
  const estimator = visibleUsers(db, user).find((next) => next.id === estimatorId);
  if (!estimator) return { error: 'Wyceniający poza tenantem', status: 403 };
  const status = optionalText(body.status ?? existing?.status ?? 'do_potwierdzenia');
  if (!valuationStatuses.has(status)) return { error: 'Nieprawidłowy status wyceny', status: 400 };
  const inspectionAt = (parseOptionalDate(body.inspectionAt ?? existing?.inspectionAt ?? order.inspectionAt ?? order.scheduledAt) ?? new Date()).toISOString();
  const totalNet = Number(body.totalNet ?? existing?.totalNet ?? order.value ?? 0);
  const margin = Number(body.margin ?? existing?.margin ?? order.margin ?? 30);
  if (!Number.isFinite(totalNet) || totalNet < 0) return { error: 'Kwota wyceny jest nieprawidłowa', status: 400 };
  if (!Number.isFinite(margin) || margin < 0) return { error: 'Marża wyceny jest nieprawidłowa', status: 400 };
  const mediaInput = Object.hasOwn(body, 'media') ? body.media : (existing?.media ?? []);
  if (!Array.isArray(mediaInput)) return { error: 'Media wyceny muszą być tablicą', status: 400 };
  const media = [...new Set(mediaInput.map((item) => optionalText(item)).filter(Boolean))];
  const itemsInput = Object.hasOwn(body, 'items') ? body.items : (existing?.items ?? []);
  if (!Array.isArray(itemsInput)) return { error: 'Pozycje wyceny muszą być tablicą', status: 400 };
  const items = normalizeValuationItems(itemsInput, order, totalNet);
  const now = new Date().toISOString();
  return {
    ...(existing ?? {}),
    orderId: order.id,
    clientId: order.clientId,
    estimatorId,
    status,
    inspectionAt,
    totalNet: Math.round(totalNet),
    margin: Math.round(margin),
    media,
    notes: optionalText(body.notes ?? existing?.notes),
    items,
    createdAt: existing?.createdAt ?? now,
    createdBy: existing?.createdBy ?? user.id,
    updatedAt: now,
    updatedBy: user.id,
  };
}

async function handleValuationUpsert(req, res) {
  const activeExistingForOrder = (req.db.valuations ?? []).find((next) => !next.deletedAt && next.orderId === req.body?.orderId);
  const activeExisting = visibleValuations(req.db, req.user).find((next) => next.id === activeExistingForOrder?.id);
  if (activeExistingForOrder && !activeExisting) {
    return res.status(403).json({ error: 'Wycena poza zakresem roli lub tenantem' });
  }
  if (activeExisting && req.body?.replaceExisting === false) {
    return res.status(409).json({ error: 'Wycena dla zlecenia już istnieje', valuation: activeExisting });
  }
  const archivedExisting = !activeExisting && req.body?.reactivateArchived !== false
    ? (req.db.valuations ?? []).find((next) => next.deletedAt && next.orderId === req.body?.orderId)
    : null;
  const existing = activeExisting ?? archivedExisting;
  if (archivedExisting && !visibleOrders(req.db, req.user).some((order) => order.id === archivedExisting.orderId)) {
    return res.status(404).json({ error: 'Nie znaleziono wyceny' });
  }
  if (archivedExisting && req.body?.replaceExisting === false) {
    return res.status(409).json({ error: 'Wycena dla zlecenia już istnieje', valuation: existing });
  }
  const payload = valuationPayload(req.db, req.user, req.body ?? {}, existing ?? null);
  if (payload.error) return res.status(payload.status).json({ error: payload.error });
  const valuation = existing ?? {
    id: req.body?.id ?? nextSequenceId('W', req.db.valuations ?? []),
  };
  Object.assign(valuation, payload, { id: valuation.id });
  if (archivedExisting) {
    delete valuation.deletedAt;
    delete valuation.deletedBy;
  }
  if (!existing) {
    req.db.valuations ??= [];
    req.db.valuations.unshift(valuation);
  }
  const order = req.db.orders.find((next) => next.id === valuation.orderId);
  order?.timeline.push({ label: existing ? 'Wycena zaktualizowana' : 'Wycena wyslana do biura', at: new Date().toISOString(), by: actorName(req.user) });
  pushEvent(req.db, req.user, 'valuations', existing ? 'valuation.updated' : 'valuation.created', valuation);
  await saveDb(req.db);
  return res.status(existing ? 200 : 201).json(valuation);
}

function visibleInvoices(db, user) {
  const orderIds = new Set(visibleOrders(db, user).map((order) => order.id));
  return db.invoices.filter((invoice) => !invoice.deletedAt && orderIds.has(invoice.orderId));
}

function visibleReportInvoices(db, user) {
  const orderIds = new Set(visibleOrders(db, user).map((order) => order.id));
  return db.invoices.filter((invoice) => !invoice.deletedAt && orderIds.has(invoice.orderId));
}

function invoicePayload(db, user, body = {}, existing = null) {
  const orderId = body.orderId ?? existing?.orderId;
  const order = db.orders.find((next) => next.id === orderId);
  if (!order) return { error: 'Nie znaleziono zlecenia', status: 400 };
  if (!visibleOrders(db, user).some((next) => next.id === order.id)) return { error: 'Poza zakresem roli lub oddziału', status: 403 };
  const number = optionalText(body.number ?? existing?.number ?? nextInvoiceNumber(db));
  if (!number) return { error: 'Numer faktury jest wymagany', status: 400 };
  const duplicate = (db.invoices ?? []).find((invoice) => invoice.id !== existing?.id && invoice.number === number);
  if (duplicate) return { error: 'Faktura z takim numerem już istnieje', status: 409, duplicateId: duplicate.id };
  const net = Number(body.net ?? existing?.net ?? order.value ?? 0);
  if (!Number.isFinite(net) || net < 0) return { error: 'Kwota faktury jest nieprawidłowa', status: 400 };
  const dueAt = parseOptionalDate(body.dueAt ?? existing?.dueAt ?? new Date(Date.now() + 1000 * 60 * 60 * 24 * 14));
  if (!dueAt) return { error: 'Termin płatności jest nieprawidłowy', status: 400 };
  const status = optionalText(body.status ?? existing?.status ?? 'szkic');
  if (!invoiceStatuses.has(status)) return { error: 'Nieprawidłowy status faktury', status: 400 };
  const paidAtInput = body.paidAt ?? existing?.paidAt;
  const paidAt = status === 'oplacona'
    ? (parseOptionalDate(paidAtInput) ?? new Date()).toISOString()
    : (paidAtInput ? parseOptionalDate(paidAtInput)?.toISOString() : undefined);
  if (paidAtInput && !paidAt) return { error: 'Data płatności jest nieprawidłowa', status: 400 };
  return {
    number,
    orderId: order.id,
    clientId: order.clientId,
    net: Math.round(net),
    dueAt: dueAt.toISOString().slice(0, 10),
    status,
    paidAt,
  };
}

function sum(rows, pick) {
  return rows.reduce((total, row) => total + Number(pick(row) ?? 0), 0);
}

function groupCount(rows, pick) {
  return rows.reduce((acc, row) => {
    const key = pick(row) ?? 'brak';
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
}

function reportOverview(db, user) {
  const orders = canUser(db, user, 'orders') ? visibleOrders(db, user) : [];
  const invoices = visibleReportInvoices(db, user);
  const valuations = canUser(db, user, 'valuations') ? visibleValuations(db, user) : [];
  const crews = canUser(db, user, 'teams') || canUser(db, user, 'schedule') ? visibleCrews(db, user) : [];
  const warehouseItems = canUser(db, user, 'warehouse') ? visibleWarehouseItems(db, user) : [];
  const now = new Date();
  const orderIds = new Set(orders.map((order) => order.id));
  const completed = orders.filter((order) => order.status === 'ZAKONCZONE');
  const revenueNet = sum(orders, (order) => order.value);
  const marginNet = sum(orders, (order) => Number(order.value ?? 0) * Number(order.margin ?? 0) / 100);
  const invoicedNet = sum(invoices, (invoice) => invoice.net);
  const paidNet = sum(invoices.filter((invoice) => invoice.status === 'oplacona'), (invoice) => invoice.net);
  const overdueInvoices = invoices.filter((invoice) => invoice.status !== 'oplacona' && invoice.dueAt && new Date(`${invoice.dueAt}T23:59:59.999Z`) < now);

  const revenueByMonth = orders.reduce((acc, order) => {
    const month = String(order.scheduledAt ?? '').slice(0, 7) || 'brak';
    const current = acc.find((row) => row.month === month);
    if (current) {
      current.revenueNet += Number(order.value ?? 0);
      current.orders += 1;
    } else {
      acc.push({ month, revenueNet: Number(order.value ?? 0), orders: 1 });
    }
    return acc;
  }, []).sort((a, b) => a.month.localeCompare(b.month));

  const crewPerformance = crews.map((crew) => {
    const crewOrders = orders.filter((order) => order.teamId === crew.id);
    const crewCompleted = crewOrders.filter((order) => order.status === 'ZAKONCZONE');
    return {
      crewId: crew.id,
      name: crew.name,
      orders: crewOrders.length,
      completed: crewCompleted.length,
      revenueNet: sum(crewOrders, (order) => order.value),
      marginNet: sum(crewOrders, (order) => Number(order.value ?? 0) * Number(order.margin ?? 0) / 100),
      utilization: crew.utilization,
    };
  });

  return {
    scope: {
      role: user.role,
      branchId: elevatedBranchRole(user) ? 'all' : user.branchId,
      orderIds: orders.map((order) => order.id),
    },
    kpis: {
      orders: orders.length,
      activeOrders: orders.filter((order) => !['ZAKONCZONE', 'ANULOWANE'].includes(order.status)).length,
      completedOrders: completed.length,
      revenueNet,
      marginNet: Math.round(marginNet),
      marginPct: revenueNet > 0 ? Math.round((marginNet / revenueNet) * 100) : 0,
      invoicedNet,
      paidNet,
      outstandingNet: invoicedNet - paidNet,
      overdueInvoices: overdueInvoices.length,
      lowStockItems: warehouseItems.filter((item) => Number(item.stock) <= Number(item.minStock)).length,
    },
    ordersByStatus: groupCount(orders, (order) => order.status),
    ordersByType: groupCount(orders, (order) => order.type),
    valuationsByStatus: groupCount(valuations.filter((valuation) => orderIds.has(valuation.orderId)), (valuation) => valuation.status),
    revenueByMonth,
    crewPerformance,
    overdueInvoices: overdueInvoices.map((invoice) => ({
      id: invoice.id,
      number: invoice.number,
      orderId: invoice.orderId,
      clientId: invoice.clientId,
      net: invoice.net,
      dueAt: invoice.dueAt,
      status: invoice.status,
    })),
    lowStockItems: warehouseItems
      .filter((item) => Number(item.stock) <= Number(item.minStock))
      .map((item) => ({ id: item.id, name: item.name, stock: item.stock, minStock: item.minStock, unit: item.unit, branchId: item.branchId })),
  };
}

function workQueueSeverityRank(severity) {
  return { urgent: 0, high: 1, normal: 2, low: 3 }[severity] ?? 4;
}

function taskQueueSeverity(task, now) {
  const due = task.dueAt ? new Date(task.dueAt).getTime() : NaN;
  if (Number.isFinite(due) && due < now.getTime()) return 'urgent';
  if (task.priority === 'urgent') return 'urgent';
  if (task.priority === 'high') return 'high';
  if (task.priority === 'low') return 'low';
  return 'normal';
}

function queueByType(items) {
  return items.reduce((acc, item) => {
    acc[item.type] = (acc[item.type] ?? 0) + 1;
    return acc;
  }, {});
}

function normalizeWorkQueueAction(action) {
  return String(action || '')
    .replace(/Oddzwoni.+do klienta/u, 'Oddzwonic do klienta')
    .replace(/Oddzwoni.+lub potwierdzi.+ustalenia/u, 'Oddzwonic lub potwierdzic ustalenia')
    .replace(/Przejrze.+analiz.+AI/u, 'Przejrzec analize AI')
    .replace(/Wykona.+zadanie/u, 'Wykonac zadanie');
}

function workQueue(db, user, limit = 100) {
  const now = new Date();
  const tenantId = tenantIdForUser(db, user);
  const items = [];
  const push = (item) => {
    if (!item?.id || !item?.sourceId) return;
    items.push({ tenantId, ...item, action: normalizeWorkQueueAction(item.action) });
  };

  if (canUser(db, user, 'orders')) {
    visibleTasks(db, user)
      .filter((task) => !['done', 'cancelled'].includes(task.status))
      .forEach((task) => push({
        id: `task-${task.id}`,
        type: 'task',
        severity: taskQueueSeverity(task, now),
        title: task.title,
        status: task.status,
        createdAt: task.createdAt,
        dueAt: task.dueAt,
        branchId: task.branchId,
        clientId: task.clientId,
        orderId: task.orderId,
        assignedUserId: task.assignedUserId,
        sourceId: task.id,
        action: task.source === 'ai_receptionist' || task.source === 'softphone' ? 'Oddzwonić lub potwierdzić ustalenia' : 'Wykonać zadanie',
        metadata: { priority: task.priority, source: task.source },
      }));
  }

  if (canUser(db, user, 'communications')) {
    const clientBranches = new Map(visibleClients(db, user).map((client) => [client.id, client.branchId ?? user.branchId]));
    visibleCommunications(db, user)
      .filter((communication) => (
        communication.status === 'missed'
        || communication.queueStatus === 'overflowed'
        || communication.analysisStatus === 'review'
      ))
      .forEach((communication) => push({
        id: `communication-${communication.id}`,
        type: 'communication',
        severity: communication.status === 'missed' || communication.queueStatus === 'overflowed' ? 'high' : 'normal',
        title: communication.subject,
        status: communication.queueStatus ?? communication.status,
        createdAt: communication.startedAt,
        branchId: clientBranches.get(communication.clientId) ?? user.branchId,
        clientId: communication.clientId,
        orderId: communication.orderId,
        assignedUserId: communication.assignedUserId ?? communication.userId,
        sourceId: communication.id,
        action: communication.analysisStatus === 'review' ? 'Przejrzeć analizę AI' : 'Oddzwonić do klienta',
        metadata: { channel: communication.channel, aiHandled: communication.aiHandled, score: communication.analysis?.score },
      }));

    visibleAiBotSessions(db, user)
      .filter((session) => session.escalationRequired || ['qualification_only', 'handoff'].includes(session.bookingStatus ?? ''))
      .forEach((session) => push({
        id: `ai-session-${session.id}`,
        type: 'ai_receptionist',
        severity: session.escalationRequired ? 'urgent' : 'high',
        title: `AI recepcjonista: ${session.outcome}`,
        status: session.bookingStatus ?? session.status,
        createdAt: session.startedAt,
        clientId: session.clientId,
        orderId: session.orderId,
        assignedUserId: session.assignedEstimatorId,
        sourceId: session.id,
        action: session.escalationRequired ? 'Eskalowac do czlowieka' : 'Domknac kwalifikacje',
        metadata: { mode: session.mode, takeoverReason: session.takeoverReason },
      }));
  }

  if (canUser(db, user, 'invoices') || canUser(db, user, 'reports')) {
    visibleInvoices(db, user)
      .filter((invoice) => invoice.status !== 'oplacona' && invoice.dueAt && new Date(`${invoice.dueAt}T23:59:59.999Z`) < now)
      .forEach((invoice) => push({
        id: `invoice-${invoice.id}`,
        type: 'invoice',
        severity: 'high',
        title: `Faktura po terminie: ${invoice.number}`,
        status: invoice.status,
        dueAt: invoice.dueAt,
        clientId: invoice.clientId,
        orderId: invoice.orderId,
        sourceId: invoice.id,
        action: 'Wysłać przypomnienie o płatności',
        metadata: { net: invoice.net },
      }));
  }

  if (canUser(db, user, 'warehouse')) {
    visibleWarehouseItems(db, user)
      .filter((item) => Number(item.stock) <= Number(item.minStock))
      .forEach((item) => push({
        id: `warehouse-${item.id}`,
        type: 'warehouse',
        severity: Number(item.stock) <= 0 ? 'urgent' : 'normal',
        title: `Niski stan magazynu: ${item.name}`,
        status: 'low_stock',
        createdAt: item.updatedAt,
        branchId: item.branchId,
        sourceId: item.id,
        action: 'Uzupelnic magazyn',
        metadata: { stock: item.stock, minStock: item.minStock, unit: item.unit },
      }));
  }

  if (canUser(db, user, 'fleet')) {
    visibleEquipment(db, user)
      .map((item) => ({ item, daysLeft: dateDiffDays(item.reviewDue, now) }))
      .filter(({ daysLeft }) => daysLeft != null && daysLeft <= 30)
      .forEach(({ item, daysLeft }) => push({
        id: `equipment-${item.id}`,
        type: 'equipment',
        severity: daysLeft < 0 ? 'urgent' : 'high',
        title: `Przegląd sprzętu: ${item.name}`,
        status: daysLeft < 0 ? 'expired' : 'due_soon',
        dueAt: item.reviewDue,
        branchId: item.branchId,
        sourceId: item.id,
        action: 'Zaplanować przegląd lub serwis',
        metadata: { daysLeft, risk: item.risk, equipmentStatus: item.status },
      }));
  }

  if (canUser(db, user, 'hr') || canUser(db, user, 'documents')) {
    const compliance = hrComplianceReport(db, user, 45);
    compliance.expirations.slice(0, 20).forEach((item) => push({
      id: `hr-${item.kind}-${item.id}`,
      type: item.kind === 'equipment_review' ? 'equipment' : 'hr',
      severity: item.status === 'expired' ? 'urgent' : 'high',
      title: item.label,
      status: item.status,
      dueAt: item.expiresAt,
      sourceId: item.id,
      action: item.status === 'expired' ? 'Odnowić natychmiast' : 'Zaplanować odnowienie',
      metadata: { daysLeft: item.daysLeft, owner: item.owner?.name },
    }));
    compliance.missingDocuments.slice(0, 20).forEach((item) => push({
      id: `document-${item.requirementId}-${item.subjectId}`,
      type: 'document',
      severity: item.status === 'missing' || item.status === 'expired' ? 'urgent' : 'high',
      title: `Dokument wymagany: ${item.name}`,
      status: item.status,
      dueAt: item.document?.createdAt,
      sourceId: item.requirementId,
      action: 'Uzupelnic dokument',
      metadata: { subjectType: item.subjectType, subjectId: item.subjectId },
    }));
  }

  const sorted = items.sort((left, right) => (
    workQueueSeverityRank(left.severity) - workQueueSeverityRank(right.severity)
    || new Date(left.dueAt ?? left.createdAt ?? '9999-12-31').getTime() - new Date(right.dueAt ?? right.createdAt ?? '9999-12-31').getTime()
    || left.title.localeCompare(right.title)
  ));

  return {
    tenantId,
    generatedAt: new Date().toISOString(),
    summary: {
      total: sorted.length,
      urgent: sorted.filter((item) => item.severity === 'urgent').length,
      high: sorted.filter((item) => item.severity === 'high').length,
      normal: sorted.filter((item) => item.severity === 'normal').length,
      low: sorted.filter((item) => item.severity === 'low').length,
      byType: queueByType(sorted),
    },
    items: sorted.slice(0, Math.max(1, Math.min(250, Number(limit) || 100))),
  };
}

function defaultPortalState() {
  return {
    accepted: false,
    paid: false,
    rating: 0,
    messages: ['Dzień dobry, czy termin 09.09 jest aktualny?'],
  };
}

function portalSnapshot(db, order, token) {
  const client = db.clients.find((next) => next.id === order.clientId);
  const invoice = db.invoices.find((next) => !next.deletedAt && next.orderId === order.id);
  const state = db.portalStates?.find((next) => next.id === token) ?? db.portal ?? defaultPortalState();
  return {
    token,
    orderId: order.id,
    clientId: order.clientId,
    clientName: client?.name,
    orderType: order.type,
    orderStatus: order.status,
    orderAddress: order.address,
    orderCity: order.city,
    scheduledAt: order.scheduledAt,
    orderValue: order.value,
    invoiceId: invoice?.id,
    invoiceNumber: invoice?.number,
    invoiceStatus: invoice?.status,
    accepted: Boolean(state.accepted),
    paid: Boolean(state.paid || invoice?.status === 'oplacona'),
    rating: Number(state.rating ?? 0),
    messages: Array.isArray(state.messages) ? state.messages : [],
  };
}

function portalForUser(db, user) {
  const order = visibleOrders(db, user).find((next) => next.status !== 'ANULOWANE') ?? visibleOrders(db, user)[0] ?? db.orders[0];
  if (!order) return { ...defaultPortalState(), token: null };
  const token = portalTokenFor(order);
  return portalSnapshot(db, order, token);
}

function resolvePortal(req) {
  const token = req.get('x-arbor-portal-token') || req.query.token || req.body?.token;
  const payload = decodePortalToken(token);
  if (!payload?.orderId || !payload?.clientId) return { error: 'Nieprawidłowy token portalu', status: 401 };
  const order = req.db.orders.find((next) => next.id === payload.orderId && next.clientId === payload.clientId);
  if (!order) return { error: 'Nie znaleziono sprawy portalu', status: 404 };
  // Stare tokeny (sprzed rewokacji linku) są odrzucane; tokeny bez pola v traktujemy jak v=1.
  if (Number(payload.v ?? 1) !== Number(order.portalTokenVersion ?? 1)) {
    return { error: 'Link portalu został unieważniony. Poproś firmę o nowy link.', status: 401 };
  }
  const client = req.db.clients.find((next) => next.id === payload.clientId);
  if (!client) return { error: 'Nie znaleziono klienta portalu', status: 404 };
  req.db.portalStates ??= [];
  let state = req.db.portalStates.find((next) => next.id === token);
  if (!state) {
    state = { id: token, ...defaultPortalState() };
    req.db.portalStates.unshift(state);
  }
  return { token, payload, order, client, state };
}

function nextSequenceId(prefix, rows) {
  const max = rows.reduce((highest, row) => {
    const value = Number(String(row.id).replace(`${prefix}-`, ''));
    return Number.isFinite(value) ? Math.max(highest, value) : highest;
  }, 0);
  return `${prefix}-${String(max + 1).padStart(4, '0')}`;
}

function actorName(user) {
  return `${user.firstName} ${user.lastName}`;
}

function nextInvoiceNumber(db) {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const prefix = `FV/${month}/${year}/`;
  const max = db.invoices.reduce((highest, invoice) => {
    if (!String(invoice.number).startsWith(prefix)) return highest;
    const value = Number(String(invoice.number).slice(prefix.length));
    return Number.isFinite(value) ? Math.max(highest, value) : highest;
  }, 0);
  return `${prefix}${String(max + 1).padStart(3, '0')}`;
}

function ensureInvoiceForOrder(db, actor, order) {
  if (order.status !== 'ZAKONCZONE') return null;
  const existing = db.invoices.find((invoice) => !invoice.deletedAt && invoice.orderId === order.id);
  if (existing) return existing;
  const due = new Date(Date.now() + 1000 * 60 * 60 * 24 * 14).toISOString().slice(0, 10);
  const now = new Date().toISOString();
  const invoice = {
    id: `fv-${crypto.randomUUID().slice(0, 8)}`,
    number: nextInvoiceNumber(db),
    orderId: order.id,
    clientId: order.clientId,
    net: Number(order.value ?? 0),
    dueAt: due,
    status: 'szkic',
    createdAt: now,
    createdBy: actor.id,
    updatedAt: now,
    updatedBy: actor.id,
  };
  db.invoices.unshift(invoice);
  order.timeline.push({ label: `Faktura: ${invoice.number}`, at: now, by: actorName(actor) });
  pushEvent(db, actor, 'invoices', 'invoice.created', { id: invoice.id, number: invoice.number, orderId: order.id, clientId: order.clientId, net: invoice.net });
  return invoice;
}

function channelsFor(db, user) {
  const channels = ['announcements'];
  if (canUser(db, user, 'orders')) channels.push(`branch:${user.branchId}:orders`);
  if (user.teamId) channels.push(`team:${user.teamId}`);
  if (canUser(db, user, 'communications')) channels.push(`branch:${user.branchId}:communications`);
  if (canUser(db, user, 'valuations')) channels.push('valuations');
  if (canUser(db, user, 'map')) channels.push(`gps:${user.branchId}`);
  if (canUser(db, user, 'invoices')) channels.push('invoices');
  return channels;
}

function shouldAutoTriggerWorkflow(eventName) {
  const name = String(eventName ?? '').trim();
  return Boolean(name) && !name.startsWith('workflow.');
}

function workflowEventPayload(db, actor, eventName, payload, sourceEvent) {
  const base = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? { ...payload }
    : { payload };
  const channelBranch = String(sourceEvent.channel ?? '').match(/^branch:([^:]+):/)?.[1];
  if (!base.branchId && channelBranch && sameTenantBranch(db, actor, channelBranch)) base.branchId = channelBranch;
  if (eventName === 'client.created' && !base.clientId) base.clientId = base.id;
  if (eventName.startsWith('order.') && !base.orderId) base.orderId = base.id;
  return {
    ...base,
    eventName,
    sourceEventId: sourceEvent.id,
    channel: sourceEvent.channel,
    actorId: actor.id,
    tenantId: sourceEvent.tenantId ?? tenantIdForUser(db, actor),
  };
}

function triggerWorkflowsForEvent(db, actor, eventName, payload, sourceEvent) {
  if (!shouldAutoTriggerWorkflow(eventName)) return [];
  const event = workflowEventPayload(db, actor, eventName, payload, sourceEvent);
  const workflows = visibleWorkflows(db, actor)
    .filter((workflow) => workflow.trigger === eventName)
    .filter((workflow) => workflow.status === 'live' || workflow.killSwitch);
  return workflows.map((workflow) => executeWorkflow(db, actor, workflow, event, {
    automatic: true,
    sourceEventId: sourceEvent.id,
    sourceEventName: eventName,
  }));
}

function pushEvent(db, actor, channel, eventName, payload) {
  const tenantId = tenantIdForUser(db, actor);
  const event = { id: crypto.randomUUID(), tenantId, actorId: actor.id, channel, eventName, payload, createdAt: new Date().toISOString(), deliveredAt: null };
  db.outbox.unshift(event);
  db.auditEvents.unshift({ id: crypto.randomUUID(), tenantId, actorId: actor.id, action: eventName, entity: payload.id ?? payload.orderId ?? channel, at: event.createdAt, payload: JSON.stringify(payload) });
  db.notifications.unshift({ id: crypto.randomUUID(), tenantId, channel, role: 'ALL', title: eventName, body: JSON.stringify(payload), unread: true, createdAt: event.createdAt });
  io?.to(channel).emit(eventName, event);
  io?.to(channel).emit('arbor.event', event);
  io?.to(`user:${actor.id}`).emit('arbor.event', event);
  triggerWorkflowsForEvent(db, actor, eventName, payload, event);
  return event;
}

const app = express();
app.disable('x-powered-by');
// Za reverse-proxy ustaw ARBOR_TRUST_PROXY (liczba hopów lub 1), inaczej req.ip = adres proxy
// i limit logowania blokuje wszystkich klientów wspólnie.
if (process.env.ARBOR_TRUST_PROXY) app.set('trust proxy', Number(process.env.ARBOR_TRUST_PROXY) || true);
const corsOrigins = (process.env.ARBOR_CORS_ORIGIN ?? '').split(',').map((origin) => origin.trim()).filter(Boolean);
if (process.env.NODE_ENV === 'production' && !corsOrigins.length) {
  console.warn('[arbor] UWAGA: brak ARBOR_CORS_ORIGIN w produkcji — API odpowiada z Access-Control-Allow-Origin: * (dowolny origin).');
}
app.use(cors(corsOrigins.length ? { origin: corsOrigins } : undefined));
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});
app.use(express.json({
  limit: process.env.ARBOR_JSON_LIMIT || '5mb',
  verify: (req, _res, buffer) => {
    req.rawBody = buffer.toString('utf8');
  },
}));
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: corsOrigins.length ? corsOrigins : true, credentials: true },
});

io.use(async (socket, next) => {
  const db = loadDb();
  const auth = decodeToken(socket.handshake.auth?.token);
  const user = db.users.find((nextUser) => nextUser.id === auth?.sub);
  if (!userIsActive(user)) return next(new Error('Unauthorized'));
  socket.data.user = user;
  socket.data.allowedChannels = channelsFor(db, user);
  next();
});

io.on('connection', (socket) => {
  const user = socket.data.user;
  socket.join(`user:${user.id}`);
  socket.emit('realtime.ready', { userId: user.id, allowedChannels: socket.data.allowedChannels });

  socket.on('subscribe', (requested = [], ack) => {
    const allowed = new Set(socket.data.allowedChannels);
    const accepted = requested.filter((channel) => allowed.has(channel));
    accepted.forEach((channel) => socket.join(channel));
    const rejected = requested.filter((channel) => !allowed.has(channel));
    ack?.({ accepted, rejected });
  });
});

app.use(async (req, res, next) => {
  req.db = loadDb();
  if (isPublicRoute(req)) return next();
  const auth = decodeToken(req.headers.authorization);
  req.user = req.db.users.find((user) => user.id === auth?.sub);
  if (!userIsActive(req.user)) return res.status(401).json({ error: 'Unauthorized' });
  next();
});

function isPublicRoute(req) {
  if (req.path === '/api/health') return true;
  if (req.path === '/api/auth/login') return true;
  if (req.path === '/api/portal' || req.path === '/api/portal/message') return true;
  if (req.path === '/api/zadarma/webhook') return true;
  if (req.path === '/api/dev/reset' && devResetEnabled) return true;
  return false;
}

function isTenantWriteExempt(req) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return true;
  if (req.path.startsWith('/api/billing')) return true;
  if (/^\/api\/users\/[^/]+\/password$/.test(req.path)) return true;
  if (req.path === '/api/notifications/read') return true;
  if (req.path === '/api/dev/reset' && devResetEnabled) return true;
  return false;
}

app.use((req, res, next) => {
  if (!req.user || isPublicRoute(req) || isTenantWriteExempt(req)) return next();
  const gate = tenantWriteStatus(req.db, req.user);
  if (!gate.blocked) return next();
  return res.status(402).json({
    error: 'Konto firmy wymaga aktywnej subskrypcji przed wykonaniem tej operacji',
    code: gate.reason,
    status: gate.status,
    billingRequired: true,
  });
});

function requireAccess(module, mode = 'read') {
  return (req, res, next) => {
    if (!req.user || !canUser(req.db, req.user, module, mode)) return res.status(403).json({ error: 'Brak uprawnień', module, mode });
    return next();
  };
}

app.get('/api/health', (req, res) => {
  res.json({ ok: true, authenticated: Boolean(req.user), user: req.user ?? null, now: new Date().toISOString() });
});

// Ochrona przed brute-force: okno kroczące per IP+login, licznik czyszczony po udanym logowaniu.
const loginAttempts = new Map();
const LOGIN_ATTEMPT_LIMIT = Number(process.env.ARBOR_LOGIN_ATTEMPT_LIMIT || 10);
const LOGIN_ATTEMPT_WINDOW_MS = Number(process.env.ARBOR_LOGIN_ATTEMPT_WINDOW_MS || 15 * 60 * 1000);

function loginRateStatus(key) {
  const now = Date.now();
  const attempts = (loginAttempts.get(key) ?? []).filter((at) => now - at < LOGIN_ATTEMPT_WINDOW_MS);
  loginAttempts.set(key, attempts);
  if (loginAttempts.size > 10000) {
    for (const [otherKey, otherAttempts] of loginAttempts) {
      if (!otherAttempts.some((at) => now - at < LOGIN_ATTEMPT_WINDOW_MS)) loginAttempts.delete(otherKey);
    }
  }
  return { blocked: attempts.length >= LOGIN_ATTEMPT_LIMIT, attempts };
}

app.post('/api/auth/login', async (req, res) => {
  const login = req.body?.login;
  // `haslo` — kontrakt aplikacji mobilnej (Expo); `password`/`pin` — web i prototypy.
  const password = req.body?.password ?? req.body?.pin ?? req.body?.haslo;
  const rateKey = `${req.ip}:${String(login ?? '')}`;
  const rate = loginRateStatus(rateKey);
  if (rate.blocked) {
    return res.status(429).json({ error: 'Zbyt wiele prób logowania. Spróbuj ponownie za kilkanaście minut.' });
  }
  const user = req.db.users.find((next) => next.login === login);
  const failed = (message) => {
    rate.attempts.push(Date.now());
    loginAttempts.set(rateKey, rate.attempts);
    return res.status(401).json({ error: message });
  };
  if (!user) return failed('Nieprawidłowy login');
  if (!userIsActive(user)) return failed('Konto użytkownika jest nieaktywne');
  if (!verifyPassword(user, password)) return failed('Nieprawidłowe hasło lub PIN');
  loginAttempts.delete(rateKey);
  // Lazy-migracja starych hashy (HMAC kluczowany ARBOR_JWT_SECRET) na scrypt — bez tego
  // rotacja sekretu JWT po cichu unieważniłaby hasła w starym formacie.
  if (user.passwordHash && !user.passwordHash.startsWith('scrypt:') && password) {
    user.passwordHash = passwordHash(password);
    await saveDb(req.db);
  }
  // Pola user scalone z kształtem mobilnym (imie/nazwisko/rola/oddzial_id) — web czyta
  // swoje pola, aplikacja mobilna swoje; jeden endpoint obsługuje oba kontrakty.
  res.json({ token: tokenFor(user), user: { ...publicUser(user), ...mobileUser(user) }, passwordRequired: Boolean(user.passwordHash) });
});

app.get('/api/branches', requireAccess('settings'), (req, res) => {
  res.json(visibleBranches(req.db, req.user, { includeArchived: req.query.includeArchived === 'true' }));
});

app.post('/api/branches', requireAccess('settings', 'write'), async (req, res) => {
  const payload = branchPayload(req.db, req.user, req.body ?? {});
  if (payload.error) return res.status(payload.status).json(payload);
  req.db.branches ??= [];
  req.db.branches.unshift(payload.branch);
  pushEvent(req.db, req.user, 'announcements', 'branch.created', {
    id: payload.branch.id,
    name: payload.branch.name,
    city: payload.branch.city,
    tenantId: payload.branch.tenantId,
  });
  await saveDb(req.db);
  res.status(201).json(payload.branch);
});

app.patch('/api/branches/:id', requireAccess('settings', 'write'), async (req, res) => {
  const target = visibleBranches(req.db, req.user, { includeArchived: true }).find((branch) => branch.id === req.params.id);
  if (!target) return res.status(404).json({ error: 'Nie znaleziono oddziału' });
  const payload = branchPayload(req.db, req.user, req.body ?? {}, target);
  if (payload.error) return res.status(payload.status).json(payload);
  if (branchStatus(target) !== 'archived' && payload.branch.status === 'archived') {
    const blocked = branchArchiveBlock(req.db, req.user, target);
    if (blocked) return res.status(blocked.status).json(blocked);
  }
  Object.assign(target, payload.branch, { id: target.id });
  pushEvent(req.db, req.user, 'announcements', 'branch.updated', {
    id: target.id,
    name: target.name,
    city: target.city,
    status: branchStatus(target),
  });
  await saveDb(req.db);
  res.json(target);
});

app.delete('/api/branches/:id', requireAccess('settings', 'write'), async (req, res) => {
  const target = visibleBranches(req.db, req.user, { includeArchived: true }).find((branch) => branch.id === req.params.id);
  if (!target) return res.status(404).json({ error: 'Nie znaleziono oddziału' });
  if (branchStatus(target) === 'archived') return res.json({ branch: target, archived: true, deleted: false, references: branchReferenceSummary(req.db, target.id) });
  const blocked = branchArchiveBlock(req.db, req.user, target);
  if (blocked) return res.status(blocked.status).json(blocked);

  const references = branchReferenceSummary(req.db, target.id);
  if (!branchHasReferences(req.db, target.id)) {
    req.db.branches = req.db.branches.filter((branch) => branch.id !== target.id);
    pushEvent(req.db, req.user, 'announcements', 'branch.deleted', { id: target.id, name: target.name, city: target.city });
    await saveDb(req.db);
    return res.json({ branch: target, archived: false, deleted: true, references });
  }

  const now = new Date().toISOString();
  target.status = 'archived';
  target.deletedAt = now;
  target.deletedBy = req.user.id;
  target.updatedAt = now;
  target.updatedBy = req.user.id;
  pushEvent(req.db, req.user, 'announcements', 'branch.archived', {
    id: target.id,
    name: target.name,
    city: target.city,
    references,
  });
  await saveDb(req.db);
  res.json({ branch: target, archived: true, deleted: false, references });
});

app.get('/api/branch-delegations', (req, res) => {
  if (!canManageBranchDelegations(req.db, req.user) && !canUser(req.db, req.user, 'settings')) {
    return res.status(403).json({ error: 'Brak uprawnień do delegacji oddziałowych' });
  }
  res.json(visibleBranchDelegations(req.db, req.user, { includeArchived: req.query.includeArchived === 'true' }));
});

app.post('/api/branch-delegations', async (req, res) => {
  if (!canManageBranchDelegations(req.db, req.user)) {
    return res.status(403).json({ error: 'Brak uprawnień do delegacji oddziałowych' });
  }
  const payload = branchDelegationPayload(req.db, req.user, req.body ?? {});
  if (payload.error) return res.status(payload.status).json(payload);
  req.db.branchDelegations ??= [];
  req.db.branchDelegations.unshift(payload.delegation);
  pushEvent(req.db, req.user, `branch:${payload.delegation.toBranchId}:orders`, 'branch_delegation.created', {
    id: payload.delegation.id,
    userId: payload.delegation.userId,
    fromBranchId: payload.delegation.fromBranchId,
    toBranchId: payload.delegation.toBranchId,
    startsAt: payload.delegation.startsAt,
    endsAt: payload.delegation.endsAt,
  });
  await saveDb(req.db);
  res.status(201).json(payload.delegation);
});

app.patch('/api/branch-delegations/:id', async (req, res) => {
  if (!canManageBranchDelegations(req.db, req.user)) {
    return res.status(403).json({ error: 'Brak uprawnień do delegacji oddziałowych' });
  }
  const delegation = visibleBranchDelegations(req.db, req.user, { includeArchived: true }).find((next) => next.id === req.params.id);
  if (!delegation) return res.status(404).json({ error: 'Nie znaleziono delegacji' });
  const payload = branchDelegationPayload(req.db, req.user, req.body ?? {}, delegation);
  if (payload.error) return res.status(payload.status).json(payload);
  Object.assign(delegation, payload.delegation, { id: delegation.id });
  pushEvent(req.db, req.user, `branch:${delegation.toBranchId}:orders`, 'branch_delegation.updated', {
    id: delegation.id,
    userId: delegation.userId,
    fromBranchId: delegation.fromBranchId,
    toBranchId: delegation.toBranchId,
    status: delegation.status,
  });
  await saveDb(req.db);
  res.json(delegation);
});

app.delete('/api/branch-delegations/:id', async (req, res) => {
  if (!canManageBranchDelegations(req.db, req.user)) {
    return res.status(403).json({ error: 'Brak uprawnień do delegacji oddziałowych' });
  }
  const delegation = visibleBranchDelegations(req.db, req.user, { includeArchived: true }).find((next) => next.id === req.params.id);
  if (!delegation) return res.status(404).json({ error: 'Nie znaleziono delegacji' });
  const now = new Date().toISOString();
  delegation.status = 'revoked';
  delegation.deletedAt = now;
  delegation.deletedBy = req.user.id;
  delegation.updatedAt = now;
  delegation.updatedBy = req.user.id;
  pushEvent(req.db, req.user, `branch:${delegation.toBranchId}:orders`, 'branch_delegation.revoked', {
    id: delegation.id,
    userId: delegation.userId,
    fromBranchId: delegation.fromBranchId,
    toBranchId: delegation.toBranchId,
  });
  await saveDb(req.db);
  res.json({ delegation, revoked: true, deleted: false });
});

app.get('/api/users', requireAccess('settings'), (req, res) => {
  res.json(visibleUsers(req.db, req.user, { includeInactive: req.query.includeInactive === 'true' }).map(publicUser));
});

app.post('/api/users', requireAccess('hr', 'write'), async (req, res) => {
  const payload = userPayload(req.db, req.user, req.body ?? {});
  if (payload.error) return res.status(payload.status).json(payload);
  if (!canManageUserRole(req.db, req.user, payload.user.role)) {
    return res.status(403).json({ error: 'Brak uprawnień do nadania tej roli' });
  }
  const nextPassword = String(req.body?.password ?? req.body?.pin ?? '');
  if (nextPassword.length < 4) return res.status(400).json({ error: 'Hasło/PIN startowy musi mieć co najmniej 4 znaki' });
  const policyError = passwordPolicyError(payload.user.role, nextPassword);
  if (policyError) return res.status(400).json({ error: policyError });
  payload.user.passwordHash = passwordHash(nextPassword);
  req.db.users ??= [];
  req.db.users.unshift(payload.user);
  pushEvent(req.db, req.user, 'announcements', 'user.created', {
    id: payload.user.id,
    login: payload.user.login,
    role: payload.user.role,
    branchId: payload.user.branchId,
    status: payload.user.status,
  });
  await saveDb(req.db);
  res.status(201).json(publicUser(payload.user));
});

app.patch('/api/users/:id', requireAccess('hr', 'write'), async (req, res) => {
  const target = visibleUsers(req.db, req.user, { includeInactive: true }).find((user) => user.id === req.params.id);
  if (!target) return res.status(404).json({ error: 'Nie znaleziono użytkownika' });
  if (!canManageUserRole(req.db, req.user, target.role)) {
    return res.status(403).json({ error: 'Brak uprawnień do edycji tego konta' });
  }
  const payload = userPayload(req.db, req.user, req.body ?? {}, target);
  if (payload.error) return res.status(payload.status).json(payload);
  if (!canManageUserRole(req.db, req.user, payload.user.role)) {
    return res.status(403).json({ error: 'Brak uprawnień do nadania tej roli' });
  }
  if (target.id === req.user.id && payload.user.status !== 'active') {
    return res.status(409).json({ error: 'Nie można dezaktywować własnego konta' });
  }
  if (target.id === req.user.id && target.role === 'ADMINISTRATOR' && payload.user.role !== 'ADMINISTRATOR') {
    return res.status(409).json({ error: 'Nie można odebrać sobie roli administratora' });
  }
  const removesActiveAdmin = target.role === 'ADMINISTRATOR' && (payload.user.role !== 'ADMINISTRATOR' || payload.user.status !== 'active');
  if (removesActiveAdmin && activeTenantAdmins(req.db, req.user, target.id).length === 0) {
    return res.status(409).json({ error: 'Nie można wyłączyć ostatniego aktywnego administratora' });
  }
  Object.assign(target, payload.user, { id: target.id });
  pushEvent(req.db, req.user, 'announcements', 'user.updated', {
    id: target.id,
    login: target.login,
    role: target.role,
    branchId: target.branchId,
    status: userStatus(target),
  });
  await saveDb(req.db);
  res.json(publicUser(target));
});

app.delete('/api/users/:id', requireAccess('hr', 'write'), async (req, res) => {
  const target = visibleUsers(req.db, req.user, { includeInactive: true }).find((user) => user.id === req.params.id);
  if (!target) return res.status(404).json({ error: 'Nie znaleziono użytkownika' });
  if (!canManageUserRole(req.db, req.user, target.role)) {
    return res.status(403).json({ error: 'Brak uprawnień do archiwizacji tego konta' });
  }
  if (target.id === req.user.id) return res.status(409).json({ error: 'Nie można usunąć własnego konta' });
  if (target.role === 'ADMINISTRATOR' && activeTenantAdmins(req.db, req.user, target.id).length === 0) {
    return res.status(409).json({ error: 'Nie można usunąć ostatniego aktywnego administratora' });
  }
  target.status = 'archived';
  target.deletedAt = new Date().toISOString();
  target.deletedBy = req.user.id;
  target.updatedAt = target.deletedAt;
  target.updatedBy = req.user.id;
  const presence = (req.db.softphonePresence ?? []).find((row) => row.userId === target.id && rowTenantId(req.db, row) === tenantIdForUser(req.db, req.user));
  if (presence) {
    presence.status = 'offline';
    presence.activeCallId = undefined;
    presence.updatedAt = target.deletedAt;
    presence.updatedBy = req.user.id;
  }
  pushEvent(req.db, req.user, 'announcements', 'user.archived', {
    id: target.id,
    login: target.login,
    role: target.role,
    branchId: target.branchId,
  });
  await saveDb(req.db);
  res.json({ user: publicUser(target), archived: true, deleted: false });
});

app.patch('/api/users/:id/password', async (req, res) => {
  const target = req.db.users.find((user) => user.id === req.params.id);
  if (!target) return res.status(404).json({ error: 'Nie znaleziono użytkownika' });
  if (target.deletedAt || userStatus(target) === 'archived') return res.status(404).json({ error: 'Nie znaleziono użytkownika' });
  if (target.id !== req.user.id && !sameTenantBranch(req.db, req.user, target.branchId)) return res.status(403).json({ error: 'Użytkownik poza tenantem' });
  const isSelf = target.id === req.user.id;
  // Reset cudzego hasła: rola zarządcza ORAZ ochrona przed eskalacją — konta uprzywilejowane
  // (ADMINISTRATOR/DYREKTOR/ROP) resetuje tylko ktoś z settings:write.
  const canManage = ['ADMINISTRATOR', 'DYREKTOR'].includes(req.user.role) && canManageUserRole(req.db, req.user, target.role);
  if (!isSelf && !canManage) return res.status(403).json({ error: 'Brak uprawnień do zmiany hasła' });
  if (isSelf && target.passwordHash && !verifyPassword(target, req.body?.currentPassword ?? req.body?.currentPin)) {
    return res.status(401).json({ error: 'Aktualne hasło jest nieprawidłowe' });
  }
  const nextPassword = String(req.body?.password ?? req.body?.pin ?? '');
  if (nextPassword.length < 4) return res.status(400).json({ error: 'Hasło/PIN musi mieć co najmniej 4 znaki' });
  const policyError = passwordPolicyError(target.role, nextPassword);
  if (policyError) return res.status(400).json({ error: policyError });
  target.passwordHash = passwordHash(nextPassword);
  pushEvent(req.db, req.user, 'announcements', 'user.password_changed', { id: target.id, login: target.login });
  await saveDb(req.db);
  res.json({ ok: true, user: publicUser(target) });
});

app.get('/api/role-permissions', requireAccess('settings'), (req, res) => {
  res.json(visibleRolePermissions(req.db, req.user));
});

app.patch('/api/role-permissions/:role', requireAccess('settings', 'write'), async (req, res) => {
  const payload = rolePermissionPayload(req.db, req.user, req.params.role, req.body ?? {});
  if (payload.error) return res.status(payload.status).json(payload);
  req.db.rolePermissions ??= [];
  const index = req.db.rolePermissions.findIndex((row) => row.id === payload.permission.id);
  if (index >= 0) req.db.rolePermissions[index] = payload.permission;
  else req.db.rolePermissions.unshift(payload.permission);
  pushEvent(req.db, req.user, 'announcements', 'role_permission.updated', {
    id: payload.permission.id,
    role: payload.permission.role,
    modules: payload.permission.modules,
    writable: payload.permission.writable,
  });
  await saveDb(req.db);
  res.json(effectiveRolePermission(req.db, req.user, payload.permission.role));
});

app.post('/api/role-permissions/:role/reset', requireAccess('settings', 'write'), async (req, res) => {
  const role = String(req.params.role ?? '').trim().toUpperCase();
  if (!userRoles.has(role)) return res.status(400).json({ error: 'Nieprawidłowa rola' });
  if (role === 'ADMINISTRATOR') return res.status(409).json({ error: 'Rola administratora jest systemowa i nie wymaga resetu' });
  const tenantId = tenantIdForUser(req.db, req.user);
  const before = req.db.rolePermissions?.length ?? 0;
  req.db.rolePermissions = (req.db.rolePermissions ?? []).filter((row) => !(row.tenantId === tenantId && row.role === role));
  pushEvent(req.db, req.user, 'announcements', 'role_permission.reset', { role, removed: before - req.db.rolePermissions.length });
  await saveDb(req.db);
  res.json(effectiveRolePermission(req.db, req.user, role));
});

app.get('/api/bootstrap', (req, res) => {
  const db = req.db;
  const branchIds = [...scopedBranchIds(db, req.user)];
  res.json({
    currentUserId: req.user.id,
    access: accessPayloadForUser(db, req.user),
    branchScope: { homeBranchId: req.user.branchId, branchIds },
    users: visibleUsers(db, req.user).map(publicUser),
    branches: visibleBranches(db, req.user),
    branchDelegations: visibleBranchDelegations(db, req.user),
    // Bez dostępu CRM, ale z fakturami (np. księgowa): okrojony katalog klientów, żeby faktury miały nazwy.
    clients: canUser(db, req.user, 'crm')
      ? visibleClients(db, req.user)
      : canUser(db, req.user, 'invoices')
        ? visibleClients(db, req.user).map((client) => ({ id: client.id, name: client.name }))
        : [],
    crews: canUser(db, req.user, 'teams') || canUser(db, req.user, 'schedule') ? visibleCrews(db, req.user) : [],
    orders: canUser(db, req.user, 'orders') ? visibleOrders(db, req.user) : [],
    valuations: canUser(db, req.user, 'valuations') ? visibleValuations(db, req.user) : [],
    treeAssets: canTreeAssets(db, req.user) ? visibleTreeAssets(db, req.user) : [],
    equipment: canUser(db, req.user, 'fleet') ? visibleEquipment(db, req.user) : [],
    equipmentReservations: canUser(db, req.user, 'fleet') ? visibleEquipmentReservations(db, req.user) : [],
    warehouseItems: canUser(db, req.user, 'warehouse') ? visibleWarehouseItems(db, req.user) : [],
    warehouseMovements: canUser(db, req.user, 'warehouse') ? visibleWarehouseMovements(db, req.user) : [],
    purchaseOrders: canUser(db, req.user, 'warehouse') ? (db.purchaseOrders ?? []).filter((po) => branchIds.includes(po.branchId)) : [],
    invoices: canUser(db, req.user, 'invoices') ? visibleInvoices(db, req.user) : [],
    notifications: visibleNotifications(db, req.user),
    auditEvents: canUser(db, req.user, 'audit') ? visibleAuditEvents(db, req.user) : [],
    tenants: visibleTenants(db, req.user),
    planLimits: canUser(db, req.user, 'settings') ? (db.planLimits ?? []) : [],
    tenantSubscriptions: canUser(db, req.user, 'settings') ? visibleTenantSubscriptions(db, req.user) : [],
    billingPayments: canUser(db, req.user, 'settings') ? visibleBillingPayments(db, req.user) : [],
    integrationSettings: canUser(db, req.user, 'settings') ? currentIntegrationSettings(db, req.user) : null,
    integrationHealth: canUser(db, req.user, 'settings') ? integrationHealth(currentIntegrationSettings(db, req.user)) : null,
    integrationSkillCatalog: canUser(db, req.user, 'settings') ? integrationSkillCatalog(currentIntegrationSettings(db, req.user)) : null,
    productionReadiness: canUser(db, req.user, 'settings') ? productionReadinessChecklist(currentIntegrationSettings(db, req.user)) : null,
    integrationSetupPlan: canUser(db, req.user, 'settings') ? integrationSetupPlan(currentIntegrationSettings(db, req.user)) : null,
    communications: canUser(db, req.user, 'communications') ? visibleCommunications(db, req.user) : [],
    softphonePresence: canUser(db, req.user, 'communications') ? visibleSoftphonePresence(db, req.user) : [],
    aiPrompts: canUser(db, req.user, 'communications') || canUser(db, req.user, 'settings') ? visibleAiPrompts(db, req.user) : [],
    aiPromptVersions: canUser(db, req.user, 'communications') || canUser(db, req.user, 'settings') ? visibleAiPromptVersions(db, req.user) : [],
    aiBotSessions: canUser(db, req.user, 'communications') ? visibleAiBotSessions(db, req.user) : [],
    aiReceptionistSettings: canUser(db, req.user, 'communications') || canUser(db, req.user, 'settings') ? currentAiReceptionistSettings(db, req.user) : null,
    workflows: canUser(db, req.user, 'automation') ? visibleWorkflows(db, req.user) : [],
    workflowRuns: canUser(db, req.user, 'automation') ? visibleWorkflowRuns(db, req.user) : [],
    tasks: canUser(db, req.user, 'orders') ? visibleTasks(db, req.user) : [],
    rolePermissions: canUser(db, req.user, 'settings') ? visibleRolePermissions(db, req.user) : [],
    moduleConfigs: canUser(db, req.user, 'settings') ? visibleModuleConfigs(db, req.user) : [],
    documentTemplates: canUser(db, req.user, 'documents') ? visibleDocumentTemplates(db, req.user) : [],
    generatedDocuments: canUser(db, req.user, 'documents') ? visibleGeneratedDocuments(db, req.user) : [],
    jobPositions: canUser(db, req.user, 'documents') || canUser(db, req.user, 'hr') ? visibleJobPositions(db, req.user) : [],
    documentRequirements: canUser(db, req.user, 'documents') || canUser(db, req.user, 'hr') ? visibleDocumentRequirements(db, req.user) : [],
    employeeContracts: canUser(db, req.user, 'documents') || canUser(db, req.user, 'hr') ? visibleEmployeeContracts(db, req.user) : [],
    trainings: canUser(db, req.user, 'documents') || canUser(db, req.user, 'hr') ? visibleTrainings(db, req.user) : [],
    medicalExams: canUser(db, req.user, 'documents') || canUser(db, req.user, 'hr') ? visibleMedicalExams(db, req.user) : [],
    certifications: canUser(db, req.user, 'documents') || canUser(db, req.user, 'hr') ? visibleCertifications(db, req.user) : [],
    portal: portalForUser(db, req.user),
    offlineQueue: db.offlineQueue,
    outbox: visibleOutbox(db, req.user).slice(0, 20),
    realtime: { channels: channelsFor(db, req.user) },
  });
});

app.get('/api/tasks', requireAccess('orders'), (req, res) => {
  res.json(visibleTasks(req.db, req.user));
});

app.post('/api/tasks', requireAccess('orders', 'write'), async (req, res) => {
  const payload = taskPayload(req.db, req.user, req.body ?? {});
  if (payload.error) return res.status(payload.status).json({ error: payload.error });
  const now = new Date().toISOString();
  const task = createOperationalTask(req.db, req.user, {
    id: req.body?.id ?? nextSequenceId('task', req.db.tasks ?? []),
    ...payload,
    createdAt: now,
    createdBy: req.user.id,
  });
  emitTaskCreated(req.db, req.user, task);
  await saveDb(req.db);
  res.status(201).json(task);
});

app.patch('/api/tasks/:id', requireAccess('orders', 'write'), async (req, res) => {
  const task = visibleTasks(req.db, req.user).find((next) => next.id === req.params.id);
  if (!task) return res.status(404).json({ error: 'Nie znaleziono zadania' });
  const previousStatus = task.status;
  const payload = taskPayload(req.db, req.user, req.body ?? {}, task);
  if (payload.error) return res.status(payload.status).json({ error: payload.error });
  Object.assign(task, payload);
  if (task.status === 'done' && previousStatus !== 'done') {
    task.completedAt = new Date().toISOString();
    task.completedBy = req.user.id;
  }
  if (task.status !== 'done') {
    task.completedAt = undefined;
    task.completedBy = undefined;
  }
  pushEvent(req.db, req.user, workflowEventChannel(req.db, req.user, task), 'task.updated', {
    id: task.id,
    title: task.title,
    status: task.status,
    priority: task.priority,
    clientId: task.clientId,
    orderId: task.orderId,
    branchId: task.branchId,
    assignedUserId: task.assignedUserId,
  });
  await saveDb(req.db);
  res.json(task);
});

app.delete('/api/tasks/:id', requireAccess('orders', 'write'), async (req, res) => {
  const task = visibleTasks(req.db, req.user).find((next) => next.id === req.params.id);
  if (!task) return res.status(404).json({ error: 'Nie znaleziono zadania' });
  const now = new Date().toISOString();
  task.status = 'cancelled';
  task.deletedAt = now;
  task.deletedBy = req.user.id;
  task.updatedAt = now;
  task.updatedBy = req.user.id;
  pushEvent(req.db, req.user, workflowEventChannel(req.db, req.user, task), 'task.deleted', {
    id: task.id,
    title: task.title,
    status: task.status,
    branchId: task.branchId,
    clientId: task.clientId,
    orderId: task.orderId,
    assignedUserId: task.assignedUserId,
    deletedAt: task.deletedAt,
    deletedBy: task.deletedBy,
  });
  await saveDb(req.db);
  res.json({ task, archived: true, deleted: false });
});

app.get('/api/orders', requireAccess('orders'), (req, res) => {
  res.json(visibleOrders(req.db, req.user));
});

app.post('/api/orders', requireAccess('orders', 'write'), async (req, res) => {
  const body = req.body ?? {};
  const client = req.db.clients.find((next) => next.id === body.clientId);
  if (!client) return res.status(400).json({ error: 'Nie znaleziono klienta' });
  if (!visibleClients(req.db, req.user).some((next) => next.id === client.id)) return res.status(403).json({ error: 'Klient poza zakresem roli lub tenantem' });
  const orderBranch = branchForWrite(req.db, req.user, body.branchId ?? client.branchId ?? req.user.branchId);
  if (orderBranch.error) return res.status(orderBranch.status).json(orderBranch);
  const now = new Date().toISOString();
  const order = {
    id: body.id ?? nextSequenceId('Z', req.db.orders),
    branchId: orderBranch.branchId,
    clientId: client.id,
    teamId: body.teamId,
    estimatorId: body.estimatorId ?? req.db.users.find((user) => user.role === 'WYCENIAJACY' && user.branchId === orderBranch.branchId)?.id,
    address: body.address ?? client.address.split(',')[0],
    city: body.city ?? client.address.split(',').at(-1)?.trim() ?? '',
    type: body.type ?? 'Nowe zapytanie',
    status: body.status ?? 'NOWE',
    priority: body.priority ?? 'normalny',
    scheduledAt: body.scheduledAt ?? body.inspectionAt ?? now,
    inspectionAt: body.inspectionAt,
    value: Number(body.value ?? 0),
    margin: Number(body.margin ?? 30),
    timeline: [
      { label: body.source === 'zadarma' ? 'Telefon i kwalifikacja' : 'Nowe zapytanie', at: now, by: actorName(req.user) },
      ...(Array.isArray(body.timeline) ? body.timeline : []),
    ],
    checklist: Array.isArray(body.checklist)
      ? body.checklist
      : [{ label: 'BHP przed pracą', done: false }, { label: 'Zdjęcia przed', done: false }, { label: 'Podpis klienta', done: false }],
  };
  if (!orderStatuses.has(order.status)) return res.status(400).json({ error: 'Nieprawidłowy status zlecenia' });
  req.db.orders.unshift(order);
  pushEvent(req.db, req.user, `branch:${order.branchId}:orders`, 'order.created', order);
  await saveDb(req.db);
  res.status(201).json(order);
});

app.patch('/api/orders/:id', requireAccess('orders', 'write'), async (req, res) => {
  const order = visibleOrders(req.db, req.user).find((next) => next.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'Nie znaleziono zlecenia' });
  const previousStatus = order.status;
  const previousBranchId = order.branchId;
  const payload = orderPayload(req.db, req.user, req.body ?? {}, order);
  if (payload.error) return res.status(payload.status).json({ error: payload.error });
  Object.assign(order, payload, {
    id: order.id,
    updatedAt: new Date().toISOString(),
    updatedBy: req.user.id,
  });
  if (order.status !== previousStatus) {
    order.timeline.push({ label: `Status: ${order.status}`, at: order.updatedAt, by: actorName(req.user) });
    ensureInvoiceForOrder(req.db, req.user, order);
  } else {
    order.timeline.push({ label: 'Zlecenie zaktualizowane', at: order.updatedAt, by: actorName(req.user) });
  }
  pushEvent(req.db, req.user, `branch:${order.branchId}:orders`, 'order.updated', {
    id: order.id,
    status: order.status,
    branchId: order.branchId,
    previousBranchId,
    clientId: order.clientId,
    teamId: order.teamId,
    estimatorId: order.estimatorId,
  });
  await saveDb(req.db);
  res.json(order);
});

app.delete('/api/orders/:id', requireAccess('orders', 'write'), async (req, res) => {
  const order = visibleOrders(req.db, req.user).find((next) => next.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'Nie znaleziono zlecenia' });
  const now = new Date().toISOString();
  order.status = 'ANULOWANE';
  order.deletedAt = now;
  order.deletedBy = req.user.id;
  order.updatedAt = now;
  order.updatedBy = req.user.id;
  order.timeline ??= [];
  order.timeline.push({ label: 'Zlecenie usuniete z aktywnej listy', at: now, by: actorName(req.user) });
  pushEvent(req.db, req.user, `branch:${order.branchId}:orders`, 'order.deleted', {
    id: order.id,
    status: order.status,
    branchId: order.branchId,
    clientId: order.clientId,
    deletedAt: order.deletedAt,
    deletedBy: order.deletedBy,
  });
  await saveDb(req.db);
  res.json({ order, archived: true, deleted: false });
});

app.patch('/api/orders/:id/status', requireAccess('orders', 'write'), async (req, res) => {
  const order = req.db.orders.find((next) => next.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'Nie znaleziono zlecenia' });
  if (!orderStatuses.has(req.body.status)) return res.status(400).json({ error: 'Nieprawidłowy status zlecenia' });
  if (!visibleOrders(req.db, req.user).some((next) => next.id === order.id)) return res.status(403).json({ error: 'Poza zakresem roli lub oddziału' });
  order.status = req.body.status;
  order.timeline.push({ label: `Status: ${req.body.status}`, at: new Date().toISOString(), by: `${req.user.firstName} ${req.user.lastName}` });
  pushEvent(req.db, req.user, `branch:${order.branchId}:orders`, 'order.status_changed', { id: order.id, status: order.status });
  ensureInvoiceForOrder(req.db, req.user, order);
  await saveDb(req.db);
  res.json(order);
});

app.get('/api/orders/:id/portal-link', requireAccess('portal'), async (req, res) => {
  const order = req.db.orders.find((next) => next.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'Nie znaleziono zlecenia' });
  if (!visibleOrders(req.db, req.user).some((next) => next.id === order.id)) return res.status(403).json({ error: 'Poza zakresem roli lub oddziału' });
  const token = portalTokenFor(order);
  res.json({
    token,
    orderId: order.id,
    clientId: order.clientId,
    url: `/portal?token=${encodeURIComponent(token)}`,
    portal: portalSnapshot(req.db, order, token),
  });
});

// Rewokacja linków portalu: podbicie wersji unieważnia WSZYSTKIE dotychczasowe linki
// zlecenia (wyciek maila/historii przeglądarki) i zwraca świeży link.
app.post('/api/orders/:id/portal-link/revoke', requireAccess('orders', 'write'), async (req, res) => {
  const order = req.db.orders.find((next) => next.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'Nie znaleziono zlecenia' });
  if (!visibleOrders(req.db, req.user).some((next) => next.id === order.id)) return res.status(403).json({ error: 'Poza zakresem roli lub oddziału' });
  order.portalTokenVersion = Number(order.portalTokenVersion ?? 1) + 1;
  pushEvent(req.db, req.user, `branch:${order.branchId}:orders`, 'order.portal_link_revoked', { id: order.id, version: order.portalTokenVersion });
  await saveDb(req.db);
  const token = portalTokenFor(order);
  res.json({
    revoked: true,
    version: order.portalTokenVersion,
    token,
    orderId: order.id,
    clientId: order.clientId,
    url: `/portal?token=${encodeURIComponent(token)}`,
  });
});

app.post('/api/orders/:id/assign-team', requireAccess('orders', 'write'), async (req, res) => {
  const order = req.db.orders.find((next) => next.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'Nie znaleziono zlecenia' });
  if (!visibleOrders(req.db, req.user).some((next) => next.id === order.id)) return res.status(403).json({ error: 'Zlecenie poza zakresem roli lub tenantem' });
  const crew = req.db.crews.find((next) => next.id === req.body.teamId);
  if (!crew) return res.status(400).json({ error: 'Nie znaleziono ekipy' });
  if (!visibleCrews(req.db, req.user).some((next) => next.id === crew.id)) return res.status(403).json({ error: 'Ekipa poza zakresem roli lub tenantem' });
  order.teamId = req.body.teamId;
  order.status = 'ZAPLANOWANE';
  const valuation = req.db.valuations.find((next) => !next.deletedAt && next.orderId === order.id);
  if (valuation) valuation.status = 'przydzielona';
  pushEvent(req.db, req.user, `team:${order.teamId}`, 'order.assigned', { id: order.id, teamId: order.teamId });
  await saveDb(req.db);
  res.json(order);
});

app.get('/api/valuations', requireAccess('valuations'), (req, res) => {
  res.json(visibleValuations(req.db, req.user));
});

app.post('/api/valuations', requireAccess('valuations', 'write'), async (req, res) => {
  return handleValuationUpsert(req, res);
  const order = req.db.orders.find((next) => next.id === req.body?.orderId);
  if (!order) return res.status(400).json({ error: 'Nie znaleziono zlecenia' });
  if (!visibleOrders(req.db, req.user).some((next) => next.id === order.id)) return res.status(403).json({ error: 'Poza zakresem roli lub oddziału' });
  const valuation = {
    id: req.body.id ?? nextSequenceId('W', req.db.valuations),
    orderId: order.id,
    clientId: order.clientId,
    estimatorId: req.body.estimatorId ?? req.user.id,
    status: req.body.status ?? 'do_potwierdzenia',
    inspectionAt: req.body.inspectionAt ?? order.inspectionAt ?? new Date().toISOString(),
    totalNet: Number(req.body.totalNet ?? order.value ?? 0),
    margin: Number(req.body.margin ?? order.margin ?? 30),
    media: Array.isArray(req.body.media) ? req.body.media : [],
    notes: req.body.notes ?? '',
    items: Array.isArray(req.body.items) ? req.body.items : [],
  };
  if (!valuationStatuses.has(valuation.status)) return res.status(400).json({ error: 'Nieprawidłowy status wyceny' });
  req.db.valuations = req.db.valuations.filter((next) => next.orderId !== order.id);
  req.db.valuations.unshift(valuation);
  order.timeline.push({ label: 'Wycena wysłana do biura', at: new Date().toISOString(), by: actorName(req.user) });
  pushEvent(req.db, req.user, 'valuations', 'valuation.created', valuation);
  await saveDb(req.db);
  res.status(201).json(valuation);
});

function normalizeTextArray(value, fallback = []) {
  if (!Array.isArray(value)) return fallback;
  const normalized = value.map((item) => String(item ?? '').trim()).filter(Boolean);
  return normalized.length ? normalized : fallback;
}

function normalizeProvidedAnalysis(input, fallbackIntent) {
  if (!input || typeof input !== 'object') return null;
  const rawScore = Number(input.score);
  if (!Number.isFinite(rawScore)) return null;
  return {
    score: Math.min(100, Math.max(0, Math.round(rawScore))),
    summary: optionalText(input.summary) || 'Analiza spotkania terenowego zapisana z aplikacji mobile.',
    intent: optionalText(input.intent) || fallbackIntent,
    strengths: normalizeTextArray(input.strengths, ['Spotkanie zapisane w CRM']),
    improvements: normalizeTextArray(input.improvements, ['Zweryfikowac komplet danych przed wyslaniem oferty']),
    nextActions: normalizeTextArray(input.nextActions, ['Przejrzeć wycenę po spotkaniu']),
    risks: normalizeTextArray(input.risks, ['Ryzyka terenowe wymagaja potwierdzenia']),
  };
}

function normalizeValuationItems(input, order, totalNet) {
  const rawItems = Array.isArray(input) ? input : [];
  const items = rawItems.map((item) => ({
    name: optionalText(item?.name) || order.type,
    qty: Number.isFinite(Number(item?.qty)) ? Math.max(0.01, Number(item.qty)) : 1,
    unit: optionalText(item?.unit) || 'usl.',
    price: Number.isFinite(Number(item?.price)) ? Math.max(0, Number(item.price)) : totalNet,
    cost: Number.isFinite(Number(item?.cost)) ? Math.max(0, Number(item.cost)) : Math.round(totalNet * 0.62),
  })).filter((item) => item.name);
  return items.length ? items : [{ name: order.type, qty: 1, unit: 'usl.', price: totalNet, cost: Math.round(totalNet * 0.62) }];
}

function upsertFieldMeetingValuation(db, user, order, client, communication, body, now) {
  const proposed = body?.proposedValuation && typeof body.proposedValuation === 'object'
    ? body.proposedValuation
    : body?.valuation && typeof body.valuation === 'object'
      ? body.valuation
      : {};
  const rawTotalNet = Number(proposed.totalNet ?? body?.totalNet ?? order.value ?? 0);
  const totalNet = Number.isFinite(rawTotalNet) && rawTotalNet > 0 ? rawTotalNet : Math.max(Number(order.value ?? 0), 3900);
  const rawMargin = Number(proposed.margin ?? body?.margin ?? order.margin ?? 0);
  const margin = Number.isFinite(rawMargin) && rawMargin > 0 ? rawMargin : Math.max(Number(order.margin ?? 0), 32);
  const items = normalizeValuationItems(proposed.items ?? body?.items, order, totalNet);
  const media = [
    ...(Array.isArray(proposed.media) ? proposed.media : []),
    ...(Array.isArray(body?.media) ? body.media : []),
    'nagranie spotkania AI',
    'transkrypcja AI',
    'analiza AI',
  ].map((item) => String(item ?? '').trim()).filter(Boolean);
  const notes = [
    optionalText(proposed.notes ?? body?.notes),
    `AI meeting ${communication.id}: ${communication.analysis?.summary ?? 'Nagranie spotkania terenowego zapisane w CRM.'}`,
  ].filter(Boolean).join('\n');

  let valuation = db.valuations.find((next) => !next.deletedAt && next.orderId === order.id);
  const created = !valuation;
  if (valuation) {
    valuation.notes = [valuation.notes, notes].filter(Boolean).join('\n').trim();
    valuation.media = [...new Set([...(valuation.media ?? []), ...media])];
    if (proposed.totalNet != null || body?.totalNet != null) valuation.totalNet = totalNet;
    if (proposed.margin != null || body?.margin != null) valuation.margin = margin;
    if (Array.isArray(proposed.items) || Array.isArray(body?.items)) valuation.items = items;
    valuation.status = valuation.status === 'odrzucona' ? 'do_potwierdzenia' : valuation.status;
    valuation.updatedAt = now;
    valuation.updatedBy = user.id;
  } else {
    valuation = {
      id: nextSequenceId('W', db.valuations),
      orderId: order.id,
      clientId: client.id,
      estimatorId: user.id,
      status: 'do_potwierdzenia',
      inspectionAt: order.inspectionAt ?? now,
      totalNet,
      margin,
      media: [...new Set(media)],
      notes: notes || 'AI po spotkaniu terenowym przygotował zakres, ryzyka i propozycje wyceny.',
      items,
      createdAt: now,
      createdBy: user.id,
      updatedAt: now,
      updatedBy: user.id,
    };
    db.valuations.unshift(valuation);
  }
  return { valuation, created };
}

function fallbackFieldMeetingAnalysis(transcriptLines, reason) {
  const text = transcriptLines.map((line) => line.text).join(' ');
  if (text.length >= 10) return demoCallAnalysis(transcriptLines, 'Spotkanie terenowe wyceniającego');
  return {
    score: 0,
    summary: reason === 'no_transcript'
      ? 'Nagranie spotkania terenowego odebrane; czeka na transkrypcję i analizę AI.'
      : 'Spotkanie terenowe wymaga ręcznego przeglądu.',
    intent: 'Spotkanie terenowe wyceniającego',
    strengths: ['Nagranie przypisane do klienta i zlecenia'],
    improvements: ['Dostarczyć transkrypcję lub uruchomić STT'],
    nextActions: ['Przejrzeć nagranie', 'Uzupełnić wycenę po analizie'],
    risks: ['Brak pelnej analizy AI bez transkrypcji'],
  };
}

async function handleMobileMeetingRecording(req, res, defaults = {}) {
  const body = { ...(defaults.body ?? {}), ...(req.body ?? {}) };
  const orderId = optionalText(body.orderId);
  if (!orderId) return res.status(400).json({ error: 'Podaj orderId spotkania terenowego' });
  const order = req.db.orders.find((next) => next.id === orderId);
  if (!order) return res.status(400).json({ error: 'Nie znaleziono zlecenia' });
  if (!visibleOrders(req.db, req.user).some((next) => next.id === order.id)) return res.status(403).json({ error: 'Poza zakresem roli lub oddziału' });
  const client = req.db.clients.find((next) => next.id === order.clientId);
  if (!client) return res.status(400).json({ error: 'Nie znaleziono klienta' });
  const requestedClientId = optionalText(body.clientId);
  if (requestedClientId && requestedClientId !== client.id) return res.status(409).json({ error: 'clientId nie pasuje do zlecenia', clientId: client.id });

  const hasTranscriptInput = Object.prototype.hasOwnProperty.call(body, 'transcript');
  const transcriptLines = hasTranscriptInput ? normalizeTranscriptLines(body.transcript) : normalizeTranscriptLines(defaults.transcript);
  const recordingUrl = optionalText(body.recordingUrl ?? body.audioUrl ?? defaults.recordingUrl);
  const recordingId = optionalText(body.recordingId ?? body.localRecordingId ?? body.providerRecordingId ?? defaults.recordingId);
  const hasUsefulPayload = Boolean(recordingUrl || recordingId || hasTranscriptInput || body.transcriptStatus || body.recordingStatus);
  if (!hasUsefulPayload) return res.status(400).json({ error: 'Podaj nagranie, recordingId, transkrypcję albo status przetwarzania' });

  const durationSec = body.durationSec == null ? Number(defaults.durationSec ?? 0) : Number(body.durationSec);
  if (!Number.isFinite(durationSec) || durationSec < 0) return res.status(400).json({ error: 'Czas nagrania jest nieprawidłowy' });
  const startedAt = (parseOptionalDate(body.startedAt ?? body.recordedAt) ?? new Date()).toISOString();
  const receivedAt = (parseOptionalDate(body.receivedAt) ?? new Date()).toISOString();
  const sourceResult = communicationRecordingSource(body.recordingSource ?? 'mobile_meeting', { channel: 'mobile_meeting' });
  if (sourceResult.error) return res.status(400).json(sourceResult);
  const recordingStatus = communicationRecordingStatus(body.recordingStatus, recordingUrl || recordingId);
  if (recordingStatus.error) return res.status(400).json(recordingStatus);
  const transcriptStatus = communicationTranscriptStatus(body.transcriptStatus, transcriptLines.length);
  if (transcriptStatus.error) return res.status(400).json(transcriptStatus);

  const communication = {
    id: `com-${crypto.randomUUID().slice(0, 8)}`,
    type: 'meeting',
    clientId: client.id,
    orderId: order.id,
    userId: req.user.id,
    direction: 'outbound',
    channel: 'mobile_meeting',
    status: recordingStatus.status === 'ready' || transcriptStatus.status === 'ready' ? 'completed' : 'active',
    subject: optionalText(body.subject) || 'Spotkanie terenowe nagrane w aplikacji mobile',
    startedAt,
    durationSec: Math.round(durationSec),
    aiHandled: false,
    analysisPromptId: undefined,
    analysisPromptVersion: undefined,
    analysisModel: undefined,
    analysisUpdatedAt: undefined,
    analysisStatus: 'review',
    coachingTags: [],
    recordingUrl: recordingUrl || undefined,
    recordingId: recordingId || undefined,
    recordingSource: sourceResult.source,
    recordingStatus: recordingStatus.status,
    recordingReceivedAt: receivedAt,
    recordingConsent: body.recordingConsent == null ? true : Boolean(body.recordingConsent),
    transcriptStatus: transcriptStatus.status,
    transcript: transcriptLines,
    analysis: fallbackFieldMeetingAnalysis(transcriptLines, transcriptLines.length ? 'analysis_pending' : 'no_transcript'),
  };

  const providedAnalysis = normalizeProvidedAnalysis(body.analysis, 'Spotkanie terenowe wyceniającego');
  let prompt = null;
  let analysis = null;
  let analysisSkippedReason = null;
  if (providedAnalysis) {
    communication.analysis = providedAnalysis;
    communication.analysisUpdatedAt = receivedAt;
    communication.analysisStatus = providedAnalysis.score >= 80 ? 'ready' : 'review';
    communication.analysisModel = optionalText(body.analysisModel) || 'mobile-provided';
    communication.coachingTags = [providedAnalysis.score >= 80 ? 'good_meeting' : 'review', 'mobile_analysis'];
    analysis = communication.analysis;
  } else {
    const integrationSettings = currentIntegrationSettings(req.db, req.user);
    const transcriptText = communicationTranscriptText(communication);
    const shouldAnalyze = body.autoAnalyze !== false && integrationSettings.ai.autoAnalyze && transcriptText.length >= 10;
    if (shouldAnalyze) {
      prompt = activePromptForCommunication(req.db, req.user, communication, body.promptId);
      if (!prompt && body.promptId) return res.status(404).json({ error: 'Nie znaleziono promptu AI dla tej komunikacji' });
      if (prompt) {
        const result = promptDrivenAnalysis(communication, prompt, transcriptText);
        communication.analysis = result.analysis;
        communication.analysisPromptId = prompt.id;
        communication.analysisPromptVersion = Number(prompt.version ?? 1);
        communication.analysisModel = openaiKey ? openaiModel : 'deterministic-local-rubric';
        communication.analysisUpdatedAt = receivedAt;
        communication.analysisStatus = result.status;
        communication.coachingTags = result.tags;
        analysis = communication.analysis;
      } else {
        analysisSkippedReason = 'no_active_prompt';
      }
    } else if (body.autoAnalyze !== false) {
      analysisSkippedReason = !integrationSettings.ai.autoAnalyze
        ? 'auto_analysis_disabled'
        : (transcriptText.length ? 'transcript_too_short' : 'no_transcript');
    }
  }

  req.db.communications ??= [];
  req.db.communications.unshift(communication);
  const { valuation, created } = upsertFieldMeetingValuation(req.db, req.user, order, client, communication, body, receivedAt);
  const timelineDetails = [
    communication.recordingStatus === 'ready' ? 'nagranie' : null,
    communication.transcriptStatus === 'ready' ? 'transkrypcja' : null,
    analysis ? `AI ${analysis.score}/100` : null,
  ].filter(Boolean).join(', ');
  order.timeline.push({
    label: `Spotkanie terenowe z mobile zapisane w CRM: ${timelineDetails || 'material do przetworzenia'}`,
    at: receivedAt,
    by: actorName(req.user),
  });
  order.timeline.push({
    label: `${created ? 'Wycena utworzona' : 'Wycena zaktualizowana'} po spotkaniu terenowym: ${valuation.id}`,
    at: receivedAt,
    by: actorName(req.user),
  });

  let reviewTask = null;
  const approvalThreshold = currentIntegrationSettings(req.db, req.user).ai.humanApprovalRequiredBelowScore ?? 70;
  if (body.createReviewTask !== false && communication.analysisStatus === 'review' && communication.analysis.score < approvalThreshold) {
    reviewTask = createOperationalTask(req.db, req.user, {
      title: `Przejrzeć spotkanie terenowe ${order.id}`,
      priority: communication.analysis.score === 0 ? 'high' : 'normal',
      source: 'field_meeting',
      sourceId: communication.id,
      clientId: client.id,
      orderId: order.id,
      branchId: order.branchId,
      assignedUserId: order.estimatorId ?? req.user.id,
      notes: communication.analysis.summary,
    });
    emitTaskCreated(req.db, req.user, reviewTask);
    order.timeline.push({ label: `Zadanie po analizie spotkania: ${reviewTask.title}`, at: receivedAt, by: 'Arbor OS' });
  }

  pushEvent(req.db, req.user, `branch:${order.branchId}:communications`, 'mobile_meeting.recording_received', {
    id: communication.id,
    orderId: order.id,
    clientId: client.id,
    valuationId: valuation.id,
    recordingStatus: communication.recordingStatus,
    transcriptStatus: communication.transcriptStatus,
    analysisScore: analysis?.score ?? communication.analysis.score,
    taskId: reviewTask?.id,
  });
  pushEvent(req.db, req.user, 'valuations', 'field_meeting.analysis_ready', {
    communicationId: communication.id,
    valuationId: valuation.id,
    score: analysis?.score ?? communication.analysis.score,
    status: communication.analysisStatus,
  });
  await saveDb(req.db);
  return res.status(201).json({ communication, valuation, order, prompt, analysis: analysis ?? communication.analysis, analysisSkippedReason, task: reviewTask });
}

app.post('/api/mobile/meeting-recordings', requireAccess('valuations', 'write'), async (req, res) => {
  await handleMobileMeetingRecording(req, res);
});

app.post('/api/field-meetings/simulate', requireAccess('valuations', 'write'), async (req, res) => {
  await handleMobileMeetingRecording(req, res, {
    recordingUrl: '/recordings/demo/mobile-field-meeting.m4a',
    recordingId: `demo-mobile-${crypto.randomUUID().slice(0, 8)}`,
    durationSec: 1140,
    transcript: [
      { speaker: 'Wyceniający', text: 'Zakres prac obejmuje oględziny drzewa, dostęp sprzętu i ryzyka przy budynku.', atSec: 16 },
      { speaker: 'Klient', text: 'Proszę uwzględnić uporządkowanie terenu i wywóz gałęzi.', atSec: 74 },
    ],
  });
});

app.patch('/api/valuations/:id', requireAccess('valuations', 'write'), async (req, res) => {
  const valuation = visibleValuations(req.db, req.user).find((next) => next.id === req.params.id);
  if (!valuation) return res.status(404).json({ error: 'Nie znaleziono wyceny' });
  const payload = valuationPayload(req.db, req.user, req.body ?? {}, valuation);
  if (payload.error) return res.status(payload.status).json({ error: payload.error });
  Object.assign(valuation, payload, { id: valuation.id });
  pushEvent(req.db, req.user, 'valuations', 'valuation.updated', {
    id: valuation.id,
    orderId: valuation.orderId,
    clientId: valuation.clientId,
    estimatorId: valuation.estimatorId,
    status: valuation.status,
    totalNet: valuation.totalNet,
  });
  await saveDb(req.db);
  res.json(valuation);
});

app.patch('/api/valuations/:id/status', requireAccess('valuations', 'write'), async (req, res) => {
  const valuation = visibleValuations(req.db, req.user).find((next) => next.id === req.params.id);
  if (!valuation) return res.status(404).json({ error: 'Nie znaleziono wyceny' });
  if (!valuationStatuses.has(req.body.status)) return res.status(400).json({ error: 'Nieprawidłowy status wyceny' });
  valuation.status = req.body.status;
  valuation.updatedAt = new Date().toISOString();
  valuation.updatedBy = req.user.id;
  pushEvent(req.db, req.user, 'valuations', 'valuation.transition', { id: valuation.id, status: valuation.status });
  await saveDb(req.db);
  res.json(valuation);
});

app.delete('/api/valuations/:id', requireAccess('valuations', 'write'), async (req, res) => {
  const valuation = visibleValuations(req.db, req.user).find((next) => next.id === req.params.id);
  if (!valuation) return res.status(404).json({ error: 'Nie znaleziono wyceny' });
  valuation.deletedAt = new Date().toISOString();
  valuation.deletedBy = req.user.id;
  valuation.updatedAt = valuation.deletedAt;
  valuation.updatedBy = req.user.id;
  pushEvent(req.db, req.user, 'valuations', 'valuation.archived', {
    id: valuation.id,
    orderId: valuation.orderId,
    clientId: valuation.clientId,
    deletedAt: valuation.deletedAt,
  });
  await saveDb(req.db);
  res.json({ valuation, archived: true, deleted: false });
});

app.get('/api/invoices', requireAccess('invoices'), (req, res) => {
  res.json(visibleInvoices(req.db, req.user));
});

app.post('/api/invoices', requireAccess('invoices', 'write'), async (req, res) => {
  const order = req.db.orders.find((next) => next.id === req.body?.orderId);
  if (!order) return res.status(400).json({ error: 'Nie znaleziono zlecenia' });
  if (!visibleOrders(req.db, req.user).some((next) => next.id === order.id)) return res.status(403).json({ error: 'Poza zakresem roli lub oddziału' });
  const existing = req.db.invoices.find((invoice) => !invoice.deletedAt && invoice.orderId === order.id);
  if (existing && !req.body?.force) return res.status(409).json({ error: 'Faktura dla zlecenia już istnieje', invoice: existing });
  const payload = invoicePayload(req.db, req.user, req.body ?? {}, {
    orderId: order.id,
    clientId: order.clientId,
    net: order.value,
  });
  if (payload.error) return res.status(payload.status).json({ error: payload.error, duplicateId: payload.duplicateId });
  const now = new Date().toISOString();
  const invoice = {
    id: req.body?.id ?? `fv-${crypto.randomUUID().slice(0, 8)}`,
    ...payload,
    createdAt: now,
    createdBy: req.user.id,
    updatedAt: now,
    updatedBy: req.user.id,
  };
  if (!invoiceStatuses.has(invoice.status)) return res.status(400).json({ error: 'Nieprawidłowy status faktury' });
  req.db.invoices.unshift(invoice);
  order.timeline.push({ label: `Faktura: ${invoice.number}`, at: now, by: actorName(req.user) });
  pushEvent(req.db, req.user, 'invoices', 'invoice.created', { id: invoice.id, number: invoice.number, orderId: order.id, clientId: order.clientId, net: invoice.net });
  await saveDb(req.db);
  res.status(201).json(invoice);
});

app.patch('/api/invoices/:id', requireAccess('invoices', 'write'), async (req, res) => {
  const invoice = visibleInvoices(req.db, req.user).find((next) => next.id === req.params.id);
  if (!invoice) return res.status(404).json({ error: 'Nie znaleziono faktury' });
  const payload = invoicePayload(req.db, req.user, req.body ?? {}, invoice);
  if (payload.error) return res.status(payload.status).json({ error: payload.error, duplicateId: payload.duplicateId });
  Object.assign(invoice, payload, {
    id: invoice.id,
    updatedAt: new Date().toISOString(),
    updatedBy: req.user.id,
  });
  pushEvent(req.db, req.user, 'invoices', 'invoice.updated', {
    id: invoice.id,
    number: invoice.number,
    orderId: invoice.orderId,
    clientId: invoice.clientId,
    net: invoice.net,
    status: invoice.status,
  });
  await saveDb(req.db);
  res.json(invoice);
});

app.patch('/api/invoices/:id/status', requireAccess('invoices', 'write'), async (req, res) => {
  const invoice = visibleInvoices(req.db, req.user).find((next) => next.id === req.params.id);
  if (!invoice) return res.status(404).json({ error: 'Nie znaleziono faktury' });
  if (!invoiceStatuses.has(req.body.status)) return res.status(400).json({ error: 'Nieprawidłowy status faktury' });
  invoice.status = req.body.status;
  invoice.paidAt = req.body.status === 'oplacona' ? new Date().toISOString() : invoice.paidAt;
  invoice.updatedAt = new Date().toISOString();
  invoice.updatedBy = req.user.id;
  pushEvent(req.db, req.user, 'invoices', 'invoice.status_changed', { id: invoice.id, status: invoice.status });
  await saveDb(req.db);
  res.json(invoice);
});

app.delete('/api/invoices/:id', requireAccess('invoices', 'write'), async (req, res) => {
  const invoice = visibleInvoices(req.db, req.user).find((next) => next.id === req.params.id);
  if (!invoice) return res.status(404).json({ error: 'Nie znaleziono faktury' });
  invoice.deletedAt = new Date().toISOString();
  invoice.deletedBy = req.user.id;
  invoice.updatedAt = invoice.deletedAt;
  invoice.updatedBy = req.user.id;
  pushEvent(req.db, req.user, 'invoices', 'invoice.archived', {
    id: invoice.id,
    number: invoice.number,
    orderId: invoice.orderId,
    clientId: invoice.clientId,
    deletedAt: invoice.deletedAt,
    deletedBy: invoice.deletedBy,
  });
  await saveDb(req.db);
  res.json({ invoice, archived: true, deleted: false });
});

app.get('/api/tree-assets', requireTreeAccess(), (req, res) => {
  const rows = visibleTreeAssets(req.db, req.user, { includeArchived: req.query.includeArchived === 'true' })
    .filter((tree) => !req.query.clientId || tree.clientId === req.query.clientId)
    .filter((tree) => !req.query.orderId || tree.orderId === req.query.orderId)
    .filter((tree) => !req.query.valuationId || tree.valuationId === req.query.valuationId);
  res.json(rows);
});

app.post('/api/tree-assets', requireTreeAccess('write'), async (req, res) => {
  const payload = treeAssetPayload(req.db, req.user, req.body ?? {});
  if (payload.error) return res.status(payload.status).json({ error: payload.error });
  req.db.treeAssets ??= [];
  req.db.treeAssets.unshift(payload.tree);
  payload.order?.timeline.push({ label: `Drzewo dodane: ${payload.tree.commonName || payload.tree.species}`, at: payload.tree.createdAt, by: actorName(req.user) });
  pushEvent(req.db, req.user, `branch:${payload.tree.branchId}:orders`, 'tree_asset.created', {
    id: payload.tree.id,
    clientId: payload.tree.clientId,
    orderId: payload.tree.orderId,
    valuationId: payload.tree.valuationId,
    species: payload.tree.species,
    riskLevel: payload.tree.riskLevel,
  });
  await saveDb(req.db);
  res.status(201).json(payload.tree);
});

app.patch('/api/tree-assets/:id', requireTreeAccess('write'), async (req, res) => {
  const tree = visibleTreeAssets(req.db, req.user, { includeArchived: true }).find((next) => next.id === req.params.id);
  if (!tree) return res.status(404).json({ error: 'Nie znaleziono drzewa' });
  const payload = treeAssetPayload(req.db, req.user, req.body ?? {}, tree);
  if (payload.error) return res.status(payload.status).json({ error: payload.error });
  Object.assign(tree, payload.tree, { id: tree.id });
  payload.order?.timeline.push({ label: `Drzewo zaktualizowane: ${tree.commonName || tree.species}`, at: tree.updatedAt, by: actorName(req.user) });
  pushEvent(req.db, req.user, `branch:${tree.branchId}:orders`, 'tree_asset.updated', {
    id: tree.id,
    clientId: tree.clientId,
    orderId: tree.orderId,
    valuationId: tree.valuationId,
    condition: tree.condition,
    riskLevel: tree.riskLevel,
    status: tree.status,
  });
  await saveDb(req.db);
  res.json(tree);
});

app.delete('/api/tree-assets/:id', requireTreeAccess('write'), async (req, res) => {
  const tree = visibleTreeAssets(req.db, req.user, { includeArchived: true }).find((next) => next.id === req.params.id);
  if (!tree) return res.status(404).json({ error: 'Nie znaleziono drzewa' });
  const now = new Date().toISOString();
  tree.status = 'archived';
  tree.deletedAt = now;
  tree.deletedBy = req.user.id;
  tree.updatedAt = now;
  tree.updatedBy = req.user.id;
  const order = tree.orderId ? (req.db.orders ?? []).find((next) => next.id === tree.orderId) : null;
  order?.timeline.push({ label: `Drzewo zarchiwizowane: ${tree.commonName || tree.species}`, at: now, by: actorName(req.user) });
  pushEvent(req.db, req.user, `branch:${tree.branchId}:orders`, 'tree_asset.archived', {
    id: tree.id,
    clientId: tree.clientId,
    orderId: tree.orderId,
    valuationId: tree.valuationId,
    deletedAt: tree.deletedAt,
    deletedBy: tree.deletedBy,
  });
  await saveDb(req.db);
  res.json({ tree, archived: true, deleted: false });
});

app.get('/api/clients', requireAccess('crm'), (req, res) => {
  res.json(visibleClients(req.db, req.user));
});

app.get('/api/clients/export.csv', requireAccess('crm'), (req, res) => {
  const csv = clientsToCsv(visibleClients(req.db, req.user));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="arbor-clients.csv"');
  res.send(csv);
});

app.post('/api/clients', requireAccess('crm', 'write'), async (req, res) => {
  const payload = clientPayload(req.db, req.user, req.body ?? {});
  if (payload.error) return res.status(payload.status).json(payload);
  const client = {
    id: req.body?.id ?? nextSequenceId('c', req.db.clients),
    ...payload,
    createdAt: new Date().toISOString(),
    createdBy: req.user.id,
    updatedAt: new Date().toISOString(),
    updatedBy: req.user.id,
  };
  req.db.clients.unshift(client);
  pushEvent(req.db, req.user, `branch:${client.branchId}:orders`, 'client.created', { id: client.id, name: client.name, phone: client.phone });
  await saveDb(req.db);
  res.status(201).json(client);
});

app.post('/api/clients/import.csv', requireAccess('crm', 'write'), express.text({ type: ['text/csv', 'text/plain', 'application/csv'] }), async (req, res) => {
  let records;
  try {
    records = clientsFromCsv(String(req.body ?? ''));
  } catch (error) {
    return res.status(400).json({ error: 'Nieprawidłowy CSV', detail: error.message });
  }
  const created = [];
  const conflicts = [];
  for (const [index, record] of records.entries()) {
    const payload = clientPayload(req.db, req.user, record);
    if (payload.error) {
      conflicts.push({ row: index + 2, error: payload.error, status: payload.status });
      continue;
    }
    const duplicate = req.db.clients.find((client) => (
      client.branchId === payload.branchId
      && client.phone.replace(/\s+/g, '') === payload.phone.replace(/\s+/g, '')
    ));
    if (duplicate) {
      conflicts.push({ row: index + 2, error: 'Klient z tym telefonem już istnieje', duplicateId: duplicate.id });
      continue;
    }
    const client = {
      id: record.id ?? nextSequenceId('c', req.db.clients.concat(created)),
      ...payload,
    };
    req.db.clients.unshift(client);
    created.push(client);
  }
  if (created.length) {
    pushEvent(req.db, req.user, `branch:${created[0].branchId}:orders`, 'client.imported', { count: created.length, conflicts: conflicts.length });
    await saveDb(req.db);
  }
  res.status(created.length ? 201 : 200).json({ created, conflicts, total: records.length });
});

app.get('/api/clients/:id/timeline', requireAccess('crm'), (req, res) => {
  const client = visibleClients(req.db, req.user).find((next) => next.id === req.params.id);
  if (!client) return res.status(404).json({ error: 'Nie znaleziono klienta' });
  const events = clientTimeline(req.db, req.user, client);
  const limit = Math.min(Math.max(Number(req.query.limit ?? 100), 1), 250);
  res.json({
    client,
    summary: {
      events: events.length,
      communications: events.filter((event) => event.type === 'communication' || event.type === 'ai').length,
      orders: events.filter((event) => event.type === 'order').length,
      trees: events.filter((event) => event.type === 'tree').length,
      tasks: events.filter((event) => event.type === 'task').length,
      documents: events.filter((event) => event.type === 'document').length,
    },
    events: events.slice(0, limit),
  });
});

app.patch('/api/clients/:id', requireAccess('crm', 'write'), async (req, res) => {
  const client = req.db.clients.find((next) => next.id === req.params.id);
  if (!client) return res.status(404).json({ error: 'Nie znaleziono klienta' });
  if (!visibleClients(req.db, req.user).some((next) => next.id === client.id)) return res.status(403).json({ error: 'Klient poza zakresem roli lub oddziału' });
  const payload = clientPayload(req.db, req.user, req.body ?? {}, client);
  if (payload.error) return res.status(payload.status).json(payload);
  Object.assign(client, payload, { updatedAt: new Date().toISOString(), updatedBy: req.user.id });
  pushEvent(req.db, req.user, `branch:${client.branchId}:orders`, 'client.updated', { id: client.id, name: client.name, phone: client.phone });
  await saveDb(req.db);
  res.json(client);
});

app.delete('/api/clients/:id', requireAccess('crm', 'write'), async (req, res) => {
  const client = visibleClients(req.db, req.user).find((next) => next.id === req.params.id);
  if (!client) return res.status(404).json({ error: 'Nie znaleziono klienta' });
  const used = [
    ...(req.db.orders ?? []).filter((order) => order.clientId === client.id),
    ...(req.db.communications ?? []).filter((communication) => communication.clientId === client.id),
    ...(req.db.aiBotSessions ?? []).filter((session) => session.clientId === client.id),
    ...(req.db.tasks ?? []).filter((task) => task.clientId === client.id),
    ...(req.db.generatedDocuments ?? []).filter((document) => document.subjectType === 'client' && document.subjectId === client.id),
    ...(req.db.invoices ?? []).filter((invoice) => invoice.clientId === client.id),
    ...(req.db.valuations ?? []).filter((valuation) => valuation.clientId === client.id),
    ...(req.db.treeAssets ?? []).filter((tree) => tree.clientId === client.id),
  ].length > 0;
  if (used) {
    client.deletedAt = new Date().toISOString();
    client.deletedBy = req.user.id;
    client.updatedAt = client.deletedAt;
    client.updatedBy = req.user.id;
  } else {
    req.db.clients = (req.db.clients ?? []).filter((next) => next.id !== client.id);
  }
  pushEvent(req.db, req.user, `branch:${client.branchId}:orders`, used ? 'client.archived' : 'client.deleted', {
    id: client.id,
    name: client.name,
    branchId: client.branchId,
    used,
    deletedAt: client.deletedAt,
  });
  await saveDb(req.db);
  res.json({ client: used ? client : null, archived: used, deleted: !used });
});

const aiReceptionistModes = new Set(['after_hours', 'overflow', 'qualification', 'full_booking', 'handoff']);
const dayKeys = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const inspectionSlotMinutes = 90;

function clockMinutes(value, fallback) {
  const match = String(value ?? '').match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return fallback;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return fallback;
  return hours * 60 + minutes;
}

function activeBusinessHours(settings, date) {
  const day = dayKeys[date.getUTCDay()];
  return (settings.businessHours ?? []).find((item) => item.active && item.day === day) ?? null;
}

function isBusinessOpen(settings, date) {
  const hours = activeBusinessHours(settings, date);
  if (!hours) return false;
  const open = clockMinutes(hours.open, 8 * 60);
  const close = clockMinutes(hours.close, 17 * 60);
  const current = date.getUTCHours() * 60 + date.getUTCMinutes();
  return current >= open && current < close;
}

function aiReceptionistDecision(settings, body, receivedAt) {
  const requestedMode = aiReceptionistModes.has(body?.mode) ? body.mode : settings.mode;
  const insideHours = isBusinessOpen(settings, receivedAt);
  const overflowSeconds = Number(body?.ringSec ?? body?.waitSec ?? body?.overflowAfterSec ?? 0);
  if (!settings.enabled) return { shouldTakeOver: false, mode: 'handoff', reason: 'ai_disabled', insideBusinessHours: insideHours };
  if (requestedMode === 'handoff') return { shouldTakeOver: false, mode: requestedMode, reason: 'handoff_mode', insideBusinessHours: insideHours };
  if (requestedMode === 'full_booking') return { shouldTakeOver: true, mode: requestedMode, reason: insideHours ? 'full_booking' : 'after_hours_full_booking', insideBusinessHours: insideHours };
  if (requestedMode === 'qualification') return { shouldTakeOver: true, mode: requestedMode, reason: 'qualification_only', insideBusinessHours: insideHours };
  if (requestedMode === 'after_hours') {
    return { shouldTakeOver: !insideHours, mode: requestedMode, reason: insideHours ? 'office_open' : 'after_hours', insideBusinessHours: insideHours };
  }
  if (requestedMode === 'overflow') {
    const overflow = Boolean(body?.overflow) || overflowSeconds >= Number(settings.overflowAfterSec ?? 25);
    return { shouldTakeOver: overflow, mode: requestedMode, reason: overflow ? 'overflow' : 'line_still_with_human', insideBusinessHours: insideHours };
  }
  return { shouldTakeOver: false, mode: 'handoff', reason: 'unknown_mode', insideBusinessHours: insideHours };
}

function aiReceptionistEscalation(settings, body) {
  const text = [
    body?.subject,
    body?.customerLine,
    body?.intent,
    body?.risk,
    body?.priority,
  ].map((item) => String(item ?? '').toLowerCase()).join(' ');
  const matchedRule = (settings.escalationRules ?? []).find((rule) => text.includes(String(rule).toLowerCase()));
  const urgent = Boolean(body?.urgent || body?.safetyRisk || matchedRule || ['pilny', 'awaria', 'zagrozenie'].some((word) => text.includes(word)));
  return {
    required: urgent,
    reason: matchedRule || (urgent ? 'pilna sprawa lub ryzyko' : ''),
  };
}

function estimatorCandidates(db, user, branchId) {
  return visibleUsers(db, user)
    .filter((next) => next.role === 'WYCENIAJACY' && next.branchId === branchId)
    .sort((left, right) => left.id.localeCompare(right.id));
}

function inspectionBusy(db, branchId, estimatorId, candidate) {
  const candidateTime = candidate.getTime();
  return (db.orders ?? []).some((order) => {
    if (order.branchId !== branchId || ['ZAKONCZONE', 'ANULOWANE'].includes(order.status)) return false;
    if (estimatorId && order.estimatorId && order.estimatorId !== estimatorId) return false;
    const planned = order.inspectionAt ?? order.scheduledAt;
    if (!planned) return false;
    const plannedTime = new Date(planned).getTime();
    if (!Number.isFinite(plannedTime)) return false;
    return Math.abs(plannedTime - candidateTime) < inspectionSlotMinutes * 60 * 1000;
  });
}

function withinBookingWindow(candidate, receivedAt, settings) {
  const windowMs = Math.max(1, Number(settings.bookingWindowDays ?? 21)) * 24 * 60 * 60 * 1000;
  return candidate.getTime() >= receivedAt.getTime() && candidate.getTime() <= receivedAt.getTime() + windowMs;
}

function dateAtUtcMinutes(date, minutes) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), Math.floor(minutes / 60), minutes % 60, 0, 0));
}

function findInspectionSlot(db, user, branchId, settings, receivedAt, requestedAt) {
  const estimators = estimatorCandidates(db, user, branchId);
  if (!estimators.length) return { slot: null, estimator: null, conflict: false, reason: 'no_estimator' };
  const requested = requestedAt ? new Date(requestedAt) : null;
  if (requested && Number.isFinite(requested.getTime()) && withinBookingWindow(requested, receivedAt, settings)) {
    const estimator = estimators.find((candidate) => !inspectionBusy(db, branchId, candidate.id, requested));
    if (estimator) return { slot: requested.toISOString(), estimator, conflict: false, reason: 'requested_available' };
  }
  const conflict = Boolean(requested && Number.isFinite(requested.getTime()));
  const windowDays = Math.max(1, Math.min(90, Number(settings.bookingWindowDays ?? 21)));
  for (let dayOffset = 0; dayOffset <= windowDays; dayOffset += 1) {
    const day = new Date(receivedAt.getTime() + dayOffset * 24 * 60 * 60 * 1000);
    const hours = activeBusinessHours(settings, day);
    if (!hours) continue;
    const open = clockMinutes(hours.open, 8 * 60);
    const close = clockMinutes(hours.close, 17 * 60);
    for (let minutes = open; minutes <= close - inspectionSlotMinutes; minutes += 120) {
      const candidate = dateAtUtcMinutes(day, minutes);
      if (candidate.getTime() <= receivedAt.getTime() + 60 * 60 * 1000) continue;
      const estimator = estimators.find((next) => !inspectionBusy(db, branchId, next.id, candidate));
      if (estimator) return { slot: candidate.toISOString(), estimator, conflict, reason: conflict ? 'requested_conflict_rebooked' : 'first_available' };
    }
  }
  return { slot: null, estimator: null, conflict, reason: conflict ? 'requested_conflict_no_slot' : 'no_slot' };
}

function aiQualificationSummary(settings, body, booking, escalation) {
  const missing = [];
  const text = `${body?.subject ?? ''} ${body?.customerLine ?? ''}`.toLowerCase();
  if (!body?.address && !text.includes('ul.') && !text.includes('krak')) missing.push('lokalizacja prac');
  if (!body?.subject && !body?.intent) missing.push('typ prac');
  if (!body?.photosProvided) missing.push('zdjęcia lub dokumenty');
  const asked = (settings.qualificationQuestions ?? []).slice(0, 6);
  return {
    missing,
    asked,
    bookingReason: booking.reason,
    escalationReason: escalation.reason,
  };
}

app.post('/api/ai-receptionist/simulate', requireAccess('communications', 'write'), async (req, res) => {
  const body = req.body ?? {};
  const phone = String(body.phone ?? '+48 799 100 200');
  const normalized = normalizePhone(phone);
  const writeBranch = branchForWrite(req.db, req.user, body.branchId);
  if (writeBranch.error) return res.status(writeBranch.status).json(writeBranch);
  const branchId = writeBranch.branchId;
  const settings = currentAiReceptionistSettings(req.db, req.user);
  const integrationSettings = currentIntegrationSettings(req.db, req.user);
  const receivedAtDate = Number.isFinite(new Date(body.receivedAt ?? '').getTime()) ? new Date(body.receivedAt) : new Date();
  const now = receivedAtDate.toISOString();
  const decision = aiReceptionistDecision(settings, body, receivedAtDate);
  const escalation = aiReceptionistEscalation(settings, body);
  let client = visibleClients(req.db, req.user).find((next) => normalizePhone(next.phone) === normalized);
  let createdClient = false;

  if (!client) {
    client = {
      id: nextSequenceId('c', req.db.clients),
      branchId,
      name: body.clientName ?? `Lead AI ${phone}`,
      phone,
      email: body.email ?? '',
      address: body.address ?? 'Do ustalenia',
      ltv: 0,
      tags: ['ai recepcjonista', 'nowy lead'],
      customFields: { source: 'ai_receptionist' },
    };
    req.db.clients.unshift(client);
    createdClient = true;
  }

  if (!elevatedBranchRole(req.user) && (client.branchId ?? req.user.branchId) !== req.user.branchId) {
    return res.status(403).json({ error: 'Klient poza zakresem roli lub oddziału' });
  }
  if (!sameTenantBranch(req.db, req.user, client.branchId ?? branchId)) return res.status(403).json({ error: 'Klient poza tenantem' });

  const canBook = decision.shouldTakeOver && !escalation.required && ['full_booking', 'after_hours', 'overflow'].includes(decision.mode);
  const booking = canBook
    ? findInspectionSlot(req.db, req.user, client.branchId ?? branchId, settings, receivedAtDate, body.inspectionAt)
    : { slot: null, estimator: null, conflict: false, reason: decision.shouldTakeOver ? 'qualification_or_escalation' : decision.reason };
  const inspectionAt = booking.slot;
  let order = req.db.orders.find((next) => next.clientId === client.id && !['ZAKONCZONE', 'ANULOWANE'].includes(next.status));
  let createdOrder = false;
  const shouldCreateOrder = decision.shouldTakeOver || escalation.required;
  if (!order && shouldCreateOrder) {
    order = {
      id: nextSequenceId('Z', req.db.orders),
      branchId: client.branchId ?? branchId,
      clientId: client.id,
      teamId: undefined,
      estimatorId: booking.estimator?.id ?? req.db.users.find((user) => user.role === 'WYCENIAJACY' && user.branchId === (client.branchId ?? branchId))?.id,
      address: body.address ?? client.address.split(',')[0] ?? 'Do ustalenia',
      city: body.city ?? client.address.split(',').at(-1)?.trim() ?? '',
      type: body.subject ?? 'Kwalifikacja AI recepcjonisty',
      status: 'NOWE',
      priority: escalation.required ? 'pilny' : body.priority ?? 'normalny',
      scheduledAt: inspectionAt ?? now,
      inspectionAt,
      value: 0,
      margin: 30,
      timeline: [
        { label: 'AI recepcjonista zakwalifikował klienta', at: now, by: 'AI recepcjonista' },
        ...(booking.conflict ? [{ label: 'AI recepcjonista zmienil termin przez konflikt kalendarza', at: now, by: 'AI recepcjonista' }] : []),
        ...(escalation.required ? [{ label: `Eskalacja do czlowieka: ${escalation.reason}`, at: now, by: 'AI recepcjonista' }] : []),
      ],
      checklist: [
        { label: 'Potwierdzić termin SMS', done: false },
        { label: 'Zdjęcia od klienta', done: Boolean(body.photosProvided) },
        { label: 'Przypisać wyceniającego', done: Boolean(booking.estimator) },
        { label: 'Zweryfikować ryzyko i dojazd', done: false },
      ],
    };
    req.db.orders.unshift(order);
    createdOrder = true;
  } else if (order) {
    if (inspectionAt && !order.inspectionAt) {
      order.inspectionAt = inspectionAt;
      order.scheduledAt = inspectionAt;
    }
    if (booking.estimator && !order.estimatorId) order.estimatorId = booking.estimator.id;
    order.timeline.push({ label: 'AI recepcjonista dopisał rozmowę', at: now, by: 'AI recepcjonista' });
    if (booking.conflict) order.timeline.push({ label: 'AI recepcjonista znalazł najbliższy wolny termin', at: now, by: 'AI recepcjonista' });
  }

  const qualification = aiQualificationSummary(settings, body, booking, escalation);
  const communication = {
    id: `com-${crypto.randomUUID().slice(0, 8)}`,
    type: 'call',
    clientId: client.id,
    orderId: order?.id,
    direction: 'inbound',
    channel: 'ai_receptionist',
    status: decision.shouldTakeOver ? 'completed' : 'queued',
    subject: body.subject ?? 'AI recepcjonista - kwalifikacja po godzinach',
    startedAt: now,
    durationSec: Number(body.durationSec ?? 196),
    aiHandled: decision.shouldTakeOver,
    recordingUrl: '/recordings/demo/ai-receptionist.mp3',
    transcript: [
      { speaker: 'AI recepcjonista', text: 'Dzień dobry, Polska Flora. Pomogę przyjąć zgłoszenie i umówić oględziny.', atSec: 0 },
      { speaker: 'Klient', text: body.customerLine ?? 'Potrzebuję wyceny prac przy drzewie, najlepiej w przyszłym tygodniu.', atSec: 18 },
      { speaker: 'AI recepcjonista', text: inspectionAt ? `Najbliższy wolny termin oględzin: ${inspectionAt}.` : 'Przekazuję sprawę do biura do ręcznego potwierdzenia.', atSec: 58 },
    ],
    analysis: {
      score: escalation.required ? 91 : decision.shouldTakeOver ? 88 : 72,
      summary: decision.shouldTakeOver
        ? 'AI zebrał dane, sprawdził reguły recepcji i przygotował dalszy krok w CRM.'
        : 'AI nie przejął rozmowy zgodnie z ustawieniami i przekazał sprawę do człowieka.',
      intent: body.intent ?? 'Nowa wycena arborystyczna',
      strengths: ['Szybka kwalifikacja', booking.slot ? 'Termin oględzin zaproponowany automatycznie' : 'Zachowana kontrola człowieka'],
      improvements: qualification.missing.length ? qualification.missing.map((item) => `Uzupełnić: ${item}`) : ['Potwierdzić SMS po rozmowie'],
      nextActions: [
        booking.slot ? 'Wysłać potwierdzenie SMS/e-mail' : 'Oddzwonić i potwierdzić termin',
        booking.estimator ? `Powiadomić wyceniającego: ${booking.estimator.firstName} ${booking.estimator.lastName}` : 'Przypisać wyceniającego',
      ],
      risks: escalation.required ? [escalation.reason] : qualification.missing.length ? ['Niepełna kwalifikacja: ' + qualification.missing.join(', ')] : ['Brak informacji o dojeździe dla sprzętu'],
    },
  };
  const bookingStatus = booking.slot ? 'booked' : decision.shouldTakeOver ? 'qualification_only' : 'handoff';
  const botSession = {
    id: `bot-${crypto.randomUUID().slice(0, 8)}`,
    clientId: client.id,
    mode: decision.mode,
    status: booking.slot ? 'booked' : decision.shouldTakeOver ? 'closed' : 'handoff',
    startedAt: now,
    transcript: communication.transcript.map((line) => `${line.speaker}: ${line.text}`).join('\n'),
    outcome: booking.slot
      ? 'Utworzono kwalifikację, zlecenie i zarezerwowano termin oględzin.'
      : decision.shouldTakeOver
        ? 'Utworzono kwalifikację i przekazano zadanie do ręcznego domknięcia.'
        : 'Rozmowa przekazana do człowieka zgodnie z ustawieniami recepcji.',
    inspectionAt,
    orderId: order?.id,
    takeoverReason: decision.reason,
    escalationRequired: escalation.required,
    bookingStatus,
    assignedEstimatorId: booking.estimator?.id,
  };
  const followupTask = createOperationalTask(req.db, req.user, {
    title: booking.slot
      ? `Sprawdzic booking AI: ${client.name}`
      : `Domknąć rozmowę AI: ${client.name}`,
    priority: escalation.required ? 'urgent' : booking.slot ? 'normal' : 'high',
    source: 'ai_receptionist',
    sourceId: botSession.id,
    clientId: client.id,
    orderId: order?.id,
    branchId: client.branchId ?? branchId,
    assignedEstimatorId: booking.estimator?.id,
    dueAt: new Date(receivedAtDate.getTime() + (booking.slot ? 24 : 2) * 60 * 60 * 1000).toISOString(),
    notes: [
      `Tryb: ${decision.mode}. Powod: ${decision.reason}.`,
      booking.slot ? `Termin oględzin: ${booking.slot}.` : `Do ustalenia terminu: ${booking.reason}.`,
      escalation.required ? `Eskalacja: ${escalation.reason}.` : '',
      qualification.missing.length ? `Braki: ${qualification.missing.join(', ')}.` : '',
    ].filter(Boolean).join(' '),
    createdAt: now,
  });
  if (order) order.timeline.push({ label: `Zadanie dla biura: ${followupTask.title}`, at: now, by: 'AI recepcjonista' });
  req.db.communications.unshift(communication);
  const confirmations = [];
  if (booking.slot && integrationSettings.messaging.sendBookingConfirmations) {
    const smsResult = createOutgoingCommunication(req.db, req.user, {
      type: 'sms',
      client,
      order,
      integrationSettings,
      subject: 'Potwierdzenie oględzin',
      body: `Polska Flora: potwierdzamy oględziny ${booking.slot}. W razie zmian prosimy o kontakt.`,
      source: 'ai_receptionist',
      aiHandled: true,
      relatedCommunicationId: communication.id,
      actorLabel: 'AI recepcjonista',
      createdAt: now,
      intent: 'Potwierdzenie terminu oględzin',
      nextActions: ['Klient otrzymał potwierdzenie terminu'],
    });
    if (smsResult.communication) confirmations.push(smsResult.communication);
    if (client.email) {
      const emailResult = createOutgoingCommunication(req.db, req.user, {
        type: 'email',
        client,
        order,
        integrationSettings,
        subject: 'Potwierdzenie oględzin Polska Flora',
        body: `Dzień dobry ${client.name}, potwierdzamy termin oględzin: ${booking.slot}. Prosimy przygotować zdjęcia i informacje o dostępie do drzewa.`,
        source: 'ai_receptionist',
        aiHandled: true,
        relatedCommunicationId: communication.id,
        actorLabel: 'AI recepcjonista',
        createdAt: now,
        intent: 'Potwierdzenie e-mail terminu',
        nextActions: ['Klient otrzymał e-mail z potwierdzeniem'],
      });
      if (emailResult.communication) confirmations.push(emailResult.communication);
    }
  } else if (!booking.slot && integrationSettings.messaging.sendMissedCallFollowups) {
    const smsResult = createOutgoingCommunication(req.db, req.user, {
      type: 'sms',
      client,
      order,
      integrationSettings,
      subject: 'Przyjęcie zgłoszenia',
      body: 'Polska Flora: przyjęliśmy zgłoszenie. Biuro skontaktuje się w celu potwierdzenia terminu oględzin.',
      source: 'ai_receptionist',
      aiHandled: true,
      relatedCommunicationId: communication.id,
      actorLabel: 'AI recepcjonista',
      createdAt: now,
      intent: 'Follow-up po rozmowie AI',
      nextActions: ['Biuro ma domknac termin z klientem'],
    });
    if (smsResult.communication) confirmations.push(smsResult.communication);
  }
  req.db.aiBotSessions.unshift(botSession);
  req.db.workflowRuns.unshift({
    id: `run-${crypto.randomUUID().slice(0, 8)}`,
    tenantId: tenantIdForUser(req.db, req.user),
    workflowId: 'wf-1',
    trigger: 'ai_receptionist.completed',
    status: decision.shouldTakeOver ? 'success' : 'waiting_approval',
    startedAt: now,
    dryRun: false,
    actionsExecuted: decision.shouldTakeOver ? 1 : 0,
    log: [
      `Decision: ${decision.reason}`,
      createdClient ? 'Client created' : 'Client matched',
      createdOrder ? 'Order created' : order ? 'Order updated' : 'Order not created',
      booking.slot ? `Inspection booked: ${booking.slot}` : `No booking: ${booking.reason}`,
      escalation.required ? `Escalation: ${escalation.reason}` : 'No escalation',
      `Task created: ${followupTask.id}`,
    ],
  });
  emitTaskCreated(req.db, req.user, followupTask);
  pushEvent(req.db, req.user, `branch:${client.branchId ?? branchId}:communications`, 'ai_receptionist.completed', {
    id: communication.id,
    clientId: client.id,
    orderId: order?.id,
    taskId: followupTask.id,
    createdClient,
    createdOrder,
    takeoverReason: decision.reason,
    bookingStatus,
    inspectionAt,
    assignedEstimatorId: booking.estimator?.id,
    escalationRequired: escalation.required,
  });
  await saveDb(req.db);
  res.status(decision.shouldTakeOver ? 201 : 202).json({
    client,
    order,
    communication,
    confirmations,
    botSession,
    task: followupTask,
    createdClient,
    createdOrder,
    decision,
    booking: {
      inspectionAt,
      conflict: booking.conflict,
      reason: booking.reason,
      estimatorId: booking.estimator?.id,
    },
    qualification,
    escalation,
  });
});

app.patch('/api/ai-receptionist/settings', requireAccess('communications', 'write'), async (req, res) => {
  const current = currentAiReceptionistSettings(req.db, req.user);
  const allowedModes = new Set(['after_hours', 'overflow', 'qualification', 'full_booking', 'handoff']);
  const patch = req.body ?? {};
  const next = { ...current };
  if (typeof patch.enabled === 'boolean') next.enabled = patch.enabled;
  if (allowedModes.has(patch.mode)) next.mode = patch.mode;
  if (Number.isFinite(Number(patch.overflowAfterSec))) next.overflowAfterSec = Math.max(5, Math.round(Number(patch.overflowAfterSec)));
  if (Number.isFinite(Number(patch.bookingWindowDays))) next.bookingWindowDays = Math.max(1, Math.round(Number(patch.bookingWindowDays)));
  if (typeof patch.language === 'string' && patch.language.trim()) next.language = patch.language.trim();
  if (Array.isArray(patch.escalationRules)) next.escalationRules = patch.escalationRules.map((item) => String(item).trim()).filter(Boolean);
  if (Array.isArray(patch.qualificationQuestions)) next.qualificationQuestions = patch.qualificationQuestions.map((item) => String(item).trim()).filter(Boolean);
  if (Array.isArray(patch.businessHours)) {
    next.businessHours = patch.businessHours
      .map((item) => ({
        day: String(item.day ?? '').trim(),
        open: String(item.open ?? '08:00').trim(),
        close: String(item.close ?? '17:00').trim(),
        active: Boolean(item.active),
      }))
      .filter((item) => item.day);
  }
  next.updatedAt = new Date().toISOString();
  next.updatedBy = req.user.id;
  const saved = replaceAiReceptionistSettings(req.db, req.user, next);
  pushEvent(req.db, req.user, 'announcements', 'ai_receptionist.settings_updated', { id: saved.id, mode: saved.mode, enabled: saved.enabled });
  await saveDb(req.db);
  res.json(saved);
});

app.get('/api/ai-prompts', requireAccess('communications'), (req, res) => {
  res.json(visibleAiPrompts(req.db, req.user));
});

app.post('/api/ai-prompts', requireAccess('communications', 'write'), async (req, res) => {
  const payload = aiPromptPayload(req.db, req.user, req.body ?? {});
  if (payload.error) return res.status(payload.status).json({ error: payload.error });
  req.db.aiPrompts ??= [];
  req.db.aiPrompts.unshift(payload.prompt);
  const versionRow = {
    id: `${payload.prompt.id}-v1`,
    tenantId: tenantIdForUser(req.db, req.user),
    promptId: payload.prompt.id,
    version: 1,
    status: 'active',
    body: payload.prompt.body,
    changeNote: optionalText(req.body?.changeNote) || 'Utworzenie promptu',
    createdAt: payload.prompt.updatedAt,
    createdBy: req.user.id,
  };
  req.db.aiPromptVersions ??= [];
  req.db.aiPromptVersions.unshift(versionRow);
  pushEvent(req.db, req.user, 'announcements', 'ai_prompt.created', { id: payload.prompt.id, version: payload.prompt.version, kind: payload.prompt.kind, status: payload.prompt.status });
  await saveDb(req.db);
  res.status(201).json({ prompt: payload.prompt, activeVersion: versionRow });
});

app.patch('/api/ai-prompts/:id', requireAccess('communications', 'write'), async (req, res) => {
  const prompt = visibleAiPrompts(req.db, req.user).find((next) => next.id === req.params.id);
  if (!prompt) return res.status(404).json({ error: 'Nie znaleziono promptu AI' });
  const payload = aiPromptPayload(req.db, req.user, req.body ?? {}, prompt);
  if (payload.error) return res.status(payload.status).json({ error: payload.error });
  const now = new Date().toISOString();
  const versions = ensurePromptVersionHistory(req.db, req.user, prompt);
  const bodyChanged = payload.prompt.body !== prompt.body;
  let versionRow = versions.find((version) => version.status === 'active') ?? versions[0];
  if (bodyChanged) {
    versions.forEach((version) => { version.status = 'archived'; });
    const nextVersion = Math.max(Number(prompt.version ?? 0), ...versions.map((version) => Number(version.version ?? 0))) + 1;
    versionRow = {
      id: `${prompt.id}-v${nextVersion}-${crypto.randomUUID().slice(0, 8)}`,
      tenantId: tenantIdForUser(req.db, req.user),
      promptId: prompt.id,
      version: nextVersion,
      status: 'active',
      body: payload.prompt.body,
      changeNote: String(req.body?.changeNote ?? 'Aktualizacja promptu').trim(),
      createdAt: now,
      createdBy: req.user.id,
    };
    req.db.aiPromptVersions.unshift(versionRow);
    prompt.version = nextVersion;
  }
  prompt.name = payload.prompt.name;
  prompt.kind = payload.prompt.kind;
  prompt.status = payload.prompt.status;
  prompt.body = payload.prompt.body;
  prompt.updatedAt = now;
  prompt.updatedBy = req.user.id;
  pushEvent(req.db, req.user, 'announcements', 'ai_prompt.updated', { id: prompt.id, version: prompt.version, kind: prompt.kind, versionId: versionRow.id });
  await saveDb(req.db);
  res.json({ prompt, activeVersion: versionRow });
});

app.delete('/api/ai-prompts/:id', requireAccess('communications', 'write'), async (req, res) => {
  const prompt = visibleAiPrompts(req.db, req.user).find((next) => next.id === req.params.id);
  if (!prompt) return res.status(404).json({ error: 'Nie znaleziono promptu AI' });
  const used = visibleCommunications(req.db, req.user).some((communication) => communication.analysisPromptId === prompt.id);
  if (used) {
    prompt.status = 'archived';
    prompt.deletedAt = new Date().toISOString();
    prompt.deletedBy = req.user.id;
    prompt.updatedAt = prompt.deletedAt;
    prompt.updatedBy = req.user.id;
  } else {
    req.db.aiPrompts = (req.db.aiPrompts ?? []).filter((next) => next.id !== prompt.id);
    req.db.aiPromptVersions = (req.db.aiPromptVersions ?? []).filter((version) => version.promptId !== prompt.id);
  }
  pushEvent(req.db, req.user, 'announcements', used ? 'ai_prompt.archived' : 'ai_prompt.deleted', {
    id: prompt.id,
    kind: prompt.kind,
    archived: used,
    deleted: !used,
  });
  await saveDb(req.db);
  res.json({ prompt: used ? prompt : null, archived: used, deleted: !used });
});

app.get('/api/ai-prompts/:id/versions', requireAccess('communications'), async (req, res) => {
  const prompt = visibleAiPrompts(req.db, req.user).find((next) => next.id === req.params.id);
  if (!prompt) return res.status(404).json({ error: 'Nie znaleziono promptu AI' });
  const versions = ensurePromptVersionHistory(req.db, req.user, prompt)
    .sort((left, right) => Number(right.version) - Number(left.version));
  await saveDb(req.db);
  res.json({ prompt, versions });
});

app.post('/api/ai-prompts/:id/test', requireAccess('communications', 'write'), async (req, res) => {
  const prompt = visibleAiPrompts(req.db, req.user).find((next) => next.id === req.params.id);
  if (!prompt) return res.status(404).json({ error: 'Nie znaleziono promptu AI' });
  const sampleTranscript = String(req.body?.sampleTranscript ?? req.body?.sample ?? '').trim();
  if (sampleTranscript.length < 10) return res.status(400).json({ error: 'Próbka rozmowy musi mieć co najmniej 10 znaków' });
  const result = promptTestResult(prompt, sampleTranscript);
  pushEvent(req.db, req.user, 'announcements', 'ai_prompt.tested', { id: prompt.id, version: prompt.version, score: result.score, status: result.status });
  await saveDb(req.db);
  res.json(result);
});

app.post('/api/ai-prompts/:id/rollback', requireAccess('communications', 'write'), async (req, res) => {
  const prompt = visibleAiPrompts(req.db, req.user).find((next) => next.id === req.params.id);
  if (!prompt) return res.status(404).json({ error: 'Nie znaleziono promptu AI' });
  const targetVersionNumber = Number(req.body?.version);
  if (!Number.isFinite(targetVersionNumber) || targetVersionNumber < 1) return res.status(400).json({ error: 'Nieprawidłowa wersja rollbacku' });
  const versions = ensurePromptVersionHistory(req.db, req.user, prompt);
  const target = versions.find((version) => Number(version.version) === targetVersionNumber);
  if (!target) return res.status(404).json({ error: 'Nie znaleziono wersji promptu' });
  versions.forEach((version) => { version.status = 'archived'; });
  target.status = 'active';
  prompt.body = target.body;
  prompt.version = target.version;
  prompt.updatedAt = new Date().toISOString();
  prompt.updatedBy = req.user.id;
  pushEvent(req.db, req.user, 'announcements', 'ai_prompt.rollback', { id: prompt.id, version: prompt.version, versionId: target.id });
  await saveDb(req.db);
  res.json({ prompt, activeVersion: target, versions: versions.sort((left, right) => Number(right.version) - Number(left.version)) });
});

app.get('/api/communications', requireAccess('communications'), (req, res) => {
  res.json(visibleCommunications(req.db, req.user));
});

app.post('/api/communications', requireAccess('communications', 'write'), async (req, res) => {
  const payload = communicationPayload(req.db, req.user, req.body ?? {});
  if (payload.error) return res.status(payload.status).json({ error: payload.error });
  const communication = {
    id: req.body?.id ?? `com-${crypto.randomUUID().slice(0, 8)}`,
    ...payload,
  };
  req.db.communications ??= [];
  req.db.communications.unshift(communication);
  const client = req.db.clients.find((next) => next.id === communication.clientId);
  const order = communication.orderId ? req.db.orders.find((next) => next.id === communication.orderId) : null;
  order?.timeline.push({ label: `Komunikacja: ${communication.subject}`, at: communication.startedAt, by: actorName(req.user) });
  pushEvent(req.db, req.user, `branch:${client?.branchId ?? req.user.branchId}:communications`, 'communication.created', {
    id: communication.id,
    clientId: communication.clientId,
    orderId: communication.orderId,
    type: communication.type,
    channel: communication.channel,
    status: communication.status,
  });
  await saveDb(req.db);
  res.status(201).json(communication);
});

app.patch('/api/communications/:id', requireAccess('communications', 'write'), async (req, res) => {
  const communication = communicationForUser(req.db, req.user, req.params.id);
  if (!communication) return res.status(404).json({ error: 'Nie znaleziono komunikacji' });
  const payload = communicationPayload(req.db, req.user, req.body ?? {}, communication);
  if (payload.error) return res.status(payload.status).json({ error: payload.error });
  Object.assign(communication, payload, { id: communication.id });
  const client = req.db.clients.find((next) => next.id === communication.clientId);
  pushEvent(req.db, req.user, `branch:${client?.branchId ?? req.user.branchId}:communications`, 'communication.updated', {
    id: communication.id,
    clientId: communication.clientId,
    orderId: communication.orderId,
    type: communication.type,
    channel: communication.channel,
    status: communication.status,
    assignedUserId: communication.assignedUserId,
  });
  await saveDb(req.db);
  res.json(communication);
});

app.delete('/api/communications/:id', requireAccess('communications', 'write'), async (req, res) => {
  const communication = communicationForUser(req.db, req.user, req.params.id);
  if (!communication) return res.status(404).json({ error: 'Nie znaleziono komunikacji' });
  communication.deletedAt = new Date().toISOString();
  communication.deletedBy = req.user.id;
  communication.updatedAt = communication.deletedAt;
  communication.updatedBy = req.user.id;
  releaseSoftphonePresenceForCommunication(req.db, req.user, communication);
  const client = req.db.clients.find((next) => next.id === communication.clientId);
  pushEvent(req.db, req.user, `branch:${client?.branchId ?? req.user.branchId}:communications`, 'communication.archived', {
    id: communication.id,
    clientId: communication.clientId,
    orderId: communication.orderId,
    deletedAt: communication.deletedAt,
  });
  await saveDb(req.db);
  res.json({ communication, archived: true, deleted: false });
});

app.post('/api/communications/:id/analyze', requireAccess('communications', 'write'), async (req, res) => {
  const communication = communicationForUser(req.db, req.user, req.params.id);
  if (!communication) return res.status(404).json({ error: 'Nie znaleziono komunikacji' });
  if (!['completed', 'missed'].includes(communication.status)) return res.status(409).json({ error: 'Analiza wymaga zakończonej lub nieodebranej rozmowy', status: communication.status });
  const prompt = activePromptForCommunication(req.db, req.user, communication, req.body?.promptId);
  if (!prompt) return res.status(404).json({ error: 'Nie znaleziono promptu AI dla tej komunikacji' });
  const transcriptText = communicationTranscriptText(communication, req.body?.transcript);
  if (transcriptText.length < 10) return res.status(400).json({ error: 'Transkrypcja musi mieć co najmniej 10 znaków' });
  const result = promptDrivenAnalysis(communication, prompt, transcriptText);
  communication.analysis = result.analysis;
  communication.analysisPromptId = prompt.id;
  communication.analysisPromptVersion = Number(prompt.version ?? 1);
  communication.analysisModel = openaiKey ? openaiModel : 'deterministic-local-rubric';
  communication.analysisUpdatedAt = new Date().toISOString();
  communication.analysisStatus = result.status;
  communication.coachingTags = result.tags;
  if (Array.isArray(req.body?.transcript)) {
    communication.transcript = req.body.transcript.map((line, index) => ({
      speaker: String(line.speaker ?? (index % 2 ? 'Klient' : 'Biuro')).trim(),
      text: String(line.text ?? '').trim(),
      atSec: Number.isFinite(Number(line.atSec)) ? Math.max(0, Math.round(Number(line.atSec))) : index * 20,
    })).filter((line) => line.text);
  }
  const order = communication.orderId ? req.db.orders.find((next) => next.id === communication.orderId) : null;
  if (order) {
    order.timeline.push({
      label: `AI analiza rozmowy: ${communication.analysis.score}/100 (${prompt.name})`,
      at: communication.analysisUpdatedAt,
      by: actorName(req.user),
    });
  }
  const client = req.db.clients.find((next) => next.id === communication.clientId);
  pushEvent(req.db, req.user, `branch:${client?.branchId ?? req.user.branchId}:communications`, 'communication.analysis_ready', {
    id: communication.id,
    clientId: communication.clientId,
    orderId: communication.orderId,
    promptId: prompt.id,
    promptVersion: prompt.version,
    score: communication.analysis.score,
    status: communication.analysisStatus,
    tags: communication.coachingTags,
  });
  await saveDb(req.db);
  res.json({ communication, prompt, analysis: communication.analysis, coachingTags: communication.coachingTags });
});

app.post('/api/communications/:id/recording', requireAccess('communications', 'write'), async (req, res) => {
  const communication = communicationForUser(req.db, req.user, req.params.id);
  if (!communication) return res.status(404).json({ error: 'Nie znaleziono komunikacji' });
  if (!['call', 'meeting'].includes(communication.type)) return res.status(409).json({ error: 'Nagrania można dodać tylko do rozmowy albo spotkania', type: communication.type });

  const body = req.body ?? {};
  const integrationSettings = currentIntegrationSettings(req.db, req.user);
  const recordingUrl = optionalText(body.recordingUrl ?? body.audioUrl);
  const recordingId = optionalText(body.recordingId ?? body.providerCallId ?? body.callId);
  const hasTranscriptInput = Object.prototype.hasOwnProperty.call(body, 'transcript');
  const transcriptLines = hasTranscriptInput
    ? normalizeTranscriptLines(body.transcript)
    : normalizeTranscriptLines(communication.transcript);
  const hasUsefulPayload = Boolean(recordingUrl || recordingId || hasTranscriptInput || body.recordingStatus || body.transcriptStatus);
  if (!hasUsefulPayload) return res.status(400).json({ error: 'Podaj recordingUrl, recordingId, transcript albo status przetwarzania' });

  const receivedAt = parseOptionalDate(body.receivedAt) ?? new Date();
  const durationSec = body.durationSec == null ? null : Number(body.durationSec);
  if (durationSec != null && (!Number.isFinite(durationSec) || durationSec < 0)) {
    return res.status(400).json({ error: 'Czas nagrania jest nieprawidłowy' });
  }

  const sourceResult = communicationRecordingSource(body.recordingSource ?? body.source ?? body.provider, communication);
  if (sourceResult.error) return res.status(400).json(sourceResult);
  const recordingStatus = communicationRecordingStatus(body.recordingStatus, recordingUrl || recordingId);
  if (recordingStatus.error) return res.status(400).json(recordingStatus);
  const transcriptStatus = communicationTranscriptStatus(body.transcriptStatus, transcriptLines.length);
  if (transcriptStatus.error) return res.status(400).json(transcriptStatus);
  const requestedStatus = optionalText(body.status);
  if (requestedStatus && !communicationStatuses.has(requestedStatus)) {
    return res.status(400).json({ error: 'Status komunikacji jest nieprawidłowy' });
  }

  if (recordingUrl) communication.recordingUrl = recordingUrl;
  if (recordingId) communication.recordingId = recordingId;
  communication.recordingSource = sourceResult.source;
  communication.recordingStatus = recordingStatus.status;
  communication.transcriptStatus = transcriptStatus.status;
  communication.recordingReceivedAt = receivedAt.toISOString();
  if (body.recordingConsent != null) communication.recordingConsent = Boolean(body.recordingConsent);
  if (durationSec != null) communication.durationSec = Math.round(durationSec);
  if (hasTranscriptInput) communication.transcript = transcriptLines;

  if (requestedStatus) {
    communication.status = requestedStatus;
  } else if (['queued', 'ringing', 'active'].includes(communication.status) && (communication.recordingStatus === 'ready' || communication.transcriptStatus === 'ready')) {
    communication.status = 'completed';
  }
  if (communication.status === 'completed' && communication.channel === 'web_softphone') {
    communication.queueStatus = 'completed';
    releaseSoftphonePresenceForCommunication(req.db, req.user, communication);
  }

  let prompt = null;
  let analysis = null;
  let analysisSkippedReason = null;
  const transcriptText = communicationTranscriptText(communication);
  const sourceAllowsAnalyze = communication.recordingSource === 'zadarma'
    ? integrationSettings.zadarma.autoAnalyzeRecordings
    : integrationSettings.ai.autoAnalyze;
  const shouldAnalyze = body.autoAnalyze !== false && sourceAllowsAnalyze && transcriptText.length >= 10;
  if (shouldAnalyze) {
    prompt = activePromptForCommunication(req.db, req.user, communication, body.promptId);
    if (!prompt && body.promptId) return res.status(404).json({ error: 'Nie znaleziono promptu AI dla tej komunikacji' });
    if (prompt) {
      const result = promptDrivenAnalysis(communication, prompt, transcriptText);
      communication.analysis = result.analysis;
      communication.analysisPromptId = prompt.id;
      communication.analysisPromptVersion = Number(prompt.version ?? 1);
      communication.analysisModel = openaiKey ? openaiModel : 'deterministic-local-rubric';
      communication.analysisUpdatedAt = new Date().toISOString();
      communication.analysisStatus = result.status;
      communication.coachingTags = result.tags;
      analysis = communication.analysis;
    } else {
      analysisSkippedReason = 'no_active_prompt';
    }
  } else if (body.autoAnalyze !== false) {
    analysisSkippedReason = !sourceAllowsAnalyze ? 'auto_analysis_disabled' : (transcriptText.length ? 'transcript_too_short' : 'no_transcript');
  }

  const client = req.db.clients.find((next) => next.id === communication.clientId);
  const order = communication.orderId ? req.db.orders.find((next) => next.id === communication.orderId) : null;
  if (order) {
    const details = [
      communication.recordingStatus === 'ready' ? 'nagranie' : null,
      communication.transcriptStatus === 'ready' ? 'transkrypcja' : null,
      analysis ? `AI ${analysis.score}/100` : null,
    ].filter(Boolean).join(', ');
    order.timeline.push({
      label: `Komunikacja z klientem zaktualizowana: ${details || 'material odebrany do przetworzenia'}`,
      at: receivedAt.toISOString(),
      by: actorName(req.user),
    });
  }

  pushEvent(req.db, req.user, `branch:${client?.branchId ?? req.user.branchId}:communications`, 'communication.recording_ready', {
    id: communication.id,
    clientId: communication.clientId,
    orderId: communication.orderId,
    recordingUrl: communication.recordingUrl,
    recordingId: communication.recordingId,
    recordingSource: communication.recordingSource,
    recordingStatus: communication.recordingStatus,
    transcriptStatus: communication.transcriptStatus,
    transcriptLines: communication.transcript?.length ?? 0,
    analysisScore: analysis?.score,
    promptId: prompt?.id,
    promptVersion: prompt?.version,
  });
  await saveDb(req.db);
  res.json({ communication, prompt, analysis, analysisSkippedReason });
});

app.get('/api/ai/coaching', requireAccess('communications'), (req, res) => {
  const rows = visibleCommunications(req.db, req.user)
    .filter((communication) => !req.query.channel || communication.channel === req.query.channel)
    .filter((communication) => !req.query.userId || communication.userId === req.query.userId);
  res.json(coachingScorecard(req.db, req.user, rows));
});

const workflowStatuses = new Set(['draft', 'live', 'paused', 'archived']);
const workflowOperators = new Set(['equals', 'not_equals', 'contains', 'greater_than', 'less_than', 'exists']);
const workflowDelayUnits = new Set(['minutes', 'hours', 'days']);
const workflowRollbackStrategies = new Set(['none', 'manual', 'automatic']);

function normalizeWorkflowList(value, fallback = []) {
  const raw = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/\n|,/)
      : fallback;
  return raw
    .map((item) => String(item ?? '').trim())
    .filter(Boolean)
    .slice(0, 50);
}

function normalizeWorkflowConditions(value, fallback = []) {
  const source = Array.isArray(value) ? value : fallback;
  const conditions = [];
  for (const item of source.slice(0, 25)) {
    const field = String(item?.field ?? '').trim();
    if (!field) return { error: 'Każdy warunek workflow musi mieć pole' };
    const operator = String(item?.operator ?? 'equals').trim();
    if (!workflowOperators.has(operator)) return { error: `Nieprawidłowy operator warunku: ${operator}` };
    const condition = { field, operator };
    if (item?.value !== undefined && ['string', 'number', 'boolean'].includes(typeof item.value)) {
      condition.value = item.value;
    } else if (item?.value !== undefined && item.value !== null) {
      condition.value = String(item.value);
    }
    conditions.push(condition);
  }
  return { conditions };
}

function normalizeWorkflowDelays(value, fallback = []) {
  const source = Array.isArray(value) ? value : fallback;
  const delays = [];
  for (const item of source.slice(0, 10)) {
    const amount = Number(item?.amount ?? 0);
    const unit = String(item?.unit ?? 'minutes').trim();
    if (!Number.isFinite(amount) || amount < 0) return { error: 'Opóźnienie workflow musi być liczbą dodatnią albo zerem' };
    if (!workflowDelayUnits.has(unit)) return { error: `Nieprawidłowa jednostka opóźnienia: ${unit}` };
    delays.push({ amount, unit });
  }
  return { delays };
}

function buildWorkflowPayload(db, user, body, existing = null) {
  const name = String(body?.name ?? existing?.name ?? '').trim();
  if (name.length < 3) return { status: 400, error: 'Nazwa workflow musi mieć co najmniej 3 znaki' };
  const trigger = String(body?.trigger ?? existing?.trigger ?? '').trim();
  if (trigger.length < 3) return { status: 400, error: 'Trigger workflow musi mieć co najmniej 3 znaki' };
  const status = String(body?.status ?? existing?.status ?? 'draft').trim();
  if (!workflowStatuses.has(status)) return { status: 400, error: 'Status workflow musi być draft, live albo paused' };
  if (!existing && status === 'archived') return { status: 400, error: 'Nowy workflow nie może startować jako archived' };
  const actions = normalizeWorkflowList(body?.actions, existing?.actions ?? []);
  if (!actions.length) return { status: 400, error: 'Workflow musi mieć przynajmniej jedną akcję' };
  const normalizedConditions = normalizeWorkflowConditions(body?.conditions, existing?.conditions ?? []);
  if (normalizedConditions.error) return { status: 400, error: normalizedConditions.error };
  const normalizedDelays = normalizeWorkflowDelays(body?.delays, existing?.delays ?? []);
  if (normalizedDelays.error) return { status: 400, error: normalizedDelays.error };
  const rollbackStrategy = String(body?.rollbackStrategy ?? existing?.rollbackStrategy ?? 'none').trim();
  if (!workflowRollbackStrategies.has(rollbackStrategy)) return { status: 400, error: 'Rollback workflow musi być none, manual albo automatic' };
  const now = new Date().toISOString();
  return {
    workflow: {
      id: existing?.id ?? `wf-${crypto.randomUUID().slice(0, 8)}`,
      tenantId: tenantIdForUser(db, user),
      name,
      trigger,
      status,
      killSwitch: body?.killSwitch === undefined ? Boolean(existing?.killSwitch ?? false) : Boolean(body.killSwitch),
      actions,
      conditions: normalizedConditions.conditions,
      delays: normalizedDelays.delays,
      approvalRequired: body?.approvalRequired === undefined ? Boolean(existing?.approvalRequired ?? false) : Boolean(body.approvalRequired),
      rollbackStrategy,
      description: String(body?.description ?? existing?.description ?? '').trim().slice(0, 1000),
      lastRunAt: existing?.lastRunAt,
      runCount: Number(existing?.runCount ?? 0),
      successRate: Number(existing?.successRate ?? 0),
      updatedAt: now,
      updatedBy: user.id,
    },
  };
}

function workflowSampleValue(sample, field) {
  return String(field).split('.').reduce((current, key) => (
    current && Object.prototype.hasOwnProperty.call(current, key) ? current[key] : undefined
  ), sample ?? {});
}

function workflowConditionPasses(actual, operator, expected) {
  if (operator === 'exists') return actual !== undefined && actual !== null && String(actual).trim() !== '';
  if (operator === 'contains') return String(actual ?? '').toLowerCase().includes(String(expected ?? '').toLowerCase());
  if (operator === 'greater_than') return Number(actual) > Number(expected);
  if (operator === 'less_than') return Number(actual) < Number(expected);
  const left = String(actual ?? '').toLowerCase();
  const right = String(expected ?? '').toLowerCase();
  return operator === 'not_equals' ? left !== right : left === right;
}

function evaluateWorkflowConditions(workflow, sample) {
  const conditions = workflow.conditions ?? [];
  if (!conditions.length) return { pass: true, log: ['Conditions checked: none'] };
  const log = [];
  let pass = true;
  conditions.forEach((condition) => {
    const actual = workflowSampleValue(sample, condition.field);
    const conditionPassed = workflowConditionPasses(actual, condition.operator, condition.value);
    if (!conditionPassed) pass = false;
    const expected = condition.operator === 'exists' ? 'present' : String(condition.value ?? '');
    log.push(`Condition ${condition.field} ${condition.operator} ${expected}: ${conditionPassed ? 'PASS' : 'FAIL'}`);
  });
  return { pass, log };
}

function workflowDryRun(workflow, body = {}) {
  const sample = body?.sample ?? body?.event ?? {};
  const conditionResult = evaluateWorkflowConditions(workflow, sample);
  const log = [
    `Test trigger: ${workflow.trigger}`,
    ...conditionResult.log,
    `Actions checked: ${(workflow.actions ?? []).length}`,
  ];
  if ((workflow.delays ?? []).length) {
    log.push(`Delays checked: ${workflow.delays.map((delay) => `${delay.amount} ${delay.unit}`).join(', ')}`);
  }
  let status = 'success';
  if (workflow.killSwitch) {
    status = 'waiting_approval';
    log.push('Kill switch active - execution blocked');
  } else if (workflow.status === 'paused') {
    status = 'failed';
    log.push('Workflow paused - dry run blocked');
  } else if (!conditionResult.pass) {
    status = 'failed';
    log.push('Conditions failed - no production action executed');
  } else if (workflow.approvalRequired) {
    status = 'waiting_approval';
    log.push('Human approval required before live execution');
  } else {
    log.push('Dry run completed without side effects');
  }
  return { status, log };
}

function updateWorkflowStats(workflow, status, now) {
  const previousRuns = Number(workflow.runCount ?? 0);
  const previousSuccesses = Math.round((Number(workflow.successRate ?? 0) / 100) * previousRuns);
  const nextRuns = previousRuns + 1;
  const nextSuccesses = previousSuccesses + (status === 'success' ? 1 : 0);
  workflow.lastRunAt = now;
  workflow.runCount = nextRuns;
  workflow.successRate = Math.round((nextSuccesses / nextRuns) * 100);
}

function recalculateWorkflowStats(db, user, workflow) {
  const runs = visibleWorkflowRuns(db, user).filter((run) => run.workflowId === workflow.id);
  if (!runs.length) return;
  workflow.lastRunAt = runs
    .map((run) => run.completedAt ?? run.startedAt)
    .filter(Boolean)
    .sort()
    .at(-1);
  workflow.runCount = runs.length;
  workflow.successRate = Math.round((runs.filter((run) => run.status === 'success').length / runs.length) * 100);
}

function workflowEventFromBody(body = {}) {
  const event = body?.event ?? body?.sample ?? {};
  if (!event || typeof event !== 'object' || Array.isArray(event)) return {};
  return event;
}

function workflowDelayMs(workflow) {
  return (workflow.delays ?? []).reduce((total, delay) => {
    const amount = Math.max(0, Number(delay.amount ?? 0));
    const unitMs = delay.unit === 'days'
      ? 24 * 60 * 60 * 1000
      : delay.unit === 'hours'
        ? 60 * 60 * 1000
        : 60 * 1000;
    return total + amount * unitMs;
  }, 0);
}

function workflowScheduledFor(workflow, now = new Date()) {
  const delayMs = workflowDelayMs(workflow);
  return delayMs > 0 ? new Date(now.getTime() + delayMs).toISOString() : null;
}

function workflowExecutionPlan(workflow, event, options = {}) {
  const conditionResult = evaluateWorkflowConditions(workflow, event);
  const log = [
    `Execute trigger: ${workflow.trigger}`,
    ...conditionResult.log,
    `Actions planned: ${(workflow.actions ?? []).length}`,
  ];
  if ((workflow.delays ?? []).length) {
    log.push(`Delays queued: ${workflow.delays.map((delay) => `${delay.amount} ${delay.unit}`).join(', ')}`);
  }
  if (workflow.killSwitch) {
    log.push('Kill switch active - execution blocked until administrator enables workflow');
    return { status: 'waiting_approval', log };
  }
  if (workflow.status !== 'live') {
    log.push(`Workflow status ${workflow.status} - live execution blocked`);
    return { status: 'failed', log };
  }
  if (!conditionResult.pass) {
    log.push('Conditions failed - no production action executed');
    return { status: 'failed', log };
  }
  if (workflow.approvalRequired) {
    log.push('Human approval required - waiting before executing actions');
    return { status: 'waiting_approval', log };
  }
  const scheduledFor = !options.ignoreDelays ? workflowScheduledFor(workflow, options.now) : null;
  if (scheduledFor) {
    log.push(`Execution scheduled for ${scheduledFor}`);
    return { status: 'scheduled', log, scheduledFor };
  }
  return { status: 'success', log };
}

function workflowActionEventName(action) {
  const lower = String(action ?? '').toLowerCase();
  if (lower.includes('sms')) return 'workflow.sms_queued';
  if (lower.includes('email') || lower.includes('mail')) return 'workflow.email_queued';
  if (lower.includes('push')) return 'workflow.push_queued';
  if (lower.includes('zadanie') || lower.includes('task')) return 'workflow.task_created';
  if (lower.includes('powiadom') || lower.includes('notify')) return 'workflow.notification_sent';
  if (lower.includes('dokument') || lower.includes('document')) return 'workflow.document_requested';
  if (lower.includes('status')) return 'workflow.status_change_requested';
  return 'workflow.action_executed';
}

function workflowEventChannel(db, user, event) {
  const branchId = String(event?.branchId ?? user.branchId ?? '').trim();
  if (branchId && sameTenantBranch(db, user, branchId)) return `branch:${branchId}:orders`;
  return 'announcements';
}

function taskPriorityFromEvent(event) {
  const raw = String(event?.priority ?? event?.urgency ?? '').toLowerCase();
  if (['pilny', 'urgent', 'krytyczny', 'critical'].includes(raw)) return 'urgent';
  if (['wysoki', 'high'].includes(raw)) return 'high';
  if (['niski', 'low'].includes(raw)) return 'low';
  return 'normal';
}

function workflowTaskAssignee(db, user, event, branchId) {
  const users = visibleUsers(db, user);
  const requestedId = event?.assignedUserId ?? event?.assignedEstimatorId ?? event?.userId;
  const requested = users.find((next) => next.id === requestedId && sameTenantBranch(db, user, next.branchId));
  if (requested) return requested.id;
  const manager = users.find((next) => next.role === 'KIEROWNIK' && next.branchId === branchId);
  if (manager) return manager.id;
  const director = users.find((next) => ['DYREKTOR', 'ROP', 'ADMINISTRATOR'].includes(next.role) && sameTenantBranch(db, user, next.branchId));
  return director?.id ?? user.id;
}

function createWorkflowTask(db, user, workflow, action, event, runId) {
  db.tasks ??= [];
  const branchId = event?.branchId && sameTenantBranch(db, user, event.branchId) ? event.branchId : user.branchId;
  const client = event?.clientId ? visibleClients(db, user).find((next) => next.id === event.clientId) : null;
  const order = event?.orderId ? visibleOrders(db, user).find((next) => next.id === event.orderId) : null;
  const subject = client?.name ?? order?.id ?? workflow.name;
  const now = new Date().toISOString();
  const task = {
    id: nextSequenceId('task', db.tasks),
    tenantId: tenantIdForUser(db, user),
    title: `${action}: ${subject}`,
    status: 'open',
    priority: taskPriorityFromEvent(event),
    source: 'workflow',
    sourceId: event?.sourceEventId ?? runId,
    workflowId: workflow.id,
    workflowRunId: runId,
    clientId: client?.id ?? event?.clientId,
    orderId: order?.id ?? event?.orderId,
    branchId,
    assignedUserId: workflowTaskAssignee(db, user, event, branchId),
    teamId: event?.teamId,
    dueAt: event?.dueAt,
    notes: `Automatyzacja: ${workflow.name}. Trigger: ${workflow.trigger}.`,
    createdAt: now,
    createdBy: user.id,
  };
  db.tasks.unshift(task);
  return task;
}

function workflowMessageBody(type, action, event) {
  if (type === 'email') {
    return String(event?.emailBody ?? event?.messageBody ?? event?.message ?? `${action}: automatyczna wiadomość z Arbor OS.`).trim();
  }
  return String(event?.smsBody ?? event?.messageBody ?? event?.message ?? `${action}: automatyczna wiadomość z Arbor OS.`).trim();
}

function createWorkflowMessage(db, user, workflow, action, event, runId, type) {
  const result = createOutgoingCommunication(db, user, {
    type,
    clientId: event?.clientId,
    orderId: event?.orderId,
    subject: event?.messageSubject ?? action,
    body: workflowMessageBody(type, action, event),
    source: 'workflow',
    relatedCommunicationId: event?.communicationId,
    intent: `Workflow: ${workflow.name}`,
    nextActions: [`Run workflow: ${runId}`],
  });
  if (result.communication) {
    result.communication.workflowId = workflow.id;
    result.communication.workflowRunId = runId;
  }
  return result;
}

function workflowDocumentSubject(event) {
  const subjectType = event?.documentSubjectType ?? event?.subjectType;
  const subjectId = event?.documentSubjectId ?? event?.subjectId;
  if (subjectType && subjectId) return { subjectType, subjectId };
  if (event?.orderId) return { subjectType: 'order', subjectId: event.orderId };
  if (event?.clientId) return { subjectType: 'client', subjectId: event.clientId };
  if (event?.employeeId) return { subjectType: 'employee', subjectId: event.employeeId };
  if (event?.equipmentId) return { subjectType: 'equipment', subjectId: event.equipmentId };
  return { subjectType: null, subjectId: null };
}

function createWorkflowDocument(db, user, event) {
  const templateId = event?.documentTemplateId ?? event?.templateId;
  if (!templateId) return { skipped: 'missing_template' };
  const template = visibleDocumentTemplates(db, user).find((next) => next.id === templateId);
  if (!template) return { skipped: 'template_not_found' };
  if (template.status === 'archived') return { skipped: 'template_archived' };
  const { subjectType, subjectId } = workflowDocumentSubject(event);
  if (!subjectType || !subjectId) return { skipped: 'missing_subject' };
  if (template.scope !== subjectType) return { skipped: 'template_scope_mismatch' };
  const context = buildDocumentContext(db, user, subjectType, subjectId);
  if (context.error) return { skipped: context.error };
  const rendered = renderDocumentTemplate(template, context.context);
  const document = {
    id: `doc-${crypto.randomUUID().slice(0, 8)}`,
    tenantId: tenantIdForUser(db, user),
    templateId,
    requirementId: event?.requirementId,
    subjectType,
    subjectId,
    status: rendered.missingFields.length ? 'draft' : 'ready',
    createdAt: new Date().toISOString(),
    createdBy: user.id,
    summary: `${template.name} wygenerowany automatycznie dla ${subjectType}:${subjectId}`,
    content: rendered.content,
    fileName: documentFileName(template, subjectType, subjectId),
    missingFields: rendered.missingFields,
  };
  db.generatedDocuments ??= [];
  db.generatedDocuments.unshift(document);
  pushEvent(db, user, 'announcements', 'document.generated', {
    id: document.id,
    templateId,
    subjectType,
    subjectId,
    status: document.status,
    missingFields: document.missingFields,
    source: 'workflow',
  });
  return { document };
}

function applyWorkflowStatusChange(db, user, event) {
  const targetStatus = event?.targetStatus ?? event?.nextStatus ?? event?.workflowStatus;
  if (!targetStatus) return { skipped: 'missing_target_status' };
  if (event?.orderId) {
    const order = visibleOrders(db, user).find((next) => next.id === event.orderId);
    if (!order) return { skipped: 'order_not_found' };
    if (!orderStatuses.has(targetStatus)) return { skipped: 'invalid_order_status' };
    const previousStatus = order.status;
    order.status = targetStatus;
    order.timeline.push({ label: `Status workflow: ${targetStatus}`, at: new Date().toISOString(), by: actorName(user) });
    pushEvent(db, user, `branch:${order.branchId}:orders`, 'order.status_changed', { id: order.id, status: order.status, source: 'workflow' });
    return { entity: 'order', id: order.id, previousStatus, status: order.status };
  }
  if (event?.valuationId) {
    const valuation = visibleValuations(db, user).find((next) => next.id === event.valuationId);
    if (!valuation) return { skipped: 'valuation_not_found' };
    if (!valuationStatuses.has(targetStatus)) return { skipped: 'invalid_valuation_status' };
    const previousStatus = valuation.status;
    valuation.status = targetStatus;
    pushEvent(db, user, 'valuations', 'valuation.transition', { id: valuation.id, status: valuation.status, source: 'workflow' });
    return { entity: 'valuation', id: valuation.id, previousStatus, status: valuation.status };
  }
  if (event?.invoiceId) {
    const invoice = visibleInvoices(db, user).find((next) => next.id === event.invoiceId);
    if (!invoice) return { skipped: 'invoice_not_found' };
    if (!invoiceStatuses.has(targetStatus)) return { skipped: 'invalid_invoice_status' };
    const previousStatus = invoice.status;
    const previousPaidAt = invoice.paidAt;
    invoice.status = targetStatus;
    invoice.paidAt = targetStatus === 'oplacona' ? new Date().toISOString() : invoice.paidAt;
    pushEvent(db, user, 'invoices', 'invoice.status_changed', { id: invoice.id, status: invoice.status, source: 'workflow' });
    return { entity: 'invoice', id: invoice.id, previousStatus, previousPaidAt, status: invoice.status };
  }
  return { skipped: 'missing_target_entity' };
}

function executeWorkflowAction(db, user, workflow, action, event, runId, index, effects = []) {
  const eventName = workflowActionEventName(action);
  const task = eventName === 'workflow.task_created'
    ? createWorkflowTask(db, user, workflow, action, event, runId)
    : null;
  const messageResult = eventName === 'workflow.sms_queued' || eventName === 'workflow.email_queued'
    ? createWorkflowMessage(db, user, workflow, action, event, runId, eventName === 'workflow.email_queued' ? 'email' : 'sms')
    : null;
  const documentResult = eventName === 'workflow.document_requested'
    ? createWorkflowDocument(db, user, event)
    : null;
  const statusResult = eventName === 'workflow.status_change_requested'
    ? applyWorkflowStatusChange(db, user, event)
    : null;
  if (task) {
    effects.push({
      id: `${runId}-effect-${index + 1}`,
      type: 'task_created',
      entity: 'task',
      entityId: task.id,
      nextStatus: task.status,
      reversible: true,
    });
  }
  if (messageResult?.communication) {
    effects.push({
      id: `${runId}-effect-${index + 1}`,
      type: 'communication_created',
      entity: 'communication',
      entityId: messageResult.communication.id,
      nextStatus: messageResult.communication.deliveryStatus,
      reversible: messageResult.communication.deliveryStatus === 'queued',
    });
  }
  if (documentResult?.document) {
    effects.push({
      id: `${runId}-effect-${index + 1}`,
      type: 'document_generated',
      entity: 'document',
      entityId: documentResult.document.id,
      nextStatus: documentResult.document.status,
      reversible: documentResult.document.status !== 'signed',
    });
  }
  if (statusResult?.entity) {
    effects.push({
      id: `${runId}-effect-${index + 1}`,
      type: 'status_changed',
      entity: statusResult.entity,
      entityId: statusResult.id,
      previousStatus: statusResult.previousStatus,
      nextStatus: statusResult.status,
      previousPaidAt: statusResult.previousPaidAt,
      reversible: Boolean(statusResult.previousStatus),
    });
  }
  pushEvent(db, user, workflowEventChannel(db, user, event), eventName, {
    id: `${runId}-action-${index + 1}`,
    workflowId: workflow.id,
    runId,
    trigger: workflow.trigger,
    action,
    taskId: task?.id,
    taskTitle: task?.title,
    communicationId: messageResult?.communication?.id,
    deliveryStatus: messageResult?.communication?.deliveryStatus,
    deliveryProvider: messageResult?.communication?.deliveryProvider,
    documentId: documentResult?.document?.id,
    documentStatus: documentResult?.document?.status,
    statusTarget: statusResult?.entity,
    statusTargetId: statusResult?.id,
    nextStatus: statusResult?.status,
    skipped: messageResult?.skipped ?? documentResult?.skipped ?? statusResult?.skipped,
    clientId: event.clientId,
    orderId: event.orderId,
    branchId: event.branchId,
  });
  if (messageResult?.communication) return `Action ${index + 1} executed: ${action} -> ${eventName} (${messageResult.communication.id})`;
  if (messageResult?.skipped) return `Action ${index + 1} skipped: ${action} -> ${messageResult.skipped}`;
  if (documentResult?.document) return `Action ${index + 1} executed: ${action} -> ${eventName} (${documentResult.document.id})`;
  if (documentResult?.skipped) return `Action ${index + 1} skipped: ${action} -> ${documentResult.skipped}`;
  if (statusResult?.entity) return `Action ${index + 1} executed: ${action} -> ${statusResult.entity}:${statusResult.id}=${statusResult.status}`;
  if (statusResult?.skipped) return `Action ${index + 1} skipped: ${action} -> ${statusResult.skipped}`;
  return task
    ? `Action ${index + 1} executed: ${action} -> ${eventName} (${task.id})`
    : `Action ${index + 1} executed: ${action} -> ${eventName}`;
}

function executeWorkflow(db, user, workflow, event, options = {}) {
  const now = new Date().toISOString();
  const run = {
    id: `run-${crypto.randomUUID().slice(0, 8)}`,
    tenantId: tenantIdForUser(db, user),
    workflowId: workflow.id,
    trigger: workflow.trigger,
    status: 'failed',
    startedAt: now,
    dryRun: Boolean(options.dryRun),
    automatic: Boolean(options.automatic),
    sourceEventId: options.sourceEventId,
    sourceEventName: options.sourceEventName,
    event,
    actionsExecuted: 0,
    effects: [],
    log: [],
  };
  const plan = workflowExecutionPlan(workflow, event);
  run.status = plan.status;
  run.scheduledFor = plan.scheduledFor;
  run.log = [...plan.log];
  if (run.status === 'success') {
    if (run.dryRun) {
      run.log.push('Dry run execution completed without side effects');
    } else {
      (workflow.actions ?? []).forEach((action, index) => {
        run.log.push(executeWorkflowAction(db, user, workflow, action, event, run.id, index, run.effects));
        run.actionsExecuted += 1;
      });
    }
  } else if (run.status === 'scheduled') {
    run.log.push('No production action executed yet - run is scheduled');
  } else {
    run.log.push('No production action executed');
  }
  if (!['waiting_approval', 'scheduled'].includes(run.status)) run.completedAt = now;
  updateWorkflowStats(workflow, run.status, now);
  db.workflowRuns ??= [];
  db.workflowRuns.unshift(run);
  const eventName = run.dryRun ? 'workflow.execution_checked' : run.status === 'scheduled' ? 'workflow.scheduled' : 'workflow.executed';
  pushEvent(db, user, 'announcements', eventName, {
    id: workflow.id,
    runId: run.id,
    trigger: workflow.trigger,
    status: run.status,
    actionsExecuted: run.actionsExecuted,
    scheduledFor: run.scheduledFor,
    automatic: run.automatic,
    sourceEventId: run.sourceEventId,
    sourceEventName: run.sourceEventName,
  });
  return { workflow, run };
}

function workflowRunDecisionComment(body = {}) {
  const comment = String(body.comment ?? body.reason ?? '').trim();
  return comment.slice(0, 500);
}

function approveWorkflowRun(db, user, run, body = {}) {
  if (run.status !== 'waiting_approval') return { error: 'Workflow run nie oczekuje na akceptacje', status: 409 };
  if (run.dryRun) return { error: 'Nie można zatwierdzić testowego workflow run', status: 409 };
  if (!run.event || typeof run.event !== 'object') return { error: 'Brak danych eventu do wykonania workflow', status: 409 };
  const workflow = visibleWorkflows(db, user, { includeArchived: true }).find((next) => next.id === run.workflowId);
  if (!workflow) return { error: 'Nie znaleziono workflow', status: 404 };
  if (workflow.killSwitch) return { error: 'Kill switch jest aktywny - najpierw włącz workflow', status: 409 };
  const now = new Date().toISOString();
  const plan = workflowExecutionPlan({ ...workflow, approvalRequired: false }, run.event, { ignoreDelays: true });
  run.approvedAt = now;
  run.approvedBy = user.id;
  run.approvalComment = workflowRunDecisionComment(body);
  run.log.push(`Approved by ${actorName(user)}${run.approvalComment ? `: ${run.approvalComment}` : ''}`);
  run.log.push(...plan.log.map((entry) => `Approval check: ${entry}`));
  if (plan.status !== 'success') {
    run.status = 'failed';
    run.completedAt = now;
    run.log.push('Approval failed because workflow is no longer executable');
    recalculateWorkflowStats(db, user, workflow);
    pushEvent(db, user, 'announcements', 'workflow.approval_failed', {
      id: workflow.id,
      runId: run.id,
      status: run.status,
      reason: plan.status,
    });
    return { workflow, run, approved: false };
  }
  (workflow.actions ?? []).forEach((action, index) => {
    run.effects ??= [];
    run.log.push(executeWorkflowAction(db, user, workflow, action, run.event, run.id, index, run.effects));
    run.actionsExecuted = Number(run.actionsExecuted ?? 0) + 1;
  });
  run.status = 'success';
  run.completedAt = now;
  run.log.push(`Approval execution completed with ${run.actionsExecuted} actions`);
  recalculateWorkflowStats(db, user, workflow);
  pushEvent(db, user, 'announcements', 'workflow.approved', {
    id: workflow.id,
    runId: run.id,
    status: run.status,
    actionsExecuted: run.actionsExecuted,
    approvedBy: user.id,
  });
  return { workflow, run, approved: true };
}

function rejectWorkflowRun(db, user, run, body = {}) {
  if (run.status !== 'waiting_approval') return { error: 'Workflow run nie oczekuje na decyzje', status: 409 };
  const workflow = visibleWorkflows(db, user, { includeArchived: true }).find((next) => next.id === run.workflowId);
  if (!workflow) return { error: 'Nie znaleziono workflow', status: 404 };
  const now = new Date().toISOString();
  run.status = 'rejected';
  run.completedAt = now;
  run.rejectedAt = now;
  run.rejectedBy = user.id;
  run.approvalComment = workflowRunDecisionComment(body);
  run.log.push(`Rejected by ${actorName(user)}${run.approvalComment ? `: ${run.approvalComment}` : ''}`);
  recalculateWorkflowStats(db, user, workflow);
  pushEvent(db, user, 'announcements', 'workflow.rejected', {
    id: workflow.id,
    runId: run.id,
    status: run.status,
    rejectedBy: user.id,
  });
  return { workflow, run, rejected: true };
}

function processScheduledWorkflowRun(db, user, run, now) {
  if (run.status !== 'scheduled') return { error: 'Workflow run nie jest zaplanowany', status: 409 };
  if (!run.scheduledFor || new Date(run.scheduledFor).getTime() > now.getTime()) return { skipped: 'not_due', run };
  const workflow = visibleWorkflows(db, user).find((next) => next.id === run.workflowId);
  if (!workflow) {
    run.status = 'failed';
    run.completedAt = now.toISOString();
    run.processedAt = now.toISOString();
    run.log.push('Scheduled execution failed: workflow not found');
    return { run, processed: false };
  }
  const plan = workflowExecutionPlan({ ...workflow, approvalRequired: false, delays: [] }, run.event ?? {}, { ignoreDelays: true, now });
  run.processedAt = now.toISOString();
  run.log.push(`Scheduled processor started at ${run.processedAt}`);
  run.log.push(...plan.log.map((entry) => `Scheduled check: ${entry}`));
  if (workflow.killSwitch || workflow.status !== 'live' || plan.status !== 'success') {
    run.status = 'failed';
    run.completedAt = now.toISOString();
    run.log.push('Scheduled execution failed before actions');
    recalculateWorkflowStats(db, user, workflow);
    pushEvent(db, user, 'announcements', 'workflow.schedule_failed', {
      id: workflow.id,
      runId: run.id,
      status: run.status,
      reason: workflow.killSwitch ? 'kill_switch' : plan.status,
    });
    return { workflow, run, processed: false };
  }
  run.effects ??= [];
  (workflow.actions ?? []).forEach((action, index) => {
    run.log.push(executeWorkflowAction(db, user, workflow, action, run.event ?? {}, run.id, index, run.effects));
    run.actionsExecuted = Number(run.actionsExecuted ?? 0) + 1;
  });
  run.status = 'success';
  run.completedAt = now.toISOString();
  run.log.push(`Scheduled execution completed with ${run.actionsExecuted} actions`);
  recalculateWorkflowStats(db, user, workflow);
  pushEvent(db, user, 'announcements', 'workflow.executed', {
    id: workflow.id,
    runId: run.id,
    trigger: run.trigger,
    status: run.status,
    actionsExecuted: run.actionsExecuted,
    scheduled: true,
    scheduledFor: run.scheduledFor,
  });
  return { workflow, run, processed: true };
}

function processDueWorkflowRuns(db, user, body = {}) {
  const now = Number.isFinite(new Date(body.now ?? '').getTime()) ? new Date(body.now) : new Date();
  const limit = Math.max(1, Math.min(100, Number(body.limit ?? 25) || 25));
  const dueRuns = visibleWorkflowRuns(db, user)
    .filter((run) => run.status === 'scheduled' && run.scheduledFor && new Date(run.scheduledFor).getTime() <= now.getTime())
    .slice(0, limit);
  const results = dueRuns.map((run) => processScheduledWorkflowRun(db, user, run, now));
  return {
    now: now.toISOString(),
    matched: dueRuns.length,
    summary: {
      processed: results.filter((result) => result.processed).length,
      failed: results.filter((result) => result.run?.status === 'failed').length,
      actionsExecuted: results.reduce((sum, result) => sum + Number(result.run?.actionsExecuted ?? 0), 0),
    },
    results,
  };
}

function rollbackWorkflowEffect(db, user, run, effect, now) {
  if (!effect.reversible) return { status: 'skipped', reason: 'effect_not_reversible' };
  if (effect.rolledBackAt) return { status: 'skipped', reason: 'already_rolled_back' };
  if (effect.entity === 'task') {
    const task = visibleTasks(db, user).find((next) => next.id === effect.entityId);
    if (!task) return { status: 'skipped', reason: 'task_not_found' };
    if (task.workflowRunId !== run.id) return { status: 'skipped', reason: 'task_not_owned_by_run' };
    task.status = 'cancelled';
    task.completedAt = now;
    task.completedBy = user.id;
    pushEvent(db, user, workflowEventChannel(db, user, task), 'task.updated', {
      id: task.id,
      status: task.status,
      source: 'workflow_rollback',
      workflowRunId: run.id,
    });
    return { status: 'rolled_back', reason: 'task_cancelled' };
  }
  if (effect.entity === 'document') {
    const document = visibleGeneratedDocuments(db, user).find((next) => next.id === effect.entityId);
    if (!document) return { status: 'skipped', reason: 'document_not_found' };
    if (document.status === 'signed') return { status: 'skipped', reason: 'signed_document' };
    db.generatedDocuments = (db.generatedDocuments ?? []).filter((next) => next.id !== document.id);
    pushEvent(db, user, 'announcements', 'document.rollback_removed', {
      id: document.id,
      workflowRunId: run.id,
      templateId: document.templateId,
      subjectType: document.subjectType,
      subjectId: document.subjectId,
    });
    return { status: 'rolled_back', reason: 'document_removed' };
  }
  if (effect.entity === 'communication') {
    const communication = visibleCommunications(db, user).find((next) => next.id === effect.entityId);
    if (!communication) return { status: 'skipped', reason: 'communication_not_found' };
    if (communication.workflowRunId !== run.id) return { status: 'skipped', reason: 'communication_not_owned_by_run' };
    if (communication.deliveryStatus !== 'queued') return { status: 'skipped', reason: 'message_already_not_cancelable' };
    communication.deliveryStatus = 'failed';
    communication.status = 'failed';
    pushEvent(db, user, workflowEventChannel(db, user, communication), 'communication.delivery_cancelled', {
      id: communication.id,
      workflowRunId: run.id,
      clientId: communication.clientId,
      orderId: communication.orderId,
    });
    return { status: 'rolled_back', reason: 'queued_message_cancelled' };
  }
  if (effect.type === 'status_changed') {
    if (!effect.previousStatus) return { status: 'skipped', reason: 'missing_previous_status' };
    if (effect.entity === 'order') {
      const order = visibleOrders(db, user).find((next) => next.id === effect.entityId);
      if (!order) return { status: 'skipped', reason: 'order_not_found' };
      if (!orderStatuses.has(effect.previousStatus)) return { status: 'skipped', reason: 'invalid_previous_order_status' };
      order.status = effect.previousStatus;
      order.timeline.push({ label: `Rollback workflow: ${effect.previousStatus}`, at: now, by: actorName(user) });
      pushEvent(db, user, `branch:${order.branchId}:orders`, 'order.status_changed', { id: order.id, status: order.status, source: 'workflow_rollback' });
      return { status: 'rolled_back', reason: 'order_status_restored' };
    }
    if (effect.entity === 'valuation') {
      const valuation = visibleValuations(db, user).find((next) => next.id === effect.entityId);
      if (!valuation) return { status: 'skipped', reason: 'valuation_not_found' };
      if (!valuationStatuses.has(effect.previousStatus)) return { status: 'skipped', reason: 'invalid_previous_valuation_status' };
      valuation.status = effect.previousStatus;
      pushEvent(db, user, 'valuations', 'valuation.transition', { id: valuation.id, status: valuation.status, source: 'workflow_rollback' });
      return { status: 'rolled_back', reason: 'valuation_status_restored' };
    }
    if (effect.entity === 'invoice') {
      const invoice = visibleInvoices(db, user).find((next) => next.id === effect.entityId);
      if (!invoice) return { status: 'skipped', reason: 'invoice_not_found' };
      if (!invoiceStatuses.has(effect.previousStatus)) return { status: 'skipped', reason: 'invalid_previous_invoice_status' };
      invoice.status = effect.previousStatus;
      invoice.paidAt = effect.previousPaidAt;
      pushEvent(db, user, 'invoices', 'invoice.status_changed', { id: invoice.id, status: invoice.status, source: 'workflow_rollback' });
      return { status: 'rolled_back', reason: 'invoice_status_restored' };
    }
  }
  return { status: 'skipped', reason: 'unsupported_effect' };
}

function rollbackWorkflowRun(db, user, run, body = {}) {
  if (run.status !== 'success') return { error: 'Rollback możliwy tylko dla zakończonego sukcesem workflow run', status: 409 };
  if (run.rolledBackAt) return { error: 'Workflow run był już cofnięty', status: 409 };
  const workflow = visibleWorkflows(db, user).find((next) => next.id === run.workflowId);
  if (!workflow) return { error: 'Nie znaleziono workflow', status: 404 };
  const effects = Array.isArray(run.effects) ? run.effects : [];
  if (!effects.length) return { error: 'Workflow run nie ma odwracalnych efektow', status: 409 };
  const now = new Date().toISOString();
  const comment = workflowRunDecisionComment(body);
  const results = [];
  [...effects].reverse().forEach((effect) => {
    const result = rollbackWorkflowEffect(db, user, run, effect, now);
    effect.rolledBackAt = result.status === 'rolled_back' ? now : effect.rolledBackAt;
    effect.rolledBackBy = result.status === 'rolled_back' ? user.id : effect.rolledBackBy;
    effect.rollbackStatus = result.status;
    effect.rollbackReason = result.reason;
    results.unshift({ effectId: effect.id, entity: effect.entity, entityId: effect.entityId, ...result });
  });
  const rolledBack = results.filter((result) => result.status === 'rolled_back').length;
  if (!rolledBack) return { error: 'Nie udalo sie cofnac zadnego efektu workflow', status: 409, results };
  run.rolledBackAt = now;
  run.rolledBackBy = user.id;
  run.rollbackComment = comment;
  run.log.push(`Rollback by ${actorName(user)}${comment ? `: ${comment}` : ''}`);
  results.forEach((result) => run.log.push(`Rollback ${result.effectId}: ${result.status} (${result.reason})`));
  pushEvent(db, user, 'announcements', 'workflow.rolled_back', {
    id: workflow.id,
    runId: run.id,
    rolledBack,
    skipped: results.length - rolledBack,
    rolledBackBy: user.id,
  });
  return { workflow, run, rolledBack, results };
}

app.get('/api/workflows', requireAccess('automation'), (req, res) => {
  res.json(visibleWorkflows(req.db, req.user));
});

app.get('/api/workflow-runs', requireAccess('automation'), (req, res) => {
  const workflowId = String(req.query.workflowId ?? '').trim();
  const runs = visibleWorkflowRuns(req.db, req.user)
    .filter((run) => !workflowId || run.workflowId === workflowId)
    .sort((left, right) => String(right.startedAt).localeCompare(String(left.startedAt)));
  res.json(runs);
});

app.post('/api/workflows', requireAccess('automation', 'write'), async (req, res) => {
  const payload = buildWorkflowPayload(req.db, req.user, req.body ?? {});
  if (payload.error) return res.status(payload.status).json({ error: payload.error });
  req.db.workflows.unshift(payload.workflow);
  pushEvent(req.db, req.user, 'announcements', 'workflow.created', { id: payload.workflow.id, status: payload.workflow.status, trigger: payload.workflow.trigger });
  await saveDb(req.db);
  res.status(201).json(payload.workflow);
});

app.post('/api/workflows/execute', requireAccess('automation', 'write'), async (req, res) => {
  const trigger = String(req.body?.trigger ?? '').trim();
  if (trigger.length < 3) return res.status(400).json({ error: 'Trigger workflow musi mieć co najmniej 3 znaki' });
  const event = workflowEventFromBody(req.body);
  const requestedWorkflowId = String(req.body?.workflowId ?? '').trim();
  const workflows = visibleWorkflows(req.db, req.user)
    .filter((workflow) => workflow.trigger === trigger)
    .filter((workflow) => !requestedWorkflowId || workflow.id === requestedWorkflowId)
    .filter((workflow) => workflow.status === 'live' || workflow.killSwitch);
  const results = workflows.map((workflow) => executeWorkflow(req.db, req.user, workflow, event, { dryRun: Boolean(req.body?.dryRun) }));
  await saveDb(req.db);
  res.status(results.length ? 201 : 200).json({
    trigger,
    matched: workflows.length,
    summary: {
      success: results.filter((result) => result.run.status === 'success').length,
      scheduled: results.filter((result) => result.run.status === 'scheduled').length,
      waitingApproval: results.filter((result) => result.run.status === 'waiting_approval').length,
      failed: results.filter((result) => result.run.status === 'failed').length,
      actionsExecuted: results.reduce((sum, result) => sum + Number(result.run.actionsExecuted ?? 0), 0),
    },
    results,
  });
});

app.post('/api/workflow-runs/:id/approve', requireAccess('automation', 'write'), async (req, res) => {
  const run = visibleWorkflowRuns(req.db, req.user).find((next) => next.id === req.params.id);
  if (!run) return res.status(404).json({ error: 'Nie znaleziono workflow run' });
  const result = approveWorkflowRun(req.db, req.user, run, req.body ?? {});
  if (result.error) return res.status(result.status).json({ error: result.error });
  await saveDb(req.db);
  res.status(result.approved ? 200 : 409).json(result);
});

app.post('/api/workflow-runs/:id/reject', requireAccess('automation', 'write'), async (req, res) => {
  const run = visibleWorkflowRuns(req.db, req.user).find((next) => next.id === req.params.id);
  if (!run) return res.status(404).json({ error: 'Nie znaleziono workflow run' });
  const result = rejectWorkflowRun(req.db, req.user, run, req.body ?? {});
  if (result.error) return res.status(result.status).json({ error: result.error });
  await saveDb(req.db);
  res.json(result);
});

app.post('/api/workflow-runs/:id/rollback', requireAccess('automation', 'write'), async (req, res) => {
  const run = visibleWorkflowRuns(req.db, req.user).find((next) => next.id === req.params.id);
  if (!run) return res.status(404).json({ error: 'Nie znaleziono workflow run' });
  const result = rollbackWorkflowRun(req.db, req.user, run, req.body ?? {});
  if (result.error) return res.status(result.status).json({ error: result.error, results: result.results });
  await saveDb(req.db);
  res.json(result);
});

app.post('/api/workflow-runs/process-due', requireAccess('automation', 'write'), async (req, res) => {
  const result = processDueWorkflowRuns(req.db, req.user, req.body ?? {});
  await saveDb(req.db);
  res.status(result.matched ? 201 : 200).json(result);
});

app.post('/api/workflows/:id/toggle', requireAccess('automation', 'write'), async (req, res) => {
  const workflow = visibleWorkflows(req.db, req.user).find((next) => next.id === req.params.id);
  if (!workflow) return res.status(404).json({ error: 'Nie znaleziono workflow' });
  workflow.status = workflow.status === 'live' ? 'paused' : 'live';
  workflow.killSwitch = workflow.status === 'live' ? false : Boolean(workflow.killSwitch);
  workflow.updatedAt = new Date().toISOString();
  workflow.updatedBy = req.user.id;
  pushEvent(req.db, req.user, 'announcements', 'workflow.toggled', { id: workflow.id, status: workflow.status });
  await saveDb(req.db);
  res.json(workflow);
});

app.patch('/api/workflows/:id', requireAccess('automation', 'write'), async (req, res) => {
  const workflow = visibleWorkflows(req.db, req.user).find((next) => next.id === req.params.id);
  if (!workflow) return res.status(404).json({ error: 'Nie znaleziono workflow' });
  const payload = buildWorkflowPayload(req.db, req.user, req.body ?? {}, workflow);
  if (payload.error) return res.status(payload.status).json({ error: payload.error });
  Object.assign(workflow, payload.workflow, { id: workflow.id, tenantId: tenantIdForUser(req.db, req.user) });
  pushEvent(req.db, req.user, 'announcements', 'workflow.updated', { id: workflow.id, status: workflow.status, trigger: workflow.trigger });
  await saveDb(req.db);
  res.json(workflow);
});

app.delete('/api/workflows/:id', requireAccess('automation', 'write'), async (req, res) => {
  const workflow = visibleWorkflows(req.db, req.user).find((next) => next.id === req.params.id);
  if (!workflow) return res.status(404).json({ error: 'Nie znaleziono workflow' });
  const used = visibleWorkflowRuns(req.db, req.user).some((run) => run.workflowId === workflow.id)
    || visibleTasks(req.db, req.user).some((task) => task.workflowId === workflow.id)
    || visibleCommunications(req.db, req.user).some((communication) => communication.workflowId === workflow.id)
    || visibleGeneratedDocuments(req.db, req.user).some((document) => document.workflowId === workflow.id);
  if (used) {
    workflow.status = 'archived';
    workflow.killSwitch = true;
    workflow.deletedAt = new Date().toISOString();
    workflow.deletedBy = req.user.id;
    workflow.updatedAt = workflow.deletedAt;
    workflow.updatedBy = req.user.id;
  } else {
    req.db.workflows = (req.db.workflows ?? []).filter((next) => next.id !== workflow.id);
  }
  pushEvent(req.db, req.user, 'announcements', used ? 'workflow.archived' : 'workflow.deleted', {
    id: workflow.id,
    name: workflow.name,
    trigger: workflow.trigger,
    archived: used,
    deleted: !used,
  });
  await saveDb(req.db);
  res.json({ workflow: used ? workflow : null, archived: used, deleted: !used });
});

app.post('/api/workflows/:id/test', requireAccess('automation', 'write'), async (req, res) => {
  const workflow = visibleWorkflows(req.db, req.user).find((next) => next.id === req.params.id);
  if (!workflow) return res.status(404).json({ error: 'Nie znaleziono workflow' });
  const now = new Date().toISOString();
  const dryRun = workflowDryRun(workflow, req.body ?? {});
  const run = {
    id: `run-${crypto.randomUUID().slice(0, 8)}`,
    tenantId: tenantIdForUser(req.db, req.user),
    workflowId: workflow.id,
    trigger: workflow.trigger,
    status: dryRun.status,
    startedAt: now,
    dryRun: true,
    actionsExecuted: 0,
    log: dryRun.log,
  };
  updateWorkflowStats(workflow, dryRun.status, now);
  req.db.workflowRuns.unshift(run);
  pushEvent(req.db, req.user, 'announcements', 'workflow.tested', { id: workflow.id, runId: run.id, status: run.status });
  await saveDb(req.db);
  res.status(201).json({ workflow, run });
});

app.post('/api/workflows/:id/kill-switch', requireAccess('automation', 'write'), async (req, res) => {
  const workflow = visibleWorkflows(req.db, req.user).find((next) => next.id === req.params.id);
  if (!workflow) return res.status(404).json({ error: 'Nie znaleziono workflow' });
  workflow.killSwitch = !workflow.killSwitch;
  if (workflow.killSwitch) workflow.status = 'paused';
  workflow.updatedAt = new Date().toISOString();
  workflow.updatedBy = req.user.id;
  pushEvent(req.db, req.user, 'announcements', 'workflow.kill_switch_toggled', { id: workflow.id, killSwitch: workflow.killSwitch, status: workflow.status });
  await saveDb(req.db);
  res.json(workflow);
});

function buildDocumentContext(db, user, subjectType, subjectId) {
  if (subjectType === 'client') {
    const client = visibleClients(db, user).find((item) => item.id === subjectId);
    if (!client) return { error: 'Nie znaleziono klienta w zakresie uprawnień', status: 404 };
    return {
      subject: client,
      context: {
        clientName: client.name,
        clientPhone: client.phone,
        clientEmail: client.email,
        clientAddress: client.address,
        branch: branchName(db, client.branchId ?? user.branchId),
        tags: (client.tags ?? []).join(', '),
        ...client.customFields,
      },
    };
  }
  if (subjectType === 'order') {
    const order = visibleOrders(db, user).find((item) => item.id === subjectId);
    if (!order) return { error: 'Nie znaleziono zlecenia w zakresie uprawnień', status: 404 };
    const client = db.clients.find((item) => item.id === order.clientId);
    const grossValue = Math.round(Number(order.value ?? 0) * 1.23);
    return {
      subject: order,
      context: {
        orderId: order.id,
        orderType: order.type,
        orderAddress: `${order.address}, ${order.city}`,
        orderStatus: order.status,
        orderPriority: order.priority,
        inspectionAt: order.inspectionAt ?? '',
        scheduledAt: order.scheduledAt,
        netValue: String(order.value ?? 0),
        grossValue: String(grossValue),
        margin: String(order.margin ?? 0),
        clientName: client?.name ?? '',
        clientPhone: client?.phone ?? '',
        clientEmail: client?.email ?? '',
        clientAddress: client?.address ?? '',
        branch: branchName(db, order.branchId),
        validUntil: new Date(Date.now() + 1000 * 60 * 60 * 24 * 14).toISOString().slice(0, 10),
      },
    };
  }
  if (subjectType === 'employee') {
    const contract = (db.employeeContracts ?? []).find((item) => item.employeeId === subjectId || item.id === subjectId);
    const employee = db.users.find((item) => item.id === subjectId || item.id === contract?.employeeId);
    if (!employee && !contract) return { error: 'Nie znaleziono pracownika lub umowy', status: 404 };
    if (employee && !visibleUsers(db, user).some((item) => item.id === employee.id)) return { error: 'Pracownik poza tenantem', status: 403 };
    const position = (db.jobPositions ?? []).find((item) => item.id === contract?.positionId);
    return {
      subject: contract ?? employee,
      context: {
        employeeId: employee?.id ?? contract?.employeeId ?? subjectId,
        employeeName: contract?.employeeName ?? `${employee?.firstName ?? ''} ${employee?.lastName ?? ''}`.trim(),
        jobTitle: position?.title ?? '',
        department: position?.department ?? '',
        contractType: contract?.type ?? position?.contractType ?? '',
        rate: contract?.rate ?? position?.rate ?? '',
        branch: branchName(db, contract?.branchId ?? employee?.branchId ?? user.branchId),
        startDate: contract?.startDate ?? '',
        endDate: contract?.endDate ?? '',
        responsibilities: (position?.responsibilities ?? []).join(', '),
        requiredDocuments: (position?.requiredDocuments ?? []).join(', '),
      },
    };
  }
  if (subjectType === 'equipment') {
    const item = visibleEquipment(db, user).find((equipment) => equipment.id === subjectId);
    if (!item) return { error: 'Nie znaleziono sprzętu w zakresie uprawnień', status: 404 };
    return {
      subject: item,
      context: {
        equipmentName: item.name,
        equipmentType: item.type,
        equipmentStatus: item.status,
        reviewDue: item.reviewDue,
        risk: item.risk,
        branch: branchName(db, item.branchId),
      },
    };
  }
  if (subjectType === 'company') {
    const tenant = currentTenant(db, user);
    return {
      subject: tenant,
      context: {
        companyName: tenant?.name ?? '',
        tenantId: tenant?.id ?? '',
        plan: tenant?.plan ?? '',
        status: tenant?.status ?? '',
        branch: branchName(db, user.branchId),
      },
    };
  }
  return { error: 'Nieprawidłowy typ dokumentu', status: 400 };
}

function renderDocumentTemplate(template, context) {
  const usedFields = new Set();
  const content = String(template.body ?? '').replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_match, key) => {
    usedFields.add(key);
    const value = context[key];
    return value == null || value === '' ? `[[${key}]]` : String(value);
  });
  const declaredFields = Array.isArray(template.fields) ? template.fields : [];
  const missingFields = [...new Set([...declaredFields, ...usedFields])]
    .filter((field) => context[field] == null || context[field] === '');
  return { content, missingFields };
}

function templateFieldsFromBody(body) {
  const fields = [];
  String(body ?? '').replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_match, key) => {
    fields.push(key);
    return _match;
  });
  return [...new Set(fields)];
}

function buildDocumentTemplatePayload(db, user, body = {}, existing = null) {
  const base = body.basedOnTemplateId
    ? visibleDocumentTemplates(db, user).find((template) => template.id === String(body.basedOnTemplateId))
    : null;
  if (body.basedOnTemplateId && !base) return { error: 'Nie znaleziono bazowego szablonu dokumentu', status: 404 };
  const name = optionalText(body.name ?? existing?.name ?? base?.name);
  if (name.length < 3) return { error: 'Nazwa szablonu musi mieć co najmniej 3 znaki', status: 400 };
  const kind = documentTemplateKinds.has(optionalText(body.kind))
    ? optionalText(body.kind)
    : (existing?.kind ?? base?.kind ?? 'contract');
  const scope = allowedDocumentSubjectTypes.has(optionalText(body.scope))
    ? optionalText(body.scope)
    : (existing?.scope ?? base?.scope ?? 'employee');
  const status = documentTemplateStatuses.has(optionalText(body.status))
    ? optionalText(body.status)
    : (existing?.status ?? base?.status ?? 'draft');
  const templateBody = String(body.body ?? existing?.body ?? base?.body ?? '').trim();
  if (templateBody.length < 10) return { error: 'Treść szablonu musi mieć co najmniej 10 znaków', status: 400 };
  const fields = [...new Set([
    ...normalizedStringList(body.fields, existing?.fields ?? base?.fields ?? []),
    ...templateFieldsFromBody(templateBody),
  ])];
  const now = new Date().toISOString();
  return {
    template: {
      ...(existing ?? {}),
      id: existing?.id ?? nextSequenceId('tpl', db.documentTemplates ?? []),
      tenantId: tenantIdForUser(db, user),
      name,
      kind,
      scope,
      status,
      fields,
      body: templateBody,
      version: existing ? Number(existing.version ?? 1) + 1 : Number(body.version ?? 1),
      clonedFromTemplateId: existing?.clonedFromTemplateId ?? base?.id,
      createdAt: existing?.createdAt ?? now,
      createdBy: existing?.createdBy ?? user.id,
      updatedAt: now,
      updatedBy: user.id,
    },
  };
}

function documentFileName(template, subjectType, subjectId) {
  return `${template.kind}-${subjectType}-${subjectId}-${new Date().toISOString().slice(0, 10)}.txt`
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, '-');
}

const allowedDocumentSubjectTypes = new Set(['client', 'order', 'employee', 'equipment', 'company']);
const documentStatuses = new Set(['draft', 'ready', 'signed']);
const documentSignatureMethods = new Set(['manual', 'electronic', 'client_portal', 'mobile']);
const documentTemplateKinds = new Set(['offer', 'contract', 'safety', 'protocol', 'consent', 'certificate']);
const documentTemplateStatuses = new Set(['draft', 'active', 'archived']);
const employeeContractStatuses = new Set(['draft', 'active', 'ending', 'expired', 'archived']);
const employeeContractTypes = new Set(['employment', 'b2b', 'mandate']);
const medicalExamTypes = new Set(['occupational', 'height', 'driver']);
const jobPositionDepartments = new Set(['office', 'field', 'sales', 'finance', 'management']);
const documentRequirementScopes = new Set(['employee', 'equipment', 'order', 'company']);

function hrRecordStatus(expiresAt, warningDays = 60) {
  return complianceStatus(dateDiffDays(expiresAt), warningDays);
}

function hrEmployeeForWrite(db, user, employeeId) {
  const id = optionalText(employeeId);
  if (!id) return { error: 'employeeId jest wymagane', status: 400 };
  const employee = visibleUsers(db, user).find((next) => next.id === id);
  if (!employee) return { error: 'Nie znaleziono pracownika w tenant/oddziale', status: 404 };
  return { employee };
}

function dateOnly(value, fallback, label) {
  const parsed = parseOptionalDate(value ?? fallback);
  if (!parsed) return { error: `${label} jest nieprawidłowa`, status: 400 };
  return { value: parsed.toISOString().slice(0, 10) };
}

function ensureDateOrder(startDate, expiresAt) {
  if (new Date(startDate) > new Date(expiresAt)) {
    return { error: 'Data ważności musi być po dacie wydania lub ukończenia', status: 400 };
  }
  return null;
}

function trainingPayload(db, user, body = {}, existing = null) {
  const employeeResult = hrEmployeeForWrite(db, user, body.employeeId ?? existing?.employeeId);
  if (employeeResult.error) return employeeResult;
  const name = optionalText(body.name ?? existing?.name);
  if (!name) return { error: 'Nazwa szkolenia jest wymagana', status: 400 };
  const completedAt = dateOnly(body.completedAt, existing?.completedAt ?? new Date(), 'Data ukonczenia szkolenia');
  if (completedAt.error) return completedAt;
  const expiresAt = dateOnly(body.expiresAt, existing?.expiresAt, 'Data ważności szkolenia');
  if (expiresAt.error) return expiresAt;
  const orderError = ensureDateOrder(completedAt.value, expiresAt.value);
  if (orderError) return orderError;
  const now = new Date().toISOString();
  return {
    ...(existing ?? {}),
    employeeId: employeeResult.employee.id,
    name,
    status: hrRecordStatus(expiresAt.value),
    completedAt: completedAt.value,
    expiresAt: expiresAt.value,
    createdAt: existing?.createdAt ?? now,
    createdBy: existing?.createdBy ?? user.id,
    updatedAt: now,
    updatedBy: user.id,
  };
}

function medicalExamPayload(db, user, body = {}, existing = null) {
  const employeeResult = hrEmployeeForWrite(db, user, body.employeeId ?? existing?.employeeId);
  if (employeeResult.error) return employeeResult;
  const type = medicalExamTypes.has(optionalText(body.type ?? existing?.type))
    ? optionalText(body.type ?? existing?.type)
    : '';
  if (!type) return { error: 'Typ badania jest wymagany', status: 400 };
  const issuedAt = dateOnly(body.issuedAt, existing?.issuedAt ?? new Date(), 'Data badania');
  if (issuedAt.error) return issuedAt;
  const expiresAt = dateOnly(body.expiresAt, existing?.expiresAt, 'Data ważności badania');
  if (expiresAt.error) return expiresAt;
  const orderError = ensureDateOrder(issuedAt.value, expiresAt.value);
  if (orderError) return orderError;
  const now = new Date().toISOString();
  return {
    ...(existing ?? {}),
    employeeId: employeeResult.employee.id,
    type,
    status: hrRecordStatus(expiresAt.value),
    issuedAt: issuedAt.value,
    expiresAt: expiresAt.value,
    createdAt: existing?.createdAt ?? now,
    createdBy: existing?.createdBy ?? user.id,
    updatedAt: now,
    updatedBy: user.id,
  };
}

function certificationPayload(db, user, body = {}, existing = null) {
  const employeeResult = hrEmployeeForWrite(db, user, body.employeeId ?? existing?.employeeId);
  if (employeeResult.error) return employeeResult;
  const name = optionalText(body.name ?? existing?.name);
  const issuer = optionalText(body.issuer ?? existing?.issuer);
  if (!name) return { error: 'Nazwa uprawnienia jest wymagana', status: 400 };
  if (!issuer) return { error: 'Wystawca uprawnienia jest wymagany', status: 400 };
  const issuedAt = dateOnly(body.issuedAt, existing?.issuedAt ?? new Date(), 'Data wydania uprawnienia');
  if (issuedAt.error) return issuedAt;
  const expiresAt = dateOnly(body.expiresAt, existing?.expiresAt, 'Data ważności uprawnienia');
  if (expiresAt.error) return expiresAt;
  const orderError = ensureDateOrder(issuedAt.value, expiresAt.value);
  if (orderError) return orderError;
  const now = new Date().toISOString();
  return {
    ...(existing ?? {}),
    employeeId: employeeResult.employee.id,
    name,
    issuer,
    status: hrRecordStatus(expiresAt.value),
    issuedAt: issuedAt.value,
    expiresAt: expiresAt.value,
    createdAt: existing?.createdAt ?? now,
    createdBy: existing?.createdBy ?? user.id,
    updatedAt: now,
    updatedBy: user.id,
  };
}

function documentSignatureHash(document, signature) {
  return createHash('sha256').update(JSON.stringify({
    documentId: document.id,
    tenantId: document.tenantId,
    templateId: document.templateId,
    subjectType: document.subjectType,
    subjectId: document.subjectId,
    content: document.content ?? '',
    signerName: signature.signerName,
    signerEmail: signature.signerEmail,
    signedAt: signature.signedAt,
    method: signature.method,
  })).digest('hex');
}

function appendDocumentTimeline(db, user, document, label, at) {
  if (document.subjectType === 'order') {
    const order = visibleOrders(db, user).find((item) => item.id === document.subjectId);
    if (order) order.timeline.push({ label, at, by: actorName(user) });
  }
  if (document.subjectType === 'client') {
    const orders = visibleOrders(db, user).filter((order) => order.clientId === document.subjectId);
    orders.forEach((order) => order.timeline.push({ label, at, by: actorName(user) }));
  }
}

function normalizeDocumentStatus(value, fallback = 'ready') {
  const status = String(value ?? fallback).trim();
  return documentStatuses.has(status) ? status : fallback;
}

function buildDocumentSignature(document, user, body, signedAt) {
  const method = documentSignatureMethods.has(String(body?.method ?? body?.signatureMethod ?? ''))
    ? String(body.method ?? body.signatureMethod)
    : (document.status === 'signed' ? 'manual' : 'electronic');
  const signerName = optionalText(body?.signerName) || actorName(user);
  const signerEmail = optionalText(body?.signerEmail);
  const signature = {
    method,
    signedAt,
    signerName,
    signerEmail: signerEmail || undefined,
  };
  return { ...signature, signatureHash: documentSignatureHash(document, signature), signedBy: user.id };
}

function applyDocumentSignature(document, user, signature, note) {
  document.status = 'signed';
  document.signedAt = signature.signedAt;
  document.signedBy = user.id;
  document.signerName = signature.signerName;
  if (signature.signerEmail) document.signerEmail = signature.signerEmail;
  document.signatureMethod = signature.method;
  document.signatureHash = signature.signatureHash;
  document.signatureNote = optionalText(note);
  document.lockedAt = signature.signedAt;
}

function requirementAppliesTo(db, user, requirement, subjectType, subjectId) {
  if (requirement.scope !== subjectType) return false;
  if (requirement.requiredFor === 'all') return true;
  if (subjectType === 'employee') {
    const contract = visibleEmployeeContracts(db, user).find((item) => item.employeeId === subjectId || item.id === subjectId);
    const position = visibleJobPositions(db, user, { includeArchivedReferenced: true }).find((item) => item.id === contract?.positionId);
    if (requirement.requiredFor === 'all-field') return position?.department === 'field';
    return requirement.requiredFor === contract?.positionId || position?.requiredDocuments?.includes(requirement.name);
  }
  if (subjectType === 'equipment') return requirement.requiredFor === 'fleet' || requirement.requiredFor === subjectId;
  if (subjectType === 'order') {
    const order = visibleOrders(db, user).find((item) => item.id === subjectId);
    return requirement.requiredFor === order?.type || requirement.requiredFor === order?.status;
  }
  return true;
}

function subjectAccess(db, user, subjectType, subjectId) {
  if (subjectType === 'client') return visibleClients(db, user).some((item) => item.id === subjectId);
  if (subjectType === 'order') return visibleOrders(db, user).some((item) => item.id === subjectId);
  if (subjectType === 'employee') {
    return visibleUsers(db, user).some((item) => item.id === subjectId)
      || visibleEmployeeContracts(db, user).some((item) => item.id === subjectId || item.employeeId === subjectId);
  }
  if (subjectType === 'equipment') return visibleEquipment(db, user).some((item) => item.id === subjectId);
  if (subjectType === 'company') return Boolean(currentTenant(db, user));
  return false;
}

function documentRequirementFulfillment(db, user, requirement, subjectType, subjectId) {
  const documents = visibleGeneratedDocuments(db, user).filter((document) => (
    document.subjectType === subjectType
    && document.subjectId === subjectId
    && ['ready', 'signed'].includes(document.status)
    && (document.requirementId === requirement.id || String(document.summary ?? '').toLowerCase().includes(requirement.name.toLowerCase()))
  ));
  const latest = documents.sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))[0];
  if (!latest) {
    return {
      requirementId: requirement.id,
      name: requirement.name,
      requiredFor: requirement.requiredFor,
      status: 'missing',
      fulfilled: false,
      warningDays: requirement.warningDays,
    };
  }
  const expiresAt = latest.expiresAt ?? (requirement.renewEveryMonths
    ? new Date(new Date(latest.createdAt).getTime() + Number(requirement.renewEveryMonths) * 31 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    : null);
  const daysLeft = expiresAt ? dateDiffDays(expiresAt) : null;
  return {
    requirementId: requirement.id,
    name: requirement.name,
    requiredFor: requirement.requiredFor,
    status: expiresAt ? complianceStatus(daysLeft, requirement.warningDays) : 'valid',
    fulfilled: true,
    documentId: latest.id,
    documentStatus: latest.status,
    expiresAt,
    daysLeft,
    warningDays: requirement.warningDays,
  };
}

function subjectDocumentCompliance(db, user, subjectType, subjectId) {
  if (!subjectAccess(db, user, subjectType, subjectId)) return { error: 'Podmiot poza zakresem uprawnień lub tenantem', status: 404 };
  const requirements = visibleDocumentRequirements(db, user)
    .filter((requirement) => requirementAppliesTo(db, user, requirement, subjectType, subjectId));
  const items = requirements.map((requirement) => documentRequirementFulfillment(db, user, requirement, subjectType, subjectId));
  return {
    subjectType,
    subjectId,
    required: items.length,
    fulfilled: items.filter((item) => item.fulfilled && item.status !== 'expired').length,
    missing: items.filter((item) => item.status === 'missing').length,
    dueSoon: items.filter((item) => item.status === 'due_soon').length,
    expired: items.filter((item) => item.status === 'expired').length,
    items,
  };
}

function expiryItem(kind, row, label, owner, dateValue, warningDays, now) {
  const daysLeft = dateDiffDays(dateValue, now);
  return {
    id: row.id,
    kind,
    label,
    owner,
    expiresAt: dateValue,
    daysLeft,
    status: complianceStatus(daysLeft, warningDays),
    warningDays,
  };
}

function hrComplianceReport(db, user, days = 60) {
  const now = new Date();
  const warningDays = Math.max(1, Math.min(365, Number(days) || 60));
  const usersById = new Map(visibleUsers(db, user).map((item) => [item.id, item]));
  const employeeName = (employeeId) => {
    const employee = usersById.get(employeeId);
    return employee ? actorName(employee) : employeeId;
  };
  const expirations = [
    ...visibleEmployeeContracts(db, user).map((contract) => expiryItem('contract', contract, `Umowa: ${contract.type}`, { id: contract.employeeId, name: contract.employeeName }, contract.endDate, warningDays, now)),
    ...visibleTrainings(db, user).map((training) => expiryItem('training', training, training.name, { id: training.employeeId, name: employeeName(training.employeeId) }, training.expiresAt, warningDays, now)),
    ...visibleMedicalExams(db, user).map((exam) => expiryItem('medical_exam', exam, `Badanie: ${exam.type}`, { id: exam.employeeId, name: employeeName(exam.employeeId) }, exam.expiresAt, warningDays, now)),
    ...visibleCertifications(db, user).map((cert) => expiryItem('certification', cert, cert.name, { id: cert.employeeId, name: employeeName(cert.employeeId) }, cert.expiresAt, warningDays, now)),
    ...visibleEquipment(db, user).map((item) => expiryItem('equipment_review', item, `Przegląd sprzętu: ${item.name}`, { id: item.id, name: item.name }, item.reviewDue, warningDays, now)),
  ].filter((item) => ['expired', 'due_soon'].includes(item.status))
    .sort((left, right) => Number(left.daysLeft ?? 9999) - Number(right.daysLeft ?? 9999));
  const documentSubjects = visibleEmployeeContracts(db, user)
    .map((contract) => subjectDocumentCompliance(db, user, 'employee', contract.employeeId))
    .filter((item) => !item.error);
  const missingDocuments = documentSubjects.flatMap((subject) => (
    subject.items
      .filter((item) => ['missing', 'expired', 'due_soon'].includes(item.status))
      .map((item) => ({ ...item, subjectType: subject.subjectType, subjectId: subject.subjectId }))
  ));
  return {
    tenantId: tenantIdForUser(db, user),
    generatedAt: new Date().toISOString(),
    warningDays,
    summary: {
      expirations: expirations.length,
      expired: expirations.filter((item) => item.status === 'expired').length,
      dueSoon: expirations.filter((item) => item.status === 'due_soon').length,
      missingDocuments: missingDocuments.filter((item) => item.status === 'missing').length,
    },
    expirations,
    missingDocuments,
  };
}

function defaultContractEndDate(startDate) {
  const start = parseOptionalDate(startDate) ?? new Date();
  const end = new Date(start);
  end.setUTCFullYear(end.getUTCFullYear() + 1);
  end.setUTCDate(end.getUTCDate() - 1);
  return end.toISOString().slice(0, 10);
}

function contractDocumentRequirement(db, user) {
  return visibleDocumentRequirements(db, user).find((requirement) => (
    requirement.scope === 'employee'
    && (requirement.requiredFor === 'all' || String(requirement.name ?? '').toLowerCase().includes('umowa'))
  )) ?? null;
}

function employeeContractTemplate(db, user, templateId) {
  const requested = optionalText(templateId);
  const templates = visibleDocumentTemplates(db, user).filter((template) => template.scope === 'employee' && template.kind === 'contract' && template.status !== 'archived');
  if (requested) return templates.find((template) => template.id === requested) ?? null;
  return templates.find((template) => template.status === 'active') ?? templates[0] ?? null;
}

function renderContractDocumentForEmployee(db, user, contract, template, requirement) {
  const context = buildDocumentContext(db, user, 'employee', contract.employeeId);
  if (context.error) return context;
  const rendered = renderDocumentTemplate(template, context.context);
  const document = {
    id: `doc-${crypto.randomUUID().slice(0, 8)}`,
    tenantId: tenantIdForUser(db, user),
    templateId: template.id,
    requirementId: requirement?.id,
    subjectType: 'employee',
    subjectId: contract.employeeId,
    status: rendered.missingFields.length ? 'draft' : 'ready',
    createdAt: new Date().toISOString(),
    createdBy: user.id,
    summary: `${template.name} wygenerowany dla ${contract.employeeName}`,
    content: rendered.content,
    fileName: documentFileName(template, 'employee', contract.employeeId),
    missingFields: rendered.missingFields,
    source: 'generated',
  };
  db.generatedDocuments ??= [];
  db.generatedDocuments.unshift(document);
  contract.generatedDocumentId = document.id;
  return { document };
}

function employeeContractPayload(db, user, body = {}, existing = null) {
  const employeeId = optionalText(body.employeeId ?? existing?.employeeId);
  const positionId = optionalText(body.positionId ?? existing?.positionId);
  if (!employeeId) return { error: 'employeeId jest wymagane', status: 400 };
  if (!positionId) return { error: 'positionId jest wymagane', status: 400 };
  const employee = visibleUsers(db, user).find((next) => next.id === employeeId);
  if (!employee) return { error: 'Nie znaleziono pracownika w tenant/oddziale', status: 404 };

  const activePosition = visibleJobPositions(db, user).find((next) => next.id === positionId);
  const referencedPosition = existing?.positionId === positionId
    ? visibleJobPositions(db, user, { includeArchivedReferenced: true }).find((next) => next.id === positionId)
    : null;
  const position = activePosition ?? referencedPosition;
  if (!position) return { error: 'Nie znaleziono stanowiska pracy', status: 404 };

  const branchId = optionalText(body.branchId ?? existing?.branchId) || employee.branchId || user.branchId;
  if (!sameTenantBranch(db, user, branchId)) return { error: 'Oddział poza tenantem', status: 403 };
  const startDate = (parseOptionalDate(body.startDate ?? existing?.startDate) ?? new Date()).toISOString().slice(0, 10);
  const endDate = (parseOptionalDate(body.endDate ?? existing?.endDate)?.toISOString().slice(0, 10)) ?? defaultContractEndDate(startDate);
  if (new Date(startDate) > new Date(endDate)) return { error: 'Data zakończenia umowy musi być po starcie', status: 400 };

  const requestedType = optionalText(body.type ?? existing?.type);
  const type = employeeContractTypes.has(requestedType) ? requestedType : position.contractType;
  if (!employeeContractTypes.has(type)) return { error: 'Nieprawidłowy typ umowy', status: 400 };
  const requestedStatus = optionalText(body.status ?? existing?.status);
  const status = employeeContractStatuses.has(requestedStatus) ? requestedStatus : 'active';
  const now = new Date().toISOString();
  return {
    employee,
    position,
    contract: {
      ...(existing ?? {}),
      id: existing?.id ?? nextSequenceId('contract', db.employeeContracts ?? []),
      tenantId: tenantIdForUser(db, user),
      employeeId: employee.id,
      employeeName: `${employee.firstName ?? ''} ${employee.lastName ?? ''}`.trim() || employee.login || employee.id,
      positionId: position.id,
      branchId,
      type,
      status,
      startDate,
      endDate,
      rate: optionalText(body.rate ?? existing?.rate) || position.rate,
      createdAt: existing?.createdAt ?? now,
      createdBy: existing?.createdBy ?? user.id,
      updatedAt: now,
      updatedBy: user.id,
    },
  };
}

function maybeGenerateEmployeeContractDocument(db, user, contract, body = {}) {
  const requirement = contractDocumentRequirement(db, user);
  if (body?.generateDocument === false) return { document: null, documentSkippedReason: null, requirement };
  const template = employeeContractTemplate(db, user, body?.templateId);
  if (!template) return { document: null, documentSkippedReason: 'no_contract_template', requirement };
  const result = renderContractDocumentForEmployee(db, user, contract, template, requirement);
  if (result.error) return result;
  return { document: result.document, documentSkippedReason: null, requirement };
}

function normalizedStringList(value, fallback = []) {
  if (!Array.isArray(value)) return fallback;
  const rows = value.map((item) => String(item ?? '').trim()).filter(Boolean);
  return [...new Set(rows)];
}

function buildJobPositionPayload(db, user, body = {}, existing = null) {
  const base = body.basedOnPositionId
    ? visibleJobPositions(db, user).find((position) => position.id === String(body.basedOnPositionId))
    : null;
  if (body.basedOnPositionId && !base) return { error: 'Nie znaleziono bazowego stanowiska', status: 404 };
  const title = optionalText(body.title ?? existing?.title ?? base?.title);
  if (title.length < 3) return { error: 'Nazwa stanowiska musi mieć co najmniej 3 znaki', status: 400 };
  const department = jobPositionDepartments.has(optionalText(body.department))
    ? optionalText(body.department)
    : (existing?.department ?? base?.department ?? 'field');
  const contractType = employeeContractTypes.has(optionalText(body.contractType))
    ? optionalText(body.contractType)
    : (existing?.contractType ?? base?.contractType ?? 'employment');
  const rate = optionalText(body.rate ?? existing?.rate ?? base?.rate);
  if (!rate) return { error: 'Stawka stanowiska jest wymagana', status: 400 };
  const requiredDocuments = normalizedStringList(body.requiredDocuments, existing?.requiredDocuments ?? base?.requiredDocuments ?? []);
  const requiredTraining = normalizedStringList(body.requiredTraining, existing?.requiredTraining ?? base?.requiredTraining ?? []);
  const responsibilities = normalizedStringList(body.responsibilities, existing?.responsibilities ?? base?.responsibilities ?? []);
  return {
    position: {
      ...(existing ?? {}),
      id: existing?.id ?? nextSequenceId('pos', db.jobPositions ?? []),
      tenantId: tenantIdForUser(db, user),
      title,
      department,
      contractType,
      rate,
      responsibilities,
      requiredDocuments,
      requiredTraining,
      status: existing?.status ?? 'active',
      updatedAt: new Date().toISOString(),
      updatedBy: user.id,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      createdBy: existing?.createdBy ?? user.id,
    },
  };
}

function syncPositionDocumentRequirements(db, user, position, options = {}) {
  const shouldSync = options.syncDocumentRequirements !== false;
  if (!shouldSync) return [];
  db.documentRequirements ??= [];
  const tenantId = tenantIdForUser(db, user);
  const created = [];
  (position.requiredDocuments ?? []).forEach((name) => {
    const existing = visibleDocumentRequirements(db, user).find((requirement) => (
      requirement.scope === 'employee'
      && requirement.requiredFor === position.id
      && requirement.name.toLowerCase() === name.toLowerCase()
    ));
    if (existing) return;
    const requirement = {
      id: nextSequenceId('req', db.documentRequirements),
      tenantId,
      scope: 'employee',
      name,
      requiredFor: position.id,
      renewEveryMonths: Number.isFinite(Number(options.renewEveryMonths)) ? Math.max(1, Math.round(Number(options.renewEveryMonths))) : undefined,
      warningDays: Number.isFinite(Number(options.warningDays)) ? Math.max(1, Math.round(Number(options.warningDays))) : 30,
      createdAt: new Date().toISOString(),
      createdBy: user.id,
    };
    db.documentRequirements.unshift(requirement);
    created.push(requirement);
  });
  return created;
}

function removePositionDocumentRequirements(db, user, positionId) {
  const now = new Date().toISOString();
  const changed = [];
  visibleDocumentRequirements(db, user)
    .filter((requirement) => requirement.requiredFor === positionId)
    .forEach((requirement) => {
      const used = (db.generatedDocuments ?? []).some((document) => document.requirementId === requirement.id);
      if (used) {
        requirement.status = 'archived';
        requirement.deletedAt = now;
        requirement.deletedBy = user.id;
        requirement.updatedAt = now;
        requirement.updatedBy = user.id;
        changed.push({ id: requirement.id, archived: true, deleted: false });
        return;
      }
      db.documentRequirements = (db.documentRequirements ?? []).filter((next) => next.id !== requirement.id);
      changed.push({ id: requirement.id, archived: false, deleted: true });
    });
  return changed;
}

function buildDocumentRequirementPayload(db, user, body = {}, existing = null) {
  const base = body.basedOnRequirementId
    ? visibleDocumentRequirements(db, user).find((requirement) => requirement.id === String(body.basedOnRequirementId))
    : null;
  if (body.basedOnRequirementId && !base) return { error: 'Nie znaleziono bazowego wymagania dokumentowego', status: 404 };
  const requestedScope = optionalText(body.scope);
  if (requestedScope && !documentRequirementScopes.has(requestedScope)) {
    return { error: 'Nieprawidłowy zakres wymagania dokumentowego', status: 400 };
  }
  const scope = requestedScope
    ? requestedScope
    : (existing?.scope ?? base?.scope ?? 'employee');
  const name = optionalText(body.name ?? existing?.name ?? base?.name);
  if (name.length < 3) return { error: 'Nazwa wymagania musi mieć co najmniej 3 znaki', status: 400 };
  const requiredFor = optionalText(body.requiredFor ?? existing?.requiredFor ?? base?.requiredFor ?? 'all');
  if (!requiredFor) return { error: 'requiredFor jest wymagane', status: 400 };
  const renewInput = body.renewEveryMonths ?? existing?.renewEveryMonths ?? base?.renewEveryMonths;
  const renewEveryMonths = renewInput == null || renewInput === ''
    ? undefined
    : Math.max(1, Math.round(Number(renewInput)));
  if (renewInput != null && renewInput !== '' && !Number.isFinite(Number(renewInput))) {
    return { error: 'renewEveryMonths musi być liczbą', status: 400 };
  }
  const warningDays = Math.max(1, Math.round(Number(body.warningDays ?? existing?.warningDays ?? base?.warningDays ?? 30)));
  if (!Number.isFinite(warningDays)) return { error: 'warningDays musi być liczbą', status: 400 };
  const now = new Date().toISOString();
  return {
    requirement: {
      ...(existing ?? {}),
      id: existing?.id ?? nextSequenceId('req', db.documentRequirements ?? []),
      tenantId: tenantIdForUser(db, user),
      scope,
      name,
      requiredFor,
      renewEveryMonths,
      warningDays,
      status: 'active',
      clonedFromRequirementId: existing?.clonedFromRequirementId ?? base?.id,
      createdAt: existing?.createdAt ?? now,
      createdBy: existing?.createdBy ?? user.id,
      updatedAt: now,
      updatedBy: user.id,
    },
  };
}

app.get('/api/document-templates', requireAccess('documents'), (req, res) => {
  res.json(visibleDocumentTemplates(req.db, req.user));
});

app.post('/api/document-templates', requireAccess('documents', 'write'), async (req, res) => {
  const payload = buildDocumentTemplatePayload(req.db, req.user, req.body ?? {});
  if (payload.error) return res.status(payload.status).json({ error: payload.error });
  req.db.documentTemplates ??= [];
  req.db.documentTemplates.unshift(payload.template);
  pushEvent(req.db, req.user, 'announcements', 'document_template.created', {
    id: payload.template.id,
    name: payload.template.name,
    kind: payload.template.kind,
    scope: payload.template.scope,
    status: payload.template.status,
    version: payload.template.version,
  });
  await saveDb(req.db);
  res.status(201).json(payload.template);
});

app.patch('/api/document-templates/:id', requireAccess('documents', 'write'), async (req, res) => {
  const template = visibleDocumentTemplates(req.db, req.user).find((next) => next.id === req.params.id);
  if (!template) return res.status(404).json({ error: 'Nie znaleziono szablonu dokumentu' });
  if (!template.tenantId || rowTenantId(req.db, template) !== tenantIdForUser(req.db, req.user)) {
    return res.status(409).json({ error: 'Bazowego szablonu nie można edytować bezpośrednio; utwórz kopię przez POST /api/document-templates z basedOnTemplateId' });
  }
  const payload = buildDocumentTemplatePayload(req.db, req.user, req.body ?? {}, template);
  if (payload.error) return res.status(payload.status).json({ error: payload.error });
  Object.assign(template, payload.template, { id: template.id, tenantId: tenantIdForUser(req.db, req.user) });
  pushEvent(req.db, req.user, 'announcements', 'document_template.updated', {
    id: template.id,
    name: template.name,
    kind: template.kind,
    scope: template.scope,
    status: template.status,
    version: template.version,
  });
  await saveDb(req.db);
  res.json(template);
});

app.delete('/api/document-templates/:id', requireAccess('documents', 'write'), async (req, res) => {
  const template = visibleDocumentTemplates(req.db, req.user).find((next) => next.id === req.params.id);
  if (!template) return res.status(404).json({ error: 'Nie znaleziono szablonu dokumentu' });
  if (!template.tenantId || rowTenantId(req.db, template) !== tenantIdForUser(req.db, req.user)) {
    return res.status(409).json({ error: 'Bazowego szablonu nie można usunąć; utwórz i usuwaj tenantową kopię' });
  }
  const used = (req.db.generatedDocuments ?? []).some((document) => (
    document.templateId === template.id && generatedDocumentVisible(req.db, req.user, document)
  ));
  if (used) {
    template.status = 'archived';
    template.deletedAt = new Date().toISOString();
    template.deletedBy = req.user.id;
    template.updatedAt = template.deletedAt;
    template.updatedBy = req.user.id;
  } else {
    req.db.documentTemplates = (req.db.documentTemplates ?? []).filter((next) => next.id !== template.id);
  }
  pushEvent(req.db, req.user, 'announcements', used ? 'document_template.archived' : 'document_template.deleted', {
    id: template.id,
    name: template.name,
    used,
    status: used ? template.status : 'deleted',
  });
  await saveDb(req.db);
  res.json({ template: used ? template : null, archived: used, deleted: !used });
});

app.post('/api/document-templates/:id/preview', requireAccess('documents'), (req, res) => {
  const template = visibleDocumentTemplates(req.db, req.user).find((next) => next.id === req.params.id);
  if (!template) return res.status(404).json({ error: 'Nie znaleziono szablonu dokumentu' });
  const subjectType = optionalText(req.body?.subjectType);
  const subjectId = optionalText(req.body?.subjectId);
  let context = req.body?.sampleContext && typeof req.body.sampleContext === 'object' ? req.body.sampleContext : null;
  let subject = null;
  if (subjectType || subjectId) {
    if (!subjectType || !subjectId) return res.status(400).json({ error: 'subjectType i subjectId muszą być podane razem' });
    if (template.scope !== subjectType) return res.status(409).json({ error: 'Szablon nie pasuje do typu podmiotu', expected: template.scope });
    const built = buildDocumentContext(req.db, req.user, subjectType, subjectId);
    if (built.error) return res.status(built.status).json(built);
    context = built.context;
    subject = built.subject;
  }
  context ??= Object.fromEntries((template.fields ?? []).map((field) => [field, `[${field}]`]));
  const rendered = renderDocumentTemplate(template, context);
  res.json({
    template,
    subjectType: subjectType || null,
    subjectId: subjectId || null,
    subject,
    context,
    content: rendered.content,
    missingFields: rendered.missingFields,
  });
});

app.post('/api/documents/generate', requireAccess('documents', 'write'), async (req, res) => {
  const { templateId, subjectType, subjectId, requirementId } = req.body ?? {};
  const template = visibleDocumentTemplates(req.db, req.user).find((next) => next.id === templateId);
  if (!template) return res.status(404).json({ error: 'Nie znaleziono szablonu dokumentu' });
  if (template.status === 'archived') return res.status(409).json({ error: 'Szablon jest zarchiwizowany i nie może generować nowych dokumentów' });
  if (!allowedDocumentSubjectTypes.has(subjectType)) return res.status(400).json({ error: 'Nieprawidłowy typ dokumentu' });
  if (template.scope !== subjectType) return res.status(409).json({ error: 'Szablon nie pasuje do typu dokumentu', expected: template.scope });
  if (!subjectId) return res.status(400).json({ error: 'Brak subjectId' });
  const context = buildDocumentContext(req.db, req.user, subjectType, subjectId);
  if (context.error) return res.status(context.status).json(context);
  const rendered = renderDocumentTemplate(template, context.context);
  const document = {
    id: `doc-${crypto.randomUUID().slice(0, 8)}`,
    tenantId: tenantIdForUser(req.db, req.user),
    templateId,
    requirementId,
    subjectType,
    subjectId,
    status: rendered.missingFields.length ? 'draft' : 'ready',
    createdAt: new Date().toISOString(),
    createdBy: req.user.id,
    summary: `${template.name} wygenerowany dla ${subjectType}:${subjectId}`,
    content: rendered.content,
    fileName: documentFileName(template, subjectType, subjectId),
    missingFields: rendered.missingFields,
  };
  req.db.generatedDocuments.unshift(document);
  pushEvent(req.db, req.user, 'announcements', 'document.generated', { id: document.id, templateId, subjectType, subjectId, status: document.status, missingFields: document.missingFields });
  await saveDb(req.db);
  res.status(201).json(document);
});

app.post('/api/documents/attach', requireAccess('documents', 'write'), async (req, res) => {
  const subjectType = String(req.body?.subjectType ?? '').trim();
  const subjectId = String(req.body?.subjectId ?? '').trim();
  if (!allowedDocumentSubjectTypes.has(subjectType)) return res.status(400).json({ error: 'Nieprawidłowy typ dokumentu' });
  if (!subjectId) return res.status(400).json({ error: 'Brak subjectId' });
  if (!subjectAccess(req.db, req.user, subjectType, subjectId)) return res.status(404).json({ error: 'Podmiot poza zakresem uprawnień lub tenantem' });

  const requirementId = optionalText(req.body?.requirementId);
  const requirement = requirementId
    ? visibleDocumentRequirements(req.db, req.user).find((next) => next.id === requirementId)
    : null;
  if (requirementId && !requirement) return res.status(404).json({ error: 'Nie znaleziono wymagania dokumentowego' });
  if (requirement && !requirementAppliesTo(req.db, req.user, requirement, subjectType, subjectId)) {
    return res.status(409).json({ error: 'Wymaganie nie dotyczy tego podmiotu', requirementId, subjectType, subjectId });
  }

  const fileName = optionalText(req.body?.fileName ?? req.body?.name);
  const fileUrl = optionalText(req.body?.fileUrl ?? req.body?.url);
  const content = optionalText(req.body?.content ?? req.body?.text);
  if (!fileName && !fileUrl && !content) {
    return res.status(400).json({ error: 'Podaj fileName, fileUrl albo content dokumentu' });
  }
  const now = (parseOptionalDate(req.body?.createdAt ?? req.body?.uploadedAt) ?? new Date()).toISOString();
  const requestedStatus = normalizeDocumentStatus(req.body?.status, 'ready');
  const expiresAt = parseOptionalDate(req.body?.expiresAt)?.toISOString().slice(0, 10);
  const sizeBytes = req.body?.sizeBytes == null ? undefined : Number(req.body.sizeBytes);
  if (sizeBytes != null && (!Number.isFinite(sizeBytes) || sizeBytes < 0)) {
    return res.status(400).json({ error: 'Rozmiar dokumentu jest nieprawidłowy' });
  }

  const document = {
    id: `doc-${crypto.randomUUID().slice(0, 8)}`,
    tenantId: tenantIdForUser(req.db, req.user),
    templateId: optionalText(req.body?.templateId) || `manual-${requirementId || subjectType}`,
    requirementId: requirement?.id,
    subjectType,
    subjectId,
    status: requestedStatus === 'signed' ? 'ready' : requestedStatus,
    createdAt: now,
    createdBy: req.user.id,
    summary: optionalText(req.body?.summary) || `${requirement?.name ?? 'Dokument'} podpiety dla ${subjectType}:${subjectId}`,
    content: content || undefined,
    fileName: fileName || `${subjectType}-${subjectId}-${now.slice(0, 10)}.txt`.toLowerCase(),
    fileUrl: fileUrl || undefined,
    mimeType: optionalText(req.body?.mimeType) || undefined,
    sizeBytes,
    source: 'upload',
    uploadedAt: now,
    uploadedBy: req.user.id,
    expiresAt,
    storageKey: optionalText(req.body?.storageKey) || undefined,
    externalId: optionalText(req.body?.externalId) || undefined,
    missingFields: [],
  };
  let signature = null;
  if (requestedStatus === 'signed') {
    const signedAt = (parseOptionalDate(req.body?.signedAt) ?? new Date(now)).toISOString();
    signature = buildDocumentSignature(document, req.user, req.body ?? {}, signedAt);
    applyDocumentSignature(document, req.user, signature, req.body?.note);
  }

  req.db.generatedDocuments.unshift(document);
  appendDocumentTimeline(req.db, req.user, document, `Dokument podpiety: ${document.summary}`, now);
  if (signature) appendDocumentTimeline(req.db, req.user, document, `Dokument podpisany: ${document.summary}`, signature.signedAt);
  const compliance = subjectDocumentCompliance(req.db, req.user, subjectType, subjectId);
  pushEvent(req.db, req.user, 'announcements', 'document.attached', {
    id: document.id,
    requirementId: document.requirementId,
    subjectType,
    subjectId,
    status: document.status,
    fileName: document.fileName,
    fileUrl: document.fileUrl,
    expiresAt: document.expiresAt,
    signedAt: document.signedAt,
  });
  await saveDb(req.db);
  res.status(201).json({ document, requirement, compliance, signature });
});

app.post('/api/generated-documents/:id/sign', requireAccess('documents', 'write'), async (req, res) => {
  const document = visibleGeneratedDocuments(req.db, req.user).find((next) => next.id === req.params.id);
  if (!document) return res.status(404).json({ error: 'Nie znaleziono dokumentu' });
  if (document.status === 'signed') return res.status(409).json({ error: 'Dokument jest już podpisany', document });
  if (document.status !== 'ready' || (document.missingFields ?? []).length) {
    return res.status(409).json({
      error: 'Podpis wymaga dokumentu gotowego bez brakujacych pol',
      status: document.status,
      missingFields: document.missingFields ?? [],
    });
  }
  const method = documentSignatureMethods.has(String(req.body?.method ?? ''))
    ? String(req.body.method)
    : 'electronic';
  const signedAt = (parseOptionalDate(req.body?.signedAt) ?? new Date()).toISOString();
  const signerName = optionalText(req.body?.signerName) || actorName(req.user);
  const signerEmail = optionalText(req.body?.signerEmail);
  const signature = {
    method,
    signedAt,
    signerName,
    signerEmail: signerEmail || undefined,
  };
  const signatureHash = documentSignatureHash(document, signature);
  document.status = 'signed';
  document.signedAt = signedAt;
  document.signedBy = req.user.id;
  document.signerName = signerName;
  if (signerEmail) document.signerEmail = signerEmail;
  document.signatureMethod = method;
  document.signatureHash = signatureHash;
  document.signatureNote = optionalText(req.body?.note);
  document.lockedAt = signedAt;

  appendDocumentTimeline(req.db, req.user, document, `Dokument podpisany: ${document.summary}`, signedAt);
  const compliance = ['client', 'order', 'employee', 'equipment', 'company'].includes(document.subjectType)
    ? subjectDocumentCompliance(req.db, req.user, document.subjectType, document.subjectId)
    : null;
  pushEvent(req.db, req.user, 'announcements', 'document.signed', {
    id: document.id,
    templateId: document.templateId,
    requirementId: document.requirementId,
    subjectType: document.subjectType,
    subjectId: document.subjectId,
    signedAt,
    signedBy: req.user.id,
    signerName,
    signatureMethod: method,
    signatureHash,
  });
  await saveDb(req.db);
  res.json({ document, signature: { ...signature, signatureHash, signedBy: req.user.id }, compliance });
});

app.get('/api/documents/compliance', requireAccess('documents'), (req, res) => {
  const subjectType = String(req.query.subjectType ?? '');
  const subjectId = String(req.query.subjectId ?? '');
  if (!subjectType || !subjectId) return res.status(400).json({ error: 'subjectType i subjectId sa wymagane' });
  const report = subjectDocumentCompliance(req.db, req.user, subjectType, subjectId);
  if (report.error) return res.status(report.status).json(report);
  res.json(report);
});

app.get('/api/document-requirements', requireAccess('documents'), (req, res) => {
  res.json(visibleDocumentRequirements(req.db, req.user));
});

app.post('/api/document-requirements', requireAccess('documents', 'write'), async (req, res) => {
  const payload = buildDocumentRequirementPayload(req.db, req.user, req.body ?? {});
  if (payload.error) return res.status(payload.status).json({ error: payload.error });
  req.db.documentRequirements ??= [];
  req.db.documentRequirements.unshift(payload.requirement);
  pushEvent(req.db, req.user, 'announcements', 'document_requirement.created', {
    id: payload.requirement.id,
    scope: payload.requirement.scope,
    name: payload.requirement.name,
    requiredFor: payload.requirement.requiredFor,
  });
  await saveDb(req.db);
  res.status(201).json(payload.requirement);
});

app.patch('/api/document-requirements/:id', requireAccess('documents', 'write'), async (req, res) => {
  const requirement = visibleDocumentRequirements(req.db, req.user).find((next) => next.id === req.params.id);
  if (!requirement) return res.status(404).json({ error: 'Nie znaleziono wymagania dokumentowego' });
  if (!requirement.tenantId || rowTenantId(req.db, requirement) !== tenantIdForUser(req.db, req.user)) {
    return res.status(409).json({ error: 'Bazowego wymagania nie można edytować bezpośrednio; utwórz kopię przez POST /api/document-requirements z basedOnRequirementId' });
  }
  const payload = buildDocumentRequirementPayload(req.db, req.user, req.body ?? {}, requirement);
  if (payload.error) return res.status(payload.status).json({ error: payload.error });
  Object.assign(requirement, payload.requirement, { id: requirement.id, tenantId: tenantIdForUser(req.db, req.user) });
  pushEvent(req.db, req.user, 'announcements', 'document_requirement.updated', {
    id: requirement.id,
    scope: requirement.scope,
    name: requirement.name,
    requiredFor: requirement.requiredFor,
  });
  await saveDb(req.db);
  res.json(requirement);
});

app.delete('/api/document-requirements/:id', requireAccess('documents', 'write'), async (req, res) => {
  const requirement = visibleDocumentRequirements(req.db, req.user).find((next) => next.id === req.params.id);
  if (!requirement) return res.status(404).json({ error: 'Nie znaleziono wymagania dokumentowego' });
  if (!requirement.tenantId || rowTenantId(req.db, requirement) !== tenantIdForUser(req.db, req.user)) {
    return res.status(409).json({ error: 'Bazowego wymagania nie można usunąć; utwórz i usuwaj tenantową kopię' });
  }
  const used = (req.db.generatedDocuments ?? []).some((document) => (
    document.requirementId === requirement.id && generatedDocumentVisible(req.db, req.user, document)
  ));
  if (used) {
    requirement.status = 'archived';
    requirement.deletedAt = new Date().toISOString();
    requirement.deletedBy = req.user.id;
    requirement.updatedAt = requirement.deletedAt;
    requirement.updatedBy = req.user.id;
  } else {
    req.db.documentRequirements = (req.db.documentRequirements ?? []).filter((next) => next.id !== requirement.id);
  }
  pushEvent(req.db, req.user, 'announcements', used ? 'document_requirement.archived' : 'document_requirement.deleted', {
    id: requirement.id,
    name: requirement.name,
    used,
    status: used ? requirement.status : 'deleted',
  });
  await saveDb(req.db);
  res.json({ requirement: used ? requirement : null, archived: used, deleted: !used });
});

app.post('/api/document-requirements/:id/fulfill', requireAccess('documents', 'write'), async (req, res) => {
  const requirement = visibleDocumentRequirements(req.db, req.user).find((next) => next.id === req.params.id);
  if (!requirement) return res.status(404).json({ error: 'Nie znaleziono wymagania dokumentowego' });
  const subjectType = String(req.body?.subjectType ?? requirement.scope);
  const subjectId = String(req.body?.subjectId ?? '');
  if (!subjectId) return res.status(400).json({ error: 'subjectId jest wymagane' });
  if (!requirementAppliesTo(req.db, req.user, requirement, subjectType, subjectId)) {
    return res.status(409).json({ error: 'Wymaganie nie dotyczy tego podmiotu', requirementId: requirement.id, subjectType, subjectId });
  }
  if (!subjectAccess(req.db, req.user, subjectType, subjectId)) return res.status(404).json({ error: 'Podmiot poza zakresem uprawnień lub tenantem' });
  const templateId = req.body?.templateId;
  const template = templateId ? visibleDocumentTemplates(req.db, req.user).find((next) => next.id === templateId) : null;
  if (templateId && !template) return res.status(404).json({ error: 'Nie znaleziono szablonu dokumentu' });
  if (template?.status === 'archived') return res.status(409).json({ error: 'Szablon jest zarchiwizowany i nie może spełniać nowych dokumentów' });
  if (template && template.scope !== subjectType) return res.status(409).json({ error: 'Szablon nie pasuje do typu podmiotu', expected: template.scope });
  const now = new Date().toISOString();
  let content = String(req.body?.content ?? '');
  let fileName = `${requirement.name}-${subjectType}-${subjectId}-${now.slice(0, 10)}.txt`.toLowerCase().replace(/[^a-z0-9_.-]+/g, '-');
  let missingFields = [];
  if (template) {
    const context = buildDocumentContext(req.db, req.user, subjectType, subjectId);
    if (context.error) return res.status(context.status).json(context);
    const rendered = renderDocumentTemplate(template, context.context);
    content = rendered.content;
    fileName = documentFileName(template, subjectType, subjectId);
    missingFields = rendered.missingFields;
  }
  const document = {
    id: `doc-${crypto.randomUUID().slice(0, 8)}`,
    tenantId: tenantIdForUser(req.db, req.user),
    templateId: template?.id ?? req.body?.templateId ?? `manual-${requirement.id}`,
    requirementId: requirement.id,
    subjectType,
    subjectId,
    status: missingFields.length ? 'draft' : String(req.body?.status ?? 'ready'),
    createdAt: now,
    createdBy: req.user.id,
    summary: String(req.body?.summary ?? `${requirement.name} spelnione dla ${subjectType}:${subjectId}`),
    content,
    fileName,
    missingFields,
  };
  req.db.generatedDocuments.unshift(document);
  const report = subjectDocumentCompliance(req.db, req.user, subjectType, subjectId);
  pushEvent(req.db, req.user, 'announcements', 'document_requirement.fulfilled', {
    id: document.id,
    requirementId: requirement.id,
    subjectType,
    subjectId,
    status: document.status,
  });
  await saveDb(req.db);
  res.status(201).json({ document, requirement, compliance: report });
});

app.get('/api/job-positions', requireAccess('hr'), (req, res) => {
  res.json(visibleJobPositions(req.db, req.user));
});

app.post('/api/job-positions', requireAccess('hr', 'write'), async (req, res) => {
  const payload = buildJobPositionPayload(req.db, req.user, req.body ?? {});
  if (payload.error) return res.status(payload.status).json({ error: payload.error });
  req.db.jobPositions ??= [];
  req.db.jobPositions.unshift(payload.position);
  const requirements = syncPositionDocumentRequirements(req.db, req.user, payload.position, req.body ?? {});
  pushEvent(req.db, req.user, 'announcements', 'job_position.created', {
    id: payload.position.id,
    title: payload.position.title,
    department: payload.position.department,
    requiredDocuments: payload.position.requiredDocuments,
    requirementsCreated: requirements.length,
  });
  await saveDb(req.db);
  res.status(201).json({ position: payload.position, requirements });
});

app.patch('/api/job-positions/:id', requireAccess('hr', 'write'), async (req, res) => {
  const position = visibleJobPositions(req.db, req.user).find((next) => next.id === req.params.id);
  if (!position) return res.status(404).json({ error: 'Nie znaleziono stanowiska pracy' });
  if (!position.tenantId || rowTenantId(req.db, position) !== tenantIdForUser(req.db, req.user)) {
    return res.status(409).json({ error: 'Bazowego stanowiska nie można edytować bezpośrednio; utwórz kopię przez POST /api/job-positions z basedOnPositionId' });
  }
  const payload = buildJobPositionPayload(req.db, req.user, req.body ?? {}, position);
  if (payload.error) return res.status(payload.status).json({ error: payload.error });
  Object.assign(position, payload.position, { id: position.id, tenantId: tenantIdForUser(req.db, req.user) });
  const requirements = syncPositionDocumentRequirements(req.db, req.user, position, req.body ?? {});
  pushEvent(req.db, req.user, 'announcements', 'job_position.updated', {
    id: position.id,
    title: position.title,
    department: position.department,
    requiredDocuments: position.requiredDocuments,
    requirementsCreated: requirements.length,
  });
  await saveDb(req.db);
  res.json({ position, requirements });
});

app.delete('/api/job-positions/:id', requireAccess('hr', 'write'), async (req, res) => {
  const position = visibleJobPositions(req.db, req.user, { includeArchivedReferenced: true }).find((next) => next.id === req.params.id);
  if (!position) return res.status(404).json({ error: 'Nie znaleziono stanowiska pracy' });
  if (!position.tenantId || rowTenantId(req.db, position) !== tenantIdForUser(req.db, req.user)) {
    return res.status(409).json({ error: 'Bazowego stanowiska nie można usunąć bezpośrednio; utwórz i usuń kopię tenantową' });
  }
  const used = visibleEmployeeContracts(req.db, req.user).some((contract) => contract.positionId === position.id);
  const requirements = removePositionDocumentRequirements(req.db, req.user, position.id);
  if (used) {
    position.status = 'archived';
    position.deletedAt = new Date().toISOString();
    position.deletedBy = req.user.id;
    position.updatedAt = position.deletedAt;
    position.updatedBy = req.user.id;
  } else {
    req.db.jobPositions = (req.db.jobPositions ?? []).filter((next) => next.id !== position.id);
  }
  pushEvent(req.db, req.user, 'announcements', used ? 'job_position.archived' : 'job_position.deleted', {
    id: position.id,
    title: position.title,
    archived: used,
    deleted: !used,
    linkedRequirements: requirements,
  });
  await saveDb(req.db);
  res.json({ position: used ? position : null, archived: used, deleted: !used, requirements });
});

app.get('/api/hr/contracts', requireAccess('hr'), (req, res) => {
  res.json(visibleEmployeeContracts(req.db, req.user));
});

app.post('/api/hr/contracts', requireAccess('hr', 'write'), async (req, res) => {
  const employeeId = optionalText(req.body?.employeeId);
  if (!employeeId) return res.status(400).json({ error: 'employeeId jest wymagane' });
  const employee = visibleUsers(req.db, req.user).find((next) => next.id === employeeId);
  if (!employee) return res.status(404).json({ error: 'Nie znaleziono pracownika w tenant/oddziale' });
  const existing = optionalText(req.body?.contractId)
    ? visibleEmployeeContracts(req.db, req.user).find((contract) => contract.id === optionalText(req.body.contractId))
    : (req.body?.replaceExisting === false
      ? null
      : visibleEmployeeContracts(req.db, req.user).find((contract) => contract.employeeId === employee.id && ['draft', 'active', 'ending'].includes(contract.status)));
  if (req.body?.contractId && !existing) return res.status(404).json({ error: 'Nie znaleziono umowy do aktualizacji' });
  const payload = employeeContractPayload(req.db, req.user, req.body ?? {}, existing);
  if (payload.error) return res.status(payload.status).json({ error: payload.error });
  const contract = existing ?? payload.contract;
  if (existing) Object.assign(contract, payload.contract, { id: existing.id });
  if (!existing) {
    req.db.employeeContracts ??= [];
    req.db.employeeContracts.unshift(contract);
  }

  const documentResult = maybeGenerateEmployeeContractDocument(req.db, req.user, contract, req.body ?? {});
  if (documentResult.error) return res.status(documentResult.status).json(documentResult);
  if (documentResult.document) {
    pushEvent(req.db, req.user, 'announcements', 'document.generated', {
      id: documentResult.document.id,
      templateId: documentResult.document.templateId,
      subjectType: documentResult.document.subjectType,
      subjectId: documentResult.document.subjectId,
      status: documentResult.document.status,
      source: 'hr_contract',
    });
  }

  const compliance = subjectDocumentCompliance(req.db, req.user, 'employee', employee.id);
  pushEvent(req.db, req.user, 'announcements', existing ? 'employee_contract.updated' : 'employee_contract.created', {
    id: contract.id,
    employeeId: contract.employeeId,
    positionId: contract.positionId,
    branchId: contract.branchId,
    status: contract.status,
    generatedDocumentId: contract.generatedDocumentId,
  });
  await saveDb(req.db);
  res.status(existing ? 200 : 201).json({
    contract,
    employee: publicUser(employee),
    position: payload.position,
    document: documentResult.document,
    documentSkippedReason: documentResult.documentSkippedReason,
    requirement: documentResult.requirement,
    compliance,
  });
});

app.patch('/api/hr/contracts/:id', requireAccess('hr', 'write'), async (req, res) => {
  const existing = visibleEmployeeContracts(req.db, req.user).find((contract) => contract.id === req.params.id);
  if (!existing) return res.status(404).json({ error: 'Nie znaleziono umowy' });
  const payload = employeeContractPayload(req.db, req.user, req.body ?? {}, existing);
  if (payload.error) return res.status(payload.status).json({ error: payload.error });
  Object.assign(existing, payload.contract, { id: existing.id });

  const documentResult = maybeGenerateEmployeeContractDocument(req.db, req.user, existing, { generateDocument: false, ...(req.body ?? {}) });
  if (documentResult.error) return res.status(documentResult.status).json(documentResult);
  if (documentResult.document) {
    pushEvent(req.db, req.user, 'announcements', 'document.generated', {
      id: documentResult.document.id,
      templateId: documentResult.document.templateId,
      subjectType: documentResult.document.subjectType,
      subjectId: documentResult.document.subjectId,
      status: documentResult.document.status,
      source: 'hr_contract',
    });
  }

  const compliance = subjectDocumentCompliance(req.db, req.user, 'employee', existing.employeeId);
  pushEvent(req.db, req.user, 'announcements', 'employee_contract.updated', {
    id: existing.id,
    employeeId: existing.employeeId,
    positionId: existing.positionId,
    branchId: existing.branchId,
    status: existing.status,
    generatedDocumentId: existing.generatedDocumentId,
  });
  await saveDb(req.db);
  res.json({
    contract: existing,
    employee: publicUser(payload.employee),
    position: payload.position,
    document: documentResult.document,
    documentSkippedReason: documentResult.documentSkippedReason,
    requirement: documentResult.requirement,
    compliance,
  });
});

app.delete('/api/hr/contracts/:id', requireAccess('hr', 'write'), async (req, res) => {
  const contract = visibleEmployeeContracts(req.db, req.user).find((next) => next.id === req.params.id);
  if (!contract) return res.status(404).json({ error: 'Nie znaleziono umowy' });
  contract.status = 'archived';
  contract.deletedAt = new Date().toISOString();
  contract.deletedBy = req.user.id;
  contract.updatedAt = contract.deletedAt;
  contract.updatedBy = req.user.id;
  pushEvent(req.db, req.user, 'announcements', 'employee_contract.archived', {
    id: contract.id,
    employeeId: contract.employeeId,
    positionId: contract.positionId,
    branchId: contract.branchId,
  });
  await saveDb(req.db);
  res.json({ contract, archived: true, deleted: false });
});

app.get('/api/hr/trainings', requireAccess('hr'), (req, res) => {
  res.json(visibleTrainings(req.db, req.user));
});

app.post('/api/hr/trainings', requireAccess('hr', 'write'), async (req, res) => {
  const payload = trainingPayload(req.db, req.user, req.body ?? {});
  if (payload.error) return res.status(payload.status).json({ error: payload.error });
  const training = { id: req.body?.id ?? nextSequenceId('tr', req.db.trainings ?? []), ...payload };
  req.db.trainings ??= [];
  req.db.trainings.unshift(training);
  pushEvent(req.db, req.user, 'announcements', 'hr.training.created', {
    id: training.id,
    employeeId: training.employeeId,
    status: training.status,
    expiresAt: training.expiresAt,
  });
  await saveDb(req.db);
  res.status(201).json(training);
});

app.patch('/api/hr/trainings/:id', requireAccess('hr', 'write'), async (req, res) => {
  const training = visibleTrainings(req.db, req.user).find((next) => next.id === req.params.id);
  if (!training) return res.status(404).json({ error: 'Nie znaleziono szkolenia' });
  const payload = trainingPayload(req.db, req.user, req.body ?? {}, training);
  if (payload.error) return res.status(payload.status).json({ error: payload.error });
  Object.assign(training, payload, { id: training.id });
  pushEvent(req.db, req.user, 'announcements', 'hr.training.updated', {
    id: training.id,
    employeeId: training.employeeId,
    status: training.status,
    expiresAt: training.expiresAt,
  });
  await saveDb(req.db);
  res.json(training);
});

app.delete('/api/hr/trainings/:id', requireAccess('hr', 'write'), async (req, res) => {
  const training = visibleTrainings(req.db, req.user).find((next) => next.id === req.params.id);
  if (!training) return res.status(404).json({ error: 'Nie znaleziono szkolenia' });
  training.status = 'archived';
  training.deletedAt = new Date().toISOString();
  training.deletedBy = req.user.id;
  training.updatedAt = training.deletedAt;
  training.updatedBy = req.user.id;
  pushEvent(req.db, req.user, 'announcements', 'hr.training.archived', { id: training.id, employeeId: training.employeeId });
  await saveDb(req.db);
  res.json({ training, archived: true, deleted: false });
});

app.get('/api/hr/medical-exams', requireAccess('hr'), (req, res) => {
  res.json(visibleMedicalExams(req.db, req.user));
});

app.post('/api/hr/medical-exams', requireAccess('hr', 'write'), async (req, res) => {
  const payload = medicalExamPayload(req.db, req.user, req.body ?? {});
  if (payload.error) return res.status(payload.status).json({ error: payload.error });
  const exam = { id: req.body?.id ?? nextSequenceId('med', req.db.medicalExams ?? []), ...payload };
  req.db.medicalExams ??= [];
  req.db.medicalExams.unshift(exam);
  pushEvent(req.db, req.user, 'announcements', 'hr.medical_exam.created', {
    id: exam.id,
    employeeId: exam.employeeId,
    type: exam.type,
    status: exam.status,
    expiresAt: exam.expiresAt,
  });
  await saveDb(req.db);
  res.status(201).json(exam);
});

app.patch('/api/hr/medical-exams/:id', requireAccess('hr', 'write'), async (req, res) => {
  const exam = visibleMedicalExams(req.db, req.user).find((next) => next.id === req.params.id);
  if (!exam) return res.status(404).json({ error: 'Nie znaleziono badania' });
  const payload = medicalExamPayload(req.db, req.user, req.body ?? {}, exam);
  if (payload.error) return res.status(payload.status).json({ error: payload.error });
  Object.assign(exam, payload, { id: exam.id });
  pushEvent(req.db, req.user, 'announcements', 'hr.medical_exam.updated', {
    id: exam.id,
    employeeId: exam.employeeId,
    type: exam.type,
    status: exam.status,
    expiresAt: exam.expiresAt,
  });
  await saveDb(req.db);
  res.json(exam);
});

app.delete('/api/hr/medical-exams/:id', requireAccess('hr', 'write'), async (req, res) => {
  const exam = visibleMedicalExams(req.db, req.user).find((next) => next.id === req.params.id);
  if (!exam) return res.status(404).json({ error: 'Nie znaleziono badania' });
  exam.status = 'archived';
  exam.deletedAt = new Date().toISOString();
  exam.deletedBy = req.user.id;
  exam.updatedAt = exam.deletedAt;
  exam.updatedBy = req.user.id;
  pushEvent(req.db, req.user, 'announcements', 'hr.medical_exam.archived', { id: exam.id, employeeId: exam.employeeId });
  await saveDb(req.db);
  res.json({ exam, archived: true, deleted: false });
});

app.get('/api/hr/certifications', requireAccess('hr'), (req, res) => {
  res.json(visibleCertifications(req.db, req.user));
});

app.post('/api/hr/certifications', requireAccess('hr', 'write'), async (req, res) => {
  const payload = certificationPayload(req.db, req.user, req.body ?? {});
  if (payload.error) return res.status(payload.status).json({ error: payload.error });
  const certification = { id: req.body?.id ?? nextSequenceId('cert', req.db.certifications ?? []), ...payload };
  req.db.certifications ??= [];
  req.db.certifications.unshift(certification);
  pushEvent(req.db, req.user, 'announcements', 'hr.certification.created', {
    id: certification.id,
    employeeId: certification.employeeId,
    status: certification.status,
    expiresAt: certification.expiresAt,
  });
  await saveDb(req.db);
  res.status(201).json(certification);
});

app.patch('/api/hr/certifications/:id', requireAccess('hr', 'write'), async (req, res) => {
  const certification = visibleCertifications(req.db, req.user).find((next) => next.id === req.params.id);
  if (!certification) return res.status(404).json({ error: 'Nie znaleziono uprawnienia' });
  const payload = certificationPayload(req.db, req.user, req.body ?? {}, certification);
  if (payload.error) return res.status(payload.status).json({ error: payload.error });
  Object.assign(certification, payload, { id: certification.id });
  pushEvent(req.db, req.user, 'announcements', 'hr.certification.updated', {
    id: certification.id,
    employeeId: certification.employeeId,
    status: certification.status,
    expiresAt: certification.expiresAt,
  });
  await saveDb(req.db);
  res.json(certification);
});

app.delete('/api/hr/certifications/:id', requireAccess('hr', 'write'), async (req, res) => {
  const certification = visibleCertifications(req.db, req.user).find((next) => next.id === req.params.id);
  if (!certification) return res.status(404).json({ error: 'Nie znaleziono uprawnienia' });
  certification.status = 'archived';
  certification.deletedAt = new Date().toISOString();
  certification.deletedBy = req.user.id;
  certification.updatedAt = certification.deletedAt;
  certification.updatedBy = req.user.id;
  pushEvent(req.db, req.user, 'announcements', 'hr.certification.archived', { id: certification.id, employeeId: certification.employeeId });
  await saveDb(req.db);
  res.json({ certification, archived: true, deleted: false });
});

app.get('/api/hr/compliance', requireAccess('hr'), (req, res) => {
  res.json(hrComplianceReport(req.db, req.user, req.query.days));
});

function normalizeModuleCustomFields(fields = []) {
  const allowedTypes = new Set(['text', 'number', 'date', 'select']);
  const seen = new Set();
  return fields
    .map((field) => ({
      key: optionalText(field?.key).replace(/\s+/g, '_').toLowerCase(),
      label: optionalText(field?.label),
      type: allowedTypes.has(field?.type) ? field.type : 'text',
    }))
    .filter((field) => {
      if (!field.key || !field.label || seen.has(field.key)) return false;
      seen.add(field.key);
      return true;
    });
}

function buildModuleConfigPayload(db, user, body = {}, existing = null) {
  const requestedModule = optionalText(body.module);
  if (requestedModule && !moduleKeys.has(requestedModule)) {
    return { error: 'Nieprawidłowy klucz modułu', status: 400 };
  }
  const module = requestedModule || existing?.module;
  if (!module) return { error: 'module jest wymagany', status: 400 };
  const label = optionalText(body.label ?? existing?.label ?? module);
  if (label.length < 2) return { error: 'Nazwa modułu musi mieć co najmniej 2 znaki', status: 400 };
  const tenantId = tenantIdForUser(db, user);
  const duplicate = visibleModuleConfigs(db, user).find((config) => (
    config.module === module && config.id !== existing?.id
  ));
  if (duplicate) return { error: 'Konfiguracja tego modułu już istnieje dla tego tenanta', status: 409, duplicateId: duplicate.id };
  const now = new Date().toISOString();
  return {
    config: {
      ...(existing ?? {}),
      id: existing?.id ?? nextSequenceId('cfg', db.moduleConfigs ?? []),
      tenantId,
      module,
      label,
      enabled: typeof body.enabled === 'boolean' ? body.enabled : (existing?.enabled ?? true),
      customFields: Array.isArray(body.customFields)
        ? normalizeModuleCustomFields(body.customFields)
        : (existing?.customFields ?? []),
      statuses: Array.isArray(body.statuses)
        ? body.statuses.map((status) => optionalText(status)).filter(Boolean)
        : (existing?.statuses ?? []),
      requiredDocuments: Array.isArray(body.requiredDocuments)
        ? body.requiredDocuments.map((document) => optionalText(document)).filter(Boolean)
        : (existing?.requiredDocuments ?? []),
      status: 'active',
      createdAt: existing?.createdAt ?? now,
      createdBy: existing?.createdBy ?? user.id,
      updatedAt: now,
      updatedBy: user.id,
    },
  };
}

app.get('/api/module-configs', requireAccess('settings'), (req, res) => {
  res.json(visibleModuleConfigs(req.db, req.user));
});

app.post('/api/module-configs', requireAccess('settings', 'write'), async (req, res) => {
  const payload = buildModuleConfigPayload(req.db, req.user, req.body ?? {});
  if (payload.error) return res.status(payload.status).json({ error: payload.error, duplicateId: payload.duplicateId });
  req.db.moduleConfigs ??= [];
  req.db.moduleConfigs.unshift(payload.config);
  pushEvent(req.db, req.user, 'announcements', 'module_config.created', {
    id: payload.config.id,
    module: payload.config.module,
    label: payload.config.label,
    enabled: payload.config.enabled,
  });
  await saveDb(req.db);
  res.status(201).json(payload.config);
});

app.patch('/api/module-configs/:id', requireAccess('settings', 'write'), async (req, res) => {
  const config = visibleModuleConfigs(req.db, req.user).find((next) => next.id === req.params.id);
  if (!config) return res.status(404).json({ error: 'Nie znaleziono konfiguracji modułu' });
  if (!config.tenantId || rowTenantId(req.db, config) !== tenantIdForUser(req.db, req.user)) {
    return res.status(409).json({ error: 'Bazowej konfiguracji modułu nie można edytować bezpośrednio; utwórz tenantową kopię' });
  }
  const payload = buildModuleConfigPayload(req.db, req.user, req.body ?? {}, config);
  if (payload.error) return res.status(payload.status).json({ error: payload.error, duplicateId: payload.duplicateId });
  Object.assign(config, payload.config, { id: config.id, tenantId: tenantIdForUser(req.db, req.user) });
  pushEvent(req.db, req.user, 'announcements', 'module_config.updated', {
    id: config.id,
    module: config.module,
    label: config.label,
    enabled: config.enabled,
  });
  await saveDb(req.db);
  res.json(config);
});

app.delete('/api/module-configs/:id', requireAccess('settings', 'write'), async (req, res) => {
  const config = visibleModuleConfigs(req.db, req.user).find((next) => next.id === req.params.id);
  if (!config) return res.status(404).json({ error: 'Nie znaleziono konfiguracji modułu' });
  if (!config.tenantId || rowTenantId(req.db, config) !== tenantIdForUser(req.db, req.user)) {
    return res.status(409).json({ error: 'Bazowej konfiguracji modułu nie można usunąć; usuwaj tenantową kopię' });
  }
  config.status = 'archived';
  config.deletedAt = new Date().toISOString();
  config.deletedBy = req.user.id;
  config.updatedAt = config.deletedAt;
  config.updatedBy = req.user.id;
  pushEvent(req.db, req.user, 'announcements', 'module_config.archived', {
    id: config.id,
    module: config.module,
    label: config.label,
  });
  await saveDb(req.db);
  res.json({ config, archived: true, deleted: false });
});

app.get('/api/integrations/settings', requireAccess('settings'), (req, res) => {
  const settings = currentIntegrationSettings(req.db, req.user);
  const health = integrationHealth(settings);
  const skillCatalog = integrationSkillCatalog(settings, health);
  const readiness = productionReadinessChecklist(settings, health, skillCatalog);
  res.json({ settings, health, skillCatalog, readiness, setupPlan: integrationSetupPlan(settings, health, readiness) });
});

app.patch('/api/integrations/settings', requireAccess('settings', 'write'), async (req, res) => {
  const current = currentIntegrationSettings(req.db, req.user);
  const settings = replaceIntegrationSettings(req.db, req.user, mergeIntegrationSettings(current, req.body ?? {}, req.user));
  const health = integrationHealth(settings);
  pushEvent(req.db, req.user, 'announcements', 'integration.settings_updated', {
    id: settings.id,
    health: health.status,
    missingRequired: health.missingRequired,
  });
  await saveDb(req.db);
  const skillCatalog = integrationSkillCatalog(settings, health);
  const readiness = productionReadinessChecklist(settings, health, skillCatalog);
  res.json({ settings, health, skillCatalog, readiness, setupPlan: integrationSetupPlan(settings, health, readiness) });
});

app.get('/api/integrations/health', requireAccess('settings'), (req, res) => {
  const settings = currentIntegrationSettings(req.db, req.user);
  const health = integrationHealth(settings);
  const skillCatalog = integrationSkillCatalog(settings, health);
  const readiness = productionReadinessChecklist(settings, health, skillCatalog);
  res.json({ settingsId: settings.id, health, skillCatalog, readiness, setupPlan: integrationSetupPlan(settings, health, readiness) });
});

app.get('/api/integrations/skills', requireAccess('settings'), (req, res) => {
  const settings = currentIntegrationSettings(req.db, req.user);
  const health = integrationHealth(settings);
  const skillCatalog = integrationSkillCatalog(settings, health);
  const readiness = productionReadinessChecklist(settings, health, skillCatalog);
  res.json({ settingsId: settings.id, health, skillCatalog, readiness, setupPlan: integrationSetupPlan(settings, health, readiness) });
});

app.get('/api/integrations/setup-report', requireAccess('settings'), (req, res) => {
  const settings = currentIntegrationSettings(req.db, req.user);
  const report = integrationSetupReport(req.db, req.user, settings);
  if (String(req.query.format || '').toLowerCase() === 'markdown') {
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="arbor-os-setup-report.md"');
    return res.send(formatIntegrationSetupReportMarkdown(report));
  }
  res.json(report);
});

app.post('/api/integrations/live-preflight', requireAccess('settings', 'write'), async (req, res) => {
  const settings = currentIntegrationSettings(req.db, req.user);
  const preflight = integrationLivePreflight(req.db, req.user, settings);
  let setupTasks = null;
  if (!preflight.allowed && req.body?.createTasks !== false) {
    setupTasks = createIntegrationSetupTasks(req.db, req.user, settings);
  }
  pushEvent(req.db, req.user, 'announcements', 'integration.live_preflight', {
    settingsId: settings.id,
    allowed: preflight.allowed,
    status: preflight.status,
    blockers: preflight.blockers.map((blocker) => blocker.key),
    createdTasks: setupTasks?.created?.length || 0,
    skippedTasks: setupTasks?.skipped?.length || 0,
  });
  await saveDb(req.db);
  res.json({
    settingsId: settings.id,
    preflight,
    setupTasks: setupTasks ? {
      ...setupTasks,
      tasks: visibleTasks(req.db, req.user).filter((task) => String(task.sourceId || '').startsWith('integration_setup:')),
    } : null,
    health: preflight.report.health,
    skillCatalog: preflight.report.skillCatalog,
    readiness: preflight.report.readiness,
    setupPlan: preflight.report.setupPlan,
  });
});

app.post('/api/integrations/test', requireAccess('settings', 'write'), async (req, res) => {
  const settings = currentIntegrationSettings(req.db, req.user);
  const diagnostics = integrationDiagnostics(settings);
  pushEvent(req.db, req.user, 'announcements', 'integrations.tested', {
    settingsId: settings.id,
    status: diagnostics.status,
    mode: diagnostics.mode,
    missing: diagnostics.summary.missing,
    blockers: diagnostics.blockers.map((blocker) => blocker.integration),
  });
  await saveDb(req.db);
  res.json({ settingsId: settings.id, health: integrationHealth(settings), diagnostics, skillCatalog: diagnostics.skillCatalog, readiness: diagnostics.readiness, setupPlan: diagnostics.setupPlan });
});

app.post('/api/integrations/test-channel', requireAccess('settings', 'write'), async (req, res) => {
  const settings = currentIntegrationSettings(req.db, req.user);
  const result = integrationChannelTest(settings, req.body?.channel);
  if (result.error) return res.status(result.status || 400).json({ error: result.error });
  pushEvent(req.db, req.user, 'announcements', 'integration.channel_tested', {
    settingsId: settings.id,
    channel: result.channel,
    mode: result.mode,
    liveReady: result.liveReady,
    severity: result.severity,
    requiredEnv: result.requiredEnv,
  });
  await saveDb(req.db);
  res.json({ settingsId: settings.id, result, health: integrationHealth(settings) });
});

app.post('/api/integrations/setup-tasks', requireAccess('settings', 'write'), async (req, res) => {
  const settings = currentIntegrationSettings(req.db, req.user);
  const result = createIntegrationSetupTasks(req.db, req.user, settings);
  pushEvent(req.db, req.user, 'announcements', 'integration.setup_tasks_created', {
    settingsId: settings.id,
    created: result.created.length,
    skipped: result.skipped.length,
    blockers: result.setupPlan.items.filter((item) => !item.ready).map((item) => item.key),
  });
  await saveDb(req.db);
  res.status(201).json({
    settingsId: settings.id,
    created: result.created,
    skipped: result.skipped,
    setupPlan: result.setupPlan,
    tasks: visibleTasks(req.db, req.user).filter((task) => String(task.sourceId || '').startsWith('integration_setup:')),
  });
});

app.get('/api/billing', requireAccess('settings'), (req, res) => {
  res.json({
    tenants: visibleTenants(req.db, req.user),
    planLimits: req.db.planLimits ?? [],
    tenantSubscriptions: visibleTenantSubscriptions(req.db, req.user),
    billingPayments: visibleBillingPayments(req.db, req.user),
  });
});

app.patch('/api/billing/subscription', requireAccess('settings', 'write'), async (req, res) => {
  const tenantId = tenantIdForUser(req.db, req.user);
  const tenant = req.db.tenants.find((next) => next.id === tenantId);
  if (!tenant) return res.status(404).json({ error: 'Nie znaleziono tenanta' });
  const requestedPlan = String(req.body?.plan ?? tenant.plan);
  const limit = planLimit(req.db, requestedPlan);
  if (!limit) return res.status(400).json({ error: 'Nieprawidłowy plan' });
  const allowedStatuses = new Set(['trialing', 'active', 'past_due', 'paused', 'cancelled']);
  const now = new Date();
  const period = nextMonthlyPeriod(now);
  let subscription = tenantSubscription(req.db, req.user);
  if (!subscription) {
    subscription = {
      id: `sub-${tenantId}`,
      tenantId,
      plan: requestedPlan,
      status: 'active',
      billingProvider: 'manual',
      currentPeriodStart: period.start,
      currentPeriodEnd: period.end,
      seats: visibleUsers(req.db, req.user).length,
      aiMinutesUsed: 0,
      storageGbUsed: 0,
      nextInvoiceNet: limit.monthlyPriceNet,
      updatedAt: now.toISOString(),
      updatedBy: req.user.id,
    };
    req.db.tenantSubscriptions.unshift(subscription);
  }
  subscription.plan = requestedPlan;
  if (allowedStatuses.has(req.body?.status)) subscription.status = req.body.status;
  if (req.body?.billingProvider === 'manual' || req.body?.billingProvider === 'przelewy24') subscription.billingProvider = req.body.billingProvider;
  if (Number.isFinite(Number(req.body?.seats))) subscription.seats = Math.max(1, Math.round(Number(req.body.seats)));
  subscription.nextInvoiceNet = limit.monthlyPriceNet;
  subscription.updatedAt = now.toISOString();
  subscription.updatedBy = req.user.id;
  tenant.plan = subscription.plan;
  tenant.status = subscription.status === 'trialing'
    ? 'trial'
    : ['paused', 'cancelled', 'past_due'].includes(subscription.status)
      ? 'paused'
      : 'active';
  pushEvent(req.db, req.user, 'announcements', 'billing.subscription_updated', {
    id: subscription.id,
    tenantId,
    plan: subscription.plan,
    status: subscription.status,
  });
  await saveDb(req.db);
  res.json({ tenant, subscription });
});

app.post('/api/billing/checkout', requireAccess('settings', 'write'), async (req, res) => {
  const tenantId = tenantIdForUser(req.db, req.user);
  const tenant = req.db.tenants.find((next) => next.id === tenantId);
  if (!tenant) return res.status(404).json({ error: 'Nie znaleziono tenanta' });
  const requestedPlan = String(req.body?.plan ?? tenant.plan);
  const limit = planLimit(req.db, requestedPlan);
  if (!limit) return res.status(400).json({ error: 'Nieprawidłowy plan' });
  const now = new Date();
  const period = nextMonthlyPeriod(now);
  let subscription = tenantSubscription(req.db, req.user);
  if (!subscription) {
    subscription = {
      id: `sub-${tenantId}`,
      tenantId,
      plan: requestedPlan,
      status: 'active',
      billingProvider: 'przelewy24',
      currentPeriodStart: period.start,
      currentPeriodEnd: period.end,
      seats: visibleUsers(req.db, req.user).length,
      aiMinutesUsed: 0,
      storageGbUsed: 0,
      nextInvoiceNet: limit.monthlyPriceNet,
      updatedAt: now.toISOString(),
      updatedBy: req.user.id,
    };
    req.db.tenantSubscriptions.unshift(subscription);
  }
  subscription.plan = requestedPlan;
  subscription.status = 'active';
  subscription.billingProvider = 'przelewy24';
  subscription.currentPeriodStart = period.start;
  subscription.currentPeriodEnd = period.end;
  subscription.nextInvoiceNet = limit.monthlyPriceNet;
  subscription.updatedAt = now.toISOString();
  subscription.updatedBy = req.user.id;
  tenant.plan = requestedPlan;
  tenant.status = 'active';
  const externalId = `P24-DEMO-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const payment = {
    id: `pay-${crypto.randomUUID().slice(0, 8)}`,
    tenantId,
    subscriptionId: subscription.id,
    provider: 'przelewy24',
    status: 'paid',
    amountNet: limit.monthlyPriceNet,
    currency: 'PLN',
    description: `Arbor OS ${limit.label} - symulowana płatność Przelewy24`,
    createdAt: now.toISOString(),
    paidAt: new Date(now.getTime() + 1000 * 30).toISOString(),
    externalId,
    checkoutUrl: `https://secure.przelewy24.pl/trnRequest/${externalId}`,
  };
  req.db.billingPayments.unshift(payment);
  pushEvent(req.db, req.user, 'announcements', 'billing.checkout_completed', {
    id: payment.id,
    tenantId,
    plan: subscription.plan,
    amountNet: payment.amountNet,
    provider: payment.provider,
  });
  await saveDb(req.db);
  res.status(201).json({ tenant, subscription, payment });
});

app.get('/api/equipment', requireAccess('fleet'), (req, res) => {
  res.json(visibleEquipment(req.db, req.user));
});

function buildEquipmentPayload(db, user, body = {}, existing = null) {
  const branch = body.branchId || !existing
    ? branchForWrite(db, user, body.branchId ?? existing?.branchId)
    : { branchId: existing.branchId };
  if (branch.error) return branch;
  const name = optionalText(body.name ?? existing?.name);
  if (name.length < 2) return { error: 'Nazwa sprzętu jest wymagana', status: 400 };
  const type = optionalText(body.type ?? existing?.type ?? 'pojazd');
  if (!equipmentTypes.has(type)) return { error: 'Nieprawidłowy typ sprzętu', status: 400 };
  const status = optionalText(body.status ?? existing?.status ?? 'dostepny');
  if (!equipmentStatuses.has(status)) return { error: 'Nieprawidłowy status sprzętu', status: 400 };
  const risk = optionalText(body.risk ?? existing?.risk ?? 'niski');
  if (!equipmentRisks.has(risk)) return { error: 'Nieprawidłowe ryzyko sprzętu', status: 400 };
  const reviewDueDate = parseOptionalDate(body.reviewDue ?? existing?.reviewDue ?? new Date(Date.now() + 1000 * 60 * 60 * 24 * 60));
  if (!reviewDueDate) return { error: 'Nieprawidłowa data przeglądu sprzętu', status: 400 };
  const now = new Date().toISOString();
  return {
    item: {
      ...(existing ?? {}),
      id: existing?.id ?? (optionalText(body.id) || `eq-${crypto.randomUUID().slice(0, 8)}`),
      branchId: branch.branchId,
      name,
      type,
      status,
      risk,
      reviewDue: reviewDueDate.toISOString().slice(0, 10),
      createdAt: existing?.createdAt ?? now,
      createdBy: existing?.createdBy ?? user.id,
      updatedAt: now,
      updatedBy: user.id,
    },
  };
}

app.post('/api/equipment', requireAccess('fleet', 'write'), async (req, res) => {
  const payload = buildEquipmentPayload(req.db, req.user, req.body ?? {});
  if (payload.error) return res.status(payload.status).json({ error: payload.error });
  const item = payload.item;
  if ((req.db.equipment ?? []).some((next) => next.id === item.id)) return res.status(409).json({ error: 'Sprzęt o takim ID już istnieje' });
  if (!item.name) return res.status(400).json({ error: 'Nazwa sprzętu jest wymagana' });
  req.db.equipment ??= [];
  req.db.equipment.unshift(item);
  pushEvent(req.db, req.user, 'announcements', 'equipment.created', item);
  await saveDb(req.db);
  res.status(201).json(item);
});

app.patch('/api/equipment/:id', requireAccess('fleet', 'write'), async (req, res) => {
  const item = visibleEquipment(req.db, req.user).find((next) => next.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Nie znaleziono sprzętu' });
  const payload = buildEquipmentPayload(req.db, req.user, req.body ?? {}, item);
  if (payload.error) return res.status(payload.status).json({ error: payload.error });
  Object.assign(item, payload.item, { id: item.id });
  pushEvent(req.db, req.user, 'announcements', 'equipment.updated', {
    id: item.id,
    branchId: item.branchId,
    name: item.name,
    status: item.status,
    risk: item.risk,
    reviewDue: item.reviewDue,
  });
  await saveDb(req.db);
  res.json(item);
});

app.delete('/api/equipment/:id', requireAccess('fleet', 'write'), async (req, res) => {
  const item = visibleEquipment(req.db, req.user).find((next) => next.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Nie znaleziono sprzętu' });
  const reservations = (req.db.equipmentReservations ?? []).filter((reservation) => reservation.equipmentId === item.id);
  const activeReservation = reservations.find((reservation) => reservation.status !== 'cancelled');
  if (activeReservation) return res.status(409).json({ error: 'Sprzęt ma aktywną rezerwację', reservationId: activeReservation.id });
  const usedByDocuments = (req.db.generatedDocuments ?? []).some((document) => (
    document.subjectType === 'equipment'
    && document.subjectId === item.id
    && generatedDocumentVisible(req.db, req.user, document)
  ));
  const used = reservations.length > 0 || usedByDocuments;
  if (used) {
    item.status = 'archived';
    item.deletedAt = new Date().toISOString();
    item.deletedBy = req.user.id;
    item.updatedAt = item.deletedAt;
    item.updatedBy = req.user.id;
  } else {
    req.db.equipment = (req.db.equipment ?? []).filter((next) => next.id !== item.id);
  }
  pushEvent(req.db, req.user, 'announcements', used ? 'equipment.archived' : 'equipment.deleted', {
    id: item.id,
    branchId: item.branchId,
    name: item.name,
    used,
    status: used ? item.status : 'deleted',
  });
  await saveDb(req.db);
  res.json({ equipment: used ? item : null, archived: used, deleted: !used });
});

app.get('/api/equipment-reservations', requireAccess('fleet'), (req, res) => {
  res.json(visibleEquipmentReservations(req.db, req.user));
});

app.post('/api/equipment/:id/reservations', requireAccess('fleet', 'write'), async (req, res) => {
  const payload = equipmentReservationPayload(req.db, req.user, { ...(req.body ?? {}), equipmentId: req.params.id, status: 'active' });
  if (payload.error) return res.status(payload.status).json(payload);
  const { item, order, reservation } = payload;
  req.db.equipmentReservations ??= [];
  req.db.equipmentReservations.unshift(reservation);
  refreshEquipmentReservationStatus(req.db, item);
  order.timeline.push({ label: `Sprzęt: ${item.name}`, at: reservation.createdAt, by: actorName(req.user) });
  pushEvent(req.db, req.user, `branch:${item.branchId}:orders`, 'equipment.reserved', reservation);
  await saveDb(req.db);
  res.status(201).json(reservation);
});

app.patch('/api/equipment-reservations/:id', requireAccess('fleet', 'write'), async (req, res) => {
  const reservation = (req.db.equipmentReservations ?? []).find((next) => next.id === req.params.id);
  if (!reservation) return res.status(404).json({ error: 'Nie znaleziono rezerwacji' });
  if (!visibleEquipmentReservations(req.db, req.user).some((next) => next.id === reservation.id)) return res.status(404).json({ error: 'Nie znaleziono rezerwacji' });
  const previousEquipmentId = reservation.equipmentId;
  const previousItem = (req.db.equipment ?? []).find((next) => next.id === previousEquipmentId);
  const payload = equipmentReservationPayload(req.db, req.user, req.body ?? {}, reservation);
  if (payload.error) return res.status(payload.status).json(payload);
  Object.assign(reservation, payload.reservation, { id: reservation.id });
  refreshEquipmentReservationStatus(req.db, previousItem);
  refreshEquipmentReservationStatus(req.db, payload.item);
  payload.order.timeline.push({ label: `Aktualizacja rezerwacji sprzętu: ${payload.item.name}`, at: reservation.updatedAt, by: actorName(req.user) });
  pushEvent(req.db, req.user, `branch:${reservation.branchId}:orders`, 'equipment.reservation_updated', reservation);
  await saveDb(req.db);
  res.json(reservation);
});

app.delete('/api/equipment-reservations/:id', requireAccess('fleet', 'write'), async (req, res) => {
  const reservation = (req.db.equipmentReservations ?? []).find((next) => next.id === req.params.id);
  if (!reservation) return res.status(404).json({ error: 'Nie znaleziono rezerwacji' });
  if (!visibleEquipmentReservations(req.db, req.user).some((next) => next.id === reservation.id)) return res.status(404).json({ error: 'Nie znaleziono rezerwacji' });
  reservation.status = 'cancelled';
  reservation.updatedAt = new Date().toISOString();
  reservation.updatedBy = req.user.id;
  const item = req.db.equipment.find((next) => next.id === reservation.equipmentId);
  refreshEquipmentReservationStatus(req.db, item);
  pushEvent(req.db, req.user, `branch:${reservation.branchId}:orders`, 'equipment.reservation_cancelled', reservation);
  await saveDb(req.db);
  res.json(reservation);
});

app.get('/api/warehouse', requireAccess('warehouse'), (req, res) => {
  res.json({
    items: visibleWarehouseItems(req.db, req.user),
    movements: visibleWarehouseMovements(req.db, req.user).slice(0, 100),
    orders: (req.db.purchaseOrders ?? []).filter((po) => elevatedBranchRole(req.user) || po.branchId === req.user.branchId),
  });
});

app.post('/api/warehouse/items', requireAccess('warehouse', 'write'), async (req, res) => {
  const payload = warehouseItemPayload(req.db, req.user, req.body ?? {});
  if (payload.error) return res.status(payload.status).json(payload);
  const duplicate = visibleWarehouseItems(req.db, req.user).find((item) => item.branchId === payload.branchId && item.name.toLowerCase() === payload.name.toLowerCase());
  if (duplicate) return res.status(409).json({ error: 'Materiał już istnieje w tym oddziale', duplicateId: duplicate.id });
  const item = {
    id: req.body?.id ?? `wh-${crypto.randomUUID().slice(0, 8)}`,
    ...payload,
    updatedAt: new Date().toISOString(),
  };
  req.db.warehouseItems ??= [];
  req.db.warehouseItems.unshift(item);
  pushEvent(req.db, req.user, 'announcements', 'warehouse.item_created', { id: item.id, name: item.name, branchId: item.branchId });
  await saveDb(req.db);
  res.status(201).json(item);
});

app.patch('/api/warehouse/items/:id', requireAccess('warehouse', 'write'), async (req, res) => {
  const item = visibleWarehouseItems(req.db, req.user).find((next) => next.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Nie znaleziono materiału' });
  const payload = warehouseItemPayload(req.db, req.user, req.body ?? {}, item);
  if (payload.error) return res.status(payload.status).json(payload);
  const duplicate = visibleWarehouseItems(req.db, req.user).find((next) => (
    next.id !== item.id
    && next.branchId === payload.branchId
    && next.name.toLowerCase() === payload.name.toLowerCase()
  ));
  if (duplicate) return res.status(409).json({ error: 'Materiał już istnieje w tym oddziale', duplicateId: duplicate.id });
  Object.assign(item, payload, { id: item.id });
  pushEvent(req.db, req.user, 'announcements', 'warehouse.item_updated', {
    id: item.id,
    name: item.name,
    branchId: item.branchId,
    stock: item.stock,
    minStock: item.minStock,
  });
  await saveDb(req.db);
  res.json(item);
});

app.delete('/api/warehouse/items/:id', requireAccess('warehouse', 'write'), async (req, res) => {
  const item = visibleWarehouseItems(req.db, req.user).find((next) => next.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Nie znaleziono materiału' });
  const movements = (req.db.warehouseMovements ?? []).filter((movement) => movement.itemId === item.id);
  const used = movements.length > 0;
  if (used) {
    item.status = 'archived';
    item.deletedAt = new Date().toISOString();
    item.deletedBy = req.user.id;
    item.updatedAt = item.deletedAt;
    item.updatedBy = req.user.id;
  } else {
    req.db.warehouseItems = (req.db.warehouseItems ?? []).filter((next) => next.id !== item.id);
  }
  pushEvent(req.db, req.user, 'announcements', used ? 'warehouse.item_archived' : 'warehouse.item_deleted', {
    id: item.id,
    name: item.name,
    branchId: item.branchId,
    used,
    status: used ? item.status : 'deleted',
  });
  await saveDb(req.db);
  res.json({ item: used ? item : null, archived: used, deleted: !used });
});

app.post('/api/warehouse/movements', requireAccess('warehouse', 'write'), async (req, res) => {
  const item = (req.db.warehouseItems ?? []).find((next) => next.id === req.body?.itemId);
  if (!item) return res.status(404).json({ error: 'Nie znaleziono materiału' });
  if (!visibleWarehouseItems(req.db, req.user).some((next) => next.id === item.id)) return res.status(403).json({ error: 'Materiał poza zakresem roli lub oddziału' });
  const type = String(req.body?.type ?? '');
  if (!['in', 'out', 'adjust'].includes(type)) return res.status(400).json({ error: 'Nieprawidłowy typ ruchu magazynowego' });
  const qty = Number(req.body?.qty);
  if (!Number.isFinite(qty) || qty <= 0) return res.status(400).json({ error: 'Ilość musi być dodatnia' });
  const nextStock = applyWarehouseMovement(item, type, Math.round(qty));
  if (!Number.isFinite(nextStock) || nextStock < 0) return res.status(409).json({ error: 'Ruch spowodowalby ujemny stan', stock: item.stock });
  const orderId = req.body?.orderId;
  if (orderId && !visibleOrders(req.db, req.user).some((order) => order.id === orderId)) return res.status(403).json({ error: 'Zlecenie poza zakresem roli lub oddziału' });
  const movement = {
    id: `wm-${crypto.randomUUID().slice(0, 8)}`,
    itemId: item.id,
    branchId: item.branchId,
    orderId,
    type,
    qty: Math.round(qty),
    note: String(req.body?.note ?? '').trim(),
    createdBy: req.user.id,
    createdAt: new Date().toISOString(),
  };
  item.stock = nextStock;
  item.updatedAt = movement.createdAt;
  req.db.warehouseMovements ??= [];
  req.db.warehouseMovements.unshift(movement);
  const eventName = item.stock <= item.minStock ? 'warehouse.low_stock' : 'warehouse.movement_created';
  pushEvent(req.db, req.user, 'announcements', eventName, { ...movement, stock: item.stock, minStock: item.minStock, itemName: item.name });
  await saveDb(req.db);
  res.status(201).json({ item, movement });
});

app.post('/api/warehouse/orders', requireAccess('warehouse', 'write'), async (req, res) => {
  const name = String(req.body?.name ?? '').trim();
  if (!name) return res.status(400).json({ error: 'Podaj nazwę materiału' });
  const qty = Number(req.body?.qty);
  if (!Number.isFinite(qty) || qty <= 0) return res.status(400).json({ error: 'Ilość musi być dodatnia' });
  const po = {
    id: `po-${crypto.randomUUID().slice(0, 8)}`,
    branchId: req.user.branchId,
    tenantId: req.user.tenantId ?? null,
    itemId: req.body?.itemId ?? null,
    name,
    qty: Math.round(qty),
    unit: String(req.body?.unit ?? 'szt'),
    supplier: String(req.body?.supplier ?? '').trim(),
    status: 'zlozone',
    createdBy: req.user.id,
    createdAt: new Date().toISOString(),
  };
  req.db.purchaseOrders ??= [];
  req.db.purchaseOrders.unshift(po);
  pushEvent(req.db, req.user, 'announcements', 'warehouse.order_created', { id: po.id, name: po.name, qty: po.qty, branchId: po.branchId });
  await saveDb(req.db);
  res.status(201).json(po);
});

app.patch('/api/warehouse/orders/:id/status', requireAccess('warehouse', 'write'), async (req, res) => {
  const po = (req.db.purchaseOrders ?? []).find((next) => next.id === req.params.id);
  if (!po) return res.status(404).json({ error: 'Nie znaleziono zamowienia' });
  if (!elevatedBranchRole(req.user) && po.branchId !== req.user.branchId) return res.status(403).json({ error: 'Zamówienie poza oddziałem' });
  const status = String(req.body?.status ?? '');
  if (!['zlozone', 'w_drodze', 'dostarczone', 'anulowane'].includes(status)) return res.status(400).json({ error: 'Nieprawidłowy status' });
  po.status = status;
  po.updatedAt = new Date().toISOString();
  // Dostarczone -> przyjmij na stan powiazany material (ruch 'in').
  if (status === 'dostarczone' && po.itemId) {
    const item = (req.db.warehouseItems ?? []).find((i) => i.id === po.itemId);
    if (item) {
      item.stock = Number(item.stock || 0) + Number(po.qty || 0);
      item.updatedAt = po.updatedAt;
      (req.db.warehouseMovements ??= []).unshift({ id: `wm-${crypto.randomUUID().slice(0, 8)}`, itemId: item.id, branchId: item.branchId, type: 'in', qty: po.qty, note: `Dostawa zamowienia ${po.id}`, createdBy: req.user.id, createdAt: po.updatedAt });
    }
  }
  pushEvent(req.db, req.user, 'announcements', 'warehouse.order_status', { id: po.id, status });
  await saveDb(req.db);
  res.json(po);
});

app.get('/api/reports/overview', requireAccess('reports'), (req, res) => {
  res.json(reportOverview(req.db, req.user));
});

app.get('/api/operations/work-queue', requireAccess('dashboard'), (req, res) => {
  res.json(workQueue(req.db, req.user, req.query.limit));
});

app.get('/api/crews', requireAccess('teams'), (req, res) => {
  res.json(visibleCrews(req.db, req.user));
});

app.post('/api/crews', requireAccess('teams', 'write'), async (req, res) => {
  const payload = crewPayload(req.db, req.user, req.body ?? {});
  if (payload.error) return res.status(payload.status).json({ error: payload.error, duplicateId: payload.duplicateId });
  const crew = {
    id: req.body?.id ?? `team-${crypto.randomUUID().slice(0, 8)}`,
    ...payload,
  };
  req.db.crews.unshift(crew);
  pushEvent(req.db, req.user, `branch:${crew.branchId}:orders`, 'crew.created', {
    id: crew.id,
    branchId: crew.branchId,
    name: crew.name,
    leaderId: crew.leaderId,
  });
  await saveDb(req.db);
  res.status(201).json(crew);
});

app.patch('/api/crews/:id', requireAccess('teams', 'write'), async (req, res) => {
  const crew = visibleCrews(req.db, req.user).find((next) => next.id === req.params.id);
  if (!crew) return res.status(404).json({ error: 'Nie znaleziono ekipy' });
  const payload = crewPayload(req.db, req.user, req.body ?? {}, crew);
  if (payload.error) return res.status(payload.status).json({ error: payload.error, duplicateId: payload.duplicateId });
  Object.assign(crew, payload, {
    id: crew.id,
    updatedAt: new Date().toISOString(),
    updatedBy: req.user.id,
  });
  pushEvent(req.db, req.user, `branch:${crew.branchId}:orders`, 'crew.updated', {
    id: crew.id,
    branchId: crew.branchId,
    name: crew.name,
    leaderId: crew.leaderId,
  });
  await saveDb(req.db);
  res.json(crew);
});

app.delete('/api/crews/:id', requireAccess('teams', 'write'), async (req, res) => {
  const crew = visibleCrews(req.db, req.user).find((next) => next.id === req.params.id);
  if (!crew) return res.status(404).json({ error: 'Nie znaleziono ekipy' });
  const usedByOrders = (req.db.orders ?? []).some((order) => !order.deletedAt && order.teamId === crew.id);
  const usedByUsers = (req.db.users ?? []).some((user) => user.teamId === crew.id);
  if (usedByOrders || usedByUsers) {
    crew.status = 'archived';
    crew.deletedAt = new Date().toISOString();
    crew.deletedBy = req.user.id;
    crew.updatedAt = crew.deletedAt;
    crew.updatedBy = req.user.id;
    pushEvent(req.db, req.user, `branch:${crew.branchId}:orders`, 'crew.archived', {
      id: crew.id,
      branchId: crew.branchId,
      usedByOrders,
      usedByUsers,
    });
    await saveDb(req.db);
    return res.json({ crew, archived: true, deleted: false });
  }
  req.db.crews = (req.db.crews ?? []).filter((next) => next.id !== crew.id);
  pushEvent(req.db, req.user, `branch:${crew.branchId}:orders`, 'crew.deleted', {
    id: crew.id,
    branchId: crew.branchId,
  });
  await saveDb(req.db);
  return res.json({ crew, archived: false, deleted: true });
});

app.patch('/api/notifications/read', async (req, res) => {
  const tenantId = tenantIdForUser(req.db, req.user);
  req.db.notifications = req.db.notifications.map((notification) => (
    rowTenantId(req.db, notification) === tenantId && (notification.role === 'ALL' || notification.role === req.user.role)
      ? { ...notification, unread: false }
      : notification
  ));
  await saveDb(req.db);
  res.json({ ok: true });
});

app.use('/api/portal', async (req, res, next) => {
  if (req.method === 'GET' && req.path === '/') {
    const portal = resolvePortal(req);
    if (portal.error) return res.status(portal.status).json({ error: portal.error });
    return res.json(portalSnapshot(req.db, portal.order, portal.token));
  }

  if (req.method === 'POST' && req.path === '/message') {
    const portal = resolvePortal(req);
    if (portal.error) return res.status(portal.status).json({ error: portal.error });
    const message = String(req.body?.message ?? '').trim();
    if (!message) return res.status(400).json({ error: 'Wiadomość nie może być pusta' });
    portal.state.messages.push(message);
    portal.state.messages.push('Biuro: dziękujemy, wrócimy z odpowiedzią w ciągu 15 minut.');
    pushEvent(req.db, integrationActor(req.db, portal.order.branchId), `branch:${portal.order.branchId}:orders`, 'portal.message_created', {
      orderId: portal.order.id,
      clientId: portal.client.id,
    });
    await saveDb(req.db);
    return res.json(portalSnapshot(req.db, portal.order, portal.token));
  }

  if (req.method === 'PATCH' && req.path === '/') {
    const portal = resolvePortal(req);
    if (portal.error) return res.status(portal.status).json({ error: portal.error });
    const patch = req.body ?? {};
    if (Object.hasOwn(patch, 'accepted')) portal.state.accepted = Boolean(patch.accepted);
    if (Object.hasOwn(patch, 'paid')) {
      portal.state.paid = Boolean(patch.paid);
      if (portal.state.paid) {
        const invoice = req.db.invoices.find((item) => !item.deletedAt && item.orderId === portal.order.id);
        if (invoice && invoice.status !== 'oplacona') {
          invoice.status = 'oplacona';
          invoice.paidAt = new Date().toISOString();
          invoice.updatedAt = invoice.paidAt;
          invoice.updatedBy = 'portal';
        }
      }
    }
    if (Object.hasOwn(patch, 'rating')) {
      const rating = Number(patch.rating);
      if (!Number.isInteger(rating) || rating < 0 || rating > 5) return res.status(400).json({ error: 'Ocena musi być w zakresie 0-5' });
      portal.state.rating = rating;
    }
    pushEvent(req.db, integrationActor(req.db, portal.order.branchId), `branch:${portal.order.branchId}:orders`, 'portal.state_updated', {
      orderId: portal.order.id,
      clientId: portal.client.id,
      accepted: portal.state.accepted,
      paid: portal.state.paid,
      rating: portal.state.rating,
    });
    await saveDb(req.db);
    return res.json(portalSnapshot(req.db, portal.order, portal.token));
  }

  return next();
});

app.post('/api/portal/message', async (req, res) => {
  req.db.portal.messages.push(req.body.message);
  req.db.portal.messages.push('Biuro: dziękujemy, wrócimy z odpowiedzią w ciągu 15 minut.');
  await saveDb(req.db);
  res.json(req.db.portal);
});

app.patch('/api/portal', async (req, res) => {
  req.db.portal = { ...req.db.portal, ...req.body };
  await saveDb(req.db);
  res.json(req.db.portal);
});

app.post('/api/offline-queue', async (req, res) => {
  req.db.offlineQueue.push(req.body.label);
  await saveDb(req.db);
  res.json(req.db.offlineQueue);
});

app.delete('/api/offline-queue', async (req, res) => {
  req.db.offlineQueue = [];
  await saveDb(req.db);
  res.json([]);
});

app.get('/api/sync', (req, res) => {
  const since = String(req.query.since ?? '');
  const tenantOutbox = visibleOutbox(req.db, req.user);
  const outbox = since
    ? tenantOutbox.filter((event) => event.createdAt > since || event.id === since)
    : tenantOutbox.slice(0, 50);
  res.json({ serverTime: new Date().toISOString(), events: outbox, channels: channelsFor(req.db, req.user) });
});

app.post('/api/sync/mutations', async (req, res) => {
  const accepted = [];
  const conflicts = [];
  const mutations = Array.isArray(req.body?.mutations) ? req.body.mutations : [];
  for (const mutation of mutations) {
    if (mutation.type === 'order.status') {
      const order = req.db.orders.find((next) => next.id === mutation.payload?.orderId);
      if (!order || !visibleOrders(req.db, req.user).some((next) => next.id === order.id) || !canUser(req.db, req.user, 'orders', 'write')) {
        conflicts.push({ id: mutation.id, reason: 'Brak dostępu do zlecenia' });
        continue;
      }
      if (!orderStatuses.has(mutation.payload.status)) {
        conflicts.push({ id: mutation.id, reason: 'Nieprawidłowy status zlecenia' });
        continue;
      }
      order.status = mutation.payload.status;
      order.timeline.push({ label: `Status offline: ${order.status}`, at: new Date().toISOString(), by: actorName(req.user) });
      accepted.push(pushEvent(req.db, req.user, `branch:${order.branchId}:orders`, 'order.status_changed', { id: order.id, status: order.status }));
      const invoice = ensureInvoiceForOrder(req.db, req.user, order);
      if (invoice) accepted.push({ id: invoice.id, eventName: 'invoice.created', payload: invoice, createdAt: new Date().toISOString() });
      continue;
    }
    if (mutation.type === 'order.checklist') {
      const order = req.db.orders.find((next) => next.id === mutation.payload?.orderId);
      if (!order || !visibleOrders(req.db, req.user).some((next) => next.id === order.id)) {
        conflicts.push({ id: mutation.id, reason: 'Brak dostępu do checklisty' });
        continue;
      }
      order.checklist = order.checklist.map((item) => item.label === mutation.payload.label ? { ...item, done: Boolean(mutation.payload.done) } : item);
      const channel = order.teamId || req.user.teamId ? `team:${order.teamId ?? req.user.teamId}` : `branch:${order.branchId}:orders`;
      accepted.push(pushEvent(req.db, req.user, channel, 'safety.checklist_updated', { orderId: order.id, label: mutation.payload.label }));
      continue;
    }
    conflicts.push({ id: mutation.id, reason: 'Nieobsługiwany typ mutacji' });
  }
  await saveDb(req.db);
  res.json({ accepted, conflicts, serverTime: new Date().toISOString() });
});

// ---------------------------------------------------------------------------
// Integracje: Zadarma (telefonia) + AI (STT + scoring rozmów).
// Aktywne tylko gdy ustawione są klucze env; inaczej tryb demo (deterministyczny),
// żeby aplikacja działała bez kont zewnętrznych.
// ---------------------------------------------------------------------------
const zadarmaKey = process.env.ZADARMA_KEY || '';
const zadarmaSip = process.env.ZADARMA_SIP || '';
const zadarmaConfigured = Boolean(zadarmaKey && zadarmaSecret);
const openaiKey = process.env.OPENAI_API_KEY || '';
const openaiModel = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const deepgramKey = process.env.DEEPGRAM_API_KEY || '';
const recordingRetentionDays = Number(process.env.RECORDING_RETENTION_DAYS || 90);
const communicationStatuses = new Set(['queued', 'ringing', 'active', 'completed', 'missed', 'failed']);
const communicationRecordingSources = new Set(['web_softphone', 'mobile_meeting', 'zadarma', 'manual', 'ai_receptionist']);
const communicationProcessingStatuses = new Set(['ready', 'processing', 'missing', 'failed']);
const integrationAiProviders = new Set(['openai', 'local']);
const integrationSpeechProviders = new Set(['deepgram', 'openai', 'manual']);
const integrationSmsProviders = new Set(['smsapi', 'manual']);
const integrationEmailProviders = new Set(['aws_ses', 'manual']);
const integrationMapProviders = new Set(['google_maps', 'manual']);

// Podpis żądania Zadarma: md5(posortowane parametry) → HMAC-SHA1(secret) hex → base64.
function zadarmaAuth(method, params) {
  const sorted = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]).sort()).toString();
  const md5 = createHash('md5').update(sorted).digest('hex');
  const hex = createHmac('sha1', zadarmaSecret).update(method + sorted + md5).digest('hex');
  return { sorted, header: `${zadarmaKey}:${Buffer.from(hex).toString('base64')}` };
}

async function zadarmaRequest(method, params = {}) {
  const { sorted, header } = zadarmaAuth(method, params);
  const url = 'https://api.zadarma.com' + method + (sorted ? '?' + sorted : '');
  const response = await fetch(url, { headers: { Authorization: header } });
  const text = await response.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!response.ok || json.status === 'error') {
    throw new Error('Zadarma ' + response.status + ': ' + String(json.message || text).slice(0, 200));
  }
  return json;
}

async function fetchRecordingUrl(callId) {
  const data = await zadarmaRequest('/v1/pbx/record/request/', { call_id: callId });
  if (Array.isArray(data.links) && data.links.length) return data.links[0];
  return data.link || null;
}

// STT + diaryzacja: Deepgram (PL + mówcy w jednym) preferowane, inaczej Whisper.
async function transcribeCall(audioUrl) {
  if (deepgramKey) {
    const response = await fetch('https://api.deepgram.com/v1/listen?model=nova-2&language=pl&diarize=true&punctuate=true', {
      method: 'POST',
      headers: { Authorization: 'Token ' + deepgramKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: audioUrl }),
    });
    if (!response.ok) throw new Error('Deepgram ' + response.status);
    const data = await response.json();
    return data?.results?.channels?.[0]?.alternatives?.[0]?.transcript || '';
  }
  if (openaiKey) {
    const audio = await fetch(audioUrl);
    if (!audio.ok) throw new Error('Pobranie nagrania ' + audio.status);
    const buffer = Buffer.from(await audio.arrayBuffer());
    const form = new FormData();
    form.append('file', new Blob([buffer], { type: 'audio/mpeg' }), 'call.mp3');
    form.append('model', 'whisper-1');
    form.append('language', 'pl');
    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST', headers: { Authorization: 'Bearer ' + openaiKey }, body: form,
    });
    if (!response.ok) throw new Error('Whisper ' + response.status);
    const data = await response.json();
    return data?.text || '';
  }
  return null;
}

const CALL_RUBRIC = 'Jesteś trenerem sprzedaży. Oceń rozmowę handlową wyceniającego usługi arborystyczne (wycinka/pielęgnacja drzew). Kryteria po 0–25 pkt: (1) przejęcie inicjatywy i dopytanie o zakres prac, (2) podanie orientacyjnych widełek cenowych, (3) umówienie terminu oględzin/oferty, (4) propozycja usług dodatkowych i jasny kolejny krok. Odpowiedz WYŁĄCZNIE poprawnym JSON: {"score": <int 0-100>, "strengths": [<string>], "improve": [{"text": <string>, "sev": "high"|"mid"|"low"}], "tips": <string>}.';

async function scoreCallTranscript(transcript) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + openaiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: openaiModel,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: CALL_RUBRIC },
        { role: 'user', content: typeof transcript === 'string' ? transcript : JSON.stringify(transcript) },
      ],
    }),
  });
  if (!response.ok) throw new Error('OpenAI ' + response.status + ': ' + (await response.text()).slice(0, 160));
  const data = await response.json();
  return JSON.parse(data.choices?.[0]?.message?.content || '{}');
}

function demoCallAnalysis(transcriptLines, fallbackIntent = 'Rozmowa telefoniczna z klientem') {
  const text = Array.isArray(transcriptLines)
    ? transcriptLines.map((line) => line.text).join(' ')
    : String(transcriptLines ?? '');
  const lower = text.toLowerCase();
  const mentionsTerm = lower.includes('termin') || lower.includes('ogledzin') || lower.includes('oględzin');
  const mentionsRisk = lower.includes('ryzyk') || lower.includes('ogrodzen') || lower.includes('budyn');
  const mentionsPhoto = lower.includes('zdjec') || lower.includes('zdję');
  return {
    score: Math.min(96, 76 + (mentionsTerm ? 8 : 0) + (mentionsRisk ? 6 : 0) + (mentionsPhoto ? 4 : 0)),
    summary: 'Rozmowa zapisana w CRM z nagraniem, transkrypcja i analiza AI.',
    intent: fallbackIntent,
    strengths: [
      mentionsTerm ? 'Ustalono kolejny krok i termin' : 'Rozmowa zostala poprawnie odebrana',
      mentionsRisk ? 'Odnotowano ryzyka terenowe' : 'Dane klienta przypisane do CRM',
    ],
    improvements: mentionsPhoto ? ['Zweryfikować zdjęcia przed oględzinami'] : ['Poprosić klienta o zdjęcia i dopisać dostęp sprzętu'],
    nextActions: ['Dopisać notatkę do klienta', 'Potwierdzić termin SMS', 'Przypisać wyceniającego'],
    risks: mentionsRisk ? ['Ryzyka terenowe wymagają oceny wyceniającego'] : ['Brak pełnego opisu ryzyk terenowych'],
  };
}

function optionalText(value) {
  if (value == null) return '';
  return String(value).trim();
}

function parseOptionalDate(value) {
  const text = optionalText(value);
  if (!text) return null;
  const date = new Date(text);
  return Number.isFinite(date.getTime()) ? date : null;
}

function normalizeTranscriptLines(input) {
  if (Array.isArray(input)) {
    return input.map((line, index) => ({
      speaker: optionalText(line?.speaker) || (index % 2 ? 'Klient' : 'Biuro'),
      text: optionalText(line?.text),
      atSec: Number.isFinite(Number(line?.atSec)) ? Math.max(0, Math.round(Number(line.atSec))) : index * 20,
    })).filter((line) => line.text).slice(0, 250);
  }

  if (typeof input === 'string') {
    return input.split(/\r?\n/)
      .map((rawLine, index) => {
        const text = optionalText(rawLine);
        if (!text) return null;
        const match = text.match(/^([^:]{1,48}):\s*(.+)$/);
        return {
          speaker: match ? optionalText(match[1]) : (index % 2 ? 'Klient' : 'Biuro'),
          text: match ? optionalText(match[2]) : text,
          atSec: index * 20,
        };
      })
      .filter(Boolean)
      .slice(0, 250);
  }

  return [];
}

function communicationRecordingSource(value, communication) {
  const raw = optionalText(value);
  if (!raw) {
    if (communication.channel === 'zadarma') return { source: 'zadarma' };
    if (communication.channel === 'web_softphone') return { source: 'web_softphone' };
    if (communication.channel === 'mobile_meeting') return { source: 'mobile_meeting' };
    if (communication.channel === 'ai_receptionist') return { source: 'ai_receptionist' };
    return { source: 'manual' };
  }
  const source = raw === 'field_meeting' ? 'mobile_meeting' : raw;
  if (!communicationRecordingSources.has(source)) {
    return { error: 'Źródło nagrania jest nieprawidłowe', source };
  }
  return { source };
}

function communicationRecordingStatus(value, hasRecording) {
  const raw = optionalText(value);
  if (raw) {
    if (!communicationProcessingStatuses.has(raw)) return { error: 'Status nagrania jest nieprawidlowy' };
    return { status: raw };
  }
  return { status: hasRecording ? 'ready' : 'missing' };
}

function communicationTranscriptStatus(value, lineCount) {
  const raw = optionalText(value);
  if (raw) {
    if (!communicationProcessingStatuses.has(raw)) return { error: 'Status transkrypcji jest nieprawidlowy' };
    return { status: raw };
  }
  return { status: lineCount > 0 ? 'ready' : 'missing' };
}

function zadarmaCallId(body) {
  return optionalText(body?.call_id_with_rec ?? body?.pbx_call_id ?? body?.call_id ?? body?.callId ?? body?.providerCallId);
}

function zadarmaCommunicationStatus(body) {
  const explicit = optionalText(body?.communicationStatus ?? body?.crmStatus);
  if (explicit && communicationStatuses.has(explicit)) return explicit;
  const rawStatus = optionalText(body?.status);
  if (communicationStatuses.has(rawStatus)) return rawStatus;
  const event = optionalText(body?.event).toUpperCase();
  if (event.includes('START') || event.includes('INCOMING')) return 'ringing';
  if (event.includes('END') || event.includes('RECORD')) return 'completed';
  if (event.includes('MISSED')) return 'missed';
  return Number(body?.durationSec ?? body?.duration ?? 0) > 0 ? 'completed' : 'completed';
}

function releaseSoftphonePresenceForCommunication(db, user, communication) {
  if (communication.channel !== 'web_softphone' || !communication.userId) return null;
  const targetUser = db.users.find((next) => next.id === communication.userId);
  if (!targetUser || !sameTenantBranch(db, user, targetUser.branchId)) return null;
  const presence = softphonePresenceRow(db, user, targetUser);
  if (presence.activeCallId !== communication.id) return null;
  return setSoftphonePresence(db, user, targetUser, 'available');
}

function clampInteger(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

function boolPatch(value, fallback) {
  return value == null ? fallback : Boolean(value);
}

function enumPatch(value, allowed, fallback) {
  const text = optionalText(value);
  return allowed.has(text) ? text : fallback;
}

function mergeIntegrationSettings(current, patch, user) {
  const next = {
    ...current,
    zadarma: { ...current.zadarma },
    ai: { ...current.ai },
    messaging: { ...current.messaging },
    maps: { ...current.maps },
    monitoring: { ...current.monitoring },
    updatedAt: new Date().toISOString(),
    updatedBy: user.id,
  };

  if (patch?.zadarma && typeof patch.zadarma === 'object') {
    next.zadarma.enabled = boolPatch(patch.zadarma.enabled, next.zadarma.enabled);
    next.zadarma.autoCreateCommunication = boolPatch(patch.zadarma.autoCreateCommunication, next.zadarma.autoCreateCommunication);
    next.zadarma.autoAttachRecordings = boolPatch(patch.zadarma.autoAttachRecordings, next.zadarma.autoAttachRecordings);
    next.zadarma.autoAnalyzeRecordings = boolPatch(patch.zadarma.autoAnalyzeRecordings, next.zadarma.autoAnalyzeRecordings);
    next.zadarma.requireRecordingConsent = boolPatch(patch.zadarma.requireRecordingConsent, next.zadarma.requireRecordingConsent);
    next.zadarma.recordingRetentionDays = clampInteger(patch.zadarma.recordingRetentionDays, next.zadarma.recordingRetentionDays, 1, 3650);
  }

  if (patch?.ai && typeof patch.ai === 'object') {
    next.ai.provider = enumPatch(patch.ai.provider, integrationAiProviders, next.ai.provider);
    next.ai.speechToText = enumPatch(patch.ai.speechToText, integrationSpeechProviders, next.ai.speechToText);
    next.ai.autoTranscribe = boolPatch(patch.ai.autoTranscribe, next.ai.autoTranscribe);
    next.ai.autoAnalyze = boolPatch(patch.ai.autoAnalyze, next.ai.autoAnalyze);
    next.ai.redactPii = boolPatch(patch.ai.redactPii, next.ai.redactPii);
    next.ai.humanApprovalRequiredBelowScore = clampInteger(patch.ai.humanApprovalRequiredBelowScore, next.ai.humanApprovalRequiredBelowScore, 0, 100);
  }

  if (patch?.messaging && typeof patch.messaging === 'object') {
    next.messaging.smsProvider = enumPatch(patch.messaging.smsProvider, integrationSmsProviders, next.messaging.smsProvider);
    next.messaging.emailProvider = enumPatch(patch.messaging.emailProvider, integrationEmailProviders, next.messaging.emailProvider);
    next.messaging.sendBookingConfirmations = boolPatch(patch.messaging.sendBookingConfirmations, next.messaging.sendBookingConfirmations);
    next.messaging.sendMissedCallFollowups = boolPatch(patch.messaging.sendMissedCallFollowups, next.messaging.sendMissedCallFollowups);
  }

  if (patch?.maps && typeof patch.maps === 'object') {
    next.maps.provider = enumPatch(patch.maps.provider, integrationMapProviders, next.maps.provider);
    next.maps.routeOptimization = boolPatch(patch.maps.routeOptimization, next.maps.routeOptimization);
  }

  if (patch?.monitoring && typeof patch.monitoring === 'object') {
    next.monitoring.sentryEnabled = boolPatch(patch.monitoring.sentryEnabled, next.monitoring.sentryEnabled);
    next.monitoring.auditRetentionDays = clampInteger(patch.monitoring.auditRetentionDays, next.monitoring.auditRetentionDays, 30, 3650);
  }

  return next;
}

function envConfigured(...keys) {
  return keys.every((key) => optionalText(process.env[key]));
}

function integrationHealthStatus(name, enabled, configured, required = true) {
  return {
    name,
    enabled: Boolean(enabled),
    configured: Boolean(configured),
    required: Boolean(required),
    status: !enabled ? 'disabled' : configured || !required ? 'ready' : 'missing_configuration',
  };
}

function integrationHealth(settings) {
  const zadarmaReady = envConfigured('ZADARMA_KEY', 'ZADARMA_SECRET');
  const openaiReady = envConfigured('OPENAI_API_KEY');
  const deepgramReady = envConfigured('DEEPGRAM_API_KEY');
  const smsReady = envConfigured('SMSAPI_TOKEN');
  const sesReady = envConfigured('AWS_SES_FROM') || envConfigured('AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_REGION');
  const mapsReady = envConfigured('GOOGLE_MAPS_API_KEY');
  const sentryReady = envConfigured('SENTRY_DSN');
  const p24Ready = envConfigured('P24_MERCHANT_ID', 'P24_POS_ID', 'P24_CRC');
  const awsStorageReady = envConfigured('AWS_S3_BUCKET', 'AWS_REGION') || envConfigured('S3_BUCKET', 'AWS_REGION');
  const checks = [
    integrationHealthStatus('zadarma', settings.zadarma.enabled, zadarmaReady, true),
    integrationHealthStatus('openai', settings.ai.provider === 'openai' || settings.ai.speechToText === 'openai', openaiReady, settings.ai.provider === 'openai'),
    integrationHealthStatus('deepgram', settings.ai.speechToText === 'deepgram', deepgramReady, settings.ai.speechToText === 'deepgram'),
    integrationHealthStatus('smsapi', settings.messaging.smsProvider === 'smsapi', smsReady, settings.messaging.smsProvider === 'smsapi'),
    integrationHealthStatus('aws_ses', settings.messaging.emailProvider === 'aws_ses', sesReady, settings.messaging.emailProvider === 'aws_ses'),
    integrationHealthStatus('google_maps', settings.maps.provider === 'google_maps', mapsReady, settings.maps.provider === 'google_maps'),
    integrationHealthStatus('przelewy24', true, p24Ready, false),
    integrationHealthStatus('aws_s3', true, awsStorageReady, false),
    integrationHealthStatus('sentry', settings.monitoring.sentryEnabled, sentryReady, false),
  ];
  const missingRequired = checks.filter((check) => check.enabled && check.required && !check.configured);
  return {
    status: missingRequired.length ? 'needs_configuration' : 'ready',
    generatedAt: new Date().toISOString(),
    checks,
    missingRequired: missingRequired.map((check) => check.name),
  };
}

function integrationSkillCatalog(settings, health = integrationHealth(settings)) {
  const byName = new Map((health.checks || []).map((check) => [check.name, check]));
  const envReady = (env = []) => env.every((name) => {
    const [key, expected] = String(name).split('=');
    return expected ? process.env[key] === expected : envConfigured(key);
  });
  const envMissing = (env = []) => env.filter((name) => {
    const [key, expected] = String(name).split('=');
    return expected ? process.env[key] !== expected : !envConfigured(key);
  });
  const envStatus = (env, required = false) => {
    const configured = envReady(env);
    return {
      enabled: true,
      configured,
      missing: envMissing(env),
      required: Boolean(required),
      status: configured ? 'ready' : required ? 'blocked' : 'demo',
    };
  };
  const statusFor = (names, required = true) => {
    const checks = names.map((name) => byName.get(name)).filter(Boolean);
    const enabled = checks.some((check) => check.enabled);
    const configured = checks.every((check) => !check.enabled || check.configured);
    const missing = checks.filter((check) => check.enabled && !check.configured).map((check) => check.name);
    return {
      enabled,
      configured,
      missing,
      required: Boolean(required),
      status: !enabled ? 'disabled' : configured ? 'ready' : required ? 'blocked' : 'demo',
    };
  };
  const rows = [
    {
      key: 'telephony_softphone',
      label: 'Telefonia web + nagrania',
      group: 'Komunikacja',
      integrations: ['zadarma'],
      skill: 'Zadarma PBX, web softphone, nagrania, webhooki',
      required: true,
      env: ['ZADARMA_KEY', 'ZADARMA_SECRET', 'ZADARMA_SIP'],
    },
    {
      key: 'ai_call_analysis',
      label: 'AI analiza rozmów',
      group: 'AI',
      integrations: ['openai', settings.ai.speechToText === 'deepgram' ? 'deepgram' : 'openai'],
      skill: 'Transkrypcja, scoring, coaching, prompt versions',
      required: true,
      env: ['OPENAI_API_KEY', settings.ai.speechToText === 'deepgram' ? 'DEEPGRAM_API_KEY' : 'OPENAI_API_KEY'],
    },
    {
      key: 'ai_receptionist',
      label: 'AI recepcjonista',
      group: 'AI',
      integrations: ['zadarma', 'openai', settings.ai.speechToText === 'deepgram' ? 'deepgram' : 'openai', 'smsapi', 'aws_ses'],
      skill: 'After-hours, overflow, kwalifikacja, umawianie, follow-up',
      required: true,
      env: ['ZADARMA_KEY', 'ZADARMA_SECRET', 'OPENAI_API_KEY', 'SMSAPI_TOKEN', 'AWS_SES_FROM'],
    },
    {
      key: 'messaging_followups',
      label: 'SMS/e-mail automatyzacje',
      group: 'Automatyzacje',
      integrations: ['smsapi', 'aws_ses'],
      skill: 'Potwierdzenia, przypomnienia, missed-call follow-up',
      required: true,
      env: ['SMSAPI_TOKEN', 'AWS_SES_FROM'],
    },
    {
      key: 'maps_routing',
      label: 'Mapy, trasy, oddziały',
      group: 'Operacje',
      integrations: ['google_maps'],
      skill: 'Mapy, dojazdy, optymalizacja tras i geokodowanie',
      required: false,
      env: ['GOOGLE_MAPS_API_KEY'],
    },
    {
      key: 'billing_payments',
      label: 'Billing SaaS + Przelewy24',
      group: 'SaaS',
      integrations: ['przelewy24'],
      skill: 'Subskrypcje, checkout, płatności, historia',
      required: false,
      env: ['P24_MERCHANT_ID', 'P24_POS_ID', 'P24_CRC'],
    },
    {
      key: 'storage_documents',
      label: 'Dokumenty i nagrania w chmurze',
      group: 'Cloud',
      integrations: ['aws_s3'],
      skill: 'S3 dla nagran, dokumentow, eksportow i backupow plikow',
      required: false,
      env: ['AWS_S3_BUCKET', 'AWS_REGION'],
    },
    {
      key: 'observability',
      label: 'Monitoring produkcji',
      group: 'Cloud',
      integrations: ['sentry'],
      skill: 'Sentry, audyt, alerty i diagnostyka produkcyjna',
      required: false,
      env: ['SENTRY_DSN'],
    },
    {
      key: 'domain_webhooks',
      label: 'Domena, HTTPS i webhooki',
      group: 'Cloud',
      integrations: [],
      skill: 'Publiczny URL dla portalu klienta, webhooków telefonii, e-mail domain verification i callbacków płatności',
      required: true,
      env: ['APP_PUBLIC_URL'],
      status: envStatus(['APP_PUBLIC_URL'], true),
    },
    {
      key: 'production_database',
      label: 'PostgreSQL produkcyjny',
      group: 'Cloud',
      integrations: [],
      skill: 'PostgreSQL runtime, DATABASE_URL, migracje, backup bazy i izolacja tenantow poza SQLite',
      required: true,
      env: ['DB_DRIVER=postgres', 'DATABASE_URL'],
      status: envStatus(['DB_DRIVER=postgres', 'DATABASE_URL'], true),
    },
    {
      key: 'mobile_release_pipeline',
      label: 'Mobile release Android/iOS',
      group: 'Mobile',
      integrations: [],
      skill: 'Expo release, Apple Developer, Google Play service account i pipeline publikacji aplikacji mobilnej',
      required: false,
      env: ['APPLE_TEAM_ID', 'GOOGLE_PLAY_SERVICE_ACCOUNT_JSON'],
      status: envStatus(['APPLE_TEAM_ID', 'GOOGLE_PLAY_SERVICE_ACCOUNT_JSON'], false),
    },
    {
      key: 'backup_ci_cd',
      label: 'Backup, CI/CD i monitoring deployu',
      group: 'Cloud',
      integrations: [],
      skill: 'Backupy, staging/production, health checks, Sentry release i kontrola migracji przed deployem',
      required: true,
      env: ['BACKUP_BUCKET', 'CI_DEPLOY_ENV', 'APP_PUBLIC_URL'],
      status: envStatus(['BACKUP_BUCKET', 'CI_DEPLOY_ENV', 'APP_PUBLIC_URL'], true),
    },
  ].map((row) => {
    const status = row.status || statusFor(row.integrations, row.required);
    return {
      ...row,
      ...status,
      mode: status.status === 'ready' ? 'live' : status.status === 'blocked' ? 'wymaga konfiguracji' : status.status === 'demo' ? 'demo/manual' : 'wyłączone',
    };
  });
  return {
    generatedAt: new Date().toISOString(),
    productionReady: rows.filter((row) => row.required).every((row) => row.status === 'ready'),
    requiredReady: rows.filter((row) => row.required && row.status === 'ready').length,
    requiredTotal: rows.filter((row) => row.required).length,
    optionalReady: rows.filter((row) => !row.required && row.status === 'ready').length,
    optionalTotal: rows.filter((row) => !row.required).length,
    rows,
  };
}

function productionReadinessChecklist(settings, health = integrationHealth(settings), skillCatalog = integrationSkillCatalog(settings, health)) {
  const check = (id) => (health.checks || []).find((item) => item.name === id) || {};
  const readyCount = (ids) => ids.filter((id) => check(id).configured || check(id).status === 'ready').length;
  const missingEnv = (ids) => ids.filter((id) => check(id).enabled !== false && !check(id).configured).flatMap((id) => ({
    zadarma: ['ZADARMA_KEY', 'ZADARMA_SECRET', 'ZADARMA_SIP'],
    openai: ['OPENAI_API_KEY'],
    deepgram: ['DEEPGRAM_API_KEY'],
    smsapi: ['SMSAPI_TOKEN'],
    aws_ses: ['AWS_SES_FROM'],
    google_maps: ['GOOGLE_MAPS_API_KEY'],
    przelewy24: ['P24_MERCHANT_ID', 'P24_POS_ID', 'P24_CRC'],
    aws_s3: ['AWS_S3_BUCKET', 'AWS_REGION'],
    sentry: ['SENTRY_DSN'],
  }[id] || [id]));
  const items = [
    {
      key: 'core_crm',
      area: 'CRM i tenanty',
      label: 'Multi-tenant CRM, role, oddziały i audyt',
      required: true,
      ready: true,
      evidence: 'RBAC, branch scope, tenant smoke i audyt backendowy',
      action: 'Utrzymac smoke:tenant przed kazdym wdrozeniem',
      missingEnv: [],
    },
    {
      key: 'phone_ai',
      area: 'Telefonia + AI',
      label: 'Zadarma, nagrania, transkrypcja, analiza i AI recepcjonista',
      required: true,
      ready: ['zadarma', 'openai', settings.ai.speechToText === 'deepgram' ? 'deepgram' : 'openai'].every((id) => check(id).configured),
      evidence: `${readyCount(['zadarma', 'openai', settings.ai.speechToText === 'deepgram' ? 'deepgram' : 'openai'])}/3 integracje gotowe`,
      action: 'Uzupełnić telefonię i AI env, potem wykonać test rozmowy live',
      missingEnv: missingEnv(['zadarma', 'openai', settings.ai.speechToText === 'deepgram' ? 'deepgram' : 'openai']),
    },
    {
      key: 'messages',
      area: 'Komunikacja',
      label: 'SMSAPI i AWS SES dla potwierdzen, follow-upow i portalu',
      required: true,
      ready: ['smsapi', 'aws_ses'].every((id) => check(id).configured),
      evidence: `${readyCount(['smsapi', 'aws_ses'])}/2 kanały gotowe`,
      action: 'Podłączyć SMSAPI i SES, wysłać test SMS/e-mail',
      missingEnv: missingEnv(['smsapi', 'aws_ses']),
    },
    {
      key: 'billing',
      area: 'SaaS billing',
      label: 'Przelewy24, subskrypcje, checkout i historia płatności',
      required: false,
      ready: Boolean(check('przelewy24').configured),
      evidence: check('przelewy24').configured ? 'Przelewy24 env skonfigurowany' : 'Checkout działa w trybie demo',
      action: 'Podłączyć P24 i wykonać transakcję sandbox/live',
      missingEnv: missingEnv(['przelewy24']),
    },
    {
      key: 'cloud_files',
      area: 'Cloud files',
      label: 'S3 dla nagran, dokumentow, eksportow i backupow plikow',
      required: false,
      ready: Boolean(check('aws_s3').configured),
      evidence: check('aws_s3').configured ? 'S3 env gotowy' : 'Pliki zostaja w storage lokalnym/demo',
      action: 'Podłączyć bucket S3 i polityki retencji',
      missingEnv: missingEnv(['aws_s3']),
    },
    {
      key: 'maps_ops',
      area: 'Operacje terenowe',
      label: 'Google Maps dla tras, geokodowania i oddziałów',
      required: false,
      ready: Boolean(check('google_maps').configured) || settings.maps.provider === 'manual',
      evidence: check('google_maps').configured ? 'Google Maps env gotowy' : 'Mapy w trybie manualnym',
      action: 'Podłączyć Google Maps API i test geokodowania',
      missingEnv: settings.maps.provider === 'manual' ? [] : missingEnv(['google_maps']),
    },
    {
      key: 'monitoring',
      area: 'Observability',
      label: 'Sentry, health, audyt, backupy i alerty produkcyjne',
      required: false,
      ready: Boolean(check('sentry').configured) || !settings.monitoring.sentryEnabled,
      evidence: check('sentry').configured ? 'Sentry env gotowy' : 'Sentry wyłączone lub demo',
      action: 'Podłączyć Sentry DSN i alerty po deployu',
      missingEnv: settings.monitoring.sentryEnabled ? missingEnv(['sentry']) : [],
    },
    {
      key: 'mobile_release',
      area: 'Mobile',
      label: 'Expo mobile, Apple Developer i Google Play release',
      required: false,
      ready: envConfigured('APPLE_TEAM_ID', 'GOOGLE_PLAY_SERVICE_ACCOUNT_JSON'),
      evidence: envConfigured('APPLE_TEAM_ID', 'GOOGLE_PLAY_SERVICE_ACCOUNT_JSON') ? 'Konta mobile release wskazane w env' : 'Mobile działa jako prototyp, release store wymaga kont',
      action: 'Podłączyć Apple Developer i Google Play service account',
      missingEnv: ['APPLE_TEAM_ID', 'GOOGLE_PLAY_SERVICE_ACCOUNT_JSON'].filter((key) => !envConfigured(key)),
    },
  ];
  const required = items.filter((item) => item.required);
  const optional = items.filter((item) => !item.required);
  return {
    generatedAt: new Date().toISOString(),
    productionReady: required.every((item) => item.ready) && skillCatalog.productionReady,
    requiredReady: required.filter((item) => item.ready).length,
    requiredTotal: required.length,
    optionalReady: optional.filter((item) => item.ready).length,
    optionalTotal: optional.length,
    blockers: items.filter((item) => item.required && !item.ready).map((item) => ({
      key: item.key,
      area: item.area,
      label: item.label,
      missingEnv: item.missingEnv,
      action: item.action,
    })),
    items,
  };
}

function integrationSetupPlan(settings, health = integrationHealth(settings), readiness = productionReadinessChecklist(settings, health)) {
  const check = (id) => (health.checks || []).find((item) => item.name === id) || {};
  const envReady = (...keys) => keys.every((key) => envConfigured(key));
  const row = ({ key, priority, account, module, env, ready, fallback, action }) => ({
    key,
    priority,
    account,
    module,
    env,
    ready: Boolean(ready),
    fallback,
    action,
    status: ready ? 'ready' : fallback ? 'demo' : 'missing',
  });
  const items = [
    row({
      key: 'zadarma',
      priority: 'P0',
      account: 'Zadarma',
      module: 'Telefonia, softphone, nagrania, AI recepcjonista',
      env: ['ZADARMA_KEY', 'ZADARMA_SECRET', 'ZADARMA_SIP'],
      ready: Boolean(check('zadarma').configured),
      fallback: 'Demo rozmów bez realnego operatora',
      action: 'Utwórz API key w Zadarma, wpisz SIP i zrestartuj API',
    }),
    row({
      key: 'openai',
      priority: 'P0',
      account: 'OpenAI',
      module: 'Analiza AI, prompty, scoring, AI recepcjonista',
      env: ['OPENAI_API_KEY', 'OPENAI_MODEL'],
      ready: Boolean(check('openai').configured),
      fallback: 'Deterministyczna analiza demo',
      action: 'Podłącz klucz OpenAI i wykonaj test promptu oraz rozmowy',
    }),
    row({
      key: 'deepgram',
      priority: settings.ai.speechToText === 'deepgram' ? 'P0' : 'P1',
      account: 'Deepgram',
      module: 'Transkrypcja PL z diarizacja',
      env: ['DEEPGRAM_API_KEY'],
      ready: Boolean(check('deepgram').configured),
      fallback: settings.ai.speechToText === 'openai' ? 'Fallback na OpenAI Whisper' : 'Manual/demo transkrypcji',
      action: 'Podlacz Deepgram lub przelacz STT na OpenAI/manual',
    }),
    row({
      key: 'smsapi',
      priority: 'P0',
      account: 'SMSAPI',
      module: 'SMS potwierdzenia, missed-call follow-up, portal',
      env: ['SMSAPI_TOKEN'],
      ready: Boolean(check('smsapi').configured),
      fallback: 'Komunikacja manualna',
      action: 'Dodaj token SMSAPI i wykonaj test kanału SMSAPI',
    }),
    row({
      key: 'aws_ses',
      priority: 'P0',
      account: 'AWS SES',
      module: 'E-mail potwierdzenia, dokumenty, portal',
      env: ['AWS_SES_FROM', 'AWS_REGION'],
      ready: Boolean(check('aws_ses').configured),
      fallback: 'E-mail manualny',
      action: 'Zweryfikuj domenę/nadawcę w SES i ustaw AWS_SES_FROM',
    }),
    row({
      key: 'aws_s3',
      priority: 'P1',
      account: 'AWS S3',
      module: 'Nagrania, dokumenty, eksporty, backup plikow',
      env: ['AWS_S3_BUCKET', 'AWS_REGION'],
      ready: Boolean(check('aws_s3').configured),
      fallback: 'Storage lokalny/demo',
      action: 'Utwórz bucket S3, polityki retencji i klucze IAM',
    }),
    row({
      key: 'przelewy24',
      priority: 'P1',
      account: 'Przelewy24',
      module: 'SaaS billing, checkout, płatności',
      env: ['P24_MERCHANT_ID', 'P24_POS_ID', 'P24_CRC', 'P24_API_KEY'],
      ready: Boolean(check('przelewy24').configured),
      fallback: 'Checkout demo/manual',
      action: 'Podłącz sandbox/live P24 i wykonaj płatność testową',
    }),
    row({
      key: 'google_maps',
      priority: 'P1',
      account: 'Google Maps',
      module: 'Mapy, trasy ekip, geokodowanie',
      env: ['GOOGLE_MAPS_API_KEY'],
      ready: Boolean(check('google_maps').configured) || settings.maps.provider === 'manual',
      fallback: settings.maps.provider === 'manual' ? 'Tryb manualny włączony' : 'Brak tras live',
      action: 'Dodaj Maps API key albo pozostaw provider manual',
    }),
    row({
      key: 'sentry',
      priority: 'P1',
      account: 'Sentry',
      module: 'Monitoring bledow, alerty produkcyjne',
      env: ['SENTRY_DSN'],
      ready: Boolean(check('sentry').configured) || !settings.monitoring.sentryEnabled,
      fallback: !settings.monitoring.sentryEnabled ? 'Sentry wyłączone' : 'Tylko health/audyt',
      action: 'Dodaj SENTRY_DSN i skonfiguruj alerty',
    }),
    row({
      key: 'domain_dns',
      priority: 'P1',
      account: 'Domena / DNS',
      module: 'Portal klienta, webhooki, e-mail domain verification',
      env: ['APP_PUBLIC_URL'],
      ready: envReady('APP_PUBLIC_URL'),
      fallback: 'Localhost / linki lokalne',
      action: 'Ustaw domenę, HTTPS i publiczny APP_PUBLIC_URL',
    }),
    row({
      key: 'apple_google_play',
      priority: 'P2',
      account: 'Apple Developer + Google Play',
      module: 'Publikacja aplikacji mobilnej i update store',
      env: ['APPLE_TEAM_ID', 'GOOGLE_PLAY_SERVICE_ACCOUNT_JSON'],
      ready: envReady('APPLE_TEAM_ID', 'GOOGLE_PLAY_SERVICE_ACCOUNT_JSON'),
      fallback: 'Mobile prototyp / build lokalny',
      action: 'Podlacz konta store i skonfiguruj release pipeline',
    }),
    row({
      key: 'postgres_aws',
      priority: 'P1',
      account: 'PostgreSQL / AWS runtime',
      module: 'Produkcja, backupy, skalowanie i migracje',
      env: ['DB_DRIVER=postgres', 'DATABASE_URL'],
      ready: process.env.DB_DRIVER === 'postgres' && envConfigured('DATABASE_URL'),
      fallback: 'SQLite lokalny',
      action: 'Ustaw PostgreSQL, backupy i migracje przed produkcja',
    }),
  ];
  const priorityOrder = { P0: 0, P1: 1, P2: 2 };
  items.sort((a, b) => (priorityOrder[a.priority] ?? 9) - (priorityOrder[b.priority] ?? 9) || Number(a.ready) - Number(b.ready));
  const missing = items.filter((item) => !item.ready);
  return {
    generatedAt: new Date().toISOString(),
    productionReady: readiness.productionReady && !items.some((item) => item.priority === 'P0' && !item.ready),
    p0Ready: items.filter((item) => item.priority === 'P0' && item.ready).length,
    p0Total: items.filter((item) => item.priority === 'P0').length,
    p1Ready: items.filter((item) => item.priority === 'P1' && item.ready).length,
    p1Total: items.filter((item) => item.priority === 'P1').length,
    nextAction: missing[0]?.action || 'Wykonać testy live i przygotowac deploy produkcyjny',
    items,
  };
}

function integrationDiagnostics(settings) {
  const health = integrationHealth(settings);
  const skillCatalog = integrationSkillCatalog(settings, health);
  const readiness = productionReadinessChecklist(settings, health, skillCatalog);
  const setupPlan = integrationSetupPlan(settings, health, readiness);
  const checks = health.checks.map((check) => ({
    ...check,
    label: check.status === 'ready' ? 'Gotowe' : check.status === 'disabled' ? 'Wylaczone' : 'Brak konfiguracji',
    requiredEnv: {
      zadarma: ['ZADARMA_KEY', 'ZADARMA_SECRET'],
      openai: ['OPENAI_API_KEY'],
      deepgram: ['DEEPGRAM_API_KEY'],
      smsapi: ['SMSAPI_TOKEN'],
      aws_ses: ['AWS_SES_FROM lub AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY/AWS_REGION'],
      google_maps: ['GOOGLE_MAPS_API_KEY'],
      przelewy24: ['P24_MERCHANT_ID', 'P24_POS_ID', 'P24_CRC'],
      aws_s3: ['AWS_S3_BUCKET', 'AWS_REGION'],
      sentry: ['SENTRY_DSN'],
    }[check.name] || [],
  }));
  const enabled = checks.filter((check) => check.enabled);
  const configured = enabled.filter((check) => check.configured || !check.required);
  const blockers = checks
    .filter((check) => check.enabled && check.required && !check.configured)
    .map((check) => ({
      integration: check.name,
      requiredEnv: check.requiredEnv,
      action: 'Uzupełnij env i zrestartuj API albo przełącz provider na manual/demo.',
    }));
  const productionReady = blockers.length === 0;
  return {
    status: productionReady ? 'ready' : 'blocked',
    mode: !enabled.length ? 'demo' : productionReady ? 'live_ready' : 'mixed',
    summary: {
      enabled: enabled.length,
      configured: configured.length,
      missing: blockers.length,
      productionReady,
    },
    checks,
    blockers,
    recommendations: blockers.length
      ? blockers.map((blocker) => `${blocker.integration}: ${blocker.requiredEnv.join(', ')}`)
      : ['Integracje wymagane do trybu live sa skonfigurowane wedlug env.'],
    skillCatalog,
    readiness,
    setupPlan,
  };
}

function integrationChannelTest(settings, rawChannel) {
  const channel = optionalText(rawChannel).toLowerCase();
  const health = integrationHealth(settings);
  const checksByName = new Map((health.checks || []).map((check) => [check.name, check]));
  const envMap = {
    zadarma: ['ZADARMA_KEY', 'ZADARMA_SECRET', 'ZADARMA_SIP'],
    openai: ['OPENAI_API_KEY'],
    deepgram: ['DEEPGRAM_API_KEY'],
    smsapi: ['SMSAPI_TOKEN'],
    aws_ses: ['AWS_SES_FROM lub AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY/AWS_REGION'],
    google_maps: ['GOOGLE_MAPS_API_KEY'],
    przelewy24: ['P24_MERCHANT_ID', 'P24_POS_ID', 'P24_CRC'],
    aws_s3: ['AWS_S3_BUCKET', 'AWS_REGION'],
    sentry: ['SENTRY_DSN'],
    domain_dns: ['APP_PUBLIC_URL'],
    postgres_aws: ['DB_DRIVER=postgres', 'DATABASE_URL'],
    apple_google_play: ['APPLE_TEAM_ID', 'GOOGLE_PLAY_SERVICE_ACCOUNT_JSON'],
    backup_ci_cd: ['BACKUP_BUCKET', 'CI_DEPLOY_ENV', 'APP_PUBLIC_URL'],
  };
  const labels = {
    zadarma: 'Telefonia Zadarma',
    openai: 'OpenAI analiza AI',
    deepgram: 'Deepgram transkrypcja',
    smsapi: 'SMSAPI',
    aws_ses: 'AWS SES',
    google_maps: 'Google Maps',
    przelewy24: 'Przelewy24',
    aws_s3: 'AWS S3',
    sentry: 'Sentry',
    domain_dns: 'Domena / DNS / webhooki',
    postgres_aws: 'PostgreSQL / AWS runtime',
    apple_google_play: 'Apple Developer + Google Play',
    backup_ci_cd: 'Backup i CI/CD',
  };
  if (!labels[channel]) return { error: 'Nieznany kanal testu integracji', status: 400 };
  const envReady = (envMap[channel] || []).every((name) => {
    const [key, expected] = String(name).split('=');
    return expected ? process.env[key] === expected : envConfigured(key);
  });
  const requiredChannel = ['zadarma', 'openai', 'deepgram', 'smsapi', 'aws_ses', 'domain_dns', 'postgres_aws', 'backup_ci_cd'].includes(channel);
  const check = checksByName.get(channel) || {
    name: channel,
    enabled: true,
    configured: envReady,
    required: requiredChannel,
    status: envReady ? 'ready' : 'missing_configuration',
  };
  const liveReady = Boolean(check.enabled && check.configured);
  const disabled = check.enabled === false;
  const mode = disabled ? 'disabled' : liveReady ? 'live_ready' : 'demo';
  const severity = check.required && !liveReady && !disabled ? 'blocker' : liveReady ? 'ok' : 'manual';
  return {
    channel,
    label: labels[channel],
    ok: true,
    liveReady,
    mode,
    severity,
    status: liveReady ? 'ready' : disabled ? 'disabled' : 'missing_configuration',
    providerStatus: check.status,
    required: Boolean(check.required),
    configured: Boolean(check.configured),
    requiredEnv: envMap[channel] || [],
    message: liveReady
      ? `${labels[channel]} ma komplet konfiguracji env.`
      : disabled
        ? `${labels[channel]} jest wyłączony w ustawieniach.`
        : `${labels[channel]} działa tylko w trybie demo/manual do czasu uzupełnienia env.`,
    testedAt: new Date().toISOString(),
  };
}

function integrationSetupReport(db, user, settings = currentIntegrationSettings(db, user)) {
  const health = integrationHealth(settings);
  const skillCatalog = integrationSkillCatalog(settings, health);
  const readiness = productionReadinessChecklist(settings, health, skillCatalog);
  const setupPlan = integrationSetupPlan(settings, health, readiness);
  const tenants = visibleTenants(db, user);
  const branches = activeTenantBranches(db, user);
  const envNames = Array.from(new Set([
    ...setupPlan.items.flatMap((item) => item.env || []),
    ...readiness.items.flatMap((item) => item.missingEnv || []),
  ])).sort();
  const envStatus = envNames.map((name) => {
    const [key, expected] = String(name).split('=');
    const configured = expected ? process.env[key] === expected : envConfigured(key);
    return { name, configured };
  });
  const missingEnv = envStatus.filter((item) => !item.configured).map((item) => item.name);
  const liveBlockers = setupPlan.items
    .filter((item) => !item.ready && ['P0', 'P1'].includes(item.priority))
    .map((item) => ({
      key: item.key,
      priority: item.priority,
      account: item.account,
      module: item.module,
      env: item.env,
      action: item.action,
    }));
  return {
    generatedAt: new Date().toISOString(),
    tenant: {
      id: tenantIdForUser(db, user),
      name: tenants[0]?.name || tenantIdForUser(db, user),
      branches: branches.map((branch) => ({ id: branch.id, name: branch.name, city: branch.city })),
    },
    generatedBy: { id: user.id, login: user.login, role: user.role, branchId: user.branchId },
    summary: {
      productionReady: Boolean(setupPlan.productionReady && readiness.productionReady && skillCatalog.productionReady),
      healthStatus: health.status,
      requiredReady: readiness.requiredReady,
      requiredTotal: readiness.requiredTotal,
      optionalReady: readiness.optionalReady,
      optionalTotal: readiness.optionalTotal,
      p0Ready: setupPlan.p0Ready,
      p0Total: setupPlan.p0Total,
      p1Ready: setupPlan.p1Ready,
      p1Total: setupPlan.p1Total,
      nextAction: setupPlan.nextAction,
    },
    environment: {
      valuesIncluded: false,
      configured: envStatus.filter((item) => item.configured).map((item) => item.name),
      missing: missingEnv,
      all: envStatus,
    },
    health,
    skillCatalog,
    readiness,
    setupPlan,
    liveBlockers,
    postSetupChecks: [
      'Zrestartować API po zmianie env.',
      'Uruchomić /api/integrations/test i testy kanałów Zadarma, OpenAI, Deepgram, SMSAPI, AWS SES.',
      'Wykonać test rozmowy: przychodzącej, wychodzącej, nagrania, transkrypcji i AI analizy.',
      'Wykonać smoke:core, smoke:tenant oraz build frontend przed deployem.',
      'Sprawdzić izolację oddziałów i tenantów na kontach menedżerów.',
    ],
  };
}

function formatIntegrationSetupReportMarkdown(report) {
  const yesNo = (value) => (value ? 'OK' : 'BRAK');
  const lines = [
    '# Arbor OS - raport wdrozeniowy integracji',
    '',
    `Wygenerowano: ${report.generatedAt}`,
    `Tenant: ${report.tenant.name} (${report.tenant.id})`,
    `Oddziały: ${report.tenant.branches.map((branch) => `${branch.name} / ${branch.city}`).join(', ') || '-'}`,
    `Sekrety w raporcie: ${report.environment.valuesIncluded ? 'tak' : 'nie, tylko nazwy env i status'}`,
    '',
    '## Status',
    '',
    `- Produkcja gotowa: ${yesNo(report.summary.productionReady)}`,
    `- Health: ${report.summary.healthStatus}`,
    `- Wymagane readiness: ${report.summary.requiredReady}/${report.summary.requiredTotal}`,
    `- Opcjonalne readiness: ${report.summary.optionalReady}/${report.summary.optionalTotal}`,
    `- P0: ${report.summary.p0Ready}/${report.summary.p0Total}`,
    `- P1: ${report.summary.p1Ready}/${report.summary.p1Total}`,
    `- Nastepny krok: ${report.summary.nextAction}`,
    '',
    '## Konta i moduly',
    '',
    '| Priorytet | Konto | Modul | Status | Env | Akcja |',
    '| --- | --- | --- | --- | --- | --- |',
    ...report.setupPlan.items.map((item) => (
      `| ${item.priority} | ${item.account} | ${item.module} | ${item.ready ? 'gotowe' : item.status} | ${(item.env || []).join(', ') || '-'} | ${item.ready ? 'Test live' : item.action} |`
    )),
    '',
    '## Blokady live',
    '',
    ...(report.liveBlockers.length
      ? report.liveBlockers.map((item) => `- ${item.priority} ${item.account}: ${item.action} (env: ${(item.env || []).join(', ') || '-'})`)
      : ['- Brak blokad P0/P1.']),
    '',
    '## Zmienne env',
    '',
    '| Env | Status |',
    '| --- | --- |',
    ...report.environment.all.map((item) => `| ${item.name} | ${item.configured ? 'ustawione' : 'brak'} |`),
    '',
    '## Skille platformy',
    '',
    '| Obszar | Funkcja | Tryb | Env |',
    '| --- | --- | --- | --- |',
    ...report.skillCatalog.rows.map((row) => `| ${row.group} | ${row.label} | ${row.mode} | ${(row.env || []).join(', ') || '-'} |`),
    '',
    '## Kroki po konfiguracji',
    '',
    ...report.postSetupChecks.map((item) => `- ${item}`),
    '',
  ];
  return lines.join('\n');
}

function integrationLivePreflight(db, user, settings = currentIntegrationSettings(db, user)) {
  const report = integrationSetupReport(db, user, settings);
  const p0Blockers = report.setupPlan.items
    .filter((item) => item.priority === 'P0' && !item.ready)
    .map((item) => ({
      key: item.key,
      priority: item.priority,
      area: item.module,
      label: item.account,
      missingEnv: item.env || [],
      action: item.action,
      source: 'setup_plan',
    }));
  const readinessBlockers = (report.readiness.blockers || [])
    .filter((item) => !p0Blockers.some((blocker) => blocker.key === item.key))
    .map((item) => ({
      key: item.key,
      priority: 'P0',
      area: item.area,
      label: item.label,
      missingEnv: item.missingEnv || [],
      action: item.action,
      source: 'readiness',
    }));
  const skillBlockers = (report.skillCatalog.rows || [])
    .filter((item) => item.required && item.status !== 'ready')
    .filter((item) => !p0Blockers.some((blocker) => blocker.key === item.key) && !readinessBlockers.some((blocker) => blocker.key === item.key))
    .map((item) => ({
      key: item.key,
      priority: item.key === 'production_database' || item.key === 'domain_webhooks' ? 'P0' : 'P1',
      area: item.group,
      label: item.label,
      missingEnv: item.env || item.missing || [],
      action: `Uzupelnic ${item.label} przed pelnym live.`,
      source: 'skill_catalog',
    }));
  const blockers = [...p0Blockers, ...readinessBlockers, ...skillBlockers];
  const allowed = blockers.length === 0 && report.summary.productionReady;
  return {
    generatedAt: new Date().toISOString(),
    allowed,
    status: allowed ? 'allowed' : 'blocked',
    mode: allowed ? 'live_ready' : 'blocked_by_required_integrations',
    message: allowed
      ? 'Preflight live zakończony pozytywnie. Można przełączyć profil live i wykonać testy kanałów.'
      : 'Preflight live zablokowany. Uzupełnij krytyczne integracje P0 albo zostań w trybie demo/manual.',
    blockers,
    nextAction: blockers[0]?.action || report.summary.nextAction,
    requiredEnv: Array.from(new Set(blockers.flatMap((blocker) => blocker.missingEnv || []))).sort(),
    report,
  };
}

function createIntegrationSetupTasks(db, user, settings = currentIntegrationSettings(db, user)) {
  const health = integrationHealth(settings);
  const skillCatalog = integrationSkillCatalog(settings, health);
  const readiness = productionReadinessChecklist(settings, health, skillCatalog);
  const setupPlan = integrationSetupPlan(settings, health, readiness);
  const now = new Date();
  const taskPriority = { P0: 'urgent', P1: 'high', P2: 'normal' };
  const setupKeys = new Set((setupPlan.items || []).map((item) => item.key));
  const skillCandidates = (skillCatalog.rows || [])
    .filter((row) => row.required && row.status !== 'ready' && !setupKeys.has(row.key))
    .map((row) => ({
      key: row.key,
      priority: row.key === 'domain_webhooks' || row.key === 'production_database' ? 'P0' : 'P1',
      account: row.label,
      module: row.skill,
      env: row.env || row.missing || [],
      ready: false,
      fallback: 'Blokada pełnego live SaaS',
      action: `Uzupelnic ${row.label} i ponowic live preflight`,
    }));
  const candidates = [...setupPlan.items, ...skillCandidates].filter((item) => !item.ready);
  const existingOpen = new Set(visibleTasks(db, user)
    .filter((task) => !['done', 'cancelled'].includes(task.status))
    .map((task) => task.sourceId));
  const created = [];
  const skipped = [];
  candidates.forEach((item, index) => {
    const sourceId = `integration_setup:${item.key}`;
    if (existingOpen.has(sourceId)) {
      skipped.push({ key: item.key, reason: 'existing_open_task' });
      return;
    }
    const due = new Date(now.getTime() + (item.priority === 'P0' ? 1 : item.priority === 'P1' ? 3 : 7) * 24 * 60 * 60 * 1000);
    const task = createOperationalTask(db, user, {
      id: nextSequenceId('task', db.tasks ?? []),
      title: `${item.priority} - podlacz ${item.account}`,
      status: 'open',
      priority: taskPriority[item.priority] || 'normal',
      source: 'system',
      sourceId,
      branchId: user.branchId,
      dueAt: due.toISOString(),
      notes: [
        `Modul: ${item.module}`,
        `Env: ${(item.env || []).join(', ') || '-'}`,
        `Fallback: ${item.fallback || '-'}`,
        `Akcja: ${item.action}`,
      ].join('\n'),
      createdAt: now.toISOString(),
      createdBy: user.id,
    });
    created.push(task);
    existingOpen.add(sourceId);
    emitTaskCreated(db, user, task);
  });
  return { setupPlan, created, skipped };
}

function communicationPromptKind(communication) {
  if (communication.channel === 'ai_receptionist') return 'ai_receptionist';
  if (communication.channel === 'mobile_meeting') return 'field_meeting';
  if (communication.type === 'meeting') return 'field_meeting';
  if (communication.direction === 'outbound') return 'estimator_call';
  return 'office_call';
}

function activePromptForCommunication(db, user, communication, promptId) {
  const prompts = visibleAiPrompts(db, user);
  if (promptId) return prompts.find((prompt) => prompt.id === promptId) ?? null;
  const kind = communicationPromptKind(communication);
  return prompts.find((prompt) => prompt.kind === kind && prompt.status === 'active')
    ?? prompts.find((prompt) => prompt.kind === kind)
    ?? prompts.find((prompt) => prompt.status === 'active')
    ?? null;
}

function communicationTranscriptText(communication, override) {
  if (typeof override === 'string' && override.trim()) return override.trim();
  if (Array.isArray(override)) return override.map((line) => `${line.speaker ?? 'Rozmowca'}: ${line.text ?? ''}`).join('\n').trim();
  return (communication.transcript ?? []).map((line) => `${line.speaker}: ${line.text}`).join('\n').trim();
}

function promptDrivenAnalysis(communication, prompt, transcriptText) {
  const text = String(transcriptText ?? '').trim();
  const lower = text.toLowerCase();
  const promptText = String(prompt?.body ?? '').toLowerCase();
  const checks = {
    term: lower.includes('termin') || lower.includes('ogledzin') || lower.includes('oględzin'),
    risk: lower.includes('ryzyk') || lower.includes('ogrodzen') || lower.includes('budyn') || lower.includes('zagro'),
    photos: lower.includes('zdjec') || lower.includes('zdję') || lower.includes('foto'),
    price: lower.includes('wycen') || lower.includes('koszt') || lower.includes('cena') || lower.includes('ofert'),
    nextStep: lower.includes('sms') || lower.includes('oddzwon') || lower.includes('potwierdz') || lower.includes('wyśl'),
    address: lower.includes('ul.') || lower.includes('krak') || lower.includes('adres') || lower.includes('lokaliz'),
  };
  const score = Math.min(98, Math.max(45,
    62
    + (checks.term ? 8 : 0)
    + (checks.risk ? 7 : 0)
    + (checks.photos ? 5 : 0)
    + (checks.price ? 6 : 0)
    + (checks.nextStep ? 6 : 0)
    + (checks.address ? 4 : 0)
    + (promptText.includes('risks') || promptText.includes('ryzyk') ? 2 : 0)
  ));
  const improvements = [];
  if (!checks.photos) improvements.push('Poprosic o zdjęcia lub dokumenty przed kolejnym krokiem');
  if (!checks.risk) improvements.push('Dopytać o ryzyka, dojazd i otoczenie prac');
  if (!checks.price) improvements.push('Nazwa? wycen?, zakres lub orientacyjne widełki');
  if (!checks.nextStep) improvements.push('Zakończyć rozmowę jasnym następnym krokiem');
  const strengths = [
    checks.term ? 'Rozmowa prowadzi do terminu lub oględzin' : 'Rozmowa została zapisana w CRM',
    checks.address ? 'Zebrano lokalizację lub kontekst miejsca' : 'Klient został przypisany do rekordu',
    checks.risk ? 'Odnotowano ryzyka terenowe' : 'Mozna dalej pogłebic ryzyka',
  ];
  const nextActions = [
    checks.term ? 'Potwierdzić termin SMS/e-mail' : 'Ustalić konkretny termin oględzin',
    checks.photos ? 'Przekazać zdjęcia wyceniającemu' : 'Poprosić klienta o zdjęcia',
    checks.risk ? 'Dopisać ryzyka do wyceny' : 'Zweryfikować ryzyka przed ofertą',
  ];
  const tags = [
    score < 75 ? 'review' : 'good_call',
    checks.risk ? 'risk_captured' : 'risk_missing',
    checks.photos ? 'photos_ready' : 'photos_missing',
    checks.nextStep ? 'next_step_clear' : 'next_step_missing',
  ];
  return {
    analysis: {
      score,
      summary: `Analiza według promptu "${prompt?.name ?? 'domyślny'}": ${score >= 80 ? 'rozmowa gotowa do pracy operacyjnej' : 'rozmowa wymaga przeglądu kierownika'}.`,
      intent: communication.analysis?.intent ?? (communication.type === 'meeting' ? 'Spotkanie terenowe' : 'Rozmowa z klientem'),
      strengths,
      improvements: improvements.length ? improvements : ['Utrzymać standard rozmowy i komplet danych w CRM'],
      nextActions,
      risks: checks.risk ? ['Ryzyka terenowe wymagaja uwzglednienia w ofercie'] : ['Brak pełnego opisu ryzyk terenowych'],
    },
    status: score >= 80 ? 'ready' : 'review',
    tags,
  };
}

function communicationOwnerLabel(db, communication) {
  if (communication.aiHandled || communication.channel === 'ai_receptionist') return { id: 'ai-receptionist', name: 'AI recepcjonista', role: 'AI' };
  const user = db.users.find((next) => next.id === communication.userId);
  if (user) return { id: user.id, name: actorName(user), role: user.role };
  return { id: 'unassigned', name: 'Nieprzypisane', role: 'UNKNOWN' };
}

function coachingScorecard(db, user, communications) {
  const completed = communications.filter((communication) => communication.status === 'completed' && communication.analysis);
  const groups = new Map();
  for (const communication of completed) {
    const owner = communicationOwnerLabel(db, communication);
    if (!groups.has(owner.id)) {
      groups.set(owner.id, {
        userId: owner.id,
        name: owner.name,
        role: owner.role,
        callCount: 0,
        averageScore: 0,
        reviewCount: 0,
        bestScore: 0,
        trend: 'stable',
        coachingTags: {},
        nextActions: [],
      });
    }
    const row = groups.get(owner.id);
    row.callCount += 1;
    row.averageScore += Number(communication.analysis.score ?? 0);
    row.bestScore = Math.max(row.bestScore, Number(communication.analysis.score ?? 0));
    if ((communication.analysisStatus ?? 'ready') === 'review' || Number(communication.analysis.score ?? 0) < 75) row.reviewCount += 1;
    for (const tag of communication.coachingTags ?? []) row.coachingTags[tag] = (row.coachingTags[tag] ?? 0) + 1;
    row.nextActions.push(...(communication.analysis.nextActions ?? []).slice(0, 2));
  }
  const rows = [...groups.values()].map((row) => ({
    ...row,
    averageScore: row.callCount ? Math.round(row.averageScore / row.callCount) : 0,
    coachingTags: Object.entries(row.coachingTags).sort((left, right) => right[1] - left[1]).map(([tag, count]) => ({ tag, count })),
    nextActions: [...new Set(row.nextActions)].slice(0, 5),
  })).sort((left, right) => right.averageScore - left.averageScore);
  const reviewQueue = completed
    .filter((communication) => (communication.analysisStatus ?? 'ready') === 'review' || Number(communication.analysis.score ?? 0) < 75)
    .sort((left, right) => Number(left.analysis.score ?? 0) - Number(right.analysis.score ?? 0))
    .slice(0, 20)
    .map((communication) => ({
      id: communication.id,
      clientId: communication.clientId,
      orderId: communication.orderId,
      user: communicationOwnerLabel(db, communication),
      score: communication.analysis.score,
      subject: communication.subject,
      startedAt: communication.startedAt,
      tags: communication.coachingTags ?? [],
    }));
  return {
    tenantId: tenantIdForUser(db, user),
    generatedAt: new Date().toISOString(),
    totalAnalyzed: completed.length,
    averageScore: completed.length ? Math.round(completed.reduce((sum, communication) => sum + Number(communication.analysis.score ?? 0), 0) / completed.length) : 0,
    users: rows,
    reviewQueue,
  };
}

function communicationForUser(db, user, id) {
  return visibleCommunications(db, user).find((communication) => communication.id === id);
}

const softphonePresenceStatuses = new Set(['available', 'busy', 'away', 'offline']);

function activeSoftphoneCall(db, userId) {
  return (db.communications ?? []).find((communication) => (
    !communication.deletedAt
    && communication.userId === userId
    && communication.channel === 'web_softphone'
    && communication.status === 'active'
  ));
}

function softphoneAgentUsers(db, user, branchId, preferredUserIds = []) {
  const preferred = new Set(preferredUserIds.map((id) => String(id)));
  return visibleUsers(db, user)
    .filter((next) => next.branchId === branchId && canRole(db, user, next.role, 'communications', 'write'))
    .sort((left, right) => {
      if (left.id === user.id) return -1;
      if (right.id === user.id) return 1;
      if (preferred.has(left.id) && !preferred.has(right.id)) return -1;
      if (preferred.has(right.id) && !preferred.has(left.id)) return 1;
      return left.id.localeCompare(right.id);
    });
}

function softphonePresenceRow(db, user, targetUser) {
  const tenantId = tenantIdForUser(db, user);
  const row = (db.softphonePresence ?? []).find((presence) => rowTenantId(db, presence) === tenantId && presence.userId === targetUser.id);
  const activeCall = activeSoftphoneCall(db, targetUser.id);
  const status = activeCall ? 'busy' : row?.status ?? 'available';
  return {
    id: row?.id ?? `presence-${tenantId}-${targetUser.id}`,
    tenantId,
    userId: targetUser.id,
    status,
    activeCallId: activeCall?.id ?? row?.activeCallId,
    updatedAt: row?.updatedAt ?? new Date().toISOString(),
    updatedBy: row?.updatedBy ?? targetUser.id,
  };
}

function setSoftphonePresence(db, user, targetUser, status, activeCallId) {
  db.softphonePresence ??= [];
  const tenantId = tenantIdForUser(db, user);
  const now = new Date().toISOString();
  const next = {
    id: `presence-${tenantId}-${targetUser.id}`,
    tenantId,
    userId: targetUser.id,
    status,
    activeCallId: activeCallId || undefined,
    updatedAt: now,
    updatedBy: user.id,
  };
  const index = db.softphonePresence.findIndex((presence) => rowTenantId(db, presence) === tenantId && presence.userId === targetUser.id);
  if (index >= 0) db.softphonePresence[index] = next;
  else db.softphonePresence.unshift(next);
  return next;
}

function softphoneAvailabilitySnapshot(db, user, branchId = user.branchId, preferredUserIds = []) {
  const agents = softphoneAgentUsers(db, user, branchId, preferredUserIds);
  const rows = agents.map((agent) => ({
    user: publicUser(agent),
    presence: softphonePresenceRow(db, user, agent),
  }));
  return {
    branchId,
    agents: rows,
    availableAgents: rows.filter((row) => row.presence.status === 'available'),
  };
}

function routeSoftphoneCall(db, user, branchId, body = {}) {
  const preferredUserIds = Array.isArray(body.preferredUserIds)
    ? body.preferredUserIds.map((id) => String(id))
    : [];
  const availability = softphoneAvailabilitySnapshot(db, user, branchId, preferredUserIds);
  const assigned = availability.availableAgents[0] ?? null;
  return {
    branchId,
    assignedUserId: assigned?.user.id,
    assignedUserName: assigned ? `${assigned.user.firstName} ${assigned.user.lastName}` : undefined,
    availableAgentCount: availability.availableAgents.length,
    totalAgentCount: availability.agents.length,
    routingLog: [
      `Eligible agents: ${availability.agents.length}`,
      `Available agents: ${availability.availableAgents.length}`,
      assigned ? `Assigned to: ${assigned.user.id}` : 'No available human agent',
    ],
  };
}

function shouldOverflowToAi(settings, route, body, receivedAt) {
  if (!settings.enabled) return { shouldOverflow: false, reason: 'ai_disabled' };
  if (body.forceAi) return { shouldOverflow: true, reason: 'forced_ai' };
  const waitSec = Number(body.waitSec ?? body.ringSec ?? 0);
  if (Boolean(body.overflow) || waitSec >= Number(settings.overflowAfterSec ?? 25)) {
    return { shouldOverflow: true, reason: 'overflow_timeout' };
  }
  const hasExplicitTime = body.receivedAt !== undefined;
  if (hasExplicitTime && !isBusinessOpen(settings, receivedAt)) return { shouldOverflow: true, reason: 'after_hours' };
  if (!route.availableAgentCount) return { shouldOverflow: true, reason: 'no_available_agents' };
  return { shouldOverflow: false, reason: 'human_agent_available' };
}

function createAiOverflowCase(db, user, client, branchId, body, reason, receivedAt) {
  const settings = currentAiReceptionistSettings(db, user);
  const escalation = aiReceptionistEscalation(settings, body);
  const booking = findInspectionSlot(db, user, client.branchId ?? branchId, settings, receivedAt, body.inspectionAt);
  let order = body.orderId ? visibleOrders(db, user).find((next) => next.id === body.orderId) : null;
  let createdOrder = false;
  if (!order) {
    order = {
      id: nextSequenceId('Z', db.orders),
      branchId: client.branchId ?? branchId,
      clientId: client.id,
      teamId: undefined,
      estimatorId: booking.estimator?.id ?? db.users.find((next) => next.role === 'WYCENIAJACY' && next.branchId === (client.branchId ?? branchId))?.id,
      address: body.address ?? client.address.split(',')[0] ?? 'Do ustalenia',
      city: body.city ?? client.address.split(',').at(-1)?.trim() ?? '',
      type: body.subject ?? 'AI overflow po nieodebranym telefonie',
      status: 'NOWE',
      priority: escalation.required ? 'pilny' : body.priority ?? 'normalny',
      scheduledAt: booking.slot ?? receivedAt.toISOString(),
      inspectionAt: booking.slot,
      value: 0,
      margin: 30,
      timeline: [
        { label: `AI recepcjonista przejął telefon: ${reason}`, at: receivedAt.toISOString(), by: 'AI recepcjonista' },
        ...(booking.slot ? [{ label: `AI zarezerwował oględziny: ${booking.slot}`, at: receivedAt.toISOString(), by: 'AI recepcjonista' }] : []),
      ],
      checklist: [
        { label: 'Potwierdzić klientowi SMS/e-mail', done: false },
        { label: 'Zweryfikować transkrypcję AI', done: false },
        { label: 'Przypisać lub potwierdzić wyceniającego', done: Boolean(booking.estimator) },
      ],
    };
    db.orders.unshift(order);
    createdOrder = true;
  } else {
    if (booking.slot && !order.inspectionAt) {
      order.inspectionAt = booking.slot;
      order.scheduledAt = booking.slot;
    }
    order.timeline.push({ label: `AI recepcjonista przejął telefon: ${reason}`, at: receivedAt.toISOString(), by: 'AI recepcjonista' });
  }
  const transcript = [
    { speaker: 'AI recepcjonista', text: 'Biuro jest teraz niedostępne, przyjmę zgłoszenie i zapiszę je w CRM.', atSec: 0 },
    { speaker: 'Klient', text: body.customerLine ?? 'Chcę umówić oględziny i proszę o oddzwonienie.', atSec: 17 },
    { speaker: 'AI recepcjonista', text: booking.slot ? `Proponuję termin oględzin ${booking.slot}.` : 'Przekazuję sprawę do biura do ręcznego umówienia.', atSec: 48 },
  ];
  const communication = {
    id: `com-${crypto.randomUUID().slice(0, 8)}`,
    type: 'call',
    clientId: client.id,
    orderId: order.id,
    direction: 'inbound',
    channel: 'ai_receptionist',
    status: 'completed',
    subject: body.subject ?? 'AI recepcjonista - overflow softphone',
    startedAt: receivedAt.toISOString(),
    durationSec: Number(body.aiDurationSec ?? 164),
    aiHandled: true,
    queueStatus: 'completed',
    overflowReason: reason,
    recordingUrl: '/recordings/demo/ai-receptionist-overflow.mp3',
    transcript,
    analysis: demoCallAnalysis(transcript, 'AI recepcjonista - overflow po nieodebranym telefonie'),
  };
  const botSession = {
    id: `bot-${crypto.randomUUID().slice(0, 8)}`,
    clientId: client.id,
    mode: reason === 'after_hours' ? 'after_hours' : 'overflow',
    status: booking.slot ? 'booked' : 'closed',
    startedAt: receivedAt.toISOString(),
    transcript: transcript.map((line) => `${line.speaker}: ${line.text}`).join('\n'),
    outcome: booking.slot ? 'AI przejął telefon i zarezerwował oględziny.' : 'AI przejął telefon i przekazał do ręcznego domknięcia.',
    inspectionAt: booking.slot,
    orderId: order.id,
    takeoverReason: reason,
    escalationRequired: escalation.required,
    bookingStatus: booking.slot ? 'booked' : 'qualification_only',
    assignedEstimatorId: booking.estimator?.id,
  };
  const task = createOperationalTask(db, user, {
    title: booking.slot
      ? `Zweryfikowac overflow AI: ${client.name}`
      : `Oddzwonić po overflow: ${client.name}`,
    priority: escalation.required ? 'urgent' : booking.slot ? 'normal' : 'high',
    source: 'softphone',
    sourceId: botSession.id,
    clientId: client.id,
    orderId: order.id,
    branchId: client.branchId ?? branchId,
    assignedEstimatorId: booking.estimator?.id,
    dueAt: new Date(receivedAt.getTime() + (booking.slot ? 24 : 2) * 60 * 60 * 1000).toISOString(),
    notes: [
      `Overflow: ${reason}.`,
      booking.slot ? `Termin oględzin: ${booking.slot}.` : `Do ręcznego umówienia: ${booking.reason}.`,
      escalation.required ? `Eskalacja: ${escalation.reason}.` : '',
    ].filter(Boolean).join(' '),
    createdAt: receivedAt.toISOString(),
  });
  order.timeline.push({ label: `Zadanie po overflow: ${task.title}`, at: receivedAt.toISOString(), by: 'AI recepcjonista' });
  db.communications.unshift(communication);
  db.aiBotSessions.unshift(botSession);
  emitTaskCreated(db, user, task);
  pushEvent(db, user, `branch:${client.branchId ?? branchId}:communications`, 'ai_receptionist.overflow_completed', {
    id: communication.id,
    clientId: client.id,
    orderId: order.id,
    taskId: task.id,
    botSessionId: botSession.id,
    reason,
    inspectionAt: booking.slot,
    createdOrder,
  });
  return {
    order,
    communication,
    botSession,
    task,
    createdOrder,
    booking: {
      inspectionAt: booking.slot,
      estimatorId: booking.estimator?.id,
      reason: booking.reason,
      conflict: booking.conflict,
    },
  };
}

function createTelephonyClient(db, user, body, source) {
  const phone = String(body.phone ?? body.callerId ?? body.from ?? '').trim();
  if (!phone) return { error: 'Numer telefonu jest wymagany', status: 400 };
  const writeBranch = branchForWrite(db, user, body.branchId);
  if (writeBranch.error) return writeBranch;
  const branchId = writeBranch.branchId;
  let client = visibleClients(db, user).find((next) => normalizePhone(next.phone) === normalizePhone(phone));
  let createdClient = false;
  if (!client) {
    client = {
      id: nextSequenceId('c', db.clients),
      branchId,
      name: body.clientName ?? `Lead telefoniczny ${phone}`,
      phone,
      email: body.email ?? '',
      address: body.address ?? 'Do ustalenia',
      ltv: 0,
      tags: [source, 'nowy lead'],
      customFields: { source },
    };
    db.clients.unshift(client);
    createdClient = true;
  }
  return { client, branchId, phone, createdClient };
}

app.get('/api/softphone/availability', requireAccess('communications'), (req, res) => {
  const branchId = String(req.query.branchId ?? req.user.branchId);
  if (!sameTenantBranch(req.db, req.user, branchId)) return res.status(403).json({ error: 'Oddział poza tenantem' });
  res.json(softphoneAvailabilitySnapshot(req.db, req.user, branchId));
});

app.patch('/api/softphone/availability', requireAccess('communications', 'write'), async (req, res) => {
  const status = String(req.body?.status ?? '').trim();
  if (!softphonePresenceStatuses.has(status)) return res.status(400).json({ error: 'Status musi być available, busy, away albo offline' });
  const targetUserId = String(req.body?.userId ?? req.user.id);
  if (targetUserId !== req.user.id && !['ADMINISTRATOR', 'DYREKTOR'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Tylko administrator lub dyrektor może zmienić status innego użytkownika' });
  }
  const targetUser = visibleUsers(req.db, req.user).find((next) => next.id === targetUserId);
  if (!targetUser || !can(targetUser.role, 'communications', 'write')) return res.status(404).json({ error: 'Nie znaleziono agenta softphone w tym tenancie' });
  const activeCall = activeSoftphoneCall(req.db, targetUser.id);
  if (activeCall && status !== 'busy') {
    return res.status(409).json({ error: 'Użytkownik ma aktywne połączenie', activeCallId: activeCall.id });
  }
  const presence = setSoftphonePresence(req.db, req.user, targetUser, status, status === 'busy' ? req.body?.activeCallId : undefined);
  pushEvent(req.db, req.user, `branch:${targetUser.branchId}:communications`, 'softphone.presence_updated', {
    id: presence.id,
    userId: targetUser.id,
    status: presence.status,
    activeCallId: presence.activeCallId,
  });
  await saveDb(req.db);
  res.json(presence);
});

app.post('/api/softphone/incoming', requireAccess('communications', 'write'), async (req, res) => {
  const payload = createTelephonyClient(req.db, req.user, req.body ?? {}, 'web_softphone');
  if (payload.error) return res.status(payload.status).json(payload);
  const receivedAt = Number.isFinite(new Date(req.body?.receivedAt ?? '').getTime()) ? new Date(req.body.receivedAt) : new Date();
  const now = receivedAt.toISOString();
  const route = routeSoftphoneCall(req.db, req.user, payload.client.branchId ?? payload.branchId, req.body ?? {});
  const settings = currentAiReceptionistSettings(req.db, req.user);
  const overflow = shouldOverflowToAi(settings, route, req.body ?? {}, receivedAt);
  const status = overflow.shouldOverflow ? 'missed' : (route.assignedUserId ? 'ringing' : 'queued');
  const communication = {
    id: `com-${crypto.randomUUID().slice(0, 8)}`,
    type: 'call',
    clientId: payload.client.id,
    orderId: req.body?.orderId,
    direction: 'inbound',
    channel: 'web_softphone',
    status,
    subject: req.body?.subject ?? 'Połączenie przychodzące web softphone',
    startedAt: now,
    durationSec: 0,
    aiHandled: false,
    queueStatus: overflow.shouldOverflow ? 'overflowed' : (route.assignedUserId ? 'assigned' : 'queued'),
    assignedUserId: overflow.shouldOverflow ? undefined : route.assignedUserId,
    assignedAt: route.assignedUserId && !overflow.shouldOverflow ? now : undefined,
    overflowAt: overflow.shouldOverflow ? now : undefined,
    overflowReason: overflow.shouldOverflow ? overflow.reason : undefined,
    routingLog: route.routingLog,
    recordingUrl: undefined,
    transcript: [],
    analysis: demoCallAnalysis([], 'Połączenie przychodzące'),
  };
  if (communication.orderId && !visibleOrders(req.db, req.user).some((order) => order.id === communication.orderId)) {
    return res.status(403).json({ error: 'Zlecenie poza zakresem roli lub tenantem' });
  }
  req.db.communications.unshift(communication);
  let aiHandoff = null;
  if (overflow.shouldOverflow) {
    aiHandoff = createAiOverflowCase(req.db, req.user, payload.client, payload.branchId, req.body ?? {}, overflow.reason, receivedAt);
  }
  pushEvent(req.db, req.user, `branch:${payload.client.branchId ?? payload.branchId}:communications`, 'softphone.incoming', {
    id: communication.id,
    clientId: payload.client.id,
    phone: payload.phone,
    createdClient: payload.createdClient,
    queueStatus: communication.queueStatus,
    assignedUserId: communication.assignedUserId,
    overflowReason: communication.overflowReason,
    aiCommunicationId: aiHandoff?.communication.id,
  });
  await saveDb(req.db);
  res.status(201).json({ client: payload.client, communication, createdClient: payload.createdClient, route, overflow, aiHandoff });
});

app.post('/api/softphone/:id/answer', requireAccess('communications', 'write'), async (req, res) => {
  const communication = communicationForUser(req.db, req.user, req.params.id);
  if (!communication) return res.status(404).json({ error: 'Nie znaleziono połączenia' });
  if (!['queued', 'ringing'].includes(communication.status)) return res.status(409).json({ error: 'Połączenie nie oczekuje na odebranie', status: communication.status });
  if (communication.assignedUserId && communication.assignedUserId !== req.user.id) {
    return res.status(409).json({ error: 'Połączenie przypisane do innego agenta', assignedUserId: communication.assignedUserId });
  }
  const presence = softphonePresenceRow(req.db, req.user, req.user);
  if (['away', 'offline'].includes(presence.status)) return res.status(409).json({ error: 'Agent nie jest dostępny', status: presence.status });
  if (presence.status === 'busy' && presence.activeCallId && presence.activeCallId !== communication.id) {
    return res.status(409).json({ error: 'Agent ma już aktywne połączenie', activeCallId: presence.activeCallId });
  }
  communication.status = 'active';
  communication.userId = req.user.id;
  communication.queueStatus = 'answered';
  communication.assignedUserId = req.user.id;
  communication.assignedAt ??= new Date().toISOString();
  communication.routingLog = [...(communication.routingLog ?? []), `Answered by: ${req.user.id}`];
  setSoftphonePresence(req.db, req.user, req.user, 'busy', communication.id);
  const client = req.db.clients.find((next) => next.id === communication.clientId);
  pushEvent(req.db, req.user, `branch:${client?.branchId ?? req.user.branchId}:communications`, 'softphone.answered', {
    id: communication.id,
    clientId: communication.clientId,
    userId: req.user.id,
  });
  await saveDb(req.db);
  res.json(communication);
});

app.post('/api/softphone/:id/complete', requireAccess('communications', 'write'), async (req, res) => {
  const communication = communicationForUser(req.db, req.user, req.params.id);
  if (!communication) return res.status(404).json({ error: 'Nie znaleziono połączenia' });
  if (communication.status === 'completed') return res.status(409).json({ error: 'Połączenie jest już zakończone' });
  const durationSec = Number(req.body?.durationSec ?? communication.durationSec ?? 0);
  if (!Number.isFinite(durationSec) || durationSec < 0) return res.status(400).json({ error: 'Czas rozmowy jest nieprawidłowy' });
  const transcript = Array.isArray(req.body?.transcript)
    ? req.body.transcript.map((line, index) => ({
        speaker: String(line.speaker ?? (index % 2 ? 'Klient' : 'Biuro')).trim(),
        text: String(line.text ?? '').trim(),
        atSec: Number.isFinite(Number(line.atSec)) ? Math.max(0, Math.round(Number(line.atSec))) : index * 20,
      })).filter((line) => line.text)
    : [
        { speaker: 'Biuro', text: 'Dzień dobry, Polska Flora, slucham.', atSec: 0 },
        { speaker: 'Klient', text: 'Chcę umówić oględziny i porozmawiać o zakresie prac.', atSec: 18 },
      ];
  communication.status = 'completed';
  communication.durationSec = Math.round(durationSec);
  communication.recordingUrl = req.body?.recordingUrl ?? communication.recordingUrl ?? '/recordings/demo/web-softphone-inbound.mp3';
  communication.transcript = transcript;
  communication.analysis = demoCallAnalysis(transcript, req.body?.intent ?? 'Rozmowa przychodząca - kwalifikacja klienta');
  communication.queueStatus = 'completed';
  communication.routingLog = [...(communication.routingLog ?? []), `Completed by: ${req.user.id}`];
  const currentPresence = softphonePresenceRow(req.db, req.user, req.user);
  if (currentPresence.activeCallId === communication.id || currentPresence.status === 'busy') {
    setSoftphonePresence(req.db, req.user, req.user, 'available');
  }
  const client = req.db.clients.find((next) => next.id === communication.clientId);
  const order = communication.orderId ? req.db.orders.find((next) => next.id === communication.orderId) : null;
  if (order) {
    order.timeline.push({ label: 'Rozmowa telefoniczna nagrana i przeanalizowana AI', at: new Date().toISOString(), by: actorName(req.user) });
  }
  pushEvent(req.db, req.user, `branch:${client?.branchId ?? req.user.branchId}:communications`, 'softphone.completed', {
    id: communication.id,
    clientId: communication.clientId,
    orderId: communication.orderId,
    score: communication.analysis.score,
    recordingUrl: communication.recordingUrl,
  });
  await saveDb(req.db);
  res.json(communication);
});

app.post('/api/zadarma/call', requireAccess('communications', 'write'), async (req, res) => {
  const phone = String(req.body?.phone ?? '').trim();
  if (!phone) return res.status(400).json({ error: 'Numer telefonu jest wymagany' });
  const integrationSettings = currentIntegrationSettings(req.db, req.user);
  if (!integrationSettings.zadarma.enabled) return res.status(409).json({ error: 'Integracja Zadarma jest wyłączona w ustawieniach tenanta' });
  const from = req.body?.from || zadarmaSip;
  const writeBranch = branchForWrite(req.db, req.user, req.body?.branchId);
  if (writeBranch.error) return res.status(writeBranch.status).json(writeBranch);
  const branchId = writeBranch.branchId;
  const now = new Date().toISOString();
  let client = req.db.clients.find((next) => normalizePhone(next.phone) === normalizePhone(phone));
  if (client && !visibleClients(req.db, req.user).some((next) => next.id === client.id)) return res.status(403).json({ error: 'Klient poza zakresem roli lub tenantem' });
  let createdClient = false;
  if (!client) {
    client = {
      id: nextSequenceId('c', req.db.clients),
      branchId,
      name: req.body?.clientName ?? `Lead telefoniczny ${phone}`,
      phone,
      email: req.body?.email ?? '',
      address: req.body?.address ?? 'Do ustalenia',
      ltv: 0,
      tags: ['softphone', 'nowy lead'],
      customFields: { source: 'web_softphone' },
    };
    req.db.clients.unshift(client);
    createdClient = true;
  }
  const payload = {
    id: `call-${crypto.randomUUID().slice(0, 8)}`,
    phone,
    from,
    userId: req.user.id,
    status: 'queued',
    createdAt: new Date().toISOString(),
  };
  if (zadarmaConfigured && phone) {
    try {
      const provider = await zadarmaRequest('/v1/request/callback/', { from, to: phone });
      payload.status = provider?.status === 'success' ? 'ringing' : 'queued';
      payload.provider = provider;
    } catch (error) {
      payload.status = 'error';
      payload.error = String(error.message || error).slice(0, 160);
      console.error('zadarma call error', error);
    }
  } else {
    payload.simulated = true;
    payload.status = 'completed';
  }
  const communication = {
    id: `com-${crypto.randomUUID().slice(0, 8)}`,
    type: 'call',
    clientId: client.id,
    userId: req.user.id,
    direction: 'outbound',
    channel: 'web_softphone',
    status: payload.status === 'error' ? 'failed' : (payload.simulated ? 'completed' : 'ringing'),
    subject: req.body?.subject ?? 'Oddzwonienie z web softphone',
    startedAt: now,
    durationSec: payload.simulated ? 164 : 0,
    aiHandled: false,
    recordingUrl: payload.simulated ? '/recordings/demo/web-softphone-call.mp3' : undefined,
    transcript: payload.simulated
      ? [
          { speaker: 'Biuro', text: 'Dzień dobry, oddzwaniamy z Polska Flora w sprawie zgłoszenia.', atSec: 0 },
          { speaker: 'Klient', text: 'Proszę potwierdzić termin oględzin i zakres prac.', atSec: 24 },
        ]
      : [],
    analysis: {
      score: payload.simulated ? 82 : 0,
      summary: payload.simulated ? 'Oddzwonienie zapisane w CRM, klient otrzymał potwierdzenie kolejnego kroku.' : 'Połączenie zainicjowane przez softphone.',
      intent: 'Oddzwonienie do klienta',
      strengths: payload.simulated ? ['Szybki kontakt zwrotny', 'Jasny następny krok'] : [],
      improvements: payload.simulated ? ['Dopytać o zdjęcia przed oględzinami'] : [],
      nextActions: ['Wysłać SMS z terminem', 'Dopisać notatkę do zlecenia'],
      risks: payload.simulated ? ['Brak pełnego opisu dostępu'] : [],
    },
  };
  req.db.communications.unshift(communication);
  pushEvent(req.db, req.user, `branch:${client.branchId ?? branchId}:communications`, 'softphone.call_created', { ...payload, clientId: client.id, communicationId: communication.id, createdClient });
  await saveDb(req.db);
  res.status(202).json({ ...payload, client, communication, createdClient });
});

app.all('/api/zadarma/webhook', async (req, res) => {
  // Walidacja URL webhooka (pierwsze wywołanie Zadarma) — odeślij echo bez podpisu.
  const echo = req.query?.zd_echo ?? req.body?.zd_echo;
  if (echo) return res.send(String(echo));
  const verified = verifyZadarmaWebhook(req);
  if (!verified.ok) return res.status(verified.status).json({ error: verified.error });

  const body = req.method === 'GET' ? req.query : (req.body ?? {});
  // NOTIFY_RECORD: nagranie rozmowy gotowe → push do CRM/Gabinetu (do analizy AI).
  if ((body.event ?? '') === 'NOTIFY_RECORD') {
    const recBranch = body.branchId ?? req.db.branches[0]?.id ?? 'krk';
    const actor = integrationActor(req.db, recBranch);
    const integrationSettings = currentIntegrationSettings(req.db, actor);
    const callId = zadarmaCallId(body);
    const now = new Date().toISOString();
    const communication = callId
      ? (req.db.communications ?? []).find((item) => item.recordingId === callId || item.providerCallId === callId)
      : null;
    const client = communication ? req.db.clients.find((item) => item.id === communication.clientId) : null;
    const order = communication?.orderId ? req.db.orders.find((item) => item.id === communication.orderId) : null;
    let prompt = null;
    let analysis = null;
    if (integrationSettings.zadarma.autoAttachRecordings && communication && client?.branchId === recBranch) {
      communication.recordingId = callId || communication.recordingId;
      communication.recordingSource = 'zadarma';
      communication.recordingStatus = 'ready';
      communication.recordingReceivedAt = now;
      communication.recordingUrl = body.recordingUrl ?? body.downloadUrl ?? body.link ?? communication.recordingUrl;
      if (Object.prototype.hasOwnProperty.call(body, 'transcript')) {
        communication.transcript = normalizeTranscriptLines(body.transcript);
        communication.transcriptStatus = communication.transcript.length ? 'ready' : 'missing';
      } else if (body.transcriptStatus) {
        const transcriptStatus = communicationTranscriptStatus(body.transcriptStatus, communication.transcript?.length ?? 0);
        if (!transcriptStatus.error) communication.transcriptStatus = transcriptStatus.status;
      }
      const transcriptText = communicationTranscriptText(communication);
      if (transcriptText.length >= 10 && body.autoAnalyze !== false && integrationSettings.ai.autoAnalyze && integrationSettings.zadarma.autoAnalyzeRecordings) {
        prompt = activePromptForCommunication(req.db, actor, communication, body.promptId);
        if (prompt) {
          const result = promptDrivenAnalysis(communication, prompt, transcriptText);
          communication.analysis = result.analysis;
          communication.analysisPromptId = prompt.id;
          communication.analysisPromptVersion = Number(prompt.version ?? 1);
          communication.analysisModel = openaiKey ? openaiModel : 'deterministic-local-rubric';
          communication.analysisUpdatedAt = now;
          communication.analysisStatus = result.status;
          communication.coachingTags = result.tags;
          analysis = communication.analysis;
        }
      }
      if (['queued', 'ringing', 'active'].includes(communication.status)) communication.status = 'completed';
      if (order) order.timeline.push({ label: 'Nagranie Zadarma gotowe do transkrypcji i analizy AI', at: now, by: actorName(actor) });
    }
    pushEvent(req.db, actor, `branch:${recBranch}:communications`, 'zadarma.recording_ready', {
      id: communication?.id ?? callId,
      callId,
      communicationId: communication?.id,
      clientId: communication?.clientId,
      orderId: communication?.orderId,
      recordingUrl: communication?.recordingUrl,
      recordingStatus: communication?.recordingStatus ?? 'ready',
      autoAttachRecordings: integrationSettings.zadarma.autoAttachRecordings,
      autoAnalyzeRecordings: integrationSettings.zadarma.autoAnalyzeRecordings,
      transcriptStatus: communication?.transcriptStatus,
      transcriptLines: communication?.transcript?.length ?? 0,
      analysisScore: analysis?.score,
      promptId: prompt?.id,
      at: now,
    });
    await saveDb(req.db);
    return res.sendStatus(200);
  }
  const phone = body.caller_id ?? body.phone ?? body.from ?? 'nieznany numer';
  const branchId = body.branchId ?? req.db.branches[0]?.id ?? 'krk';
  const actor = integrationActor(req.db, branchId);
  const integrationSettings = currentIntegrationSettings(req.db, actor);
  const now = new Date().toISOString();
  const callId = zadarmaCallId(body);
  let client = req.db.clients.find((next) => next.phone === phone);
  let createdClient = false;

  if (!client) {
    client = {
      id: nextSequenceId('c', req.db.clients),
      branchId,
      name: body.clientName ?? `Lead telefoniczny ${phone}`,
      phone,
      email: body.email ?? '',
      address: body.address ?? body.city ?? 'Do ustalenia',
      ltv: 0,
      tags: ['zadarma', 'nowy lead'],
      customFields: { source: 'zadarma', callId: body.call_id ?? body.callId ?? null },
    };
    req.db.clients.unshift(client);
    createdClient = true;
  }

  const openOrder = req.db.orders.find((order) => order.clientId === client.id && !['ZAKONCZONE', 'ANULOWANE'].includes(order.status));
  let order = openOrder;
  let createdOrder = false;
  if (!order && (body.direction ?? 'inbound') === 'inbound') {
    order = {
      id: nextSequenceId('Z', req.db.orders),
      branchId,
      clientId: client.id,
      teamId: undefined,
      estimatorId: req.db.users.find((user) => user.role === 'WYCENIAJACY' && user.branchId === branchId)?.id,
      address: body.address ?? client.address.split(',')[0] ?? 'Do ustalenia',
      city: body.city ?? client.address.split(',').at(-1)?.trim() ?? '',
      type: body.subject ?? 'Telefon z Zadarmy',
      status: 'NOWE',
      priority: body.priority ?? 'normalny',
      scheduledAt: body.scheduledAt ?? now,
      inspectionAt: body.inspectionAt,
      value: Number(body.value ?? 0),
      margin: Number(body.margin ?? 30),
      timeline: [{ label: 'Telefon i kwalifikacja', at: now, by: actorName(actor) }],
      checklist: [{ label: 'BHP przed pracą', done: false }, { label: 'Zdjęcia przed', done: false }, { label: 'Podpis klienta', done: false }],
    };
    req.db.orders.unshift(order);
    createdOrder = true;
  } else if (order) {
    order.timeline.push({ label: 'Telefon od klienta', at: now, by: actorName(actor) });
  }

  let communication = integrationSettings.zadarma.autoCreateCommunication && callId
    ? (req.db.communications ?? []).find((item) => item.recordingId === callId || item.providerCallId === callId)
    : null;
  let createdCommunication = false;
  if (!communication && integrationSettings.zadarma.autoCreateCommunication) {
    communication = {
      id: `com-${crypto.randomUUID().slice(0, 8)}`,
      type: 'call',
      clientId: client.id,
      orderId: order?.id,
      direction: (body.direction ?? 'inbound') === 'outbound' ? 'outbound' : 'inbound',
      channel: 'zadarma',
      status: zadarmaCommunicationStatus(body),
      subject: body.subject ?? 'Telefon z Zadarmy',
      startedAt: body.startedAt ?? body.start ?? now,
      durationSec: Math.max(0, Math.round(Number(body.durationSec ?? body.duration ?? 0) || 0)),
      aiHandled: false,
      recordingId: callId || undefined,
      recordingSource: 'zadarma',
      recordingStatus: callId ? 'processing' : 'missing',
      transcriptStatus: 'missing',
      transcript: [],
      analysis: demoCallAnalysis([], 'Telefon z Zadarmy'),
    };
    req.db.communications.unshift(communication);
    createdCommunication = true;
  } else if (communication) {
    communication.clientId = client.id;
    communication.orderId ??= order?.id;
    communication.status = zadarmaCommunicationStatus(body);
    communication.durationSec = Math.max(communication.durationSec ?? 0, Math.round(Number(body.durationSec ?? body.duration ?? 0) || 0));
    communication.recordingId = callId || communication.recordingId;
    communication.recordingSource = 'zadarma';
  }
  if (order && communication && !order.timeline.some((item) => item.label.includes(`Rozmowa Zadarma ${communication.id}`))) {
    order.timeline.push({ label: `Rozmowa Zadarma ${communication.id} zapisana w CRM`, at: now, by: actorName(actor) });
  }

  const payload = {
    phone,
    clientId: client.id,
    orderId: order?.id,
    communicationId: communication?.id,
    direction: body.direction ?? 'inbound',
    callId,
    createdClient,
    createdOrder,
    createdCommunication,
    autoCreateCommunication: integrationSettings.zadarma.autoCreateCommunication,
    at: now,
  };
  pushEvent(req.db, actor, `branch:${branchId}:communications`, 'zadarma.incoming_call', payload);
  await saveDb(req.db);
  res.json({ ok: true, payload });
});

app.get('/api/zadarma/recordings/:callId', requireAccess('crm'), async (req, res) => {
  const retentionDays = currentIntegrationSettings(req.db, req.user).zadarma.recordingRetentionDays ?? recordingRetentionDays;
  if (zadarmaConfigured) {
    try {
      const downloadUrl = await fetchRecordingUrl(req.params.callId);
      return res.json({ callId: req.params.callId, downloadUrl, encrypted: true, retentionDays });
    } catch (error) {
      console.error('zadarma recording error', error);
      return res.status(502).json({ error: 'Nie udało się pobrać nagrania', detail: String(error.message || error).slice(0, 160) });
    }
  }
  res.json({
    callId: req.params.callId,
    encrypted: true,
    retentionDays,
    downloadUrl: null,
    simulated: true,
    note: 'Tryb demo. Ustaw ZADARMA_KEY/ZADARMA_SECRET, aby pobierać realne nagrania (podpis HMAC).',
  });
});

app.post('/api/call-analyses/:recordingId/run', requireAccess('valuations', 'write'), async (req, res) => {
  const recordingId = req.params.recordingId;
  let transcript = req.body?.transcript || null;

  try {
    if (!transcript && (deepgramKey || openaiKey)) {
      const audioUrl = req.body?.audioUrl || (zadarmaConfigured ? await fetchRecordingUrl(recordingId).catch(() => null) : null);
      if (audioUrl) transcript = await transcribeCall(audioUrl);
    }
    if (transcript && openaiKey) {
      // RODO: pseudonimizuj PII przed wysłaniem do zewnętrznego LLM.
      const safeTranscript = pseudonymizeTranscript(transcript, req.db.clients);
      const scored = await scoreCallTranscript(safeTranscript);
      const analysis = {
        id: `analysis-${crypto.randomUUID().slice(0, 8)}`,
        recordingId,
        estimatorId: req.user.id,
        score: Number(scored.score) || 0,
        strengths: Array.isArray(scored.strengths) ? scored.strengths : [],
        improve: Array.isArray(scored.improve) ? scored.improve : [],
        tips: scored.tips || '',
        source: 'ai',
        createdAt: new Date().toISOString(),
      };
      pushEvent(req.db, req.user, 'valuations', 'call_analysis.ready', analysis);
      await saveDb(req.db);
      return res.status(201).json(analysis);
    }
  } catch (error) {
    console.error('call analysis error', error);
    // spadnij do trybu demo poniżej
  }

  // Tryb demo (brak kluczy AI lub błąd) — deterministyczny wynik, by gabinet działał.
  const analysis = {
    id: `analysis-${crypto.randomUUID().slice(0, 8)}`,
    recordingId,
    estimatorId: req.user.id,
    score: 86,
    strengths: ['Przejęcie inicjatywy w rozmowie', 'Dopytanie o zakres prac i ryzyka'],
    improve: [
      { text: 'Podaj orientacyjne widełki cenowe podczas rozmowy', sev: 'high' },
      { text: 'Zaproponuj usługę dodatkową (np. frezowanie pnia)', sev: 'mid' },
    ],
    tips: 'Na koniec zawsze umów konkretny termin oględzin i potwierdź go SMS-em.',
    intent: 'wycinka lub pielęgnacja drzewa',
    nextBestAction: 'Umówić oględziny i potwierdzić termin SMS-em',
    source: 'demo',
    createdAt: new Date().toISOString(),
  };
  pushEvent(req.db, req.user, 'valuations', 'call_analysis.ready', analysis);
  await saveDb(req.db);
  res.status(202).json(analysis);
});

// Zgłoszenia od ekipy (brygadzista → menedżer): prośba o sprzęt lub informacja.
// Bez nowej tabeli — tworzy powiadomienie dla roli KIEROWNIK (trafia do jego inboxa).
app.post('/api/requests', async (req, res) => {
  const body = req.body ?? {};
  const reqType = body.type === 'equipment' ? 'equipment' : 'info';
  const now = new Date().toISOString();
  const title = reqType === 'equipment'
    ? `Prośba o sprzęt: ${body.equipment || 'sprzęt'}${body.neededAt ? ' (na ' + body.neededAt + ')' : ''}`
    : `Zgłoszenie od ekipy: ${body.subject || 'informacja'}`;
  const detail = [body.note, body.equipment && ('sprzęt: ' + body.equipment), body.neededAt && ('termin: ' + body.neededAt)].filter(Boolean).join(' · ');
  const notification = {
    id: `req-${crypto.randomUUID().slice(0, 8)}`,
    channel: 'zgloszenie',
    role: 'KIEROWNIK',
    title,
    body: detail || title,
    unread: true,
    createdAt: now,
  };
  req.db.notifications.unshift(notification);
  if (req.user?.branchId) pushEvent(req.db, req.user, `branch:${req.user.branchId}:orders`, 'request.created', { id: notification.id, from: req.user.id, type: reqType, title });
  await saveDb(req.db);
  res.status(201).json({ id: notification.id, type: reqType, title, status: 'wysłane', createdAt: now });
});

app.post('/api/dev/reset', async (req, res) => {
  if (!devResetEnabled) return res.status(404).json({ error: 'Dev reset disabled' });
  if (!devResetSecret) return res.status(503).json({ error: 'ARBOR_DEV_RESET_SECRET is required' });
  const provided = req.get('x-arbor-dev-secret') || req.body?.secret || '';
  if (!safeEqual(provided, devResetSecret)) return res.status(401).json({ error: 'Unauthorized dev reset' });
  await resetDb();
  res.json({ ok: true });
});

// Kontrakt natywnej aplikacji mobilnej (Expo, repo arbor) — tłumaczenie na kanoniczny model danych.
registerMobileCompat(app, {
  visibleOrders, visibleBranches, visibleCrews, visibleUsers, visibleNotifications,
  visibleEquipment, visibleValuations, saveDb, pushEvent, portalTokenFor,
});

// RODO: wymieć dane poza oknem retencji (audyt, powiadomienia, outbox, transkrypty rozmów).
// Przy starcie ORAZ raz na dobę — kontener produkcyjny może działać miesiącami bez restartu.
async function retentionSweep() {
  try {
    const db = loadDb();
    const purged = applyRetention(db);
    const total = Object.values(purged).reduce((sum, count) => sum + count, 0);
    if (total > 0) {
      await saveDb(db);
      console.log(`[retention] usunięto ${total} wpisów poza oknem retencji (${JSON.stringify(purged)})`);
    }
  } catch (err) {
    console.error('retention sweep error', err);
  }
}
await retentionSweep();
setInterval(retentionSweep, 24 * 60 * 60 * 1000).unref();

// W produkcji konta bez hasła nie mogą się logować — ostrzeż operatora przy starcie.
if (process.env.NODE_ENV === 'production') {
  try {
    const db = loadDb();
    const locked = (db.users ?? []).filter((user) => userIsActive(user) && !user.passwordHash);
    if (locked.length) {
      console.warn(`[arbor] UWAGA: ${locked.length} aktywnych kont bez hasła nie zaloguje się w produkcji (${locked.map((u) => u.login).join(', ')}). Ustaw ARBOR_ADMIN_PASSWORD/ARBOR_USERS_PASSWORD przed seedem albo nadaj hasła przez PATCH /api/users/:id/password.`);
    }
  } catch (err) {
    console.error('password audit error', err);
  }
}

// Ostatnia linia obrony routingu: raport do Sentry + odpowiedź JSON
// (domyślny handler Expressa zwraca stronę HTML, łamiąc kontrakt API).
app.use((err, req, res, next) => {
  console.error(`[arbor] nieobsłużony błąd ${req.method} ${req.path}:`, err);
  try { sentry?.captureException?.(err); } catch { /* monitoring nie może wywracać obsługi błędu */ }
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Wewnętrzny błąd serwera' });
});

process.on('unhandledRejection', (reason) => {
  console.error('[arbor] unhandledRejection:', reason);
  try { sentry?.captureException?.(reason); } catch { /* jw. */ }
});

httpServer.listen(port, () => {
  console.log(`Arbor OS API listening on http://127.0.0.1:${port}`);
});

// Graceful shutdown: node jest PID 1 w kontenerze — bez handlera `docker stop` ubija
// in-flight requesty (np. wielosekundowe analizy AI zapisujące bazę na końcu).
function shutdown(signal) {
  console.log(`[arbor] ${signal} — zamykam serwer (drenaż połączeń, max 10 s)`);
  httpServer.close(() => process.exit(0));
  io.close();
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
