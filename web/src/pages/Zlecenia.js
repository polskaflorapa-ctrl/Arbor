import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
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
import { getApiErrorMessage } from '../utils/apiError';
import { getLocalStorageJson } from '../utils/safeJsonLocalStorage';
import { getStoredToken, authHeaders } from '../utils/storedToken';
 
 
const PUSTY_FORMULARZ = {
  klient_nazwa: '', klient_telefon: '', klient_email: '',
  adres: '', miasto: '',
  typ_uslugi: 'Wycinka', status: 'Nowe', priorytet: 'Normalny',
  data_planowana: '', wartosc_planowana: '', czas_planowany_godziny: '',
  ekipa_id: '', kierownik_id: '',
  opis_pracy: '',
  wywoz: false, usuwanie_pni: false, czas_realizacji_godz: '',
  rebak: false, pila_wysiegniku: false, nozyce_dlugie: false,
  kosiarka: false, podkaszarka: false, lopata: false, mulczer: false,
  ilosc_osob: '', arborysta: false,
  wynik: '', budzet: '', rabat: '', kwota_minimalna: '',
  zrebki: '', drzewno: '', notatki: '',
};
const VIEW_MODE_KEY = 'zlecenia_view_mode';
const WORKFLOW_CONFIG_KEY = 'zlecenia_workflow_config';
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
        <span style={{ fontSize: 12, color: form[field] ? '#34d399' : 'var(--text-muted)', fontWeight: '600', minWidth: 24 }}>
          {form[field] ? t('common.yes') : t('common.no')}
        </span>
        <Toggle value={form[field]} onChange={v => onChange(field, v)} disabled={disabled} />
      </div>
    </div>
  );
}
 
export default function Zlecenia() {
  const { t } = useTranslation();
  const [zlecenia, setZlecenia] = useState([]);
  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState(null);
  const [ekipy, setEkipy] = useState([]);
  const [uzytkownicy, setUzytkownicy] = useState([]);
  const [tryb, setTryb] = useState(() => localStorage.getItem(VIEW_MODE_KEY) || 'lista');
  const [wybraneZlecenie, setWybraneZlecenie] = useState(null);
  const [form, setForm] = useState(PUSTY_FORMULARZ);
  const [filtrStatus, setFiltrStatus] = useState('');
  const [filtrTyp, setFiltrTyp] = useState('');
  const [filtrOddzial, setFiltrOddzial] = useState('');
  const [filtrEkipa, setFiltrEkipa] = useState('');
  const [szukaj, setSzukaj] = useState('');
  const [komunikat, setKomunikat] = useState({ tekst: '', typ: '' });
  const [potwierdzUsuniecie, setPotwierdzUsuniecie] = useState(null);
  const [selectedTaskIds, setSelectedTaskIds] = useState([]);
  const [draggedTaskId, setDraggedTaskId] = useState(null);
  const [statusUpdatingId, setStatusUpdatingId] = useState(null);
  const [showWorkflowPanel, setShowWorkflowPanel] = useState(false);
  const [workflowConfig, setWorkflowConfig] = useState(() => {
    const parsed = getLocalStorageJson(WORKFLOW_CONFIG_KEY, {});
    return { ...DEFAULT_WORKFLOW_CONFIG, ...parsed };
  });
  const navigate = useNavigate();
 
  const isDyrektor = currentUser?.rola === 'Dyrektor' || currentUser?.rola === 'Administrator';
  const isKierownik = currentUser?.rola === 'Kierownik';
  const mozeTworzyc = isDyrektor || isKierownik;
  const mozeEdytowac = isDyrektor;
  const mozeUsuwac = isDyrektor;
  const mozePrzesuwacStatus = isDyrektor || isKierownik;

  useEffect(() => {
    localStorage.setItem(VIEW_MODE_KEY, tryb);
  }, [tryb]);

  useEffect(() => {
    localStorage.setItem(WORKFLOW_CONFIG_KEY, JSON.stringify(workflowConfig));
  }, [workflowConfig]);
 
  useEffect(() => {
    const parsedUser = getLocalStorageJson('user');
    if (!parsedUser) { navigate('/'); return; }
    setCurrentUser(parsedUser);
    loadData(parsedUser);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
 
  const loadData = async (user) => {
    try {
      const token = getStoredToken();
      const h = authHeaders(token);
      const rola = user?.rola;
      const endpoint = (rola === 'Dyrektor' || rola === 'Administrator') ? `/tasks/wszystkie` : `/tasks`;
      const [zRes, eRes, uRes] = await Promise.all([
        api.get(endpoint, { headers: h }),
        api.get(`/ekipy`, { headers: h }),
        api.get(`/uzytkownicy`, { headers: h }),
      ]);
      setZlecenia(zRes.data);
      setEkipy(eRes.data);
      setUzytkownicy(uRes.data);
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
 
  const setField = (field, value) => setForm(prev => ({ ...prev, [field]: value }));
 
  const otworzNowe = () => { setForm(PUSTY_FORMULARZ); setWybraneZlecenie(null); setTryb('nowy'); };
 
  const otworzSzczegoly = (z) => { setWybraneZlecenie(z); setTryb('szczegoly'); };
 
  const otworzEdycje = (z) => {
    setForm({
      klient_nazwa: z.klient_nazwa || '', klient_telefon: z.klient_telefon || '',
      klient_email: z.klient_email || '', adres: z.adres || '', miasto: z.miasto || '',
      typ_uslugi: z.typ_uslugi || 'Wycinka', status: z.status || 'Nowe',
      priorytet: z.priorytet || 'Normalny',
      data_planowana: z.data_planowana ? z.data_planowana.split('T')[0] : '',
      wartosc_planowana: z.wartosc_planowana || '', czas_planowany_godziny: z.czas_planowany_godziny || '',
      ekipa_id: z.ekipa_id || '', kierownik_id: z.kierownik_id || '',
      opis_pracy: z.opis_pracy || '',
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
    setTryb('edytuj');
  };
 
  const zapiszZlecenie = async () => {
    if (!form.klient_nazwa) { pokazKomunikat('Podaj nazwę klienta', 'error'); return; }
    try {
      const token = getStoredToken();
      const h = authHeaders(token);
      if (tryb === 'nowy') {
        await api.post(`/tasks`, form, { headers: h });
        pokazKomunikat('Zlecenie zostało utworzone');
      } else {
        await api.put(`/tasks/${wybraneZlecenie.id}`, form, { headers: h });
        pokazKomunikat('Zlecenie zaktualizowane');
      }
      await loadData(currentUser);
      setTryb('lista');
    } catch (err) {
      pokazKomunikat(getApiErrorMessage(err, 'Błąd zapisu'), 'error');
    }
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
    const isClosed = ['Zakonczone', 'Anulowane'].includes(task.status);
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

  const zmienStatusInline = async (taskId, nextStatus) => {
    const task = zlecenia.find((z) => z.id === taskId);
    if (!task || task.status === nextStatus) return;
    if (nextStatus === 'W_Realizacji') {
      const inProgressCount = zlecenia.filter((z) => z.status === 'W_Realizacji').length;
      if (task.status !== 'W_Realizacji' && inProgressCount >= 10) {
        pokazKomunikat('Limit WIP: maksymalnie 10 zleceń w realizacji.', 'error');
        return;
      }
    }
    setStatusUpdatingId(taskId);
    try {
      const token = getStoredToken();
      await api.put(
        `/tasks/${taskId}/status`,
        { status: nextStatus },
        { headers: authHeaders(token) }
      );
      setZlecenia((prev) => prev.map((z) => (z.id === taskId ? { ...z, status: nextStatus } : z)));
      if (wybraneZlecenie?.id === taskId) {
        setWybraneZlecenie((prev) => ({ ...prev, status: nextStatus }));
      }
      await runStatusWorkflow(task, nextStatus);
      pokazKomunikat(`Status zlecenia #${taskId} -> ${nextStatus}`);
    } catch (err) {
      pokazKomunikat(getApiErrorMessage(err, 'Nie udało się zmienić statusu'), 'error');
    } finally {
      setStatusUpdatingId(null);
    }
  };

  const toggleTaskSelection = (taskId) => {
    setSelectedTaskIds((prev) =>
      prev.includes(taskId) ? prev.filter((id) => id !== taskId) : [...prev, taskId]
    );
  };

  const toggleSelectAllVisible = () => {
    const visibleIds = filtrowane.map((z) => z.id);
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
      await zmienStatusInline(taskId, nextStatus);
    }
    setSelectedTaskIds([]);
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
    ];
    const rows = filtrowane.map((z) => [
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
    const rows = filtrowane.map((z) => ({
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
    }));

    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Zlecenia');

    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    XLSX.writeFile(workbook, `zlecenia-${stamp}.xlsx`);
    pokazKomunikat(`Wyeksportowano ${rows.length} rekordów do XLSX.`);
  };
 
  const filtrowane = zlecenia.filter(z => {
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
  const visibleIds = filtrowane.map((z) => z.id);
  const areAllVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedTaskIds.includes(id));
  const KANBAN_COLUMNS = ['Nowe', 'Zaplanowane', 'W_Realizacji', 'Zakonczone', 'Anulowane'];
  const oddzialyOpcje = [...new Set(zlecenia.map((z) => z.oddzial_id).filter(Boolean))];
  const kanbanStats = KANBAN_COLUMNS.map((status) => {
    const items = filtrowane.filter((z) => z.status === status);
    const total = items.reduce((sum, z) => sum + (parseFloat(z.wartosc_planowana) || 0), 0);
    return { status, count: items.length, total };
  });
  const totalKanbanValue = kanbanStats.reduce((sum, s) => sum + s.total, 0);
 
  const getStatusColor = (st) => ({ Zakonczone: '#4CAF50', W_Realizacji: '#F9A825', Nowe: '#2196F3', Zaplanowane: '#64748b', Anulowane: '#EF5350' }[st] || '#6B7280');
  const getPriorytetColor = (p) => ({ Pilny: '#EF5350', Wysoki: '#F9A825', Normalny: '#2196F3', Niski: '#9CA3AF' }[p] || '#6B7280');
  const formatCurrency = (v) => !v ? '—' : parseFloat(v).toLocaleString('pl-PL', { minimumFractionDigits: 2 }) + ' PLN';
 
  return (
    <div style={s.container}>
      <Sidebar />
      <div style={s.main}>
 
        <StatusMessage
          message={komunikat.tekst || ''}
          tone={komunikat.typ === 'error' ? 'error' : komunikat.typ === 'success' ? 'success' : undefined}
          style={s.komunikat}
        />
 
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
                  <button type="button" style={s.btnSecondary} onClick={exportFilteredCsv}>{t('common.exportCsv')}</button>
                  <button type="button" style={s.btnSecondary} onClick={exportFilteredXlsx}>{t('common.exportXlsx')}</button>
                  <button type="button" style={s.btnSecondary} onClick={() => { setFiltrStatus(''); setTryb('kanban'); }}>{t('pages.zlecenia.kanbanTitle')}</button>
                  {mozeTworzyc && <button type="button" style={s.btnPrimary} onClick={otworzNowe}>+ {t('common.newOrder')}</button>}
                </>
              }
            />
            <div style={{ display: 'grid', gridTemplateColumns: '1.2fr .8fr', gap: 12, marginBottom: 12 }}>
              <div style={{ background: 'linear-gradient(150deg, var(--bg-card) 0%, var(--bg-card2) 100%)', border: '1px solid var(--border2)', borderRadius: 12, padding: '10px 12px', boxShadow: 'var(--shadow-sm)' }}>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>Panel operacyjny</div>
                <div style={{ marginTop: 6, fontSize: 13, color: 'var(--text-sub)' }}>Łącznie: <strong style={{ color: 'var(--text)' }}>{zlecenia.length}</strong> · Widoczne: <strong style={{ color: 'var(--text)' }}>{filtrowane.length}</strong> · Wartość: <strong style={{ color: 'var(--text)' }}>{formatCurrency(filtrowane.reduce((s, z) => s + (parseFloat(z.wartosc_planowana) || 0), 0))}</strong></div>
              </div>
              <div style={{ background: 'linear-gradient(150deg, var(--bg-card) 0%, var(--bg-card2) 100%)', border: '1px solid var(--border2)', borderRadius: 12, padding: '10px 12px', boxShadow: 'var(--shadow-sm)' }}>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>Quick actions</div>
                <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button type="button" style={s.btnSecondary} onClick={() => setTryb('kanban')}>Kanban</button>
                  <button type="button" style={s.btnSecondary} onClick={exportFilteredCsv}>CSV</button>
                </div>
              </div>
            </div>
 
            <div style={s.filtryRow}>
              <input style={s.searchInput} placeholder={t('pages.zlecenia.searchPlaceholder')}
                value={szukaj} onChange={e => setSzukaj(e.target.value)} />
              <select style={s.filtrInput} value={filtrStatus} onChange={e => setFiltrStatus(e.target.value)}>
                <option value="">{t('pages.zlecenia.allStatuses')}</option>
                <option value="Nowe">{t('taskStatus.Nowe')}</option>
                <option value="Zaplanowane">{t('taskStatus.Zaplanowane')}</option>
                <option value="W_Realizacji">{t('taskStatus.W_Realizacji')}</option>
                <option value="Zakonczone">{t('taskStatus.Zakonczone')}</option>
                <option value="Anulowane">{t('taskStatus.Anulowane')}</option>
              </select>
              <select style={s.filtrInput} value={filtrTyp} onChange={e => setFiltrTyp(e.target.value)}>
                <option value="">{t('pages.zlecenia.allTypes')}</option>
                <option value="Wycinka">{t('serviceType.Wycinka')}</option>
                <option value="Pielęgnacja">{t('serviceType.Pielęgnacja')}</option>
                <option value="Ogrodnictwo">{t('serviceType.Ogrodnictwo')}</option>
                <option value="Frezowanie pniaków">{t('serviceType.Frezowanie pniaków')}</option>
                <option value="Inne">{t('serviceType.Inne')}</option>
              </select>
              {(filtrStatus || filtrTyp || szukaj) && (
                <button style={s.clearBtn} onClick={() => { setFiltrStatus(''); setFiltrTyp(''); setSzukaj(''); }}>{t('pages.zlecenia.clear')}</button>
              )}
              <span style={s.countBadge}>{filtrowane.length} / {zlecenia.length}</span>
            </div>

            {selectedTaskIds.length > 0 && (
              <div style={s.bulkBar}>
                <div style={s.bulkInfo}>{t('pages.zlecenia.bulkSelected', { count: selectedTaskIds.length })}</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button style={s.bulkBtn} onClick={() => bulkUpdateStatus('Zaplanowane')}>{t('pages.zlecenia.bulkToPlanned')}</button>
                  <button style={s.bulkBtn} onClick={() => bulkUpdateStatus('W_Realizacji')}>{t('pages.zlecenia.bulkToProgress')}</button>
                  <button style={s.bulkBtn} onClick={() => bulkUpdateStatus('Zakonczone')}>{t('pages.zlecenia.bulkFinish')}</button>
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
                {filtrowane.length === 0 ? (
                  <div style={{ ...s.card, textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>{t('pages.zlecenia.emptyList')}</div>
                ) : (
                  <div style={s.listCardsGrid}>
                    {filtrowane.map((z) => (
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
                        <div style={s.listTaskChips}>
                          <span style={{ ...s.badge, backgroundColor: getStatusColor(z.status) }}>{t(`taskStatus.${z.status}`, { defaultValue: z.status })}</span>
                          <span style={{ ...s.badge, backgroundColor: getPriorytetColor(z.priorytet) }}>{z.priorytet}</span>
                        </div>
                        <div style={s.slaWrap}>
                          {getSlaFlags(z).length === 0 ? (
                            <span style={s.slaOk}>{t('pages.zlecenia.slaOk')}</span>
                          ) : getSlaFlags(z).map((flag) => (
                            <span key={flag} style={s.slaBadge}>{slaFlagLabel(flag)}</span>
                          ))}
                        </div>
                        <div style={s.listTaskFooter}>
                          <span style={s.listTaskDate}>{z.data_planowana ? z.data_planowana.split('T')[0] : '—'}</span>
                          <span style={s.listTaskValue}>{formatCurrency(z.wartosc_planowana)}</span>
                        </div>
                      </div>
                    ))}
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
                <option value="Wycinka">{t('serviceType.Wycinka')}</option>
                <option value="Pielęgnacja">{t('serviceType.Pielęgnacja')}</option>
                <option value="Ogrodnictwo">{t('serviceType.Ogrodnictwo')}</option>
                <option value="Frezowanie pniaków">{t('serviceType.Frezowanie pniaków')}</option>
                <option value="Inne">{t('serviceType.Inne')}</option>
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
              {(filtrTyp || szukaj || filtrOddzial || filtrEkipa) && (
                <button style={s.clearBtn} onClick={() => { setFiltrStatus(''); setFiltrTyp(''); setFiltrOddzial(''); setFiltrEkipa(''); setSzukaj(''); }}>{t('pages.zlecenia.clear')}</button>
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
                    <div style={s.kpiCount}>{filtrowane.length}</div>
                    <div style={s.kpiValue}>{formatCurrency(totalKanbanValue)}</div>
                  </div>
                </div>
                <div style={s.kanbanWrap}>
                {KANBAN_COLUMNS.map((status) => {
                  const items = filtrowane.filter((z) => z.status === status);
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
                        ) : items.map((z) => (
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
                            <div style={s.kanbanCardFooter}>
                              <span style={{ ...s.badge, backgroundColor: getPriorytetColor(z.priorytet) }}>{z.priorytet}</span>
                              <span style={s.kanbanValue}>{formatCurrency(z.wartosc_planowana)}</span>
                            </div>
                            <div style={s.kanbanActions} onClick={(e) => e.stopPropagation()}>
                              <button style={s.kanbanActionBtn} onClick={() => otworzSzczegoly(z)}>👁</button>
                              {mozeEdytowac && <button style={s.kanbanActionBtn} onClick={() => otworzEdycje(z)}>✏️</button>}
                              {mozeUsuwac && (
                                <button
                                  style={{ ...s.kanbanActionBtn, color: '#C62828', backgroundColor: 'rgba(248,113,113,0.12)' }}
                                  onClick={() => setPotwierdzUsuniecie(z)}>
                                  🗑
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
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
                      style={{ ...s.btnSecondary, backgroundColor: 'rgba(248,113,113,0.1)', color: '#C62828', borderColor: '#EF9A9A' }}
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
 
            <div style={s.twoCol}>
              <div style={s.card}>
                <div style={s.cardTitle}>Dane klienta</div>
                {[['Klient', wybraneZlecenie.klient_nazwa], ['Telefon', wybraneZlecenie.klient_telefon],
                  ['Email', wybraneZlecenie.klient_email], ['Adres', wybraneZlecenie.adres],
                  ['Miasto', wybraneZlecenie.miasto]].map(([l, v]) => v ? (
                  <div key={l} style={s.detailRow}>
                    <span style={s.detailLabel}>{l}</span><span style={s.detailValue}>{v}</span>
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
                  <div style={{ fontSize: 13, fontWeight: 'bold', color: 'var(--accent)', marginBottom: 10, paddingBottom: 6, borderBottom: '1px solid var(--border)' }}>📦 Logistyka</div>
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
 
            <div style={s.card}>
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
 
            <div style={s.card}>
              <div style={s.cardTitle}>Planowanie</div>
              <div style={s.formGrid}>
                <div style={s.fg}><label style={s.label}>Typ usługi</label>
                  <select style={s.input} value={form.typ_uslugi} onChange={e => setField('typ_uslugi', e.target.value)}>
                    <option value="Wycinka">{t('serviceType.Wycinka')}</option>
                    <option value="Pielęgnacja">{t('serviceType.Pielęgnacja')}</option>
                    <option value="Ogrodnictwo">{t('serviceType.Ogrodnictwo')}</option>
                    <option value="Frezowanie pniaków">{t('serviceType.Frezowanie pniaków')}</option>
                    <option value="Inne">{t('serviceType.Inne')}</option>
                  </select></div>
                <div style={s.fg}><label style={s.label}>Status</label>
                  <select style={s.input} value={form.status} onChange={e => setField('status', e.target.value)}>
                    <option value="Nowe">Nowe</option><option value="Zaplanowane">Zaplanowane</option>
                    <option value="W_Realizacji">W realizacji</option><option value="Zakonczone">Zakończone</option>
                    <option value="Anulowane">Anulowane</option>
                  </select></div>
                <div style={s.fg}><label style={s.label}>Priorytet</label>
                  <select style={s.input} value={form.priorytet} onChange={e => setField('priorytet', e.target.value)}>
                    <option value="Niski">Niski</option><option value="Normalny">Normalny</option>
                    <option value="Wysoki">Wysoki</option><option value="Pilny">Pilny</option>
                  </select></div>
                <div style={s.fg}><label style={s.label}>Data planowana</label>
                  <input style={s.input} type="date" value={form.data_planowana} onChange={e => setField('data_planowana', e.target.value)} /></div>
                <div style={s.fg}><label style={s.label}>Ekipa</label>
                  <select style={s.input} value={form.ekipa_id} onChange={e => setField('ekipa_id', e.target.value)}>
                    <option value="">— brak —</option>
                    {ekipy.map(e => <option key={e.id} value={e.id}>{e.nazwa}</option>)}
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
 
            <div style={s.card}>
              <div style={s.cardTitle}>1. Opis pracy</div>
              <textarea style={{ ...s.input, minHeight: 80, resize: 'vertical', width: '100%', boxSizing: 'border-box' }}
                placeholder="np. Przycinanie żywopłotu i drzew, usuwanie gałęzi..."
                value={form.opis_pracy} onChange={e => setField('opis_pracy', e.target.value)} />
            </div>
 
            <div style={s.twoCol}>
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
                <TakNie label="6. Rębak" field="rebak" form={form} onChange={setField} />
                <TakNie label="7. Piła na wysięgniku" field="pila_wysiegniku" form={form} onChange={setField} />
                <TakNie label="8. Nożyce długie" field="nozyce_dlugie" form={form} onChange={setField} />
                <TakNie label="17. Kosiarka" field="kosiarka" form={form} onChange={setField} />
                <TakNie label="18. Podkaszarka" field="podkaszarka" form={form} onChange={setField} />
                <TakNie label="19. Łopata" field="lopata" form={form} onChange={setField} />
                <TakNie label="20. Mulczer" field="mulczer" form={form} onChange={setField} />
              </div>
            </div>
 
            <div style={s.card}>
              <div style={s.cardTitle}>10–15. Wynik i finanse</div>
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
 
            <div style={s.card}>
              <div style={s.cardTitle}>Notatki dodatkowe</div>
              <textarea style={{ ...s.input, minHeight: 80, resize: 'vertical', width: '100%', boxSizing: 'border-box' }}
                placeholder="Dodatkowe uwagi..." value={form.notatki} onChange={e => setField('notatki', e.target.value)} />
            </div>
 
            <div style={{ display: 'flex', gap: 12, marginTop: 8, flexWrap: 'wrap', paddingBottom: 40 }}>
              <button type="button" style={s.btnPrimary} onClick={zapiszZlecenie}>
                {tryb === 'nowy' ? t('pages.zlecenia.submitCreate') : t('pages.zlecenia.submitSave')}
              </button>
              <button type="button" style={s.btnGray} onClick={() => setTryb(wybraneZlecenie ? 'szczegoly' : 'lista')}>{t('common.cancel')}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
 
const s = {
  container: { display: 'flex', minHeight: '100vh', background: 'linear-gradient(180deg, var(--bg) 0%, var(--bg-deep) 100%)' },
  main: { flex: 1, padding: '24px', overflowX: 'hidden', position: 'relative' },
  headerRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, flexWrap: 'wrap', gap: 12 },
  breadcrumb: { display: 'flex', alignItems: 'center', gap: 12 },
  title: { fontSize: 'clamp(22px, 5vw, 28px)', fontWeight: 'bold', color: 'var(--accent)', margin: 0 },
  sub: { color: 'var(--text-muted)', marginTop: 4, fontSize: 14 },
  backBtn: { padding: '6px 14px', backgroundColor: 'var(--bg-deep)', color: 'var(--accent)', border: '1px solid #A5D6A7', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: '500' },
  filtryRow: {
    display: 'flex', gap: 10, marginBottom: 20, alignItems: 'center',
    background: 'linear-gradient(145deg, var(--bg-card) 0%, var(--bg-card2) 100%)',
    padding: '12px 16px', borderRadius: 14, border: '1px solid var(--border2)',
    boxShadow: 'var(--shadow-sm)', flexWrap: 'wrap'
  },
  searchInput: { padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 13, minWidth: 200, flex: 1 },
  filtrInput: { padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 13, backgroundColor: 'var(--bg-card)' },
  clearBtn: { padding: '7px 14px', backgroundColor: 'rgba(255,127,169,0.14)', color: 'var(--danger)', border: '1px solid rgba(255,127,169,0.3)', borderRadius: 9, cursor: 'pointer', fontSize: 12 },
  countBadge: { fontSize: 12, color: 'var(--text-muted)', marginLeft: 'auto', whiteSpace: 'nowrap' },
  card: {
    background: 'linear-gradient(150deg, var(--bg-card) 0%, var(--bg-card2) 100%)',
    borderRadius: 18, padding: 20, border: '1px solid var(--border2)',
    boxShadow: 'var(--shadow-sm)', marginBottom: 16
  },
  cardTitle: { fontSize: 15, fontWeight: 'bold', color: 'var(--accent)', marginBottom: 16, paddingBottom: 10, borderBottom: '1px solid var(--border)' },
  twoCol: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16, marginBottom: 0 },
  tableScroll: { overflowX: 'auto' },
  table: { width: '100%', borderCollapse: 'collapse', minWidth: 700 },
  thCheck: { padding: '11px 8px', backgroundColor: 'var(--bg-deep)', width: 28 },
  th: { padding: '11px 14px', backgroundColor: 'var(--bg-deep)', color: 'var(--text)', textAlign: 'left', fontSize: 13, fontWeight: '600' },
  tdCheck: { padding: '11px 8px', borderBottom: '1px solid var(--border)' },
  td: { padding: '11px 14px', fontSize: 13, color: 'var(--text-sub)', borderBottom: '1px solid var(--border)' },
  idBadge: { backgroundColor: 'var(--bg-deep)', color: 'var(--accent)', padding: '2px 8px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 13, fontWeight: '600' },
  badge: { padding: '3px 10px', borderRadius: 20, color: '#fff', fontSize: 11, fontWeight: '600', display: 'inline-block' },
  akcjeRow: { display: 'flex', gap: 6 },
  btnSm: { padding: '5px 9px', backgroundColor: 'var(--bg-deep)', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13 },
  btnPrimary: { padding: '10px 20px', backgroundColor: 'var(--bg-deep)', color: '#fff', border: 'none', borderRadius: 10, cursor: 'pointer', fontSize: 14, fontWeight: '600' },
  btnSecondary: {
    padding: '8px 16px',
    backgroundColor: 'var(--bg-deep)',
    color: 'var(--accent)',
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: 'var(--border2)',
    borderRadius: 10,
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: '600',
  },
  btnGray: { padding: '10px 20px', backgroundColor: 'var(--bg-deep)', color: 'var(--text-sub)', border: '1px solid var(--border2)', borderRadius: 10, cursor: 'pointer', fontSize: 14 },
  btnDanger: { padding: '10px 20px', backgroundColor: 'var(--danger)', color: 'var(--on-accent)', border: 'none', borderRadius: 10, cursor: 'pointer', fontSize: 14, fontWeight: '600' },
  detailRow: { display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border)', gap: 12 },
  detailLabel: { fontSize: 13, color: 'var(--text-muted)', minWidth: 130 },
  detailValue: { fontSize: 13, color: 'var(--text)', fontWeight: '500', textAlign: 'right' },
  formGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 },
  fg: { display: 'flex', flexDirection: 'column', gap: 5 },
  label: { fontSize: 13, fontWeight: '600', color: 'var(--text-sub)' },
  input: { padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 13, backgroundColor: 'var(--bg-card)', outline: 'none' },
  komunikat: { padding: '12px 16px', borderRadius: 10, marginBottom: 16, fontSize: 14, fontWeight: '500' },
  bulkBar: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
    padding: '10px 12px',
    border: '1px solid var(--border)',
    borderRadius: 10,
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
    backgroundColor: 'var(--bg-card2)',
    borderRadius: 10,
    border: '1px solid var(--border2)',
    borderTop: '3px solid var(--accent)',
    padding: '10px 12px',
  },
  kpiTitle: {
    fontSize: 11,
    color: 'var(--text-muted)',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
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
    backgroundColor: 'var(--bg-card2)',
    border: '1px solid var(--border2)',
    borderRadius: 10,
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
    letterSpacing: 0.4,
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
    backgroundColor: 'var(--bg-card)',
    border: '1px solid var(--border2)',
    borderRadius: 12,
    minHeight: 220,
    display: 'flex',
    flexDirection: 'column',
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
    border: '1px solid var(--border2)',
    borderRadius: 10,
    backgroundColor: 'var(--bg-card2)',
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
    border: '1px solid var(--border)',
    borderRadius: 6,
    padding: '3px 8px',
    fontSize: 12,
    backgroundColor: 'var(--bg-card)',
    cursor: 'pointer',
  },
  kanbanValue: {
    fontSize: 12,
    color: 'var(--accent)',
    fontWeight: 700,
  },
  overlay: { position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modal: { backgroundColor: 'var(--bg-card)', borderRadius: 18, border: '1px solid var(--border2)', padding: 32, maxWidth: 420, width: '90%', textAlign: 'center', boxShadow: 'var(--shadow-lg)' },
  listCardsWrap: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  listCardsHeader: {
    background: 'linear-gradient(150deg, var(--bg-card) 0%, var(--bg-card2) 100%)',
    border: '1px solid var(--border2)',
    borderRadius: 12,
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
    gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))',
    gap: 12,
  },
  listTaskCard: {
    background: 'linear-gradient(150deg, var(--bg-card) 0%, var(--bg-card2) 100%)',
    border: '1px solid var(--border2)',
    borderRadius: 14,
    boxShadow: 'var(--shadow-sm)',
    padding: 12,
    display: 'flex',
    flexDirection: 'column',
    gap: 7,
    cursor: 'pointer',
  },
  listTaskTop: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  listTaskClient: { fontSize: 14, fontWeight: 700, color: 'var(--text)' },
  listTaskMeta: { fontSize: 12, color: 'var(--text-muted)' },
  listTaskChips: { display: 'flex', gap: 6, flexWrap: 'wrap' },
  listTaskFooter: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 },
  listTaskDate: { fontSize: 12, color: 'var(--text-sub)', fontWeight: 600 },
  listTaskValue: { fontSize: 13, color: 'var(--accent)', fontWeight: 800 },
};