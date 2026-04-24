import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTheme } from '../constants/ThemeContext';
import type { Theme } from '../constants/theme';
import {
  ActivityIndicator, Alert, Modal, RefreshControl, ScrollView,
  StyleSheet, Text, TextInput, TouchableOpacity, View, StatusBar, Animated,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { useLanguage } from '../constants/LanguageContext';
import { API_URL } from '../constants/api';
import { PLATINUM_MOTION } from '../constants/motion';
import { KeyboardSafeScreen } from '../components/ui/keyboard-safe-screen';
import { PlatinumIconBadge } from '../components/ui/platinum-icon-badge';
import { PlatinumModalSheet } from '../components/ui/platinum-modal-sheet';
import { PlatinumCTA } from '../components/ui/platinum-cta';
import { useOddzialFeatureGuard } from '../hooks/use-oddzial-feature-guard';
import { getStoredSession } from '../utils/session';
import { filterQuotesForEstimatorRole } from '../utils/estimator-compensation';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { elevationCard } from '../constants/elevation';
import { triggerHaptic } from '../utils/haptics';

const WYCENA_ROLES = ['Wyceniający', 'Kierownik', 'Administrator', 'Dyrektor'];

const USLUGI_OPTIONS: { apiValue: string; labelKey: string }[] = [
  { apiValue: 'Wycinka drzew', labelKey: 'wycenyCal.service.cut' },
  { apiValue: 'Pielęgnacja drzew', labelKey: 'wycenyCal.service.care' },
  { apiValue: 'Karczowanie pni', labelKey: 'wycenyCal.service.stump' },
  { apiValue: 'Zrębkowanie', labelKey: 'wycenyCal.service.chip' },
  { apiValue: 'Pielęgnacja żywopłotu', labelKey: 'wycenyCal.service.hedge' },
  { apiValue: 'Nasadzenia', labelKey: 'wycenyCal.service.plant' },
  { apiValue: 'Trawnik', labelKey: 'wycenyCal.service.lawn' },
  { apiValue: 'Inne', labelKey: 'wycenyCal.service.other' },
];

function approvalStatusColors(theme: Theme) {
  return {
    oczekuje: theme.warning,
    rezerwacja_wstepna: theme.success,
    do_specjalisty: theme.info,
    zatwierdzono: theme.success,
    odrzucono: theme.danger,
  };
}

function makeCalendarStyles(t: Theme) {
  const platinumBorder = t.accent + '88';
  const platinumSoft = t.accent + '22';
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: t.bg },
    bgOrbTop: {
      position: 'absolute',
      top: -120,
      right: -90,
      width: 250,
      height: 250,
      borderRadius: 140,
      backgroundColor: t.accent + '20',
    },
    bgOrbBottom: {
      position: 'absolute',
      bottom: 120,
      left: -80,
      width: 220,
      height: 220,
      borderRadius: 120,
      backgroundColor: t.chartCyan + '14',
    },
    centerFull: { flex: 1, backgroundColor: t.bg, alignItems: 'center', justifyContent: 'center' },
    scroll: { paddingBottom: 40 },

    header: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: 16, paddingTop: 52, paddingBottom: 14,
      backgroundColor: t.headerBg, borderBottomWidth: 1, borderBottomColor: platinumBorder,
      shadowColor: t.shadowColor,
      shadowOpacity: t.shadowOpacity * 0.58,
      shadowRadius: t.shadowRadius * 1.05,
      shadowOffset: { width: 0, height: 5 },
      elevation: t.cardElevation + 1,
    },
    headerTitle: { fontSize: t.fontSection + 2, fontWeight: '800', color: t.headerText, letterSpacing: 0.4 },
    backBtn: { padding: 4 },
    addBtn: {
      width: 34, height: 34, alignItems: 'center', justifyContent: 'center',
      borderRadius: t.radiusSm, borderWidth: 1, borderColor: platinumBorder, backgroundColor: t.surface2,
    },
    addBtnIcon: { width: 24, height: 24, borderRadius: 8 },
    platinumBar: {
      marginHorizontal: 12,
      marginTop: 10,
      marginBottom: 4,
      borderWidth: 1,
      borderColor: platinumBorder,
      backgroundColor: platinumSoft,
      borderRadius: 12,
      paddingVertical: 8,
      paddingHorizontal: 12,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      shadowColor: t.shadowColor,
      shadowOpacity: t.shadowOpacity * 0.35,
      shadowRadius: t.shadowRadius * 0.6,
      shadowOffset: { width: 0, height: 3 },
      elevation: t.cardElevation,
    },
    platinumBarIcon: { width: 22, height: 22, borderRadius: 8 },
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

    monthNav: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: 20, paddingVertical: 16,
    },
    navBtn: {
      backgroundColor: t.surface2, borderRadius: t.radiusSm, padding: 8,
      borderWidth: 1, borderColor: t.border,
    },
    monthLabel: { fontSize: 17, fontWeight: '700', color: t.text },

    calCard: {
      marginHorizontal: 12, backgroundColor: t.cardBg,
      borderRadius: t.radiusLg, padding: 12,
      borderWidth: 1, borderColor: platinumBorder,
      ...elevationCard(t),
    },
    dayNamesRow: { flexDirection: 'row', marginBottom: 6 },
    dayName: {
      flex: 1, textAlign: 'center', fontSize: t.fontCaption,
      fontWeight: '600', color: t.textMuted, paddingVertical: 4,
    },
    weekRow: { flexDirection: 'row' },
    cell: {
      flex: 1, alignItems: 'center', paddingVertical: 6,
      borderRadius: t.radiusSm, margin: 1, minHeight: 44,
    },
    cellToday: { borderWidth: 1, borderColor: t.success },
    cellSelected: { backgroundColor: t.success },
    cellText: { fontSize: 14, color: t.text, fontWeight: '500' },
    cellTextSelected: { color: t.accentText, fontWeight: '700' },
    dotsRow: { flexDirection: 'row', marginTop: 2, gap: 2 },
    dot: { width: 5, height: 5, borderRadius: 3 },

    legend: {
      flexDirection: 'row', justifyContent: 'center', gap: 16,
      paddingVertical: 10,
    },
    legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    legendText: { fontSize: t.fontMicro, color: t.textSub },

    daySection: { marginHorizontal: 12, marginTop: 8 },
    daySectionHeader: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      marginBottom: 8,
    },
    daySectionTitle: { fontSize: 15, fontWeight: '700', color: t.text },
    addDayBtn: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    addDayText: { fontSize: 13, color: t.success, fontWeight: '600' },
    emptyDay: { alignItems: 'center', paddingVertical: 24, gap: 8 },
    emptyDayText: { color: t.textMuted, fontSize: 14 },

    section: { marginHorizontal: 12, marginTop: 16 },
    sectionTitle: { fontSize: 15, fontWeight: '800', color: t.text, marginBottom: 8, letterSpacing: 0.3 },

    wCard: {
      backgroundColor: t.cardBg, borderRadius: t.radiusLg, padding: 14,
      marginBottom: 8, flexDirection: 'row', alignItems: 'center',
      borderWidth: 1, borderColor: platinumBorder,
      ...elevationCard(t),
    },
    wCardLeft: { flex: 1, borderLeftWidth: 3, paddingLeft: 10 },
    wCardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
    wCardTitle: { fontSize: 14, fontWeight: '600', color: t.text, flex: 1, marginRight: 8 },
    wCardMeta: { flexDirection: 'row', flexWrap: 'wrap' },
    wCardMetaText: { fontSize: t.fontMicro, color: t.textSub },
    badge: {
      paddingHorizontal: 7, paddingVertical: 2, borderRadius: t.radiusXs,
      borderWidth: 1, borderColor: platinumBorder,
    },
    badgeText: { fontSize: t.fontMicro, fontWeight: '700', letterSpacing: 0.2 },

    modalOverlay: {
      flex: 1, backgroundColor: 'rgba(5,8,15,0.9)',
      justifyContent: 'flex-end',
    },
    modalSheet: {
      backgroundColor: t.surface2, borderTopLeftRadius: 28, borderTopRightRadius: 28,
      maxHeight: '90%', paddingBottom: 24,
      borderTopWidth: 1, borderTopColor: platinumBorder,
      shadowColor: t.shadowColor,
      shadowOpacity: t.shadowOpacity * 0.42,
      shadowRadius: t.shadowRadius * 0.85,
      shadowOffset: { width: 0, height: -4 },
    },
    modalHeader: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      padding: 20, borderBottomWidth: 1, borderBottomColor: t.border,
      backgroundColor: t.surface3,
    },
    modalTitle: { fontSize: t.fontSection + 3, fontWeight: '800', color: t.text, letterSpacing: 0.4 },
    modalScroll: { paddingHorizontal: 20, paddingTop: 12 },

    label: { fontSize: 12, fontWeight: '800', color: t.textSub, marginBottom: 6, marginTop: 14, textTransform: 'uppercase', letterSpacing: 0.7 },
    required: { color: t.warning },
    input: {
      backgroundColor: t.inputBg, borderRadius: t.radiusMd, borderWidth: 1,
      borderColor: t.inputBorder, color: t.inputText, paddingHorizontal: 14,
      paddingVertical: 10, fontSize: 14,
    },
    inputMulti: { minHeight: 80, textAlignVertical: 'top' },

    pillsScroll: { marginBottom: 6 },
    pill: {
      backgroundColor: t.inputBg, borderRadius: 20, paddingHorizontal: 14,
      paddingVertical: 8, marginRight: 8, borderWidth: 1, borderColor: platinumBorder,
    },
    pillActive: { backgroundColor: t.success, borderColor: t.success },
    pillText: { fontSize: 13, color: t.textSub, fontWeight: '600' },
    pillTextActive: { color: t.accentText, fontWeight: '800' },

    ekipaPill: {
      flexDirection: 'row', alignItems: 'center', gap: 6,
      backgroundColor: t.inputBg, borderRadius: 20, paddingHorizontal: 12,
      paddingVertical: 8, marginRight: 8, borderWidth: 1, borderColor: t.accent + '33',
    },
    ekipaDot: { width: 8, height: 8, borderRadius: 4 },
    ekipaText: { fontSize: 13, color: t.text, fontWeight: '500' },

    helpText: { fontSize: t.fontCaption, color: t.textMuted, textAlign: 'center', marginVertical: 12, lineHeight: 18 },

    submitBtn: {
      backgroundColor: t.success, borderRadius: t.radiusMd, paddingVertical: 14,
      marginHorizontal: 20, marginTop: 8, alignItems: 'center', borderWidth: 1, borderColor: platinumBorder,
      shadowColor: t.shadowColor,
      shadowOpacity: t.shadowOpacity * 0.44,
      shadowRadius: t.shadowRadius * 0.6,
      shadowOffset: { width: 0, height: 3 },
      elevation: t.cardElevation,
    },
    submitBtnDisabled: { opacity: 0.6 },
  });
}

export type CalendarScreenStyles = ReturnType<typeof makeCalendarStyles>;

function wycenaApprovalTabKey(status: string | undefined): string | null {
  switch (status) {
    case 'oczekuje':
      return 'approve.tab.pending';
    case 'rezerwacja_wstepna':
      return 'Rezerwacja wstępna';
    case 'do_specjalisty':
      return 'approve.tab.toSpecialist';
    case 'zatwierdzono':
      return 'approve.tab.approved';
    case 'odrzucono':
      return 'approve.tab.rejected';
    default:
      return null;
  }
}

function pickBestOperationalSlot(slots: { time: string; eta_minutes?: number | null }[], etaThresholdMinutes: number) {
  const withEta = (slots || []).filter((s) => s.eta_minutes != null);
  const safeEta = withEta.filter((s) => Number(s.eta_minutes) <= etaThresholdMinutes);
  if (safeEta.length > 0) return { best: safeEta[0], warning: '' };
  if (withEta.length > 0) return { best: withEta[0], warning: `Brak slotu ETA <= ${etaThresholdMinutes} min. Wybrano najlepszy dostępny.` };
  const fallback = (slots || [])[0] || null;
  return { best: fallback, warning: 'Brak slotów z ETA. Sprawdź GPS/pinezkę klienta.' };
}

export default function WycenaKalendarzScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const { t, language } = useLanguage();
  const guard = useOddzialFeatureGuard('/wycena-kalendarz');
  const approvalColors = useMemo(() => approvalStatusColors(theme), [theme]);
  const s = useMemo(() => makeCalendarStyles(theme), [theme]);
  const [user, setUser] = useState<any>(null);
  const [wyceny, setWyceny] = useState<any[]>([]);
  const [ekipy, setEkipy] = useState<any[]>([]);
  const [oddzialy, setOddzialy] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [runtimeError, setRuntimeError] = useState('');

  // Calendar state
  const today = new Date();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth()); // 0-indexed
  const [selectedDay, setSelectedDay] = useState<number | null>(today.getDate());
  const monthPulse = useState(new Animated.Value(0))[0];

  const monthLocale = language === 'uk' ? 'uk-UA' : language === 'ru' ? 'ru-RU' : 'pl-PL';
  const monthTitleCal = useMemo(
    () => new Date(viewYear, viewMonth, 1).toLocaleDateString(monthLocale, { month: 'long', year: 'numeric' }),
    [viewYear, viewMonth, monthLocale],
  );
  const weekdayCal = useMemo(
    () =>
      Array.from({ length: 7 }, (_, i) =>
        new Date(2024, 0, 1 + i).toLocaleDateString(monthLocale, { weekday: 'short' }),
      ),
    [monthLocale],
  );
  const selectedDateCal = useMemo(() => {
    if (!selectedDay) return '';
    return new Date(viewYear, viewMonth, selectedDay).toLocaleDateString(monthLocale, {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  }, [viewYear, viewMonth, selectedDay, monthLocale]);

  useEffect(() => {
    monthPulse.setValue(0);
    Animated.timing(monthPulse, {
      toValue: 1,
      duration: PLATINUM_MOTION.duration.medium,
      useNativeDriver: true,
    }).start();
  }, [monthPulse, viewMonth, viewYear]);

  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [reserveModal, setReserveModal] = useState<any | null>(null);
  const [reserveDraft, setReserveDraft] = useState<{ ekipa_id: string; data: string; godzina: string; slots: { time: string; score?: number; eta_minutes?: number | null; eta_source?: string | null; eta_unavailable_reason?: string | null }[] }>({
    ekipa_id: '',
    data: '',
    godzina: '08:00',
    slots: [],
  });
  const [reserveDiag, setReserveDiag] = useState<{ eta_available?: boolean; eta_unavailable_reason?: string | null; target_source?: string | null; team_gps_age_min?: number | null } | null>(null);
  const [reserveRuleWarning, setReserveRuleWarning] = useState('');
  const [slotLoading, setSlotLoading] = useState(false);
  const [etaThreshold, setEtaThreshold] = useState(25);
  const [liveByTeam, setLiveByTeam] = useState<Record<string, any>>({});
  const [form, setForm] = useState({
    klient_nazwa: '',
    adres: '',
    miasto: '',
    rodzaj_uslugi: '',
    data_wyceny: formatDate(new Date()),
    godzina: '09:00',
    ekipa_id: '' as string | number,
    oddzial_id: '' as string | number,
    wartosc: '',
    opis: '',
  });

  function formatDate(d: Date) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  const etaReasonLabel = (reason?: string | null) => {
    if (reason === 'no_target_point') return 'brak pinezki klienta';
    if (reason === 'no_team_gps') return 'brak sygnału GPS ekipy';
    return '';
  };

  useEffect(() => {
    (async () => {
      const raw = await AsyncStorage.getItem(`arbor_eta_threshold_${user?.id || 'global'}`);
      const val = Number(raw);
      if ([20, 25, 30].includes(val)) setEtaThreshold(val);
    })();
  }, [user?.id]);

  const setEtaThresholdPersisted = async (next: number) => {
    setEtaThreshold(next);
    await AsyncStorage.setItem(`arbor_eta_threshold_${user?.id || 'global'}`, String(next));
  };

  const loadAll = useCallback(
    async (tokenOverride?: string, sessionUser?: { id?: unknown; rola?: string } | null) => {
      try {
        setRuntimeError('');
        const authToken = tokenOverride || token;
        if (!authToken) {
          router.replace('/login');
          return;
        }
        const u = sessionUser ?? user;
        const headers = { Authorization: `Bearer ${authToken}` };
        const [wRes, eRes, oRes] = await Promise.all([
          fetch(`${API_URL}/wyceny`, { headers }),
          fetch(`${API_URL}/ekipy`, { headers }),
          fetch(`${API_URL}/oddzialy`, { headers }),
        ]);
        const liveRes = await fetch(`${API_URL}/ekipy/live-locations`, { headers }).catch(() => null);
        if (wRes.ok) {
          const wData = await wRes.json();
          let list = Array.isArray(wData) ? wData : wData.wyceny || [];
          list = filterQuotesForEstimatorRole(list, u?.id, u?.rola);
          setWyceny(list);
        }
        if (eRes.ok) setEkipy(await eRes.json());
        if (oRes.ok) setOddzialy(await oRes.json());
        if (liveRes && liveRes.ok) {
          const liveData = await liveRes.json().catch(() => ({ items: [] }));
          const map: Record<string, any> = {};
          const items = Array.isArray(liveData?.items) ? liveData.items : [];
          for (const item of items) {
            if (item?.ekipa_id != null) map[String(item.ekipa_id)] = item;
          }
          setLiveByTeam(map);
        } else {
          setLiveByTeam({});
        }
      } catch {
        setWyceny([]);
        setRuntimeError('Błąd serwera przy pobieraniu kalendarza wycen.');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [token, user],
  );

  const init = useCallback(async () => {
    const { token: storedToken, user: storedUser } = await getStoredSession();
    if (!storedToken) { router.replace('/login'); return; }
    setToken(storedToken);
    if (storedUser) setUser(storedUser);
    await loadAll(storedToken, storedUser ?? undefined);
  }, [loadAll]);

  useEffect(() => { void init(); }, [init]);

  const onRefresh = () => { setRefreshing(true); loadAll(); };

  // ─── Calendar helpers ───────────────────────────────────────────────────────

  const getDaysInMonth = (year: number, month: number) =>
    new Date(year, month + 1, 0).getDate();

  const getFirstDayOfWeek = (year: number, month: number) => {
    // 0=Sun,1=Mon... convert to Mon=0
    const d = new Date(year, month, 1).getDay();
    return (d + 6) % 7;
  };

  const wycenyForDay = (day: number) => {
    const dateStr = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return wyceny.filter(w => {
      const d = (w.data_wykonania || w.created_at || '').slice(0, 10);
      return d === dateStr;
    });
  };

  const selectedWyceny = selectedDay ? wycenyForDay(selectedDay) : [];

  const prevMonth = () => {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); }
    else setViewMonth(m => m - 1);
    setSelectedDay(null);
  };
  const nextMonth = () => {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); }
    else setViewMonth(m => m + 1);
    setSelectedDay(null);
  };

  // ─── Form submit ────────────────────────────────────────────────────────────

  const handleSubmit = async () => {
    if (!form.adres.trim()) { Alert.alert(t('wyceny.alert.saveFail'), t('wycenyCal.alert.address')); return; }
    if (!form.rodzaj_uslugi) { Alert.alert(t('wyceny.alert.saveFail'), t('wycenyCal.alert.service')); return; }
    if (!form.ekipa_id) { Alert.alert(t('wyceny.alert.saveFail'), t('wycenyCal.alert.team')); return; }
    if (!form.data_wyceny) { Alert.alert(t('wyceny.alert.saveFail'), t('wycenyCal.alert.date')); return; }

    setSaving(true);
    try {
      if (!token) { router.replace('/login'); return; }
      const body = {
        klient_nazwa: form.klient_nazwa || 'Wycena',
        adres: form.adres,
        miasto: form.miasto,
        wycena_uwagi: `${form.rodzaj_uslugi}${form.opis ? '\n' + form.opis : ''}`,
        typ_uslugi: form.rodzaj_uslugi,
        data_wykonania: form.data_wyceny,
        godzina_rozpoczecia: form.godzina,
        ekipa_id: form.ekipa_id || null,
        wartosc_planowana: form.wartosc ? parseFloat(form.wartosc) : null,
      };
      const res = await fetch(`${API_URL}/wyceny`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        void triggerHaptic('error');
        Alert.alert(t('wyceny.alert.saveFail'), err.message || t('wycenyCal.alert.saveFail'));
        return;
      }
      void triggerHaptic('success');
      setShowModal(false);
      resetForm();
      loadAll();
      Alert.alert(t('wycenyCal.alert.sentTitle'), t('wycenyCal.alert.sentBody'));
    } catch {
      void triggerHaptic('error');
      Alert.alert(t('wyceny.alert.saveFail'), t('wycenyCal.alert.network'));
      setRuntimeError('Błąd serwera przy zapisie wyceny.');
    } finally {
      setSaving(false);
    }
  };

  const openReserveModal = async (w: any) => {
    const ekipa_id = String(w.proponowana_ekipa_id || w.ekipa_id || '');
    const data = (w.proponowana_data || w.data_wykonania || '').slice(0, 10) || formatDate(new Date());
    const godzina = (w.proponowana_godzina || w.godzina_rozpoczecia || '08:00').slice(0, 5);
    const next = {
      ekipa_id,
      data,
      godzina,
      slots: [] as { time: string; score?: number; eta_minutes?: number | null; eta_source?: string | null; eta_unavailable_reason?: string | null }[],
    };
    setReserveModal(w);
    setReserveDraft(next);
    setReserveDiag(null);
    setReserveRuleWarning('');
    if (ekipa_id) await fetchSlots(next, w.id);
  };

  const fetchSlots = async (draft: { ekipa_id: string; data: string }, wycenaId: number, thresholdOverride: number | null = null) => {
    if (!draft.ekipa_id || !draft.data || !token) return;
    try {
      setSlotLoading(true);
      const res = await fetch(`${API_URL}/wyceny/availability/slots?ekipa_id=${encodeURIComponent(draft.ekipa_id)}&data=${encodeURIComponent(draft.data)}&exclude_wycena_id=${wycenaId}&wycena_id=${wycenaId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      const slots = (Array.isArray(data?.items) ? data.items : []).sort(
        (a: { score?: number }, b: { score?: number }) => (b.score || 0) - (a.score || 0),
      );
      const picked = pickBestOperationalSlot(slots, thresholdOverride ?? etaThreshold);
      setReserveDraft((prev) => ({ ...prev, slots, godzina: picked.best?.time || prev.godzina }));
      setReserveDiag(data?.diagnostics || null);
      setReserveRuleWarning(picked.warning);
    } finally {
      setSlotLoading(false);
    }
  };

  const saveReservation = async () => {
    if (!reserveModal || !token) return;
    if (!reserveDraft.ekipa_id || !reserveDraft.data || !reserveDraft.godzina) {
      Alert.alert('Brak danych', 'Wybierz ekipę, datę i godzinę.');
      return;
    }
    try {
      const res = await fetch(`${API_URL}/wyceny/${reserveModal.id}/rezerwuj-termin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          ekipa_id: reserveDraft.ekipa_id,
          data_wykonania: reserveDraft.data,
          godzina_rozpoczecia: reserveDraft.godzina,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        void triggerHaptic('error');
        Alert.alert('Błąd', err.error || 'Nie udało się zapisać rezerwacji.');
        return;
      }
      void triggerHaptic('success');
      Alert.alert('Gotowe', 'Termin zarezerwowany wstępnie. Czeka na akceptację specjalisty.');
      setReserveModal(null);
      setReserveDiag(null);
      setReserveRuleWarning('');
      loadAll();
    } catch {
      void triggerHaptic('error');
      Alert.alert('Błąd', 'Błąd sieci podczas zapisu rezerwacji.');
      setRuntimeError('Błąd serwera przy zapisie rezerwacji.');
    }
  };

  const resetForm = () => {
    setForm({
      klient_nazwa: '',
      adres: '',
      miasto: '',
      rodzaj_uslugi: '',
      data_wyceny: formatDate(new Date()),
      godzina: '09:00',
      ekipa_id: '',
      oddzial_id: '',
      wartosc: '',
      opis: '',
    });
  };

  const openModal = () => {
    if (selectedDay) {
      const d = new Date(viewYear, viewMonth, selectedDay);
      setForm(f => ({ ...f, data_wyceny: formatDate(d) }));
    }
    setShowModal(true);
  };

  // ─── Access control ─────────────────────────────────────────────────────────
  const canAdd = user && WYCENA_ROLES.includes(user.rola);

  // ─── Render ─────────────────────────────────────────────────────────────────

  if (guard.ready && !guard.allowed) {
    return <View style={s.root} />;
  }
  if (!guard.ready) {
    return (
      <View style={s.centerFull}>
        <ActivityIndicator size="large" color={theme.success} />
      </View>
    );
  }

  if (loading) {
    return (
      <View style={s.centerFull}>
        <ActivityIndicator size="large" color={theme.success} />
      </View>
    );
  }

  const daysInMonth = getDaysInMonth(viewYear, viewMonth);
  const firstDow = getFirstDayOfWeek(viewYear, viewMonth);

  // Build calendar grid cells
  const cells: (number | null)[] = [
    ...Array(firstDow).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  // Pad to full rows
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <KeyboardSafeScreen style={s.root}>
      <View pointerEvents="none" style={s.bgOrbTop} />
      <View pointerEvents="none" style={s.bgOrbBottom} />
      <StatusBar barStyle={theme.name === 'dark' ? 'light-content' : 'dark-content'} backgroundColor={theme.headerBg} />

      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <PlatinumIconBadge icon="arrow-back" color={theme.headerText} size={13} style={{ width: 26, height: 26, borderRadius: 9 }} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>{t('wyceny.calendarTitle')}</Text>
        {canAdd ? (
          <TouchableOpacity onPress={openModal} style={s.addBtn}>
            <PlatinumIconBadge icon="add" color={theme.accent} size={12} style={s.addBtnIcon} />
          </TouchableOpacity>
        ) : <View style={{ width: 36 }} />}
      </View>
      <View style={s.platinumBar}>
        <PlatinumIconBadge icon="diamond-outline" color={theme.accent} size={10} style={s.platinumBarIcon} />
        <Text style={s.platinumBarText}>Platinum Dispatch Console</Text>
      </View>
      {runtimeError ? (
        <View style={s.errorBar}>
          <PlatinumIconBadge icon="warning-outline" color={theme.warning} size={10} style={s.platinumBarIcon} />
          <Text style={s.errorBarText}>{runtimeError}</Text>
        </View>
      ) : null}

      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.success} />}
        contentContainerStyle={s.scroll}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
      >
        {/* Month nav */}
        <View style={s.monthNav}>
          <TouchableOpacity onPress={prevMonth} style={s.navBtn}>
            <PlatinumIconBadge icon="chevron-back" color={theme.text} size={14} style={{ width: 24, height: 24, borderRadius: 8 }} />
          </TouchableOpacity>
          <Animated.View
            style={{
              opacity: monthPulse.interpolate({ inputRange: [0, 1], outputRange: [0.65, 1] }),
              transform: [{ scale: monthPulse.interpolate({ inputRange: [0, 1], outputRange: [0.98, 1] }) }],
            }}
          >
            <Text style={s.monthLabel}>{monthTitleCal}</Text>
          </Animated.View>
          <TouchableOpacity onPress={nextMonth} style={s.navBtn}>
            <PlatinumIconBadge icon="chevron-forward" color={theme.text} size={14} style={{ width: 24, height: 24, borderRadius: 8 }} />
          </TouchableOpacity>
        </View>

        {/* Calendar grid */}
        <View style={s.calCard}>
          {/* Day names */}
          <View style={s.dayNamesRow}>
            {weekdayCal.map((d, wi) => (
              <Text key={`${wi}-${d}`} style={[s.dayName, wi === 6 && { color: theme.danger }]}>{d}</Text>
            ))}
          </View>

          {/* Cells */}
          {Array.from({ length: cells.length / 7 }, (_, ri) => (
            <View key={ri} style={s.weekRow}>
              {cells.slice(ri * 7, ri * 7 + 7).map((day, ci) => {
                if (!day) return <View key={ci} style={s.cell} />;
                const dayWyceny = wycenyForDay(day);
                const isToday = day === today.getDate() && viewMonth === today.getMonth() && viewYear === today.getFullYear();
                const isSelected = day === selectedDay;
                return (
                  <TouchableOpacity
                    key={ci}
                    style={[s.cell, isSelected && s.cellSelected, isToday && !isSelected && s.cellToday]}
                    onPress={() => setSelectedDay(day)}
                  >
                    <Text style={[
                      s.cellText,
                      isSelected && s.cellTextSelected,
                      ci === 6 && { color: theme.danger },
                    ]}>{day}</Text>
                    {/* Status dots */}
                    <View style={s.dotsRow}>
                      {dayWyceny.slice(0, 3).map((w, i) => (
                        <View
                          key={i}
                          style={[s.dot, { backgroundColor: approvalColors[w.status_akceptacji as keyof typeof approvalColors] || theme.textMuted }]}
                        />
                      ))}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          ))}
        </View>

        {/* Legend */}
        <View style={s.legend}>
          {Object.entries(approvalColors).map(([k, c]) => {
            const sk = wycenaApprovalTabKey(k);
            return (
              <View key={k} style={s.legendItem}>
                <View style={[s.dot, { backgroundColor: c }]} />
                <Text style={s.legendText}>{sk ? t(sk) : k}</Text>
              </View>
            );
          })}
        </View>

        {/* Selected day wyceny */}
        {selectedDay !== null && (
          <View style={s.daySection}>
            <View style={s.daySectionHeader}>
              <Text style={s.daySectionTitle}>
                {selectedDateCal}
              </Text>
              {canAdd && (
                <TouchableOpacity onPress={openModal} style={s.addDayBtn}>
                  <PlatinumIconBadge icon="add-circle-outline" color={theme.success} size={12} style={{ width: 22, height: 22, borderRadius: 8 }} />
                  <Text style={s.addDayText}>{t('wycenyCal.newQuote')}</Text>
                </TouchableOpacity>
              )}
            </View>

            {selectedWyceny.length === 0 ? (
              <View style={s.emptyDay}>
                <PlatinumIconBadge icon="calendar-outline" color={theme.textMuted} size={18} style={{ width: 36, height: 36, borderRadius: 12 }} />
                <Text style={s.emptyDayText}>{t('wycenyCal.emptyDay')}</Text>
              </View>
            ) : (
              selectedWyceny.map(w => (
                <WycenaCard key={w.id} wycena={w} ekipy={ekipy} liveByTeam={liveByTeam} theme={theme} s={s} onReserve={() => openReserveModal(w)} />
              ))
            )}
          </View>
        )}

        {/* All upcoming wyceny */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>{t('wycenyCal.sectionAll', { count: wyceny.length })}</Text>
          {wyceny.length === 0 ? (
            <View style={s.emptyDay}>
              <Text style={s.emptyDayText}>{t('wycenyCal.emptyAll')}</Text>
            </View>
          ) : (
            wyceny.slice(0, 20).map(w => (
              <WycenaCard key={w.id} wycena={w} ekipy={ekipy} liveByTeam={liveByTeam} theme={theme} s={s} onReserve={() => openReserveModal(w)} />
            ))
          )}
        </View>
      </ScrollView>

      {/* New Wycena Modal */}
      <Modal visible={showModal} animationType="slide" transparent>
        <KeyboardAvoidingView
          style={s.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top : 0}
        >
          <PlatinumModalSheet visible={showModal} style={s.modalSheet}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>{t('wycenyCal.modalTitle')}</Text>
              <TouchableOpacity onPress={() => { setShowModal(false); resetForm(); }}>
                <PlatinumIconBadge icon="close" color={theme.textSub} size={13} style={{ width: 26, height: 26, borderRadius: 9 }} />
              </TouchableOpacity>
            </View>

            <ScrollView
              style={s.modalScroll}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
            >
              {/* Client name */}
              <Text style={s.label}>{t('wycenyCal.label.client')}</Text>
              <TextInput
                style={s.input}
                placeholder={t('wycenyCal.ph.client')}
                placeholderTextColor={theme.inputPlaceholder}
                value={form.klient_nazwa}
                onChangeText={(txt) => setForm(f => ({ ...f, klient_nazwa: txt }))}
              />

              {/* Address */}
              <Text style={s.label}>{t('wycenyCal.label.address')}</Text>
              <TextInput
                style={s.input}
                placeholder={t('wycenyCal.ph.address')}
                placeholderTextColor={theme.inputPlaceholder}
                value={form.adres}
                onChangeText={(txt) => setForm(f => ({ ...f, adres: txt }))}
              />

              {/* City */}
              <Text style={s.label}>{t('wycenyCal.label.city')}</Text>
              <TextInput
                style={s.input}
                placeholder={t('wycenyCal.ph.city')}
                placeholderTextColor={theme.inputPlaceholder}
                value={form.miasto}
                onChangeText={(txt) => setForm(f => ({ ...f, miasto: txt }))}
              />

              {/* Service type */}
              <Text style={s.label}>{t('wycenyCal.label.service')}</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.pillsScroll}>
                {USLUGI_OPTIONS.map(({ apiValue, labelKey }) => (
                  <TouchableOpacity
                    key={apiValue}
                    style={[s.pill, form.rodzaj_uslugi === apiValue && s.pillActive]}
                    onPress={() => setForm(f => ({ ...f, rodzaj_uslugi: apiValue }))}
                  >
                    <Text style={[s.pillText, form.rodzaj_uslugi === apiValue && s.pillTextActive]}>{t(labelKey)}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              {/* Date */}
              <Text style={s.label}>{t('wycenyCal.label.date')}</Text>
              <TextInput
                style={s.input}
                placeholder={t('wycenyCal.ph.date')}
                placeholderTextColor={theme.inputPlaceholder}
                value={form.data_wyceny}
                onChangeText={(txt) => setForm(f => ({ ...f, data_wyceny: txt }))}
              />

              {/* Time */}
              <Text style={s.label}>{t('wycenyCal.label.time')}</Text>
              <TextInput
                style={s.input}
                placeholder="09:00"
                placeholderTextColor={theme.inputPlaceholder}
                value={form.godzina}
                onChangeText={(txt) => setForm(f => ({ ...f, godzina: txt }))}
              />

              {/* Ekipa — mandatory */}
              <Text style={s.label}>{t('wycenyCal.label.team')} <Text style={s.required}>{t('wycenyCal.teamRequired')}</Text></Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.pillsScroll}>
                {ekipy.map(e => {
                  const active = String(form.ekipa_id) === String(e.id);
                  const color = e.kolor || theme.success;
                  return (
                    <TouchableOpacity
                      key={e.id}
                      style={[s.ekipaPill, active && { backgroundColor: color, borderColor: color }]}
                      onPress={() => setForm(f => ({ ...f, ekipa_id: e.id }))}
                    >
                      <View style={[s.ekipaDot, { backgroundColor: color }]} />
                      <Text style={[s.ekipaText, active && { color: theme.accentText, fontWeight: '700' }]}>
                        {e.nazwa}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              {/* Oddział */}
              {oddzialy.length > 0 && (
                <>
                  <Text style={s.label}>{t('wycenyCal.label.branch')}</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.pillsScroll}>
                    {oddzialy.map(o => (
                      <TouchableOpacity
                        key={o.id}
                        style={[s.pill, String(form.oddzial_id) === String(o.id) && s.pillActive]}
                        onPress={() => setForm(f => ({
                          ...f,
                          oddzial_id: String(form.oddzial_id) === String(o.id) ? '' : o.id,
                        }))}
                      >
                        <Text style={[s.pillText, String(form.oddzial_id) === String(o.id) && s.pillTextActive]}>
                          {o.nazwa}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </>
              )}

              {/* Estimated value */}
              <Text style={s.label}>{t('wycenyCal.label.value')}</Text>
              <TextInput
                style={s.input}
                placeholder="0.00"
                placeholderTextColor={theme.inputPlaceholder}
                keyboardType="decimal-pad"
                value={form.wartosc}
                onChangeText={(txt) => setForm(f => ({ ...f, wartosc: txt }))}
              />

              {/* Notes */}
              <Text style={s.label}>{t('wycenyCal.label.notes')}</Text>
              <TextInput
                style={[s.input, s.inputMulti]}
                placeholder={t('wycenyCal.ph.notes')}
                placeholderTextColor={theme.inputPlaceholder}
                multiline
                numberOfLines={3}
                value={form.opis}
                onChangeText={(txt) => setForm(f => ({ ...f, opis: txt }))}
              />

              <Text style={s.helpText}>
                {t('wycenyCal.helpManager')}
              </Text>
            </ScrollView>

            <PlatinumCTA
              style={[s.submitBtn, saving && s.submitBtnDisabled]}
              label={t('wycenyCal.submit')}
              onPress={handleSubmit}
              disabled={saving}
              loading={saving}
            />
          </PlatinumModalSheet>
        </KeyboardAvoidingView>
      </Modal>
      <Modal visible={!!reserveModal} animationType="slide" transparent>
        <KeyboardAvoidingView style={s.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <PlatinumModalSheet visible={!!reserveModal} style={s.modalSheet}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>Rezerwacja terminu ekipy</Text>
              <TouchableOpacity onPress={() => setReserveModal(null)}>
                <PlatinumIconBadge icon="close" color={theme.textSub} size={13} style={{ width: 26, height: 26, borderRadius: 9 }} />
              </TouchableOpacity>
            </View>
            <ScrollView style={s.modalScroll}>
              <Text style={s.label}>Ekipa</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.pillsScroll}>
                {ekipy.map((e) => {
                  const active = String(reserveDraft.ekipa_id) === String(e.id);
                  return (
                    <TouchableOpacity key={e.id} style={[s.ekipaPill, active && s.pillActive]} onPress={() => {
                      const next = { ...reserveDraft, ekipa_id: String(e.id) };
                      setReserveDraft(next);
                      if (reserveModal) fetchSlots(next, reserveModal.id);
                    }}>
                      <Text style={[s.ekipaText, active && s.pillTextActive]}>{e.nazwa}</Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
              <Text style={s.label}>Data</Text>
              <TextInput style={s.input} value={reserveDraft.data} onChangeText={(txt) => {
                const next = { ...reserveDraft, data: txt };
                setReserveDraft(next);
                if (reserveModal) fetchSlots(next, reserveModal.id);
              }} />
              <Text style={s.label}>Godzina</Text>
              <TextInput style={s.input} value={reserveDraft.godzina} onChangeText={(txt) => setReserveDraft((p) => ({ ...p, godzina: txt }))} />
              <Text style={s.label}>Sugerowane sloty</Text>
              {reserveDiag ? (
                <Text style={s.helpText}>
                  ETA: {reserveDiag.eta_available ? 'dostępne' : `niedostępne (${etaReasonLabel(reserveDiag.eta_unavailable_reason) || 'brak danych'})`}
                  {reserveDiag.target_source === 'task_pin' ? ' • punkt: pin zadania' : ''}
                  {reserveDiag.target_source === 'wycena' ? ' • punkt: wycena' : ''}
                  {reserveDiag.team_gps_age_min != null ? ` • wiek GPS: ${reserveDiag.team_gps_age_min} min` : ''}
                </Text>
              ) : null}
              {reserveRuleWarning ? (
                <Text style={[s.helpText, { color: theme.warning }]}>{reserveRuleWarning}</Text>
              ) : null}
              <Text style={[s.helpText, { marginTop: 0 }]}>Próg ETA: {etaThreshold} min</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.pillsScroll}>
                {[20, 25, 30].map((v) => (
                  <TouchableOpacity
                    key={v}
                    style={[s.pill, etaThreshold === v && s.pillActive]}
                    onPress={async () => {
                        await setEtaThresholdPersisted(v);
                      if (reserveModal) {
                        const next = { ekipa_id: reserveDraft.ekipa_id, data: reserveDraft.data };
                        await fetchSlots(next, reserveModal.id, v);
                      }
                    }}
                  >
                    <Text style={[s.pillText, etaThreshold === v && s.pillTextActive]}>{v}m</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
              <Text style={[s.helpText, { marginTop: 0 }]}>Najpierw sloty z ETA, potem bez ETA.</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.pillsScroll}>
                {slotLoading ? <Text style={s.helpText}>Liczenie slotów...</Text> : null}
                {!slotLoading && reserveDraft.slots.filter((slot) => slot.eta_minutes != null).map((slot) => (
                  <TouchableOpacity key={slot.time} style={s.pill} onPress={() => setReserveDraft((p) => ({ ...p, godzina: slot.time }))}>
                    <Text style={s.pillText}>
                      {slot.time}
                      {slot.eta_minutes != null ? ` • ETA ${slot.eta_minutes}m` : ''}
                      {slot.eta_source === 'task_pin' ? ' • pin' : ''}
                      {slot.eta_minutes == null && slot.eta_unavailable_reason ? ` • ${etaReasonLabel(slot.eta_unavailable_reason)}` : ''}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
              {reserveDraft.slots.some((slot) => slot.eta_minutes == null) ? (
                <Text style={[s.helpText, { marginTop: 0, color: theme.warning }]}>Sloty bez ETA (niższy priorytet):</Text>
              ) : null}
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.pillsScroll}>
                {reserveDraft.slots.filter((slot) => slot.eta_minutes == null).map((slot) => (
                  <TouchableOpacity key={slot.time} style={[s.pill, { opacity: 0.85 }]} onPress={() => setReserveDraft((p) => ({ ...p, godzina: slot.time }))}>
                    <Text style={s.pillText}>
                      {slot.time}
                      {slot.eta_unavailable_reason ? ` • ${etaReasonLabel(slot.eta_unavailable_reason)}` : ''}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </ScrollView>
            <PlatinumCTA
              style={s.submitBtn}
              label="Zapisz rezerwację"
              onPress={saveReservation}
              loading={saving}
              disabled={saving}
            />
          </PlatinumModalSheet>
        </KeyboardAvoidingView>
      </Modal>
    </KeyboardSafeScreen>
  );
}

// ─── Wycena card component ──────────────────────────────────────────────────

function WycenaCard({ wycena: w, ekipy, liveByTeam, theme, s, onReserve }: { wycena: any; ekipy: any[]; liveByTeam: Record<string, any>; theme: Theme; s: CalendarScreenStyles; onReserve: () => void }) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const ac = approvalStatusColors(theme);
  const statusColor = ac[w.status_akceptacji as keyof typeof ac] || theme.textMuted;
  const ekipa = ekipy.find(e => String(e.id) === String(w.ekipa_id));
  const statusKey = wycenaApprovalTabKey(w.status_akceptacji);
  const hasGeo = Number.isFinite(Number(w.lat)) && Number.isFinite(Number(w.lon));
  const teamId = String(w.proponowana_ekipa_id || w.ekipa_id || '');
  const live = teamId ? liveByTeam[teamId] : null;
  const gpsAge = live?.recorded_at ? Math.max(0, Math.round((Date.now() - new Date(live.recorded_at).getTime()) / 60000)) : null;
  const noGps = Boolean(teamId) && !live;
  const staleGps = Boolean(live) && gpsAge != null && gpsAge > 15;

  return (
    <TouchableOpacity style={s.wCard} onPress={() => setOpen(o => !o)} activeOpacity={0.85}>
      <View style={[s.wCardLeft, { borderLeftColor: statusColor }]}>
        {(!hasGeo || noGps || staleGps) && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
            {!hasGeo ? <Text style={[s.wCardMetaText, { color: theme.warning }]}>Brak pinezki klienta</Text> : null}
            {noGps ? <Text style={[s.wCardMetaText, { color: theme.danger }]}>Brak GPS ekipy</Text> : null}
            {staleGps ? <Text style={[s.wCardMetaText, { color: theme.danger }]}>Stary GPS ({gpsAge} min)</Text> : null}
          </View>
        )}
        <View style={s.wCardTop}>
          <Text style={s.wCardTitle} numberOfLines={1}>{w.adres || t('approve.card.unknownAddress')}</Text>
          <View style={[s.badge, { backgroundColor: statusColor + '30', borderColor: statusColor }]}>
            <Text style={[s.badgeText, { color: statusColor }]}>
              {statusKey ? t(statusKey) : w.status_akceptacji}
            </Text>
          </View>
        </View>
        <View style={s.wCardMeta}>
          {w.data_wykonania ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <PlatinumIconBadge icon="calendar-outline" color={theme.textSub} size={10} style={{ width: 22, height: 22, borderRadius: 7 }} />
              <Text style={s.wCardMetaText}>{(w.data_wykonania || '').slice(0, 10)}</Text>
            </View>
          ) : null}
          {w.godzina_rozpoczecia ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <PlatinumIconBadge icon="time-outline" color={theme.textSub} size={10} style={{ width: 22, height: 22, borderRadius: 7 }} />
              <Text style={s.wCardMetaText}>{w.godzina_rozpoczecia.slice(0, 5)}</Text>
            </View>
          ) : null}
          {ekipa && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <PlatinumIconBadge icon="people-outline" color={theme.textSub} size={10} style={{ width: 22, height: 22, borderRadius: 7 }} />
              <Text style={s.wCardMetaText}>{ekipa.nazwa}</Text>
            </View>
          )}
        </View>
        {(w.status_akceptacji === 'oczekuje' || w.status_akceptacji === 'rezerwacja_wstepna') && (
          <PlatinumCTA
            style={{ marginTop: 8, alignSelf: 'flex-start', minWidth: 190 }}
            label="Rezerwuj termin ekipy"
            onPress={onReserve}
          />
        )}
      </View>
      <PlatinumIconBadge icon={open ? 'chevron-up' : 'chevron-down'} color={theme.textMuted} size={10} style={{ width: 22, height: 22, borderRadius: 8 }} />
    </TouchableOpacity>
  );
}
