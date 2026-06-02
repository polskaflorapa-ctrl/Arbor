const express = require('express');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const pool = require('../config/database');
const logger = require('../config/logger');
const { authMiddleware, isSalesDirector, isDyrektorOrAdmin } = require('../middleware/auth');
const { env } = require('../config/env');
const { validateBody, validateParams, validateQuery } = require('../middleware/validate');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { z } = require('zod');
const { TASK_ACCESS_DENIED, VALIDATION_FAILED } = require('../constants/error-codes');
const {
  buildKommoTaskPayload,
  ensureKommoTaskSyncQueue,
  getKommoTaskSyncQueueRow,
  markKommoTaskSyncSuccess,
  postKommoWebhook,
  recordKommoTaskSyncFailure,
  syncTaskToKommo,
  kommoWebhookConfigured,
} = require('../services/kommo');
const { pushToUser } = require('./notifications');
const {
  validateClientPayment,
  grossForTask,
  netSettlementValue,
  settlementCalcDetail,
  countTaskFinishPhotos,
  FINISH_PHOTO_MIN,
  CASH_COLLECTION_NOTE_PCT,
  isCashCollectionNoteMissing,
} = require('../services/taskSettlement');
const { tryAutoTeamDayCloseAfterTaskFinish } = require('../services/payrollTeamDay');
const { sendSmsOptional } = require('../services/twilioSms');
const { sendSmsGateway } = require('../services/smsGateway');
const { renderSmsStatusTemplate } = require('../services/smsTemplates');
const { getTaskFinishCostSuggestions, validateFinishCostPayload } = require('../services/taskFinishCosts');
const { assertTeamCompetenciesForTask } = require('../services/taskCompetencies');
const { tryConsumeIdempotencyKey } = require('../lib/idempotency');
const { getTeamBusyRanges, planRangeConflicts } = require('../services/taskScheduling');
const { assertTeamAvailableForBranch, assertEstimatorAvailableForBranch } = require('../services/branchResources');
const { uploadsPath } = require('../config/uploadPaths');
const {
  cleanupLocalFile,
  cleanupTemporaryUpload,
  deleteStoredUpload,
  deleteUploadByUrl,
  persistUploadedFile,
} = require('../services/upload-storage');

const router = express.Router();

function generatePublicStatusToken() {
  return crypto.randomBytes(24).toString('base64url');
}

function publicStatusBaseUrl() {
  const base = String(env.PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
  return base || null;
}

function publicStatusUrl(token) {
  const base = publicStatusBaseUrl();
  return base && token ? `${base}/track/${token}` : null;
}

function publicTaskTimeWindowUrl(token) {
  const base = publicStatusBaseUrl();
  return base && token ? `${base}/api/tasks/time-window/${token}` : null;
}

function sendCompetencyBlock(res, result) {
  return res.status(result.status || 409).json(result.payload || {
    error: 'Ekipa nie ma wymaganych kompetencji.',
    code: 'TEAM_COMPETENCY_MISSING',
  });
}

async function ensurePublicStatusLinkTables(db = pool) {
  await db.query('ALTER TABLE tasks ADD COLUMN IF NOT EXISTS link_statusowy_token VARCHAR(64)');
  await db.query(
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_link_statusowy_token ON tasks(link_statusowy_token) WHERE link_statusowy_token IS NOT NULL'
  );
  await db.query(`
    CREATE TABLE IF NOT EXISTS task_public_status_events (
      id SERIAL PRIMARY KEY,
      task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      from_status VARCHAR(64),
      to_status VARCHAR(64) NOT NULL,
      source VARCHAR(40) NOT NULL DEFAULT 'system',
      note TEXT,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.query(
    'CREATE INDEX IF NOT EXISTS idx_task_public_status_events_task_created ON task_public_status_events(task_id, created_at)'
  );
}

async function ensureTaskTimeWindowTables(db = pool) {
  await db.query('ALTER TABLE tasks ADD COLUMN IF NOT EXISTS okno_od TIME');
  await db.query('ALTER TABLE tasks ADD COLUMN IF NOT EXISTS okno_do TIME');
  await db.query(`
    CREATE TABLE IF NOT EXISTS task_time_window_proposals (
      id SERIAL PRIMARY KEY,
      task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      token VARCHAR(80) NOT NULL UNIQUE,
      proposed_date DATE NOT NULL,
      okno_od TIME NOT NULL,
      okno_do TIME NOT NULL,
      status VARCHAR(32) NOT NULL DEFAULT 'pending',
      note TEXT,
      client_note TEXT,
      proposed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      decided_at TIMESTAMPTZ,
      expires_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.query('CREATE INDEX IF NOT EXISTS idx_task_time_window_proposals_task ON task_time_window_proposals(task_id, created_at DESC)');
  await db.query('CREATE INDEX IF NOT EXISTS idx_task_time_window_proposals_status ON task_time_window_proposals(status, expires_at)');
}

async function ensureTaskPublicStatusToken(db, taskId) {
  await ensurePublicStatusLinkTables(db);
  const current = await db.query('SELECT link_statusowy_token FROM tasks WHERE id = $1', [taskId]);
  if (current.rows[0]?.link_statusowy_token) return current.rows[0].link_statusowy_token;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const token = generatePublicStatusToken();
    const updated = await db.query(
      `UPDATE tasks
          SET link_statusowy_token = COALESCE(link_statusowy_token, $1),
              updated_at = NOW()
        WHERE id = $2
        RETURNING link_statusowy_token`,
      [token, taskId]
    );
    if (updated.rows[0]?.link_statusowy_token) return updated.rows[0].link_statusowy_token;
  }
  return null;
}

async function recordTaskPublicStatusEvent(db, {
  taskId,
  fromStatus = null,
  toStatus,
  source = 'system',
  note = null,
  userId = null,
}) {
  if (!taskId || !toStatus) return null;
  await ensurePublicStatusLinkTables(db);
  const result = await db.query(
    `INSERT INTO task_public_status_events (
       task_id, from_status, to_status, source, note, created_by
     ) VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING *`,
    [taskId, fromStatus || null, toStatus, source, note || null, userId || null]
  );
  return result.rows[0] || null;
}

let _kommoTaskCols = false;
async function ensureKommoTaskColumns() {
  if (_kommoTaskCols) return;
  _kommoTaskCols = true;
  const stmts = [
    'ALTER TABLE tasks ADD COLUMN IF NOT EXISTS kommo_last_sync_at TIMESTAMPTZ',
    'ALTER TABLE tasks ADD COLUMN IF NOT EXISTS kommo_last_sync_status VARCHAR(32)',
    'ALTER TABLE tasks ADD COLUMN IF NOT EXISTS kommo_last_sync_http INTEGER',
    'ALTER TABLE tasks ADD COLUMN IF NOT EXISTS kommo_last_sync_error TEXT',
  ];
  for (const sql of stmts) {
    await pool.query(sql);
  }
}

let _kommoInboundEventTable = false;
async function ensureKommoInboundEventTable() {
  if (_kommoInboundEventTable) return;
  _kommoInboundEventTable = true;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS task_kommo_inbound_events (
      id SERIAL PRIMARY KEY,
      event_key VARCHAR(160) NOT NULL UNIQUE,
      task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
      status VARCHAR(32) NOT NULL DEFAULT 'received',
      incoming_status VARCHAR(64),
      applied_status VARCHAR(64),
      conflict_reason TEXT,
      payload_json JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      processed_at TIMESTAMPTZ
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_task_kommo_inbound_events_task_created
      ON task_kommo_inbound_events (task_id, created_at DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_task_kommo_inbound_events_status_created
      ON task_kommo_inbound_events (status, created_at DESC)
  `);
}

let _taskDocumentsTable = false;
async function ensureTaskDocumentsTable() {
  if (_taskDocumentsTable) return;
  _taskDocumentsTable = true;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS task_documents (
      id SERIAL PRIMARY KEY,
      task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      nazwa VARCHAR(240) NOT NULL,
      sciezka TEXT NOT NULL,
      mime_type VARCHAR(120),
      rozmiar_bytes INTEGER,
      kategoria VARCHAR(80) NOT NULL DEFAULT 'inne',
      status VARCHAR(40) NOT NULL DEFAULT 'roboczy',
      opis TEXT,
      wersja INTEGER NOT NULL DEFAULT 1,
      source_provider VARCHAR(40),
      source_external_id VARCHAR(160),
      remote_url TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (source_provider, source_external_id)
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_task_documents_task ON task_documents (task_id, created_at DESC)');
}

let _taskOperationalCols = false;
async function ensureTaskOperationalColumns() {
  if (_taskOperationalCols) return;
  const stmts = [
    'ALTER TABLE tasks ADD COLUMN IF NOT EXISTS numer VARCHAR(64)',
    'ALTER TABLE tasks ADD COLUMN IF NOT EXISTS godzina_rozpoczecia TIME',
    'ALTER TABLE tasks ADD COLUMN IF NOT EXISTS opis_pracy TEXT',
    'ALTER TABLE tasks ADD COLUMN IF NOT EXISTS notatki TEXT',
    'ALTER TABLE tasks ADD COLUMN IF NOT EXISTS wywoz BOOLEAN DEFAULT false',
    'ALTER TABLE tasks ADD COLUMN IF NOT EXISTS usuwanie_pni BOOLEAN DEFAULT false',
    'ALTER TABLE tasks ADD COLUMN IF NOT EXISTS czas_realizacji_godz DECIMAL(5,2)',
    'ALTER TABLE tasks ADD COLUMN IF NOT EXISTS rebak BOOLEAN DEFAULT false',
    'ALTER TABLE tasks ADD COLUMN IF NOT EXISTS pila_wysiegniku BOOLEAN DEFAULT false',
    'ALTER TABLE tasks ADD COLUMN IF NOT EXISTS nozyce_dlugie BOOLEAN DEFAULT false',
    'ALTER TABLE tasks ADD COLUMN IF NOT EXISTS kosiarka BOOLEAN DEFAULT false',
    'ALTER TABLE tasks ADD COLUMN IF NOT EXISTS podkaszarka BOOLEAN DEFAULT false',
    'ALTER TABLE tasks ADD COLUMN IF NOT EXISTS lopata BOOLEAN DEFAULT false',
    'ALTER TABLE tasks ADD COLUMN IF NOT EXISTS mulczer BOOLEAN DEFAULT false',
    'ALTER TABLE tasks ADD COLUMN IF NOT EXISTS ilosc_osob INTEGER',
    'ALTER TABLE tasks ADD COLUMN IF NOT EXISTS arborysta BOOLEAN DEFAULT false',
    'ALTER TABLE tasks ADD COLUMN IF NOT EXISTS wynik TEXT',
    'ALTER TABLE tasks ADD COLUMN IF NOT EXISTS budzet DECIMAL(10,2)',
    'ALTER TABLE tasks ADD COLUMN IF NOT EXISTS rabat DECIMAL(5,2)',
    'ALTER TABLE tasks ADD COLUMN IF NOT EXISTS kwota_minimalna DECIMAL(10,2)',
    'ALTER TABLE tasks ADD COLUMN IF NOT EXISTS zrebki VARCHAR(100)',
    'ALTER TABLE tasks ADD COLUMN IF NOT EXISTS drzewno VARCHAR(200)',
  ];
  for (const sql of stmts) {
    await pool.query(sql);
  }
  _taskOperationalCols = true;
}

let _issuesCompatCols = false;
async function ensureIssuesCompatColumns() {
  if (_issuesCompatCols) return;
  const stmts = [
    'ALTER TABLE issues ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW()',
    'ALTER TABLE issues ADD COLUMN IF NOT EXISTS opis TEXT',
    'ALTER TABLE issues ADD COLUMN IF NOT EXISTS data_zgloszenia TIMESTAMP DEFAULT NOW()',
  ];
  for (const sql of stmts) {
    await pool.query(sql);
  }
  _issuesCompatCols = true;
}

let _taskClientContactTables = false;
async function ensureTaskClientContactTables() {
  if (_taskClientContactTables) return;
  const stmts = [
    `CREATE TABLE IF NOT EXISTS task_client_contacts (
      task_id INTEGER PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
      status VARCHAR(32),
      note TEXT,
      due_at TIMESTAMPTZ,
      updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    'ALTER TABLE task_client_contacts ADD COLUMN IF NOT EXISTS due_at TIMESTAMPTZ',
    'CREATE INDEX IF NOT EXISTS idx_task_client_contacts_status ON task_client_contacts(status)',
    'CREATE INDEX IF NOT EXISTS idx_task_client_contacts_due ON task_client_contacts(due_at)',
    'CREATE INDEX IF NOT EXISTS idx_task_client_contacts_updated ON task_client_contacts(updated_at DESC)',
    `CREATE TABLE IF NOT EXISTS task_client_contact_events (
      id SERIAL PRIMARY KEY,
      task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      status VARCHAR(32),
      note TEXT,
      due_at TIMESTAMPTZ,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    'ALTER TABLE task_client_contact_events ADD COLUMN IF NOT EXISTS due_at TIMESTAMPTZ',
    'CREATE INDEX IF NOT EXISTS idx_task_client_contact_events_task ON task_client_contact_events(task_id, created_at DESC)',
  ];
  for (const sql of stmts) {
    await pool.query(sql);
  }
  _taskClientContactTables = true;
}

let _taskClosureDecisionTables = false;
async function ensureTaskClosureDecisionTables() {
  if (_taskClosureDecisionTables) return;
  const stmts = [
    `CREATE TABLE IF NOT EXISTS task_closure_decision_events (
      id SERIAL PRIMARY KEY,
      task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      action VARCHAR(40) NOT NULL,
      severity VARCHAR(16),
      status_before VARCHAR(64),
      status_after VARCHAR(64),
      blockers JSONB DEFAULT '[]'::jsonb,
      warnings JSONB DEFAULT '[]'::jsonb,
      risk_score INTEGER DEFAULT 0,
      quality_score INTEGER DEFAULT 0,
      value NUMERIC(12,2) DEFAULT 0,
      note TEXT,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    'CREATE INDEX IF NOT EXISTS idx_task_closure_decision_task ON task_closure_decision_events(task_id, created_at DESC)',
    'CREATE INDEX IF NOT EXISTS idx_task_closure_decision_action ON task_closure_decision_events(action)',
    'CREATE INDEX IF NOT EXISTS idx_task_closure_decision_created ON task_closure_decision_events(created_at DESC)',
  ];
  for (const sql of stmts) {
    await pool.query(sql);
  }
  _taskClosureDecisionTables = true;
}

let _taskClientSignatureTable = false;
async function ensureTaskClientSignatureTable() {
  if (_taskClientSignatureTable) return;
  const stmts = [
    `CREATE TABLE IF NOT EXISTS task_client_signatures (
      task_id INTEGER PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
      signer_name VARCHAR(120) NOT NULL,
      signature_data_url TEXT,
      signed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      note TEXT,
      updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    'CREATE INDEX IF NOT EXISTS idx_task_client_signatures_signed_at ON task_client_signatures(signed_at DESC)',
  ];
  for (const sql of stmts) {
    await pool.query(sql);
  }
  _taskClientSignatureTable = true;
}

let _workLogSafetyCols = false;
async function ensureWorkLogSafetyColumns() {
  if (_workLogSafetyCols) return;
  await pool.query('ALTER TABLE work_logs ADD COLUMN IF NOT EXISTS bhp_checklista JSONB');
  _workLogSafetyCols = true;
}

function kommoActor(req) {
  const u = req.user;
  if (!u) return null;
  return { id: u.id ?? null, login: u.login ?? null, rola: u.rola ?? null };
}

const isDyrektor = (user) => ['Prezes', 'Dyrektor'].includes(user.rola);
const isKierownik = (user) => user.rola === 'Kierownik';
const isSpecjalista = (user) => user.rola === 'Specjalista';
const isTeamScoped = (user) => user.rola === 'Brygadzista' || user.rola === 'Pomocnik';
const isEstimator = (user) => user.rola === 'Wyceniający' || user.rola === 'Wyceniajacy';
const canSeeAllTasks = (user) => isDyrektorOrAdmin(user) || isSalesDirector(user);
const canManageTaskBackoffice = (user) => isDyrektorOrAdmin(user) || isKierownik(user) || isSpecjalista(user);

function envBranchList(name) {
  return String(process.env[name] || '')
    .split(/[,\s;]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function envFlagForBranch(globalName, branchListName, oddzialId) {
  if (process.env[globalName] === '1') return true;
  const branches = envBranchList(branchListName);
  if (!branches.length || oddzialId == null) return false;
  return branches.includes(String(oddzialId));
}

/** F3.5 — wymuszenie zdjecia "Po" przy finish (ekipa): globalnie albo lista oddzialow. */
function finishRequirePoPhoto(oddzialId = null) {
  return envFlagForBranch(
    'TASK_FINISH_REQUIRE_PO_PHOTO',
    'TASK_FINISH_REQUIRE_PO_PHOTO_BRANCHES',
    oddzialId
  );
}

/** F3.6 — wymagane zdjecie "Przed" lub check-in: globalnie albo lista oddzialow. */
function finishRequirePrzedPhoto(oddzialId = null) {
  return envFlagForBranch(
    'TASK_FINISH_REQUIRE_PRZED_PHOTO',
    'TASK_FINISH_REQUIRE_PRZED_PHOTO_BRANCHES',
    oddzialId
  );
}

/** F3.7 — wymuszenie listy `zuzyte_materialy` przy finish (ekipa): `TASK_FINISH_REQUIRE_MATERIAL_USAGE=1`. */
function finishRequireMaterialUsage() {
  return process.env.TASK_FINISH_REQUIRE_MATERIAL_USAGE === '1';
}

/** @param {import('pg').PoolClient} client */
async function assertTeamFinishPhotoRules(client, task) {
  const taskId = task?.id;
  const requirePo = finishRequirePoPhoto(task?.oddzial_id);
  const requirePrzed = finishRequirePrzedPhoto(task?.oddzial_id);
  if (!requirePo && !requirePrzed) return;
  const counts = await countTaskFinishPhotos(client, taskId);
  if (requirePo && counts.po < FINISH_PHOTO_MIN.po) {
    const e = new Error('po');
    e.code = 'TASK_FINISH_PO_PHOTO_REQUIRED';
    throw e;
  }
  if (requirePrzed && counts.przed < FINISH_PHOTO_MIN.przed) {
    const e = new Error('przed');
    e.code = 'TASK_FINISH_PRZED_PHOTO_REQUIRED';
    throw e;
  }
}

/** @param {import('pg').PoolClient} client */
async function insertFinishMaterialUsageRows(client, taskId, userId, rows) {
  if (!Array.isArray(rows) || rows.length === 0) return;
  for (const row of rows.slice(0, 50)) {
    const nazwa = row?.nazwa != null ? String(row.nazwa).trim() : '';
    if (!nazwa) continue;
    const ilosc = row.ilosc != null && row.ilosc !== '' ? Number(row.ilosc) : null;
    const unitCost = row.koszt_jednostkowy != null && row.koszt_jednostkowy !== ''
      ? Number(row.koszt_jednostkowy)
      : null;
    const totalCost = row.koszt_laczny != null && row.koszt_laczny !== ''
      ? Number(row.koszt_laczny)
      : (Number.isFinite(ilosc) && Number.isFinite(unitCost) ? ilosc * unitCost : null);
    const materialId = row?.material_id != null && row.material_id !== '' ? Number(row.material_id) : null;
    try {
      await client.query(
        `INSERT INTO task_finish_material_usage (
           task_id, recorded_by, material_id, nazwa, ilosc, jednostka, koszt_jednostkowy, koszt_laczny, notatka
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          taskId,
          userId,
          Number.isFinite(materialId) ? materialId : null,
          nazwa.slice(0, 200),
          ilosc,
          row.jednostka ? String(row.jednostka).trim().slice(0, 24) : null,
          Number.isFinite(unitCost) ? unitCost : null,
          Number.isFinite(totalCost) ? totalCost : null,
          row.notatka ? String(row.notatka).trim().slice(0, 500) : null,
        ]
      );
    } catch (err) {
      if (String(err.message || '').includes('task_finish_material_usage')) {
        const e = new Error('migration');
        e.code = 'TASK_FINISH_USAGE_TABLE_MISSING';
        throw e;
      }
      throw err;
    }
  }
}

/** @param {import('pg').PoolClient} client */
async function insertWarehouseIssuesForFinish(client, task, taskId, userId, rows) {
  if (!Array.isArray(rows) || rows.length === 0) return;
  for (const row of rows.slice(0, 50)) {
    const nazwa = row?.nazwa != null ? String(row.nazwa).trim() : '';
    const ilosc = row?.ilosc != null && row.ilosc !== '' ? Number(row.ilosc) : null;
    if (!Number.isFinite(ilosc) || ilosc <= 0) continue;
    const materialId = row?.material_id != null && row.material_id !== '' ? Number(row.material_id) : null;
    const materialParams = Number.isFinite(materialId)
      ? [materialId, task.oddzial_id]
      : [nazwa, task.oddzial_id];
    const materialSql = Number.isFinite(materialId)
      ? 'SELECT id, oddzial_id, nazwa, koszt_jednostkowy FROM warehouse_materials WHERE id = $1 AND oddzial_id = $2'
      : 'SELECT id, oddzial_id, nazwa, koszt_jednostkowy FROM warehouse_materials WHERE lower(nazwa) = lower($1) AND oddzial_id = $2 AND aktywny = true ORDER BY id LIMIT 1';
    const materialResult = await client.query(materialSql, materialParams);
    const material = materialResult.rows[0];
    if (!material) continue;
    const stockResult = await client.query(
      `SELECT COALESCE(SUM(CASE
          WHEN typ IN ('przyjecie', 'korekta_plus') THEN ilosc
          WHEN typ IN ('rozchod', 'korekta_minus') THEN -ilosc
          ELSE 0
        END), 0)::numeric AS stan
       FROM warehouse_material_movements
      WHERE material_id = $1`,
      [material.id]
    );
    const stock = Number(stockResult.rows[0]?.stan || 0);
    if (stock < ilosc) {
      const e = new Error('warehouse stock underflow');
      e.code = 'WAREHOUSE_STOCK_UNDERFLOW';
      e.details = { material_id: material.id, nazwa: material.nazwa, stan: stock, requested: ilosc };
      throw e;
    }
    const unitCost = row.koszt_jednostkowy != null && row.koszt_jednostkowy !== ''
      ? Number(row.koszt_jednostkowy)
      : Number(material.koszt_jednostkowy || 0);
    await client.query(
      `INSERT INTO warehouse_material_movements
        (oddzial_id, material_id, typ, ilosc, koszt_jednostkowy, task_id, notatki, user_id)
       VALUES ($1,$2,'rozchod',$3,$4,$5,$6,$7)`,
      [
        material.oddzial_id,
        material.id,
        ilosc,
        Number.isFinite(unitCost) ? unitCost : 0,
        taskId,
        `Finish zlecenia #${taskId}`,
        userId,
      ]
    );
  }
}

/** @param {import('pg').PoolClient} client */
async function insertOperationalCostRows(client, taskId, userId, rows) {
  if (!Array.isArray(rows) || rows.length === 0) return;
  const allowed = new Set(['sprzet', 'paliwo', 'utylizacja', 'inne']);
  for (const row of rows.slice(0, 50)) {
    const category = String(row?.category || row?.kategoria || '').trim().toLowerCase();
    const amount = row?.amount ?? row?.kwota ?? row?.koszt;
    const numericAmount = amount !== '' && amount != null ? Number(amount) : null;
    if (!allowed.has(category) || !Number.isFinite(numericAmount) || numericAmount < 0) continue;
    await client.query(
      `INSERT INTO task_operational_costs (
         task_id, recorded_by, category, label, amount, source, note
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        taskId,
        userId,
        category,
        row.label ? String(row.label).trim().slice(0, 200) : null,
        numericAmount,
        row.source ? String(row.source).trim().slice(0, 80) : 'finish',
        row.note ? String(row.note).trim().slice(0, 500) : null,
      ]
    );
  }
}

const getTaskScope = (user, alias = 't', startParam = 1) => {
  if (canSeeAllTasks(user)) {
    return { clause: '', params: [], nextParam: startParam };
  }

  if (isTeamScoped(user)) {
    const clause = `${alias}.ekipa_id IN (
      SELECT tm.team_id FROM team_members tm WHERE tm.user_id = $${startParam}
      UNION
      SELECT te.id FROM teams te WHERE te.brygadzista_id = $${startParam}
    )`;
    return { clause, params: [user.id], nextParam: startParam + 1 };
  }

  if (isEstimator(user)) {
    const clause = `${alias}.wyceniajacy_id = $${startParam}`;
    return { clause, params: [user.id], nextParam: startParam + 1 };
  }

  const clause = `${alias}.oddzial_id = $${startParam}`;
  return { clause, params: [user.oddzial_id], nextParam: startParam + 1 };
};

const requireTaskAccess = async (req, res, next) => {
  try {
    const taskId = Number(req.params.id);
    const scope = getTaskScope(req.user, 't', 2);
    const where = scope.clause ? `id = $1 AND ${scope.clause}` : 'id = $1';
    const result = await pool.query(`SELECT id FROM tasks t WHERE ${where} LIMIT 1`, [taskId, ...scope.params]);
    if (result.rows.length === 0) {
      return res.status(403).json({
        error: req.t('errors.tasks.accessDenied'),
        code: TASK_ACCESS_DENIED,
        requestId: req.requestId,
      });
    }
    return next();
  } catch (err) {
    logger.error('Blad sprawdzania dostepu do zlecenia', { message: err.message, requestId: req.requestId });
    return res.status(500).json({ error: req.t('errors.http.serverError') });
  }
};

function taskKommoPayloadSql() {
  return `
    SELECT
      t.*,
      tr.wartosc_brutto AS rozliczenie_wartosc_brutto,
      tr.vat_stawka AS rozliczenie_vat_stawka,
      tr.wartosc_netto AS rozliczenie_wartosc_netto,
      tr.koszt_pomocnikow AS rozliczenie_koszt_pomocnikow,
      tr.podstawa_brygadzisty AS rozliczenie_podstawa_brygadzisty,
      tr.procent_brygadzisty AS rozliczenie_procent_brygadzisty,
      tr.wynagrodzenie_brygadzisty AS rozliczenie_wynagrodzenie_brygadzisty,
      COALESCE(mu.materialy_zuzyte_count, 0)::int AS materialy_zuzyte_count,
      COALESCE(mu.materialy_zuzyte, '[]'::json) AS materialy_zuzyte,
      COALESCE(mu.koszt_materialow, 0)::numeric AS koszt_materialow,
      COALESCE(op.koszt_sprzetu, 0)::numeric AS koszt_sprzetu,
      COALESCE(op.koszt_paliwa, 0)::numeric AS koszt_paliwa,
      COALESCE(op.koszt_utylizacji, 0)::numeric AS koszt_utylizacji,
      COALESCE(op.koszt_inne, 0)::numeric AS koszt_inne,
      COALESCE(wl.work_logs_count, 0)::int AS work_logs_count,
      COALESCE(wl.work_total_minutes, 0)::int AS work_total_minutes,
      wl.work_started_at,
      wl.work_finished_at,
      COALESCE(wl.work_logs, '[]'::json) AS work_logs,
      COALESCE(ph.photos_count, 0)::int AS photos_count,
      COALESCE(ph.photo_counts_by_type, '{}'::json) AS photo_counts_by_type,
      COALESCE(ph.photos, '[]'::json) AS photos,
      COALESCE(doc.documents_count, 0)::int AS documents_count,
      COALESCE(doc.documents, '[]'::json) AS documents
    FROM tasks t
    LEFT JOIN task_rozliczenie tr ON tr.task_id = t.id
    LEFT JOIN LATERAL (
      SELECT
        COUNT(*)::int AS materialy_zuzyte_count,
        COALESCE(
          json_agg(
            json_build_object(
              'nazwa', m.nazwa,
              'ilosc', m.ilosc,
              'jednostka', m.jednostka,
              'koszt_jednostkowy', m.koszt_jednostkowy,
              'koszt_laczny', m.koszt_laczny,
              'notatka', m.notatka
            )
            ORDER BY m.id
          ),
          '[]'::json
        ) AS materialy_zuzyte,
        COALESCE(SUM(m.koszt_laczny), 0) AS koszt_materialow
      FROM task_finish_material_usage m
      WHERE m.task_id = t.id
    ) mu ON true
    LEFT JOIN LATERAL (
      SELECT
        COALESCE(SUM(amount) FILTER (WHERE category = 'sprzet'), 0) AS koszt_sprzetu,
        COALESCE(SUM(amount) FILTER (WHERE category = 'paliwo'), 0) AS koszt_paliwa,
        COALESCE(SUM(amount) FILTER (WHERE category = 'utylizacja'), 0) AS koszt_utylizacji,
        COALESCE(SUM(amount) FILTER (WHERE category = 'inne'), 0) AS koszt_inne
      FROM task_operational_costs c
      WHERE c.task_id = t.id
    ) op ON true
    LEFT JOIN LATERAL (
      SELECT
        COUNT(*)::int AS work_logs_count,
        COALESCE(SUM(COALESCE(w.czas_pracy_minuty, EXTRACT(EPOCH FROM (w.end_time - w.start_time)) / 60)), 0)::int AS work_total_minutes,
        MIN(w.start_time) AS work_started_at,
        MAX(w.end_time) AS work_finished_at,
        COALESCE(
          json_agg(
            json_build_object(
              'id', w.id,
              'user_id', w.user_id,
              'start_time', w.start_time,
              'end_time', w.end_time,
              'minutes', COALESCE(w.czas_pracy_minuty, EXTRACT(EPOCH FROM (w.end_time - w.start_time)) / 60),
              'start_lat', w.start_lat,
              'start_lng', w.start_lng,
              'end_lat', w.end_lat,
              'end_lng', w.end_lng
            )
            ORDER BY w.start_time
          ) FILTER (WHERE w.id IS NOT NULL),
          '[]'::json
        ) AS work_logs
      FROM work_logs w
      WHERE w.task_id = t.id
    ) wl ON true
    LEFT JOIN LATERAL (
      SELECT
        COUNT(*)::int AS photos_count,
        COALESCE(json_object_agg(photo_type, c), '{}'::json) AS photo_counts_by_type,
        COALESCE(
          json_agg(
            json_build_object(
              'id', id,
              'typ', typ,
              'url', url,
              'sciezka', sciezka,
              'opis', opis,
              'data_dodania', data_dodania
            )
            ORDER BY data_dodania DESC
          ) FILTER (WHERE id IS NOT NULL),
          '[]'::json
        ) AS photos
      FROM (
        SELECT
          p.*,
          COALESCE(NULLIF(p.typ, ''), 'inne') AS photo_type,
          COUNT(*) OVER (PARTITION BY COALESCE(NULLIF(p.typ, ''), 'inne')) AS c
        FROM photos p
        WHERE p.task_id = t.id
        ORDER BY p.data_dodania DESC
        LIMIT 24
      ) p
    ) ph ON true
    LEFT JOIN LATERAL (
      SELECT
        COUNT(*)::int AS documents_count,
        COALESCE(
          json_agg(
            json_build_object(
              'id', d.id,
              'nazwa', d.nazwa,
              'kategoria', d.kategoria,
              'sciezka', d.sciezka,
              'remote_url', d.remote_url,
              'source_provider', d.source_provider
            )
            ORDER BY d.created_at DESC
          ) FILTER (WHERE d.id IS NOT NULL),
          '[]'::json
        ) AS documents
      FROM task_documents d
      WHERE d.task_id = t.id
    ) doc ON true
    WHERE t.id = $1`;
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = uploadsPath('tasks');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `task_${Date.now()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Tylko obrazy'), false);
    }
  }
});

const documentStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = uploadsPath('task-documents');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `task_doc_${Date.now()}${ext}`);
  }
});

const documentUpload = multer({
  storage: documentStorage,
  limits: { fileSize: 25 * 1024 * 1024 },
});

function cleanupUploadedFile(file) {
  cleanupLocalFile(file);
}

const toNum = (val) => {
  if (val === '' || val === null || val === undefined) return null;
  const n = parseFloat(val);
  return isNaN(n) ? null : n;
};

const toBool = (val) => val === true || val === 'true' || val === 1 || val === '1';

const toInt = (val) => {
  if (val === '' || val === null || val === undefined) return null;
  const n = parseInt(String(val), 10);
  return Number.isNaN(n) ? null : n;
};

const normalizeIdList = (val) => {
  if (!Array.isArray(val)) return [];
  return [...new Set(val.map((item) => toInt(item)).filter(Boolean))];
};

const toStr = (val) => {
  if (val === '' || val === null || val === undefined) return null;
  return val;
};

function splitClientName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { imie: parts[0] || null, nazwisko: null };
  return { imie: parts[0], nazwisko: parts.slice(1).join(' ') };
}

async function ensureIntakeClient({ klient_nazwa, klient_telefon, adres, miasto, created_by }) {
  const phone = String(klient_telefon || '').trim();
  const name = String(klient_nazwa || '').trim();
  const { imie, nazwisko } = splitClientName(name);
  if (phone) {
    const existing = await pool.query('SELECT id FROM klienci WHERE telefon = $1 ORDER BY id LIMIT 1', [phone]);
    if (existing.rows[0]) {
      const { rows } = await pool.query(
        `UPDATE klienci
         SET imie = COALESCE($2, imie),
             nazwisko = COALESCE($3, nazwisko),
             firma = CASE WHEN $2 IS NULL THEN COALESCE($4, firma) ELSE firma END,
             adres = COALESCE($5, adres),
             miasto = COALESCE($6, miasto),
             zrodlo = COALESCE(zrodlo, 'telefon'),
             created_by = COALESCE(created_by, $7),
             updated_at = NOW()
         WHERE id = $1
         RETURNING id`,
        [existing.rows[0].id, imie, nazwisko, name || null, adres || null, miasto || null, created_by || null]
      );
      return rows[0]?.id || existing.rows[0].id;
    }
  }

  const { rows } = await pool.query(
    `INSERT INTO klienci (imie, nazwisko, firma, telefon, adres, miasto, zrodlo, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,'telefon',$7)
     RETURNING id`,
    [imie, nazwisko, imie ? null : name || null, phone || null, adres || null, miasto || null, created_by || null]
  );
  return rows[0]?.id || null;
}

async function createLinkedInspectionForFieldTask({
  taskId,
  wyceniajacyId,
  wycenaId,
  klient_nazwa,
  klient_telefon,
  adres,
  miasto,
  plannedDateTime,
  notes,
  createdBy,
}) {
  const estimatorId = toInt(wyceniajacyId);
  if (!taskId || !estimatorId) return null;

  const existing = await pool.query('SELECT id FROM ogledziny WHERE task_id = $1 ORDER BY id LIMIT 1', [taskId]);
  if (existing.rows[0]) {
    const { rows } = await pool.query(
      `UPDATE ogledziny
       SET brygadzista_id = COALESCE(brygadzista_id, $2),
           wycena_id = COALESCE($3, wycena_id),
           data_planowana = COALESCE($4::timestamptz, data_planowana),
           updated_at = NOW()
       WHERE id = $1
       RETURNING id`,
      [existing.rows[0].id, estimatorId, wycenaId || null, plannedDateTime || null]
    );
    return rows[0]?.id || existing.rows[0].id;
  }

  const clientId = await ensureIntakeClient({
    klient_nazwa,
    klient_telefon,
    adres,
    miasto,
    created_by: createdBy,
  });
  const inspectionNote = [
    `Zgloszenie z telefonu zapisane jako zlecenie #${taskId}.`,
    klient_telefon ? `Telefon klienta: ${klient_telefon}` : '',
    notes ? `Notatka biura:\n${notes}` : '',
    'Cel: specjalista ds. wyceny robi zdjecia, szkic, zakres, czas, budzet i ryzyka dla biura.',
  ].filter(Boolean).join('\n');

  const { rows } = await pool.query(
    `INSERT INTO ogledziny (
       klient_id, brygadzista_id, data_planowana, status, adres, miasto,
       notatki, wycena_id, task_id, created_by
     )
     VALUES ($1,$2,$3,'Zaplanowane',$4,$5,$6,$7,$8,$9)
     RETURNING id`,
    [
      clientId,
      estimatorId,
      plannedDateTime || null,
      adres || null,
      miasto || null,
      inspectionNote,
      wycenaId || null,
      taskId,
      createdBy || null,
    ]
  );
  return rows[0]?.id || null;
}

function buildTaskPlannedDateTime(dataPlanowana, godzinaRozpoczecia) {
  const rawDate = String(dataPlanowana || '').trim();
  if (!rawDate) return rawDate;
  const rawHour = String(godzinaRozpoczecia || '').trim().slice(0, 5);
  if (!rawHour) return rawDate;
  const datePart = rawDate.includes('T') ? rawDate.slice(0, 10) : rawDate.split(' ')[0];
  const hourMatch = rawHour.match(/^(\d{1,2}):(\d{2})$/);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart) || !hourMatch) return rawDate;
  const hh = String(Math.min(23, Number(hourMatch[1]))).padStart(2, '0');
  const mm = String(Math.min(59, Number(hourMatch[2]))).padStart(2, '0');
  return `${datePart} ${hh}:${mm}:00`;
}

function normalizeTimeHm(value) {
  const raw = String(value || '').trim();
  const match = raw.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hh = Number(match[1]);
  const mm = Number(match[2]);
  if (!Number.isInteger(hh) || !Number.isInteger(mm) || hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function timeHmToMinutes(value) {
  const hm = normalizeTimeHm(value);
  if (!hm) return null;
  const [h, m] = hm.split(':').map(Number);
  return h * 60 + m;
}

function lastSundayOfMonthUtc(year, monthIndex) {
  const date = new Date(Date.UTC(year, monthIndex + 1, 0, 1, 0, 0));
  date.setUTCDate(date.getUTCDate() - date.getUTCDay());
  return date;
}

function warsawOffsetMinutesForInstant(date) {
  const year = date.getUTCFullYear();
  const dstStart = lastSundayOfMonthUtc(year, 2);
  const dstEnd = lastSundayOfMonthUtc(year, 9);
  return date >= dstStart && date < dstEnd ? 120 : 60;
}

function plannedDateTimeToWarsawMinutes(value) {
  const raw = String(value || '').trim();
  const inlineTime = raw.match(/(?:T|\s)(\d{1,2}):(\d{2})/);
  const hasExplicitZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw);
  if (inlineTime && !hasExplicitZone) {
    const hh = Number(inlineTime[1]);
    const mm = Number(inlineTime[2]);
    if (Number.isInteger(hh) && Number.isInteger(mm) && hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59) {
      return hh * 60 + mm;
    }
  }

  const planned = new Date(value);
  if (Number.isNaN(planned.getTime())) return null;

  const utcMinutes = planned.getUTCHours() * 60 + planned.getUTCMinutes();
  return (utcMinutes + warsawOffsetMinutesForInstant(planned)) % (24 * 60);
}

function planWindowViolation({ oknoOd, oknoDo, plannedDateTime, godzinaRozpoczecia, durationHours }) {
  const windowStart = timeHmToMinutes(oknoOd);
  const windowEnd = timeHmToMinutes(oknoDo);
  if (windowStart == null || windowEnd == null || windowEnd <= windowStart) return null;
  const explicitStart = timeHmToMinutes(godzinaRozpoczecia);
  const startMin = explicitStart != null
    ? explicitStart
    : plannedDateTimeToWarsawMinutes(plannedDateTime);
  if (startMin == null) return null;
  const durMin = Math.max(15, Math.round(Number(durationHours || 2) * 60));
  const endMin = startMin + durMin;
  if (startMin < windowStart || endMin > windowEnd) {
    return {
      code: 'TASK_CLIENT_TIME_WINDOW_CONFLICT',
      error: `Plan poza zaakceptowanym oknem klienta ${normalizeTimeHm(oknoOd)}-${normalizeTimeHm(oknoDo)}.`,
      okno_od: normalizeTimeHm(oknoOd),
      okno_do: normalizeTimeHm(oknoDo),
      start: normalizeTimeHm(godzinaRozpoczecia) || normalizeTimeHm(`${Math.floor(startMin / 60)}:${String(startMin % 60).padStart(2, '0')}`),
      duration_min: durMin,
    };
  }
  return null;
}

let _teamAttendanceTablesForTasks = false;
async function ensureTeamAttendanceTablesForTasks() {
  if (_teamAttendanceTablesForTasks) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS team_attendance (
      id SERIAL PRIMARY KEY,
      date_ymd DATE NOT NULL,
      team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      present BOOLEAN NOT NULL DEFAULT true,
      note TEXT,
      actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      actor_name VARCHAR(160),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS idx_team_attendance_day_team ON team_attendance(date_ymd, team_id)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_team_attendance_date ON team_attendance(date_ymd)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_team_attendance_team ON team_attendance(team_id)');
  _teamAttendanceTablesForTasks = true;
}

async function getTeamAttendanceForPlan(teamId, plannedDateTime) {
  const day = String(plannedDateTime || '').slice(0, 10);
  if (!teamId || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  await ensureTeamAttendanceTablesForTasks();
  const { rows } = await pool.query(
    `SELECT t.id AS team_id,
            t.nazwa AS team_name,
            a.present,
            a.note,
            a.actor_name
       FROM teams t
       LEFT JOIN team_attendance a ON a.team_id = t.id AND a.date_ymd = $2::date
      WHERE t.id = $1
      LIMIT 1`,
    [teamId, day]
  );
  const row = rows[0];
  if (!row) return null;
  return {
    day,
    teamId: String(row.team_id || teamId),
    teamName: row.team_name || `Ekipa #${teamId}`,
    present: row.present === null || row.present === undefined ? true : row.present === true,
    note: String(row.note || ''),
    actor: String(row.actor_name || ''),
  };
}

function firstTaskText(row, keys = []) {
  for (const key of keys) {
    const value = String(row?.[key] ?? '').trim();
    if (value) return value;
  }
  return '';
}

function extractLabeledNote(row, label) {
  const notes = String([row?.notatki_wewnetrzne, row?.notatki].filter(Boolean).join('\n'));
  const escaped = String(label).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = notes.match(new RegExp(`${escaped}:\\s*([^\\n]+)`, 'i'));
  return match ? String(match[1] || '').trim() : '';
}

function buildTaskAddressLine(row = {}) {
  return [row.adres, row.miasto].map((item) => String(item || '').trim()).filter(Boolean).join(', ');
}

function buildOfficePlanPackageLines({
  task,
  plannedDateTime,
  hours,
  teamId,
  teamName,
  equipmentNames = [],
  note = '',
  actor = '',
}) {
  const scope = firstTaskText(task, ['opis_pracy', 'opis', 'wynik']) || extractLabeledNote(task, 'Zakres prac');
  const risks = extractLabeledNote(task, 'Ryzyka');
  const fieldEquipment = extractLabeledNote(task, 'Sprzet');
  const settlement = extractLabeledNote(task, 'Warunki rozliczenia');
  const waste = extractLabeledNote(task, 'Odpady');
  const value = Number(task?.wartosc_planowana ?? task?.budzet ?? 0) || 0;
  const photosTotal = Number(task?.photo_total || 0);
  const photosField = Number(task?.photo_wycena || 0) + Number(task?.photo_szkic || 0);
  const equipmentLine = [equipmentNames.join(', '), fieldEquipment, note].filter(Boolean).join(' | ');
  return [
    'PLAN BIURA / PAKIET DLA EKIPY',
    `Klient: ${task?.klient_nazwa || 'brak'}`,
    `Telefon: ${task?.klient_telefon || 'brak'}`,
    `Adres: ${buildTaskAddressLine(task) || 'brak'}`,
    `Typ prac: ${task?.typ_uslugi || '-'}`,
    `Zakres z terenu: ${scope || '-'}`,
    `Ryzyka: ${risks || '-'}`,
    settlement ? `Warunki rozliczenia: ${settlement}` : '',
    waste ? `Odpady: ${waste}` : '',
    `Budzet/wartosc: ${value ? `${value} PLN` : '-'}`,
    `Zdjecia/szkic: ${photosField}/${photosTotal}`,
    `Termin: ${plannedDateTime}`,
    `Czas: ${hours} h`,
    `Ekipa: ${teamName || `#${teamId}`} (#${teamId})`,
    `Sprzet: ${equipmentLine || '-'}`,
    `Zaplanowal: ${actor}`,
    `Data planowania: ${new Date().toISOString()}`,
  ].filter(Boolean);
}

let equipmentReservationTaskSchemaReady = false;

async function ensureEquipmentReservationTaskSchema(db) {
  if (equipmentReservationTaskSchemaReady) return;
  await db.query('ALTER TABLE equipment_reservations ADD COLUMN IF NOT EXISTS task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL');
  await db.query('ALTER TABLE equipment_reservations ADD COLUMN IF NOT EXISTS notatki TEXT');
  await db.query('CREATE INDEX IF NOT EXISTS idx_equipment_reservations_task ON equipment_reservations (task_id)');
  equipmentReservationTaskSchemaReady = true;
}

function resourceStatusBlocksPlanning(status) {
  const text = String(status || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  return text.includes('napraw') || text.includes('serwis') || text.includes('awari') || text.includes('wycof');
}

async function assertTeamResourcesAvailableForPlan(db, teamId) {
  const id = toInt(teamId);
  if (!id) return { ok: true, items: [] };
  const result = await db.query(
    `SELECT 'Sprzet' AS kind,
            id,
            COALESCE(NULLIF(nazwa, ''), 'Sprzet #' || id::text) AS label,
            status
       FROM equipment_items
      WHERE ekipa_id = $1
        AND (
          LOWER(COALESCE(status, '')) LIKE '%napraw%' OR
          LOWER(COALESCE(status, '')) LIKE '%serwis%' OR
          LOWER(COALESCE(status, '')) LIKE '%awari%' OR
          LOWER(COALESCE(status, '')) LIKE '%wycof%'
        )
      UNION ALL
     SELECT 'Auto' AS kind,
            id,
            COALESCE(
              NULLIF(TRIM(CONCAT(COALESCE(marka, ''), ' ', COALESCE(model, ''), ' ', COALESCE(nr_rejestracyjny, ''))), ''),
              'Auto #' || id::text
            ) AS label,
            status
       FROM vehicles
      WHERE ekipa_id = $1
        AND (
          LOWER(COALESCE(status, '')) LIKE '%napraw%' OR
          LOWER(COALESCE(status, '')) LIKE '%serwis%' OR
          LOWER(COALESCE(status, '')) LIKE '%awari%' OR
          LOWER(COALESCE(status, '')) LIKE '%wycof%'
        )`,
    [id]
  );
  const items = (result.rows || [])
    .filter((item) => resourceStatusBlocksPlanning(item.status))
    .map((item) => ({
      kind: item.kind || 'Zasob',
      id: item.id,
      label: item.label || `#${item.id}`,
      status: item.status || '',
    }));
  if (!items.length) return { ok: true, items: [] };
  const detail = items
    .slice(0, 4)
    .map((item) => `${item.kind}: ${item.label}${item.status ? ` (${item.status})` : ''}`)
    .join(', ');
  return {
    ok: false,
    status: 409,
    code: 'TEAM_RESOURCE_UNAVAILABLE',
    error: `Ekipa ma zasoby w naprawie lub serwisie: ${detail}. Zamknij naprawe albo wybierz inna ekipe przed planowaniem.`,
    items,
  };
}

async function syncTaskEquipmentReservations(db, {
  taskId,
  oddzialId,
  teamId,
  plannedDateTime,
  sprzetIds,
  note,
  userId,
}) {
  const ids = normalizeIdList(sprzetIds);
  await ensureEquipmentReservationTaskSchema(db);

  if (!ids.length) {
    await db.query(
      `UPDATE equipment_reservations
          SET status = 'Anulowane', updated_at = NOW()
        WHERE task_id = $1
          AND LOWER(COALESCE(status, '')) NOT LIKE 'anul%'`,
      [taskId]
    );
    return { ok: true, reservations: [] };
  }

  const equipmentResult = await db.query(
    `SELECT id, nazwa, typ, oddzial_id, ekipa_id, status
       FROM equipment_items
      WHERE id = ANY($1::int[])`,
    [ids]
  );
  const equipmentById = new Map(equipmentResult.rows.map((item) => [Number(item.id), item]));
  const missing = ids.filter((id) => !equipmentById.has(Number(id)));
  if (missing.length) {
    return {
      ok: false,
      status: 404,
      error: `Nie znaleziono sprzetu: ${missing.join(', ')}`,
      code: 'EQUIPMENT_NOT_FOUND',
    };
  }

  const branchId = toInt(oddzialId);
  for (const id of ids) {
    const item = equipmentById.get(Number(id));
    const equipmentTravelsWithTeam = teamId && item.ekipa_id && Number(item.ekipa_id) === Number(teamId);
    if (branchId && item.oddzial_id && Number(item.oddzial_id) !== branchId && !equipmentTravelsWithTeam) {
      return {
        ok: false,
        status: 400,
        error: `Sprzet "${item.nazwa || `#${id}`}" nalezy do innego oddzialu. Mozna go uzyc tylko wtedy, gdy jest przypisany do delegowanej ekipy.`,
        code: 'EQUIPMENT_BRANCH_MISMATCH',
      };
    }
    if (resourceStatusBlocksPlanning(item.status)) {
      return {
        ok: false,
        status: 409,
        error: `Sprzet "${item.nazwa || `#${id}`}" nie jest dostepny.`,
        code: 'EQUIPMENT_UNAVAILABLE',
      };
    }
  }

  const day = String(plannedDateTime || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return {
      ok: false,
      status: 400,
      error: 'Nieprawidlowa data rezerwacji sprzetu.',
      code: 'EQUIPMENT_RESERVATION_DATE_INVALID',
    };
  }

  for (const id of ids) {
    const item = equipmentById.get(Number(id));
    const clash = await db.query(
      `SELECT r.id, r.ekipa_id, r.task_id, t.nazwa AS ekipa_nazwa
         FROM equipment_reservations r
         LEFT JOIN teams t ON t.id = r.ekipa_id
        WHERE r.sprzet_id = $1
          AND LOWER(COALESCE(r.status, '')) NOT LIKE 'anul%'
          AND LOWER(COALESCE(r.status, '')) NOT LIKE 'zwr%'
          AND NOT (r.data_do < $2::date OR r.data_od > $3::date)
          AND (r.task_id IS NULL OR r.task_id <> $4::int)
          AND r.ekipa_id IS DISTINCT FROM $5::int
        LIMIT 1`,
      [id, day, day, taskId, teamId]
    );
    if (clash.rows.length) {
      const row = clash.rows[0];
      return {
        ok: false,
        status: 409,
        error: `Konflikt rezerwacji sprzetu: "${item.nazwa || `#${id}`}" jest juz zarezerwowany ${day}${row.ekipa_nazwa ? ` dla ${row.ekipa_nazwa}` : ''}.`,
        code: 'EQUIPMENT_RESERVATION_CONFLICT',
      };
    }
  }

  await db.query(
    `UPDATE equipment_reservations
        SET status = 'Anulowane', updated_at = NOW()
      WHERE task_id = $1
        AND LOWER(COALESCE(status, '')) NOT LIKE 'anul%'`,
    [taskId]
  );

  const reservations = [];
  for (const id of ids) {
    const item = equipmentById.get(Number(id));
    const reservationBranchId = branchId || toInt(item.oddzial_id);
    if (!reservationBranchId) {
      return {
        ok: false,
        status: 400,
        error: `Brak oddzialu dla rezerwacji sprzetu "${item.nazwa || `#${id}`}".`,
        code: 'EQUIPMENT_BRANCH_REQUIRED',
      };
    }
    const insert = await db.query(
      `INSERT INTO equipment_reservations (
         oddzial_id, sprzet_id, ekipa_id, data_od, data_do, caly_dzien,
         status, user_id, task_id, notatki
       )
       VALUES ($1,$2,$3,$4::date,$5::date,true,'Zarezerwowane',$6,$7,$8)
       RETURNING id, sprzet_id`,
      [
        reservationBranchId,
        id,
        teamId,
        day,
        day,
        userId || null,
        taskId,
        note || `Rezerwacja z planu zlecenia #${taskId}`,
      ]
    );
    reservations.push({
      id: insert.rows[0].id,
      sprzet_id: insert.rows[0].sprzet_id,
      sprzet_nazwa: item.nazwa || `Sprzet #${id}`,
    });
  }

  return { ok: true, reservations };
}

function hasExplicitPlannedHour(dataPlanowana, godzinaRozpoczecia) {
  return Boolean(String(godzinaRozpoczecia || '').trim()) || /[T\s]\d{1,2}:\d{2}/.test(String(dataPlanowana || ''));
}

/** Tagi zdjęcia (PATCH / web) — max 20 etykiet, każda do 80 znaków. */
function normalizePhotoTagi(val) {
  if (val == null) return [];
  const list = Array.isArray(val)
    ? val.map((x) => String(x ?? '').trim()).filter(Boolean)
    : String(val)
        .split(/[,;]+/)
        .map((s) => s.trim())
        .filter(Boolean);
  return list.map((s) => s.slice(0, 80)).slice(0, 20);
}

function normalizeIssueTyp(value) {
  const raw = String(value || '').trim();
  const key = raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\s-]+/g, '_');
  const aliases = {
    usterka: 'Awaria_Sprzetu',
    awaria: 'Awaria_Sprzetu',
    awaria_sprzetu: 'Awaria_Sprzetu',
    sprzet: 'Awaria_Sprzetu',
    zastawiony_dojazd: 'Zastawiony_Dojazd',
    dojazd: 'Zastawiony_Dojazd',
    zla_pogoda: 'Zla_Pogoda',
    pogoda: 'Zla_Pogoda',
    brak_dostepu: 'Brak_Dostepu',
    dostep: 'Brak_Dostepu',
    inny: 'Inne',
    inne: 'Inne',
    other: 'Inne',
  };
  return aliases[key] || raw;
}

const taskCreateSchema = z.object({
  klient_nazwa: z.string().trim().min(1, 'klient_nazwa jest wymagane'),
  klient_telefon: z.string().trim().optional().nullable(),
  klient_email: z.string().trim().optional().nullable(),
  adres: z.string().trim().min(1, 'adres jest wymagany'),
  miasto: z.string().trim().min(1, 'miasto jest wymagane'),
  typ_uslugi: z.string().trim().optional().nullable(),
  priorytet: z.string().trim().optional().nullable(),
  wartosc_planowana: z.union([z.number(), z.string()]).optional().nullable(),
  czas_planowany_godziny: z.union([z.number(), z.string()]).optional().nullable(),
  data_planowana: z.string().trim().min(1, 'data_planowana jest wymagana'),
  godzina_rozpoczecia: z.string().trim().optional().nullable(),
  opis: z.string().trim().max(6000).optional().nullable(),
  opis_pracy: z.string().trim().max(6000).optional().nullable(),
  notatki_wewnetrzne: z.string().optional().nullable(),
  notatki: z.string().optional().nullable(),
  oddzial_id: z.union([z.number().int().positive(), z.string().trim()]).optional().nullable(),
  ekipa_id: z.union([z.number().int().positive(), z.string().trim()]).optional().nullable(),
  kierownik_id: z.union([z.number().int().positive(), z.string().trim()]).optional().nullable(),
  wyceniajacy_id: z.union([z.number().int().positive(), z.string().trim()]).optional().nullable(),
  source_ogledziny_id: z.union([z.number().int().positive(), z.string().trim()]).optional().nullable(),
  pin_lat: z.union([z.number(), z.string()]).optional().nullable(),
  pin_lng: z.union([z.number(), z.string()]).optional().nullable(),
  ankieta_uproszczona: z.boolean().optional(),
  wywoz: z.boolean().optional(),
  usuwanie_pni: z.boolean().optional(),
  czas_realizacji_godz: z.union([z.number(), z.string()]).optional().nullable(),
  rebak: z.boolean().optional(),
  pila_wysiegniku: z.boolean().optional(),
  nozyce_dlugie: z.boolean().optional(),
  kosiarka: z.boolean().optional(),
  podkaszarka: z.boolean().optional(),
  lopata: z.boolean().optional(),
  mulczer: z.boolean().optional(),
  ilosc_osob: z.union([z.number(), z.string()]).optional().nullable(),
  arborysta: z.boolean().optional(),
  wynik: z.string().trim().max(4000).optional().nullable(),
  budzet: z.union([z.number(), z.string()]).optional().nullable(),
  rabat: z.union([z.number(), z.string()]).optional().nullable(),
  kwota_minimalna: z.union([z.number(), z.string()]).optional().nullable(),
  zrebki: z.string().trim().max(100).optional().nullable(),
  drzewno: z.string().trim().max(200).optional().nullable(),
  status: z.enum(['Nowe', 'Wycena_Terenowa', 'Do_Zatwierdzenia', 'Zaplanowane', 'W_Realizacji', 'Zakonczone', 'Anulowane']).optional(),
});

const taskUpdateSchema = z.object({
  klient_nazwa: z.string().trim().min(1, 'klient_nazwa jest wymagane'),
  klient_telefon: z.string().trim().optional().nullable(),
  klient_email: z.string().trim().optional().nullable(),
  adres: z.string().trim().min(1, 'adres jest wymagany'),
  miasto: z.string().trim().min(1, 'miasto jest wymagane'),
  typ_uslugi: z.string().trim().optional().nullable(),
  priorytet: z.string().trim().optional().nullable(),
  wartosc_planowana: z.union([z.number(), z.string()]).optional().nullable(),
  /** Kwota po dodatkowych pracach / korekcie (opcjonalnie przy realizacji). */
  wartosc_rzeczywista: z.union([z.number(), z.string()]).optional().nullable(),
  czas_planowany_godziny: z.union([z.number(), z.string()]).optional().nullable(),
  data_planowana: z.string().trim().min(1, 'data_planowana jest wymagana'),
  godzina_rozpoczecia: z.string().trim().optional().nullable(),
  notatki_wewnetrzne: z.string().optional().nullable(),
  notatki: z.string().optional().nullable(),
  /** Zakres / dodatkowa praca (opis dla ekipy i biura). */
  opis: z.string().optional().nullable(),
  opis_pracy: z.string().optional().nullable(),
  notatki_klienta: z.string().optional().nullable(),
  oddzial_id: z.union([z.number().int().positive(), z.string().trim()]).optional().nullable(),
  ekipa_id: z.union([z.number().int().positive(), z.string().trim()]).optional().nullable(),
  kierownik_id: z.union([z.number().int().positive(), z.string().trim()]).optional().nullable(),
  wyceniajacy_id: z.union([z.number().int().positive(), z.string().trim()]).optional().nullable(),
  status: z.enum(['Nowe', 'Wycena_Terenowa', 'Do_Zatwierdzenia', 'Zaplanowane', 'W_Realizacji', 'Zakonczone', 'Anulowane']).optional(),
  absence_override: z.boolean().optional(),
  wywoz: z.boolean().optional(),
  usuwanie_pni: z.boolean().optional(),
  czas_realizacji_godz: z.union([z.number(), z.string()]).optional().nullable(),
  rebak: z.boolean().optional(),
  pila_wysiegniku: z.boolean().optional(),
  nozyce_dlugie: z.boolean().optional(),
  kosiarka: z.boolean().optional(),
  podkaszarka: z.boolean().optional(),
  lopata: z.boolean().optional(),
  mulczer: z.boolean().optional(),
  ilosc_osob: z.union([z.number(), z.string()]).optional().nullable(),
  arborysta: z.boolean().optional(),
  wynik: z.string().trim().max(4000).optional().nullable(),
  budzet: z.union([z.number(), z.string()]).optional().nullable(),
  rabat: z.union([z.number(), z.string()]).optional().nullable(),
  kwota_minimalna: z.union([z.number(), z.string()]).optional().nullable(),
  zrebki: z.string().trim().max(100).optional().nullable(),
  drzewno: z.string().trim().max(200).optional().nullable(),
});

/** PATCH /tasks/:id/plan — tylko termin (`data_planowana`). */
const taskPlanPatchSchema = z.object({
  data_planowana: z.string().trim().min(1, 'data_planowana jest wymagana'),
  godzina_rozpoczecia: z.string().trim().optional().nullable(),
  ekipa_id: z.union([z.number().int().positive(), z.string().trim()]).optional().nullable(),
  absence_override: z.boolean().optional(),
});

const taskTimeWindowProposalSchema = z.object({
  proposed_date: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Podaj date w formacie YYYY-MM-DD'),
  okno_od: z.string().trim().regex(/^\d{1,2}:\d{2}$/, 'Podaj godzine HH:MM'),
  okno_do: z.string().trim().regex(/^\d{1,2}:\d{2}$/, 'Podaj godzine HH:MM'),
  note: z.string().trim().max(2000).optional().nullable(),
  expires_at: z.string().trim().max(80).optional().nullable(),
  send_sms: z.boolean().optional(),
});

const publicTimeWindowTokenParamsSchema = z.object({
  token: z.string().trim().min(20).max(120).regex(/^[a-zA-Z0-9_-]+$/),
});

const publicTimeWindowDecisionSchema = z.object({
  decision: z.enum(['accepted', 'rejected']),
  client_note: z.string().trim().max(2000).optional().nullable(),
});

const taskKommoRetrySchema = z.object({
  force: z.boolean().optional(),
});

const taskAssignSchema = z.object({
  ekipa_id: z.union([z.number().int().positive(), z.string().trim().min(1)]),
  absence_override: z.boolean().optional(),
});

const taskStatusSchema = z.object({
  status: z.enum(['Nowe', 'Wycena_Terenowa', 'Do_Zatwierdzenia', 'Zaplanowane', 'W_Realizacji', 'Zakonczone', 'Anulowane']),
});

const TASK_FORWARD_TRANSITIONS = Object.freeze({
  Nowe: ['Wycena_Terenowa'],
  Wycena_Terenowa: ['Do_Zatwierdzenia'],
  Do_Zatwierdzenia: ['Zaplanowane'],
  Zaplanowane: ['W_Realizacji'],
  W_Realizacji: ['Zakonczone'],
  Zakonczone: [],
  Anulowane: [],
});
const CLOSED_TASK_STATUSES_FLOW = new Set(['Zakonczone', 'Anulowane']);

function canTaskStatusTransition(fromStatus, toStatus, options = {}) {
  const from = String(fromStatus || 'Nowe');
  const to = String(toStatus || '');
  if (!to) return false;
  if (from === to) return true;
  const next = [...(TASK_FORWARD_TRANSITIONS[from] || [])];
  if (options.allowCancel !== false && !CLOSED_TASK_STATUSES_FLOW.has(from) && !next.includes('Anulowane')) {
    next.push('Anulowane');
  }
  return next.includes(to);
}

const TASK_WORKFLOW_STAGES = Object.freeze({
  Nowe: { key: 'intake', step: '1', label: 'Telefon', detail: 'biuro przyjmuje zgloszenie' },
  Wycena_Terenowa: { key: 'fieldInspection', step: '2', label: 'Ogledziny', detail: 'specjalista ds. wyceny zbiera zdjecia, zakres i budzet' },
  Do_Zatwierdzenia: { key: 'officeApproval', step: '3', label: 'Biuro planuje', detail: 'klient zaakceptowal, biuro dopina szczegoly' },
  Zaplanowane: { key: 'crewReady', step: '4', label: 'Ekipa gotowa', detail: 'termin, brygada i sprzet sa ustawione' },
  W_Realizacji: { key: 'execution', step: '5', label: 'Wykonanie', detail: 'ekipa pracuje wedlug briefu' },
  Zakonczone: { key: 'done', step: '6', label: 'Zamkniecie', detail: 'dowody i rozliczenie kompletne' },
  Anulowane: { key: 'cancelled', step: 'X', label: 'Anulowane', detail: 'zlecenie wycofane z procesu' },
});

function normalizeTaskStatusFlow(status) {
  const raw = String(status || 'Nowe');
  return raw === 'Zako\u0144czone' ? 'Zakonczone' : raw;
}

function hasTaskText(row, fields) {
  return fields.some((field) => String(row?.[field] || '').trim());
}

function hasTaskNumber(row, fields) {
  return fields.some((field) => {
    const value = row?.[field];
    if (value === null || value === undefined || value === '') return false;
    const n = Number(value);
    return Number.isFinite(n) && n > 0;
  });
}

function taskPhotoCount(row, ...fields) {
  for (const field of fields) {
    const value = Number(row?.[field]);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return 0;
}

function buildTaskWorkflowMissing(row = {}) {
  const status = normalizeTaskStatusFlow(row.status);
  const missing = [];
  const add = (key, label, required = true) => missing.push({ key, label, required });
  const hasBrief = hasTaskText(row, ['opis_pracy', 'opis', 'wynik', 'notatki_wewnetrzne']);
  const hasPrice = hasTaskNumber(row, ['wartosc_planowana', 'budzet']);
  const hasHours = hasTaskNumber(row, ['czas_planowany_godziny', 'czas_realizacji_godz']);
  const hasDate = Boolean(String(row.data_planowana || '').trim());
  const hasTeam = Boolean(row.ekipa_id || row.ekipa_nazwa);
  const hasEquipment = hasTaskNumber(row, ['equipment_reserved_count', 'sprzet_reserved_count', 'rezerwacje_sprzetu_count']) ||
    hasTaskText(row, ['equipment_reserved_names', 'sprzet_notatka']);
  const photoWycena = taskPhotoCount(row, 'photo_wycena', 'photos_wycena');
  const photoSzkic = taskPhotoCount(row, 'photo_szkic', 'photos_szkic');
  const photoDojazd = taskPhotoCount(row, 'photo_dojazd', 'photos_dojazd');

  if (status === 'Nowe') {
    if (!hasTaskText(row, ['klient_nazwa'])) add('client', 'klient');
    if (!hasTaskText(row, ['klient_telefon'])) add('phone', 'telefon klienta');
    if (!hasTaskText(row, ['adres', 'miasto'])) add('address', 'adres realizacji');
    if (!hasDate) add('inspection_date', 'termin ogledzin');
    if (!row.wyceniajacy_id) add('estimator', 'specjalista ds. wyceny');
    return missing;
  }

  if (['Wycena_Terenowa', 'Do_Zatwierdzenia', 'Zaplanowane', 'W_Realizacji'].includes(status)) {
    if (!hasBrief) add('brief', 'opis / zakres prac');
  }

  if (['Wycena_Terenowa', 'Do_Zatwierdzenia'].includes(status)) {
    if (photoWycena <= 0) add('photo_wycena', 'zdjecie ogolne / wycena');
    if (photoSzkic <= 0) add('photo_szkic', 'szkic zakresu');
    if (photoDojazd <= 0) add('photo_dojazd', 'dojazd / posesja', false);
    if (!hasPrice) add('price', 'cena / budzet');
    if (!hasHours) add('hours', 'czas pracy');
  }

  if (['Do_Zatwierdzenia', 'Zaplanowane', 'W_Realizacji'].includes(status)) {
    if (!hasTeam) add('team', 'ekipa');
    if (!hasDate) add('work_date', 'termin pracy');
    if (!hasEquipment) add('equipment', 'sprzet', false);
  }

  return missing;
}

function taskMoneyAndTimeReadiness(row = {}) {
  const value = Number(row.wartosc_planowana ?? row.budzet ?? row.wartosc_zaproponowana ?? row.wartosc_szacowana ?? 0);
  const hours = Number(row.czas_planowany_godziny ?? row.czas_realizacji_godz ?? 0);
  const hasValue = Number.isFinite(value) && value > 0;
  const hasHours = Number.isFinite(hours) && hours > 0;
  return {
    ready: hasValue && hasHours,
    value,
    hours,
    label: hasValue && hasHours
      ? `${value.toLocaleString('pl-PL')} PLN / ${hours}h`
      : hasValue
        ? `${value.toLocaleString('pl-PL')} PLN / brak h`
        : hasHours
          ? `brak ceny / ${hours}h`
          : 'brak',
  };
}

function taskEquipmentReadiness(row = {}) {
  const directCount = Number(
    row.equipment_reserved_count ??
    row.sprzet_reserved_count ??
    row.rezerwacje_sprzetu_count ??
    0
  );
  const noteEquipment = extractLabeledNote(row, 'Sprzet');
  const names = String(row.equipment_reserved_names || row.sprzet_notatka || noteEquipment || '').trim();
  const notes = String([row.notatki_wewnetrzne, row.notatki, row.sprzet_notatka].filter(Boolean).join('\n')).toLowerCase();
  const explicitNoEquipment = /bez\s+(dodatkowego\s+)?sprz[eę]tu|sprz[eę]t\s*:\s*(brak|-|nie)/i.test(notes);
  const ids = row.sprzet_ids ?? row.sprzetIds;
  const idsCount = Array.isArray(ids)
    ? ids.filter(Boolean).length
    : typeof ids === 'string'
      ? ids.split(',').map((id) => id.trim()).filter(Boolean).length
      : 0;
  const equipmentFlags = [
    'rebak',
    'pila_wysiegniku',
    'nozyce_dlugie',
    'kosiarka',
    'podkaszarka',
    'lopata',
    'mulczer',
    'arborysta',
  ];
  const flagCount = equipmentFlags.filter((key) => Boolean(row[key])).length;
  const count = Math.max(
    Number.isFinite(directCount) ? directCount : 0,
    idsCount,
    flagCount,
  );
  return {
    ready: count > 0 || Boolean(names) || explicitNoEquipment,
    count,
    label: count > 0 ? `${count} poz.` : names || (explicitNoEquipment ? 'bez dodatkowego' : 'brak'),
  };
}

function taskRiskReadiness(row = {}) {
  const raw = String([
    row.notatki_wewnetrzne,
    row.notatki,
    row.opis,
    row.opis_pracy,
    row.wynik,
  ].filter(Boolean).join('\n')).toLowerCase();
  return /ryzyk|bhp|zgod|linie|ogrodzenie|dach|elewac|trudny dojazd|ruch pieszy|brak szczegolnych/.test(raw);
}

function taskPhotoReadiness(row = {}) {
  const wycena = taskPhotoCount(row, 'photo_wycena', 'photos_wycena');
  const szkic = taskPhotoCount(row, 'photo_szkic', 'photos_szkic');
  const dojazd = taskPhotoCount(row, 'photo_dojazd', 'photos_dojazd');
  return {
    ready: wycena > 0 && szkic > 0 && dojazd > 0,
    totalReady: [wycena, szkic, dojazd].filter((count) => count > 0).length,
    totalRequired: 3,
    label: `${[wycena, szkic, dojazd].filter((count) => count > 0).length}/3`,
  };
}

function decorateReadinessChecks(checks) {
  const readyCount = checks.filter((item) => item.ready).length;
  const missing = checks.filter((item) => !item.ready);
  return {
    checks,
    ready: missing.length === 0,
    ready_count: readyCount,
    total_count: checks.length,
    missing_items: missing.map((item) => ({
      key: item.key,
      label: item.label,
      value: item.value,
    })),
    missing_labels: missing.map((item) => item.label),
  };
}

function taskOfficePlanReadiness(row = {}) {
  const photos = taskPhotoReadiness(row);
  const moneyAndTime = taskMoneyAndTimeReadiness(row);
  const equipment = taskEquipmentReadiness(row);
  const hasScope = hasTaskText(row, ['opis_pracy', 'opis', 'wynik', 'notatki_wewnetrzne', 'typ_uslugi']);
  const hasTeam = Boolean(row.ekipa_id || row.ekipa_nazwa);
  const hasSlot = Boolean(String(row.data_planowana || '').trim()) && hasTaskNumber(row, ['czas_planowany_godziny', 'czas_realizacji_godz']);
  return decorateReadinessChecks([
    { key: 'photos', label: 'Zdjecia', value: photos.label, ready: photos.ready },
    { key: 'scope', label: 'Zakres', value: hasScope ? 'OK' : 'brak', ready: hasScope },
    { key: 'money_time', label: 'Cena/czas', value: moneyAndTime.label, ready: moneyAndTime.ready },
    { key: 'team', label: 'Ekipa', value: row.ekipa_nazwa || (row.ekipa_id ? `#${row.ekipa_id}` : 'brak'), ready: hasTeam },
    { key: 'slot', label: 'Termin', value: String(row.data_planowana || '').trim() ? 'OK' : 'brak', ready: hasSlot },
    { key: 'equipment', label: 'Sprzet', value: equipment.label, ready: equipment.ready },
  ]);
}

function taskCrewExecutionReadiness(row = {}) {
  const office = taskOfficePlanReadiness(row);
  const hasAddress = hasTaskText(row, ['adres', 'miasto']);
  const riskReady = taskRiskReadiness(row);
  return decorateReadinessChecks([
    { key: 'address', label: 'Adres', value: hasAddress ? 'OK' : 'brak', ready: hasAddress },
    ...office.checks,
    { key: 'risk', label: 'BHP', value: riskReady ? 'OK' : 'brak', ready: riskReady },
  ]);
}

function getTaskTransitionBlockers(row = {}, toStatus) {
  const fromStatus = normalizeTaskStatusFlow(row.status);
  const nextStatus = normalizeTaskStatusFlow(toStatus);
  if (!nextStatus || fromStatus === nextStatus || nextStatus === 'Anulowane') return [];
  const decorated = decorateTaskWorkflow(row);
  if (fromStatus === 'Do_Zatwierdzenia' && nextStatus === 'Zaplanowane') {
    return decorated.office_plan_missing_items || [];
  }
  if (fromStatus === 'Zaplanowane' && nextStatus === 'W_Realizacji') {
    return decorated.crew_execution_missing_items || [];
  }
  if (decorated.workflow_next_status === nextStatus) {
    return (decorated.workflow_missing_items || []).filter((item) => item.required !== false);
  }
  return [];
}

function taskTransitionBlockedPayload(fromStatus, toStatus, blockers = []) {
  const missingItems = blockers.map((item) => ({
    key: item.key,
    label: item.label,
    value: item.value,
  }));
  return {
    error: `Nie można przejść dalej: ${fromStatus || 'brak'} -> ${toStatus || 'brak'}. Uzupełnij wymagane dane.`,
    code: 'TASK_WORKFLOW_BLOCKED',
    from_status: fromStatus || null,
    to_status: toStatus || null,
    missing_items: missingItems,
    missing_labels: missingItems.map((item) => item.label),
  };
}

function decorateTaskWorkflow(row = {}) {
  const status = normalizeTaskStatusFlow(row.status);
  const stage = TASK_WORKFLOW_STAGES[status] || TASK_WORKFLOW_STAGES.Nowe;
  const missing = buildTaskWorkflowMissing(row);
  const officePlan = taskOfficePlanReadiness(row);
  const crewExecution = taskCrewExecutionReadiness(row);
  const blockers = missing.filter((item) => item.required);
  const nextStatus = (TASK_FORWARD_TRANSITIONS[status] || [])[0] || null;
  const readyForNext = Boolean(nextStatus) && blockers.length === 0;
  const nextAction = CLOSED_TASK_STATUSES_FLOW.has(status)
    ? 'Zamkniete'
    : blockers[0]
      ? `Uzupelnij: ${blockers[0].label}`
      : nextStatus
        ? `Przejdz do: ${TASK_WORKFLOW_STAGES[nextStatus]?.label || nextStatus}`
        : 'Otworz szczegoly';

  return {
    ...row,
    workflow_stage: stage.key,
    workflow_stage_step: stage.step,
    workflow_stage_label: stage.label,
    workflow_stage_detail: stage.detail,
    workflow_next_status: nextStatus,
    workflow_next_action: nextAction,
    workflow_ready_for_next: readyForNext,
    workflow_blockers_count: blockers.length,
    workflow_missing_items: missing,
    workflow_missing_labels: missing.map((item) => item.label),
    office_plan_ready: officePlan.ready,
    office_plan_ready_count: officePlan.ready_count,
    office_plan_total_count: officePlan.total_count,
    office_plan_checks: officePlan.checks,
    office_plan_missing_items: officePlan.missing_items,
    office_plan_missing_labels: officePlan.missing_labels,
    crew_execution_ready: crewExecution.ready,
    crew_execution_ready_count: crewExecution.ready_count,
    crew_execution_total_count: crewExecution.total_count,
    crew_execution_checks: crewExecution.checks,
    crew_execution_missing_items: crewExecution.missing_items,
    crew_execution_missing_labels: crewExecution.missing_labels,
  };
}

function decorateTaskWorkflowRows(rows = []) {
  return rows.map((row) => decorateTaskWorkflow(row));
}

const TASK_WORK_LOG_AGG_SELECT = `
        COALESCE(wl.work_logs_total, 0)::int AS work_logs_total,
        COALESCE(wl.active_work_count, 0)::int AS active_work_count,
        wl.last_checkin_at,
        wl.active_work_started_at,
        wl.last_work_finished_at`;

const TASK_WORK_LOG_AGG_JOIN = `
       LEFT JOIN (
         SELECT
           task_id,
           COUNT(*)::int AS work_logs_total,
           COUNT(*) FILTER (
             WHERE end_time IS NULL
               AND LOWER(COALESCE(status, '')) NOT LIKE '%check%'
           )::int AS active_work_count,
           MAX(start_time) FILTER (
             WHERE LOWER(COALESCE(status, '')) LIKE '%check%'
           ) AS last_checkin_at,
           MAX(start_time) FILTER (
             WHERE end_time IS NULL
               AND LOWER(COALESCE(status, '')) NOT LIKE '%check%'
           ) AS active_work_started_at,
           MAX(end_time) FILTER (
             WHERE end_time IS NOT NULL
               AND LOWER(COALESCE(status, '')) NOT LIKE '%check%'
           ) AS last_work_finished_at
         FROM work_logs
         GROUP BY task_id
       ) wl ON wl.task_id = t.id`;

const TASK_ISSUE_AGG_SELECT = `
        COALESCE(ia.problem_total, 0)::int AS problem_total,
        COALESCE(ia.problem_open, 0)::int AS problem_open`;

const TASK_ISSUE_AGG_JOIN = `
       LEFT JOIN (
         SELECT
           task_id,
           COUNT(*)::int AS problem_total,
           COUNT(*) FILTER (
             WHERE LOWER(COALESCE(status, '')) NOT LIKE 'rozwi%'
               AND LOWER(COALESCE(status, '')) NOT LIKE 'zamkn%'
               AND LOWER(COALESCE(status, '')) NOT LIKE 'resolved%'
               AND LOWER(COALESCE(status, '')) NOT LIKE 'done%'
           )::int AS problem_open
         FROM issues
         GROUP BY task_id
       ) ia ON ia.task_id = t.id`;

async function fetchTaskWorkflowRow(taskId) {
  const result = await pool.query(
    `SELECT t.*,
        te.nazwa as ekipa_nazwa,
        COALESCE(ps.photo_total, 0)::int AS photo_total,
        COALESCE(ps.photo_wycena, 0)::int AS photo_wycena,
        COALESCE(ps.photo_szkic, 0)::int AS photo_szkic,
        COALESCE(ps.photo_dojazd, 0)::int AS photo_dojazd,
        COALESCE(er.equipment_reserved_count, 0)::int AS equipment_reserved_count,
        COALESCE(er.equipment_reserved_names, '') AS equipment_reserved_names,
        ${TASK_WORK_LOG_AGG_SELECT},
        ${TASK_ISSUE_AGG_SELECT}
       FROM tasks t
       LEFT JOIN teams te ON t.ekipa_id = te.id
       LEFT JOIN (
         SELECT
           p.task_id,
           COUNT(*)::int AS photo_total,
           COUNT(*) FILTER (WHERE LOWER(COALESCE(p.typ, '')) IN ('wycena', 'przed', 'checkin'))::int AS photo_wycena,
           COUNT(*) FILTER (WHERE LOWER(COALESCE(p.typ, '')) IN ('szkic', 'sketch'))::int AS photo_szkic,
           COUNT(*) FILTER (WHERE LOWER(COALESCE(p.typ, '')) IN ('dojazd', 'posesja', 'dojazd_posesja'))::int AS photo_dojazd
         FROM photos p
         GROUP BY p.task_id
       ) ps ON ps.task_id = t.id
       LEFT JOIN (
         SELECT
           r.task_id,
           COUNT(*) FILTER (WHERE LOWER(COALESCE(r.status, '')) NOT LIKE 'anul%')::int AS equipment_reserved_count,
           STRING_AGG(e.nazwa, ', ' ORDER BY e.nazwa) FILTER (WHERE LOWER(COALESCE(r.status, '')) NOT LIKE 'anul%') AS equipment_reserved_names
         FROM equipment_reservations r
         LEFT JOIN equipment_items e ON e.id = r.sprzet_id
         WHERE r.task_id IS NOT NULL
         GROUP BY r.task_id
       ) er ON er.task_id = t.id
       ${TASK_WORK_LOG_AGG_JOIN}
       ${TASK_ISSUE_AGG_JOIN}
       WHERE t.id = $1`,
    [taskId]
  );
  return result.rows[0] || null;
}

const taskFieldPackageSchema = z.object({
  opis: z.string().trim().max(6000).optional().nullable(),
  zakres_prac: z.string().trim().max(6000).optional().nullable(),
  ryzyka: z.string().trim().max(3000).optional().nullable(),
  typy_prac: z.array(z.string().trim().max(120)).max(20).optional(),
  sprzet: z.array(z.string().trim().max(120)).max(30).optional(),
  warunki_rozliczenia: z.string().trim().max(1000).optional().nullable(),
  odpady: z.string().trim().max(1000).optional().nullable(),
  czas_planowany_godziny: z.union([z.number(), z.string()]).optional().nullable(),
  wartosc_planowana: z.union([z.number(), z.string()]).optional().nullable(),
  klient_zaakceptowal: z.boolean().optional(),
  send_to_office: z.boolean().optional(),
});

const taskOfficePlanSchema = z.object({
  data_planowana: z.string().trim().min(1, 'data_planowana jest wymagana'),
  godzina_rozpoczecia: z.string().trim().max(8).optional().nullable(),
  czas_planowany_godziny: z.union([z.number(), z.string()]).optional().nullable(),
  ekipa_id: z.union([z.number().int().positive(), z.string().trim().min(1)]),
  sprzet_notatka: z.string().trim().max(2000).optional().nullable(),
  sprzet_ids: z.array(z.union([z.number().int().positive(), z.string().trim().min(1)])).max(30).optional(),
  absence_override: z.boolean().optional(),
});

const taskClientContactSchema = z.object({
  status: z.enum(['todo', 'informed', 'waiting', 'risk']).optional(),
  note: z.string().max(2000).optional().nullable(),
  due_at: z.string().trim().max(80).optional().nullable(),
});

const taskClosureDecisionItemSchema = z.object({
  key: z.string().trim().max(120).optional().nullable(),
  label: z.string().trim().max(240).optional().nullable(),
  detail: z.string().trim().max(1200).optional().nullable(),
  required: z.boolean().optional().nullable(),
}).passthrough();

const taskClosureDecisionSchema = z.object({
  action: z.enum(['blocked_attempt', 'warning_review', 'forced_close', 'clean_close', 'fix_started']),
  severity: z.enum(['good', 'warning', 'danger']).optional().nullable(),
  status_before: z.string().trim().max(64).optional().nullable(),
  status_after: z.string().trim().max(64).optional().nullable(),
  blockers: z.array(taskClosureDecisionItemSchema).max(40).optional().default([]),
  warnings: z.array(taskClosureDecisionItemSchema).max(40).optional().default([]),
  risk_score: z.coerce.number().int().min(0).max(10000).optional().default(0),
  quality_score: z.coerce.number().int().min(0).max(10000).optional().default(0),
  value: z.coerce.number().min(0).max(999999999).optional().default(0),
  note: z.string().trim().max(2000).optional().nullable(),
});

const taskClientSignatureSchema = z.object({
  signer_name: z.string().trim().min(2).max(120),
  signature_data_url: z.string().trim().max(400000).optional().nullable(),
  signed_at: z.string().trim().max(80).optional().nullable(),
  note: z.string().trim().max(1000).optional().nullable(),
});

const taskStartSchema = z.object({
  lat: z.union([z.number(), z.string().trim().min(1)]).optional().nullable(),
  lng: z.union([z.number(), z.string().trim().min(1)]).optional().nullable(),
  /** Dmuchawa / filtr — sprawny i wyczyszczony (Brygadzista / Pomocnik — wymagane przy starcie). */
  dmuchawa_filtr_ok: z.boolean().optional(),
  /** Rębak zatankowany (wymagane dla ekipy). */
  rebak_zatankowany: z.boolean().optional(),
  /** Pomocnicy i brygadzysta w kaskach (wymagane dla ekipy). */
  kaski_zespol: z.boolean().optional(),
  /** Krótkie BHP — potwierdzenie zapoznania (musi być true dla ekipy). */
  bhp_potwierdzone: z.boolean().optional(),
  bhp_checklista: z.array(z.object({
    key: z.string().trim().min(1).max(80),
    label: z.string().trim().min(1).max(160),
    hint: z.string().trim().max(500).optional().nullable(),
    done: z.boolean(),
  })).max(50).optional(),
});

const taskCheckinSchema = z.object({
  lat: z.union([z.number(), z.string().trim().min(1)]).optional().nullable(),
  lng: z.union([z.number(), z.string().trim().min(1)]).optional().nullable(),
  note: z.string().trim().max(1000).optional().nullable(),
});

const taskStopSchema = z.object({
  lat: z.union([z.number(), z.string().trim().min(1)]).optional().nullable(),
  lng: z.union([z.number(), z.string().trim().min(1)]).optional().nullable(),
  work_log_id: z.union([z.number().int().positive(), z.string().trim().min(1)]),
});

const paymentCloseSchema = z.object({
  forma_platnosc: z.enum(['Gotowka', 'Przelew', 'Faktura_VAT', 'Brak']),
  kwota_odebrana: z.union([z.number(), z.string()]).optional().nullable(),
  faktura_vat: z.boolean().optional(),
  nip: z.string().max(20).optional().nullable(),
  notatki: z.string().max(2000).optional().nullable(),
});

const taskFinishMaterialRowSchema = z.object({
  material_id: z.coerce.number().int().positive().optional().nullable(),
  nazwa: z.string().trim().min(1).max(200),
  ilosc: z.coerce.number().optional().nullable(),
  jednostka: z.string().trim().max(24).optional().nullable(),
  koszt_jednostkowy: z.coerce.number().optional().nullable(),
  koszt_laczny: z.coerce.number().optional().nullable(),
  notatka: z.string().trim().max(500).optional().nullable(),
});

const taskOperationalCostRowSchema = z.object({
  category: z.enum(['sprzet', 'paliwo', 'utylizacja', 'inne']).optional(),
  kategoria: z.enum(['sprzet', 'paliwo', 'utylizacja', 'inne']).optional(),
  label: z.string().trim().max(200).optional().nullable(),
  amount: z.coerce.number().optional().nullable(),
  kwota: z.coerce.number().optional().nullable(),
  koszt: z.coerce.number().optional().nullable(),
  source: z.string().trim().max(80).optional().nullable(),
  note: z.string().trim().max(500).optional().nullable(),
});

const taskFinishSchema = z.object({
  lat: z.union([z.number(), z.string().trim().min(1)]).optional().nullable(),
  lng: z.union([z.number(), z.string().trim().min(1)]).optional().nullable(),
  notatki: z.string().optional().nullable(),
  payment: paymentCloseSchema.optional(),
  zuzyte_materialy: z.array(taskFinishMaterialRowSchema).max(50).optional(),
  koszty_operacyjne: z.array(taskOperationalCostRowSchema).max(50).optional(),
});

const extraWorkCreateSchema = z.object({
  opis: z.string().trim().min(1).max(4000),
});

const extraWorkQuoteSchema = z.object({
  amount_pln: z.union([z.number(), z.string()]),
});

const extraWorkAcceptSchema = z.object({
  channel: z.enum(['na_miejscu', 'sms']),
});
const extraWorkRejectSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});

const ewIdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
  ewId: z.coerce.number().int().positive(),
});

const taskProblemSchema = z.object({
  typ: z.string().trim().min(1, 'typ jest wymagany'),
  opis: z.string().trim().max(4000).optional().nullable(),
});

const taskIdParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

const taskPhotoIdParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
  photoId: z.coerce.number().int().positive(),
});

const taskDocumentIdParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
  docId: z.coerce.number().int().positive(),
});

const taskPhotoPatchSchema = z
  .object({
    opis: z.string().max(4000).nullable().optional(),
    typ: z.string().trim().max(80).nullable().optional(),
    tagi: z.union([z.string(), z.array(z.string()), z.null()]).optional(),
  })
  .passthrough();

const taskListQuerySchema = z.object({
  oddzial_id: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  from: z.string().trim().max(20).optional(),
  to: z.string().trim().max(20).optional(),
});

const taskMojeQuerySchema = z.object({
  data: z.string().max(20).optional(),
});

router.get('/time-window/:token', validateParams(publicTimeWindowTokenParamsSchema), async (req, res) => {
  try {
    await ensureTaskTimeWindowTables();
    const { rows } = await pool.query(
      `SELECT p.id, p.task_id, p.proposed_date::text AS proposed_date,
              p.okno_od::text AS okno_od, p.okno_do::text AS okno_do,
              p.status, p.note, p.client_note, p.expires_at, p.created_at, p.decided_at,
              t.klient_nazwa, t.adres, t.miasto, t.typ_uslugi, t.status AS task_status,
              b.nazwa AS oddzial_nazwa, b.telefon AS oddzial_telefon
         FROM task_time_window_proposals p
         JOIN tasks t ON t.id = p.task_id
         LEFT JOIN branches b ON b.id = t.oddzial_id
        WHERE p.token = $1
        LIMIT 1`,
      [req.params.token]
    );
    const row = rows[0];
    if (!row) return res.status(404).json({ error: 'Nie znaleziono propozycji terminu.' });
    const expired = row.expires_at && new Date(row.expires_at).getTime() < Date.now();
    res.json({
      proposal: {
        id: row.id,
        task_id: row.task_id,
        proposed_date: row.proposed_date,
        okno_od: normalizeTimeHm(row.okno_od),
        okno_do: normalizeTimeHm(row.okno_do),
        status: expired && row.status === 'pending' ? 'expired' : row.status,
        note: row.note,
        client_note: row.client_note,
        expires_at: row.expires_at,
        created_at: row.created_at,
        decided_at: row.decided_at,
      },
      task: {
        service: row.typ_uslugi,
        address: [row.adres, row.miasto].filter(Boolean).join(', '),
        client_name: row.klient_nazwa,
        status: row.task_status,
      },
      branch: {
        name: row.oddzial_nazwa,
        phone: row.oddzial_telefon,
      },
    });
  } catch (err) {
    logger.error('tasks.timeWindow.publicGet', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

router.post('/time-window/:token/decision', validateParams(publicTimeWindowTokenParamsSchema), validateBody(publicTimeWindowDecisionSchema), async (req, res) => {
  try {
    await ensureTaskTimeWindowTables();
    const { decision, client_note } = req.body;
    const { rows } = await pool.query(
      `SELECT p.*, t.status AS task_status
         FROM task_time_window_proposals p
         JOIN tasks t ON t.id = p.task_id
        WHERE p.token = $1
        LIMIT 1`,
      [req.params.token]
    );
    const proposal = rows[0];
    if (!proposal) return res.status(404).json({ error: 'Nie znaleziono propozycji terminu.' });
    if (proposal.status !== 'pending') {
      return res.status(409).json({ error: 'Ta propozycja zostala juz obsluzona.', status: proposal.status });
    }
    if (proposal.expires_at && new Date(proposal.expires_at).getTime() < Date.now()) {
      await pool.query(
        `UPDATE task_time_window_proposals
            SET status = 'expired', client_note = COALESCE($2, client_note), updated_at = NOW()
          WHERE id = $1`,
        [proposal.id, client_note || null]
      );
      return res.status(409).json({ error: 'Ta propozycja terminu wygasla.', status: 'expired' });
    }
    if (decision === 'rejected') {
      await pool.query(
        `UPDATE task_time_window_proposals
            SET status = 'rejected', client_note = $2, decided_at = NOW(), updated_at = NOW()
          WHERE id = $1`,
        [proposal.id, client_note || null]
      );
      return res.json({ status: 'rejected', task_id: proposal.task_id });
    }
    const date = String(proposal.proposed_date).slice(0, 10);
    const start = normalizeTimeHm(proposal.okno_od);
    const end = normalizeTimeHm(proposal.okno_do);
    const plannedDateTime = `${date} ${start}:00`;
    await pool.query(
      `UPDATE task_time_window_proposals
          SET status = 'accepted', client_note = $2, decided_at = NOW(), updated_at = NOW()
        WHERE id = $1`,
      [proposal.id, client_note || null]
    );
    await pool.query(
      `UPDATE tasks
          SET data_planowana = $1::timestamptz,
              godzina_rozpoczecia = COALESCE(godzina_rozpoczecia, $2::time),
              okno_od = $2::time,
              okno_do = $3::time,
              updated_at = NOW()
        WHERE id = $4`,
      [plannedDateTime, start, end, proposal.task_id]
    );
    await recordTaskPublicStatusEvent(pool, {
      taskId: proposal.task_id,
      fromStatus: proposal.task_status,
      toStatus: proposal.task_status,
      source: 'client_time_window',
      note: `Klient zaakceptowal okno ${date} ${start}-${end}`,
    }).catch((error) => logger.warn('tasks.timeWindow.publicStatusEvent', { message: error.message, taskId: proposal.task_id }));
    res.json({ status: 'accepted', task_id: proposal.task_id, proposed_date: date, okno_od: start, okno_do: end });
  } catch (err) {
    logger.error('tasks.timeWindow.publicDecision', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

router.post('/:id/time-window-proposals', authMiddleware, validateParams(taskIdParamsSchema), validateBody(taskTimeWindowProposalSchema), requireTaskAccess, async (req, res) => {
  try {
    if (!canManageTaskBackoffice(req.user)) {
      return res.status(403).json({ error: req.t('errors.auth.forbidden') });
    }
    await ensureTaskTimeWindowTables();
    const taskId = Number(req.params.id);
    const start = normalizeTimeHm(req.body.okno_od);
    const end = normalizeTimeHm(req.body.okno_do);
    if (!start || !end || timeHmToMinutes(end) <= timeHmToMinutes(start)) {
      return res.status(400).json({ error: 'Okno czasowe jest nieprawidlowe.' });
    }
    const taskR = await pool.query(
      `SELECT t.*, b.telefon AS oddzial_telefon, b.nazwa AS oddzial_nazwa
         FROM tasks t
         LEFT JOIN branches b ON b.id = t.oddzial_id
        WHERE t.id = $1
        LIMIT 1`,
      [taskId]
    );
    if (!taskR.rows.length) return res.status(404).json({ error: req.t('errors.generic.notFound') });
    const task = taskR.rows[0];
    const proposalUrlPreview = publicTaskTimeWindowUrl('preview');
    if (req.body.send_sms && !proposalUrlPreview) {
      return res.status(400).json({ error: 'Brak PUBLIC_BASE_URL - nie mozna wyslac publicznego linku SMS.' });
    }
    if (req.body.send_sms && !task.klient_telefon) {
      return res.status(400).json({ error: 'Brak telefonu klienta - nie mozna wyslac SMS z propozycja terminu.' });
    }
    const token = generatePublicStatusToken();
    await pool.query(
      `UPDATE task_time_window_proposals
          SET status = 'superseded', updated_at = NOW()
        WHERE task_id = $1 AND status = 'pending'`,
      [taskId]
    );
    const insert = await pool.query(
      `INSERT INTO task_time_window_proposals
          (task_id, token, proposed_date, okno_od, okno_do, note, proposed_by, expires_at)
       VALUES ($1, $2, $3::date, $4::time, $5::time, $6, $7, $8::timestamptz)
       RETURNING id, task_id, token, proposed_date::text AS proposed_date, okno_od::text AS okno_od,
                 okno_do::text AS okno_do, status, note, expires_at, created_at`,
      [
        taskId,
        token,
        req.body.proposed_date,
        start,
        end,
        req.body.note || null,
        req.user.id || null,
        req.body.expires_at || null,
      ]
    );
    const proposal = insert.rows[0];
    const proposalUrl = publicTaskTimeWindowUrl(proposal.token);
    let sms = null;
    if (req.body.send_sms) {
      const proposedWindow = `${start}-${end}`;
      const rendered = await renderSmsStatusTemplate(pool, {
        templateKey: 'time_window_proposal',
        task,
        context: {
          proposed_date: req.body.proposed_date,
          proposed_window: proposedWindow,
          time_window_url: proposalUrl,
        },
      });
      const smsResult = await sendSmsGateway({
        to: task.klient_telefon,
        body: rendered.body,
        taskId,
        oddzialId: task.oddzial_id,
      });
      sms = {
        ok: Boolean(smsResult.ok),
        provider: smsResult.provider || null,
        sid: smsResult.sid || smsResult.id || null,
        error: smsResult.error || null,
        template: rendered.source,
      };
      if (!smsResult.ok) {
        return res.status(502).json({
          error: smsResult.error || 'Nie udalo sie wyslac SMS z propozycja terminu.',
          proposal: {
            ...proposal,
            okno_od: normalizeTimeHm(proposal.okno_od),
            okno_do: normalizeTimeHm(proposal.okno_do),
            url: proposalUrl,
          },
          sms,
        });
      }
    }
    res.status(201).json({
      proposal: {
        ...proposal,
        okno_od: normalizeTimeHm(proposal.okno_od),
        okno_do: normalizeTimeHm(proposal.okno_do),
        url: proposalUrl,
      },
      sms,
    });
  } catch (err) {
    logger.error('tasks.timeWindow.createProposal', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

router.get('/:id/time-window-proposals', authMiddleware, validateParams(taskIdParamsSchema), requireTaskAccess, async (req, res) => {
  try {
    if (!canManageTaskBackoffice(req.user)) {
      return res.status(403).json({ error: req.t('errors.auth.forbidden') });
    }
    await ensureTaskTimeWindowTables();
    const taskId = Number(req.params.id);
    const { rows } = await pool.query(
      `SELECT p.id, p.task_id, p.token, p.proposed_date::text AS proposed_date,
              p.okno_od::text AS okno_od, p.okno_do::text AS okno_do,
              p.status, p.note, p.client_note, p.created_at, p.updated_at, p.decided_at, p.expires_at,
              u.login AS proposed_by_login,
              h.status AS sms_status,
              h.provider AS sms_provider,
              h.provider_status AS sms_provider_status,
              h.delivery_error_code AS sms_delivery_error_code,
              h.delivery_updated_at AS sms_delivery_updated_at,
              h.delivered_at AS sms_delivered_at,
              h.created_at AS sms_created_at
         FROM task_time_window_proposals p
         LEFT JOIN users u ON u.id = p.proposed_by
         LEFT JOIN LATERAL (
           SELECT *
             FROM sms_history sh
            WHERE sh.task_id = p.task_id
              AND COALESCE(sh.tresc, '') ILIKE '%' || p.token || '%'
            ORDER BY sh.created_at DESC
            LIMIT 1
         ) h ON true
        WHERE p.task_id = $1
        ORDER BY p.created_at DESC
        LIMIT 20`,
      [taskId]
    );
    const items = rows.map((row) => {
      const expired = row.expires_at && new Date(row.expires_at).getTime() < Date.now();
      const effectiveStatus = expired && row.status === 'pending' ? 'expired' : row.status;
      return {
        id: row.id,
        task_id: row.task_id,
        token: row.token,
        url: publicTaskTimeWindowUrl(row.token),
        proposed_date: row.proposed_date,
        okno_od: normalizeTimeHm(row.okno_od),
        okno_do: normalizeTimeHm(row.okno_do),
        status: row.status,
        effective_status: effectiveStatus,
        note: row.note,
        client_note: row.client_note,
        proposed_by_login: row.proposed_by_login,
        created_at: row.created_at,
        updated_at: row.updated_at,
        decided_at: row.decided_at,
        expires_at: row.expires_at,
        sms: row.sms_created_at ? {
          status: row.sms_status,
          provider: row.sms_provider,
          provider_status: row.sms_provider_status,
          delivery_error_code: row.sms_delivery_error_code,
          delivery_updated_at: row.sms_delivery_updated_at,
          delivered_at: row.sms_delivered_at,
          created_at: row.sms_created_at,
        } : null,
      };
    });
    res.json({ items });
  } catch (err) {
    logger.error('tasks.timeWindow.listProposals', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

router.get('/moje', authMiddleware, validateQuery(taskMojeQuerySchema), async (req, res) => {
  try {
    const dzisiaj = req.query.data || new Date().toISOString().split('T')[0];
    const result = await pool.query(
      `SELECT t.*,
        te.nazwa as ekipa_nazwa,
        COALESCE(ps.photo_total, 0)::int AS photo_total,
        COALESCE(ps.photo_wycena, 0)::int AS photo_wycena,
        COALESCE(ps.photo_szkic, 0)::int AS photo_szkic,
        COALESCE(ps.photo_dojazd, 0)::int AS photo_dojazd,
        COALESCE(er.equipment_reserved_count, 0)::int AS equipment_reserved_count,
        COALESCE(er.equipment_reserved_names, '') AS equipment_reserved_names,
        ${TASK_WORK_LOG_AGG_SELECT},
        ${TASK_ISSUE_AGG_SELECT}
       FROM tasks t
       LEFT JOIN teams te ON t.ekipa_id = te.id
       LEFT JOIN team_members tm ON tm.team_id = te.id AND tm.user_id = $2
       LEFT JOIN (
         SELECT
           p.task_id,
           COUNT(*)::int AS photo_total,
           COUNT(*) FILTER (WHERE LOWER(COALESCE(p.typ, '')) IN ('wycena', 'przed', 'checkin'))::int AS photo_wycena,
           COUNT(*) FILTER (WHERE LOWER(COALESCE(p.typ, '')) IN ('szkic', 'sketch'))::int AS photo_szkic,
           COUNT(*) FILTER (WHERE LOWER(COALESCE(p.typ, '')) IN ('dojazd', 'posesja', 'dojazd_posesja'))::int AS photo_dojazd
         FROM photos p
         GROUP BY p.task_id
       ) ps ON ps.task_id = t.id
       LEFT JOIN (
         SELECT
           r.task_id,
           COUNT(*) FILTER (WHERE LOWER(COALESCE(r.status, '')) NOT LIKE 'anul%')::int AS equipment_reserved_count,
           STRING_AGG(e.nazwa, ', ' ORDER BY e.nazwa) FILTER (WHERE LOWER(COALESCE(r.status, '')) NOT LIKE 'anul%') AS equipment_reserved_names
         FROM equipment_reservations r
         LEFT JOIN equipment_items e ON e.id = r.sprzet_id
         WHERE r.task_id IS NOT NULL
         GROUP BY r.task_id
       ) er ON er.task_id = t.id
       ${TASK_WORK_LOG_AGG_JOIN}
       ${TASK_ISSUE_AGG_JOIN}
       WHERE t.data_planowana::date = $1::date
       AND (t.brygadzista_id = $2 OR te.brygadzista_id = $2 OR tm.user_id = $2)
       ORDER BY t.id ASC`,
      [dzisiaj, req.user.id]
    );
    res.json(decorateTaskWorkflowRows(result.rows));
  } catch (err) {
    logger.error('Blad pobierania moich zlecen', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

router.get('/stats', authMiddleware, async (req, res) => {
  try {
    const scope = getTaskScope(req.user, 't', 1);
    const query = `SELECT
      COUNT(*) FILTER (WHERE status = 'Nowe') as nowe,
      COUNT(*) FILTER (WHERE status = 'Wycena_Terenowa') as wycena_terenowa,
      COUNT(*) FILTER (WHERE status = 'Do_Zatwierdzenia') as do_zatwierdzenia,
      COUNT(*) FILTER (WHERE status = 'Zaplanowane') as zaplanowane,
      COUNT(*) FILTER (WHERE status = 'W_Realizacji') as w_realizacji,
      COUNT(*) FILTER (WHERE status = 'Zakonczone') as zakonczone
      FROM tasks t ${scope.clause ? `WHERE ${scope.clause}` : ''}`;
    const params = scope.params;
    const result = await pool.query(query, params);
    res.json(result.rows[0]);
  } catch (err) {
    logger.error('Blad pobierania statystyk zlecen', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

router.get('/', authMiddleware, validateQuery(taskListQuerySchema), (req, res) => {
  const query = new URLSearchParams(req.query).toString();
  const target = `${req.baseUrl}/wszystkie${query ? `?${query}` : ''}`;
  return res.redirect(307, target);
});

router.get('/wszystkie', authMiddleware, validateQuery(taskListQuerySchema), async (req, res) => {
  try {
    const { oddzial_id, limit, offset, from, to } = req.query;
    let whereClause = '';
    let params = [];
    if (isTeamScoped(req.user)) {
      const scope = getTaskScope(req.user, 't', 1);
      whereClause = `WHERE ${scope.clause}`;
      params = scope.params;
    } else if (oddzial_id && canSeeAllTasks(req.user)) {
      whereClause = 'WHERE t.oddzial_id = $1';
      params = [oddzial_id];
    } else if (oddzial_id && isKierownik(req.user)) {
      if (Number(oddzial_id) !== Number(req.user.oddzial_id)) {
        return res.status(403).json({ error: req.t('errors.auth.branchAccessDenied') });
      }
      whereClause = 'WHERE t.oddzial_id = $1';
      params = [req.user.oddzial_id];
    } else if (!canSeeAllTasks(req.user)) {
      const scope = getTaskScope(req.user, 't', 1);
      whereClause = `WHERE ${scope.clause}`;
      params = scope.params;
    }
    const whereParts = whereClause ? [whereClause.replace(/^WHERE\s+/i, '')] : [];
    if (from) {
      params.push(from);
      whereParts.push(`t.data_planowana::date >= $${params.length}::date`);
    }
    if (to) {
      params.push(to);
      whereParts.push(`t.data_planowana::date <= $${params.length}::date`);
    }
    whereClause = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';

    const baseFrom = `
       FROM tasks t
       LEFT JOIN teams te ON t.ekipa_id = te.id
       LEFT JOIN users u ON t.brygadzista_id = u.id
       LEFT JOIN branches b ON t.oddzial_id = b.id
       LEFT JOIN (
         SELECT
           p.task_id,
           COUNT(*)::int AS photo_total,
           COUNT(*) FILTER (WHERE LOWER(COALESCE(p.typ, '')) IN ('wycena', 'przed', 'checkin'))::int AS photo_wycena,
           COUNT(*) FILTER (WHERE LOWER(COALESCE(p.typ, '')) IN ('szkic', 'sketch'))::int AS photo_szkic,
           COUNT(*) FILTER (WHERE LOWER(COALESCE(p.typ, '')) IN ('dojazd', 'posesja', 'dojazd_posesja'))::int AS photo_dojazd
         FROM photos p
         GROUP BY p.task_id
       ) ps ON ps.task_id = t.id
       LEFT JOIN (
         SELECT
           r.task_id,
           COUNT(*) FILTER (WHERE LOWER(COALESCE(r.status, '')) NOT LIKE 'anul%')::int AS equipment_reserved_count,
           STRING_AGG(e.nazwa, ', ' ORDER BY e.nazwa) FILTER (WHERE LOWER(COALESCE(r.status, '')) NOT LIKE 'anul%') AS equipment_reserved_names
         FROM equipment_reservations r
         LEFT JOIN equipment_items e ON e.id = r.sprzet_id
         WHERE r.task_id IS NOT NULL
         GROUP BY r.task_id
       ) er ON er.task_id = t.id
       ${TASK_WORK_LOG_AGG_JOIN}
       ${TASK_ISSUE_AGG_JOIN}
       ${whereClause}`;

    if (limit != null) {
      const lim = limit;
      const off = offset ?? 0;
      const countResult = await pool.query(`SELECT COUNT(*)::int AS c ${baseFrom}`, params);
      const total = countResult.rows[0]?.c ?? 0;
      const p2 = [...params, lim, off];
      const limIdx = params.length + 1;
      const offIdx = params.length + 2;
      const result = await pool.query(
        `SELECT t.*,
        te.nazwa as ekipa_nazwa,
        u.imie || ' ' || u.nazwisko as kierownik_nazwa,
        b.nazwa as oddzial_nazwa,
        COALESCE(ps.photo_total, 0)::int AS photo_total,
        COALESCE(ps.photo_wycena, 0)::int AS photo_wycena,
        COALESCE(ps.photo_szkic, 0)::int AS photo_szkic,
        COALESCE(ps.photo_dojazd, 0)::int AS photo_dojazd,
        COALESCE(er.equipment_reserved_count, 0)::int AS equipment_reserved_count,
        COALESCE(er.equipment_reserved_names, '') AS equipment_reserved_names,
        ${TASK_WORK_LOG_AGG_SELECT},
        ${TASK_ISSUE_AGG_SELECT}
        ${baseFrom}
       ORDER BY t.data_planowana DESC, t.id DESC
       LIMIT $${limIdx} OFFSET $${offIdx}`,
        p2
      );
      return res.json({ items: decorateTaskWorkflowRows(result.rows), total, limit: Number(lim), offset: Number(off) });
    }

    const result = await pool.query(
      `SELECT t.*,
        te.nazwa as ekipa_nazwa,
        u.imie || ' ' || u.nazwisko as kierownik_nazwa,
        b.nazwa as oddzial_nazwa,
        COALESCE(ps.photo_total, 0)::int AS photo_total,
        COALESCE(ps.photo_wycena, 0)::int AS photo_wycena,
        COALESCE(ps.photo_szkic, 0)::int AS photo_szkic,
        COALESCE(ps.photo_dojazd, 0)::int AS photo_dojazd,
        COALESCE(er.equipment_reserved_count, 0)::int AS equipment_reserved_count,
        COALESCE(er.equipment_reserved_names, '') AS equipment_reserved_names,
        ${TASK_WORK_LOG_AGG_SELECT},
        ${TASK_ISSUE_AGG_SELECT}
       ${baseFrom}
       ORDER BY t.data_planowana DESC, t.id DESC`,
      params
    );
    res.json(decorateTaskWorkflowRows(result.rows));
  } catch (err) {
    logger.error('Blad pobierania listy zlecen', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

router.get('/field-drafts', authMiddleware, validateQuery(taskListQuerySchema), async (req, res) => {
  try {
    const { oddzial_id, limit, offset } = req.query;
    let whereParts = [
      `COALESCE(t.ankieta_uproszczona, false) = true`,
      `t.status IN ('Wycena_Terenowa', 'Do_Zatwierdzenia')`,
    ];
    let params = [];

    if (isTeamScoped(req.user)) {
      const scope = getTaskScope(req.user, 't', 1);
      whereParts.push(scope.clause);
      params = scope.params;
    } else if (oddzial_id && (isDyrektor(req.user) || isKierownik(req.user))) {
      whereParts.push(`t.oddzial_id = $1`);
      params = [oddzial_id];
    } else if (!isDyrektor(req.user)) {
      const scope = getTaskScope(req.user, 't', 1);
      whereParts.push(scope.clause);
      params = scope.params;
    }

    const whereClause = `WHERE ${whereParts.filter(Boolean).join(' AND ')}`;
    const baseFrom = `
      FROM tasks t
      LEFT JOIN teams te ON t.ekipa_id = te.id
      LEFT JOIN users k ON t.kierownik_id = k.id
      LEFT JOIN users w ON t.wyceniajacy_id = w.id
      LEFT JOIN branches b ON t.oddzial_id = b.id
      LEFT JOIN (
        SELECT
          p.task_id,
          COUNT(*)::int AS photo_total,
          COUNT(*) FILTER (WHERE LOWER(COALESCE(p.typ, '')) IN ('wycena', 'przed', 'checkin'))::int AS photo_wycena,
          COUNT(*) FILTER (WHERE LOWER(COALESCE(p.typ, '')) IN ('szkic', 'sketch'))::int AS photo_szkic,
          COUNT(*) FILTER (WHERE LOWER(COALESCE(p.typ, '')) IN ('dojazd', 'posesja', 'dojazd_posesja'))::int AS photo_dojazd
        FROM photos p
        GROUP BY p.task_id
      ) ps ON ps.task_id = t.id
      LEFT JOIN (
        SELECT
          r.task_id,
          COUNT(*) FILTER (WHERE LOWER(COALESCE(r.status, '')) NOT LIKE 'anul%')::int AS equipment_reserved_count,
          STRING_AGG(e.nazwa, ', ' ORDER BY e.nazwa) FILTER (WHERE LOWER(COALESCE(r.status, '')) NOT LIKE 'anul%') AS equipment_reserved_names
        FROM equipment_reservations r
        LEFT JOIN equipment_items e ON e.id = r.sprzet_id
        WHERE r.task_id IS NOT NULL
        GROUP BY r.task_id
      ) er ON er.task_id = t.id
      ${TASK_WORK_LOG_AGG_JOIN}
      ${TASK_ISSUE_AGG_JOIN}
      ${whereClause}`;

    const selectSql = `SELECT
        t.*,
        te.nazwa AS ekipa_nazwa,
        k.imie || ' ' || k.nazwisko AS kierownik_nazwa,
        w.imie || ' ' || w.nazwisko AS wyceniajacy_nazwa,
        b.nazwa AS oddzial_nazwa,
        COALESCE(ps.photo_total, 0)::int AS photo_total,
        COALESCE(ps.photo_wycena, 0)::int AS photo_wycena,
        COALESCE(ps.photo_szkic, 0)::int AS photo_szkic,
        COALESCE(ps.photo_dojazd, 0)::int AS photo_dojazd,
        COALESCE(er.equipment_reserved_count, 0)::int AS equipment_reserved_count,
        COALESCE(er.equipment_reserved_names, '') AS equipment_reserved_names,
        ${TASK_WORK_LOG_AGG_SELECT},
        ${TASK_ISSUE_AGG_SELECT},
        ARRAY_REMOVE(ARRAY[
          CASE WHEN COALESCE(ps.photo_wycena, 0) = 0 THEN 'zdjęcie ogólne / wycena' END,
          CASE WHEN COALESCE(ps.photo_szkic, 0) = 0 THEN 'szkic zakresu' END,
          CASE WHEN COALESCE(ps.photo_dojazd, 0) = 0 THEN 'dojazd / posesja' END,
          CASE WHEN t.wartosc_planowana IS NULL THEN 'cena / budżet' END,
          CASE WHEN t.czas_planowany_godziny IS NULL THEN 'czas pracy' END,
          CASE WHEN t.ekipa_id IS NULL THEN 'ekipa' END
        ], NULL) AS missing_items`;

    if (limit != null) {
      const lim = limit;
      const off = offset ?? 0;
      const countResult = await pool.query(`SELECT COUNT(*)::int AS c ${baseFrom}`, params);
      const total = countResult.rows[0]?.c ?? 0;
      const limIdx = params.length + 1;
      const offIdx = params.length + 2;
      const result = await pool.query(
        `${selectSql}
         ${baseFrom}
         ORDER BY t.created_at DESC, t.id DESC
         LIMIT $${limIdx} OFFSET $${offIdx}`,
        [...params, lim, off]
      );
      const items = decorateTaskWorkflowRows(result.rows)
        .map((row) => ({ ...row, missing_items: row.workflow_missing_labels || row.missing_items || [] }));
      return res.json({ items, total, limit: Number(lim), offset: Number(off) });
    }

    const result = await pool.query(
      `${selectSql}
       ${baseFrom}
       ORDER BY t.created_at DESC, t.id DESC`,
      params
    );
    res.json(decorateTaskWorkflowRows(result.rows)
      .map((row) => ({ ...row, missing_items: row.workflow_missing_labels || row.missing_items || [] })));
  } catch (err) {
    logger.error('Blad pobierania draftow terenowych', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

router.post('/nowe', authMiddleware, validateBody(taskCreateSchema), async (req, res) => {
  try {
    if (!canManageTaskBackoffice(req.user)) {
      return res.status(403).json({ error: req.t('errors.auth.forbidden') });
    }
    await ensureTaskOperationalColumns();
    const {
      klient_nazwa, klient_telefon, klient_email, adres, miasto,
      typ_uslugi, priorytet, wartosc_planowana,
      czas_planowany_godziny, data_planowana, godzina_rozpoczecia,
      opis, opis_pracy, notatki_wewnetrzne, notatki, oddzial_id, ekipa_id,
      kierownik_id, wyceniajacy_id, source_ogledziny_id, pin_lat, pin_lng, ankieta_uproszczona,
      status, wywoz, usuwanie_pni, czas_realizacji_godz, rebak, pila_wysiegniku,
      nozyce_dlugie, kosiarka, podkaszarka, lopata, mulczer, ilosc_osob, arborysta,
      wynik, budzet, rabat, kwota_minimalna, zrebki, drzewno
    } = req.body;

    const finalOddzialId = isDyrektorOrAdmin(req.user)
      ? (oddzial_id || req.user.oddzial_id)
      : req.user.oddzial_id;
    const plannedDateTime = buildTaskPlannedDateTime(data_planowana, godzina_rozpoczecia);

    if (ekipa_id && finalOddzialId) {
      const teamCheck = await assertTeamAvailableForBranch(pool, ekipa_id, finalOddzialId, plannedDateTime);
      if (!teamCheck.ok) return res.status(teamCheck.status || 409).json({ error: teamCheck.error });
    }
    if (ekipa_id && hasExplicitPlannedHour(data_planowana, godzina_rozpoczecia)) {
      const teamId = Number(ekipa_id);
      const planDay = String(plannedDateTime).slice(0, 10);
      const busyRanges = await getTeamBusyRanges(pool, teamId, planDay, null, null);
      const d = new Date(plannedDateTime);
      if (!Number.isNaN(d.getTime())) {
        const startMin = d.getHours() * 60 + d.getMinutes();
        const durMin = Math.max(15, Math.round(Number(czas_planowany_godziny || 2) * 60));
        if (planRangeConflicts(busyRanges, startMin, durMin)) {
          return res.status(409).json({
            error: 'Konflikt terminu: ekipa ma juz zaplanowane zlecenie lub aktywna rezerwacje w tym przedziale.',
            code: 'TASK_PLAN_CONFLICT',
          });
        }
      }
    }
    if (wyceniajacy_id && finalOddzialId) {
      const estimatorCheck = await assertEstimatorAvailableForBranch(pool, wyceniajacy_id, finalOddzialId, plannedDateTime);
      if (!estimatorCheck.ok) return res.status(estimatorCheck.status || 409).json({ error: estimatorCheck.error });
    }
    const initialStatus = status || (toInt(wyceniajacy_id) ? 'Wycena_Terenowa' : 'Nowe');
    const taskOpisPracy = toStr(opis_pracy) || toStr(opis);
    const taskOpis = toStr(opis) || taskOpisPracy;
    const taskNotes = [toStr(notatki_wewnetrzne), toStr(notatki)].filter(Boolean).join('\n\n') || null;
    const finalKierownikId = toInt(kierownik_id) || req.user.id;
    const statusToken = generatePublicStatusToken();
    await ensurePublicStatusLinkTables();

    // Branch ownership check: non-admin users can only assign teams from their own branch
    if (ekipa_id && !isDyrektorOrAdmin(req.user)) {
      const teamBranch = await pool.query('SELECT oddzial_id FROM teams WHERE id = $1', [toNum(ekipa_id)]);
      if (
        !teamBranch.rows.length ||
        Number(teamBranch.rows[0].oddzial_id) !== Number(finalOddzialId)
      ) {
        return res.status(403).json({ error: req.t('errors.auth.branchAccessDenied') });
      }
    }

    const result = await pool.query(
      `INSERT INTO tasks (
        klient_nazwa, klient_telefon, klient_email, adres, miasto,
        typ_uslugi, priorytet, wartosc_planowana,
        czas_planowany_godziny, data_planowana, godzina_rozpoczecia,
        opis, opis_pracy, notatki_wewnetrzne, notatki, status, kierownik_id,
        oddzial_id, ekipa_id, wyceniajacy_id, pin_lat, pin_lng, ankieta_uproszczona, link_statusowy_token,
        wywoz, usuwanie_pni, czas_realizacji_godz, rebak, pila_wysiegniku,
        nozyce_dlugie, kosiarka, podkaszarka, lopata, mulczer, ilosc_osob, arborysta,
        wynik, budzet, rabat, kwota_minimalna, zrebki, drzewno
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
        $21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40,$41,$42
      )
      RETURNING id, link_statusowy_token`,
      [
        klient_nazwa,
        toStr(klient_telefon),
        toStr(klient_email),
        adres,
        miasto,
        typ_uslugi || 'Wycinka',
        priorytet || 'Normalny',
        toNum(wartosc_planowana),
        toNum(czas_planowany_godziny),
        plannedDateTime,
        toStr(godzina_rozpoczecia),
        taskOpis,
        taskOpisPracy,
        taskNotes,
        toStr(notatki),
        initialStatus,
        finalKierownikId,
        toNum(finalOddzialId),
        toNum(ekipa_id),
        toInt(wyceniajacy_id),
        toNum(pin_lat),
        toNum(pin_lng),
        ankieta_uproszczona === true,
        statusToken,
        toBool(wywoz),
        toBool(usuwanie_pni),
        toNum(czas_realizacji_godz),
        toBool(rebak),
        toBool(pila_wysiegniku),
        toBool(nozyce_dlugie),
        toBool(kosiarka),
        toBool(podkaszarka),
        toBool(lopata),
        toBool(mulczer),
        toInt(ilosc_osob),
        toBool(arborysta),
        toStr(wynik),
        toNum(budzet),
        toNum(rabat),
        toNum(kwota_minimalna),
        toStr(zrebki),
        toStr(drzewno)
      ]
    );
    const taskId = result.rows[0].id;
    await recordTaskPublicStatusEvent(pool, {
      taskId,
      toStatus: initialStatus,
      source: 'created',
      note: 'Zlecenie przyjete',
      userId: req.user.id,
    }).catch((error) => logger.warn('tasks.public_status.created', { message: error.message, taskId }));

    let wycenaId = null;
    if (toInt(wyceniajacy_id)) {
      const wycenaR = await pool.query(
        `INSERT INTO wyceny (
          klient_nazwa, klient_telefon, adres, miasto, typ_uslugi,
          wartosc_szacowana, wartosc_planowana, opis, notatki_wewnetrzne,
          lat, lon, autor_id, status, status_akceptacji, data_wykonania
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$6,$7,$8,$9,$10,$11,'Nowa','oczekuje',$12
        ) RETURNING id`,
        [
          klient_nazwa,
          toStr(klient_telefon),
          adres,
          miasto,
          typ_uslugi || 'Wycena',
          toNum(wartosc_planowana),
          `AUTO zlecenie #${taskId} (${ankieta_uproszczona ? 'ankieta uproszczona' : 'pełna ankieta'})`,
          toStr(notatki_wewnetrzne),
          toNum(pin_lat),
          toNum(pin_lng),
          toInt(wyceniajacy_id),
          data_planowana,
        ]
      );
      wycenaId = wycenaR.rows[0]?.id || null;
    }

    const sourceOgledzinyId = toInt(source_ogledziny_id);
    let ogledzinyId = null;
    if (sourceOgledzinyId) {
      try {
        const sourceNote = [
          `Draft terenowy zapisany automatycznie jako zlecenie #${taskId}.`,
          wycenaId ? `Powiazana wycena: #${wycenaId}.` : 'Brak powiazanej wyceny w odpowiedzi tworzenia zlecenia.',
          'Dla biura: sprawdzic opis, termin ekipy, rezerwacje czasu i szczegoly z klientem.',
        ].join('\n');
        await pool.query(
          `UPDATE ogledziny
           SET wycena_id = COALESCE($2, wycena_id),
               status = 'Zakonczone',
               notatki_wyniki = CONCAT_WS(E'\n', NULLIF(notatki_wyniki, ''), $3),
               updated_at = NOW()
           WHERE id = $1`,
          [sourceOgledzinyId, wycenaId, sourceNote],
        );
        await pool.query(
          `INSERT INTO ogledziny_field_events (ogledziny_id, user_id, event_type, note)
           VALUES ($1,$2,'done',$3)`,
          [sourceOgledzinyId, req.user.id, sourceNote],
        ).catch(() => null);
      } catch (linkErr) {
        logger.warn('tasks.create.linkInspection', { message: linkErr.message, requestId: req.requestId, sourceOgledzinyId, taskId, wycenaId });
      }
    } else if (initialStatus === 'Wycena_Terenowa' && toInt(wyceniajacy_id)) {
      try {
        ogledzinyId = await createLinkedInspectionForFieldTask({
          taskId,
          wyceniajacyId: wyceniajacy_id,
          wycenaId,
          klient_nazwa,
          klient_telefon: toStr(klient_telefon),
          adres,
          miasto,
          plannedDateTime,
          notes: taskNotes || taskOpis,
          createdBy: req.user.id,
        });
        if (ogledzinyId) {
          await pool.query(
            `UPDATE tasks
             SET notatki_wewnetrzne = CONCAT_WS(E'\n\n', NULLIF(notatki_wewnetrzne, ''), $2),
                 updated_at = NOW()
             WHERE id = $1`,
            [taskId, `Powiazane ogledziny terenowe: #${ogledzinyId}.`]
          );
        }
      } catch (inspectionErr) {
        logger.warn('tasks.create.autoInspection', {
          message: inspectionErr.message,
          requestId: req.requestId,
          taskId,
          wycenaId,
        });
      }
    }

    const workflowFallback = {
      id: taskId,
      status: initialStatus,
      klient_nazwa,
      klient_telefon: toStr(klient_telefon),
      adres,
      miasto,
      data_planowana: plannedDateTime,
      wyceniajacy_id: toInt(wyceniajacy_id),
      ekipa_id: toNum(ekipa_id),
      opis: taskOpis,
      opis_pracy: taskOpisPracy,
      wartosc_planowana: toNum(wartosc_planowana),
      budzet: toNum(budzet),
      czas_planowany_godziny: toNum(czas_planowany_godziny),
      czas_realizacji_godz: toNum(czas_realizacji_godz),
      photo_total: 0,
      photo_wycena: 0,
      photo_szkic: 0,
      photo_dojazd: 0,
    };
    const workflowRow = await fetchTaskWorkflowRow(taskId).catch(() => null);
    res.json({
      wycena_id: wycenaId,
      ogledziny_id: ogledzinyId || sourceOgledzinyId || null,
      ...decorateTaskWorkflow(workflowRow || workflowFallback),
    });
  } catch (err) {
    logger.error('Blad tworzenia zlecenia', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: err.message });
  }
});

router.get(
  '/:id/kommo-payload',
  authMiddleware,
  validateParams(taskIdParamsSchema),
  requireTaskAccess,
  async (req, res) => {
    if (!canManageTaskBackoffice(req.user)) {
      return res.status(403).json({ error: req.t('errors.auth.forbidden') });
    }
    await ensureKommoTaskColumns();
    try {
      const result = await pool.query(taskKommoPayloadSql(), [req.params.id]);
      if (!result.rows.length) return res.status(404).json({ error: req.t('errors.generic.notFound') });
      res.json(buildKommoTaskPayload(result.rows[0], kommoActor(req)));
    } catch (err) {
      logger.error('Blad kommo-payload zlecenia', { message: err.message, requestId: req.requestId });
      res.status(500).json({ error: req.t('errors.http.serverError') });
    }
  }
);

router.get(
  '/:id/status-link',
  authMiddleware,
  validateParams(taskIdParamsSchema),
  requireTaskAccess,
  async (req, res) => {
    try {
      const token = await ensureTaskPublicStatusToken(pool, Number(req.params.id));
      if (!token) return res.status(404).json({ error: req.t('errors.generic.notFound') });
      res.json({
        task_id: Number(req.params.id),
        token,
        url: publicStatusUrl(token),
      });
    } catch (err) {
      logger.error('Blad status-link zlecenia', { message: err.message, requestId: req.requestId });
      res.status(500).json({ error: req.t('errors.http.serverError') });
    }
  }
);

router.post(
  '/:id/kommo-push',
  authMiddleware,
  validateParams(taskIdParamsSchema),
  requireTaskAccess,
  async (req, res) => {
    if (!canManageTaskBackoffice(req.user)) {
      return res.status(403).json({ error: req.t('errors.auth.forbidden') });
    }
    await ensureKommoTaskColumns();
    try {
      const result = await pool.query(taskKommoPayloadSql(), [req.params.id]);
      if (!result.rows.length) return res.status(404).json({ error: req.t('errors.generic.notFound') });
      const row = result.rows[0];
      if (!kommoWebhookConfigured('crm')) {
        return res.status(400).json({
          error:
            'Brak konfiguracji webhooka Kommo dla CRM. Ustaw KOMMO_CRM_WEBHOOK_URL lub KOMMO_WEBHOOK_URL.',
        });
      }
      const payload = buildKommoTaskPayload(row, kommoActor(req));
      const markSync = async (next) => {
        await pool.query(
          `UPDATE tasks SET
            kommo_last_sync_at = NOW(),
            kommo_last_sync_status = $1,
            kommo_last_sync_http = $2,
            kommo_last_sync_error = $3,
            updated_at = NOW()
          WHERE id = $4`,
          [next.status || null, next.http ?? null, next.error || null, row.id]
        );
      };
      try {
        const { response, bodyText } = await postKommoWebhook(payload, 'crm');
        if (!response.ok) {
          const error = `HTTP ${response.status}: ${bodyText.slice(0, 500)}`;
          await markSync({
            status: 'error',
            http: response.status,
            error,
          });
          const queueRow = await recordKommoTaskSyncFailure(pool, {
            taskId: row.id,
            payload,
            actor: kommoActor(req),
            httpStatus: response.status,
            error,
          });
          return res.status(502).json({
            ok: false,
            status: queueRow?.status || 'failed',
            queue_status: queueRow?.status || 'failed',
            retry_count: Number(queueRow?.retry_count || 0),
            http_status: response.status,
            body: bodyText.slice(0, 500),
          });
        }
        await markSync({ status: 'ok', http: response.status, error: null });
        const queueRow = await markKommoTaskSyncSuccess(pool, row.id);
        return res.json({
          ok: true,
          status: 'ok',
          queue_status: queueRow?.status || 'sent',
          http_status: response.status,
        });
      } catch (err) {
        const error = err.message || 'network error';
        await markSync({ status: 'error', http: null, error });
        const queueRow = await recordKommoTaskSyncFailure(pool, {
          taskId: row.id,
          payload,
          actor: kommoActor(req),
          error,
        });
        return res.status(502).json({
          ok: false,
          status: queueRow?.status || 'failed',
          queue_status: queueRow?.status || 'failed',
          retry_count: Number(queueRow?.retry_count || 0),
          error: err.message || 'Nie udało się wysłać danych do Kommo',
        });
      }
    } catch (err) {
      logger.error('Blad kommo-push zlecenia', { message: err.message, requestId: req.requestId });
      res.status(500).json({ error: req.t('errors.http.serverError') });
    }
  }
);

router.post(
  '/:id/kommo-retry',
  authMiddleware,
  validateParams(taskIdParamsSchema),
  validateBody(taskKommoRetrySchema),
  requireTaskAccess,
  async (req, res) => {
    if (!canManageTaskBackoffice(req.user)) {
      return res.status(403).json({ error: req.t('errors.auth.forbidden') });
    }
    await ensureKommoTaskColumns();
    try {
      const result = await pool.query(taskKommoPayloadSql(), [req.params.id]);
      if (!result.rows.length) return res.status(404).json({ error: req.t('errors.generic.notFound') });
      const row = result.rows[0];
      if (!kommoWebhookConfigured('crm')) {
        return res.status(400).json({
          error:
            'Brak konfiguracji webhooka Kommo dla CRM. Ustaw KOMMO_CRM_WEBHOOK_URL lub KOMMO_WEBHOOK_URL.',
        });
      }

      const queueBefore = await getKommoTaskSyncQueueRow(pool, row.id);
      if (queueBefore?.status === 'dead_letter' && req.body.force !== true) {
        return res.status(409).json({
          ok: false,
          status: 'dead_letter',
          queue_status: 'dead_letter',
          retry_count: Number(queueBefore.retry_count || 0),
          error: 'Sync Kommo jest w dead-letter. Wyslij ponownie z force=true po sprawdzeniu konfliktu.',
        });
      }

      const payload = buildKommoTaskPayload(row, kommoActor(req));
      const retryCount = Number(queueBefore?.retry_count || 0);
      const markSync = async (next) => {
        await pool.query(
          `UPDATE tasks SET
            kommo_last_sync_at = NOW(),
            kommo_last_sync_status = $1,
            kommo_last_sync_http = $2,
            kommo_last_sync_error = $3,
            updated_at = NOW()
          WHERE id = $4`,
          [next.status || null, next.http ?? null, next.error || null, row.id]
        );
      };

      try {
        const { response, bodyText } = await postKommoWebhook(payload, 'crm');
        if (!response.ok) {
          const error = `HTTP ${response.status}: ${bodyText.slice(0, 500)}`;
          await markSync({ status: 'error', http: response.status, error });
          const queueAfter = await recordKommoTaskSyncFailure(pool, {
            taskId: row.id,
            payload,
            actor: kommoActor(req),
            httpStatus: response.status,
            error,
            retryCount,
          });
          return res.status(502).json({
            ok: false,
            status: queueAfter?.status || 'failed',
            queue_status: queueAfter?.status || 'failed',
            retry_count: Number(queueAfter?.retry_count || retryCount + 1),
            http_status: response.status,
            body: bodyText.slice(0, 500),
          });
        }

        await markSync({ status: 'ok', http: response.status, error: null });
        const queueAfter = await markKommoTaskSyncSuccess(pool, row.id);
        return res.json({
          ok: true,
          status: 'ok',
          queue_status: queueAfter?.status || 'sent',
          http_status: response.status,
        });
      } catch (err) {
        const error = err.message || 'network error';
        await markSync({ status: 'error', http: null, error });
        const queueAfter = await recordKommoTaskSyncFailure(pool, {
          taskId: row.id,
          payload,
          actor: kommoActor(req),
          error,
          retryCount,
        });
        return res.status(502).json({
          ok: false,
          status: queueAfter?.status || 'failed',
          queue_status: queueAfter?.status || 'failed',
          retry_count: Number(queueAfter?.retry_count || retryCount + 1),
          error,
        });
      }
    } catch (err) {
      logger.error('Blad kommo-retry zlecenia', { message: err.message, requestId: req.requestId });
      res.status(500).json({ error: req.t('errors.http.serverError') });
    }
  }
);

/** F4.1 - zmiana terminu zlecenia z harmonogramu (DnD); Kierownik / Dyrektor. */
router.patch(
  '/:id/plan',
  authMiddleware,
  validateParams(taskIdParamsSchema),
  validateBody(taskPlanPatchSchema),
  requireTaskAccess,
  async (req, res) => {
    if (!isDyrektor(req.user) && !isKierownik(req.user)) {
      return res.status(403).json({ error: 'Tylko kierownik lub dyrektor może zmieniać harmonogram.' });
    }
    try {
      const taskId = Number(req.params.id);
      const r = await pool.query(
        `SELECT id, status, ekipa_id, oddzial_id, czas_planowany_godziny, data_planowana FROM tasks WHERE id = $1`,
        [taskId]
      );
      if (!r.rows.length) return res.status(404).json({ error: req.t('errors.generic.notFound') });
      const row = r.rows[0];
      const st = row.status;
      if (st === 'Zakonczone' || st === 'Anulowane') {
        return res.status(400).json({ error: 'Nie można przesunąć zakończonego lub anulowanego zlecenia.' });
      }
      const windowR = await pool.query('SELECT okno_od, okno_do FROM tasks WHERE id = $1', [taskId]);
      const windowRow = windowR.rows[0] || {};
      const plannedDateTime = buildTaskPlannedDateTime(req.body.data_planowana, req.body.godzina_rozpoczecia);
      const windowConflict = planWindowViolation({
        oknoOd: windowRow.okno_od,
        oknoDo: windowRow.okno_do,
        plannedDateTime,
        durationHours: row.czas_planowany_godziny || 2,
      });
      if (windowConflict) return res.status(409).json(windowConflict);
      const hasTeamBody = Object.prototype.hasOwnProperty.call(req.body, 'ekipa_id');
      const teamId = hasTeamBody ? toNum(req.body.ekipa_id) : (row.ekipa_id != null ? Number(row.ekipa_id) : null);
      let teamAttendance = null;
      if (teamId) {
        const planDay = String(plannedDateTime).slice(0, 10);
        if (row.oddzial_id) {
          const teamCheck = await assertTeamAvailableForBranch(pool, teamId, row.oddzial_id, planDay);
          if (!teamCheck.ok) return res.status(teamCheck.status || 409).json({ error: teamCheck.error });
        }
        const competencyCheck = await assertTeamCompetenciesForTask(pool, {
          taskId,
          teamId,
          plannedDate: plannedDateTime,
        });
        if (!competencyCheck.ok) return sendCompetencyBlock(res, competencyCheck);
        teamAttendance = await getTeamAttendanceForPlan(teamId, plannedDateTime);
        if (teamAttendance?.present === false && req.body.absence_override !== true) {
          return res.status(409).json({
            error: `Ekipa ${teamAttendance.teamName} jest oznaczona jako nieobecna w dniu ${teamAttendance.day}. Wymagane potwierdzenie kierownika.`,
            code: 'TEAM_ABSENT',
            attendance: {
              teamId: teamAttendance.teamId,
              teamName: teamAttendance.teamName,
              dateYmd: teamAttendance.day,
              present: false,
              note: teamAttendance.note,
              actor: teamAttendance.actor,
            },
          });
        }
        const busyRanges = await getTeamBusyRanges(pool, teamId, planDay, null, taskId);
        const d = new Date(plannedDateTime);
        const startMin = d.getHours() * 60 + d.getMinutes();
        const durMin = Math.max(15, Math.round(Number(row.czas_planowany_godziny || 2) * 60));
        if (planRangeConflicts(busyRanges, startMin, durMin)) {
          return res.status(409).json({
            error:
              'Konflikt terminu: ekipa ma już zaplanowane zlecenie lub aktywną rezerwację w tym przedziale.',
            code: 'TASK_PLAN_CONFLICT',
          });
        }
      }
      const absenceNote = teamAttendance?.present === false && req.body.absence_override === true
        ? [
          'WYJATEK PLANOWANIA EKIPY',
          `Kierownik potwierdzil przesuniecie mimo nieobecnosci ekipy${teamAttendance.note ? `: ${teamAttendance.note}` : '.'}`,
          `Data zlecenia: ${String(req.body.data_planowana || '').slice(0, 10) || '-'}`,
          `Ekipa: ${teamAttendance.teamName} (#${teamAttendance.teamId})`,
          `Operator: ${req.user.login || req.user.id || '-'}`,
        ].join('\n')
        : null;
      await pool.query(
        `UPDATE tasks
            SET data_planowana = $1::timestamptz,
                ekipa_id = $2,
                godzina_rozpoczecia = COALESCE($5::time, godzina_rozpoczecia),
                notatki_wewnetrzne = CASE
                  WHEN $4::text IS NULL THEN notatki_wewnetrzne
                  ELSE CONCAT_WS(E'\n\n', NULLIF(BTRIM(COALESCE(notatki_wewnetrzne, '')), ''), $4::text)
                END,
                updated_at = NOW()
          WHERE id = $3`,
        [
          plannedDateTime,
          teamId,
          taskId,
          absenceNote,
          toStr(req.body.godzina_rozpoczecia) || null,
        ]
      );
      const oldDay = row.data_planowana ? String(row.data_planowana).slice(0, 10) : '';
      const nextDay = String(plannedDateTime || '').slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(nextDay)) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(oldDay)) {
          await pool.query(
            `UPDATE equipment_reservations
                SET data_od = data_od + ($1::date - $2::date),
                    data_do = data_do + ($1::date - $2::date),
                    updated_at = NOW()
              WHERE task_id = $3
                AND LOWER(COALESCE(status, '')) NOT LIKE 'anul%'
                AND LOWER(COALESCE(status, '')) NOT LIKE 'zwr%'`,
            [nextDay, oldDay, taskId]
          );
        } else {
          await pool.query(
            `UPDATE equipment_reservations
                SET data_od = $1::date,
                    data_do = $1::date,
                    updated_at = NOW()
              WHERE task_id = $2
                AND LOWER(COALESCE(status, '')) NOT LIKE 'anul%'
                AND LOWER(COALESCE(status, '')) NOT LIKE 'zwr%'`,
            [nextDay, taskId]
          );
        }
      }

      let workflowRow = await fetchTaskWorkflowRow(taskId).catch(() => null);
      let hasWorkflowRow = Boolean(workflowRow?.id);
      let workflow = decorateTaskWorkflow(workflowRow || {
        ...row,
        id: taskId,
        data_planowana: plannedDateTime,
        godzina_rozpoczecia: req.body.godzina_rozpoczecia || row.godzina_rozpoczecia,
        ekipa_id: teamId,
      });
      let promoted = false;
      const beforeStatus = normalizeTaskStatusFlow(row.status);
      if (beforeStatus === 'Do_Zatwierdzenia' && workflow.office_plan_ready) {
        await pool.query(
          `UPDATE tasks SET status = 'Zaplanowane', updated_at = NOW() WHERE id = $1`,
          [taskId]
        );
        await recordTaskPublicStatusEvent(pool, {
          taskId,
          fromStatus: row.status,
          toStatus: 'Zaplanowane',
          source: 'plan',
          userId: req.user.id,
        }).catch((error) => logger.warn('tasks.public_status.plan', { message: error.message, taskId }));
        promoted = true;
        workflowRow = await fetchTaskWorkflowRow(taskId).catch(() => null);
        hasWorkflowRow = Boolean(workflowRow?.id);
        workflow = decorateTaskWorkflow(workflowRow || {
          ...workflow,
          status: 'Zaplanowane',
          data_planowana: plannedDateTime,
          godzina_rozpoczecia: req.body.godzina_rozpoczecia || workflow.godzina_rozpoczecia,
          ekipa_id: teamId,
        });
      }

      const missingLabels = hasWorkflowRow ? (workflow.office_plan_missing_labels || []) : [];
      res.json({
        message: promoted
          ? 'Plan zaktualizowany. Zlecenie gotowe dla ekipy.'
          : missingLabels.length
            ? `Plan zaktualizowany. Braki przed zatwierdzeniem: ${missingLabels.join(', ')}.`
            : 'Plan zaktualizowany',
        plan_promoted: promoted,
        status: workflow.status || (promoted ? 'Zaplanowane' : row.status),
        office_plan_ready: workflow.office_plan_ready,
        office_plan_missing_labels: missingLabels,
        crew_execution_ready: workflow.crew_execution_ready,
        crew_execution_missing_labels: workflow.crew_execution_missing_labels || [],
        task: workflow,
      });
    } catch (err) {
      logger.error('tasks.planPatch', { message: err.message, requestId: req.requestId });
      res.status(500).json({ error: req.t('errors.http.serverError') });
    }
  }
);

function mapClientContact(row, history = []) {
  return {
    task_id: Number(row?.task_id),
    status: row?.status || '',
    note: row?.note || '',
    due_at: row?.due_at || null,
    updated_at: row?.updated_at || null,
    updated_by: row?.updated_by || null,
    actor: row?.actor || null,
    history,
  };
}

function normalizeJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function mapClosureDecisionEvent(row, actorFallback = 'Operator') {
  return {
    id: Number(row?.id),
    task_id: Number(row?.task_id),
    action: row?.action || '',
    severity: row?.severity || '',
    status_before: row?.status_before || '',
    status_after: row?.status_after || '',
    blockers: normalizeJsonArray(row?.blockers),
    warnings: normalizeJsonArray(row?.warnings),
    risk_score: Number(row?.risk_score) || 0,
    quality_score: Number(row?.quality_score) || 0,
    value: Number(row?.value) || 0,
    note: row?.note || '',
    created_at: row?.created_at || null,
    created_by: row?.created_by || null,
    actor: row?.actor || actorFallback,
  };
}

function requestActorName(req) {
  return [req.user?.imie, req.user?.nazwisko].filter(Boolean).join(' ')
    || req.user?.login
    || 'Operator';
}

function kommoSyncOwnerMeta(row = {}) {
  const status = String(row.status || '').toLowerCase();
  return {
    owner_role: 'Dyspozytor/Admin',
    owner_label: 'Dyspozytor/Admin - integracje Kommo',
    escalation: status === 'dead_letter'
      ? 'P1 gdy dead-letter > 0 po 30 min'
      : 'P2 gdy retry failed nie wraca do sent po 30 min',
  };
}

router.get('/kommo-sync/diagnostics', authMiddleware, async (req, res) => {
  if (!canManageTaskBackoffice(req.user) && !isSalesDirector(req.user)) {
    return res.status(403).json({ error: req.t('errors.http.forbidden') });
  }
  try {
    await ensureKommoTaskColumns();
    await ensureKommoTaskSyncQueue(pool);
    await ensureKommoInboundEventTable();
    const limit = Math.min(100, Math.max(1, Number(req.query.limit || 30)));
    const status = String(req.query.status || '').trim();
    const requestedBranchId = req.query.oddzial_id ? Number(req.query.oddzial_id) : null;
    const branchId = isKierownik(req.user)
      ? Number(req.user.oddzial_id || 0) || null
      : requestedBranchId;
    if (requestedBranchId && isKierownik(req.user) && Number(requestedBranchId) !== Number(req.user.oddzial_id)) {
      return res.status(403).json({ error: req.t('errors.auth.branchAccessDenied') });
    }
    const queueParams = [];
    const queueWhereParts = [];
    if (status) {
      queueParams.push(status);
      queueWhereParts.push(`q.status = $${queueParams.length}`);
    }
    if (branchId) {
      queueParams.push(branchId);
      queueWhereParts.push(`t.oddzial_id = $${queueParams.length}`);
    }
    const queueWhere = queueWhereParts.length ? `WHERE ${queueWhereParts.join(' AND ')}` : '';
    const inboundParams = [];
    const inboundWhereParts = [];
    if (branchId) {
      inboundParams.push(branchId);
      inboundWhereParts.push(`t.oddzial_id = $${inboundParams.length}`);
    }
    const inboundWhere = inboundWhereParts.length ? `WHERE ${inboundWhereParts.join(' AND ')}` : '';
    queueParams.push(limit);
    inboundParams.push(limit);
    const [queueResult, inboundResult] = await Promise.all([
      pool.query(
        `SELECT
           q.id, q.task_id, q.event, q.idempotency_key, q.status, q.retry_count, q.next_retry_at,
           q.last_http_status, q.last_error, q.updated_at, q.last_attempt_at, q.sent_at,
           t.numer, t.klient_nazwa, t.status AS task_status, t.oddzial_id
         FROM task_kommo_sync_queue q
         LEFT JOIN tasks t ON t.id = q.task_id
         ${queueWhere}
         ORDER BY q.updated_at DESC, q.id DESC
         LIMIT $${queueParams.length}`,
        queueParams
      ),
      pool.query(
        `SELECT
           e.id, e.event_key, e.task_id, e.status, e.incoming_status, e.applied_status,
           e.conflict_reason, e.created_at, e.processed_at,
           t.numer, t.klient_nazwa, t.status AS task_status, t.oddzial_id
         FROM task_kommo_inbound_events e
         LEFT JOIN tasks t ON t.id = e.task_id
         ${inboundWhere}
         ORDER BY e.created_at DESC, e.id DESC
         LIMIT $${inboundParams.length}`,
        inboundParams
      ),
    ]);
    res.json({
      queue: queueResult.rows.map((row) => ({ ...row, ...kommoSyncOwnerMeta(row) })),
      inbound_events: inboundResult.rows.map((row) => ({
        ...row,
        owner_role: 'Dyspozytor/Admin',
        owner_label: 'Dyspozytor/Admin - inbound Kommo',
        escalation: row.status === 'conflict' ? 'P2 gdy konflikt statusu nie ma decyzji ownera po 30 min' : 'Monitoruj w standardowym trybie',
      })),
      summary: {
        queue_errors: queueResult.rows.filter((row) => ['failed', 'dead_letter'].includes(row.status)).length,
        inbound_conflicts: inboundResult.rows.filter((row) => row.status === 'conflict').length,
        oddzial_id: branchId,
      },
    });
  } catch (err) {
    logger.error('Blad diagnostyki Kommo sync', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

router.get('/client-contacts', authMiddleware, async (req, res) => {
  try {
    await ensureTaskClientContactTables();
    const scope = getTaskScope(req.user, 't', 1);
    const where = scope.clause ? `WHERE ${scope.clause}` : '';
    const result = await pool.query(
      `SELECT c.task_id, c.status, c.note, c.due_at, c.updated_at, c.updated_by,
              u.imie || ' ' || u.nazwisko AS actor
       FROM task_client_contacts c
       JOIN tasks t ON t.id = c.task_id
       LEFT JOIN users u ON u.id = c.updated_by
       ${where}
       ORDER BY c.updated_at DESC`,
      scope.params
    );
    const contacts = {};
    for (const row of result.rows) {
      contacts[String(row.task_id)] = mapClientContact(row);
    }
    res.json({ contacts });
  } catch (err) {
    logger.error('tasks.clientContacts.list', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

router.get('/closure-events', authMiddleware, async (req, res) => {
  try {
    await ensureTaskClosureDecisionTables();
    const scope = getTaskScope(req.user, 't', 1);
    const where = scope.clause ? `WHERE ${scope.clause}` : '';
    const result = await pool.query(
      `SELECT e.id, e.task_id, e.action, e.severity, e.status_before, e.status_after,
              e.blockers, e.warnings, e.risk_score, e.quality_score, e.value,
              e.note, e.created_at, e.created_by,
              u.imie || ' ' || u.nazwisko AS actor
       FROM task_closure_decision_events e
       JOIN tasks t ON t.id = e.task_id
       LEFT JOIN users u ON u.id = e.created_by
       ${where}
       ORDER BY e.created_at DESC
       LIMIT 500`,
      scope.params
    );
    const events = {};
    for (const row of result.rows) {
      const event = mapClosureDecisionEvent(row);
      const key = String(event.task_id);
      events[key] = [...(events[key] || []), event].slice(0, 30);
    }
    res.json({ events });
  } catch (err) {
    logger.error('tasks.closureEvents.list', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

router.get('/:id/client-contact', authMiddleware, validateParams(taskIdParamsSchema), requireTaskAccess, async (req, res) => {
  try {
    await ensureTaskClientContactTables();
    const current = await pool.query(
      `SELECT c.task_id, c.status, c.note, c.due_at, c.updated_at, c.updated_by,
              u.imie || ' ' || u.nazwisko AS actor
       FROM task_client_contacts c
       LEFT JOIN users u ON u.id = c.updated_by
       WHERE c.task_id = $1`,
      [req.params.id]
    );
    const history = await pool.query(
      `SELECT e.id, e.task_id, e.status, e.note, e.due_at, e.created_at, e.created_by,
              u.imie || ' ' || u.nazwisko AS actor
       FROM task_client_contact_events e
       LEFT JOIN users u ON u.id = e.created_by
       WHERE e.task_id = $1
       ORDER BY e.created_at DESC
       LIMIT 20`,
      [req.params.id]
    );
    res.json(mapClientContact(current.rows[0] || { task_id: req.params.id }, history.rows));
  } catch (err) {
    logger.error('tasks.clientContact.get', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

router.patch(
  '/:id/client-contact',
  authMiddleware,
  validateParams(taskIdParamsSchema),
  validateBody(taskClientContactSchema),
  requireTaskAccess,
  async (req, res) => {
    let client;
    try {
      await ensureTaskClientContactTables();
      client = await pool.connect();
      await client.query('BEGIN');

      const existing = await client.query(
        'SELECT status, note, due_at FROM task_client_contacts WHERE task_id = $1 FOR UPDATE',
        [req.params.id]
      );
      const prev = existing.rows[0] || {};
      const hasStatus = Object.prototype.hasOwnProperty.call(req.body, 'status');
      const hasNote = Object.prototype.hasOwnProperty.call(req.body, 'note');
      const hasDueAt = Object.prototype.hasOwnProperty.call(req.body, 'due_at');
      const status = hasStatus ? req.body.status : (prev.status || '');
      const note = hasNote ? String(req.body.note || '') : (prev.note || '');
      const dueAt = hasDueAt ? toStr(req.body.due_at) : (prev.due_at || null);

      await client.query(
        `INSERT INTO task_client_contacts (task_id, status, note, due_at, updated_by, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (task_id)
         DO UPDATE SET status = EXCLUDED.status,
                       note = EXCLUDED.note,
                       due_at = EXCLUDED.due_at,
                       updated_by = EXCLUDED.updated_by,
                       updated_at = NOW()`,
        [req.params.id, status, note, dueAt, req.user.id]
      );
      await client.query(
        `INSERT INTO task_client_contact_events (task_id, status, note, due_at, created_by, created_at)
         VALUES ($1, $2, $3, $4, $5, NOW())`,
        [req.params.id, status, note, dueAt, req.user.id]
      );
      const current = await client.query(
        `SELECT c.task_id, c.status, c.note, c.due_at, c.updated_at, c.updated_by,
                u.imie || ' ' || u.nazwisko AS actor
         FROM task_client_contacts c
         LEFT JOIN users u ON u.id = c.updated_by
         WHERE c.task_id = $1`,
        [req.params.id]
      );
      const history = await client.query(
        `SELECT e.id, e.task_id, e.status, e.note, e.due_at, e.created_at, e.created_by,
                u.imie || ' ' || u.nazwisko AS actor
         FROM task_client_contact_events e
         LEFT JOIN users u ON u.id = e.created_by
         WHERE e.task_id = $1
         ORDER BY e.created_at DESC
         LIMIT 20`,
        [req.params.id]
      );
      await client.query('COMMIT');
      res.json(mapClientContact(current.rows[0], history.rows));
    } catch (err) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      logger.error('tasks.clientContact.patch', { message: err.message, requestId: req.requestId });
      res.status(500).json({ error: req.t('errors.http.serverError') });
    } finally {
      if (client) client.release();
    }
  }
);

router.post(
  '/:id/closure-events',
  authMiddleware,
  validateParams(taskIdParamsSchema),
  validateBody(taskClosureDecisionSchema),
  requireTaskAccess,
  async (req, res) => {
    try {
      await ensureTaskClosureDecisionTables();
      const body = req.body;
      const result = await pool.query(
        `INSERT INTO task_closure_decision_events (
          task_id, action, severity, status_before, status_after, blockers, warnings,
          risk_score, quality_score, value, note, created_by, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, $10, $11, $12, NOW())
        RETURNING *`,
        [
          req.params.id,
          body.action,
          body.severity || (body.blockers?.length ? 'danger' : body.warnings?.length ? 'warning' : 'good'),
          body.status_before || null,
          body.status_after || null,
          JSON.stringify(body.blockers || []),
          JSON.stringify(body.warnings || []),
          body.risk_score || 0,
          body.quality_score || 0,
          body.value || 0,
          body.note || null,
          req.user.id,
        ]
      );
      res.json(mapClosureDecisionEvent(result.rows[0], requestActorName(req)));
    } catch (err) {
      logger.error('tasks.closureEvents.create', { message: err.message, requestId: req.requestId });
      res.status(500).json({ error: req.t('errors.http.serverError') });
    }
  }
);

router.get('/:id/client-signature', authMiddleware, validateParams(taskIdParamsSchema), requireTaskAccess, async (req, res) => {
  try {
    await ensureTaskClientSignatureTable();
    const row = await pool.query(
      `SELECT s.task_id, s.signer_name, s.signature_data_url, s.signed_at, s.note, s.updated_at, s.updated_by,
              u.imie || ' ' || u.nazwisko AS actor
       FROM task_client_signatures s
       LEFT JOIN users u ON u.id = s.updated_by
       WHERE s.task_id = $1`,
      [req.params.id]
    );
    res.json(row.rows[0] || null);
  } catch (err) {
    logger.error('tasks.clientSignature.get', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

router.get('/:id/protokol-link', authMiddleware, validateParams(taskIdParamsSchema), requireTaskAccess, async (req, res) => {
  try {
    const taskId = Number(req.params.id);
    const accessToken = jwt.sign(
      {
        typ: 'task_pdf_link',
        task_id: taskId,
        user_id: req.user.id,
        rola: req.user.rola,
        oddzial_id: req.user.oddzial_id ?? null,
      },
      env.JWT_SECRET,
      { expiresIn: '10m' }
    );
    res.json({
      path: `/api/pdf/zlecenie/${taskId}?access_token=${encodeURIComponent(accessToken)}`,
      expires_in_sec: 600,
    });
  } catch (err) {
    logger.error('tasks.protokolLink.get', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

router.get('/:id/finish-cost-suggestions', authMiddleware, validateParams(taskIdParamsSchema), requireTaskAccess, async (req, res) => {
  try {
    const suggestions = await getTaskFinishCostSuggestions(pool, Number(req.params.id));
    if (!suggestions) return res.status(404).json({ error: req.t('errors.generic.notFound') });
    res.json(suggestions);
  } catch (err) {
    logger.error('tasks.finishCostSuggestions.get', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

router.put(
  '/:id/client-signature',
  authMiddleware,
  validateParams(taskIdParamsSchema),
  validateBody(taskClientSignatureSchema),
  requireTaskAccess,
  async (req, res) => {
    let client;
    try {
      await ensureTaskClientSignatureTable();
      client = await pool.connect();
      await client.query('BEGIN');
      const signedAt = req.body.signed_at ? new Date(req.body.signed_at) : new Date();
      const parsedSignedAt = Number.isNaN(signedAt.getTime()) ? new Date() : signedAt;
      const upsert = await client.query(
        `INSERT INTO task_client_signatures (
          task_id, signer_name, signature_data_url, signed_at, note, updated_by, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, NOW())
        ON CONFLICT (task_id)
        DO UPDATE SET
          signer_name = EXCLUDED.signer_name,
          signature_data_url = EXCLUDED.signature_data_url,
          signed_at = EXCLUDED.signed_at,
          note = EXCLUDED.note,
          updated_by = EXCLUDED.updated_by,
          updated_at = NOW()
        RETURNING *`,
        [
          req.params.id,
          req.body.signer_name.trim().slice(0, 120),
          req.body.signature_data_url || null,
          parsedSignedAt.toISOString(),
          req.body.note || null,
          req.user.id,
        ]
      );
      await client.query('COMMIT');
      res.json(upsert.rows[0] || null);
    } catch (err) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      logger.error('tasks.clientSignature.put', { message: err.message, requestId: req.requestId });
      res.status(500).json({ error: req.t('errors.http.serverError') });
    } finally {
      if (client) client.release();
    }
  }
);

router.get('/:id', authMiddleware, validateParams(taskIdParamsSchema), requireTaskAccess, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT t.*,
        te.nazwa as ekipa_nazwa,
        u.imie || ' ' || u.nazwisko as kierownik_nazwa,
        b.nazwa as oddzial_nazwa,
        COALESCE(ps.photo_total, 0)::int AS photo_total,
        COALESCE(ps.photo_wycena, 0)::int AS photo_wycena,
        COALESCE(ps.photo_szkic, 0)::int AS photo_szkic,
        COALESCE(ps.photo_dojazd, 0)::int AS photo_dojazd
       FROM tasks t
       LEFT JOIN teams te ON t.ekipa_id = te.id
       LEFT JOIN users u ON t.brygadzista_id = u.id
       LEFT JOIN branches b ON t.oddzial_id = b.id
       LEFT JOIN (
         SELECT
           p.task_id,
           COUNT(*)::int AS photo_total,
           COUNT(*) FILTER (WHERE LOWER(COALESCE(p.typ, '')) IN ('wycena', 'przed', 'checkin'))::int AS photo_wycena,
           COUNT(*) FILTER (WHERE LOWER(COALESCE(p.typ, '')) IN ('szkic', 'sketch'))::int AS photo_szkic,
           COUNT(*) FILTER (WHERE LOWER(COALESCE(p.typ, '')) IN ('dojazd', 'posesja', 'dojazd_posesja'))::int AS photo_dojazd
         FROM photos p
         GROUP BY p.task_id
       ) ps ON ps.task_id = t.id
       WHERE t.id = $1`,
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: req.t('errors.generic.notFound') });
    const row = result.rows[0];
    try {
      const pay = await pool.query(`SELECT * FROM task_client_payments WHERE task_id = $1`, [req.params.id]);
      row.client_payment = pay.rows[0] || null;
    } catch {
      row.client_payment = null;
    }
    try {
      const ex = await pool.query(`SELECT * FROM task_extra_work WHERE task_id = $1 ORDER BY id DESC`, [req.params.id]);
      row.extra_work = ex.rows;
    } catch {
      row.extra_work = [];
    }
    try {
      await ensureTaskClientSignatureTable();
      const sig = await pool.query(
        `SELECT task_id, signer_name, signature_data_url, signed_at, note, updated_at, updated_by
         FROM task_client_signatures WHERE task_id = $1`,
        [req.params.id]
      );
      row.client_signature = sig.rows[0] || null;
    } catch {
      row.client_signature = null;
    }
    try {
      const equipment = await pool.query(
        `SELECT r.id, r.sprzet_id, r.ekipa_id, r.data_od, r.data_do, r.caly_dzien,
                r.status, r.notatki,
                e.nazwa AS sprzet_nazwa, e.typ AS sprzet_typ, e.nr_seryjny,
                e.status AS sprzet_status, te.nazwa AS ekipa_nazwa
           FROM equipment_reservations r
           JOIN equipment_items e ON e.id = r.sprzet_id
           LEFT JOIN teams te ON te.id = r.ekipa_id
          WHERE r.task_id = $1
          ORDER BY r.data_od DESC, r.id DESC`,
        [req.params.id]
      );
      row.equipment_reservations = equipment.rows;
    } catch {
      row.equipment_reservations = [];
    }
    const tid = req.params.id;
    const { po: poCount, przed: prCount } = await countTaskFinishPhotos(pool, tid);
    row.finish_requirements = {
      require_po_photo: finishRequirePoPhoto(row.oddzial_id),
      require_przed_photo: finishRequirePrzedPhoto(row.oddzial_id),
      require_material_usage: finishRequireMaterialUsage(),
      has_po_photo: poCount >= FINISH_PHOTO_MIN.po,
      has_przed_photo: prCount >= FINISH_PHOTO_MIN.przed,
    };
    res.json(decorateTaskWorkflow(row));
  } catch (err) {
    logger.error('Blad pobierania zlecenia', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

router.put('/:id', authMiddleware, validateParams(taskIdParamsSchema), validateBody(taskUpdateSchema), requireTaskAccess, async (req, res) => {
  try {
    if (!canManageTaskBackoffice(req.user)) {
      return res.status(403).json({ error: req.t('errors.auth.forbidden') });
    }
    await ensureTaskOperationalColumns();
    const {
      klient_nazwa, klient_telefon, klient_email, adres, miasto,
      typ_uslugi, priorytet, wartosc_planowana,
      wartosc_rzeczywista, czas_planowany_godziny, data_planowana,
      godzina_rozpoczecia, notatki_wewnetrzne, notatki, opis, opis_pracy,
      notatki_klienta, oddzial_id, ekipa_id, kierownik_id, wyceniajacy_id,
      status, wywoz, usuwanie_pni, czas_realizacji_godz, rebak, pila_wysiegniku,
      nozyce_dlugie, kosiarka, podkaszarka, lopata, mulczer, ilosc_osob,
      arborysta, wynik, budzet, rabat, kwota_minimalna, zrebki, drzewno,
      absence_override
    } = req.body;

    const curR = await pool.query(
      'SELECT * FROM tasks WHERE id = $1',
      [req.params.id]
    );
    if (!curR.rows.length) return res.status(404).json({ error: req.t('errors.generic.notFound') });
    const cur = curR.rows[0];
    const hasBody = (field) => Object.prototype.hasOwnProperty.call(req.body, field);
    const plannedDateTime = buildTaskPlannedDateTime(data_planowana, godzina_rozpoczecia);
    const nextPlannedDateTime = hasBody('data_planowana') || hasBody('godzina_rozpoczecia')
      ? plannedDateTime
      : cur.data_planowana;
    const nextOddzialId = isDyrektorOrAdmin(req.user)
      ? (hasBody('oddzial_id') ? toNum(oddzial_id) : cur.oddzial_id)
      : (cur.oddzial_id || req.user.oddzial_id);
    const nextTeamId = hasBody('ekipa_id') ? toNum(ekipa_id) : cur.ekipa_id;
    const nextEstimatorId = hasBody('wyceniajacy_id') ? toInt(wyceniajacy_id) : cur.wyceniajacy_id;
    const nextKierownikId = hasBody('kierownik_id') ? toInt(kierownik_id) : cur.kierownik_id;
    let nextStatus = status || cur.status || 'Nowe';
    if (!status && nextEstimatorId && cur.status === 'Nowe') nextStatus = 'Wycena_Terenowa';
    if (!canTaskStatusTransition(cur.status, nextStatus, { allowCancel: true })) {
      return res.status(409).json({
        error: `Niedozwolona zmiana statusu: ${cur.status || 'brak'} -> ${nextStatus || 'brak'}`,
        code: 'TASK_STATUS_TRANSITION_BLOCKED',
      });
    }
    if (nextStatus !== (cur.status || 'Nowe')) {
      const workflowCurrent = await fetchTaskWorkflowRow(req.params.id).catch(() => cur);
      const transitionCandidate = {
        ...(workflowCurrent || cur),
        status: cur.status || 'Nowe',
        klient_nazwa: hasBody('klient_nazwa') ? klient_nazwa : (workflowCurrent?.klient_nazwa ?? cur.klient_nazwa),
        klient_telefon: hasBody('klient_telefon') ? toStr(klient_telefon) : (workflowCurrent?.klient_telefon ?? cur.klient_telefon),
        adres: hasBody('adres') ? adres : (workflowCurrent?.adres ?? cur.adres),
        miasto: hasBody('miasto') ? miasto : (workflowCurrent?.miasto ?? cur.miasto),
        opis: hasBody('opis') ? toStr(opis) : (workflowCurrent?.opis ?? cur.opis),
        opis_pracy: hasBody('opis_pracy') ? toStr(opis_pracy) : (workflowCurrent?.opis_pracy ?? cur.opis_pracy),
        notatki_wewnetrzne: hasBody('notatki_wewnetrzne') ? toStr(notatki_wewnetrzne) : (workflowCurrent?.notatki_wewnetrzne ?? cur.notatki_wewnetrzne),
        notatki: hasBody('notatki') ? toStr(notatki) : (workflowCurrent?.notatki ?? cur.notatki),
        wynik: hasBody('wynik') ? toStr(wynik) : (workflowCurrent?.wynik ?? cur.wynik),
        wartosc_planowana: hasBody('wartosc_planowana') ? toNum(wartosc_planowana) : (workflowCurrent?.wartosc_planowana ?? cur.wartosc_planowana),
        budzet: hasBody('budzet') ? toNum(budzet) : (workflowCurrent?.budzet ?? cur.budzet),
        czas_planowany_godziny: hasBody('czas_planowany_godziny') ? toNum(czas_planowany_godziny) : (workflowCurrent?.czas_planowany_godziny ?? cur.czas_planowany_godziny),
        czas_realizacji_godz: hasBody('czas_realizacji_godz') ? toNum(czas_realizacji_godz) : (workflowCurrent?.czas_realizacji_godz ?? cur.czas_realizacji_godz),
        data_planowana: nextPlannedDateTime,
        godzina_rozpoczecia: hasBody('godzina_rozpoczecia') ? toStr(godzina_rozpoczecia) : (workflowCurrent?.godzina_rozpoczecia ?? cur.godzina_rozpoczecia),
        ekipa_id: nextTeamId,
        wyceniajacy_id: nextEstimatorId,
        rebak: hasBody('rebak') ? toBool(rebak) : (workflowCurrent?.rebak ?? cur.rebak),
        pila_wysiegniku: hasBody('pila_wysiegniku') ? toBool(pila_wysiegniku) : (workflowCurrent?.pila_wysiegniku ?? cur.pila_wysiegniku),
        nozyce_dlugie: hasBody('nozyce_dlugie') ? toBool(nozyce_dlugie) : (workflowCurrent?.nozyce_dlugie ?? cur.nozyce_dlugie),
        kosiarka: hasBody('kosiarka') ? toBool(kosiarka) : (workflowCurrent?.kosiarka ?? cur.kosiarka),
        podkaszarka: hasBody('podkaszarka') ? toBool(podkaszarka) : (workflowCurrent?.podkaszarka ?? cur.podkaszarka),
        lopata: hasBody('lopata') ? toBool(lopata) : (workflowCurrent?.lopata ?? cur.lopata),
        mulczer: hasBody('mulczer') ? toBool(mulczer) : (workflowCurrent?.mulczer ?? cur.mulczer),
        arborysta: hasBody('arborysta') ? toBool(arborysta) : (workflowCurrent?.arborysta ?? cur.arborysta),
      };
      const transitionBlockers = getTaskTransitionBlockers(transitionCandidate, nextStatus);
      if (transitionBlockers.length) {
        return res.status(409).json(taskTransitionBlockedPayload(cur.status, nextStatus, transitionBlockers));
      }
    }
    if (!isDyrektorOrAdmin(req.user) && nextOddzialId && Number(nextOddzialId) !== Number(req.user.oddzial_id)) {
      return res.status(403).json({ error: req.t('errors.auth.branchAccessDenied') });
    }
    if (nextTeamId && nextOddzialId) {
      const teamCheck = await assertTeamAvailableForBranch(pool, nextTeamId, nextOddzialId, nextPlannedDateTime);
      if (!teamCheck.ok) return res.status(teamCheck.status || 409).json({ error: teamCheck.error });
    }
    if (nextTeamId) {
      const competencyCheck = await assertTeamCompetenciesForTask(pool, {
        taskId: Number(req.params.id),
        teamId: Number(nextTeamId),
        plannedDate: nextPlannedDateTime,
      });
      if (!competencyCheck.ok) return sendCompetencyBlock(res, competencyCheck);
    }
    if (nextEstimatorId && nextOddzialId) {
      const estimatorCheck = await assertEstimatorAvailableForBranch(pool, nextEstimatorId, nextOddzialId, nextPlannedDateTime);
      if (!estimatorCheck.ok) return res.status(estimatorCheck.status || 409).json({ error: estimatorCheck.error });
    }
    const teamAttendance = nextTeamId ? await getTeamAttendanceForPlan(Number(nextTeamId), nextPlannedDateTime) : null;
    if (teamAttendance?.present === false && absence_override !== true) {
      return res.status(409).json({
        error: `Ekipa ${teamAttendance.teamName} jest oznaczona jako nieobecna w dniu ${teamAttendance.day}. Wymagane potwierdzenie kierownika.`,
        code: 'TEAM_ABSENT',
        attendance: {
          teamId: teamAttendance.teamId,
          teamName: teamAttendance.teamName,
          dateYmd: teamAttendance.day,
          present: false,
          note: teamAttendance.note,
          actor: teamAttendance.actor,
        },
      });
    }
    if (nextTeamId && hasExplicitPlannedHour(data_planowana, godzina_rozpoczecia)) {
      const planDay = String(nextPlannedDateTime).slice(0, 10);
      const busyRanges = await getTeamBusyRanges(pool, Number(nextTeamId), planDay, null, Number(req.params.id));
      const d = new Date(nextPlannedDateTime);
      if (!Number.isNaN(d.getTime())) {
        const startMin = d.getHours() * 60 + d.getMinutes();
        const durMin = Math.max(15, Math.round(Number(czas_planowany_godziny || 2) * 60));
        if (planRangeConflicts(busyRanges, startMin, durMin)) {
          return res.status(409).json({
            error: 'Konflikt terminu: ekipa ma juz zaplanowane zlecenie lub aktywna rezerwacje w tym przedziale.',
            code: 'TASK_PLAN_CONFLICT',
          });
        }
      }
    }

    const keepStr = (field, value) => hasBody(field) ? toStr(value) : cur[field];
    const keepNum = (field, value) => hasBody(field) ? toNum(value) : cur[field];
    const keepInt = (field, value) => hasBody(field) ? toInt(value) : cur[field];
    const keepBool = (field, value) => hasBody(field) ? toBool(value) : cur[field];

    const wr = hasBody('wartosc_rzeczywista')
      ? toNum(wartosc_rzeczywista)
      : cur.wartosc_rzeczywista;
    const hasOpisPracy = hasBody('opis_pracy');
    const hasOpis = hasBody('opis');
    const opisPracy = hasOpisPracy ? toStr(opis_pracy) : cur.opis_pracy;
    const op = hasOpisPracy
      ? (opisPracy || toStr(opis) || cur.opis)
      : hasOpis
        ? (toStr(opis) || opisPracy)
        : (cur.opis || opisPracy);
    const nk = hasBody('notatki_klienta')
      ? toStr(notatki_klienta)
      : cur.notatki_klienta;
    const absenceNote = teamAttendance?.present === false && absence_override === true
      ? [
        'WYJATEK PLANOWANIA EKIPY',
        `Kierownik potwierdzil aktualizacje zlecenia mimo nieobecnosci ekipy${teamAttendance.note ? `: ${teamAttendance.note}` : '.'}`,
        `Data zlecenia: ${String(nextPlannedDateTime || '').slice(0, 10) || '-'}`,
        `Ekipa: ${teamAttendance.teamName} (#${teamAttendance.teamId})`,
        `Operator: ${req.user.login || req.user.id || '-'}`,
      ].join('\n')
      : '';
    const internalNotes = absenceNote
      ? [String(keepStr('notatki_wewnetrzne', notatki_wewnetrzne) || '').trim(), absenceNote].filter(Boolean).join('\n\n').slice(0, 12000)
      : keepStr('notatki_wewnetrzne', notatki_wewnetrzne);

    const update = await pool.query(
      `UPDATE tasks SET
        klient_nazwa=$1, klient_telefon=$2, klient_email=$3, adres=$4, miasto=$5,
        typ_uslugi=$6, priorytet=$7, wartosc_planowana=$8,
        czas_planowany_godziny=$9, data_planowana=$10, godzina_rozpoczecia=$11,
        notatki_wewnetrzne=$12, notatki=$13,
        wartosc_rzeczywista=$14, opis=$15, opis_pracy=$16, notatki_klienta=$17,
        status=$18, oddzial_id=$19, ekipa_id=$20, kierownik_id=$21, wyceniajacy_id=$22,
        wywoz=$23, usuwanie_pni=$24, czas_realizacji_godz=$25, rebak=$26,
        pila_wysiegniku=$27, nozyce_dlugie=$28, kosiarka=$29, podkaszarka=$30,
        lopata=$31, mulczer=$32, ilosc_osob=$33, arborysta=$34,
        wynik=$35, budzet=$36, rabat=$37, kwota_minimalna=$38, zrebki=$39, drzewno=$40,
        updated_at=NOW()
       WHERE id=$41
       RETURNING *`,
      [
        klient_nazwa,
        toStr(klient_telefon),
        toStr(klient_email),
        adres,
        miasto,
        typ_uslugi,
        priorytet,
        toNum(wartosc_planowana),
        toNum(czas_planowany_godziny),
        nextPlannedDateTime,
        toStr(godzina_rozpoczecia),
        internalNotes,
        keepStr('notatki', notatki),
        wr,
        op,
        opisPracy,
        nk,
        nextStatus,
        nextOddzialId,
        nextTeamId,
        nextKierownikId,
        nextEstimatorId,
        keepBool('wywoz', wywoz),
        keepBool('usuwanie_pni', usuwanie_pni),
        keepNum('czas_realizacji_godz', czas_realizacji_godz),
        keepBool('rebak', rebak),
        keepBool('pila_wysiegniku', pila_wysiegniku),
        keepBool('nozyce_dlugie', nozyce_dlugie),
        keepBool('kosiarka', kosiarka),
        keepBool('podkaszarka', podkaszarka),
        keepBool('lopata', lopata),
        keepBool('mulczer', mulczer),
        keepInt('ilosc_osob', ilosc_osob),
        keepBool('arborysta', arborysta),
        keepStr('wynik', wynik),
        keepNum('budzet', budzet),
        keepNum('rabat', rabat),
        keepNum('kwota_minimalna', kwota_minimalna),
        keepStr('zrebki', zrebki),
        keepStr('drzewno', drzewno),
        req.params.id
      ]
    );
    const workflowRow = await fetchTaskWorkflowRow(req.params.id)
      .catch(() => update.rows[0] || { id: req.params.id, status: nextStatus });
    res.json(decorateTaskWorkflow(workflowRow || update.rows[0] || { id: req.params.id, status: nextStatus }));
  } catch (err) {
    logger.error('Blad aktualizacji zlecenia', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

router.put('/:id/field-package', authMiddleware, validateParams(taskIdParamsSchema), validateBody(taskFieldPackageSchema), requireTaskAccess, async (req, res) => {
  try {
    await ensureTaskOperationalColumns();
    const taskR = await pool.query(
      'SELECT id, status, wyceniajacy_id, notatki_wewnetrzne FROM tasks WHERE id = $1',
      [req.params.id]
    );
    if (!taskR.rows.length) return res.status(404).json({ error: req.t('errors.generic.notFound') });
    const task = taskR.rows[0];
    const assignedEstimator = isEstimator(req.user) && Number(task.wyceniajacy_id) === Number(req.user.id);
    if (!canManageTaskBackoffice(req.user) && !assignedEstimator) {
      return res.status(403).json({ error: req.t('errors.auth.forbidden') });
    }

    const zakres = toStr(req.body.zakres_prac || req.body.opis);
    const ryzyka = toStr(req.body.ryzyka);
    const typyPrac = Array.isArray(req.body.typy_prac) ? req.body.typy_prac.filter(Boolean).join(', ') : '';
    const sprzet = Array.isArray(req.body.sprzet) ? req.body.sprzet.filter(Boolean).join(', ') : '';
    const warunkiRozliczenia = toStr(req.body.warunki_rozliczenia);
    const odpady = toStr(req.body.odpady);
    const hours = toNum(req.body.czas_planowany_godziny);
    const value = toNum(req.body.wartosc_planowana);
    const accepted = req.body.klient_zaakceptowal === true;
    const nextStatus = req.body.send_to_office && accepted ? 'Do_Zatwierdzenia' : task.status;
    const actor = [req.user.imie, req.user.nazwisko].filter(Boolean).join(' ') || req.user.login || `#${req.user.id}`;
    const fieldLines = [
      'PRZEKAZANIE DO BIURA',
      `Typy prac: ${typyPrac || '-'}`,
      `Zakres prac: ${zakres || '-'}`,
      `Czas pracy: ${hours != null ? `${hours} h` : '-'}`,
      `Budzet klienta: ${value != null ? `${value} PLN` : '-'}`,
      `Sprzet: ${sprzet || '-'}`,
      `Warunki rozliczenia: ${warunkiRozliczenia || '-'}`,
      `Odpady: ${odpady || '-'}`,
      `Ryzyka: ${ryzyka || '-'}`,
      `Klient zaakceptowal: ${accepted ? 'tak' : 'nie'}`,
      `Specjalista ds. wyceny: ${actor}`,
      `Data przekazania: ${new Date().toISOString()}`,
    ];
    const nextNotes = [
      String(task.notatki_wewnetrzne || '').trim(),
      fieldLines.join('\n'),
    ].filter(Boolean).join('\n\n').slice(0, 12000);

    if (nextStatus !== task.status) {
      const workflowCurrent = await fetchTaskWorkflowRow(req.params.id).catch(() => task);
      const transitionBlockers = getTaskTransitionBlockers({
        ...(workflowCurrent || task),
        status: task.status,
        opis: zakres || workflowCurrent?.opis,
        opis_pracy: zakres || workflowCurrent?.opis_pracy,
        notatki_wewnetrzne: nextNotes,
        notatki: nextNotes,
        czas_planowany_godziny: hours ?? workflowCurrent?.czas_planowany_godziny,
        wartosc_planowana: value ?? workflowCurrent?.wartosc_planowana,
        budzet: value ?? workflowCurrent?.budzet,
        wynik: accepted ? 'Klient zaakceptowal zakres i budzet w terenie.' : workflowCurrent?.wynik,
      }, nextStatus);
      if (transitionBlockers.length) {
        return res.status(409).json(taskTransitionBlockedPayload(task.status, nextStatus, transitionBlockers));
      }
    }

    const update = await pool.query(
      `UPDATE tasks
       SET opis = COALESCE($1, opis),
           opis_pracy = COALESCE($1, opis_pracy),
           notatki_wewnetrzne = $2,
           notatki = $2,
           czas_planowany_godziny = COALESCE($3, czas_planowany_godziny),
           wartosc_planowana = COALESCE($4, wartosc_planowana),
           budzet = COALESCE($4, budzet),
           wynik = COALESCE($7, wynik),
           status = $5,
           updated_at = NOW()
       WHERE id = $6
       RETURNING id, status`,
      [zakres, nextNotes, hours, value, nextStatus, req.params.id, accepted ? 'Klient zaakceptowal zakres i budzet w terenie.' : null]
    );

    const workflowRow = await fetchTaskWorkflowRow(req.params.id)
      .catch(() => update.rows[0] || { id: req.params.id, status: nextStatus });
    res.json({
      message: 'Pakiet terenowy zapisany',
      ...decorateTaskWorkflow(workflowRow || update.rows[0] || { id: req.params.id, status: nextStatus }),
    });
  } catch (err) {
    logger.error('Blad zapisu pakietu terenowego', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

router.put('/:id/office-plan', authMiddleware, validateParams(taskIdParamsSchema), validateBody(taskOfficePlanSchema), requireTaskAccess, async (req, res) => {
  try {
    if (!canManageTaskBackoffice(req.user)) {
      return res.status(403).json({ error: req.t('errors.auth.forbidden') });
    }
    const taskId = Number(req.params.id);
    const { data_planowana, godzina_rozpoczecia, czas_planowany_godziny, ekipa_id, sprzet_notatka, sprzet_ids, absence_override } = req.body;
    const shouldSyncEquipment = Object.prototype.hasOwnProperty.call(req.body, 'sprzet_ids');
    const selectedEquipmentIds = shouldSyncEquipment ? normalizeIdList(sprzet_ids) : [];
    const taskR = await pool.query(
      'SELECT id, status, oddzial_id, notatki_wewnetrzne, okno_od, okno_do FROM tasks WHERE id = $1',
      [taskId]
    );
    if (!taskR.rows.length) return res.status(404).json({ error: req.t('errors.generic.notFound') });
    const task = taskR.rows[0];
    if (task.status === 'Zakonczone' || task.status === 'Anulowane') {
      return res.status(400).json({ error: 'Nie można planować zakończonego lub anulowanego zlecenia.' });
    }

    const plannedDateTime = buildTaskPlannedDateTime(data_planowana, godzina_rozpoczecia);
    const hours = toNum(czas_planowany_godziny) ?? 2;
    const windowConflict = planWindowViolation({
      oknoOd: task.okno_od,
      oknoDo: task.okno_do,
      plannedDateTime,
      godzinaRozpoczecia: godzina_rozpoczecia,
      durationHours: hours,
    });
    if (windowConflict) return res.status(409).json(windowConflict);
    const teamId = toNum(ekipa_id);
    if (!teamId) return res.status(400).json({ error: 'Wybierz ekipę.' });

    let teamCheckRow = null;
    if (task.oddzial_id) {
      const teamCheck = await assertTeamAvailableForBranch(pool, teamId, task.oddzial_id, plannedDateTime);
      if (!teamCheck.ok) return res.status(teamCheck.status || 409).json({ error: teamCheck.error });
      teamCheckRow = teamCheck.row || null;
    }
    const competencyCheck = await assertTeamCompetenciesForTask(pool, {
      taskId,
      teamId,
      plannedDate: plannedDateTime,
    });
    if (!competencyCheck.ok) return sendCompetencyBlock(res, competencyCheck);
    const resourceCheck = await assertTeamResourcesAvailableForPlan(pool, teamId);
    if (!resourceCheck.ok) {
      return res.status(resourceCheck.status || 409).json({
        error: resourceCheck.error,
        code: resourceCheck.code,
        items: resourceCheck.items,
      });
    }
    const teamAttendance = await getTeamAttendanceForPlan(teamId, plannedDateTime);
    if (teamAttendance?.present === false && absence_override !== true) {
      return res.status(409).json({
        error: `Ekipa ${teamAttendance.teamName} jest oznaczona jako nieobecna w dniu ${teamAttendance.day}. Wymagane potwierdzenie kierownika.`,
        code: 'TEAM_ABSENT',
        attendance: {
          teamId: teamAttendance.teamId,
          teamName: teamAttendance.teamName,
          dateYmd: teamAttendance.day,
          present: false,
          note: teamAttendance.note,
          actor: teamAttendance.actor,
        },
      });
    }
    const planDay = String(plannedDateTime).slice(0, 10);
    const busyRanges = await getTeamBusyRanges(pool, teamId, planDay, null, taskId);
    const d = new Date(plannedDateTime);
    const startMin = d.getHours() * 60 + d.getMinutes();
    const durMin = Math.max(15, Math.round(Number(hours || 2) * 60));
    if (planRangeConflicts(busyRanges, startMin, durMin)) {
      return res.status(409).json({
        error: 'Konflikt terminu: ekipa ma już zaplanowane zlecenie lub aktywną rezerwację w tym przedziale.',
        code: 'TASK_PLAN_CONFLICT',
      });
    }

    const absenceNote = teamAttendance?.present === false && absence_override === true
      ? `Kierownik potwierdzil plan mimo nieobecnosci ekipy${teamAttendance.note ? `: ${teamAttendance.note}` : '.'}`
      : '';
    const note = [String(sprzet_notatka || '').trim(), absenceNote]
      .filter(Boolean)
      .join('\n')
      .slice(0, 2000);
    const workflowCurrent = await fetchTaskWorkflowRow(taskId).catch(() => task);
    if (task.status !== 'Zaplanowane') {
      const transitionBlockers = getTaskTransitionBlockers({
        ...(workflowCurrent || task),
        status: task.status,
        data_planowana: plannedDateTime,
        godzina_rozpoczecia: toStr(godzina_rozpoczecia),
        czas_planowany_godziny: hours,
        ekipa_id: teamId,
        sprzet_ids: selectedEquipmentIds,
        sprzet_notatka: note,
      }, 'Zaplanowane');
      if (transitionBlockers.length) {
        return res.status(409).json(taskTransitionBlockedPayload(task.status, 'Zaplanowane', transitionBlockers));
      }
    }
    const equipmentSync = shouldSyncEquipment
      ? await syncTaskEquipmentReservations(pool, {
        taskId,
        oddzialId: task.oddzial_id,
        teamId,
        plannedDateTime,
        sprzetIds: selectedEquipmentIds,
        note,
        userId: req.user.id,
      })
      : { ok: true, reservations: [] };
    if (!equipmentSync.ok) {
      return res.status(equipmentSync.status || 400).json({
        error: equipmentSync.error,
        code: equipmentSync.code,
      });
    }
    const equipmentNames = equipmentSync.reservations.map((item) => item.sprzet_nazwa).filter(Boolean);
    const teamName = teamCheckRow?.nazwa
      || (Number(workflowCurrent?.ekipa_id) === Number(teamId) ? workflowCurrent?.ekipa_nazwa : '')
      || `#${teamId}`;
    const planLines = buildOfficePlanPackageLines({
      task: workflowCurrent || task,
      plannedDateTime,
      hours,
      teamId,
      teamName,
      equipmentNames,
      note,
      actor: req.user.login || req.user.id,
    });
    const nextNotes = [String(task.notatki_wewnetrzne || '').trim(), planLines.join('\n')]
      .filter(Boolean)
      .join('\n\n')
      .slice(0, 12000);

    const update = await pool.query(
      `UPDATE tasks
       SET data_planowana = $1::timestamptz,
           czas_planowany_godziny = $2,
           ekipa_id = $3,
           status = 'Zaplanowane',
           notatki_wewnetrzne = $4,
           godzina_rozpoczecia = COALESCE($5::time, godzina_rozpoczecia),
           updated_at = NOW()
       WHERE id = $6
       RETURNING id, status`,
      [plannedDateTime, hours, teamId, nextNotes, toStr(godzina_rozpoczecia) || null, taskId]
    );
    const workflowRow = await fetchTaskWorkflowRow(taskId)
      .catch(() => update.rows[0] || { id: taskId, status: 'Zaplanowane' });
    res.json({
      message: equipmentNames.length
        ? `Zlecenie zaplanowane. Zarezerwowano sprzet: ${equipmentNames.join(', ')}.`
        : 'Zlecenie zaplanowane',
      ...decorateTaskWorkflow(workflowRow || update.rows[0] || { id: taskId, status: 'Zaplanowane' }),
      ekipa_nazwa: workflowRow?.ekipa_nazwa || teamName,
      sprzet_ids: shouldSyncEquipment ? selectedEquipmentIds : undefined,
      rezerwacje_sprzetu: equipmentSync.reservations,
    });
  } catch (err) {
    logger.error('Blad planowania zlecenia przez biuro', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

router.put('/:id/przypisz', authMiddleware, validateParams(taskIdParamsSchema), validateBody(taskAssignSchema), requireTaskAccess, async (req, res) => {
  try {
    if (!canManageTaskBackoffice(req.user)) {
      return res.status(403).json({ error: req.t('errors.auth.forbidden') });
    }
    const { ekipa_id, absence_override } = req.body;
    const taskR = await pool.query(
      'SELECT id, oddzial_id, data_planowana, czas_planowany_godziny, status, notatki_wewnetrzne FROM tasks WHERE id = $1',
      [req.params.id]
    );
    if (!taskR.rows.length) return res.status(404).json({ error: req.t('errors.generic.notFound') });
    const task = taskR.rows[0];
    if (task.status === 'Zakonczone' || task.status === 'Anulowane') {
      return res.status(400).json({ error: 'Nie można przypisać ekipy do zakończonego lub anulowanego zlecenia.' });
    }
    if (task.oddzial_id) {
      const teamCheck = await assertTeamAvailableForBranch(pool, ekipa_id, task.oddzial_id, task.data_planowana);
      if (!teamCheck.ok) return res.status(teamCheck.status || 409).json({ error: teamCheck.error });
    }
    const competencyCheck = await assertTeamCompetenciesForTask(pool, {
      taskId: Number(req.params.id),
      teamId: Number(ekipa_id),
      plannedDate: task.data_planowana,
    });
    if (!competencyCheck.ok) return sendCompetencyBlock(res, competencyCheck);
    const resourceCheck = await assertTeamResourcesAvailableForPlan(pool, Number(ekipa_id));
    if (!resourceCheck.ok) {
      return res.status(resourceCheck.status || 409).json({
        error: resourceCheck.error,
        code: resourceCheck.code,
        items: resourceCheck.items,
      });
    }
    const teamAttendance = await getTeamAttendanceForPlan(Number(ekipa_id), task.data_planowana);
    if (teamAttendance?.present === false && absence_override !== true) {
      return res.status(409).json({
        error: `Ekipa ${teamAttendance.teamName} jest oznaczona jako nieobecna w dniu ${teamAttendance.day}. Wymagane potwierdzenie kierownika.`,
        code: 'TEAM_ABSENT',
        attendance: {
          teamId: teamAttendance.teamId,
          teamName: teamAttendance.teamName,
          dateYmd: teamAttendance.day,
          present: false,
          note: teamAttendance.note,
          actor: teamAttendance.actor,
        },
      });
    }
    if (task.data_planowana) {
      const planDay = String(task.data_planowana).slice(0, 10);
      const busyRanges = await getTeamBusyRanges(pool, Number(ekipa_id), planDay, null, Number(req.params.id));
      const d = new Date(task.data_planowana);
      const startMin = d.getHours() * 60 + d.getMinutes();
      const durMin = Math.max(15, Math.round(Number(task.czas_planowany_godziny || 2) * 60));
      if (planRangeConflicts(busyRanges, startMin, durMin)) {
        return res.status(409).json({
          error: 'Konflikt terminu: ekipa ma już zaplanowane zlecenie lub aktywną rezerwację w tym przedziale.',
          code: 'TASK_PLAN_CONFLICT',
        });
      }
    }
    let nextAssignedStatus = task.status;
    if (task.status === 'Do_Zatwierdzenia') {
      const workflowCurrent = await fetchTaskWorkflowRow(req.params.id).catch(() => task);
      const transitionBlockers = getTaskTransitionBlockers({
        ...(workflowCurrent || task),
        status: task.status,
        ekipa_id: toNum(ekipa_id),
      }, 'Zaplanowane');
      if (transitionBlockers.length === 0) {
        nextAssignedStatus = 'Zaplanowane';
      }
    }
    const absenceNote = teamAttendance?.present === false && absence_override === true
      ? [
        'WYJATEK PLANOWANIA EKIPY',
        `Kierownik potwierdzil przypisanie mimo nieobecnosci ekipy${teamAttendance.note ? `: ${teamAttendance.note}` : '.'}`,
        `Data zlecenia: ${String(task.data_planowana || '').slice(0, 10) || '-'}`,
        `Ekipa: ${teamAttendance.teamName} (#${teamAttendance.teamId})`,
        `Operator: ${req.user.login || req.user.id || '-'}`,
      ].join('\n')
      : '';
    const nextNotes = absenceNote
      ? [String(task.notatki_wewnetrzne || '').trim(), absenceNote].filter(Boolean).join('\n\n').slice(0, 12000)
      : null;
    const update = await pool.query(
      `UPDATE tasks
       SET ekipa_id = $1,
           status = $3,
           notatki_wewnetrzne = COALESCE($4::text, notatki_wewnetrzne),
           updated_at = NOW()
       WHERE id = $2
       RETURNING id, status`,
      [toNum(ekipa_id), req.params.id, nextAssignedStatus, nextNotes]
    );
    if (nextAssignedStatus !== task.status) {
      await recordTaskPublicStatusEvent(pool, {
        taskId: Number(req.params.id),
        fromStatus: task.status,
        toStatus: nextAssignedStatus,
        source: 'assignment',
        userId: req.user.id,
      }).catch((error) => logger.warn('tasks.public_status.assign', { message: error.message, taskId: req.params.id }));
    }
    const workflowRow = await fetchTaskWorkflowRow(req.params.id)
      .catch(() => update.rows[0] || { id: req.params.id, status: task.status });
    res.json({
      message: 'Ekipa przypisana',
      ...decorateTaskWorkflow(workflowRow || update.rows[0] || { id: req.params.id, status: task.status }),
    });
  } catch (err) {
    logger.error('Blad przypisywania ekipy', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

router.put('/:id/status', authMiddleware, validateParams(taskIdParamsSchema), validateBody(taskStatusSchema), requireTaskAccess, async (req, res) => {
  if (!canManageTaskBackoffice(req.user)) {
    return res.status(403).json({ error: req.t('errors.auth.forbidden') });
  }
  const taskId = Number(req.params.id);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const replay = await tryConsumeIdempotencyKey(client, req, `task:${taskId}:status`);
    if (replay) {
      await client.query('ROLLBACK');
      const workflowRow = await fetchTaskWorkflowRow(taskId)
        .catch(() => ({ id: taskId }));
      return res.json({
        message: 'Status zmieniony',
        idempotent_replay: true,
        ...decorateTaskWorkflow(workflowRow || { id: taskId }),
      });
    }
    const { status } = req.body;
    const prevR = await client.query('SELECT status, oddzial_id FROM tasks WHERE id = $1', [taskId]);
    if (!prevR.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: req.t('errors.generic.notFound') });
    }
    const prevStatus = prevR.rows[0]?.status;
    const taskOddzialId = prevR.rows[0]?.oddzial_id;
    if (!canTaskStatusTransition(prevStatus, status, { allowCancel: true })) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: `Niedozwolona zmiana statusu: ${prevStatus || 'brak'} -> ${status || 'brak'}`,
        code: 'TASK_STATUS_TRANSITION_BLOCKED',
      });
    }
    const workflowCurrent = await fetchTaskWorkflowRow(taskId).catch(() => prevR.rows[0] || { id: taskId, status: prevStatus });
    const transitionBlockers = getTaskTransitionBlockers({
      ...(workflowCurrent || prevR.rows[0] || {}),
      status: prevStatus,
    }, status);
    if (transitionBlockers.length) {
      await client.query('ROLLBACK');
      return res.status(409).json(taskTransitionBlockedPayload(prevStatus, status, transitionBlockers));
    }
    await client.query('UPDATE tasks SET status = $1, updated_at = NOW() WHERE id = $2', [status, taskId]);
    await recordTaskPublicStatusEvent(client, {
      taskId,
      fromStatus: prevStatus,
      toStatus: status,
      source: 'manual',
      userId: req.user.id,
    });
    await client.query('COMMIT');
    await req.auditLog({
      action: 'task.status_change',
      entityType: 'task',
      entityId: taskId,
      metadata: { from: prevStatus, to: status, oddzial_id: taskOddzialId },
    });
    // EPIC 8: auto-sync status to Kommo (fire-and-forget, never blocks response)
    if (kommoWebhookConfigured('crm')) {
      const fullTask = await pool.query('SELECT * FROM tasks WHERE id = $1', [taskId]);
      if (fullTask.rows.length) {
        syncTaskToKommo(pool, fullTask.rows[0], { id: req.user.id, login: req.user.login }).catch(() => {});
      }
    }
    // Real-time SSE: push task_update event to the assigned team member if present
    try {
      const tRow = await pool.query(
        `SELECT t.ekipa_id, e.brygadzista_id
         FROM tasks t LEFT JOIN teams e ON e.id = t.ekipa_id
         WHERE t.id = $1`, [taskId]
      );
      if (tRow.rows[0]?.brygadzista_id) {
        pushToUser(tRow.rows[0].brygadzista_id, { event: 'task_update', task_id: taskId, status });
      }
    } catch { /* non-critical */ }
    const workflowRow = await fetchTaskWorkflowRow(taskId)
      .catch(() => ({ id: taskId, status }));
    res.json({
      message: 'Status zmieniony',
      ...decorateTaskWorkflow(workflowRow || { id: taskId, status }),
    });
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    logger.error('Blad aktualizacji statusu', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  } finally {
    client.release();
  }
});

router.post('/:id/checkin', authMiddleware, validateParams(taskIdParamsSchema), validateBody(taskCheckinSchema), requireTaskAccess, async (req, res) => {
  const taskId = Number(req.params.id);
  const latN = toNum(req.body.lat);
  const lngN = toNum(req.body.lng);

  if (!isTeamScoped(req.user) && !canManageTaskBackoffice(req.user)) {
    return res.status(403).json({ error: req.t('errors.auth.forbidden') });
  }
  if (isTeamScoped(req.user) && (latN == null || lngN == null)) {
    return res.status(400).json({
      error: req.t('errors.tasks.startLocationRequired'),
      code: VALIDATION_FAILED,
      requestId: req.requestId,
    });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const replay = await tryConsumeIdempotencyKey(client, req, `task:${taskId}:checkin`);
    if (replay) {
      const wl = await client.query(
        `SELECT id FROM work_logs WHERE task_id = $1 AND user_id = $2 AND status = 'Check_In' ORDER BY start_time DESC LIMIT 1`,
        [taskId, req.user.id]
      );
      await client.query('ROLLBACK');
      return res.json({ message: 'Check-in zapisany', checkin_id: wl.rows[0]?.id ?? null, idempotent_replay: true });
    }
    const result = await client.query(
      `INSERT INTO work_logs (
        task_id, user_id, start_time, end_time, start_lat, start_lng, end_lat, end_lng, status, czas_pracy_minuty
      ) VALUES ($1, $2, NOW(), NOW(), $3, $4, $3, $4, 'Check_In', 0) RETURNING id`,
      [taskId, req.user.id, latN, lngN]
    );
    await client.query('COMMIT');
    await req.auditLog({
      action: 'task.field_checkin',
      entityType: 'task',
      entityId: taskId,
      metadata: { lat: latN, lng: lngN, note: req.body.note || null },
    });
    res.json({ message: 'Check-in zapisany', checkin_id: result.rows[0].id });
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    logger.error('Blad check-in zlecenia', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  } finally {
    client.release();
  }
});

router.post('/:id/start', authMiddleware, validateParams(taskIdParamsSchema), validateBody(taskStartSchema), requireTaskAccess, async (req, res) => {
  const { lat, lng, dmuchawa_filtr_ok, rebak_zatankowany, kaski_zespol, bhp_potwierdzone, bhp_checklista } = req.body;
  const latN = toNum(lat);
  const lngN = toNum(lng);

  if (isTeamScoped(req.user)) {
    if (latN == null || lngN == null) {
      return res.status(400).json({
        error: req.t('errors.tasks.startLocationRequired'),
        code: VALIDATION_FAILED,
        requestId: req.requestId,
      });
    }
    const need = [
      ['dmuchawa_filtr_ok', dmuchawa_filtr_ok],
      ['rebak_zatankowany', rebak_zatankowany],
      ['kaski_zespol', kaski_zespol],
    ];
    for (const [, v] of need) {
      if (typeof v !== 'boolean') {
        return res.status(400).json({
          error: req.t('errors.tasks.startChecklistIncomplete'),
          code: VALIDATION_FAILED,
          requestId: req.requestId,
        });
      }
    }
    if (bhp_potwierdzone !== true) {
      return res.status(400).json({
        error: req.t('errors.tasks.bhpMustConfirm'),
        code: VALIDATION_FAILED,
        requestId: req.requestId,
      });
    }
    const checklistOk = Array.isArray(bhp_checklista) &&
      bhp_checklista.length > 0 &&
      bhp_checklista.every((row) => row && row.done === true);
    if (!checklistOk) {
      return res.status(400).json({
        error: req.t('errors.tasks.bhpMustConfirm'),
        code: VALIDATION_FAILED,
        requestId: req.requestId,
      });
    }
  }

  const taskId = Number(req.params.id);
  await ensureWorkLogSafetyColumns();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const replay = await tryConsumeIdempotencyKey(client, req, `task:${taskId}:start`);
    if (replay) {
      const wl = await client.query(
        `SELECT id FROM work_logs WHERE task_id = $1 AND end_time IS NULL ORDER BY start_time DESC LIMIT 1`,
        [taskId]
      );
      await client.query('ROLLBACK');
      return res.json({ work_log_id: wl.rows[0]?.id ?? null, idempotent_replay: true });
    }
    const taskRow = await client.query(
      `SELECT status FROM tasks WHERE id = $1 FOR UPDATE`,
      [taskId]
    );
    if (['Zakonczone', 'Anulowane'].includes(String(taskRow.rows[0]?.status || ''))) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: 'Zlecenie jest juz zamkniete.',
        code: VALIDATION_FAILED,
        reason: 'TASK_NOT_STARTABLE',
        requestId: req.requestId,
      });
    }
    const activeWorkLog = await client.query(
      `SELECT id, user_id, start_time FROM work_logs WHERE task_id = $1 AND end_time IS NULL ORDER BY start_time DESC LIMIT 1`,
      [taskId]
    );
    if (activeWorkLog.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: 'Praca na tym zleceniu jest juz rozpoczeta.',
        code: VALIDATION_FAILED,
        reason: 'TASK_WORK_LOG_ACTIVE',
        work_log_id: activeWorkLog.rows[0].id,
        requestId: req.requestId,
      });
    }
    const result = await client.query(
      `INSERT INTO work_logs (
        task_id, user_id, start_time, start_lat, start_lng, status,
        dmuchawa_filtr_ok, rebak_zatankowany, kaski_zespol, bhp_potwierdzone, bhp_checklista
      ) VALUES ($1, $2, NOW(), $3, $4, 'W_Trakcie', $5, $6, $7, $8, $9::jsonb) RETURNING id`,
      [
        req.params.id,
        req.user.id,
        latN,
        lngN,
        isTeamScoped(req.user) ? dmuchawa_filtr_ok : null,
        isTeamScoped(req.user) ? rebak_zatankowany : null,
        isTeamScoped(req.user) ? kaski_zespol : null,
        isTeamScoped(req.user) ? bhp_potwierdzone : null,
        isTeamScoped(req.user) ? JSON.stringify(bhp_checklista || []) : null,
      ]
    );
    await client.query(
      `UPDATE tasks SET status = 'W_Realizacji', data_rozpoczecia = COALESCE(data_rozpoczecia, NOW()) WHERE id = $1`,
      [req.params.id]
    );
    await recordTaskPublicStatusEvent(client, {
      taskId,
      toStatus: 'W_Realizacji',
      source: 'start',
      userId: req.user.id,
    });
    await client.query('COMMIT');
    res.json({ work_log_id: result.rows[0].id });
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    logger.error('Blad rozpoczecia pracy', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  } finally {
    client.release();
  }
});

router.post('/:id/stop', authMiddleware, validateParams(taskIdParamsSchema), validateBody(taskStopSchema), requireTaskAccess, async (req, res) => {
  const taskId = Number(req.params.id);
  const { lat, lng, work_log_id } = req.body;
  const latN = toNum(lat);
  const lngN = toNum(lng);

  if (isTeamScoped(req.user) && (latN == null || lngN == null)) {
    return res.status(400).json({
      error: req.t('errors.tasks.startLocationRequired'),
      code: VALIDATION_FAILED,
      requestId: req.requestId,
    });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const replay = await tryConsumeIdempotencyKey(client, req, `task:${taskId}:stop`);
    if (replay) {
      await client.query('ROLLBACK');
      return res.json({ message: 'Czas zapisany', idempotent_replay: true });
    }
    const activeWorkLog = await client.query(
      `SELECT id, end_time FROM work_logs WHERE id = $1 AND task_id = $2 FOR UPDATE`,
      [work_log_id, taskId]
    );
    if (!activeWorkLog.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'Nie znaleziono aktywnego czasu pracy dla tego zlecenia.',
        code: VALIDATION_FAILED,
        reason: 'TASK_WORK_LOG_NOT_FOUND',
        requestId: req.requestId,
      });
    }
    if (activeWorkLog.rows[0].end_time) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: 'Ten czas pracy jest juz zakonczony.',
        code: VALIDATION_FAILED,
        reason: 'TASK_WORK_LOG_ALREADY_STOPPED',
        requestId: req.requestId,
      });
    }
    await client.query(
      `UPDATE work_logs SET end_time = NOW(), end_lat = $1, end_lng = $2,
       status = 'Zakończony',
       czas_pracy_minuty = EXTRACT(EPOCH FROM (NOW() - start_time))/60
       WHERE id = $3`,
      [latN, lngN, work_log_id]
    );
    await client.query(
      "UPDATE tasks SET status = 'Zakonczone', data_zakonczenia = COALESCE(data_zakonczenia, NOW()) WHERE id = $1",
      [req.params.id]
    );
    await recordTaskPublicStatusEvent(client, {
      taskId,
      toStatus: 'Zakonczone',
      source: 'stop',
      userId: req.user.id,
    });
    await client.query('COMMIT');
    res.json({ message: 'Czas zapisany' });
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    logger.error('Blad zakonczenia pracy', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  } finally {
    client.release();
  }
});

/** M3 F3.9 — zakończenie zlecenia z obowiązkową formą płatności dla ekipy (mobile: POST /finish). */
router.post(
  '/:id/finish',
  authMiddleware,
  validateParams(taskIdParamsSchema),
  validateBody(taskFinishSchema),
  requireTaskAccess,
  async (req, res) => {
    const taskId = Number(req.params.id);
    const cardPct = parseFloat(process.env.PAYROLL_CARD_COMMISSION_PCT || '1.5', 10);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const replay = await tryConsumeIdempotencyKey(client, req, `task:${taskId}:finish`);
      if (replay) {
        await client.query('ROLLBACK');
        const t2 = await pool.query(
          `SELECT status, wartosc_netto_do_rozliczenia FROM tasks WHERE id = $1`,
          [taskId]
        );
        const tr = t2.rows[0];
        if (tr && tr.status === 'Zakonczone') {
          return res.json({
            message: 'Zlecenie zakończone',
            wartosc_netto_do_rozliczenia: Number(tr.wartosc_netto_do_rozliczenia) || 0,
            idempotent_replay: true,
          });
        }
        return res.status(409).json({
          error:
            'Idempotency-Key już użyty, a zlecenie nie jest zakończone — nie można bezpiecznie powtórzyć.',
          code: 'IDEMPOTENCY_INCOMPLETE',
          requestId: req.requestId,
        });
      }
      const tRes = await client.query(`SELECT * FROM tasks WHERE id = $1 FOR UPDATE`, [taskId]);
      const task = tRes.rows[0];
      if (!task) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: req.t('errors.generic.notFound') });
      }
      if (task.status === 'Zakonczone') {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: req.t('errors.tasks.taskAlreadyFinished'),
          code: VALIDATION_FAILED,
          reason: 'TASK_ALREADY_FINISHED',
          requestId: req.requestId,
        });
      }
      const payment = req.body.payment;
      if (isTeamScoped(req.user)) {
        const payErr = validateClientPayment(payment, { requireAll: true });
        if (payErr.length) {
          await client.query('ROLLBACK');
          return res.status(400).json({
            error: payErr.join('; '),
            code: 'PAYMENT_REQUIRED',
            requestId: req.requestId,
          });
        }
      }
      if (isTeamScoped(req.user)) {
        try {
          await assertTeamFinishPhotoRules(client, task);
        } catch (e) {
          await client.query('ROLLBACK');
          if (e.code === 'TASK_FINISH_PO_PHOTO_REQUIRED') {
            return res.status(400).json({
              error: req.t('errors.tasks.finishPoPhotoRequired'),
              code: e.code,
              requestId: req.requestId,
            });
          }
          if (e.code === 'TASK_FINISH_PRZED_PHOTO_REQUIRED') {
            return res.status(400).json({
              error: req.t('errors.tasks.finishPrzedPhotoRequired'),
              code: e.code,
              requestId: req.requestId,
            });
          }
          throw e;
        }
        const zu = req.body.zuzyte_materialy;
        if (finishRequireMaterialUsage()) {
          const ok = Array.isArray(zu) && zu.some((r) => r && String(r.nazwa || '').trim().length > 0);
          if (!ok) {
            await client.query('ROLLBACK');
            return res.status(400).json({
              error: req.t('errors.tasks.finishMaterialUsageRequired'),
              code: 'TASK_FINISH_MATERIAL_USAGE_REQUIRED',
              requestId: req.requestId,
            });
          }
        }
      }
      const costValidation = validateFinishCostPayload({
        task,
        materialRows: req.body.zuzyte_materialy,
        operationalRows: req.body.koszty_operacyjne,
      });
      if (!costValidation.ok) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: costValidation.errors.join('; '),
          code: 'TASK_FINISH_COST_VALIDATION_FAILED',
          details: costValidation,
          requestId: req.requestId,
        });
      }
      const wl = await client.query(
        `SELECT id FROM work_logs WHERE task_id = $1 AND end_time IS NULL ORDER BY start_time DESC LIMIT 1`,
        [taskId]
      );
      if (!wl.rows[0]) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: req.t('errors.tasks.finishNoActiveWorkLog'),
          code: VALIDATION_FAILED,
          requestId: req.requestId,
        });
      }
      const work_log_id = wl.rows[0].id;
      const lat = toNum(req.body.lat);
      const lng = toNum(req.body.lng);
      const notatki = toStr(req.body.notatki);

      let net;
      const grossVal = grossForTask(task, payment || {});
      if (isTeamScoped(req.user) && payment) {
        net = netSettlementValue(payment.forma_platnosc, grossVal, { cardCommissionPct: cardPct });
      } else {
        net = Number.isFinite(grossVal) && grossVal > 0 ? grossVal : 0;
      }
      if (isTeamScoped(req.user) && payment) {
        if (isCashCollectionNoteMissing(payment, grossVal, notatki)) {
          await client.query('ROLLBACK');
          return res.status(400).json({
            error: req.tv('errors.tasks.paymentNoteRequiredOverPct', { pct: CASH_COLLECTION_NOTE_PCT }),
            code: 'PAYMENT_NOTE_REQUIRED_OVER_5_PCT',
            requestId: req.requestId,
          });
        }
        await client.query(
          `INSERT INTO task_client_payments (
            task_id, forma_platnosc, kwota_odebrana, faktura_vat, nip, notatki, recorded_by
          ) VALUES ($1,$2,$3,$4,$5,$6,$7)
          ON CONFLICT (task_id) DO UPDATE SET
            forma_platnosc = EXCLUDED.forma_platnosc,
            kwota_odebrana = EXCLUDED.kwota_odebrana,
            faktura_vat = EXCLUDED.faktura_vat,
            nip = EXCLUDED.nip,
            notatki = EXCLUDED.notatki,
            recorded_by = EXCLUDED.recorded_by,
            recorded_at = NOW()`,
          [
            taskId,
            payment.forma_platnosc,
            toNum(payment.kwota_odebrana),
            !!payment.faktura_vat,
            payment.nip ? String(payment.nip).replace(/\s/g, '').slice(0, 20) : null,
            payment.notatki || notatki || null,
            req.user.id,
          ]
        );
      }
      await client.query(
        `UPDATE work_logs SET end_time = NOW(), end_lat = $1, end_lng = $2,
         status = 'Zakończony',
         czas_pracy_minuty = EXTRACT(EPOCH FROM (NOW() - start_time))/60
         WHERE id = $3`,
        [lat, lng, work_log_id]
      );
      await client.query(
        `UPDATE tasks SET status = 'Zakonczone', data_zakonczenia = NOW(),
         wartosc_netto_do_rozliczenia = $1,
         notatki_wewnetrzne = COALESCE($2, notatki_wewnetrzne),
         updated_at = NOW()
         WHERE id = $3`,
        [net, notatki, taskId]
      );
      await recordTaskPublicStatusEvent(client, {
        taskId,
        fromStatus: task.status,
        toStatus: 'Zakonczone',
        source: 'finish',
        userId: req.user.id,
      });
      if (isTeamScoped(req.user) && Array.isArray(req.body.zuzyte_materialy)) {
        try {
          await insertFinishMaterialUsageRows(client, taskId, req.user.id, req.body.zuzyte_materialy);
          await insertWarehouseIssuesForFinish(client, task, taskId, req.user.id, req.body.zuzyte_materialy);
        } catch (e) {
          if (e.code === 'TASK_FINISH_USAGE_TABLE_MISSING') {
            await client.query('ROLLBACK');
            return res.status(503).json({
              error: 'Uruchom migrację (task_finish_material_usage).',
              requestId: req.requestId,
            });
          }
          if (e.code === 'WAREHOUSE_STOCK_UNDERFLOW') {
            await client.query('ROLLBACK');
            return res.status(409).json({
              error: 'magazyn_brak_stanu',
              code: 'WAREHOUSE_STOCK_UNDERFLOW',
              details: e.details,
              requestId: req.requestId,
            });
          }
          throw e;
        }
      }
      if (isTeamScoped(req.user) && Array.isArray(req.body.koszty_operacyjne)) {
        await insertOperationalCostRows(client, taskId, req.user.id, req.body.koszty_operacyjne);
      }
      const calcDetail = settlementCalcDetail({
        task,
        payment: payment || null,
        gross: grossVal,
        net,
        cardCommissionPct: cardPct,
        teamScoped: isTeamScoped(req.user),
      });
      await client.query(
        `INSERT INTO task_calc_log (task_id, gross, forma_platnosc, net_result, detail_json, recorded_by)
         VALUES ($1,$2,$3,$4,$5::jsonb,$6)`,
        [
          taskId,
          grossVal,
          payment?.forma_platnosc ?? null,
          net,
          JSON.stringify(calcDetail),
          req.user.id,
        ]
      );
      if (task.wyceniajacy_id && net > 0) {
        const accMonth = new Date();
        accMonth.setUTCDate(1);
        accMonth.setUTCHours(0, 0, 0, 0);
        const monthKey = accMonth.toISOString().slice(0, 10);
        await client.query(
          `INSERT INTO estimator_month_accrual (wyceniajacy_id, accrual_month, commission_base, extra_work_pln)
           VALUES ($1, $2::date, $3, 0)
           ON CONFLICT (wyceniajacy_id, accrual_month) DO UPDATE SET
             commission_base = estimator_month_accrual.commission_base + EXCLUDED.commission_base,
             updated_at = NOW()`,
          [task.wyceniajacy_id, monthKey, net]
        );
      }
      // F3.10/F11.6: wycenione, ale bez akceptacji klienta przed finish -> nie wchodzi do rozliczeń.
      await client.query(
        `UPDATE task_extra_work
         SET status = 'Wyceniona_Bez_Akceptacji',
             rejected_at = NOW(),
             rejected_by = COALESCE(rejected_by, $2),
             rejection_reason = COALESCE(rejection_reason, 'AUTO: finish zlecenia bez akceptacji klienta')
         WHERE task_id = $1 AND status = 'Wycenione'`,
        [taskId, req.user.id]
      );
      await client.query('COMMIT');
      await req.auditLog?.({
        action: 'task.finish',
        entityType: 'task',
        entityId: taskId,
        metadata: {
          from: task.status,
          to: 'Zakonczone',
          oddzial_id: task.oddzial_id,
          wartosc_netto_do_rozliczenia: net,
          gross_value: grossVal,
          payment_method: payment?.forma_platnosc ?? null,
          team_scoped: isTeamScoped(req.user),
        },
      });
      try {
        await tryAutoTeamDayCloseAfterTaskFinish(pool, taskId);
      } catch (e) {
        logger.warn('tasks.finish.autoReport', { message: e.message, taskId });
      }
      res.json({ message: 'Zlecenie zakończone', wartosc_netto_do_rozliczenia: net });
    } catch (e) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* ignore */
      }
      if (String(e.message || '').includes('task_client_payments')) {
        return res.status(503).json({
          error: 'Brak tabeli płatności — uruchom migrację bazy (task_client_payments).',
        });
      }
      if (String(e.message || '').includes('task_calc_log')) {
        return res.status(503).json({
          error: 'Brak tabeli audytu wyliczeń — uruchom migrację (task_calc_log).',
        });
      }
      logger.error('tasks.finish', { message: e.message, requestId: req.requestId });
      res.status(500).json({ error: req.t('errors.http.serverError') });
    } finally {
      client.release();
    }
  }
);

router.post(
  '/:id/extra-work',
  authMiddleware,
  validateParams(taskIdParamsSchema),
  validateBody(extraWorkCreateSchema),
  requireTaskAccess,
  async (req, res) => {
    if (!isTeamScoped(req.user)) {
      return res.status(403).json({ error: 'Tylko ekipa w terenie zgłasza prace dodatkowe' });
    }
    const taskId = Number(req.params.id);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const replay = await tryConsumeIdempotencyKey(client, req, `task:${taskId}:extra-work`);
      if (replay) {
        await client.query('ROLLBACK');
        return res.status(200).json({ idempotent_replay: true });
      }
      const { rows } = await client.query(
        `INSERT INTO task_extra_work (task_id, created_by, opis, status) VALUES ($1,$2,$3,'OczekujeWyceny') RETURNING *`,
        [req.params.id, req.user.id, req.body.opis.trim()]
      );
      await client.query('COMMIT');
      res.status(201).json(rows[0]);
    } catch (e) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* ignore */
      }
      if (String(e.message || '').includes('task_extra_work')) {
        return res.status(503).json({ error: 'Uruchom migrację (task_extra_work).' });
      }
      logger.error('tasks.extra-work', { message: e.message });
      res.status(500).json({ error: req.t('errors.http.serverError') });
    } finally {
      client.release();
    }
  }
);

router.patch(
  '/:id/extra-work/:ewId/quote',
  authMiddleware,
  validateParams(ewIdParamSchema),
  validateBody(extraWorkQuoteSchema),
  requireTaskAccess,
  async (req, res) => {
    try {
      const u = req.user;
      const taskR = await pool.query(`SELECT wyceniajacy_id FROM tasks WHERE id = $1`, [req.params.id]);
      const t = taskR.rows[0];
      if (!t) return res.status(404).json({ error: req.t('errors.generic.notFound') });
      const canQuote =
        isDyrektor(u) ||
        isKierownik(u) ||
        (u.rola === 'Wyceniający' && Number(t.wyceniajacy_id) === Number(u.id));
      if (!canQuote) return res.status(403).json({ error: 'Brak uprawnień do wyceny pracy dodatkowej' });
      const amt = toNum(req.body.amount_pln);
      if (amt == null || amt <= 0) return res.status(400).json({ error: 'Kwota musi być > 0' });
      const { rows } = await pool.query(
        `UPDATE task_extra_work SET amount_pln = $1, quoted_by = $2, quoted_at = NOW(), status = 'Wycenione'
         WHERE id = $3 AND task_id = $4 AND status = 'OczekujeWyceny'
         RETURNING *`,
        [amt, u.id, req.params.ewId, req.params.id]
      );
      if (!rows[0]) return res.status(400).json({ error: 'Brak oczekującej pracy dodatkowej' });
      res.json(rows[0]);
    } catch (e) {
      logger.error('tasks.extra-work.quote', { message: e.message });
      res.status(500).json({ error: req.t('errors.http.serverError') });
    }
  }
);

router.post(
  '/:id/extra-work/:ewId/accept',
  authMiddleware,
  validateParams(ewIdParamSchema),
  validateBody(extraWorkAcceptSchema),
  requireTaskAccess,
  async (req, res) => {
    if (!isTeamScoped(req.user)) {
      return res.status(403).json({ error: 'Akceptacja z terenu — brygadzista / pomocnik' });
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const taskId = Number(req.params.id);
      const ewId = Number(req.params.ewId);
      const replay = await tryConsumeIdempotencyKey(client, req, `task:${taskId}:extra-work-accept:${ewId}`);
      if (replay) {
        await client.query('ROLLBACK');
        return res.json({ ok: true, idempotent_replay: true });
      }
      const ewR = await client.query(`SELECT * FROM task_extra_work WHERE id = $1 AND task_id = $2 FOR UPDATE`, [
        req.params.ewId,
        req.params.id,
      ]);
      const ew = ewR.rows[0];
      if (!ew || ew.status !== 'Wycenione') {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Praca musi być najpierw wyceniona' });
      }
      const taskR = await client.query(`SELECT * FROM tasks WHERE id = $1 FOR UPDATE`, [req.params.id]);
      const task = taskR.rows[0];
      if (!task) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: req.t('errors.generic.notFound') });
      }
      const amt = Number(ew.amount_pln);
      await client.query(
        `UPDATE task_extra_work SET status = 'Zaakceptowane', accepted_at = NOW(), acceptance_channel = $1 WHERE id = $2`,
        [req.body.channel, req.params.ewId]
      );
      await client.query(
        `UPDATE tasks SET wartosc_rzeczywista = COALESCE(wartosc_rzeczywista, COALESCE(wartosc_planowana,0)) + $1, updated_at = NOW() WHERE id = $2`,
        [amt, req.params.id]
      );
      if (task.wyceniajacy_id && amt > 0) {
        const accMonth = new Date();
        accMonth.setUTCDate(1);
        const monthKey = accMonth.toISOString().slice(0, 10);
        await client.query(
          `INSERT INTO estimator_month_accrual (wyceniajacy_id, accrual_month, commission_base, extra_work_pln)
           VALUES ($1, $2::date, 0, $3)
           ON CONFLICT (wyceniajacy_id, accrual_month) DO UPDATE SET
             extra_work_pln = estimator_month_accrual.extra_work_pln + EXCLUDED.extra_work_pln,
             updated_at = NOW()`,
          [task.wyceniajacy_id, monthKey, amt]
        );
      }
      await client.query('COMMIT');
      if (req.body.channel === 'sms' && task.klient_telefon) {
        const msg = `ARBOR: akceptacja dopłaty ${amt} PLN do zlecenia #${req.params.id}. Dziękujemy!`;
        void sendSmsOptional({ to: task.klient_telefon, body: msg, taskId: Number(req.params.id) });
      }
      res.json({ ok: true, amount_pln: amt });
    } catch (e) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* ignore */
      }
      logger.error('tasks.extra-work.accept', { message: e.message });
      res.status(500).json({ error: req.t('errors.http.serverError') });
    } finally {
      client.release();
    }
  }
);

router.post(
  '/:id/extra-work/:ewId/reject',
  authMiddleware,
  validateParams(ewIdParamSchema),
  validateBody(extraWorkRejectSchema),
  requireTaskAccess,
  async (req, res) => {
    if (!isTeamScoped(req.user)) {
      return res.status(403).json({ error: 'Odrzucenie z terenu — brygadzista / pomocnik' });
    }
    try {
      const reason = req.body.reason ? String(req.body.reason).slice(0, 500) : null;
      const { rows } = await pool.query(
        `UPDATE task_extra_work
         SET status = 'Wyceniona_Bez_Akceptacji',
             rejected_at = NOW(),
             rejected_by = $1,
             rejection_reason = $2
         WHERE id = $3 AND task_id = $4 AND status = 'Wycenione'
         RETURNING *`,
        [req.user.id, reason, req.params.ewId, req.params.id]
      );
      if (!rows[0]) return res.status(400).json({ error: 'Praca musi być w statusie Wycenione' });
      res.json(rows[0]);
    } catch (e) {
      logger.error('tasks.extra-work.reject', { message: e.message });
      res.status(500).json({ error: req.t('errors.http.serverError') });
    }
  }
);

const postTaskProblem = async (req, res) => {
  const taskId = Number(req.params.id);
  let client;
  try {
    await ensureIssuesCompatColumns();
    client = await pool.connect();
    await client.query('BEGIN');
    const replay = await tryConsumeIdempotencyKey(client, req, `task:${taskId}:problem`);
    if (replay) {
      await client.query('ROLLBACK');
      return res.json({ message: 'Problem zgloszony', idempotent_replay: true });
    }
    const typ = normalizeIssueTyp(req.body.typ);
    const opis = req.body.opis != null && String(req.body.opis).trim()
      ? String(req.body.opis).trim()
      : null;
    const issueResult = await client.query(
      `INSERT INTO issues (task_id, user_id, typ, opis, data_zgloszenia)
       VALUES ($1, $2, $3, $4, NOW())
       RETURNING id, task_id, typ, opis, status, data_zgloszenia`,
      [taskId, req.user.id, typ, opis]
    );
    const issue = issueResult.rows[0] || null;
    const taskResult = await client.query(
      `SELECT id, numer, oddzial_id
         FROM tasks
        WHERE id = $1`,
      [taskId]
    );
    const task = taskResult.rows[0] || null;
    let notifications = [];
    if (task) {
      const message = `Nowy problem w zleceniu ${task.numer || `#${taskId}`}: ${typ}${opis ? ` - ${opis.slice(0, 180)}` : ''}`;
      const notificationResult = await client.query(
        `INSERT INTO notifications (from_user_id, to_user_id, task_id, typ, tresc, status)
         SELECT $1, u.id, $2, 'Problem', $3, 'Nowe'
           FROM users u
          WHERE u.id <> $1
            AND u.rola IN ('Prezes', 'Dyrektor', 'Administrator', 'Kierownik')
            AND (
              u.rola IN ('Prezes', 'Dyrektor', 'Administrator')
              OR u.oddzial_id = $4
            )
         RETURNING id, to_user_id, typ, tresc, task_id, status, data_utworzenia`,
        [req.user.id, taskId, message, task.oddzial_id || null]
      );
      notifications = notificationResult.rows || [];
    }
    await client.query('COMMIT');
    for (const notification of notifications) {
      pushToUser(notification.to_user_id, {
        event: 'notification',
        notification,
        task_id: taskId,
        tab: 'problemy',
      });
    }
    res.json({
      message: 'Problem zgloszony',
      issue,
      notifications_created: notifications.length,
    });
  } catch (err) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* ignore */
      }
    }
    logger.error('Blad zglaszania problemu', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  } finally {
    if (client) client.release();
  }
};

router.post(
  '/:id/problem',
  authMiddleware,
  validateParams(taskIdParamsSchema),
  validateBody(taskProblemSchema),
  requireTaskAccess,
  postTaskProblem
);
router.post(
  '/:id/problemy',
  authMiddleware,
  validateParams(taskIdParamsSchema),
  validateBody(taskProblemSchema),
  requireTaskAccess,
  postTaskProblem
);

router.get('/:id/logi', authMiddleware, validateParams(taskIdParamsSchema), requireTaskAccess, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT wl.*, u.imie || ' ' || u.nazwisko as pracownik
       FROM work_logs wl
       LEFT JOIN users u ON wl.user_id = u.id
       WHERE wl.task_id = $1
       ORDER BY wl.start_time`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    logger.error('Blad pobierania logow pracy', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

router.get('/:id/problemy', authMiddleware, validateParams(taskIdParamsSchema), requireTaskAccess, async (req, res) => {
  try {
    await ensureIssuesCompatColumns();
    const result = await pool.query(
      `SELECT i.*, COALESCE(i.data_zgloszenia, i.created_at) AS data_zgloszenia,
              u.imie || ' ' || u.nazwisko as zglaszajacy
       FROM issues i
       LEFT JOIN users u ON i.user_id = u.id
       WHERE i.task_id = $1
       ORDER BY COALESCE(i.data_zgloszenia, i.created_at) DESC`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    logger.error('Blad pobierania problemow', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

router.get('/:id/zdjecia', authMiddleware, validateParams(taskIdParamsSchema), requireTaskAccess, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT p.*, u.imie || ' ' || u.nazwisko as autor
       FROM photos p
       LEFT JOIN users u ON p.user_id = u.id
       WHERE p.task_id = $1
       ORDER BY p.data_dodania DESC NULLS LAST, p.id DESC`,
      [req.params.id]
    );
    const rows = result.rows.map(r => ({
      ...r,
      sciezka: r.sciezka || r.url,
      data_dodania: r.data_dodania || r.timestamp
    }));
    res.json(rows);
  } catch (err) {
    logger.error('Blad pobierania zdjec', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

router.post('/:id/zdjecia', authMiddleware, validateParams(taskIdParamsSchema), requireTaskAccess, upload.single('zdjecie'), async (req, res) => {
  let client;
  let storedPhoto;
  try {
    if (!req.file) {
      return res.status(400).json({ error: req.t('errors.tasks.missingFile') });
    }
    const taskId = Number(req.params.id);
    const typ = req.body.typ || 'Przed';
    const photoLat = toNum(req.body.lat);
    const photoLon = toNum(req.body.lon);
    const opisRaw = req.body.opis;
    const photoOpis =
      opisRaw != null && String(opisRaw).trim() ? String(opisRaw).trim().slice(0, 4000) : null;
    let photoTagi = [];
    const tagiRaw = req.body.tagi;
    if (tagiRaw != null && String(tagiRaw).trim()) {
      const s = String(tagiRaw).trim();
      try {
        const parsed = JSON.parse(s);
        photoTagi = normalizePhotoTagi(Array.isArray(parsed) ? parsed : s);
      } catch {
        photoTagi = normalizePhotoTagi(s);
      }
    }
    client = await pool.connect();
    await client.query('BEGIN');
    const replay = await tryConsumeIdempotencyKey(client, req, `task:${taskId}:photo`);
    if (replay) {
      await client.query('ROLLBACK');
      cleanupUploadedFile(req.file);
      return res.json({ message: 'Zdjecie dodane', sciezka: null, idempotent_replay: true });
    }
    storedPhoto = await persistUploadedFile(req.file, { folder: 'tasks', fileName: req.file.filename });
    const sciezka = storedPhoto.url;
    await client.query(
      `INSERT INTO photos (task_id, user_id, typ, url, sciezka, data_dodania, lat, lon, opis, tagi)
       VALUES ($1, $2, $3, $4, $4, NOW(), $5, $6, $7, $8)`,
      [taskId, req.user.id, typ, sciezka, photoLat, photoLon, photoOpis, photoTagi]
    );
    await client.query('COMMIT');
    cleanupTemporaryUpload(storedPhoto);
    res.json({ message: 'Zdjecie dodane', sciezka });
  } catch (err) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* ignore */
      }
    }
    if (storedPhoto) await deleteStoredUpload(storedPhoto);
    else cleanupUploadedFile(req.file);
    logger.error('Blad dodawania zdjecia', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: err.message });
  } finally {
    if (client) client.release();
  }
});

router.patch(
  '/:id/zdjecia/:photoId',
  authMiddleware,
  validateParams(taskPhotoIdParamsSchema),
  validateBody(taskPhotoPatchSchema),
  requireTaskAccess,
  async (req, res) => {
    try {
      const taskId = Number(req.params.id);
      const photoId = Number(req.params.photoId);
      const b = req.body;
      const parts = [];
      const vals = [];
      if (Object.prototype.hasOwnProperty.call(b, 'typ') && b.typ != null) {
        parts.push(`typ = $${parts.length + 1}`);
        vals.push(String(b.typ).slice(0, 80));
      }
      if (Object.prototype.hasOwnProperty.call(b, 'opis')) {
        parts.push(`opis = $${parts.length + 1}`);
        const raw = b.opis;
        vals.push(raw == null || String(raw).trim() === '' ? null : String(raw).trim().slice(0, 4000));
      }
      if (Object.prototype.hasOwnProperty.call(b, 'tagi')) {
        parts.push(`tagi = $${parts.length + 1}`);
        vals.push(b.tagi == null ? [] : normalizePhotoTagi(b.tagi));
      }
      if (!parts.length) {
        const cur = await pool.query(`SELECT p.*, u.imie || ' ' || u.nazwisko AS autor FROM photos p LEFT JOIN users u ON u.id = p.user_id WHERE p.id = $1 AND p.task_id = $2`, [photoId, taskId]);
        if (!cur.rows.length) return res.status(404).json({ error: req.t('errors.generic.notFound') });
        const r = cur.rows[0];
        return res.json({
          ...r,
          sciezka: r.sciezka || r.url,
          data_dodania: r.data_dodania || r.timestamp,
        });
      }
      const idPh = vals.length + 1;
      const taskPh = vals.length + 2;
      vals.push(photoId, taskId);
      const result = await pool.query(
        `UPDATE photos SET ${parts.join(', ')} WHERE id = $${idPh} AND task_id = $${taskPh}
         RETURNING *`,
        vals
      );
      if (!result.rows.length) return res.status(404).json({ error: req.t('errors.generic.notFound') });
      const r = result.rows[0];
      const u = await pool.query(`SELECT imie || ' ' || nazwisko AS autor FROM users WHERE id = $1`, [r.user_id]);
      res.json({
        ...r,
        autor: u.rows[0]?.autor || null,
        sciezka: r.sciezka || r.url,
        data_dodania: r.data_dodania || r.timestamp,
      });
    } catch (err) {
      logger.error('Blad patch zdjecia', { message: err.message, requestId: req.requestId });
      res.status(500).json({ error: req.t('errors.http.serverError') });
    }
  }
);

router.delete(
  '/:id/zdjecia/:photoId',
  authMiddleware,
  validateParams(taskPhotoIdParamsSchema),
  requireTaskAccess,
  async (req, res) => {
    try {
      const taskId = Number(req.params.id);
      const photoId = Number(req.params.photoId);
      const sel = await pool.query(`SELECT COALESCE(sciezka, url) AS sciezka FROM photos WHERE id = $1 AND task_id = $2`, [photoId, taskId]);
      if (!sel.rows.length) return res.status(404).json({ error: req.t('errors.generic.notFound') });
      const sciezka = sel.rows[0].sciezka;
      await pool.query(`DELETE FROM photos WHERE id = $1 AND task_id = $2`, [photoId, taskId]);
      await deleteUploadByUrl(sciezka);
      res.json({ ok: true });
    } catch (err) {
      logger.error('Blad usuwania zdjecia', { message: err.message, requestId: req.requestId });
      res.status(500).json({ error: req.t('errors.http.serverError') });
    }
  }
);

router.get('/:id/dokumenty', authMiddleware, validateParams(taskIdParamsSchema), requireTaskAccess, async (req, res) => {
  try {
    await ensureTaskDocumentsTable();
    const result = await pool.query(
      `SELECT d.*,
              COALESCE(NULLIF(TRIM(CONCAT_WS(' ', u.imie, u.nazwisko)), ''), u.login) AS autor
         FROM task_documents d
         LEFT JOIN users u ON u.id = d.user_id
        WHERE d.task_id = $1
        ORDER BY d.created_at DESC, d.id DESC`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    logger.error('Blad pobierania dokumentow zlecenia', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

router.post(
  '/:id/dokumenty',
  authMiddleware,
  validateParams(taskIdParamsSchema),
  requireTaskAccess,
  documentUpload.single('dokument'),
  async (req, res) => {
    let stored;
    try {
      if (!req.file) return res.status(400).json({ error: 'Brak pliku (pole dokument)' });
      await ensureTaskDocumentsTable();
      stored = await persistUploadedFile(req.file, { folder: 'task-documents', fileName: req.file.filename });
      const nazwa = String(req.body.nazwa || req.file.originalname || req.file.filename || 'Dokument').slice(0, 240);
      const kategoria = String(req.body.kategoria || 'inne').slice(0, 80);
      const status = String(req.body.status || 'roboczy').slice(0, 40);
      const opis = String(req.body.opis || '').trim().slice(0, 4000) || null;
      const result = await pool.query(
        `INSERT INTO task_documents (
           task_id, user_id, nazwa, sciezka, mime_type, rozmiar_bytes, kategoria, status, opis
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING *`,
        [
          req.params.id,
          req.user.id,
          nazwa,
          stored.url,
          req.file.mimetype || null,
          req.file.size || null,
          kategoria,
          status,
          opis,
        ]
      );
      cleanupTemporaryUpload(stored);
      stored = null;
      res.status(201).json(result.rows[0]);
    } catch (err) {
      if (stored) await deleteStoredUpload(stored).catch(() => {});
      else cleanupUploadedFile(req.file);
      logger.error('Blad dodawania dokumentu zlecenia', { message: err.message, requestId: req.requestId });
      res.status(500).json({ error: req.t('errors.http.serverError') });
    }
  }
);

router.patch('/:id/dokumenty/:docId', authMiddleware, validateParams(taskDocumentIdParamsSchema), requireTaskAccess, async (req, res) => {
  try {
    await ensureTaskDocumentsTable();
    const sets = ['updated_at = NOW()'];
    const params = [];
    for (const [column, max] of [['opis', 4000], ['kategoria', 80], ['status', 40], ['nazwa', 240]]) {
      if (req.body[column] === undefined) continue;
      params.push(String(req.body[column] || '').trim().slice(0, max) || null);
      sets.push(`${column} = $${params.length}`);
    }
    if (req.body.bump_version === true) sets.push('wersja = COALESCE(wersja, 1) + 1');
    params.push(req.params.id, req.params.docId);
    const result = await pool.query(
      `UPDATE task_documents SET ${sets.join(', ')}
        WHERE task_id = $${params.length - 1} AND id = $${params.length}
        RETURNING *`,
      params
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Dokument nie istnieje' });
    res.json(result.rows[0]);
  } catch (err) {
    logger.error('Blad aktualizacji dokumentu zlecenia', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

router.delete('/:id/dokumenty/:docId', authMiddleware, validateParams(taskDocumentIdParamsSchema), requireTaskAccess, async (req, res) => {
  try {
    await ensureTaskDocumentsTable();
    const result = await pool.query(
      'DELETE FROM task_documents WHERE task_id = $1 AND id = $2 RETURNING sciezka',
      [req.params.id, req.params.docId]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Dokument nie istnieje' });
    await deleteUploadByUrl(result.rows[0].sciezka).catch((error) => {
      logger.warn('task.document.deleteUpload', { message: error.message, docId: req.params.docId });
    });
    res.json({ ok: true });
  } catch (err) {
    logger.error('Blad usuwania dokumentu zlecenia', { message: err.message, requestId: req.requestId });
    res.status(500).json({ error: req.t('errors.http.serverError') });
  }
});

module.exports = router;
