import { useEffect, useState, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Sidebar from '../components/Sidebar';
import CityInput from '../components/CityInput';
import api from '../api';
import { getApiErrorMessage } from '../utils/apiError';
import { getLocalStorageJson } from '../utils/safeJsonLocalStorage';

const STATUSY = ['Zaplanowane', 'W_Trakcie', 'Zakonczone', 'Anulowane'];
const UI_COLORS = {
  info: '#1d4ed8',
  warning: '#b45309',
  success: '#166534',
  danger: '#dc2626',
  muted: 'var(--text-muted)',
};

const STATUS_COLOR = {
  Zaplanowane: UI_COLORS.info,
  W_Trakcie:   UI_COLORS.warning,
  Zakonczone:  'var(--accent)',
  Anulowane:   UI_COLORS.danger,
};

const STATUS_LABEL = {
  Zaplanowane: 'Zaplanowane',
  W_Trakcie:  'W trakcie',
  Zakonczone:  'Zakończone',
  Anulowane:   'Anulowane',
};

const ZONE_ORDER = ['Krakow-POLNOC', 'Krakow-WSCHOD', 'Krakow-POŁUDNIE', 'Krakow-ZACHOD'];
const ZONE_LABEL = {
  'Krakow-POLNOC': 'Kraków - Północ',
  'Krakow-WSCHOD': 'Kraków - Wschód',
  'Krakow-POŁUDNIE': 'Kraków - Południe',
  'Krakow-ZACHOD': 'Kraków - Zachód',
  'Krakow-NIEJEDNOZNACZNA': 'Kraków - Niejednoznaczna',
  'POZA-KRAKOWEM': 'Poza Krakowem',
};
const ZONE_COLOR = {
  'Krakow-POLNOC': '#60A5FA',
  'Krakow-WSCHOD': '#38bdf8',
  'Krakow-POŁUDNIE': '#34D399',
  'Krakow-ZACHOD': '#F59E0B',
  'Krakow-NIEJEDNOZNACZNA': '#F87171',
  'POZA-KRAKOWEM': '#94A3B8',
};

const ZONE_RULES = {
  'Krakow-POLNOC': [
    'pradnik bialy', 'prądnik biały', 'pradnik czerwony', 'prądnik czerwony', 'bronowice',
    'krowodrza', 'wzgorza krzeslawickie', 'wzgórza krzesławickie',
  ],
  'Krakow-WSCHOD': [
    'nowa huta', 'czyzyny', 'czyżyny', 'bienczyce', 'bieńczyce', 'mistrzejowice',
    'grzegorzki', 'grzegórzki',
  ],
  'Krakow-POŁUDNIE': [
    'podgorze', 'podgórze', 'swoszowice', 'lagniki', 'łagiewniki', 'dębniki', 'debniki',
    'borek fałęcki', 'borek falecki', 'prokocim', 'biezanow', 'bieżanów',
  ],
  'Krakow-ZACHOD': [
    'zwierzyniec', 'salwator', 'olszanica', 'wola justowska', 'ruczaj', 'tyniec',
  ],
};

function normalizeText(v) {
  return String(v || '').trim().toLowerCase();
}

function toDateSafe(v) {
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function detectKrakowZone(item) {
  const city = normalizeText(item.miasto);
  const address = normalizeText(item.adres);
  const blob = `${city} ${address}`;
  const isKrakow = city.includes('krakow') || city.includes('kraków') || address.includes('krakow') || address.includes('kraków');
  if (!isKrakow) return 'POZA-KRAKOWEM';

  const matches = [];
  for (const [zone, keys] of Object.entries(ZONE_RULES)) {
    if (keys.some((k) => blob.includes(k))) matches.push(zone);
  }
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) return 'Krakow-NIEJEDNOZNACZNA';

  const postal = blob.match(/\b3[0-9]-[0-9]{3}\b/);
  if (postal) {
    const p = postal[0];
    if (['30-', '31-'].some((x) => p.startsWith(x))) return 'Krakow-ZACHOD';
    if (['32-'].some((x) => p.startsWith(x))) return 'Krakow-POŁUDNIE';
  }

  return 'Krakow-NIEJEDNOZNACZNA';
}

function zoneRank(zone) {
  const idx = ZONE_ORDER.indexOf(zone);
  return idx === -1 ? 99 : idx;
}

function compareRoute(a, b) {
  const da = toDateSafe(a.data_planowana);
  const db = toDateSafe(b.data_planowana);
  if (da && db && da.getTime() !== db.getTime()) return da.getTime() - db.getTime();
  if (da && !db) return -1;
  if (!da && db) return 1;
  const cityCmp = normalizeText(a.miasto).localeCompare(normalizeText(b.miasto), 'pl');
  if (cityCmp !== 0) return cityCmp;
  return normalizeText(a.adres).localeCompare(normalizeText(b.adres), 'pl');
}

function buildGoogleMapsMultiStop(addresses) {
  const clean = addresses.map((a) => String(a || '').trim()).filter(Boolean);
  if (clean.length === 0) return null;
  if (clean.length === 1) return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(clean[0])}`;
  const origin = clean[0];
  const destination = clean[clean.length - 1];
  const waypoints = clean.slice(1, -1);
  const waypointParam = waypoints.length ? `&waypoints=${encodeURIComponent(waypoints.join('|'))}` : '';
  return `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}${waypointParam}&travelmode=driving`;
}

function buildGoogleMapsNavigationUrl(origin, destination) {
  if (!destination) return null;
  const dest = encodeURIComponent(destination);
  if (!origin) return `https://www.google.com/maps/search/?api=1&query=${dest}`;
  return `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${dest}&travelmode=driving`;
}

function computeDelayRisk({ item, live, etaMinutes }) {
  const plannedMs = item?.data_planowana ? new Date(item.data_planowana).getTime() : null;
  const minutesToPlanned = plannedMs ? Math.round((plannedMs - Date.now()) / 60000) : null;
  const gpsAgeMin = live?.recorded_at ? Math.round((Date.now() - new Date(live.recorded_at).getTime()) / 60000) : null;
  let score = 0;
  if (minutesToPlanned != null) {
    if (minutesToPlanned < 0) score += 5;
    else if (minutesToPlanned < 30) score += 4;
    else if (minutesToPlanned < 60) score += 3;
    else if (minutesToPlanned < 120) score += 1;
  }
  if (etaMinutes != null && minutesToPlanned != null) {
    const slack = minutesToPlanned - etaMinutes;
    if (slack < 0) score += 5;
    else if (slack < 15) score += 3;
    else if (slack < 30) score += 1;
  }
  if (gpsAgeMin != null) {
    if (gpsAgeMin > 30) score += 4;
    else if (gpsAgeMin > 15) score += 2;
  }
  if (!live) score += 2;
  const level = score >= 8 ? 'high' : score >= 4 ? 'medium' : 'low';
  return { score, level };
}

function getAssignmentLabel(item, live) {
  if (live?.ekipa_nazwa) return live.ekipa_nazwa;
  if (item?.brygadzista_nazwa) return item.brygadzista_nazwa;
  if (item?.wyceniajacy_nazwa) return item.wyceniajacy_nazwa;
  if (item?.wyceniajacy_id) return `Wyceniający #${item.wyceniajacy_id}`;
  if (item?.ekipa_id) return `Ekipa #${item.ekipa_id}`;
  return 'Nieprzypisane';
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function computeEtaMinutes(live, inspection) {
  const lat = Number(inspection?.lat);
  const lon = Number(inspection?.lon);
  const lLat = Number(live?.lat);
  const lLon = Number(live?.lng);
  if (![lat, lon, lLat, lLon].every(Number.isFinite)) return null;
  const km = haversineKm(lLat, lLon, lat, lon);
  const speed = Number.isFinite(Number(live?.speed_kmh)) && Number(live.speed_kmh) > 5 ? Number(live.speed_kmh) : 32;
  return Math.round((km / speed) * 60);
}

export default function Ogledziny() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [lista, setLista] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState('');
  const [filterDate, setFilterDate] = useState('');
  const [routeMode, setRouteMode] = useState(false);
  const [zoneMode, setZoneMode] = useState(false);
  const [zoneFilter, setZoneFilter] = useState('');
  const [showZoneDictionary, setShowZoneDictionary] = useState(false);
  const [zoneImportError, setZoneImportError] = useState('');
  const [zoneOverrides, setZoneOverrides] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('ogledziny_zone_overrides') || '{}');
    } catch {
      return {};
    }
  });
  const [clientZoneDefaults, setClientZoneDefaults] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('ogledziny_client_zone_defaults') || '{}');
    } catch {
      return {};
    }
  });
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [liveLocationsByTeam, setLiveLocationsByTeam] = useState({});
  const [liveLocationsByEstimator, setLiveLocationsByEstimator] = useState({});
  const [teamFilter, setTeamFilter] = useState('');
  const [dispatchMode, setDispatchMode] = useState(false);

  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [klienciList, setKlienciList] = useState([]);
  const [brygadList, setBrygadList] = useState([]);

  const [form, setForm] = useState({
    klient_id: searchParams.get('klient') || '',
    brygadzista_id: '',
    data_planowana: '',
    adres: '',
    miasto: '',
    notatki: '',
  });

  const [showStatusModal, setShowStatusModal] = useState(false);
  const [newStatus, setNewStatus] = useState('');
  const [statusNotatki, setStatusNotatki] = useState('');
  const [statusSaving, setStatusSaving] = useState(false);

  const currentUser = getLocalStorageJson('user', {});
  const canManage = ['Dyrektor', 'Administrator', 'Kierownik'].includes(currentUser.rola);
  const canPlan = canManage || currentUser.rola === 'Specjalista';

  const loadLista = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (filterStatus) params.status = filterStatus;
      const res = await api.get('/ogledziny', { params });
      setLista(res.data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [filterStatus]);

  const loadLiveLocations = useCallback(async (refresh = false) => {
    try {
      const res = await api.get('/ekipy/live-locations', { params: refresh ? { refresh: 1 } : {} });
      const items = Array.isArray(res.data?.items) ? res.data.items : [];
      const map = {};
      const estimatorMap = {};
      for (const item of items) {
        if (item.ekipa_id == null) continue;
        map[item.ekipa_id] = item;
        if (item.wyceniajacy_id != null) estimatorMap[item.wyceniajacy_id] = item;
      }
      for (const item of items) {
        if (item.wyceniajacy_id == null) continue;
        if (!estimatorMap[item.wyceniajacy_id]) estimatorMap[item.wyceniajacy_id] = item;
      }
      setLiveLocationsByTeam(map);
      setLiveLocationsByEstimator(estimatorMap);
    } catch (e) {
      console.error('Błąd live-locations', e);
    }
  }, []);

  useEffect(() => { loadLista(); }, [loadLista]);
  useEffect(() => {
    loadLiveLocations(true);
    const timer = setInterval(() => { loadLiveLocations(false); }, 60000);
    return () => clearInterval(timer);
  }, [loadLiveLocations]);

  // Otwórz od razu formularz jeśli ?klient= w URL
  useEffect(() => {
    if (searchParams.get('klient')) {
      loadSelectData();
      setShowForm(true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadSelectData = async () => {
    try {
      const [kRes, bRes] = await Promise.all([
        api.get('/klienci'),
        api.get('/uzytkownicy?rola=Brygadzista').catch(() => api.get('/uzytkownicy')),
      ]);
      setKlienciList(kRes.data);
      const workers = bRes.data.filter(u => u.rola === 'Brygadzista' || u.rola === 'Kierownik' || u.rola === 'Administrator');
      setBrygadList(workers);
    } catch (e) {
      console.error(e);
    }
  };

  const openForm = async () => {
    await loadSelectData();
    setForm({ klient_id: '', brygadzista_id: '', data_planowana: '', adres: '', miasto: '', notatki: '' });
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.klient_id) { alert('Wybierz klienta'); return; }
    setSaving(true);
    try {
      await api.post('/ogledziny', {
        ...form,
        klient_id: Number(form.klient_id),
        brygadzista_id: form.brygadzista_id ? Number(form.brygadzista_id) : null,
      });
      setShowForm(false);
      loadLista();
    } catch (e) {
      alert('Błąd: ' + getApiErrorMessage(e, e.message));
    } finally {
      setSaving(false);
    }
  };

  const loadDetail = async (id) => {
    setSelected(id);
    setDetailLoading(true);
    setDetail(null);
    try {
      const res = await api.get(`/ogledziny/${id}`);
      setDetail(res.data);
    } catch (e) {
      console.error(e);
    } finally {
      setDetailLoading(false);
    }
  };

  const handleChangeStatus = async () => {
    if (!newStatus) return;
    setStatusSaving(true);
    try {
      await api.put(`/ogledziny/${selected}/status`, { status: newStatus, notatki_wyniki: statusNotatki || null });
      setShowStatusModal(false);
      loadDetail(selected);
      loadLista();
    } catch (e) {
      alert('Błąd: ' + getApiErrorMessage(e, e.message));
    } finally {
      setStatusSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selected || !window.confirm('Usunąć te oględziny?')) return;
    try {
      await api.delete(`/ogledziny/${selected}`);
      setSelected(null);
      setDetail(null);
      loadLista();
    } catch (e) {
      alert('Błąd: ' + getApiErrorMessage(e, e.message));
    }
  };

  const fmt = (d) => d ? new Date(d).toLocaleDateString('pl-PL') : '—';
  const fmtDt = (d) => d ? new Date(d).toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Brak daty';
  const fmtPln = (v) => v != null ? `${Number(v).toLocaleString('pl-PL')} zł` : '—';
  const fmtGpsAge = (iso) => {
    if (!iso) return 'brak czasu';
    const diffMin = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
    if (diffMin < 1) return 'teraz';
    if (diffMin < 60) return `${diffMin} min temu`;
    const h = Math.floor(diffMin / 60);
    const m = diffMin % 60;
    return `${h}h ${m}m temu`;
  };
  const gpsState = (live) => {
    const ageMin = live?.recorded_at ? (Date.now() - new Date(live.recorded_at).getTime()) / 60000 : Infinity;
    const speed = Number(live?.speed_kmh || 0);
    if (ageMin > 15) return { label: 'stary sygnał', color: UI_COLORS.danger };
    if (speed > 5) return { label: 'jazda', color: UI_COLORS.success };
    return { label: 'postój', color: UI_COLORS.info };
  };
  const fmtEta = (minutes) => {
    if (minutes == null) return null;
    if (minutes < 60) return `${minutes} min`;
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${h}h ${m}m`;
  };
  const livePoints = Object.values(liveLocationsByTeam).filter(
    (p) => Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng))
  );
  const mapBounds = (() => {
    if (livePoints.length === 0) return null;
    const lats = livePoints.map((p) => Number(p.lat));
    const lngs = livePoints.map((p) => Number(p.lng));
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    return {
      minLat: minLat - 0.01,
      maxLat: maxLat + 0.01,
      minLng: minLng - 0.01,
      maxLng: maxLng + 0.01,
    };
  })();
  const pointToXY = (point) => {
    if (!mapBounds) return { x: 50, y: 50 };
    const lat = Number(point.lat);
    const lng = Number(point.lng);
    const x = ((lng - mapBounds.minLng) / Math.max(0.000001, mapBounds.maxLng - mapBounds.minLng)) * 100;
    const y = (1 - (lat - mapBounds.minLat) / Math.max(0.000001, mapBounds.maxLat - mapBounds.minLat)) * 100;
    return { x, y };
  };

  const sc = (s) => STATUS_COLOR[s] || '#94A3B8';
  const zoneFor = (o) => zoneOverrides[o.id] || clientZoneDefaults[o.klient_id] || detectKrakowZone(o);
  const listaPoDacie = filterDate
    ? lista.filter((o) => String(o.data_planowana || '').slice(0, 10) === filterDate)
    : lista;
  const listaPoStrefie = zoneFilter ? listaPoDacie.filter((o) => zoneFor(o) === zoneFilter) : listaPoDacie;
  const listaPoEkipie = teamFilter ? listaPoStrefie.filter((o) => String(o.ekipa_id || '') === String(teamFilter)) : listaPoStrefie;
  const trasaList = routeMode || dispatchMode
    ? [...listaPoEkipie].sort((a, b) => {
        if (dispatchMode) {
          const liveA = a.ekipa_id ? liveLocationsByTeam[a.ekipa_id] : null;
          const liveB = b.ekipa_id ? liveLocationsByTeam[b.ekipa_id] : null;
          const etaA = computeEtaMinutes(liveA, a);
          const etaB = computeEtaMinutes(liveB, b);
          const riskA = computeDelayRisk({ item: a, live: liveA, etaMinutes: etaA });
          const riskB = computeDelayRisk({ item: b, live: liveB, etaMinutes: etaB });
          if (riskA.level === 'high' && riskB.level !== 'high') return -1;
          if (riskA.level !== 'high' && riskB.level === 'high') return 1;
          if (etaA != null && etaB != null && etaA !== etaB) return etaA - etaB;
          if (etaA != null && etaB == null) return -1;
          if (etaA == null && etaB != null) return 1;
        }
        if (zoneMode) {
          const zr = zoneRank(zoneFor(a)) - zoneRank(zoneFor(b));
          if (zr !== 0) return zr;
        }
        return compareRoute(a, b);
      })
    : listaPoEkipie;
  const trasaAdresy = trasaList.map((o) => [o.adres, o.miasto].filter(Boolean).join(', ')).filter(Boolean);
  const mapsRouteUrl = buildGoogleMapsMultiStop(trasaAdresy);
  const clientsById = Object.fromEntries(
    lista
      .map((o) => [o.klient_id, o.klient_nazwa?.trim() || `Klient #${o.klient_id}`])
      .filter(([id]) => id != null)
  );
  const dictionaryRows = Object.entries(clientZoneDefaults)
    .map(([clientId, zone]) => ({
      clientId: Number(clientId),
      zone,
      clientName: clientsById[clientId] || `Klient #${clientId}`,
    }))
    .sort((a, b) => a.clientName.localeCompare(b.clientName, 'pl'));
  const staleSignals = livePoints.filter((p) => gpsState(p).label === 'stary sygnał');
  const riskRows = trasaList
    .map((o) => {
      const live = (o.ekipa_id ? liveLocationsByTeam[o.ekipa_id] : null) || (o.wyceniajacy_id ? liveLocationsByEstimator[o.wyceniajacy_id] : null);
      const etaMinutes = live ? computeEtaMinutes(live, o) : null;
      const risk = computeDelayRisk({ item: o, live, etaMinutes });
      return { o, live, etaMinutes, risk };
    })
    .sort((a, b) => b.risk.score - a.risk.score);
  const topRisks = riskRows.slice(0, 3);
  const criticalRisks = riskRows.filter((x) => x.risk.level === 'high');
  const withoutGpsRows = riskRows.filter(({ o, live }) => {
    const hasAssignment = o.ekipa_id || o.brygadzista_id || o.wyceniajacy_id || o.brygadzista_nazwa || o.wyceniajacy_nazwa;
    return hasAssignment && !live;
  });
  const statusSummary = STATUSY.map((s) => ({
    key: s,
    label: STATUS_LABEL[s],
    count: trasaList.filter((o) => o.status === s).length,
    color: sc(s),
  }));

  useEffect(() => {
    localStorage.setItem('ogledziny_zone_overrides', JSON.stringify(zoneOverrides));
  }, [zoneOverrides]);
  useEffect(() => {
    localStorage.setItem('ogledziny_client_zone_defaults', JSON.stringify(clientZoneDefaults));
  }, [clientZoneDefaults]);

  const setOverrideZone = (id, zone) => {
    setZoneOverrides((prev) => {
      const next = { ...prev };
      if (!zone) delete next[id];
      else next[id] = zone;
      return next;
    });
  };
  const setClientDefaultZone = (clientId, zone) => {
    if (!clientId) return;
    setClientZoneDefaults((prev) => {
      const next = { ...prev };
      if (!zone) delete next[clientId];
      else next[clientId] = zone;
      return next;
    });
  };
  const exportZoneDictionary = () => {
    const payload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      clientZoneDefaults,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `arbor-zone-dictionary-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const importZoneDictionary = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setZoneImportError('');
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const source = parsed?.clientZoneDefaults;
      if (!source || typeof source !== 'object' || Array.isArray(source)) {
        throw new Error('Brak pola clientZoneDefaults');
      }
      const clean = {};
      for (const [key, value] of Object.entries(source)) {
        if (!/^\d+$/.test(String(key))) continue;
        if (!ZONE_LABEL[value]) continue;
        clean[String(key)] = value;
      }
      setClientZoneDefaults(clean);
    } catch (err) {
      setZoneImportError(`Nie udało się wczytać pliku: ${err.message}`);
    }
  };

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: 'linear-gradient(180deg, var(--bg) 0%, var(--bg-deep) 100%)' }}>
      <Sidebar />
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', height: '100vh' }}>

        {/* ── LEWA KOLUMNA: lista ── */}
        <div style={{ width: 360, borderRight: '1px solid var(--border2)', display: 'flex', flexDirection: 'column', background: 'linear-gradient(160deg, var(--bg-card) 0%, var(--bg-card2) 100%)' }}>

          {/* Nagłówek */}
          <div style={{ padding: '20px 16px 12px', borderBottom: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>Oględziny</h2>
                <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>{trasaList.length} rekordów</p>
              </div>
              {canPlan && (
                <button onClick={openForm} style={btn.primary}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                  Nowe
                </button>
              )}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 6, marginBottom: 10 }}>
              {statusSummary.map((s) => (
                <div key={s.key} style={{ background: 'var(--bg-deep)', border: '1px solid var(--border2)', borderRadius: 8, padding: '6px 8px' }}>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>{s.label}</div>
                  <div style={{ marginTop: 2, fontSize: 16, color: s.color, fontWeight: 800 }}>{s.count}</div>
                </div>
              ))}
            </div>

            {/* Filtry statusów */}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <Chip active={filterStatus === ''} onClick={() => setFilterStatus('')} color="var(--accent)">Wszystkie</Chip>
              {STATUSY.map(s => (
                <Chip key={s} active={filterStatus === s} onClick={() => setFilterStatus(s)} color={sc(s)}>
                  {STATUS_LABEL[s]}
                </Chip>
              ))}
            </div>
            <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, alignItems: 'center' }}>
              <input
                type="date"
                style={inp.base}
                value={filterDate}
                onChange={(e) => setFilterDate(e.target.value)}
              />
              <button
                type="button"
                style={{ ...btn.secondary, whiteSpace: 'nowrap' }}
                onClick={() => setRouteMode((v) => !v)}
              >
                {routeMode ? 'Widok standard' : 'Ułóż trasę'}
              </button>
            </div>
            <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, alignItems: 'center' }}>
              <select style={inp.base} value={zoneFilter} onChange={(e) => setZoneFilter(e.target.value)}>
                <option value="">Wszystkie strefy</option>
                {Object.entries(ZONE_LABEL).map(([z, label]) => (
                  <option key={z} value={z}>{label}</option>
                ))}
              </select>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  type="button"
                  style={{ ...btn.secondary, whiteSpace: 'nowrap' }}
                  onClick={() => setZoneMode((v) => !v)}
                >
                  {zoneMode ? 'Bez stref' : 'Tryb 4 stref'}
                </button>
                <button
                  type="button"
                  style={{ ...btn.secondary, whiteSpace: 'nowrap' }}
                  onClick={() => setShowZoneDictionary((v) => !v)}
                >
                  Słownik stref
                </button>
              </div>
            </div>
            <div style={{ marginTop: 8 }}>
              <select style={inp.base} value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)}>
                <option value="">Wszystkie ekipy</option>
                {Object.values(liveLocationsByTeam)
                  .filter((x) => x?.ekipa_id != null)
                  .sort((a, b) => String(a.ekipa_nazwa || '').localeCompare(String(b.ekipa_nazwa || ''), 'pl'))
                  .map((x) => (
                    <option key={x.ekipa_id} value={x.ekipa_id}>
                      {x.ekipa_nazwa || `Ekipa #${x.ekipa_id}`}
                    </option>
                  ))}
              </select>
            </div>
            {showZoneDictionary && (
              <div style={{ marginTop: 8, background: 'var(--bg-deep)', border: '1px solid var(--border)', borderRadius: 10, padding: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <strong style={{ fontSize: 12, color: 'var(--text)' }}>Domyślne strefy klientów</strong>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      type="button"
                      style={{ ...btn.secondary, fontSize: 11, padding: '4px 8px' }}
                      onClick={exportZoneDictionary}
                    >
                      Eksport JSON
                    </button>
                    <label style={{ ...btn.secondary, fontSize: 11, padding: '4px 8px', cursor: 'pointer' }}>
                      Import JSON
                      <input type="file" accept="application/json" style={{ display: 'none' }} onChange={importZoneDictionary} />
                    </label>
                    <button
                      type="button"
                      style={{ ...btn.secondary, fontSize: 11, padding: '4px 8px' }}
                      onClick={() => setClientZoneDefaults({})}
                    >
                      Wyczyść wszystko
                    </button>
                  </div>
                </div>
                {zoneImportError ? (
                  <div style={{ marginBottom: 8, fontSize: 11, color: 'var(--danger)' }}>{zoneImportError}</div>
                ) : null}
                {dictionaryRows.length === 0 ? (
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Brak zapisanych domyślnych stref.</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 180, overflowY: 'auto' }}>
                    {dictionaryRows.map((row) => (
                      <div key={row.clientId} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 6, alignItems: 'center' }}>
                        <span style={{ fontSize: 11, color: 'var(--text-sub)' }}>{row.clientName}</span>
                        <select
                          value={row.zone}
                          onChange={(e) => setClientDefaultZone(row.clientId, e.target.value)}
                          style={{ ...inp.base, padding: '3px 6px', fontSize: 11 }}
                        >
                          {Object.entries(ZONE_LABEL).map(([z, label]) => (
                            <option key={z} value={z}>{label}</option>
                          ))}
                        </select>
                        <button
                          type="button"
                          style={{ ...btn.secondary, fontSize: 11, padding: '4px 8px' }}
                          onClick={() => setClientDefaultZone(row.clientId, '')}
                        >
                          Usuń
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            {routeMode && (
              <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  Kolejność: {zoneMode ? 'strefa → ' : ''}godzina → miasto → adres
                </span>
                {mapsRouteUrl ? (
                  <a href={mapsRouteUrl} target="_blank" rel="noopener noreferrer" style={{ ...btn.secondary, textDecoration: 'none' }}>
                    Otwórz trasę w mapach
                  </a>
                ) : null}
                {zoneMode ? (
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    Strefy są umowne i czasem się mieszają — to normalne.
                  </span>
                ) : null}
              </div>
            )}
            <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <button
                type="button"
                style={{ ...btn.secondary, whiteSpace: 'nowrap', borderColor: dispatchMode ? 'var(--accent)' : 'var(--border)' }}
                onClick={() => setDispatchMode((v) => !v)}
              >
                {dispatchMode ? 'Dispatch OFF' : 'Dispatch ON (ETA)'}
              </button>
              {dispatchMode ? <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Sortowanie priorytetem ETA</span> : null}
            </div>
            {dispatchMode && criticalRisks.length > 0 ? (
              <div style={{ marginTop: 8, fontSize: 11, color: 'var(--danger)', background: 'rgba(248,113,113,0.14)', border: '1px solid rgba(248,113,113,0.3)', borderRadius: 8, padding: '7px 9px' }}>
                Krytyczne opóźnienia: {criticalRisks.length}. Najwyższy priorytet przypięty na górę listy.
              </div>
            ) : null}
            {staleSignals.length > 0 ? (
              <div style={{ marginTop: 8, fontSize: 11, color: 'var(--danger)', background: 'rgba(248,113,113,0.12)', border: '1px solid rgba(248,113,113,0.25)', borderRadius: 8, padding: '6px 8px' }}>
                Uwaga: {staleSignals.length} ekip ma stary sygnał GPS (&gt;15 min).
              </div>
            ) : null}
            {withoutGpsRows.length > 0 ? (
              <div style={{ marginTop: 8, fontSize: 11, color: 'var(--warning)', background: 'rgba(251,191,36,0.12)', border: '1px solid rgba(251,191,36,0.25)', borderRadius: 8, padding: '6px 8px' }}>
                Bez GPS: {withoutGpsRows.length} przypisanych pozycji (np. wyceniający bez lokalizatora).
              </div>
            ) : null}
            {topRisks.length > 0 ? (
              <div style={{ marginTop: 8, background: 'var(--bg-deep)', border: '1px solid var(--border)', borderRadius: 10, padding: 10 }}>
                <strong style={{ fontSize: 12, color: 'var(--text)' }}>Top ryzyka opóźnienia</strong>
                <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {topRisks.map(({ o, etaMinutes, risk }, idx) => (
                    <button
                      type="button"
                      key={o.id}
                      onClick={() => loadDetail(o.id)}
                      style={{
                        textAlign: 'left',
                        border: '1px solid var(--border)',
                        borderRadius: 8,
                        background: risk.level === 'high' ? 'rgba(248,113,113,0.13)' : risk.level === 'medium' ? 'rgba(251,191,36,0.12)' : 'rgba(52,211,153,0.1)',
                        padding: '6px 8px',
                        color: 'var(--text)',
                        cursor: 'pointer',
                      }}
                    >
                      <div style={{ fontSize: 11, fontWeight: 700 }}>
                        #{idx + 1} {o.klient_nazwa || `Oględziny #${o.id}`}
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                        Ryzyko: {risk.score} • ETA: {fmtEta(etaMinutes) || 'brak'} • Termin: {fmtDt(o.data_planowana)}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            {withoutGpsRows.length > 0 ? (
              <div style={{ marginTop: 8, background: 'var(--bg-deep)', border: '1px solid var(--border)', borderRadius: 10, padding: 10 }}>
                <strong style={{ fontSize: 12, color: 'var(--text)' }}>Przypisane bez GPS</strong>
                <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 140, overflowY: 'auto' }}>
                  {withoutGpsRows.slice(0, 6).map(({ o }) => (
                    <button
                      type="button"
                      key={`nogps-${o.id}`}
                      onClick={() => loadDetail(o.id)}
                      style={{
                        textAlign: 'left',
                        border: '1px solid var(--border)',
                        borderRadius: 8,
                        background: 'rgba(251,191,36,0.08)',
                        padding: '6px 8px',
                        color: 'var(--text)',
                        cursor: 'pointer',
                      }}
                    >
                      <div style={{ fontSize: 11, fontWeight: 700 }}>
                        {o.klient_nazwa || `Oględziny #${o.id}`}
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                        {getAssignmentLabel(o, null)} • brak sygnału GPS
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            {livePoints.length > 0 && (
              <div style={{ marginTop: 10, background: 'var(--bg-deep)', border: '1px solid var(--border)', borderRadius: 10, padding: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <strong style={{ fontSize: 12, color: 'var(--text)' }}>Mapa live ekip (GPS)</strong>
                  <button type="button" style={{ ...btn.secondary, fontSize: 11, padding: '4px 8px' }} onClick={() => loadLiveLocations(true)}>
                    Odśwież GPS
                  </button>
                </div>
                <div style={{ position: 'relative', height: 160, borderRadius: 8, background: 'linear-gradient(180deg,#0f172a,#111827)', overflow: 'hidden' }}>
                  {livePoints.map((point) => {
                    const pos = pointToXY(point);
                    const gps = gpsState(point);
                    return (
                      <button
                        type="button"
                        key={`${point.ekipa_id}-${point.vehicle_id}`}
                        title={`${point.ekipa_nazwa || 'Ekipa'} • ${point.nr_rejestracyjny || 'pojazd'} • ${gps.label}`}
                        onClick={() => setTeamFilter(String(point.ekipa_id || ''))}
                        style={{
                          position: 'absolute',
                          left: `calc(${pos.x}% - 5px)`,
                          top: `calc(${pos.y}% - 5px)`,
                          width: 10,
                          height: 10,
                          borderRadius: 999,
                          background: gps.color,
                          boxShadow: `0 0 0 3px ${gps.color}44`,
                          border: 'none',
                          padding: 0,
                          cursor: 'pointer',
                        }}
                      />
                    );
                  })}
                </div>
                <div style={{ marginTop: 6, fontSize: 11, color: 'var(--text-muted)' }}>
                  Widok orientacyjny (siatka GPS), nie pełna mapa drogowa.
                </div>
                <div style={{ marginTop: 4, fontSize: 11, color: 'var(--text-muted)', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ color: UI_COLORS.success }}>● jazda</span>
                  <span style={{ color: UI_COLORS.info }}>● postój</span>
                  <span style={{ color: UI_COLORS.danger }}>● stary sygnał</span>
                  {teamFilter ? (
                    <button type="button" style={{ ...btn.secondary, fontSize: 11, padding: '2px 8px' }} onClick={() => setTeamFilter('')}>
                      Wyczyść filtr ekipy
                    </button>
                  ) : null}
                </div>
              </div>
            )}
          </div>

          {/* Lista */}
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {loading ? (
              <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>Ładowanie...</div>
            ) : trasaList.length === 0 ? (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
                <div style={{ fontSize: 36, marginBottom: 8, opacity: 0.4 }}>🔍</div>
                <p>Brak oględzin</p>
              </div>
            ) : trasaList.map((o, idx) => (
              <div
                key={o.id}
                onClick={() => loadDetail(o.id)}
                style={{
                  padding: '12px 16px',
                  borderBottom: '1px solid var(--border)',
                  cursor: 'pointer',
                  background: selected === o.id
                    ? 'rgba(52,211,153,0.07)'
                    : (() => {
                        const live = (o.ekipa_id ? liveLocationsByTeam[o.ekipa_id] : null) || (o.wyceniajacy_id ? liveLocationsByEstimator[o.wyceniajacy_id] : null);
                        const risk = computeDelayRisk({ item: o, live, etaMinutes: live ? computeEtaMinutes(live, o) : null });
                        if (risk.level === 'high') return 'rgba(248,113,113,0.07)';
                        if (risk.level === 'medium') return 'rgba(251,191,36,0.06)';
                        return 'transparent';
                      })(),
                  borderLeft: `3px solid ${selected === o.id ? 'var(--accent)' : 'transparent'}`,
                  transition: 'all 0.15s',
                }}
              >
                {(() => {
                  const live = (o.ekipa_id ? liveLocationsByTeam[o.ekipa_id] : null) || (o.wyceniajacy_id ? liveLocationsByEstimator[o.wyceniajacy_id] : null);
                  const etaMinutes = live ? computeEtaMinutes(live, o) : null;
                  const etaLabel = fmtEta(etaMinutes);
                  const risk = computeDelayRisk({ item: o, live, etaMinutes });
                  const brygadzistaPhone = o.brygadzista_telefon || o.brygadzista_tel || null;
                  const navigationUrl = live
                    ? buildGoogleMapsNavigationUrl(`${live.lat},${live.lng}`, [o.adres, o.miasto].filter(Boolean).join(', '))
                    : buildGoogleMapsNavigationUrl(null, [o.adres, o.miasto].filter(Boolean).join(', '));
                  return (
                    <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--text)', marginBottom: 2 }}>
                      {routeMode ? `${idx + 1}. ` : ''}
                      {o.klient_nazwa?.trim() || 'Klient nieznany'}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-sub)', marginBottom: 2 }}>
                      {fmtDt(o.data_planowana)}
                    </div>
                    {o.adres && (
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        {o.adres}{o.miasto ? `, ${o.miasto}` : ''}
                      </div>
                    )}
                    <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          padding: '2px 8px',
                          borderRadius: 7,
                          background: `${ZONE_COLOR[zoneFor(o)] || '#94A3B8'}22`,
                          color: ZONE_COLOR[zoneFor(o)] || '#94A3B8',
                        }}
                      >
                        {ZONE_LABEL[zoneFor(o)] || zoneFor(o)}
                      </span>
                      <select
                        value={zoneOverrides[o.id] || ''}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => setOverrideZone(o.id, e.target.value)}
                        style={{
                          fontSize: 10,
                          borderRadius: 6,
                          border: '1px solid var(--border)',
                          background: 'var(--bg-deep)',
                          color: 'var(--text-sub)',
                          padding: '2px 6px',
                        }}
                      >
                        <option value="">Auto</option>
                        {Object.entries(ZONE_LABEL).map(([z, label]) => (
                          <option key={z} value={z}>{label}</option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          const zone = zoneOverrides[o.id] || detectKrakowZone(o);
                          setClientDefaultZone(o.klient_id, zone);
                        }}
                        style={{
                          fontSize: 10,
                          borderRadius: 6,
                          border: '1px solid var(--border)',
                          background: 'var(--bg-deep)',
                          color: 'var(--text-sub)',
                          padding: '2px 6px',
                          cursor: 'pointer',
                        }}
                      >
                        Ustaw domyślne dla klienta
                      </button>
                      {clientZoneDefaults[o.klient_id] ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setClientDefaultZone(o.klient_id, '');
                          }}
                          style={{
                            fontSize: 10,
                            borderRadius: 6,
                            border: '1px solid rgba(248,113,113,0.35)',
                            background: 'rgba(248,113,113,0.12)',
                            color: 'var(--danger)',
                            padding: '2px 6px',
                            cursor: 'pointer',
                          }}
                        >
                          Usuń domyślne
                        </button>
                      ) : null}
                    </div>
                    {o.brygadzista_nazwa && (
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                        👷 {o.brygadzista_nazwa}
                      </div>
                    )}
                    {live ? (
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                        📍 GPS ekipy: {fmtGpsAge(live.recorded_at)}
                        {live.speed_kmh != null ? ` · ${Math.round(Number(live.speed_kmh))} km/h` : ''}
                        {etaLabel ? ` · ETA ~ ${etaLabel}` : ''}
                        {` · ${gpsState(live).label} · ryzyko ${risk.score}`}
                      </div>
                    ) : (
                      <div style={{ fontSize: 11, color: 'var(--warning)', marginTop: 2 }}>
                        ⚠ Brak GPS: {getAssignmentLabel(o, live)}
                      </div>
                    )}
                    {navigationUrl ? (
                      <div style={{ marginTop: 4, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <a
                          href={navigationUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          style={{ ...btn.secondary, textDecoration: 'none', fontSize: 11, padding: '3px 8px', display: 'inline-flex' }}
                        >
                          Nawiguj ekipę do klienta
                        </a>
                        {brygadzistaPhone ? (
                          <a
                            href={`tel:${String(brygadzistaPhone).replace(/\s+/g, '')}`}
                            onClick={(e) => e.stopPropagation()}
                            style={{ ...btn.secondary, textDecoration: 'none', fontSize: 11, padding: '3px 8px', display: 'inline-flex' }}
                          >
                            Zadzwoń do brygadzisty
                          </a>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                  <span style={{
                    fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 7,
                    background: sc(o.status) + '22', color: sc(o.status),
                    whiteSpace: 'nowrap', marginLeft: 8,
                  }}>
                    {STATUS_LABEL[o.status] || o.status}
                  </span>
                </div>
                    </>
                  );
                })()}
              </div>
            ))}
          </div>
        </div>

        {/* ── PRAWA KOLUMNA: szczegóły ── */}
        <div style={{ flex: 1, overflowY: 'auto', background: 'linear-gradient(180deg, var(--bg) 0%, var(--bg-deep) 100%)' }}>
          {!selected ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)' }}>
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" style={{ opacity: 0.3, marginBottom: 16 }}>
                <circle cx="11" cy="11" r="8"/>
                <line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
              <p style={{ fontSize: 14 }}>Wybierz oględziny z listy</p>
            </div>
          ) : detailLoading ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)' }}>Ładowanie...</div>
          ) : detail && (
            <div style={{ maxWidth: 820, margin: '0 auto', padding: 28 }}>

              {/* Nagłówek */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                    <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: 'var(--text)' }}>
                      Oględziny #{detail.id}
                    </h1>
                    <span style={{
                      fontSize: 12, fontWeight: 700, padding: '4px 12px', borderRadius: 9,
                      background: sc(detail.status) + '22', color: sc(detail.status),
                    }}>
                      {STATUS_LABEL[detail.status] || detail.status}
                    </span>
                  </div>
                  <p style={{ margin: 0, fontSize: 13, color: 'var(--text-sub)' }}>
                    {detail.klient_nazwa?.trim()}
                    {detail.klient_telefon && <span style={{ marginLeft: 8 }}>· {detail.klient_telefon}</span>}
                  </p>
                  <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>
                    Dodał: {detail.created_by_nazwa} · {fmt(detail.created_at)}
                  </p>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  {detail.klient_id && (
                    <button onClick={() => navigate(`/klienci`)} style={btn.secondary}>
                      Profil klienta
                    </button>
                  )}
                  <button
                    onClick={() => { setNewStatus(detail.status); setStatusNotatki(detail.notatki_wyniki || ''); setShowStatusModal(true); }}
                    style={btn.secondary}
                  >
                    Zmień status
                  </button>
                  {canManage && (
                    <button onClick={handleDelete} style={btn.danger}>Usuń</button>
                  )}
                </div>
              </div>

              {/* Karty */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
                <Card title="Termin i lokalizacja">
                  <Row label="Data" value={fmtDt(detail.data_planowana)} />
                  <Row label="Adres" value={detail.adres} />
                  <Row label="Miasto" value={detail.miasto} />
                </Card>
                <Card title="Przypisanie">
                  <Row label="Brygadzista" value={detail.brygadzista_nazwa} />
                  <Row label="Klient firma" value={detail.klient_firma} />
                  <Row label="Tel. klienta" value={detail.klient_telefon} />
                  <Row label="Email klienta" value={detail.klient_email} />
                </Card>
              </div>

              {detail.notatki && (
                <section style={sec.wrap}>
                  <div style={sec.header}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                    <span style={sec.title}>Notatki</span>
                  </div>
                  <p style={{ margin: 0, fontSize: 13, color: 'var(--text)', lineHeight: 1.6 }}>{detail.notatki}</p>
                </section>
              )}

              {detail.notatki_wyniki && (
                <section style={{ ...sec.wrap, borderColor: 'rgba(52,211,153,0.3)' }}>
                  <div style={sec.header}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>
                    <span style={sec.title}>Wyniki oględzin</span>
                  </div>
                  <p style={{ margin: 0, fontSize: 13, color: 'var(--text)', lineHeight: 1.6 }}>{detail.notatki_wyniki}</p>
                </section>
              )}

              {/* Powiązana wycena */}
              {detail.wycena_id && (
                <section style={sec.wrap}>
                  <div style={sec.header}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
                    <span style={sec.title}>Powiązana wycena</span>
                  </div>
                  <div style={sec.row}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 2 }}>
                        Wycena #{detail.wycena_id}
                        {detail.wartosc_szacowana && (
                          <span style={{ color: 'var(--accent)', marginLeft: 8 }}>{fmtPln(detail.wartosc_szacowana)}</span>
                        )}
                      </div>
                      {detail.wycena_opis && (
                        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{detail.wycena_opis}</div>
                      )}
                    </div>
                    {detail.wycena_status && (
                      <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 8,
                        background: 'rgba(52,211,153,0.15)', color: 'var(--accent)' }}>
                        {detail.wycena_status}
                      </span>
                    )}
                  </div>
                </section>
              )}

              {/* Zdjęcia */}
              {detail.zdjecia?.length > 0 && (
                <section style={sec.wrap}>
                  <div style={sec.header}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                    <span style={sec.title}>Zdjęcia ({detail.zdjecia.length})</span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 10 }}>
                    {detail.zdjecia.map(z => (
                      <a key={z.id} href={z.url} target="_blank" rel="noopener noreferrer">
                        <img
                          src={z.url}
                          alt=""
                          style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', borderRadius: 10, border: '1px solid var(--border)' }}
                        />
                      </a>
                    ))}
                  </div>
                </section>
              )}

            </div>
          )}
        </div>
      </div>

      {/* ── MODAL: nowe oględziny ── */}
      {showForm && (
        <div style={modal.overlay} onClick={e => { if (e.target === e.currentTarget) setShowForm(false); }}>
          <div style={modal.box}>
            <div style={modal.header}>
              <h3 style={modal.title}>Zaplanuj oględziny</h3>
              <button onClick={() => setShowForm(false)} style={modal.closeBtn}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div style={{ overflowY: 'auto', maxHeight: 'calc(85vh - 120px)' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, padding: '16px 24px 20px' }}>
                <FormField label="Klient *" style={{ gridColumn: 'span 2' }}>
                  <select style={inp.base} value={form.klient_id} onChange={e => {
                    const k = klienciList.find(k => k.id === Number(e.target.value));
                    setForm(f => ({
                      ...f,
                      klient_id: e.target.value,
                      adres: k?.adres || f.adres,
                      miasto: k?.miasto || f.miasto,
                    }));
                  }}>
                    <option value="">— wybierz klienta —</option>
                    {klienciList.map(k => (
                      <option key={k.id} value={k.id}>
                        {k.imie} {k.nazwisko}{k.firma ? ` (${k.firma})` : ''} {k.telefon ? `· ${k.telefon}` : ''}
                      </option>
                    ))}
                  </select>
                </FormField>
                <FormField label="Brygadzista" style={{ gridColumn: 'span 2' }}>
                  <select style={inp.base} value={form.brygadzista_id} onChange={e => setForm(f => ({ ...f, brygadzista_id: e.target.value }))}>
                    <option value="">— nieprzypisany —</option>
                    {brygadList.map(u => (
                      <option key={u.id} value={u.id}>{u.imie} {u.nazwisko} ({u.rola})</option>
                    ))}
                  </select>
                </FormField>
                <FormField label="Data i godzina" style={{ gridColumn: 'span 2' }}>
                  <input type="datetime-local" style={inp.base} value={form.data_planowana}
                    onChange={e => setForm(f => ({ ...f, data_planowana: e.target.value }))} />
                  <p style={{ margin: '6px 0 0', fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.4 }}>
                    Tylko termin wizyty u klienta — bez ceny i bez terminu realizacji zlecenia. Wycena i harmonogram brygad powstają później u wyceniającego.
                  </p>
                </FormField>
                <FormField label="Adres">
                  <input style={inp.base} value={form.adres}
                    onChange={e => setForm(f => ({ ...f, adres: e.target.value }))} placeholder="ul. Leśna 1" />
                </FormField>
                <FormField label="Miasto">
                  <CityInput
                    style={inp.base}
                    value={form.miasto}
                    onChange={e => setForm(f => ({ ...f, miasto: e.target.value }))}
                    placeholder="Warszawa"
                    extraCities={klienciList.map((k) => k.miasto)}
                  />
                </FormField>
                <FormField label="Notatki" style={{ gridColumn: 'span 2' }}>
                  <textarea style={{ ...inp.base, resize: 'vertical', minHeight: 70 }} value={form.notatki}
                    onChange={e => setForm(f => ({ ...f, notatki: e.target.value }))}
                    placeholder="Dodatkowe informacje dla brygadzisty..." />
                </FormField>
              </div>
            </div>
            <div style={modal.footer}>
              <button onClick={() => setShowForm(false)} style={btn.secondaryGhost}>Anuluj</button>
              <button onClick={handleSave} disabled={saving} style={btn.primary}>
                {saving ? 'Zapisuję...' : 'Zaplanuj'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL: zmiana statusu ── */}
      {showStatusModal && (
        <div style={modal.overlay} onClick={e => { if (e.target === e.currentTarget) setShowStatusModal(false); }}>
          <div style={{ ...modal.box, maxWidth: 420 }}>
            <div style={modal.header}>
              <h3 style={modal.title}>Zmień status oględzin</h3>
              <button onClick={() => setShowStatusModal(false)} style={modal.closeBtn}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div style={{ padding: '16px 24px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {STATUSY.map(s => (
                  <button
                    key={s}
                    onClick={() => setNewStatus(s)}
                    style={{
                      padding: '10px 14px', borderRadius: 10, border: `2px solid ${newStatus === s ? sc(s) : 'var(--border)'}`,
                      background: newStatus === s ? sc(s) + '18' : 'var(--bg-deep)',
                      color: newStatus === s ? sc(s) : 'var(--text-sub)',
                      fontWeight: 700, fontSize: 13, cursor: 'pointer', transition: 'all 0.15s',
                    }}
                  >
                    {STATUS_LABEL[s]}
                  </button>
                ))}
              </div>
              <FormField label="Notatki z wyników (opcjonalne)">
                <textarea
                  style={{ ...inp.base, resize: 'vertical', minHeight: 80 }}
                  value={statusNotatki}
                  onChange={e => setStatusNotatki(e.target.value)}
                  placeholder="Co ustalono na oględzinach?"
                />
              </FormField>
            </div>
            <div style={modal.footer}>
              <button onClick={() => setShowStatusModal(false)} style={btn.secondaryGhost}>Anuluj</button>
              <button onClick={handleChangeStatus} disabled={statusSaving || !newStatus} style={btn.primary}>
                {statusSaving ? 'Zapisuję...' : 'Zapisz'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Pomocnicze komponenty ────────────────────────────────────────────────────
function Chip({ children, active, onClick, color }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '5px 12px', borderRadius: 9, border: `1px solid ${active ? color : 'var(--border2)'}`,
        background: active ? color + '20' : 'var(--bg-deep)',
        color: active ? color : 'var(--text-muted)',
        fontSize: 11, fontWeight: 700, cursor: 'pointer', transition: 'all 0.15s',
      }}
    >
      {children}
    </button>
  );
}

function Card({ title, children }) {
  return (
    <div style={{ background: 'linear-gradient(150deg, var(--bg-card) 0%, var(--bg-card2) 100%)', borderRadius: 16, border: '1px solid var(--border2)', boxShadow: 'var(--shadow-sm)', padding: 16 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: 1, marginBottom: 12, textTransform: 'uppercase' }}>{title}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{children}</div>
    </div>
  );
}

function Row({ label, value }) {
  if (!value && value !== 0) return null;
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
      <span style={{ fontSize: 12, color: 'var(--text-muted)', flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: 12, color: 'var(--text)', fontWeight: 600, textAlign: 'right' }}>{value}</span>
    </div>
  );
}

function FormField({ label, children, style }) {
  return (
    <div style={style}>
      <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</label>
      {children}
    </div>
  );
}

// ─── Style ────────────────────────────────────────────────────────────────────
const btn = {
  primary: {
    display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px',
    background: 'var(--accent)', color: 'var(--on-accent)', border: '1px solid var(--border2)', borderRadius: 10,
    fontSize: 13, fontWeight: 700, cursor: 'pointer', boxShadow: 'var(--shadow-sm)',
  },
  secondary: {
    display: 'flex', alignItems: 'center', gap: 6, padding: '7px 13px',
    background: 'var(--bg-deep)', color: 'var(--text-sub)', border: '1px solid var(--border2)',
    borderRadius: 9, fontSize: 12, fontWeight: 600, cursor: 'pointer',
  },
  secondaryGhost: {
    padding: '9px 18px', background: 'transparent', color: 'var(--text-sub)',
    border: '1px solid var(--border2)', borderRadius: 9, fontSize: 13, fontWeight: 600, cursor: 'pointer',
  },
  danger: {
    padding: '7px 13px', background: 'rgba(255,127,169,0.14)', color: 'var(--danger)',
    border: '1px solid rgba(255,127,169,0.3)', borderRadius: 9, fontSize: 12, fontWeight: 600, cursor: 'pointer',
  },
};

const inp = {
  base: {
    width: '100%', padding: '9px 11px', background: 'var(--input-bg)',
    border: '1px solid var(--input-border)', borderRadius: 9,
    color: 'var(--text)', fontSize: 13, outline: 'none', boxSizing: 'border-box',
  },
};

const sec = {
  wrap: {
    background: 'linear-gradient(150deg, var(--bg-card) 0%, var(--bg-card2) 100%)',
    borderRadius: 14,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: 'var(--border)',
    padding: 16,
    marginBottom: 16,
  },
  header: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 },
  title: { fontSize: 13, fontWeight: 700, color: 'var(--text)' },
  row: {
    display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px',
    background: 'var(--bg-deep)', borderRadius: 10, border: '1px solid var(--border)',
  },
};

const modal = {
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex',
    alignItems: 'center', justifyContent: 'center', zIndex: 500,
  },
  box: {
    width: '90%', maxWidth: 600, background: 'var(--bg-card)',
    borderRadius: 18, border: '1px solid var(--border2)',
    boxShadow: 'var(--shadow-lg)', display: 'flex', flexDirection: 'column',
    maxHeight: '90vh',
  },
  header: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '20px 24px 16px', borderBottom: '1px solid var(--border)',
  },
  title: { margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--text)' },
  closeBtn: { background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex' },
  footer: {
    padding: '16px 24px', borderTop: '1px solid var(--border)',
    display: 'flex', justifyContent: 'flex-end', gap: 10,
  },
};
