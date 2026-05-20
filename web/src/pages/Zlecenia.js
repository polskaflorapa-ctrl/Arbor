import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import * as XLSX from 'xlsx';
import api from '../api';
import Sidebar from '../components/Sidebar';
import StatusMessage from '../components/StatusMessage';
import PageHeader from '../components/PageHeader';
import CityInput from '../components/CityInput';
import AssignmentOutlined from '@mui/icons-material/AssignmentOutlined';
import ViewKanbanOutlined from '@mui/icons-material/ViewKanbanOutlined';
import VisibilityOutlined from '@mui/icons-material/VisibilityOutlined';
import EditOutlined from '@mui/icons-material/EditOutlined';
import DeleteOutline from '@mui/icons-material/DeleteOutline';
import PhoneOutlined from '@mui/icons-material/PhoneOutlined';
import ContentCopyOutlined from '@mui/icons-material/ContentCopyOutlined';
import RouteOutlined from '@mui/icons-material/RouteOutlined';
import SmsOutlined from '@mui/icons-material/SmsOutlined';
import { getApiErrorMessage } from '../utils/apiError';
import { getLocalStorageJson } from '../utils/safeJsonLocalStorage';
import { getStoredToken, authHeaders } from '../utils/storedToken';
import { telHref } from '../utils/telLink';
import {
  TASK_PRIORITIES,
  TASK_EQUIPMENT_OPTIONS,
  TASK_RISK_PRESETS,
  TASK_SCOPE_PRESETS,
  TASK_SERVICE_TYPES,
  TASK_SETTLEMENT_OPTIONS,
  appendUniqueLine,
  buildTaskCreatePayload,
  createTaskFormDefaults,
  getTaskCreateMissingFields,
} from '../utils/taskForm';
import {
  CREW_REQUIRED_TASK_STATUSES,
  FIELD_EVIDENCE_REQUIRED_TASK_STATUSES,
  PRICE_REQUIRED_TASK_STATUSES,
  TASK_STATUS,
  TASK_STATUSES,
  canTransitionTaskStatus,
  getNextTaskStatuses,
  getTaskStatusColor,
  isTaskClosed,
  isTaskDone,
  isTaskInProgress,
  mergeTaskMutationResponse,
} from '../utils/taskWorkflow';

const PUSTY_FORMULARZ = createTaskFormDefaults();
const VIEW_MODE_KEY = 'zlecenia_view_mode';
const WORKFLOW_CONFIG_KEY = 'zlecenia_workflow_config';
const SMART_FILTER_KEY = 'zlecenia_smart_filter';
const TASK_SORT_KEY = 'zlecenia_sort_mode';
const CLIENT_CONTACT_KEY = 'zlecenia_client_contact_state';
const CLOSURE_DECISION_KEY = 'zlecenia_closure_decision_events';
const ZLECENIA_TRYBY = new Set(['lista', 'kanban', 'nowy', 'edytuj', 'szczegoly']);
const SMART_FILTERS = [
  { key: 'overdue', label: 'Przeterminowane' },
  { key: 'unassigned', label: 'Bez ekipy' },
  { key: 'urgent', label: 'Pilne' },
  { key: 'today', label: 'Dzisiaj' },
  { key: 'noDate', label: 'Bez terminu' },
  { key: 'noContact', label: 'Bez kontaktu' },
  { key: 'noMedia', label: 'Bez zdjęć' },
  { key: 'noFieldSketch', label: 'Bez szkicu' },
  { key: 'noPrice', label: 'Bez wyceny' },
  { key: 'fieldInspection', label: 'U wyceniającego' },
  { key: 'officeApproval', label: 'Do zatwierdzenia' },
  { key: 'readyClose', label: 'Do zamknięcia' },
  { key: 'contactTodo', label: 'Do kontaktu' },
  { key: 'contactWaiting', label: 'Czeka na odp.' },
  { key: 'contactRisk', label: 'Ryzyko kontaktu' },
  { key: 'contactOverdue', label: 'Kontakt po terminie' },
  { key: 'contactToday', label: 'Kontakt dziś' },
];
const OPERATIONAL_VIEWS = [
  { key: 'intake', label: '1. Telefon', detail: 'zgłoszenie z biura', status: TASK_STATUS.NOWE },
  { key: 'fieldInspection', label: '2. Oględziny', detail: 'u wyceniającego', status: TASK_STATUS.WYCENA_TERENOWA },
  { key: 'officeApproval', label: '3. Biuro planuje', detail: 'po akceptacji klienta', status: TASK_STATUS.DO_ZATWIERDZENIA },
  { key: 'planned', label: '4. Ekipa gotowa', detail: 'termin i brygada', status: TASK_STATUS.ZAPLANOWANE },
  { key: 'active', label: '5. Wykonanie', detail: 'ekipa w terenie', status: TASK_STATUS.W_REALIZACJI },
  { key: 'close', label: '6. Zamknięcie', detail: 'dowody i rozliczenie', smartFilter: 'readyClose' },
];
const TASK_SORT_OPTIONS = [
  { key: 'risk', label: 'Najpierw ryzyko', detail: 'Blokery, termin, pilność' },
  { key: 'date', label: 'Najbliższy termin', detail: 'Od najwcześniejszego' },
  { key: 'value', label: 'Największa wartość', detail: 'Budżetowo najpierw' },
  { key: 'newest', label: 'Najnowsze', detail: 'Ostatnio dodane' },
];
const TASK_SORT_KEYS = new Set(TASK_SORT_OPTIONS.map((option) => option.key));
const COMMAND_TABS = [
  { key: 'dispatch', label: 'Dyspozytor', detail: 'kolejka, trasa, odprawa' },
  { key: 'finance', label: 'Finanse', detail: 'marża, ryzyko, jakość' },
  { key: 'audit', label: 'Audyt', detail: 'zamykanie i poprawki' },
];
const FORM_STEPS = [
  { key: 'client', label: 'Klient', detail: 'kontakt i adres' },
  { key: 'work', label: 'Praca', detail: 'opis, logistyka, sprzęt' },
  { key: 'planning', label: 'Ekipa / BHP', detail: 'termin, priorytet, obsada' },
  { key: 'finance', label: 'Finanse', detail: 'wartość, minimum, notatki' },
  { key: 'media', label: 'Zdjęcia', detail: 'foto, szkic, dowody' },
  { key: 'summary', label: 'Podsumowanie', detail: 'kontrola przed zapisem' },
];
const FORM_STEP_KEYS = new Set(FORM_STEPS.map((step) => step.key));
const FORM_WORKFLOW_STEPS = [
  { status: TASK_STATUS.NOWE, step: '1', label: 'Telefon', detail: 'biuro przyjmuje zgłoszenie' },
  { status: TASK_STATUS.WYCENA_TERENOWA, step: '2', label: 'Oględziny', detail: 'wyceniacz zbiera zdjęcia i zakres' },
  { status: TASK_STATUS.DO_ZATWIERDZENIA, step: '3', label: 'Biuro planuje', detail: 'klient akceptuje, biuro dopina szczegóły' },
  { status: TASK_STATUS.ZAPLANOWANE, step: '4', label: 'Ekipa gotowa', detail: 'termin, brygada i sprzęt są ustawione' },
  { status: TASK_STATUS.W_REALIZACJI, step: '5', label: 'Wykonanie', detail: 'ekipa pracuje według briefu' },
  { status: TASK_STATUS.ZAKONCZONE, step: '6', label: 'Zamknięcie', detail: 'dowody i rozliczenie są kompletne' },
];
const TASK_CREATE_FIELD_LABELS = {
  klient_nazwa: 'klient',
  adres: 'adres',
  miasto: 'miasto',
  data_planowana: 'termin oględzin lub pracy',
  oddzial_id: 'oddział',
  wyceniajacy_id: 'wyceniacz',
};
const TASK_CREATE_FIELD_STEPS = {
  klient_nazwa: 'client',
  adres: 'client',
  miasto: 'client',
  data_planowana: 'planning',
  oddzial_id: 'planning',
  wyceniajacy_id: 'planning',
};
const OFFICE_PLAN_DEFAULTS = {
  data_planowana: '',
  godzina_rozpoczecia: '08:00',
  czas_planowany_godziny: '2',
  ekipa_id: '',
  sprzet_notatka: '',
  sprzet_ids: [],
};
const QUICK_CALL_DEFAULTS = Object.freeze({
  klient_nazwa: '',
  klient_telefon: '',
  adres: '',
  miasto: '',
  data_planowana: '',
  godzina_rozpoczecia: '',
  oddzial_id: '',
  wyceniajacy_id: '',
  opis_pracy: '',
  priorytet: 'Normalny',
});
const FIELD_PHOTO_TYPES = [
  { key: 'Wycena', label: 'Wycena u klienta' },
  { key: 'Szkic', label: 'Szkic / rysunek' },
  { key: 'Przed', label: 'Przed pracą' },
  { key: 'Po', label: 'Po pracy' },
  { key: 'Inne', label: 'Inne' },
];
const CREW_ISSUE_TYPES = [
  { key: 'zakres', label: 'Zakres pracy' },
  { key: 'dojazd', label: 'Dojazd / dostep' },
  { key: 'sprzet', label: 'Sprzet' },
  { key: 'bhp', label: 'BHP / ryzyko' },
  { key: 'klient', label: 'Klient' },
  { key: 'inne', label: 'Inne' },
];
function formatMoneyBrief(value) {
  return `${(Number(value) || 0).toLocaleString('pl-PL', { maximumFractionDigits: 0 })} PLN`;
}

const CLIENT_CONTACT_STATUSES = [
  { key: 'todo', label: 'Do kontaktu', tone: 'warning' },
  { key: 'informed', label: 'Klient poinformowany', tone: 'good' },
  { key: 'waiting', label: 'Czeka na odpowiedź', tone: 'warning' },
  { key: 'risk', label: 'Ryzyko kontaktu', tone: 'danger' },
];
const DEFAULT_WORKFLOW_CONFIG = {
  logEnabled: true,
  notificationsEnabled: true,
  remindersEnabled: true,
  smsEnabled: true,
};
const WORKFLOW_PRESETS = {
  minimal: {
    logEnabled: true,
    notificationsEnabled: false,
    remindersEnabled: false,
    smsEnabled: false,
  },
  standard: {
    logEnabled: true,
    notificationsEnabled: true,
    remindersEnabled: true,
    smsEnabled: false,
  },
  full: {
    logEnabled: true,
    notificationsEnabled: true,
    remindersEnabled: true,
    smsEnabled: true,
  },
};

function Toggle({ value, onChange, disabled }) {
  return (
    <button type="button" disabled={disabled} onClick={() => !disabled && onChange(!value)}
      style={{ width: 52, height: 28, borderRadius: 14, border: value ? 'none' : '1px solid var(--border2)', cursor: disabled ? 'default' : 'pointer',
        backgroundColor: value ? '#34D399' : 'var(--bg-deep)', position: 'relative', transition: 'background 0.2s',
        flexShrink: 0, opacity: disabled ? 0.6 : 1 }}>
      <div style={{ width: 22, height: 22, borderRadius: '50%', backgroundColor: 'var(--bg-card)', position: 'absolute',
        top: 3, left: value ? 27 : 3, transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)' }} />
    </button>
  );
}

function TakNie({ label, field, form, onChange, disabled }) {
  const { t } = useTranslation();
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
      <span style={{ fontSize: 14, color: 'var(--text-sub)' }}>{label}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 12, color: form[field] ? 'var(--accent-dk)' : 'var(--text-muted)', fontWeight: '600', minWidth: 24 }}>
          {form[field] ? t('common.yes') : t('common.no')}
        </span>
        <Toggle value={form[field]} onChange={v => onChange(field, v)} disabled={disabled} />
      </div>
    </div>
  );
}

function taskAssetUrl(pathMaybe) {
  if (!pathMaybe) return '';
  const value = String(pathMaybe);
  if (value.startsWith('http://') || value.startsWith('https://')) return value;
  return value.startsWith('/') ? value : `/${value}`;
}

function formatTaskPhotoDate(value) {
  if (!value) return 'brak daty';
  try {
    return new Date(value).toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return 'brak daty';
  }
}

function taskPhotoTypeLabel(type) {
  const found = FIELD_PHOTO_TYPES.find((item) => item.key === type);
  return found?.label || type || 'Inne';
}

function TaskPhotosPanel({
  styles,
  title,
  subtitle,
  taskId,
  photos,
  loading,
  uploading,
  draft,
  inputRef,
  onDraftChange,
  onPickFiles,
  onDraw,
  onDelete,
  onSaveDraft,
}) {
  const canUpload = Boolean(taskId);
  return (
    <div className="zlecenia-task-photos-panel" style={styles.taskPhotosPanel}>
      <div style={styles.taskPhotosHeader}>
        <div>
          <div style={styles.detailOpsEyebrow}>Zdjęcia i szkice</div>
          <div style={styles.taskPhotosTitle}>{title}</div>
          <div style={styles.taskPhotosSubtitle}>{subtitle}</div>
        </div>
        <span style={styles.taskPhotosCount}>{loading ? '...' : photos.length}</span>
      </div>

      {canUpload ? (
        <>
          <div style={styles.taskPhotosToolbar}>
            <select
              style={styles.taskPhotosSelect}
              value={draft.typ}
              onChange={(event) => onDraftChange({ ...draft, typ: event.target.value })}
              disabled={uploading}
            >
              {FIELD_PHOTO_TYPES.map((item) => (
                <option key={item.key} value={item.key}>{item.label}</option>
              ))}
            </select>
            <input
              style={styles.taskPhotosInput}
              value={draft.opis}
              onChange={(event) => onDraftChange({ ...draft, opis: event.target.value })}
              placeholder="Krótki opis dla ekipy, np. co ciąć, czego nie ruszać"
              disabled={uploading}
            />
            <input
              style={styles.taskPhotosInputSmall}
              value={draft.tagi}
              onChange={(event) => onDraftChange({ ...draft, tagi: event.target.value })}
              placeholder="Tagi: wycena, granica, ryzyko"
              disabled={uploading}
            />
            <button type="button" style={styles.taskPhotosBtn} onClick={() => inputRef.current?.click()} disabled={uploading}>
              {uploading ? 'Wgrywanie...' : '+ Dodaj zdjęcia'}
            </button>
            <button type="button" style={styles.taskPhotosBtnSecondary} onClick={onDraw} disabled={uploading}>
              Rysuj na zdjęciu
            </button>
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              multiple
              style={{ display: 'none' }}
              onChange={(event) => onPickFiles(event.target.files)}
            />
          </div>
          <div style={styles.taskPhotosHint}>
            Najważniejsze: zdjęcia z oględzin są instrukcją dla ekipy i dowodem zakresu dla klienta. Zdjęcia z telefonu można dodać seriami.
          </div>
        </>
      ) : (
        <div style={styles.taskPhotosDraftBox}>
          <strong>Zapisz szybki draft zlecenia, potem od razu dodaj zdjęcia.</strong>
          <span>To jest tryb dla wyceniającego u klienta: minimum danych, zapis, zdjęcia, szkic, następny klient.</span>
          <button type="button" style={styles.taskPhotosBtn} onClick={onSaveDraft}>
            Zapisz draft i dodaj zdjęcia
          </button>
        </div>
      )}

      {loading ? (
        <div style={styles.taskPhotosEmpty}>Ładowanie dokumentacji...</div>
      ) : photos.length === 0 ? (
        <div style={styles.taskPhotosEmpty}>Brak zdjęć. Dodaj zdjęcia z oględzin albo szkic z zaznaczeniem drzew.</div>
      ) : (
        <div style={styles.taskPhotosGrid}>
          {photos.map((photo) => (
            <div key={photo.id || photo.sciezka} style={styles.taskPhotoCard}>
              <a href={taskAssetUrl(photo.sciezka || photo.url)} target="_blank" rel="noreferrer" style={styles.taskPhotoImageLink}>
                <img src={taskAssetUrl(photo.sciezka || photo.url)} alt={photo.opis || 'Zdjęcie zlecenia'} style={styles.taskPhotoImage} />
              </a>
              <div style={styles.taskPhotoMeta}>
                <strong>{taskPhotoTypeLabel(photo.typ)}</strong>
                <span>{formatTaskPhotoDate(photo.created_at || photo.data_dodania)}</span>
              </div>
              {photo.opis ? <div style={styles.taskPhotoOpis}>{photo.opis}</div> : null}
              {Array.isArray(photo.tagi) && photo.tagi.length ? (
                <div style={styles.taskPhotoTags}>
                  {photo.tagi.slice(0, 4).map((tag) => <span key={tag} style={styles.taskPhotoTag}>{tag}</span>)}
                </div>
              ) : null}
              {onDelete ? (
                <button type="button" style={styles.taskPhotoDelete} onClick={() => onDelete(photo.id)}>
                  Usuń
                </button>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function WorkflowPathPanel({ styles, task, canChange, statusBusy, onChangeStatus }) {
  if (!task) return null;
  const currentStatus = task.status || TASK_STATUS.NOWE;
  const nextStatuses = getNextTaskStatuses(currentStatus, { allowCancel: canChange });
  const activeIndex = Math.max(0, FORM_WORKFLOW_STEPS.findIndex((step) => step.status === currentStatus));
  const actionableNext = nextStatuses.filter((status) => status !== TASK_STATUS.ANULOWANE);
  const cancelAllowed = nextStatuses.includes(TASK_STATUS.ANULOWANE);

  return (
    <section style={styles.workflowPathPanel}>
      <div style={styles.workflowPathHeader}>
        <div>
          <div style={styles.detailOpsEyebrow}>Oś statusów</div>
          <div style={styles.workflowPathTitle}>Telefon -> oględziny -> biuro -> ekipa -> zamknięcie</div>
          <p style={styles.workflowPathSubtitle}>
            System pokazuje tylko następny logiczny ruch. Przeskoki bokiem są blokowane, żeby zlecenia nie wpadały w chaos.
          </p>
        </div>
        <span style={{ ...styles.businessHealth, ...styles.businessHealth_good }}>
          Etap {FORM_WORKFLOW_STEPS[activeIndex]?.step || '1'}
        </span>
      </div>
      <div style={styles.workflowPathSteps}>
        {FORM_WORKFLOW_STEPS.map((step, index) => {
          const active = step.status === currentStatus;
          const done = index < activeIndex;
          return (
            <div
              key={step.status}
              style={{
                ...styles.workflowPathStep,
                ...(active ? styles.workflowPathStepActive : done ? styles.workflowPathStepDone : {}),
              }}
            >
              <span style={styles.workflowPathNo}>{step.step}</span>
              <strong>{step.label}</strong>
              <small>{step.detail}</small>
            </div>
          );
        })}
      </div>
      <div style={styles.workflowPathActions}>
        {actionableNext.length ? actionableNext.map((status) => (
          <button
            key={status}
            type="button"
            style={styles.workflowPathBtn}
            disabled={!canChange || statusBusy}
            onClick={() => onChangeStatus(status)}
          >
            Przejdź do: {status}
          </button>
        )) : (
          <span style={styles.workflowPathDone}>Brak następnego kroku w czystej ścieżce.</span>
        )}
        {cancelAllowed ? (
          <button
            type="button"
            style={styles.workflowPathCancelBtn}
            disabled={!canChange || statusBusy}
            onClick={() => onChangeStatus(TASK_STATUS.ANULOWANE)}
          >
            Anuluj
          </button>
        ) : null}
      </div>
    </section>
  );
}

function getDetailWorkflowCommandRows({ task, meta, qualityChecklist = [], safetyChecklist = [], photos = [], contact = {}, showOfficePlanPanel = false }) {
  if (!task) return [];
  const currentStatus = task.status || TASK_STATUS.NOWE;
  const activeIndex = Math.max(0, FORM_WORKFLOW_STEPS.findIndex((step) => step.status === currentStatus));
  const q = Object.fromEntries(qualityChecklist.map((item) => [item.key, item]));
  const s = Object.fromEntries(safetyChecklist.map((item) => [item.key, item]));
  const photoSummary = meta?.diagnostics?.photos || getTaskPhotoSummary(task);
  const hasFieldPackage = Boolean(
    photoSummary.total > 0 ||
    task.opis_pracy ||
    task.wynik ||
    Number(task.wartosc_planowana) ||
    Number(task.budzet) ||
    Number(task.czas_planowany_godziny)
  );
  const isStepDone = (status) => {
    const index = FORM_WORKFLOW_STEPS.findIndex((step) => step.status === status);
    if (index < 0) return false;
    return activeIndex > index || currentStatus === TASK_STATUS.ZAKONCZONE;
  };
  const isStepCurrent = (status) => status === currentStatus;
  const missingLabels = (items) => items
    .filter(Boolean)
    .filter((item) => item.required !== false && !item.ok)
    .map((item) => item.label);
  const optionalMissingLabels = (items) => items
    .filter(Boolean)
    .filter((item) => item.required === false && !item.ok)
    .map((item) => item.label);
  const rowState = (status, missing, optional = [], forcedDone = false) => {
    if (currentStatus === TASK_STATUS.ANULOWANE) return 'muted';
    if (forcedDone || isStepDone(status)) return 'done';
    if (isStepCurrent(status)) return missing.length ? 'blocked' : optional.length ? 'warning' : 'active';
    if (missing.length) return 'blocked';
    if (optional.length) return 'warning';
    return 'ready';
  };

  const intakeRequired = [q.phone, q.address, q.date].filter(Boolean);
  if (!task.wyceniajacy_id && currentStatus === TASK_STATUS.NOWE) {
    intakeRequired.push({ key: 'estimator', label: 'Wyceniacz', ok: false, required: true });
  }
  const fieldRequired = [
    q.media,
    q.price,
    Number(task.czas_planowany_godziny) ? null : { key: 'hours', label: 'Plan godzin', ok: false, required: true },
    task.opis_pracy || task.wynik ? null : { key: 'brief', label: 'Zakres prac', ok: false, required: true },
  ].filter(Boolean);
  const officeRequired = [q.team, q.date].filter(Boolean);
  const crewRequired = [s.team, s.address, s.brief].filter(Boolean);
  const executionRequired = [s.arborist].filter(Boolean);
  const closeRequired = qualityChecklist.filter((item) => item.required && !item.ok);

  return [
    {
      key: 'intake',
      step: '1',
      title: 'Telefon i zgłoszenie',
      owner: 'Specjalista biura',
      status: TASK_STATUS.NOWE,
      state: rowState(TASK_STATUS.NOWE, missingLabels(intakeRequired), [], isStepDone(TASK_STATUS.NOWE)),
      primary: task.klient_nazwa || 'Nowy klient',
      detail: task.klient_telefon ? `Tel. ${task.klient_telefon}` : 'Brak telefonu utrudni potwierdzenie terminu.',
      missing: missingLabels(intakeRequired),
      actionLabel: missingLabels(intakeRequired).length ? 'Uzupełnij dane' : 'Wyślij do wyceniacza',
      action: missingLabels(intakeRequired).length
        ? { target: 'edit', formStep: 'client' }
        : { target: 'status', nextStatus: TASK_STATUS.WYCENA_TERENOWA },
    },
    {
      key: 'field',
      step: '2',
      title: 'Oględziny i pakiet terenowy',
      owner: 'Wyceniacz',
      status: TASK_STATUS.WYCENA_TERENOWA,
      state: rowState(TASK_STATUS.WYCENA_TERENOWA, missingLabels(fieldRequired), optionalMissingLabels([q['field-sketch']]), isStepDone(TASK_STATUS.WYCENA_TERENOWA) && hasFieldPackage),
      primary: `${photoSummary.total || photos.length || 0} zdjęć / ${photoSummary.fieldEvidence || 0} wycena i szkic`,
      detail: task.opis_pracy || task.wynik || 'Zakres, cena, czas i ryzyka mają wrócić z terenu.',
      missing: missingLabels(fieldRequired),
      optionalMissing: optionalMissingLabels([q['field-sketch']]),
      actionLabel: missingLabels(fieldRequired).some((label) => label.toLowerCase().includes('zdj')) ? 'Dodaj zdjęcia' : 'Uzupełnij pakiet',
      action: missingLabels(fieldRequired).some((label) => label.toLowerCase().includes('zdj'))
        ? { target: 'photos' }
        : { target: 'edit', formStep: 'work' },
    },
    {
      key: 'office',
      step: '3',
      title: 'Plan biura',
      owner: 'Specjalista / kierownik',
      status: TASK_STATUS.DO_ZATWIERDZENIA,
      state: rowState(TASK_STATUS.DO_ZATWIERDZENIA, missingLabels(officeRequired), [], isStepDone(TASK_STATUS.DO_ZATWIERDZENIA)),
      primary: task.ekipa_nazwa || (task.ekipa_id ? `Ekipa #${task.ekipa_id}` : 'Ekipa nie wybrana'),
      detail: task.data_planowana ? `Termin: ${String(task.data_planowana).slice(0, 10)} ${task.godzina_rozpoczecia || ''}` : 'Biuro dopina termin, ekipę i sprzęt.',
      missing: missingLabels(officeRequired),
      actionLabel: showOfficePlanPanel ? 'Zaplanuj ekipę' : 'Edytuj plan',
      action: showOfficePlanPanel ? { target: 'officePlan' } : { target: 'edit', formStep: 'planning' },
    },
    {
      key: 'crew',
      step: '4',
      title: 'Odprawa ekipy',
      owner: 'Brygadzista',
      status: TASK_STATUS.ZAPLANOWANE,
      state: rowState(TASK_STATUS.ZAPLANOWANE, missingLabels(crewRequired), optionalMissingLabels([s.equipment]), isStepDone(TASK_STATUS.ZAPLANOWANE)),
      primary: task.ekipa_nazwa || (task.ekipa_id ? `Ekipa #${task.ekipa_id}` : 'Bez ekipy'),
      detail: safetyChecklist.find((item) => item.required && !item.ok)?.detail || 'Ekipa widzi brief, zdjęcia, ryzyka i dojazd.',
      missing: missingLabels(crewRequired),
      optionalMissing: optionalMissingLabels([s.equipment]),
      actionLabel: missingLabels(crewRequired).length ? 'Popraw odprawę' : 'Kopiuj brief',
      action: missingLabels(crewRequired).length ? { target: 'edit', formStep: 'work' } : { target: 'copyBrief' },
    },
    {
      key: 'execution',
      step: '5',
      title: 'Wykonanie pracy',
      owner: 'Ekipa w terenie',
      status: TASK_STATUS.W_REALIZACJI,
      state: rowState(TASK_STATUS.W_REALIZACJI, missingLabels(executionRequired), [], isStepDone(TASK_STATUS.W_REALIZACJI)),
      primary: currentStatus === TASK_STATUS.W_REALIZACJI ? 'Praca w toku' : 'Czeka na start',
      detail: executionRequired.find((item) => !item.ok)?.detail || 'Po starcie ekipa raportuje problemy i dowody wykonania.',
      missing: missingLabels(executionRequired),
      actionLabel: currentStatus === TASK_STATUS.ZAPLANOWANE ? 'Rozpocznij' : currentStatus === TASK_STATUS.W_REALIZACJI ? 'Zamknij pracę' : 'Pokaż odprawę',
      action: currentStatus === TASK_STATUS.ZAPLANOWANE
        ? { target: 'status', nextStatus: TASK_STATUS.W_REALIZACJI }
        : currentStatus === TASK_STATUS.W_REALIZACJI
          ? { target: 'status', nextStatus: TASK_STATUS.ZAKONCZONE }
          : { target: 'crewBrief' },
    },
    {
      key: 'close',
      step: '6',
      title: 'Zamknięcie i rozliczenie',
      owner: 'Biuro / kierownik',
      status: TASK_STATUS.ZAKONCZONE,
      state: currentStatus === TASK_STATUS.ZAKONCZONE ? 'done' : closeRequired.length ? 'blocked' : meta?.diagnostics?.readyToClose ? 'active' : 'ready',
      primary: currentStatus === TASK_STATUS.ZAKONCZONE ? 'Zamknięte' : meta?.diagnostics?.readyToClose ? 'Gotowe do zamknięcia' : 'Jeszcze przed finalną kontrolą',
      detail: closeRequired[0]?.detail || (contact.status === 'risk'
        ? 'Sprawdź kontakt, cenę, zdjęcia i kompletność danych.'
        : 'Po wykonaniu zostaje kontrola jakości i rozliczenie.'),
      missing: closeRequired.map((item) => item.label),
      actionLabel: meta?.diagnostics?.readyToClose ? 'Zamknij zlecenie' : 'Centrum decyzji',
      action: meta?.diagnostics?.readyToClose
        ? { target: 'status', nextStatus: TASK_STATUS.ZAKONCZONE }
        : { target: 'decision' },
    },
  ];
}

function DetailWorkflowCommandCenter({ styles, rows, statusBusy, canChangeStatus, onCommand }) {
  if (!rows.length) return null;
  return (
    <section style={styles.detailWorkflowPanel}>
      <div style={styles.detailWorkflowHeader}>
        <div>
          <div style={styles.detailOpsEyebrow}>Sterowanie zleceniem</div>
          <div style={styles.detailWorkflowTitle}>Jedna ścieżka od telefonu do wykonania</div>
          <p style={styles.detailWorkflowSubtitle}>
            Każdy etap ma właściciela, listę braków i jeden następny ruch. To ma zastąpić skakanie po różnych formularzach.
          </p>
        </div>
        <span style={styles.detailWorkflowBadge}>
          {rows.filter((row) => row.state === 'done').length}/{rows.length} etapów
        </span>
      </div>
      <div style={styles.detailWorkflowGrid}>
        {rows.map((row) => {
          const stateStyle = styles[`detailWorkflowStep_${row.state}`] || {};
          const disabled = statusBusy || (row.action?.target === 'status' && !canChangeStatus);
          return (
            <article key={row.key} style={{ ...styles.detailWorkflowStep, ...stateStyle }}>
              <div style={styles.detailWorkflowStepTop}>
                <span style={styles.detailWorkflowStepNo}>{row.step}</span>
                <span style={styles.detailWorkflowOwner}>{row.owner}</span>
              </div>
              <strong style={styles.detailWorkflowStepTitle}>{row.title}</strong>
              <span style={styles.detailWorkflowPrimary}>{row.primary}</span>
              <small style={styles.detailWorkflowDetail}>{row.detail}</small>
              {row.missing?.length ? (
                <div style={styles.detailWorkflowMissing}>
                  {row.missing.slice(0, 3).map((label) => <span key={label} style={styles.detailWorkflowPill}>{label}</span>)}
                </div>
              ) : row.optionalMissing?.length ? (
                <div style={styles.detailWorkflowOptional}>
                  {row.optionalMissing.slice(0, 2).map((label) => <span key={label} style={styles.detailWorkflowOptionalPill}>Opcj.: {label}</span>)}
                </div>
              ) : (
                <div style={styles.detailWorkflowOk}>Gotowe</div>
              )}
              <button
                type="button"
                style={{ ...styles.detailWorkflowAction, ...(disabled ? styles.detailWorkflowActionDisabled : {}) }}
                disabled={disabled}
                onClick={() => onCommand(row.action)}
              >
                {row.actionLabel}
              </button>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function CrewExecutionBrief({
  styles,
  task,
  photos,
  issues,
  safetyChecklist,
  equipment,
  issueDraft,
  issueSaving,
  statusBusy,
  canChangeStatus,
  onIssueDraftChange,
  onReportIssue,
  onStart,
  onFinish,
  onCopy,
}) {
  if (!task) return null;
  const description = getTaskCrewDescription(task);
  const risk = getTaskCrewRisk(task);
  const equipmentNote = getTaskCrewEquipmentNote(task);
  const fieldPhotos = photos
    .filter((photo) => ['Wycena', 'Szkic', 'Przed'].includes(photo.typ))
    .slice(0, 4);
  const visibleChecklist = safetyChecklist.slice(0, 6);
  const canStart = canChangeStatus && task.status === TASK_STATUS.ZAPLANOWANE;
  const canFinish = canChangeStatus && isTaskInProgress(task.status);

  return (
    <section className="zlecenia-crew-brief" style={styles.crewBriefPanel}>
      <div style={styles.crewBriefHeader}>
        <div>
          <div style={styles.detailOpsEyebrow}>Brief brygady</div>
          <div style={styles.crewBriefTitle}>Jedna instrukcja wykonania pracy</div>
          <p style={styles.crewBriefSubtitle}>
            To jest pakiet dla ekipy: co robimy, gdzie, jakim sprzetem, jakie ryzyka i jakie zdjecia pokazal wyceniajacy.
          </p>
        </div>
        <span style={{ ...styles.businessHealth, ...styles.businessHealth_good }}>
          {task.status || 'Nowe'}
        </span>
      </div>

      <div style={styles.crewBriefGrid}>
        <div style={styles.crewBriefMain}>
          <div style={styles.crewBriefRow}>
            <span>Termin</span>
            <strong>{formatTaskPlanLine(task)}</strong>
          </div>
          <div style={styles.crewBriefRow}>
            <span>Klient</span>
            <strong>{task.klient_nazwa || 'Brak klienta'}{task.klient_telefon ? ` | ${task.klient_telefon}` : ''}</strong>
          </div>
          <div style={styles.crewBriefRow}>
            <span>Adres</span>
            <strong>{getTaskAddressLine(task) || 'Brak adresu'}</strong>
          </div>
          <div style={styles.crewBriefBlock}>
            <span>Zakres prac</span>
            <p>{description || 'Brak jasnego opisu. Biuro albo wyceniajacy musi dopisac zakres przed wyjazdem ekipy.'}</p>
          </div>
          <div style={styles.crewBriefTwoCol}>
            <div style={styles.crewBriefBlock}>
              <span>Sprzet i logistyka</span>
              <p>{[equipment.join(', '), equipmentNote].filter(Boolean).join(' | ') || 'Sprzet nie zostal doprecyzowany.'}</p>
            </div>
            <div style={styles.crewBriefBlock}>
              <span>Ryzyka / BHP</span>
              <p>{risk || 'Brak wpisanych ryzyk. Sprawdzic teren przed startem pracy.'}</p>
            </div>
          </div>
        </div>

        <aside style={styles.crewBriefSide}>
          <div style={styles.crewBriefActions}>
            <button type="button" style={styles.crewActionBtn} disabled={!canStart || statusBusy} onClick={onStart}>
              Start pracy
            </button>
            <button type="button" style={styles.crewActionBtn} disabled={!canFinish || statusBusy} onClick={onFinish}>
              Zakoncz
            </button>
            <button type="button" style={styles.crewActionBtnSecondary} onClick={onCopy}>
              Kopiuj brief
            </button>
          </div>
          <div style={styles.crewIssueBox}>
            <div style={styles.detailDecisionLabel}>Szybkie zgloszenie problemu</div>
            <select
              style={styles.crewIssueSelect}
              value={issueDraft.typ}
              onChange={(event) => onIssueDraftChange({ ...issueDraft, typ: event.target.value })}
              disabled={issueSaving}
            >
              {CREW_ISSUE_TYPES.map((item) => (
                <option key={item.key} value={item.key}>{item.label}</option>
              ))}
            </select>
            <textarea
              style={styles.crewIssueTextarea}
              value={issueDraft.opis}
              placeholder="Co blokuje prace? Np. brak dostepu, klient zmienil zakres, potrzebna zwyzka."
              onChange={(event) => onIssueDraftChange({ ...issueDraft, opis: event.target.value })}
              disabled={issueSaving}
            />
            <button type="button" style={styles.crewIssueBtn} disabled={issueSaving} onClick={onReportIssue}>
              {issueSaving ? 'Zglaszam...' : 'Zglos problem'}
            </button>
            <small style={styles.crewIssueCount}>Zgloszenia: {issues.length}</small>
          </div>
        </aside>
      </div>

      <div style={styles.crewBriefBottom}>
        <div style={styles.crewChecklist}>
          {visibleChecklist.map((item) => (
            <div
              key={item.key}
              style={{
                ...styles.crewChecklistItem,
                ...(item.ok ? styles.detailChecklistOk : item.required ? styles.detailChecklistDanger : styles.detailChecklistWarn),
              }}
            >
              <span>{item.ok ? 'OK' : item.required ? 'Wymagane' : 'Uwaga'}</span>
              <strong>{item.label}</strong>
              <small>{item.detail}</small>
            </div>
          ))}
        </div>
        <div style={styles.crewPhotoStrip}>
          {fieldPhotos.length ? fieldPhotos.map((photo) => (
            <a key={photo.id || photo.sciezka} href={taskAssetUrl(photo.sciezka || photo.url)} target="_blank" rel="noreferrer" style={styles.crewPhotoLink}>
              <img src={taskAssetUrl(photo.sciezka || photo.url)} alt={photo.opis || 'Zdjecie z wyceny'} style={styles.crewPhotoThumb} />
              <span style={styles.crewPhotoLabel}>{taskPhotoTypeLabel(photo.typ)}</span>
            </a>
          )) : (
            <div style={styles.crewPhotoEmpty}>Brak zdjec wyceny/szkicu dla ekipy.</div>
          )}
        </div>
      </div>
    </section>
  );
}

function getTaskDay(task) {
  return task.data_planowana || task.data_wykonania
    ? String(task.data_planowana || task.data_wykonania).slice(0, 10)
    : '';
}

function getTaskAddressLine(task) {
  return [task.adres, task.miasto].filter(Boolean).join(', ');
}

function extractTaskNoteLine(task, label) {
  const raw = String(task?.notatki_wewnetrzne || '');
  const line = raw
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find((item) => item.toLowerCase().startsWith(`${String(label).toLowerCase()}:`));
  return line ? line.slice(String(label).length + 1).trim() : '';
}

function getTaskCrewDescription(task) {
  return task?.opis_pracy || task?.opis || extractTaskNoteLine(task, 'Zakres prac') || task?.wynik || '';
}

function getTaskCrewRisk(task) {
  return task?.ryzyka || extractTaskNoteLine(task, 'Ryzyka') || '';
}

function getTaskCrewEquipmentNote(task) {
  return task?.sprzet_notatka || extractTaskNoteLine(task, 'Sprzet / uwagi') || extractTaskNoteLine(task, 'Sprzet') || '';
}

function formatTaskPlanLine(task) {
  const day = task?.data_planowana ? String(task.data_planowana).slice(0, 10) : 'brak daty';
  const time = task?.godzina_rozpoczecia || (String(task?.data_planowana || '').includes('T') ? String(task.data_planowana).split('T')[1]?.slice(0, 5) : '');
  const hours = task?.czas_planowany_godziny ? `${task.czas_planowany_godziny} h` : 'brak czasu';
  return [day, time, hours].filter(Boolean).join(' | ');
}

function getMapsHref(task) {
  const address = getTaskAddressLine(task);
  return address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}` : '';
}

function getDirectionsHref(tasks) {
  const addresses = tasks
    .map(getTaskAddressLine)
    .filter(Boolean)
    .slice(0, 10);
  if (addresses.length === 0) return '';
  if (addresses.length === 1) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addresses[0])}`;
  }
  const destination = addresses[addresses.length - 1];
  const waypoints = addresses.slice(0, -1).join('|');
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}&waypoints=${encodeURIComponent(waypoints)}`;
}

function getDayDistance(day, todayIso) {
  if (!day) return Number.POSITIVE_INFINITY;
  const target = new Date(`${day}T00:00:00`);
  const today = new Date(`${todayIso}T00:00:00`);
  if (Number.isNaN(target.getTime()) || Number.isNaN(today.getTime())) return Number.POSITIVE_INFINITY;
  return Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

function firstNumericValue(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === '') continue;
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return 0;
}

function getTaskPhotoSummary(task = {}) {
  const fallbackPhotos = Array.isArray(task.zdjecia) ? task.zdjecia.length : 0;
  const total = firstNumericValue(task.photo_total, task.photos_count, task.zdjecia_count, fallbackPhotos);
  const valuation = firstNumericValue(task.photo_wycena, task.photos_wycena);
  const sketch = firstNumericValue(task.photo_szkic, task.photos_szkic);
  const access = firstNumericValue(task.photo_dojazd, task.photos_dojazd);
  return {
    total,
    valuation,
    sketch,
    access,
    fieldEvidence: valuation + sketch,
  };
}

function getTaskWorkflowMissingFromApi(task = {}) {
  const rawItems = Array.isArray(task.workflow_missing_items) ? task.workflow_missing_items : [];
  const labels = Array.isArray(task.workflow_missing_labels) ? task.workflow_missing_labels : [];
  const items = [
    ...rawItems.map((item) => ({
      key: String(item?.key || item?.label || '').trim(),
      label: String(item?.label || item?.key || '').trim(),
      required: item?.required !== false,
    })),
    ...labels.map((label) => ({
      key: String(label || '').trim(),
      label: String(label || '').trim(),
      required: true,
    })),
  ].filter((item) => item.label);

  const seen = new Set();
  return items.filter((item) => {
    const key = `${item.key || item.label}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function taskWorkflowBlockerTone(item) {
  const key = String(item?.key || item?.label || '').toLowerCase();
  if (key.includes('phone') || key.includes('telefon') || key.includes('client') || key.includes('klient')) return 'danger';
  return 'warning';
}

function normalizeTaskWorkflowBlockerKey(item) {
  const key = String(item?.key || item?.label || '').toLowerCase();
  if (key.includes('phone') || key.includes('telefon')) return 'noContact';
  if (key.includes('team') || key.includes('ekipa')) return 'unassigned';
  if (key.includes('date') || key.includes('termin')) return 'noDate';
  if (key.includes('price') || key.includes('cena') || key.includes('budzet') || key.includes('budżet')) return 'noPrice';
  if (key.includes('photo') || key.includes('zdjec') || key.includes('zdję')) return 'noMedia';
  if (key.includes('sketch') || key.includes('szkic')) return 'noFieldSketch';
  if (key.includes('estimator') || key.includes('wyceniacz')) return 'estimator';
  if (key.includes('brief') || key.includes('opis') || key.includes('zakres')) return 'brief';
  return `api_${key || 'workflow'}`.replace(/\s+/g, '_');
}

function getTaskWorkflowStageFromApi(task = {}) {
  if (!task.workflow_stage && !task.workflow_stage_label) return null;
  const status = String(task.status || '');
  let tone = 'blue';
  if (task.workflow_blockers_count > 0) tone = 'warning';
  else if (status === TASK_STATUS.ANULOWANE) tone = 'danger';
  else if (isTaskClosed(status)) tone = 'good';
  else if ([TASK_STATUS.DO_ZATWIERDZENIA, TASK_STATUS.ZAPLANOWANE].includes(status)) tone = 'good';

  return {
    key: task.workflow_stage || status || 'workflow',
    step: task.workflow_stage_step || '',
    label: task.workflow_stage_label || status || 'Workflow',
    detail: task.workflow_stage_detail || task.workflow_next_action || '',
    tone,
  };
}

function getTaskDiagnostics(task, todayIso) {
  const day = getTaskDay(task);
  const status = String(task.status || '');
  const isClosed = isTaskClosed(status);
  const photos = getTaskPhotoSummary(task);
  const needsCrew = CREW_REQUIRED_TASK_STATUSES.has(status);
  const needsFieldEvidence = FIELD_EVIDENCE_REQUIRED_TASK_STATUSES.has(status);
  const needsPrice = PRICE_REQUIRED_TASK_STATUSES.has(status);
  const hasPrice = Boolean(Number(task.wartosc_planowana) || Number(task.budzet));
  const has = {
    overdue: Boolean(day && day < todayIso && !isClosed),
    unassigned: Boolean(!task.ekipa_id && needsCrew && !isClosed),
    urgent: Boolean(task.priorytet === 'Pilny' && !isClosed),
    today: Boolean(day === todayIso && !isClosed),
    noDate: Boolean(!day && !isClosed),
    noContact: Boolean(!String(task.klient_telefon || '').trim() && !isClosed),
    noMedia: Boolean(photos.total === 0 && needsFieldEvidence && !isClosed),
    noFieldSketch: Boolean(photos.total > 0 && photos.fieldEvidence === 0 && needsFieldEvidence && !isClosed),
    noPrice: Boolean(!hasPrice && needsPrice && !isClosed),
  };

  const localBlockers = [
    has.noContact ? { key: 'noContact', label: 'Brak telefonu', tone: 'danger' } : null,
    has.unassigned ? { key: 'unassigned', label: 'Brak ekipy', tone: 'warning' } : null,
    has.noDate ? { key: 'noDate', label: 'Brak terminu', tone: 'warning' } : null,
    has.noMedia ? { key: 'noMedia', label: 'Brak zdjęć', tone: 'warning' } : null,
    has.noFieldSketch ? { key: 'noFieldSketch', label: 'Brak wyceny/szkicu', tone: 'warning' } : null,
    has.noPrice ? { key: 'noPrice', label: 'Brak ceny', tone: 'warning' } : null,
  ].filter(Boolean);
  const apiBlockers = getTaskWorkflowMissingFromApi(task)
    .filter((item) => item.required !== false)
    .map((item) => ({
      key: normalizeTaskWorkflowBlockerKey(item),
      label: item.label,
      tone: taskWorkflowBlockerTone(item),
    }));
  const blockerSeen = new Set();
  const blockers = [...localBlockers, ...apiBlockers].filter((item) => {
    const key = String(item.key || item.label || '').toLowerCase();
    if (blockerSeen.has(key)) return false;
    blockerSeen.add(key);
    return true;
  });

  const risks = [
    has.overdue ? { key: 'overdue', label: 'Po terminie', tone: 'danger' } : null,
    has.urgent ? { key: 'urgent', label: 'Pilne', tone: 'warning' } : null,
  ].filter(Boolean);

  const readyToClose = isTaskInProgress(status) && blockers.length === 0;
  const readyForOfficeApproval = status === TASK_STATUS.WYCENA_TERENOWA && blockers.length === 0;
  const readyForCrewPlan = status === TASK_STATUS.DO_ZATWIERDZENIA && blockers.length === 0;
  const score = Math.max(
    0,
    100 -
      blockers.length * 22 -
      risks.length * 12 -
      (status === TASK_STATUS.NOWE && !isClosed ? 8 : 0)
  );

  let nextAction = { label: task.workflow_next_action || 'Otwórz szczegóły', target: 'details' };
  if (blockers.length) {
    const first = blockers[0];
    const key = String(first.key || first.label || '').toLowerCase();
    nextAction = {
      label: `Uzupełnij: ${first.label}`,
      target: key.includes('media') || key.includes('photo') || key.includes('sketch') || key.includes('zdj') || key.includes('szkic')
        ? 'details'
        : 'edit',
    };
  }
  else if (has.noContact) nextAction = { label: 'Uzupełnij kontakt', target: 'edit' };
  else if (has.unassigned) nextAction = { label: 'Przypisz ekipę', target: 'edit' };
  else if (has.noDate) nextAction = { label: 'Ustal termin', target: 'edit' };
  else if (has.noMedia || has.noFieldSketch) nextAction = { label: 'Dodaj zdjęcia', target: 'details' };
  else if (has.noPrice) nextAction = { label: 'Uzupełnij wycenę', target: 'edit' };
  else if (status === TASK_STATUS.NOWE && has.overdue) nextAction = { label: 'Przeplanuj oględziny', target: 'edit' };
  else if (status === TASK_STATUS.NOWE) nextAction = { label: 'Wyślij do wyceniającego', target: 'status', nextStatus: TASK_STATUS.WYCENA_TERENOWA };
  else if (readyForOfficeApproval) nextAction = { label: 'Klient akceptuje', target: 'status', nextStatus: TASK_STATUS.DO_ZATWIERDZENIA };
  else if (readyForCrewPlan) nextAction = { label: 'Zatwierdź plan ekipy', target: 'status', nextStatus: TASK_STATUS.ZAPLANOWANE };
  else if (status === TASK_STATUS.ZAPLANOWANE && has.overdue) nextAction = { label: 'Przeplanuj termin ekipy', target: 'edit' };
  else if (status === TASK_STATUS.ZAPLANOWANE) nextAction = { label: 'Rozpocznij realizację', target: 'status', nextStatus: TASK_STATUS.W_REALIZACJI };
  else if (readyToClose) nextAction = { label: 'Zamknij zlecenie', target: 'status', nextStatus: TASK_STATUS.ZAKONCZONE };
  else if (has.overdue) nextAction = { label: 'Przeplanuj termin', target: 'edit' };

  return {
    day,
    has: { ...has, readyClose: readyToClose, readyForOfficeApproval, readyForCrewPlan },
    items: [...blockers, ...risks],
    blockers,
    risks,
    readyToClose,
    readyForOfficeApproval,
    readyForCrewPlan,
    score,
    photos,
    level: blockers.length || has.overdue ? 'danger' : has.urgent || score < 85 ? 'warning' : 'good',
    nextAction,
  };
}

function getTaskInspectionWorkflow(task = {}, diagnostics = null) {
  const apiStage = getTaskWorkflowStageFromApi(task);
  if (apiStage) return apiStage;

  const status = String(task.status || '');
  const photos = diagnostics?.photos || getTaskPhotoSummary(task);
  const isClosed = isTaskClosed(status);
  const hasTeam = Boolean(task.ekipa_id || task.ekipa_nazwa);
  const hasPrice = Boolean(Number(task.wartosc_planowana) || Number(task.budzet));
  const hasFieldPackage = photos.total > 0 && hasPrice;

  if (status === TASK_STATUS.ANULOWANE) {
    return { key: 'cancelled', step: 'X', label: 'Anulowane', detail: 'Zlecenie wycofane', tone: 'danger' };
  }
  if (isClosed) {
    return { key: 'done', step: '6', label: 'Zamknięte', detail: 'Praca zakończona i rozliczana', tone: 'good' };
  }
  if (isTaskInProgress(status)) {
    return { key: 'execution', step: '5', label: 'Praca brygady', detail: 'Ekipa realizuje lub kończy pracę', tone: 'blue' };
  }
  if (status === TASK_STATUS.ZAPLANOWANE) {
    return { key: 'crewPlan', step: '4', label: 'Plan ekipy', detail: 'Biuro zatwierdziło termin i obsadę brygady', tone: 'blue' };
  }
  if (status === TASK_STATUS.DO_ZATWIERDZENIA || (!status && hasFieldPackage && hasTeam)) {
    return { key: 'officeApproval', step: '3', label: 'Biuro zatwierdza', detail: 'Klient zaakceptował, biuro dopina ekipę i termin', tone: 'good' };
  }
  if (status === TASK_STATUS.WYCENA_TERENOWA) {
    return { key: 'fieldInspection', step: '2', label: 'Oględziny / wycena', detail: 'Wyceniający zbiera zdjęcia, zakres i cenę', tone: 'warning' };
  }
  return { key: 'intake', step: '1', label: 'Biuro umawia', detail: 'Telefon, adres i termin oględzin', tone: 'muted' };
}

function getTaskQueueMeta(task, todayIso) {
  const diagnostics = getTaskDiagnostics(task, todayIso);
  const daysLeft = getDayDistance(diagnostics.day, todayIso);
  const value = Number(task.wartosc_planowana) || 0;
  let score = 0;
  const reasons = [];

  if (diagnostics.has.noContact) {
    score += 42;
    reasons.push('brak telefonu');
  }
  if (diagnostics.has.overdue) {
    score += 38 + Math.min(24, Math.abs(daysLeft) * 3);
    reasons.push('po terminie');
  }
  if (diagnostics.has.unassigned) {
    score += 32;
    reasons.push('brak ekipy');
  }
  if (diagnostics.has.noDate) {
    score += 24;
    reasons.push('brak terminu');
  }
  if (diagnostics.has.noMedia) {
    score += 28;
    reasons.push('brak zdjęć');
  } else if (diagnostics.has.noFieldSketch) {
    score += 16;
    reasons.push('brak szkicu');
  }
  if (diagnostics.has.noPrice) {
    score += 20;
    reasons.push('brak wyceny');
  }
  if (diagnostics.has.urgent) {
    score += 22;
    reasons.push('pilne');
  }
  if (diagnostics.has.today) {
    score += 18;
    reasons.push('dzisiaj');
  }
  if (diagnostics.readyToClose) {
    score += 16;
    reasons.push('do zamknięcia');
  }
  if (isTaskInProgress(task.status)) score += 8;
  score += Math.min(18, value / 1000);

  return {
    diagnostics,
    daysLeft,
    value,
    score,
    reasons: reasons.slice(0, 3),
  };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function getTaskBusinessMeta(task, todayIso, contact = {}) {
  const diagnostics = getTaskDiagnostics(task, todayIso);
  const followup = getContactFollowupMeta(contact);
  const value = Number(task.wartosc_planowana) || 0;
  const minimum = Number(task.kwota_minimalna) || 0;
  const budget = Number(task.budzet) || 0;
  const plannedHours = Number(task.czas_planowany_godziny) || 0;
  const bufferBase = minimum || budget;
  const buffer = value && bufferBase ? value - bufferBase : null;
  const revenuePerHour = value && plannedHours ? value / plannedHours : null;
  const flags = [];
  let riskWeight = 0;

  if (diagnostics.has.overdue) {
    riskWeight += 0.3;
    flags.push('po terminie');
  }
  if (diagnostics.has.unassigned) {
    riskWeight += 0.24;
    flags.push('brak ekipy');
  }
  if (diagnostics.has.noDate) {
    riskWeight += 0.18;
    flags.push('brak terminu');
  }
  if (diagnostics.has.noContact) {
    riskWeight += 0.16;
    flags.push('brak telefonu');
  }
  if (diagnostics.has.noMedia) {
    riskWeight += 0.24;
    flags.push('brak zdjęć');
  } else if (diagnostics.has.noFieldSketch) {
    riskWeight += 0.12;
    flags.push('brak szkicu/wyceny');
  }
  if (diagnostics.has.noPrice) {
    riskWeight += 0.18;
    flags.push('brak wyceny');
  }
  if (diagnostics.has.urgent) {
    riskWeight += 0.12;
    flags.push('pilne');
  }
  if (contact.status === 'risk') {
    riskWeight += 0.32;
    flags.push('ryzyko kontaktu');
  }
  if (contact.status === 'waiting') {
    riskWeight += 0.1;
    flags.push('czeka na klienta');
  }
  if (followup.overdue) {
    riskWeight += 0.22;
    flags.push('follow-up po terminie');
  } else if (followup.today) {
    riskWeight += 0.08;
    flags.push('follow-up dziś');
  }
  if (buffer !== null && buffer < 0) {
    riskWeight += 0.2;
    flags.push('poniżej minimum');
  }
  if (diagnostics.readyToClose) {
    riskWeight = Math.max(0, riskWeight - 0.08);
  }

  const normalizedRisk = clamp(riskWeight, 0, 0.95);
  return {
    diagnostics,
    followup,
    value,
    minimum,
    budget,
    plannedHours,
    buffer,
    bufferRatio: buffer !== null && value ? buffer / value : null,
    revenuePerHour,
    flags,
    riskScore: Math.round(normalizedRisk * 100),
    riskValue: Math.round(value * normalizedRisk),
    severity: normalizedRisk >= 0.5 || (buffer !== null && buffer < 0) ? 'danger' : normalizedRisk >= 0.22 ? 'warning' : 'good',
  };
}

function buildBusinessGuardSummary(tasks, todayIso, getContact) {
  const rows = tasks.map((task) => ({
    task,
    meta: getTaskBusinessMeta(task, todayIso, getContact(task.id)),
  }));
  const totalValue = rows.reduce((sum, row) => sum + row.meta.value, 0);
  const riskValue = rows.reduce((sum, row) => sum + row.meta.riskValue, 0);
  const readyRows = rows.filter((row) => row.meta.diagnostics.readyToClose);
  const readyValue = readyRows.reduce((sum, row) => sum + row.meta.value, 0);
  const criticalRows = rows.filter((row) => row.meta.severity === 'danger');
  const totalHours = rows.reduce((sum, row) => sum + row.meta.plannedHours, 0);
  const pricedHoursValue = rows.reduce((sum, row) => row.meta.plannedHours ? sum + row.meta.value : sum, 0);
  const bufferRows = rows.filter((row) => row.meta.buffer !== null);
  const totalBuffer = bufferRows.reduce((sum, row) => sum + row.meta.buffer, 0);
  const avgReadiness = rows.length
    ? Math.round(rows.reduce((sum, row) => sum + row.meta.diagnostics.score, 0) / rows.length)
    : 100;
  const riskRatio = totalValue ? riskValue / totalValue : 0;
  const health = riskRatio >= 0.35 || criticalRows.length >= 3
    ? 'danger'
    : riskRatio >= 0.16 || criticalRows.length
      ? 'warning'
      : 'good';

  const topRisks = rows
    .filter((row) => row.meta.riskScore > 0 || row.meta.riskValue > 0)
    .sort((a, b) => {
      if (b.meta.riskValue !== a.meta.riskValue) return b.meta.riskValue - a.meta.riskValue;
      return b.meta.riskScore - a.meta.riskScore;
    })
    .slice(0, 3);

  return {
    rows,
    totalValue,
    riskValue,
    riskRatio,
    readyCount: readyRows.length,
    readyValue,
    criticalCount: criticalRows.length,
    avgReadiness,
    totalBuffer,
    hasBuffer: bufferRows.length > 0,
    revenuePerHour: totalHours ? pricedHoursValue / totalHours : null,
    health,
    healthLabel: health === 'danger' ? 'Alarm' : health === 'warning' ? 'Uwaga' : 'Stabilnie',
    topRisks,
    signals: [
      {
        key: 'overdue',
        label: 'Po terminie',
        count: rows.filter((row) => row.meta.diagnostics.has.overdue).length,
        value: rows.filter((row) => row.meta.diagnostics.has.overdue).reduce((sum, row) => sum + row.meta.value, 0),
        filter: 'overdue',
      },
      {
        key: 'unassigned',
        label: 'Bez ekipy',
        count: rows.filter((row) => row.meta.diagnostics.has.unassigned).length,
        value: rows.filter((row) => row.meta.diagnostics.has.unassigned).reduce((sum, row) => sum + row.meta.value, 0),
        filter: 'unassigned',
      },
      {
        key: 'contactOverdue',
        label: 'Kontakt po terminie',
        count: rows.filter((row) => row.meta.followup.overdue).length,
        value: rows.filter((row) => row.meta.followup.overdue).reduce((sum, row) => sum + row.meta.value, 0),
        filter: 'contactOverdue',
      },
      {
        key: 'readyClose',
        label: 'Do zamknięcia',
        count: readyRows.length,
        value: readyValue,
        filter: 'readyClose',
      },
    ],
  };
}

function getTaskPriceGuidance(task, meta) {
  const value = meta?.value || 0;
  const minimum = meta?.minimum || 0;
  const budget = meta?.budget || 0;
  const plannedHours = meta?.plannedHours || 0;
  const revenuePerHour = meta?.revenuePerHour || 0;
  const base = Math.max(minimum, budget);
  const recommended = base ? Math.max(value, Math.ceil(base * 1.08 / 50) * 50) : value;
  const buffer = base ? value - base : null;
  const minLabel = minimum ? 'kwoty minimalnej' : budget ? 'budżetu' : 'braku progu';

  if (!value && !base) {
    return {
      tone: 'warning',
      label: 'Brak danych ceny',
      detail: 'Uzupełnij wartość zlecenia oraz minimum lub budżet, żeby system pilnował marży.',
      recommended: null,
      buffer: null,
      revenuePerHour: null,
      minLabel,
    };
  }

  if (base && value < base) {
    return {
      tone: 'danger',
      label: 'Cena poniżej minimum',
      detail: `Zlecenie jest poniżej ${minLabel}; podnieś cenę albo oznacz wyjątek w notatce.`,
      recommended,
      buffer,
      revenuePerHour,
      minLabel,
    };
  }

  if (base && value < recommended) {
    return {
      tone: 'warning',
      label: 'Cena bez bufora',
      detail: `Cena spełnia próg, ale bufor jest mały. Rekomendacja daje około 8% zapasu.`,
      recommended,
      buffer,
      revenuePerHour,
      minLabel,
    };
  }

  return {
    tone: 'good',
    label: base ? 'Cena bezpieczna' : 'Cena wpisana',
    detail: plannedHours && revenuePerHour
      ? 'Cena jest spójna z progiem i ma policzoną stawkę godzinową.'
      : 'Cena jest wpisana; dodaj plan godzin, żeby pilnować stawki pracy.',
    recommended: recommended || value || null,
    buffer,
    revenuePerHour,
    minLabel,
  };
}

function getTaskQualityChecklist(task, meta, contact = {}) {
  const diagnostics = meta?.diagnostics || getTaskDiagnostics(task, new Date().toISOString().slice(0, 10));
  const photos = diagnostics.photos || getTaskPhotoSummary(task);
  const price = getTaskPriceGuidance(task, meta || getTaskBusinessMeta(task, new Date().toISOString().slice(0, 10), contact));
  const status = String(task.status || '');
  const needsCrew = CREW_REQUIRED_TASK_STATUSES.has(status);
  const needsFieldEvidence = FIELD_EVIDENCE_REQUIRED_TASK_STATUSES.has(status);
  const needsPrice = PRICE_REQUIRED_TASK_STATUSES.has(status);
  const hasPrice = Boolean(Number(task.wartosc_planowana) || Number(task.budzet));
  return [
    {
      key: 'phone',
      label: 'Telefon klienta',
      detail: task.klient_telefon ? task.klient_telefon : 'brak numeru do klienta',
      ok: Boolean(String(task.klient_telefon || '').trim()),
      required: true,
    },
    {
      key: 'address',
      label: 'Adres realizacji',
      detail: getTaskAddressLine(task) || 'brak adresu do trasy',
      ok: Boolean(getTaskAddressLine(task)),
      required: true,
    },
    {
      key: 'date',
      label: 'Termin',
      detail: diagnostics.day || 'brak daty planowanej',
      ok: Boolean(diagnostics.day),
      required: true,
    },
    {
      key: 'team',
      label: 'Ekipa',
      detail: task.ekipa_nazwa || (task.ekipa_id ? `Ekipa #${task.ekipa_id}` : 'brak przypisanej ekipy'),
      ok: !needsCrew || Boolean(task.ekipa_id || task.ekipa_nazwa),
      required: needsCrew,
    },
    {
      key: 'media',
      label: 'Zdjęcia z wyceny',
      detail: photos.total ? `${photos.total} zdjęć, ${photos.fieldEvidence} wycena/szkic` : 'brak dowodu zdjęciowego',
      ok: !needsFieldEvidence || photos.total > 0,
      required: needsFieldEvidence,
    },
    {
      key: 'field-sketch',
      label: 'Szkic zakresu',
      detail: photos.fieldEvidence ? `${photos.valuation} wycena, ${photos.sketch} szkic` : 'brak szkicu lub zdjęcia z zakresem',
      ok: !needsFieldEvidence || photos.fieldEvidence > 0,
      required: false,
    },
    {
      key: 'contact',
      label: 'Status klienta',
      detail: getClientContactOption(contact.status).label,
      ok: contact.status === 'informed' || contact.status === 'waiting',
      required: false,
    },
    {
      key: 'price',
      label: 'Cena i minimum',
      detail: price.label,
      ok: !needsPrice || (hasPrice && price.tone !== 'danger'),
      required: needsPrice,
    },
    {
      key: 'hours',
      label: 'Plan godzin',
      detail: task.czas_planowany_godziny ? `${task.czas_planowany_godziny} h` : 'brak planu godzin',
      ok: Boolean(Number(task.czas_planowany_godziny)),
      required: false,
    },
    {
      key: 'brief',
      label: 'Opis lub wynik',
      detail: task.opis_pracy || task.wynik ? 'jest kontekst dla ekipy' : 'brak opisu pracy i wyniku rozmowy',
      ok: Boolean(task.opis_pracy || task.wynik),
      required: false,
    },
  ];
}

function getTaskEquipmentList(task) {
  return [
    ['Rębak', task.rebak],
    ['Piła na wysięgniku', task.pila_wysiegniku],
    ['Nożyce długie', task.nozyce_dlugie],
    ['Kosiarka', task.kosiarka],
    ['Podkaszarka', task.podkaszarka],
    ['Łopata', task.lopata],
    ['Mulczer', task.mulczer],
  ].filter(([, enabled]) => Boolean(enabled)).map(([label]) => label);
}

function getTaskSafetyChecklist(task, meta, contact = {}) {
  const diagnostics = meta?.diagnostics || getTaskDiagnostics(task, new Date().toISOString().slice(0, 10));
  const equipment = getTaskEquipmentList(task);
  const arboristWork = ['Wycinka', 'Pielęgnacja'].includes(task.typ_uslugi) || Boolean(task.arborysta);
  const needsCrew = CREW_REQUIRED_TASK_STATUSES.has(String(task.status || ''));
  return [
    {
      key: 'address',
      label: 'Adres i dojazd',
      ok: Boolean(getTaskAddressLine(task)),
      detail: getTaskAddressLine(task) || 'Brak adresu do mapy i odprawy.',
      required: true,
    },
    {
      key: 'team',
      label: 'Ekipa',
      ok: !needsCrew || Boolean(task.ekipa_id || task.ekipa_nazwa),
      detail: task.ekipa_nazwa || (task.ekipa_id ? `Ekipa #${task.ekipa_id}` : 'Brak przypisanej ekipy.'),
      required: needsCrew,
    },
    {
      key: 'brief',
      label: 'Odprawa pracy',
      ok: Boolean(task.opis_pracy || task.wynik),
      detail: task.opis_pracy || task.wynik || 'Brak jasnego opisu dla brygady.',
      required: true,
    },
    {
      key: 'arborist',
      label: 'BHP arborysty',
      ok: !arboristWork || Boolean(task.arborysta),
      detail: arboristWork
        ? (task.arborysta ? 'Wymagany arborysta oznaczony.' : 'Praca drzewna bez oznaczenia arborysty.')
        : 'Brak specjalnego wymogu arborystycznego.',
      required: arboristWork,
    },
    {
      key: 'equipment',
      label: 'Sprzęt',
      ok: equipment.length > 0 || !arboristWork,
      detail: equipment.length ? equipment.join(', ') : 'Sprzęt nie został doprecyzowany.',
      required: false,
    },
    {
      key: 'client',
      label: 'Kontakt klienta',
      ok: contact.status === 'informed' || contact.status === 'waiting' || Boolean(task.klient_telefon),
      detail: getClientContactOption(contact.status).label,
      required: false,
    },
    {
      key: 'close',
      label: 'Gotowość zamknięcia',
      ok: diagnostics.readyToClose,
      detail: diagnostics.readyToClose ? 'Można przejść do finalnej kontroli.' : diagnostics.nextAction.label,
      required: false,
    },
  ];
}

function getTaskDecisionRecommendation(task, meta, checklist, contact = {}) {
  const missingRequired = checklist.filter((item) => item.required && !item.ok);
  const price = getTaskPriceGuidance(task, meta);
  if (price.tone === 'danger') return 'Najpierw popraw cenę lub zatwierdź wyjątek, bo zlecenie schodzi poniżej progu.';
  if (contact.status === 'risk') return 'Najpierw wyjaśnij ryzyko kontaktu z klientem.';
  if (meta?.followup?.overdue) return 'Oddzwoń do klienta, follow-up jest po terminie.';
  if (missingRequired.length) return `Domknij blokadę: ${missingRequired[0].label.toLowerCase()}.`;
  if (meta?.diagnostics?.readyToClose) return 'Zlecenie wygląda gotowo do zamknięcia po finalnej kontroli jakości.';
  return meta?.diagnostics?.nextAction?.label || 'Otwórz szczegóły i przejdź po checklistach.';
}

function getTaskDetailNextAction(task, meta, checklist) {
  const price = getTaskPriceGuidance(task, meta);
  if (price.tone === 'danger') return { label: 'Popraw finanse', target: 'edit' };
  const missingRequired = checklist.find((item) => item.required && !item.ok);
  if (missingRequired) {
    const labels = {
      phone: 'Uzupełnij telefon',
      address: 'Uzupełnij adres',
      date: 'Ustal termin',
      team: 'Przypisz ekipę',
      price: 'Popraw finanse',
    };
    return { label: labels[missingRequired.key] || `Popraw: ${missingRequired.label}`, target: 'edit' };
  }
  if (meta?.followup?.overdue) return { label: 'Zapisz kontakt', target: 'contact' };
  return meta?.diagnostics?.nextAction || { label: 'Otwórz szczegóły', target: 'details' };
}

function getFormStepForEditAction(action) {
  const label = String(action?.label || '').toLowerCase();
  if (label.includes('telefon') || label.includes('kontakt') || label.includes('adres')) return 'client';
  if (label.includes('termin') || label.includes('ekip')) return 'planning';
  if (label.includes('zdj') || label.includes('szkic') || label.includes('media')) return 'media';
  if (label.includes('finans') || label.includes('cen') || label.includes('kwot') || label.includes('budżet')) return 'finance';
  if (label.includes('opis') || label.includes('pracy') || label.includes('brief')) return 'work';
  return 'client';
}

function buildTaskClosureGuard(task, todayIso, contact = {}) {
  const meta = getTaskBusinessMeta(task, todayIso, contact);
  const price = getTaskPriceGuidance(task, meta);
  const checklist = getTaskQualityChecklist(task, meta, contact);
  const blockers = checklist.filter((item) => item.required && !item.ok);
  const warnings = checklist.filter((item) => !item.required && !item.ok);

  if (price.tone === 'warning') {
    warnings.unshift({
      key: 'price-buffer',
      label: price.label,
      detail: price.detail,
      ok: false,
      required: false,
    });
  }

  if (meta.followup.overdue) {
    warnings.unshift({
      key: 'followup-overdue',
      label: 'Follow-up po terminie',
      detail: meta.followup.label,
      ok: false,
      required: false,
    });
  }

  return {
    task,
    meta,
    price,
    checklist,
    blockers,
    warnings,
    shouldPause: blockers.length > 0 || warnings.length > 0,
    canForceClose: blockers.length === 0,
  };
}

function compareTasksBySort(a, b, sortMode, todayIso) {
  const aMeta = getTaskQueueMeta(a, todayIso);
  const bMeta = getTaskQueueMeta(b, todayIso);

  if (sortMode === 'date') {
    const aDays = Number.isFinite(aMeta.daysLeft) ? aMeta.daysLeft : 9999;
    const bDays = Number.isFinite(bMeta.daysLeft) ? bMeta.daysLeft : 9999;
    if (aDays !== bDays) return aDays - bDays;
    return bMeta.score - aMeta.score;
  }

  if (sortMode === 'value') {
    if (bMeta.value !== aMeta.value) return bMeta.value - aMeta.value;
    return bMeta.score - aMeta.score;
  }

  if (sortMode === 'newest') {
    const aCreated = new Date(a.created_at || a.updated_at || 0).getTime() || 0;
    const bCreated = new Date(b.created_at || b.updated_at || 0).getTime() || 0;
    if (bCreated !== aCreated) return bCreated - aCreated;
    return Number(b.id || 0) - Number(a.id || 0);
  }

  if (bMeta.score !== aMeta.score) return bMeta.score - aMeta.score;
  const aDays = Number.isFinite(aMeta.daysLeft) ? aMeta.daysLeft : 9999;
  const bDays = Number.isFinite(bMeta.daysLeft) ? bMeta.daysLeft : 9999;
  if (aDays !== bDays) return aDays - bDays;
  return Number(a.id || 0) - Number(b.id || 0);
}

function formatQueueTiming(daysLeft) {
  if (!Number.isFinite(daysLeft)) return 'bez terminu';
  if (daysLeft < 0) return `${Math.abs(daysLeft)} dni po terminie`;
  if (daysLeft === 0) return 'dzisiaj';
  return `za ${daysLeft} dni`;
}

function getClientContactOption(status) {
  return CLIENT_CONTACT_STATUSES.find((item) => item.key === status) || {
    key: 'none',
    label: 'Brak statusu kontaktu',
    tone: 'muted',
  };
}

function formatContactStamp(value) {
  if (!value) return 'brak historii';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'brak historii';
  return date.toLocaleString('pl-PL', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function toDatetimeLocalValue(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function datetimeLocalToIso(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function getFollowupPresetIso(daysFromToday) {
  const date = new Date();
  date.setDate(date.getDate() + daysFromToday);
  date.setHours(daysFromToday === 0 ? Math.max(date.getHours() + 2, 10) : 10, 0, 0, 0);
  return date.toISOString();
}

function getContactFollowupMeta(contact) {
  if (!contact?.dueAt) {
    return { label: 'bez terminu follow-up', tone: 'muted', overdue: false, today: false };
  }
  const due = new Date(contact.dueAt);
  if (Number.isNaN(due.getTime())) {
    return { label: 'bez terminu follow-up', tone: 'muted', overdue: false, today: false };
  }
  const now = new Date();
  const dueDay = due.toISOString().slice(0, 10);
  const today = now.toISOString().slice(0, 10);
  const needsAction = contact.status !== 'informed';
  const overdue = needsAction && due.getTime() < now.getTime();
  const isToday = needsAction && dueDay === today;
  return {
    label: overdue ? `po terminie: ${formatContactStamp(contact.dueAt)}` : `follow-up: ${formatContactStamp(contact.dueAt)}`,
    tone: overdue ? 'danger' : isToday ? 'warning' : 'muted',
    overdue,
    today: isToday,
  };
}

function normalizeClientContact(row) {
  if (!row || typeof row !== 'object') return {};
  return {
    task_id: row.task_id ?? row.taskId ?? null,
    status: row.status || '',
    note: row.note || '',
    dueAt: row.dueAt || row.due_at || null,
    updatedAt: row.updatedAt || row.updated_at || null,
    updatedBy: row.updatedBy || row.updated_by || null,
    actor: row.actor || null,
    history: Array.isArray(row.history) ? row.history : [],
  };
}

function normalizeClientContactPatch(patch) {
  const out = {};
  if (Object.prototype.hasOwnProperty.call(patch || {}, 'status')) out.status = patch.status || '';
  if (Object.prototype.hasOwnProperty.call(patch || {}, 'note')) out.note = patch.note || '';
  if (Object.prototype.hasOwnProperty.call(patch || {}, 'due_at')) out.dueAt = patch.due_at || null;
  if (Object.prototype.hasOwnProperty.call(patch || {}, 'dueAt')) out.dueAt = patch.dueAt || null;
  return out;
}

function normalizeClientContactsPayload(payload) {
  const rawContacts = payload?.contacts || payload || {};
  if (!rawContacts || typeof rawContacts !== 'object' || Array.isArray(rawContacts)) return {};
  return Object.entries(rawContacts).reduce((acc, [taskId, row]) => {
    const normalized = normalizeClientContact(row);
    if (normalized.status || normalized.note || normalized.updatedAt) {
      acc[String(taskId)] = normalized;
    }
    return acc;
  }, {});
}

function normalizeClosureDecisionItem(item) {
  return {
    key: item?.key || '',
    label: item?.label || '',
    detail: item?.detail || '',
    required: Boolean(item?.required),
  };
}

function normalizeClosureDecisionEvent(row) {
  if (!row || typeof row !== 'object') return null;
  const taskId = row.task_id ?? row.taskId;
  if (!taskId) return null;
  return {
    id: row.id || `${taskId}-${row.created_at || Date.now()}-${row.action || 'event'}`,
    task_id: Number(taskId),
    action: row.action || '',
    severity: row.severity || '',
    status_before: row.status_before || row.statusBefore || '',
    status_after: row.status_after || row.statusAfter || '',
    blockers: Array.isArray(row.blockers) ? row.blockers.map(normalizeClosureDecisionItem) : [],
    warnings: Array.isArray(row.warnings) ? row.warnings.map(normalizeClosureDecisionItem) : [],
    risk_score: Number(row.risk_score ?? row.riskScore) || 0,
    quality_score: Number(row.quality_score ?? row.qualityScore) || 0,
    value: Number(row.value) || 0,
    note: row.note || '',
    created_at: row.created_at || row.createdAt || null,
    created_by: row.created_by || row.createdBy || null,
    actor: row.actor || 'Operator',
  };
}

function normalizeClosureDecisionPayload(payload) {
  const rawEvents = payload?.events || payload || {};
  if (!rawEvents || typeof rawEvents !== 'object') return {};
  if (Array.isArray(rawEvents)) {
    return rawEvents.reduce((acc, row) => {
      const event = normalizeClosureDecisionEvent(row);
      if (!event) return acc;
      const key = String(event.task_id);
      acc[key] = [event, ...(acc[key] || [])].slice(0, 30);
      return acc;
    }, {});
  }
  return Object.entries(rawEvents).reduce((acc, [taskId, rows]) => {
    const list = Array.isArray(rows) ? rows : [];
    acc[String(taskId)] = list.map(normalizeClosureDecisionEvent).filter(Boolean).slice(0, 30);
    return acc;
  }, {});
}

function closureActionLabel(action) {
  const labels = {
    blocked_attempt: 'Zatrzymano zamknięcie',
    warning_review: 'Kontrola z uwagami',
    forced_close: 'Zamknięto mimo uwag',
    clean_close: 'Zamknięto bez blokad',
    fix_started: 'Wrócono do poprawy',
  };
  return labels[action] || 'Decyzja operatora';
}

function buildClosureAuditSummary(eventsByTask, tasks = []) {
  const taskMap = new Map(tasks.map((task) => [String(task.id), task]));
  const rows = Object.entries(eventsByTask || {}).flatMap(([taskId, events]) =>
    (Array.isArray(events) ? events : []).map((event) => {
      const task = taskMap.get(String(event.task_id || taskId)) || null;
      return {
        event,
        task,
        value: Number(event.value) || Number(task?.wartosc_planowana) || 0,
      };
    })
  );

  rows.sort((a, b) => {
    const aTime = new Date(a.event.created_at || 0).getTime() || 0;
    const bTime = new Date(b.event.created_at || 0).getTime() || 0;
    return bTime - aTime;
  });

  const stats = {
    total: rows.length,
    blocked: 0,
    warningReviews: 0,
    forced: 0,
    clean: 0,
    fixes: 0,
    reviewedValue: 0,
    blockedValue: 0,
  };
  const issueMap = new Map();
  const actorMap = new Map();

  rows.forEach(({ event, value }) => {
    stats.reviewedValue += value;
    if (event.action === 'blocked_attempt') {
      stats.blocked += 1;
      stats.blockedValue += value;
    } else if (event.action === 'warning_review') {
      stats.warningReviews += 1;
    } else if (event.action === 'forced_close') {
      stats.forced += 1;
    } else if (event.action === 'clean_close') {
      stats.clean += 1;
    } else if (event.action === 'fix_started') {
      stats.fixes += 1;
    }

    const actor = event.actor || 'Operator';
    const actorStats = actorMap.get(actor) || { actor, count: 0, blocked: 0, forced: 0, fixes: 0 };
    actorStats.count += 1;
    if (event.action === 'blocked_attempt') actorStats.blocked += 1;
    if (event.action === 'forced_close') actorStats.forced += 1;
    if (event.action === 'fix_started') actorStats.fixes += 1;
    actorMap.set(actor, actorStats);

    [
      ...(event.blockers || []).map((item) => ({ item, type: 'blocker' })),
      ...(event.warnings || []).map((item) => ({ item, type: 'warning' })),
    ].forEach(({ item, type }) => {
      const label = item.label || item.key || 'Nieopisany warunek';
      const key = item.key || label;
      const current = issueMap.get(key) || {
        key,
        label,
        count: 0,
        blockers: 0,
        warnings: 0,
        value: 0,
        taskIds: new Set(),
      };
      current.count += 1;
      current.value += value;
      current.taskIds.add(String(event.task_id));
      if (type === 'blocker') current.blockers += 1;
      else current.warnings += 1;
      issueMap.set(key, current);
    });
  });

  const topIssues = Array.from(issueMap.values())
    .map((issue) => ({ ...issue, taskIds: Array.from(issue.taskIds || []) }))
    .sort((a, b) => b.count - a.count || b.value - a.value)
    .slice(0, 5);
  const topActors = Array.from(actorMap.values())
    .sort((a, b) => b.count - a.count || b.blocked - a.blocked)
    .slice(0, 4);

  let health = 'good';
  let healthLabel = 'Czysto';
  if (!stats.total) {
    health = 'warning';
    healthLabel = 'Czeka na dane';
  } else if (stats.forced > 0) {
    health = 'danger';
    healthLabel = 'Wymuszenia do przeglądu';
  } else if (stats.blocked > 0) {
    health = 'warning';
    healthLabel = 'Strażnik działa';
  }

  return {
    ...stats,
    rows,
    topIssues,
    topActors,
    recent: rows.slice(0, 6),
    health,
    healthLabel,
  };
}

function getClosureEventDecisionItems(event) {
  return [
    ...(event?.blockers || []),
    ...(event?.warnings || []),
  ].filter((item) => item?.key || item?.label);
}

function getClosureIssueKey(item) {
  return item?.key || item?.label || '';
}

function buildClosureRepairQueue(rows, issueKey = '') {
  const seen = new Set();
  const queue = [];
  (rows || []).forEach(({ event, task, value }) => {
    if (!task || !event || seen.has(String(event.task_id))) return;
    const allItems = getClosureEventDecisionItems(event);
    if (!allItems.length) return;
    const matchingItems = issueKey
      ? allItems.filter((item) => getClosureIssueKey(item) === issueKey)
      : allItems;
    if (!matchingItems.length) return;
    seen.add(String(event.task_id));
    queue.push({
      event,
      task,
      value,
      items: matchingItems.slice(0, 3),
    });
  });
  return queue.slice(0, 4);
}

function getClientMessageStatusLine(task, planned) {
  if (task.status === TASK_STATUS.WYCENA_TERENOWA) {
    return `Oględziny i wycena są zaplanowane${planned ? ` na ${planned}` : ''}.`;
  }
  if (task.status === TASK_STATUS.DO_ZATWIERDZENIA) {
    return 'Zakres prac wrócił do biura do finalnego zatwierdzenia.';
  }
  if (task.status === TASK_STATUS.ZAPLANOWANE) {
    return `Zlecenie jest zaplanowane${planned ? ` na ${planned}` : ''}.`;
  }
  if (isTaskInProgress(task.status)) return 'Ekipa jest w trakcie realizacji prac.';
  if (isTaskDone(task.status)) return 'Prace zostały oznaczone jako zakończone.';
  if (task.status === TASK_STATUS.ANULOWANE) return 'Zlecenie zostało anulowane.';
  return 'Potwierdzamy przyjęcie zgłoszenia.';
}

function getClientMessageNextStep(task, diagnostics) {
  if (isTaskDone(task.status)) {
    return 'Dziękujemy za współpracę. W razie uwag prosimy o kontakt.';
  }
  if (task.status === TASK_STATUS.ANULOWANE) return 'W razie pytań prosimy o kontakt z biurem.';
  if (diagnostics.has.noDate) return 'Skontaktujemy się, żeby potwierdzić dogodny termin.';
  if (diagnostics.has.noContact) return 'Prosimy o potwierdzenie numeru kontaktowego w odpowiedzi.';
  if (diagnostics.has.overdue) return 'Potwierdzimy najbliższe dostępne okno prac.';
  if (task.status === TASK_STATUS.WYCENA_TERENOWA) return 'Wyceniający przygotuje zdjęcia, zakres i propozycję ceny.';
  if (task.status === TASK_STATUS.DO_ZATWIERDZENIA) return 'Biuro dopina ekipę, godzinę i potwierdzenie prac.';
  if (task.status === TASK_STATUS.ZAPLANOWANE) return 'Przed przyjazdem potwierdzimy szczegóły organizacyjne.';
  if (isTaskInProgress(task.status)) return 'Po zakończeniu przekażemy podsumowanie prac.';
  return 'W razie pytań prosimy o kontakt z biurem.';
}
 
export default function Zlecenia() {
  const { t } = useTranslation();
  const taskPhotoInputRef = useRef(null);
  const quickCallRef = useRef(null);
  const quickCallClientInputRef = useRef(null);
  const [zlecenia, setZlecenia] = useState([]);
  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState(null);
  const [ekipy, setEkipy] = useState([]);
  const [uzytkownicy, setUzytkownicy] = useState([]);
  const [sprzetItems, setSprzetItems] = useState([]);
  const [tryb, setTryb] = useState(() => {
    const v = localStorage.getItem(VIEW_MODE_KEY) || 'lista';
    return ZLECENIA_TRYBY.has(v) ? v : 'lista';
  });
  const [wybraneZlecenie, setWybraneZlecenie] = useState(null);
  const [form, setForm] = useState(PUSTY_FORMULARZ);
  const [filtrStatus, setFiltrStatus] = useState('');
  const [filtrTyp, setFiltrTyp] = useState('');
  const [filtrOddzial, setFiltrOddzial] = useState('');
  const [filtrEkipa, setFiltrEkipa] = useState('');
  const [szukaj, setSzukaj] = useState('');
  const [smartFilter, setSmartFilter] = useState(() => localStorage.getItem(SMART_FILTER_KEY) || '');
  const [sortMode, setSortMode] = useState(() => {
    const stored = localStorage.getItem(TASK_SORT_KEY) || 'risk';
    return TASK_SORT_KEYS.has(stored) ? stored : 'risk';
  });
  const [komunikat, setKomunikat] = useState({ tekst: '', typ: '' });
  const [copyFallback, setCopyFallback] = useState(null);
  const [potwierdzUsuniecie, setPotwierdzUsuniecie] = useState(null);
  const [formStep, setFormStep] = useState('client');
  const [taskPhotosById, setTaskPhotosById] = useState({});
  const [taskProblemsById, setTaskProblemsById] = useState({});
  const [taskPhotosLoading, setTaskPhotosLoading] = useState(false);
  const [uploadingTaskPhoto, setUploadingTaskPhoto] = useState(false);
  const [taskPhotoDraft, setTaskPhotoDraft] = useState({
    typ: 'Wycena',
    opis: '',
    tagi: 'wycena, teren',
  });
  const [closeGuard, setCloseGuard] = useState(null);
  const [selectedTaskIds, setSelectedTaskIds] = useState([]);
  const [activeClosureIssueKey, setActiveClosureIssueKey] = useState('');
  const [draggedTaskId, setDraggedTaskId] = useState(null);
  const [statusUpdatingId, setStatusUpdatingId] = useState(null);
  const [showWorkflowPanel, setShowWorkflowPanel] = useState(false);
  const [clientContacts, setClientContacts] = useState(() =>
    normalizeClientContactsPayload(getLocalStorageJson(CLIENT_CONTACT_KEY, {}))
  );
  const [closureDecisionEvents, setClosureDecisionEvents] = useState(() =>
    normalizeClosureDecisionPayload(getLocalStorageJson(CLOSURE_DECISION_KEY, {}))
  );
  const [contactDraft, setContactDraft] = useState('');
  const [contactDueDraft, setContactDueDraft] = useState('');
  const [officePlan, setOfficePlan] = useState(OFFICE_PLAN_DEFAULTS);
  const [officePlanSaving, setOfficePlanSaving] = useState(false);
  const [quickCall, setQuickCall] = useState(QUICK_CALL_DEFAULTS);
  const [quickCallSaving, setQuickCallSaving] = useState(false);
  const [quickCallFocused, setQuickCallFocused] = useState(false);
  const [crewIssueDraft, setCrewIssueDraft] = useState({ typ: 'inne', opis: '' });
  const [crewIssueSaving, setCrewIssueSaving] = useState(false);
  const [commandTab, setCommandTab] = useState('dispatch');
  const [showAdvancedOps, setShowAdvancedOps] = useState(false);
  const [workflowConfig, setWorkflowConfig] = useState(() => {
    const parsed = getLocalStorageJson(WORKFLOW_CONFIG_KEY, {});
    return { ...DEFAULT_WORKFLOW_CONFIG, ...parsed };
  });
  const navigate = useNavigate();
  const location = useLocation();
 
  const isDyrektor = ['Prezes', 'Dyrektor'].includes(currentUser?.rola);
  const isAdmin = currentUser?.rola === 'Administrator';
  const canManageAllBranches = isDyrektor || isAdmin;
  const isKierownik = currentUser?.rola === 'Kierownik';
  const isSpecjalista = currentUser?.rola === 'Specjalista';
  const isWyceniajacy = currentUser?.rola === 'Wyceniający' || currentUser?.rola === 'Wyceniajacy';
  const mozeTworzyc = canManageAllBranches || isKierownik || isSpecjalista || isWyceniajacy;
  const mozeEdytowac = canManageAllBranches || isKierownik || isSpecjalista || isWyceniajacy;
  const mozePlanowacBiuro = canManageAllBranches || isKierownik || isSpecjalista;
  const mozeUsuwac = canManageAllBranches;
  const mozePrzesuwacStatus = canManageAllBranches || isKierownik;
  const mozeObslugiwacRealizacje = mozePrzesuwacStatus || String(currentUser?.rola || '').toLowerCase().includes('bryg');

  useEffect(() => {
    localStorage.setItem(VIEW_MODE_KEY, tryb);
  }, [tryb]);

  useEffect(() => {
    localStorage.setItem(WORKFLOW_CONFIG_KEY, JSON.stringify(workflowConfig));
  }, [workflowConfig]);

  useEffect(() => {
    if (smartFilter) localStorage.setItem(SMART_FILTER_KEY, smartFilter);
    else localStorage.removeItem(SMART_FILTER_KEY);
  }, [smartFilter]);

  useEffect(() => {
    const query = new URLSearchParams(location.search).get('search') || '';
    if (!query) return;
    setSzukaj(query);
    setTryb('lista');
    setSmartFilter('');
    setFiltrStatus('');
    setFiltrTyp('');
    setFiltrOddzial('');
    setFiltrEkipa('');
  }, [location.search]);

  useEffect(() => {
    const focus = new URLSearchParams(location.search).get('focus') || '';
    if (focus !== 'telefon' || !mozeTworzyc) return undefined;
    setTryb('lista');
    setSmartFilter('');
    setFiltrStatus('');
    setQuickCallFocused(true);
    const focusPanelTimer = window.setTimeout(() => {
      quickCallRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      quickCallClientInputRef.current?.focus({ preventScroll: true });
    }, 120);
    const focusTimer = window.setTimeout(() => setQuickCallFocused(false), 2400);
    return () => {
      window.clearTimeout(focusPanelTimer);
      window.clearTimeout(focusTimer);
    };
  }, [location.search, mozeTworzyc]);

  useEffect(() => {
    localStorage.setItem(TASK_SORT_KEY, TASK_SORT_KEYS.has(sortMode) ? sortMode : 'risk');
  }, [sortMode]);

  useEffect(() => {
    localStorage.setItem(CLIENT_CONTACT_KEY, JSON.stringify(clientContacts));
  }, [clientContacts]);

  useEffect(() => {
    localStorage.setItem(CLOSURE_DECISION_KEY, JSON.stringify(closureDecisionEvents));
  }, [closureDecisionEvents]);
 
  useEffect(() => {
    const parsedUser = getLocalStorageJson('user');
    if (!parsedUser) { navigate('/'); return; }
    setCurrentUser(parsedUser);
    loadData(parsedUser);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!ZLECENIA_TRYBY.has(tryb)) setTryb('lista');
  }, [tryb]);

  useEffect(() => {
    if (tryb === 'szczegoly' && !wybraneZlecenie) setTryb('lista');
    if (tryb === 'edytuj' && !wybraneZlecenie) setTryb('lista');
  }, [tryb, wybraneZlecenie]);

  useEffect(() => {
    if (!currentUser?.oddzial_id) return;
    setQuickCall((prev) => ({
      ...prev,
      oddzial_id: prev.oddzial_id || String(currentUser.oddzial_id),
      wyceniajacy_id: isWyceniajacy ? (prev.wyceniajacy_id || String(currentUser.id || '')) : prev.wyceniajacy_id,
    }));
  }, [currentUser?.id, currentUser?.oddzial_id, isWyceniajacy]);

  useEffect(() => {
    if (!wybraneZlecenie?.id) {
      setContactDraft('');
      setOfficePlan(OFFICE_PLAN_DEFAULTS);
      setCrewIssueDraft({ typ: 'inne', opis: '' });
      return;
    }
    setContactDraft(clientContacts[String(wybraneZlecenie.id)]?.note || '');
    setContactDueDraft(toDatetimeLocalValue(clientContacts[String(wybraneZlecenie.id)]?.dueAt));
    setCrewIssueDraft({ typ: 'inne', opis: '' });
  }, [wybraneZlecenie?.id, clientContacts]);

  useEffect(() => {
    if (!wybraneZlecenie?.id) {
      setOfficePlan(OFFICE_PLAN_DEFAULTS);
      return;
    }
    const rawDate = String(wybraneZlecenie.data_planowana || '');
    const datePart = rawDate ? rawDate.slice(0, 10) : '';
    const timePart = wybraneZlecenie.godzina_rozpoczecia || (rawDate.includes('T') ? rawDate.split('T')[1]?.slice(0, 5) : '') || '08:00';
    setOfficePlan({
      data_planowana: datePart,
      godzina_rozpoczecia: timePart,
      czas_planowany_godziny: String(wybraneZlecenie.czas_planowany_godziny || wybraneZlecenie.czas_realizacji_godz || '2'),
      ekipa_id: wybraneZlecenie.ekipa_id ? String(wybraneZlecenie.ekipa_id) : '',
      sprzet_notatka: '',
      sprzet_ids: [],
    });
  }, [
    wybraneZlecenie?.id,
    wybraneZlecenie?.data_planowana,
    wybraneZlecenie?.godzina_rozpoczecia,
    wybraneZlecenie?.czas_planowany_godziny,
    wybraneZlecenie?.czas_realizacji_godz,
    wybraneZlecenie?.ekipa_id,
  ]);
 
  const loadData = async (user) => {
    try {
      const token = getStoredToken();
      const h = authHeaders(token);
      const rola = user?.rola;
      const canLoadAllTasks = [
        'Prezes',
        'Dyrektor',
        'Administrator',
        'Dyrektor Sprzedazy',
        'Dyrektor Sprzedaży',
        'Dyrektor dzialu sprzedaz',
        'Dyrektor działu sprzedaż',
      ].includes(rola);
      const endpoint = canLoadAllTasks ? `/tasks/wszystkie` : `/tasks`;
      const [zRes, eRes, uRes, equipmentRes, contactRes, closureRes] = await Promise.all([
        api.get(endpoint, { headers: h }),
        api.get(`/ekipy`, { headers: h }),
        api.get(`/uzytkownicy`, { headers: h }),
        api.get('/flota/sprzet', { headers: h }).catch(() => ({ data: [] })),
        api.get('/tasks/client-contacts', { headers: h }).catch(() => ({ data: null })),
        api.get('/tasks/closure-events', { headers: h }).catch(() => ({ data: null })),
      ]);
      setZlecenia(Array.isArray(zRes.data) ? zRes.data : []);
      setEkipy(Array.isArray(eRes.data) ? eRes.data : []);
      setUzytkownicy(Array.isArray(uRes.data) ? uRes.data : []);
      setSprzetItems(Array.isArray(equipmentRes.data) ? equipmentRes.data : (equipmentRes.data?.items || []));
      if (contactRes.data) {
        setClientContacts(normalizeClientContactsPayload(contactRes.data));
      }
      if (closureRes.data) {
        setClosureDecisionEvents(normalizeClosureDecisionPayload(closureRes.data));
      }
    } catch (err) {
      pokazKomunikat(getApiErrorMessage(err, 'Błąd ładowania danych'), 'error');
    } finally {
      setLoading(false);
    }
  };
 
  const pokazKomunikat = (tekst, typ = 'success') => {
    setKomunikat({ tekst, typ });
    setTimeout(() => setKomunikat({ tekst: '', typ: '' }), 4000);
  };

  const loadTaskPhotos = async (taskId, options = {}) => {
    if (!taskId) return [];
    setTaskPhotosLoading(true);
    try {
      const token = getStoredToken();
      const { data } = await api.get(`/tasks/${taskId}/zdjecia`, { headers: authHeaders(token), dedupe: false });
      const rows = Array.isArray(data) ? data : [];
      setTaskPhotosById((prev) => ({ ...prev, [String(taskId)]: rows }));
      return rows;
    } catch (err) {
      if (!options.silent) pokazKomunikat(getApiErrorMessage(err, 'Nie udało się pobrać zdjęć zlecenia'), 'error');
      return [];
    } finally {
      setTaskPhotosLoading(false);
    }
  };

  const loadTaskProblems = async (taskId, options = {}) => {
    if (!taskId) return [];
    try {
      const token = getStoredToken();
      const { data } = await api.get(`/tasks/${taskId}/problemy`, { headers: authHeaders(token), dedupe: false });
      const rows = Array.isArray(data) ? data : [];
      setTaskProblemsById((prev) => ({ ...prev, [String(taskId)]: rows }));
      return rows;
    } catch (err) {
      if (!options.silent) pokazKomunikat(getApiErrorMessage(err, 'Nie udalo sie pobrac problemow zlecenia'), 'error');
      return [];
    }
  };

  const reportCrewIssue = async () => {
    const taskId = wybraneZlecenie?.id;
    if (!taskId) return;
    const opis = String(crewIssueDraft.opis || '').trim();
    if (!opis) {
      pokazKomunikat('Opisz problem przed wyslaniem.', 'error');
      return;
    }
    setCrewIssueSaving(true);
    try {
      const token = getStoredToken();
      await api.post(
        `/tasks/${taskId}/problemy`,
        { typ: crewIssueDraft.typ || 'inne', opis },
        { headers: authHeaders(token) }
      );
      await loadTaskProblems(taskId, { silent: true });
      setCrewIssueDraft({ typ: 'inne', opis: '' });
      pokazKomunikat(`Problem zgloszony dla zlecenia #${taskId}.`);
    } catch (err) {
      pokazKomunikat(getApiErrorMessage(err, 'Nie udalo sie zglosic problemu'), 'error');
    } finally {
      setCrewIssueSaving(false);
    }
  };

  const uploadTaskPhotos = async (files) => {
    const taskId = wybraneZlecenie?.id;
    const list = Array.from(files || []).filter(Boolean);
    if (taskPhotoInputRef.current) taskPhotoInputRef.current.value = '';
    if (!taskId) {
      pokazKomunikat('Najpierw zapisz draft zlecenia, potem dodaj zdjęcia.', 'error');
      return;
    }
    if (!list.length) return;
    setUploadingTaskPhoto(true);
    try {
      const token = getStoredToken();
      for (const file of list) {
        const formData = new FormData();
        formData.append('zdjecie', file);
        formData.append('typ', taskPhotoDraft.typ || 'Wycena');
        const opis = String(taskPhotoDraft.opis || '').trim();
        const tagi = String(taskPhotoDraft.tagi || '').trim();
        if (opis) formData.append('opis', opis);
        if (tagi) formData.append('tagi', tagi);
        await api.post(`/tasks/${taskId}/zdjecia`, formData, { headers: authHeaders(token) });
      }
      await loadTaskPhotos(taskId, { silent: true });
      pokazKomunikat(`Dodano zdjęcia: ${list.length}`);
      setTaskPhotoDraft((prev) => ({ ...prev, opis: '' }));
    } catch (err) {
      pokazKomunikat(getApiErrorMessage(err, 'Nie udało się dodać zdjęć'), 'error');
    } finally {
      setUploadingTaskPhoto(false);
    }
  };

  const deleteTaskPhoto = async (photoId) => {
    const taskId = wybraneZlecenie?.id;
    if (!taskId || !photoId) return;
    try {
      const token = getStoredToken();
      await api.delete(`/tasks/${taskId}/zdjecia/${photoId}`, { headers: authHeaders(token) });
      await loadTaskPhotos(taskId, { silent: true });
      pokazKomunikat('Zdjęcie usunięte');
    } catch (err) {
      pokazKomunikat(getApiErrorMessage(err, 'Nie udało się usunąć zdjęcia'), 'error');
    }
  };

  const openTaskDraw = () => {
    const taskId = wybraneZlecenie?.id;
    if (!taskId) {
      pokazKomunikat('Najpierw zapisz draft zlecenia, potem otwórz rysowanie.', 'error');
      return;
    }
    navigate(`/wycena-rysuj?taskId=${encodeURIComponent(taskId)}&photoKind=${encodeURIComponent(taskPhotoDraft.typ || 'Szkic')}`);
  };

  const setField = (field, value) => setForm(prev => ({ ...prev, [field]: value }));

  const applyScopePreset = (preset) => {
    setForm((prev) => ({
      ...prev,
      typ_uslugi: preset.serviceType || prev.typ_uslugi,
      opis_pracy: appendUniqueLine(prev.opis_pracy, preset.scopeLine),
    }));
  };

  const toggleEquipmentPreset = (preset) => {
    if (!preset.field) return;
    setForm((prev) => ({ ...prev, [preset.field]: !prev[preset.field] }));
  };

  const appendRiskPreset = (preset) => {
    setForm((prev) => ({
      ...prev,
      notatki: appendUniqueLine(prev.notatki, preset.note),
      notatki_wewnetrzne: appendUniqueLine(prev.notatki_wewnetrzne, preset.note),
    }));
  };

  const applySettlementPreset = (preset) => {
    setForm((prev) => ({
      ...prev,
      notatki: appendUniqueLine(prev.notatki, preset.note),
      notatki_wewnetrzne: appendUniqueLine(prev.notatki_wewnetrzne, preset.note),
    }));
  };

  const handleFormStatusChange = (nextStatus) => {
    setField('status', nextStatus);
    if (tryb === 'nowy' || nextStatus !== TASK_STATUS.ZAKONCZONE || isTaskDone(wybraneZlecenie?.status)) return;
    const projectedTask = {
      ...(wybraneZlecenie || {}),
      ...form,
      status: nextStatus,
      id: wybraneZlecenie?.id,
      ekipa_nazwa: ekipy.find((ekipa) => String(ekipa.id) === String(form.ekipa_id))?.nazwa || wybraneZlecenie?.ekipa_nazwa,
    };
    const guard = buildTaskClosureGuard(projectedTask, todayIso, getClientContact(projectedTask.id));
    if (guard.shouldPause) {
      const formGuard = { ...guard, status_before: wybraneZlecenie?.status || form.status };
      recordClosureDecision(formGuard, formGuard.blockers.length ? 'blocked_attempt' : 'warning_review');
      setCloseGuard({ ...formGuard, mode: 'form' });
    }
  };
 
  const otworzNowe = () => {
    setForm(createTaskFormDefaults({
      status: isWyceniajacy ? TASK_STATUS.WYCENA_TERENOWA : TASK_STATUS.NOWE,
      oddzial_id: currentUser?.oddzial_id || '',
      wyceniajacy_id: isWyceniajacy ? currentUser?.id || '' : '',
    }));
    setWybraneZlecenie(null);
    setFormStep('client');
    setTaskPhotoDraft({ typ: 'Wycena', opis: '', tagi: 'wycena, teren' });
    setTryb('nowy');
  };

  const setQuickCallField = (field, value) => {
    setQuickCall((prev) => ({
      ...prev,
      [field]: value,
      ...(field === 'oddzial_id' ? { wyceniajacy_id: '' } : {}),
    }));
  };

  const utworzOgledzinyZTelefonu = async () => {
    const missing = [];
    if (!String(quickCall.klient_nazwa || '').trim()) missing.push('klient');
    if (!String(quickCall.klient_telefon || '').trim()) missing.push('telefon');
    if (!String(quickCall.adres || '').trim()) missing.push('adres');
    if (!String(quickCall.miasto || '').trim()) missing.push('miasto');
    if (!String(quickCall.data_planowana || '').trim()) missing.push('data oględzin');
    if (!String(quickCall.wyceniajacy_id || '').trim()) missing.push('wyceniacz');
    if (canManageAllBranches && !String(quickCall.oddzial_id || '').trim()) missing.push('oddział');
    if (missing.length) {
      pokazKomunikat(`Telefon do biura: uzupełnij ${missing.join(', ')}`, 'error');
      return false;
    }
    setQuickCallSaving(true);
    try {
      const token = getStoredToken();
      const h = authHeaders(token);
      const payload = buildTaskCreatePayload(
        createTaskFormDefaults({
          ...quickCall,
          status: TASK_STATUS.WYCENA_TERENOWA,
          typ_uslugi: 'Wycinka',
          opis_pracy: appendUniqueLine(
            quickCall.opis_pracy,
            'Źródło: telefon do biura. Cel: oględziny u klienta i pakiet zdjęć dla biura.',
          ),
          notatki_wewnetrzne: appendUniqueLine(
            quickCall.opis_pracy,
            `Telefon przyjął: ${[currentUser?.imie, currentUser?.nazwisko].filter(Boolean).join(' ') || currentUser?.login || 'biuro'}`,
          ),
          ankieta_uproszczona: true,
        }),
        currentUser,
        {
          initialStatus: TASK_STATUS.WYCENA_TERENOWA,
          extra: { source: 'office_call_intake' },
        },
      );
      const { data } = await api.post('/tasks/nowe', payload, { headers: h });
      const created = data && typeof data === 'object' ? data : {};
      pokazKomunikat(`Oględziny utworzone i wysłane do wyceniacza${created.id ? ` (#${created.id})` : ''}`);
      setSmartFilter('fieldInspection');
      setFiltrStatus('');
      setSzukaj('');
      setQuickCall({
        ...QUICK_CALL_DEFAULTS,
        oddzial_id: quickCall.oddzial_id || currentUser?.oddzial_id || '',
        godzina_rozpoczecia: quickCall.godzina_rozpoczecia || '',
      });
      await loadData(currentUser);
      return true;
    } catch (err) {
      pokazKomunikat(getApiErrorMessage(err, 'Nie udało się utworzyć oględzin z telefonu'), 'error');
      return false;
    } finally {
      setQuickCallSaving(false);
    }
  };
 
  const otworzSzczegoly = (z) => {
    setWybraneZlecenie(z);
    setTryb('szczegoly');
    if (z?.id) {
      loadTaskPhotos(z.id, { silent: true });
      loadTaskProblems(z.id, { silent: true });
    }
  };
 
  const otworzEdycje = (z, step = 'client') => {
    setForm({
      klient_nazwa: z.klient_nazwa || '', klient_telefon: z.klient_telefon || '',
      klient_email: z.klient_email || '', adres: z.adres || '', miasto: z.miasto || '',
      typ_uslugi: z.typ_uslugi || TASK_SERVICE_TYPES[0], status: z.status || TASK_STATUS.NOWE,
      priorytet: z.priorytet || 'Normalny',
      data_planowana: z.data_planowana ? z.data_planowana.split('T')[0] : '',
      godzina_rozpoczecia: z.godzina_rozpoczecia || '',
      wartosc_planowana: z.wartosc_planowana || '', czas_planowany_godziny: z.czas_planowany_godziny || '',
      oddzial_id: z.oddzial_id || currentUser?.oddzial_id || '',
      ekipa_id: z.ekipa_id || '', kierownik_id: z.kierownik_id || '', wyceniajacy_id: z.wyceniajacy_id || '',
      opis_pracy: z.opis_pracy || '', opis: z.opis || '', notatki_wewnetrzne: z.notatki_wewnetrzne || '',
      wywoz: !!z.wywoz, usuwanie_pni: !!z.usuwanie_pni,
      czas_realizacji_godz: z.czas_realizacji_godz || '',
      rebak: !!z.rebak, pila_wysiegniku: !!z.pila_wysiegniku, nozyce_dlugie: !!z.nozyce_dlugie,
      kosiarka: !!z.kosiarka, podkaszarka: !!z.podkaszarka, lopata: !!z.lopata, mulczer: !!z.mulczer,
      ilosc_osob: z.ilosc_osob || '', arborysta: !!z.arborysta,
      wynik: z.wynik || '', budzet: z.budzet || '', rabat: z.rabat || '',
      kwota_minimalna: z.kwota_minimalna || '', zrebki: z.zrebki || '',
      drzewno: z.drzewno || '', notatki: z.notatki || '',
    });
    setWybraneZlecenie(z);
    setFormStep(FORM_STEP_KEYS.has(step) ? step : 'client');
    if (z?.id) {
      loadTaskPhotos(z.id, { silent: true });
      loadTaskProblems(z.id, { silent: true });
    }
    setTryb('edytuj');
  };

  const buildTaskFromForm = () => ({
    ...(wybraneZlecenie || {}),
    ...form,
    id: wybraneZlecenie?.id,
    ekipa_nazwa: ekipy.find((ekipa) => String(ekipa.id) === String(form.ekipa_id))?.nazwa || wybraneZlecenie?.ekipa_nazwa,
  });
 
  const zapiszZlecenie = async (options = {}) => {
    if (tryb === 'nowy') {
      const missing = getTaskCreateMissingFields(form, { requireBranch: canManageAllBranches });
      if (missing.length) {
        const firstMissing = missing[0];
        setFormStep(TASK_CREATE_FIELD_STEPS[firstMissing] || 'client');
        pokazKomunikat(
          `Uzupełnij: ${missing.map((field) => TASK_CREATE_FIELD_LABELS[field] || field).join(', ')}`,
          'error'
        );
        return false;
      }
    } else if (!form.klient_nazwa) {
      pokazKomunikat('Podaj nazwę klienta', 'error');
      return false;
    }
    const closesTask = tryb !== 'nowy' && form.status === TASK_STATUS.ZAKONCZONE && !isTaskDone(wybraneZlecenie?.status);
    let closureGuardForSave = null;
    if (closesTask && !options.forceClose) {
      const projectedTask = buildTaskFromForm();
      const guard = buildTaskClosureGuard(projectedTask, todayIso, getClientContact(projectedTask.id));
      if (guard.shouldPause) {
        const formGuard = { ...guard, status_before: wybraneZlecenie?.status || form.status };
        recordClosureDecision(formGuard, formGuard.blockers.length ? 'blocked_attempt' : 'warning_review');
        setCloseGuard({ ...formGuard, mode: 'form' });
        return false;
      }
      closureGuardForSave = { ...guard, status_before: wybraneZlecenie?.status || form.status };
    } else if (closesTask && options.guard) {
      closureGuardForSave = options.guard;
    }
    try {
      const token = getStoredToken();
      const h = authHeaders(token);
      let savedTask = null;
      if (tryb === 'nowy') {
        const initialStatus = form.wyceniajacy_id && form.status === TASK_STATUS.NOWE
          ? TASK_STATUS.WYCENA_TERENOWA
          : form.status || TASK_STATUS.NOWE;
        const payload = buildTaskCreatePayload(form, currentUser, { initialStatus });
        const res = await api.post(`/tasks/nowe`, payload, { headers: h });
        const created = res.data || {};
        savedTask = {
          ...payload,
          ...created,
          id: created.id || payload.id,
          status: created.status || payload.status,
        };
        pokazKomunikat('Zlecenie zostało utworzone');
      } else {
        const res = await api.put(`/tasks/${wybraneZlecenie.id}`, form, { headers: h });
        savedTask = res.data || wybraneZlecenie;
        pokazKomunikat('Zlecenie zaktualizowane');
      }
      if (closesTask && closureGuardForSave) {
        await recordClosureDecision(
          closureGuardForSave,
          options.forceClose ? 'forced_close' : 'clean_close',
          options.forceClose ? 'Operator zamknął zlecenie mimo uwag.' : 'Zlecenie zamknięte bez blokad.'
        );
      }
      await loadData(currentUser);
      if (options.stayOpen && savedTask) {
        otworzEdycje(savedTask, options.nextStep || formStep);
        if (options.nextStep === 'media') await loadTaskPhotos(savedTask.id, { silent: true });
        return true;
      }
      setTryb('lista');
      return true;
    } catch (err) {
      pokazKomunikat(getApiErrorMessage(err, 'Błąd zapisu'), 'error');
      return false;
    }
  };

  const zapiszDraftIDodajZdjecia = async () => {
    await zapiszZlecenie({ stayOpen: true, nextStep: 'media' });
  };
 
  const usunZlecenie = async (id) => {
    try {
      const token = getStoredToken();
      await api.delete(`/tasks/${id}`, { headers: authHeaders(token) });
      pokazKomunikat('Zlecenie usunięte');
      setPotwierdzUsuniecie(null);
      setZlecenia(prev => prev.filter(z => z.id !== id));
      if (tryb === 'szczegoly') setTryb('lista');
    } catch (err) {
      pokazKomunikat(getApiErrorMessage(err, 'Błąd usuwania zlecenia'), 'error');
    }
  };

  const parseDateSafe = (value) => {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  };

  const getSlaFlags = (task) => {
    const now = new Date();
    const createdAt = parseDateSafe(task.created_at);
    const plannedAt = parseDateSafe(task.data_planowana);
    const isClosed = isTaskClosed(task.status);
    const flags = [];

    if (!isClosed && plannedAt && plannedAt < new Date(now.toDateString())) {
      flags.push('Przeterminowane');
    }
    if (!isClosed && createdAt) {
      const ageHours = (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60);
      if (ageHours >= 48) flags.push('48h+ bez zamknięcia');
    }
    return flags;
  };

  const slaFlagLabel = (flag) => {
    if (flag === '48h+ bez zamknięcia') return t('taskSla.stale48h');
    return t(`taskSla.${flag}`, { defaultValue: flag });
  };

  const smsTemplateForStatus = (status) => ({
    Zaplanowane: 'zaplanowane',
    W_Realizacji: 'w_drodze',
    Zakonczone: 'zakonczone',
  }[status] || null);

  const runStatusWorkflow = async (task, nextStatus) => {
    const token = getStoredToken();
    const headers = authHeaders(token);
    const workflowMessage = `Workflow: status "${task.status}" -> "${nextStatus}" dla zlecenia #${task.id}`;

    const notificationPayload = {
      typ: 'info',
      tresc: workflowMessage,
      task_id: task.id,
      do_kogo: 'Dyrektor',
    };

    const operations = [
    ];
    if (workflowConfig.logEnabled) {
      operations.push(
        api.post(`/tasks/${task.id}/logi`, { tresc: workflowMessage, status: nextStatus }, { headers })
      );
    }
    if (workflowConfig.notificationsEnabled) {
      operations.push(api.post('/notifications', notificationPayload, { headers }));
    }

    // 3) Przypomnienie po przejściu do zaplanowanych.
    if (workflowConfig.remindersEnabled && nextStatus === 'Zaplanowane') {
      operations.push(
        api.post(
          '/notifications',
          {
            typ: 'przypomnienie',
            tresc: `Sprawdź potwierdzenie terminu dla zlecenia #${task.id}.`,
            task_id: task.id,
            do_kogo: 'Kierownik',
          },
          { headers }
        )
      );
    }

    // 4) Opcjonalny SMS dla klienta (jeśli backend wspiera endpoint).
    const smsType = smsTemplateForStatus(nextStatus);
    if (workflowConfig.smsEnabled && smsType) {
      operations.push(api.post(`/sms/zlecenie/${task.id}`, { typ: smsType }, { headers }));
    }

    // Workflow jest "best effort": nie blokuje głównej zmiany statusu.
    if (operations.length > 0) {
      await Promise.allSettled(operations);
    }
  };

  const zmienStatusInline = async (taskId, nextStatus, options = {}) => {
    const task = zlecenia.find((z) => z.id === taskId);
    if (!task || task.status === nextStatus) return true;
    if (!canTransitionTaskStatus(task.status, nextStatus, { allowCancel: mozePrzesuwacStatus })) {
      pokazKomunikat(`Ten przeskok statusu jest zablokowany: ${task.status || 'brak'} -> ${nextStatus}.`, 'error');
      return false;
    }
    if (nextStatus === TASK_STATUS.W_REALIZACJI) {
      const inProgressCount = zlecenia.filter((z) => isTaskInProgress(z.status)).length;
      if (!isTaskInProgress(task.status) && inProgressCount >= 10) {
        pokazKomunikat('Limit WIP: maksymalnie 10 zleceń w realizacji.', 'error');
        return false;
      }
    }
    let closureGuardForStatus = null;
    if (nextStatus === TASK_STATUS.ZAKONCZONE && !options.forceClose) {
      const guard = buildTaskClosureGuard(task, todayIso, getClientContact(task.id));
      if (guard.shouldPause) {
        await recordClosureDecision(guard, guard.blockers.length ? 'blocked_attempt' : 'warning_review');
        setCloseGuard({ ...guard, mode: 'status' });
        return false;
      }
      closureGuardForStatus = guard;
    } else if (nextStatus === TASK_STATUS.ZAKONCZONE && options.guard) {
      closureGuardForStatus = options.guard;
    }
    setStatusUpdatingId(taskId);
    try {
      const token = getStoredToken();
      const { data } = await api.put(
        `/tasks/${taskId}/status`,
        { status: nextStatus },
        { headers: authHeaders(token) }
      );
      const updated = mergeTaskMutationResponse(task, data, { id: taskId, status: nextStatus });
      setZlecenia((prev) => prev.map((z) => (z.id === taskId ? mergeTaskMutationResponse(z, data, updated) : z)));
      if (wybraneZlecenie?.id === taskId) {
        setWybraneZlecenie((prev) => mergeTaskMutationResponse(prev, data, updated));
      }
      await runStatusWorkflow(task, nextStatus);
      if (nextStatus === TASK_STATUS.ZAKONCZONE && closureGuardForStatus) {
        await recordClosureDecision(
          closureGuardForStatus,
          options.forceClose ? 'forced_close' : 'clean_close',
          options.forceClose ? 'Operator zamknął zlecenie mimo uwag.' : 'Zlecenie zamknięte bez blokad.'
        );
      }
      pokazKomunikat(`Status zlecenia #${taskId} -> ${nextStatus}`);
      return true;
    } catch (err) {
      pokazKomunikat(getApiErrorMessage(err, 'Nie udało się zmienić statusu'), 'error');
      return false;
    } finally {
      setStatusUpdatingId(null);
    }
  };

  const setOfficePlanField = (field, value) => {
    setOfficePlan((prev) => ({ ...prev, [field]: value }));
  };

  const setOfficePlanEquipment = (selectedOptions) => {
    const ids = Array.from(selectedOptions || []).map((option) => option.value).filter(Boolean);
    setOfficePlan((prev) => ({ ...prev, sprzet_ids: ids }));
  };

  const zapiszPlanBiura = async () => {
    if (!wybraneZlecenie?.id) return false;
    const missing = [];
    if (!officePlan.data_planowana) missing.push('data');
    if (!officePlan.godzina_rozpoczecia) missing.push('godzina');
    if (!officePlan.czas_planowany_godziny) missing.push('czas');
    if (!officePlan.ekipa_id) missing.push('ekipa');
    if (missing.length) {
      pokazKomunikat(`Uzupełnij plan: ${missing.join(', ')}`, 'error');
      return false;
    }

    setOfficePlanSaving(true);
    try {
      const token = getStoredToken();
      const { data } = await api.put(`/tasks/${wybraneZlecenie.id}/office-plan`, officePlan, { headers: authHeaders(token) });
      const plannedTeam = ekipy.find((e) => String(e.id) === String(officePlan.ekipa_id));
      const updated = {
        ...wybraneZlecenie,
        ...(data && typeof data === 'object' ? data : {}),
        id: wybraneZlecenie.id,
        status: TASK_STATUS.ZAPLANOWANE,
        data_planowana: data?.data_planowana || officePlan.data_planowana,
        godzina_rozpoczecia: officePlan.godzina_rozpoczecia,
        czas_planowany_godziny: data?.czas_planowany_godziny || officePlan.czas_planowany_godziny,
        ekipa_id: data?.ekipa_id || officePlan.ekipa_id,
        ekipa_nazwa: data?.ekipa_nazwa || plannedTeam?.nazwa || wybraneZlecenie.ekipa_nazwa,
      };
      setWybraneZlecenie(updated);
      setZlecenia((prev) => prev.map((z) => (String(z.id) === String(updated.id) ? { ...z, ...updated } : z)));
      await loadData(currentUser);
      pokazKomunikat(data?.message || 'Zlecenie zaplanowane dla ekipy');
      return true;
    } catch (err) {
      pokazKomunikat(getApiErrorMessage(err, 'Nie udało się zaplanować zlecenia'), 'error');
      return false;
    } finally {
      setOfficePlanSaving(false);
    }
  };

  const toggleTaskSelection = (taskId) => {
    setSelectedTaskIds((prev) =>
      prev.includes(taskId) ? prev.filter((id) => id !== taskId) : [...prev, taskId]
    );
  };

  const toggleSelectAllVisible = () => {
    const visibleIds = widoczneZlecenia.map((z) => z.id);
    const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedTaskIds.includes(id));
    if (allSelected) {
      setSelectedTaskIds((prev) => prev.filter((id) => !visibleIds.includes(id)));
      return;
    }
    setSelectedTaskIds((prev) => [...new Set([...prev, ...visibleIds])]);
  };

  const bulkUpdateStatus = async (nextStatus) => {
    if (!selectedTaskIds.length) return;
    if (!window.confirm(`Zmienić status ${selectedTaskIds.length} zleceń na "${nextStatus}"?`)) return;

    const idsToUpdate = [...selectedTaskIds];
    for (const taskId of idsToUpdate) {
      // Sequential update keeps API load predictable and UX messages clear.
      // eslint-disable-next-line no-await-in-loop
      const updated = await zmienStatusInline(taskId, nextStatus);
      if (!updated && nextStatus === TASK_STATUS.ZAKONCZONE) break;
    }
    setSelectedTaskIds([]);
  };

  const getClientContact = (taskId) => clientContacts[String(taskId)] || {};

  const getOperatorName = () =>
    currentUser?.imie_nazwisko ||
    currentUser?.name ||
    currentUser?.login ||
    currentUser?.email ||
    'Operator';

  const buildClosureDecisionPayload = (guard, action, note = '') => ({
    action,
    severity: guard.blockers?.length ? 'danger' : guard.warnings?.length ? 'warning' : 'good',
    status_before: guard.status_before || guard.task?.status || '',
    status_after: action === 'forced_close' || action === 'clean_close' ? 'Zakonczone' : '',
    blockers: (guard.blockers || []).map(normalizeClosureDecisionItem),
    warnings: (guard.warnings || []).map(normalizeClosureDecisionItem),
    risk_score: guard.meta?.riskScore || 0,
    quality_score: guard.meta?.diagnostics?.score || 0,
    value: guard.meta?.value || 0,
    note,
  });

  const recordClosureDecision = async (guard, action, note = '') => {
    if (!guard?.task?.id) return null;
    const taskId = String(guard.task.id);
    const payload = buildClosureDecisionPayload(guard, action, note);
    const optimistic = normalizeClosureDecisionEvent({
      ...payload,
      id: `local-${Date.now()}-${action}`,
      task_id: guard.task.id,
      created_at: new Date().toISOString(),
      actor: getOperatorName(),
      created_by: currentUser?.id || null,
    });
    if (!optimistic) return null;
    setClosureDecisionEvents((prev) => ({
      ...prev,
      [taskId]: [optimistic, ...(prev[taskId] || [])].slice(0, 30),
    }));
    try {
      const token = getStoredToken();
      const res = await api.post(`/tasks/${guard.task.id}/closure-events`, payload, { headers: authHeaders(token) });
      const saved = normalizeClosureDecisionEvent(res.data);
      if (saved) {
        setClosureDecisionEvents((prev) => ({
          ...prev,
          [taskId]: [saved, ...(prev[taskId] || []).filter((event) => event.id !== optimistic.id)].slice(0, 30),
        }));
      }
      return saved || optimistic;
    } catch {
      return optimistic;
    }
  };

  const saveClientContact = async (task, patch, successMessage) => {
    if (!task?.id) return;
    const taskId = String(task.id);
    const updatedAt = new Date().toISOString();
    const optimisticPatch = normalizeClientContactPatch(patch);
    const optimistic = {
      ...(clientContacts[taskId] || {}),
      ...optimisticPatch,
      updatedAt,
      actor: getOperatorName(),
    };
    setClientContacts((prev) => ({ ...prev, [taskId]: optimistic }));

    try {
      const token = getStoredToken();
      const response = await api.patch(`/tasks/${task.id}/client-contact`, patch, { headers: authHeaders(token) });
      const normalized = normalizeClientContact(response.data);
      setClientContacts((prev) => ({
        ...prev,
        [taskId]: {
          ...optimistic,
          ...normalized,
          updatedAt: normalized.updatedAt || optimistic.updatedAt,
        },
      }));
      pokazKomunikat(successMessage || `Zapisano kontakt z klientem dla zlecenia #${task.id}.`);
    } catch {
      pokazKomunikat('API kontaktu jest niedostępne. Zapisano lokalnie w tej przeglądarce.', 'error');
    }
  };

  const markClientContactStatus = (task, status) => {
    const option = getClientContactOption(status);
    saveClientContact(task, { status }, `Kontakt z klientem: ${option.label}.`);
  };

  const saveContactNote = (task) => {
    saveClientContact(task, { note: contactDraft.trim() }, `Zapisano notatkę kontaktową dla zlecenia #${task.id}.`);
  };

  const markPreparedSms = (task) => {
    const existing = getClientContact(task.id);
    saveClientContact(
      task,
      {
        status: 'waiting',
        note: contactDraft.trim() || existing.note || 'Przygotowano wiadomość do klienta, oczekuje na odpowiedź.',
        due_at: existing.dueAt || getFollowupPresetIso(1),
      },
      `Oznaczono zlecenie #${task.id}: czeka na odpowiedź klienta.`
    );
  };

  const setContactDuePreset = (task, daysFromToday) => {
    const dueAt = getFollowupPresetIso(daysFromToday);
    setContactDueDraft(toDatetimeLocalValue(dueAt));
    saveClientContact(task, { due_at: dueAt }, `Ustawiono follow-up klienta dla zlecenia #${task.id}.`);
  };

  const saveContactDue = (task) => {
    const dueAt = datetimeLocalToIso(contactDueDraft);
    saveClientContact(task, { due_at: dueAt }, `Zapisano termin follow-upu dla zlecenia #${task.id}.`);
  };

  const clearContactDue = (task) => {
    setContactDueDraft('');
    saveClientContact(task, { due_at: null }, `Wyczyszczono termin follow-upu dla zlecenia #${task.id}.`);
  };

  const copyText = async (text, successMessage) => {
    if (!text) {
      pokazKomunikat('Brak danych do skopiowania.', 'error');
      return;
    }
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.left = '-9999px';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        textarea.remove();
      }
      setCopyFallback(null);
      pokazKomunikat(successMessage);
    } catch {
      setCopyFallback({ text, title: successMessage });
      pokazKomunikat('Schowek zablokowany przez przeglądarkę. Tekst jest gotowy poniżej.', 'error');
    }
  };

  const buildTaskBrief = (task, index, diagnostics = getTaskDiagnostics(task, todayIso)) => {
    const address = getTaskAddressLine(task) || 'brak adresu';
    const phone = task.klient_telefon || 'brak telefonu';
    const planned = formatTaskPlanLine(task);
    const blockers = diagnostics.items.length ? diagnostics.items.map((item) => item.label).join(', ') : 'brak';
    const mapUrl = getMapsHref(task);
    const equipment = getTaskEquipmentList(task);
    const description = getTaskCrewDescription(task);
    const risk = getTaskCrewRisk(task);
    const equipmentNote = getTaskCrewEquipmentNote(task);
    const photos = getTaskPhotoSummary(task);
    return [
      `${index ? `${index}. ` : ''}Zlecenie #${task.id}: ${task.klient_nazwa || 'bez klienta'}`,
      `Telefon: ${phone}`,
      `Adres: ${address}`,
      `Termin: ${planned}`,
      `Ekipa: ${task.ekipa_nazwa || (task.ekipa_id ? `#${task.ekipa_id}` : 'brak')}`,
      `Status: ${task.status || 'brak'}`,
      `Priorytet: ${task.priorytet || 'brak'} | Wartość: ${formatCurrency(task.wartosc_planowana)}`,
      description ? `Zakres: ${description}` : null,
      equipment.length || equipmentNote ? `Sprzet: ${[equipment.join(', '), equipmentNote].filter(Boolean).join(' | ')}` : null,
      risk ? `Ryzyka: ${risk}` : null,
      `Zdjecia: ${photos.total} razem, wycena/szkic: ${photos.fieldEvidence}`,
      `Blokery: ${blockers}`,
      `Następny ruch: ${diagnostics.nextAction.label}`,
      mapUrl ? `Mapa: ${mapUrl}` : null,
    ].filter(Boolean).join('\n');
  };

  const copyTaskBrief = (task, diagnostics = getTaskDiagnostics(task, todayIso)) => {
    copyText(buildTaskBrief(task, null, diagnostics), `Skopiowano brief zlecenia #${task.id}.`);
  };

  const buildClientMessage = (task, diagnostics = getTaskDiagnostics(task, todayIso)) => {
    const planned = task.data_planowana ? String(task.data_planowana).slice(0, 10) : '';
    const address = getTaskAddressLine(task);
    const service = task.typ_uslugi ? t(`serviceType.${task.typ_uslugi}`, { defaultValue: task.typ_uslugi }) : '';
    const mapUrl = getMapsHref(task);

    return [
      task.klient_nazwa ? `Dzień dobry, ${task.klient_nazwa}.` : 'Dzień dobry.',
      getClientMessageStatusLine(task, planned),
      service ? `Zakres: ${service}.` : null,
      planned ? `Termin: ${planned}.` : 'Termin: do potwierdzenia.',
      address ? `Adres: ${address}.` : null,
      getClientMessageNextStep(task, diagnostics),
      mapUrl ? `Mapa: ${mapUrl}` : null,
      'ARBOR-OS',
    ].filter(Boolean).join('\n');
  };

  const copyClientMessage = (task, diagnostics = getTaskDiagnostics(task, todayIso)) => {
    copyText(buildClientMessage(task, diagnostics), `Skopiowano SMS do klienta dla zlecenia #${task.id}.`);
  };

  const copyTaskAddress = (task) => {
    copyText(getTaskAddressLine(task), `Skopiowano adres zlecenia #${task.id}.`);
  };

  const copyDispatchManifest = (tasks, label = 'bieżącego widoku') => {
    const scopedTasks = tasks.filter(Boolean);
    if (scopedTasks.length === 0) {
      pokazKomunikat('Brak zleceń do odprawy.', 'error');
      return;
    }
    const value = scopedTasks.reduce((sum, task) => sum + (Number(task.wartosc_planowana) || 0), 0);
    const withAddress = scopedTasks.filter((task) => getTaskAddressLine(task)).length;
    const withPhone = scopedTasks.filter((task) => telHref(task.klient_telefon)).length;
    const directionsHref = getDirectionsHref(scopedTasks);
    const manifest = [
      `ARBOR-OS | Odprawa operacyjna ${label}`,
      `Zleceń: ${scopedTasks.length} | Telefony: ${withPhone}/${scopedTasks.length} | Adresy: ${withAddress}/${scopedTasks.length} | Wartość: ${formatCurrency(value)}`,
      directionsHref ? `Trasa zbiorcza: ${directionsHref}` : null,
      '',
      scopedTasks.map((task, index) => buildTaskBrief(task, index + 1)).join('\n\n'),
    ].filter((line) => line !== null).join('\n');
    copyText(manifest, `Skopiowano odprawę: ${scopedTasks.length} zleceń.`);
  };

  const handleTaskNextAction = async (task, diagnostics) => {
    const action = diagnostics.nextAction;
    if (action.target === 'status' && action.nextStatus && mozePrzesuwacStatus) {
      await zmienStatusInline(task.id, action.nextStatus);
      return;
    }
    if (action.target === 'edit' && mozeEdytowac) {
      otworzEdycje(task, getFormStepForEditAction(action));
      return;
    }
    otworzSzczegoly(task);
  };

  const openClosureRepairTask = (task, mode = 'details') => {
    if (!task) return;
    if (mode === 'edit' && mozeEdytowac) {
      otworzEdycje(task);
      return;
    }
    otworzSzczegoly(task);
  };

  const handleDetailDecisionAction = async () => {
    if (!wybraneZlecenie || !detailNextAction) return;
    if (detailNextAction.target === 'edit' && mozeEdytowac) {
      otworzEdycje(wybraneZlecenie, getFormStepForEditAction(detailNextAction));
      return;
    }
    if (detailNextAction.target === 'contact') {
      pokazKomunikat('Sekcja kontaktu jest poniżej. Zapisz notatkę lub ustaw follow-up po rozmowie.');
      return;
    }
    await handleTaskNextAction(wybraneZlecenie, { ...detailBusinessMeta.diagnostics, nextAction: detailNextAction });
  };

  const scrollToDetailSection = (sectionKey) => {
    window.requestAnimationFrame(() => {
      document.querySelector(`[data-detail-section="${sectionKey}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  const handleDetailWorkflowCommand = async (action) => {
    if (!wybraneZlecenie || !action) return;
    if (action.target === 'status' && action.nextStatus) {
      if (!mozePrzesuwacStatus) {
        pokazKomunikat('Brak uprawnień do zmiany statusu z tego panelu.', 'error');
        return;
      }
      await zmienStatusInline(wybraneZlecenie.id, action.nextStatus);
      return;
    }
    if (action.target === 'edit') {
      if (!mozeEdytowac) {
        pokazKomunikat('Brak uprawnień do edycji tego zlecenia.', 'error');
        return;
      }
      otworzEdycje(wybraneZlecenie, action.formStep || getFormStepForEditAction(action));
      return;
    }
    if (action.target === 'photos') {
      scrollToDetailSection('photos');
      return;
    }
    if (action.target === 'officePlan') {
      scrollToDetailSection('officePlan');
      return;
    }
    if (action.target === 'crewBrief') {
      scrollToDetailSection('crewBrief');
      return;
    }
    if (action.target === 'decision') {
      scrollToDetailSection('decision');
      return;
    }
    if (action.target === 'copyBrief') {
      copyTaskBrief(wybraneZlecenie);
    }
  };

  const continueCloseGuard = async () => {
    const guard = closeGuard;
    if (!guard || !guard.canForceClose) return;
    setCloseGuard(null);
    if (guard.mode === 'form') {
      await zapiszZlecenie({ forceClose: true, guard });
      return;
    }
    await zmienStatusInline(guard.task.id, 'Zakonczone', { forceClose: true, guard });
  };

  const fixCloseGuard = () => {
    const guard = closeGuard;
    setCloseGuard(null);
    if (!guard) return;
    recordClosureDecision(guard, 'fix_started', 'Operator wrócił do poprawy danych przed zamknięciem.');
    if (guard.mode === 'form') return;
    if (mozeEdytowac) {
      otworzEdycje(guard.task);
      return;
    }
    otworzSzczegoly(guard.task);
  };

  const toCsvValue = (value) => {
    const text = String(value ?? '');
    if (text.includes('"') || text.includes(';') || text.includes('\n')) {
      return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
  };

  const exportFilteredCsv = () => {
    const headers = [
      'ID',
      'Klient',
      'Adres',
      'Miasto',
      'Typ uslugi',
      'Status',
      'Priorytet',
      'SLA',
      'Data planowana',
      'Wartosc planowana',
      'Oddzial ID',
      'Ekipa ID',
      'Kontakt status',
      'Follow-up kontakt',
    ];
    const rows = widoczneZlecenia.map((z) => [
      z.id,
      z.klient_nazwa,
      z.adres,
      z.miasto,
      z.typ_uslugi,
      z.status,
      z.priorytet,
      getSlaFlags(z).join(', ') || 'OK',
      z.data_planowana ? z.data_planowana.split('T')[0] : '',
      z.wartosc_planowana ?? '',
      z.oddzial_id ?? '',
      z.ekipa_id ?? '',
      getClientContactOption(getClientContact(z.id).status).label,
      getClientContact(z.id).dueAt ? formatContactStamp(getClientContact(z.id).dueAt) : '',
    ]);
    const csv = [headers, ...rows].map((row) => row.map(toCsvValue).join(';')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    link.download = `zlecenia-${stamp}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    pokazKomunikat(`Wyeksportowano ${rows.length} rekordów do CSV.`);
  };

  const exportFilteredXlsx = () => {
    const rows = widoczneZlecenia.map((z) => ({
      ID: z.id,
      Klient: z.klient_nazwa || '',
      Adres: z.adres || '',
      Miasto: z.miasto || '',
      'Typ uslugi': z.typ_uslugi || '',
      Status: z.status || '',
      Priorytet: z.priorytet || '',
      SLA: getSlaFlags(z).join(', ') || 'OK',
      'Data planowana': z.data_planowana ? z.data_planowana.split('T')[0] : '',
      'Wartosc planowana': z.wartosc_planowana ?? '',
      'Oddzial ID': z.oddzial_id ?? '',
      'Ekipa ID': z.ekipa_id ?? '',
      'Kontakt status': getClientContactOption(getClientContact(z.id).status).label,
      'Follow-up kontakt': getClientContact(z.id).dueAt ? formatContactStamp(getClientContact(z.id).dueAt) : '',
    }));

    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Zlecenia');

    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    XLSX.writeFile(workbook, `zlecenia-${stamp}.xlsx`);
    pokazKomunikat(`Wyeksportowano ${rows.length} rekordów do XLSX.`);
  };
 
  const todayIso = new Date().toISOString().slice(0, 10);
  const matchesSmartFilter = (task, filterKey = smartFilter) => {
    if (!filterKey) return true;
    const diagnostics = getTaskDiagnostics(task, todayIso);
    if (filterKey === 'overdue') return diagnostics.has.overdue;
    if (filterKey === 'unassigned') return diagnostics.has.unassigned;
    if (filterKey === 'urgent') return diagnostics.has.urgent;
    if (filterKey === 'today') return diagnostics.has.today;
    if (filterKey === 'noDate') return diagnostics.has.noDate;
    if (filterKey === 'noContact') return diagnostics.has.noContact;
    if (filterKey === 'noMedia') return diagnostics.has.noMedia;
    if (filterKey === 'noFieldSketch') return diagnostics.has.noFieldSketch;
    if (filterKey === 'noPrice') return diagnostics.has.noPrice;
    if (filterKey === 'fieldInspection') return getTaskInspectionWorkflow(task, diagnostics).key === 'fieldInspection';
    if (filterKey === 'officeApproval') return getTaskInspectionWorkflow(task, diagnostics).key === 'officeApproval';
    if (filterKey === 'readyClose') return diagnostics.has.readyClose;
    if (filterKey === 'contactTodo') {
      const contactStatus = getClientContact(task.id).status;
      return !contactStatus || contactStatus === 'todo';
    }
    if (filterKey === 'contactWaiting') return getClientContact(task.id).status === 'waiting';
    if (filterKey === 'contactRisk') return getClientContact(task.id).status === 'risk';
    if (filterKey === 'contactOverdue') return getContactFollowupMeta(getClientContact(task.id)).overdue;
    if (filterKey === 'contactToday') return getContactFollowupMeta(getClientContact(task.id)).today;
    return true;
  };
  const smartFilterCounts = SMART_FILTERS.map((item) => ({
    ...item,
    count: zlecenia.filter((task) => matchesSmartFilter(task, item.key)).length,
  }));
  const activeSmartLabel = SMART_FILTERS.find((item) => item.key === smartFilter)?.label;
  const matchesOperationalView = (task, view) => {
    if (view.smartFilter && !matchesSmartFilter(task, view.smartFilter)) return false;
    if (view.status && task.status !== view.status) return false;
    return true;
  };
  const operationalViews = OPERATIONAL_VIEWS.map((view) => ({
    ...view,
    count: zlecenia.filter((task) => matchesOperationalView(task, view)).length,
  }));
  const activeOperationalViewKey = operationalViews.find((view) =>
    (view.smartFilter || '') === (smartFilter || '') &&
    (view.status || '') === (filtrStatus || '') &&
    !filtrTyp &&
    !filtrOddzial &&
    !filtrEkipa &&
    !szukaj
  )?.key;

  const applyOperationalView = (view) => {
    setSmartFilter(view.smartFilter || '');
    setFiltrStatus(view.status || '');
    setFiltrTyp('');
    setFiltrOddzial('');
    setFiltrEkipa('');
    setSzukaj('');
    setSelectedTaskIds([]);
  };

  const filtrowane = zlecenia.filter(z => {
    if (smartFilter && !matchesSmartFilter(z)) return false;
    if (filtrStatus && z.status !== filtrStatus) return false;
    if (filtrTyp && z.typ_uslugi !== filtrTyp) return false;
    if (filtrOddzial && String(z.oddzial_id || '') !== filtrOddzial) return false;
    if (filtrEkipa && String(z.ekipa_id || '') !== filtrEkipa) return false;
    if (szukaj) {
      const q = szukaj.toLowerCase();
      if (!`${z.klient_nazwa} ${z.adres} ${z.miasto}`.toLowerCase().includes(q)) return false;
    }
    return true;
  });
  const widoczneZlecenia = [...filtrowane].sort((a, b) => compareTasksBySort(a, b, sortMode, todayIso));
  const activeSort = TASK_SORT_OPTIONS.find((option) => option.key === sortMode) || TASK_SORT_OPTIONS[0];
  const queueItems = widoczneZlecenia.slice(0, 3).map((task) => ({
    task,
    meta: getTaskQueueMeta(task, todayIso),
  }));
  const businessGuard = buildBusinessGuardSummary(widoczneZlecenia, todayIso, getClientContact);
  const visibleOpenTasks = widoczneZlecenia.filter((task) => !isTaskClosed(task.status));
  const visibleValue = widoczneZlecenia.reduce((sum, task) => sum + (Number(task.wartosc_planowana) || 0), 0);
  const visibleUnassigned = visibleOpenTasks.filter((task) => getTaskDiagnostics(task, todayIso).has.unassigned).length;
  const visibleNoDate = visibleOpenTasks.filter((task) => !getTaskDay(task)).length;
  const visibleNoContact = visibleOpenTasks.filter((task) => getTaskDiagnostics(task, todayIso).has.noContact).length;
  const visibleNoMedia = visibleOpenTasks.filter((task) => getTaskDiagnostics(task, todayIso).has.noMedia).length;
  const visibleNoFieldSketch = visibleOpenTasks.filter((task) => getTaskDiagnostics(task, todayIso).has.noFieldSketch).length;
  const visibleNoPrice = visibleOpenTasks.filter((task) => getTaskDiagnostics(task, todayIso).has.noPrice).length;
  const visibleFieldInspection = visibleOpenTasks.filter((task) => getTaskInspectionWorkflow(task, getTaskDiagnostics(task, todayIso)).key === 'fieldInspection').length;
  const visibleOfficeApproval = visibleOpenTasks.filter((task) => getTaskInspectionWorkflow(task, getTaskDiagnostics(task, todayIso)).key === 'officeApproval').length;
  const visibleToday = widoczneZlecenia.filter((task) => getTaskDiagnostics(task, todayIso).has.today).length;
  const visibleReadyClose = widoczneZlecenia.filter((task) => getTaskDiagnostics(task, todayIso).has.readyClose).length;
  const dispatchReadiness = [
    { key: 'crew', label: 'Obsada', count: visibleUnassigned, ok: 'Ekipy gotowe', danger: 'Bez ekipy', filterKey: 'unassigned' },
    { key: 'time', label: 'Termin', count: visibleNoDate, ok: 'Plan gotowy', danger: 'Bez terminu', filterKey: 'noDate' },
    { key: 'photos', label: 'Zdjęcia', count: visibleNoMedia, ok: 'Dokumentacja OK', danger: 'Bez zdjęć', filterKey: 'noMedia' },
    { key: 'sketch', label: 'Szkic', count: visibleNoFieldSketch, ok: 'Zakres opisany', danger: 'Bez szkicu', filterKey: 'noFieldSketch' },
    { key: 'price', label: 'Wycena', count: visibleNoPrice, ok: 'Cena OK', danger: 'Bez wyceny', filterKey: 'noPrice' },
    { key: 'contact', label: 'Kontakt', count: visibleNoContact, ok: 'Kontakt OK', danger: 'Brak telefonu', filterKey: 'noContact' },
  ];
  const zleceniaOpsCards = [
    { label: 'Widoczne', value: widoczneZlecenia.length, detail: `${zlecenia.length} w systemie`, tone: 'green' },
    { label: 'Wartość widoku', value: formatMoneyBrief(visibleValue), detail: 'planowana wartość prac', tone: 'green' },
    { label: 'Ryzyko', value: businessGuard.criticalCount, detail: formatMoneyBrief(businessGuard.riskValue), tone: businessGuard.criticalCount ? 'danger' : 'green' },
    { label: 'Bez ekipy', value: visibleUnassigned, detail: 'do dyspozycji', tone: visibleUnassigned ? 'warning' : 'green', filterKey: 'unassigned' },
    { label: 'Bez terminu', value: visibleNoDate, detail: 'nie wejdą do planu', tone: visibleNoDate ? 'warning' : 'green', filterKey: 'noDate' },
    { label: 'Bez zdjęć', value: visibleNoMedia, detail: 'ryzyko sporu z klientem', tone: visibleNoMedia ? 'danger' : 'green', filterKey: 'noMedia' },
    { label: 'Bez wyceny', value: visibleNoPrice, detail: 'teren bez ceny', tone: visibleNoPrice ? 'warning' : 'green', filterKey: 'noPrice' },
    { label: 'U wyceniających', value: visibleFieldInspection, detail: 'oględziny / wycena', tone: 'warning', filterKey: 'fieldInspection' },
    { label: 'Do zatwierdzenia', value: visibleOfficeApproval, detail: 'biuro tylko akceptuje', tone: visibleOfficeApproval ? 'blue' : 'green', filterKey: 'officeApproval' },
    { label: 'Dzisiaj', value: visibleToday, detail: `${visibleReadyClose} do zamknięcia`, tone: 'blue', filterKey: 'today' },
  ];
  const closureAudit = buildClosureAuditSummary(closureDecisionEvents, zlecenia);
  const effectiveClosureIssueKey = closureAudit.topIssues.some((issue) => issue.key === activeClosureIssueKey)
    ? activeClosureIssueKey
    : '';
  const activeClosureIssue = closureAudit.topIssues.find((issue) => issue.key === effectiveClosureIssueKey) || null;
  const closureRepairQueue = buildClosureRepairQueue(closureAudit.rows, effectiveClosureIssueKey);
  const visibleIds = widoczneZlecenia.map((z) => z.id);
  const selectedVisibleTasks = widoczneZlecenia.filter((z) => selectedTaskIds.includes(z.id));
  const viewRouteHref = getDirectionsHref(widoczneZlecenia.slice(0, 8));
  const selectedRouteHref = getDirectionsHref(selectedVisibleTasks);
  const detailContact = wybraneZlecenie ? getClientContact(wybraneZlecenie.id) : {};
  const detailContactOption = getClientContactOption(detailContact.status);
  const detailFollowupMeta = getContactFollowupMeta(detailContact);
  const detailBusinessMeta = wybraneZlecenie ? getTaskBusinessMeta(wybraneZlecenie, todayIso, detailContact) : null;
  const detailPriceGuidance = wybraneZlecenie && detailBusinessMeta
    ? getTaskPriceGuidance(wybraneZlecenie, detailBusinessMeta)
    : null;
  const detailQualityChecklist = wybraneZlecenie && detailBusinessMeta
    ? getTaskQualityChecklist(wybraneZlecenie, detailBusinessMeta, detailContact)
    : [];
  const detailSafetyChecklist = wybraneZlecenie && detailBusinessMeta
    ? getTaskSafetyChecklist(wybraneZlecenie, detailBusinessMeta, detailContact)
    : [];
  const detailSafetyOkCount = detailSafetyChecklist.filter((item) => item.ok).length;
  const detailSafetyRequiredIssues = detailSafetyChecklist.filter((item) => item.required && !item.ok);
  const detailEquipmentList = wybraneZlecenie ? getTaskEquipmentList(wybraneZlecenie) : [];
  const detailQualityOkCount = detailQualityChecklist.filter((item) => item.ok).length;
  const detailRequiredIssues = detailQualityChecklist.filter((item) => item.required && !item.ok);
  const detailDecisionRecommendation = wybraneZlecenie && detailBusinessMeta
    ? getTaskDecisionRecommendation(wybraneZlecenie, detailBusinessMeta, detailQualityChecklist, detailContact)
    : '';
  const detailNextAction = wybraneZlecenie && detailBusinessMeta
    ? getTaskDetailNextAction(wybraneZlecenie, detailBusinessMeta, detailQualityChecklist)
    : null;
  const detailClosureEvents = wybraneZlecenie ? (closureDecisionEvents[String(wybraneZlecenie.id)] || []) : [];
  const areAllVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedTaskIds.includes(id));
  const KANBAN_COLUMNS = TASK_STATUSES;
  const oddzialyOpcje = [...new Set(zlecenia.map((z) => z.oddzial_id).filter(Boolean))];
  const branchSelectOptions = [
    ...new Set([currentUser?.oddzial_id, form.oddzial_id, quickCall.oddzial_id, ...oddzialyOpcje]
      .filter((value) => value !== undefined && value !== null && value !== '')
      .map((value) => String(value)))
  ];
  const estimatorOptions = uzytkownicy
    .filter((u) => u.rola === 'Wyceniający' || u.rola === 'Wyceniajacy')
    .filter((u) => (
      !form.oddzial_id ||
      !u.oddzial_id ||
      String(u.oddzial_id) === String(form.oddzial_id) ||
      String(u.id) === String(form.wyceniajacy_id)
    ));
  const quickCallEstimatorOptions = uzytkownicy
    .filter((u) => u.rola === 'Wyceniający' || u.rola === 'Wyceniajacy')
    .filter((u) => (
      !quickCall.oddzial_id ||
      !u.oddzial_id ||
      String(u.oddzial_id) === String(quickCall.oddzial_id) ||
      String(u.id) === String(quickCall.wyceniajacy_id)
    ));
  const teamOptions = ekipy.filter((ekipa) => (
    !form.oddzial_id ||
    !ekipa.oddzial_id ||
    String(ekipa.oddzial_id) === String(form.oddzial_id) ||
    String(ekipa.id) === String(form.ekipa_id)
  ));
  const kanbanStats = KANBAN_COLUMNS.map((status) => {
    const items = widoczneZlecenia.filter((z) => z.status === status);
    const total = items.reduce((sum, z) => sum + (parseFloat(z.wartosc_planowana) || 0), 0);
    return { status, count: items.length, total };
  });
  const totalKanbanValue = kanbanStats.reduce((sum, s) => sum + s.total, 0);
 
  const getStatusColor = (st) => getTaskStatusColor(st);
  const getPriorytetColor = (p) => ({ Pilny: '#EF5350', Wysoki: '#F9A825', Normalny: '#2196F3', Niski: '#9CA3AF' }[p] || '#6B7280');
  const formatCurrency = (v) => !v ? '—' : parseFloat(v).toLocaleString('pl-PL', { minimumFractionDigits: 2 }) + ' PLN';
  const formatCurrencyZero = (v) => (Number(v) || 0).toLocaleString('pl-PL', { minimumFractionDigits: 2 }) + ' PLN';
  const formatPercent = (v) => `${Math.round((Number(v) || 0) * 100)}%`;
  const formStepIndex = Math.max(0, FORM_STEPS.findIndex((step) => step.key === formStep));
  const currentFormStep = FORM_STEPS[formStepIndex] || FORM_STEPS[0];
  const isFirstFormStep = formStepIndex === 0;
  const isLastFormStep = formStepIndex === FORM_STEPS.length - 1;
  const formPreviewTask = buildTaskFromForm();
  const formWorkflowStageIndex = Math.max(
    0,
    FORM_WORKFLOW_STEPS.findIndex((step) => step.status === (formPreviewTask.status || TASK_STATUS.NOWE))
  );
  const formWorkflowStage = FORM_WORKFLOW_STEPS[formWorkflowStageIndex] || FORM_WORKFLOW_STEPS[0];
  const formStatusOptions = tryb === 'nowy'
    ? [TASK_STATUS.NOWE, TASK_STATUS.WYCENA_TERENOWA]
    : getNextTaskStatuses(wybraneZlecenie?.status || form.status, {
      includeCurrent: true,
      allowCancel: mozePrzesuwacStatus,
    });
  const formPreviewContact = formPreviewTask?.id ? getClientContact(formPreviewTask.id) : {};
  const formPreviewMeta = getTaskBusinessMeta(formPreviewTask, todayIso, formPreviewContact);
  const formPreviewPrice = getTaskPriceGuidance(formPreviewTask, formPreviewMeta);
  const formPreviewSafety = getTaskSafetyChecklist(formPreviewTask, formPreviewMeta, formPreviewContact);
  const formPreviewSafetyRequired = formPreviewSafety.filter((item) => item.required && !item.ok);
  const selectedTaskPhotos = wybraneZlecenie?.id ? (taskPhotosById[String(wybraneZlecenie.id)] || []) : [];
  const selectedTaskProblems = wybraneZlecenie?.id ? (taskProblemsById[String(wybraneZlecenie.id)] || []) : [];
  const fieldPhotoCount = selectedTaskPhotos.filter((photo) => ['Wycena', 'Szkic'].includes(photo.typ)).length;
  const detailPlanTeamOptions = wybraneZlecenie
    ? ekipy.filter((ekipa) => (
      !wybraneZlecenie.oddzial_id ||
      !ekipa.oddzial_id ||
      String(ekipa.oddzial_id) === String(wybraneZlecenie.oddzial_id) ||
      String(ekipa.id) === String(officePlan.ekipa_id)
    ))
    : [];
  const officePlanTeam = detailPlanTeamOptions.find((ekipa) => String(ekipa.id) === String(officePlan.ekipa_id))
    || ekipy.find((ekipa) => String(ekipa.id) === String(officePlan.ekipa_id));
  const detailEquipmentOptions = wybraneZlecenie
    ? [...sprzetItems]
      .filter((item) => {
        const selected = (officePlan.sprzet_ids || []).some((id) => String(id) === String(item.id));
        const sameBranch = !wybraneZlecenie.oddzial_id || !item.oddzial_id || String(item.oddzial_id) === String(wybraneZlecenie.oddzial_id);
        const status = String(item.status || '').toLowerCase();
        const unavailable = status.includes('serwis') || status.includes('awari') || status.includes('wycof');
        return selected || (sameBranch && !unavailable);
      })
      .sort((a, b) => {
        const aTeam = officePlan.ekipa_id && String(a.ekipa_id || '') === String(officePlan.ekipa_id) ? 0 : 1;
        const bTeam = officePlan.ekipa_id && String(b.ekipa_id || '') === String(officePlan.ekipa_id) ? 0 : 1;
        if (aTeam !== bTeam) return aTeam - bTeam;
        return String(a.typ || '').localeCompare(String(b.typ || ''), 'pl') || String(a.nazwa || '').localeCompare(String(b.nazwa || ''), 'pl');
      })
    : [];
  const selectedOfficeEquipment = detailEquipmentOptions.filter((item) =>
    (officePlan.sprzet_ids || []).some((id) => String(id) === String(item.id))
  );
  const showOfficePlanPanel = Boolean(
    wybraneZlecenie &&
    mozePlanowacBiuro &&
    !isTaskClosed(wybraneZlecenie.status) &&
    [TASK_STATUS.DO_ZATWIERDZENIA, TASK_STATUS.ZAPLANOWANE].includes(wybraneZlecenie.status)
  );
  const detailWorkflowRows = wybraneZlecenie && detailBusinessMeta
    ? getDetailWorkflowCommandRows({
      task: wybraneZlecenie,
      meta: detailBusinessMeta,
      qualityChecklist: detailQualityChecklist,
      safetyChecklist: detailSafetyChecklist,
      photos: selectedTaskPhotos,
      contact: detailContact,
      showOfficePlanPanel,
    })
    : [];
  const detailHeroTone = detailSafetyRequiredIssues.length
    ? 'danger'
    : detailRequiredIssues.length
      ? 'warning'
      : detailBusinessMeta?.severity || 'good';
  const detailHeroStats = wybraneZlecenie ? [
    {
      label: 'Status',
      value: wybraneZlecenie.status || 'Nowe',
      detail: wybraneZlecenie.priorytet ? `Priorytet: ${wybraneZlecenie.priorytet}` : 'Priorytet nie ustawiony',
      tone: detailHeroTone,
    },
    {
      label: 'Wartość',
      value: formatMoneyBrief(wybraneZlecenie.wartosc_planowana),
      detail: detailPriceGuidance?.label || 'Brak rekomendacji ceny',
      tone: detailPriceGuidance?.tone || 'good',
    },
    {
      label: 'Gotowość',
      value: detailBusinessMeta ? `${detailBusinessMeta.diagnostics.score}/100` : 'Brak',
      detail: detailRequiredIssues[0]?.label || detailSafetyRequiredIssues[0]?.label || 'Można odprawić bez blokad',
      tone: detailHeroTone,
    },
    {
      label: 'Dokumentacja',
      value: selectedTaskPhotos.length,
      detail: `${fieldPhotoCount} zdjęć z wyceny/szkicu`,
      tone: selectedTaskPhotos.length ? 'blue' : 'warning',
    },
  ] : [];
  const setFormStepSafe = (key) => setFormStep(FORM_STEP_KEYS.has(key) ? key : 'client');
  const goPrevFormStep = () => setFormStep(FORM_STEPS[Math.max(0, formStepIndex - 1)].key);
  const goNextFormStep = () => setFormStep(FORM_STEPS[Math.min(FORM_STEPS.length - 1, formStepIndex + 1)].key);
 
  return (
    <div className="app-shell">
      <Sidebar />
      <main className="app-main" style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={s.main}>
 
        <StatusMessage
          message={komunikat.tekst || ''}
          tone={komunikat.typ === 'error' ? 'error' : komunikat.typ === 'success' ? 'success' : undefined}
          style={s.komunikat}
        />

        {copyFallback && (
          <div style={s.copyFallback}>
            <div style={s.copyFallbackHeader}>
              <div>
                <div style={s.copyFallbackEyebrow}>Tekst do skopiowania</div>
                <div style={s.copyFallbackTitle}>{copyFallback.title}</div>
              </div>
              <button type="button" style={s.bulkBtnSecondary} onClick={() => setCopyFallback(null)}>Zamknij</button>
            </div>
            <textarea
              readOnly
              value={copyFallback.text}
              style={s.copyFallbackText}
              onFocus={(event) => event.target.select()}
            />
          </div>
        )}

        {potwierdzUsuniecie && (
          <div style={s.overlay}>
            <div style={s.modal}>
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12, color: 'var(--text-muted)' }}>
                <DeleteOutline style={{ fontSize: 48 }} aria-hidden />
              </div>
              <h3 style={{ fontSize: 20, fontWeight: 'bold', color: 'var(--text)', margin: '0 0 8px' }}>{t('pages.zlecenia.deleteTitle')}</h3>
              <p style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.6, margin: '0 0 24px' }}>
                {t('pages.zlecenia.deleteBody', { id: potwierdzUsuniecie.id, client: potwierdzUsuniecie.klient_nazwa })}
              </p>
              <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
                <button style={s.btnDanger} onClick={() => usunZlecenie(potwierdzUsuniecie.id)}>{t('pages.zlecenia.deleteYes')}</button>
                <button style={s.btnGray} onClick={() => setPotwierdzUsuniecie(null)}>{t('common.cancel')}</button>
              </div>
            </div>
          </div>
        )}

        {closeGuard && (
          <div style={s.overlay}>
            <div style={s.closeGuardModal}>
              <div style={s.closeGuardHeader}>
                <div>
                  <div style={s.detailOpsEyebrow}>Kontrola przed zamknięciem</div>
                  <h3 style={s.closeGuardTitle}>Zlecenie #{closeGuard.task?.id}</h3>
                </div>
                <span style={{ ...s.businessHealth, ...s[`businessHealth_${closeGuard.blockers.length ? 'danger' : 'warning'}`] }}>
                  {closeGuard.blockers.length ? 'Blokada' : 'Uwaga'}
                </span>
              </div>
              <p style={s.closeGuardLead}>
                {closeGuard.blockers.length
                  ? 'Nie zamykam zlecenia, bo są krytyczne braki. Popraw je przed finalnym statusem.'
                  : 'Zlecenie można zamknąć, ale ma uwagi jakościowe. Zamknięcie będzie świadomą decyzją operatora.'}
              </p>
              <div style={s.closeGuardMetrics}>
                <div style={s.detailDecisionMetric}><span>Wartość</span><strong>{formatCurrencyZero(closeGuard.meta.value)}</strong></div>
                <div style={s.detailDecisionMetric}><span>Jakość</span><strong>{closeGuard.meta.diagnostics.score}/100</strong></div>
                <div style={s.detailDecisionMetric}><span>Ryzyko</span><strong>{closeGuard.meta.riskScore}</strong></div>
              </div>
              {closeGuard.blockers.length > 0 ? (
                <div style={s.closeGuardSection}>
                  <div style={s.closeGuardSectionTitle}>Blokady krytyczne</div>
                  {closeGuard.blockers.map((item) => (
                    <div key={item.key} style={{ ...s.closeGuardItem, ...s.closeGuardItemDanger }}>
                      <strong>{item.label}</strong>
                      <span>{item.detail}</span>
                    </div>
                  ))}
                </div>
              ) : null}
              {closeGuard.warnings.length > 0 ? (
                <div style={s.closeGuardSection}>
                  <div style={s.closeGuardSectionTitle}>Uwagi jakościowe</div>
                  {closeGuard.warnings.map((item) => (
                    <div key={item.key} style={s.closeGuardItem}>
                      <strong>{item.label}</strong>
                      <span>{item.detail}</span>
                    </div>
                  ))}
                </div>
              ) : null}
              <div style={s.closeGuardActions}>
                {closeGuard.canForceClose ? (
                  <button type="button" style={s.btnPrimary} onClick={continueCloseGuard}>
                    Zamknij mimo uwag
                  </button>
                ) : null}
                <button type="button" style={s.btnSecondary} onClick={fixCloseGuard}>
                  {closeGuard.mode === 'form' ? 'Wróć do formularza' : 'Popraw dane'}
                </button>
                <button type="button" style={s.btnGray} onClick={() => setCloseGuard(null)}>
                  Anuluj
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ══ LISTA ══ */}
        {tryb === 'lista' && (
          <>
            <PageHeader
              variant="plain"
              title={t('pages.zlecenia.title')}
              subtitle={t('pages.zlecenia.subtitle')}
              icon={<AssignmentOutlined style={{ fontSize: 26 }} />}
              actions={
                <>
                  <button type="button" style={s.btnSecondary} onClick={() => { setFiltrStatus(''); setTryb('kanban'); }}>{t('pages.zlecenia.kanbanTitle')}</button>
                  {mozeTworzyc && <button type="button" style={s.btnPrimary} onClick={otworzNowe}>+ {t('common.newOrder')}</button>}
                </>
              }
            />
            <div style={s.commandPanel}>
              <div style={s.commandHeader}>
                <div>
                  <div style={s.commandEyebrow}>Centrum pracy</div>
                  <div style={s.commandTitle}>Jedna droga zlecenia: od telefonu do wykonania pracy.</div>
                </div>
                <div style={s.commandActions}>
                  <button type="button" style={s.btnSecondary} onClick={() => setTryb('kanban')}>Kanban</button>
                  {showAdvancedOps ? (
                    <>
                      <button type="button" style={s.btnSecondary} onClick={exportFilteredCsv}>CSV</button>
                      <button type="button" style={s.btnSecondary} onClick={exportFilteredXlsx}>XLSX</button>
                      <button type="button" style={s.btnSecondary} onClick={() => copyDispatchManifest(widoczneZlecenia, 'bieżącego widoku')}>
                        Odprawa widoku
                      </button>
                      {viewRouteHref ? (
                        <a href={viewRouteHref} target="_blank" rel="noreferrer" style={s.btnSecondary}>
                          Trasa top 8
                        </a>
                      ) : null}
                    </>
                  ) : null}
                </div>
              </div>
              <div style={s.commandStats}>
                <div style={s.commandStat}>
                  <span>Łącznie</span>
                  <strong style={s.commandStatStrong}>{zlecenia.length}</strong>
                </div>
                <div style={s.commandStat}>
                  <span>Widoczne</span>
                  <strong style={s.commandStatStrong}>{filtrowane.length}</strong>
                </div>
                <div style={s.commandStat}>
                  <span>Wartość widoku</span>
                  <strong style={s.commandStatStrong}>{formatCurrency(filtrowane.reduce((sum, z) => sum + (parseFloat(z.wartosc_planowana) || 0), 0))}</strong>
                </div>
              </div>
              {mozeTworzyc ? (
                <div
                  ref={quickCallRef}
                  style={{
                    ...s.quickCallPanel,
                    ...(quickCallFocused ? s.quickCallPanelFocused : {}),
                  }}
                >
                  <div style={s.quickCallHeader}>
                    <div>
                      <div style={s.dispatchEyebrow}>Telefon do biura</div>
                      <div style={s.quickCallTitle}>30 sekund: klient, adres, termin i wyceniacz</div>
                    </div>
                    <span style={s.quickCallStatus}>Tworzy: Wycena_Terenowa</span>
                  </div>
                  <div style={s.quickCallGrid}>
                    <div style={s.fg}>
                      <label style={s.label}>Klient *</label>
                      <input
                        ref={quickCallClientInputRef}
                        data-testid="quick-call-client"
                        style={s.input}
                        placeholder="Imię / firma"
                        value={quickCall.klient_nazwa}
                        onChange={(event) => setQuickCallField('klient_nazwa', event.target.value)}
                      />
                    </div>
                    <div style={s.fg}>
                      <label style={s.label}>Telefon *</label>
                      <input
                        style={s.input}
                        placeholder="+48 000 000 000"
                        value={quickCall.klient_telefon}
                        onChange={(event) => setQuickCallField('klient_telefon', event.target.value)}
                      />
                    </div>
                    <div style={s.fg}>
                      <label style={s.label}>Adres *</label>
                      <input
                        style={s.input}
                        placeholder="ulica, numer"
                        value={quickCall.adres}
                        onChange={(event) => setQuickCallField('adres', event.target.value)}
                      />
                    </div>
                    <div style={s.fg}>
                      <label style={s.label}>Miasto *</label>
                      <CityInput
                        style={s.input}
                        placeholder="Kraków"
                        value={quickCall.miasto}
                        onChange={(event) => setQuickCallField('miasto', event.target.value)}
                        extraCities={zlecenia.map((z) => z.miasto)}
                      />
                    </div>
                    <div style={s.fg}>
                      <label style={s.label}>Data oględzin *</label>
                      <input
                        style={s.input}
                        type="date"
                        value={quickCall.data_planowana}
                        onChange={(event) => setQuickCallField('data_planowana', event.target.value)}
                      />
                    </div>
                    <div style={s.fg}>
                      <label style={s.label}>Godzina</label>
                      <input
                        style={s.input}
                        type="time"
                        value={quickCall.godzina_rozpoczecia}
                        onChange={(event) => setQuickCallField('godzina_rozpoczecia', event.target.value)}
                      />
                    </div>
                    <div style={s.fg}>
                      <label style={s.label}>Oddział</label>
                      <select
                        style={s.input}
                        value={quickCall.oddzial_id}
                        disabled={!canManageAllBranches && !!currentUser?.oddzial_id}
                        onChange={(event) => setQuickCallField('oddzial_id', event.target.value)}
                      >
                        <option value="">— wybierz —</option>
                        {branchSelectOptions.map((oddzialId) => (
                          <option key={oddzialId} value={oddzialId}>Oddział #{oddzialId}</option>
                        ))}
                      </select>
                    </div>
                    <div style={s.fg}>
                      <label style={s.label}>Wyceniacz *</label>
                      <select
                        style={s.input}
                        value={quickCall.wyceniajacy_id}
                        onChange={(event) => setQuickCallField('wyceniajacy_id', event.target.value)}
                      >
                        <option value="">— wybierz —</option>
                        {quickCallEstimatorOptions.map((u) => (
                          <option key={u.id} value={u.id}>{u.imie} {u.nazwisko}</option>
                        ))}
                      </select>
                    </div>
                    <div style={{ ...s.fg, gridColumn: '1 / -1' }}>
                      <label style={s.label}>Notatka z rozmowy</label>
                      <textarea
                        style={{ ...s.input, minHeight: 58, resize: 'vertical' }}
                        placeholder="np. klient prosi o oględziny po 15:00, brama od strony ogrodu, do wyceny 2 drzewa"
                        value={quickCall.opis_pracy}
                        onChange={(event) => setQuickCallField('opis_pracy', event.target.value)}
                      />
                    </div>
                  </div>
                  <div style={s.quickCallFooter}>
                    <span>Po zapisie wyceniacz zobaczy to w mobilce jako oględziny terenowe.</span>
                    <div style={s.quickCallActions}>
                      <button type="button" style={s.btnSecondary} onClick={otworzNowe}>Pełny formularz</button>
                      <button
                        type="button"
                        style={{ ...s.btnPrimary, ...(quickCallSaving ? s.formWizardBtnDisabled : {}) }}
                        disabled={quickCallSaving}
                        onClick={utworzOgledzinyZTelefonu}
                      >
                        {quickCallSaving ? 'Tworzę...' : 'Utwórz oględziny'}
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}
              <div style={s.workflowLanePanel}>
                <div style={s.workflowLaneHeader}>
                  <div>
                    <div style={s.dispatchEyebrow}>Jedna ścieżka zlecenia</div>
                    <div style={s.workflowLaneTitle}>Telefon -> oględziny -> biuro -> ekipa -> zamknięcie</div>
                  </div>
                  <span style={s.workflowLaneHint}>Kliknij etap, żeby zobaczyć tylko te sprawy.</span>
                </div>
                <div style={s.savedViews}>
                  {operationalViews.map((view) => (
                    <button
                      key={view.key}
                      type="button"
                      onClick={() => applyOperationalView(view)}
                      style={{
                        ...s.savedViewBtn,
                        ...(activeOperationalViewKey === view.key ? s.savedViewBtnActive : {}),
                      }}
                    >
                      <span style={s.savedViewLabel}>{view.label}</span>
                      <span style={s.savedViewMeta}>{view.detail}</span>
                      <span style={s.savedViewCount}>{view.count}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div style={s.advancedOpsHeader}>
                <div>
                  <strong style={s.advancedOpsTitle}>Kontrola operacyjna</strong>
                  <span style={s.advancedOpsText}>Ryzyka, audyt, finanse i wszystkie filtry są dostępne tutaj, ale nie mieszają się z codzienną ścieżką.</span>
                </div>
                <button type="button" style={s.btnSecondary} onClick={() => setShowAdvancedOps((value) => !value)}>
                  {showAdvancedOps ? 'Ukryj kontrolę' : 'Pokaż kontrolę'}
                </button>
              </div>
              {!showAdvancedOps && smartFilter ? (
                <div style={s.activeFilterBanner}>
                  <span>Aktywny filtr: <strong>{activeSmartLabel || smartFilter}</strong></span>
                  <button type="button" style={s.clearBtn} onClick={() => setSmartFilter('')}>Wyczyść</button>
                </div>
              ) : null}
              {showAdvancedOps ? (
                <>
              <div className="zlecenia-ops-grid" style={s.opsGrid}>
                {zleceniaOpsCards.map((card) => (
                  <button
                    key={card.label}
                    type="button"
                    onClick={() => {
                      if (card.filterKey) setSmartFilter(smartFilter === card.filterKey ? '' : card.filterKey);
                    }}
                    style={{
                      ...s.opsCard,
                      ...(s[`opsCard_${card.tone}`] || {}),
                      cursor: card.filterKey ? 'pointer' : 'default',
                    }}
                  >
                    <span style={s.opsCardLabel}>{card.label}</span>
                    <strong style={s.opsCardValue}>{card.value}</strong>
                    <small style={s.opsCardDetail}>{card.detail}</small>
                  </button>
                ))}
              </div>
              <div style={s.dispatchReadinessStrip}>
                <div>
                  <div style={s.dispatchReadinessEyebrow}>Kontrola przed wysłaniem ekipy</div>
                  <strong style={s.dispatchReadinessTitle}>Najpierw zdjęcia, termin, ekipa i kontakt</strong>
                </div>
                <div style={s.dispatchReadinessItems}>
                  {dispatchReadiness.map((item) => {
                    const active = smartFilter === item.filterKey;
                    const blocked = item.count > 0;
                    return (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() => setSmartFilter(active ? '' : item.filterKey)}
                        style={{
                          ...s.dispatchReadinessItem,
                          ...(active ? s.dispatchReadinessItemActive : {}),
                          ...(blocked ? s.dispatchReadinessItemBlocked : {}),
                        }}
                      >
                        <span style={s.dispatchReadinessLabel}>{item.label}</span>
                        <strong style={s.dispatchReadinessCount}>{item.count}</strong>
                        <small style={s.dispatchReadinessHint}>{blocked ? item.danger : item.ok}</small>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div style={s.commandTabs}>
                {COMMAND_TABS.map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setCommandTab(tab.key)}
                    style={{
                      ...s.commandTab,
                      ...(commandTab === tab.key ? s.commandTabActive : {}),
                    }}
                  >
                    <span style={s.commandTabLabel}>{tab.label}</span>
                    <span style={s.commandTabDetail}>{tab.detail}</span>
                  </button>
                ))}
              </div>
              {commandTab === 'dispatch' && (
              <div style={s.dispatchPanel}>
                <div style={s.dispatchHeader}>
                  <div>
                    <div style={s.dispatchEyebrow}>Kolejka dyspozytora</div>
                    <div style={s.dispatchTitle}>Sortowanie: {activeSort.label}</div>
                  </div>
                  <div style={s.sortTabs}>
                    {TASK_SORT_OPTIONS.map((option) => (
                      <button
                        key={option.key}
                        type="button"
                        onClick={() => setSortMode(option.key)}
                        style={{
                          ...s.sortTab,
                          ...(sortMode === option.key ? s.sortTabActive : {}),
                        }}
                      >
                        <span style={s.sortTabLabel}>{option.label}</span>
                        <span style={s.sortTabDetail}>{option.detail}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <div style={s.queueList}>
                  {queueItems.length === 0 ? (
                    <div style={s.queueEmpty}>Brak zleceń w bieżącym widoku.</div>
                  ) : queueItems.map(({ task, meta }) => (
                    <button
                      key={task.id}
                      type="button"
                      style={s.queueItem}
                      onClick={() => otworzSzczegoly(task)}
                    >
                      <span style={s.queueRank}>{Math.round(meta.score)}</span>
                      <span style={s.queueBody}>
                        <span style={s.queueTitle}>#{task.id} {task.klient_nazwa || 'Bez klienta'}</span>
                        <span style={s.queueMeta}>
                          {meta.reasons.length ? meta.reasons.join(' · ') : 'bez blokerów'} · {formatQueueTiming(meta.daysLeft)}
                        </span>
                      </span>
                      <span style={s.queueValue}>{formatCurrency(meta.value)}</span>
                    </button>
                  ))}
                </div>
                <div style={s.manifestBar}>
                  <span>
                    Odprawa obejmie <strong>{widoczneZlecenia.length}</strong> zleceń w aktualnej kolejności.
                  </span>
                  <button type="button" style={s.manifestBtn} onClick={() => copyDispatchManifest(widoczneZlecenia, 'bieżącego widoku')}>
                    Kopiuj odprawę
                  </button>
                </div>
              </div>
              )}
              {commandTab === 'finance' && (
              <div style={s.businessGuardPanel}>
                <div style={s.businessGuardHeader}>
                  <div>
                    <div style={s.dispatchEyebrow}>Ochrona marży i jakości</div>
                    <div style={s.dispatchTitle}>Ryzyko finansowe aktualnego widoku</div>
                  </div>
                  <span style={{ ...s.businessHealth, ...s[`businessHealth_${businessGuard.health}`] }}>
                    {businessGuard.healthLabel}
                  </span>
                </div>
                <div style={s.businessKpiGrid}>
                  <button type="button" style={s.businessKpi} onClick={() => setSortMode('risk')}>
                    <span style={s.businessKpiLabel}>Wartość pod ryzykiem</span>
                    <strong style={s.businessKpiValue}>{formatCurrencyZero(businessGuard.riskValue)}</strong>
                    <span style={s.businessKpiHint}>{formatPercent(businessGuard.riskRatio)} wartości widoku</span>
                  </button>
                  <button type="button" style={s.businessKpi} onClick={() => setSmartFilter('readyClose')}>
                    <span style={s.businessKpiLabel}>Do domknięcia</span>
                    <strong style={s.businessKpiValue}>{formatCurrencyZero(businessGuard.readyValue)}</strong>
                    <span style={s.businessKpiHint}>{businessGuard.readyCount} gotowych zleceń</span>
                  </button>
                  <div style={s.businessKpiStatic}>
                    <span style={s.businessKpiLabel}>Jakość operacyjna</span>
                    <strong style={s.businessKpiValue}>{businessGuard.avgReadiness}/100</strong>
                    <span style={s.businessKpiHint}>{businessGuard.criticalCount} krytycznych pozycji</span>
                  </div>
                  <div style={s.businessKpiStatic}>
                    <span style={s.businessKpiLabel}>{businessGuard.hasBuffer ? 'Bufor ceny' : 'Stawka planu'}</span>
                    <strong style={s.businessKpiValue}>
                      {businessGuard.hasBuffer
                        ? formatCurrencyZero(businessGuard.totalBuffer)
                        : businessGuard.revenuePerHour
                          ? `${Math.round(businessGuard.revenuePerHour).toLocaleString('pl-PL')} PLN/h`
                          : '—'}
                    </strong>
                    <span style={s.businessKpiHint}>
                      {businessGuard.hasBuffer ? 'vs minimum lub budżet' : 'wg wartości i godzin'}
                    </span>
                  </div>
                </div>
                <div style={s.businessSignalRow}>
                  {businessGuard.signals.map((signal) => (
                    <button
                      key={signal.key}
                      type="button"
                      disabled={!signal.count}
                      onClick={() => {
                        setSmartFilter(signal.filter);
                        setSelectedTaskIds([]);
                      }}
                      style={{
                        ...s.businessSignal,
                        ...(signal.count ? s.businessSignalActive : s.businessSignalDisabled),
                      }}
                    >
                      <span>{signal.label}</span>
                      <strong>{signal.count}</strong>
                      <small>{formatCurrencyZero(signal.value)}</small>
                    </button>
                  ))}
                </div>
                <div style={s.businessRiskList}>
                  {businessGuard.topRisks.length === 0 ? (
                    <div style={s.businessRiskEmpty}>Brak ryzyk finansowych w aktualnym widoku.</div>
                  ) : businessGuard.topRisks.map(({ task, meta }) => (
                    <button
                      key={task.id}
                      type="button"
                      style={s.businessRiskItem}
                      onClick={() => otworzSzczegoly(task)}
                    >
                      <span style={s.businessRiskMain}>
                        <span style={s.businessRiskTitle}>#{task.id} {task.klient_nazwa || 'Bez klienta'}</span>
                        <span style={s.businessRiskFlags}>{meta.flags.slice(0, 3).join(' · ') || 'ryzyko operacyjne'}</span>
                      </span>
                      <span style={s.businessRiskScore}>{meta.riskScore}</span>
                      <strong style={s.businessRiskValue}>{formatCurrencyZero(meta.riskValue)}</strong>
                    </button>
                  ))}
                </div>
              </div>
              )}
              {commandTab === 'audit' && (
              <div style={s.closureAuditPanel}>
                <div style={s.closureAuditHeader}>
                  <div>
                    <div style={s.dispatchEyebrow}>Audyt zamykania</div>
                    <div style={s.dispatchTitle}>Kto zamyka, co blokuje i gdzie ucieka jakość</div>
                  </div>
                  <span style={{ ...s.businessHealth, ...s[`businessHealth_${closureAudit.health}`] }}>
                    {closureAudit.healthLabel}
                  </span>
                </div>
                <div style={s.closureAuditKpis}>
                  <div style={s.closureAuditKpi}>
                    <span style={s.businessKpiLabel}>Zatrzymane próby</span>
                    <strong style={s.businessKpiValue}>{closureAudit.blocked}</strong>
                    <span style={s.businessKpiHint}>{formatCurrencyZero(closureAudit.blockedValue)} ochronione w audycie</span>
                  </div>
                  <div style={s.closureAuditKpi}>
                    <span style={s.businessKpiLabel}>Zamknięcia mimo uwag</span>
                    <strong style={s.businessKpiValue}>{closureAudit.forced}</strong>
                    <span style={s.businessKpiHint}>do kontroli kierownika</span>
                  </div>
                  <div style={s.closureAuditKpi}>
                    <span style={s.businessKpiLabel}>Powroty do poprawy</span>
                    <strong style={s.businessKpiValue}>{closureAudit.fixes}</strong>
                    <span style={s.businessKpiHint}>operator poprawił dane</span>
                  </div>
                  <div style={s.closureAuditKpi}>
                    <span style={s.businessKpiLabel}>Czyste zamknięcia</span>
                    <strong style={s.businessKpiValue}>{closureAudit.clean}</strong>
                    <span style={s.businessKpiHint}>{closureAudit.total} decyzji łącznie</span>
                  </div>
                </div>
                <div style={s.closureAuditColumns}>
                  <div style={s.closureAuditBox}>
                    <div style={s.closureAuditBoxTitle}>Najczęstsze blokady</div>
                    {closureAudit.topIssues.length === 0 ? (
                      <div style={s.closureAuditEmpty}>Brak zarejestrowanych blokad.</div>
                    ) : closureAudit.topIssues.map((issue) => (
                      <button
                        key={issue.key}
                        type="button"
                        data-testid={`closure-audit-issue-${issue.key}`}
                        style={{
                          ...s.closureAuditIssue,
                          ...(effectiveClosureIssueKey === issue.key ? s.closureAuditIssueActive : {}),
                        }}
                        onClick={() => setActiveClosureIssueKey(effectiveClosureIssueKey === issue.key ? '' : issue.key)}
                      >
                        <span style={s.closureAuditIssueBody}>
                          <strong>{issue.label}</strong>
                          <small>{issue.blockers} krytyczne · {issue.warnings} ostrzeżenia · {issue.taskIds.length} zleceń</small>
                        </span>
                        <span style={s.closureAuditCount}>{issue.count}</span>
                        <span style={s.closureAuditValue}>{formatCurrencyZero(issue.value)}</span>
                      </button>
                    ))}
                  </div>
                  <div style={s.closureAuditBox}>
                    <div style={s.closureAuditBoxTitle}>Operatorzy i decyzje</div>
                    {closureAudit.topActors.length === 0 ? (
                      <div style={s.closureAuditEmpty}>Rejestr decyzji jest pusty.</div>
                    ) : closureAudit.topActors.map((actor) => (
                      <div key={actor.actor} style={s.closureAuditActor}>
                        <span style={s.closureAuditIssueBody}>
                          <strong>{actor.actor}</strong>
                          <small>{actor.blocked} zatrzymane · {actor.forced} wymuszone · {actor.fixes} poprawy</small>
                        </span>
                        <span style={s.closureAuditCount}>{actor.count}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div style={s.closureRepairPanel} data-testid="closure-repair-panel">
                  <div style={s.closureRepairHeader}>
                    <div>
                      <div style={s.closureAuditBoxTitle}>Tryb naprawczy</div>
                      <div style={s.closureRepairTitle}>
                        {activeClosureIssue ? activeClosureIssue.label : 'Wszystkie aktywne blokady'}
                      </div>
                    </div>
                    {activeClosureIssue ? (
                      <button type="button" style={s.closureRepairClear} onClick={() => setActiveClosureIssueKey('')}>
                        Wszystkie
                      </button>
                    ) : null}
                  </div>
                  {closureRepairQueue.length === 0 ? (
                    <div style={s.closureAuditEmpty}>Brak zleceń do poprawy w tej kategorii.</div>
                  ) : (
                    <div style={s.closureRepairList}>
                      {closureRepairQueue.map(({ event, task, value, items }) => (
                        <div key={`${event.id}-repair`} style={s.closureRepairItem} data-testid={`closure-repair-item-${task.id}`}>
                          <span style={s.closureRepairScore}>{event.risk_score}</span>
                          <span style={s.closureRepairBody}>
                            <strong>#{task.id} {task.klient_nazwa || 'Bez klienta'}</strong>
                            <small>{items.map((item) => item.label).join(' · ')} · {closureActionLabel(event.action)}</small>
                          </span>
                          <span style={s.closureRepairValue}>{formatCurrencyZero(value)}</span>
                          <span style={s.closureRepairActions}>
                            <button type="button" data-testid={`closure-repair-details-${task.id}`} style={s.closureRepairBtn} onClick={() => openClosureRepairTask(task)}>
                              Szczegóły
                            </button>
                            <button type="button" data-testid={`closure-repair-edit-${task.id}`} style={s.closureRepairBtnPrimary} onClick={() => openClosureRepairTask(task, 'edit')}>
                              {mozeEdytowac ? 'Napraw' : 'Podgląd'}
                            </button>
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div style={s.closureAuditRecent}>
                  <div style={s.closureAuditBoxTitle}>Ostatnie decyzje</div>
                  {closureAudit.recent.length === 0 ? (
                    <div style={s.closureAuditEmpty}>Zamknij lub zatrzymaj pierwsze zlecenie, a pojawi się tu ślad audytowy.</div>
                  ) : closureAudit.recent.map(({ event, task, value }, index) => (
                    <button
                      key={`${event.id}-${index}`}
                      type="button"
                      style={s.closureAuditEvent}
                      onClick={() => task && otworzSzczegoly(task)}
                      disabled={!task}
                    >
                      <span style={{ ...s.contactDot, ...(event.severity === 'danger' ? s.contactDot_danger : event.severity === 'warning' ? s.contactDot_warning : s.contactDot_good) }} />
                      <span style={s.closureAuditEventBody}>
                        <strong>#{event.task_id} {task?.klient_nazwa || 'Zlecenie bez klienta'}</strong>
                        <small>{closureActionLabel(event.action)} · {event.actor || 'Operator'} · {formatContactStamp(event.created_at)}</small>
                      </span>
                      <span style={s.closureAuditEventMeta}>
                        ryzyko {event.risk_score} · {formatCurrencyZero(value)}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
              )}
                </>
              ) : null}
            </div>

            {showAdvancedOps ? (
            <div style={s.smartFilterRow}>
              <span style={s.smartFilterTitle}>Inteligentne widoki</span>
              {smartFilterCounts.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setSmartFilter(smartFilter === item.key ? '' : item.key)}
                  style={{
                    ...s.smartFilterChip,
                    ...(smartFilter === item.key ? s.smartFilterChipActive : {}),
                  }}
                >
                  {item.label}
                  <span style={s.smartFilterCount}>{item.count}</span>
                </button>
              ))}
              {smartFilter ? (
                <button type="button" style={s.clearBtn} onClick={() => setSmartFilter('')}>
                  Wyczyść: {activeSmartLabel}
                </button>
              ) : null}
            </div>
            ) : null}

            <div style={s.filtryRow}>
              <input style={s.searchInput} placeholder={t('pages.zlecenia.searchPlaceholder')}
                value={szukaj} onChange={e => setSzukaj(e.target.value)} />
              <select style={s.filtrInput} value={filtrStatus} onChange={e => setFiltrStatus(e.target.value)}>
                <option value="">{t('pages.zlecenia.allStatuses')}</option>
                {TASK_STATUSES.map((status) => (
                  <option key={status} value={status}>{t(`taskStatus.${status}`, { defaultValue: status })}</option>
                ))}
              </select>
              <select style={s.filtrInput} value={filtrTyp} onChange={e => setFiltrTyp(e.target.value)}>
                <option value="">{t('pages.zlecenia.allTypes')}</option>
                {TASK_SERVICE_TYPES.map((type) => (
                  <option key={type} value={type}>{t(`serviceType.${type}`, { defaultValue: type })}</option>
                ))}
              </select>
              {ekipy.length > 0 && (
                <select style={s.filtrInput} value={filtrEkipa} onChange={e => setFiltrEkipa(e.target.value)}>
                  <option value="">Wszystkie ekipy</option>
                  {ekipy.map((ekipa) => (
                    <option key={ekipa.id} value={ekipa.id}>{ekipa.nazwa || ekipa.name || `Ekipa #${ekipa.id}`}</option>
                  ))}
                </select>
              )}
              {oddzialyOpcje.length > 0 && (
                <select style={s.filtrInput} value={filtrOddzial} onChange={e => setFiltrOddzial(e.target.value)}>
                  <option value="">Wszystkie oddziały</option>
                  {oddzialyOpcje.map((oddzial) => (
                    <option key={oddzial} value={oddzial}>Oddział {oddzial}</option>
                  ))}
                </select>
              )}
              {(filtrStatus || filtrTyp || filtrEkipa || filtrOddzial || szukaj || smartFilter) && (
                <button style={s.clearBtn} onClick={() => { setFiltrStatus(''); setFiltrTyp(''); setFiltrEkipa(''); setFiltrOddzial(''); setSzukaj(''); setSmartFilter(''); }}>{t('pages.zlecenia.clear')}</button>
              )}
              <span style={s.countBadge}>{filtrowane.length} / {zlecenia.length}</span>
            </div>

            {selectedTaskIds.length > 0 && (
              <div style={s.bulkBar}>
                <div style={s.bulkInfo}>{t('pages.zlecenia.bulkSelected', { count: selectedTaskIds.length })}</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button style={s.bulkBtn} onClick={() => bulkUpdateStatus('Wycena_Terenowa')}>Na oględziny</button>
                  <button style={s.bulkBtn} onClick={() => bulkUpdateStatus('Do_Zatwierdzenia')}>Do zatwierdzenia</button>
                  <button style={s.bulkBtn} onClick={() => bulkUpdateStatus('Zaplanowane')}>{t('pages.zlecenia.bulkToPlanned')}</button>
                  <button style={s.bulkBtn} onClick={() => bulkUpdateStatus('W_Realizacji')}>{t('pages.zlecenia.bulkToProgress')}</button>
                  <button style={s.bulkBtn} onClick={() => bulkUpdateStatus('Zakonczone')}>{t('pages.zlecenia.bulkFinish')}</button>
                  <button style={s.bulkBtn} onClick={() => copyDispatchManifest(selectedVisibleTasks, 'zaznaczonych zleceń')}>Odprawa zazn.</button>
                  {selectedRouteHref ? (
                    <a href={selectedRouteHref} target="_blank" rel="noreferrer" style={s.bulkBtn}>Trasa zazn.</a>
                  ) : null}
                  <button style={s.bulkBtnSecondary} onClick={() => setSelectedTaskIds([])}>{t('pages.zlecenia.bulkClearSelection')}</button>
                </div>
              </div>
            )}
 
            {loading ? <div style={s.loading}>{t('pages.zlecenia.loading')}</div> : (
              <div style={s.listCardsWrap}>
                <div style={s.listCardsHeader}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input type="checkbox" checked={areAllVisibleSelected} onChange={toggleSelectAllVisible} />
                    <span style={s.listCardsHeaderText}>Zaznacz wszystkie</span>
                  </div>
                  <span style={s.listCardsHeaderText}>Kliknij kartę, aby otworzyć szczegóły</span>
                </div>
                {widoczneZlecenia.length === 0 ? (
                  <div style={{ ...s.card, textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>{t('pages.zlecenia.emptyList')}</div>
                ) : (
                  <div className="zlecenia-list-grid" style={s.listCardsGrid}>
                    {widoczneZlecenia.map((z) => {
                      const diagnostics = getTaskDiagnostics(z, todayIso);
                      const photoSummary = diagnostics.photos;
                      const workflowStage = getTaskInspectionWorkflow(z, diagnostics);
                      const phoneHref = telHref(z.klient_telefon);
                      const mapsHref = getMapsHref(z);
                      const contact = getClientContact(z.id);
                      const contactOption = getClientContactOption(contact.status);
                      const followupMeta = getContactFollowupMeta(contact);
                      return (
                      <div key={z.id} style={s.listTaskCard} onClick={() => otworzSzczegoly(z)}>
                        <div style={s.listTaskTop}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }} onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              checked={selectedTaskIds.includes(z.id)}
                              onChange={() => toggleTaskSelection(z.id)}
                            />
                            <span style={s.idBadge}>#{z.id}</span>
                          </div>
                          <div style={s.akcjeRow} onClick={(e) => e.stopPropagation()}>
                            <button type="button" style={s.btnSm} onClick={() => otworzSzczegoly(z)} title={t('common.details')} aria-label={t('common.details')}>
                              <VisibilityOutlined style={{ fontSize: 18, display: 'block' }} />
                            </button>
                            {mozeEdytowac && (
                              <button type="button" style={s.btnSm} onClick={() => otworzEdycje(z)} title={t('common.edit')} aria-label={t('common.edit')}>
                                <EditOutlined style={{ fontSize: 18, display: 'block' }} />
                              </button>
                            )}
                            {mozeUsuwac && (
                              <button type="button" style={{ ...s.btnSm, backgroundColor: 'rgba(248,113,113,0.1)', color: '#C62828' }} onClick={() => setPotwierdzUsuniecie(z)} title={t('common.delete')} aria-label={t('common.delete')}>
                                <DeleteOutline style={{ fontSize: 18, display: 'block' }} />
                              </button>
                            )}
                          </div>
                        </div>
                        <div style={s.listTaskClient}>{z.klient_nazwa}</div>
                        <div style={s.listTaskMeta}>{z.adres ? `${z.adres}${z.miasto ? ', ' + z.miasto : ''}` : z.miasto || '—'}</div>
                        <div style={s.listTaskMeta}>{t(`serviceType.${z.typ_uslugi}`, { defaultValue: z.typ_uslugi })}</div>
                        <div style={s.contactMini}>
                          <span style={{ ...s.contactDot, ...s[`contactDot_${contactOption.tone}`] }} />
                          <span>{contactOption.label}</span>
                          {contact.updatedAt ? <strong>{formatContactStamp(contact.updatedAt)}</strong> : null}
                        </div>
                        {contact.dueAt ? (
                          <div style={{ ...s.contactMini, ...s.contactMiniFollowup, ...(followupMeta.overdue ? s.contactMiniDanger : {}) }}>
                            <span style={{ ...s.contactDot, ...s[`contactDot_${followupMeta.tone}`] }} />
                            <span>{followupMeta.label}</span>
                          </div>
                        ) : null}
                        <div style={{ ...s.workflowStageRow, ...(s[`workflowStage_${workflowStage.tone}`] || {}) }}>
                          <span style={s.workflowStageStep}>{workflowStage.step}</span>
                          <div style={s.workflowStageBody}>
                            <strong>{workflowStage.label}</strong>
                            <small>{workflowStage.detail}</small>
                          </div>
                        </div>
                        <div style={s.fieldOpsRow} onClick={(event) => event.stopPropagation()}>
                          {phoneHref ? (
                            <a href={phoneHref} style={s.fieldOpsBtn} title="Zadzwoń do klienta">
                              <PhoneOutlined style={s.fieldOpsIcon} aria-hidden />
                              Zadzwoń
                            </a>
                          ) : (
                            <span style={{ ...s.fieldOpsBtn, ...s.fieldOpsBtnDisabled }}>
                              <PhoneOutlined style={s.fieldOpsIcon} aria-hidden />
                              Brak tel.
                            </span>
                          )}
                          <button type="button" style={s.fieldOpsBtn} onClick={() => copyClientMessage(z, diagnostics)} title="Skopiuj SMS do klienta">
                            <SmsOutlined style={s.fieldOpsIcon} aria-hidden />
                            SMS
                          </button>
                          {mapsHref ? (
                            <a href={mapsHref} target="_blank" rel="noreferrer" style={s.fieldOpsBtn} title="Otwórz trasę w mapie">
                              <RouteOutlined style={s.fieldOpsIcon} aria-hidden />
                              Trasa
                            </a>
                          ) : (
                            <span style={{ ...s.fieldOpsBtn, ...s.fieldOpsBtnDisabled }}>
                              <RouteOutlined style={s.fieldOpsIcon} aria-hidden />
                              Brak adresu
                            </span>
                          )}
                          <button type="button" style={s.fieldOpsBtn} onClick={() => copyTaskAddress(z)} title="Skopiuj adres">
                            <ContentCopyOutlined style={s.fieldOpsIcon} aria-hidden />
                            Adres
                          </button>
                          <button type="button" style={s.fieldOpsBtn} onClick={() => copyTaskBrief(z, diagnostics)} title="Skopiuj brief dla ekipy">
                            <ContentCopyOutlined style={s.fieldOpsIcon} aria-hidden />
                            Brief
                          </button>
                        </div>
                        <div
                          style={{
                            ...s.documentationRow,
                            ...(photoSummary.total === 0 ? s.documentationRowWarning : {}),
                          }}
                        >
                          <span style={s.documentationLabel}>Dokumentacja</span>
                          <span style={s.documentationMetric}>
                            <strong>{photoSummary.total}</strong> zdjęć
                          </span>
                          <span style={s.documentationMetric}>
                            <strong>{photoSummary.valuation}</strong> wycena
                          </span>
                          <span style={s.documentationMetric}>
                            <strong>{photoSummary.sketch}</strong> szkic
                          </span>
                        </div>
                        <div style={s.listTaskChips}>
                          <span style={{ ...s.badge, backgroundColor: getStatusColor(z.status) }}>{t(`taskStatus.${z.status}`, { defaultValue: z.status })}</span>
                          <span style={{ ...s.badge, backgroundColor: getPriorytetColor(z.priorytet) }}>{z.priorytet}</span>
                        </div>
                        <div style={s.readinessBlock}>
                          <div style={s.readinessTop}>
                            <span>Gotowość</span>
                            <strong>{diagnostics.score}%</strong>
                          </div>
                          <div style={s.readinessTrack}>
                            <span
                              style={{
                                ...s.readinessFill,
                                width: `${diagnostics.score}%`,
                                backgroundColor: diagnostics.level === 'danger' ? '#EF5350' : diagnostics.level === 'warning' ? '#F9A825' : '#34D399',
                              }}
                            />
                          </div>
                        </div>
                        <div style={s.blockerWrap}>
                          {diagnostics.items.length === 0 ? (
                            <span style={{ ...s.blockerBadge, ...s.blockerGood }}>Gotowe operacyjnie</span>
                          ) : diagnostics.items.slice(0, 4).map((item) => (
                            <span
                              key={item.key}
                              style={{
                                ...s.blockerBadge,
                                ...(item.tone === 'danger' ? s.blockerDanger : s.blockerWarning),
                              }}
                            >
                              {item.label}
                            </span>
                          ))}
                        </div>
                        <div style={s.slaWrap}>
                          {getSlaFlags(z).length === 0 ? (
                            <span style={s.slaOk}>{t('pages.zlecenia.slaOk')}</span>
                          ) : getSlaFlags(z).map((flag) => (
                            <span key={flag} style={s.slaBadge}>{slaFlagLabel(flag)}</span>
                          ))}
                        </div>
                        <div style={s.nextActionRow}>
                          <span style={s.nextActionText}>Następny ruch</span>
                          <button
                            type="button"
                            style={s.nextActionBtn}
                            onClick={(event) => {
                              event.stopPropagation();
                              handleTaskNextAction(z, diagnostics);
                            }}
                          >
                            {diagnostics.nextAction.label}
                          </button>
                        </div>
                        <div style={s.listTaskFooter}>
                          <span style={s.listTaskDate}>{z.data_planowana ? z.data_planowana.split('T')[0] : '—'}</span>
                          <span style={s.listTaskValue}>{formatCurrency(z.wartosc_planowana)}</span>
                        </div>
                      </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* ══ KANBAN ══ */}
        {tryb === 'kanban' && (
          <>
            <PageHeader
              variant="plain"
              back={{ onClick: () => setTryb('lista'), label: t('common.back') }}
              title={t('pages.zlecenia.kanbanTitle')}
              subtitle={t('pages.zlecenia.kanbanSubtitle')}
              icon={<ViewKanbanOutlined style={{ fontSize: 26 }} />}
              actions={
                <>
                  <button type="button" style={s.btnSecondary} onClick={exportFilteredCsv}>{t('common.exportCsv')}</button>
                  <button type="button" style={s.btnSecondary} onClick={exportFilteredXlsx}>{t('common.exportXlsx')}</button>
                  <button type="button" style={s.btnSecondary} onClick={() => setShowWorkflowPanel((v) => !v)}>
                    {t('pages.zlecenia.workflow')}
                  </button>
                  <button type="button" style={s.btnSecondary} onClick={() => setTryb('lista')}>{t('pages.zlecenia.listView')}</button>
                  {mozeTworzyc && <button type="button" style={s.btnPrimary} onClick={otworzNowe}>+ {t('common.newOrder')}</button>}
                </>
              }
            />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 10, marginBottom: 10 }}>
              <div style={{ background: 'linear-gradient(150deg, var(--bg-card) 0%, var(--bg-card2) 100%)', border: '1px solid var(--border2)', borderRadius: 12, padding: '10px 12px', boxShadow: 'var(--shadow-sm)' }}>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>Kanban control</div>
                <div style={{ marginTop: 6, fontSize: 13, color: 'var(--text-sub)' }}>Przeciągaj zlecenia między kolumnami i zarządzaj automatyzacjami workflow.</div>
              </div>
            </div>

            {showWorkflowPanel && (
              <div style={s.workflowPanel}>
                <div style={s.workflowTitle}>Automatyzacje po zmianie statusu</div>
                <div style={s.workflowPresets}>
                  <button
                    type="button"
                    style={s.workflowPresetBtn}
                    onClick={() => setWorkflowConfig(WORKFLOW_PRESETS.minimal)}>
                    Minimalny
                  </button>
                  <button
                    type="button"
                    style={s.workflowPresetBtn}
                    onClick={() => setWorkflowConfig(WORKFLOW_PRESETS.standard)}>
                    Standard
                  </button>
                  <button
                    type="button"
                    style={s.workflowPresetBtn}
                    onClick={() => setWorkflowConfig(WORKFLOW_PRESETS.full)}>
                    Full
                  </button>
                </div>
                <label style={s.workflowOption}>
                  <input
                    type="checkbox"
                    checked={workflowConfig.logEnabled}
                    onChange={(e) => setWorkflowConfig((cfg) => ({ ...cfg, logEnabled: e.target.checked }))}
                  />
                  Zapis logu statusu
                </label>
                <label style={s.workflowOption}>
                  <input
                    type="checkbox"
                    checked={workflowConfig.notificationsEnabled}
                    onChange={(e) => setWorkflowConfig((cfg) => ({ ...cfg, notificationsEnabled: e.target.checked }))}
                  />
                  Powiadomienie wewnętrzne
                </label>
                <label style={s.workflowOption}>
                  <input
                    type="checkbox"
                    checked={workflowConfig.remindersEnabled}
                    onChange={(e) => setWorkflowConfig((cfg) => ({ ...cfg, remindersEnabled: e.target.checked }))}
                  />
                  Przypomnienie dla statusu „Zaplanowane”
                </label>
                <label style={s.workflowOption}>
                  <input
                    type="checkbox"
                    checked={workflowConfig.smsEnabled}
                    onChange={(e) => setWorkflowConfig((cfg) => ({ ...cfg, smsEnabled: e.target.checked }))}
                  />
                  SMS do klienta (jeśli endpoint dostępny)
                </label>
              </div>
            )}

            <div style={s.filtryRow}>
              <input style={s.searchInput} placeholder={t('pages.zlecenia.searchPlaceholder')}
                value={szukaj} onChange={e => setSzukaj(e.target.value)} />
              <select style={s.filtrInput} value={filtrTyp} onChange={e => setFiltrTyp(e.target.value)}>
                <option value="">{t('pages.zlecenia.allTypes')}</option>
                {TASK_SERVICE_TYPES.map((type) => (
                  <option key={type} value={type}>{t(`serviceType.${type}`, { defaultValue: type })}</option>
                ))}
              </select>
              <select style={s.filtrInput} value={filtrOddzial} onChange={e => { setFiltrOddzial(e.target.value); setFiltrEkipa(''); }}>
                <option value="">{t('common.allBranches')}</option>
                {oddzialyOpcje.map((id) => <option key={id} value={String(id)}>{t('common.branch')} #{id}</option>)}
              </select>
              <select style={s.filtrInput} value={filtrEkipa} onChange={e => setFiltrEkipa(e.target.value)}>
                <option value="">{t('common.allTeams')}</option>
                {ekipy
                  .filter((e) => !filtrOddzial || String(e.oddzial_id || '') === filtrOddzial)
                  .map((e) => <option key={e.id} value={String(e.id)}>{e.nazwa}</option>)}
              </select>
              {(filtrTyp || szukaj || filtrOddzial || filtrEkipa || smartFilter) && (
                <button style={s.clearBtn} onClick={() => { setFiltrStatus(''); setFiltrTyp(''); setFiltrOddzial(''); setFiltrEkipa(''); setSzukaj(''); setSmartFilter(''); }}>{t('pages.zlecenia.clear')}</button>
              )}
              <span style={s.countBadge}>{filtrowane.length} / {zlecenia.length}</span>
            </div>

            {loading ? <div style={s.loading}>{t('pages.zlecenia.loading')}</div> : (
              <>
                <div style={s.kpiWrap}>
                  {kanbanStats.map((sItem) => (
                    <div key={sItem.status} style={{ ...s.kpiItem, borderTopColor: getStatusColor(sItem.status) }}>
                      <div style={s.kpiTitle}>{t(`taskStatus.${sItem.status}`, { defaultValue: sItem.status })}</div>
                      <div style={s.kpiCount}>{sItem.count}</div>
                      <div style={s.kpiValue}>{formatCurrency(sItem.total)}</div>
                    </div>
                  ))}
                  <div style={{ ...s.kpiItem, borderTopColor: 'var(--accent)' }}>
                    <div style={s.kpiTitle}>{t('pages.zlecenia.sum')}</div>
                    <div style={s.kpiCount}>{widoczneZlecenia.length}</div>
                    <div style={s.kpiValue}>{formatCurrency(totalKanbanValue)}</div>
                  </div>
                </div>
                <div style={s.kanbanWrap}>
                {KANBAN_COLUMNS.map((status) => {
                  const items = widoczneZlecenia.filter((z) => z.status === status);
                  return (
                    <div
                      key={status}
                      style={s.kanbanCol}
                      onDragOver={(e) => {
                        if (mozePrzesuwacStatus) e.preventDefault();
                      }}
                      onDrop={async () => {
                        if (!mozePrzesuwacStatus || !draggedTaskId) return;
                        await zmienStatusInline(draggedTaskId, status);
                        setDraggedTaskId(null);
                      }}>
                      <div style={s.kanbanColHeader}>
                        <span style={{ ...s.badge, backgroundColor: getStatusColor(status) }}>{t(`taskStatus.${status}`, { defaultValue: status })}</span>
                        <span style={s.kanbanCount}>{items.length}</span>
                      </div>
                      <div style={s.kanbanColBody}>
                        {items.length === 0 ? (
                          <div style={s.kanbanEmpty}>{t('pages.zlecenia.emptyList')}</div>
                        ) : items.map((z) => {
                          const diagnostics = getTaskDiagnostics(z, todayIso);
                          return (
                          <div
                            key={z.id}
                            draggable={mozePrzesuwacStatus && statusUpdatingId !== z.id}
                            onDragStart={() => setDraggedTaskId(z.id)}
                            onDragEnd={() => setDraggedTaskId(null)}
                            onClick={() => otworzSzczegoly(z)}
                            style={{
                              ...s.kanbanCard,
                              opacity: statusUpdatingId === z.id ? 0.6 : 1,
                              cursor: statusUpdatingId === z.id ? 'progress' : 'pointer',
                            }}>
                            <div style={s.kanbanCardTitle}>#{z.id} {z.klient_nazwa}</div>
                            <div style={s.kanbanCardMeta}>{z.adres ? `${z.adres}${z.miasto ? `, ${z.miasto}` : ''}` : (z.miasto || '—')}</div>
                            <div style={s.kanbanCardMeta}>{z.typ_uslugi ? t(`serviceType.${z.typ_uslugi}`, { defaultValue: z.typ_uslugi }) : t('common.none')}</div>
                            <div style={s.slaWrap}>
                              {getSlaFlags(z).length === 0 ? (
                                <span style={s.slaOk}>{t('pages.zlecenia.slaOk')}</span>
                              ) : getSlaFlags(z).map((flag) => (
                                <span key={flag} style={s.slaBadge}>{slaFlagLabel(flag)}</span>
                              ))}
                            </div>
                            <div style={s.kanbanDiagnostics}>
                              <span>Gotowość {diagnostics.score}%</span>
                              <span>{diagnostics.items[0]?.label || 'OK'}</span>
                            </div>
                            <div style={s.kanbanCardFooter}>
                              <span style={{ ...s.badge, backgroundColor: getPriorytetColor(z.priorytet) }}>{z.priorytet}</span>
                              <span style={s.kanbanValue}>{formatCurrency(z.wartosc_planowana)}</span>
                            </div>
                            <div style={s.kanbanActions} onClick={(e) => e.stopPropagation()}>
                              <button style={s.kanbanActionBtn} onClick={() => otworzSzczegoly(z)} title={t('common.details')} aria-label={t('common.details')}>
                                <VisibilityOutlined style={{ fontSize: 16, display: 'block' }} />
                              </button>
                              {mozeEdytowac && (
                                <button style={s.kanbanActionBtn} onClick={() => otworzEdycje(z)} title={t('common.edit')} aria-label={t('common.edit')}>
                                  <EditOutlined style={{ fontSize: 16, display: 'block' }} />
                                </button>
                              )}
                              {mozeUsuwac && (
                                <button
                                  style={{ ...s.kanbanActionBtn, color: '#C62828', backgroundColor: 'rgba(248,113,113,0.12)' }}
                                  onClick={() => setPotwierdzUsuniecie(z)}
                                  title={t('common.delete')}
                                  aria-label={t('common.delete')}>
                                  <DeleteOutline style={{ fontSize: 16, display: 'block' }} />
                                </button>
                              )}
                            </div>
                          </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
                </div>
              </>
            )}
          </>
        )}
 
        {/* ══ SZCZEGÓŁY ══ */}
        {tryb === 'szczegoly' && wybraneZlecenie && (
          <>
            <PageHeader
              variant="plain"
              back={{ onClick: () => setTryb('lista'), label: t('common.back') }}
              title={t('pages.zlecenia.detailHeading', { id: wybraneZlecenie.id })}
              icon={<AssignmentOutlined style={{ fontSize: 26 }} />}
              actions={
                <>
                  {mozeEdytowac && (
                    <button type="button" style={s.btnSecondary} onClick={() => otworzEdycje(wybraneZlecenie)} title={t('common.edit')}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <EditOutlined style={{ fontSize: 18 }} aria-hidden />
                        {t('common.edit')}
                      </span>
                    </button>
                  )}
                  {mozeUsuwac && (
                    <button
                      type="button"
                      style={{ ...s.btnSecondary, backgroundColor: 'rgba(248,113,113,0.1)', color: '#C62828', border: '1px solid #EF9A9A' }}
                      onClick={() => setPotwierdzUsuniecie(wybraneZlecenie)}
                      title={t('common.delete')}
                    >
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <DeleteOutline style={{ fontSize: 18 }} aria-hidden />
                        {t('common.delete')}
                      </span>
                    </button>
                  )}
                </>
              }
            />

            <section className="zlecenia-detail-hero" style={s.detailHeroPanel}>
              <div style={s.detailHeroMain}>
                <div style={s.detailOpsEyebrow}>Paszport operacyjny</div>
                <h2 style={s.detailHeroTitle}>
                  {wybraneZlecenie.klient_nazwa || `Zlecenie #${wybraneZlecenie.id}`}
                </h2>
                <div style={s.detailHeroMeta}>
                  <span>{getTaskAddressLine(wybraneZlecenie) || 'Brak adresu'}</span>
                  <span>{wybraneZlecenie.typ_uslugi || 'Typ pracy nie ustawiony'}</span>
                  <span>{wybraneZlecenie.ekipa_nazwa || (wybraneZlecenie.ekipa_id ? `Ekipa #${wybraneZlecenie.ekipa_id}` : 'Bez ekipy')}</span>
                </div>
              </div>
              <div className="zlecenia-detail-hero-stats" style={s.detailHeroStats}>
                {detailHeroStats.map((stat) => (
                  <div
                    key={stat.label}
                    style={{
                      ...s.detailHeroStat,
                      ...(s[`detailHeroStat_${stat.tone}`] || {}),
                    }}
                  >
                    <span style={s.detailHeroStatLabel}>{stat.label}</span>
                    <strong style={s.detailHeroStatValue}>{stat.value}</strong>
                    <small style={s.detailHeroStatDetail}>{stat.detail}</small>
                  </div>
                ))}
              </div>
            </section>

            <WorkflowPathPanel
              styles={s}
              task={wybraneZlecenie}
              canChange={mozePrzesuwacStatus}
              statusBusy={statusUpdatingId === wybraneZlecenie.id}
              onChangeStatus={(nextStatus) => zmienStatusInline(wybraneZlecenie.id, nextStatus)}
            />

            <DetailWorkflowCommandCenter
              styles={s}
              rows={detailWorkflowRows}
              statusBusy={statusUpdatingId === wybraneZlecenie.id}
              canChangeStatus={mozePrzesuwacStatus}
              onCommand={handleDetailWorkflowCommand}
            />
 
            <div style={s.detailOpsPanel}>
              <div>
                <div style={s.detailOpsEyebrow}>Akcje terenowe</div>
                <div style={s.detailOpsTitle}>{getTaskAddressLine(wybraneZlecenie) || 'Brak adresu w zleceniu'}</div>
              </div>
              <div style={s.detailOpsActions}>
                {telHref(wybraneZlecenie.klient_telefon) ? (
                  <a href={telHref(wybraneZlecenie.klient_telefon)} style={s.fieldOpsBtn}>
                    <PhoneOutlined style={s.fieldOpsIcon} aria-hidden />
                    Zadzwoń
                  </a>
                ) : null}
                {getMapsHref(wybraneZlecenie) ? (
                  <a href={getMapsHref(wybraneZlecenie)} target="_blank" rel="noreferrer" style={s.fieldOpsBtn}>
                    <RouteOutlined style={s.fieldOpsIcon} aria-hidden />
                    Trasa
                  </a>
                ) : null}
                <button type="button" style={s.fieldOpsBtn} onClick={() => copyClientMessage(wybraneZlecenie)}>
                  <SmsOutlined style={s.fieldOpsIcon} aria-hidden />
                  SMS
                </button>
                <button type="button" style={s.fieldOpsBtn} onClick={() => copyTaskAddress(wybraneZlecenie)}>
                  <ContentCopyOutlined style={s.fieldOpsIcon} aria-hidden />
                  Adres
                </button>
                <button type="button" style={s.fieldOpsBtn} onClick={() => copyTaskBrief(wybraneZlecenie)}>
                  <ContentCopyOutlined style={s.fieldOpsIcon} aria-hidden />
                  Brief
                </button>
              </div>
            </div>

            <div data-detail-section="crewBrief">
              <CrewExecutionBrief
                styles={s}
                task={wybraneZlecenie}
                photos={selectedTaskPhotos}
                issues={selectedTaskProblems}
                safetyChecklist={detailSafetyChecklist}
                equipment={detailEquipmentList}
                issueDraft={crewIssueDraft}
                issueSaving={crewIssueSaving}
                statusBusy={statusUpdatingId === wybraneZlecenie.id}
                canChangeStatus={mozeObslugiwacRealizacje}
                onIssueDraftChange={setCrewIssueDraft}
                onReportIssue={reportCrewIssue}
                onStart={() => zmienStatusInline(wybraneZlecenie.id, TASK_STATUS.W_REALIZACJI)}
                onFinish={() => zmienStatusInline(wybraneZlecenie.id, TASK_STATUS.ZAKONCZONE)}
                onCopy={() => copyTaskBrief(wybraneZlecenie)}
              />
            </div>

            {detailBusinessMeta ? (
              <div className="zlecenia-detail-passport" style={s.detailPassportPanel}>
                <div style={s.detailPassportHeader}>
                  <div>
                    <div style={s.detailOpsEyebrow}>Paszport zlecenia 360</div>
                    <div style={s.detailPassportTitle}>
                      {wybraneZlecenie.klient_nazwa || `Zlecenie #${wybraneZlecenie.id}`}
                    </div>
                  </div>
                  <span style={{ ...s.businessHealth, ...s[`businessHealth_${detailSafetyRequiredIssues.length ? 'danger' : detailBusinessMeta.severity}`] }}>
                    BHP {detailSafetyOkCount}/{detailSafetyChecklist.length}
                  </span>
                </div>
                <div className="zlecenia-detail-passport-grid" style={s.detailPassportGrid}>
                  <div style={s.detailPassportCard}>
                    <span style={s.detailDecisionLabel}>Klient</span>
                    <strong>{detailContactOption.label}</strong>
                    <small>{wybraneZlecenie.klient_telefon || 'Brak telefonu'}{detailContact.dueAt ? ` · ${detailFollowupMeta.label}` : ''}</small>
                  </div>
                  <div style={s.detailPassportCard}>
                    <span style={s.detailDecisionLabel}>Ekipa i termin</span>
                    <strong>{wybraneZlecenie.ekipa_nazwa || (wybraneZlecenie.ekipa_id ? `Ekipa #${wybraneZlecenie.ekipa_id}` : 'Bez ekipy')}</strong>
                    <small>{wybraneZlecenie.data_planowana ? `${wybraneZlecenie.data_planowana.split('T')[0]}${wybraneZlecenie.godzina_rozpoczecia ? ` ${wybraneZlecenie.godzina_rozpoczecia}` : ''}` : 'Brak terminu'}</small>
                  </div>
                  <div style={s.detailPassportCard}>
                    <span style={s.detailDecisionLabel}>BHP</span>
                    <strong>{detailSafetyRequiredIssues.length ? 'Wymaga poprawy' : 'Gotowe do odprawy'}</strong>
                    <small>{detailSafetyRequiredIssues[0]?.label || 'Krytyczne punkty są zamknięte.'}</small>
                  </div>
                  <div style={s.detailPassportCard}>
                    <span style={s.detailDecisionLabel}>Sprzęt</span>
                    <strong>{detailEquipmentList.length ? `${detailEquipmentList.length} pozycji` : 'Nie wskazano'}</strong>
                    <small>{detailEquipmentList.slice(0, 3).join(', ') || 'Uzupełnij, jeśli ekipa ma zabrać konkretny sprzęt.'}</small>
                  </div>
                </div>
                <div className="zlecenia-detail-safety-grid" style={s.detailSafetyGrid}>
                  {detailSafetyChecklist.map((item) => (
                    <div
                      key={item.key}
                      style={{
                        ...s.detailSafetyItem,
                        ...(item.ok ? s.detailChecklistOk : item.required ? s.detailChecklistDanger : s.detailChecklistWarn),
                      }}
                    >
                      <span style={s.detailChecklistStatus}>{item.ok ? 'OK' : item.required ? 'Wymagane' : 'Uwaga'}</span>
                      <strong>{item.label}</strong>
                      <small>{item.detail}</small>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {showOfficePlanPanel ? (
              <div className="zlecenia-office-plan" data-detail-section="officePlan" style={s.officePlanPanel}>
                <div style={s.officePlanHeader}>
                  <div>
                    <div style={s.detailOpsEyebrow}>Plan biura</div>
                    <div style={s.officePlanTitle}>Do zaplanowania dla ekipy</div>
                    <p style={s.officePlanSubtitle}>
                      Biuro dopina termin, ekipę i sprzęt na podstawie pakietu z wyceny terenowej.
                    </p>
                  </div>
                  <span style={{ ...s.businessHealth, ...s.businessHealth_good }}>
                    {wybraneZlecenie.status === TASK_STATUS.ZAPLANOWANE ? 'Zaplanowane' : 'Czeka na plan'}
                  </span>
                </div>
                <div style={s.officePlanGrid}>
                  <div style={s.fg}>
                    <label style={s.label}>Data</label>
                    <input
                      type="date"
                      style={s.input}
                      value={officePlan.data_planowana}
                      onChange={(event) => setOfficePlanField('data_planowana', event.target.value)}
                    />
                  </div>
                  <div style={s.fg}>
                    <label style={s.label}>Godzina startu</label>
                    <input
                      type="time"
                      style={s.input}
                      value={officePlan.godzina_rozpoczecia}
                      onChange={(event) => setOfficePlanField('godzina_rozpoczecia', event.target.value)}
                    />
                  </div>
                  <div style={s.fg}>
                    <label style={s.label}>Czas pracy (h)</label>
                    <input
                      type="number"
                      min="0.25"
                      step="0.25"
                      style={s.input}
                      value={officePlan.czas_planowany_godziny}
                      onChange={(event) => setOfficePlanField('czas_planowany_godziny', event.target.value)}
                    />
                  </div>
                  <div style={s.fg}>
                    <label style={s.label}>Ekipa</label>
                    <select
                      style={s.input}
                      value={officePlan.ekipa_id}
                      onChange={(event) => setOfficePlanField('ekipa_id', event.target.value)}
                    >
                      <option value="">— wybierz ekipę —</option>
                      {detailPlanTeamOptions.map((ekipa) => (
                        <option key={ekipa.id} value={ekipa.id}>{ekipa.nazwa || `Ekipa #${ekipa.id}`}</option>
                      ))}
                    </select>
                  </div>
                  <div style={{ ...s.fg, ...s.officePlanEquipmentField }}>
                    <label style={s.label}>Sprzet do rezerwacji</label>
                    <select
                      multiple
                      style={{ ...s.input, ...s.officePlanMultiSelect }}
                      value={officePlan.sprzet_ids || []}
                      onChange={(event) => setOfficePlanEquipment(event.target.selectedOptions)}
                    >
                      {detailEquipmentOptions.map((item) => (
                        <option key={item.id} value={item.id}>
                          {[item.typ, item.nazwa || `Sprzet #${item.id}`, item.ekipa_nazwa ? `(${item.ekipa_nazwa})` : ''].filter(Boolean).join(' - ')}
                        </option>
                      ))}
                    </select>
                    <small style={s.officePlanEquipmentHint}>
                      {selectedOfficeEquipment.length
                        ? `Wybrano: ${selectedOfficeEquipment.map((item) => item.nazwa || `#${item.id}`).join(', ')}`
                        : 'Rezerwacja powstanie razem z planem zlecenia.'}
                    </small>
                  </div>
                  <div style={{ ...s.fg, ...s.officePlanNoteField }}>
                    <label style={s.label}>Sprzęt / uwagi dla brygady</label>
                    <textarea
                      style={{ ...s.input, ...s.officePlanTextarea }}
                      value={officePlan.sprzet_notatka}
                      placeholder="np. rębak, zwyżka, zabezpieczenie rabaty, dojazd od bramy bocznej"
                      onChange={(event) => setOfficePlanField('sprzet_notatka', event.target.value)}
                    />
                  </div>
                </div>
                <div style={s.officePlanFooter}>
                  <div style={s.officePlanSummary}>
                    <strong>{officePlanTeam?.nazwa || 'Ekipa nie wybrana'}</strong>
                    <span>
                      {officePlan.data_planowana || 'brak daty'} {officePlan.godzina_rozpoczecia || ''}
                      {officePlan.czas_planowany_godziny ? ` · ${officePlan.czas_planowany_godziny} h` : ''}
                    </span>
                  </div>
                  <button
                    type="button"
                    style={{ ...s.bulkBtn, ...(officePlanSaving ? { opacity: 0.62, cursor: 'wait' } : {}) }}
                    disabled={officePlanSaving}
                    onClick={zapiszPlanBiura}
                  >
                    {officePlanSaving ? 'Zapisuję...' : 'Zapisz i ustaw Zaplanowane'}
                  </button>
                </div>
              </div>
            ) : null}

            <div data-detail-section="photos">
              <TaskPhotosPanel
                styles={s}
                title="Dokumentacja z wyceny i wykonania"
                subtitle="To widzi biuro i ekipa: zakres wyceniony u klienta, szkice cięcia, dowody przed/po."
                taskId={wybraneZlecenie.id}
                photos={selectedTaskPhotos}
                loading={taskPhotosLoading}
                uploading={uploadingTaskPhoto}
                draft={taskPhotoDraft}
                inputRef={taskPhotoInputRef}
                onDraftChange={setTaskPhotoDraft}
                onPickFiles={uploadTaskPhotos}
                onDraw={openTaskDraw}
                onDelete={mozeEdytowac ? deleteTaskPhoto : null}
              />
            </div>

            {detailBusinessMeta && detailPriceGuidance ? (
              <div className="zlecenia-detail-decision" data-detail-section="decision" style={s.detailDecisionPanel}>
                <div style={s.detailDecisionHeader}>
                  <div>
                    <div style={s.detailOpsEyebrow}>Centrum decyzji</div>
                    <div style={s.detailDecisionTitle}>{detailDecisionRecommendation}</div>
                  </div>
                  <span style={{ ...s.businessHealth, ...s[`businessHealth_${detailBusinessMeta.severity}`] }}>
                    Ryzyko {detailBusinessMeta.riskScore}
                  </span>
                </div>
                <div className="zlecenia-detail-decision-grid" style={s.detailDecisionGrid}>
                  <div style={s.detailDecisionHero}>
                    <span style={s.detailDecisionLabel}>Następny ruch</span>
                    <strong style={s.detailDecisionHeroText}>{detailNextAction?.label || detailBusinessMeta.diagnostics.nextAction.label}</strong>
                    <div style={s.detailDecisionActions}>
                      <button
                        type="button"
                        style={s.bulkBtn}
                        onClick={handleDetailDecisionAction}
                      >
                        Wykonaj
                      </button>
                      <button type="button" style={s.bulkBtnSecondary} onClick={() => copyTaskBrief(wybraneZlecenie)}>
                        Kopiuj brief
                      </button>
                    </div>
                  </div>
                  <div style={{ ...s.detailPriceBox, ...s[`detailPriceBox_${detailPriceGuidance.tone}`] }}>
                    <span style={s.detailDecisionLabel}>Cena</span>
                    <strong style={s.detailPriceTitle}>{detailPriceGuidance.label}</strong>
                    <span style={s.detailPriceText}>{detailPriceGuidance.detail}</span>
                    <div style={s.detailPriceMetrics}>
                      <span>Rekomendacja: <strong>{detailPriceGuidance.recommended ? formatCurrencyZero(detailPriceGuidance.recommended) : '—'}</strong></span>
                      <span>Bufor: <strong>{detailPriceGuidance.buffer === null ? '—' : formatCurrencyZero(detailPriceGuidance.buffer)}</strong></span>
                      <span>Stawka: <strong>{detailPriceGuidance.revenuePerHour ? `${Math.round(detailPriceGuidance.revenuePerHour).toLocaleString('pl-PL')} PLN/h` : '—'}</strong></span>
                    </div>
                    {mozeEdytowac ? (
                      <button type="button" style={s.detailPriceEditBtn} onClick={() => otworzEdycje(wybraneZlecenie, 'finance')}>
                        Edytuj finanse
                      </button>
                    ) : null}
                  </div>
                </div>
                <div style={s.detailDecisionMetrics}>
                  <div style={s.detailDecisionMetric}>
                    <span>Wartość</span>
                    <strong>{formatCurrencyZero(detailBusinessMeta.value)}</strong>
                  </div>
                  <div style={s.detailDecisionMetric}>
                    <span>Jakość</span>
                    <strong>{detailBusinessMeta.diagnostics.score}/100</strong>
                  </div>
                  <div style={s.detailDecisionMetric}>
                    <span>Checklist</span>
                    <strong>{detailQualityOkCount}/{detailQualityChecklist.length}</strong>
                  </div>
                  <div style={s.detailDecisionMetric}>
                    <span>Blokady krytyczne</span>
                    <strong>{detailRequiredIssues.length}</strong>
                  </div>
                </div>
                <div style={s.detailChecklistGrid}>
                  {detailQualityChecklist.map((item) => (
                    <div
                      key={item.key}
                      style={{
                        ...s.detailChecklistItem,
                        ...(item.ok ? s.detailChecklistOk : item.required ? s.detailChecklistDanger : s.detailChecklistWarn),
                      }}
                    >
                      <span style={s.detailChecklistStatus}>{item.ok ? 'OK' : item.required ? 'Wymagane' : 'Uwaga'}</span>
                      <strong>{item.label}</strong>
                      <small>{item.detail}</small>
                    </div>
                  ))}
                </div>
                <div style={s.closureDecisionLog}>
                  <div style={s.closureDecisionHeader}>
                    <div>
                      <div style={s.detailOpsEyebrow}>Rejestr decyzji</div>
                      <div style={s.closureDecisionTitle}>Zamykanie i blokady</div>
                    </div>
                    <span style={s.closureDecisionCount}>{detailClosureEvents.length}</span>
                  </div>
                  {detailClosureEvents.length === 0 ? (
                    <div style={s.closureDecisionEmpty}>Brak prób zamknięcia i decyzji operatora.</div>
                  ) : detailClosureEvents.slice(0, 5).map((event) => (
                    <div key={event.id} style={s.closureDecisionItem}>
                      <span style={{ ...s.contactDot, ...(event.severity === 'danger' ? s.contactDot_danger : event.severity === 'warning' ? s.contactDot_warning : s.contactDot_good) }} />
                      <div style={s.closureDecisionBody}>
                        <div style={s.closureDecisionTop}>
                          <strong>{closureActionLabel(event.action)}</strong>
                          <span>{formatContactStamp(event.created_at)}</span>
                        </div>
                        <div style={s.closureDecisionMeta}>
                          {event.actor || 'Operator'} · ryzyko {event.risk_score} · jakość {event.quality_score}/100
                        </div>
                        {[...(event.blockers || []), ...(event.warnings || [])].length ? (
                          <div style={s.closureDecisionChips}>
                            {[...(event.blockers || []), ...(event.warnings || [])].slice(0, 4).map((item) => (
                              <span key={`${event.id}-${item.key}-${item.label}`} style={s.closureDecisionChip}>
                                {item.label}
                              </span>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            <div style={s.clientContactPanel}>
              <div style={s.clientContactHeader}>
                <div>
                  <div style={s.detailOpsEyebrow}>Kontakt z klientem</div>
                  <div style={s.clientContactTitle}>{detailContactOption.label}</div>
                </div>
                <div style={s.clientContactMeta}>
                  <span>Ostatnio: {formatContactStamp(detailContact.updatedAt)}</span>
                  {detailContact.dueAt ? <span>{detailFollowupMeta.label}</span> : null}
                  {detailContact.actor ? <strong>{detailContact.actor}</strong> : null}
                </div>
              </div>
              <div style={s.contactStatusGrid}>
                {CLIENT_CONTACT_STATUSES.map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    style={{
                      ...s.contactStatusBtn,
                      ...(detailContactOption.key === option.key ? s.contactStatusBtnActive : {}),
                    }}
                    onClick={() => markClientContactStatus(wybraneZlecenie, option.key)}
                  >
                    <span style={{ ...s.contactDot, ...s[`contactDot_${option.tone}`] }} />
                    {option.label}
                  </button>
                ))}
              </div>
              <textarea
                value={contactDraft}
                onChange={(event) => setContactDraft(event.target.value)}
                style={s.contactTextarea}
                placeholder="Ostatnia rozmowa, ustalenia, obietnica oddzwonienia..."
              />
              <div style={s.contactFollowupPanel}>
                <div style={s.contactFollowupHeader}>
                  <div>
                    <div style={s.detailOpsEyebrow}>Termin follow-upu</div>
                    <div style={{ ...s.contactFollowupTitle, ...(detailFollowupMeta.overdue ? s.contactFollowupTitleDanger : {}) }}>
                      {detailFollowupMeta.label}
                    </div>
                  </div>
                  <div style={s.contactFollowupQuick}>
                    <button type="button" style={s.followupBtn} onClick={() => setContactDuePreset(wybraneZlecenie, 0)}>Dziś</button>
                    <button type="button" style={s.followupBtn} onClick={() => setContactDuePreset(wybraneZlecenie, 1)}>Jutro</button>
                    <button type="button" style={s.followupBtn} onClick={() => setContactDuePreset(wybraneZlecenie, 2)}>Za 2 dni</button>
                    <button type="button" style={{ ...s.followupBtn, ...s.followupClearBtn }} onClick={() => clearContactDue(wybraneZlecenie)}>Wyczyść</button>
                  </div>
                </div>
                <div style={s.contactFollowupInputRow}>
                  <input
                    type="datetime-local"
                    value={contactDueDraft}
                    onChange={(event) => setContactDueDraft(event.target.value)}
                    style={s.contactFollowupInput}
                  />
                  <button type="button" style={s.bulkBtn} onClick={() => saveContactDue(wybraneZlecenie)}>
                    Zapisz termin
                  </button>
                </div>
              </div>
              <div style={s.clientContactActions}>
                <button type="button" style={s.bulkBtn} onClick={() => saveContactNote(wybraneZlecenie)}>
                  Zapisz notatkę
                </button>
                <button type="button" style={s.bulkBtn} onClick={() => copyClientMessage(wybraneZlecenie)}>
                  Skopiuj SMS
                </button>
                <button type="button" style={s.bulkBtnSecondary} onClick={() => markPreparedSms(wybraneZlecenie)}>
                  Po SMS: czeka
                </button>
              </div>
              {Array.isArray(detailContact.history) && detailContact.history.length > 0 ? (
                <div style={s.contactHistory}>
                  <div style={s.contactHistoryTitle}>Historia kontaktu</div>
                  {detailContact.history.slice(0, 4).map((event) => {
                    const option = getClientContactOption(event.status);
                    return (
                      <div key={event.id || `${event.status}-${event.created_at}`} style={s.contactHistoryItem}>
                        <span style={{ ...s.contactDot, ...s[`contactDot_${option.tone}`] }} />
                        <div style={s.contactHistoryBody}>
                          <div style={s.contactHistoryTop}>
                            <strong>{option.label}</strong>
                            <span>{formatContactStamp(event.created_at || event.updated_at)}</span>
                          </div>
                          <div style={s.contactHistoryMeta}>
                            {event.actor || 'Operator'}{event.due_at ? ` · follow-up: ${formatContactStamp(event.due_at)}` : ''}{event.note ? ` · ${event.note}` : ''}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </div>

            <div style={s.twoCol}>
              <div style={s.card}>
                <div style={s.cardTitle}>Dane klienta</div>
                {[['Klient', wybraneZlecenie.klient_nazwa], ['Telefon', wybraneZlecenie.klient_telefon, 'tel'],
                  ['Email', wybraneZlecenie.klient_email], ['Adres', wybraneZlecenie.adres],
                  ['Miasto', wybraneZlecenie.miasto]].map(([l, v, kind]) => v ? (
                  <div key={l} style={s.detailRow}>
                    <span style={s.detailLabel}>{l}</span>
                    <span style={s.detailValue}>
                      {kind === 'tel' && telHref(v) ? (
                        <a href={telHref(v)} style={{ color: 'var(--accent)', fontWeight: 600, textDecoration: 'none' }}>{v}</a>
                      ) : (
                        v
                      )}
                    </span>
                  </div>
                ) : null)}
              </div>
              <div style={s.card}>
                <div style={s.cardTitle}>Planowanie</div>
                {[['Typ usługi', wybraneZlecenie.typ_uslugi], ['Status', wybraneZlecenie.status],
                  ['Priorytet', wybraneZlecenie.priorytet],
                  ['Data planowana', wybraneZlecenie.data_planowana ? wybraneZlecenie.data_planowana.split('T')[0] : null],
                  ['Czas planowany', wybraneZlecenie.czas_planowany_godziny ? wybraneZlecenie.czas_planowany_godziny + ' h' : null],
                  ['Ekipa', wybraneZlecenie.ekipa_nazwa]].map(([l, v]) => v ? (
                  <div key={l} style={s.detailRow}>
                    <span style={s.detailLabel}>{l}</span><span style={s.detailValue}>{v}</span>
                  </div>
                ) : null)}
              </div>
            </div>
 
            <div style={s.card}>
              <div style={s.cardTitle}>Specyfikacja pracy</div>
              {wybraneZlecenie.opis_pracy && (
                <div style={{ marginBottom: 16, padding: '12px 14px', backgroundColor: 'var(--bg-card)', borderRadius: 8, fontSize: 14 }}>
                  <strong>1. Opis pracy:</strong> {wybraneZlecenie.opis_pracy}
                </div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
                <div style={{ backgroundColor: 'var(--bg-card)', borderRadius: 10, padding: 14 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 'bold', color: 'var(--accent)', marginBottom: 10, paddingBottom: 6, borderBottom: '1px solid var(--border)' }}>
                    <RouteOutlined style={{ fontSize: 16 }} aria-hidden />
                    Logistyka
                  </div>
                  {[['2. Wywóz', wybraneZlecenie.wywoz], ['3. Usuwanie pni', wybraneZlecenie.usuwanie_pni]].map(([l, v]) => (
                    <div key={l} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                      <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{l}</span>
                      <span style={{ fontSize: 13, fontWeight: '600', color: v ? 'var(--accent)' : '#EF5350' }}>{v ? t('common.yes') : t('common.no')}</span>
                    </div>
                  ))}
                  {wybraneZlecenie.czas_realizacji_godz && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                      <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>4. Czas realizacji</span>
                      <span style={{ fontSize: 13 }}>{wybraneZlecenie.czas_realizacji_godz} h</span>
                    </div>
                  )}
                  {wybraneZlecenie.ilosc_osob && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0' }}>
                      <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>9. Ilość osób</span>
                      <span style={{ fontSize: 13 }}>{wybraneZlecenie.ilosc_osob}</span>
                    </div>
                  )}
                </div>
                <div style={{ backgroundColor: 'var(--bg-card)', borderRadius: 10, padding: 14 }}>
                  <div style={{ fontSize: 13, fontWeight: 'bold', color: 'var(--accent)', marginBottom: 10, paddingBottom: 6, borderBottom: '1px solid var(--border)' }}>Sprzęt</div>
                  {[['6. Rębak', wybraneZlecenie.rebak], ['7. Piła na wysięgniku', wybraneZlecenie.pila_wysiegniku],
                    ['8. Nożyce długie', wybraneZlecenie.nozyce_dlugie], ['16. Arborysta', wybraneZlecenie.arborysta],
                    ['17. Kosiarka', wybraneZlecenie.kosiarka], ['18. Podkaszarka', wybraneZlecenie.podkaszarka],
                    ['19. Łopata', wybraneZlecenie.lopata], ['20. Mulczer', wybraneZlecenie.mulczer]].map(([l, v]) => (
                    <div key={l} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                      <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{l}</span>
                      <span style={{ fontSize: 13, fontWeight: '600', color: v ? 'var(--accent)' : '#EF5350' }}>{v ? t('common.yes') : t('common.no')}</span>
                    </div>
                  ))}
                </div>
                <div style={{ backgroundColor: 'var(--bg-card)', borderRadius: 10, padding: 14 }}>
                  <div style={{ fontSize: 13, fontWeight: 'bold', color: 'var(--accent)', marginBottom: 10, paddingBottom: 6, borderBottom: '1px solid var(--border)' }}>Finanse</div>
                  {[['11. Budżet', formatCurrency(wybraneZlecenie.budzet)],
                    ['12. Rabat', wybraneZlecenie.rabat ? wybraneZlecenie.rabat + '%' : null],
                    ['13. Kwota minimalna', formatCurrency(wybraneZlecenie.kwota_minimalna)],
                    ['Wartość zlecenia', formatCurrency(wybraneZlecenie.wartosc_planowana)],
                    ['14. Zrębki (m³)', wybraneZlecenie.zrebki],
                    ['15. Drewno', wybraneZlecenie.drzewno]].map(([l, v]) => v && v !== '—' ? (
                    <div key={l} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                      <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{l}</span>
                      <span style={{ fontSize: 13, fontWeight: '600', color: 'var(--accent)' }}>{v}</span>
                    </div>
                  ) : null)}
                  {wybraneZlecenie.wynik && (
                    <div style={{ marginTop: 10, padding: '8px 10px', backgroundColor: 'var(--bg-deep)', borderRadius: 6, fontSize: 13 }}>
                      <strong>10. Wynik:</strong> {wybraneZlecenie.wynik}
                    </div>
                  )}
                </div>
              </div>
              {wybraneZlecenie.notatki && (
                <div style={{ marginTop: 16, padding: '12px 14px', backgroundColor: 'var(--bg-deep)', borderRadius: 8, fontSize: 14, borderLeft: '3px solid #F9A825' }}>
                  <strong>Notatki:</strong> {wybraneZlecenie.notatki}
                </div>
              )}
            </div>
          </>
        )}
 
        {/* ══ FORMULARZ NOWY / EDYTUJ ══ */}
        {(tryb === 'nowy' || tryb === 'edytuj') && (
          <>
            <PageHeader
              variant="plain"
              back={{
                onClick: () => setTryb(wybraneZlecenie ? 'szczegoly' : 'lista'),
                label: t('common.back'),
              }}
              title={tryb === 'nowy' ? t('common.newOrder') : `${t('common.edit')} #${wybraneZlecenie?.id}`}
              icon={<AssignmentOutlined style={{ fontSize: 26 }} />}
            />

            <div style={s.formWizardPanel}>
              <div style={s.formWizardHeader}>
                <div>
                  <div style={s.detailOpsEyebrow}>Wizard zlecenia</div>
                  <div style={s.formWizardTitle}>{currentFormStep.label}</div>
                  <div style={s.formWizardSubtitle}>{currentFormStep.detail}</div>
                </div>
                <span style={s.formWizardProgress}>{formStepIndex + 1}/{FORM_STEPS.length}</span>
              </div>
              <div style={s.formWizardSteps}>
                {FORM_STEPS.map((step, index) => (
                  <button
                    key={step.key}
                    type="button"
                    onClick={() => setFormStepSafe(step.key)}
                    style={{
                      ...s.formWizardStep,
                      ...(formStep === step.key ? s.formWizardStepActive : {}),
                      ...(index < formStepIndex ? s.formWizardStepDone : {}),
                    }}
                  >
                    <span style={s.formWizardStepNo}>{index + 1}</span>
                    <span style={s.formWizardStepText}>
                      <strong>{step.label}</strong>
                      <small>{step.detail}</small>
                    </span>
                  </button>
                ))}
              </div>
              <div style={s.formFlowPanel}>
                <div style={s.formFlowHeader}>
                  <span>Jedna ścieżka zlecenia</span>
                  <strong>{formWorkflowStage.label}</strong>
                </div>
                <div style={s.formFlowSteps}>
                  {FORM_WORKFLOW_STEPS.map((step, index) => (
                    <div
                      key={step.status}
                      style={{
                        ...s.formFlowStep,
                        ...(index < formWorkflowStageIndex ? s.formFlowStepDone : {}),
                        ...(index === formWorkflowStageIndex ? s.formFlowStepActive : {}),
                      }}
                    >
                      <span style={{ ...s.formFlowStepNo, borderColor: getStatusColor(step.status) }}>{step.step}</span>
                      <span style={s.formFlowStepText}>
                        <strong>{step.label}</strong>
                        <small>{step.detail}</small>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
 
            <div style={{ ...s.card, display: formStep === 'client' ? undefined : 'none' }}>
              <div style={s.cardTitle}>Dane klienta</div>
              <div style={s.formGrid}>
                <div style={s.fg}><label style={s.label}>Nazwa klienta *</label>
                  <input style={s.input} placeholder="Imię i nazwisko / firma" value={form.klient_nazwa} onChange={e => setField('klient_nazwa', e.target.value)} /></div>
                <div style={s.fg}><label style={s.label}>Telefon</label>
                  <input style={s.input} placeholder="+48 000 000 000" value={form.klient_telefon} onChange={e => setField('klient_telefon', e.target.value)} /></div>
                <div style={s.fg}><label style={s.label}>Email</label>
                  <input style={s.input} type="email" value={form.klient_email} onChange={e => setField('klient_email', e.target.value)} /></div>
                <div style={s.fg}><label style={s.label}>Adres realizacji</label>
                  <input style={s.input} placeholder="ul. Przykładowa 1" value={form.adres} onChange={e => setField('adres', e.target.value)} /></div>
                <div style={s.fg}><label style={s.label}>Miasto</label>
                  <CityInput
                    style={s.input}
                    placeholder="Warszawa"
                    value={form.miasto}
                    onChange={e => setField('miasto', e.target.value)}
                    extraCities={zlecenia.map((z) => z.miasto)}
                  />
                </div>
              </div>
            </div>
 
            <div style={{ ...s.card, display: formStep === 'planning' ? undefined : 'none' }}>
              <div style={s.cardTitle}>Planowanie</div>
              <div style={s.formGrid}>
                <div style={s.fg}><label style={s.label}>Typ usługi</label>
                  <select style={s.input} value={form.typ_uslugi} onChange={e => setField('typ_uslugi', e.target.value)}>
                    {TASK_SERVICE_TYPES.map((type) => (
                      <option key={type} value={type}>{t(`serviceType.${type}`, { defaultValue: type })}</option>
                    ))}
                  </select></div>
                <div style={s.fg}><label style={s.label}>Status</label>
                  <select style={s.input} value={form.status} onChange={e => handleFormStatusChange(e.target.value)}>
                    {formStatusOptions.map((status) => (
                      <option key={status} value={status}>{t(`taskStatus.${status}`, { defaultValue: status })}</option>
                    ))}
                  </select>
                  {tryb !== 'nowy' ? (
                    <small style={s.formStatusHint}>Aktualny etap plus następny dozwolony krok. Reszta jest blokowana przez workflow.</small>
                  ) : null}
                </div>
                <div style={s.fg}><label style={s.label}>Oddział</label>
                  <select
                    style={s.input}
                    value={form.oddzial_id}
                    disabled={!canManageAllBranches && !!currentUser?.oddzial_id}
                    onChange={e => setForm(prev => ({
                      ...prev,
                      oddzial_id: e.target.value,
                      ekipa_id: '',
                      wyceniajacy_id: '',
                    }))}
                  >
                    <option value="">— wybierz oddział —</option>
                    {branchSelectOptions.map((oddzialId) => (
                      <option key={oddzialId} value={oddzialId}>Oddział #{oddzialId}</option>
                    ))}
                  </select></div>
                <div style={s.fg}><label style={s.label}>Wyceniacz / oględziny</label>
                  <select
                    style={s.input}
                    value={form.wyceniajacy_id}
                    onChange={e => setForm(prev => ({
                      ...prev,
                      wyceniajacy_id: e.target.value,
                      status: e.target.value && prev.status === TASK_STATUS.NOWE ? TASK_STATUS.WYCENA_TERENOWA : prev.status,
                    }))}
                  >
                    <option value="">— jeszcze nie przypisano —</option>
                    {estimatorOptions.map((u) => (
                      <option key={u.id} value={u.id}>{u.imie} {u.nazwisko}</option>
                    ))}
                  </select></div>
                <div style={s.fg}><label style={s.label}>Priorytet</label>
                  <select style={s.input} value={form.priorytet} onChange={e => setField('priorytet', e.target.value)}>
                    {TASK_PRIORITIES.map((priority) => (
                      <option key={priority} value={priority}>{priority}</option>
                    ))}
                  </select></div>
                <div style={s.fg}><label style={s.label}>Data planowana</label>
                  <input style={s.input} type="date" value={form.data_planowana} onChange={e => setField('data_planowana', e.target.value)} /></div>
                <div style={s.fg}><label style={s.label}>Godzina startu ekipy</label>
                  <input style={s.input} type="time" value={form.godzina_rozpoczecia} onChange={e => setField('godzina_rozpoczecia', e.target.value)} /></div>
                <div style={s.fg}><label style={s.label}>Ekipa</label>
                  <select style={s.input} value={form.ekipa_id} onChange={e => setField('ekipa_id', e.target.value)}>
                    <option value="">— brak —</option>
                    {teamOptions.map(e => <option key={e.id} value={e.id}>{e.nazwa}</option>)}
                  </select></div>
                <div style={s.fg}><label style={s.label}>Kierownik</label>
                  <select style={s.input} value={form.kierownik_id} onChange={e => setField('kierownik_id', e.target.value)}>
                    <option value="">— brak —</option>
                    {uzytkownicy.filter(u => u.rola === 'Kierownik' || u.rola === 'Dyrektor').map(u => (
                      <option key={u.id} value={u.id}>{u.imie} {u.nazwisko}</option>
                    ))}
                  </select></div>
              </div>
            </div>
 
            <div style={{ ...s.card, display: formStep === 'work' ? undefined : 'none' }}>
              <div style={s.cardTitle}>1. Opis pracy</div>
              <div style={s.inspectionPresetPanel}>
                <div style={s.inspectionPresetHead}>
                  <strong>Szybki zakres oględzin</strong>
                  <span>Klikasz typ pracy, a system dopisuje ten sam opis dla biura, wyceniacza i ekipy.</span>
                </div>
                <div style={s.inspectionPresetGrid}>
                  {TASK_SCOPE_PRESETS.map((preset) => (
                    <button
                      key={preset.key}
                      type="button"
                      style={{
                        ...s.inspectionChip,
                        ...(form.opis_pracy?.includes(preset.scopeLine) ? s.inspectionChipActive : {}),
                      }}
                      onClick={() => applyScopePreset(preset)}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>
              <textarea style={{ ...s.input, minHeight: 80, resize: 'vertical', width: '100%', boxSizing: 'border-box' }}
                placeholder="np. Przycinanie żywopłotu i drzew, usuwanie gałęzi..."
                value={form.opis_pracy} onChange={e => setField('opis_pracy', e.target.value)} />
            </div>
 
            <div style={{ ...s.twoCol, display: formStep === 'work' ? 'grid' : 'none' }}>
              <div style={s.card}>
                <div style={s.cardTitle}>2–5. Logistyka i zasoby</div>
                <TakNie label="2. Wywóz" field="wywoz" form={form} onChange={setField} />
                <TakNie label="3. Usuwanie pni" field="usuwanie_pni" form={form} onChange={setField} />
                <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div style={s.fg}><label style={s.label}>4. Czas realizacji (godziny)</label>
                    <input style={s.input} type="number" min="0" step="0.5" placeholder="np. 5"
                      value={form.czas_realizacji_godz} onChange={e => setField('czas_realizacji_godz', e.target.value)} /></div>
                  <div style={s.fg}><label style={s.label}>9. Ilość osób do realizacji</label>
                    <input style={s.input} type="number" min="1" placeholder="np. 3"
                      value={form.ilosc_osob} onChange={e => setField('ilosc_osob', e.target.value)} /></div>
                </div>
                <div style={{ marginTop: 8 }}>
                  <TakNie label="16. Arborysta" field="arborysta" form={form} onChange={setField} />
                </div>
              </div>
 
              <div style={s.card}>
                <div style={s.cardTitle}>5–8. Cechy pracy / sprzęt</div>
                <div style={s.inspectionPresetGrid}>
                  {TASK_EQUIPMENT_OPTIONS.map((preset) => (
                    <button
                      key={preset.key}
                      type="button"
                      style={{
                        ...s.inspectionChip,
                        ...(form[preset.field] ? s.inspectionChipActive : {}),
                      }}
                      onClick={() => toggleEquipmentPreset(preset)}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
                <TakNie label="6. Rębak" field="rebak" form={form} onChange={setField} />
                <TakNie label="7. Piła na wysięgniku" field="pila_wysiegniku" form={form} onChange={setField} />
                <TakNie label="8. Nożyce długie" field="nozyce_dlugie" form={form} onChange={setField} />
                <TakNie label="17. Kosiarka" field="kosiarka" form={form} onChange={setField} />
                <TakNie label="18. Podkaszarka" field="podkaszarka" form={form} onChange={setField} />
                <TakNie label="19. Łopata" field="lopata" form={form} onChange={setField} />
                <TakNie label="20. Mulczer" field="mulczer" form={form} onChange={setField} />
              </div>
            </div>

            <div style={{ ...s.card, display: formStep === 'work' ? undefined : 'none' }}>
              <div style={s.cardTitle}>Ryzyka BHP / dojazd</div>
              <div style={s.inspectionPresetGrid}>
                {TASK_RISK_PRESETS.map((preset) => (
                  <button
                    key={preset.key}
                    type="button"
                    style={{
                      ...s.inspectionChip,
                      ...(form.notatki?.includes(preset.note) ? s.inspectionChipActive : {}),
                    }}
                    onClick={() => appendRiskPreset(preset)}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>
 
            <div style={{ ...s.card, display: formStep === 'finance' ? undefined : 'none' }}>
              <div style={s.cardTitle}>10–15. Wynik i finanse</div>
              <div style={s.inspectionPresetPanel}>
                <div style={s.inspectionPresetHead}>
                  <strong>Warunki rozliczenia</strong>
                  <span>Jedna notatka dla biura i kierownika, żeby później nie zgadywać, co uzgodniono z klientem.</span>
                </div>
                <div style={s.inspectionPresetGrid}>
                  {TASK_SETTLEMENT_OPTIONS.map((preset) => (
                    <button
                      key={preset.key}
                      type="button"
                      style={{
                        ...s.inspectionChip,
                        ...(form.notatki?.includes(preset.note) ? s.inspectionChipActive : {}),
                      }}
                      onClick={() => applySettlementPreset(preset)}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>
              <div style={s.formGrid}>
                <div style={{ ...s.fg, gridColumn: '1 / -1' }}><label style={s.label}>10. Wynik rozmowy z klientem</label>
                  <input style={s.input} placeholder="np. Klient zgadza się na wykonanie robót. Trzeba ustalić termin."
                    value={form.wynik} onChange={e => setField('wynik', e.target.value)} /></div>
                <div style={s.fg}><label style={s.label}>11. Budżet (PLN)</label>
                  <input style={s.input} type="number" step="0.01" placeholder="0.00" value={form.budzet} onChange={e => setField('budzet', e.target.value)} /></div>
                <div style={s.fg}><label style={s.label}>12. Rabat (%)</label>
                  <input style={s.input} type="number" min="0" max="100" step="0.1" placeholder="0" value={form.rabat} onChange={e => setField('rabat', e.target.value)} /></div>
                <div style={s.fg}><label style={s.label}>13. Kwota minimalna (PLN)</label>
                  <input style={s.input} type="number" step="0.01" placeholder="0.00" value={form.kwota_minimalna} onChange={e => setField('kwota_minimalna', e.target.value)} /></div>
                <div style={s.fg}><label style={s.label}>Wartość zlecenia (PLN)</label>
                  <input style={s.input} type="number" step="0.01" placeholder="0.00" value={form.wartosc_planowana} onChange={e => setField('wartosc_planowana', e.target.value)} /></div>
                <div style={s.fg}><label style={s.label}>14. Zrębki (m³)</label>
                  <input style={s.input} type="number" min="0" step="0.1" placeholder="0" value={form.zrebki} onChange={e => setField('zrebki', e.target.value)} /></div>
                <div style={s.fg}><label style={s.label}>15. Drewno</label>
                  <input style={s.input} placeholder="np. 2 mp" value={form.drzewno} onChange={e => setField('drzewno', e.target.value)} /></div>
                <div style={s.fg}><label style={s.label}>Czas planowany (h)</label>
                  <input style={s.input} type="number" step="0.5" placeholder="0" value={form.czas_planowany_godziny} onChange={e => setField('czas_planowany_godziny', e.target.value)} /></div>
              </div>
            </div>
 
            <div style={{ ...s.card, display: formStep === 'finance' ? undefined : 'none' }}>
              <div style={s.cardTitle}>Notatki dodatkowe</div>
              <textarea style={{ ...s.input, minHeight: 80, resize: 'vertical', width: '100%', boxSizing: 'border-box' }}
                placeholder="Dodatkowe uwagi..." value={form.notatki} onChange={e => setField('notatki', e.target.value)} />
            </div>

            {formStep === 'media' && (
              <TaskPhotosPanel
                styles={s}
                title="Dowody z oględzin dla ekipy i biura"
                subtitle="Zdjęcia, szkice i adnotacje z terenu trafiają prosto do zlecenia."
                taskId={wybraneZlecenie?.id}
                photos={selectedTaskPhotos}
                loading={taskPhotosLoading}
                uploading={uploadingTaskPhoto}
                draft={taskPhotoDraft}
                inputRef={taskPhotoInputRef}
                onDraftChange={setTaskPhotoDraft}
                onPickFiles={uploadTaskPhotos}
                onDraw={openTaskDraw}
                onDelete={mozeEdytowac ? deleteTaskPhoto : null}
                onSaveDraft={zapiszDraftIDodajZdjecia}
              />
            )}

            {formStep === 'summary' && (
              <div style={s.formSummaryGrid}>
                <div style={s.formSummaryCard}>
                  <span style={s.detailDecisionLabel}>Klient</span>
                  <strong>{form.klient_nazwa || 'Brak nazwy klienta'}</strong>
                  <small>{form.klient_telefon || 'Brak telefonu'}</small>
                  <small>{[form.adres, form.miasto].filter(Boolean).join(', ') || 'Brak adresu realizacji'}</small>
                </div>
                <div style={s.formSummaryCard}>
                  <span style={s.detailDecisionLabel}>Plan operacyjny</span>
                  <strong>{form.typ_uslugi || 'Typ usługi nieustalony'}</strong>
                  <small>{form.data_planowana ? `Termin: ${form.data_planowana}${form.godzina_rozpoczecia ? ` ${form.godzina_rozpoczecia}` : ''}` : 'Brak terminu'}</small>
                  <small>{formPreviewTask.ekipa_nazwa || 'Brak ekipy'} | {form.ilosc_osob || '0'} os.</small>
                </div>
                <div style={{ ...s.formSummaryCard, ...s[`detailPriceBox_${formPreviewPrice.tone}`] }}>
                  <span style={s.detailDecisionLabel}>Finanse</span>
                  <strong>{formPreviewPrice.label}</strong>
                  <small>Wartość: {formatCurrencyZero(formPreviewMeta.value)}</small>
                  <small>{formPreviewPrice.detail}</small>
                </div>
                <div style={s.formSummaryCard}>
                  <span style={s.detailDecisionLabel}>BHP i gotowość</span>
                  <strong>{formPreviewSafetyRequired.length ? `${formPreviewSafetyRequired.length} rzeczy do poprawy` : 'Gotowe do zapisu'}</strong>
                  <div style={s.formSummaryChecks}>
                    {formPreviewSafety.slice(0, 5).map((item) => (
                      <span
                        key={item.key}
                        style={{
                          ...s.formSummaryCheck,
                          ...(item.ok ? s.detailChecklistOk : item.required ? s.detailChecklistDanger : s.detailChecklistWarn),
                        }}
                      >
                        {item.ok ? 'OK' : item.required ? 'Wymagane' : 'Uwaga'}: {item.label}
                      </span>
                    ))}
                  </div>
                </div>
                <div style={s.formSummaryCard}>
                  <span style={s.detailDecisionLabel}>Zdjęcia terenowe</span>
                  <strong>{fieldPhotoCount ? `${fieldPhotoCount} dowodów z wyceny` : 'Brak zdjęć z wyceny'}</strong>
                  <small>{selectedTaskPhotos.length ? `Łącznie zdjęć: ${selectedTaskPhotos.length}` : 'Dodaj zdjęcia lub szkic, żeby ekipa widziała dokładny zakres.'}</small>
                  <button type="button" style={s.taskPhotosBtnSecondary} onClick={() => setFormStepSafe('media')}>
                    Przejdź do zdjęć
                  </button>
                </div>
              </div>
            )}
 
            <div style={s.formWizardActions}>
              <button
                type="button"
                style={{ ...s.btnGray, ...(isFirstFormStep ? s.formWizardBtnDisabled : {}) }}
                onClick={goPrevFormStep}
                disabled={isFirstFormStep}
              >
                Wstecz
              </button>
              {isLastFormStep ? (
                <button type="button" style={s.btnPrimary} onClick={() => zapiszZlecenie()}>
                  {tryb === 'nowy' ? t('pages.zlecenia.submitCreate') : t('pages.zlecenia.submitSave')}
                </button>
              ) : (
                <button type="button" style={s.btnPrimary} onClick={goNextFormStep}>
                  Dalej
                </button>
              )}
              <button type="button" style={s.btnGray} onClick={() => setTryb(wybraneZlecenie ? 'szczegoly' : 'lista')}>{t('common.cancel')}</button>
            </div>
          </>
        )}
      </div>
      </main>
    </div>
  );
}
 
const s = {
  main: { flex: 1, minWidth: 0, overflowX: 'hidden', position: 'relative' },
  headerRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, flexWrap: 'wrap', gap: 12 },
  breadcrumb: { display: 'flex', alignItems: 'center', gap: 12 },
  title: { fontSize: 'clamp(22px, 5vw, 28px)', fontWeight: 'bold', color: 'var(--accent)', margin: 0 },
  sub: { color: 'var(--text-muted)', marginTop: 4, fontSize: 14 },
  backBtn: { padding: '6px 14px', backgroundColor: 'var(--bg-deep)', color: 'var(--accent)', border: '1px solid #A5D6A7', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: '500' },
  filtryRow: {
    display: 'flex', gap: 10, marginBottom: 20, alignItems: 'center',
    background: 'linear-gradient(135deg, var(--glass-bg-strong), var(--glass-bg))',
    padding: '12px 14px', borderRadius: 8, border: '1px solid var(--glass-border)',
    boxShadow: 'var(--shadow-sm)', flexWrap: 'wrap'
  },
  searchInput: { padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 13, minWidth: 220, flex: 1, backgroundColor: 'var(--input-bg)' },
  filtrInput: { padding: '9px 10px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 13, backgroundColor: 'var(--input-bg)', color: 'var(--text)' },
  clearBtn: { padding: '8px 13px', backgroundColor: 'rgba(248,113,113,0.12)', color: 'var(--danger)', border: '1px solid rgba(248,113,113,0.3)', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 800 },
  countBadge: { fontSize: 12, color: 'var(--accent)', marginLeft: 'auto', whiteSpace: 'nowrap', border: '1px solid var(--border2)', borderRadius: 8, padding: '6px 9px', backgroundColor: 'var(--accent-surface)', fontWeight: 900 },
  commandPanel: {
    border: '1px solid var(--border2)',
    borderRadius: 8,
    background: 'linear-gradient(135deg, var(--bg-card), var(--bg-card2))',
    backgroundImage: 'linear-gradient(135deg, var(--bg-card), var(--bg-card2)), repeating-linear-gradient(135deg, rgba(255,255,255,0.025) 0 1px, transparent 1px 22px)',
    padding: 16,
    marginBottom: 12,
    boxShadow: 'var(--shadow-md)',
    overflow: 'hidden',
  },
  commandHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
    flexWrap: 'wrap',
    marginBottom: 12,
  },
  commandEyebrow: {
    fontSize: 11,
    fontWeight: 800,
    color: 'var(--text-muted)',
    textTransform: 'uppercase',
    letterSpacing: 0,
  },
  commandTitle: {
    marginTop: 3,
    fontSize: 16,
    color: 'var(--text)',
    fontWeight: 900,
    lineHeight: 1.25,
  },
  commandActions: { display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' },
  commandStats: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
    gap: 8,
    marginBottom: 12,
  },
  commandStat: {
    display: 'grid',
    gap: 8,
    padding: '10px 11px',
    border: '1px solid var(--border)',
    borderRadius: 8,
    background: 'linear-gradient(180deg, var(--bg-deep), rgba(255,255,255,0.015))',
    color: 'var(--text-muted)',
    fontSize: 12,
    fontWeight: 700,
  },
  commandStatStrong: {
    color: 'var(--text)',
    fontSize: 20,
    lineHeight: 1,
    fontWeight: 950,
    fontVariantNumeric: 'tabular-nums',
  },
  quickCallPanel: {
    border: '1px solid var(--glass-border)',
    borderRadius: 8,
    background: 'linear-gradient(135deg, rgba(34,197,94,0.11), var(--glass-bg))',
    padding: 12,
    marginBottom: 12,
    boxShadow: 'var(--shadow-sm)',
    scrollMarginTop: 18,
    transition: 'border-color 0.2s ease, box-shadow 0.2s ease, background 0.2s ease',
  },
  quickCallPanelFocused: {
    borderColor: 'var(--accent)',
    background: 'linear-gradient(135deg, rgba(34,197,94,0.2), var(--glass-bg-strong))',
    boxShadow: '0 0 0 3px rgba(34,197,94,0.18), var(--shadow-md)',
  },
  quickCallHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
    flexWrap: 'wrap',
    marginBottom: 10,
  },
  quickCallTitle: {
    color: 'var(--text)',
    fontSize: 15,
    fontWeight: 950,
    marginTop: 2,
    lineHeight: 1.25,
  },
  quickCallStatus: {
    display: 'inline-flex',
    alignItems: 'center',
    minHeight: 30,
    border: '1px solid rgba(52,211,153,0.35)',
    borderRadius: 8,
    backgroundColor: 'var(--accent-surface)',
    color: 'var(--accent)',
    padding: '5px 9px',
    fontSize: 11,
    fontWeight: 950,
  },
  quickCallGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: 10,
  },
  quickCallFooter: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    flexWrap: 'wrap',
    marginTop: 10,
    paddingTop: 10,
    borderTop: '1px solid var(--border)',
    color: 'var(--text-muted)',
    fontSize: 12,
    fontWeight: 750,
  },
  quickCallActions: {
    display: 'flex',
    gap: 8,
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
  },
  workflowLanePanel: {
    border: '1px solid var(--glass-border)',
    borderRadius: 8,
    background: 'linear-gradient(135deg, rgba(30,111,74,0.14), var(--glass-bg))',
    padding: 12,
    marginBottom: 12,
    boxShadow: 'var(--shadow-sm)',
  },
  workflowLaneHeader: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    flexWrap: 'wrap',
    marginBottom: 10,
  },
  workflowLaneTitle: {
    color: 'var(--text)',
    fontSize: 15,
    lineHeight: 1.25,
    fontWeight: 950,
    marginTop: 2,
  },
  workflowLaneHint: {
    color: 'var(--text-muted)',
    fontSize: 12,
    fontWeight: 800,
    maxWidth: 260,
    lineHeight: 1.35,
  },
  advancedOpsHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    flexWrap: 'wrap',
    border: '1px solid var(--border)',
    borderRadius: 8,
    background: 'rgba(0,0,0,0.1)',
    padding: '10px 12px',
    marginBottom: 12,
  },
  advancedOpsTitle: {
    display: 'block',
    color: 'var(--text)',
    fontSize: 13,
    fontWeight: 950,
  },
  advancedOpsText: {
    display: 'block',
    color: 'var(--text-muted)',
    fontSize: 12,
    fontWeight: 720,
    lineHeight: 1.35,
    marginTop: 2,
  },
  activeFilterBanner: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    flexWrap: 'wrap',
    border: '1px solid var(--accent)',
    borderRadius: 8,
    background: 'var(--accent-surface)',
    color: 'var(--text)',
    padding: '9px 11px',
    marginBottom: 12,
    fontSize: 12,
    fontWeight: 850,
  },
  opsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(128px, 1fr))',
    gap: 8,
    marginBottom: 12,
  },
  opsCard: {
    minHeight: 92,
    border: '1px solid var(--glass-border)',
    borderRadius: 8,
    background: 'linear-gradient(150deg, var(--glass-bg-strong), var(--glass-bg))',
    color: 'var(--text)',
    padding: '10px 11px',
    textAlign: 'left',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between',
    gap: 5,
    boxShadow: 'var(--shadow-sm)',
  },
  opsCard_green: { border: '1px solid rgba(120,242,173,0.24)' },
  opsCard_blue: { border: '1px solid rgba(91,192,235,0.24)' },
  opsCard_warning: { border: '1px solid rgba(242,184,75,0.32)' },
  opsCard_danger: { border: '1px solid rgba(248,113,113,0.34)' },
  opsCardLabel: {
    color: 'var(--text-muted)',
    fontSize: 10,
    fontWeight: 950,
    textTransform: 'uppercase',
    lineHeight: 1.15,
  },
  opsCardValue: {
    color: 'var(--text)',
    fontSize: 20,
    fontWeight: 950,
    lineHeight: 1.05,
    fontVariantNumeric: 'tabular-nums',
    overflowWrap: 'anywhere',
  },
  opsCardDetail: {
    color: 'var(--accent)',
    fontSize: 11,
    fontWeight: 850,
    lineHeight: 1.25,
  },
  dispatchReadinessStrip: {
    border: '1px solid var(--glass-border)',
    borderRadius: 8,
    background: 'linear-gradient(135deg, rgba(30,111,74,0.12), var(--glass-bg))',
    padding: '11px 12px',
    marginBottom: 12,
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))',
    gap: 12,
    alignItems: 'center',
  },
  dispatchReadinessEyebrow: {
    color: 'var(--text-muted)',
    fontSize: 10,
    fontWeight: 950,
    textTransform: 'uppercase',
    letterSpacing: 0,
  },
  dispatchReadinessTitle: {
    display: 'block',
    marginTop: 3,
    color: 'var(--text)',
    fontSize: 13,
    fontWeight: 950,
    lineHeight: 1.25,
  },
  dispatchReadinessItems: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(116px, 1fr))',
    gap: 7,
  },
  dispatchReadinessItem: {
    border: '1px solid var(--border)',
    borderRadius: 8,
    backgroundColor: 'var(--bg-card)',
    color: 'var(--text)',
    padding: '8px 9px',
    cursor: 'pointer',
    display: 'grid',
    gridTemplateColumns: '1fr auto',
    gap: '2px 8px',
    alignItems: 'center',
    textAlign: 'left',
    minHeight: 54,
  },
  dispatchReadinessItemActive: {
    border: '1px solid var(--accent)',
    boxShadow: '0 0 0 2px rgba(48,128,86,0.12)',
  },
  dispatchReadinessItemBlocked: {
    border: '1px solid rgba(242,184,75,0.38)',
    backgroundColor: 'rgba(251,191,36,0.1)',
  },
  dispatchReadinessLabel: {
    color: 'var(--text-muted)',
    fontSize: 10,
    fontWeight: 950,
    textTransform: 'uppercase',
  },
  dispatchReadinessCount: {
    color: 'var(--text)',
    fontSize: 18,
    fontWeight: 950,
    fontVariantNumeric: 'tabular-nums',
  },
  dispatchReadinessHint: {
    gridColumn: '1 / -1',
    color: 'var(--text-sub)',
    fontSize: 11,
    fontWeight: 800,
    overflowWrap: 'anywhere',
  },
  savedViews: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
    gap: 8,
  },
  savedViewBtn: {
    display: 'grid',
    gridTemplateColumns: '1fr auto',
    gridTemplateRows: 'auto auto',
    gap: '2px 8px',
    alignItems: 'center',
    textAlign: 'left',
    border: '1px solid var(--border)',
    borderRadius: 8,
    background: 'rgba(0,0,0,0.16)',
    color: 'var(--text)',
    padding: '10px 11px',
    cursor: 'pointer',
    minHeight: 62,
  },
  savedViewBtnActive: {
    border: '1px solid var(--accent)',
    background: 'linear-gradient(90deg, var(--accent-surface), rgba(255,255,255,0.02))',
    boxShadow: 'inset 3px 0 0 var(--accent)',
  },
  savedViewLabel: { fontSize: 13, fontWeight: 800 },
  savedViewMeta: { fontSize: 11, color: 'var(--text-muted)' },
  savedViewCount: {
    gridRow: '1 / 3',
    gridColumn: 2,
    minWidth: 28,
    height: 28,
    borderRadius: 8,
    background: 'var(--bg-card)',
    border: '1px solid var(--border)',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 13,
    fontWeight: 800,
    fontVariantNumeric: 'tabular-nums',
  },
  commandTabs: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: 8,
    marginTop: 12,
    paddingTop: 12,
    borderTop: '1px solid var(--border)',
  },
  commandTab: {
    border: '1px solid var(--border)',
    borderRadius: 8,
    background: 'var(--bg-deep)',
    color: 'var(--text-sub)',
    padding: '9px 10px',
    cursor: 'pointer',
    textAlign: 'left',
    display: 'grid',
    gap: 2,
    fontFamily: 'inherit',
  },
  commandTabActive: {
    border: '1px solid var(--accent)',
    background: 'var(--accent-surface)',
    color: 'var(--text)',
  },
  commandTabLabel: { fontSize: 13, fontWeight: 850 },
  commandTabDetail: { fontSize: 11, fontWeight: 650, color: 'var(--text-muted)' },
  dispatchPanel: {
    marginTop: 12,
    borderTop: '1px solid var(--border)',
    paddingTop: 12,
  },
  dispatchHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
    flexWrap: 'wrap',
    marginBottom: 10,
  },
  dispatchEyebrow: {
    fontSize: 11,
    fontWeight: 800,
    color: 'var(--text-muted)',
    textTransform: 'uppercase',
    letterSpacing: 0,
  },
  dispatchTitle: {
    marginTop: 3,
    fontSize: 13,
    color: 'var(--text)',
    fontWeight: 800,
  },
  sortTabs: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(145px, 1fr))',
    gap: 8,
    flex: '1 1 560px',
    maxWidth: 720,
  },
  sortTab: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    alignItems: 'flex-start',
    border: '1px solid var(--border)',
    borderRadius: 8,
    background: 'var(--bg-deep)',
    color: 'var(--text-sub)',
    padding: '7px 9px',
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 800,
    textAlign: 'left',
  },
  sortTabActive: {
    border: '1px solid var(--accent)',
    background: 'var(--accent-surface)',
    color: 'var(--accent)',
  },
  sortTabLabel: { fontSize: 12, fontWeight: 900, lineHeight: 1.2 },
  sortTabDetail: { fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.2 },
  queueList: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
    gap: 8,
  },
  queueItem: {
    display: 'grid',
    gridTemplateColumns: '34px 1fr auto',
    gap: 9,
    alignItems: 'center',
    border: '1px solid var(--border)',
    borderRadius: 8,
    background: 'var(--bg-deep)',
    color: 'var(--text)',
    padding: '8px 9px',
    cursor: 'pointer',
    textAlign: 'left',
  },
  queueRank: {
    width: 30,
    height: 30,
    borderRadius: 8,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'var(--bg-card)',
    border: '1px solid var(--border2)',
    color: 'var(--accent)',
    fontSize: 13,
    fontWeight: 900,
    fontVariantNumeric: 'tabular-nums',
  },
  queueBody: { minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 },
  queueTitle: { fontSize: 13, fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  queueMeta: { fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  queueValue: { fontSize: 12, color: 'var(--accent)', fontWeight: 900, whiteSpace: 'nowrap' },
  queueEmpty: {
    border: '1px dashed var(--border)',
    borderRadius: 8,
    padding: '12px 10px',
    color: 'var(--text-muted)',
    fontSize: 12,
    fontWeight: 700,
  },
  manifestBar: {
    marginTop: 8,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
    flexWrap: 'wrap',
    border: '1px solid var(--border)',
    borderRadius: 8,
    background: 'var(--bg-deep)',
    padding: '8px 10px',
    color: 'var(--text-muted)',
    fontSize: 12,
    fontWeight: 700,
  },
  manifestBtn: {
    border: '1px solid var(--border2)',
    borderRadius: 8,
    background: 'var(--bg-card)',
    color: 'var(--accent)',
    padding: '6px 10px',
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 800,
  },
  businessGuardPanel: {
    marginTop: 12,
    borderTop: '1px solid var(--border)',
    paddingTop: 12,
  },
  businessGuardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 10,
    flexWrap: 'wrap',
    marginBottom: 10,
  },
  businessHealth: {
    minHeight: 28,
    borderRadius: 8,
    padding: '5px 10px',
    border: '1px solid var(--border)',
    background: 'var(--bg-deep)',
    color: 'var(--text-muted)',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 12,
    fontWeight: 900,
  },
  businessHealth_good: {
    color: '#34D399',
    border: '1px solid rgba(52,211,153,0.28)',
    background: 'rgba(52,211,153,0.09)',
  },
  businessHealth_warning: {
    color: '#F9A825',
    border: '1px solid rgba(249,168,37,0.32)',
    background: 'rgba(249,168,37,0.1)',
  },
  businessHealth_danger: {
    color: '#EF5350',
    border: '1px solid rgba(239,83,80,0.32)',
    background: 'rgba(239,83,80,0.1)',
  },
  businessKpiGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(165px, 1fr))',
    gap: 8,
    marginBottom: 8,
  },
  businessKpi: {
    border: '1px solid var(--border)',
    borderRadius: 8,
    background: 'var(--bg-deep)',
    color: 'var(--text)',
    padding: '9px 10px',
    minHeight: 82,
    cursor: 'pointer',
    textAlign: 'left',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between',
    gap: 4,
  },
  businessKpiStatic: {
    border: '1px solid var(--border)',
    borderRadius: 8,
    background: 'var(--bg-deep)',
    color: 'var(--text)',
    padding: '9px 10px',
    minHeight: 82,
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between',
    gap: 4,
  },
  businessKpiLabel: {
    color: 'var(--text-muted)',
    fontSize: 11,
    fontWeight: 800,
    textTransform: 'uppercase',
    lineHeight: 1.2,
  },
  businessKpiValue: {
    color: 'var(--accent)',
    fontSize: 15,
    fontWeight: 900,
    lineHeight: 1.2,
    overflowWrap: 'anywhere',
  },
  businessKpiHint: {
    color: 'var(--text-muted)',
    fontSize: 11,
    fontWeight: 700,
    lineHeight: 1.2,
  },
  businessSignalRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(145px, 1fr))',
    gap: 8,
    marginBottom: 8,
  },
  businessSignal: {
    borderRadius: 8,
    padding: '7px 9px',
    display: 'grid',
    gridTemplateColumns: '1fr auto',
    gap: '2px 8px',
    alignItems: 'center',
    textAlign: 'left',
    fontSize: 12,
    fontWeight: 800,
  },
  businessSignalActive: {
    border: '1px solid var(--border2)',
    background: 'var(--bg-deep)',
    color: 'var(--text)',
    cursor: 'pointer',
  },
  businessSignalDisabled: {
    border: '1px solid var(--border)',
    background: 'transparent',
    color: 'var(--text-muted)',
    cursor: 'default',
    opacity: 0.66,
  },
  businessRiskList: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
    gap: 8,
  },
  businessRiskItem: {
    display: 'grid',
    gridTemplateColumns: '1fr 34px auto',
    gap: 8,
    alignItems: 'center',
    border: '1px solid var(--border)',
    borderRadius: 8,
    background: 'var(--bg-deep)',
    color: 'var(--text)',
    padding: '8px 9px',
    cursor: 'pointer',
    textAlign: 'left',
    minWidth: 0,
  },
  businessRiskMain: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    minWidth: 0,
  },
  businessRiskTitle: {
    fontSize: 13,
    fontWeight: 850,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  businessRiskFlags: {
    color: 'var(--text-muted)',
    fontSize: 11,
    fontWeight: 700,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  businessRiskScore: {
    width: 30,
    height: 30,
    borderRadius: 8,
    border: '1px solid rgba(239,83,80,0.28)',
    background: 'rgba(239,83,80,0.1)',
    color: '#EF5350',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 12,
    fontWeight: 900,
    fontVariantNumeric: 'tabular-nums',
  },
  businessRiskValue: {
    color: 'var(--accent)',
    fontSize: 12,
    fontWeight: 900,
    whiteSpace: 'nowrap',
  },
  businessRiskEmpty: {
    border: '1px dashed var(--border)',
    borderRadius: 8,
    padding: '12px 10px',
    color: 'var(--text-muted)',
    fontSize: 12,
    fontWeight: 700,
  },
  closureAuditPanel: {
    marginTop: 12,
    borderTop: '1px solid var(--border)',
    paddingTop: 12,
  },
  closureAuditHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 10,
    flexWrap: 'wrap',
    marginBottom: 10,
  },
  closureAuditKpis: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(155px, 1fr))',
    gap: 8,
    marginBottom: 8,
  },
  closureAuditKpi: {
    border: '1px solid var(--border)',
    borderRadius: 8,
    background: 'var(--bg-deep)',
    color: 'var(--text)',
    padding: '9px 10px',
    minHeight: 78,
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between',
    gap: 4,
  },
  closureAuditColumns: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(255px, 1fr))',
    gap: 8,
    marginBottom: 8,
  },
  closureAuditBox: {
    border: '1px solid var(--border)',
    borderRadius: 8,
    background: 'var(--bg-deep)',
    padding: 10,
    minWidth: 0,
  },
  closureAuditBoxTitle: {
    color: 'var(--text)',
    fontSize: 12,
    fontWeight: 900,
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  closureAuditIssue: {
    width: '100%',
    display: 'grid',
    gridTemplateColumns: '1fr 28px auto',
    gap: 8,
    alignItems: 'center',
    border: 'none',
    borderTop: '1px solid var(--border)',
    background: 'transparent',
    color: 'var(--text)',
    paddingTop: 8,
    marginTop: 8,
    minWidth: 0,
    cursor: 'pointer',
    textAlign: 'left',
  },
  closureAuditIssueActive: {
    backgroundColor: 'var(--accent-surface)',
    boxShadow: 'inset 3px 0 0 var(--accent)',
    paddingLeft: 8,
    paddingRight: 6,
    borderRadius: 8,
  },
  closureAuditActor: {
    display: 'grid',
    gridTemplateColumns: '1fr 28px',
    gap: 8,
    alignItems: 'center',
    borderTop: '1px solid var(--border)',
    paddingTop: 8,
    marginTop: 8,
    minWidth: 0,
  },
  closureAuditIssueBody: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    minWidth: 0,
  },
  closureAuditCount: {
    width: 26,
    height: 26,
    borderRadius: 8,
    border: '1px solid var(--border2)',
    background: 'var(--bg-card)',
    color: 'var(--accent)',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 12,
    fontWeight: 900,
    fontVariantNumeric: 'tabular-nums',
  },
  closureAuditValue: {
    color: 'var(--accent)',
    fontSize: 11,
    fontWeight: 900,
    whiteSpace: 'nowrap',
  },
  closureRepairPanel: {
    border: '1px solid var(--border)',
    borderRadius: 8,
    background: 'var(--bg-deep)',
    padding: 10,
    marginBottom: 8,
  },
  closureRepairHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 8,
  },
  closureRepairTitle: {
    color: 'var(--text)',
    fontSize: 13,
    fontWeight: 900,
    lineHeight: 1.25,
  },
  closureRepairClear: {
    border: '1px solid var(--border2)',
    borderRadius: 8,
    backgroundColor: 'var(--bg-card2)',
    color: 'var(--accent)',
    padding: '6px 9px',
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 850,
  },
  closureRepairList: {
    display: 'grid',
    gap: 7,
  },
  closureRepairItem: {
    display: 'grid',
    gridTemplateColumns: '32px minmax(0, 1fr) auto',
    gap: 8,
    alignItems: 'center',
    border: '1px solid var(--border)',
    borderRadius: 8,
    background: 'var(--bg-card2)',
    padding: '8px 9px',
    minWidth: 0,
  },
  closureRepairScore: {
    width: 30,
    height: 30,
    borderRadius: 8,
    border: '1px solid rgba(239,83,80,0.28)',
    backgroundColor: 'rgba(239,83,80,0.1)',
    color: '#EF5350',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 12,
    fontWeight: 900,
    fontVariantNumeric: 'tabular-nums',
  },
  closureRepairBody: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    minWidth: 0,
    overflowWrap: 'anywhere',
  },
  closureRepairValue: {
    color: 'var(--accent)',
    fontSize: 11,
    fontWeight: 900,
    whiteSpace: 'nowrap',
  },
  closureRepairActions: {
    gridColumn: '2 / -1',
    display: 'flex',
    gap: 6,
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
  },
  closureRepairBtn: {
    border: '1px solid var(--border2)',
    borderRadius: 8,
    backgroundColor: 'var(--bg-deep)',
    color: 'var(--accent)',
    padding: '6px 8px',
    cursor: 'pointer',
    fontSize: 11,
    fontWeight: 850,
  },
  closureRepairBtnPrimary: {
    border: '1px solid var(--accent)',
    borderRadius: 8,
    backgroundColor: 'var(--accent-surface)',
    color: 'var(--accent)',
    padding: '6px 8px',
    cursor: 'pointer',
    fontSize: 11,
    fontWeight: 900,
  },
  closureAuditEmpty: {
    border: '1px dashed var(--border)',
    borderRadius: 8,
    padding: '10px 9px',
    color: 'var(--text-muted)',
    fontSize: 12,
    fontWeight: 700,
  },
  closureAuditRecent: {
    border: '1px solid var(--border)',
    borderRadius: 8,
    background: 'var(--bg-deep)',
    padding: 10,
  },
  closureAuditEvent: {
    width: '100%',
    display: 'grid',
    gridTemplateColumns: '12px minmax(0, 1fr)',
    gap: 8,
    alignItems: 'center',
    border: '1px solid var(--border)',
    borderRadius: 8,
    background: 'var(--bg-card2)',
    color: 'var(--text)',
    padding: '8px 9px',
    marginTop: 6,
    cursor: 'pointer',
    textAlign: 'left',
    minWidth: 0,
    outline: 'none',
  },
  closureAuditEventBody: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    minWidth: 0,
    overflowWrap: 'anywhere',
  },
  closureAuditEventMeta: {
    gridColumn: '2',
    color: 'var(--text-muted)',
    fontSize: 11,
    fontWeight: 800,
    lineHeight: 1.3,
    overflowWrap: 'anywhere',
  },
  smartFilterRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
    marginBottom: 12,
    padding: '11px 12px',
    border: '1px solid var(--glass-border)',
    borderRadius: 8,
    background: 'linear-gradient(135deg, var(--glass-bg-strong), var(--glass-bg))',
  },
  smartFilterTitle: {
    fontSize: 12,
    fontWeight: 800,
    color: 'var(--text-muted)',
    textTransform: 'uppercase',
    marginRight: 4,
  },
  smartFilterChip: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 7,
    padding: '7px 10px',
    borderRadius: 8,
    border: '1px solid var(--border)',
    background: 'rgba(0,0,0,0.16)',
    color: 'var(--text-sub)',
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 700,
  },
  smartFilterChipActive: {
    border: '1px solid var(--accent)',
    color: 'var(--accent)',
    background: 'linear-gradient(90deg, var(--accent-surface), rgba(255,255,255,0.02))',
    boxShadow: 'inset 3px 0 0 var(--accent)',
  },
  smartFilterCount: {
    minWidth: 18,
    height: 18,
    padding: '0 5px',
    borderRadius: 8,
    background: 'rgba(255,255,255,0.08)',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 11,
    fontVariantNumeric: 'tabular-nums',
  },
  card: {
    background: 'linear-gradient(150deg, var(--bg-card) 0%, var(--bg-card2) 100%)',
    borderRadius: 8, padding: 20, border: '1px solid var(--border2)',
    boxShadow: 'var(--shadow-sm)', marginBottom: 16
  },
  cardTitle: { fontSize: 15, fontWeight: 'bold', color: 'var(--accent)', marginBottom: 16, paddingBottom: 10, borderBottom: '1px solid var(--border)' },
  twoCol: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16, marginBottom: 0 },
  formWizardPanel: {
    border: '1px solid var(--border2)',
    borderRadius: 8,
    background: 'var(--bg-card)',
    boxShadow: 'var(--shadow-sm)',
    padding: 14,
    marginBottom: 14,
  },
  formWizardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 12,
    flexWrap: 'wrap',
  },
  formWizardTitle: {
    color: 'var(--text)',
    fontSize: 18,
    fontWeight: 900,
    lineHeight: 1.2,
  },
  formWizardSubtitle: {
    color: 'var(--text-muted)',
    fontSize: 12,
    fontWeight: 700,
    marginTop: 3,
  },
  formWizardProgress: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 44,
    height: 32,
    padding: '0 10px',
    border: '1px solid var(--border)',
    borderRadius: 8,
    backgroundColor: 'var(--bg-deep)',
    color: 'var(--accent)',
    fontSize: 12,
    fontWeight: 900,
    fontVariantNumeric: 'tabular-nums',
  },
  formWizardSteps: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
    gap: 8,
  },
  formWizardStep: {
    minHeight: 58,
    border: '1px solid var(--border)',
    borderRadius: 8,
    backgroundColor: 'var(--bg-deep)',
    color: 'var(--text-sub)',
    padding: '8px 9px',
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    cursor: 'pointer',
    textAlign: 'left',
  },
  formWizardStepActive: {
    border: '1px solid rgba(52,211,153,0.42)',
    backgroundColor: 'rgba(52,211,153,0.1)',
    color: 'var(--text)',
  },
  formWizardStepDone: {
    border: '1px solid rgba(76,175,80,0.24)',
  },
  formWizardStepNo: {
    flex: '0 0 auto',
    width: 28,
    height: 28,
    borderRadius: 8,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'var(--bg-card)',
    color: 'var(--accent)',
    fontSize: 12,
    fontWeight: 900,
    fontVariantNumeric: 'tabular-nums',
  },
  formWizardStepText: {
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    lineHeight: 1.2,
    fontSize: 12,
  },
  formFlowPanel: {
    marginTop: 12,
    padding: 12,
    border: '1px solid var(--border)',
    borderRadius: 8,
    backgroundColor: 'var(--bg-deep)',
  },
  formFlowHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 10,
    color: 'var(--text-muted)',
    fontSize: 12,
    fontWeight: 850,
    textTransform: 'uppercase',
  },
  formFlowSteps: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
    gap: 8,
  },
  formFlowStep: {
    minHeight: 66,
    border: '1px solid var(--border)',
    borderRadius: 8,
    backgroundColor: 'var(--bg-card)',
    color: 'var(--text-muted)',
    padding: '9px 10px',
    display: 'flex',
    alignItems: 'center',
    gap: 9,
  },
  formFlowStepActive: {
    border: '1px solid rgba(52,211,153,0.42)',
    backgroundColor: 'rgba(52,211,153,0.1)',
    color: 'var(--text)',
  },
  formFlowStepDone: {
    color: 'var(--text-sub)',
    opacity: 0.82,
  },
  formFlowStepNo: {
    flex: '0 0 auto',
    width: 30,
    height: 30,
    borderRadius: 8,
    border: '1px solid var(--accent)',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'var(--accent)',
    fontSize: 12,
    fontWeight: 950,
    fontVariantNumeric: 'tabular-nums',
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  formFlowStepText: {
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    lineHeight: 1.25,
    fontSize: 12,
  },
  inspectionPresetPanel: {
    border: '1px solid var(--border)',
    borderRadius: 8,
    backgroundColor: 'var(--bg-deep)',
    padding: 10,
    marginBottom: 10,
  },
  inspectionPresetHead: {
    display: 'flex',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 10,
    flexWrap: 'wrap',
    color: 'var(--text-sub)',
    fontSize: 12,
    marginBottom: 8,
  },
  inspectionPresetGrid: {
    display: 'flex',
    gap: 8,
    flexWrap: 'wrap',
    alignItems: 'center',
    marginBottom: 8,
  },
  inspectionChip: {
    border: '1px solid var(--border2)',
    borderRadius: 8,
    backgroundColor: 'var(--bg-card)',
    color: 'var(--text-sub)',
    minHeight: 36,
    padding: '7px 10px',
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 850,
    fontFamily: 'inherit',
  },
  inspectionChipActive: {
    border: '1px solid var(--accent)',
    backgroundColor: 'var(--accent-surface)',
    color: 'var(--accent)',
    boxShadow: 'inset 3px 0 0 var(--accent)',
  },
  formWizardActions: {
    display: 'flex',
    gap: 12,
    marginTop: 8,
    flexWrap: 'wrap',
    paddingBottom: 40,
    alignItems: 'center',
  },
  formWizardBtnDisabled: {
    opacity: 0.45,
    cursor: 'not-allowed',
  },
  formSummaryGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
    gap: 12,
    marginBottom: 16,
  },
  formSummaryCard: {
    border: '1px solid var(--border2)',
    borderRadius: 8,
    backgroundColor: 'var(--bg-card)',
    padding: 14,
    minHeight: 130,
    display: 'flex',
    flexDirection: 'column',
    gap: 7,
    color: 'var(--text-sub)',
    boxShadow: 'var(--shadow-sm)',
  },
  formSummaryChecks: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    marginTop: 3,
  },
  formSummaryCheck: {
    border: '1px solid var(--border)',
    borderRadius: 8,
    backgroundColor: 'var(--bg-deep)',
    padding: '6px 8px',
    fontSize: 11,
    fontWeight: 800,
    color: 'var(--text-sub)',
    lineHeight: 1.25,
  },
  taskPhotosPanel: {
    border: '1px solid var(--glass-border)',
    borderRadius: 8,
    background: 'linear-gradient(145deg, var(--glass-bg-strong), var(--glass-bg))',
    boxShadow: 'var(--shadow-md)',
    padding: 14,
    marginBottom: 16,
  },
  taskPhotosHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
    flexWrap: 'wrap',
    marginBottom: 12,
  },
  taskPhotosTitle: {
    color: 'var(--text)',
    fontSize: 17,
    fontWeight: 900,
    lineHeight: 1.25,
  },
  taskPhotosSubtitle: {
    color: 'var(--text-muted)',
    fontSize: 12,
    fontWeight: 700,
    marginTop: 4,
    lineHeight: 1.35,
  },
  taskPhotosCount: {
    minWidth: 38,
    height: 30,
    border: '1px solid var(--border)',
    borderRadius: 8,
    backgroundColor: 'var(--bg-deep)',
    color: 'var(--accent)',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: 900,
    fontSize: 12,
    fontVariantNumeric: 'tabular-nums',
  },
  taskPhotosToolbar: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
    gap: 8,
    alignItems: 'center',
    marginBottom: 8,
  },
  taskPhotosSelect: {
    padding: '9px 10px',
    borderRadius: 8,
    border: '1px solid var(--border)',
    backgroundColor: 'var(--bg-deep)',
    color: 'var(--text)',
    fontSize: 12,
    minWidth: 0,
  },
  taskPhotosInput: {
    padding: '9px 10px',
    borderRadius: 8,
    border: '1px solid var(--border)',
    backgroundColor: 'var(--bg-deep)',
    color: 'var(--text)',
    fontSize: 12,
    minWidth: 0,
  },
  taskPhotosInputSmall: {
    padding: '9px 10px',
    borderRadius: 8,
    border: '1px solid var(--border)',
    backgroundColor: 'var(--bg-deep)',
    color: 'var(--text)',
    fontSize: 12,
    minWidth: 0,
  },
  taskPhotosBtn: {
    border: '1px solid rgba(52,211,153,0.32)',
    borderRadius: 8,
    backgroundColor: 'rgba(52,211,153,0.12)',
    color: 'var(--accent)',
    padding: '9px 12px',
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 900,
    whiteSpace: 'nowrap',
  },
  taskPhotosBtnSecondary: {
    border: '1px solid var(--border2)',
    borderRadius: 8,
    backgroundColor: 'var(--bg-deep)',
    color: 'var(--text-sub)',
    padding: '9px 12px',
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 850,
    whiteSpace: 'nowrap',
  },
  taskPhotosHint: {
    border: '1px solid var(--border)',
    borderRadius: 8,
    backgroundColor: 'var(--bg-deep)',
    color: 'var(--text-muted)',
    padding: '8px 10px',
    fontSize: 12,
    lineHeight: 1.35,
    marginBottom: 10,
  },
  taskPhotosDraftBox: {
    border: '1px solid rgba(249,168,37,0.28)',
    borderRadius: 8,
    backgroundColor: 'rgba(249,168,37,0.08)',
    padding: 12,
    color: 'var(--text-sub)',
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    marginBottom: 10,
    fontSize: 13,
    lineHeight: 1.35,
  },
  taskPhotosEmpty: {
    border: '1px dashed var(--border)',
    borderRadius: 8,
    backgroundColor: 'var(--bg-deep)',
    padding: 18,
    textAlign: 'center',
    color: 'var(--text-muted)',
    fontSize: 13,
  },
  taskPhotosGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: 10,
  },
  taskPhotoCard: {
    border: '1px solid var(--border)',
    borderRadius: 8,
    backgroundColor: 'var(--bg-deep)',
    padding: 8,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 7,
  },
  taskPhotoImageLink: {
    display: 'block',
    borderRadius: 7,
    overflow: 'hidden',
    backgroundColor: '#07110d',
    aspectRatio: '4 / 3',
  },
  taskPhotoImage: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    display: 'block',
  },
  taskPhotoMeta: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 8,
    alignItems: 'center',
    color: 'var(--text-sub)',
    fontSize: 11,
    lineHeight: 1.2,
  },
  taskPhotoOpis: {
    color: 'var(--text)',
    fontSize: 12,
    lineHeight: 1.35,
    overflowWrap: 'anywhere',
  },
  taskPhotoTags: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 5,
  },
  taskPhotoTag: {
    border: '1px solid var(--border)',
    borderRadius: 999,
    padding: '2px 7px',
    color: 'var(--text-muted)',
    fontSize: 10,
    fontWeight: 800,
  },
  taskPhotoDelete: {
    marginTop: 'auto',
    alignSelf: 'flex-start',
    border: '1px solid rgba(248,113,113,0.32)',
    borderRadius: 8,
    backgroundColor: 'rgba(248,113,113,0.1)',
    color: 'var(--danger)',
    padding: '5px 8px',
    cursor: 'pointer',
    fontSize: 11,
    fontWeight: 800,
  },
  tableScroll: { overflowX: 'auto' },
  table: { width: '100%', borderCollapse: 'collapse', minWidth: 700 },
  thCheck: { padding: '11px 8px', backgroundColor: 'var(--bg-deep)', width: 28 },
  th: { padding: '11px 14px', backgroundColor: 'var(--bg-deep)', color: 'var(--text)', textAlign: 'left', fontSize: 13, fontWeight: '600' },
  tdCheck: { padding: '11px 8px', borderBottom: '1px solid var(--border)' },
  td: { padding: '11px 14px', fontSize: 13, color: 'var(--text-sub)', borderBottom: '1px solid var(--border)' },
  idBadge: { backgroundColor: 'var(--bg-deep)', color: 'var(--accent)', padding: '2px 8px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 13, fontWeight: '600' },
  badge: { padding: '3px 10px', borderRadius: 8, color: '#fff', fontSize: 11, fontWeight: '600', display: 'inline-block' },
  akcjeRow: { display: 'flex', gap: 6 },
  btnSm: { padding: '6px 9px', backgroundColor: 'rgba(0,0,0,0.16)', color: 'var(--text-sub)', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer', fontSize: 13, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' },
  btnPrimary: { padding: '10px 20px', background: 'linear-gradient(135deg, var(--accent), var(--accent-dk))', color: 'var(--on-accent)', border: '1px solid var(--accent)', borderRadius: 8, cursor: 'pointer', fontSize: 14, fontWeight: '900', boxShadow: '0 8px 20px rgba(34,197,94,0.22)' },
  btnSecondary: {
    padding: '8px 16px',
    backgroundColor: 'rgba(0,0,0,0.16)',
    color: 'var(--accent)',
    border: '1px solid var(--border2)',
    borderRadius: 8,
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: '800',
    textDecoration: 'none',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnGray: { padding: '10px 20px', backgroundColor: 'var(--bg-deep)', color: 'var(--text-sub)', border: '1px solid var(--border2)', borderRadius: 8, cursor: 'pointer', fontSize: 14 },
  btnDanger: { padding: '10px 20px', backgroundColor: 'var(--danger)', color: 'var(--on-accent)', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 14, fontWeight: '600' },
  detailRow: { display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border)', gap: 12 },
  detailLabel: { fontSize: 13, color: 'var(--text-muted)', minWidth: 130 },
  detailValue: { fontSize: 13, color: 'var(--text)', fontWeight: '500', textAlign: 'right' },
  formGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 },
  fg: { display: 'flex', flexDirection: 'column', gap: 5 },
  label: { fontSize: 13, fontWeight: '600', color: 'var(--text-sub)' },
  input: { padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 13, backgroundColor: 'var(--bg-card)', outline: 'none' },
  komunikat: { padding: '12px 16px', borderRadius: 10, marginBottom: 16, fontSize: 14, fontWeight: '500' },
  copyFallback: {
    border: '1px solid var(--border2)',
    borderRadius: 8,
    backgroundColor: 'var(--bg-card)',
    boxShadow: 'var(--shadow-sm)',
    padding: 12,
    marginBottom: 12,
  },
  copyFallbackHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
    marginBottom: 10,
    flexWrap: 'wrap',
  },
  copyFallbackEyebrow: {
    fontSize: 11,
    color: 'var(--text-muted)',
    fontWeight: 800,
    textTransform: 'uppercase',
    letterSpacing: 0,
  },
  copyFallbackTitle: {
    marginTop: 3,
    fontSize: 13,
    color: 'var(--text)',
    fontWeight: 800,
  },
  copyFallbackText: {
    width: '100%',
    minHeight: 160,
    resize: 'vertical',
    border: '1px solid var(--border)',
    borderRadius: 8,
    backgroundColor: 'var(--bg-deep)',
    color: 'var(--text)',
    padding: 10,
    fontSize: 12,
    lineHeight: 1.5,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  },
  bulkBar: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
    padding: '10px 12px',
    border: '1px solid var(--border)',
    borderRadius: 8,
    backgroundColor: 'var(--bg-card)',
    flexWrap: 'wrap',
  },
  bulkInfo: { fontSize: 13, fontWeight: 700, color: 'var(--text)' },
  bulkBtn: {
    padding: '6px 10px',
    border: '1px solid var(--border)',
    backgroundColor: 'var(--bg-deep)',
    color: 'var(--accent)',
    borderRadius: 8,
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 700,
    textDecoration: 'none',
    display: 'inline-flex',
    alignItems: 'center',
  },
  bulkBtnSecondary: {
    padding: '6px 10px',
    border: '1px solid var(--border)',
    backgroundColor: 'transparent',
    color: 'var(--text-sub)',
    borderRadius: 8,
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 700,
  },
  slaWrap: { display: 'flex', gap: 4, flexWrap: 'wrap' },
  slaBadge: {
    padding: '2px 6px',
    borderRadius: 999,
    fontSize: 10,
    fontWeight: 700,
    backgroundColor: 'rgba(248,113,113,0.18)',
    color: '#C62828',
    border: '1px solid rgba(248,113,113,0.25)',
  },
  slaOk: {
    padding: '2px 6px',
    borderRadius: 999,
    fontSize: 10,
    fontWeight: 700,
    backgroundColor: 'rgba(52,211,153,0.18)',
    color: 'var(--accent)',
    border: '1px solid rgba(52,211,153,0.25)',
  },
  loading: { textAlign: 'center', padding: 60, color: 'var(--text-muted)', fontSize: 16 },
  kpiWrap: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
    gap: 10,
    marginBottom: 12,
  },
  kpiItem: {
    background: 'linear-gradient(180deg, var(--bg-card), var(--bg-card2))',
    borderRadius: 8,
    border: '1px solid var(--glass-border)',
    borderTop: '3px solid var(--accent)',
    padding: '11px 12px',
    boxShadow: 'var(--shadow-sm)',
  },
  kpiTitle: {
    fontSize: 11,
    color: 'var(--text-muted)',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: 0,
  },
  kpiCount: {
    marginTop: 4,
    fontSize: 20,
    color: 'var(--text)',
    fontWeight: 800,
  },
  kpiValue: {
    marginTop: 2,
    fontSize: 12,
    color: 'var(--accent)',
    fontWeight: 700,
  },
  workflowPanel: {
    background: 'linear-gradient(135deg, var(--glass-bg-strong), var(--glass-bg))',
    border: '1px solid var(--glass-border)',
    borderRadius: 8,
    padding: '10px 12px',
    marginBottom: 12,
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
    gap: 8,
  },
  workflowTitle: {
    gridColumn: '1 / -1',
    fontSize: 12,
    color: 'var(--text-muted)',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: 0,
  },
  workflowOption: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 13,
    color: 'var(--text-sub)',
  },
  workflowPresets: {
    gridColumn: '1 / -1',
    display: 'flex',
    gap: 8,
    flexWrap: 'wrap',
  },
  workflowPresetBtn: {
    border: '1px solid var(--border)',
    backgroundColor: 'var(--bg-deep)',
    color: 'var(--text-sub)',
    borderRadius: 8,
    fontSize: 12,
    padding: '6px 10px',
    cursor: 'pointer',
    fontWeight: 700,
  },
  kanbanWrap: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
    gap: 12,
    alignItems: 'start',
    marginBottom: 20,
  },
  kanbanCol: {
    background: 'linear-gradient(180deg, var(--bg-card), var(--bg-deep))',
    border: '1px solid var(--glass-border)',
    borderRadius: 8,
    minHeight: 220,
    display: 'flex',
    flexDirection: 'column',
    boxShadow: 'var(--shadow-sm)',
  },
  kanbanColHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 10px 8px',
    borderBottom: '1px solid var(--border)',
  },
  kanbanCount: {
    fontSize: 12,
    color: 'var(--text-muted)',
    fontWeight: 600,
  },
  kanbanColBody: {
    padding: 10,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  kanbanEmpty: {
    fontSize: 12,
    color: 'var(--text-muted)',
    textAlign: 'center',
    padding: '20px 8px',
    border: '1px dashed var(--border)',
    borderRadius: 8,
  },
  kanbanCard: {
    border: '1px solid var(--border)',
    borderRadius: 8,
    background: 'linear-gradient(160deg, var(--bg-card2), var(--bg-card))',
    padding: 10,
    transition: 'transform 0.12s ease, box-shadow 0.12s ease',
  },
  kanbanCardTitle: {
    fontSize: 13,
    fontWeight: 700,
    color: 'var(--text)',
    marginBottom: 4,
  },
  kanbanCardMeta: {
    fontSize: 12,
    color: 'var(--text-muted)',
    marginBottom: 3,
  },
  kanbanDiagnostics: {
    marginTop: 7,
    display: 'flex',
    justifyContent: 'space-between',
    gap: 8,
    padding: '5px 7px',
    borderRadius: 8,
    border: '1px solid var(--border)',
    backgroundColor: 'var(--bg-deep)',
    color: 'var(--text-muted)',
    fontSize: 11,
    fontWeight: 800,
  },
  kanbanCardFooter: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
    gap: 8,
  },
  kanbanActions: {
    marginTop: 8,
    display: 'flex',
    gap: 6,
    justifyContent: 'flex-end',
  },
  kanbanActionBtn: {
    border: '1px solid var(--border2)',
    borderRadius: 6,
    minWidth: 30,
    minHeight: 28,
    padding: '4px 8px',
    fontSize: 12,
    backgroundColor: 'rgba(0,0,0,0.16)',
    color: 'var(--accent)',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  kanbanValue: {
    fontSize: 12,
    color: 'var(--accent)',
    fontWeight: 700,
  },
  overlay: { position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modal: { backgroundColor: 'var(--bg-card)', borderRadius: 8, border: '1px solid var(--border2)', padding: 32, maxWidth: 420, width: '90%', textAlign: 'center', boxShadow: 'var(--shadow-lg)' },
  closeGuardModal: {
    backgroundColor: 'var(--bg-card)',
    borderRadius: 8,
    border: '1px solid var(--border2)',
    padding: 18,
    maxWidth: 680,
    width: 'min(92vw, 680px)',
    maxHeight: '88vh',
    overflowY: 'auto',
    boxShadow: 'var(--shadow-lg)',
  },
  closeGuardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 8,
  },
  closeGuardTitle: {
    margin: '3px 0 0',
    color: 'var(--text)',
    fontSize: 20,
    fontWeight: 900,
  },
  closeGuardLead: {
    margin: '0 0 12px',
    color: 'var(--text-sub)',
    fontSize: 13,
    lineHeight: 1.45,
    fontWeight: 650,
  },
  closeGuardMetrics: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
    gap: 8,
    marginBottom: 12,
  },
  closeGuardSection: {
    display: 'grid',
    gap: 7,
    marginTop: 10,
  },
  closeGuardSectionTitle: {
    color: 'var(--text-muted)',
    fontSize: 11,
    fontWeight: 900,
    textTransform: 'uppercase',
  },
  closeGuardItem: {
    border: '1px solid rgba(249,168,37,0.28)',
    borderRadius: 8,
    backgroundColor: 'rgba(249,168,37,0.08)',
    color: 'var(--text)',
    padding: '8px 10px',
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    fontSize: 12,
    lineHeight: 1.35,
  },
  closeGuardItemDanger: {
    border: '1px solid rgba(239,83,80,0.34)',
    backgroundColor: 'rgba(239,83,80,0.1)',
  },
  closeGuardActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 10,
    flexWrap: 'wrap',
    marginTop: 14,
  },
  detailOpsPanel: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    flexWrap: 'wrap',
    border: '1px solid var(--glass-border)',
    borderRadius: 8,
    background: 'linear-gradient(145deg, var(--glass-bg-strong), var(--glass-bg))',
    padding: '12px 14px',
    marginBottom: 12,
    boxShadow: 'var(--shadow-md)',
  },
  detailOpsEyebrow: {
    fontSize: 11,
    color: 'var(--text-muted)',
    fontWeight: 800,
    textTransform: 'uppercase',
    letterSpacing: 0,
  },
  detailOpsTitle: {
    marginTop: 3,
    fontSize: 14,
    color: 'var(--text)',
    fontWeight: 800,
  },
  detailOpsActions: {
    display: 'flex',
    gap: 8,
    flexWrap: 'wrap',
  },
  detailHeroPanel: {
    display: 'grid',
    gridTemplateColumns: 'minmax(280px, 1.1fr) minmax(360px, 1fr)',
    gap: 12,
    border: '1px solid var(--glass-border)',
    borderRadius: 8,
    background: 'linear-gradient(135deg, rgba(110,231,168,0.14), var(--glass-bg-strong) 42%, var(--glass-bg))',
    boxShadow: 'var(--shadow-md)',
    padding: 14,
    marginBottom: 12,
    overflow: 'hidden',
  },
  detailHeroMain: {
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    gap: 7,
  },
  detailHeroTitle: {
    margin: 0,
    color: 'var(--text)',
    fontSize: 24,
    lineHeight: 1.12,
    fontWeight: 950,
    overflowWrap: 'anywhere',
  },
  detailHeroMeta: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 8,
    color: 'var(--text-sub)',
    fontSize: 12,
    fontWeight: 800,
  },
  detailHeroStats: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
    gap: 8,
    minWidth: 0,
  },
  detailHeroStat: {
    border: '1px solid var(--border)',
    borderRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.18)',
    padding: '10px 11px',
    minHeight: 96,
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between',
    gap: 5,
    minWidth: 0,
  },
  detailHeroStat_good: {
    border: '1px solid rgba(52,211,153,0.28)',
    backgroundColor: 'rgba(52,211,153,0.09)',
  },
  detailHeroStat_blue: {
    border: '1px solid rgba(91,192,235,0.28)',
    backgroundColor: 'rgba(91,192,235,0.08)',
  },
  detailHeroStat_warning: {
    border: '1px solid rgba(242,184,75,0.34)',
    backgroundColor: 'rgba(242,184,75,0.1)',
  },
  detailHeroStat_danger: {
    border: '1px solid rgba(248,113,113,0.35)',
    backgroundColor: 'rgba(248,113,113,0.11)',
  },
  detailHeroStatLabel: {
    color: 'var(--text-muted)',
    fontSize: 10,
    fontWeight: 900,
    textTransform: 'uppercase',
    lineHeight: 1.1,
  },
  detailHeroStatValue: {
    color: 'var(--text)',
    fontSize: 18,
    lineHeight: 1.15,
    fontWeight: 950,
    overflowWrap: 'anywhere',
  },
  detailHeroStatDetail: {
    color: 'var(--text-muted)',
    fontSize: 11,
    lineHeight: 1.25,
    fontWeight: 750,
  },
  officePlanPanel: {
    border: '1px solid rgba(52,211,153,0.34)',
    borderRadius: 8,
    background: 'linear-gradient(145deg, rgba(52,211,153,0.12), var(--glass-bg))',
    padding: '12px 14px',
    marginBottom: 12,
    boxShadow: 'var(--shadow-md)',
  },
  officePlanHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
    flexWrap: 'wrap',
    marginBottom: 10,
  },
  officePlanTitle: {
    marginTop: 3,
    color: 'var(--text)',
    fontSize: 16,
    fontWeight: 950,
    lineHeight: 1.2,
  },
  officePlanSubtitle: {
    margin: '4px 0 0',
    color: 'var(--text-muted)',
    fontSize: 12,
    fontWeight: 700,
    lineHeight: 1.35,
    maxWidth: 720,
  },
  officePlanGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
    gap: 10,
    alignItems: 'start',
  },
  officePlanNoteField: {
    gridColumn: '1 / -1',
  },
  officePlanEquipmentField: {
    gridColumn: '1 / -1',
  },
  officePlanMultiSelect: {
    minHeight: 118,
    lineHeight: 1.35,
    padding: '8px 10px',
  },
  officePlanEquipmentHint: {
    display: 'block',
    marginTop: 6,
    color: 'var(--text-muted)',
    fontSize: 12,
    fontWeight: 700,
    lineHeight: 1.35,
  },
  officePlanTextarea: {
    minHeight: 72,
    resize: 'vertical',
    lineHeight: 1.35,
  },
  officePlanFooter: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    flexWrap: 'wrap',
    marginTop: 10,
    paddingTop: 10,
    borderTop: '1px solid var(--border)',
  },
  officePlanSummary: {
    display: 'flex',
    flexDirection: 'column',
    gap: 3,
    minWidth: 0,
    color: 'var(--text)',
    fontSize: 13,
    lineHeight: 1.25,
  },
  workflowPathPanel: {
    border: '1px solid rgba(14,165,233,0.28)',
    borderRadius: 8,
    background: 'linear-gradient(145deg, rgba(14,165,233,0.1), var(--glass-bg))',
    padding: '12px 14px',
    marginBottom: 12,
    boxShadow: 'var(--shadow-md)',
  },
  workflowPathHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
    flexWrap: 'wrap',
    marginBottom: 10,
  },
  workflowPathTitle: {
    marginTop: 3,
    color: 'var(--text)',
    fontSize: 16,
    fontWeight: 950,
    lineHeight: 1.2,
  },
  workflowPathSubtitle: {
    margin: '4px 0 0',
    color: 'var(--text-muted)',
    fontSize: 12,
    fontWeight: 700,
    lineHeight: 1.35,
    maxWidth: 780,
  },
  workflowPathSteps: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(135px, 1fr))',
    gap: 8,
  },
  workflowPathStep: {
    border: '1px solid var(--border)',
    borderRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.12)',
    padding: '8px 9px',
    minHeight: 86,
    display: 'flex',
    flexDirection: 'column',
    gap: 3,
    color: 'var(--text-muted)',
  },
  workflowPathStepActive: {
    border: '1px solid rgba(14,165,233,0.42)',
    backgroundColor: 'rgba(14,165,233,0.12)',
    color: 'var(--text)',
  },
  workflowPathStepDone: {
    border: '1px solid rgba(52,211,153,0.28)',
    backgroundColor: 'rgba(52,211,153,0.08)',
    color: 'var(--text)',
  },
  workflowPathNo: {
    width: 24,
    height: 24,
    borderRadius: 8,
    backgroundColor: 'var(--bg-card)',
    border: '1px solid var(--border)',
    color: 'var(--accent)',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 11,
    fontWeight: 950,
  },
  workflowPathActions: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
    marginTop: 10,
    paddingTop: 10,
    borderTop: '1px solid var(--border)',
  },
  workflowPathBtn: {
    border: '1px solid rgba(52,211,153,0.38)',
    borderRadius: 8,
    backgroundColor: 'rgba(52,211,153,0.14)',
    color: 'var(--accent)',
    padding: '8px 11px',
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 900,
  },
  workflowPathCancelBtn: {
    border: '1px solid rgba(239,83,80,0.34)',
    borderRadius: 8,
    backgroundColor: 'rgba(239,83,80,0.1)',
    color: 'var(--danger)',
    padding: '8px 11px',
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 900,
  },
  workflowPathDone: {
    color: 'var(--text-muted)',
    fontSize: 12,
    fontWeight: 800,
  },
  detailWorkflowPanel: {
    border: '1px solid rgba(52,211,153,0.3)',
    borderRadius: 8,
    background: 'linear-gradient(145deg, rgba(52,211,153,0.1), var(--glass-bg-strong))',
    padding: '12px 14px',
    marginBottom: 12,
    boxShadow: 'var(--shadow-md)',
  },
  detailWorkflowHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
    flexWrap: 'wrap',
    marginBottom: 10,
  },
  detailWorkflowTitle: {
    marginTop: 3,
    color: 'var(--text)',
    fontSize: 16,
    fontWeight: 950,
    lineHeight: 1.2,
  },
  detailWorkflowSubtitle: {
    margin: '4px 0 0',
    color: 'var(--text-muted)',
    fontSize: 12,
    fontWeight: 700,
    lineHeight: 1.35,
    maxWidth: 820,
  },
  detailWorkflowBadge: {
    border: '1px solid rgba(52,211,153,0.32)',
    borderRadius: 8,
    backgroundColor: 'rgba(52,211,153,0.12)',
    color: 'var(--accent)',
    padding: '7px 10px',
    fontSize: 12,
    fontWeight: 950,
  },
  detailWorkflowGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
    gap: 9,
  },
  detailWorkflowStep: {
    border: '1px solid var(--border)',
    borderRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.12)',
    padding: 10,
    minHeight: 188,
    display: 'flex',
    flexDirection: 'column',
    gap: 7,
    minWidth: 0,
  },
  detailWorkflowStep_done: {
    border: '1px solid rgba(52,211,153,0.34)',
    backgroundColor: 'rgba(52,211,153,0.09)',
  },
  detailWorkflowStep_active: {
    border: '1px solid rgba(14,165,233,0.44)',
    backgroundColor: 'rgba(14,165,233,0.12)',
  },
  detailWorkflowStep_ready: {
    border: '1px solid rgba(132,204,22,0.32)',
    backgroundColor: 'rgba(132,204,22,0.08)',
  },
  detailWorkflowStep_warning: {
    border: '1px solid rgba(242,184,75,0.34)',
    backgroundColor: 'rgba(242,184,75,0.1)',
  },
  detailWorkflowStep_blocked: {
    border: '1px solid rgba(248,113,113,0.35)',
    backgroundColor: 'rgba(248,113,113,0.1)',
  },
  detailWorkflowStep_muted: {
    opacity: 0.72,
  },
  detailWorkflowStepTop: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  detailWorkflowStepNo: {
    width: 26,
    height: 26,
    borderRadius: 8,
    backgroundColor: 'var(--bg-card)',
    border: '1px solid var(--border)',
    color: 'var(--accent)',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 12,
    fontWeight: 950,
    flexShrink: 0,
  },
  detailWorkflowOwner: {
    color: 'var(--text-muted)',
    fontSize: 10,
    fontWeight: 900,
    textTransform: 'uppercase',
    textAlign: 'right',
  },
  detailWorkflowStepTitle: {
    color: 'var(--text)',
    fontSize: 14,
    lineHeight: 1.2,
    fontWeight: 950,
  },
  detailWorkflowPrimary: {
    color: 'var(--accent)',
    fontSize: 12,
    lineHeight: 1.25,
    fontWeight: 900,
    overflowWrap: 'anywhere',
  },
  detailWorkflowDetail: {
    color: 'var(--text-muted)',
    fontSize: 12,
    lineHeight: 1.35,
    fontWeight: 700,
    flex: 1,
  },
  detailWorkflowMissing: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 5,
  },
  detailWorkflowOptional: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 5,
  },
  detailWorkflowPill: {
    border: '1px solid rgba(248,113,113,0.28)',
    borderRadius: 8,
    backgroundColor: 'rgba(248,113,113,0.1)',
    color: 'var(--danger)',
    padding: '4px 6px',
    fontSize: 10,
    fontWeight: 900,
    lineHeight: 1.1,
  },
  detailWorkflowOptionalPill: {
    border: '1px solid rgba(242,184,75,0.28)',
    borderRadius: 8,
    backgroundColor: 'rgba(242,184,75,0.1)',
    color: 'var(--warning)',
    padding: '4px 6px',
    fontSize: 10,
    fontWeight: 900,
    lineHeight: 1.1,
  },
  detailWorkflowOk: {
    color: 'var(--accent)',
    fontSize: 12,
    fontWeight: 900,
  },
  detailWorkflowAction: {
    border: '1px solid rgba(52,211,153,0.35)',
    borderRadius: 8,
    backgroundColor: 'rgba(52,211,153,0.14)',
    color: 'var(--accent)',
    padding: '8px 10px',
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 950,
    marginTop: 'auto',
  },
  detailWorkflowActionDisabled: {
    opacity: 0.54,
    cursor: 'not-allowed',
  },
  crewBriefPanel: {
    border: '1px solid rgba(34,197,94,0.32)',
    borderRadius: 8,
    background: 'linear-gradient(145deg, rgba(22,101,52,0.18), var(--glass-bg))',
    padding: '12px 14px',
    marginBottom: 12,
    boxShadow: 'var(--shadow-md)',
  },
  crewBriefHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
    flexWrap: 'wrap',
    marginBottom: 10,
  },
  crewBriefTitle: {
    marginTop: 3,
    color: 'var(--text)',
    fontSize: 17,
    fontWeight: 950,
    lineHeight: 1.2,
  },
  crewBriefSubtitle: {
    margin: '4px 0 0',
    color: 'var(--text-muted)',
    fontSize: 12,
    fontWeight: 700,
    lineHeight: 1.35,
    maxWidth: 760,
  },
  crewBriefGrid: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) minmax(260px, 340px)',
    gap: 10,
    alignItems: 'stretch',
  },
  crewBriefMain: {
    border: '1px solid var(--border)',
    borderRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.16)',
    padding: 10,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    minWidth: 0,
  },
  crewBriefSide: {
    border: '1px solid var(--border)',
    borderRadius: 8,
    backgroundColor: 'var(--bg-deep)',
    padding: 10,
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    minWidth: 0,
  },
  crewBriefRow: {
    display: 'grid',
    gridTemplateColumns: '110px 1fr',
    gap: 10,
    alignItems: 'baseline',
    color: 'var(--text)',
    fontSize: 13,
    lineHeight: 1.3,
  },
  crewBriefBlock: {
    borderTop: '1px solid var(--border)',
    paddingTop: 8,
    minWidth: 0,
  },
  crewBriefTwoCol: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
    gap: 10,
  },
  crewBriefActions: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    gap: 8,
  },
  crewActionBtn: {
    border: '1px solid rgba(52,211,153,0.42)',
    borderRadius: 8,
    backgroundColor: 'rgba(52,211,153,0.16)',
    color: 'var(--accent)',
    padding: '8px 10px',
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 900,
  },
  crewActionBtnSecondary: {
    border: '1px solid var(--border2)',
    borderRadius: 8,
    backgroundColor: 'var(--bg-card)',
    color: 'var(--text)',
    padding: '8px 10px',
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 900,
  },
  crewIssueBox: {
    display: 'flex',
    flexDirection: 'column',
    gap: 7,
  },
  crewIssueSelect: {
    width: '100%',
    border: '1px solid var(--border)',
    borderRadius: 8,
    backgroundColor: 'var(--bg-card)',
    color: 'var(--text)',
    padding: '7px 9px',
    fontSize: 12,
    fontWeight: 800,
  },
  crewIssueTextarea: {
    width: '100%',
    minHeight: 70,
    resize: 'vertical',
    border: '1px solid var(--border)',
    borderRadius: 8,
    backgroundColor: 'var(--bg-card)',
    color: 'var(--text)',
    padding: '8px 9px',
    fontSize: 12,
    lineHeight: 1.35,
    boxSizing: 'border-box',
  },
  crewIssueBtn: {
    border: '1px solid rgba(249,168,37,0.36)',
    borderRadius: 8,
    backgroundColor: 'rgba(249,168,37,0.12)',
    color: 'var(--warning)',
    padding: '8px 10px',
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 900,
  },
  crewIssueCount: {
    color: 'var(--text-muted)',
    fontSize: 11,
    fontWeight: 800,
  },
  formStatusHint: {
    display: 'block',
    marginTop: 5,
    color: 'var(--text-muted)',
    fontSize: 11,
    lineHeight: 1.35,
    fontWeight: 750,
  },
  crewBriefBottom: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) minmax(240px, 360px)',
    gap: 10,
    marginTop: 10,
  },
  crewChecklist: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
    gap: 8,
  },
  crewChecklistItem: {
    border: '1px solid var(--border)',
    borderRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.16)',
    padding: '8px 9px',
    minHeight: 78,
    display: 'flex',
    flexDirection: 'column',
    gap: 3,
  },
  crewPhotoStrip: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: 8,
    alignContent: 'start',
  },
  crewPhotoLink: {
    position: 'relative',
    display: 'block',
    borderRadius: 8,
    overflow: 'hidden',
    border: '1px solid var(--border)',
    minHeight: 92,
    backgroundColor: 'var(--bg-deep)',
    textDecoration: 'none',
  },
  crewPhotoThumb: {
    width: '100%',
    height: 92,
    objectFit: 'cover',
    display: 'block',
  },
  crewPhotoLabel: {
    position: 'absolute',
    left: 6,
    bottom: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.62)',
    color: '#fff',
    padding: '3px 7px',
    fontSize: 10,
    fontWeight: 900,
  },
  crewPhotoEmpty: {
    gridColumn: '1 / -1',
    border: '1px dashed var(--border)',
    borderRadius: 8,
    padding: 12,
    color: 'var(--text-muted)',
    fontSize: 12,
    fontWeight: 800,
  },
  detailPassportPanel: {
    border: '1px solid var(--glass-border)',
    borderRadius: 8,
    background: 'linear-gradient(145deg, var(--glass-bg-strong), var(--glass-bg))',
    padding: '12px 14px',
    marginBottom: 12,
    boxShadow: 'var(--shadow-md)',
  },
  detailPassportHeader: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    flexWrap: 'wrap',
    marginBottom: 10,
  },
  detailPassportTitle: {
    marginTop: 3,
    color: 'var(--text)',
    fontSize: 16,
    fontWeight: 900,
    lineHeight: 1.25,
  },
  detailPassportGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: 8,
    marginBottom: 10,
  },
  detailPassportCard: {
    border: '1px solid var(--border)',
    borderRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.16)',
    padding: '9px 10px',
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    minHeight: 88,
    minWidth: 0,
  },
  detailSafetyGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
    gap: 8,
  },
  detailSafetyItem: {
    border: '1px solid var(--border)',
    borderRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.16)',
    padding: '8px 9px',
    minHeight: 78,
    display: 'flex',
    flexDirection: 'column',
    gap: 3,
  },
  detailDecisionPanel: {
    border: '1px solid var(--glass-border)',
    borderRadius: 8,
    background: 'linear-gradient(145deg, var(--glass-bg-strong), var(--glass-bg))',
    padding: '12px 14px',
    marginBottom: 12,
    boxShadow: 'var(--shadow-md)',
  },
  detailDecisionHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
    flexWrap: 'wrap',
    marginBottom: 10,
  },
  detailDecisionTitle: {
    marginTop: 3,
    color: 'var(--text)',
    fontSize: 15,
    fontWeight: 900,
    lineHeight: 1.3,
  },
  detailDecisionGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
    gap: 10,
    marginBottom: 10,
  },
  detailDecisionHero: {
    border: '1px solid var(--border)',
    borderRadius: 8,
    backgroundColor: 'var(--bg-deep)',
    padding: 12,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    minWidth: 0,
  },
  detailDecisionLabel: {
    color: 'var(--text-muted)',
    fontSize: 11,
    fontWeight: 850,
    textTransform: 'uppercase',
    lineHeight: 1.2,
  },
  detailDecisionHeroText: {
    color: 'var(--accent)',
    fontSize: 18,
    lineHeight: 1.2,
    overflowWrap: 'anywhere',
  },
  detailDecisionActions: {
    display: 'flex',
    gap: 8,
    flexWrap: 'wrap',
    marginTop: 'auto',
  },
  detailPriceBox: {
    border: '1px solid var(--border)',
    borderRadius: 8,
    backgroundColor: 'var(--bg-deep)',
    padding: 12,
    display: 'flex',
    flexDirection: 'column',
    gap: 7,
    minWidth: 0,
  },
  detailPriceBox_good: {
    border: '1px solid rgba(52,211,153,0.28)',
    backgroundColor: 'rgba(52,211,153,0.08)',
  },
  detailPriceBox_warning: {
    border: '1px solid rgba(249,168,37,0.32)',
    backgroundColor: 'rgba(249,168,37,0.09)',
  },
  detailPriceBox_danger: {
    border: '1px solid rgba(239,83,80,0.34)',
    backgroundColor: 'rgba(239,83,80,0.1)',
  },
  detailPriceTitle: {
    color: 'var(--text)',
    fontSize: 16,
    lineHeight: 1.2,
  },
  detailPriceText: {
    color: 'var(--text-sub)',
    fontSize: 12,
    fontWeight: 700,
    lineHeight: 1.35,
  },
  detailPriceMetrics: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(135px, 1fr))',
    gap: 6,
    color: 'var(--text-muted)',
    fontSize: 11,
    fontWeight: 750,
  },
  detailPriceEditBtn: {
    alignSelf: 'flex-start',
    border: '1px solid var(--border2)',
    borderRadius: 8,
    backgroundColor: 'var(--bg-card)',
    color: 'var(--accent)',
    padding: '6px 10px',
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 800,
  },
  detailDecisionMetrics: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
    gap: 8,
    marginBottom: 10,
  },
  detailDecisionMetric: {
    border: '1px solid var(--border)',
    borderRadius: 8,
    backgroundColor: 'var(--bg-deep)',
    padding: '8px 10px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
    color: 'var(--text-muted)',
    fontSize: 12,
    fontWeight: 800,
  },
  detailChecklistGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
    gap: 8,
  },
  detailChecklistItem: {
    border: '1px solid var(--border)',
    borderRadius: 8,
    backgroundColor: 'var(--bg-deep)',
    padding: '8px 9px',
    minHeight: 74,
    display: 'flex',
    flexDirection: 'column',
    gap: 3,
  },
  detailChecklistOk: {
    border: '1px solid rgba(52,211,153,0.24)',
  },
  detailChecklistWarn: {
    border: '1px solid rgba(249,168,37,0.28)',
  },
  detailChecklistDanger: {
    border: '1px solid rgba(239,83,80,0.3)',
  },
  detailChecklistStatus: {
    color: 'var(--text-muted)',
    fontSize: 10,
    fontWeight: 900,
    textTransform: 'uppercase',
    lineHeight: 1.1,
  },
  closureDecisionLog: {
    marginTop: 10,
    border: '1px solid var(--border)',
    borderRadius: 8,
    backgroundColor: 'var(--bg-deep)',
    padding: 10,
  },
  closureDecisionHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
  },
  closureDecisionTitle: {
    color: 'var(--text)',
    fontSize: 13,
    fontWeight: 900,
    marginTop: 2,
  },
  closureDecisionCount: {
    minWidth: 26,
    height: 26,
    borderRadius: 8,
    border: '1px solid var(--border2)',
    backgroundColor: 'var(--bg-card)',
    color: 'var(--accent)',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 12,
    fontWeight: 900,
  },
  closureDecisionEmpty: {
    border: '1px dashed var(--border)',
    borderRadius: 8,
    padding: '10px 9px',
    color: 'var(--text-muted)',
    fontSize: 12,
    fontWeight: 700,
  },
  closureDecisionItem: {
    display: 'grid',
    gridTemplateColumns: '12px 1fr',
    gap: 8,
    alignItems: 'flex-start',
    borderTop: '1px solid var(--border)',
    paddingTop: 8,
    marginTop: 8,
  },
  closureDecisionBody: {
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 3,
  },
  closureDecisionTop: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 8,
    color: 'var(--text)',
    fontSize: 12,
    fontWeight: 850,
  },
  closureDecisionMeta: {
    color: 'var(--text-muted)',
    fontSize: 11,
    fontWeight: 700,
  },
  closureDecisionChips: {
    display: 'flex',
    gap: 5,
    flexWrap: 'wrap',
    marginTop: 2,
  },
  closureDecisionChip: {
    border: '1px solid var(--border)',
    borderRadius: 8,
    backgroundColor: 'var(--bg-card)',
    color: 'var(--text-sub)',
    padding: '3px 6px',
    fontSize: 10,
    fontWeight: 800,
  },
  clientContactPanel: {
    border: '1px solid var(--glass-border)',
    borderRadius: 8,
    background: 'linear-gradient(145deg, var(--glass-bg-strong), var(--glass-bg))',
    padding: '12px 14px',
    marginBottom: 12,
    boxShadow: 'var(--shadow-md)',
  },
  clientContactHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
    flexWrap: 'wrap',
    marginBottom: 10,
  },
  clientContactTitle: {
    marginTop: 3,
    fontSize: 15,
    color: 'var(--text)',
    fontWeight: 900,
  },
  clientContactMeta: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: 2,
    color: 'var(--text-muted)',
    fontSize: 12,
    fontWeight: 700,
  },
  contactStatusGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
    gap: 8,
    marginBottom: 10,
  },
  contactStatusBtn: {
    minHeight: 34,
    border: '1px solid var(--border)',
    borderRadius: 8,
    backgroundColor: 'var(--bg-deep)',
    color: 'var(--text-sub)',
    padding: '7px 9px',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 7,
    fontSize: 12,
    fontWeight: 800,
    textAlign: 'left',
  },
  contactStatusBtnActive: {
    border: '1px solid var(--accent)',
    backgroundColor: 'var(--accent-surface)',
    color: 'var(--accent)',
  },
  contactTextarea: {
    width: '100%',
    minHeight: 82,
    resize: 'vertical',
    border: '1px solid var(--border)',
    borderRadius: 8,
    backgroundColor: 'var(--bg-deep)',
    color: 'var(--text)',
    padding: 10,
    fontSize: 13,
    lineHeight: 1.45,
    outline: 'none',
    boxSizing: 'border-box',
  },
  contactFollowupPanel: {
    marginTop: 10,
    border: '1px solid var(--border)',
    borderRadius: 8,
    backgroundColor: 'var(--bg-deep)',
    padding: 10,
  },
  contactFollowupHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 10,
    flexWrap: 'wrap',
    marginBottom: 8,
  },
  contactFollowupTitle: {
    marginTop: 3,
    color: 'var(--text)',
    fontSize: 13,
    fontWeight: 900,
  },
  contactFollowupTitleDanger: {
    color: '#C62828',
  },
  contactFollowupQuick: {
    display: 'flex',
    gap: 6,
    flexWrap: 'wrap',
  },
  followupBtn: {
    border: '1px solid var(--border2)',
    borderRadius: 8,
    backgroundColor: 'var(--bg-card)',
    color: 'var(--accent)',
    padding: '6px 9px',
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 800,
  },
  followupClearBtn: {
    color: 'var(--text-muted)',
    border: '1px solid var(--border)',
  },
  contactFollowupInputRow: {
    display: 'grid',
    gridTemplateColumns: 'minmax(180px, 1fr) auto',
    gap: 8,
    alignItems: 'center',
  },
  contactFollowupInput: {
    minHeight: 34,
    border: '1px solid var(--border)',
    borderRadius: 8,
    backgroundColor: 'var(--bg-card)',
    color: 'var(--text)',
    padding: '6px 8px',
    fontSize: 12,
    fontWeight: 700,
    minWidth: 0,
  },
  clientContactActions: {
    marginTop: 10,
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 8,
    flexWrap: 'wrap',
  },
  contactHistory: {
    marginTop: 12,
    borderTop: '1px solid var(--border)',
    paddingTop: 10,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  contactHistoryTitle: {
    fontSize: 11,
    color: 'var(--text-muted)',
    fontWeight: 900,
    textTransform: 'uppercase',
    letterSpacing: 0,
  },
  contactHistoryItem: {
    display: 'grid',
    gridTemplateColumns: '12px 1fr',
    gap: 8,
    alignItems: 'start',
    border: '1px solid var(--border)',
    borderRadius: 8,
    backgroundColor: 'var(--bg-deep)',
    padding: '8px 9px',
  },
  contactHistoryBody: {
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 3,
  },
  contactHistoryTop: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 10,
    color: 'var(--text)',
    fontSize: 12,
    fontWeight: 800,
  },
  contactHistoryMeta: {
    color: 'var(--text-muted)',
    fontSize: 12,
    lineHeight: 1.35,
    overflowWrap: 'anywhere',
  },
  listCardsWrap: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  listCardsHeader: {
    background: 'linear-gradient(135deg, var(--glass-bg-strong), var(--glass-bg))',
    border: '1px solid var(--glass-border)',
    borderRadius: 8,
    padding: '10px 12px',
    boxShadow: 'var(--shadow-sm)',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  listCardsHeaderText: { fontSize: 12, color: 'var(--text-muted)', fontWeight: 700 },
  listCardsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 360px), 1fr))',
    gap: 12,
  },
  listTaskCard: {
    background: 'linear-gradient(160deg, var(--bg-card) 0%, var(--bg-card2) 100%)',
    border: '1px solid var(--glass-border)',
    borderRadius: 8,
    boxShadow: 'var(--shadow-md)',
    padding: 14,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    cursor: 'pointer',
    minHeight: 320,
  },
  listTaskTop: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  listTaskClient: { fontSize: 16, fontWeight: 900, color: 'var(--text)', lineHeight: 1.25, overflowWrap: 'anywhere' },
  listTaskMeta: { fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.35, overflowWrap: 'anywhere' },
  contactMini: {
    display: 'inline-flex',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    border: '1px solid var(--border)',
    borderRadius: 8,
    backgroundColor: 'var(--bg-deep)',
    color: 'var(--text-muted)',
    padding: '4px 7px',
    fontSize: 11,
    fontWeight: 800,
  },
  contactMiniFollowup: {
    color: 'var(--text-sub)',
  },
  contactMiniDanger: {
    color: '#C62828',
    border: '1px solid rgba(248,113,113,0.32)',
    backgroundColor: 'rgba(248,113,113,0.09)',
  },
  contactDot: {
    width: 7,
    height: 7,
    borderRadius: '50%',
    backgroundColor: 'var(--text-muted)',
    boxShadow: '0 0 0 2px rgba(148,163,184,0.12)',
    flexShrink: 0,
  },
  contactDot_good: {
    backgroundColor: '#34D399',
    boxShadow: '0 0 0 2px rgba(52,211,153,0.16)',
  },
  contactDot_warning: {
    backgroundColor: '#F9A825',
    boxShadow: '0 0 0 2px rgba(249,168,37,0.16)',
  },
  contactDot_danger: {
    backgroundColor: '#EF5350',
    boxShadow: '0 0 0 2px rgba(239,83,80,0.16)',
  },
  contactDot_muted: {
    backgroundColor: '#94A3B8',
    boxShadow: '0 0 0 2px rgba(148,163,184,0.12)',
  },
  workflowStageRow: {
    border: '1px solid var(--border)',
    borderRadius: 8,
    backgroundColor: 'var(--bg-deep)',
    padding: '8px 9px',
    display: 'grid',
    gridTemplateColumns: '28px 1fr',
    gap: 8,
    alignItems: 'center',
  },
  workflowStageStep: {
    width: 24,
    height: 24,
    borderRadius: 8,
    backgroundColor: 'var(--accent-surface)',
    color: 'var(--accent)',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 12,
    fontWeight: 950,
  },
  workflowStageBody: {
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    color: 'var(--text)',
    fontSize: 12,
    fontWeight: 900,
  },
  workflowStage_good: {
    border: '1px solid rgba(52,211,153,0.32)',
    backgroundColor: 'rgba(52,211,153,0.09)',
  },
  workflowStage_warning: {
    border: '1px solid rgba(242,184,75,0.32)',
    backgroundColor: 'rgba(251,191,36,0.1)',
  },
  workflowStage_blue: {
    border: '1px solid rgba(91,192,235,0.3)',
    backgroundColor: 'rgba(91,192,235,0.08)',
  },
  workflowStage_danger: {
    border: '1px solid rgba(248,113,113,0.28)',
    backgroundColor: 'rgba(248,113,113,0.08)',
  },
  workflowStage_muted: {
    border: '1px solid var(--border)',
  },
  fieldOpsRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(86px, 1fr))',
    gap: 6,
  },
  fieldOpsBtn: {
    minHeight: 32,
    border: '1px solid var(--border2)',
    borderRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.16)',
    color: 'var(--accent)',
    padding: '6px 8px',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    fontSize: 11,
    fontWeight: 800,
    textDecoration: 'none',
    whiteSpace: 'nowrap',
  },
  fieldOpsBtnDisabled: {
    color: 'var(--text-muted)',
    cursor: 'default',
    opacity: 0.7,
  },
  fieldOpsIcon: { fontSize: 15, flexShrink: 0 },
  documentationRow: {
    border: '1px solid var(--border)',
    borderRadius: 8,
    backgroundColor: 'var(--bg-deep)',
    padding: '7px 8px',
    display: 'grid',
    gridTemplateColumns: '1fr repeat(3, auto)',
    alignItems: 'center',
    gap: 8,
    color: 'var(--text-sub)',
    fontSize: 11,
    fontWeight: 800,
  },
  documentationRowWarning: {
    border: '1px solid rgba(248,113,113,0.28)',
    backgroundColor: 'rgba(248,113,113,0.08)',
  },
  documentationLabel: {
    color: 'var(--text)',
    fontWeight: 950,
    textTransform: 'uppercase',
  },
  documentationMetric: {
    whiteSpace: 'nowrap',
    color: 'var(--text-muted)',
  },
  listTaskChips: { display: 'flex', gap: 6, flexWrap: 'wrap' },
  readinessBlock: {
    border: '1px solid var(--border)',
    borderRadius: 8,
    padding: '8px 9px',
    backgroundColor: 'rgba(0,0,0,0.16)',
  },
  readinessTop: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
    fontSize: 11,
    color: 'var(--text-muted)',
    fontWeight: 800,
    textTransform: 'uppercase',
  },
  readinessTrack: {
    marginTop: 6,
    height: 5,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: 'rgba(148,163,184,0.18)',
  },
  readinessFill: {
    display: 'block',
    height: '100%',
    borderRadius: 8,
    transition: 'width 0.18s ease',
  },
  blockerWrap: { display: 'flex', gap: 5, flexWrap: 'wrap', minHeight: 22 },
  blockerBadge: {
    padding: '3px 7px',
    borderRadius: 8,
    fontSize: 10,
    fontWeight: 800,
    border: '1px solid var(--border)',
    lineHeight: 1.3,
  },
  blockerDanger: {
    backgroundColor: 'rgba(248,113,113,0.14)',
    border: '1px solid rgba(248,113,113,0.28)',
    color: '#C62828',
  },
  blockerWarning: {
    backgroundColor: 'rgba(251,191,36,0.15)',
    border: '1px solid rgba(251,191,36,0.3)',
    color: '#A16207',
  },
  blockerGood: {
    backgroundColor: 'rgba(52,211,153,0.14)',
    border: '1px solid rgba(52,211,153,0.3)',
    color: 'var(--accent)',
  },
  nextActionRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
    paddingTop: 4,
  },
  nextActionText: {
    fontSize: 11,
    color: 'var(--text-muted)',
    fontWeight: 800,
    textTransform: 'uppercase',
  },
  nextActionBtn: {
    border: '1px solid var(--accent)',
    borderRadius: 8,
    background: 'linear-gradient(135deg, var(--accent), var(--accent-dk))',
    color: 'var(--on-accent)',
    padding: '6px 9px',
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 900,
    maxWidth: 170,
    textAlign: 'center',
  },
  listTaskFooter: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 },
  listTaskDate: { fontSize: 12, color: 'var(--text-sub)', fontWeight: 600 },
  listTaskValue: { fontSize: 13, color: 'var(--accent)', fontWeight: 800 },
};
