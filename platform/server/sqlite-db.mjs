import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import seed from './seed.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, 'data');
mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(path.join(dataDir, 'arbor-os.sqlite'));
db.exec('PRAGMA foreign_keys = ON');

const parse = (value, fallback) => {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
};

const json = (value) => JSON.stringify(value ?? null);

db.exec(`
  CREATE TABLE IF NOT EXISTS branches (
    id TEXT PRIMARY KEY,
    tenantId TEXT,
    name TEXT NOT NULL,
    city TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    createdAt TEXT,
    createdBy TEXT,
    updatedAt TEXT,
    updatedBy TEXT,
    deletedAt TEXT,
    deletedBy TEXT
  );

  CREATE TABLE IF NOT EXISTS tenants (
    id TEXT PRIMARY KEY,
    sortOrder INTEGER NOT NULL DEFAULT 0,
    payloadJson TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS plan_limits (
    id TEXT PRIMARY KEY,
    sortOrder INTEGER NOT NULL DEFAULT 0,
    payloadJson TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tenant_subscriptions (
    id TEXT PRIMARY KEY,
    sortOrder INTEGER NOT NULL DEFAULT 0,
    payloadJson TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS billing_payments (
    id TEXT PRIMARY KEY,
    sortOrder INTEGER NOT NULL DEFAULT 0,
    payloadJson TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS integration_settings (
    id TEXT PRIMARY KEY,
    sortOrder INTEGER NOT NULL DEFAULT 0,
    payloadJson TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS communications (
    id TEXT PRIMARY KEY,
    sortOrder INTEGER NOT NULL DEFAULT 0,
    payloadJson TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tree_assets (
    id TEXT PRIMARY KEY,
    sortOrder INTEGER NOT NULL DEFAULT 0,
    payloadJson TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS softphone_presence (
    id TEXT PRIMARY KEY,
    sortOrder INTEGER NOT NULL DEFAULT 0,
    payloadJson TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS ai_prompts (
    id TEXT PRIMARY KEY,
    sortOrder INTEGER NOT NULL DEFAULT 0,
    payloadJson TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS ai_prompt_versions (
    id TEXT PRIMARY KEY,
    sortOrder INTEGER NOT NULL DEFAULT 0,
    payloadJson TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS ai_bot_sessions (
    id TEXT PRIMARY KEY,
    sortOrder INTEGER NOT NULL DEFAULT 0,
    payloadJson TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS ai_receptionist_settings (
    id TEXT PRIMARY KEY,
    sortOrder INTEGER NOT NULL DEFAULT 0,
    payloadJson TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS workflows (
    id TEXT PRIMARY KEY,
    sortOrder INTEGER NOT NULL DEFAULT 0,
    payloadJson TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS workflow_runs (
    id TEXT PRIMARY KEY,
    sortOrder INTEGER NOT NULL DEFAULT 0,
    payloadJson TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    sortOrder INTEGER NOT NULL DEFAULT 0,
    payloadJson TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS purchase_orders (
    id TEXT PRIMARY KEY,
    sortOrder INTEGER NOT NULL DEFAULT 0,
    payloadJson TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS module_configs (
    id TEXT PRIMARY KEY,
    sortOrder INTEGER NOT NULL DEFAULT 0,
    payloadJson TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS branch_delegations (
    id TEXT PRIMARY KEY,
    sortOrder INTEGER NOT NULL DEFAULT 0,
    payloadJson TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS role_permissions (
    id TEXT PRIMARY KEY,
    sortOrder INTEGER NOT NULL DEFAULT 0,
    payloadJson TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS document_templates (
    id TEXT PRIMARY KEY,
    sortOrder INTEGER NOT NULL DEFAULT 0,
    payloadJson TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS generated_documents (
    id TEXT PRIMARY KEY,
    sortOrder INTEGER NOT NULL DEFAULT 0,
    payloadJson TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS job_positions (
    id TEXT PRIMARY KEY,
    sortOrder INTEGER NOT NULL DEFAULT 0,
    payloadJson TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS document_requirements (
    id TEXT PRIMARY KEY,
    sortOrder INTEGER NOT NULL DEFAULT 0,
    payloadJson TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS employee_contracts (
    id TEXT PRIMARY KEY,
    sortOrder INTEGER NOT NULL DEFAULT 0,
    payloadJson TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS trainings (
    id TEXT PRIMARY KEY,
    sortOrder INTEGER NOT NULL DEFAULT 0,
    payloadJson TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS medical_exams (
    id TEXT PRIMARY KEY,
    sortOrder INTEGER NOT NULL DEFAULT 0,
    payloadJson TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS certifications (
    id TEXT PRIMARY KEY,
    sortOrder INTEGER NOT NULL DEFAULT 0,
    payloadJson TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    login TEXT NOT NULL UNIQUE,
    firstName TEXT NOT NULL,
    lastName TEXT NOT NULL,
    role TEXT NOT NULL,
    branchId TEXT NOT NULL,
    teamId TEXT,
    passwordHash TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    createdAt TEXT,
    createdBy TEXT,
    updatedAt TEXT,
    updatedBy TEXT,
    deletedAt TEXT,
    deletedBy TEXT,
    FOREIGN KEY (branchId) REFERENCES branches(id)
  );

  CREATE TABLE IF NOT EXISTS clients (
    id TEXT PRIMARY KEY,
    branchId TEXT NOT NULL,
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    email TEXT NOT NULL,
    address TEXT NOT NULL,
    ltv INTEGER NOT NULL,
    pipelineStage TEXT NOT NULL DEFAULT 'lead',
    tagsJson TEXT NOT NULL,
    customFieldsJson TEXT NOT NULL,
    createdAt TEXT,
    createdBy TEXT,
    updatedAt TEXT,
    updatedBy TEXT,
    deletedAt TEXT,
    deletedBy TEXT,
    FOREIGN KEY (branchId) REFERENCES branches(id)
  );

  CREATE TABLE IF NOT EXISTS crews (
    id TEXT PRIMARY KEY,
    branchId TEXT NOT NULL,
    name TEXT NOT NULL,
    leaderId TEXT NOT NULL,
    membersJson TEXT NOT NULL,
    utilization INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    createdAt TEXT,
    createdBy TEXT,
    updatedAt TEXT,
    updatedBy TEXT,
    deletedAt TEXT,
    deletedBy TEXT,
    FOREIGN KEY (branchId) REFERENCES branches(id)
  );

  CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    branchId TEXT NOT NULL,
    clientId TEXT NOT NULL,
    teamId TEXT,
    estimatorId TEXT,
    address TEXT NOT NULL,
    city TEXT NOT NULL,
    type TEXT NOT NULL,
    status TEXT NOT NULL,
    priority TEXT NOT NULL,
    scheduledAt TEXT NOT NULL,
    inspectionAt TEXT,
    value INTEGER NOT NULL,
    margin INTEGER NOT NULL,
    timelineJson TEXT NOT NULL,
    checklistJson TEXT NOT NULL,
    createdAt TEXT,
    createdBy TEXT,
    updatedAt TEXT,
    updatedBy TEXT,
    deletedAt TEXT,
    deletedBy TEXT,
    FOREIGN KEY (branchId) REFERENCES branches(id),
    FOREIGN KEY (clientId) REFERENCES clients(id),
    FOREIGN KEY (teamId) REFERENCES crews(id)
  );

  CREATE TABLE IF NOT EXISTS valuations (
    id TEXT PRIMARY KEY,
    orderId TEXT NOT NULL UNIQUE,
    clientId TEXT NOT NULL,
    estimatorId TEXT NOT NULL,
    status TEXT NOT NULL,
    inspectionAt TEXT NOT NULL,
    totalNet INTEGER NOT NULL,
    margin INTEGER NOT NULL,
    mediaJson TEXT NOT NULL,
    notes TEXT NOT NULL,
    itemsJson TEXT NOT NULL,
    createdAt TEXT,
    createdBy TEXT,
    updatedAt TEXT,
    updatedBy TEXT,
    deletedAt TEXT,
    deletedBy TEXT,
    FOREIGN KEY (orderId) REFERENCES orders(id),
    FOREIGN KEY (clientId) REFERENCES clients(id)
  );

  CREATE TABLE IF NOT EXISTS equipment (
    id TEXT PRIMARY KEY,
    branchId TEXT NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    status TEXT NOT NULL,
    risk TEXT NOT NULL,
    reviewDue TEXT NOT NULL,
    FOREIGN KEY (branchId) REFERENCES branches(id)
  );

  CREATE TABLE IF NOT EXISTS equipment_reservations (
    id TEXT PRIMARY KEY,
    equipmentId TEXT NOT NULL,
    orderId TEXT NOT NULL,
    branchId TEXT NOT NULL,
    startsAt TEXT NOT NULL,
    endsAt TEXT NOT NULL,
    status TEXT NOT NULL,
    createdBy TEXT NOT NULL,
    createdAt TEXT NOT NULL,
    FOREIGN KEY (equipmentId) REFERENCES equipment(id),
    FOREIGN KEY (orderId) REFERENCES orders(id),
    FOREIGN KEY (branchId) REFERENCES branches(id)
  );

  CREATE TABLE IF NOT EXISTS warehouse_items (
    id TEXT PRIMARY KEY,
    branchId TEXT NOT NULL,
    name TEXT NOT NULL,
    unit TEXT NOT NULL,
    stock INTEGER NOT NULL,
    minStock INTEGER NOT NULL,
    supplier TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    createdAt TEXT,
    createdBy TEXT,
    updatedAt TEXT NOT NULL,
    updatedBy TEXT,
    deletedAt TEXT,
    deletedBy TEXT,
    FOREIGN KEY (branchId) REFERENCES branches(id)
  );

  CREATE TABLE IF NOT EXISTS warehouse_movements (
    id TEXT PRIMARY KEY,
    itemId TEXT NOT NULL,
    branchId TEXT NOT NULL,
    orderId TEXT,
    type TEXT NOT NULL,
    qty INTEGER NOT NULL,
    note TEXT NOT NULL,
    createdBy TEXT NOT NULL,
    createdAt TEXT NOT NULL,
    FOREIGN KEY (itemId) REFERENCES warehouse_items(id),
    FOREIGN KEY (branchId) REFERENCES branches(id)
  );

  CREATE TABLE IF NOT EXISTS invoices (
    id TEXT PRIMARY KEY,
    number TEXT NOT NULL UNIQUE,
    orderId TEXT NOT NULL,
    clientId TEXT NOT NULL,
    net INTEGER NOT NULL,
    dueAt TEXT NOT NULL,
    status TEXT NOT NULL,
    paidAt TEXT,
    createdAt TEXT,
    createdBy TEXT,
    updatedAt TEXT,
    updatedBy TEXT,
    deletedAt TEXT,
    deletedBy TEXT,
    FOREIGN KEY (clientId) REFERENCES clients(id)
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    tenantId TEXT,
    channel TEXT NOT NULL,
    role TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    unread INTEGER NOT NULL,
    createdAt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS audit_events (
    id TEXT PRIMARY KEY,
    tenantId TEXT,
    actorId TEXT NOT NULL,
    action TEXT NOT NULL,
    entity TEXT NOT NULL,
    at TEXT NOT NULL,
    payload TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS portal_state (
    id TEXT PRIMARY KEY,
    accepted INTEGER NOT NULL,
    paid INTEGER NOT NULL,
    rating INTEGER NOT NULL,
    messagesJson TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS offline_queue (
    id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    createdAt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS outbox (
    id TEXT PRIMARY KEY,
    tenantId TEXT,
    actorId TEXT NOT NULL,
    channel TEXT NOT NULL,
    eventName TEXT NOT NULL,
    payloadJson TEXT NOT NULL,
    createdAt TEXT NOT NULL,
    deliveredAt TEXT
  );
`);

function run(statement, params = {}) {
  db.prepare(statement).run(params);
}

function all(statement, params = {}) {
  return db.prepare(statement).all(params);
}

function get(statement, params = {}) {
  return db.prepare(statement).get(params);
}

function ensureColumn(table, column, definition) {
  const columns = all(`PRAGMA table_info(${table})`).map((next) => next.name);
  if (!columns.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

ensureColumn('users', 'passwordHash', 'TEXT');
ensureColumn('users', 'status', "TEXT NOT NULL DEFAULT 'active'");
ensureColumn('users', 'createdAt', 'TEXT');
ensureColumn('users', 'createdBy', 'TEXT');
ensureColumn('users', 'updatedAt', 'TEXT');
ensureColumn('users', 'updatedBy', 'TEXT');
ensureColumn('users', 'deletedAt', 'TEXT');
ensureColumn('users', 'deletedBy', 'TEXT');
ensureColumn('branches', 'tenantId', 'TEXT');
ensureColumn('branches', 'status', "TEXT NOT NULL DEFAULT 'active'");
ensureColumn('branches', 'createdAt', 'TEXT');
ensureColumn('branches', 'createdBy', 'TEXT');
ensureColumn('branches', 'updatedAt', 'TEXT');
ensureColumn('branches', 'updatedBy', 'TEXT');
ensureColumn('branches', 'deletedAt', 'TEXT');
ensureColumn('branches', 'deletedBy', 'TEXT');
ensureColumn('notifications', 'tenantId', 'TEXT');
ensureColumn('audit_events', 'tenantId', 'TEXT');
ensureColumn('outbox', 'tenantId', 'TEXT');
ensureColumn('warehouse_items', 'status', "TEXT NOT NULL DEFAULT 'active'");
ensureColumn('warehouse_items', 'createdAt', 'TEXT');
ensureColumn('warehouse_items', 'createdBy', 'TEXT');
ensureColumn('warehouse_items', 'updatedBy', 'TEXT');
ensureColumn('warehouse_items', 'deletedAt', 'TEXT');
ensureColumn('warehouse_items', 'deletedBy', 'TEXT');
ensureColumn('clients', 'createdAt', 'TEXT');
ensureColumn('clients', 'createdBy', 'TEXT');
ensureColumn('clients', 'updatedAt', 'TEXT');
ensureColumn('clients', 'updatedBy', 'TEXT');
ensureColumn('clients', 'deletedAt', 'TEXT');
ensureColumn('clients', 'deletedBy', 'TEXT');
ensureColumn('clients', 'pipelineStage', "TEXT NOT NULL DEFAULT 'lead'");
ensureColumn('orders', 'createdAt', 'TEXT');
ensureColumn('orders', 'createdBy', 'TEXT');
ensureColumn('orders', 'updatedAt', 'TEXT');
ensureColumn('orders', 'updatedBy', 'TEXT');
ensureColumn('orders', 'deletedAt', 'TEXT');
ensureColumn('orders', 'deletedBy', 'TEXT');
ensureColumn('orders', 'portalTokenVersion', 'INTEGER');
ensureColumn('invoices', 'createdAt', 'TEXT');
ensureColumn('invoices', 'createdBy', 'TEXT');
ensureColumn('invoices', 'updatedAt', 'TEXT');
ensureColumn('invoices', 'updatedBy', 'TEXT');
ensureColumn('invoices', 'deletedAt', 'TEXT');
ensureColumn('invoices', 'deletedBy', 'TEXT');
ensureColumn('crews', 'status', "TEXT NOT NULL DEFAULT 'active'");
ensureColumn('crews', 'createdAt', 'TEXT');
ensureColumn('crews', 'createdBy', 'TEXT');
ensureColumn('crews', 'updatedAt', 'TEXT');
ensureColumn('crews', 'updatedBy', 'TEXT');
ensureColumn('crews', 'deletedAt', 'TEXT');
ensureColumn('crews', 'deletedBy', 'TEXT');
ensureColumn('valuations', 'createdAt', 'TEXT');
ensureColumn('valuations', 'createdBy', 'TEXT');
ensureColumn('valuations', 'updatedAt', 'TEXT');
ensureColumn('valuations', 'updatedBy', 'TEXT');
ensureColumn('valuations', 'deletedAt', 'TEXT');
ensureColumn('valuations', 'deletedBy', 'TEXT');

function insertMany(table, rows, columns) {
  if (!rows.length) return;
  const placeholders = columns.map((column) => `$${column}`).join(', ');
  const statement = db.prepare(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`);
  rows.forEach((row) => statement.run(Object.fromEntries(columns.map((column) => [`$${column}`, row[column] ?? null]))));
}

function insertJsonRows(table, rows = []) {
  if (!rows.length) return;
  const statement = db.prepare(`INSERT INTO ${table} (id, sortOrder, payloadJson) VALUES ($id, $sortOrder, $payloadJson)`);
  rows.forEach((row, index) => statement.run({ $id: row.id, $sortOrder: index, $payloadJson: json(row) }));
}

function loadJsonRows(table, fallback = []) {
  const rows = all(`SELECT payloadJson FROM ${table} ORDER BY sortOrder, id`);
  const parsed = rows.map((row) => parse(row.payloadJson, null)).filter(Boolean);
  return parsed.length ? parsed : fallback;
}

export function saveDb(state) {
  db.exec('BEGIN IMMEDIATE TRANSACTION');
  try {
    [
      'outbox',
      'offline_queue',
      'portal_state',
      'job_positions',
      'certifications',
      'medical_exams',
      'trainings',
      'employee_contracts',
      'document_requirements',
      'generated_documents',
      'document_templates',
      'role_permissions',
      'branch_delegations',
      'module_configs',
      'tasks',
      'purchase_orders',
      'workflow_runs',
      'workflows',
      'ai_receptionist_settings',
      'ai_bot_sessions',
      'ai_prompt_versions',
      'ai_prompts',
      'softphone_presence',
      'communications',
      'tree_assets',
      'integration_settings',
      'billing_payments',
      'tenant_subscriptions',
      'plan_limits',
      'tenants',
      'audit_events',
      'notifications',
      'invoices',
      'valuations',
      'warehouse_movements',
      'warehouse_items',
      'equipment_reservations',
      'orders',
      'equipment',
      'crews',
      'clients',
      'users',
      'branches',
    ].forEach((table) => db.exec(`DELETE FROM ${table}`));

    insertJsonRows('tenants', state.tenants ?? []);
    insertJsonRows('plan_limits', state.planLimits ?? []);
    insertJsonRows('tenant_subscriptions', state.tenantSubscriptions ?? []);
    insertJsonRows('billing_payments', state.billingPayments ?? []);
    insertJsonRows('integration_settings', state.integrationSettings ?? []);
    insertJsonRows('communications', state.communications ?? []);
    insertJsonRows('tree_assets', state.treeAssets ?? []);
    insertJsonRows('softphone_presence', state.softphonePresence ?? []);
    insertJsonRows('ai_prompts', state.aiPrompts ?? []);
    insertJsonRows('ai_prompt_versions', state.aiPromptVersions ?? []);
    insertJsonRows('ai_bot_sessions', state.aiBotSessions ?? []);
    insertJsonRows(
      'ai_receptionist_settings',
      Array.isArray(state.aiReceptionistSettings)
        ? state.aiReceptionistSettings
        : state.aiReceptionistSettings
          ? [state.aiReceptionistSettings]
          : [],
    );
    insertJsonRows('workflows', state.workflows ?? []);
    insertJsonRows('workflow_runs', state.workflowRuns ?? []);
    insertJsonRows('tasks', state.tasks ?? []);
    insertJsonRows('purchase_orders', state.purchaseOrders ?? []);
    insertJsonRows('module_configs', state.moduleConfigs ?? []);
    insertJsonRows('branch_delegations', state.branchDelegations ?? []);
    insertJsonRows('role_permissions', state.rolePermissions ?? []);
    insertJsonRows('document_templates', state.documentTemplates ?? []);
    insertJsonRows('generated_documents', state.generatedDocuments ?? []);
    insertJsonRows('job_positions', state.jobPositions ?? []);
    insertJsonRows('document_requirements', state.documentRequirements ?? []);
    insertJsonRows('employee_contracts', state.employeeContracts ?? []);
    insertJsonRows('trainings', state.trainings ?? []);
    insertJsonRows('medical_exams', state.medicalExams ?? []);
    insertJsonRows('certifications', state.certifications ?? []);

    insertMany('branches', state.branches.map((branch) => ({
      ...branch,
      tenantId: branch.tenantId ?? state.tenants?.[0]?.id ?? null,
      status: branch.status ?? 'active',
      createdAt: branch.createdAt ?? null,
      createdBy: branch.createdBy ?? null,
      updatedAt: branch.updatedAt ?? null,
      updatedBy: branch.updatedBy ?? null,
      deletedAt: branch.deletedAt ?? null,
      deletedBy: branch.deletedBy ?? null,
    })), ['id', 'tenantId', 'name', 'city', 'status', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy', 'deletedAt', 'deletedBy']);
    insertMany('users', state.users.map((user) => ({
      ...user,
      teamId: user.teamId ?? null,
      passwordHash: user.passwordHash ?? null,
      status: user.status ?? 'active',
      createdAt: user.createdAt ?? null,
      createdBy: user.createdBy ?? null,
      updatedAt: user.updatedAt ?? null,
      updatedBy: user.updatedBy ?? null,
      deletedAt: user.deletedAt ?? null,
      deletedBy: user.deletedBy ?? null,
    })), [
      'id', 'login', 'firstName', 'lastName', 'role', 'branchId', 'teamId', 'passwordHash',
      'status', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy', 'deletedAt', 'deletedBy',
    ]);
    insertMany('clients', state.clients.map((client) => ({
      ...client,
      branchId: client.branchId ?? 'krk',
      pipelineStage: client.pipelineStage ?? 'lead',
      tagsJson: json(client.tags),
      customFieldsJson: json(client.customFields),
      createdAt: client.createdAt ?? null,
      createdBy: client.createdBy ?? null,
      updatedAt: client.updatedAt ?? null,
      updatedBy: client.updatedBy ?? null,
      deletedAt: client.deletedAt ?? null,
      deletedBy: client.deletedBy ?? null,
    })), ['id', 'branchId', 'name', 'phone', 'email', 'address', 'ltv', 'pipelineStage', 'tagsJson', 'customFieldsJson', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy', 'deletedAt', 'deletedBy']);
    insertMany('crews', state.crews.map((crew) => ({
      ...crew,
      membersJson: json(crew.members),
      status: crew.status ?? 'active',
      createdAt: crew.createdAt ?? null,
      createdBy: crew.createdBy ?? null,
      updatedAt: crew.updatedAt ?? null,
      updatedBy: crew.updatedBy ?? null,
      deletedAt: crew.deletedAt ?? null,
      deletedBy: crew.deletedBy ?? null,
    })), ['id', 'branchId', 'name', 'leaderId', 'membersJson', 'utilization', 'status', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy', 'deletedAt', 'deletedBy']);
    insertMany('equipment', state.equipment, ['id', 'branchId', 'name', 'type', 'status', 'risk', 'reviewDue']);
    insertMany('warehouse_items', (state.warehouseItems ?? []).map((item) => ({
      ...item,
      status: item.status ?? 'active',
      createdAt: item.createdAt ?? item.updatedAt ?? new Date().toISOString(),
      createdBy: item.createdBy ?? null,
      updatedAt: item.updatedAt ?? new Date().toISOString(),
      updatedBy: item.updatedBy ?? null,
      deletedAt: item.deletedAt ?? null,
      deletedBy: item.deletedBy ?? null,
    })), ['id', 'branchId', 'name', 'unit', 'stock', 'minStock', 'supplier', 'status', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy', 'deletedAt', 'deletedBy']);
    insertMany('warehouse_movements', (state.warehouseMovements ?? []).map((movement) => ({
      ...movement,
      orderId: movement.orderId ?? null,
      note: movement.note ?? '',
      createdAt: movement.createdAt ?? new Date().toISOString(),
    })), ['id', 'itemId', 'branchId', 'orderId', 'type', 'qty', 'note', 'createdBy', 'createdAt']);
    insertMany('orders', state.orders.map((order) => ({
      ...order,
      teamId: order.teamId ?? null,
      estimatorId: order.estimatorId ?? null,
      inspectionAt: order.inspectionAt ?? null,
      timelineJson: json(order.timeline),
      checklistJson: json(order.checklist),
      createdAt: order.createdAt ?? null,
      createdBy: order.createdBy ?? null,
      updatedAt: order.updatedAt ?? null,
      updatedBy: order.updatedBy ?? null,
      deletedAt: order.deletedAt ?? null,
      deletedBy: order.deletedBy ?? null,
      portalTokenVersion: order.portalTokenVersion ?? 1,
    })), ['id', 'branchId', 'clientId', 'teamId', 'estimatorId', 'address', 'city', 'type', 'status', 'priority', 'scheduledAt', 'inspectionAt', 'value', 'margin', 'timelineJson', 'checklistJson', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy', 'deletedAt', 'deletedBy', 'portalTokenVersion']);
    insertMany('valuations', state.valuations.map((valuation) => ({
      ...valuation,
      mediaJson: json(valuation.media),
      itemsJson: json(valuation.items),
      createdAt: valuation.createdAt ?? null,
      createdBy: valuation.createdBy ?? null,
      updatedAt: valuation.updatedAt ?? null,
      updatedBy: valuation.updatedBy ?? null,
      deletedAt: valuation.deletedAt ?? null,
      deletedBy: valuation.deletedBy ?? null,
    })), ['id', 'orderId', 'clientId', 'estimatorId', 'status', 'inspectionAt', 'totalNet', 'margin', 'mediaJson', 'notes', 'itemsJson', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy', 'deletedAt', 'deletedBy']);
    insertMany('invoices', state.invoices.map((invoice) => ({
      ...invoice,
      paidAt: invoice.paidAt ?? null,
      createdAt: invoice.createdAt ?? null,
      createdBy: invoice.createdBy ?? null,
      updatedAt: invoice.updatedAt ?? null,
      updatedBy: invoice.updatedBy ?? null,
      deletedAt: invoice.deletedAt ?? null,
      deletedBy: invoice.deletedBy ?? null,
    })), ['id', 'number', 'orderId', 'clientId', 'net', 'dueAt', 'status', 'paidAt', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy', 'deletedAt', 'deletedBy']);
    insertMany('equipment_reservations', (state.equipmentReservations ?? []).map((reservation) => ({
      ...reservation,
      status: reservation.status ?? 'active',
      createdAt: reservation.createdAt ?? new Date().toISOString(),
    })), ['id', 'equipmentId', 'orderId', 'branchId', 'startsAt', 'endsAt', 'status', 'createdBy', 'createdAt']);
    insertMany('notifications', state.notifications.map((notification) => ({ ...notification, tenantId: notification.tenantId ?? null, unread: notification.unread ? 1 : 0 })), ['id', 'tenantId', 'channel', 'role', 'title', 'body', 'unread', 'createdAt']);
    insertMany('audit_events', state.auditEvents.map((event) => ({ ...event, tenantId: event.tenantId ?? null })), ['id', 'tenantId', 'actorId', 'action', 'entity', 'at', 'payload']);
    const portalStates = state.portalStates?.length
      ? state.portalStates
      : [{ id: 'singleton', ...(state.portal ?? seed.portal) }];
    insertMany('portal_state', portalStates.map((portal) => ({
      id: portal.id,
      accepted: portal.accepted ? 1 : 0,
      paid: portal.paid ? 1 : 0,
      rating: portal.rating ?? 0,
      messagesJson: json(portal.messages ?? []),
    })), ['id', 'accepted', 'paid', 'rating', 'messagesJson']);
    insertMany('offline_queue', state.offlineQueue.map((label, index) => ({ id: `offline-${index}-${crypto.randomUUID()}`, label, createdAt: new Date().toISOString() })), ['id', 'label', 'createdAt']);
    insertMany('outbox', state.outbox.map((event) => ({
      ...event,
      tenantId: event.tenantId ?? null,
      payloadJson: json(event.payload),
      deliveredAt: event.deliveredAt ?? null,
    })), ['id', 'tenantId', 'actorId', 'channel', 'eventName', 'payloadJson', 'createdAt', 'deliveredAt']);

    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function resetDb() {
  saveDb(seed);
}

export function ensureSeeded() {
  const count = get('SELECT COUNT(*) as count FROM branches')?.count ?? 0;
  if (count === 0) resetDb();
}

export function loadDb() {
  ensureSeeded();
  const portal = get('SELECT * FROM portal_state WHERE id = $id', { $id: 'singleton' });
  const portalStates = all('SELECT * FROM portal_state ORDER BY id').map((next) => ({
    id: next.id,
    accepted: Boolean(next.accepted),
    paid: Boolean(next.paid),
    rating: next.rating,
    messages: parse(next.messagesJson, []),
  }));
  return {
    tenants: loadJsonRows('tenants', seed.tenants ?? []),
    planLimits: loadJsonRows('plan_limits', seed.planLimits ?? []),
    tenantSubscriptions: loadJsonRows('tenant_subscriptions', seed.tenantSubscriptions ?? []),
    billingPayments: loadJsonRows('billing_payments', seed.billingPayments ?? []),
    integrationSettings: loadJsonRows('integration_settings', seed.integrationSettings ?? []),
    branches: all('SELECT * FROM branches ORDER BY id').map((branch) => ({
      ...branch,
      tenantId: branch.tenantId ?? undefined,
      status: branch.status ?? 'active',
      createdAt: branch.createdAt ?? undefined,
      createdBy: branch.createdBy ?? undefined,
      updatedAt: branch.updatedAt ?? undefined,
      updatedBy: branch.updatedBy ?? undefined,
      deletedAt: branch.deletedAt ?? undefined,
      deletedBy: branch.deletedBy ?? undefined,
    })),
    users: all('SELECT * FROM users ORDER BY id').map((user) => ({
      ...user,
      teamId: user.teamId ?? undefined,
      passwordHash: user.passwordHash ?? undefined,
      status: user.status ?? 'active',
      createdAt: user.createdAt ?? undefined,
      createdBy: user.createdBy ?? undefined,
      updatedAt: user.updatedAt ?? undefined,
      updatedBy: user.updatedBy ?? undefined,
      deletedAt: user.deletedAt ?? undefined,
      deletedBy: user.deletedBy ?? undefined,
    })),
    clients: all('SELECT * FROM clients ORDER BY id').map(({ tagsJson, customFieldsJson, ...client }) => ({
      ...client,
      tags: parse(tagsJson, []),
      customFields: parse(customFieldsJson, {}),
      pipelineStage: client.pipelineStage ?? 'lead',
      createdAt: client.createdAt ?? undefined,
      createdBy: client.createdBy ?? undefined,
      updatedAt: client.updatedAt ?? undefined,
      updatedBy: client.updatedBy ?? undefined,
      deletedAt: client.deletedAt ?? undefined,
      deletedBy: client.deletedBy ?? undefined,
    })),
    crews: all('SELECT * FROM crews ORDER BY id').map(({ membersJson, ...crew }) => ({
      ...crew,
      members: parse(membersJson, []),
      status: crew.status ?? 'active',
      createdAt: crew.createdAt ?? undefined,
      createdBy: crew.createdBy ?? undefined,
      updatedAt: crew.updatedAt ?? undefined,
      updatedBy: crew.updatedBy ?? undefined,
      deletedAt: crew.deletedAt ?? undefined,
      deletedBy: crew.deletedBy ?? undefined,
    })),
    orders: all('SELECT * FROM orders ORDER BY scheduledAt').map(({ timelineJson, checklistJson, ...order }) => ({
      ...order,
      teamId: order.teamId ?? undefined,
      estimatorId: order.estimatorId ?? undefined,
      inspectionAt: order.inspectionAt ?? undefined,
      createdAt: order.createdAt ?? undefined,
      createdBy: order.createdBy ?? undefined,
      updatedAt: order.updatedAt ?? undefined,
      updatedBy: order.updatedBy ?? undefined,
      deletedAt: order.deletedAt ?? undefined,
      deletedBy: order.deletedBy ?? undefined,
      timeline: parse(timelineJson, []),
      checklist: parse(checklistJson, []),
    })),
    valuations: all('SELECT * FROM valuations ORDER BY inspectionAt').map(({ mediaJson, itemsJson, ...valuation }) => ({
      ...valuation,
      media: parse(mediaJson, []),
      items: parse(itemsJson, []),
      createdAt: valuation.createdAt ?? undefined,
      createdBy: valuation.createdBy ?? undefined,
      updatedAt: valuation.updatedAt ?? undefined,
      updatedBy: valuation.updatedBy ?? undefined,
      deletedAt: valuation.deletedAt ?? undefined,
      deletedBy: valuation.deletedBy ?? undefined,
    })),
    equipment: all('SELECT * FROM equipment ORDER BY id'),
    equipmentReservations: all('SELECT * FROM equipment_reservations ORDER BY startsAt'),
    warehouseItems: all('SELECT * FROM warehouse_items ORDER BY name'),
    warehouseMovements: all('SELECT * FROM warehouse_movements ORDER BY createdAt DESC'),
    invoices: all('SELECT * FROM invoices ORDER BY dueAt').map((invoice) => ({
      ...invoice,
      paidAt: invoice.paidAt ?? undefined,
      createdAt: invoice.createdAt ?? undefined,
      createdBy: invoice.createdBy ?? undefined,
      updatedAt: invoice.updatedAt ?? undefined,
      updatedBy: invoice.updatedBy ?? undefined,
      deletedAt: invoice.deletedAt ?? undefined,
      deletedBy: invoice.deletedBy ?? undefined,
    })),
    notifications: all('SELECT * FROM notifications ORDER BY createdAt DESC').map((notification) => ({ ...notification, unread: Boolean(notification.unread) })),
    auditEvents: all('SELECT * FROM audit_events ORDER BY at DESC'),
    communications: loadJsonRows('communications', seed.communications ?? []),
    treeAssets: loadJsonRows('tree_assets', seed.treeAssets ?? []),
    purchaseOrders: loadJsonRows('purchase_orders', seed.purchaseOrders ?? []),
    softphonePresence: loadJsonRows('softphone_presence', seed.softphonePresence ?? []),
    aiPrompts: loadJsonRows('ai_prompts', seed.aiPrompts ?? []),
    aiPromptVersions: loadJsonRows('ai_prompt_versions', seed.aiPromptVersions ?? []),
    aiBotSessions: loadJsonRows('ai_bot_sessions', seed.aiBotSessions ?? []),
    aiReceptionistSettings: loadJsonRows(
      'ai_receptionist_settings',
      Array.isArray(seed.aiReceptionistSettings)
        ? seed.aiReceptionistSettings
        : seed.aiReceptionistSettings
          ? [seed.aiReceptionistSettings]
          : [],
    ),
    workflows: loadJsonRows('workflows', seed.workflows ?? []),
    workflowRuns: loadJsonRows('workflow_runs', seed.workflowRuns ?? []),
    tasks: loadJsonRows('tasks', seed.tasks ?? []),
    moduleConfigs: loadJsonRows('module_configs', seed.moduleConfigs ?? []),
    branchDelegations: loadJsonRows('branch_delegations', seed.branchDelegations ?? []),
    rolePermissions: loadJsonRows('role_permissions', seed.rolePermissions ?? []),
    documentTemplates: loadJsonRows('document_templates', seed.documentTemplates ?? []),
    generatedDocuments: loadJsonRows('generated_documents', seed.generatedDocuments ?? []),
    jobPositions: loadJsonRows('job_positions', seed.jobPositions ?? []),
    documentRequirements: loadJsonRows('document_requirements', seed.documentRequirements ?? []),
    employeeContracts: loadJsonRows('employee_contracts', seed.employeeContracts ?? []),
    trainings: loadJsonRows('trainings', seed.trainings ?? []),
    medicalExams: loadJsonRows('medical_exams', seed.medicalExams ?? []),
    certifications: loadJsonRows('certifications', seed.certifications ?? []),
    portal: portal
      ? {
          accepted: Boolean(portal.accepted),
          paid: Boolean(portal.paid),
          rating: portal.rating,
          messages: parse(portal.messagesJson, []),
        }
      : seed.portal,
    portalStates,
    offlineQueue: all('SELECT * FROM offline_queue ORDER BY createdAt').map((item) => item.label),
    outbox: all('SELECT * FROM outbox ORDER BY createdAt DESC LIMIT 50').map(({ payloadJson, ...event }) => ({
      ...event,
      payload: parse(payloadJson, {}),
      deliveredAt: event.deliveredAt ?? null,
    })),
  };
}
