import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, FlatList, KeyboardAvoidingView, Modal, Platform, RefreshControl,
  ScrollView, StatusBar, StyleSheet, Text,
  TextInput, TouchableOpacity, View,
} from 'react-native';
import { PlatinumCTA } from '../components/ui/platinum-cta';
import { useLanguage } from '../constants/LanguageContext';
import { useTheme } from '../constants/ThemeContext';
import { API_URL } from '../constants/api';
import type { Theme } from '../constants/theme';
import { useOddzialFeatureGuard } from '../hooks/use-oddzial-feature-guard';
import { triggerHaptic } from '../utils/haptics';
import { enqueueOfflineRequest, flushOfflineQueue } from '../utils/offline-queue';
import { getStoredSession } from '../utils/session';
import { openAddressInMaps } from '../utils/maps-link';

const STATUSY = ['Zaplanowane', 'W_Trakcie', 'Zakonczone', 'Anulowane'] as const;
type Status = typeof STATUSY[number];
const ZONE_ORDER = ['Krakow-POLNOC', 'Krakow-WSCHOD', 'Krakow-POŁUDNIE', 'Krakow-ZACHOD'] as const;
const ZONE_LABEL: Record<string, string> = {
  'Krakow-POLNOC': 'Kraków - Północ',
  'Krakow-WSCHOD': 'Kraków - Wschód',
  'Krakow-POŁUDNIE': 'Kraków - Południe',
  'Krakow-ZACHOD': 'Kraków - Zachód',
  'Krakow-NIEJEDNOZNACZNA': 'Kraków - Niejednoznaczna',
  'POZA-KRAKOWEM': 'Poza Krakowem',
};
const ZONE_RULES: Record<string, string[]> = {
  'Krakow-POLNOC': ['pradnik bialy', 'prądnik biały', 'pradnik czerwony', 'prądnik czerwony', 'bronowice', 'krowodrza'],
  'Krakow-WSCHOD': ['nowa huta', 'czyzyny', 'czyżyny', 'bienczyce', 'bieńczyce', 'mistrzejowice'],
  'Krakow-POŁUDNIE': ['podgorze', 'podgórze', 'swoszowice', 'łagiewniki', 'lagniki', 'debniki', 'dębniki', 'prokocim', 'biezanow', 'bieżanów'],
  'Krakow-ZACHOD': ['zwierzyniec', 'wola justowska', 'ruczaj', 'tyniec', 'salwator'],
};
const ZONE_COLOR = {
  'Krakow-POLNOC': '#60A5FA',
  'Krakow-WSCHOD': '#A78BFA',
  'Krakow-POŁUDNIE': '#34D399',
  'Krakow-ZACHOD': '#F59E0B',
  'Krakow-NIEJEDNOZNACZNA': '#F87171',
  'POZA-KRAKOWEM': '#94A3B8',
} as const;
const ZONE_OVERRIDE_KEY = 'ogledziny_zone_overrides_mobile_v1';
const ZONE_CLIENT_DEFAULT_KEY = 'ogledziny_zone_client_defaults_mobile_v1';

function statusColor(s: string, th: Theme): string {
  switch (s) {
    case 'Zaplanowane': return th.info;
    case 'W_Trakcie':   return th.warning;
    case 'Zakonczone':  return th.success;
    case 'Anulowane':   return th.danger;
    default:            return th.textMuted;
  }
}

function inspectionStatusLabel(code: string, tr: (key: string) => string) {
  const k = `inspections.status.${code}`;
  const r = tr(k);
  return r === k ? code : r;
}

function quoteStatusLabel(code: string | undefined, tr: (key: string) => string) {
  if (!code) return '';
  const k = `wyceny.status.${code}`;
  const r = tr(k);
  return r === k ? code.replace(/_/g, ' ') : r;
}

function normalizeText(v: unknown): string {
  return String(v || '').trim().toLowerCase();
}

function detectKrakowZone(item: Pick<Ogledziny, 'miasto' | 'adres'>): string {
  const city = normalizeText(item.miasto);
  const address = normalizeText(item.adres);
  const blob = `${city} ${address}`;
  const isKrakow = city.includes('krakow') || city.includes('kraków') || address.includes('krakow') || address.includes('kraków');
  if (!isKrakow) return 'POZA-KRAKOWEM';

  const matches: string[] = [];
  for (const [zone, keys] of Object.entries(ZONE_RULES)) {
    if (keys.some((k) => blob.includes(k))) matches.push(zone);
  }
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) return 'Krakow-NIEJEDNOZNACZNA';
  return 'Krakow-NIEJEDNOZNACZNA';
}

function zoneRank(zone: string): number {
  const idx = ZONE_ORDER.indexOf(zone as any);
  return idx === -1 ? 99 : idx;
}

function compareByRoute(a: Ogledziny, b: Ogledziny): number {
  const da = a.data_planowana ? new Date(a.data_planowana).getTime() : Number.MAX_SAFE_INTEGER;
  const db = b.data_planowana ? new Date(b.data_planowana).getTime() : Number.MAX_SAFE_INTEGER;
  if (da !== db) return da - db;
  const cityCmp = normalizeText(a.miasto).localeCompare(normalizeText(b.miasto), 'pl');
  if (cityCmp !== 0) return cityCmp;
  return normalizeText(a.adres).localeCompare(normalizeText(b.adres), 'pl');
}

interface Ogledziny {
  id: number;
  klient_id?: number;
  klient_nazwa: string;
  klient_telefon?: string;
  klient_firma?: string;
  brygadzista_nazwa?: string;
  data_planowana?: string;
  status: Status;
  adres?: string;
  miasto?: string;
  notatki?: string;
  notatki_wyniki?: string;
  wycena_id?: number;
  wartosc_szacowana?: number;
  wycena_status?: string;
  ekipa_id?: number;
  oddzial_id?: number | string;
  wyceniajacy_id?: number | string;
}

type SessionUser = {
  id?: number | string;
  rola?: string;
  oddzial_id?: number | string;
};

type LiveTeamLocation = {
  ekipa_id?: number;
  ekipa_nazwa?: string;
  nr_rejestracyjny?: string;
  recorded_at?: string;
  speed_kmh?: number | null;
  lat?: number;
  lng?: number;
};

export default function OgledzinyScreen() {
  const { theme } = useTheme();
  const { t, language } = useLanguage();
  const dateLocale = language === 'uk' ? 'uk-UA' : language === 'ru' ? 'ru-RU' : 'pl-PL';
  const numberLocale = dateLocale;
  const guard = useOddzialFeatureGuard('/ogledziny');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lista, setLista] = useState<Ogledziny[]>([]);
  const [filterStatus, setFilterStatus] = useState<Status | ''>('');
  const [zoneFilter, setZoneFilter] = useState<string>('');
  const [routeMode, setRouteMode] = useState(false);
  const [zoneMode, setZoneMode] = useState(false);
  const [zoneOverrides, setZoneOverrides] = useState<Record<string, string>>({});
  const [clientZoneDefaults, setClientZoneDefaults] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Ogledziny | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [newStatus, setNewStatus] = useState<Status>('Zaplanowane');
  const [notatki, setNotatki] = useState('');
  const [saving, setSaving] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [runtimeError, setRuntimeError] = useState('');
  const [ekipy, setEkipy] = useState<any[]>([]);
  const [liveLocationsByTeam, setLiveLocationsByTeam] = useState<Record<string, LiveTeamLocation>>({});
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createSaving, setCreateSaving] = useState(false);
  const [createForm, setCreateForm] = useState({
    klient_nazwa: '',
    klient_telefon: '',
    adres: '',
    miasto: '',
    data_planowana: new Date().toISOString().slice(0, 16),
    ekipa_id: '',
    notatki: '',
  });

  const S = makeStyles(theme);

  useEffect(() => {
    (async () => {
      try {
        const [ovRaw, defRaw] = await Promise.all([
          AsyncStorage.getItem(ZONE_OVERRIDE_KEY),
          AsyncStorage.getItem(ZONE_CLIENT_DEFAULT_KEY),
        ]);
        if (ovRaw) setZoneOverrides(JSON.parse(ovRaw));
        if (defRaw) setClientZoneDefaults(JSON.parse(defRaw));
      } catch {
        // ignore malformed local storage
      }
    })();
  }, []);

  useEffect(() => {
    AsyncStorage.setItem(ZONE_OVERRIDE_KEY, JSON.stringify(zoneOverrides)).catch(() => {});
  }, [zoneOverrides]);

  useEffect(() => {
    AsyncStorage.setItem(ZONE_CLIENT_DEFAULT_KEY, JSON.stringify(clientZoneDefaults)).catch(() => {});
  }, [clientZoneDefaults]);

  const fetchLista = useCallback(async () => {
    try {
      const { token: storedToken, user: storedUser } = await getStoredSession();
      if (!storedToken) { router.replace('/login'); return; }
      setToken(storedToken);
      setUser(storedUser);
      await flushOfflineQueue(storedToken);
      const params = filterStatus ? `?status=${filterStatus}` : '';
      const res = await fetch(`${API_URL}/ogledziny${params}`, {
        headers: { Authorization: `Bearer ${storedToken}` },
      });
      const ekipyRes = await fetch(`${API_URL}/ekipy`, {
        headers: { Authorization: `Bearer ${storedToken}` },
      });
      const liveRes = await fetch(`${API_URL}/ekipy/live-locations`, {
        headers: { Authorization: `Bearer ${storedToken}` },
      });
      const data = await res.json();
      const source = Array.isArray(data) ? data : [];
      const userId = storedUser?.id != null ? String(storedUser.id) : '';
      const userOddzialId = storedUser?.oddzial_id != null ? String(storedUser.oddzial_id) : '';
      const scoped = source.filter((item: Ogledziny) => {
        const sameOddzial = !userOddzialId || !item.oddzial_id || String(item.oddzial_id) === userOddzialId;
        const assignedToEstimator = !item.wyceniajacy_id || !userId || String(item.wyceniajacy_id) === userId;
        return sameOddzial && assignedToEstimator;
      });
      setLista(scoped);
      if (ekipyRes.ok) {
        const eData = await ekipyRes.json();
        const rawEkipy = Array.isArray(eData) ? eData : [];
        const filteredEkipy = userOddzialId
          ? rawEkipy.filter((e: any) => String(e.oddzial_id) === userOddzialId)
          : rawEkipy;
        setEkipy(filteredEkipy);
      }
      if (liveRes.ok) {
        const liveData = await liveRes.json();
        const items = Array.isArray(liveData?.items) ? liveData.items : [];
        const map: Record<string, LiveTeamLocation> = {};
        for (const item of items) {
          if (item?.ekipa_id == null) continue;
          map[String(item.ekipa_id)] = item;
        }
        setLiveLocationsByTeam(map);
      }
    } catch {
      setLista([]);
      setRuntimeError('Błąd serwera przy pobieraniu listy oględzin.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [filterStatus]);

  useEffect(() => { fetchLista(); }, [fetchLista]);
  useEffect(() => {
    const timer = setInterval(() => {
      fetchLista();
    }, 60000);
    return () => clearInterval(timer);
  }, [fetchLista]);

  const onRefresh = () => { setRefreshing(true); fetchLista(); };

  const resetCreateForm = () => {
    setCreateForm({
      klient_nazwa: '',
      klient_telefon: '',
      adres: '',
      miasto: '',
      data_planowana: new Date().toISOString().slice(0, 16),
      ekipa_id: '',
      notatki: '',
    });
  };

  const handleCreate = async () => {
    if (!createForm.klient_nazwa.trim() || !createForm.data_planowana.trim()) return;
    setCreateSaving(true);
    try {
      if (!token) { router.replace('/login'); return; }
      const body = {
        klient_nazwa: createForm.klient_nazwa.trim(),
        klient_telefon: createForm.klient_telefon.trim() || null,
        adres: createForm.adres.trim() || null,
        miasto: createForm.miasto.trim() || null,
        data_planowana: createForm.data_planowana,
        status: 'Zaplanowane',
        notatki: createForm.notatki.trim() || null,
        bezplatne: true,
        ekipa_id: createForm.ekipa_id ? Number(createForm.ekipa_id) : null,
        oddzial_id: user?.oddzial_id ?? null,
        wyceniajacy_id: user?.id ?? null,
      };
      const res = await fetch(`${API_URL}/ogledziny`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        await enqueueOfflineRequest({
          url: `${API_URL}/ogledziny`,
          method: 'POST',
          body: body as Record<string, unknown>,
        });
        void triggerHaptic('warning');
      }
      setShowCreateModal(false);
      resetCreateForm();
      await fetchLista();
      void triggerHaptic('success');
    } catch {
      await enqueueOfflineRequest({
        url: `${API_URL}/ogledziny`,
        method: 'POST',
        body: {
          ...createForm,
          bezplatne: true,
          status: 'Zaplanowane',
          ekipa_id: createForm.ekipa_id ? Number(createForm.ekipa_id) : null,
          oddzial_id: user?.oddzial_id ?? null,
          wyceniajacy_id: user?.id ?? null,
        },
      });
      setShowCreateModal(false);
      resetCreateForm();
      await fetchLista();
      setRuntimeError('Błąd serwera przy tworzeniu oględzin. Zapisano do kolejki offline.');
      void triggerHaptic('error');
    } finally {
      setCreateSaving(false);
    }
  };

  const openDetail = (item: Ogledziny) => {
    setSelected(item);
    setShowDetail(true);
  };

  const openStatusModal = () => {
    if (!selected) return;
    setNewStatus(selected.status);
    setNotatki(selected.notatki_wyniki || '');
    setShowDetail(false);
    setShowStatusModal(true);
  };

  const handleChangeStatus = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      if (!token) { router.replace('/login'); return; }
      const payload = { status: newStatus, notatki_wyniki: notatki || null };
      const res = await fetch(`${API_URL}/ogledziny/${selected.id}/status`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        await enqueueOfflineRequest({
          url: `${API_URL}/ogledziny/${selected.id}/status`,
          method: 'PUT',
          body: payload as Record<string, unknown>,
        });
        setShowStatusModal(false);
        await fetchLista();
        void triggerHaptic('warning');
        return;
      }
      setShowStatusModal(false);
      await fetchLista();
      void triggerHaptic('success');
    } catch {
      await enqueueOfflineRequest({
        url: `${API_URL}/ogledziny/${selected.id}/status`,
        method: 'PUT',
        body: { status: newStatus, notatki_wyniki: notatki || null },
      });
      setShowStatusModal(false);
      setRuntimeError('Błąd serwera przy zmianie statusu. Zapisano do kolejki offline.');
      void triggerHaptic('error');
    } finally {
      setSaving(false);
    }
  };

  const fmtDate = (d?: string) => {
    if (!d) return t('inspections.noDate');
    return new Date(d).toLocaleString(dateLocale, {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  };
  const fmtGpsAge = (iso?: string) => {
    if (!iso) return 'brak czasu';
    const diffMin = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
    if (diffMin < 1) return 'teraz';
    if (diffMin < 60) return `${diffMin} min temu`;
    const h = Math.floor(diffMin / 60);
    const m = diffMin % 60;
    return `${h}h ${m}m temu`;
  };
  const gpsState = (live?: LiveTeamLocation) => {
    const ageMin = live?.recorded_at ? (Date.now() - new Date(live.recorded_at).getTime()) / 60000 : Number.POSITIVE_INFINITY;
    const speed = Number(live?.speed_kmh || 0);
    if (ageMin > 15) return { label: 'stary sygnał', color: '#F87171' };
    if (speed > 5) return { label: 'jazda', color: '#34D399' };
    return { label: 'postój', color: '#60A5FA' };
  };
  const liveTeamList = Object.values(liveLocationsByTeam)
    .filter((x) => x?.ekipa_id != null)
    .sort((a, b) => String(a.ekipa_nazwa || '').localeCompare(String(b.ekipa_nazwa || ''), 'pl'));

  const zoneFor = (item: Ogledziny) =>
    zoneOverrides[String(item.id)] || (item.klient_id != null ? clientZoneDefaults[String(item.klient_id)] : undefined) || detectKrakowZone(item);
  const setInspectionZoneOverride = (inspectionId: number, zone: string) => {
    setZoneOverrides((prev) => {
      const next = { ...prev };
      if (!zone) delete next[String(inspectionId)];
      else next[String(inspectionId)] = zone;
      return next;
    });
  };
  const setClientDefaultZone = (clientId: number | undefined, zone: string) => {
    if (clientId == null) return;
    setClientZoneDefaults((prev) => {
      const next = { ...prev };
      if (!zone) delete next[String(clientId)];
      else next[String(clientId)] = zone;
      return next;
    });
  };
  const filteredByZone = zoneFilter ? lista.filter((item) => zoneFor(item) === zoneFilter) : lista;
  const displayLista = routeMode
    ? [...filteredByZone].sort((a, b) => {
        if (zoneMode) {
          const zr = zoneRank(zoneFor(a)) - zoneRank(zoneFor(b));
          if (zr !== 0) return zr;
        }
        return compareByRoute(a, b);
      })
    : filteredByZone;

  const renderItem = ({ item }: { item: Ogledziny }) => {
    const sc = statusColor(item.status, theme);
    const zone = zoneFor(item);
    const routeIndex = displayLista.findIndex((x) => x.id === item.id);
    const live = item.ekipa_id != null ? liveLocationsByTeam[String(item.ekipa_id)] : undefined;
    return (
      <TouchableOpacity style={S.card} onPress={() => openDetail(item)} activeOpacity={0.7}>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
            <Text style={S.cardTitle} numberOfLines={1}>
              {routeMode && routeIndex >= 0 ? `${routeIndex + 1}. ` : ''}
              {item.klient_nazwa?.trim() || t('inspections.unknownClient')}
            </Text>
            <View style={[S.statusBadge, { backgroundColor: sc + '22' }]}>
              <Text style={[S.statusText, { color: sc }]}>{inspectionStatusLabel(item.status, t)}</Text>
            </View>
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 4 }}>
            <Ionicons name="calendar-outline" size={13} color={theme.textMuted} />
            <Text style={S.cardSub}>{fmtDate(item.data_planowana)}</Text>
          </View>

          {(item.adres || item.miasto) && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 4 }}>
              <Ionicons name="location-outline" size={13} color={theme.textMuted} />
              <Text style={S.cardMuted} numberOfLines={1}>
                {[item.adres, item.miasto].filter(Boolean).join(', ')}
              </Text>
            </View>
          )}

          {item.klient_telefon && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              <Ionicons name="call-outline" size={13} color={theme.textMuted} />
              <Text style={S.cardMuted}>{item.klient_telefon}</Text>
            </View>
          )}
          <View style={{ marginTop: 7, flexDirection: 'row', alignItems: 'center' }}>
            <View style={[S.statusBadge, { backgroundColor: (ZONE_COLOR[zone as keyof typeof ZONE_COLOR] || theme.textMuted) + '22' }]}>
              <Text style={[S.statusText, { color: ZONE_COLOR[zone as keyof typeof ZONE_COLOR] || theme.textMuted }]}>
                {ZONE_LABEL[zone] || zone}
              </Text>
            </View>
          </View>
          {live ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 5 }}>
              <Ionicons name="navigate-outline" size={13} color={theme.textMuted} />
              <Text style={S.cardMuted}>
                GPS: {fmtGpsAge(live.recorded_at)}
                {live.speed_kmh != null ? ` • ${Math.round(Number(live.speed_kmh))} km/h` : ''}
              </Text>
            </View>
          ) : null}
        </View>
      </TouchableOpacity>
    );
  };

  if (guard.ready && !guard.allowed) {
    return <View style={S.container} />;
  }

  return (
    <View style={S.container}>
      <StatusBar
        barStyle={theme.name === 'dark' ? 'light-content' : 'dark-content'}
        backgroundColor={theme.headerBg}
      />

      {/* Header */}
      <View style={S.header}>
        <TouchableOpacity onPress={() => router.back()} style={S.backBtn}>
          <Ionicons name="arrow-back" size={22} color={theme.headerText} />
        </TouchableOpacity>
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Ionicons name="search-outline" size={20} color={theme.headerText} />
          <Text style={S.headerTitle}>{t('inspections.title')}</Text>
        </View>
        <TouchableOpacity
          onPress={() => setShowCreateModal(true)}
          style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center' }}
        >
          <Ionicons name="add-circle-outline" size={22} color={theme.headerText} />
        </TouchableOpacity>
        <Text style={S.headerCount}>{displayLista.length}</Text>
      </View>
      <View style={S.platinumBar}>
        <Ionicons name="diamond-outline" size={14} color={theme.accent} />
        <Text style={S.platinumBarText}>Platinum Field Intelligence</Text>
      </View>
      {runtimeError ? (
        <View style={S.errorBar}>
          <Ionicons name="warning-outline" size={14} color={theme.warning} />
          <Text style={S.errorBarText}>{runtimeError}</Text>
        </View>
      ) : null}

      {/* Filtry */}
      <View style={S.filterRow}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 12 }}>
          <FilterChip
            label={t('inspections.filterAll')}
            active={filterStatus === ''}
            color={theme.accent}
            theme={theme}
            onPress={() => setFilterStatus('')}
          />
          {STATUSY.map(s => (
            <FilterChip
              key={s}
              label={inspectionStatusLabel(s, t)}
              active={filterStatus === s}
              color={statusColor(s, theme)}
              theme={theme}
              onPress={() => setFilterStatus(s)}
            />
          ))}
        </ScrollView>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 12, paddingTop: 8 }}>
          <FilterChip label="Wszystkie strefy" active={zoneFilter === ''} color={theme.accent} theme={theme} onPress={() => setZoneFilter('')} />
          {Object.entries(ZONE_LABEL).map(([zone, label]) => (
            <FilterChip
              key={zone}
              label={label}
              active={zoneFilter === zone}
              color={ZONE_COLOR[zone as keyof typeof ZONE_COLOR] || theme.textMuted}
              theme={theme}
              onPress={() => setZoneFilter(zone)}
            />
          ))}
        </ScrollView>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 12, paddingTop: 8 }}>
          <FilterChip
            label={routeMode ? 'Widok standard' : 'Ułóż trasę'}
            active={routeMode}
            color={theme.success}
            theme={theme}
            onPress={() => setRouteMode((v) => !v)}
          />
          <FilterChip
            label={zoneMode ? 'Bez stref' : 'Tryb 4 stref'}
            active={zoneMode}
            color={theme.info}
            theme={theme}
            onPress={() => setZoneMode((v) => !v)}
          />
        </ScrollView>
        {liveTeamList.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 12, paddingTop: 8, paddingBottom: 4 }}>
            {liveTeamList.map((live) => {
              const state = gpsState(live);
              return (
                <View
                  key={`${live.ekipa_id}-${live.nr_rejestracyjny || 'vehicle'}`}
                  style={{
                    backgroundColor: theme.surface2,
                    borderWidth: 1,
                    borderColor: theme.border,
                    borderRadius: 10,
                    paddingVertical: 6,
                    paddingHorizontal: 9,
                    minWidth: 180,
                  }}
                >
                  <Text style={{ fontSize: 11, fontWeight: '700', color: theme.text }}>
                    {live.ekipa_nazwa || `Ekipa #${live.ekipa_id}`}
                  </Text>
                  <Text style={{ fontSize: 11, color: theme.textMuted }}>
                    GPS: {fmtGpsAge(live.recorded_at)}
                    {live.speed_kmh != null ? ` • ${Math.round(Number(live.speed_kmh))} km/h` : ''}
                  </Text>
                  <Text style={{ fontSize: 10, color: state.color, fontWeight: '700' }}>
                    {state.label}
                  </Text>
                </View>
              );
            })}
          </ScrollView>
        ) : null}
      </View>

      {!guard.ready || loading ? (
        <View style={S.center}>
          <ActivityIndicator size="large" color={theme.accent} />
        </View>
      ) : (
        <FlatList
          data={displayLista}
          keyExtractor={item => item.id.toString()}
          renderItem={renderItem}
          contentContainerStyle={{ padding: 12, paddingBottom: 40 }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.accent} />}
          ListEmptyComponent={
            <View style={S.emptyBox}>
              <Ionicons name="search-outline" size={48} color={theme.textMuted} />
              <Text style={S.emptyText}>{t('inspections.empty')}</Text>
              <Text style={[S.emptyText, { fontSize: 13 }]}>{t('inspections.emptySub')}</Text>
            </View>
          }
        />
      )}

      {/* ── MODAL: szczegóły ── */}
      <Modal visible={showDetail} animationType="slide" transparent onRequestClose={() => setShowDetail(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={S.modalOverlay}>
          <View style={S.modalBox}>
            {selected && (
              <>
                <View style={S.modalHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={S.modalTitle}>{selected.klient_nazwa?.trim()}</Text>
                    {selected.klient_firma && (
                      <Text style={[S.modalSub, { color: theme.accent }]}>{selected.klient_firma}</Text>
                    )}
                  </View>
                  <TouchableOpacity onPress={() => setShowDetail(false)} style={S.modalClose}>
                    <Ionicons name="close" size={22} color={theme.textMuted} />
                  </TouchableOpacity>
                </View>

                <ScrollView
                  style={{ flex: 1 }}
                  showsVerticalScrollIndicator={false}
                  keyboardShouldPersistTaps="handled"
                  keyboardDismissMode="on-drag"
                  automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
                >
                  <View style={{ padding: 16 }}>

                    {/* Status */}
                    <View style={[S.statusRow, { backgroundColor: statusColor(selected.status, theme) + '18' }]}>
                      <Ionicons name="flag-outline" size={16} color={statusColor(selected.status, theme)} />
                      <Text style={[S.statusRowText, { color: statusColor(selected.status, theme) }]}>
                        {inspectionStatusLabel(selected.status, t)}
                      </Text>
                    </View>

                    {/* Sekcja: termin */}
                    <SectionHeader icon="calendar-outline" label={t('inspections.sectionWhenWhere')} theme={theme} />
                    <InfoRow icon="calendar-outline" label={t('inspections.labelDate')} value={fmtDate(selected.data_planowana)} theme={theme} />
                    <InfoRow icon="location-outline" label={t('inspections.labelAddress')} value={[selected.adres, selected.miasto].filter(Boolean).join(', ') || undefined} theme={theme} />
                    {selected.adres || selected.miasto ? (
                      <TouchableOpacity
                        style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 }}
                        onPress={() => { void openAddressInMaps(selected.adres || '', selected.miasto || ''); }}
                      >
                        <Ionicons name="map-outline" size={18} color={theme.accent} />
                        <Text style={{ color: theme.accent, fontWeight: '600' }}>{t('inspections.openMaps')}</Text>
                      </TouchableOpacity>
                    ) : null}

                    <SectionHeader icon="git-branch-outline" label="Strefa trasy" theme={theme} />
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                      <FilterChip
                        label="Auto"
                        active={!zoneOverrides[String(selected.id)]}
                        color={theme.accent}
                        theme={theme}
                        onPress={() => setInspectionZoneOverride(selected.id, '')}
                      />
                      {Object.entries(ZONE_LABEL).map(([zone, label]) => (
                        <FilterChip
                          key={zone}
                          label={label}
                          active={zoneOverrides[String(selected.id)] === zone}
                          color={ZONE_COLOR[zone as keyof typeof ZONE_COLOR] || theme.textMuted}
                          theme={theme}
                          onPress={() => setInspectionZoneOverride(selected.id, zone)}
                        />
                      ))}
                    </ScrollView>
                    <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                      <TouchableOpacity
                        style={[S.footerBtn, { backgroundColor: theme.surface2, borderWidth: 1, borderColor: theme.border, flex: 1 }]}
                        onPress={() => setClientDefaultZone(selected.klient_id, zoneFor(selected))}
                      >
                        <Text style={[S.footerBtnText, { color: theme.textSub, fontSize: 13 }]}>Ustaw domyślną dla klienta</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[S.footerBtn, { backgroundColor: theme.surface2, borderWidth: 1, borderColor: theme.border, flex: 1 }]}
                        onPress={() => setClientDefaultZone(selected.klient_id, '')}
                      >
                        <Text style={[S.footerBtnText, { color: theme.textSub, fontSize: 13 }]}>Usuń domyślną</Text>
                      </TouchableOpacity>
                    </View>

                    {/* Sekcja: klient */}
                    <SectionHeader icon="person-outline" label={t('inspections.sectionClient')} theme={theme} />
                    <InfoRow icon="call-outline" label={t('inspections.labelPhone')} value={selected.klient_telefon} theme={theme} />

                    {/* Notatki */}
                    {selected.notatki && (
                      <>
                        <SectionHeader icon="document-text-outline" label={t('inspections.sectionNotes')} theme={theme} />
                        <View style={[S.notatkiBox, { backgroundColor: theme.surface2 }]}>
                          <Text style={[S.notatkiText, { color: theme.text }]}>{selected.notatki}</Text>
                        </View>
                      </>
                    )}

                    {/* Wyniki */}
                    {selected.notatki_wyniki && (
                      <>
                        <SectionHeader icon="checkmark-circle-outline" label={t('inspections.sectionResults')} theme={theme} />
                        <View style={[S.notatkiBox, { backgroundColor: theme.accentLight || theme.surface2 }]}>
                          <Text style={[S.notatkiText, { color: theme.text }]}>{selected.notatki_wyniki}</Text>
                        </View>
                      </>
                    )}

                    {/* Wycena */}
                    {selected.wycena_id && (
                      <>
                        <SectionHeader icon="layers-outline" label={t('inspections.sectionLinkedQuote')} theme={theme} />
                        <View style={[S.wycenaRow, { backgroundColor: theme.surface2, borderColor: theme.border }]}>
                          <View style={{ flex: 1 }}>
                            <Text style={[S.wycenaTitle, { color: theme.text }]}>{t('inspections.linkedQuoteTitle', { id: selected.wycena_id })}</Text>
                            {selected.wartosc_szacowana != null && (
                              <Text style={[S.wycenaVal, { color: theme.accent }]}>
                                {Number(selected.wartosc_szacowana).toLocaleString(numberLocale)} {t('wyceny.currency')}
                              </Text>
                            )}
                          </View>
                          {selected.wycena_status && (
                            <View style={[S.statusBadge, { backgroundColor: theme.accent + '22' }]}>
                              <Text style={[S.statusText, { color: theme.accent }]}>{quoteStatusLabel(selected.wycena_status, t)}</Text>
                            </View>
                          )}
                        </View>
                      </>
                    )}

                  </View>
                </ScrollView>

                <View style={S.modalFooter}>
                  <PlatinumCTA
                    label={t('inspections.btnChangeStatus')}
                    style={S.footerBtn}
                    onPress={() => {
                      void triggerHaptic('light');
                      openStatusModal();
                    }}
                  />
                  <TouchableOpacity
                    style={[S.footerBtn, { backgroundColor: theme.surface2, borderWidth: 1, borderColor: theme.border }]}
                    onPress={() => {
                      if (!selected) return;
                      void triggerHaptic('light');
                      router.push({
                        pathname: '/ogledziny-dokumentacja' as never,
                        params: {
                          ogledzinyId: String(selected.id),
                          wycenaId: selected.wycena_id ? String(selected.wycena_id) : '',
                          klient: selected.klient_nazwa || '',
                        },
                      });
                    }}
                  >
                    <Ionicons name="camera-outline" size={17} color={theme.text} />
                    <Text style={[S.footerBtnText, { color: theme.text }]}>{t('inspections.btnMobileDocs')}</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── MODAL: zmiana statusu ── */}
      <Modal visible={showStatusModal} animationType="slide" transparent onRequestClose={() => setShowStatusModal(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={S.modalOverlay}>
          <View style={[S.modalBox, { maxHeight: '75%' }]}>
            <View style={S.modalHeader}>
              <Text style={S.modalTitle}>{t('inspections.statusModalTitle')}</Text>
              <TouchableOpacity onPress={() => setShowStatusModal(false)} style={S.modalClose}>
                <Ionicons name="close" size={22} color={theme.textMuted} />
              </TouchableOpacity>
            </View>
            <ScrollView
              style={{ flex: 1 }}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
            >
              <View style={{ padding: 16 }}>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 20 }}>
                  {STATUSY.map(s => {
                    const sc = statusColor(s, theme);
                    const active = newStatus === s;
                    return (
                      <TouchableOpacity
                        key={s}
                        onPress={() => setNewStatus(s)}
                        style={[
                          S.statusChip,
                          {
                            borderColor: active ? sc : theme.border,
                            backgroundColor: active ? sc + '18' : theme.surface2,
                          },
                        ]}
                      >
                        <Text style={[S.statusChipText, { color: active ? sc : theme.textMuted }]}>
                          {inspectionStatusLabel(s, t)}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <Text style={[S.fieldLabel, { color: theme.textMuted }]}>{t('inspections.resultsNotesLabel')}</Text>
                <TextInput
                  style={[S.textarea, { backgroundColor: theme.inputBg, borderColor: theme.inputBorder, color: theme.inputText }]}
                  multiline
                  numberOfLines={4}
                  textAlignVertical="top"
                  placeholder={t('inspections.resultsPlaceholder')}
                  placeholderTextColor={theme.inputPlaceholder}
                  value={notatki}
                  onChangeText={setNotatki}
                />
              </View>
            </ScrollView>
            <View style={S.modalFooter}>
              <TouchableOpacity
                style={[S.footerBtn, { backgroundColor: theme.surface2, borderWidth: 1, borderColor: theme.border }]}
                onPress={() => {
                  void triggerHaptic('light');
                  setShowStatusModal(false);
                }}
              >
                <Text style={[S.footerBtnText, { color: theme.textSub }]}>{t('common.cancel')}</Text>
              </TouchableOpacity>
              <PlatinumCTA
                label={t('inspections.btnSave')}
                style={[S.footerBtn, { flex: 1 }]}
                onPress={handleChangeStatus}
                disabled={saving}
                loading={saving}
              />
            </View>
          </View>
        </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── MODAL: nowe oględziny ── */}
      <Modal visible={showCreateModal} animationType="slide" transparent onRequestClose={() => setShowCreateModal(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={S.modalOverlay}>
          <View style={[S.modalBox, { maxHeight: '80%' }]}>
            <View style={S.modalHeader}>
              <Text style={S.modalTitle}>{t('inspections.createTitle')}</Text>
              <TouchableOpacity onPress={() => setShowCreateModal(false)} style={S.modalClose}>
                <Ionicons name="close" size={22} color={theme.textMuted} />
              </TouchableOpacity>
            </View>
            <ScrollView
              style={{ flex: 1 }}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
              contentContainerStyle={{ paddingBottom: 16 }}
            >
              <View style={{ padding: 16 }}>
                <Text style={[S.fieldLabel, { color: theme.textMuted }]}>{t('inspections.labelClientStar')}</Text>
                <TextInput
                  style={[S.textarea, { minHeight: 48, backgroundColor: theme.inputBg, borderColor: theme.inputBorder, color: theme.inputText }]}
                  value={createForm.klient_nazwa}
                  onChangeText={(v) => setCreateForm((p) => ({ ...p, klient_nazwa: v }))}
                  placeholder={t('inspections.phClient')}
                  placeholderTextColor={theme.inputPlaceholder}
                />
                <Text style={[S.fieldLabel, { color: theme.textMuted }]}>{t('inspections.labelPhone')}</Text>
                <TextInput
                  style={[S.textarea, { minHeight: 48, backgroundColor: theme.inputBg, borderColor: theme.inputBorder, color: theme.inputText }]}
                  value={createForm.klient_telefon}
                  onChangeText={(v) => setCreateForm((p) => ({ ...p, klient_telefon: v }))}
                  placeholder={t('inspections.phPhone')}
                  placeholderTextColor={theme.inputPlaceholder}
                  keyboardType="phone-pad"
                />
                <Text style={[S.fieldLabel, { color: theme.textMuted }]}>{t('inspections.labelDateTime')}</Text>
                <TextInput
                  style={[S.textarea, { minHeight: 48, backgroundColor: theme.inputBg, borderColor: theme.inputBorder, color: theme.inputText }]}
                  value={createForm.data_planowana}
                  onChangeText={(v) => setCreateForm((p) => ({ ...p, data_planowana: v }))}
                  placeholder={t('inspections.phDateTime')}
                  placeholderTextColor={theme.inputPlaceholder}
                />
                <Text style={[S.fieldLabel, { color: theme.textMuted }]}>{t('inspections.labelAddressBlock')}</Text>
                <TextInput
                  style={[S.textarea, { minHeight: 48, backgroundColor: theme.inputBg, borderColor: theme.inputBorder, color: theme.inputText }]}
                  value={createForm.adres}
                  onChangeText={(v) => setCreateForm((p) => ({ ...p, adres: v }))}
                  placeholder={t('inspections.phAddress')}
                  placeholderTextColor={theme.inputPlaceholder}
                />
                <TextInput
                  style={[S.textarea, { minHeight: 48, backgroundColor: theme.inputBg, borderColor: theme.inputBorder, color: theme.inputText }]}
                  value={createForm.miasto}
                  onChangeText={(v) => setCreateForm((p) => ({ ...p, miasto: v }))}
                  placeholder={t('inspections.phCity')}
                  placeholderTextColor={theme.inputPlaceholder}
                />
                <Text style={[S.fieldLabel, { color: theme.textMuted }]}>{t('inspections.labelTeam')}</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 4 }}>
                  <TouchableOpacity
                    onPress={() => setCreateForm((p) => ({ ...p, ekipa_id: '' }))}
                    style={[
                      S.statusChip,
                      { borderColor: createForm.ekipa_id === '' ? theme.accent : theme.border, backgroundColor: theme.surface2 },
                    ]}
                  >
                    <Text style={[S.statusChipText, { color: createForm.ekipa_id === '' ? theme.accent : theme.textSub }]}>{t('inspections.teamNone')}</Text>
                  </TouchableOpacity>
                  {ekipy.map((ekipa) => {
                    const id = String(ekipa.id);
                    const active = createForm.ekipa_id === id;
                    return (
                      <TouchableOpacity
                        key={id}
                        onPress={() => setCreateForm((p) => ({ ...p, ekipa_id: id }))}
                        style={[
                          S.statusChip,
                          { borderColor: active ? theme.accent : theme.border, backgroundColor: active ? theme.accent + '18' : theme.surface2 },
                        ]}
                      >
                        <Text style={[S.statusChipText, { color: active ? theme.accent : theme.textSub }]}>{ekipa.nazwa || `Ekipa #${id}`}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
                <Text style={[S.fieldLabel, { color: theme.textMuted }]}>{t('inspections.labelNotes')}</Text>
                <TextInput
                  style={[S.textarea, { backgroundColor: theme.inputBg, borderColor: theme.inputBorder, color: theme.inputText }]}
                  value={createForm.notatki}
                  onChangeText={(v) => setCreateForm((p) => ({ ...p, notatki: v }))}
                  placeholder={t('inspections.phScopeNotes')}
                  placeholderTextColor={theme.inputPlaceholder}
                  multiline
                />
              </View>
            </ScrollView>
            <View style={S.modalFooter}>
              <TouchableOpacity
                style={[S.footerBtn, { backgroundColor: theme.surface2, borderWidth: 1, borderColor: theme.border }]}
                onPress={() => {
                  void triggerHaptic('light');
                  setShowCreateModal(false);
                }}
              >
                <Text style={[S.footerBtnText, { color: theme.textSub }]}>{t('common.cancel')}</Text>
              </TouchableOpacity>
              <PlatinumCTA
                label={t('inspections.btnSave')}
                style={[S.footerBtn, { flex: 1 }]}
                onPress={handleCreate}
                disabled={createSaving}
                loading={createSaving}
              />
            </View>
          </View>
        </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

// ─── Pomocnicze komponenty ────────────────────────────────────────────────────
function FilterChip({ label, active, color, theme, onPress }: {
  label: string; active: boolean; color: string; theme: Theme; onPress: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={{
        paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20,
        borderWidth: 1,
        borderColor: active ? color : theme.border,
        backgroundColor: active ? color + '18' : theme.surface2,
      }}
    >
      <Text style={{ fontSize: 12, fontWeight: '700', color: active ? color : theme.textMuted }}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

function SectionHeader({ icon, label, theme }: { icon: string; label: string; theme: Theme }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 18, marginBottom: 8 }}>
      <Ionicons name={icon as any} size={14} color={theme.accent} />
      <Text style={{ fontSize: 11, fontWeight: '700', color: theme.textMuted, textTransform: 'uppercase', letterSpacing: 1 }}>
        {label}
      </Text>
    </View>
  );
}

function InfoRow({ icon, label, value, theme }: {
  icon: string; label: string; value?: string; theme: Theme;
}) {
  if (!value) return null;
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Ionicons name={icon as any} size={14} color={theme.textMuted} />
        <Text style={{ fontSize: 13, color: theme.textMuted }}>{label}</Text>
      </View>
      <Text style={{ fontSize: 13, fontWeight: '600', color: theme.text, flex: 1, textAlign: 'right', marginLeft: 12 }}>
        {value}
      </Text>
    </View>
  );
}

// ─── Style ────────────────────────────────────────────────────────────────────
const makeStyles = (t: Theme) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: {
    backgroundColor: t.headerBg, paddingHorizontal: 16,
    paddingTop: 56, paddingBottom: 14,
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderBottomWidth: 1, borderBottomColor: t.accent + '55',
  },
  backBtn: { width: 36, height: 36, justifyContent: 'center', alignItems: 'center' },
  headerTitle: { fontSize: 18, fontWeight: '800', color: t.headerText, flex: 1, letterSpacing: 0.35 },
  headerCount: { fontSize: 13, color: t.textMuted, fontWeight: '600' },
  platinumBar: {
    marginHorizontal: 12,
    marginTop: 10,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: t.accent + '88',
    backgroundColor: t.accent + '1F',
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  platinumBarText: {
    color: t.accent,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
  },
  errorBar: {
    marginHorizontal: 12,
    marginTop: 8,
    marginBottom: 2,
    borderWidth: 1,
    borderColor: t.warning + '66',
    backgroundColor: t.warning + '1A',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  errorBarText: { color: t.warning, fontSize: 12, fontWeight: '700', flex: 1 },
  filterRow: {
    paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: t.accent + '2E',
    backgroundColor: t.cardBg,
  },

  card: {
    backgroundColor: t.cardBg, padding: 14, borderRadius: 14,
    marginBottom: 10, borderWidth: 1, borderColor: t.accent + '2E',
    elevation: 1,
  },
  cardTitle: { fontSize: 15, fontWeight: '800', color: t.text, flex: 1, letterSpacing: 0.2 },
  cardSub: { fontSize: 12, color: t.textSub },
  cardMuted: { fontSize: 12, color: t.textMuted, flex: 1 },

  statusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, borderWidth: 1, borderColor: t.accent + '44' },
  statusText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.2 },

  emptyBox: { alignItems: 'center', paddingTop: 60, gap: 10 },
  emptyText: { color: t.textMuted, fontSize: 15, textAlign: 'center' },

  // Modal
  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(5,8,15,0.9)',
    justifyContent: 'flex-end',
  },
  modalBox: {
    backgroundColor: t.cardBg, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    maxHeight: '90%', minHeight: '50%',
    borderTopWidth: 1, borderColor: t.accent + '4A',
  },
  modalHeader: {
    flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between',
    padding: 16, borderBottomWidth: 1, borderBottomColor: t.border,
  },
  modalTitle: { fontSize: 17, fontWeight: '800', color: t.text, letterSpacing: 0.25 },
  modalSub: { fontSize: 13, marginTop: 2 },
  modalClose: { padding: 4 },
  modalFooter: {
    flexDirection: 'row', gap: 10, padding: 16,
    borderTopWidth: 1, borderTopColor: t.border,
  },
  footerBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, padding: 14, borderRadius: 14, flex: 1,
  },
  footerBtnText: { fontSize: 15, fontWeight: '700' },

  statusRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    padding: 12, borderRadius: 12, marginBottom: 8,
  },
  statusRowText: { fontSize: 14, fontWeight: '700' },

  notatkiBox: {
    borderRadius: 12, padding: 12, marginBottom: 4, borderWidth: 1, borderColor: t.accent + '22',
  },
  notatkiText: { fontSize: 13, lineHeight: 20 },

  wycenaRow: {
    flexDirection: 'row', alignItems: 'center',
    padding: 12, borderRadius: 12, borderWidth: 1, borderColor: t.accent + '33',
  },
  wycenaTitle: { fontSize: 13, fontWeight: '600', marginBottom: 2 },
  wycenaVal: { fontSize: 15, fontWeight: '700' },

  statusChip: {
    paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12, borderWidth: 2,
  },
  statusChipText: { fontSize: 13, fontWeight: '800', letterSpacing: 0.3 },

  fieldLabel: { fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.7, marginBottom: 6 },
  textarea: {
    borderWidth: 1, borderRadius: 12, padding: 12,
    fontSize: 14, minHeight: 100,
  },
});
