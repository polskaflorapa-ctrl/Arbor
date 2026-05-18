import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';
import { getLocalStorageJson } from '../utils/safeJsonLocalStorage';
import { getStoredToken, authHeaders } from '../utils/storedToken';
import Sidebar from '../components/Sidebar';

const TEAM_ROW_H = 154;
const TEAM_COL_W = 184;
const TEAM_LABEL_W = 224;
const DAY_START_HOUR = 8;
const DAY_END_HOUR = 18;
const DAY_HOUR_HEIGHT = 78;
const DAY_TIME_LABEL_W = 76;
const DAY_TEAM_COL_W = 248;
const MIN_VISIBLE_GAP_MINUTES = 45;
const TASK_STATUS_COLOR = {
  Do_Zatwierdzenia: '#f59e0b',
  Zaplanowane: '#22c55e',
  W_Realizacji: '#0ea5e9',
  Zakonczone: '#64748b',
  Anulowane: '#94a3b8',
};
const ACTIVE_TASK_STATUSES = new Set(['Do_Zatwierdzenia', 'Zaplanowane', 'W_Realizacji']);

// ─── stałe ────────────────────────────────────────────────────────────────────
const ROW_H = 48;           // px — wysokość wiersza zasobu
const COL_W = 46;           // px — szerokość kolumny dnia
const HEADER_H = 56;        // px — nagłówek z datami
const LABEL_W = 200;        // px — lewa kolumna z nazwą sprzętu
const DNI_PL  = ['Nd', 'Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'Sb'];
const MIESIACE = ['Sty', 'Lut', 'Mar', 'Kwi', 'Maj', 'Cze',
                  'Lip', 'Sie', 'Wrz', 'Paź', 'Lis', 'Gru'];

const STATUS_COLOR = {
  Zarezerwowane: '#3b82f6',
  Wydane:        '#f59e0b',
  Zwrócone:      '#10b981',
  Anulowane:     '#6b7280',
};

// ─── helpers ──────────────────────────────────────────────────────────────────
const toISO = (d) => d.toISOString().split('T')[0];

function addDays(d, n) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function diffDays(a, b) {
  // dni między datami (a, b to stringi YYYY-MM-DD lub Date)
  return Math.round((new Date(b) - new Date(a)) / 86_400_000);
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function hourLabel(hour) {
  return `${String(hour).padStart(2, '0')}:00`;
}

function timeToMinutes(value) {
  const match = String(value || '').match(/^(\d{1,2}):(\d{2})/);
  if (!match) return DAY_START_HOUR * 60;
  return clamp(Number(match[1]), 0, 23) * 60 + clamp(Number(match[2]), 0, 59);
}

function minutesToTime(minutes) {
  const safe = clamp(Math.round(minutes), 0, 23 * 60 + 59);
  const hh = Math.floor(safe / 60);
  const mm = safe % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function durationLabel(minutes) {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

function roundUpToStep(minutes, step = 30) {
  return Math.ceil(minutes / step) * step;
}

function taskDate(task) {
  return String(task?.data_planowana || '').slice(0, 10);
}

function taskTime(task) {
  const planned = String(task?.data_planowana || '');
  if (task?.godzina_rozpoczecia) return String(task.godzina_rozpoczecia).slice(0, 5);
  if (planned.includes('T')) return planned.split('T')[1]?.slice(0, 5) || '08:00';
  return '08:00';
}

function taskHours(task) {
  const value = Number(task?.czas_planowany_godziny || task?.czas_realizacji_godz || 2);
  return Number.isFinite(value) && value > 0 ? value : 2;
}

function formDurationMinutes(form, task) {
  const value = Number(form?.czas_planowany_godziny);
  const hours = Number.isFinite(value) && value > 0 ? value : taskHours(task);
  return Math.max(30, Math.round(hours * 60));
}

function taskRangeMinutes(task) {
  const start = timeToMinutes(taskTime(task));
  const duration = Math.max(30, Math.round(taskHours(task) * 60));
  return { start, end: start + duration, duration };
}

function taskBranchId(task) {
  return task?.oddzial_id == null || task.oddzial_id === '' ? '' : String(task.oddzial_id);
}

function teamBranchId(team) {
  return team?.dostepny_w_oddziale_id || team?.oddzial_id || team?.oddzial_macierzysty_id || '';
}

function taskClientLabel(task) {
  return task?.klient_nazwa || task?.adres || `Zlecenie #${task?.id}`;
}

function buildSlotSuggestions(tasks, task, form) {
  const teamId = String(form?.ekipa_id || '');
  const day = String(form?.data_planowana || '');
  if (!teamId || !day) return [];
  const duration = formDurationMinutes(form, task);
  const workStart = DAY_START_HOUR * 60;
  const workEnd = DAY_END_HOUR * 60;
  const ranges = (tasks || [])
    .filter((row) => String(row?.id) !== String(task?.id))
    .filter((row) => String(row?.ekipa_id || '') === teamId)
    .filter((row) => taskDate(row) === day)
    .filter((row) => ACTIVE_TASK_STATUSES.has(row.status))
    .map((row) => taskRangeMinutes(row))
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const suggestions = [];
  let cursor = workStart;
  const addFromGap = (start, end) => {
    let value = roundUpToStep(start, 30);
    while (value + duration <= end && suggestions.length < 6) {
      suggestions.push({
        time: minutesToTime(value),
        end: minutesToTime(value + duration),
        minutes: duration,
      });
      value += 30;
    }
  };

  for (const range of ranges) {
    const start = clamp(range.start, workStart, workEnd);
    const end = clamp(range.end, workStart, workEnd);
    if (start - cursor >= duration) addFromGap(cursor, start);
    cursor = Math.max(cursor, end);
    if (suggestions.length >= 6) break;
  }
  if (workEnd - cursor >= duration) addFromGap(cursor, workEnd);
  return suggestions;
}

function formPlanRange(form, task) {
  const start = timeToMinutes(form?.godzina_rozpoczecia || taskTime(task));
  const duration = formDurationMinutes(form, task);
  return { start, end: start + duration, duration };
}

function buildPlanWarnings(tasks, task, form) {
  const teamId = String(form?.ekipa_id || '');
  const day = String(form?.data_planowana || '');
  if (!teamId || !day) return { conflicts: [], outsideWorkday: false };
  const range = formPlanRange(form, task);
  const workStart = DAY_START_HOUR * 60;
  const workEnd = DAY_END_HOUR * 60;
  const outsideWorkday = range.start < workStart || range.end > workEnd;
  const conflicts = (tasks || [])
    .filter((row) => String(row?.id) !== String(task?.id))
    .filter((row) => String(row?.ekipa_id || '') === teamId)
    .filter((row) => taskDate(row) === day)
    .filter((row) => ACTIVE_TASK_STATUSES.has(row.status))
    .filter((row) => {
      const busy = taskRangeMinutes(row);
      return range.start < busy.end && range.end > busy.start;
    })
    .slice(0, 3);
  return { conflicts, outsideWorkday };
}

function canSeeAllBranches(user) {
  return ['Prezes', 'Dyrektor', 'Administrator'].includes(user?.rola);
}

function buildRange(anchor, days) {
  // zwraca tablicę Date — `days` dni zaczynając od poniedziałku tygodnia anchor
  const d = new Date(anchor);
  const dow = d.getDay();
  const pon = new Date(d);
  pon.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1));
  return Array.from({ length: days }, (_, i) => addDays(pon, i));
}

// ─── modal nowej rezerwacji ───────────────────────────────────────────────────
function NowaRezerwacjaModal({ sprzet, ekipy, defaultSprzet, defaultDate, onSave, onClose, saving, error }) {
  const [form, setForm] = useState({
    sprzet_id:  String(defaultSprzet || ''),
    ekipa_id:   '',
    data_od:    defaultDate || toISO(new Date()),
    data_do:    defaultDate || toISO(new Date()),
    status:     'Zarezerwowane',
  });

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  return (
    <div style={mStyles.overlay} onClick={onClose}>
      <div style={mStyles.panel} onClick={e => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 16px', fontSize: 16 }}>Nowa rezerwacja sprzętu</h3>

        <label style={mStyles.label}>Sprzęt</label>
        <select style={mStyles.select} value={form.sprzet_id} onChange={e => set('sprzet_id', e.target.value)}>
          <option value="">— wybierz —</option>
          {sprzet.map(s => <option key={s.id} value={s.id}>{s.nazwa}{s.typ ? ` (${s.typ})` : ''}</option>)}
        </select>

        <label style={mStyles.label}>Ekipa</label>
        <select style={mStyles.select} value={form.ekipa_id} onChange={e => set('ekipa_id', e.target.value)}>
          <option value="">— wybierz —</option>
          {ekipy.map(e => <option key={e.id} value={e.id}>{e.nazwa}</option>)}
        </select>

        <div style={{ display: 'flex', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <label style={mStyles.label}>Od</label>
            <input type="date" style={mStyles.input} value={form.data_od} onChange={e => set('data_od', e.target.value)} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={mStyles.label}>Do</label>
            <input type="date" style={mStyles.input} value={form.data_do} onChange={e => set('data_do', e.target.value)} />
          </div>
        </div>

        <label style={mStyles.label}>Status</label>
        <select style={mStyles.select} value={form.status} onChange={e => set('status', e.target.value)}>
          {['Zarezerwowane', 'Wydane', 'Zwrócone', 'Anulowane'].map(s => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>

        {error && <div style={{ color: 'var(--error)', fontSize: 13, margin: '8px 0 0' }}>{error}</div>}

        <div style={{ display: 'flex', gap: 10, marginTop: 18, justifyContent: 'flex-end' }}>
          <button style={mStyles.btnCancel} onClick={onClose}>Anuluj</button>
          <button style={mStyles.btnSave} disabled={saving}
            onClick={() => onSave(form)}>
            {saving ? 'Zapisuję…' : 'Zapisz'}
          </button>
        </div>
      </div>
    </div>
  );
}

const mStyles = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  panel:   { background: 'var(--bg-card)', borderRadius: 12, padding: 24, minWidth: 360, maxWidth: 460, width: '90vw', boxShadow: '0 8px 32px rgba(0,0,0,0.3)' },
  label:   { display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4, marginTop: 12 },
  select:  { width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-card2)', color: 'var(--text)', fontSize: 14 },
  input:   { width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-card2)', color: 'var(--text)', fontSize: 14, boxSizing: 'border-box' },
  textarea: { width: '100%', minHeight: 84, resize: 'vertical', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-card2)', color: 'var(--text)', fontSize: 14, boxSizing: 'border-box' },
  modalHead: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 12 },
  subtle: { marginTop: 4, color: 'var(--text-muted)', fontSize: 12, lineHeight: 1.35 },
  statusPill: { padding: '4px 8px', borderRadius: 999, background: 'rgba(34,197,94,0.14)', color: 'var(--accent)', fontSize: 11, fontWeight: 800, whiteSpace: 'nowrap' },
  formGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 },
  slotPanel: { marginTop: 12, padding: 10, border: '1px solid var(--border)', borderRadius: 8, background: 'rgba(34,197,94,0.06)' },
  slotHead: { display: 'flex', justifyContent: 'space-between', gap: 10, color: 'var(--text)', fontSize: 12, marginBottom: 8, flexWrap: 'wrap' },
  slotList: { display: 'flex', flexWrap: 'wrap', gap: 8 },
  slotBtn: { border: '1px solid rgba(34,197,94,0.35)', background: 'rgba(34,197,94,0.12)', color: 'var(--text)', borderRadius: 8, padding: '6px 9px', cursor: 'pointer', display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2, fontSize: 12, fontWeight: 800 },
  slotEmpty: { color: 'var(--text-muted)', fontSize: 12, fontWeight: 700 },
  planWarning: { marginTop: 10, padding: '8px 10px', borderRadius: 8, background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.35)', color: '#92400e', fontSize: 12, fontWeight: 700, lineHeight: 1.45 },
  warningList: { margin: '6px 0 0', paddingLeft: 18 },
  errorBox: { marginTop: 10, padding: '8px 10px', borderRadius: 8, background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.32)', color: '#ef4444', fontSize: 12, fontWeight: 700 },
  actionsRow: { display: 'flex', gap: 10, marginTop: 18, justifyContent: 'flex-end', flexWrap: 'wrap' },
  btnCancel: { padding: '8px 18px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text)', cursor: 'pointer', fontSize: 14 },
  btnGhost: { padding: '8px 18px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-card2)', color: 'var(--text)', cursor: 'pointer', fontSize: 14, fontWeight: 600 },
  btnSave:   { padding: '8px 18px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: 'var(--on-accent)', cursor: 'pointer', fontSize: 14, fontWeight: 600 },
};

// ─── podgląd/edycja istniejącej rezerwacji ────────────────────────────────────
function RezerwacjaDetailModal({ rez, ekipy, onStatusChange, onClose, saving }) {
  const [status, setStatus] = useState(rez.status);
  return (
    <div style={mStyles.overlay} onClick={onClose}>
      <div style={mStyles.panel} onClick={e => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 16px', fontSize: 16 }}>Rezerwacja #{rez.id}</h3>
        <div style={{ fontSize: 14, lineHeight: 1.8 }}>
          <div><b>Sprzęt:</b> {rez.sprzet_nazwa}</div>
          <div><b>Ekipa:</b> {rez.ekipa_nazwa}</div>
          <div><b>Od:</b> {rez.data_od?.slice(0,10)}</div>
          <div><b>Do:</b> {rez.data_do?.slice(0,10)}</div>
        </div>
        <label style={mStyles.label}>Status</label>
        <select style={mStyles.select} value={status} onChange={e => setStatus(e.target.value)}>
          {['Zarezerwowane', 'Wydane', 'Zwrócone', 'Anulowane'].map(s => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <div style={{ display: 'flex', gap: 10, marginTop: 18, justifyContent: 'flex-end' }}>
          <button style={mStyles.btnCancel} onClick={onClose}>Zamknij</button>
          <button style={mStyles.btnSave} disabled={saving || status === rez.status}
            onClick={() => onStatusChange(rez.id, status)}>
            {saving ? 'Zapisuję…' : 'Zapisz status'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── główny komponent ────────────────────────────────────────────────────────
function TaskPlanModal({ task, teams, tasks, onSave, onClose, onOpenTask, saving, error }) {
  const [form, setForm] = useState({
    data_planowana: taskDate(task) || toISO(new Date()),
    godzina_rozpoczecia: taskTime(task),
    czas_planowany_godziny: String(taskHours(task)),
    ekipa_id: task.ekipa_id ? String(task.ekipa_id) : '',
    sprzet_notatka: '',
  });

  const set = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));
  const { ekipa_id, data_planowana, godzina_rozpoczecia, czas_planowany_godziny } = form;
  const slotSuggestions = useMemo(
    () => buildSlotSuggestions(tasks, task, { ekipa_id, data_planowana, czas_planowany_godziny }),
    [tasks, task, ekipa_id, data_planowana, czas_planowany_godziny],
  );
  const planWarnings = useMemo(
    () => buildPlanWarnings(tasks, task, { ekipa_id, data_planowana, godzina_rozpoczecia, czas_planowany_godziny }),
    [tasks, task, ekipa_id, data_planowana, godzina_rozpoczecia, czas_planowany_godziny],
  );

  return (
    <div style={mStyles.overlay} onClick={onClose}>
      <div style={{ ...mStyles.panel, maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
        <div style={mStyles.modalHead}>
          <div>
            <h3 style={{ margin: 0, fontSize: 16 }}>Plan zlecenia #{task.id}</h3>
            <div style={mStyles.subtle}>{taskClientLabel(task)} · {task.miasto || task.adres || 'brak adresu'}</div>
          </div>
          <span style={mStyles.statusPill}>{task.status || 'Nowe'}</span>
        </div>

        <div style={mStyles.formGrid}>
          <div>
            <label style={mStyles.label}>Data</label>
            <input type="date" style={mStyles.input} value={form.data_planowana} onChange={(e) => set('data_planowana', e.target.value)} />
          </div>
          <div>
            <label style={mStyles.label}>Godzina</label>
            <input type="time" style={mStyles.input} value={form.godzina_rozpoczecia} onChange={(e) => set('godzina_rozpoczecia', e.target.value)} />
          </div>
          <div>
            <label style={mStyles.label}>Czas pracy (h)</label>
            <input type="number" min="0.25" step="0.25" style={mStyles.input} value={form.czas_planowany_godziny} onChange={(e) => set('czas_planowany_godziny', e.target.value)} />
          </div>
          <div>
            <label style={mStyles.label}>Ekipa</label>
            <select style={mStyles.select} value={form.ekipa_id} onChange={(e) => set('ekipa_id', e.target.value)}>
              <option value="">- wybierz ekipe -</option>
              {teams.map((team) => (
                <option key={team.id} value={team.id}>{team.nazwa || `Ekipa #${team.id}`}</option>
              ))}
            </select>
          </div>
        </div>

        <div style={mStyles.slotPanel}>
          <div style={mStyles.slotHead}>
            <strong>Najblizsze wolne sloty</strong>
            <span>
              {form.ekipa_id && form.data_planowana
                ? `${form.data_planowana} - ${form.czas_planowany_godziny || taskHours(task)} h`
                : 'wybierz ekipe i date'}
            </span>
          </div>
          {slotSuggestions.length ? (
            <div style={mStyles.slotList}>
              {slotSuggestions.map((slot) => (
                <button
                  key={`${slot.time}-${slot.end}`}
                  type="button"
                  style={mStyles.slotBtn}
                  onClick={() => set('godzina_rozpoczecia', slot.time)}
                >
                  <strong>{slot.time}</strong>
                  <span>do {slot.end}</span>
                </button>
              ))}
            </div>
          ) : (
            <div style={mStyles.slotEmpty}>Brak wolnego slotu dla wybranej dlugosci w godzinach 08:00-18:00.</div>
          )}
        </div>

        {(planWarnings.outsideWorkday || planWarnings.conflicts.length > 0) && (
          <div style={mStyles.planWarning}>
            {planWarnings.outsideWorkday && <div>Wybrany czas wychodzi poza standardowe godziny pracy 08:00-18:00.</div>}
            {planWarnings.conflicts.length > 0 && (
              <>
                <div>Konflikt z innym zleceniem tej ekipy:</div>
                <ul style={mStyles.warningList}>
                  {planWarnings.conflicts.map((row) => {
                    const busy = taskRangeMinutes(row);
                    return (
                      <li key={row.id}>
                        #{row.id} {minutesToTime(busy.start)}-{minutesToTime(busy.end)} {taskClientLabel(row)}
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </div>
        )}

        <label style={mStyles.label}>Uwagi dla brygady / sprzet</label>
        <textarea
          style={mStyles.textarea}
          value={form.sprzet_notatka}
          placeholder="np. zabrac rebak, zwyzka od 10:00, wjazd od bramy bocznej"
          onChange={(e) => set('sprzet_notatka', e.target.value)}
        />

        {error && <div style={mStyles.errorBox}>{error}</div>}

        <div style={mStyles.actionsRow}>
          <button style={mStyles.btnCancel} onClick={onClose}>Zamknij</button>
          <button style={mStyles.btnGhost} onClick={onOpenTask}>Pelne zlecenie</button>
          <button style={mStyles.btnSave} disabled={saving} onClick={() => onSave(task, form)}>
            {saving ? 'Zapisuje...' : 'Zapisz plan'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function KalendarzZasobow() {
  const navigate = useNavigate();
  const [currentUser, setCurrentUser] = useState(null);
  const [sprzet, setSprzet]   = useState([]);   // lista equipment_items
  const [ekipy, setEkipy]     = useState([]);
  const [tasks, setTasks]     = useState([]);
  const [oddzialy, setOddzialy] = useState([]);
  const [rezerwacje, setRezerwacje] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('teams');
  const [teamViewMode, setTeamViewMode] = useState('day');
  const [selectedBranchId, setSelectedBranchId] = useState('');
  const [rangeLen, setRangeLen] = useState(14);  // 14 lub 28 dni
  const [anchor, setAnchor]   = useState(new Date());
  const [msg, setMsg]         = useState('');
  const [msgType, setMsgType] = useState('ok');
  const [modalNew, setModalNew]  = useState(null);   // { sprzetId, date }
  const [modalDet, setModalDet]  = useState(null);   // rez object
  const [modalTaskPlan, setModalTaskPlan] = useState(null);
  const [saving, setSaving]  = useState(false);
  const [modalErr, setModalErr]  = useState('');
  const [taskPlanErr, setTaskPlanErr] = useState('');

  // drag & drop state (ref — nie triggeruje re-renderu)
  const drag = useRef(null);
  const taskDrag = useRef(null);
  // highlight drop target
  const [dropTarget, setDropTarget] = useState(null); // { sprzetId, date }
  const [teamDropTarget, setTeamDropTarget] = useState(null);

  const canEdit = useMemo(() => {
    if (!currentUser) return false;
    return ['Prezes', 'Dyrektor', 'Administrator', 'Kierownik'].includes(currentUser.rola);
  }, [currentUser]);

  const userCanSeeAllBranches = useMemo(() => canSeeAllBranches(currentUser), [currentUser]);

  // ─── zakres dat ──────────────────────────────────────────────────────────
  const days = useMemo(() => buildRange(anchor, rangeLen), [anchor, rangeLen]);
  const from = useMemo(() => toISO(days[0]), [days]);
  const to   = useMemo(() => toISO(days[days.length - 1]), [days]);
  const dayISO = useMemo(() => toISO(anchor), [anchor]);
  const daySlots = useMemo(
    () => Array.from({ length: DAY_END_HOUR - DAY_START_HOUR }, (_, i) => DAY_START_HOUR + i),
    []
  );
  const dayHourMarks = useMemo(
    () => Array.from({ length: DAY_END_HOUR - DAY_START_HOUR + 1 }, (_, i) => DAY_START_HOUR + i),
    []
  );
  const dayTimelineHeight = (DAY_END_HOUR - DAY_START_HOUR) * DAY_HOUR_HEIGHT;

  const periodLabel = useMemo(() => {
    const a = days[0];
    const b = days[days.length - 1];
    if (a.getMonth() === b.getMonth()) {
      return `${a.getDate()}–${b.getDate()} ${MIESIACE[a.getMonth()]} ${a.getFullYear()}`;
    }
    return `${a.getDate()} ${MIESIACE[a.getMonth()]} — ${b.getDate()} ${MIESIACE[b.getMonth()]} ${b.getFullYear()}`;
  }, [days]);

  const dayLabel = useMemo(() => {
    const d = new Date(anchor);
    return `${DNI_PL[d.getDay()]} ${d.getDate()} ${MIESIACE[d.getMonth()]} ${d.getFullYear()}`;
  }, [anchor]);

  const todayISO = toISO(new Date());

  // ─── ładowanie danych ─────────────────────────────────────────────────────
  const loadAll = useCallback(async () => {
    const token = getStoredToken();
    if (!token) { navigate('/'); return; }
    const h = authHeaders(token);
    const user = getLocalStorageJson('user');
    const tasksEndpoint = canSeeAllBranches(user) ? '/tasks/wszystkie' : '/tasks';
    setLoading(true);
    try {
      const [sRes, eRes, oRes, tRes] = await Promise.all([
        api.get('/flota/sprzet', { headers: h }),
        api.get('/ekipy', { headers: h }),
        api.get('/oddzialy', { headers: h }).catch(() => ({ data: [] })),
        api.get(tasksEndpoint, { headers: h }).catch(() => ({ data: [] })),
      ]);
      setSprzet(Array.isArray(sRes.data) ? sRes.data : sRes.data?.items || []);
      setEkipy(Array.isArray(eRes.data) ? eRes.data : eRes.data?.ekipy || []);
      setOddzialy(Array.isArray(oRes.data) ? oRes.data : []);
      setTasks(Array.isArray(tRes.data) ? tRes.data : []);
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  }, [navigate]);

  const loadRezerwacje = useCallback(async () => {
    const token = getStoredToken();
    if (!token) return;
    const h = authHeaders(token);
    try {
      const res = await api.get(`/flota/rezerwacje?from=${from}&to=${to}`, { headers: h });
      setRezerwacje(Array.isArray(res.data) ? res.data : []);
    } catch {
      setRezerwacje([]);
    }
  }, [from, to]);

  useEffect(() => {
    const u = getLocalStorageJson('user');
    if (u) setCurrentUser(u);
    loadAll();
  }, [loadAll]);

  useEffect(() => {
    loadRezerwacje();
  }, [loadRezerwacje]);

  useEffect(() => {
    if (!currentUser) return;
    if (!userCanSeeAllBranches && currentUser.oddzial_id) {
      setSelectedBranchId(String(currentUser.oddzial_id));
    }
  }, [currentUser, userCanSeeAllBranches]);

  // ─── mapa: sprzetId → lista rezerwacji w zakresie ─────────────────────────
  const rezBySprzet = useMemo(() => {
    const map = {};
    for (const r of rezerwacje) {
      if (!map[r.sprzet_id]) map[r.sprzet_id] = [];
      map[r.sprzet_id].push(r);
    }
    return map;
  }, [rezerwacje]);

  const branchOptions = useMemo(() => {
    const byId = new Map();
    for (const oddzial of oddzialy) {
      if (oddzial?.id == null) continue;
      byId.set(String(oddzial.id), oddzial.nazwa || `Oddzial #${oddzial.id}`);
    }
    for (const team of ekipy) {
      const id = teamBranchId(team);
      if (id) byId.set(String(id), team.dostepny_w_oddziale_nazwa || team.oddzial_nazwa || byId.get(String(id)) || `Oddzial #${id}`);
    }
    for (const task of tasks) {
      const id = taskBranchId(task);
      if (id && !byId.has(String(id))) byId.set(String(id), task.oddzial_nazwa || `Oddzial #${id}`);
    }
    return Array.from(byId.entries()).map(([id, nazwa]) => ({ id, nazwa }));
  }, [ekipy, oddzialy, tasks]);

  const visibleTeams = useMemo(() => {
    return ekipy.filter((team) => !selectedBranchId || String(teamBranchId(team)) === String(selectedBranchId));
  }, [ekipy, selectedBranchId]);

  const plannerTeams = useMemo(() => {
    if (!modalTaskPlan) return visibleTeams.length ? visibleTeams : ekipy;
    const taskBranch = taskBranchId(modalTaskPlan);
    const currentTeamId = modalTaskPlan.ekipa_id ? String(modalTaskPlan.ekipa_id) : '';
    const scoped = ekipy.filter((team) => (
      !taskBranch ||
      String(teamBranchId(team)) === String(taskBranch) ||
      String(team.id) === currentTeamId
    ));
    return scoped.length ? scoped : ekipy;
  }, [ekipy, modalTaskPlan, visibleTeams]);

  const scheduledTasks = useMemo(() => {
    const firstISO = toISO(days[0]);
    const lastISO = toISO(days[days.length - 1]);
    return tasks
      .filter((task) => task?.typ !== 'wycena')
      .filter((task) => ACTIVE_TASK_STATUSES.has(task.status))
      .filter((task) => !selectedBranchId || String(taskBranchId(task)) === String(selectedBranchId))
      .filter((task) => task.ekipa_id && taskDate(task) >= firstISO && taskDate(task) <= lastISO)
      .sort((a, b) => `${taskDate(a)} ${taskTime(a)}`.localeCompare(`${taskDate(b)} ${taskTime(b)}`));
  }, [days, selectedBranchId, tasks]);

  const planningQueue = useMemo(() => {
    return tasks
      .filter((task) => task?.typ !== 'wycena')
      .filter((task) => task.status === 'Do_Zatwierdzenia' || !task.ekipa_id || !task.data_planowana)
      .filter((task) => !selectedBranchId || String(taskBranchId(task)) === String(selectedBranchId))
      .slice()
      .sort((a, b) => String(b.updated_at || b.created_at || '').localeCompare(String(a.updated_at || a.created_at || '')))
      .slice(0, 12);
  }, [selectedBranchId, tasks]);

  const tasksByTeamDay = useMemo(() => {
    const map = new Map();
    for (const task of scheduledTasks) {
      const key = `${task.ekipa_id}|${taskDate(task)}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(task);
    }
    return map;
  }, [scheduledTasks]);

  const dayTasksByTeam = useMemo(() => {
    const map = new Map();
    for (const task of scheduledTasks) {
      if (taskDate(task) !== dayISO) continue;
      const key = String(task.ekipa_id);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(task);
    }
    for (const list of map.values()) {
      list.sort((a, b) => taskTime(a).localeCompare(taskTime(b)));
    }
    return map;
  }, [dayISO, scheduledTasks]);

  const dayAnalysisByTeam = useMemo(() => {
    const map = new Map();
    const workStart = DAY_START_HOUR * 60;
    const workEnd = DAY_END_HOUR * 60;
    for (const team of visibleTeams) {
      const teamId = String(team.id);
      const ranges = (dayTasksByTeam.get(teamId) || [])
        .map((task) => ({ task, ...taskRangeMinutes(task) }))
        .sort((a, b) => a.start - b.start || a.end - b.end);
      const conflictIds = new Set();
      for (let i = 0; i < ranges.length; i += 1) {
        for (let j = i + 1; j < ranges.length; j += 1) {
          if (ranges[j].start >= ranges[i].end) break;
          conflictIds.add(String(ranges[i].task.id));
          conflictIds.add(String(ranges[j].task.id));
        }
      }
      const gaps = [];
      let cursor = workStart;
      for (const range of ranges) {
        const start = clamp(range.start, workStart, workEnd);
        const end = clamp(range.end, workStart, workEnd);
        if (start - cursor >= MIN_VISIBLE_GAP_MINUTES) {
          gaps.push({ start: cursor, end: start, minutes: start - cursor });
        }
        cursor = Math.max(cursor, end);
      }
      if (workEnd - cursor >= MIN_VISIBLE_GAP_MINUTES) {
        gaps.push({ start: cursor, end: workEnd, minutes: workEnd - cursor });
      }
      map.set(teamId, {
        ranges,
        gaps,
        conflictIds,
        loadMinutes: ranges.reduce((sum, range) => sum + range.duration, 0),
      });
    }
    return map;
  }, [dayTasksByTeam, visibleTeams]);

  // ─── nawigacja ────────────────────────────────────────────────────────────
  const isTeamDayView = activeTab === 'teams' && teamViewMode === 'day';
  const prev = () => setAnchor(a => addDays(a, isTeamDayView ? -1 : -rangeLen));
  const next = () => setAnchor(a => addDays(a, isTeamDayView ? 1 : rangeLen));
  const goToday = () => setAnchor(new Date());

  // ─── flash message ────────────────────────────────────────────────────────
  const showMsg = (txt, type = 'ok') => {
    setMsg(txt); setMsgType(type);
    setTimeout(() => setMsg(''), 3000);
  };

  // ─── tworzenie rezerwacji ─────────────────────────────────────────────────
  const handleNewSave = async (form) => {
    if (!form.sprzet_id || !form.ekipa_id) {
      setModalErr('Wybierz sprzęt i ekipę.'); return;
    }
    setSaving(true); setModalErr('');
    try {
      const token = getStoredToken();
      await api.post('/flota/rezerwacje', {
        sprzet_id: Number(form.sprzet_id),
        ekipa_id:  Number(form.ekipa_id),
        data_od:   form.data_od,
        data_do:   form.data_do,
        status:    form.status,
      }, { headers: authHeaders(token) });
      setModalNew(null);
      showMsg('Rezerwacja dodana.');
      await loadRezerwacje();
    } catch (err) {
      const code = err.response?.data?.error;
      if (err.response?.status === 409) setModalErr('Kolizja — sprzęt już zarezerwowany w tym terminie.');
      else setModalErr(code || 'Błąd zapisu.');
    } finally {
      setSaving(false);
    }
  };

  // ─── zmiana statusu ────────────────────────────────────────────────────────
  const handleStatusChange = async (id, status) => {
    setSaving(true);
    try {
      const token = getStoredToken();
      await api.put(`/flota/rezerwacje/${id}/status`, { status }, { headers: authHeaders(token) });
      setModalDet(null);
      showMsg('Status zaktualizowany.');
      await loadRezerwacje();
    } catch {
      showMsg('Błąd zapisu statusu.', 'err');
    } finally {
      setSaving(false);
    }
  };

  // ─── drag & drop ──────────────────────────────────────────────────────────
  const handleDragStart = (e, rez, dayISO) => {
    if (!canEdit) { e.preventDefault(); return; }
    drag.current = { rez, dragDayISO: dayISO };
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(rez.id));
  };

  const handleDragOver = (e, sprzetId, dayISO) => {
    if (!drag.current) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDropTarget({ sprzetId, dayISO });
  };

  const handleDragLeave = () => setDropTarget(null);

  const handleDrop = async (e, sprzetId, dayISO) => {
    e.preventDefault();
    setDropTarget(null);
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (String(sprzetId) !== String(d.rez.sprzet_id)) return; // tylko w obrębie tego samego sprzętu

    const delta = diffDays(d.dragDayISO, dayISO);
    if (delta === 0) return;

    const newOd = toISO(addDays(new Date(d.rez.data_od), delta));
    const newDo = toISO(addDays(new Date(d.rez.data_do), delta));

    try {
      const token = getStoredToken();
      await api.patch(`/flota/rezerwacje/${d.rez.id}`, { data_od: newOd, data_do: newDo }, { headers: authHeaders(token) });
      showMsg('Rezerwacja przesunięta.');
      await loadRezerwacje();
    } catch (err) {
      const code = err.response?.data?.error;
      if (err.response?.status === 409) showMsg('Kolizja — termin zajęty.', 'err');
      else showMsg(code || 'Błąd przesunięcia.', 'err');
    }
  };

  // ─── renderowanie paska rezerwacji ────────────────────────────────────────
  // Zwraca element bar dla danej rezerwacji; oblicza pozycję i szerokość
  const openTaskPlan = (task) => {
    setTaskPlanErr('');
    setModalTaskPlan(task);
  };

  const closeTaskPlan = () => {
    setTaskPlanErr('');
    setModalTaskPlan(null);
  };

  const openFullTask = (task) => {
    if (!task?.id) return;
    navigate(`/zlecenia?search=${task.id}`);
  };

  const handleTaskPlanSave = async (task, form) => {
    if (!task?.id) return;
    if (!form.data_planowana || !form.godzina_rozpoczecia || !form.czas_planowany_godziny || !form.ekipa_id) {
      setTaskPlanErr('Uzupelnij date, godzine, czas pracy i ekipe.');
      return;
    }
    setSaving(true);
    setTaskPlanErr('');
    try {
      const token = getStoredToken();
      await api.put(`/tasks/${task.id}/office-plan`, {
        data_planowana: form.data_planowana,
        godzina_rozpoczecia: form.godzina_rozpoczecia,
        czas_planowany_godziny: form.czas_planowany_godziny,
        ekipa_id: form.ekipa_id,
        sprzet_notatka: form.sprzet_notatka || 'Zmieniono w panelu harmonogramu.',
      }, { headers: authHeaders(token) });
      showMsg(`Zapisano plan zlecenia #${task.id}.`);
      setModalTaskPlan(null);
      await loadAll();
    } catch (err) {
      const code = err.response?.data?.error;
      setTaskPlanErr(code || 'Nie udalo sie zapisac planu.');
    } finally {
      setSaving(false);
    }
  };

  const handleTaskDragStart = (e, task) => {
    if (!canEdit) { e.preventDefault(); return; }
    taskDrag.current = { task };
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(task.id));
  };

  const handleTaskDragOver = (e, teamId, dayISO, time = null) => {
    if (!taskDrag.current) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setTeamDropTarget({ teamId, dayISO, time });
  };

  const handleTaskDragLeave = () => setTeamDropTarget(null);

  const handleTaskDrop = async (e, teamId, dayISO, time = null) => {
    e.preventDefault();
    setTeamDropTarget(null);
    const payload = taskDrag.current;
    taskDrag.current = null;
    if (!payload?.task) return;
    const task = payload.task;
    const nextTime = time || taskTime(task);
    const nextHours = taskHours(task);
    if (String(task.ekipa_id || '') === String(teamId) && taskDate(task) === dayISO && taskTime(task) === nextTime) return;

    setSaving(true);
    try {
      const token = getStoredToken();
      await api.put(`/tasks/${task.id}/office-plan`, {
        data_planowana: dayISO,
        godzina_rozpoczecia: nextTime,
        czas_planowany_godziny: nextHours,
        ekipa_id: teamId,
        sprzet_notatka: 'Przesunieto w harmonogramie ekip.',
      }, { headers: authHeaders(token) });
      showMsg(`Zlecenie #${task.id} zaplanowane: ${dayISO} ${nextTime}.`);
      await loadAll();
    } catch (err) {
      const code = err.response?.data?.error;
      showMsg(code || 'Nie udalo sie przesunac zlecenia.', 'err');
    } finally {
      setSaving(false);
    }
  };

  const renderTaskCard = (task) => {
    const color = TASK_STATUS_COLOR[task.status] || '#64748b';
    return (
      <div
        key={task.id}
        draggable={canEdit}
        onDragStart={(e) => handleTaskDragStart(e, task)}
        onClick={(e) => { e.stopPropagation(); openTaskPlan(task); }}
        title={`${taskClientLabel(task)}\n${taskTime(task)} | ${taskHours(task)} h\n${task.adres || ''}`}
        style={{ ...st.taskCard, borderLeft: `4px solid ${color}` }}
      >
        <div style={st.taskCardTop}>
          <strong>#{task.id} {taskTime(task)}</strong>
          <span style={{ ...st.taskStatus, background: color }}>{task.status}</span>
        </div>
        <div style={st.taskTitle}>{taskClientLabel(task)}</div>
        <div style={st.taskMeta}>{task.miasto || task.adres || 'Brak adresu'} · {taskHours(task)} h</div>
      </div>
    );
  };

  const renderDayTaskBlock = (task) => {
    const color = TASK_STATUS_COLOR[task.status] || '#64748b';
    const start = clamp(timeToMinutes(taskTime(task)), DAY_START_HOUR * 60, DAY_END_HOUR * 60 - 15);
    const duration = Math.max(30, Math.round(taskHours(task) * 60));
    const top = ((start - DAY_START_HOUR * 60) / 60) * DAY_HOUR_HEIGHT + 4;
    const height = Math.max(48, (duration / 60) * DAY_HOUR_HEIGHT - 8);
    const analysis = dayAnalysisByTeam.get(String(task.ekipa_id));
    const hasConflict = analysis?.conflictIds?.has(String(task.id));
    return (
      <div
        key={task.id}
        draggable={canEdit}
        onDragStart={(e) => handleTaskDragStart(e, task)}
        onClick={(e) => { e.stopPropagation(); openTaskPlan(task); }}
        style={{
          ...st.dayTaskBlock,
          ...(hasConflict ? st.dayTaskBlockConflict : {}),
          top,
          height,
          borderLeft: `4px solid ${hasConflict ? '#ef4444' : color}`,
        }}
        title={`${taskClientLabel(task)}\n${taskTime(task)} | ${taskHours(task)} h\n${task.adres || ''}`}
      >
        <div style={st.dayTaskTime}>
          {taskTime(task)} · {taskHours(task)} h{hasConflict ? ' · konflikt' : ''}
        </div>
        <strong style={st.dayTaskTitle}>#{task.id} {taskClientLabel(task)}</strong>
        <span style={st.dayTaskMeta}>{task.miasto || task.adres || 'Brak adresu'}</span>
      </div>
    );
  };

  const renderBar = (rez, rowIndex) => {
    const rezOd = rez.data_od?.slice(0, 10);
    const rezDo = rez.data_do?.slice(0, 10);
    const firstISO = toISO(days[0]);
    const lastISO  = toISO(days[days.length - 1]);

    // Przytnij do widocznego zakresu
    const startISO = rezOd < firstISO ? firstISO : rezOd;
    const endISO   = rezDo > lastISO  ? lastISO  : rezDo;

    const colStart = diffDays(firstISO, startISO);
    const spanDays = diffDays(startISO, endISO) + 1;
    if (spanDays <= 0 || colStart >= days.length) return null;

    const left   = colStart * COL_W + 2;
    const width  = spanDays * COL_W - 4;
    const color  = STATUS_COLOR[rez.status] || '#6b7280';
    const isAnulowana = rez.status === 'Anulowane';

    return (
      <div
        key={rez.id}
        draggable={canEdit && !isAnulowana}
        onDragStart={(e) => handleDragStart(e, rez, startISO)}
        onClick={(e) => { e.stopPropagation(); setModalDet(rez); }}
        title={`${rez.sprzet_nazwa} | ${rez.ekipa_nazwa}\n${rezOd} → ${rezDo}\nStatus: ${rez.status}`}
        style={{
          position: 'absolute',
          left:     left,
          top:      (rowIndex * ROW_H) + 7,
          width:    width,
          height:   ROW_H - 14,
          background: color,
          borderRadius: 6,
          color: '#fff',
          fontSize: 11,
          fontWeight: 600,
          display: 'flex',
          alignItems: 'center',
          paddingLeft: 8,
          overflow: 'hidden',
          whiteSpace: 'nowrap',
          textOverflow: 'ellipsis',
          opacity: isAnulowana ? 0.45 : 1,
          cursor: canEdit && !isAnulowana ? 'grab' : 'pointer',
          userSelect: 'none',
          zIndex: 2,
          boxShadow: '0 1px 4px rgba(0,0,0,0.2)',
        }}
      >
        {spanDays > 1 ? `${rez.ekipa_nazwa}` : ''}
      </div>
    );
  };

  // ─── render ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{ display: 'flex', minHeight: '100vh' }}>
        <Sidebar />
        <div style={{ padding: 40, color: 'var(--text-muted)' }}>Ładowanie kalendarza zasobów…</div>
      </div>
    );
  }

  const equipmentTotalW = LABEL_W + days.length * COL_W;
  const teamTotalW = TEAM_LABEL_W + days.length * TEAM_COL_W;
  const dayTotalW = DAY_TIME_LABEL_W + Math.max(visibleTeams.length, 1) * DAY_TEAM_COL_W;
  const totalW = activeTab === 'teams'
    ? (teamViewMode === 'day' ? dayTotalW : teamTotalW)
    : equipmentTotalW;

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--bg)' }}>
      <Sidebar />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* ── nagłówek strony ───────────────────────────────────────────── */}
        <div style={st.pageHeader}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button style={st.navBtn} onClick={prev}>‹</button>
            <button style={st.todayBtn} onClick={goToday}>Dziś</button>
            <button style={st.navBtn} onClick={next}>›</button>
            <span style={st.periodLabel}>{isTeamDayView ? dayLabel : periodLabel}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              style={{ ...st.viewBtn, background: activeTab === 'teams' ? 'var(--accent)' : 'var(--bg-card2)', color: activeTab === 'teams' ? 'var(--on-accent)' : 'var(--text)' }}
              onClick={() => setActiveTab('teams')}>Ekipy</button>
            {activeTab === 'teams' && (
              <>
                <button
                  style={{ ...st.viewBtn, background: teamViewMode === 'day' ? 'var(--accent)' : 'var(--bg-card2)', color: teamViewMode === 'day' ? 'var(--on-accent)' : 'var(--text)' }}
                  onClick={() => setTeamViewMode('day')}>Dzien</button>
                <button
                  style={{ ...st.viewBtn, background: teamViewMode === 'range' ? 'var(--accent)' : 'var(--bg-card2)', color: teamViewMode === 'range' ? 'var(--on-accent)' : 'var(--text)' }}
                  onClick={() => setTeamViewMode('range')}>Zakres</button>
              </>
            )}
            <button
              style={{ ...st.viewBtn, background: activeTab === 'equipment' ? 'var(--accent)' : 'var(--bg-card2)', color: activeTab === 'equipment' ? 'var(--on-accent)' : 'var(--text)' }}
              onClick={() => setActiveTab('equipment')}>Sprzet</button>
            <select
              style={st.branchSelect}
              value={selectedBranchId}
              disabled={!userCanSeeAllBranches}
              onChange={(event) => setSelectedBranchId(event.target.value)}
            >
              {userCanSeeAllBranches && <option value="">Wszystkie oddzialy</option>}
              {branchOptions.map((branch) => (
                <option key={branch.id} value={branch.id}>{branch.nazwa}</option>
              ))}
            </select>
            {(!isTeamDayView) && (
              <>
                <button
                  style={{ ...st.viewBtn, background: rangeLen === 14 ? 'var(--accent)' : 'var(--bg-card2)', color: rangeLen === 14 ? 'var(--on-accent)' : 'var(--text)' }}
                  onClick={() => setRangeLen(14)}>2 tygodnie</button>
                <button
                  style={{ ...st.viewBtn, background: rangeLen === 28 ? 'var(--accent)' : 'var(--bg-card2)', color: rangeLen === 28 ? 'var(--on-accent)' : 'var(--text)' }}
                  onClick={() => setRangeLen(28)}>4 tygodnie</button>
              </>
            )}
          </div>
          <h2 style={st.pageTitle}>Kalendarz zasobów</h2>
        </div>

        {/* ── flash message ─────────────────────────────────────────────── */}
        {msg && (
          <div style={{ ...st.flash, background: msgType === 'ok' ? 'var(--success-bg, #d1fae5)' : 'var(--error-bg, #fee2e2)', color: msgType === 'ok' ? '#065f46' : '#991b1b' }}>
            {msg}
          </div>
        )}

        {/* ── legenda statusów ──────────────────────────────────────────── */}
        <div style={st.legend}>
          {Object.entries(activeTab === 'teams' ? TASK_STATUS_COLOR : STATUS_COLOR).map(([s, c]) => (
            <span key={s} style={st.legendItem}>
              <span style={{ ...st.legendDot, background: c }} />
              {s}
            </span>
          ))}
          {canEdit && <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-muted)' }}>Kliknij komórkę — nowa rezerwacja · Przeciągnij bar — zmień termin</span>}
        </div>

        {/* ── główna siatka ─────────────────────────────────────────────── */}
        <div style={{ flex: 1, overflow: 'auto' }}>
          <div style={{ minWidth: totalW }}>
            {activeTab === 'teams' ? (
              <>
                {planningQueue.length > 0 && (
                  <div style={st.queuePanel}>
                    <div style={st.queueHead}>
                      <strong>Do zaplanowania</strong>
                      <span>{planningQueue.length} pozycji czeka na ekipe lub termin</span>
                    </div>
                    <div style={st.queueList}>
                      {planningQueue.map((task) => renderTaskCard(task))}
                    </div>
                  </div>
                )}

                <div style={{ display: teamViewMode === 'day' ? 'none' : 'flex', position: 'sticky', top: 0, zIndex: 10, background: 'var(--bg-card)', borderBottom: '1px solid var(--border)' }}>
                  <div style={{ width: TEAM_LABEL_W, minWidth: TEAM_LABEL_W, height: HEADER_H, display: 'flex', alignItems: 'center', paddingLeft: 16, fontWeight: 700, fontSize: 13, borderRight: '1px solid var(--border)', color: 'var(--text-muted)', flexShrink: 0 }}>
                    Ekipa / dzien
                  </div>
                  {days.map((d, i) => {
                    const iso = toISO(d);
                    const isToday = iso === todayISO;
                    const isWeekend = d.getDay() === 0 || d.getDay() === 6;
                    const firstOfMonth = d.getDate() === 1;
                    return (
                      <div key={iso} style={{
                        width: TEAM_COL_W, minWidth: TEAM_COL_W, height: HEADER_H,
                        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                        borderLeft: firstOfMonth ? '2px solid var(--accent)' : '1px solid var(--border)',
                        background: isToday ? 'var(--accent-surface)' : isWeekend ? 'var(--bg-card2)' : 'var(--bg-card)',
                        fontSize: 11, flexShrink: 0,
                      }}>
                        {(i === 0 || firstOfMonth) && (
                          <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--accent)', letterSpacing: 0.5, textTransform: 'uppercase' }}>
                            {MIESIACE[d.getMonth()]}
                          </span>
                        )}
                        <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{DNI_PL[d.getDay()]}</span>
                        <span style={{
                          fontSize: 14, fontWeight: isToday ? 800 : 500,
                          background: isToday ? 'var(--accent)' : 'transparent',
                          color: isToday ? '#fff' : isWeekend ? 'var(--text-muted)' : 'var(--text)',
                          borderRadius: 20, width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                          {d.getDate()}
                        </span>
                      </div>
                    );
                  })}
                </div>

                {visibleTeams.length === 0 && (
                  <div style={{ padding: '40px 24px', color: 'var(--text-muted)', textAlign: 'center' }}>
                    Brak ekip w wybranym oddziale.
                  </div>
                )}

                {teamViewMode === 'day' ? (
                  <div style={st.dayPlanner}>
                    <div style={st.dayPlannerHeader}>
                      <div style={st.dayTimeHeader}>Godzina</div>
                      {visibleTeams.map((team) => (
                        <div key={team.id} style={st.dayTeamHeader}>
                          {(() => {
                            const analysis = dayAnalysisByTeam.get(String(team.id));
                            const hasConflict = (analysis?.conflictIds?.size || 0) > 0;
                            return (
                              <>
                                <strong>{team.nazwa}</strong>
                                <span>{team.dostepny_w_oddziale_nazwa || team.oddzial_nazwa || 'Oddzial'}{team.delegowany ? ' · delegacja' : ''}</span>
                                <span style={{ ...st.dayTeamHeaderMeta, ...(hasConflict ? st.dayTeamHeaderMetaConflict : {}) }}>
                                  {durationLabel(analysis?.loadMinutes || 0)} pracy · {analysis?.gaps?.length || 0} luk{hasConflict ? ' · konflikt' : ''}
                                </span>
                              </>
                            );
                          })()}
                        </div>
                      ))}
                    </div>
                    <div style={st.dayPlannerBody}>
                      <div style={{ ...st.dayTimeRail, height: dayTimelineHeight }}>
                        {dayHourMarks.map((hour) => (
                          <span
                            key={hour}
                            style={{
                              ...st.dayHourMark,
                              top: Math.max(0, (hour - DAY_START_HOUR) * DAY_HOUR_HEIGHT - 7),
                            }}
                          >
                            {hourLabel(hour)}
                          </span>
                        ))}
                      </div>
                      {visibleTeams.map((team) => {
                        const teamTasks = dayTasksByTeam.get(String(team.id)) || [];
                        const analysis = dayAnalysisByTeam.get(String(team.id));
                        return (
                          <div key={team.id} style={{ ...st.dayTeamColumn, height: dayTimelineHeight }}>
                            {daySlots.map((hour) => {
                              const slotTime = hourLabel(hour);
                              const isDropHere =
                                String(teamDropTarget?.teamId || '') === String(team.id) &&
                                teamDropTarget?.dayISO === dayISO &&
                                teamDropTarget?.time === slotTime;
                              return (
                                <div
                                  key={`${team.id}-${slotTime}`}
                                  style={{
                                    ...st.dayHourSlot,
                                    top: (hour - DAY_START_HOUR) * DAY_HOUR_HEIGHT,
                                    height: DAY_HOUR_HEIGHT,
                                    background: isDropHere ? 'rgba(34,197,94,0.18)' : 'transparent',
                                  }}
                                  onDragOver={(e) => handleTaskDragOver(e, team.id, dayISO, slotTime)}
                                  onDragLeave={handleTaskDragLeave}
                                  onDrop={(e) => handleTaskDrop(e, team.id, dayISO, slotTime)}
                                />
                              );
                            })}
                            {(analysis?.gaps || []).map((gap) => {
                              const top = ((gap.start - DAY_START_HOUR * 60) / 60) * DAY_HOUR_HEIGHT + 3;
                              const height = Math.max(22, (gap.minutes / 60) * DAY_HOUR_HEIGHT - 6);
                              return (
                                <div
                                  key={`${team.id}-gap-${gap.start}-${gap.end}`}
                                  style={{ ...st.dayGapBlock, top, height }}
                                  title={`Wolne ${minutesToTime(gap.start)}-${minutesToTime(gap.end)}`}
                                >
                                  wolne {minutesToTime(gap.start)}-{minutesToTime(gap.end)}
                                </div>
                              );
                            })}
                            {teamTasks.length ? teamTasks.map(renderDayTaskBlock) : (
                              <div style={st.dayEmptyColumn}>Brak zlecen w tym dniu</div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : visibleTeams.map((team) => (
                  <div key={team.id} style={{ display: 'flex', borderBottom: '1px solid var(--border)', minHeight: TEAM_ROW_H }}>
                    <div style={{
                      width: TEAM_LABEL_W, minWidth: TEAM_LABEL_W, minHeight: TEAM_ROW_H,
                      display: 'flex', flexDirection: 'column', justifyContent: 'center',
                      paddingLeft: 16, paddingRight: 12,
                      borderRight: '1px solid var(--border)',
                      flexShrink: 0, overflow: 'hidden',
                    }}>
                      <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{team.nazwa}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                        {team.dostepny_w_oddziale_nazwa || team.oddzial_nazwa || 'Oddzial'}{team.delegowany ? ' · delegacja' : ''}
                      </div>
                    </div>
                    {days.map((d) => {
                      const iso = toISO(d);
                      const isWeekend = d.getDay() === 0 || d.getDay() === 6;
                      const isToday = iso === todayISO;
                      const firstOfMonth = d.getDate() === 1;
                      const isDropHere = String(teamDropTarget?.teamId || '') === String(team.id) && teamDropTarget?.dayISO === iso;
                      const cellTasks = tasksByTeamDay.get(`${team.id}|${iso}`) || [];
                      return (
                        <div
                          key={`${team.id}-${iso}`}
                          style={{
                            width: TEAM_COL_W,
                            minWidth: TEAM_COL_W,
                            minHeight: TEAM_ROW_H,
                            borderLeft: firstOfMonth ? '2px solid var(--accent)' : '1px solid var(--border)',
                            background: isDropHere
                              ? 'rgba(34,197,94,0.18)'
                              : isToday
                              ? 'var(--accent-surface)'
                              : isWeekend
                              ? 'var(--bg-card2)'
                              : 'transparent',
                            padding: 8,
                            boxSizing: 'border-box',
                            overflowY: 'auto',
                          }}
                          onDragOver={(e) => handleTaskDragOver(e, team.id, iso)}
                          onDragLeave={handleTaskDragLeave}
                          onDrop={(e) => handleTaskDrop(e, team.id, iso)}
                        >
                          {cellTasks.length ? cellTasks.map(renderTaskCard) : <div style={st.emptyTeamCell}>wolne</div>}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </>
            ) : (
              <>

            {/* nagłówek dat */}
            <div style={{ display: 'flex', position: 'sticky', top: 0, zIndex: 10, background: 'var(--bg-card)', borderBottom: '1px solid var(--border)' }}>
              {/* lewa kolumna — sprzęt */}
              <div style={{ width: LABEL_W, minWidth: LABEL_W, height: HEADER_H, display: 'flex', alignItems: 'center', paddingLeft: 16, fontWeight: 700, fontSize: 13, borderRight: '1px solid var(--border)', color: 'var(--text-muted)', flexShrink: 0 }}>
                Sprzęt / Zasób
              </div>
              {/* kolumny dni */}
              {days.map((d, i) => {
                const iso = toISO(d);
                const isToday = iso === todayISO;
                const isWeekend = d.getDay() === 0 || d.getDay() === 6;
                const firstOfMonth = d.getDate() === 1;
                return (
                  <div key={iso} style={{
                    width: COL_W, minWidth: COL_W, height: HEADER_H,
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                    borderLeft: firstOfMonth ? '2px solid var(--accent)' : '1px solid var(--border)',
                    background: isToday ? 'var(--accent-surface)' : isWeekend ? 'var(--bg-card2)' : 'var(--bg-card)',
                    fontSize: 11, flexShrink: 0,
                  }}>
                    {(i === 0 || firstOfMonth) && (
                      <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--accent)', letterSpacing: 0.5, textTransform: 'uppercase' }}>
                        {MIESIACE[d.getMonth()]}
                      </span>
                    )}
                    <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{DNI_PL[d.getDay()]}</span>
                    <span style={{
                      fontSize: 14, fontWeight: isToday ? 800 : 500,
                      background: isToday ? 'var(--accent)' : 'transparent',
                      color: isToday ? '#fff' : isWeekend ? 'var(--text-muted)' : 'var(--text)',
                      borderRadius: 20, width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      {d.getDate()}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* wiersze sprzętu */}
            {sprzet.length === 0 && (
              <div style={{ padding: '40px 24px', color: 'var(--text-muted)', textAlign: 'center' }}>
                Brak sprzętu. Dodaj urządzenia w module Flota.
              </div>
            )}

            {sprzet.map((s) => {
              const rowRez = rezBySprzet[s.id] || [];

              return (
                <div key={s.id} style={{ display: 'flex', borderBottom: '1px solid var(--border)', minHeight: ROW_H }}>
                  {/* etykieta sprzętu */}
                  <div style={{
                    width: LABEL_W, minWidth: LABEL_W, height: ROW_H,
                    display: 'flex', flexDirection: 'column', justifyContent: 'center',
                    paddingLeft: 16, paddingRight: 8,
                    borderRight: '1px solid var(--border)',
                    flexShrink: 0, overflow: 'hidden',
                  }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.nazwa}</div>
                    {s.typ && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{s.typ}</div>}
                  </div>

                  {/* komórki dni — wrapper relatywny dla absolutnych barów */}
                  <div style={{ flex: 1, position: 'relative', height: ROW_H }}>
                    {/* tło komórek — drop zones */}
                    {days.map((d) => {
                      const iso = toISO(d);
                      const isWeekend = d.getDay() === 0 || d.getDay() === 6;
                      const isToday = iso === todayISO;
                      const isDropHere = dropTarget?.sprzetId === s.id && dropTarget?.dayISO === iso;
                      const colIdx = diffDays(toISO(days[0]), iso);
                      const firstOfMonth = d.getDate() === 1;
                      return (
                        <div
                          key={iso}
                          style={{
                            position: 'absolute',
                            left: colIdx * COL_W,
                            top: 0,
                            width: COL_W,
                            height: ROW_H,
                            borderLeft: firstOfMonth ? '2px solid var(--accent)' : '1px solid var(--border)',
                            background: isDropHere
                              ? 'rgba(59,130,246,0.25)'
                              : isToday
                              ? 'var(--accent-surface)'
                              : isWeekend
                              ? 'var(--bg-card2)'
                              : 'transparent',
                            cursor: canEdit ? 'pointer' : 'default',
                            zIndex: 1,
                          }}
                          onClick={() => canEdit && setModalNew({ sprzetId: s.id, date: iso })}
                          onDragOver={(e) => handleDragOver(e, s.id, iso)}
                          onDragLeave={handleDragLeave}
                          onDrop={(e) => handleDrop(e, s.id, iso)}
                        />
                      );
                    })}

                    {/* paski rezerwacji */}
                    {rowRez.map((rez) => renderBar(rez, 0))}
                  </div>
                </div>
              );
            })}
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── modals ──────────────────────────────────────────────────────────── */}
      {modalNew && (
        <NowaRezerwacjaModal
          sprzet={sprzet}
          ekipy={ekipy}
          defaultSprzet={modalNew.sprzetId}
          defaultDate={modalNew.date}
          onSave={handleNewSave}
          onClose={() => { setModalNew(null); setModalErr(''); }}
          saving={saving}
          error={modalErr}
        />
      )}
      {modalDet && (
        <RezerwacjaDetailModal
          rez={modalDet}
          ekipy={ekipy}
          onStatusChange={handleStatusChange}
          onClose={() => setModalDet(null)}
          saving={saving}
        />
      )}
      {modalTaskPlan && (
        <TaskPlanModal
          key={modalTaskPlan.id}
          task={modalTaskPlan}
          teams={plannerTeams}
          tasks={tasks}
          onSave={handleTaskPlanSave}
          onClose={closeTaskPlan}
          onOpenTask={() => openFullTask(modalTaskPlan)}
          saving={saving}
          error={taskPlanErr}
        />
      )}
    </div>
  );
}

// ─── style ───────────────────────────────────────────────────────────────────
const st = {
  pageHeader: {
    display: 'flex', alignItems: 'center', gap: 16, padding: '12px 24px',
    borderBottom: '1px solid var(--border)', background: 'var(--bg-card)',
    flexWrap: 'wrap',
  },
  pageTitle: {
    margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--text)',
    marginLeft: 'auto',
  },
  navBtn: {
    width: 32, height: 32, border: '1px solid var(--border)', borderRadius: 8,
    background: 'var(--bg-card2)', cursor: 'pointer', fontSize: 18,
    color: 'var(--text)', display: 'flex', alignItems: 'center', justifyContent: 'center',
    lineHeight: 1,
  },
  todayBtn: {
    padding: '5px 12px', border: '1px solid var(--border)', borderRadius: 8,
    background: 'var(--bg-card2)', cursor: 'pointer', fontSize: 13,
    color: 'var(--text)', fontWeight: 500,
  },
  periodLabel: {
    fontSize: 15, fontWeight: 600, color: 'var(--text)',
  },
  viewBtn: {
    padding: '5px 12px', border: 'none', borderRadius: 8,
    cursor: 'pointer', fontSize: 13, fontWeight: 500,
  },
  branchSelect: {
    minWidth: 170,
    height: 32,
    padding: '5px 10px',
    border: '1px solid var(--border)',
    borderRadius: 8,
    background: 'var(--bg-card2)',
    color: 'var(--text)',
    fontSize: 13,
    fontWeight: 600,
  },
  flash: {
    padding: '8px 24px', fontSize: 13, fontWeight: 500,
  },
  legend: {
    display: 'flex', alignItems: 'center', gap: 16,
    padding: '8px 24px', borderBottom: '1px solid var(--border)',
    background: 'var(--bg-card)', fontSize: 12,
  },
  legendItem: {
    display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-muted)',
  },
  legendDot: {
    width: 10, height: 10, borderRadius: 3, flexShrink: 0,
  },
  queuePanel: {
    borderBottom: '1px solid var(--border)',
    background: 'linear-gradient(135deg, rgba(34,197,94,0.08), var(--bg-card))',
    padding: '12px 16px',
  },
  queueHead: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    marginBottom: 10,
    color: 'var(--text)',
    fontSize: 13,
  },
  queueList: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))',
    gap: 8,
  },
  taskCard: {
    minHeight: 54,
    border: '1px solid var(--border)',
    borderRadius: 8,
    background: 'var(--bg-card)',
    color: 'var(--text)',
    padding: '7px 8px',
    marginBottom: 6,
    boxShadow: '0 1px 4px rgba(0,0,0,0.12)',
    cursor: 'grab',
    userSelect: 'none',
    boxSizing: 'border-box',
  },
  taskCardTop: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
    fontSize: 11,
  },
  taskStatus: {
    color: '#fff',
    borderRadius: 999,
    padding: '2px 6px',
    fontSize: 9,
    fontWeight: 800,
    maxWidth: 82,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  taskTitle: {
    marginTop: 4,
    fontSize: 12,
    fontWeight: 800,
    lineHeight: 1.2,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  taskMeta: {
    marginTop: 3,
    fontSize: 10,
    color: 'var(--text-muted)',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  emptyTeamCell: {
    minHeight: 40,
    border: '1px dashed var(--border)',
    borderRadius: 8,
    color: 'var(--text-muted)',
    fontSize: 11,
    fontWeight: 700,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.72,
  },
  dayPlanner: {
    minWidth: '100%',
    background: 'var(--bg)',
  },
  dayPlannerHeader: {
    display: 'flex',
    position: 'sticky',
    top: 0,
    zIndex: 12,
    background: 'var(--bg-card)',
    borderBottom: '1px solid var(--border)',
  },
  dayTimeHeader: {
    width: DAY_TIME_LABEL_W,
    minWidth: DAY_TIME_LABEL_W,
    height: HEADER_H,
    borderRight: '1px solid var(--border)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'var(--text-muted)',
    fontSize: 12,
    fontWeight: 800,
  },
  dayTeamHeader: {
    width: DAY_TEAM_COL_W,
    minWidth: DAY_TEAM_COL_W,
    height: HEADER_H,
    borderRight: '1px solid var(--border)',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    padding: '0 12px',
    boxSizing: 'border-box',
    color: 'var(--text)',
    fontSize: 13,
    lineHeight: 1.25,
  },
  dayTeamHeaderMeta: {
    display: 'inline-flex',
    marginTop: 4,
    color: '#16a34a',
    fontSize: 10,
    fontWeight: 900,
  },
  dayTeamHeaderMetaConflict: {
    color: '#ef4444',
  },
  dayPlannerBody: {
    display: 'flex',
    alignItems: 'stretch',
  },
  dayTimeRail: {
    width: DAY_TIME_LABEL_W,
    minWidth: DAY_TIME_LABEL_W,
    position: 'relative',
    borderRight: '1px solid var(--border)',
    background: 'var(--bg-card)',
  },
  dayHourMark: {
    position: 'absolute',
    right: 10,
    color: 'var(--text-muted)',
    fontSize: 11,
    fontWeight: 800,
    lineHeight: 1,
  },
  dayTeamColumn: {
    width: DAY_TEAM_COL_W,
    minWidth: DAY_TEAM_COL_W,
    position: 'relative',
    borderRight: '1px solid var(--border)',
    background: 'var(--bg-card)',
    overflow: 'hidden',
  },
  dayHourSlot: {
    position: 'absolute',
    left: 0,
    right: 0,
    borderTop: '1px solid var(--border)',
    boxSizing: 'border-box',
  },
  dayTaskBlock: {
    position: 'absolute',
    left: 8,
    right: 8,
    zIndex: 2,
    border: '1px solid var(--border)',
    borderRadius: 8,
    background: 'var(--bg-card2)',
    boxShadow: '0 2px 8px rgba(0,0,0,0.18)',
    color: 'var(--text)',
    padding: '7px 8px',
    overflow: 'hidden',
    cursor: 'grab',
    boxSizing: 'border-box',
  },
  dayTaskBlockConflict: {
    border: '1px solid rgba(239,68,68,0.72)',
    background: 'linear-gradient(135deg, rgba(239,68,68,0.16), var(--bg-card2))',
    boxShadow: '0 0 0 2px rgba(239,68,68,0.16), 0 2px 8px rgba(0,0,0,0.22)',
  },
  dayTaskTime: {
    color: 'var(--accent)',
    fontSize: 11,
    fontWeight: 900,
    lineHeight: 1.2,
  },
  dayTaskTitle: {
    display: 'block',
    marginTop: 3,
    fontSize: 12,
    lineHeight: 1.2,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  dayTaskMeta: {
    display: 'block',
    marginTop: 3,
    color: 'var(--text-muted)',
    fontSize: 10,
    lineHeight: 1.2,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  dayEmptyColumn: {
    position: 'absolute',
    top: 12,
    left: 10,
    right: 10,
    border: '1px dashed var(--border)',
    borderRadius: 8,
    color: 'var(--text-muted)',
    fontSize: 11,
    fontWeight: 700,
    padding: 10,
    textAlign: 'center',
    opacity: 0.72,
  },
  dayGapBlock: {
    position: 'absolute',
    left: 9,
    right: 9,
    zIndex: 1,
    border: '1px dashed rgba(34,197,94,0.48)',
    borderRadius: 8,
    background: 'rgba(34,197,94,0.08)',
    color: '#16a34a',
    fontSize: 10,
    fontWeight: 900,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    pointerEvents: 'none',
    overflow: 'hidden',
    whiteSpace: 'nowrap',
  },
};
