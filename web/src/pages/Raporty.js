import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import AssessmentOutlined from '@mui/icons-material/AssessmentOutlined';
import AssignmentOutlined from '@mui/icons-material/AssignmentOutlined';
import AttachMoney from '@mui/icons-material/AttachMoney';
import BoltOutlined from '@mui/icons-material/BoltOutlined';
import BusinessOutlined from '@mui/icons-material/BusinessOutlined';
import CheckCircleOutline from '@mui/icons-material/CheckCircleOutline';
import CloseOutlined from '@mui/icons-material/CloseOutlined';
import ContentCutOutlined from '@mui/icons-material/ContentCutOutlined';
import DescriptionOutlined from '@mui/icons-material/DescriptionOutlined';
import ForestOutlined from '@mui/icons-material/ForestOutlined';
import GroupsOutlined from '@mui/icons-material/GroupsOutlined';
import HandymanOutlined from '@mui/icons-material/HandymanOutlined';
import Inventory2Outlined from '@mui/icons-material/Inventory2Outlined';
import LocalFloristOutlined from '@mui/icons-material/LocalFloristOutlined';
import SearchOutlined from '@mui/icons-material/SearchOutlined';
import TrackChangesOutlined from '@mui/icons-material/TrackChangesOutlined';
import LeaderboardOutlined from '@mui/icons-material/LeaderboardOutlined';
import api from '../api';
import PageHeader from '../components/PageHeader';
import Sidebar from '../components/Sidebar';
import TaskStatusIcon from '../components/TaskStatusIcon';
import { getLocalStorageJson } from '../utils/safeJsonLocalStorage';
import { getStoredToken, authHeaders } from '../utils/storedToken';

const SERVICE_TYPE_ROW = [
  { typ: 'Wycinka', Icon: ForestOutlined },
  { typ: 'Pielęgnacja', Icon: ContentCutOutlined },
  { typ: 'Ogrodnictwo', Icon: LocalFloristOutlined },
  { typ: 'Frezowanie pniaków', Icon: HandymanOutlined },
  { typ: 'Inne', Icon: Inventory2Outlined },
];

const UI_COLORS = {
  success: '#166534',
  warning: '#b45309',
  info: '#1d4ed8',
  danger: '#dc2626',
  muted: '#64748b',
};

function isTaskCancelled(z) {
  return z.status === 'Anulowane';
}

function isTaskDone(z) {
  return z.status === 'Zakonczone' || z.status === 'Zakończone';
}

function taskDayKey(z) {
  const raw = (z.data_wykonania || z.data_planowana || '').toString();
  const d = raw.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : '';
}

export default function Raporty() {
  const { t, i18n } = useTranslation();
  const [zlecenia, setZlecenia] = useState([]);
  const [oddzialy, setOddzialy] = useState([]);
  const [ekipy, setEkipy] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filtrOddzial, setFiltrOddzial] = useState('');
  const [filtrEkipa, setFiltrEkipa] = useState('');
  const [filtrMiesiac, setFiltrMiesiac] = useState(new Date().toISOString().slice(0, 7));
  const [filtrRok, setFiltrRok] = useState(new Date().getFullYear());
  const [activeTab, setActiveTab] = useState('podsumowanie');
  /** Okres agregacji w zakładce „Brygadziści”: miesiąc (jak filtry), cały rok, lub wszystkie wczytane dane */
  const [analizaOkres, setAnalizaOkres] = useState('miesiac');
  const [currentUser, setCurrentUser] = useState(null);
  const [oddzialCele, setOddzialCele] = useState([]);
  const [oddzialCeleDraft, setOddzialCeleDraft] = useState({});
  const [savingCeleKey, setSavingCeleKey] = useState('');
  const [ogledziny, setOgledziny] = useState([]);
  const [wyceny, setWyceny] = useState([]);
  const [oddzialSprzedaz, setOddzialSprzedaz] = useState([]);
  const [oddzialSprzedazDraft, setOddzialSprzedazDraft] = useState({});
  const [savingSprzedazKey, setSavingSprzedazKey] = useState('');
  const [callLogs, setCallLogs] = useState([]);
  const [callbackTasks, setCallbackTasks] = useState([]);
  const [newCallForm, setNewCallForm] = useState({ oddzial_id: '', phone: '', call_type: 'outbound', status: 'missed', duration_sec: '', lead_name: '', notes: '' });
  const [newCallbackForm, setNewCallbackForm] = useState({ oddzial_id: '', phone: '', lead_name: '', priority: 'normal', due_at: '', notes: '' });
  const navigate = useNavigate();
 
  // POPRAWKA: obliczane na poziomie komponentu, dostępne w JSX
  const isDyrektor = currentUser?.rola === 'Dyrektor' || currentUser?.rola === 'Administrator';
  const isKierownik = currentUser?.rola === 'Kierownik';
 
  // POPRAWKA: parsedUser przekazywany bezpośrednio do loadData
  useEffect(() => {
    const parsedUser = getLocalStorageJson('user');
    if (!parsedUser) { navigate('/'); return; }
    setCurrentUser(parsedUser);
    loadData(parsedUser);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
 
  // POPRAWKA: async + przyjmuje user jako parametr + wybiera właściwy endpoint
  const loadData = async (user) => {
    try {
      const token = getStoredToken();
      const h = authHeaders(token);
      const rola = user?.rola;
      const endpoint = (rola === 'Dyrektor' || rola === 'Administrator')
        ? `/tasks/wszystkie`
        : `/tasks`;
 
      const [zRes, oRes, eRes, oglRes, wycRes, callsRes, callbacksRes] = await Promise.all([
        api.get(endpoint, { headers: h }),
        api.get(`/oddzialy`, { headers: h }),
        api.get(`/ekipy`, { headers: h }),
        api.get(`/ogledziny`, { headers: h }),
        api.get(`/wyceny`, { headers: h }),
        api.get(`/telephony/calls`, { headers: h }),
        api.get(`/telephony/callbacks`, { headers: h }),
      ]);
      setZlecenia(zRes.data);
      setOddzialy(oRes.data);
      setEkipy(eRes.data);
      setOgledziny(Array.isArray(oglRes.data) ? oglRes.data : []);
      setWyceny(Array.isArray(wycRes.data) ? wycRes.data : []);
      setCallLogs(Array.isArray(callsRes.data) ? callsRes.data : []);
      setCallbackTasks(Array.isArray(callbacksRes.data) ? callbacksRes.data : []);
    } catch (err) {
      console.log('Błąd ładowania:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadCele = async (rok, miesiacIso) => {
    try {
      const token = getStoredToken();
      const h = authHeaders(token);
      const month = Number((miesiacIso || '').split('-')[1]) || 1;
      const { data } = await api.get(`/oddzialy/cele?rok=${rok}&miesiac=${month}`, { headers: h });
      const rows = Array.isArray(data) ? data : [];
      setOddzialCele(rows);
      const draft = {};
      rows.forEach((row) => {
        draft[row.oddzial_id] = {
          plan_zlecen: row.plan_zlecen ?? 0,
          plan_obrotu: row.plan_obrotu ?? 0,
          plan_marzy: row.plan_marzy ?? 0,
        };
      });
      setOddzialCeleDraft((prev) => ({ ...prev, ...draft }));
    } catch (err) {
      console.log('Błąd ładowania celów oddziałów:', err);
    }
  };

  const loadSprzedaz = async (rok, miesiacIso) => {
    try {
      const token = getStoredToken();
      const h = authHeaders(token);
      const month = Number((miesiacIso || '').split('-')[1]) || 1;
      const { data } = await api.get(`/oddzialy/sprzedaz?rok=${rok}&miesiac=${month}`, { headers: h });
      const rows = Array.isArray(data) ? data : [];
      setOddzialSprzedaz(rows);
      const draft = {};
      rows.forEach((row) => {
        draft[row.oddzial_id] = {
          calls_total: row.calls_total ?? 0,
          calls_answered: row.calls_answered ?? 0,
          calls_missed: row.calls_missed ?? 0,
          leads_new: row.leads_new ?? 0,
          meetings_booked: row.meetings_booked ?? 0,
        };
      });
      setOddzialSprzedazDraft((prev) => ({ ...prev, ...draft }));
    } catch (err) {
      console.log('Błąd ładowania sprzedaży oddziałów:', err);
    }
  };

  useEffect(() => {
    loadCele(filtrRok, filtrMiesiac);
    loadSprzedaz(filtrRok, filtrMiesiac);
  }, [filtrRok, filtrMiesiac]); // eslint-disable-line react-hooks/exhaustive-deps
 
  const filtrowane = zlecenia.filter(z => {
    if (filtrOddzial && z.oddzial_id?.toString() !== filtrOddzial) return false;
    if (filtrEkipa && z.ekipa_id?.toString() !== filtrEkipa) return false;
    if (filtrMiesiac && z.data_planowana) {
      const miesiac = z.data_planowana.split('T')[0].slice(0, 7);
      if (miesiac !== filtrMiesiac) return false;
    }
    if (filtrRok && z.data_planowana) {
      const rok = z.data_planowana.split('T')[0].slice(0, 4);
      if (rok !== filtrRok.toString()) return false;
    }
    return true;
  });
 
  const localeNum = i18n.language === 'uk' ? 'uk-UA' : i18n.language === 'ru' ? 'ru-RU' : 'pl-PL';
  const formatCurrency = useCallback((value) => {
    if (!value) return `0 PLN`;
    return parseFloat(value).toLocaleString(localeNum, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' PLN';
  }, [localeNum]);
 
  const sumaWartosc = filtrowane.reduce((s, z) => s + (parseFloat(z.wartosc_planowana) || 0), 0);
  const zakonczone = filtrowane.filter(z => z.status === 'Zakonczone');
  const wRealizacji = filtrowane.filter(z => z.status === 'W_Realizacji');
  const nowe = filtrowane.filter(z => z.status === 'Nowe');
  const zaplanowane = filtrowane.filter(z => z.status === 'Zaplanowane');
  const anulowane = filtrowane.filter(z => z.status === 'Anulowane');
  const skutecznosc = filtrowane.length > 0 ? ((zakonczone.length / filtrowane.length) * 100).toFixed(0) : 0;
 
  const statsByOddzial = oddzialy.map(o => {
    const zl = zlecenia.filter(z => z.oddzial_id === o.id);
    const zak = zl.filter(z => z.status === 'Zakonczone');
    const wartosc = zl.reduce((s, z) => s + (parseFloat(z.wartosc_planowana) || 0), 0);
    return { ...o, total: zl.length, zakonczone: zak.length, wartosc };
  });
 
  const statsByEkipa = ekipy.map(e => {
    const zl = zlecenia.filter(z => z.ekipa_id === e.id);
    const zak = zl.filter(z => z.status === 'Zakonczone');
    const wartosc = zl.reduce((s, z) => s + (parseFloat(z.wartosc_planowana) || 0), 0);
    return { ...e, total: zl.length, zakonczone: zak.length, wartosc };
  });
 
  const monthNames = useMemo(() => {
    const names = t('calendar.monthNames', { returnObjects: true });
    if (Array.isArray(names) && names.length === 12) return names;
    return ['Styczeń', 'Luty', 'Marzec', 'Kwiecień', 'Maj', 'Czerwiec', 'Lipiec', 'Sierpień', 'Wrzesień', 'Październik', 'Listopad', 'Grudzień'];
  }, [t]);

  const statystykiMiesieczne = useMemo(() => monthNames.map((nazwa, idx) => {
    const zl = zlecenia.filter(z => {
      if (!z.data_planowana) return false;
      const data = new Date(z.data_planowana);
      return data.getMonth() === idx && data.getFullYear() === parseInt(filtrRok, 10);
    });
    const wartosc = zl.reduce((s, z) => s + (parseFloat(z.wartosc_planowana) || 0), 0);
    return { nazwa, liczba: zl.length, wartosc };
  }), [monthNames, filtrRok, zlecenia]);
 
  const clearFilters = () => {
    setFiltrOddzial('');
    setFiltrEkipa('');
    setFiltrMiesiac(new Date().toISOString().slice(0, 7));
    setFiltrRok(new Date().getFullYear());
  };
 
  const getSkutecznoscColor = (value) => {
    if (value >= 70) return UI_COLORS.success;
    if (value >= 40) return UI_COLORS.warning;
    return UI_COLORS.danger;
  };
 
  const lata = [...new Set(zlecenia.map(z => z.data_planowana?.split('T')[0]?.slice(0, 4)).filter(Boolean))].sort((a,b)=>b-a);
 
  const ekipyFiltered = filtrOddzial
    ? ekipy.filter(e => e.oddzial_id === parseInt(filtrOddzial))
    : ekipy;

  const zleceniaDoAnalizyBryg = useMemo(() => {
    const matchesDate = (z) => {
      if (analizaOkres === 'caly') return true;
      const dp = (z.data_planowana || '').toString();
      if (!dp) return false;
      const y = dp.slice(0, 4);
      if (analizaOkres === 'rok') return y === String(filtrRok);
      const m = dp.slice(0, 7);
      return y === String(filtrRok) && m === filtrMiesiac;
    };
    return zlecenia.filter((z) => {
      if (z.typ === 'wycena') return false;
      if (!matchesDate(z)) return false;
      if (filtrOddzial && String(z.oddzial_id) !== String(filtrOddzial)) return false;
      if (filtrEkipa && String(z.ekipa_id || '') !== String(filtrEkipa)) return false;
      return true;
    });
  }, [zlecenia, analizaOkres, filtrRok, filtrMiesiac, filtrOddzial, filtrEkipa]);

  const rankingBrygadzistow = useMemo(() => {
    const teamById = new Map(ekipy.map((e) => [e.id, e]));
    const rowsMap = new Map();

    const bump = (key, label, kind) => {
      if (!rowsMap.has(key)) {
        rowsMap.set(key, {
          key,
          label,
          kind,
          oddzialy: new Set(),
          ekipyNazwy: new Set(),
          obrot: 0,
          zlecenia: 0,
          zakonczone: 0,
          dop: 0,
          bony: 0,
          dni: new Set(),
        });
      }
      return rowsMap.get(key);
    };

    for (const z of zleceniaDoAnalizyBryg) {
      if (isTaskCancelled(z)) continue;
      const tid = z.ekipa_id;
      if (!tid) {
        const r = bump('_nie_ekipa', 'Zlecenia bez ekipy', 'ghost');
        r.zlecenia += 1;
        r.dop += Number(z.dodatkowe_uslugi_liczba) || 0;
        r.bony += Number(z.bony_liczba) || 0;
        if (isTaskDone(z)) {
          r.obrot += parseFloat(z.wartosc_planowana) || 0;
          r.zakonczone += 1;
        }
        const dk = taskDayKey(z);
        if (dk) r.dni.add(dk);
        if (z.oddzial_id != null) {
          const on = oddzialy.find((o) => o.id === z.oddzial_id)?.nazwa;
          if (on) r.oddzialy.add(on);
        }
        continue;
      }
      const team = teamById.get(tid);
      if (team?.brygadzista_id) {
        const key = `u:${team.brygadzista_id}`;
        const label = [team.brygadzista_imie, team.brygadzista_nazwisko].filter(Boolean).join(' ').trim() || `Brygadzista #${team.brygadzista_id}`;
        const r = bump(key, label, 'leader');
        r.zlecenia += 1;
        r.dop += Number(z.dodatkowe_uslugi_liczba) || 0;
        r.bony += Number(z.bony_liczba) || 0;
        if (isTaskDone(z)) {
          r.obrot += parseFloat(z.wartosc_planowana) || 0;
          r.zakonczone += 1;
        }
        const dk = taskDayKey(z);
        if (dk) r.dni.add(dk);
        if (team.oddzial_id != null) {
          const on = oddzialy.find((o) => o.id === team.oddzial_id)?.nazwa;
          if (on) r.oddzialy.add(on);
        }
        if (team.nazwa) r.ekipyNazwy.add(team.nazwa);
      } else {
        const r = bump(`e:${tid}`, `${team?.nazwa || 'Ekipa'} — brak brygadzisty`, 'noLeader');
        r.zlecenia += 1;
        r.dop += Number(z.dodatkowe_uslugi_liczba) || 0;
        r.bony += Number(z.bony_liczba) || 0;
        if (isTaskDone(z)) {
          r.obrot += parseFloat(z.wartosc_planowana) || 0;
          r.zakonczone += 1;
        }
        const dk = taskDayKey(z);
        if (dk) r.dni.add(dk);
        if (team?.oddzial_id != null) {
          const on = oddzialy.find((o) => o.id === team.oddzial_id)?.nazwa;
          if (on) r.oddzialy.add(on);
        }
        if (team?.nazwa) r.ekipyNazwy.add(team.nazwa);
      }
    }

    const rows = Array.from(rowsMap.values()).map((r) => {
      const dniLiczba = r.dni.size;
      return {
        ...r,
        oddzialyArr: [...r.oddzialy].sort(),
        ekipyArr: [...r.ekipyNazwy].sort(),
        dniLiczba,
        sredniObrotNaDzien: dniLiczba > 0 ? r.obrot / dniLiczba : 0,
      };
    });
    rows.sort((a, b) => {
      const pri = (x) => (x.kind === 'leader' ? 0 : x.kind === 'noLeader' ? 1 : 2);
      const p = pri(a) - pri(b);
      if (p !== 0) return p;
      return b.obrot - a.obrot;
    });
    return rows;
  }, [zleceniaDoAnalizyBryg, ekipy, oddzialy]);

  const brygadzisciInsights = useMemo(() => {
    const leaders = rankingBrygadzistow.filter((r) => r.kind === 'leader');
    const ghost = rankingBrygadzistow.filter((r) => r.kind !== 'leader');
    const top = [...leaders].sort((a, b) => b.obrot - a.obrot).slice(0, 3);
    const alerts = [];
    for (const r of leaders) {
      if (r.zlecenia >= 25 && r.dop <= 3 && r.bony <= 5) {
        alerts.push(t('pages.raporty.brygadzisci.alertLowUpsell', { name: r.label, zlec: r.zlecenia, dop: r.dop, bony: r.bony }));
      }
      if (r.zlecenia >= 15 && r.bony === 0) {
        alerts.push(t('pages.raporty.brygadzisci.alertNoBony', { name: r.label, zlec: r.zlecenia }));
      }
    }
    const sumObrot = leaders.reduce((s, r) => s + r.obrot, 0);
    const ghostObrot = ghost.reduce((s, r) => s + r.obrot, 0);
    const systemic = [];
    if (ghostObrot > 0 && sumObrot > 0 && ghostObrot / (sumObrot + ghostObrot) >= 0.08) {
      systemic.push(t('pages.raporty.brygadzisci.systemicGhostTurnover', { value: formatCurrency(ghostObrot) }));
    }
    if (ghost.some((g) => g.zlecenia > 0)) {
      systemic.push(t('pages.raporty.brygadzisci.systemicUnassigned', { count: ghost.reduce((s, g) => s + g.zlecenia, 0) }));
    }
    const topWithDays = top.filter((r) => r.dniLiczba > 0);
    const avgTop =
      topWithDays.length > 0 ? topWithDays.reduce((s, r) => s + r.obrot / r.dniLiczba, 0) / topWithDays.length : 0;
    if (avgTop > 0 && leaders.length > 3) {
      const rest = leaders.filter((x) => !top.some((tp) => tp.key === x.key));
      const restWithDays = rest.filter((r) => r.dniLiczba > 0);
      const avgRest =
        restWithDays.length > 0 ? restWithDays.reduce((s, r) => s + r.obrot / r.dniLiczba, 0) / restWithDays.length : 0;
      if (avgRest > 0 && avgTop / avgRest >= 1.35) {
        systemic.push(t('pages.raporty.brygadzisci.systemicSpread', { top: formatCurrency(avgTop), rest: formatCurrency(avgRest) }));
      }
    }
    return { top, alerts, systemic };
  }, [rankingBrygadzistow, t, formatCurrency]);

  const celeMap = useMemo(() => {
    const map = {};
    oddzialCele.forEach((c) => { map[c.oddzial_id] = c; });
    return map;
  }, [oddzialCele]);

  const sprzedazMap = useMemo(() => {
    const map = {};
    oddzialSprzedaz.forEach((s) => { map[s.oddzial_id] = s; });
    return map;
  }, [oddzialSprzedaz]);

  const oddzialAnalytics = useMemo(() => {
    const [yy, mm] = (filtrMiesiac || '').split('-');
    const monthYear = Number(yy) || Number(filtrRok);
    const monthIndex = (Number(mm) || 1) - 1;
    const daysInMonth = new Date(monthYear, monthIndex + 1, 0).getDate();
    const today = new Date();
    const isCurrentMonth = today.getFullYear() === monthYear && today.getMonth() === monthIndex;
    const elapsedDays = isCurrentMonth ? Math.max(1, today.getDate()) : daysInMonth;
    const dayLabels = Array.from({ length: daysInMonth }, (_, i) => {
      const day = String(i + 1).padStart(2, '0');
      const mon = String(monthIndex + 1).padStart(2, '0');
      return `${day}.${mon}`;
    });

    const rows = oddzialy.map((o) => {
      const monthTasks = zlecenia.filter((z) => {
        if (z.oddzial_id !== o.id || !z.data_planowana) return false;
        const dt = new Date(z.data_planowana);
        return dt.getFullYear() === monthYear && dt.getMonth() === monthIndex;
      });
      const doneTasks = monthTasks.filter((z) => z.status === 'Zakonczone');
      const cel = celeMap[o.id];
      const revenuePlan = cel?.plan_obrotu ?? monthTasks.reduce((sum, z) => sum + (parseFloat(z.wartosc_planowana) || 0), 0);
      const revenueDone = doneTasks.reduce((sum, z) => sum + (parseFloat(z.wartosc_planowana) || 0), 0);

      const dailyDoneMap = Array.from({ length: daysInMonth }, (_, idx) => {
        const dayNum = idx + 1;
        return doneTasks.filter((z) => new Date(z.data_planowana).getDate() === dayNum).length;
      });

      const planMonth = cel?.plan_zlecen ?? monthTasks.length;
      const factMonth = doneTasks.length;
      const monthlyPct = planMonth > 0 ? (factMonth / planMonth) * 100 : 0;
      const dailyAvg = factMonth / elapsedDays;
      const revenuePct = revenuePlan > 0 ? (revenueDone / revenuePlan) * 100 : 0;

      return {
        oddzialId: o.id,
        oddzialNazwa: o.nazwa,
        planMonth,
        factMonth,
        monthlyPct,
        dailyAvg,
        revenuePlan,
        revenueDone,
        revenuePct,
        dailyDoneMap,
      };
    });

    return { dayLabels, rows };
  }, [oddzialy, zlecenia, filtrMiesiac, filtrRok, celeMap]);

  const setCelDraftField = (oddzialId, field, value) => {
    setOddzialCeleDraft((prev) => ({
      ...prev,
      [oddzialId]: {
        ...(prev[oddzialId] || { plan_zlecen: 0, plan_obrotu: 0, plan_marzy: 0 }),
        [field]: value,
      },
    }));
  };

  const zapiszCelOddzialu = async (oddzialId) => {
    try {
      const token = getStoredToken();
      const h = authHeaders(token);
      const month = Number((filtrMiesiac || '').split('-')[1]) || 1;
      const draft = oddzialCeleDraft[oddzialId] || {};
      setSavingCeleKey(`${oddzialId}`);
      await api.post('/oddzialy/cele', {
        oddzial_id: oddzialId,
        rok: filtrRok,
        miesiac: month,
        plan_zlecen: Number(draft.plan_zlecen || 0),
        plan_obrotu: Number(draft.plan_obrotu || 0),
        plan_marzy: Number(draft.plan_marzy || 0),
      }, { headers: h });
      await loadCele(filtrRok, filtrMiesiac);
    } catch (err) {
      console.log('Błąd zapisu celu oddziału:', err);
    } finally {
      setSavingCeleKey('');
    }
  };

  const setSprzedazDraftField = (oddzialId, field, value) => {
    setOddzialSprzedazDraft((prev) => ({
      ...prev,
      [oddzialId]: {
        ...(prev[oddzialId] || {
          calls_total: 0,
          calls_answered: 0,
          calls_missed: 0,
          leads_new: 0,
          meetings_booked: 0,
        }),
        [field]: value,
      },
    }));
  };

  const zapiszSprzedazOddzialu = async (oddzialId) => {
    try {
      const token = getStoredToken();
      const h = authHeaders(token);
      const month = Number((filtrMiesiac || '').split('-')[1]) || 1;
      const draft = oddzialSprzedazDraft[oddzialId] || {};
      setSavingSprzedazKey(`${oddzialId}`);
      await api.post('/oddzialy/sprzedaz', {
        oddzial_id: oddzialId,
        rok: filtrRok,
        miesiac: month,
        calls_total: Number(draft.calls_total || 0),
        calls_answered: Number(draft.calls_answered || 0),
        calls_missed: Number(draft.calls_missed || 0),
        leads_new: Number(draft.leads_new || 0),
        meetings_booked: Number(draft.meetings_booked || 0),
      }, { headers: h });
      await loadSprzedaz(filtrRok, filtrMiesiac);
    } catch (err) {
      console.log('Błąd zapisu danych sprzedaży oddziału:', err);
    } finally {
      setSavingSprzedazKey('');
    }
  };

  const odswiezTelephony = async () => {
    try {
      const token = getStoredToken();
      const h = authHeaders(token);
      const [callsRes, callbacksRes] = await Promise.all([
        api.get('/telephony/calls', { headers: h }),
        api.get('/telephony/callbacks', { headers: h }),
      ]);
      setCallLogs(Array.isArray(callsRes.data) ? callsRes.data : []);
      setCallbackTasks(Array.isArray(callbacksRes.data) ? callbacksRes.data : []);
    } catch (err) {
      console.log('Błąd odświeżenia telephony:', err);
    }
  };

  const dodajCallLog = async () => {
    try {
      const token = getStoredToken();
      const h = authHeaders(token);
      await api.post('/telephony/calls', {
        ...newCallForm,
        oddzial_id: Number(newCallForm.oddzial_id || 0),
        duration_sec: Number(newCallForm.duration_sec || 0),
      }, { headers: h });
      setNewCallForm({ oddzial_id: '', phone: '', call_type: 'outbound', status: 'missed', duration_sec: '', lead_name: '', notes: '' });
      await odswiezTelephony();
    } catch (err) {
      console.log('Błąd dodania call log:', err);
    }
  };

  const dodajCallback = async () => {
    try {
      const token = getStoredToken();
      const h = authHeaders(token);
      await api.post('/telephony/callbacks', {
        ...newCallbackForm,
        oddzial_id: Number(newCallbackForm.oddzial_id || 0),
      }, { headers: h });
      setNewCallbackForm({ oddzial_id: '', phone: '', lead_name: '', priority: 'normal', due_at: '', notes: '' });
      await odswiezTelephony();
    } catch (err) {
      console.log('Błąd dodania callback:', err);
    }
  };

  const zmienCallbackStatus = async (id, status) => {
    try {
      const token = getStoredToken();
      const h = authHeaders(token);
      await api.patch(`/telephony/callbacks/${id}/status`, { status }, { headers: h });
      await odswiezTelephony();
    } catch (err) {
      console.log('Błąd zmiany statusu callback:', err);
    }
  };

  const salesFunnelByOddzial = useMemo(() => {
    const [yy, mm] = (filtrMiesiac || '').split('-');
    const monthYear = Number(yy) || Number(filtrRok);
    const monthIndex = (Number(mm) || 1) - 1;
    const inMonth = (dateStr) => {
      if (!dateStr) return false;
      const dt = new Date(dateStr);
      return dt.getFullYear() === monthYear && dt.getMonth() === monthIndex;
    };
    return oddzialy.map((o) => {
      const sales = sprzedazMap[o.id] || {};
      const callsFromLogs = callLogs.filter((c) => Number(c.oddzial_id) === o.id && inMonth(c.created_at)).length;
      const calls = callsFromLogs || Number(sales.calls_total || 0);
      const leads = Number(sales.leads_new || 0);
      const ogl = ogledziny.filter((g) => Number(g.oddzial_id) === o.id && inMonth(g.data_planowana || g.created_at)).length;
      const wyc = wyceny.filter((w) => Number(w.oddzial_id) === o.id && inMonth(w.created_at)).length;
      const approved = wyceny.filter((w) => Number(w.oddzial_id) === o.id && w.status_akceptacji === 'zatwierdzono' && inMonth(w.zatwierdzone_at || w.created_at)).length;
      const tasksMonth = zlecenia.filter((z) => Number(z.oddzial_id) === o.id && z.typ !== 'wycena' && inMonth(z.data_planowana || z.created_at));
      const closed = tasksMonth.filter((z) => z.status === 'Zakonczone').length;
      const callbacksOpen = callbackTasks.filter((cb) => Number(cb.oddzial_id) === o.id && cb.status === 'open').length;
      return {
        oddzialId: o.id,
        oddzialNazwa: o.nazwa,
        calls,
        leads,
        ogl,
        wyc,
        approved,
        closed,
        callbacksOpen,
      };
    });
  }, [oddzialy, sprzedazMap, ogledziny, wyceny, zlecenia, callLogs, callbackTasks, filtrMiesiac, filtrRok]);

  const toPct = (from, to) => (Number(from) > 0 ? (Number(to) / Number(from)) * 100 : 0);
  const conversionColor = (pct) => {
    if (pct >= 70) return UI_COLORS.success;
    if (pct >= 40) return UI_COLORS.warning;
    return UI_COLORS.danger;
  };
  const findLeakStage = (row) => {
    const stages = [
      { key: 'Telefon->Lead', from: row.calls, to: row.leads },
      { key: 'Lead->Oględziny', from: row.leads, to: row.ogl },
      { key: 'Oględziny->Wycena', from: row.ogl, to: row.wyc },
      { key: 'Wycena->Zatwierdzenie', from: row.wyc, to: row.approved },
      { key: 'Zatwierdzenie->Zamknięcie', from: row.approved, to: row.closed },
    ];
    let min = { key: 'Brak danych', pct: 100 };
    stages.forEach((s) => {
      if (Number(s.from) <= 0) return;
      const pct = toPct(s.from, s.to);
      if (pct < min.pct) min = { key: s.key, pct };
    });
    return min;
  };
 
  return (
    <div style={styles.container}>
      <Sidebar />
      <div style={styles.main}>
        <PageHeader
          variant="plain"
          title={t('pages.raporty.title')}
          subtitle={t('pages.raporty.subtitle')}
          icon={<AssessmentOutlined style={{ fontSize: 26 }} />}
        />
 
        {/* Filtry */}
        <div style={styles.filtryRow}>
          <div style={styles.filtrGroup}>
            <label style={styles.filtrLabel}>{t('common.year')}:</label>
            <select style={styles.filtrInput} value={filtrRok} onChange={e => setFiltrRok(parseInt(e.target.value))}>
              {lata.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div style={styles.filtrGroup}>
            <label style={styles.filtrLabel}>{t('common.month')}:</label>
            <input style={styles.filtrInput} type="month" value={filtrMiesiac} onChange={e => setFiltrMiesiac(e.target.value)} />
          </div>
          {(isDyrektor || isKierownik) && (
            <div style={styles.filtrGroup}>
              <label style={styles.filtrLabel}>{t('common.branch')}:</label>
              <select style={styles.filtrInput} value={filtrOddzial} onChange={e => setFiltrOddzial(e.target.value)}>
                <option value="">{t('common.allBranches')}</option>
                {oddzialy.map(o => <option key={o.id} value={o.id}>{o.nazwa}</option>)}
              </select>
            </div>
          )}
          <div style={styles.filtrGroup}>
            <label style={styles.filtrLabel}>{t('common.team')}:</label>
            <select style={styles.filtrInput} value={filtrEkipa} onChange={e => setFiltrEkipa(e.target.value)}>
              <option value="">{t('common.allTeams')}</option>
              {ekipyFiltered.map(e => <option key={e.id} value={e.id}>{e.nazwa}</option>)}
            </select>
          </div>
          {(filtrOddzial || filtrEkipa || (filtrMiesiac !== new Date().toISOString().slice(0, 7)) || filtrRok !== new Date().getFullYear()) && (
            <button type="button" style={styles.clearBtn} onClick={clearFilters}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <CloseOutlined sx={{ fontSize: 16 }} />
                {t('common.clearFilters')}
              </span>
            </button>
          )}
        </div>
 
        {/* KPI */}
        <div style={styles.kpiRow}>
          <div style={{ ...styles.kpi, borderTopColor: 'var(--accent)' }}>
            <div style={styles.kpiIcon}><AssignmentOutlined sx={{ fontSize: 26, color: 'var(--accent)' }} /></div>
            <div style={styles.kpiNum}>{filtrowane.length}</div>
            <div style={styles.kpiLabel}>{t('pages.raporty.kpiAllTasks')}</div>
          </div>
          <div style={{ ...styles.kpi, borderTopColor: UI_COLORS.success }}>
            <div style={styles.kpiIcon}><CheckCircleOutline sx={{ fontSize: 26, color: UI_COLORS.success }} /></div>
            <div style={styles.kpiNum}>{zakonczone.length}</div>
            <div style={styles.kpiLabel}>{t('pages.raporty.kpiDone')}</div>
          </div>
          <div style={{ ...styles.kpi, borderTopColor: UI_COLORS.warning }}>
            <div style={styles.kpiIcon}><BoltOutlined sx={{ fontSize: 26, color: UI_COLORS.warning }} /></div>
            <div style={styles.kpiNum}>{wRealizacji.length}</div>
            <div style={styles.kpiLabel}>{t('pages.raporty.kpiInProgress')}</div>
          </div>
          <div style={{ ...styles.kpi, borderTopColor: UI_COLORS.info }}>
            <div style={styles.kpiIcon}><DescriptionOutlined sx={{ fontSize: 26, color: UI_COLORS.info }} /></div>
            <div style={styles.kpiNum}>{nowe.length}</div>
            <div style={styles.kpiLabel}>{t('pages.raporty.kpiNew')}</div>
          </div>
          <div style={{ ...styles.kpi, borderTopColor: 'var(--accent-dk)' }}>
            <div style={styles.kpiIcon}><AttachMoney sx={{ fontSize: 26, color: 'var(--accent-dk)' }} /></div>
            <div style={styles.kpiNum}>{formatCurrency(sumaWartosc)}</div>
            <div style={styles.kpiLabel}>{t('pages.raporty.kpiTotalValue')}</div>
          </div>
          <div style={{ ...styles.kpi, borderTopColor: getSkutecznoscColor(skutecznosc) }}>
            <div style={styles.kpiIcon}><TrackChangesOutlined sx={{ fontSize: 26, color: getSkutecznoscColor(skutecznosc) }} /></div>
            <div style={{ ...styles.kpiNum, color: getSkutecznoscColor(skutecznosc) }}>
              {skutecznosc}%
            </div>
            <div style={styles.kpiLabel}>{t('pages.raporty.kpiEffectiveness')}</div>
          </div>
        </div>
 
        {/* Tabs */}
        <div style={styles.tabs}>
          <button type="button" style={{...styles.tab, ...(activeTab === 'podsumowanie' ? styles.tabActive : {})}} onClick={() => setActiveTab('podsumowanie')}>
            {t('pages.raporty.tabSummary')}
          </button>
          <button type="button" style={{...styles.tab, ...(activeTab === 'oddzialy' ? styles.tabActive : {})}} onClick={() => setActiveTab('oddzialy')}>
            {t('pages.raporty.tabByBranch')}
          </button>
          <button type="button" style={{...styles.tab, ...(activeTab === 'ekipy' ? styles.tabActive : {})}} onClick={() => setActiveTab('ekipy')}>
            {t('pages.raporty.tabByTeam')}
          </button>
          <button type="button" style={{...styles.tab, ...(activeTab === 'brygadzisci' ? styles.tabActive : {})}} onClick={() => setActiveTab('brygadzisci')}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <LeaderboardOutlined sx={{ fontSize: 18 }} />
              {t('pages.raporty.tabBrygadzisci')}
            </span>
          </button>
          <button type="button" style={{...styles.tab, ...(activeTab === 'miesiace' ? styles.tabActive : {})}} onClick={() => setActiveTab('miesiace')}>
            {t('pages.raporty.tabMonthly')}
          </button>
          <button type="button" style={{...styles.tab, ...(activeTab === 'sprzedaz' ? styles.tabActive : {})}} onClick={() => setActiveTab('sprzedaz')}>
            Lejek sprzedaży
          </button>
          <button type="button" style={{...styles.tab, ...(activeTab === 'zlecenia' ? styles.tabActive : {})}} onClick={() => setActiveTab('zlecenia')}>
            {t('pages.raporty.tabList')}
          </button>
        </div>
 
        {/* TAB: Podsumowanie */}
        {activeTab === 'podsumowanie' && (
          <div style={styles.twoCol}>
            <div style={styles.card}>
              <div style={styles.cardTitle}>{t('pages.raporty.cardStatusTitle')}</div>
              {[
                { key: 'Zakonczone', label: t('taskStatus.Zakonczone'), count: zakonczone.length, color: 'var(--accent)' },
                { key: 'W_Realizacji', label: t('taskStatus.W_Realizacji'), count: wRealizacji.length, color: UI_COLORS.warning },
                { key: 'Nowe', label: t('taskStatus.Nowe'), count: nowe.length, color: UI_COLORS.info },
                { key: 'Zaplanowane', label: t('taskStatus.Zaplanowane'), count: zaplanowane.length, color: UI_COLORS.muted },
                { key: 'Anulowane', label: t('taskStatus.Anulowane'), count: anulowane.length, color: UI_COLORS.danger },
              ].map(s => (
                <div key={s.key} style={styles.statusRow}>
                  <div style={styles.statusInfo}>
                    <span style={styles.statusIcon}><TaskStatusIcon status={s.key} size={18} /></span>
                    <span style={styles.statusLabel}>{s.label}</span>
                  </div>
                  <div style={styles.statusRight}>
                    <div style={styles.statusBar}>
                      <div style={{...styles.statusBarFill, width: filtrowane.length > 0 ? `${(s.count / filtrowane.length) * 100}%` : '0%', backgroundColor: s.color}} />
                    </div>
                    <span style={styles.statusCount}>{s.count}</span>
                    <span style={styles.statusPercent}>{filtrowane.length > 0 ? `${Math.round((s.count / filtrowane.length) * 100)}%` : '0%'}</span>
                  </div>
                </div>
              ))}
            </div>
 
            <div style={styles.card}>
              <div style={styles.cardTitle}>{t('pages.raporty.cardTypesTitle')}</div>
              {SERVICE_TYPE_ROW.map((item) => {
                const count = filtrowane.filter(z => z.typ_uslugi === item.typ).length;
                const wartosc = filtrowane.filter(z => z.typ_uslugi === item.typ).reduce((s, z) => s + (parseFloat(z.wartosc_planowana) || 0), 0);
                if (count === 0 && wartosc === 0) return null;
                const TypeIcon = item.Icon;
                return (
                  <div key={item.typ} style={styles.typRow}>
                    <div style={styles.typLabel}>
                      <span style={styles.typIcon}><TypeIcon sx={{ fontSize: 18, color: 'var(--accent)' }} /></span>
                      {t(`serviceType.${item.typ}`, { defaultValue: item.typ })}
                    </div>
                    <div style={styles.typRight}>
                      <span style={styles.typCount}>{t('pages.raporty.typeOrdersCount', { count })}</span>
                      <span style={styles.typWartosc}>{formatCurrency(wartosc)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
 
        {/* TAB: Per oddział */}
        {activeTab === 'oddzialy' && (
          <div style={styles.card}>
            <div style={styles.cardTitle}>{t('pages.raporty.branchResultsTitle')}</div>
            <div style={styles.reportCardsGrid}>
              {statsByOddzial.map((o) => {
                const skut = o.total > 0 ? Math.round((o.zakonczone / o.total) * 100) : 0;
                return (
                  <div
                    key={o.id}
                    style={styles.reportMetricCard}
                    onClick={() => { setFiltrOddzial(o.id.toString()); setActiveTab('zlecenia'); }}
                  >
                    <div style={styles.reportTaskTop}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontWeight: 700, color: 'var(--text)' }}>
                        <BusinessOutlined sx={{ fontSize: 18, color: 'var(--accent)', flexShrink: 0 }} />
                        {o.nazwa}
                      </span>
                      <button type="button" style={styles.viewBtn} aria-label={t('common.details')}>
                        <SearchOutlined sx={{ fontSize: 18, color: 'var(--text-sub)' }} />
                      </button>
                    </div>
                    <div style={styles.reportTaskMeta}>
                      <span style={styles.reportMetaLabel}>{t('pages.raporty.thTasks')}</span>
                      <span style={styles.reportMetaValue}>{o.total}</span>
                    </div>
                    <div style={styles.reportTaskMeta}>
                      <span style={styles.reportMetaLabel}>{t('pages.raporty.thDone')}</span>
                      <span style={styles.reportMetaValue}>{o.zakonczone}</span>
                    </div>
                    <div style={styles.reportTaskMeta}>
                      <span style={styles.reportMetaLabel}>{t('pages.raporty.thEffectiveness')}</span>
                      <span style={{ ...styles.badge, backgroundColor: getSkutecznoscColor(skut) }}>{skut}%</span>
                    </div>
                    <div style={styles.reportTaskFooter}>
                      <span style={styles.reportMetaLabel}>{t('pages.raporty.thValue')}</span>
                      <span style={styles.reportValue}>{formatCurrency(o.wartosc)}</span>
                    </div>
                  </div>
                );
              })}
            </div>

            <div style={styles.analyticsTitleRow}>
              <span style={styles.analyticsTitle}>Analityka oddziałów (miesięczna)</span>
              <span style={styles.analyticsSubTitle}>Plan/Fakt + dzienny rozkład wykonanych zleceń</span>
            </div>
            <div style={styles.analyticsScroll}>
              <table style={styles.analyticsTable}>
                <thead>
                  <tr>
                    <th style={styles.analyticsThSticky}>Oddział</th>
                    <th style={styles.analyticsTh}>Plan / miesiąc</th>
                    <th style={styles.analyticsTh}>Fakt / miesiąc</th>
                    <th style={styles.analyticsTh}>Miesięcznie</th>
                    <th style={styles.analyticsTh}>Śr. dziennie</th>
                    <th style={styles.analyticsTh}>Obrót plan</th>
                    <th style={styles.analyticsTh}>Obrót fakt</th>
                    <th style={styles.analyticsTh}>Realizacja obrotu</th>
                    {oddzialAnalytics.dayLabels.map((day) => (
                      <th key={day} style={styles.analyticsThDay}>{day}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {oddzialAnalytics.rows.map((row) => (
                    <tr key={row.oddzialId}>
                      <td style={styles.analyticsTdSticky}>{row.oddzialNazwa}</td>
                      <td style={styles.analyticsTd}>{row.planMonth}</td>
                      <td style={styles.analyticsTd}>{row.factMonth}</td>
                      <td style={styles.analyticsTd}>
                        <span style={{ ...styles.badge, backgroundColor: getSkutecznoscColor(Math.round(row.monthlyPct)) }}>
                          {row.monthlyPct.toFixed(1)}%
                        </span>
                      </td>
                      <td style={styles.analyticsTd}>{row.dailyAvg.toFixed(2)}</td>
                      <td style={styles.analyticsTd}>{formatCurrency(row.revenuePlan)}</td>
                      <td style={styles.analyticsTd}>{formatCurrency(row.revenueDone)}</td>
                      <td style={styles.analyticsTd}>
                        <span style={{ ...styles.badge, backgroundColor: getSkutecznoscColor(Math.round(row.revenuePct)) }}>
                          {row.revenuePct.toFixed(1)}%
                        </span>
                      </td>
                      {row.dailyDoneMap.map((val, idx) => (
                        <td key={`${row.oddzialId}-${idx}`} style={styles.analyticsTdDay}>
                          {val}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {(isDyrektor || isKierownik) && (
              <>
                <div style={styles.analyticsTitleRow}>
                  <span style={styles.analyticsTitle}>Cele miesięczne oddziałów</span>
                  <span style={styles.analyticsSubTitle}>Wpisz plan raz, raport liczy wykonanie automatycznie</span>
                </div>
                <div style={styles.analyticsGoalsGrid}>
                  {oddzialy.map((o) => {
                    const draft = oddzialCeleDraft[o.id] || { plan_zlecen: 0, plan_obrotu: 0, plan_marzy: 0 };
                    const busy = savingCeleKey === `${o.id}`;
                    return (
                      <div key={`goal-${o.id}`} style={styles.goalCard}>
                        <div style={styles.goalTitle}>{o.nazwa}</div>
                        <div style={styles.goalFields}>
                          <input
                            style={styles.goalInput}
                            type="number"
                            min="0"
                            value={draft.plan_zlecen}
                            onChange={(e) => setCelDraftField(o.id, 'plan_zlecen', e.target.value)}
                            placeholder="Plan zleceń"
                          />
                          <input
                            style={styles.goalInput}
                            type="number"
                            min="0"
                            step="100"
                            value={draft.plan_obrotu}
                            onChange={(e) => setCelDraftField(o.id, 'plan_obrotu', e.target.value)}
                            placeholder="Plan obrotu (PLN)"
                          />
                          <input
                            style={styles.goalInput}
                            type="number"
                            min="0"
                            step="100"
                            value={draft.plan_marzy}
                            onChange={(e) => setCelDraftField(o.id, 'plan_marzy', e.target.value)}
                            placeholder="Plan marży (PLN)"
                          />
                        </div>
                        <button
                          type="button"
                          style={styles.goalSaveBtn}
                          onClick={() => zapiszCelOddzialu(o.id)}
                          disabled={busy}
                        >
                          {busy ? 'Zapisywanie...' : 'Zapisz cele'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        )}
 
        {/* TAB: Per ekipa */}
        {activeTab === 'ekipy' && (
          <div style={styles.card}>
            <div style={styles.cardTitle}>{t('pages.raporty.teamResultsTitle')}</div>
            <div style={styles.reportCardsGrid}>
              {statsByEkipa.filter(e => e.total > 0).map((e) => {
                const skut = e.total > 0 ? Math.round((e.zakonczone / e.total) * 100) : 0;
                return (
                  <div
                    key={e.id}
                    style={styles.reportMetricCard}
                    onClick={() => { setFiltrEkipa(e.id.toString()); setActiveTab('zlecenia'); }}
                  >
                    <div style={styles.reportTaskTop}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontWeight: 700, color: 'var(--text)' }}>
                        <GroupsOutlined sx={{ fontSize: 18, color: 'var(--accent)', flexShrink: 0 }} />
                        {e.nazwa}
                      </span>
                      <span style={styles.reportMetaValue}>{e.oddzial_nazwa || '-'}</span>
                    </div>
                    <div style={styles.reportTaskMeta}>
                      <span style={styles.reportMetaLabel}>{t('pages.raporty.thTasks')}</span>
                      <span style={styles.reportMetaValue}>{e.total}</span>
                    </div>
                    <div style={styles.reportTaskMeta}>
                      <span style={styles.reportMetaLabel}>{t('pages.raporty.thDone')}</span>
                      <span style={styles.reportMetaValue}>{e.zakonczone}</span>
                    </div>
                    <div style={styles.reportTaskMeta}>
                      <span style={styles.reportMetaLabel}>{t('pages.raporty.thEffectiveness')}</span>
                      <span style={{ ...styles.badge, backgroundColor: getSkutecznoscColor(skut) }}>{skut}%</span>
                    </div>
                    <div style={styles.reportTaskFooter}>
                      <span style={styles.reportMetaLabel}>{t('pages.raporty.thValue')}</span>
                      <span style={styles.reportValue}>{formatCurrency(e.wartosc)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {activeTab === 'brygadzisci' && (
          <div style={styles.card}>
            <div style={styles.cardTitle}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
                <LeaderboardOutlined sx={{ fontSize: 22, color: 'var(--accent)' }} />
                {t('pages.raporty.brygadzisci.title')}
              </span>
            </div>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: -8, marginBottom: 16, lineHeight: 1.5 }}>
              {t('pages.raporty.brygadzisci.hint')}
            </p>
            <div style={{ ...styles.filtryRow, marginBottom: 16 }}>
              <div style={styles.filtrGroup}>
                <label style={styles.filtrLabel}>{t('pages.raporty.brygadzisci.period')}</label>
                <select style={styles.filtrInput} value={analizaOkres} onChange={(e) => setAnalizaOkres(e.target.value)}>
                  <option value="miesiac">{t('pages.raporty.brygadzisci.periodMonth')}</option>
                  <option value="rok">{t('pages.raporty.brygadzisci.periodYear')}</option>
                  <option value="caly">{t('pages.raporty.brygadzisci.periodAll')}</option>
                </select>
              </div>
            </div>
            {rankingBrygadzistow.length === 0 ? (
              <div style={styles.empty}>
                <p>{t('pages.raporty.brygadzisci.emptyRanking')}</p>
              </div>
            ) : (
              <div style={styles.tableScroll}>
                <table style={{ ...styles.table, minWidth: 920 }}>
                  <thead>
                    <tr>
                      <th style={styles.th}>{t('pages.raporty.brygadzisci.thRank')}</th>
                      <th style={styles.th}>{t('pages.raporty.brygadzisci.thLeader')}</th>
                      <th style={styles.th}>{t('pages.raporty.brygadzisci.thBranches')}</th>
                      <th style={{ ...styles.th, textAlign: 'right' }}>{t('pages.raporty.brygadzisci.thTurnover')}</th>
                      <th style={{ ...styles.th, textAlign: 'right' }}>{t('pages.raporty.brygadzisci.thOrders')}</th>
                      <th style={{ ...styles.th, textAlign: 'right' }}>{t('pages.raporty.brygadzisci.thDone')}</th>
                      <th style={{ ...styles.th, textAlign: 'right' }}>{t('pages.raporty.brygadzisci.thUpsell')}</th>
                      <th style={{ ...styles.th, textAlign: 'right' }}>{t('pages.raporty.brygadzisci.thBony')}</th>
                      <th style={{ ...styles.th, textAlign: 'right' }}>{t('pages.raporty.brygadzisci.thDays')}</th>
                      <th style={{ ...styles.th, textAlign: 'right' }}>{t('pages.raporty.brygadzisci.thAvgDay')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rankingBrygadzistow.map((r, idx) => (
                      <tr key={r.key}>
                        <td style={styles.td}>{idx + 1}</td>
                        <td style={{ ...styles.td, fontWeight: 700, color: 'var(--text)' }}>{r.label}</td>
                        <td style={styles.td}>{r.oddzialyArr.length ? r.oddzialyArr.join(', ') : '—'}</td>
                        <td style={{ ...styles.td, textAlign: 'right', fontWeight: 700, color: 'var(--accent)' }}>{formatCurrency(r.obrot)}</td>
                        <td style={{ ...styles.td, textAlign: 'right' }}>{r.zlecenia.toLocaleString(localeNum)}</td>
                        <td style={{ ...styles.td, textAlign: 'right' }}>{r.zakonczone.toLocaleString(localeNum)}</td>
                        <td style={{ ...styles.td, textAlign: 'right' }}>{r.dop.toLocaleString(localeNum)}</td>
                        <td style={{ ...styles.td, textAlign: 'right' }}>{r.bony.toLocaleString(localeNum)}</td>
                        <td style={{ ...styles.td, textAlign: 'right' }}>{r.dniLiczba.toLocaleString(localeNum)}</td>
                        <td style={{ ...styles.td, textAlign: 'right', color: 'var(--text-sub)' }}>
                          {r.dniLiczba > 0 ? formatCurrency(r.sredniObrotNaDzien) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div style={{ ...styles.twoCol, marginTop: 24 }}>
              <div style={{ ...styles.card, marginBottom: 0, padding: 16 }}>
                <div style={{ ...styles.cardTitle, marginBottom: 12, fontSize: 14 }}>{t('pages.raporty.brygadzisci.leadersTitle')}</div>
                {brygadzisciInsights.top.length === 0 ? (
                  <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>—</p>
                ) : (
                  <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--text-sub)', fontSize: 13, lineHeight: 1.55 }}>
                    {brygadzisciInsights.top.map((r, idx) => (
                      <li key={r.key}>
                        {t('pages.raporty.brygadzisci.leaderLine', {
                          rank: idx + 1,
                          name: r.label,
                          obrot: formatCurrency(r.obrot),
                          zlec: r.zlecenia,
                        })}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div style={{ ...styles.card, marginBottom: 0, padding: 16 }}>
                <div style={{ ...styles.cardTitle, marginBottom: 12, fontSize: 14 }}>{t('pages.raporty.brygadzisci.insightsTitle')}</div>
                {brygadzisciInsights.alerts.length > 0 && (
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: UI_COLORS.warning, marginBottom: 6 }}>{t('pages.raporty.brygadzisci.alertsTitle')}</div>
                    <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--text-sub)', fontSize: 13, lineHeight: 1.55 }}>
                      {brygadzisciInsights.alerts.map((line, i) => (
                        <li key={`a-${i}`}>{line}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {brygadzisciInsights.systemic.length > 0 && (
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>{t('pages.raporty.brygadzisci.systemicTitle')}</div>
                    <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--text-sub)', fontSize: 13, lineHeight: 1.55 }}>
                      {brygadzisciInsights.systemic.map((line, i) => (
                        <li key={`s-${i}`}>{line}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {brygadzisciInsights.alerts.length === 0 && brygadzisciInsights.systemic.length === 0 && (
                  <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('pages.raporty.brygadzisci.noAutoInsights')}</p>
                )}
              </div>
            </div>
          </div>
        )}
 
        {/* TAB: Miesięczne */}
        {activeTab === 'miesiace' && (
          <div style={styles.card}>
            <div style={styles.cardTitle}>{t('pages.raporty.monthlyTitle', { year: filtrRok })}</div>
            <div style={styles.reportCardsGrid}>
              {statystykiMiesieczne.map((m, i) => {
                const maxVal = Math.max(...statystykiMiesieczne.map((x) => x.wartosc), 1);
                const width = Math.max(6, Math.round((m.wartosc / maxVal) * 100));
                return (
                  <div key={i} style={styles.reportMetricCard}>
                    <div style={styles.reportTaskTop}>
                      <span style={styles.reportTaskClient}>{m.nazwa}</span>
                      <span style={styles.reportMetaValue}>{m.liczba} {t('pages.raporty.thTaskCount').toLowerCase()}</span>
                    </div>
                    <div style={styles.monthBarTrack}>
                      <div style={{ ...styles.monthBarFill, width: `${width}%` }} />
                    </div>
                    <div style={styles.reportTaskMeta}>
                      <span style={styles.reportMetaLabel}>{t('pages.raporty.thValue')}</span>
                      <span style={styles.reportValue}>{formatCurrency(m.wartosc)}</span>
                    </div>
                    <div style={styles.reportTaskMeta}>
                      <span style={styles.reportMetaLabel}>{t('pages.raporty.thAvgValue')}</span>
                      <span style={styles.reportMetaValue}>{m.liczba > 0 ? formatCurrency(m.wartosc / m.liczba) : '0 PLN'}</span>
                    </div>
                  </div>
                );
              })}
              <div style={{ ...styles.reportMetricCard, borderColor: 'var(--accent)' }}>
                <div style={{ ...styles.reportTaskClient, marginBottom: 4 }}>{t('pages.raporty.footerSum')}</div>
                <div style={styles.reportTaskMeta}>
                  <span style={styles.reportMetaLabel}>{t('pages.raporty.thTaskCount')}</span>
                  <span style={styles.reportMetaValue}>{statystykiMiesieczne.reduce((s, m) => s + m.liczba, 0)}</span>
                </div>
                <div style={styles.reportTaskMeta}>
                  <span style={styles.reportMetaLabel}>{t('pages.raporty.thValue')}</span>
                  <span style={styles.reportValue}>
                    {formatCurrency(statystykiMiesieczne.reduce((s, m) => s + m.wartosc, 0))}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'sprzedaz' && (
          <div style={styles.card}>
            <div style={styles.cardTitle}>Lejek sprzedaży (oddziały)</div>
            <div style={styles.reportCardsGrid}>
              {salesFunnelByOddzial.map((row) => (
                <div key={`funnel-${row.oddzialId}`} style={styles.reportMetricCard}>
                  <div style={styles.reportTaskTop}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontWeight: 700, color: 'var(--text)' }}>
                      <BusinessOutlined sx={{ fontSize: 18, color: 'var(--accent)', flexShrink: 0 }} />
                      {row.oddzialNazwa}
                    </span>
                  </div>
                  {[
                    ['Telefonów', row.calls],
                    ['Nowe leady', row.leads],
                    ['Oględziny', row.ogl],
                    ['Wyceny', row.wyc],
                    ['Zatwierdzone wyceny', row.approved],
                    ['Zamknięte zlecenia', row.closed],
                    ['Open callbacks', row.callbacksOpen],
                  ].map(([label, value]) => (
                    <div key={`${row.oddzialId}-${label}`} style={styles.reportTaskMeta}>
                      <span style={styles.reportMetaLabel}>{label}</span>
                      <span style={styles.reportMetaValue}>{value}</span>
                    </div>
                  ))}
                  <div style={styles.funnelDivider} />
                  {[
                    ['Telefon→Lead', toPct(row.calls, row.leads)],
                    ['Lead→Oględziny', toPct(row.leads, row.ogl)],
                    ['Oględziny→Wycena', toPct(row.ogl, row.wyc)],
                    ['Wycena→Zatwierdzona', toPct(row.wyc, row.approved)],
                    ['Zatwierdzona→Zamknięta', toPct(row.approved, row.closed)],
                  ].map(([label, pct]) => (
                    <div key={`${row.oddzialId}-conv-${label}`} style={styles.reportTaskMeta}>
                      <span style={styles.reportMetaLabel}>{label}</span>
                      <span style={{ ...styles.badge, backgroundColor: conversionColor(pct), fontSize: 10 }}>
                        {pct.toFixed(1)}%
                      </span>
                    </div>
                  ))}
                  <div style={styles.funnelLeakRow}>
                    <span style={styles.reportMetaLabel}>Największy przeciek</span>
                    <span style={{ ...styles.badge, backgroundColor: conversionColor(findLeakStage(row).pct), fontSize: 10 }}>
                      {findLeakStage(row).key} ({findLeakStage(row).pct.toFixed(1)}%)
                    </span>
                  </div>
                </div>
              ))}
            </div>

            {(isDyrektor || isKierownik) && (
              <>
                <div style={styles.analyticsTitleRow}>
                  <span style={styles.analyticsTitle}>Dane wejściowe działu sprzedaży</span>
                  <span style={styles.analyticsSubTitle}>Telefony i leady wpisujesz raz na miesiąc dla oddziału</span>
                </div>
                <div style={styles.analyticsGoalsGrid}>
                  {oddzialy.map((o) => {
                    const draft = oddzialSprzedazDraft[o.id] || {
                      calls_total: 0,
                      calls_answered: 0,
                      calls_missed: 0,
                      leads_new: 0,
                      meetings_booked: 0,
                    };
                    const busy = savingSprzedazKey === `${o.id}`;
                    return (
                      <div key={`sales-${o.id}`} style={styles.goalCard}>
                        <div style={styles.goalTitle}>{o.nazwa}</div>
                        <div style={styles.goalFields}>
                          <input style={styles.goalInput} type="number" min="0" value={draft.calls_total} onChange={(e) => setSprzedazDraftField(o.id, 'calls_total', e.target.value)} placeholder="Liczba telefonów" />
                          <input style={styles.goalInput} type="number" min="0" value={draft.calls_answered} onChange={(e) => setSprzedazDraftField(o.id, 'calls_answered', e.target.value)} placeholder="Telefony odebrane" />
                          <input style={styles.goalInput} type="number" min="0" value={draft.calls_missed} onChange={(e) => setSprzedazDraftField(o.id, 'calls_missed', e.target.value)} placeholder="Telefony nieodebrane" />
                          <input style={styles.goalInput} type="number" min="0" value={draft.leads_new} onChange={(e) => setSprzedazDraftField(o.id, 'leads_new', e.target.value)} placeholder="Nowe leady" />
                          <input style={styles.goalInput} type="number" min="0" value={draft.meetings_booked} onChange={(e) => setSprzedazDraftField(o.id, 'meetings_booked', e.target.value)} placeholder="Umówione spotkania" />
                        </div>
                        <button type="button" style={styles.goalSaveBtn} onClick={() => zapiszSprzedazOddzialu(o.id)} disabled={busy}>
                          {busy ? 'Zapisywanie...' : 'Zapisz dane sprzedaży'}
                        </button>
                      </div>
                    );
                  })}
                </div>

                <div style={styles.analyticsTitleRow}>
                  <span style={styles.analyticsTitle}>Call Center — szybkie logowanie i oddzwanianie</span>
                  <span style={styles.analyticsSubTitle}>Dodaj połączenie i kolejkę callback bez wychodzenia z raportu</span>
                </div>
                <div style={styles.telephonyGrid}>
                  <div style={styles.goalCard}>
                    <div style={styles.goalTitle}>Nowy log połączenia</div>
                    <div style={styles.goalFields}>
                      <select style={styles.goalInput} value={newCallForm.oddzial_id} onChange={(e) => setNewCallForm((p) => ({ ...p, oddzial_id: e.target.value }))}>
                        <option value="">Wybierz oddział</option>
                        {oddzialy.map((o) => <option key={`call-o-${o.id}`} value={o.id}>{o.nazwa}</option>)}
                      </select>
                      <input style={styles.goalInput} value={newCallForm.phone} onChange={(e) => setNewCallForm((p) => ({ ...p, phone: e.target.value }))} placeholder="Telefon (+48...)" />
                      <select style={styles.goalInput} value={newCallForm.call_type} onChange={(e) => setNewCallForm((p) => ({ ...p, call_type: e.target.value }))}>
                        <option value="outbound">Outbound</option>
                        <option value="inbound">Inbound</option>
                      </select>
                      <select style={styles.goalInput} value={newCallForm.status} onChange={(e) => setNewCallForm((p) => ({ ...p, status: e.target.value }))}>
                        <option value="answered">Odebrane</option>
                        <option value="missed">Nieodebrane</option>
                        <option value="no_answer">Brak odpowiedzi</option>
                        <option value="busy">Zajęty</option>
                      </select>
                      <input style={styles.goalInput} type="number" min="0" value={newCallForm.duration_sec} onChange={(e) => setNewCallForm((p) => ({ ...p, duration_sec: e.target.value }))} placeholder="Czas rozmowy (sek)" />
                      <input style={styles.goalInput} value={newCallForm.lead_name} onChange={(e) => setNewCallForm((p) => ({ ...p, lead_name: e.target.value }))} placeholder="Lead / klient" />
                    </div>
                    <button type="button" style={styles.goalSaveBtn} onClick={dodajCallLog}>Zapisz połączenie</button>
                  </div>

                  <div style={styles.goalCard}>
                    <div style={styles.goalTitle}>Nowy callback (oddzwanianie)</div>
                    <div style={styles.goalFields}>
                      <select style={styles.goalInput} value={newCallbackForm.oddzial_id} onChange={(e) => setNewCallbackForm((p) => ({ ...p, oddzial_id: e.target.value }))}>
                        <option value="">Wybierz oddział</option>
                        {oddzialy.map((o) => <option key={`cb-o-${o.id}`} value={o.id}>{o.nazwa}</option>)}
                      </select>
                      <input style={styles.goalInput} value={newCallbackForm.phone} onChange={(e) => setNewCallbackForm((p) => ({ ...p, phone: e.target.value }))} placeholder="Telefon (+48...)" />
                      <input style={styles.goalInput} value={newCallbackForm.lead_name} onChange={(e) => setNewCallbackForm((p) => ({ ...p, lead_name: e.target.value }))} placeholder="Lead / klient" />
                      <select style={styles.goalInput} value={newCallbackForm.priority} onChange={(e) => setNewCallbackForm((p) => ({ ...p, priority: e.target.value }))}>
                        <option value="low">Niski</option>
                        <option value="normal">Normalny</option>
                        <option value="high">Wysoki</option>
                      </select>
                      <input style={styles.goalInput} type="datetime-local" value={newCallbackForm.due_at} onChange={(e) => setNewCallbackForm((p) => ({ ...p, due_at: e.target.value }))} />
                    </div>
                    <button type="button" style={styles.goalSaveBtn} onClick={dodajCallback}>Dodaj do callback queue</button>
                  </div>
                </div>

                <div style={styles.analyticsTitleRow}>
                  <span style={styles.analyticsTitle}>Otwarte oddzwaniania</span>
                  <span style={styles.analyticsSubTitle}>Pracuj po liście i zamykaj pozycje po kontakcie</span>
                </div>
                <div style={styles.reportCardsGrid}>
                  {callbackTasks.filter((cb) => cb.status === 'open').length === 0 ? (
                    <div style={styles.reportMetricCard}>
                      <div style={styles.reportMetaValue}>Brak otwartych callbacków 🎉</div>
                    </div>
                  ) : callbackTasks.filter((cb) => cb.status === 'open').map((cb) => (
                    <div key={`cb-${cb.id}`} style={styles.reportMetricCard}>
                      <div style={styles.reportTaskTop}>
                        <span style={styles.reportTaskClient}>{cb.lead_name || 'Lead'}</span>
                        <span style={{ ...styles.badge, backgroundColor: cb.priority === 'high' ? UI_COLORS.danger : cb.priority === 'normal' ? UI_COLORS.warning : UI_COLORS.info }}>
                          {cb.priority}
                        </span>
                      </div>
                      <div style={styles.reportTaskMeta}><span style={styles.reportMetaLabel}>Telefon</span><span style={styles.reportMetaValue}>{cb.phone}</span></div>
                      <div style={styles.reportTaskMeta}><span style={styles.reportMetaLabel}>Oddział</span><span style={styles.reportMetaValue}>{oddzialy.find((o) => o.id === cb.oddzial_id)?.nazwa || '-'}</span></div>
                      <div style={styles.reportTaskMeta}><span style={styles.reportMetaLabel}>Termin</span><span style={styles.reportMetaValue}>{cb.due_at ? new Date(cb.due_at).toLocaleString(localeNum) : 'ASAP'}</span></div>
                      <div style={styles.btnRowInline}>
                        <button type="button" style={styles.smallActionBtn} onClick={() => zmienCallbackStatus(cb.id, 'done')}>Oznacz jako DONE</button>
                        <button type="button" style={{ ...styles.smallActionBtn, borderColor: 'rgba(248,113,113,0.35)', color: 'var(--danger)' }} onClick={() => zmienCallbackStatus(cb.id, 'cancelled')}>Anuluj</button>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
 
        {/* TAB: Lista zleceń */}
        {activeTab === 'zlecenia' && (
          <div style={styles.card}>
            <div style={styles.cardTitle}>
              {t('pages.raporty.listTitle', { count: filtrowane.length })}
              {filtrowane.length > 0 && <span style={styles.sumWartosc}>{t('pages.raporty.listTotalValue', { value: formatCurrency(sumaWartosc) })}</span>}
            </div>
            {loading ? (
              <div style={styles.loading}>{t('pages.raporty.loadingTasks')}</div>
            ) : filtrowane.length === 0 ? (
              <div style={styles.empty}>
                <div style={styles.emptyIcon}>
                  <DescriptionOutlined sx={{ fontSize: 48, opacity: 0.45, color: 'var(--text-muted)' }} />
                </div>
                <p>{t('pages.raporty.emptyList')}</p>
              </div>
            ) : (
              <div style={styles.reportCardsGrid}>
                {filtrowane.map((z) => (
                  <div
                    key={z.id}
                    style={styles.reportTaskCard}
                    onClick={() => navigate(`/zlecenia/${z.id}`)}
                  >
                    <div style={styles.reportTaskTop}>
                      <span style={styles.idBadge}>#{z.id}</span>
                      <span style={{ ...styles.badge, backgroundColor: getStatusColor(z.status), display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <TaskStatusIcon status={z.status} size={15} color="#fff" />
                        {t(`taskStatus.${z.status}`, { defaultValue: z.status })}
                      </span>
                    </div>
                    <div style={styles.reportTaskClient}>{z.klient_nazwa}</div>
                    <div style={styles.reportTaskMeta}>
                      <span style={styles.reportMetaLabel}>{t('pages.raporty.thBranch')}</span>
                      <span style={styles.reportMetaValue}>{z.oddzial_nazwa || '-'}</span>
                    </div>
                    <div style={styles.reportTaskMeta}>
                      <span style={styles.reportMetaLabel}>{t('pages.raporty.thTeam')}</span>
                      <span style={styles.reportMetaValue}>{z.ekipa_nazwa || t('common.missing')}</span>
                    </div>
                    <div style={styles.reportTaskFooter}>
                      <span style={styles.reportDate}>{formatDate(z.data_planowana)}</span>
                      <span style={styles.reportValue}>{formatCurrency(z.wartosc_planowana)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
 
function formatDate(d) {
  if (!d) return '-';
  return d.split('T')[0];
}
 
function getStatusColor(status) {
  switch (status) {
    case 'Zakonczone': return UI_COLORS.success;
    case 'W_Realizacji': return UI_COLORS.warning;
    case 'Nowe': return UI_COLORS.info;
    case 'Zaplanowane': return UI_COLORS.muted;
    case 'Anulowane': return UI_COLORS.danger;
    default: return UI_COLORS.muted;
  }
}
 
const styles = {
  container: { display: 'flex', minHeight: '100vh', backgroundColor: 'var(--bg)' },
  main: { flex: 1, padding: '24px', overflowX: 'hidden' },
  filtryRow: { display: 'flex', gap: 12, marginBottom: 20, alignItems: 'center', backgroundColor: 'var(--bg-card)', padding: '12px 20px', borderRadius: 12, boxShadow: 'var(--shadow-sm)', flexWrap: 'wrap' },
  filtrGroup: { display: 'flex', alignItems: 'center', gap: 8 },
  filtrLabel: { fontSize: 13, fontWeight: '600', color: 'var(--text-sub)' },
  filtrInput: { padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 13, backgroundColor: 'var(--bg-card)' },
  clearBtn: { padding: '7px 14px', backgroundColor: 'rgba(248,113,113,0.1)', color: 'var(--danger)', border: '1px solid rgba(248,113,113,0.35)', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: '500' },
  kpiRow: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 20 },
  kpi: { backgroundColor: 'var(--bg-card)', borderRadius: 12, padding: '14px 16px', boxShadow: 'var(--shadow-sm)', borderTopWidth: 3, borderTopStyle: 'solid', textAlign: 'center' },
  kpiIcon: { display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  kpiNum: { fontSize: 'clamp(18px, 4vw, 22px)', fontWeight: 'bold', color: 'var(--text)' },
  kpiLabel: { fontSize: 11, color: 'var(--text-muted)', marginTop: 4 },
  tabs: { display: 'flex', gap: 4, marginBottom: 20, borderBottom: '2px solid var(--border)', flexWrap: 'wrap' },
  tab: { padding: '10px 20px', border: 'none', backgroundColor: 'transparent', cursor: 'pointer', fontSize: 14, fontWeight: '500', color: 'var(--text-muted)', borderBottom: '2px solid transparent', marginBottom: -2, transition: 'all 0.2s' },
  tabActive: { color: 'var(--accent)', borderBottom: '2px solid var(--accent)' },
  twoCol: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 20 },
  card: { backgroundColor: 'var(--bg-card)', borderRadius: 16, padding: 20, boxShadow: 'var(--shadow-sm)', marginBottom: 20 },
  cardTitle: { fontSize: 16, fontWeight: 'bold', color: 'var(--accent)', marginBottom: 16, paddingBottom: 10, borderBottom: '1px solid var(--border)' },
  sumWartosc: { fontSize: 13, fontWeight: 'normal', color: 'var(--text-muted)', marginLeft: 8 },
  statusRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border)' },
  statusInfo: { display: 'flex', alignItems: 'center', gap: 8 },
  statusIcon: { display: 'inline-flex', alignItems: 'center', flexShrink: 0 },
  statusLabel: { fontSize: 14, color: 'var(--text-sub)' },
  statusRight: { display: 'flex', alignItems: 'center', gap: 12 },
  statusBar: { width: 120, height: 8, backgroundColor: 'var(--bg-deep)', borderRadius: 4, overflow: 'hidden' },
  statusBarFill: { height: '100%', borderRadius: 4, transition: 'width 0.3s' },
  statusCount: { fontSize: 14, fontWeight: 'bold', color: 'var(--text)', minWidth: 24, textAlign: 'right' },
  statusPercent: { fontSize: 12, color: 'var(--text-muted)', minWidth: 40 },
  typRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--border)' },
  typLabel: { fontSize: 14, color: 'var(--text-sub)', fontWeight: '500', display: 'flex', alignItems: 'center', gap: 8 },
  typIcon: { display: 'inline-flex', alignItems: 'center', flexShrink: 0 },
  typRight: { display: 'flex', gap: 16, alignItems: 'center' },
  typCount: { fontSize: 13, color: 'var(--text-muted)' },
  typWartosc: { fontSize: 13, fontWeight: '600', color: 'var(--accent)' },
  tableScroll: { overflowX: 'auto' },
  table: { width: '100%', borderCollapse: 'collapse', minWidth: 600 },
  th: { padding: '12px 14px', backgroundColor: 'var(--bg-deep)', color: '#fff', textAlign: 'left', fontSize: 13, fontWeight: '600' },
  td: { padding: '11px 14px', fontSize: 13, color: 'var(--text-sub)', borderBottom: '1px solid var(--border)' },
  badge: { padding: '3px 10px', borderRadius: 20, color: '#fff', fontSize: 11, fontWeight: '600', display: 'inline-block' },
  idBadge: { backgroundColor: 'var(--bg-deep)', color: 'var(--accent)', padding: '2px 8px', borderRadius: 6, fontSize: 13, fontWeight: '600' },
  gray: { color: 'var(--text-muted)', fontStyle: 'italic' },
  viewBtn: { padding: '6px 10px', backgroundColor: 'var(--bg-deep)', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' },
  loading: { textAlign: 'center', padding: 40, color: 'var(--text-muted)' },
  empty: { textAlign: 'center', padding: 60, color: 'var(--text-muted)' },
  emptyIcon: { marginBottom: 12, display: 'flex', justifyContent: 'center' },
  reportCardsGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))', gap: 12 },
  reportTaskCard: {
    background: 'linear-gradient(150deg, var(--bg-card) 0%, var(--bg-card2) 100%)',
    border: '1px solid var(--border2)',
    borderRadius: 14,
    boxShadow: 'var(--shadow-sm)',
    padding: 12,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    cursor: 'pointer',
  },
  reportMetricCard: {
    background: 'linear-gradient(150deg, var(--bg-card) 0%, var(--bg-card2) 100%)',
    border: '1px solid var(--border2)',
    borderRadius: 14,
    boxShadow: 'var(--shadow-sm)',
    padding: 12,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    cursor: 'pointer',
  },
  reportTaskTop: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  reportTaskClient: { fontSize: 14, fontWeight: 700, color: 'var(--text)' },
  reportTaskMeta: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 },
  reportMetaLabel: { fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em', fontWeight: 700 },
  reportMetaValue: { fontSize: 12, color: 'var(--text-sub)', textAlign: 'right', fontWeight: 600 },
  reportTaskFooter: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 },
  funnelDivider: { borderTop: '1px solid var(--border)', marginTop: 2, paddingTop: 2 },
  funnelLeakRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginTop: 2 },
  reportDate: { fontSize: 12, color: 'var(--text-sub)', fontWeight: 600 },
  reportValue: { fontSize: 13, color: 'var(--accent)', fontWeight: 800 },
  monthBarTrack: { width: '100%', height: 8, backgroundColor: 'var(--bg-deep)', borderRadius: 999, overflow: 'hidden' },
  monthBarFill: { height: '100%', borderRadius: 999, background: 'linear-gradient(90deg, var(--accent-dk), var(--accent))' },
  analyticsTitleRow: { marginTop: 20, display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' },
  analyticsTitle: { fontSize: 14, fontWeight: 800, color: 'var(--text)' },
  analyticsSubTitle: { fontSize: 12, color: 'var(--text-muted)' },
  analyticsScroll: { marginTop: 10, overflowX: 'auto', border: '1px solid var(--border2)', borderRadius: 12 },
  analyticsTable: { width: '100%', borderCollapse: 'collapse', minWidth: 1450, backgroundColor: 'var(--bg-card)' },
  analyticsTh: { padding: '10px 10px', backgroundColor: 'var(--bg-deep)', color: 'var(--text-sub)', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap', borderBottom: '1px solid var(--border)' },
  analyticsThSticky: { position: 'sticky', left: 0, zIndex: 3, padding: '10px 12px', backgroundColor: 'var(--bg-card2)', color: 'var(--text)', fontSize: 12, fontWeight: 800, whiteSpace: 'nowrap', borderBottom: '1px solid var(--border)' },
  analyticsThDay: { padding: '10px 8px', backgroundColor: 'var(--bg-deep)', color: 'var(--text-muted)', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap', borderBottom: '1px solid var(--border)', textAlign: 'center' },
  analyticsTd: { padding: '8px 10px', color: 'var(--text-sub)', fontSize: 12, borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' },
  analyticsTdSticky: { position: 'sticky', left: 0, zIndex: 2, padding: '8px 12px', color: 'var(--text)', backgroundColor: 'var(--bg-card)', fontSize: 12, fontWeight: 700, borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' },
  analyticsTdDay: { padding: '8px 6px', color: 'var(--text-sub)', fontSize: 12, borderBottom: '1px solid var(--border)', textAlign: 'center' },
  analyticsGoalsGrid: { marginTop: 10, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 10 },
  goalCard: { background: 'linear-gradient(150deg, var(--bg-card) 0%, var(--bg-card2) 100%)', border: '1px solid var(--border2)', borderRadius: 12, padding: 10, boxShadow: 'var(--shadow-sm)' },
  goalTitle: { fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 8 },
  goalFields: { display: 'grid', gap: 8 },
  goalInput: { padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 12, backgroundColor: 'var(--bg-card)', color: 'var(--text)' },
  goalSaveBtn: { marginTop: 8, padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border2)', backgroundColor: 'var(--accent)', color: 'var(--on-accent)', fontSize: 12, fontWeight: 700, cursor: 'pointer' },
  telephonyGrid: { marginTop: 10, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 10 },
  btnRowInline: { display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' },
  smallActionBtn: { padding: '6px 8px', borderRadius: 8, border: '1px solid var(--logo-tint-border)', backgroundColor: 'var(--bg-card)', color: 'var(--accent-dk)', fontSize: 11, fontWeight: 700, cursor: 'pointer' },
};
 