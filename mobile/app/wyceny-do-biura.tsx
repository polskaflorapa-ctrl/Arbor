import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { EmptyState, ErrorBanner } from '../components/ui/app-state';
import { PlatinumAppear } from '../components/ui/platinum-appear';
import { KeyboardSafeScreen } from '../components/ui/keyboard-safe-screen';
import { ScreenHeader } from '../components/ui/screen-header';
import { API_URL } from '../constants/api';
import { useTheme } from '../constants/ThemeContext';
import type { Theme } from '../constants/theme';
import { openAddressInMaps } from '../utils/maps-link';
import { subscribeOfflineFlushDone } from '../utils/offline-queue-sync-events';
import { getStoredSession } from '../utils/session';
import { triggerHaptic } from '../utils/haptics';

type FieldDraft = {
  id: number;
  klient_nazwa?: string;
  klient_telefon?: string;
  adres?: string;
  miasto?: string;
  data_planowana?: string;
  status?: string;
  typ_uslugi?: string;
  wartosc_planowana?: number | string | null;
  czas_planowany_godziny?: number | string | null;
  ekipa_id?: number | string | null;
  ekipa_nazwa?: string | null;
  wyceniajacy_nazwa?: string | null;
  oddzial_nazwa?: string | null;
  photo_total?: number;
  photo_wycena?: number;
  photo_szkic?: number;
  photo_dojazd?: number;
  missing_items?: string[];
  created_at?: string;
  updated_at?: string;
};

type FilterKey = 'all' | 'urgent' | 'missing' | 'ready' | 'photos' | 'pricing' | 'planning';

type ReadinessCheck = {
  key: string;
  label: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  done: boolean;
  hint: string;
};

const PHOTO_REQUIREMENTS = [
  { key: 'photo_wycena', label: 'Wycena', icon: 'image-outline' },
  { key: 'photo_szkic', label: 'Szkic', icon: 'create-outline' },
  { key: 'photo_dojazd', label: 'Dojazd', icon: 'navigate-outline' },
] as const;

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'Wszystkie' },
  { key: 'urgent', label: 'Pilne' },
  { key: 'missing', label: 'Do uzupełnienia' },
  { key: 'photos', label: 'Foto' },
  { key: 'pricing', label: 'Cena' },
  { key: 'planning', label: 'Plan' },
  { key: 'ready', label: 'Kompletne' },
];

const URGENT_AFTER_MINUTES = 120;

function asNumber(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function formatDate(value?: string) {
  if (!value) return 'bez terminu';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value.split('T')[0] || value;
  return d.toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function missingList(row: FieldDraft) {
  return Array.isArray(row.missing_items) ? row.missing_items.filter(Boolean) : [];
}

function draftAgeMinutes(row: FieldDraft) {
  const raw = row.created_at || row.updated_at || row.data_planowana;
  if (!raw) return 0;
  const ts = new Date(raw).getTime();
  if (!Number.isFinite(ts)) return 0;
  return Math.max(0, Math.round((Date.now() - ts) / 60000));
}

function draftAgeLabel(row: FieldDraft) {
  const minutes = draftAgeMinutes(row);
  if (minutes < 1) return 'teraz';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours < 24) return rest ? `${hours}h ${rest}m` : `${hours}h`;
  return `${Math.floor(hours / 24)} dni`;
}

function completionScore(row: FieldDraft) {
  const checks = [
    asNumber(row.photo_wycena) > 0,
    asNumber(row.photo_szkic) > 0,
    asNumber(row.photo_dojazd) > 0,
    hasPrice(row),
    hasPlannedTime(row),
    hasTeam(row),
  ];
  return checks.filter(Boolean).length / checks.length;
}

function formatMoney(value: unknown) {
  const amount = asNumber(value);
  return amount > 0 ? `${amount.toLocaleString('pl-PL')} PLN` : 'bez ceny';
}

function photoPackageReady(row: FieldDraft) {
  return PHOTO_REQUIREMENTS.every((req) => asNumber(row[req.key]) > 0);
}

function hasPrice(row: FieldDraft) {
  return asNumber(row.wartosc_planowana) > 0;
}

function hasPlannedTime(row: FieldDraft) {
  return asNumber(row.czas_planowany_godziny) > 0;
}

function hasTeam(row: FieldDraft) {
  return !!row.ekipa_id || !!row.ekipa_nazwa;
}

function hasCrewPlan(row: FieldDraft) {
  return hasTeam(row) && hasPlannedTime(row);
}

function readinessChecks(row: FieldDraft): ReadinessCheck[] {
  const photosReady = PHOTO_REQUIREMENTS.filter((req) => asNumber(row[req.key]) > 0).length;
  const price = asNumber(row.wartosc_planowana);
  const hours = asNumber(row.czas_planowany_godziny);
  const teamReady = hasTeam(row);

  return [
    {
      key: 'photos',
      label: 'Zdjęcia',
      icon: 'images-outline',
      done: photosReady === PHOTO_REQUIREMENTS.length,
      hint: `${photosReady}/${PHOTO_REQUIREMENTS.length}`,
    },
    {
      key: 'price',
      label: 'Cena',
      icon: 'cash-outline',
      done: hasPrice(row),
      hint: price > 0 ? `${price.toLocaleString('pl-PL')} PLN` : 'brak',
    },
    {
      key: 'time',
      label: 'Czas',
      icon: 'time-outline',
      done: hasPlannedTime(row),
      hint: hours > 0 ? `${hours} h` : 'brak',
    },
    {
      key: 'team',
      label: 'Ekipa',
      icon: 'people-outline',
      done: teamReady,
      hint: row.ekipa_nazwa || 'brak',
    },
  ];
}

function primaryMissing(row: FieldDraft) {
  const missing = missingList(row);
  if (!missing.length) return 'Przekazać do planowania';
  return missing[0];
}

function isUrgent(row: FieldDraft) {
  if (missingList(row).length === 0) return false;
  if (draftAgeMinutes(row) >= URGENT_AFTER_MINUTES) return true;
  return completionScore(row) < 0.5;
}

function sortOfficeDrafts(a: FieldDraft, b: FieldDraft) {
  const aUrgent = isUrgent(a) ? 1 : 0;
  const bUrgent = isUrgent(b) ? 1 : 0;
  if (aUrgent !== bUrgent) return bUrgent - aUrgent;
  const aReady = missingList(a).length === 0 ? 1 : 0;
  const bReady = missingList(b).length === 0 ? 1 : 0;
  if (aReady !== bReady) return aReady - bReady;
  const ageDiff = draftAgeMinutes(b) - draftAgeMinutes(a);
  if (ageDiff !== 0) return ageDiff;
  return completionScore(a) - completionScore(b);
}

export default function WycenyDoBiuraScreen() {
  const { theme } = useTheme();
  const S = makeStyles(theme);
  const [items, setItems] = useState<FieldDraft[]>([]);
  const [filter, setFilter] = useState<FilterKey>('missing');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [approvingId, setApprovingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const { token } = await getStoredSession();
      if (!token) {
        router.replace('/login');
        return;
      }
      const res = await fetch(`${API_URL}/tasks/field-drafts`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setItems([]);
        setError(data?.error || `HTTP ${res.status}`);
        return;
      }
      setItems(Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : []);
    } catch (err) {
      setItems([]);
      setError(err instanceof Error ? err.message : 'Nie udało się pobrać kolejki.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const unsubscribe = subscribeOfflineFlushDone((d) => {
      if (d.flushed > 0) void load();
    });
    return unsubscribe;
  }, [load]);

  const stats = useMemo(() => {
    const complete = items.filter((row) => missingList(row).length === 0).length;
    const urgent = items.filter(isUrgent).length;
    const oldestOpen = items
      .filter((row) => missingList(row).length > 0)
      .sort((a, b) => draftAgeMinutes(b) - draftAgeMinutes(a))[0];
    return {
      total: items.length,
      complete,
      urgent,
      missing: Math.max(0, items.length - complete),
      oldestOpen,
    };
  }, [items]);
  const visibleItems = useMemo(() => {
    return items
      .filter((row) => {
        const ready = missingList(row).length === 0;
        if (filter === 'urgent') return isUrgent(row);
        if (filter === 'missing') return !ready;
        if (filter === 'photos') return !photoPackageReady(row);
        if (filter === 'pricing') return !hasPrice(row);
        if (filter === 'planning') return !hasCrewPlan(row);
        if (filter === 'ready') return ready;
        return true;
      })
      .sort(sortOfficeDrafts);
  }, [filter, items]);

  const nextDraft = useMemo(() => [...items].sort(sortOfficeDrafts)[0] || null, [items]);
  const evidenceSummary = useMemo(() => {
    const evidenceReady = items.filter(photoPackageReady).length;
    const photoTotal = items.reduce((sum, row) => sum + asNumber(row.photo_total), 0);
    const missingSketch = items.filter((row) => asNumber(row.photo_szkic) <= 0).length;
    const missingAccess = items.filter((row) => asNumber(row.photo_dojazd) <= 0).length;
    const missingPhotos = items.filter((row) => !photoPackageReady(row)).length;
    const missingPrice = items.filter((row) => !hasPrice(row)).length;
    const missingPlan = items.filter((row) => !hasCrewPlan(row)).length;
    const readyToApprove = items.filter((row) => missingList(row).length === 0 && hasTeam(row)).length;
    return { evidenceReady, photoTotal, missingSketch, missingAccess, missingPhotos, missingPrice, missingPlan, readyToApprove };
  }, [items]);
  const evidenceCards: {
    key: string;
    label: string;
    value: string;
    hint: string;
    icon: React.ComponentProps<typeof Ionicons>['name'];
    color: string;
  }[] = [
    {
      key: 'photo',
      label: 'Foto komplet',
      value: `${evidenceSummary.evidenceReady}/${stats.total}`,
      hint: 'wycena + szkic + dojazd',
      icon: 'images-outline',
      color: theme.success,
    },
    {
      key: 'sketch',
      label: 'Braki szkicu',
      value: String(evidenceSummary.missingSketch),
      hint: 'co trzeba przyciac',
      icon: 'create-outline',
      color: evidenceSummary.missingSketch ? theme.warning : theme.success,
    },
    {
      key: 'access',
      label: 'Braki dojazdu',
      value: String(evidenceSummary.missingAccess),
      hint: 'wjazd, brama, miejsce',
      icon: 'navigate-outline',
      color: evidenceSummary.missingAccess ? theme.warning : theme.success,
    },
    {
      key: 'approve',
      label: 'Do zatwierdzenia',
      value: String(evidenceSummary.readyToApprove),
      hint: `${evidenceSummary.photoTotal} zdjec lacznie`,
      icon: 'checkmark-done-outline',
      color: theme.accent,
    },
  ];
  const bottleneckCards: {
    key: FilterKey;
    label: string;
    value: number;
    hint: string;
    icon: React.ComponentProps<typeof Ionicons>['name'];
    color: string;
  }[] = [
    {
      key: 'photos',
      label: 'Foto pakiet',
      value: evidenceSummary.missingPhotos,
      hint: 'wycena, szkic, dojazd',
      icon: 'images-outline',
      color: evidenceSummary.missingPhotos ? theme.warning : theme.success,
    },
    {
      key: 'pricing',
      label: 'Cena',
      value: evidenceSummary.missingPrice,
      hint: 'brak kwoty dla klienta',
      icon: 'cash-outline',
      color: evidenceSummary.missingPrice ? theme.warning : theme.success,
    },
    {
      key: 'planning',
      label: 'Plan ekipy',
      value: evidenceSummary.missingPlan,
      hint: 'ekipa i czas pracy',
      icon: 'calendar-number-outline',
      color: evidenceSummary.missingPlan ? theme.warning : theme.success,
    },
    {
      key: 'ready',
      label: 'Gotowe',
      value: stats.complete,
      hint: 'mozna zatwierdzac',
      icon: 'checkmark-done-outline',
      color: stats.complete ? theme.accent : theme.textMuted,
    },
  ];

  const onRefresh = () => {
    setRefreshing(true);
    void load();
  };

  const approveDraftPlan = async (row: FieldDraft) => {
    if (!row.ekipa_id) {
      void triggerHaptic('warning');
      setError('Najpierw wybierz ekipę. Bez ekipy nie można zatwierdzić planu.');
      return;
    }
    setApprovingId(row.id);
    setError(null);
    try {
      const { token } = await getStoredSession();
      if (!token) {
        router.replace('/login');
        return;
      }
      const res = await fetch(`${API_URL}/tasks/${row.id}/przypisz`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ekipa_id: row.ekipa_id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        void triggerHaptic('warning');
        setError(data?.error || `Nie zatwierdzono planu #${row.id}.`);
        return;
      }
      void triggerHaptic('success');
      setItems((prev) => prev.filter((item) => item.id !== row.id));
      void load();
    } catch (err) {
      void triggerHaptic('error');
      setError(err instanceof Error ? err.message : `Nie zatwierdzono planu #${row.id}.`);
    } finally {
      setApprovingId(null);
    }
  };

  const confirmApproveDraft = (row: FieldDraft) => {
    const when = [formatDate(row.data_planowana), row.czas_planowany_godziny ? `${row.czas_planowany_godziny} h` : 'bez czasu'].join(' · ');
    Alert.alert(
      'Zatwierdzić plan?',
      `${row.klient_nazwa || `Zlecenie #${row.id}`}\n${row.ekipa_nazwa || `Ekipa #${row.ekipa_id}`}\n${when}`,
      [
        { text: 'Jeszcze nie', style: 'cancel' },
        { text: 'Zatwierdź', onPress: () => void approveDraftPlan(row) },
      ],
    );
  };

  const nextDraftMissing = nextDraft ? missingList(nextDraft) : [];
  const nextDraftReady = !!nextDraft && nextDraftMissing.length === 0;
  const nextDraftUrgent = !!nextDraft && isUrgent(nextDraft);
  const nextDraftScore = nextDraft ? completionScore(nextDraft) : 0;
  const nextDraftAddress = nextDraft ? [nextDraft.adres, nextDraft.miasto].filter(Boolean).join(', ') : '';
  const nextDraftColor = nextDraftReady ? theme.success : nextDraftUrgent ? theme.danger : theme.warning;

  if (loading) {
    return (
      <KeyboardSafeScreen style={S.center}>
        <StatusBar barStyle={theme.name === 'dark' ? 'light-content' : 'dark-content'} backgroundColor={theme.headerBg} />
        <ActivityIndicator color={theme.accent} size="large" />
      </KeyboardSafeScreen>
    );
  }

  return (
    <KeyboardSafeScreen style={S.root}>
      <StatusBar barStyle={theme.name === 'dark' ? 'light-content' : 'dark-content'} backgroundColor={theme.headerBg} />
      <ScreenHeader title="Do opracowania" edgeSlotWidth={48} />

      <ScrollView
        style={S.scroll}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={S.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.accent} colors={[theme.accent]} />}
      >
        {error ? <ErrorBanner message={error} /> : null}

        <View style={S.commandPanel}>
          <View style={S.commandTop}>
            <View style={S.commandIcon}>
              <Ionicons name="file-tray-full-outline" size={18} color={theme.accent} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={S.commandTitle}>Kolejka wycen terenowych</Text>
              <Text style={S.commandText}>Najpierw domykamy braki, potem planujemy ekipę i termin.</Text>
              <Text style={S.commandMeta}>
                SLA: pilne po 2h lub poniżej 50% danych
                {stats.oldestOpen ? ` · najstarszy czeka ${draftAgeLabel(stats.oldestOpen)}` : ''}
              </Text>
            </View>
            <TouchableOpacity style={S.refreshBtn} onPress={onRefresh}>
              <Ionicons name="refresh-outline" size={17} color={theme.accent} />
            </TouchableOpacity>
          </View>
        </View>

        <View style={S.kpiRow}>
          <KpiCard label="W kolejce" value={stats.total} color={theme.accent} theme={theme} />
          <KpiCard label="Pilne" value={stats.urgent} color={theme.danger} theme={theme} />
          <KpiCard label="Braki" value={stats.missing} color={theme.warning} theme={theme} />
          <KpiCard label="Gotowe" value={stats.complete} color={theme.success} theme={theme} />
        </View>

        <View style={S.officeBoard}>
          <View style={S.officeBoardHead}>
            <View style={S.officeBoardTitleWrap}>
              <View style={S.officeBoardIcon}>
                <Ionicons name="leaf-outline" size={17} color={theme.accent} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={S.officeBoardTitle}>Dowody terenowe</Text>
                <Text style={S.officeBoardSub}>Szybka kontrola: klient, zdjecia, szkic, dojazd i ekipa.</Text>
              </View>
            </View>
            <View style={S.officeBoardBadge}>
              <Text style={S.officeBoardBadgeText}>{stats.missing ? `${stats.missing} otwarte` : 'czysto'}</Text>
            </View>
          </View>

          <View style={S.officeBoardGrid}>
            {evidenceCards.map((card) => (
              <View key={card.key} style={S.evidenceCard}>
                <View style={[S.evidenceIcon, { backgroundColor: card.color + '18' }]}>
                  <Ionicons name={card.icon} size={16} color={card.color} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={S.evidenceLabel}>{card.label}</Text>
                  <Text style={S.evidenceHint} numberOfLines={1}>{card.hint}</Text>
                </View>
                <Text style={[S.evidenceValue, { color: card.color }]}>{card.value}</Text>
              </View>
            ))}
          </View>

          <View style={S.bottleneckBoard}>
            <View style={S.bottleneckHead}>
              <Ionicons name="options-outline" size={15} color={theme.accent} />
              <Text style={S.bottleneckTitle}>Co blokuje przekazanie dalej</Text>
            </View>
            <View style={S.bottleneckGrid}>
              {bottleneckCards.map((card) => {
                const active = filter === card.key;
                return (
                  <TouchableOpacity
                    key={card.key}
                    style={[
                      S.bottleneckCard,
                      {
                        borderColor: active ? card.color : theme.border,
                        backgroundColor: active ? card.color + '16' : theme.surface2,
                      },
                    ]}
                    onPress={() => {
                      setFilter(card.key);
                      void triggerHaptic('light');
                    }}
                  >
                    <View style={[S.bottleneckIcon, { backgroundColor: card.color + '18' }]}>
                      <Ionicons name={card.icon} size={15} color={card.color} />
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={S.bottleneckLabel} numberOfLines={1}>{card.label}</Text>
                      <Text style={S.bottleneckHint} numberOfLines={1}>{card.hint}</Text>
                    </View>
                    <Text style={[S.bottleneckValue, { color: card.color }]}>{card.value}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          <View style={S.officeFlow}>
            {['Telefon', 'Ogledziny', 'Foto pakiet', 'Plan ekipy'].map((step, index) => (
              <View key={step} style={S.officeFlowStep}>
                <View style={[S.officeFlowDot, index >= 2 && { backgroundColor: theme.accentLight, borderColor: theme.accent }]}>
                  <Text style={[S.officeFlowNo, index >= 2 && { color: theme.accent }]}>{index + 1}</Text>
                </View>
                <Text style={S.officeFlowText}>{step}</Text>
              </View>
            ))}
          </View>
        </View>

        {nextDraft ? (
          <View style={S.focusCard}>
            <View style={[S.cardAccent, { backgroundColor: nextDraftColor }]} />
            <View style={S.focusHeader}>
              <View style={[S.focusIcon, { backgroundColor: nextDraftColor + '1A' }]}>
                <Ionicons
                  name={nextDraftReady ? 'checkmark-done-outline' : nextDraftUrgent ? 'flame-outline' : 'file-tray-full-outline'}
                  size={18}
                  color={nextDraftColor}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={S.focusEyebrow}>
                  {nextDraftReady ? 'Gotowe do zatwierdzenia' : nextDraftUrgent ? 'Najpierw rozwiązać' : 'Następna sprawa dla biura'}
                </Text>
                <Text style={S.focusTitle} numberOfLines={1}>
                  #{nextDraft.id} {nextDraft.klient_nazwa || 'Bez klienta'}
                </Text>
                <Text style={S.focusSub} numberOfLines={1}>
                  {nextDraftAddress || 'Brak adresu'} · czeka {draftAgeLabel(nextDraft)}
                </Text>
              </View>
              <View style={[S.focusBadge, { backgroundColor: nextDraftColor + '20', borderColor: nextDraftColor + '66' }]}>
                <Text style={[S.focusBadgeText, { color: nextDraftColor }]}>{Math.round(nextDraftScore * 100)}%</Text>
              </View>
            </View>

            <View style={S.progressTrack}>
              <View style={[S.progressFill, { width: `${Math.round(nextDraftScore * 100)}%`, backgroundColor: nextDraftColor }]} />
            </View>

            <View style={S.checklistGrid}>
              {readinessChecks(nextDraft).map((check) => (
                <View
                  key={check.key}
                  style={[
                    S.checkChip,
                    {
                      borderColor: check.done ? theme.success + '77' : theme.warning + '77',
                      backgroundColor: check.done ? theme.successBg : theme.warningBg,
                    },
                  ]}
                >
                  <Ionicons name={check.done ? 'checkmark-circle-outline' : check.icon} size={14} color={check.done ? theme.success : theme.warning} />
                  <Text style={[S.checkLabel, { color: check.done ? theme.success : theme.warning }]}>{check.label}</Text>
                  <Text style={[S.checkHint, { color: theme.textSub }]} numberOfLines={1}>{check.hint}</Text>
                </View>
              ))}
            </View>

            <View style={[S.nextStepBox, { borderColor: nextDraftColor, backgroundColor: nextDraftColor + '14' }]}>
              <Ionicons name={nextDraftReady ? 'calendar-outline' : 'alert-circle-outline'} size={16} color={nextDraftColor} />
              <Text style={[S.nextStepText, { color: nextDraftColor }]}>
                {nextDraftReady ? 'Paczka kompletna: zaplanować termin i zatwierdzić ekipę.' : `Domknąć: ${primaryMissing(nextDraft)}`}
              </Text>
            </View>

            <View style={S.actions}>
              {nextDraft.klient_telefon ? (
                <TouchableOpacity
                  style={S.actionBtn}
                  onPress={() => {
                    void triggerHaptic('light');
                    void Linking.openURL(`tel:${nextDraft.klient_telefon}`);
                  }}
                >
                  <Ionicons name="call-outline" size={15} color={theme.success} />
                  <Text style={[S.actionText, { color: theme.success }]}>Dzwoń</Text>
                </TouchableOpacity>
              ) : null}
              {nextDraftAddress ? (
                <TouchableOpacity
                  style={S.actionBtn}
                  onPress={() => {
                    void triggerHaptic('light');
                    void openAddressInMaps(nextDraft.adres || '', nextDraft.miasto || '');
                  }}
                >
                  <Ionicons name="map-outline" size={15} color={theme.warning} />
                  <Text style={[S.actionText, { color: theme.warning }]}>Mapa</Text>
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity
                style={S.actionBtn}
                onPress={() => {
                  void triggerHaptic('light');
                  router.push(`/zlecenie/${nextDraft.id}?tab=zdjecia` as never);
                }}
              >
                <Ionicons name="camera-outline" size={15} color={theme.info} />
                <Text style={[S.actionText, { color: theme.info }]}>Zdjęcia</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={S.actionBtn}
                onPress={() => {
                  void triggerHaptic('light');
                  router.push(`/zlecenie/${nextDraft.id}` as never);
                }}
              >
                <Ionicons name="open-outline" size={15} color={theme.accent} />
                <Text style={[S.actionText, { color: theme.accent }]}>Otwórz kartę</Text>
              </TouchableOpacity>
              {nextDraftReady && nextDraft.ekipa_id ? (
                <TouchableOpacity
                  style={[S.actionBtn, S.actionBtnPrimary, approvingId === nextDraft.id && { opacity: 0.65 }]}
                  onPress={() => confirmApproveDraft(nextDraft)}
                  disabled={approvingId === nextDraft.id}
                >
                  {approvingId === nextDraft.id ? (
                    <ActivityIndicator size="small" color={theme.accentText} />
                  ) : (
                    <Ionicons name="checkmark-done-outline" size={15} color={theme.accentText} />
                  )}
                  <Text style={S.actionPrimaryText}>Zatwierdź plan</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </View>
        ) : null}

        <View style={S.filterRow}>
          {FILTERS.map((f) => {
            const active = filter === f.key;
            return (
              <TouchableOpacity
                key={f.key}
                style={[S.filterBtn, active && { backgroundColor: theme.accentLight, borderColor: theme.accent }]}
                onPress={() => {
                  setFilter(f.key);
                  void triggerHaptic('light');
                }}
              >
                <Text style={[S.filterText, active && { color: theme.accent }]}>{f.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {items.length === 0 ? (
          <EmptyState
            icon="checkmark-done-circle-outline"
            title="Brak draftów do opracowania"
            subtitle="Gdy wyceniający zapisze draft terenowy, pojawi się tutaj."
          />
        ) : visibleItems.length === 0 ? (
          <EmptyState
            icon="filter-outline"
            title="Nic w tym filtrze"
            subtitle="Zmień filtr albo odśwież kolejkę."
          />
        ) : (
          visibleItems.map((item, index) => {
            const missing = missingList(item);
            const ready = missing.length === 0;
            const urgent = isUrgent(item);
            const score = completionScore(item);
            const address = [item.adres, item.miasto].filter(Boolean).join(', ');
            const priorityColor = ready ? theme.success : urgent ? theme.danger : theme.warning;
            const priorityLabel = ready ? 'gotowe do planu' : urgent ? 'pilne' : 'do triage';
            return (
              <PlatinumAppear key={item.id} delayMs={20 * Math.min(index, 8)}>
                <View style={S.card}>
                  <View style={[S.cardAccent, { backgroundColor: priorityColor }]} />
                  <View style={S.cardTop}>
                    <View style={{ flex: 1 }}>
                      <Text style={S.cardTitle} numberOfLines={1}>#{item.id} {item.klient_nazwa || 'Bez klienta'}</Text>
                      <Text style={S.cardSub} numberOfLines={1}>{address || 'Brak adresu'}</Text>
                    </View>
                    <View style={[S.readyBadge, { backgroundColor: priorityColor + '22' }]}>
                      <Text style={[S.readyBadgeText, { color: priorityColor }]}>
                        {priorityLabel}
                      </Text>
                    </View>
                  </View>

                  <View style={S.progressBlock}>
                    <View style={S.progressTop}>
                      <Text style={S.progressLabel}>Kompletność pakietu</Text>
                      <Text style={[S.progressValue, { color: ready ? theme.success : theme.warning }]}>
                        {Math.round(score * 100)}%
                      </Text>
                    </View>
                    <View style={S.progressTrack}>
                      <View style={[S.progressFill, { width: `${Math.round(score * 100)}%`, backgroundColor: ready ? theme.success : theme.warning }]} />
                    </View>
                  </View>

                  <View style={S.metaGrid}>
                    <MetaPill icon="calendar-outline" text={formatDate(item.data_planowana)} theme={theme} />
                    <MetaPill icon="cash-outline" text={formatMoney(item.wartosc_planowana)} theme={theme} />
                    <MetaPill icon="time-outline" text={item.czas_planowany_godziny ? `${item.czas_planowany_godziny} h` : 'bez czasu'} theme={theme} />
                    <MetaPill icon="people-outline" text={item.ekipa_nazwa || 'bez ekipy'} theme={theme} />
                    <MetaPill icon="timer-outline" text={`czeka ${draftAgeLabel(item)}`} theme={theme} />
                  </View>

                  <View style={S.photoRow}>
                    {PHOTO_REQUIREMENTS.map((req) => {
                      const value = asNumber(item[req.key]);
                      const ok = value > 0;
                      return (
                        <View key={req.key} style={[S.photoPill, { borderColor: ok ? theme.success : theme.warning, backgroundColor: ok ? theme.successBg : theme.warningBg }]}>
                          <Ionicons name={req.icon} size={13} color={ok ? theme.success : theme.warning} />
                          <Text style={[S.photoPillText, { color: ok ? theme.success : theme.warning }]}>{req.label}: {value}</Text>
                        </View>
                      );
                    })}
                  </View>

                  <View style={S.checklistGrid}>
                    {readinessChecks(item).map((check) => (
                      <View
                        key={check.key}
                        style={[
                          S.checkChip,
                          {
                            borderColor: check.done ? theme.success + '77' : theme.warning + '77',
                            backgroundColor: check.done ? theme.successBg : theme.warningBg,
                          },
                        ]}
                      >
                        <Ionicons name={check.done ? 'checkmark-circle-outline' : check.icon} size={14} color={check.done ? theme.success : theme.warning} />
                        <Text style={[S.checkLabel, { color: check.done ? theme.success : theme.warning }]}>{check.label}</Text>
                        <Text style={[S.checkHint, { color: theme.textSub }]} numberOfLines={1}>{check.hint}</Text>
                      </View>
                    ))}
                  </View>

                  <View style={[S.nextStepBox, { borderColor: priorityColor, backgroundColor: priorityColor + '18' }]}>
                    <Ionicons name={ready ? 'checkmark-done-outline' : urgent ? 'flame-outline' : 'alert-circle-outline'} size={16} color={priorityColor} />
                    <Text style={[S.nextStepText, { color: ready ? theme.success : urgent ? theme.danger : theme.warning }]}>
                      {urgent ? 'Pilne: ' : 'Następny krok: '}{primaryMissing(item)}
                    </Text>
                  </View>

                  {missing.length > 0 ? (
                    <View style={S.missingBox}>
                      <Text style={S.missingTitle}>Brakuje:</Text>
                      <View style={S.missingChips}>
                        {missing.map((m) => (
                          <View key={m} style={S.missingChip}>
                            <Text style={S.missingChipText}>{m}</Text>
                          </View>
                        ))}
                      </View>
                    </View>
                  ) : (
                    <View style={[S.readyBox, { borderColor: theme.success, backgroundColor: theme.successBg }]}>
                      <Ionicons name="checkmark-circle-outline" size={16} color={theme.success} />
                      <Text style={[S.readyText, { color: theme.success }]}>Pakiet terenowy jest kompletny do dalszego planowania.</Text>
                    </View>
                  )}

                  <View style={S.actions}>
                    <TouchableOpacity
                      style={S.actionBtn}
                      onPress={() => {
                        void triggerHaptic('light');
                        router.push(`/zlecenie/${item.id}` as never);
                      }}
                    >
                      <Ionicons name="open-outline" size={15} color={theme.accent} />
                      <Text style={[S.actionText, { color: theme.accent }]}>Otwórz</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={S.actionBtn}
                      onPress={() => {
                        void triggerHaptic('light');
                        router.push(`/zlecenie/${item.id}?tab=zdjecia` as never);
                      }}
                    >
                      <Ionicons name="camera-outline" size={15} color={theme.info} />
                      <Text style={[S.actionText, { color: theme.info }]}>Zdjęcia</Text>
                    </TouchableOpacity>
                    {ready ? (
                      <TouchableOpacity
                        style={S.actionBtn}
                        onPress={() => {
                          void triggerHaptic('light');
                          router.push('/harmonogram' as never);
                        }}
                      >
                        <Ionicons name="calendar-outline" size={15} color={theme.success} />
                        <Text style={[S.actionText, { color: theme.success }]}>Plan</Text>
                      </TouchableOpacity>
                    ) : null}
                    {ready && item.ekipa_id ? (
                      <TouchableOpacity
                        style={[S.actionBtn, S.actionBtnPrimary, approvingId === item.id && { opacity: 0.65 }]}
                        onPress={() => confirmApproveDraft(item)}
                        disabled={approvingId === item.id}
                      >
                        {approvingId === item.id ? (
                          <ActivityIndicator size="small" color={theme.accentText} />
                        ) : (
                          <Ionicons name="checkmark-done-outline" size={15} color={theme.accentText} />
                        )}
                        <Text style={S.actionPrimaryText}>Zatwierdź plan</Text>
                      </TouchableOpacity>
                    ) : null}
                    {item.data_planowana ? (
                      <TouchableOpacity
                        style={S.actionBtn}
                        onPress={() => {
                          void triggerHaptic('light');
                          const prefData = item.data_planowana?.split('T')[0] || '';
                          router.push({
                            pathname: '/rezerwacje-sprzetu',
                            params: { prefData, prefZlecenie: String(item.id) },
                          } as never);
                        }}
                      >
                        <Ionicons name="construct-outline" size={15} color={theme.accent} />
                        <Text style={[S.actionText, { color: theme.accent }]}>Sprzęt</Text>
                      </TouchableOpacity>
                    ) : null}
                    {item.klient_telefon ? (
                      <TouchableOpacity style={S.actionBtn} onPress={() => Linking.openURL(`tel:${item.klient_telefon}`)}>
                        <Ionicons name="call-outline" size={15} color={theme.success} />
                        <Text style={[S.actionText, { color: theme.success }]}>Dzwoń</Text>
                      </TouchableOpacity>
                    ) : null}
                    {address ? (
                      <TouchableOpacity style={S.actionBtn} onPress={() => void openAddressInMaps(item.adres || '', item.miasto || '')}>
                        <Ionicons name="map-outline" size={15} color={theme.warning} />
                        <Text style={[S.actionText, { color: theme.warning }]}>Mapa</Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                </View>
              </PlatinumAppear>
            );
          })
        )}
      </ScrollView>
    </KeyboardSafeScreen>
  );
}

function KpiCard({ label, value, color, theme }: { label: string; value: number; color: string; theme: Theme }) {
  return (
    <View style={[stylesShared.kpiCard, { backgroundColor: theme.cardBg, borderColor: theme.cardBorder }]}>
      <Text style={[stylesShared.kpiValue, { color }]}>{value}</Text>
      <Text style={[stylesShared.kpiLabel, { color: theme.textSub }]}>{label}</Text>
    </View>
  );
}

function MetaPill({ icon, text, theme }: { icon: React.ComponentProps<typeof Ionicons>['name']; text: string; theme: Theme }) {
  return (
    <View style={[stylesShared.metaPill, { backgroundColor: theme.surface2, borderColor: theme.border }]}>
      <Ionicons name={icon} size={13} color={theme.textMuted} />
      <Text style={[stylesShared.metaText, { color: theme.textSub }]} numberOfLines={1}>{text}</Text>
    </View>
  );
}

const stylesShared = StyleSheet.create({
  kpiCard: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
  },
  kpiValue: { fontSize: 22, fontWeight: '900', fontVariant: ['tabular-nums'] },
  kpiLabel: { fontSize: 11, fontWeight: '700', marginTop: 2 },
  metaPill: {
    width: '48%',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 9,
    paddingVertical: 7,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  metaText: { flex: 1, fontSize: 12, fontWeight: '700' },
});

const makeStyles = (t: Theme) => StyleSheet.create({
  root: { flex: 1, backgroundColor: t.bg },
  center: { flex: 1, backgroundColor: t.bg, alignItems: 'center', justifyContent: 'center' },
  scroll: { flex: 1 },
  content: { padding: 12, paddingBottom: 44, gap: 12 },
  commandPanel: {
    borderWidth: 1,
    borderColor: t.cardBorder,
    backgroundColor: t.cardBg,
    borderRadius: 12,
    padding: 14,
  },
  commandTop: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  commandIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: t.accentLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  commandTitle: { color: t.text, fontSize: 16, fontWeight: '900' },
  commandText: { color: t.textMuted, fontSize: 12, lineHeight: 17, marginTop: 2 },
  commandMeta: { color: t.textMuted, fontSize: 11, lineHeight: 15, marginTop: 5, fontWeight: '700' },
  refreshBtn: {
    width: 42,
    height: 42,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: t.cardBorder,
    backgroundColor: t.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  kpiRow: { flexDirection: 'row', gap: 8 },
  officeBoard: {
    borderWidth: 1,
    borderColor: t.cardBorder,
    backgroundColor: t.cardBg,
    borderRadius: 16,
    padding: 13,
    gap: 12,
  },
  officeBoardHead: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 },
  officeBoardTitleWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  officeBoardIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: t.accentLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  officeBoardTitle: { color: t.text, fontSize: 15, fontWeight: '900' },
  officeBoardSub: { color: t.textMuted, fontSize: 11, lineHeight: 15, marginTop: 2 },
  officeBoardBadge: {
    borderWidth: 1,
    borderColor: t.accent + '55',
    backgroundColor: t.accentLight,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  officeBoardBadgeText: { color: t.accent, fontSize: 10, fontWeight: '900', textTransform: 'uppercase' },
  officeBoardGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  evidenceCard: {
    width: '48%',
    minHeight: 76,
    borderWidth: 1,
    borderColor: t.border,
    backgroundColor: t.surface2,
    borderRadius: 14,
    padding: 10,
    gap: 7,
  },
  evidenceIcon: {
    width: 30,
    height: 30,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  evidenceLabel: { color: t.text, fontSize: 12, fontWeight: '900' },
  evidenceHint: { color: t.textMuted, fontSize: 10, fontWeight: '700', marginTop: 2 },
  evidenceValue: {
    position: 'absolute',
    right: 10,
    top: 10,
    fontSize: 18,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  bottleneckBoard: {
    borderWidth: 1,
    borderColor: t.border,
    backgroundColor: t.surface2,
    borderRadius: 14,
    padding: 10,
    gap: 9,
  },
  bottleneckHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  bottleneckTitle: { color: t.text, fontSize: 12.5, fontWeight: '900' },
  bottleneckGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  bottleneckCard: {
    flexGrow: 1,
    flexBasis: '47%',
    minHeight: 56,
    borderWidth: 1,
    borderRadius: 13,
    paddingHorizontal: 9,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  bottleneckIcon: {
    width: 30,
    height: 30,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottleneckLabel: { color: t.text, fontSize: 11.5, fontWeight: '900' },
  bottleneckHint: { color: t.textMuted, fontSize: 10, lineHeight: 14, marginTop: 1 },
  bottleneckValue: { fontSize: 15, fontWeight: '900', fontVariant: ['tabular-nums'] },
  officeFlow: {
    borderWidth: 1,
    borderColor: t.border,
    backgroundColor: t.surface2,
    borderRadius: 14,
    padding: 8,
    flexDirection: 'row',
    gap: 6,
  },
  officeFlowStep: { flex: 1, alignItems: 'center', gap: 5 },
  officeFlowDot: {
    width: 24,
    height: 24,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: t.border,
    backgroundColor: t.cardBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  officeFlowNo: { color: t.textMuted, fontSize: 10, fontWeight: '900', fontVariant: ['tabular-nums'] },
  officeFlowText: { color: t.textSub, fontSize: 9, fontWeight: '900', textAlign: 'center' },
  focusCard: {
    borderWidth: 1,
    borderColor: t.cardBorder,
    backgroundColor: t.cardBg,
    borderRadius: 12,
    padding: 14,
    paddingLeft: 17,
    gap: 11,
    overflow: 'hidden',
  },
  focusHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  focusIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  focusEyebrow: { color: t.textMuted, fontSize: 10, fontWeight: '900', textTransform: 'uppercase' },
  focusTitle: { color: t.text, fontSize: 16, fontWeight: '900', marginTop: 2 },
  focusSub: { color: t.textMuted, fontSize: 12, marginTop: 2 },
  focusBadge: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 6,
  },
  focusBadgeText: { fontSize: 12, fontWeight: '900', fontVariant: ['tabular-nums'] },
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    borderWidth: 1,
    borderColor: t.cardBorder,
    backgroundColor: t.surface2,
    borderRadius: 12,
    padding: 5,
  },
  filterBtn: {
    flexGrow: 1,
    flexBasis: '30%',
    borderWidth: 1,
    borderColor: 'transparent',
    borderRadius: 10,
    paddingVertical: 9,
    alignItems: 'center',
  },
  filterText: { color: t.textMuted, fontSize: 11, fontWeight: '900' },
  card: {
    borderWidth: 1,
    borderColor: t.cardBorder,
    backgroundColor: t.cardBg,
    borderRadius: 12,
    padding: 14,
    paddingLeft: 17,
    gap: 11,
    overflow: 'hidden',
  },
  cardAccent: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 4 },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  cardTitle: { color: t.text, fontSize: 15, fontWeight: '900' },
  cardSub: { color: t.textMuted, fontSize: 12, marginTop: 2 },
  readyBadge: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 5 },
  readyBadgeText: { fontSize: 10, fontWeight: '900', textTransform: 'uppercase' },
  progressBlock: { gap: 6 },
  progressTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  progressLabel: { color: t.textSub, fontSize: 11, fontWeight: '800' },
  progressValue: { fontSize: 11, fontWeight: '900', fontVariant: ['tabular-nums'] },
  progressTrack: { height: 7, borderRadius: 999, backgroundColor: t.surface2, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 999 },
  metaGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  photoRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  photoPill: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  photoPillText: { fontSize: 11, fontWeight: '900' },
  checklistGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  checkChip: {
    width: '48%',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 9,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  checkLabel: { fontSize: 11, fontWeight: '900' },
  checkHint: { flex: 1, textAlign: 'right', fontSize: 11, fontWeight: '800' },
  nextStepBox: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  nextStepText: { flex: 1, fontSize: 12, fontWeight: '900' },
  missingBox: {
    borderWidth: 1,
    borderColor: t.warning + '55',
    backgroundColor: t.warningBg,
    borderRadius: 12,
    padding: 10,
    gap: 7,
  },
  missingTitle: { color: t.warning, fontSize: 12, fontWeight: '900' },
  missingChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  missingChip: {
    backgroundColor: t.cardBg,
    borderColor: t.warning + '55',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  missingChipText: { color: t.warning, fontSize: 11, fontWeight: '800' },
  readyBox: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  readyText: { flex: 1, fontSize: 12, fontWeight: '800' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  actionBtn: {
    borderWidth: 1,
    borderColor: t.border,
    backgroundColor: t.surface2,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  actionText: { fontSize: 12, fontWeight: '900' },
  actionBtnPrimary: {
    borderColor: t.accent,
    backgroundColor: t.accent,
  },
  actionPrimaryText: { color: t.accentText, fontSize: 12, fontWeight: '900' },
});
