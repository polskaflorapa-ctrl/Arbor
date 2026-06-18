import { safeBack } from '../utils/navigation';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { KeyboardSafeScreen } from '../components/ui/keyboard-safe-screen';
import { PlatinumCTA } from '../components/ui/platinum-cta';
import { useTheme } from '../constants/ThemeContext';
import { API_URL } from '../constants/api';
import { shadowStyle } from '../constants/elevation';
import type { Theme } from '../constants/theme';
import { useOddzialFeatureGuard } from '../hooks/use-oddzial-feature-guard';
import { triggerHaptic } from '../utils/haptics';
import { openAddressInMaps } from '../utils/maps-link';
import { createOfflineRequestId, queueRequestWithOfflineFallback } from '../utils/offline-queue';
import { buildNewOrderRoute } from '../utils/new-order-route';
import { getStoredSession } from '../utils/session';
import { getRoleDisplayName } from '../utils/role-display';
import { fetchWithTimeout } from '../utils/api-client';

import { AppStatusBar } from '../components/ui/app-status-bar';
function paramString(value: unknown) {
  if (Array.isArray(value)) return String(value[0] || '');
  return String(value || '');
}

type VisitStatus = 'Zaplanowane' | 'W_Trakcie' | 'Zakonczone' | 'Anulowane' | string;

type VisitRow = {
  id: number;
  status?: VisitStatus;
  data_planowana?: string;
  oddzial_id?: number | string;
  wyceniajacy_id?: number | string;
  klient_nazwa?: string;
  klient_telefon?: string;
  adres?: string;
  miasto?: string;
  notatki?: string;
  notatki_wyniki?: string;
  wycena_id?: number | string;
  live_event_type?: 'start' | 'delay' | 'done' | 'heartbeat' | 'note' | string | null;
  live_recorded_at?: string | null;
  live_lat?: number | string | null;
  live_lng?: number | string | null;
  live_eta_min?: number | string | null;
  live_note?: string | null;
};

type SessionUser = {
  id?: number | string;
  oddzial_id?: number | string;
  rola?: string;
};

function isToday(dateLike?: string) {
  if (!dateLike) return false;
  return dateLike.split('T')[0] === new Date().toISOString().split('T')[0];
}

function byTime(a: VisitRow, b: VisitRow) {
  const ta = a.data_planowana ? new Date(a.data_planowana).getTime() : Number.MAX_SAFE_INTEGER;
  const tb = b.data_planowana ? new Date(b.data_planowana).getTime() : Number.MAX_SAFE_INTEGER;
  return ta - tb;
}

function visitTime(dateLike?: string) {
  if (!dateLike) return '--:--';
  const d = new Date(dateLike);
  if (Number.isNaN(d.getTime())) return '--:--';
  return d.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
}

function visitDate(dateLike?: string) {
  if (!dateLike) return new Date().toISOString().split('T')[0];
  return dateLike.split('T')[0];
}

function visitHour(dateLike?: string) {
  if (!dateLike) return '';
  const d = new Date(dateLike);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
}

function statusLabel(status?: VisitStatus) {
  if (status === 'W_Trakcie') return 'w trakcie';
  if (status === 'Zakonczone') return 'gotowe';
  if (status === 'Anulowane') return 'anulowane';
  return 'plan';
}

function statusColor(status: VisitStatus | undefined, theme: Theme) {
  if (status === 'W_Trakcie') return theme.warning;
  if (status === 'Zakonczone') return theme.success;
  if (status === 'Anulowane') return theme.danger;
  return theme.info;
}

function isVisitClosed(status?: VisitStatus) {
  return status === 'Zakonczone' || status === 'Anulowane';
}

function liveLabel(item: VisitRow) {
  if (item.live_event_type === 'delay') {
    const eta = item.live_eta_min != null ? Number(item.live_eta_min) : null;
    return eta && Number.isFinite(eta) ? `Opoznienie +${eta} min` : 'Opoznienie';
  }
  if (item.live_event_type === 'start') return 'Wizyta rozpoczeta';
  if (item.live_event_type === 'done') return 'Wizyta zakonczona';
  if (item.live_event_type === 'heartbeat') return 'Sygnal GPS';
  if (item.live_event_type === 'note') return 'Notatka z trasy';
  return '';
}

function liveIcon(item: VisitRow) {
  if (item.live_event_type === 'delay') return 'time-outline';
  if (item.live_event_type === 'start') return 'play-circle-outline';
  if (item.live_event_type === 'done') return 'checkmark-done-circle-outline';
  if (item.live_event_type === 'heartbeat') return 'location-outline';
  return 'radio-outline';
}

function liveColor(item: VisitRow, theme: Theme) {
  if (item.live_event_type === 'delay') return theme.warning;
  if (item.live_event_type === 'done') return theme.success;
  if (item.live_event_type === 'start') return theme.info;
  return theme.accent;
}

function liveAge(dateLike?: string | null) {
  if (!dateLike) return '';
  const ts = new Date(dateLike).getTime();
  if (!Number.isFinite(ts)) return '';
  const diff = Math.max(0, Math.round((Date.now() - ts) / 60000));
  if (diff < 1) return 'teraz';
  if (diff < 60) return `${diff} min temu`;
  return `${Math.floor(diff / 60)}h ${diff % 60}m temu`;
}

function hasVisitLocation(item: VisitRow) {
  return !!(item.adres || item.miasto || item.live_lat || item.live_lng);
}

function visitMainAction(item: VisitRow) {
  if (item.status === 'Zakonczone') return null;
  if (item.status === 'W_Trakcie') return { label: 'Zakończ', status: 'Zakonczone' as VisitStatus, icon: 'checkmark-done-outline' as const };
  return { label: 'Start', status: 'W_Trakcie' as VisitStatus, icon: 'play-outline' as const };
}

export default function PlanOgledzinScreen() {
  const { theme } = useTheme();
  const params = useLocalSearchParams<{ pickNext?: string }>();
  const guard = useOddzialFeatureGuard('/ogledziny');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [delaySavingId, setDelaySavingId] = useState<string | null>(null);
  const [manualPickOverride, setManualPickOverride] = useState(false);
  const [manualPickSuppressed, setManualPickSuppressed] = useState(false);
  const [runtimeError, setRuntimeError] = useState('');
  const [items, setItems] = useState<VisitRow[]>([]);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [token, setToken] = useState<string | null>(null);

  const styles = useMemo(() => makeStyles(theme), [theme]);
  const manualPickMode = manualPickOverride || (!manualPickSuppressed && paramString(params.pickNext) === '1');

  const load = useCallback(async () => {
    try {
      setRuntimeError('');
      const { token: storedToken, user: storedUser } = await getStoredSession();
      if (!storedToken || !storedUser) {
        router.replace('/login');
        return;
      }
      setToken(storedToken);
      setUser(storedUser);
      const res = await fetchWithTimeout(`${API_URL}/ogledziny`, {
        headers: { Authorization: `Bearer ${storedToken}` },
      });
      if (!res.ok) {
        setItems([]);
        setRuntimeError(`Nie mozna pobrac planu ogledzin (HTTP ${res.status}).`);
        return;
      }
      const data = await res.json();
      const source = Array.isArray(data) ? data : [];
      const userId = storedUser?.id != null ? String(storedUser.id) : '';
      const userOddzialId = storedUser?.oddzial_id != null ? String(storedUser.oddzial_id) : '';
      const scoped = source.filter((item: VisitRow) => {
        const sameOddzial = !userOddzialId || !item.oddzial_id || String(item.oddzial_id) === userOddzialId;
        const assignedToUser = !item.wyceniajacy_id || !userId || String(item.wyceniajacy_id) === userId;
        return sameOddzial && assignedToUser;
      });
      setItems(scoped);
    } catch {
      setItems([]);
      setRuntimeError('Nie mozna pobrac planu ogledzin.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const today = useMemo(() => items.filter((item) => isToday(item.data_planowana)).sort(byTime), [items]);
  const doneCount = today.filter((item) => item.status === 'Zakonczone').length;
  const active = today.find((item) => item.status === 'W_Trakcie');
  const openToday = useMemo(() => today.filter((item) => !isVisitClosed(item.status)), [today]);
  const next = active || openToday[0] || null;
  const progress = today.length ? Math.round((doneCount / today.length) * 100) : 0;
  const displayedVisits = manualPickMode ? openToday : today;
  const planSummary = useMemo(() => {
    const linkedDrafts = today.filter((item) => !!item.wycena_id).length;
    const started = today.filter((item) => item.status === 'W_Trakcie').length;
    const delayed = today.filter((item) => item.live_event_type === 'delay').length;
    const missingContact = today.filter((item) => !item.klient_telefon).length;
    return {
      linkedDrafts,
      started,
      delayed,
      missingContact,
      open: openToday.length,
    };
  }, [openToday.length, today]);
  const routeReadiness = useMemo(() => {
    const missingAddress = today.filter((item) => !hasVisitLocation(item)).length;
    const missingDraft = openToday.filter((item) => !item.wycena_id).length;
    const liveSignals = today.filter((item) => !!item.live_recorded_at).length;
    const checksDone = [
      today.length > 0,
      planSummary.missingContact === 0,
      missingAddress === 0,
      missingDraft === 0,
      planSummary.delayed === 0,
    ].filter(Boolean).length;
    const score = today.length ? Math.round((checksDone / 5) * 100) : 0;
    const firstBlocker = !today.length
      ? 'Brak planu ogledzin na dzisiaj.'
      : planSummary.missingContact > 0
        ? 'Brakuje telefonu do klienta.'
        : missingAddress > 0
          ? 'Brakuje adresu albo pinezki GPS.'
          : missingDraft > 0
            ? 'Brakuje draftu dla biura.'
            : planSummary.delayed > 0
              ? 'Sa opoznienia w trasie.'
              : 'Trasa jest czysta, mozna jechac po kolei.';
    return {
      missingAddress,
      missingDraft,
      liveSignals,
      score,
      firstBlocker,
    };
  }, [openToday, planSummary.delayed, planSummary.missingContact, today]);
  const routeActionVisit = useMemo(() => {
    return openToday.find((item) => !item.klient_telefon)
      || openToday.find((item) => !hasVisitLocation(item))
      || openToday.find((item) => !item.wycena_id)
      || next;
  }, [next, openToday]);
  const routeActionText = routeActionVisit
    ? !routeActionVisit.klient_telefon || !hasVisitLocation(routeActionVisit)
      ? 'Pokaz brak w planie'
      : !routeActionVisit.wycena_id
        ? 'Otworz draft'
        : 'Otworz pakiet foto'
    : 'Brak akcji';
  const nextMoveText = next
    ? next.status === 'W_Trakcie'
      ? 'Zrob zdjecia, szkic, protokol i zamknij wizyte.'
      : `Jedz do klienta na ${visitTime(next.data_planowana)} i wyslij start GPS.`
    : 'Brak nastepnej otwartej wizyty na dzisiaj.';
  const findNextOpenVisit = useCallback((current: VisitRow) => {
    const currentTime = current.data_planowana ? new Date(current.data_planowana).getTime() : 0;
    const candidates = openToday
      .filter((item) => item.id !== current.id)
      .sort(byTime);
    return candidates.find((item) => {
      const ts = item.data_planowana ? new Date(item.data_planowana).getTime() : Number.MAX_SAFE_INTEGER;
      return ts >= currentTime;
    }) || candidates[0] || null;
  }, [openToday]);
  const nextChecks = useMemo(() => {
    if (!next) return [];
    return [
      {
        key: 'contact',
        label: 'Kontakt',
        done: !!next.klient_telefon,
        hint: next.klient_telefon ? 'Telefon gotowy' : 'Brak telefonu klienta',
        icon: 'call-outline' as const,
      },
      {
        key: 'route',
        label: 'Dojazd',
        done: hasVisitLocation(next),
        hint: hasVisitLocation(next) ? 'Adres lub GPS dostępny' : 'Brak adresu',
        icon: 'map-outline' as const,
      },
      {
        key: 'start',
        label: 'Start GPS',
        done: next.status === 'W_Trakcie' || next.status === 'Zakonczone' || next.live_event_type === 'start',
        hint: next.status === 'W_Trakcie' ? 'Wizyta w trakcie' : 'Wyślij start po przyjeździe',
        icon: 'radio-outline' as const,
      },
      {
        key: 'draft',
        label: 'Draft dla biura',
        done: !!next.wycena_id,
        hint: next.wycena_id ? `Powiązana wycena #${next.wycena_id}` : 'Utwórz draft ze zdjęciami i opisem',
        icon: 'flash-outline' as const,
      },
    ];
  }, [next]);
  const nextReadyCount = nextChecks.filter((item) => item.done).length;

  const openDraft = (item: VisitRow) => {
    void triggerHaptic('light');
    if (manualPickMode) {
      setManualPickOverride(false);
      setManualPickSuppressed(true);
    }
    router.push(buildNewOrderRoute({
        source: 'plan-ogledzin',
        inspectionId: String(item.id),
        klient: item.klient_nazwa || '',
        telefon: item.klient_telefon || '',
        adres: item.adres || '',
        miasto: item.miasto || '',
        data: visitDate(item.data_planowana),
        godzina: visitHour(item.data_planowana),
        notatki: item.notatki || '',
    }) as never);
  };

  const openDocumentation = (item: VisitRow) => {
    void triggerHaptic('light');
    router.push({
      pathname: '/ogledziny-dokumentacja' as never,
      params: {
        ogledzinyId: String(item.id),
        wycenaId: item.wycena_id ? String(item.wycena_id) : '',
        klient: item.klient_nazwa || '',
      },
    });
  };

  const captureCoords = async () => {
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== 'granted') return null;
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      return { lat: pos.coords.latitude, lng: pos.coords.longitude };
    } catch {
      return null;
    }
  };

  const sendFieldEvent = async (
    item: VisitRow,
    eventType: 'start' | 'delay' | 'done' | 'heartbeat' | 'note',
    options: { etaMin?: number; note?: string } = {},
  ) => {
    if (!token) {
      router.replace('/login');
      return false;
    }
    const coords = await captureCoords();
    const body = {
      event_type: eventType,
      ...(coords ? { lat: coords.lat, lng: coords.lng } : {}),
      ...(options.etaMin != null ? { eta_min: options.etaMin } : {}),
      ...(options.note ? { note: options.note } : {}),
    };
    const requestId = createOfflineRequestId(`ogledziny-${item.id}-${eventType}`);
    try {
      const res = await fetchWithTimeout(`${API_URL}/ogledziny/${item.id}/field-event`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': requestId,
        },
        body: JSON.stringify(body),
      });
      if (res.ok) return true;
      if (res.status >= 500) {
        await queueRequestWithOfflineFallback({
          id: requestId,
          url: `${API_URL}/ogledziny/${item.id}/field-event`,
          method: 'POST',
          body,
        });
        return true;
      }
      return false;
    } catch {
      await queueRequestWithOfflineFallback({
        id: requestId,
        url: `${API_URL}/ogledziny/${item.id}/field-event`,
        method: 'POST',
        body,
      });
      return true;
    }
  };

  const markStatus = async (item: VisitRow, status: VisitStatus) => {
    if (!token) {
      router.replace('/login');
      return false;
    }
    setSavingId(item.id);
    try {
      if (status === 'W_Trakcie') {
        const ok = await sendFieldEvent(item, 'start', { note: 'Start wizyty z planu ogledzin.' });
        if (!ok) setRuntimeError(`Nie zapisano sygnalu startu ogledzin #${item.id}.`);
        await load();
        void triggerHaptic(ok ? 'success' : 'warning');
        return ok;
      }
      if (status === 'Zakonczone') {
        const ok = await sendFieldEvent(item, 'done', { note: 'Wizyta zakonczona z planu dnia.' });
        if (!ok) setRuntimeError(`Nie zapisano sygnalu zakonczenia ogledzin #${item.id}.`);
        await load();
        void triggerHaptic(ok ? 'success' : 'warning');
        return ok;
      }
      const res = await fetchWithTimeout(`${API_URL}/ogledziny/${item.id}/status`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status,
          notatki_wyniki: status === 'Zakonczone'
            ? [item.notatki_wyniki || '', 'Wizyta zakonczona z planu dnia.'].filter(Boolean).join('\n')
            : item.notatki_wyniki || null,
        }),
      });
      if (!res.ok) {
        setRuntimeError(`Nie zapisano statusu ogledzin #${item.id}.`);
        void triggerHaptic('warning');
        return false;
      }
      void triggerHaptic('success');
      await load();
      return true;
    } catch {
      setRuntimeError(`Nie zapisano statusu ogledzin #${item.id}.`);
      void triggerHaptic('warning');
      return false;
    } finally {
      setSavingId(null);
    }
  };

  const finishVisitWithChoice = async (item: VisitRow) => {
    const nextOpen = findNextOpenVisit(item);
    const ok = await markStatus(item, 'Zakonczone');
    if (!ok) return;
    const buttons: { text: string; style?: 'default' | 'cancel' | 'destructive'; onPress?: () => void }[] = [];
    if (nextOpen) {
      buttons.push({
        text: 'Następna auto',
        onPress: () => openDraft(nextOpen),
      });
    }
    buttons.push({
      text: 'Wybierz ręcznie',
      style: 'cancel',
      onPress: () => setManualPickOverride(true),
    });
    Alert.alert(
      'Wizyta zakończona',
      nextOpen
        ? 'Możesz od razu otworzyć kolejną wizytę albo wybrać ręcznie z planu dnia.'
        : 'Nie widzę kolejnej otwartej wizyty. Zostań w planie i wybierz ręcznie, jeśli trzeba.',
      buttons,
    );
  };

  const reportDelay = async (item: VisitRow, etaMin: number) => {
    setDelaySavingId(`${item.id}:${etaMin}`);
    const note = `Specjalista oględzin raportuje opoznienie +${etaMin} min.`;
    try {
      const ok = await sendFieldEvent(item, 'delay', { etaMin, note });
      if (!ok) {
        setRuntimeError(`Nie zapisano opoznienia ogledzin #${item.id}.`);
        void triggerHaptic('warning');
        return;
      }
      void triggerHaptic('success');
      await load();
    } finally {
      setDelaySavingId(null);
    }
  };

  const sendGpsSignal = async (item: VisitRow) => {
    setDelaySavingId(`${item.id}:heartbeat`);
    try {
      const ok = await sendFieldEvent(item, 'heartbeat', { note: 'Sygnał GPS z planu oględzin.' });
      if (!ok) {
        setRuntimeError(`Nie zapisano sygnału GPS oględzin #${item.id}.`);
        void triggerHaptic('warning');
        return;
      }
      void triggerHaptic('success');
      await load();
    } finally {
      setDelaySavingId(null);
    }
  };

  const handleMissionStepPress = (item: VisitRow, key: string) => {
    void triggerHaptic('light');
    if (key === 'contact' && item.klient_telefon) {
      void Linking.openURL(`tel:${item.klient_telefon}`);
      return;
    }
    if (key === 'route') {
      void openAddressInMaps(item.adres || '', item.miasto || '');
      return;
    }
    if (key === 'start') {
      if (item.status === 'W_Trakcie' || item.status === 'Zakonczone') {
        void sendGpsSignal(item);
      } else {
        void markStatus(item, 'W_Trakcie');
      }
      return;
    }
    if (key === 'draft') openDraft(item);
  };

  if (!guard.ready || loading) {
    return (
      <KeyboardSafeScreen style={styles.center}>
        <AppStatusBar />
        <ActivityIndicator color={theme.accent} size="large" />
      </KeyboardSafeScreen>
    );
  }

  if (!guard.allowed) {
    return (
      <KeyboardSafeScreen style={styles.root}>
        <View />
      </KeyboardSafeScreen>
    );
  }

  return (
    <KeyboardSafeScreen style={styles.root}>
      <AppStatusBar />
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => safeBack()}>
          <Ionicons name="arrow-back" size={21} color={theme.accent} />
        </TouchableOpacity>
        <View style={styles.headerIcon}>
          <Ionicons name="map-outline" size={22} color={theme.accent} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.headerEyebrow}>Trasa specjalisty oględzin</Text>
          <Text style={styles.title}>Plan ogledzin dnia</Text>
          <Text style={styles.subtitle}>Trasa, telefon, mapa i draft bez przepisywania.</Text>
        </View>
      </View>

      {runtimeError ? (
        <View style={styles.errorBar}>
          <Ionicons name="warning-outline" size={15} color={theme.warning} />
          <Text style={styles.errorText}>{runtimeError}</Text>
        </View>
      ) : null}

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.body}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load();
            }}
            tintColor={theme.accent}
            colors={[theme.accent]}
          />
        }
      >
        <View style={styles.kpiRow}>
          <Metric label="Plan" value={String(today.length)} theme={theme} />
          <Metric label="Zostalo" value={String(Math.max(0, today.length - doneCount))} theme={theme} />
          <Metric label="Gotowe" value={String(doneCount)} theme={theme} />
        </View>

        <View style={styles.progressCard}>
          <View style={styles.progressTop}>
            <Text style={styles.progressTitle}>Postep dnia</Text>
            <Text style={styles.progressPct}>{progress}%</Text>
          </View>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${progress}%` }]} />
          </View>
          <Text style={styles.progressHint}>
            {user?.rola ? `${getRoleDisplayName(user.rola)} - ` : ''}{today.length ? 'jedz po kolei wedlug godziny wizyty' : 'brak zaplanowanych ogledzin na dzis'}
          </Text>
        </View>

        <View style={styles.commandCard}>
          <View style={styles.commandHead}>
            <View style={styles.commandIcon}>
              <Ionicons name="leaf-outline" size={19} color={theme.accent} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.commandTitle}>Szybka pilka dnia</Text>
              <Text style={styles.commandSub}>{nextMoveText}</Text>
            </View>
          </View>
          <View style={styles.commandStats}>
            {[
              { label: 'Otwarte', value: planSummary.open, color: theme.accent, icon: 'map-outline' as const },
              { label: 'W toku', value: planSummary.started, color: theme.warning, icon: 'radio-outline' as const },
              { label: 'Drafty', value: planSummary.linkedDrafts, color: theme.success, icon: 'document-text-outline' as const },
              { label: 'Opoznienia', value: planSummary.delayed, color: planSummary.delayed ? theme.danger : theme.success, icon: 'time-outline' as const },
            ].map((item) => (
              <View key={item.label} style={[styles.commandTile, { borderColor: item.color + '55', backgroundColor: item.color + '12' }]}>
                <Ionicons name={item.icon} size={15} color={item.color} />
                <Text style={[styles.commandTileValue, { color: item.color }]}>{item.value}</Text>
                <Text style={styles.commandTileLabel}>{item.label}</Text>
              </View>
            ))}
          </View>
          <View style={styles.commandFlow}>
            {[
              { label: 'Biuro', done: today.length > 0 },
              { label: 'Trasa', done: planSummary.started > 0 || planSummary.open > 0 },
              { label: 'Pakiet', done: planSummary.linkedDrafts > 0 },
              { label: 'Do biura', done: planSummary.linkedDrafts >= Math.max(1, doneCount) && doneCount > 0 },
            ].map((step, index, arr) => (
              <View key={step.label} style={styles.commandFlowStep}>
                <View style={[styles.commandFlowDot, { borderColor: step.done ? theme.success : theme.border, backgroundColor: step.done ? theme.successBg : theme.surface2 }]}>
                  <Ionicons name={step.done ? 'checkmark' : 'ellipse-outline'} size={12} color={step.done ? theme.success : theme.textMuted} />
                </View>
                {index < arr.length - 1 ? <View style={[styles.commandFlowLine, { backgroundColor: step.done ? theme.success + '55' : theme.border }]} /> : null}
                <Text style={[styles.commandFlowText, { color: step.done ? theme.textSub : theme.textMuted }]} numberOfLines={1}>{step.label}</Text>
              </View>
            ))}
          </View>
          {planSummary.missingContact > 0 ? (
            <View style={styles.commandWarning}>
              <Ionicons name="call-outline" size={14} color={theme.warning} />
              <Text style={styles.commandWarningText}>{planSummary.missingContact} wizyt bez telefonu klienta.</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.routeControlCard}>
          <View style={styles.routeControlHead}>
            <View style={styles.routeControlIcon}>
              <Ionicons name="git-branch-outline" size={18} color={theme.accent} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.routeControlTitle}>Kontrola trasy</Text>
              <Text style={styles.routeControlSub}>{routeReadiness.firstBlocker}</Text>
            </View>
            <View style={[
              styles.routeControlScore,
              {
                borderColor: routeReadiness.score >= 80 ? theme.success + '66' : theme.warning + '66',
                backgroundColor: routeReadiness.score >= 80 ? theme.successBg : theme.warningBg,
              },
            ]}>
              <Text style={[styles.routeControlScoreText, { color: routeReadiness.score >= 80 ? theme.success : theme.warning }]}>
                {routeReadiness.score}%
              </Text>
              <Text style={styles.routeControlScoreLabel}>gotowe</Text>
            </View>
          </View>
          <View style={styles.routeControlGrid}>
            {[
              {
                label: 'Telefony',
                value: `${Math.max(0, today.length - planSummary.missingContact)}/${today.length}`,
                color: planSummary.missingContact ? theme.warning : theme.success,
                icon: 'call-outline' as const,
              },
              {
                label: 'Adresy',
                value: `${Math.max(0, today.length - routeReadiness.missingAddress)}/${today.length}`,
                color: routeReadiness.missingAddress ? theme.warning : theme.success,
                icon: 'location-outline' as const,
              },
              {
                label: 'Drafty',
                value: `${Math.max(0, openToday.length - routeReadiness.missingDraft)}/${openToday.length}`,
                color: routeReadiness.missingDraft ? theme.warning : theme.success,
                icon: 'document-text-outline' as const,
              },
              {
                label: 'Live',
                value: String(routeReadiness.liveSignals),
                color: planSummary.delayed ? theme.danger : theme.info,
                icon: 'radio-outline' as const,
              },
            ].map((item) => (
              <View key={item.label} style={styles.routeControlMetric}>
                <View style={[styles.routeControlMetricIcon, { borderColor: item.color + '55', backgroundColor: item.color + '14' }]}>
                  <Ionicons name={item.icon} size={14} color={item.color} />
                </View>
                <Text style={[styles.routeControlMetricValue, { color: item.color }]}>{item.value}</Text>
                <Text style={styles.routeControlMetricLabel}>{item.label}</Text>
              </View>
            ))}
          </View>
          {routeActionVisit ? (
            <TouchableOpacity
              style={styles.routeControlNext}
              activeOpacity={0.86}
              onPress={() => {
                void triggerHaptic('light');
                if (!routeActionVisit.klient_telefon || !hasVisitLocation(routeActionVisit)) {
                  setManualPickOverride(true);
                  setManualPickSuppressed(false);
                  return;
                }
                if (!routeActionVisit.wycena_id) {
                  openDraft(routeActionVisit);
                  return;
                }
                openDocumentation(routeActionVisit);
              }}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.routeControlNextLabel}>Nastepny najlepszy ruch</Text>
                <Text style={styles.routeControlNextText} numberOfLines={1}>
                  {routeActionText} - {routeActionVisit.klient_nazwa || `Wizyta #${routeActionVisit.id}`}
                </Text>
              </View>
              <Ionicons name="arrow-forward" size={18} color={theme.accent} />
            </TouchableOpacity>
          ) : null}
        </View>

        {manualPickMode ? (
          <View style={styles.pickBanner}>
            <View style={styles.pickBannerIcon}>
              <Ionicons name="hand-left-outline" size={17} color={theme.accent} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.pickBannerTitle}>Ręczny wybór następnej oględziny</Text>
              <Text style={styles.pickBannerText}>
                Do wyboru: {openToday.length}. Lista pokazuje tylko otwarte wizyty, system nie narzuca kolejności.
              </Text>
            </View>
            <TouchableOpacity
              style={styles.pickBannerClose}
              onPress={() => {
                setManualPickOverride(false);
                setManualPickSuppressed(true);
              }}
            >
              <Ionicons name="close" size={16} color={theme.textMuted} />
            </TouchableOpacity>
          </View>
        ) : null}

        {next ? (
          <View style={styles.nextCard}>
            <View style={styles.nextTop}>
              <View style={styles.nextBadge}>
                <Ionicons name="navigate" size={18} color={theme.accentText} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.nextEyebrow}>Nastepny klient</Text>
                <Text style={styles.nextTitle}>{next.klient_nazwa || `Ogledziny #${next.id}`}</Text>
                <Text style={styles.nextMeta}>
                  {visitTime(next.data_planowana)}
                  {[next.adres, next.miasto].filter(Boolean).length ? ` - ${[next.adres, next.miasto].filter(Boolean).join(', ')}` : ''}
                </Text>
              </View>
              <View style={[styles.statusPill, { backgroundColor: statusColor(next.status, theme) + '22' }]}>
                <Text style={[styles.statusPillText, { color: statusColor(next.status, theme) }]}>{statusLabel(next.status)}</Text>
              </View>
            </View>
            {next.notatki ? <Text style={styles.nextNote} numberOfLines={3}>{next.notatki}</Text> : null}
            <View style={styles.fieldPack}>
              <View style={styles.fieldPackHead}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.fieldPackTitle}>Pakiet u klienta</Text>
                  <Text style={styles.fieldPackSub}>Zdjecia, szkic i protokol trafia do biura bez przepisywania.</Text>
                </View>
                <TouchableOpacity style={styles.fieldPackCta} onPress={() => openDocumentation(next)}>
                  <Text style={styles.fieldPackCtaText}>Otworz</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.fieldPackSteps}>
                {[
                  { icon: 'camera-outline' as const, label: 'Zdjecia', hint: 'przed / zakres' },
                  { icon: 'create-outline' as const, label: 'Szkic', hint: 'zaznacz ciecie' },
                  { icon: 'document-text-outline' as const, label: 'Protokol', hint: 'sprzet i budzet' },
                ].map((step) => (
                  <TouchableOpacity key={step.label} style={styles.fieldPackStep} onPress={() => openDocumentation(next)}>
                    <Ionicons name={step.icon} size={16} color={theme.accent} />
                    <Text style={styles.fieldPackStepLabel}>{step.label}</Text>
                    <Text style={styles.fieldPackStepHint}>{step.hint}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
            {liveLabel(next) ? (
              <View style={[styles.liveStrip, { borderColor: liveColor(next, theme) + '66', backgroundColor: liveColor(next, theme) + '16' }]}>
                <View style={[styles.liveIcon, { backgroundColor: liveColor(next, theme) + '22' }]}>
                  <Ionicons name={liveIcon(next)} size={17} color={liveColor(next, theme)} />
                </View>
                <View style={styles.liveTextWrap}>
                  <View style={styles.liveTitleRow}>
                    <Text style={[styles.liveTitle, { color: liveColor(next, theme) }]}>{liveLabel(next)}</Text>
                    {liveAge(next.live_recorded_at) ? <Text style={styles.liveAge}>{liveAge(next.live_recorded_at)}</Text> : null}
                  </View>
                  {next.live_note ? <Text style={styles.liveNote} numberOfLines={2}>{next.live_note}</Text> : null}
                </View>
              </View>
            ) : null}

            <View style={styles.missionPanel}>
              <View style={styles.missionHead}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.missionTitle}>Misja wizyty</Text>
                  <Text style={styles.missionSub}>Najpierw kontakt i dojazd, potem start GPS, draft ze zdjęciami i sygnał do biura.</Text>
                </View>
                <View style={styles.missionScore}>
                  <Text style={styles.missionScoreValue}>{nextReadyCount}/{nextChecks.length}</Text>
                  <Text style={styles.missionScoreLabel}>gotowe</Text>
                </View>
              </View>
              <View style={styles.missionSteps}>
                {nextChecks.map((check) => (
                  <TouchableOpacity
                    key={check.key}
                    style={[
                      styles.missionStep,
                      check.done && { borderTopColor: theme.success + '55' },
                    ]}
                    onPress={() => handleMissionStepPress(next, check.key)}
                    disabled={savingId === next.id || delaySavingId === `${next.id}:heartbeat`}
                  >
                    <Ionicons name={check.done ? 'checkmark-circle' : check.icon} size={16} color={check.done ? theme.success : theme.warning} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.missionStepTitle}>{check.label}</Text>
                      <Text style={styles.missionStepHint} numberOfLines={1}>{check.hint}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={15} color={theme.textMuted} />
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <View style={styles.nextActions}>
              {next.klient_telefon ? (
                <TouchableOpacity style={styles.actionBtn} onPress={() => void Linking.openURL(`tel:${next.klient_telefon}`)}>
                  <Ionicons name="call-outline" size={16} color={theme.success} />
                  <Text style={[styles.actionText, { color: theme.success }]}>Dzwon</Text>
                </TouchableOpacity>
              ) : null}
              {(next.adres || next.miasto) ? (
                <TouchableOpacity style={styles.actionBtn} onPress={() => void openAddressInMaps(next.adres || '', next.miasto || '')}>
                  <Ionicons name="map-outline" size={16} color={theme.info} />
                  <Text style={[styles.actionText, { color: theme.info }]}>Mapa</Text>
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity
                style={styles.actionBtn}
                onPress={() => void sendGpsSignal(next)}
                disabled={delaySavingId === `${next.id}:heartbeat` || savingId === next.id}
              >
                {delaySavingId === `${next.id}:heartbeat` ? (
                  <ActivityIndicator size="small" color={theme.accent} />
                ) : (
                  <Ionicons name="radio-outline" size={16} color={theme.accent} />
                )}
                <Text style={[styles.actionText, { color: theme.accent }]}>GPS</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.actionBtn} onPress={() => openDraft(next)}>
                <Ionicons name="flash-outline" size={16} color={theme.accent} />
                <Text style={[styles.actionText, { color: theme.accent }]}>Draft</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.actionBtn} onPress={() => openDocumentation(next)}>
                <Ionicons name="images-outline" size={16} color={theme.warning} />
                <Text style={[styles.actionText, { color: theme.warning }]}>Media</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.delayRow}>
              {[15, 30].map((etaMin) => {
                const loadingDelay = delaySavingId === `${next.id}:${etaMin}`;
                return (
                  <TouchableOpacity
                    key={etaMin}
                    style={[styles.delayBtn, loadingDelay && { opacity: 0.65 }]}
                    onPress={() => void reportDelay(next, etaMin)}
                    disabled={loadingDelay || savingId === next.id}
                  >
                    {loadingDelay ? (
                      <ActivityIndicator size="small" color={theme.warning} />
                    ) : (
                      <Ionicons name="time-outline" size={15} color={theme.warning} />
                    )}
                    <Text style={styles.delayText}>+{etaMin} min</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <View style={styles.mainActions}>
              {next.status !== 'W_Trakcie' ? (
                <PlatinumCTA
                  label="Start wizyty"
                  style={styles.mainCta}
                  onPress={() => void markStatus(next, 'W_Trakcie')}
                  disabled={savingId === next.id}
                  loading={savingId === next.id}
                />
              ) : (
                <PlatinumCTA
                  label="Zakończ i wybierz"
                  style={[styles.mainCta, { backgroundColor: theme.success }]}
                  onPress={() => void finishVisitWithChoice(next)}
                  disabled={savingId === next.id}
                  loading={savingId === next.id}
                />
              )}
            </View>
          </View>
        ) : (
          <View style={styles.emptyCard}>
            <Ionicons name="checkmark-done-circle-outline" size={30} color={theme.success} />
            <Text style={styles.emptyTitle}>{today.length ? 'Wszystkie ogledziny domkniete' : 'Brak planu na dzis'}</Text>
            <Text style={styles.emptyText}>Mozesz utworzyc szybki draft lub odswiezyc liste.</Text>
            <TouchableOpacity style={styles.emptyBtn} onPress={() => router.push(buildNewOrderRoute({ source: 'plan-ogledzin' }) as never)}>
              <Text style={styles.emptyBtnText}>Nowy draft</Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.listHead}>
          <Text style={styles.listTitle}>{manualPickMode ? 'Wybierz następną wizytę' : 'Kolejnosc wizyt'}</Text>
          <Text style={styles.listSub}>{manualPickMode ? `${openToday.length} otwarte` : `${today.length} dzis`}</Text>
        </View>

        <View style={styles.list}>
          {displayedVisits.length === 0 ? (
            <View style={styles.manualEmptyCard}>
              <Ionicons name="checkmark-done-circle-outline" size={24} color={theme.success} />
              <Text style={styles.manualEmptyTitle}>Nie ma otwartych oględzin</Text>
              <Text style={styles.manualEmptyText}>Wszystko z dzisiejszego planu wygląda na zamknięte albo anulowane.</Text>
            </View>
          ) : null}
          {displayedVisits.map((item, index) => {
            const color = statusColor(item.status, theme);
            const isCurrent = next?.id === item.id;
            const rowAction = visitMainAction(item);
            const canPick = manualPickMode && !!rowAction;
            return (
              <View
                key={item.id}
                style={[
                  styles.visitCard,
                  isCurrent && { borderColor: theme.accent },
                  canPick && { borderColor: theme.warning, backgroundColor: theme.warningBg },
                ]}
              >
                <View style={styles.visitIndex}>
                  <Text style={styles.visitIndexText}>{index + 1}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <View style={styles.visitTitleRow}>
                    <Text style={styles.visitTitle} numberOfLines={1}>{item.klient_nazwa || `Ogledziny #${item.id}`}</Text>
                    <Text style={[styles.visitStatus, { color }]}>{statusLabel(item.status)}</Text>
                  </View>
                  <Text style={styles.visitMeta}>
                    {visitTime(item.data_planowana)}
                    {[item.adres, item.miasto].filter(Boolean).length ? ` - ${[item.adres, item.miasto].filter(Boolean).join(', ')}` : ''}
                  </Text>
                  {liveLabel(item) ? (
                    <View style={[styles.liveMini, { borderColor: liveColor(item, theme) + '44', backgroundColor: liveColor(item, theme) + '12' }]}>
                      <Ionicons name={liveIcon(item)} size={13} color={liveColor(item, theme)} />
                      <Text style={[styles.liveMiniText, { color: liveColor(item, theme) }]} numberOfLines={1}>
                        {liveLabel(item)}
                      </Text>
                      {liveAge(item.live_recorded_at) ? <Text style={styles.liveMiniAge}>{liveAge(item.live_recorded_at)}</Text> : null}
                    </View>
                  ) : null}
                  <View style={styles.visitActions}>
                    {canPick ? (
                      <TouchableOpacity style={[styles.visitMiniBtn, styles.visitPickBtn]} onPress={() => openDraft(item)}>
                        <Ionicons name="checkmark-circle-outline" size={14} color={theme.warning} />
                        <Text style={[styles.visitMiniText, { color: theme.warning }]}>Wybierz</Text>
                      </TouchableOpacity>
                    ) : null}
                    {item.klient_telefon ? (
                      <TouchableOpacity style={styles.visitMiniBtn} onPress={() => void Linking.openURL(`tel:${item.klient_telefon}`)}>
                        <Ionicons name="call-outline" size={14} color={theme.success} />
                        <Text style={styles.visitMiniText}>Tel</Text>
                      </TouchableOpacity>
                    ) : null}
                    {(item.adres || item.miasto) ? (
                      <TouchableOpacity style={styles.visitMiniBtn} onPress={() => void openAddressInMaps(item.adres || '', item.miasto || '')}>
                        <Ionicons name="map-outline" size={14} color={theme.info} />
                        <Text style={styles.visitMiniText}>Mapa</Text>
                      </TouchableOpacity>
                    ) : null}
                    <TouchableOpacity style={styles.visitMiniBtn} onPress={() => openDraft(item)}>
                      <Ionicons name="flash-outline" size={14} color={theme.accent} />
                      <Text style={styles.visitMiniText}>Draft</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.visitMiniBtn} onPress={() => openDocumentation(item)}>
                      <Ionicons name="images-outline" size={14} color={theme.warning} />
                      <Text style={styles.visitMiniText}>Media</Text>
                    </TouchableOpacity>
                    {rowAction ? (
                      <TouchableOpacity
                        style={[styles.visitMiniBtn, styles.visitStateBtn, item.status === 'W_Trakcie' && { borderColor: theme.success + '66', backgroundColor: theme.successBg }]}
                        onPress={() => {
                          void markStatus(item, rowAction.status);
                        }}
                        disabled={savingId === item.id}
                      >
                        {savingId === item.id ? (
                          <ActivityIndicator size="small" color={theme.accent} />
                        ) : (
                          <Ionicons name={rowAction.icon} size={14} color={item.status === 'W_Trakcie' ? theme.success : theme.accent} />
                        )}
                        <Text style={[styles.visitMiniText, { color: item.status === 'W_Trakcie' ? theme.success : theme.accent }]}>
                          {rowAction.label}
                        </Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                </View>
              </View>
            );
          })}
        </View>
      </ScrollView>
    </KeyboardSafeScreen>
  );
}

function Metric({ label, value, theme }: { label: string; value: string; theme: Theme }) {
  return (
    <View style={{ flex: 1, borderWidth: 1, borderColor: theme.cardBorder, borderRadius: 7, padding: 12, backgroundColor: theme.cardBg }}>
      <Text style={{ color: theme.accent, fontSize: 22, fontWeight: '900', textAlign: 'center' }}>{value}</Text>
      <Text style={{ color: theme.textMuted, fontSize: 11, textAlign: 'center', marginTop: 3, fontWeight: '700' }}>{label}</Text>
    </View>
  );
}

const makeStyles = (theme: Theme) => StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  center: { flex: 1, backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center' },
  header: {
    backgroundColor: theme.cardBg,
    marginHorizontal: 14,
    marginTop: 12,
    marginBottom: 10,
    paddingTop: 18,
    paddingBottom: 16,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: theme.cardBorder,
    ...shadowStyle(theme, {
      opacity: theme.shadowOpacity * 0.5,
      radius: theme.shadowRadius,
      offsetY: theme.shadowOffsetY,
      elevation: 2,
    }),
  },
  backBtn: {
    width: 42,
    height: 42,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerIcon: {
    width: 44,
    height: 44,
    borderRadius: 7,
    backgroundColor: theme.accentLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerEyebrow: { color: theme.accent, fontSize: 11, fontWeight: '900', textTransform: 'uppercase' },
  title: { color: theme.text, fontSize: 20, lineHeight: 24, fontWeight: '900' },
  subtitle: { color: theme.textMuted, fontSize: 12, marginTop: 2, fontWeight: '700' },
  errorBar: {
    margin: 12,
    marginBottom: 0,
    borderWidth: 1,
    borderColor: theme.warning + '66',
    backgroundColor: theme.warningBg,
    borderRadius: 7,
    padding: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  errorText: { color: theme.warning, flex: 1, fontSize: 12, fontWeight: '800' },
  scroll: { flex: 1 },
  body: { padding: 12, paddingBottom: 40, gap: 12 },
  kpiRow: { flexDirection: 'row', gap: 8 },
  progressCard: {
    borderWidth: 1,
    borderColor: theme.cardBorder,
    borderRadius: 6,
    backgroundColor: theme.cardBg,
    padding: 12,
  },
  progressTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 9 },
  progressTitle: { color: theme.text, fontSize: 14, fontWeight: '900' },
  progressPct: { color: theme.accent, fontSize: 14, fontWeight: '900' },
  progressTrack: { height: 9, borderRadius: 5, backgroundColor: theme.surface2, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 5, backgroundColor: theme.accent },
  progressHint: { color: theme.textMuted, fontSize: 11, lineHeight: 16, marginTop: 8 },
  commandCard: {
    borderWidth: 1,
    borderColor: theme.cardBorder,
    borderRadius: 7,
    backgroundColor: theme.cardBg,
    padding: 13,
    gap: 12,
  },
  commandHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  commandIcon: {
    width: 40,
    height: 40,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: theme.accent + '44',
    backgroundColor: theme.accentLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  commandTitle: { color: theme.text, fontSize: 15, fontWeight: '900' },
  commandSub: { color: theme.textMuted, fontSize: 11, lineHeight: 16, marginTop: 2 },
  commandStats: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  commandTile: {
    flexGrow: 1,
    flexBasis: '47%',
    minHeight: 64,
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    justifyContent: 'center',
    gap: 2,
  },
  commandTileValue: { fontSize: 18, fontWeight: '900', fontVariant: ['tabular-nums'] },
  commandTileLabel: { color: theme.textMuted, fontSize: 10, fontWeight: '900', textTransform: 'uppercase' },
  commandFlow: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surface2,
    borderRadius: 6,
    padding: 9,
    gap: 4,
  },
  commandFlowStep: { flex: 1, alignItems: 'center', gap: 4, position: 'relative' },
  commandFlowDot: {
    width: 26,
    height: 26,
    borderRadius: 5,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  commandFlowLine: {
    position: 'absolute',
    top: 13,
    left: '55%',
    right: '-55%',
    height: 2,
    borderRadius: 5,
  },
  commandFlowText: { fontSize: 9.5, fontWeight: '900', textAlign: 'center' },
  commandWarning: {
    borderWidth: 1,
    borderColor: theme.warning + '55',
    backgroundColor: theme.warningBg,
    borderRadius: 7,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  commandWarningText: { color: theme.warning, fontSize: 11, fontWeight: '900', flex: 1 },
  routeControlCard: {
    borderWidth: 1,
    borderColor: theme.cardBorder,
    borderRadius: 7,
    backgroundColor: theme.cardBg,
    padding: 13,
    gap: 12,
  },
  routeControlHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  routeControlIcon: {
    width: 38,
    height: 38,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: theme.accent + '44',
    backgroundColor: theme.accentLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  routeControlTitle: { color: theme.text, fontSize: 14, fontWeight: '900' },
  routeControlSub: { color: theme.textMuted, fontSize: 11, lineHeight: 16, marginTop: 2 },
  routeControlScore: {
    minWidth: 72,
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
    alignItems: 'center',
  },
  routeControlScoreText: { fontSize: 17, fontWeight: '900', fontVariant: ['tabular-nums'] },
  routeControlScoreLabel: { color: theme.textMuted, fontSize: 9, fontWeight: '900', textTransform: 'uppercase' },
  routeControlGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  routeControlMetric: {
    flexGrow: 1,
    flexBasis: '47%',
    minHeight: 66,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 6,
    backgroundColor: theme.surface2,
    paddingHorizontal: 10,
    paddingVertical: 8,
    justifyContent: 'center',
    gap: 3,
  },
  routeControlMetricIcon: {
    width: 26,
    height: 26,
    borderRadius: 9,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  routeControlMetricValue: { fontSize: 16, fontWeight: '900', fontVariant: ['tabular-nums'] },
  routeControlMetricLabel: { color: theme.textMuted, fontSize: 10, fontWeight: '900', textTransform: 'uppercase' },
  routeControlNext: {
    borderWidth: 1,
    borderColor: theme.accent + '55',
    backgroundColor: theme.accentLight,
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  routeControlNextLabel: { color: theme.accent, fontSize: 10, fontWeight: '900', textTransform: 'uppercase' },
  routeControlNextText: { color: theme.text, fontSize: 12, fontWeight: '900', marginTop: 2 },
  pickBanner: {
    borderWidth: 1,
    borderColor: theme.accent + '66',
    backgroundColor: theme.accentLight,
    borderRadius: 6,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  pickBannerIcon: {
    width: 34,
    height: 34,
    borderRadius: 6,
    backgroundColor: theme.cardBg,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: theme.accent + '44',
  },
  pickBannerTitle: { color: theme.text, fontSize: 13, fontWeight: '900' },
  pickBannerText: { color: theme.textSub, fontSize: 11, lineHeight: 16, marginTop: 2 },
  pickBannerClose: {
    width: 32,
    height: 32,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: theme.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.cardBg,
  },
  nextCard: {
    borderWidth: 1,
    borderColor: theme.accent,
    borderRadius: 7,
    backgroundColor: theme.cardBg,
    padding: 14,
    gap: 12,
  },
  nextTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  nextBadge: {
    width: 40,
    height: 40,
    borderRadius: 6,
    backgroundColor: theme.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nextEyebrow: { color: theme.accent, fontSize: 11, fontWeight: '900', textTransform: 'uppercase' },
  nextTitle: { color: theme.text, fontSize: 18, fontWeight: '900', marginTop: 2 },
  nextMeta: { color: theme.textMuted, fontSize: 12, lineHeight: 17, marginTop: 3 },
  statusPill: { borderRadius: 5, paddingHorizontal: 8, paddingVertical: 4 },
  statusPillText: { fontSize: 10, fontWeight: '900', textTransform: 'uppercase' },
  nextNote: {
    color: theme.textSub,
    fontSize: 12,
    lineHeight: 18,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surface2,
    borderRadius: 7,
    padding: 10,
  },
  fieldPack: {
    borderWidth: 1,
    borderColor: theme.accent + '55',
    backgroundColor: theme.accentLight,
    borderRadius: 6,
    padding: 11,
    gap: 10,
  },
  fieldPackHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  fieldPackTitle: { color: theme.text, fontSize: 13, fontWeight: '900' },
  fieldPackSub: { color: theme.textSub, fontSize: 11, lineHeight: 16, marginTop: 2 },
  fieldPackCta: {
    minHeight: 34,
    borderRadius: 5,
    backgroundColor: theme.cardBg,
    borderWidth: 1,
    borderColor: theme.accent + '55',
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fieldPackCtaText: { color: theme.accent, fontSize: 11, fontWeight: '900' },
  fieldPackSteps: { flexDirection: 'row', gap: 8 },
  fieldPackStep: {
    flex: 1,
    minHeight: 74,
    borderWidth: 1,
    borderColor: theme.accent + '33',
    backgroundColor: theme.cardBg,
    borderRadius: 7,
    padding: 9,
    gap: 4,
  },
  fieldPackStepLabel: { color: theme.text, fontSize: 11, fontWeight: '900' },
  fieldPackStepHint: { color: theme.textMuted, fontSize: 10, lineHeight: 13, fontWeight: '700' },
  liveStrip: {
    borderWidth: 1,
    borderRadius: 7,
    padding: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  liveIcon: {
    width: 34,
    height: 34,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  liveTextWrap: { flex: 1, minWidth: 0 },
  liveTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  liveTitle: { fontSize: 12, fontWeight: '900', flexShrink: 1 },
  liveAge: { color: theme.textMuted, fontSize: 10, fontWeight: '800' },
  liveNote: { color: theme.textSub, fontSize: 11, lineHeight: 16, marginTop: 3 },
  missionPanel: {
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surface2,
    borderRadius: 6,
    padding: 11,
    gap: 10,
  },
  missionHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  missionTitle: { color: theme.text, fontSize: 13, fontWeight: '900' },
  missionSub: { color: theme.textMuted, fontSize: 11, lineHeight: 16, marginTop: 2 },
  missionScore: {
    minWidth: 58,
    borderWidth: 1,
    borderColor: theme.cardBorder,
    backgroundColor: theme.cardBg,
    borderRadius: 7,
    paddingHorizontal: 8,
    paddingVertical: 6,
    alignItems: 'center',
  },
  missionScoreValue: {
    color: theme.accent,
    fontSize: 16,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  missionScoreLabel: { color: theme.textMuted, fontSize: 9, fontWeight: '900', textTransform: 'uppercase' },
  missionSteps: { gap: 7 },
  missionStep: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: theme.border,
    paddingTop: 7,
  },
  missionStepTitle: { color: theme.text, fontSize: 12, fontWeight: '900' },
  missionStepHint: { color: theme.textMuted, fontSize: 11, marginTop: 1 },
  nextActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  actionBtn: {
    flex: 1,
    minWidth: 92,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surface2,
    borderRadius: 7,
    paddingVertical: 10,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  actionText: { fontSize: 12, fontWeight: '900' },
  delayRow: { flexDirection: 'row', gap: 8 },
  delayBtn: {
    flex: 1,
    minHeight: 42,
    borderWidth: 1,
    borderColor: theme.warning + '66',
    backgroundColor: theme.warningBg,
    borderRadius: 7,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  delayText: { color: theme.warning, fontSize: 12, fontWeight: '900' },
  mainActions: { flexDirection: 'row', gap: 8 },
  mainCta: { flex: 1 },
  emptyCard: {
    borderWidth: 1,
    borderColor: theme.cardBorder,
    borderRadius: 7,
    backgroundColor: theme.cardBg,
    padding: 18,
    alignItems: 'center',
    gap: 8,
  },
  emptyTitle: { color: theme.text, fontSize: 16, fontWeight: '900' },
  emptyText: { color: theme.textMuted, fontSize: 12, textAlign: 'center' },
  emptyBtn: { marginTop: 4, backgroundColor: theme.accent, borderRadius: 7, paddingHorizontal: 14, paddingVertical: 10 },
  emptyBtnText: { color: theme.accentText, fontWeight: '900', fontSize: 12 },
  listHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 2 },
  listTitle: { color: theme.text, fontSize: 15, fontWeight: '900' },
  listSub: { color: theme.textMuted, fontSize: 12, fontWeight: '800' },
  list: { gap: 9 },
  manualEmptyCard: {
    borderWidth: 1,
    borderColor: theme.success + '55',
    backgroundColor: theme.successBg,
    borderRadius: 6,
    padding: 14,
    alignItems: 'center',
    gap: 6,
  },
  manualEmptyTitle: { color: theme.text, fontSize: 14, fontWeight: '900' },
  manualEmptyText: { color: theme.textSub, fontSize: 12, lineHeight: 17, textAlign: 'center' },
  visitCard: {
    borderWidth: 1,
    borderColor: theme.cardBorder,
    backgroundColor: theme.cardBg,
    borderRadius: 6,
    padding: 11,
    flexDirection: 'row',
    gap: 10,
  },
  visitIndex: {
    width: 32,
    height: 32,
    borderRadius: 6,
    backgroundColor: theme.accentLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  visitIndexText: { color: theme.accent, fontWeight: '900', fontSize: 13 },
  visitTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  visitTitle: { color: theme.text, fontSize: 14, fontWeight: '900', flex: 1 },
  visitStatus: { fontSize: 10, fontWeight: '900', textTransform: 'uppercase' },
  visitMeta: { color: theme.textMuted, fontSize: 12, lineHeight: 17, marginTop: 3 },
  liveMini: {
    alignSelf: 'flex-start',
    maxWidth: '100%',
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 5,
    marginTop: 7,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  liveMiniText: { fontSize: 10, fontWeight: '900', flexShrink: 1 },
  liveMiniAge: { color: theme.textMuted, fontSize: 10, fontWeight: '800' },
  visitActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 9 },
  visitMiniBtn: {
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 6,
    backgroundColor: theme.surface2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 7,
  },
  visitStateBtn: {
    borderColor: theme.accent + '66',
    backgroundColor: theme.accentLight,
  },
  visitPickBtn: {
    borderColor: theme.warning + '66',
    backgroundColor: theme.cardBg,
  },
  visitMiniText: { color: theme.textSub, fontSize: 11, fontWeight: '800' },
});
