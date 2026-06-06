import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import api from '../api';
import CommandSidebar from '../components/CommandSidebar';
import LanguageSwitcher from '../components/LanguageSwitcher';
import { readStoredUser } from '../utils/readStoredUser';
import { getRoleDisplayName } from '../utils/roleDisplay';
import { getStoredToken } from '../utils/storedToken';
import { clearAuthSession } from '../utils/authSession';
import { useTheme, THEMES } from '../ThemeContext';
import { getRolaColor } from '../theme';
import { isTaskClosed } from '../utils/taskWorkflow';

const SMART_FILTER_KEY = 'zlecenia_smart_filter';
const SMART_FILTER_INTENT_KEY = 'zlecenia_smart_filter_intent_at';

const FIELD_ROLES = new Set(['Brygadzista', 'Pomocnik', 'Pomocnik bez doświadczenia']);
const MANAGEMENT_ROLES = new Set(['Administrator', 'Dyrektor', 'Kierownik']);
const TODAY = new Date().toISOString().slice(0, 10);
const OPERATOR_TASK_STATUS_LABELS = {
  todo: 'Do zrobienia',
  in_progress: 'W toku',
  done: 'Gotowe',
  archived: 'Archiwum',
};
const OPERATOR_TASK_PRIORITY_LABELS = {
  low: 'Niski',
  normal: 'Normalny',
  high: 'Ważny',
  urgent: 'Pilne',
};
const SETTLEMENT_TYPE_LABELS = {
  hourly: 'Stawka godzinowa',
  daily: 'Stawka dzienna',
  fixed: 'Stała miesięczna',
  percent_revenue: '% od przychodu',
  percent_margin: '% od marży',
  mixed: 'Mix: fix + % + bonus',
  b2b: 'B2B / indywidualnie',
};
const EMPTY_POSITION_CARD_DRAFT = {
  user_id: '',
  stanowisko: '',
  cenny_produkt: '',
  obowiazki: '',
  kryteria: '',
  settlement_type: 'mixed',
  fixed_amount_pln: '',
  daily_rate_pln: '',
  hourly_rate_pln: '',
  revenue_percent: '',
  margin_percent: '',
  bonus_rules: '',
  settlement_notes: '',
};
const CREW_MANAGER_TEMPLATE = {
  stanowisko: 'Kierownik brygad',
  cenny_produkt: 'Efektywna praca brygad',
  obowiazki: [
    'Regularne zarządzanie pracą podległych brygad i utrzymywanie wspólnego pola informacyjnego.',
    'Codzienna weryfikacja pracy brygad, obciążenia ludzi i dostępności pracy na kolejne dni.',
    'Kontrola przestrzegania BHP oraz zgłaszanie potrzeby dodatkowych szkoleń.',
    'Kontrola sprzętu, serwisu, logistyki i gotowości brygad do realizacji zleceń.',
    'Szybkie eskalowanie problemów z brygadami, klientami, sprzętem i kosztami produkcji.',
    'Regularne spotkania z pracownikami i rozwijanie składu brygad.',
  ].join('\n'),
  kryteria: [
    'Brygady są zabezpieczone pracą, wiedzą co robić i pracują bez przestojów.',
    'Problemy operacyjne są rozwiązywane zanim zatrzymają realizację.',
    'Sprzęt jest obsługiwany zgodnie z instrukcjami, a koszty produkcji są pod kontrolą.',
  ].join('\n'),
  settlement_type: 'mixed',
  fixed_amount_pln: '3450',
  daily_rate_pln: '150',
  hourly_rate_pln: '',
  revenue_percent: '4',
  margin_percent: '20',
  bonus_rules: 'Bonusy za wykonanie planu, amortyzację, użycie własnego samochodu lub dodatkowe ustalenia.',
  settlement_notes: 'Szablon na podstawie przykładowej karty. Kwoty i procenty należy potwierdzić przed podpisaniem.',
};

const BHP_CHECKLIST = [
  'Kask, okulary, ochronniki słuchu, rękawice i spodnie antyprzecięciowe',
  'Ocena drzewa, strefy upadku, martwych konarów i podłoża',
  'Linie energetyczne, drogi, chodniki i osoby postronne zabezpieczone',
  'Piła, pilarka na wysięgniku i rębak sprawdzone przed startem',
  'Apteczka, łączność, osoba asekurująca i plan awaryjny dostępne',
  'Raport mobilny, zdjęcia i uwagi przekazane po realizacji',
];

const OFFICE_CHECKLIST = [
  'Dane klientów i pracowników przetwarzane tylko w ARBOR-OS',
  'CRM, zlecenia i follow-upy aktualizowane w dniu kontaktu',
  'Dokumenty finansowe i kadrowe opisane, bez plików na prywatnych kontach',
  'Telefon, e-mail i notatki z rozmów przekazane do właściwego zlecenia',
  'Sprawy niedomknięte oznaczone statusem, terminem i właścicielem',
  'Dostęp do systemu używany wyłącznie z konta imiennego',
];

const EMPTY_DOCUMENTS = Object.freeze([]);
const EMPLOYEE_DOCUMENT_TYPE_LABELS = {
  contract: 'Umowa',
  medical: 'Badania lekarskie',
  bhp: 'BHP',
  qualification: 'Uprawnienia',
  office_card: 'Karta biurowa',
  settlement: 'Warunki rozliczenia',
  id: 'Dokument tozsamosci',
  other: 'Inny dokument',
};
const EMPLOYEE_DOCUMENT_STATUS_LABELS = {
  valid: 'Aktywny',
  pending: 'Do uzupelnienia',
  expired: 'Po terminie',
  archived: 'Archiwum',
};
const EMPTY_EMPLOYEE_DOCUMENT_DRAFT = {
  type: 'contract',
  title: '',
  issued_at: '',
  expires_at: '',
  status: 'valid',
  notes: '',
};

function fullName(user) {
  return [user?.imie, user?.nazwisko].filter(Boolean).join(' ') || user?.login || 'Operator';
}

function isFieldWorker(user) {
  const role = String(user?.rola || '');
  const position = String(user?.stanowisko || '').toLowerCase();
  return FIELD_ROLES.has(role) || position.includes('arbor') || position.includes('pilarz') || position.includes('teren');
}

function getDocAckKey(user, docType) {
  return `arbor_profile_ack_${user?.id || 'guest'}_${docType}_${TODAY}`;
}

function getTaskDay(task) {
  return task?.data_planowana || task?.data_wykonania
    ? String(task.data_planowana || task.data_wykonania).slice(0, 10)
    : '';
}

function formatDate(value) {
  if (!value) return 'brak terminu';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return date.toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit' });
}

function formatDateTime(value) {
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

function formatDateOnly(value) {
  if (!value) return 'brak';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10) || 'brak';
  return date.toLocaleDateString('pl-PL', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

function formatMoney(value) {
  const num = Number(value) || 0;
  return `${num.toLocaleString('pl-PL', { maximumFractionDigits: 0 })} PLN`;
}

function normalizeContactsPayload(payload) {
  const raw = payload?.contacts || payload || {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return Object.entries(raw).reduce((acc, [taskId, contact]) => {
    acc[String(taskId)] = {
      taskId: Number(taskId),
      status: contact?.status || '',
      note: contact?.note || '',
      dueAt: contact?.dueAt || contact?.due_at || null,
      updatedAt: contact?.updatedAt || contact?.updated_at || null,
      actor: contact?.actor || '',
    };
    return acc;
  }, {});
}

function normalizeClosurePayload(payload) {
  const raw = payload?.events || payload || {};
  if (!raw || typeof raw !== 'object') return [];
  const rows = Array.isArray(raw)
    ? raw
    : Object.entries(raw).flatMap(([taskId, list]) =>
        (Array.isArray(list) ? list : []).map((event) => ({ ...event, task_id: event.task_id || taskId }))
      );
  return rows
    .filter(Boolean)
    .map((event) => ({
      ...event,
      task_id: Number(event.task_id),
      value: Number(event.value) || 0,
      risk_score: Number(event.risk_score ?? event.riskScore) || 0,
      created_at: event.created_at || event.createdAt || null,
      actor: event.actor || 'Operator',
      blockers: Array.isArray(event.blockers) ? event.blockers : [],
      warnings: Array.isArray(event.warnings) ? event.warnings : [],
    }))
    .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
}

function normalizeOperatorTasksPayload(payload) {
  const rows = Array.isArray(payload?.tasks) ? payload.tasks : Array.isArray(payload) ? payload : [];
  return rows
    .filter(Boolean)
    .map((task) => ({
      ...task,
      id: Number(task.id),
      assigned_to: Number(task.assigned_to),
      created_by: Number(task.created_by),
      title: task.title || '',
      opis: task.opis || '',
      status: task.status || 'todo',
      priority: task.priority || 'normal',
      due_at: task.due_at || null,
      assignee_name: task.assignee_name || '',
      created_by_name: task.created_by_name || '',
    }));
}

function normalizePositionCardsPayload(payload) {
  const rows = Array.isArray(payload?.cards) ? payload.cards : Array.isArray(payload) ? payload : [];
  return rows.reduce((acc, card) => {
    if (!card?.user_id) return acc;
    acc[String(card.user_id)] = card;
    return acc;
  }, {});
}

function normalizeEmployeeDocumentsPayload(payload) {
  const rows = Array.isArray(payload?.documents) ? payload.documents : Array.isArray(payload) ? payload : [];
  return rows.reduce((acc, doc) => {
    if (!doc?.user_id) return acc;
    const key = String(doc.user_id);
    if (!acc[key]) acc[key] = [];
    acc[key].push({
      ...doc,
      id: Number(doc.id),
      user_id: Number(doc.user_id),
      type: doc.type || 'other',
      title: doc.title || EMPLOYEE_DOCUMENT_TYPE_LABELS[doc.type] || 'Dokument pracownika',
      status: doc.status || 'valid',
      expiry_status: doc.expiry_status || getDocumentExpiryMeta(doc).key,
    });
    return acc;
  }, {});
}

function actionLabel(action) {
  return {
    blocked_attempt: 'Zatrzymano zamknięcie',
    warning_review: 'Kontrola z uwagami',
    forced_close: 'Zamknięto mimo uwag',
    clean_close: 'Zamknięto bez blokad',
    fix_started: 'Wrócono do poprawy',
  }[action] || 'Decyzja operatora';
}

function buildRolePermissions(user) {
  const role = user?.rola || '';
  const isManagement = MANAGEMENT_ROLES.has(role);
  const isCrew = FIELD_ROLES.has(role);
  return [
    { label: 'Zlecenia', enabled: true, detail: isCrew ? 'widok ekipy' : 'pełny obieg pracy' },
    { label: 'Zmiana statusu', enabled: isManagement || isCrew, detail: isManagement ? 'pełne decyzje' : 'realizacja w terenie' },
    { label: 'Audyt zamykania', enabled: isManagement, detail: isManagement ? 'kontrola jakości' : 'tylko historia swoich prac' },
    { label: 'Kadry i role', enabled: role === 'Administrator' || role === 'Dyrektor', detail: 'uprawnienia i pracownicy' },
    { label: 'CRM i wyceny', enabled: isManagement || role === 'Wyceniający' || role === 'Specjalista', detail: 'kontakt i sprzedaż' },
  ];
}

function buildOfficeScope(user) {
  const role = user?.rola || '';
  if (role === 'Wyceniający') return 'wyceny terenowe, kontakt z klientem, oferta i przekazanie do realizacji';
  if (role === 'Kierownik') return 'plan dnia, ekipy, jakość danych, follow-upy i eskalacje';
  if (role === 'Specjalista') return 'obsługa operacyjna, CRM, dokumentacja i koordynacja zleceń';
  if (role === 'Magazynier') return 'sprzęt, rezerwacje, wydania, zwroty i stan techniczny';
  if (role === 'Administrator') return 'konfiguracja systemu, użytkownicy, uprawnienia, integracje i audyt';
  if (role === 'Dyrektor') return 'kontrola finansów, decyzje, jakość procesu i priorytety operacyjne';
  return 'obsługa biurowa, dokumentacja, kontakt i porządek danych';
}

function isTaskRelatedToUser(task, user) {
  if (!task || !user) return false;
  if (MANAGEMENT_ROLES.has(user.rola)) return true;
  const userId = String(user.id || '');
  const teamId = String(user.ekipa_id || '');
  return (
    String(task.kierownik_id || '') === userId ||
    String(task.wyceniajacy_id || '') === userId ||
    String(task.user_id || '') === userId ||
    (teamId && String(task.ekipa_id || '') === teamId)
  );
}

function canOpenEmployeeProfile(actor, target) {
  if (!actor || !target) return false;
  if (Number(actor.id) === Number(target.id)) return true;
  if (actor.rola === 'Administrator' || actor.rola === 'Dyrektor') return true;
  if (actor.rola === 'Kierownik') {
    return String(actor.oddzial_id || '') === String(target.oddzial_id || '');
  }
  return false;
}

function isOperatorTaskOpen(task) {
  return task && task.status !== 'done' && task.status !== 'archived';
}

function getOperatorTaskDueMeta(task) {
  if (!task?.due_at) return { label: 'bez terminu', overdue: false, today: false };
  const due = new Date(task.due_at);
  if (Number.isNaN(due.getTime())) return { label: 'bez terminu', overdue: false, today: false };
  const dueDay = due.toISOString().slice(0, 10);
  return {
    label: formatDateTime(task.due_at),
    overdue: isOperatorTaskOpen(task) && due.getTime() < Date.now(),
    today: isOperatorTaskOpen(task) && dueDay === TODAY,
  };
}

function splitCardLines(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-•\s]+/, '').trim())
    .filter(Boolean);
}

function buildPositionCardDraft(card, employee) {
  return {
    ...EMPTY_POSITION_CARD_DRAFT,
    user_id: String(card?.user_id || employee?.id || ''),
    stanowisko: card?.stanowisko || employee?.stanowisko || employee?.rola || '',
    cenny_produkt: card?.cenny_produkt || '',
    obowiazki: card?.obowiazki || '',
    kryteria: card?.kryteria || '',
    settlement_type: card?.settlement_type || (employee?.rola === 'Brygadzista' ? 'percent_revenue' : 'mixed'),
    fixed_amount_pln: card?.fixed_amount_pln ?? '',
    daily_rate_pln: card?.daily_rate_pln ?? '',
    hourly_rate_pln: card?.hourly_rate_pln ?? employee?.stawka_godzinowa ?? '',
    revenue_percent: card?.revenue_percent ?? employee?.procent_wynagrodzenia ?? '',
    margin_percent: card?.margin_percent ?? '',
    bonus_rules: card?.bonus_rules || '',
    settlement_notes: card?.settlement_notes || '',
  };
}

function formatSettlement(card) {
  if (!card) return 'Brak zapisanych warunków rozliczenia.';
  const parts = [];
  if (card.fixed_amount_pln) parts.push(`fix ${formatMoney(card.fixed_amount_pln)}`);
  if (card.daily_rate_pln) parts.push(`${formatMoney(card.daily_rate_pln)} / dzień`);
  if (card.hourly_rate_pln) parts.push(`${formatMoney(card.hourly_rate_pln)} / h`);
  if (card.revenue_percent) parts.push(`${card.revenue_percent}% od przychodu`);
  if (card.margin_percent) parts.push(`${card.margin_percent}% od marży`);
  if (!parts.length) parts.push(SETTLEMENT_TYPE_LABELS[card.settlement_type] || 'indywidualnie');
  return parts.join(' · ');
}

function cardAckLabel(card) {
  if (!card?.updated_at) return 'Karta nieopublikowana';
  if (card.acknowledgement_status === 'confirmed') return `Podpisano ${formatDateTime(card.acknowledged_at)}`;
  return 'Do potwierdzenia przez pracownika';
}

function getDocumentExpiryMeta(doc) {
  const key = doc?.expiry_status || doc?.status || 'valid';
  if (key === 'archived') return { key, label: 'Archiwum', tone: 'muted' };
  if (key === 'pending') return { key, label: 'Do uzupelnienia', tone: 'warn' };
  if (key === 'expired') return { key, label: 'Po terminie', tone: 'danger' };
  if (key === 'expiring') return { key, label: 'Wygasa wkrotce', tone: 'warn' };
  if (!doc?.expires_at) return { key: 'no_expiry', label: 'Bez terminu', tone: 'ok' };
  const expiry = new Date(`${String(doc.expires_at).slice(0, 10)}T23:59:59.999Z`);
  if (Number.isNaN(expiry.getTime())) return { key: 'no_expiry', label: 'Bez terminu', tone: 'ok' };
  const diffDays = Math.ceil((expiry.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
  if (diffDays < 0) return { key: 'expired', label: 'Po terminie', tone: 'danger' };
  if (diffDays <= 45) return { key: 'expiring', label: `Wygasa za ${diffDays} dni`, tone: 'warn' };
  return { key: 'valid', label: 'Aktualny', tone: 'ok' };
}

function isDocumentCurrent(doc) {
  const meta = getDocumentExpiryMeta(doc);
  return !['archived', 'pending', 'expired'].includes(meta.key);
}

function findCurrentDocument(documents, types) {
  const typeSet = new Set(types);
  return (documents || [])
    .filter((doc) => typeSet.has(doc.type))
    .sort((a, b) => {
      const aCurrent = isDocumentCurrent(a) ? 0 : 1;
      const bCurrent = isDocumentCurrent(b) ? 0 : 1;
      if (aCurrent !== bCurrent) return aCurrent - bCurrent;
      const aDate = a.expires_at || '9999-12-31';
      const bDate = b.expires_at || '9999-12-31';
      return String(aDate).localeCompare(String(bDate));
    })[0] || null;
}

function documentCompletenessDetail(doc) {
  if (!doc) return 'brak dokumentu';
  const meta = getDocumentExpiryMeta(doc);
  const expiry = doc.expires_at ? `do ${formatDateOnly(doc.expires_at)}` : meta.label;
  return `${EMPLOYEE_DOCUMENT_TYPE_LABELS[doc.type] || doc.type} - ${expiry}`;
}

function buildEmployeeDocumentSummary(documents, fieldWorker) {
  const requiredTypes = ['contract', 'medical', fieldWorker ? 'bhp' : 'office_card'];
  if (fieldWorker) requiredTypes.push('qualification');
  const required = requiredTypes.map((type) => ({
    type,
    label: EMPLOYEE_DOCUMENT_TYPE_LABELS[type] || type,
    doc: findCurrentDocument(documents, [type]),
  }));
  const expired = documents.filter((doc) => getDocumentExpiryMeta(doc).key === 'expired');
  const expiring = documents.filter((doc) => getDocumentExpiryMeta(doc).key === 'expiring');
  const pending = documents.filter((doc) => getDocumentExpiryMeta(doc).key === 'pending');
  return {
    total: documents.length,
    required,
    missing: required.filter((item) => !item.doc || !isDocumentCurrent(item.doc)),
    expired,
    expiring,
    pending,
    needsAttention: expired.length + expiring.length + pending.length + required.filter((item) => !item.doc || !isDocumentCurrent(item.doc)).length,
  };
}

function buildEmployeeTerms(user, card) {
  return [
    { label: 'Stanowisko', value: card?.stanowisko || user?.stanowisko || getRoleDisplayName(user?.rola, 'brak') },
    { label: 'Oddział', value: user?.oddzial_nazwa || (user?.oddzial_id ? `Oddział #${user.oddzial_id}` : 'brak') },
    { label: 'Data zatrudnienia', value: formatDateOnly(user?.data_zatrudnienia) },
    { label: 'Status konta', value: user?.aktywny === false ? 'Nieaktywny' : 'Aktywny' },
    { label: 'Rozliczenie', value: card?.updated_at ? formatSettlement(card) : 'brak karty rozliczenia' },
    { label: 'Stawka bazowa', value: user?.stawka_godzinowa ? `${formatMoney(user.stawka_godzinowa)} / h` : 'brak' },
    { label: 'Procent', value: user?.procent_wynagrodzenia ? `${user.procent_wynagrodzenia}%` : 'brak' },
    { label: 'Dodatki', value: user?.wynagrodzenie_dodatki_pln ? formatMoney(user.wynagrodzenie_dodatki_pln) : 'brak' },
  ];
}

function buildEmployeeCompleteness(user, card, fieldWorker, documents = EMPTY_DOCUMENTS) {
  const contractDoc = findCurrentDocument(documents, ['contract', 'settlement']);
  const medicalDoc = findCurrentDocument(documents, ['medical']);
  const safetyDoc = findCurrentDocument(documents, [fieldWorker ? 'bhp' : 'office_card', 'bhp']);
  const qualificationDoc = fieldWorker ? findCurrentDocument(documents, ['qualification']) : null;
  const items = [
    {
      label: 'Dane kontaktowe',
      done: Boolean(user?.telefon && user?.email),
      detail: user?.telefon || user?.email ? [user?.telefon, user?.email].filter(Boolean).join(' · ') : 'brak telefonu lub e-maila',
    },
    {
      label: 'Kontakt awaryjny',
      done: Boolean(user?.kontakt_awaryjny_imie || user?.kontakt_awaryjny_telefon),
      detail: [user?.kontakt_awaryjny_imie, user?.kontakt_awaryjny_telefon].filter(Boolean).join(' · ') || 'do uzupełnienia',
    },
    {
      label: 'Stanowisko i oddział',
      done: Boolean((user?.stanowisko || card?.stanowisko || user?.rola) && (user?.oddzial_id || user?.oddzial_nazwa)),
      detail: `${card?.stanowisko || user?.stanowisko || getRoleDisplayName(user?.rola, 'brak')} · ${user?.oddzial_nazwa || user?.oddzial_id || 'brak oddziału'}`,
    },
    {
      label: 'Warunki rozliczenia',
      done: Boolean(card?.updated_at || user?.stawka_godzinowa || user?.procent_wynagrodzenia),
      detail: card?.updated_at ? formatSettlement(card) : 'brak opublikowanej karty',
    },
    {
      label: 'Karta stanowiska',
      done: Boolean(card?.updated_at),
      detail: card?.updated_at ? `wersja ${formatDateTime(card.updated_at)}` : 'nieopublikowana',
    },
    {
      label: 'Podpis pracownika',
      done: card?.acknowledgement_status === 'confirmed',
      detail: card?.acknowledgement_status === 'confirmed' ? formatDateTime(card.acknowledged_at) : 'czeka na podpis',
    },
    {
      label: fieldWorker ? 'BHP terenowe' : 'Karta biurowa',
      done: Boolean(safetyDoc && isDocumentCurrent(safetyDoc)),
      detail: safetyDoc ? documentCompletenessDetail(safetyDoc) : fieldWorker ? 'brak szkolenia BHP' : 'brak karty biurowej',
    },
    {
      label: 'Umowa / formalnosci',
      done: Boolean(contractDoc && isDocumentCurrent(contractDoc)),
      detail: contractDoc ? documentCompletenessDetail(contractDoc) : 'brak umowy lub warunkow formalnych',
    },
    {
      label: 'Badania lekarskie',
      done: Boolean(medicalDoc && isDocumentCurrent(medicalDoc)),
      detail: medicalDoc ? documentCompletenessDetail(medicalDoc) : 'brak badan lub terminu waznosci',
    },
  ];
  if (fieldWorker) {
    items.push({
      label: 'Uprawnienia terenowe',
      done: Boolean(qualificationDoc && isDocumentCurrent(qualificationDoc)),
      detail: qualificationDoc ? documentCompletenessDetail(qualificationDoc) : 'brak pilarki, wysokosci lub innych uprawnien',
    });
  }
  const doneCount = items.filter((item) => item.done).length;
  return {
    items,
    doneCount,
    total: items.length,
    score: Math.round((doneCount / items.length) * 100),
  };
}

export default function Profil() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { userId: routeUserIdParam } = useParams();
  const hashRouteUserId =
    typeof window !== 'undefined'
      ? String(window.location.hash || '').match(/^#\/profil\/([^/?#]+)/)?.[1] || ''
      : '';
  const routeUserId = routeUserIdParam || String(location.pathname || '').match(/^\/profil\/([^/]+)/)?.[1] || hashRouteUserId || '';
  const { themeId, setTheme } = useTheme();
  const [actorUser, setActorUser] = useState(null);
  const [user, setUser] = useState(null);
  const [ops, setOps] = useState({
    loading: true,
    apiOk: null,
    tasks: [],
    contacts: {},
    closureEvents: [],
    operatorTasks: [],
    positionCards: {},
    employeeDocuments: {},
    users: [],
  });
  const [docAck, setDocAck] = useState('');
  const [assignmentDraft, setAssignmentDraft] = useState({
    assigned_to: '',
    title: '',
    opis: '',
    priority: 'normal',
    due_at: '',
  });
  const [taskBusyId, setTaskBusyId] = useState(null);
  const [taskFormMessage, setTaskFormMessage] = useState('');
  const [selectedCardUserId, setSelectedCardUserId] = useState('');
  const selectedCardUserIdRef = useRef('');
  const [positionCardDraft, setPositionCardDraft] = useState(EMPTY_POSITION_CARD_DRAFT);
  const [positionCardBusy, setPositionCardBusy] = useState(false);
  const [positionCardMessage, setPositionCardMessage] = useState('');
  const [positionAckBusy, setPositionAckBusy] = useState(false);
  const [positionAckMessage, setPositionAckMessage] = useState('');
  const employeeDocFileRef = useRef(null);
  const profilePhotoFileRef = useRef(null);
  const [employeeDocDraft, setEmployeeDocDraft] = useState(EMPTY_EMPLOYEE_DOCUMENT_DRAFT);
  const [employeeDocBusy, setEmployeeDocBusy] = useState(false);
  const [employeeDocMessage, setEmployeeDocMessage] = useState('');
  const [profilePhotoBusy, setProfilePhotoBusy] = useState(false);
  const [profilePhotoMessage, setProfilePhotoMessage] = useState('');
  const [profileEditDraft, setProfileEditDraft] = useState({
    imie: '',
    nazwisko: '',
    email: '',
    telefon: '',
    stanowisko: '',
    data_zatrudnienia: '',
    adres_zamieszkania: '',
    kontakt_awaryjny_imie: '',
    kontakt_awaryjny_telefon: '',
    notatki: '',
  });
  const [profileEditBusy, setProfileEditBusy] = useState(false);
  const [profileEditMessage, setProfileEditMessage] = useState('');
  const [profileAccessMessage, setProfileAccessMessage] = useState('');

  useEffect(() => {
    if (!getStoredToken()) {
      navigate('/');
      return;
    }
    const stored = readStoredUser();
    if (!stored) {
      navigate('/');
      return;
    }
    setActorUser(stored);
    setUser(stored);
  }, [navigate]);

  const fieldWorker = isFieldWorker(user);
  const docType = fieldWorker ? 'bhp' : 'office';
  const actorId = actorUser?.id;
  const actorRole = actorUser?.rola;
  const actorBranchId = actorUser?.oddzial_id;
  const actorLogin = actorUser?.login;
  const actorFirstName = actorUser?.imie;
  const actorLastName = actorUser?.nazwisko;
  const actorBranchName = actorUser?.oddzial_nazwa;

  useEffect(() => {
    if (!user?.id) return;
    setDocAck(localStorage.getItem(getDocAckKey(user, docType)) || '');
  }, [user?.id, docType]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!user?.id) return;
    setProfileEditDraft({
      imie: user.imie || '',
      nazwisko: user.nazwisko || '',
      email: user.email || '',
      telefon: user.telefon || '',
      stanowisko: user.stanowisko || '',
      data_zatrudnienia: user.data_zatrudnienia ? String(user.data_zatrudnienia).slice(0, 10) : '',
      adres_zamieszkania: user.adres_zamieszkania || '',
      kontakt_awaryjny_imie: user.kontakt_awaryjny_imie || '',
      kontakt_awaryjny_telefon: user.kontakt_awaryjny_telefon || '',
      notatki: user.notatki || '',
    });
    setProfileEditMessage('');
  }, [user?.id]);

  useEffect(() => {
    if (!actorId) return;
    let cancelled = false;

    async function loadOperatorData() {
      setOps((prev) => ({ ...prev, loading: true }));
      const endpoint = MANAGEMENT_ROLES.has(actorRole) ? '/tasks/wszystkie' : '/tasks';
      const [healthRes, tasksRes, contactsRes, closureRes, operatorTasksRes, positionCardsRes, employeeDocsRes, usersRes] = await Promise.allSettled([
        api.get('/health', { dedupe: false }),
        api.get(endpoint),
        api.get('/tasks/client-contacts').catch(() => ({ data: null })),
        api.get('/tasks/closure-events').catch(() => ({ data: null })),
        api.get('/operator-tasks').catch(() => ({ data: null })),
        api.get('/position-cards').catch(() => ({ data: null })),
        api.get('/employee-documents').catch(() => ({ data: null })),
        api.get('/uzytkownicy').catch(() => ({ data: [] })),
      ]);

      if (cancelled) return;
      const users = usersRes.status === 'fulfilled' && Array.isArray(usersRes.value.data) ? usersRes.value.data : [];
      const actorFallback = {
        id: actorId,
        login: actorLogin,
        imie: actorFirstName,
        nazwisko: actorLastName,
        rola: actorRole,
        oddzial_id: actorBranchId,
        oddzial_nazwa: actorBranchName,
      };
      const fullActor = users.find((row) => String(row.id) === String(actorId));
      const actor = fullActor ? { ...actorFallback, ...fullActor } : actorFallback;
      const requestedUserId = routeUserId || actor.id;
      const requestedUser = users.find((row) => String(row.id) === String(requestedUserId));
      const ownRequestedUser = String(requestedUserId) === String(actor.id) ? actor : null;
      const profileUser = requestedUser || ownRequestedUser;

      if (fullActor) {
        setActorUser((prev) => {
          const next = { ...(prev || {}), ...fullActor };
          return JSON.stringify(prev || {}) === JSON.stringify(next) ? prev : next;
        });
      }
      if (!profileUser) {
        setProfileAccessMessage('Nie znaleziono pracownika. Pokazuję Twój profil.');
        setUser(actor);
      } else if (!canOpenEmployeeProfile(actor, profileUser)) {
        setProfileAccessMessage('Nie masz dostępu do tego profilu. Pokazuję Twój profil.');
        setUser(actor);
      } else {
        setProfileAccessMessage('');
        setUser(profileUser);
      }

      setOps({
        loading: false,
        apiOk: healthRes.status === 'fulfilled' && healthRes.value?.status === 200,
        tasks: tasksRes.status === 'fulfilled' && Array.isArray(tasksRes.value.data) ? tasksRes.value.data : [],
        contacts: contactsRes.status === 'fulfilled' ? normalizeContactsPayload(contactsRes.value.data) : {},
        closureEvents: closureRes.status === 'fulfilled' ? normalizeClosurePayload(closureRes.value.data) : [],
        operatorTasks: operatorTasksRes.status === 'fulfilled' ? normalizeOperatorTasksPayload(operatorTasksRes.value.data) : [],
        positionCards: positionCardsRes.status === 'fulfilled' ? normalizePositionCardsPayload(positionCardsRes.value.data) : {},
        employeeDocuments: employeeDocsRes.status === 'fulfilled' ? normalizeEmployeeDocumentsPayload(employeeDocsRes.value.data) : {},
        users,
      });
    }

    loadOperatorData();
    return () => {
      cancelled = true;
    };
  }, [actorBranchId, actorBranchName, actorFirstName, actorId, actorLastName, actorLogin, actorRole, routeUserId]);

  const rolaColor = getRolaColor(user?.rola);
  const operatorName = fullName(user);
  const initials =
    `${String(user?.imie?.[0] || '').toUpperCase()}${String(user?.nazwisko?.[0] || '').toUpperCase()}` ||
    '?';
  const profilePhotoUrl = user?.profile_photo_url || user?.avatar_url || user?.photo_url || '';

  const dashboard = useMemo(() => {
    const relatedTasks = ops.tasks.filter((task) => isTaskRelatedToUser(task, user));
    const activeTasks = relatedTasks.filter((task) => !isTaskClosed(task.status));
    const todayTasks = activeTasks
      .filter((task) => {
        const day = getTaskDay(task);
        return !day || day <= TODAY;
      })
      .sort((a, b) => {
        const aDay = getTaskDay(a) || '9999-12-31';
        const bDay = getTaskDay(b) || '9999-12-31';
        return aDay.localeCompare(bDay) || Number(a.id || 0) - Number(b.id || 0);
      });
    const dueContacts = Object.values(ops.contacts)
      .filter((contact) => contact.dueAt && contact.status !== 'informed' && new Date(contact.dueAt).getTime() <= Date.now())
      .sort((a, b) => new Date(a.dueAt || 0).getTime() - new Date(b.dueAt || 0).getTime());
    const actorEvents = ops.closureEvents.filter((event) =>
      String(event.actor || '').toLowerCase() === operatorName.toLowerCase()
    );
    const visibleEvents = actorEvents.length ? actorEvents : ops.closureEvents;
    const repairTaskIds = new Set();
    visibleEvents.forEach((event) => {
      if ((event.blockers?.length || event.warnings?.length) && event.task_id) {
        repairTaskIds.add(String(event.task_id));
      }
    });
    const openOperatorTasks = ops.operatorTasks
      .filter(isOperatorTaskOpen)
      .sort((a, b) => {
        const aDue = a.due_at || '9999-12-31T23:59:59.999Z';
        const bDue = b.due_at || '9999-12-31T23:59:59.999Z';
        return String(aDue).localeCompare(String(bDue)) || Number(b.id || 0) - Number(a.id || 0);
      });
    const assignedOperatorTasks = openOperatorTasks.filter((task) => Number(task.assigned_to) === Number(user?.id));
    const delegatedOperatorTasks = openOperatorTasks.filter((task) => Number(task.created_by) === Number(user?.id));
    const operatorTaskQueue = [
      ...assignedOperatorTasks,
      ...delegatedOperatorTasks.filter((task) => Number(task.assigned_to) !== Number(user?.id)),
      ...openOperatorTasks.filter((task) => Number(task.assigned_to) !== Number(user?.id) && Number(task.created_by) !== Number(user?.id)),
    ].slice(0, 6);
    const overdueOperatorTasks = openOperatorTasks.filter((task) => getOperatorTaskDueMeta(task).overdue);
    const savedPositionCards = Object.values(ops.positionCards || {}).filter((card) => card?.updated_at);
    const pendingPositionCards = savedPositionCards.filter((card) => card.acknowledgement_status === 'pending');
    const visibleEmployeeDocuments = Object.values(ops.employeeDocuments || {}).flat();
    const employeeDocumentAlerts = visibleEmployeeDocuments.filter((doc) =>
      ['expired', 'expiring', 'pending'].includes(getDocumentExpiryMeta(doc).key)
    );

    return {
      relatedTasks,
      activeTasks,
      todayTasks: todayTasks.slice(0, 5),
      dueContacts,
      visibleEvents: visibleEvents.slice(0, 5),
      repairCount: repairTaskIds.size,
      decisionsCount: visibleEvents.length,
      openOperatorTasks,
      operatorTaskQueue,
      overdueOperatorTasks,
      savedPositionCards,
      pendingPositionCards,
      visibleEmployeeDocuments,
      employeeDocumentAlerts,
    };
  }, [ops.contacts, ops.closureEvents, ops.employeeDocuments, ops.operatorTasks, ops.positionCards, ops.tasks, operatorName, user]);

  const permissions = useMemo(() => buildRolePermissions(user), [user]);
  const canAssignTasks = MANAGEMENT_ROLES.has(actorUser?.rola);
  const canConfirmDocument = Number(actorUser?.id) === Number(user?.id);
  const canEditProfilePhoto =
    Number(actorUser?.id) === Number(user?.id) ||
    ['Administrator', 'Dyrektor', 'Prezes'].includes(actorUser?.rola) ||
    (actorUser?.rola === 'Kierownik' && String(actorUser?.oddzial_id || '') === String(user?.oddzial_id || ''));
  const canEditProfileData = canEditProfilePhoto;
  const assignableUsers = useMemo(() => {
    const rows = ops.users.filter((row) => row.aktywny !== false);
    if (actorUser?.rola === 'Kierownik') {
      return rows.filter((row) => String(row.oddzial_id || '') === String(actorUser.oddzial_id || '') || Number(row.id) === Number(actorUser.id));
    }
    return rows;
  }, [actorUser, ops.users]);
  const ownPositionCard = ops.positionCards[String(user?.id || '')] || null;
  const currentPositionCard = ownPositionCard?.updated_at ? ownPositionCard : null;
  const ownEmployeeDocuments = ops.employeeDocuments[String(user?.id || '')] || EMPTY_DOCUMENTS;
  const employeeDocumentSummary = useMemo(
    () => buildEmployeeDocumentSummary(ownEmployeeDocuments, fieldWorker),
    [fieldWorker, ownEmployeeDocuments]
  );
  const documentConfirmed = currentPositionCard ? currentPositionCard.acknowledgement_status === 'confirmed' : Boolean(docAck);
  const selectedCardEmployee =
    assignableUsers.find((row) => String(row.id) === String(selectedCardUserId)) ||
    ops.users.find((row) => String(row.id) === String(selectedCardUserId)) ||
    user;
  const selectedPositionCard = ops.positionCards[String(selectedCardUserId || user?.id || '')] || null;
  const positionResponsibilities = splitCardLines(currentPositionCard?.obowiazki);
  const employeeTerms = useMemo(() => buildEmployeeTerms(user, currentPositionCard), [currentPositionCard, user]);
  const employeeCompleteness = useMemo(
    () => buildEmployeeCompleteness(user, currentPositionCard, fieldWorker, ownEmployeeDocuments),
    [currentPositionCard, fieldWorker, ownEmployeeDocuments, user]
  );

  useEffect(() => {
    if (!user?.id) return;
    const ownUserId = String(user.id);
    selectedCardUserIdRef.current = ownUserId;
    setSelectedCardUserId(ownUserId);
    setAssignmentDraft((prev) => (
      canAssignTasks ? { ...prev, assigned_to: ownUserId } : prev
    ));
  }, [canAssignTasks, user?.id]);

  useEffect(() => {
    selectedCardUserIdRef.current = selectedCardUserId || '';
  }, [selectedCardUserId]);

  useEffect(() => {
    if (!selectedCardEmployee?.id) return;
    const card = ops.positionCards[String(selectedCardEmployee.id)];
    setPositionCardDraft(buildPositionCardDraft(card, selectedCardEmployee));
  }, [ops.positionCards, selectedCardEmployee?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!user?.id) return;
    setEmployeeDocDraft({
      ...EMPTY_EMPLOYEE_DOCUMENT_DRAFT,
      type: fieldWorker ? 'bhp' : 'contract',
    });
    setEmployeeDocMessage('');
    if (employeeDocFileRef.current) employeeDocFileRef.current.value = '';
  }, [fieldWorker, user?.id]);

  const docChecklist = fieldWorker ? BHP_CHECKLIST : OFFICE_CHECKLIST;
  const docTitle = currentPositionCard?.stanowisko || (fieldWorker ? 'BHP arborysty' : 'Karta stanowiska biurowego');
  const docSubtitle = currentPositionCard?.cenny_produkt || (fieldWorker
    ? 'Bezpieczna praca w terenie, sprzęt i potwierdzenie gotowości na dziś'
    : buildOfficeScope(user));

  const handleLogout = () => {
    if (window.confirm(t('profile.logoutConfirm'))) {
      clearAuthSession();
      navigate('/');
    }
  };

  const confirmDocument = async () => {
    if (currentPositionCard) {
      setPositionAckBusy(true);
      setPositionAckMessage('');
      try {
        const response = await api.post(`/position-cards/${currentPositionCard.user_id}/acknowledge`, {
          note: 'Potwierdzono z profilu pracownika',
        });
        setOps((prev) => ({
          ...prev,
          positionCards: {
            ...prev.positionCards,
            [String(currentPositionCard.user_id)]: response.data,
          },
        }));
        setPositionAckMessage('Karta stanowiska podpisana i zapisana w systemie.');
      } catch (err) {
        setPositionAckMessage(err?.response?.data?.error || 'Nie udało się potwierdzić karty stanowiska.');
      } finally {
        setPositionAckBusy(false);
      }
      return;
    }
    const stamp = new Date().toISOString();
    localStorage.setItem(getDocAckKey(user, docType), stamp);
    setDocAck(stamp);
  };

  const goToOrders = (smartFilter = '') => {
    if (smartFilter) {
      localStorage.setItem(SMART_FILTER_KEY, smartFilter);
      localStorage.setItem(SMART_FILTER_INTENT_KEY, String(Date.now()));
    } else {
      localStorage.removeItem(SMART_FILTER_KEY);
      localStorage.removeItem(SMART_FILTER_INTENT_KEY);
    }
    navigate('/zlecenia');
  };

  const updateOperatorTaskInState = (updated) => {
    setOps((prev) => ({
      ...prev,
      operatorTasks: prev.operatorTasks.some((task) => Number(task.id) === Number(updated.id))
        ? prev.operatorTasks.map((task) => (Number(task.id) === Number(updated.id) ? updated : task))
        : [updated, ...prev.operatorTasks],
    }));
  };

  const createOperatorTask = async (event) => {
    event.preventDefault();
    if (!assignmentDraft.title.trim() || !assignmentDraft.assigned_to) {
      setTaskFormMessage('Wpisz zadanie i wybierz pracownika.');
      return;
    }
    setTaskBusyId('create');
    setTaskFormMessage('');
    try {
      const response = await api.post('/operator-tasks', {
        ...assignmentDraft,
        assigned_to: Number(assignmentDraft.assigned_to),
        due_at: assignmentDraft.due_at ? new Date(assignmentDraft.due_at).toISOString() : null,
      });
      updateOperatorTaskInState(response.data);
      setAssignmentDraft({ assigned_to: '', title: '', opis: '', priority: 'normal', due_at: '' });
      setTaskFormMessage('Zadanie wysłane do profilu pracownika.');
    } catch (err) {
      setTaskFormMessage(err?.response?.data?.error || 'Nie udało się wysłać zadania.');
    } finally {
      setTaskBusyId(null);
    }
  };

  const changeOperatorTaskStatus = async (task, status) => {
    if (!task?.id) return;
    setTaskBusyId(task.id);
    try {
      const response = await api.patch(`/operator-tasks/${task.id}`, { status });
      updateOperatorTaskInState(response.data);
    } catch {
      setTaskFormMessage('Nie udało się zmienić statusu zadania.');
    } finally {
      setTaskBusyId(null);
    }
  };

  const savePositionCard = async (event) => {
    event.preventDefault();
    const formUserId = event.currentTarget.elements.position_card_user_id?.value;
    const userId = selectedCardUserIdRef.current || formUserId || selectedCardUserId || positionCardDraft.user_id;
    if (!userId) {
      setPositionCardMessage('Wybierz pracownika.');
      return;
    }
    setPositionCardBusy(true);
    setPositionCardMessage('');
    try {
      const response = await api.put(`/position-cards/${userId}`, { ...positionCardDraft, user_id: Number(userId) });
      setOps((prev) => ({
        ...prev,
        positionCards: {
          ...prev.positionCards,
          [String(userId)]: response.data,
        },
      }));
      setPositionCardMessage('Karta stanowiska zapisana w profilu pracownika.');
    } catch (err) {
      setPositionCardMessage(err?.response?.data?.error || 'Nie udało się zapisać karty stanowiska.');
    } finally {
      setPositionCardBusy(false);
    }
  };

  const upsertEmployeeDocumentInState = (doc) => {
    setOps((prev) => {
      const key = String(doc.user_id);
      const current = prev.employeeDocuments[key] || [];
      const nextRows = current.some((item) => Number(item.id) === Number(doc.id))
        ? current.map((item) => (Number(item.id) === Number(doc.id) ? doc : item))
        : [doc, ...current];
      return {
        ...prev,
        employeeDocuments: {
          ...prev.employeeDocuments,
          [key]: nextRows,
        },
      };
    });
  };

  const createEmployeeDocument = async (event) => {
    event.preventDefault();
    if (!canAssignTasks || !user?.id) return;
    setEmployeeDocBusy(true);
    setEmployeeDocMessage('');
    try {
      const form = new FormData();
      Object.entries(employeeDocDraft).forEach(([key, value]) => {
        form.append(key, value || '');
      });
      const file = employeeDocFileRef.current?.files?.[0];
      if (file) form.append('file', file);
      const response = await api.post(`/employee-documents/${user.id}`, form);
      upsertEmployeeDocumentInState(response.data);
      setEmployeeDocDraft({ ...EMPTY_EMPLOYEE_DOCUMENT_DRAFT, type: fieldWorker ? 'bhp' : 'contract' });
      if (employeeDocFileRef.current) employeeDocFileRef.current.value = '';
      setEmployeeDocMessage('Dokument zapisany w teczce pracownika.');
    } catch (err) {
      setEmployeeDocMessage(err?.response?.data?.error || 'Nie udalo sie zapisac dokumentu.');
    } finally {
      setEmployeeDocBusy(false);
    }
  };

  const mergeUserInState = (nextUser) => {
    if (!nextUser?.id) return;
    setUser((prev) => (prev && Number(prev.id) === Number(nextUser.id) ? { ...prev, ...nextUser } : prev));
    setActorUser((prev) => (prev && Number(prev.id) === Number(nextUser.id) ? { ...prev, ...nextUser } : prev));
    setOps((prev) => ({
      ...prev,
      users: prev.users.map((row) => (Number(row.id) === Number(nextUser.id) ? { ...row, ...nextUser } : row)),
    }));
    if (Number(actorUser?.id) === Number(nextUser.id)) {
      const stored = readStoredUser() || {};
      localStorage.setItem('user', JSON.stringify({ ...stored, ...nextUser }));
    }
  };

  const uploadProfilePhoto = async (event) => {
    const file = event.target.files?.[0];
    if (!file || !user?.id || !canEditProfilePhoto) return;
    if (!String(file.type || '').startsWith('image/')) {
      setProfilePhotoMessage('Wybierz plik obrazu.');
      event.target.value = '';
      return;
    }

    setProfilePhotoBusy(true);
    setProfilePhotoMessage('');
    try {
      const form = new FormData();
      form.append('avatar', file);
      const response = await api.post(`/uzytkownicy/${user.id}/avatar`, form);
      const nextUser = response.data?.user || response.data;
      mergeUserInState(nextUser);
      setProfilePhotoMessage('Zdjecie zapisane.');
    } catch (err) {
      setProfilePhotoMessage(err?.response?.data?.error || 'Nie udalo sie zapisac zdjecia.');
    } finally {
      setProfilePhotoBusy(false);
      event.target.value = '';
    }
  };

  const updateProfileDraft = (field, value) => {
    setProfileEditDraft((prev) => ({ ...prev, [field]: value }));
  };

  const saveProfileData = async (event) => {
    event.preventDefault();
    if (!user?.id || !canEditProfileData) return;
    setProfileEditBusy(true);
    setProfileEditMessage('');
    try {
      const response = await api.put(`/uzytkownicy/${user.id}`, profileEditDraft);
      mergeUserInState(response.data);
      setProfileEditMessage('Dane profilu zapisane.');
    } catch (err) {
      setProfileEditMessage(err?.response?.data?.error || 'Nie udalo sie zapisac danych profilu.');
    } finally {
      setProfileEditBusy(false);
    }
  };

  const archiveEmployeeDocument = async (doc) => {
    if (!doc?.id || !canAssignTasks) return;
    setEmployeeDocBusy(doc.id);
    setEmployeeDocMessage('');
    try {
      const response = await api.patch(`/employee-documents/${doc.id}`, { status: 'archived' });
      upsertEmployeeDocumentInState(response.data);
      setEmployeeDocMessage('Dokument przeniesiony do archiwum.');
    } catch (err) {
      setEmployeeDocMessage(err?.response?.data?.error || 'Nie udalo sie zarchiwizowac dokumentu.');
    } finally {
      setEmployeeDocBusy(false);
    }
  };

  const applyCrewManagerTemplate = () => {
    setPositionCardDraft((prev) => ({
      ...prev,
      ...CREW_MANAGER_TEMPLATE,
      user_id: selectedCardUserIdRef.current || selectedCardUserId || prev.user_id,
    }));
  };

  const themeBtnStyle = (active) => ({
    minHeight: 42,
    padding: '10px 12px',
    borderRadius: 8,
    border: active ? '2px solid var(--accent)' : '1px solid var(--border)',
    background: 'var(--surface-field)',
    cursor: 'pointer',
    fontWeight: active ? 800 : 650,
    color: active ? 'var(--accent)' : 'var(--text-muted)',
    fontFamily: 'inherit',
    fontSize: 13,
  });

  const S = {
    wrap: { display: 'flex', minHeight: '100vh', background: 'var(--bg)' },
    main: { flex: 1, padding: '24px 28px 48px', maxWidth: 1180, minWidth: 0 },
    header: {
      display: 'grid',
      gridTemplateColumns: 'auto minmax(0, 1fr)',
      gap: 16,
      alignItems: 'center',
      padding: 18,
      border: '1px solid var(--border)',
      borderRadius: 8,
      background: 'var(--surface-glass)',
      boxShadow: 'var(--shadow-sm)',
      marginBottom: 14,
    },
    avatar: {
      width: 72,
      height: 72,
      borderRadius: 8,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: 26,
      fontWeight: 900,
      background: `${rolaColor}22`,
      color: rolaColor,
      border: `2px solid ${rolaColor}`,
      flexShrink: 0,
    },
    eyebrow: { color: 'var(--text-muted)', fontSize: 11, fontWeight: 900, textTransform: 'uppercase' },
    title: { margin: '3px 0 6px', fontSize: 26, color: 'var(--text)', fontWeight: 900, lineHeight: 1.15 },
    subtitle: { color: 'var(--text-sub)', fontSize: 14, lineHeight: 1.45, fontWeight: 650 },
    photoActions: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 10 },
    photoBtn: {
      minHeight: 34,
      padding: '7px 11px',
      borderRadius: 8,
      border: '1px solid var(--border)',
      background: 'var(--surface-field)',
      color: 'var(--accent)',
      fontSize: 12,
      fontWeight: 850,
      fontFamily: 'inherit',
      cursor: 'pointer',
    },
    photoMessage: { color: 'var(--text-muted)', fontSize: 12, fontWeight: 750 },
    badgeRow: { gridColumn: '1 / -1', display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-start' },
    profileSwitch: { display: 'grid', gap: 5, maxWidth: 360, marginTop: 10 },
    inlineNotice: {
      gridColumn: '1 / -1',
      border: '1px solid rgba(249,168,37,0.35)',
      borderRadius: 8,
      background: 'rgba(249,168,37,0.08)',
      color: '#F9A825',
      padding: '9px 10px',
      fontSize: 12,
      fontWeight: 850,
    },
    badge: {
      display: 'inline-flex',
      alignItems: 'center',
      minHeight: 28,
      padding: '5px 10px',
      borderRadius: 8,
      border: '1px solid var(--border)',
      background: 'var(--surface-field)',
      color: 'var(--text-sub)',
      fontSize: 12,
      fontWeight: 850,
    },
    roleBadge: { background: `${rolaColor}22`, color: rolaColor, border: `1px solid ${rolaColor}55` },
    okBadge: { color: '#34D399', border: '1px solid rgba(52,211,153,0.35)', background: 'rgba(52,211,153,0.09)' },
    warnBadge: { color: '#F9A825', border: '1px solid rgba(249,168,37,0.35)', background: 'rgba(249,168,37,0.09)' },
    statGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10, marginBottom: 14 },
    stat: {
      border: '1px solid var(--border)',
      borderRadius: 8,
      background: 'var(--surface-glass)',
      padding: '12px 14px',
      minHeight: 84,
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'space-between',
      gap: 5,
    },
    statLabel: { color: 'var(--text-muted)', fontSize: 11, fontWeight: 900, textTransform: 'uppercase' },
    statValue: { color: 'var(--accent)', fontSize: 22, fontWeight: 950, lineHeight: 1.1 },
    statHint: { color: 'var(--text-sub)', fontSize: 12, fontWeight: 700, lineHeight: 1.3 },
    grid: { display: 'grid', gridTemplateColumns: 'minmax(0, 1.45fr) minmax(320px, 0.9fr)', gap: 14, alignItems: 'start' },
    column: { display: 'grid', gap: 14, minWidth: 0 },
    panel: {
      border: '1px solid var(--border)',
      borderRadius: 8,
      background: 'var(--surface-glass)',
      boxShadow: 'var(--shadow-sm)',
      padding: 14,
      minWidth: 0,
    },
    panelHeader: { display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start', marginBottom: 10 },
    panelTitle: { color: 'var(--text)', fontSize: 16, fontWeight: 900, marginTop: 2 },
    rows: { display: 'grid', gap: 8 },
    row: {
      border: '1px solid var(--border)',
      borderRadius: 8,
      background: 'var(--surface-field)',
      padding: '9px 10px',
      display: 'grid',
      gap: 3,
      minWidth: 0,
    },
    todoOverdue: { border: '1px solid rgba(249,168,37,0.35)', background: 'rgba(249,168,37,0.08)' },
    rowTop: { display: 'flex', justifyContent: 'space-between', gap: 10, color: 'var(--text)', fontSize: 13, fontWeight: 850 },
    rowMeta: { color: 'var(--text-muted)', fontSize: 12, fontWeight: 700, lineHeight: 1.35 },
    taskForm: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
      gap: 8,
      border: '1px solid var(--border)',
      borderRadius: 8,
      background: 'var(--surface-field)',
      padding: 10,
      marginBottom: 10,
    },
    input: {
      minHeight: 38,
      border: '1px solid var(--border)',
      borderRadius: 8,
      background: 'var(--surface-glass)',
      color: 'var(--text)',
      padding: '8px 10px',
      fontSize: 13,
      fontWeight: 700,
      outline: 'none',
      minWidth: 0,
      boxSizing: 'border-box',
    },
    textarea: {
      gridColumn: '1 / -1',
      minHeight: 72,
      border: '1px solid var(--border)',
      borderRadius: 8,
      background: 'var(--surface-glass)',
      color: 'var(--text)',
      padding: '9px 10px',
      fontSize: 13,
      lineHeight: 1.4,
      resize: 'vertical',
      outline: 'none',
      boxSizing: 'border-box',
      fontFamily: 'inherit',
    },
    textareaLarge: {
      gridColumn: '1 / -1',
      minHeight: 136,
      border: '1px solid var(--border)',
      borderRadius: 8,
      background: 'var(--surface-glass)',
      color: 'var(--text)',
      padding: '9px 10px',
      fontSize: 13,
      lineHeight: 1.45,
      resize: 'vertical',
      outline: 'none',
      boxSizing: 'border-box',
      fontFamily: 'inherit',
    },
    positionForm: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
      gap: 8,
    },
    fieldGroup: { display: 'grid', gap: 5, minWidth: 0 },
    settlementGrid: {
      gridColumn: '1 / -1',
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(128px, 1fr))',
      gap: 8,
      padding: 10,
      borderRadius: 8,
      border: '1px solid var(--border)',
      background: 'var(--surface-field)',
    },
    settlementPreview: {
      display: 'grid',
      gap: 4,
      border: '1px solid var(--border)',
      borderRadius: 8,
      background: 'var(--surface-field)',
      padding: '9px 10px',
      marginBottom: 10,
    },
    ackPreview: {
      display: 'grid',
      gap: 4,
      border: '1px solid rgba(249,168,37,0.28)',
      borderRadius: 8,
      background: 'rgba(249,168,37,0.08)',
      padding: '9px 10px',
      marginTop: 8,
      marginBottom: 10,
    },
    ackPreviewOk: {
      border: '1px solid rgba(52,211,153,0.3)',
      background: 'rgba(52,211,153,0.09)',
    },
    editorActions: { gridColumn: '1 / -1', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' },
    assignBtn: {
      minHeight: 40,
      border: '1px solid var(--accent)',
      borderRadius: 8,
      background: 'var(--accent-surface)',
      color: 'var(--accent)',
      cursor: 'pointer',
      fontSize: 13,
      fontWeight: 900,
      fontFamily: 'inherit',
    },
    formHint: {
      alignSelf: 'center',
      color: 'var(--text-muted)',
      fontSize: 12,
      fontWeight: 800,
      lineHeight: 1.3,
    },
    todoActions: { display: 'flex', gap: 7, flexWrap: 'wrap', justifyContent: 'flex-end', marginTop: 3 },
    smallBtn: {
      border: '1px solid var(--border)',
      borderRadius: 8,
      background: 'var(--surface-glass)',
      color: 'var(--accent)',
      padding: '6px 9px',
      cursor: 'pointer',
      fontSize: 12,
      fontWeight: 850,
      fontFamily: 'inherit',
    },
    smallBtnPrimary: {
      border: '1px solid rgba(52,211,153,0.35)',
      borderRadius: 8,
      background: 'rgba(52,211,153,0.1)',
      color: '#34D399',
      padding: '6px 9px',
      cursor: 'pointer',
      fontSize: 12,
      fontWeight: 900,
      fontFamily: 'inherit',
    },
    identityGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 8, marginBottom: 10 },
    editGrid: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 },
    editWide: { gridColumn: '1 / -1' },
    identityItem: {
      border: '1px solid var(--border)',
      borderRadius: 8,
      background: 'var(--surface-field)',
      padding: '9px 10px',
      display: 'grid',
      gap: 3,
    },
    identityLabel: { color: 'var(--text-muted)', fontSize: 11, fontWeight: 900, textTransform: 'uppercase' },
    identityValue: { color: 'var(--text)', fontSize: 13, fontWeight: 850, overflowWrap: 'anywhere' },
    permissionGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8 },
    permission: {
      border: '1px solid var(--border)',
      borderRadius: 8,
      background: 'var(--surface-field)',
      padding: '8px 9px',
      display: 'grid',
      gap: 3,
    },
    permissionOn: { border: '1px solid rgba(52,211,153,0.28)' },
    permissionOff: { opacity: 0.62 },
    termsGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(145px, 1fr))', gap: 8, marginBottom: 10 },
    termItem: {
      border: '1px solid var(--border)',
      borderRadius: 8,
      background: 'var(--surface-field)',
      padding: '9px 10px',
      display: 'grid',
      gap: 3,
      minWidth: 0,
    },
    completenessHead: { display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', margin: '8px 0' },
    progressTrack: {
      height: 10,
      borderRadius: 8,
      background: 'var(--surface-field)',
      border: '1px solid var(--border)',
      overflow: 'hidden',
      marginBottom: 10,
    },
    progressFill: {
      height: '100%',
      borderRadius: 8,
      background: 'linear-gradient(90deg, #34D399, var(--accent))',
    },
    completenessList: { display: 'grid', gap: 7 },
    completenessRow: {
      display: 'grid',
      gridTemplateColumns: '24px minmax(0, 1fr)',
      gap: 8,
      alignItems: 'start',
      border: '1px solid var(--border)',
      borderRadius: 8,
      background: 'var(--surface-field)',
      padding: '8px 9px',
    },
    completenessMark: {
      width: 18,
      height: 18,
      borderRadius: 8,
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: 12,
      fontWeight: 950,
      marginTop: 1,
    },
    markOk: { color: '#34D399', background: 'rgba(52,211,153,0.12)', border: '1px solid rgba(52,211,153,0.3)' },
    markWarn: { color: '#F9A825', background: 'rgba(249,168,37,0.1)', border: '1px solid rgba(249,168,37,0.28)' },
    quickActions: { display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 },
    docLead: { color: 'var(--text-sub)', fontSize: 13, lineHeight: 1.45, fontWeight: 650, margin: '0 0 10px' },
    checklist: { display: 'grid', gap: 7, marginBottom: 10 },
    checkItem: {
      display: 'grid',
      gridTemplateColumns: '18px 1fr',
      gap: 8,
      alignItems: 'start',
      color: 'var(--text-sub)',
      fontSize: 12,
      fontWeight: 700,
      lineHeight: 1.35,
    },
    dot: {
      width: 9,
      height: 9,
      borderRadius: 8,
      marginTop: 4,
      background: '#34D399',
      boxShadow: '0 0 0 3px rgba(52,211,153,0.12)',
    },
    confirmBtn: {
      width: '100%',
      minHeight: 42,
      border: '1px solid var(--border)',
      borderRadius: 8,
      background: documentConfirmed ? 'rgba(52,211,153,0.12)' : 'var(--accent-surface)',
      color: documentConfirmed ? '#34D399' : 'var(--accent)',
      cursor: 'pointer',
      fontSize: 13,
      fontWeight: 900,
      fontFamily: 'inherit',
    },
    documentSummaryGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(145px, 1fr))',
      gap: 8,
      marginBottom: 10,
    },
    documentSummaryItem: {
      border: '1px solid rgba(52,211,153,0.28)',
      borderRadius: 8,
      background: 'rgba(52,211,153,0.08)',
      padding: '9px 10px',
      display: 'grid',
      gap: 3,
    },
    documentSummaryWarn: {
      border: '1px solid rgba(249,168,37,0.35)',
      background: 'rgba(249,168,37,0.08)',
    },
    documentForm: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(155px, 1fr))',
      gap: 8,
      border: '1px solid var(--border)',
      borderRadius: 8,
      background: 'var(--surface-field)',
      padding: 10,
      marginBottom: 10,
    },
    fileInput: {
      minHeight: 38,
      border: '1px solid var(--border)',
      borderRadius: 8,
      background: 'var(--surface-glass)',
      color: 'var(--text-muted)',
      padding: '7px 10px',
      fontSize: 12,
      fontWeight: 700,
      boxSizing: 'border-box',
      maxWidth: '100%',
    },
    documentRow: {
      border: '1px solid var(--border)',
      borderRadius: 8,
      background: 'var(--surface-field)',
      padding: '9px 10px',
      display: 'grid',
      gap: 5,
      minWidth: 0,
    },
    documentOk: { border: '1px solid rgba(52,211,153,0.25)' },
    documentWarn: { border: '1px solid rgba(249,168,37,0.35)', background: 'rgba(249,168,37,0.08)' },
    documentDanger: { border: '1px solid rgba(239,68,68,0.35)', background: 'rgba(239,68,68,0.08)' },
    documentActions: { display: 'flex', gap: 7, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' },
    linkBtn: {
      display: 'inline-flex',
      alignItems: 'center',
      minHeight: 30,
      border: '1px solid var(--border)',
      borderRadius: 8,
      background: 'var(--surface-glass)',
      color: 'var(--accent)',
      padding: '5px 9px',
      textDecoration: 'none',
      fontSize: 12,
      fontWeight: 850,
      fontFamily: 'inherit',
    },
    shortcuts: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 },
    shortcutBtn: {
      border: '1px solid var(--border)',
      borderRadius: 8,
      background: 'var(--surface-field)',
      color: 'var(--accent)',
      minHeight: 42,
      padding: '8px 10px',
      cursor: 'pointer',
      fontSize: 12,
      fontWeight: 850,
      textAlign: 'left',
      fontFamily: 'inherit',
    },
    themeRow: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(95px, 1fr))', gap: 8 },
    langWrap: { marginTop: 10 },
    logout: {
      width: '100%',
      padding: 14,
      marginTop: 10,
      borderRadius: 8,
      border: '1px solid color-mix(in srgb, var(--danger) 35%, transparent)',
      background: 'color-mix(in srgb, var(--danger) 10%, transparent)',
      color: 'var(--danger)',
      fontWeight: 800,
      fontSize: 14,
      cursor: 'pointer',
      fontFamily: 'inherit',
    },
    empty: {
      border: '1px dashed var(--border)',
      borderRadius: 8,
      padding: '12px 10px',
      color: 'var(--text-muted)',
      fontSize: 12,
      fontWeight: 750,
      lineHeight: 1.4,
    },
  };

  return (
    <div className="profile-shell app-shell command-os-shell" style={S.wrap}>
      <CommandSidebar active="profile" user={actorUser || user} />
      <main className="profile-main app-main" style={S.main}>
        <header className="profile-header" style={S.header}>
          <div className={profilePhotoUrl ? 'profile-avatar profile-avatar-has-photo' : 'profile-avatar'} style={S.avatar}>
            {profilePhotoUrl ? <img src={profilePhotoUrl} alt={`Zdjecie profilowe ${operatorName}`} /> : initials}
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={S.eyebrow}>Centrum operatora</div>
            <h1 style={S.title}>{operatorName}</h1>
            <div style={S.subtitle}>
              {user?.stanowisko || getRoleDisplayName(user?.rola, 'Stanowisko')} · {user?.oddzial_nazwa || `Oddział #${user?.oddzial_id || 'brak'}`}
            </div>
            <div style={S.photoActions}>
              <input
                ref={profilePhotoFileRef}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={uploadProfilePhoto}
              />
              {canEditProfilePhoto ? (
                <button
                  type="button"
                  style={S.photoBtn}
                  onClick={() => profilePhotoFileRef.current?.click()}
                  disabled={profilePhotoBusy}
                >
                  {profilePhotoBusy ? 'Wgrywam...' : profilePhotoUrl ? 'Zmien zdjecie' : 'Dodaj zdjecie'}
                </button>
              ) : null}
              {profilePhotoMessage ? <span style={S.photoMessage}>{profilePhotoMessage}</span> : null}
            </div>
            {canAssignTasks ? (
              <label style={S.profileSwitch}>
                <span style={S.identityLabel}>Oglądany profil</span>
                <select
                  style={S.input}
                  value={user?.id || ''}
                  onChange={(event) => navigate(event.target.value ? `/profil/${event.target.value}` : '/profil')}
                  aria-label="Oglądany profil"
                >
                  {assignableUsers.map((row) => (
                    <option key={row.id} value={row.id}>
                      {[row.imie, row.nazwisko].filter(Boolean).join(' ') || row.login} ({getRoleDisplayName(row.rola)})
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>
          <div style={S.badgeRow}>
            {user?.rola ? <span style={{ ...S.badge, ...S.roleBadge }}>{getRoleDisplayName(user.rola)}</span> : null}
            <span style={{ ...S.badge, ...(ops.apiOk ? S.okBadge : ops.apiOk === false ? S.warnBadge : {}) }}>
              API {ops.apiOk ? 'online' : ops.apiOk === false ? 'offline' : 'sprawdzam'}
            </span>
            <span style={{ ...S.badge, ...(documentConfirmed ? S.okBadge : S.warnBadge) }}>
              {documentConfirmed ? 'Dokument potwierdzony' : 'Dokument do potwierdzenia'}
            </span>
          </div>
          {profileAccessMessage ? <div style={S.inlineNotice}>{profileAccessMessage}</div> : null}
        </header>

        <section className="profile-stat-grid" style={S.statGrid}>
          <div className="profile-stat" style={S.stat}>
            <span style={S.statLabel}>Aktywne zadania</span>
            <strong style={S.statValue}>{dashboard.activeTasks.length}</strong>
            <span style={S.statHint}>{dashboard.todayTasks.length} w kolejce na dziś lub zaległe</span>
          </div>
          <div className="profile-stat" style={S.stat}>
            <span style={S.statLabel}>Zadania Todo</span>
            <strong style={S.statValue}>{dashboard.openOperatorTasks.length}</strong>
            <span style={S.statHint}>{dashboard.overdueOperatorTasks.length} po terminie</span>
          </div>
          <div className="profile-stat" style={S.stat}>
            <span style={S.statLabel}>Karty stanowiskowe</span>
            <strong style={S.statValue}>{dashboard.pendingPositionCards.length}</strong>
            <span style={S.statHint}>{dashboard.savedPositionCards.length} zapisane, {dashboard.pendingPositionCards.length} czeka na podpis</span>
          </div>
          <div className="profile-stat" style={S.stat}>
            <span style={S.statLabel}>Dokumenty akt</span>
            <strong style={S.statValue}>{employeeDocumentSummary.needsAttention}</strong>
            <span style={S.statHint}>{ownEmployeeDocuments.length} w teczce, {dashboard.employeeDocumentAlerts.length} alertow widocznych</span>
          </div>
          <div className="profile-stat" style={S.stat}>
            <span style={S.statLabel}>Follow-up po terminie</span>
            <strong style={S.statValue}>{dashboard.dueContacts.length}</strong>
            <span style={S.statHint}>kontakty wymagające reakcji</span>
          </div>
          <div className="profile-stat" style={S.stat}>
            <span style={S.statLabel}>Moje decyzje</span>
            <strong style={S.statValue}>{dashboard.decisionsCount}</strong>
            <span style={S.statHint}>{dashboard.repairCount} zleceń z blokadą lub poprawką</span>
          </div>
          <div className="profile-stat" style={S.stat}>
            <span style={S.statLabel}>Sesja</span>
            <strong style={S.statValue}>{getStoredToken() ? 'OK' : 'Brak'}</strong>
            <span style={S.statHint}>{ops.loading ? 'synchronizacja danych' : `stan na ${formatDateTime(new Date())}`}</span>
          </div>
        </section>

        <div className="profile-grid" style={S.grid}>
          <div className="profile-column" style={S.column}>
            <section className="profile-panel profile-edit-panel" style={S.panel}>
              <div style={S.panelHeader}>
                <div>
                  <div style={S.eyebrow}>Profil 360</div>
                  <div style={S.panelTitle}>Dane kontaktowe i kadrowe</div>
                </div>
                <span style={{ ...S.badge, ...(canEditProfileData ? S.okBadge : S.warnBadge) }}>
                  {canEditProfileData ? 'Edycja wlaczona' : 'Tylko podglad'}
                </span>
              </div>
              <form style={S.editGrid} onSubmit={saveProfileData}>
                <label style={S.fieldGroup}>
                  <span style={S.identityLabel}>Imie</span>
                  <input
                    style={S.input}
                    value={profileEditDraft.imie}
                    onChange={(event) => updateProfileDraft('imie', event.target.value)}
                    disabled={!canEditProfileData || profileEditBusy}
                  />
                </label>
                <label style={S.fieldGroup}>
                  <span style={S.identityLabel}>Nazwisko</span>
                  <input
                    style={S.input}
                    value={profileEditDraft.nazwisko}
                    onChange={(event) => updateProfileDraft('nazwisko', event.target.value)}
                    disabled={!canEditProfileData || profileEditBusy}
                  />
                </label>
                <label style={S.fieldGroup}>
                  <span style={S.identityLabel}>Telefon</span>
                  <input
                    style={S.input}
                    value={profileEditDraft.telefon}
                    onChange={(event) => updateProfileDraft('telefon', event.target.value)}
                    disabled={!canEditProfileData || profileEditBusy}
                    placeholder="+48 ..."
                  />
                </label>
                <label style={S.fieldGroup}>
                  <span style={S.identityLabel}>E-mail</span>
                  <input
                    style={S.input}
                    type="email"
                    value={profileEditDraft.email}
                    onChange={(event) => updateProfileDraft('email', event.target.value)}
                    disabled={!canEditProfileData || profileEditBusy}
                    placeholder="email@firma.pl"
                  />
                </label>
                <label style={S.fieldGroup}>
                  <span style={S.identityLabel}>Stanowisko</span>
                  <input
                    style={S.input}
                    value={profileEditDraft.stanowisko}
                    onChange={(event) => updateProfileDraft('stanowisko', event.target.value)}
                    disabled={!canEditProfileData || profileEditBusy}
                    placeholder="np. Kierownik brygad"
                  />
                </label>
                <label style={S.fieldGroup}>
                  <span style={S.identityLabel}>Data zatrudnienia</span>
                  <input
                    style={S.input}
                    type="date"
                    value={profileEditDraft.data_zatrudnienia}
                    onChange={(event) => updateProfileDraft('data_zatrudnienia', event.target.value)}
                    disabled={!canEditProfileData || profileEditBusy}
                  />
                </label>
                <label style={S.fieldGroup}>
                  <span style={S.identityLabel}>Kontakt awaryjny</span>
                  <input
                    style={S.input}
                    value={profileEditDraft.kontakt_awaryjny_imie}
                    onChange={(event) => updateProfileDraft('kontakt_awaryjny_imie', event.target.value)}
                    disabled={!canEditProfileData || profileEditBusy}
                    placeholder="Imie i nazwisko"
                  />
                </label>
                <label style={S.fieldGroup}>
                  <span style={S.identityLabel}>Telefon awaryjny</span>
                  <input
                    style={S.input}
                    value={profileEditDraft.kontakt_awaryjny_telefon}
                    onChange={(event) => updateProfileDraft('kontakt_awaryjny_telefon', event.target.value)}
                    disabled={!canEditProfileData || profileEditBusy}
                    placeholder="+48 ..."
                  />
                </label>
                <label style={{ ...S.fieldGroup, ...S.editWide }}>
                  <span style={S.identityLabel}>Adres</span>
                  <input
                    style={S.input}
                    value={profileEditDraft.adres_zamieszkania}
                    onChange={(event) => updateProfileDraft('adres_zamieszkania', event.target.value)}
                    disabled={!canEditProfileData || profileEditBusy}
                    placeholder="Adres zamieszkania"
                  />
                </label>
                <label style={{ ...S.fieldGroup, ...S.editWide }}>
                  <span style={S.identityLabel}>Notatki kadrowe</span>
                  <textarea
                    style={S.textarea}
                    value={profileEditDraft.notatki}
                    onChange={(event) => updateProfileDraft('notatki', event.target.value)}
                    disabled={!canEditProfileData || profileEditBusy}
                    placeholder="Ustalenia, preferencje, uwagi kadrowe..."
                  />
                </label>
                <div style={{ ...S.editorActions, ...S.editWide }}>
                  <button type="submit" style={S.assignBtn} disabled={!canEditProfileData || profileEditBusy}>
                    {profileEditBusy ? 'Zapisuje...' : 'Zapisz dane profilu'}
                  </button>
                  {profileEditMessage ? <div style={S.formHint}>{profileEditMessage}</div> : null}
                </div>
              </form>
            </section>

            <section className="profile-panel" style={S.panel}>
              <div style={S.panelHeader}>
                <div>
                  <div style={S.eyebrow}>Kim jestem i co mogę</div>
                  <div style={S.panelTitle}>Uprawnienia i dane stanowiska</div>
                </div>
              </div>
              <div style={S.identityGrid}>
                <div style={S.identityItem}>
                  <span style={S.identityLabel}>Login</span>
                  <strong style={S.identityValue}>{user?.login || 'brak'}</strong>
                </div>
                <div style={S.identityItem}>
                  <span style={S.identityLabel}>Telefon</span>
                  <strong style={S.identityValue}>{user?.telefon || 'brak numeru'}</strong>
                </div>
                <div style={S.identityItem}>
                  <span style={S.identityLabel}>E-mail</span>
                  <strong style={S.identityValue}>{user?.email || 'brak adresu'}</strong>
                </div>
                <div style={S.identityItem}>
                  <span style={S.identityLabel}>Ekipa</span>
                  <strong style={S.identityValue}>{user?.ekipa_id ? `Ekipa #${user.ekipa_id}` : 'brak przypisania'}</strong>
                </div>
              </div>
              <div style={S.permissionGrid}>
                {permissions.map((permission) => (
                  <div
                    key={permission.label}
                    style={{
                      ...S.permission,
                      ...(permission.enabled ? S.permissionOn : S.permissionOff),
                    }}
                  >
                    <span style={S.identityLabel}>{permission.enabled ? 'Aktywne' : 'Brak dostępu'}</span>
                    <strong style={S.identityValue}>{permission.label}</strong>
                    <span style={S.rowMeta}>{permission.detail}</span>
                  </div>
                ))}
              </div>
            </section>

            <section className="profile-panel" style={S.panel}>
              <div style={S.panelHeader}>
                <div>
                  <div style={S.eyebrow}>Pracownik 360</div>
                  <div style={S.panelTitle}>Warunki i kompletność akt</div>
                </div>
                <span style={{ ...S.badge, ...(employeeCompleteness.score >= 80 ? S.okBadge : S.warnBadge) }}>
                  {employeeCompleteness.score}%
                </span>
              </div>
              <div style={S.termsGrid}>
                {employeeTerms.map((term) => (
                  <div key={term.label} style={S.termItem}>
                    <span style={S.identityLabel}>{term.label}</span>
                    <strong style={S.identityValue}>{term.value}</strong>
                  </div>
                ))}
              </div>
              <div style={S.completenessHead}>
                <span style={S.identityLabel}>Kompletność dokumentów</span>
                <strong style={S.identityValue}>{employeeCompleteness.doneCount}/{employeeCompleteness.total}</strong>
              </div>
              <div style={S.progressTrack} aria-label="Kompletność akt pracownika">
                <div style={{ ...S.progressFill, width: `${employeeCompleteness.score}%` }} />
              </div>
              <div style={S.completenessList}>
                {employeeCompleteness.items.map((item) => (
                  <div key={item.label} style={S.completenessRow}>
                    <span style={{ ...S.completenessMark, ...(item.done ? S.markOk : S.markWarn) }}>
                      {item.done ? '✓' : '!'}
                    </span>
                    <span>
                      <strong style={S.identityValue}>{item.label}</strong>
                      <span style={S.rowMeta}>{item.detail}</span>
                    </span>
                  </div>
                ))}
              </div>
              <div style={S.quickActions}>
                <button type="button" style={S.smallBtn} onClick={() => navigate(`/uzytkownicy/${user?.id}`)}>
                  Dane pracownika
                </button>
                <button type="button" style={S.smallBtn} onClick={() => navigate(`/kadry-dokumenty/druk/${user?.id}`)}>
                  PDF karty
                </button>
                <button type="button" style={S.smallBtn} onClick={() => document.getElementById('employee-documents-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
                  Dokumenty
                </button>
                <button type="button" style={S.smallBtnPrimary} onClick={() => navigate('/zadania')}>
                  Zadania
                </button>
              </div>
            </section>

            <section id="employee-documents-panel" style={S.panel}>
              <div style={S.panelHeader}>
                <div>
                  <div style={S.eyebrow}>Teczka pracownika</div>
                  <div style={S.panelTitle}>Dokumenty, skany i terminy</div>
                </div>
                <span style={{ ...S.badge, ...(employeeDocumentSummary.needsAttention ? S.warnBadge : S.okBadge) }}>
                  {employeeDocumentSummary.needsAttention ? `${employeeDocumentSummary.needsAttention} alertow` : 'Komplet'}
                </span>
              </div>
              <div style={S.documentSummaryGrid}>
                {employeeDocumentSummary.required.map((item) => {
                  const meta = item.doc ? getDocumentExpiryMeta(item.doc) : { label: 'Brak', tone: 'warn' };
                  return (
                    <div key={item.type} style={{ ...S.documentSummaryItem, ...(meta.tone === 'warn' || meta.tone === 'danger' ? S.documentSummaryWarn : {}) }}>
                      <span style={S.identityLabel}>{item.label}</span>
                      <strong style={S.identityValue}>{item.doc ? meta.label : 'Brak dokumentu'}</strong>
                      <span style={S.rowMeta}>{item.doc ? formatDateOnly(item.doc.expires_at) : 'do dodania'}</span>
                    </div>
                  );
                })}
              </div>

              {canAssignTasks ? (
                <form style={S.documentForm} onSubmit={createEmployeeDocument}>
                  <label style={S.fieldGroup}>
                    <span style={S.identityLabel}>Typ</span>
                    <select
                      style={S.input}
                      value={employeeDocDraft.type}
                      onChange={(event) => setEmployeeDocDraft((prev) => ({ ...prev, type: event.target.value }))}
                      aria-label="Typ dokumentu"
                    >
                      {Object.entries(EMPLOYEE_DOCUMENT_TYPE_LABELS).map(([key, label]) => (
                        <option key={key} value={key}>{label}</option>
                      ))}
                    </select>
                  </label>
                  <label style={S.fieldGroup}>
                    <span style={S.identityLabel}>Nazwa</span>
                    <input
                      style={S.input}
                      value={employeeDocDraft.title}
                      onChange={(event) => setEmployeeDocDraft((prev) => ({ ...prev, title: event.target.value }))}
                      placeholder="np. Badania okresowe"
                    />
                  </label>
                  <label style={S.fieldGroup}>
                    <span style={S.identityLabel}>Wydano</span>
                    <input
                      style={S.input}
                      type="date"
                      value={employeeDocDraft.issued_at}
                      onChange={(event) => setEmployeeDocDraft((prev) => ({ ...prev, issued_at: event.target.value }))}
                    />
                  </label>
                  <label style={S.fieldGroup}>
                    <span style={S.identityLabel}>Wazne do</span>
                    <input
                      style={S.input}
                      type="date"
                      value={employeeDocDraft.expires_at}
                      onChange={(event) => setEmployeeDocDraft((prev) => ({ ...prev, expires_at: event.target.value }))}
                    />
                  </label>
                  <label style={S.fieldGroup}>
                    <span style={S.identityLabel}>Status</span>
                    <select
                      style={S.input}
                      value={employeeDocDraft.status}
                      onChange={(event) => setEmployeeDocDraft((prev) => ({ ...prev, status: event.target.value }))}
                      aria-label="Status dokumentu"
                    >
                      {Object.entries(EMPLOYEE_DOCUMENT_STATUS_LABELS).map(([key, label]) => (
                        <option key={key} value={key}>{label}</option>
                      ))}
                    </select>
                  </label>
                  <label style={S.fieldGroup}>
                    <span style={S.identityLabel}>Plik / skan</span>
                    <input ref={employeeDocFileRef} style={S.fileInput} type="file" />
                  </label>
                  <label style={{ ...S.fieldGroup, gridColumn: '1 / -1' }}>
                    <span style={S.identityLabel}>Notatka</span>
                    <textarea
                      style={S.textarea}
                      value={employeeDocDraft.notes}
                      onChange={(event) => setEmployeeDocDraft((prev) => ({ ...prev, notes: event.target.value }))}
                      placeholder="Kto dostarczyl dokument, co trzeba dopilnowac, warunki odnowienia..."
                    />
                  </label>
                  <div style={S.editorActions}>
                    <button type="submit" style={S.assignBtn} disabled={employeeDocBusy === true}>
                      {employeeDocBusy === true ? 'Zapisuje...' : 'Dodaj dokument'}
                    </button>
                    {employeeDocMessage ? <div style={S.formHint}>{employeeDocMessage}</div> : null}
                  </div>
                </form>
              ) : null}

              <div className="profile-rows" style={S.rows}>
                {ownEmployeeDocuments.length === 0 ? (
                  <div style={S.empty}>Brak dokumentow w teczce tego pracownika.</div>
                ) : ownEmployeeDocuments.map((doc) => {
                  const meta = getDocumentExpiryMeta(doc);
                  const rowStyle = {
                    ...S.documentRow,
                    ...(meta.tone === 'danger' ? S.documentDanger : meta.tone === 'warn' ? S.documentWarn : meta.tone === 'ok' ? S.documentOk : {}),
                  };
                  return (
                    <div key={doc.id} style={rowStyle}>
                      <div style={S.rowTop}>
                        <strong>{doc.title || EMPLOYEE_DOCUMENT_TYPE_LABELS[doc.type] || 'Dokument'}</strong>
                        <span>{meta.label}</span>
                      </div>
                      <div style={S.rowMeta}>
                        {EMPLOYEE_DOCUMENT_TYPE_LABELS[doc.type] || doc.type} - status {EMPLOYEE_DOCUMENT_STATUS_LABELS[doc.status] || doc.status}
                        {doc.expires_at ? ` - wazne do ${formatDateOnly(doc.expires_at)}` : ' - bez terminu'}
                      </div>
                      {doc.notes ? <div style={S.rowMeta}>{doc.notes}</div> : null}
                      <div style={S.documentActions}>
                        {doc.file_url ? (
                          <a style={S.linkBtn} href={doc.file_url} target="_blank" rel="noreferrer">
                            Otworz plik
                          </a>
                        ) : (
                          <span style={S.rowMeta}>metadane bez pliku</span>
                        )}
                        {canAssignTasks && doc.status !== 'archived' ? (
                          <button type="button" style={S.smallBtn} disabled={employeeDocBusy === doc.id} onClick={() => archiveEmployeeDocument(doc)}>
                            {employeeDocBusy === doc.id ? 'Archiwizuje...' : 'Archiwizuj'}
                          </button>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="profile-panel" style={S.panel}>
              <div style={S.panelHeader}>
                <div>
                  <div style={S.eyebrow}>Moje zadania na dziś</div>
                  <div style={S.panelTitle}>Priorytet operatora</div>
                </div>
                <button type="button" style={S.shortcutBtn} onClick={() => goToOrders()}>
                  Otwórz zlecenia
                </button>
              </div>
              <div className="profile-rows" style={S.rows}>
                {dashboard.todayTasks.length === 0 ? (
                  <div style={S.empty}>Brak zadań zaległych lub zaplanowanych na dziś.</div>
                ) : dashboard.todayTasks.map((task) => (
                  <div key={task.id} style={S.row}>
                    <div style={S.rowTop}>
                      <strong>#{task.id} {task.klient_nazwa || 'Bez klienta'}</strong>
                      <span>{formatDate(getTaskDay(task))}</span>
                    </div>
                    <div style={S.rowMeta}>
                      {task.status || 'brak statusu'} · {task.typ_uslugi || 'usługa'} · {formatMoney(task.wartosc_planowana)}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="profile-panel" style={S.panel}>
              <div style={S.panelHeader}>
                <div>
                  <div style={S.eyebrow}>Zadania Todo</div>
                  <div style={S.panelTitle}>Polecenia od kierownika i prezesa</div>
                </div>
                <span style={{ ...S.badge, ...(dashboard.overdueOperatorTasks.length ? S.warnBadge : S.okBadge) }}>
                  {dashboard.openOperatorTasks.length} aktywne
                </span>
              </div>
              {canAssignTasks ? (
                <form className="profile-task-form" style={S.taskForm} onSubmit={createOperatorTask}>
                  <select
                    style={S.input}
                    value={assignmentDraft.assigned_to}
                    onChange={(event) => setAssignmentDraft((prev) => ({ ...prev, assigned_to: event.target.value }))}
                    aria-label="Pracownik"
                  >
                    <option value="">Wybierz pracownika</option>
                    {assignableUsers.map((row) => (
                      <option key={row.id} value={row.id}>
                        {[row.imie, row.nazwisko].filter(Boolean).join(' ') || row.login} ({getRoleDisplayName(row.rola)})
                      </option>
                    ))}
                  </select>
                  <input
                    style={S.input}
                    value={assignmentDraft.title}
                    onChange={(event) => setAssignmentDraft((prev) => ({ ...prev, title: event.target.value }))}
                    placeholder="Co trzeba zrobić?"
                  />
                  <input
                    style={S.input}
                    type="datetime-local"
                    value={assignmentDraft.due_at}
                    onChange={(event) => setAssignmentDraft((prev) => ({ ...prev, due_at: event.target.value }))}
                  />
                  <select
                    style={S.input}
                    value={assignmentDraft.priority}
                    onChange={(event) => setAssignmentDraft((prev) => ({ ...prev, priority: event.target.value }))}
                    aria-label="Priorytet"
                  >
                    {Object.entries(OPERATOR_TASK_PRIORITY_LABELS).map(([key, label]) => (
                      <option key={key} value={key}>{label}</option>
                    ))}
                  </select>
                  <textarea
                    style={S.textarea}
                    value={assignmentDraft.opis}
                    onChange={(event) => setAssignmentDraft((prev) => ({ ...prev, opis: event.target.value }))}
                    placeholder="Szczegóły, link do zlecenia, ustalenia..."
                  />
                  <button type="submit" style={S.assignBtn} disabled={taskBusyId === 'create'}>
                    {taskBusyId === 'create' ? 'Wysyłam...' : 'Wyślij do profilu'}
                  </button>
                  {taskFormMessage ? <div style={S.formHint}>{taskFormMessage}</div> : null}
                </form>
              ) : null}

              <div className="profile-rows" style={S.rows}>
                {dashboard.operatorTaskQueue.length === 0 ? (
                  <div style={S.empty}>Brak aktywnych zadań Todo.</div>
                ) : dashboard.operatorTaskQueue.map((task) => {
                  const due = getOperatorTaskDueMeta(task);
                  return (
                    <div key={task.id} style={{ ...S.row, ...(due.overdue ? S.todoOverdue : {}) }}>
                      <div style={S.rowTop}>
                        <strong>{task.title}</strong>
                        <span>{OPERATOR_TASK_PRIORITY_LABELS[task.priority] || 'Normalny'}</span>
                      </div>
                      <div style={S.rowMeta}>
                        {OPERATOR_TASK_STATUS_LABELS[task.status] || task.status} · dla {task.assignee_name || `#${task.assigned_to}`} · od {task.created_by_name || `#${task.created_by}`} · {due.label}
                      </div>
                      {task.opis ? <div style={S.rowMeta}>{task.opis}</div> : null}
                      <div style={S.todoActions}>
                        {task.status !== 'in_progress' ? (
                          <button type="button" style={S.smallBtn} disabled={taskBusyId === task.id} onClick={() => changeOperatorTaskStatus(task, 'in_progress')}>
                            W toku
                          </button>
                        ) : null}
                        <button type="button" style={S.smallBtnPrimary} disabled={taskBusyId === task.id} onClick={() => changeOperatorTaskStatus(task, 'done')}>
                          Gotowe
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="profile-panel" style={S.panel}>
              <div style={S.panelHeader}>
                <div>
                  <div style={S.eyebrow}>Moje decyzje</div>
                  <div style={S.panelTitle}>Zamykanie, blokady i poprawki</div>
                </div>
                <button type="button" style={S.shortcutBtn} onClick={() => goToOrders()}>
                  Audyt
                </button>
              </div>
              <div className="profile-rows" style={S.rows}>
                {dashboard.visibleEvents.length === 0 ? (
                  <div style={S.empty}>Brak decyzji operatora w rejestrze.</div>
                ) : dashboard.visibleEvents.map((event, index) => (
                  <div key={`${event.id || event.task_id}-${index}`} style={S.row}>
                    <div style={S.rowTop}>
                      <strong>{actionLabel(event.action)}</strong>
                      <span>{formatDateTime(event.created_at)}</span>
                    </div>
                    <div style={S.rowMeta}>
                      Zlecenie #{event.task_id} · {event.actor || 'Operator'} · ryzyko {event.risk_score} · {formatMoney(event.value)}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>

          <aside className="profile-column" style={S.column}>
            {canAssignTasks ? (
              <section className="profile-panel" style={S.panel}>
                <div style={S.panelHeader}>
                  <div>
                    <div style={S.eyebrow}>Karta stanowiska</div>
                    <div style={S.panelTitle}>Obowiązki i rozliczenie</div>
                  </div>
                  <button type="button" style={S.smallBtn} onClick={applyCrewManagerTemplate}>
                    Szablon kierownik brygad
                  </button>
                </div>
                <form className="profile-position-form" style={S.positionForm} onSubmit={savePositionCard}>
                  <label style={S.fieldGroup}>
                    <span style={S.identityLabel}>Pracownik</span>
                    <select
                      style={S.input}
                      value={selectedCardUserId}
                      name="position_card_user_id"
                      onChange={(event) => {
                        const nextUserId = event.target.value;
                        selectedCardUserIdRef.current = nextUserId;
                        setSelectedCardUserId(nextUserId);
                        setPositionCardDraft((prev) => ({ ...prev, user_id: nextUserId }));
                        setPositionCardMessage('');
                      }}
                      aria-label="Pracownik karty"
                    >
                      <option value="">Wybierz osobę</option>
                      {assignableUsers.map((row) => (
                        <option key={row.id} value={row.id}>
                          {[row.imie, row.nazwisko].filter(Boolean).join(' ') || row.login} ({getRoleDisplayName(row.rola)})
                        </option>
                      ))}
                    </select>
                  </label>
                  <label style={S.fieldGroup}>
                    <span style={S.identityLabel}>Stanowisko</span>
                    <input
                      style={S.input}
                      value={positionCardDraft.stanowisko}
                      onChange={(event) => setPositionCardDraft((prev) => ({ ...prev, stanowisko: event.target.value }))}
                      placeholder="np. Kierownik brygad"
                    />
                  </label>
                  <label style={{ ...S.fieldGroup, gridColumn: '1 / -1' }}>
                    <span style={S.identityLabel}>Cenny produkt</span>
                    <input
                      style={S.input}
                      value={positionCardDraft.cenny_produkt}
                      onChange={(event) => setPositionCardDraft((prev) => ({ ...prev, cenny_produkt: event.target.value }))}
                      placeholder="Jaki wynik ma dawać to stanowisko?"
                    />
                  </label>
                  <label style={{ ...S.fieldGroup, gridColumn: '1 / -1' }}>
                    <span style={S.identityLabel}>Obowiązki</span>
                    <textarea
                      style={S.textareaLarge}
                      value={positionCardDraft.obowiazki}
                      onChange={(event) => setPositionCardDraft((prev) => ({ ...prev, obowiazki: event.target.value }))}
                      placeholder="Każdy obowiązek w osobnej linii..."
                    />
                  </label>
                  <label style={{ ...S.fieldGroup, gridColumn: '1 / -1' }}>
                    <span style={S.identityLabel}>Kryteria oceny</span>
                    <textarea
                      style={S.textarea}
                      value={positionCardDraft.kryteria}
                      onChange={(event) => setPositionCardDraft((prev) => ({ ...prev, kryteria: event.target.value }))}
                      placeholder="Po czym poznajemy, że praca jest wykonana dobrze?"
                    />
                  </label>
                  <div style={S.settlementGrid}>
                    <label style={S.fieldGroup}>
                      <span style={S.identityLabel}>Typ rozliczenia</span>
                      <select
                        style={S.input}
                        value={positionCardDraft.settlement_type}
                        onChange={(event) => setPositionCardDraft((prev) => ({ ...prev, settlement_type: event.target.value }))}
                        aria-label="Typ rozliczenia"
                      >
                        {Object.entries(SETTLEMENT_TYPE_LABELS).map(([key, label]) => (
                          <option key={key} value={key}>{label}</option>
                        ))}
                      </select>
                    </label>
                    <label style={S.fieldGroup}>
                      <span style={S.identityLabel}>Fix PLN</span>
                      <input
                        style={S.input}
                        inputMode="decimal"
                        value={positionCardDraft.fixed_amount_pln}
                        onChange={(event) => setPositionCardDraft((prev) => ({ ...prev, fixed_amount_pln: event.target.value }))}
                        placeholder="0"
                      />
                    </label>
                    <label style={S.fieldGroup}>
                      <span style={S.identityLabel}>Dzień PLN</span>
                      <input
                        style={S.input}
                        inputMode="decimal"
                        value={positionCardDraft.daily_rate_pln}
                        onChange={(event) => setPositionCardDraft((prev) => ({ ...prev, daily_rate_pln: event.target.value }))}
                        placeholder="0"
                      />
                    </label>
                    <label style={S.fieldGroup}>
                      <span style={S.identityLabel}>Godzina PLN</span>
                      <input
                        style={S.input}
                        inputMode="decimal"
                        value={positionCardDraft.hourly_rate_pln}
                        onChange={(event) => setPositionCardDraft((prev) => ({ ...prev, hourly_rate_pln: event.target.value }))}
                        placeholder="0"
                      />
                    </label>
                    <label style={S.fieldGroup}>
                      <span style={S.identityLabel}>% przychodu</span>
                      <input
                        style={S.input}
                        inputMode="decimal"
                        value={positionCardDraft.revenue_percent}
                        onChange={(event) => setPositionCardDraft((prev) => ({ ...prev, revenue_percent: event.target.value }))}
                        placeholder="0"
                      />
                    </label>
                    <label style={S.fieldGroup}>
                      <span style={S.identityLabel}>% marży</span>
                      <input
                        style={S.input}
                        inputMode="decimal"
                        value={positionCardDraft.margin_percent}
                        onChange={(event) => setPositionCardDraft((prev) => ({ ...prev, margin_percent: event.target.value }))}
                        placeholder="0"
                      />
                    </label>
                  </div>
                  <label style={{ ...S.fieldGroup, gridColumn: '1 / -1' }}>
                    <span style={S.identityLabel}>Bonusy i dodatki</span>
                    <textarea
                      style={S.textarea}
                      value={positionCardDraft.bonus_rules}
                      onChange={(event) => setPositionCardDraft((prev) => ({ ...prev, bonus_rules: event.target.value }))}
                      placeholder="Premie, amortyzacja, samochód, reklama, indywidualne ustalenia..."
                    />
                  </label>
                  <label style={{ ...S.fieldGroup, gridColumn: '1 / -1' }}>
                    <span style={S.identityLabel}>Uwagi do rozliczenia</span>
                    <textarea
                      style={S.textarea}
                      value={positionCardDraft.settlement_notes}
                      onChange={(event) => setPositionCardDraft((prev) => ({ ...prev, settlement_notes: event.target.value }))}
                      placeholder="Warunki podpisania, okres próbny, wyjątki..."
                    />
                  </label>
                  <div style={S.editorActions}>
                    <button type="submit" style={S.assignBtn} disabled={positionCardBusy}>
                      {positionCardBusy ? 'Zapisuję...' : 'Zapisz kartę'}
                    </button>
                    {positionCardMessage ? <div style={S.formHint}>{positionCardMessage}</div> : null}
                  </div>
                </form>
                {selectedPositionCard?.updated_at ? (
                  <div style={{ ...S.ackPreview, ...(selectedPositionCard.acknowledgement_status === 'confirmed' ? S.ackPreviewOk : {}), marginBottom: 0 }}>
                    <span style={S.identityLabel}>Potwierdzenie pracownika</span>
                    <strong style={S.identityValue}>{cardAckLabel(selectedPositionCard)}</strong>
                    <span style={S.rowMeta}>
                      Ostatnia aktualizacja: {formatDateTime(selectedPositionCard.updated_at)}
                      {selectedPositionCard.updated_by_name ? ` przez ${selectedPositionCard.updated_by_name}` : ''}
                    </span>
                  </div>
                ) : null}
              </section>
            ) : null}

            <section className="profile-panel" style={S.panel}>
              <div style={S.panelHeader}>
                <div>
                  <div style={S.eyebrow}>{fieldWorker ? 'Bezpieczeństwo pracy' : 'Dokument stanowiskowy'}</div>
                  <div style={S.panelTitle}>{docTitle}</div>
                </div>
                <span style={{ ...S.badge, ...(documentConfirmed ? S.okBadge : S.warnBadge) }}>
                  {documentConfirmed ? 'Potwierdzone' : 'Do potwierdzenia'}
                </span>
              </div>
              <p style={S.docLead}>{docSubtitle}</p>
              {currentPositionCard ? (
                <>
                  <div style={S.settlementPreview}>
                    <span style={S.identityLabel}>Warunki rozliczenia</span>
                    <strong style={S.identityValue}>{formatSettlement(currentPositionCard)}</strong>
                    {currentPositionCard.settlement_notes ? <span style={S.rowMeta}>{currentPositionCard.settlement_notes}</span> : null}
                  </div>
                  <div style={{ ...S.ackPreview, ...(documentConfirmed ? S.ackPreviewOk : {}) }}>
                    <span style={S.identityLabel}>Status podpisu</span>
                    <strong style={S.identityValue}>{cardAckLabel(currentPositionCard)}</strong>
                    <span style={S.rowMeta}>Wersja karty: {formatDateTime(currentPositionCard.updated_at)}</span>
                  </div>
                </>
              ) : null}
              <div style={S.checklist}>
                {(positionResponsibilities.length ? positionResponsibilities : docChecklist).map((item) => (
                  <div key={item} style={S.checkItem}>
                    <span style={S.dot} />
                    <span>{item}</span>
                  </div>
                ))}
              </div>
              <button type="button" style={S.confirmBtn} onClick={confirmDocument} disabled={positionAckBusy || !canConfirmDocument || (currentPositionCard && documentConfirmed)}>
                {positionAckBusy
                  ? 'Potwierdzam...'
                  : !canConfirmDocument
                    ? 'Podpisuje pracownik w swoim profilu'
                    : currentPositionCard
                    ? documentConfirmed
                      ? `Podpisano ${formatDateTime(currentPositionCard.acknowledged_at)}`
                      : 'Podpisuję kartę stanowiska'
                    : docAck
                      ? `Potwierdzone ${formatDateTime(docAck)}`
                      : fieldWorker ? 'Potwierdzam BHP na dziś' : 'Potwierdzam kartę stanowiska'}
              </button>
              {positionAckMessage ? <div style={{ ...S.formHint, marginTop: 8 }}>{positionAckMessage}</div> : null}
            </section>

            <section className="profile-panel" style={S.panel}>
              <div style={S.panelHeader}>
                <div>
                  <div style={S.eyebrow}>Preferencje</div>
                  <div style={S.panelTitle}>Motyw i język</div>
                </div>
              </div>
              <div style={S.themeRow}>
                {Object.values(THEMES).map((th) => (
                  <button
                    key={th.id}
                    type="button"
                    style={themeBtnStyle(th.id === themeId)}
                    onClick={() => setTheme(th.id)}
                  >
                    {th.label}
                  </button>
                ))}
              </div>
              <div style={S.langWrap}>
                <LanguageSwitcher />
              </div>
            </section>

            <section className="profile-panel" style={S.panel}>
              <div style={S.panelHeader}>
                <div>
                  <div style={S.eyebrow}>Skróty</div>
                  <div style={S.panelTitle}>Najbliższy ruch</div>
                </div>
              </div>
              <div style={S.shortcuts}>
                <button type="button" style={S.shortcutBtn} onClick={() => navigate('/raporty/misja-dnia')}>
                  Plan dnia
                </button>
                <button type="button" style={S.shortcutBtn} onClick={() => goToOrders('contactOverdue')}>
                  Zaległe kontakty
                </button>
                <button type="button" style={S.shortcutBtn} onClick={() => goToOrders('noContact')}>
                  Do naprawy
                </button>
                <button type="button" style={S.shortcutBtn} onClick={() => navigate('/powiadomienia')}>
                  Powiadomienia
                </button>
              </div>
              <button type="button" style={S.logout} onClick={handleLogout}>
                {t('profile.logout')}
              </button>
            </section>
          </aside>
        </div>
      </main>
    </div>
  );
}
