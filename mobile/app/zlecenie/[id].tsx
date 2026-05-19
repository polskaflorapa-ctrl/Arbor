import * as ImagePicker from 'expo-image-picker';
import * as Clipboard from 'expo-clipboard';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, Image, KeyboardAvoidingView, Linking, Modal, PanResponder, Platform, RefreshControl,
  ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity,
  View, StatusBar,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import ViewShot from 'react-native-view-shot';
import Svg, { Path as SvgPath } from 'react-native-svg';
import { OfflineQueueBanner } from '../../components/ui/app-state';
import { KeyboardSafeScreen } from '../../components/ui/keyboard-safe-screen';
import { PlatinumCTA } from '../../components/ui/platinum-cta';
import { PlatinumIconBadge } from '../../components/ui/platinum-icon-badge';
import { useLanguage } from '../../constants/LanguageContext';
import { useTheme } from '../../constants/ThemeContext';
import { openBrowserAsync, WebBrowserPresentationStyle } from 'expo-web-browser';
import { API_BASE_URL, API_URL, WEB_APP_URL } from '../../constants/api';
import { shadowStyle } from '../../constants/elevation';
import type { Theme } from '../../constants/theme';
import { useOddzialFeatureGuard } from '../../hooks/use-oddzial-feature-guard';
import { isFeatureEnabledForOddzial } from '../../utils/oddzial-features';
import {
  createOfflineRequestId,
  flushOfflineQueue,
  getOfflineQueueSize,
  queueRequestWithOfflineFallback,
  queueTaskPhotoOffline,
} from '../../utils/offline-queue';
import { subscribeOfflineFlushDone } from '../../utils/offline-queue-sync-events';
import { openAddressInMaps } from '../../utils/maps-link';
import { getStoredSession } from '../../utils/session';
import { TASK_STATUS, TASK_STATUSES, getNextTaskStatuses, getTaskWorkflowStep, isTaskDone, makeTaskStatusColorMap } from '../../constants/task-workflow';
import {
  TASK_EQUIPMENT_OPTIONS,
  TASK_RISK_PRESETS,
  TASK_SCOPE_PRESETS,
  TASK_SETTLEMENT_OPTIONS,
  appendUniqueLine,
} from '../../constants/task-form';
import { triggerHaptic } from '../../utils/haptics';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

const TYP_ZDJECIA_KEYS = ['wycena', 'szkic', 'dojazd', 'checkin', 'przed', 'po', 'inne'] as const;
const PHOTO_TYPE_LABELS: Record<(typeof TYP_ZDJECIA_KEYS)[number], string> = {
  wycena: 'Wycena u klienta',
  szkic: 'Szkic zakresu',
  dojazd: 'Dojazd / posesja',
  checkin: 'Check-in',
  przed: 'Przed pracą',
  po: 'Po pracy',
  inne: 'Inne',
};
const SAFETY_CHECKLIST_ITEMS = [
  {
    key: 'zone',
    label: 'Strefa pracy',
    hint: 'Odgradzona, klient i osoby postronne poza zasiegiem.',
    icon: 'alert-circle-outline',
  },
  {
    key: 'power',
    label: 'Linie i przeszkody',
    hint: 'Sprawdzone przewody, ogrodzenia, auta, dachy i szkody ryzyka.',
    icon: 'flash-outline',
  },
  {
    key: 'ppe',
    label: 'Sprzęt i PPE',
    hint: 'Kaski, uprzęże, piła, rębak i komunikacja ekipy gotowe.',
    icon: 'construct-outline',
  },
  {
    key: 'escape',
    label: 'Droga ucieczki',
    hint: 'Ustalona strefa zrzutu, kierunek obalenia i awaryjny odwrót.',
    icon: 'walk-outline',
  },
  {
    key: 'client',
    label: 'Klient poinformowany',
    hint: 'Zakres, ryzyka, odpady i ograniczenia uzgodnione na miejscu.',
    icon: 'chatbubble-ellipses-outline',
  },
] as const;
const DEFAULT_FIELD_SETTLEMENT = TASK_SETTLEMENT_OPTIONS[0]?.note || '';
type PhotoTypeKey = (typeof TYP_ZDJECIA_KEYS)[number];
type PhotoFilterKey = 'all' | PhotoTypeKey;

type FinishRequirements = {
  require_po_photo: boolean;
  require_przed_photo: boolean;
  require_material_usage: boolean;
  has_po_photo: boolean;
  has_przed_photo: boolean;
};

type SafetyLogRow = {
  key: string;
  label: string;
  hint: string | null;
  done: boolean;
};

function parseSafetyLogRows(value: unknown): SafetyLogRow[] {
  const raw = typeof value === 'string'
    ? (() => {
      try { return JSON.parse(value); } catch { return []; }
    })()
    : value;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row, index) => {
      const item = row && typeof row === 'object' ? row as Record<string, unknown> : {};
      const label = String(item.label || item.key || '').trim();
      if (!label) return null;
      return {
        key: String(item.key || `bhp-${index}`).trim(),
        label,
        hint: item.hint == null ? null : String(item.hint).trim(),
        done: item.done === true,
      };
    })
    .filter((row): row is SafetyLogRow => Boolean(row));
}

function photoTypMatches(typ: unknown, allowed: string[]) {
  const k = String(typ ?? '')
    .toLowerCase()
    .trim();
  return allowed.includes(k);
}

function absolutePhotoUrl(pathMaybe: unknown) {
  const raw = String(pathMaybe || '');
  if (!raw) return '';
  if (raw.startsWith('http://') || raw.startsWith('https://')) return raw;
  return `${API_BASE_URL}${raw.startsWith('/') ? raw : `/${raw}`}`;
}

function compactLines(value: unknown) {
  return String(value || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

type WorkflowMissingItem = {
  key: string;
  label: string;
  required: boolean;
};

function taskWorkflowMissingItems(task: any): WorkflowMissingItem[] {
  const rawItems = Array.isArray(task?.workflow_missing_items) ? task.workflow_missing_items : [];
  const labels = Array.isArray(task?.workflow_missing_labels) ? task.workflow_missing_labels : [];
  const items = [
    ...rawItems.map((item: any) => ({
      key: String(item?.key || item?.label || '').trim(),
      label: String(item?.label || item?.key || '').trim(),
      required: item?.required !== false,
    })),
    ...labels.map((label: unknown) => ({
      key: String(label || '').trim(),
      label: String(label || '').trim(),
      required: true,
    })),
  ].filter((item) => item.label);
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.key || item.label}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function workflowTargetFor(item?: WorkflowMissingItem) {
  const key = String(item?.key || item?.label || '').toLowerCase();
  if (key.includes('photo') || key.includes('zdjec') || key.includes('zdję') || key.includes('sketch') || key.includes('szkic') || key.includes('dojazd')) {
    return 'photos';
  }
  if (key.includes('brief') || key.includes('opis') || key.includes('zakres') || key.includes('price') || key.includes('cena') || key.includes('budzet') || key.includes('budżet') || key.includes('hours') || key.includes('czas')) {
    return 'field';
  }
  return 'details';
}

function workflowPhotoFilterFor(item?: WorkflowMissingItem): PhotoFilterKey {
  const key = String(item?.key || item?.label || '').toLowerCase();
  if (key.includes('szkic') || key.includes('sketch')) return 'szkic';
  if (key.includes('dojazd') || key.includes('posesja')) return 'dojazd';
  if (key.includes('photo') || key.includes('zdjec') || key.includes('zdję') || key.includes('wycena')) return 'wycena';
  return 'all';
}

function taskMutationPayload(data: unknown) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
  const {
    message: _message,
    idempotent_replay: _idempotentReplay,
    sprzet_ids: _equipmentIds,
    rezerwacje_sprzetu: _equipmentReservations,
    ...taskFields
  } = data as Record<string, unknown>;
  return taskFields;
}

function mergeTaskMutationResponse(currentTask: any, data: unknown, fallback: Record<string, unknown> = {}) {
  const taskFields = taskMutationPayload(data);
  const merged = {
    ...(currentTask || {}),
    ...fallback,
    ...taskFields,
  } as Record<string, unknown>;
  if (merged.id == null) merged.id = fallback.id ?? currentTask?.id;
  return merged;
}

function orderPrioColors(theme: Theme) {
  return {
    Pilny: theme.danger,
    Wysoki: theme.warning,
    Normalny: theme.info,
    Niski: theme.textMuted,
  };
}

function orderPhotoTypeMeta(theme: Theme): Record<(typeof TYP_ZDJECIA_KEYS)[number], { icon: IoniconName; color: string }> {
  return {
    wycena: { icon: 'clipboard', color: theme.accent },
    szkic: { icon: 'create', color: theme.info },
    dojazd: { icon: 'navigate', color: theme.warning },
    checkin: { icon: 'location', color: theme.info },
    przed: { icon: 'camera', color: theme.warning },
    po: { icon: 'checkmark-circle', color: theme.success },
    inne: { icon: 'images', color: theme.textSub },
  };
}

export default function ZlecenieDetailScreen() {
  const { id, tab } = useLocalSearchParams<{ id: string; tab?: string }>();
  const { theme } = useTheme();
  const { t } = useLanguage();
  const guard = useOddzialFeatureGuard('/zlecenia');
  const statusPalette = useMemo(() => makeTaskStatusColorMap(theme), [theme]);
  const prioPalette = useMemo(() => orderPrioColors(theme), [theme]);
  const photoTypeMeta = useMemo(() => orderPhotoTypeMeta(theme), [theme]);
  const [user, setUser] = useState<any>(null);
  const [zlecenie, setZlecenie] = useState<any>(null);
  const [logi, setLogi] = useState<any[]>([]);
  const [problemy, setProblemy] = useState<any[]>([]);
  const [zdjecia, setZdjecia] = useState<any[]>([]);
  const [pomocnicy, setPomocnicy] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<'info' | 'logi' | 'problemy' | 'zdjecia'>('info');
  const [changingStatus, setChangingStatus] = useState(false);
  const [problemModal, setProblemModal] = useState(false);
  const [zdjecieModal, setZdjecieModal] = useState(false);
  const [photoFilter, setPhotoFilter] = useState<PhotoFilterKey>('all');
  const [photoPreview, setPhotoPreview] = useState<any | null>(null);
  const [photoOpisDraft, setPhotoOpisDraft] = useState('');
  const [photoTagiDraft, setPhotoTagiDraft] = useState('');
  const [problemForm, setProblemForm] = useState({ typ: 'usterka', opis: '' });
  const [lokalizacja, setLokalizacja] = useState<any>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [offlineQueueCount, setOfflineQueueCount] = useState(0);
  const [cmrLista, setCmrLista] = useState<any[]>([]);
  /** Minimalna liczba zdjęć na typ przy wymogu finish — zgodnie z `FINISH_PHOTO_MIN` w os/taskSettlement.js */
  const MIN_FINISH_TYP_PHOTOS = 2;
  const finishRequirements: FinishRequirements = useMemo(() => {
    const raw = zlecenie?.finish_requirements as Partial<FinishRequirements> | undefined;
    const countPoLocal = zdjecia.filter((z: { typ?: string }) =>
      photoTypMatches(z?.typ, ['po', 'after']),
    ).length;
    const countPrzedLocal = zdjecia.filter((z: { typ?: string }) =>
      photoTypMatches(z?.typ, ['przed', 'before', 'checkin']),
    ).length;
    const hasPoLocal = countPoLocal >= MIN_FINISH_TYP_PHOTOS;
    const hasPrzedLocal = countPrzedLocal >= MIN_FINISH_TYP_PHOTOS;
    if (raw && typeof raw.require_po_photo === 'boolean') {
      return {
        require_po_photo: !!raw.require_po_photo,
        require_przed_photo: !!raw.require_przed_photo,
        require_material_usage: !!raw.require_material_usage,
        has_po_photo: !!raw.has_po_photo || hasPoLocal,
        has_przed_photo: !!raw.has_przed_photo || hasPrzedLocal,
      };
    }
    return {
      require_po_photo: false,
      require_przed_photo: false,
      require_material_usage: false,
      has_po_photo: hasPoLocal,
      has_przed_photo: hasPrzedLocal,
    };
  }, [zlecenie, zdjecia]);
  const [finishModal, setFinishModal] = useState(false);
  const [finishUsageNazwa, setFinishUsageNazwa] = useState('');
  const [finishUsageIlosc, setFinishUsageIlosc] = useState('');
  const [finishNotatki, setFinishNotatki] = useState('');
  const [finishIssuesReviewed, setFinishIssuesReviewed] = useState(false);
  const [finishClientAccepted, setFinishClientAccepted] = useState(false);
  const [payForm, setPayForm] = useState({
    forma_platnosc: 'Gotowka' as 'Gotowka' | 'Przelew' | 'Faktura_VAT' | 'Brak',
    kwota_odebrana: '',
    faktura_vat: false,
    nip: '',
  });
  const [extraOpis, setExtraOpis] = useState('');
  const [quoteAmount, setQuoteAmount] = useState<Record<number, string>>({});
  const [showClientSignatureModal, setShowClientSignatureModal] = useState(false);
  const [clientSignature, setClientSignature] = useState<any>(null);
  const [scopeConfirmed, setScopeConfirmed] = useState(false);
  const [safetyChecks, setSafetyChecks] = useState<Record<string, boolean>>({});
  const [fieldScopeDraft, setFieldScopeDraft] = useState('');
  const [fieldTimeDraft, setFieldTimeDraft] = useState('');
  const [fieldBudgetDraft, setFieldBudgetDraft] = useState('');
  const [fieldRiskDraft, setFieldRiskDraft] = useState('');
  const [fieldScopePresetKeys, setFieldScopePresetKeys] = useState<string[]>([]);
  const [fieldEquipmentKeys, setFieldEquipmentKeys] = useState<string[]>([]);
  const [fieldSettlementDraft, setFieldSettlementDraft] = useState<string>(DEFAULT_FIELD_SETTLEMENT);
  const [fieldClientAccepted, setFieldClientAccepted] = useState(false);
  const [fieldPackageSaving, setFieldPackageSaving] = useState(false);
  const scopeConfirmKey = useMemo(() => `arbor-task-scope-confirmed:${id}`, [id]);
  const safetyChecklistKey = useMemo(() => `arbor-task-safety-checklist:${id}`, [id]);

  const openCmrInBrowser = useCallback(async (path: string) => {
    const base = WEB_APP_URL.replace(/\/+$/, '');
    const p = path.startsWith('/') ? path : `/${path}`;
    const url = `${base}${p}`;
    try {
      await openBrowserAsync(url, { presentationStyle: WebBrowserPresentationStyle.AUTOMATIC });
    } catch {
      Alert.alert(t('notif.alert.errorTitle'), url);
    }
  }, [t]);

  const openTaskProtocolPdf = useCallback(async () => {
    if (!token) {
      router.replace('/login');
      return;
    }
    try {
      const res = await fetch(`${API_URL}/tasks/${id}/protokol-link`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const msg = await res.text().catch(() => '');
        Alert.alert(t('notif.alert.errorTitle'), msg.slice(0, 200) || `HTTP ${res.status}`);
        return;
      }
      const data = await res.json().catch(() => ({}));
      const relPath = String((data as { path?: string }).path || '').trim();
      if (!relPath) {
        Alert.alert(t('notif.alert.errorTitle'), 'Brak linku do protokołu.');
        return;
      }
      const url = relPath.startsWith('http') ? relPath : `${API_BASE_URL}${relPath}`;
      await openBrowserAsync(url, { presentationStyle: WebBrowserPresentationStyle.AUTOMATIC });
    } catch (err) {
      Alert.alert(t('notif.alert.errorTitle'), err instanceof Error ? err.message : 'Nie udało się otworzyć protokołu PDF.');
    }
  }, [id, t, token]);

  const loadAll = useCallback(async (tokenOverride?: string | null) => {
    try {
      const authToken = tokenOverride ?? token;
      if (!authToken) { router.replace('/login'); return; }
      const h = { Authorization: `Bearer ${authToken}` };
      const [zRes, lRes, pRes, zdRes] = await Promise.all([
        fetch(`${API_URL}/tasks/${id}`, { headers: h }),
        fetch(`${API_URL}/tasks/${id}/logi`, { headers: h }),
        fetch(`${API_URL}/tasks/${id}/problemy`, { headers: h }),
        fetch(`${API_URL}/tasks/${id}/zdjecia`, { headers: h }),
      ]);
      if (zRes.ok) {
        const d = await zRes.json();
        setZlecenie(d);
        setPomocnicy(d.pomocnicy || []);
        setClientSignature(d.client_signature || null);
      }
      if (lRes.ok) setLogi(await lRes.json());
      if (pRes.ok) setProblemy(await pRes.json());
      if (zdRes.ok) setZdjecia(await zdRes.json());
      let cmrRows: any[] = [];
      try {
        const cmrRes = await fetch(`${API_URL}/cmr?task_id=${id}`, { headers: h });
        if (cmrRes.ok) {
          const data = await cmrRes.json();
          cmrRows = Array.isArray(data) ? data : [];
        }
      } catch { /* brak CMR / sieć */ }
      setCmrLista(cmrRows);
    } catch {
      setCmrLista([]);
      setClientSignature(null);
      Alert.alert(t('notif.alert.errorTitle'), t('order.loadFail'));
      setOfflineQueueCount(await getOfflineQueueSize());
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [id, token, t]);

  const init = useCallback(async () => {
    const { user: storedUser, token: storedToken } = await getStoredSession();
    if (storedUser) setUser(storedUser);
    setToken(storedToken);
    if (storedToken) {
      const flushInfo = await flushOfflineQueue(storedToken);
      setOfflineQueueCount(flushInfo.left);
    }
    await loadAll(storedToken);
  }, [loadAll]);

  useEffect(() => { void init(); }, [init]);

  useEffect(() => {
    if (!zlecenie?.id) return;
    setFieldScopeDraft(String(zlecenie.opis || zlecenie.opis_pracy || '').trim());
    setFieldTimeDraft(zlecenie.czas_planowany_godziny != null ? String(zlecenie.czas_planowany_godziny) : '');
    setFieldBudgetDraft(zlecenie.wartosc_planowana != null ? String(zlecenie.wartosc_planowana) : '');
    setFieldRiskDraft('');
    setFieldScopePresetKeys([]);
    setFieldEquipmentKeys([]);
    setFieldSettlementDraft(DEFAULT_FIELD_SETTLEMENT);
    setFieldClientAccepted(false);
  }, [zlecenie?.id]);

  useEffect(() => {
    let alive = true;
    Promise.all([
      AsyncStorage.getItem(scopeConfirmKey),
      AsyncStorage.getItem(safetyChecklistKey),
    ])
      .then(([scopeValue, safetyValue]) => {
        if (!alive) return;
        setScopeConfirmed(scopeValue === '1');
        try {
          const parsed = safetyValue ? JSON.parse(safetyValue) : {};
          setSafetyChecks(parsed && typeof parsed === 'object' ? parsed : {});
        } catch {
          setSafetyChecks({});
        }
      })
      .catch(() => {
        if (alive) {
          setScopeConfirmed(false);
          setSafetyChecks({});
        }
      });
    return () => {
      alive = false;
    };
  }, [safetyChecklistKey, scopeConfirmKey]);

  useEffect(() => {
    if (tab === 'zdjecia' || tab === 'info' || tab === 'logi' || tab === 'problemy') {
      setActiveTab(tab);
    }
  }, [tab]);

  useEffect(() => {
    const unsubscribe = subscribeOfflineFlushDone((d) => {
      if (d.flushed <= 0) return;
      setOfflineQueueCount(d.left);
      void (async () => {
        const { token: tkn } = await getStoredSession();
        if (tkn) await loadAll(tkn);
      })();
    });
    return unsubscribe;
  }, [loadAll]);

  const onRefresh = async () => { setRefreshing(true); await loadAll(); };

  const statusUi = (s: string) => {
    return TASK_STATUSES.includes(s as any) ? t(`zlecenia.status.${s}`) : (s || '').replace(/_/g, ' ');
  };

  const zmienStatus = async (nowyStatus: string) => {
    Alert.alert(t('order.changeStatusTitle'), t('order.changeStatusBody', { status: statusUi(nowyStatus) }), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.yes'), onPress: async () => {
          const idempotencyKey = createOfflineRequestId(`task-${id}-status`);
          setChangingStatus(true);
          try {
            if (!token) { router.replace('/login'); return; }
            const res = await fetch(`${API_URL}/tasks/${id}/status`, {
              method: 'PUT',
              headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
                'Idempotency-Key': idempotencyKey,
              },
              body: JSON.stringify({ status: nowyStatus }),
            });
            if (res.ok) {
              const data = await res.json().catch(() => ({}));
              setZlecenie((prev: any) => mergeTaskMutationResponse(prev, data, { id: Number(id), status: nowyStatus }));
              void triggerHaptic('success');
              await loadAll();
              Alert.alert(t('common.ok'), t('order.statusChanged'));
            }
            else if (res.status >= 500) {
              void triggerHaptic('warning');
              const queued = await queueRequestWithOfflineFallback({
                id: idempotencyKey,
                url: `${API_URL}/tasks/${id}/status`,
                method: 'PUT',
                body: { status: nowyStatus },
              });
              setOfflineQueueCount(queued);
              Alert.alert(t('notif.alert.offlineTitle'), t('order.offlineStatusQueued'));
            } else {
              void triggerHaptic('warning');
              const msg = await res.text().catch(() => '');
              Alert.alert(t('notif.alert.errorTitle'), msg.slice(0, 200) || `HTTP ${res.status}`);
            }
          } catch {
            void triggerHaptic('warning');
            const queued = await queueRequestWithOfflineFallback({
              id: idempotencyKey,
              url: `${API_URL}/tasks/${id}/status`,
              method: 'PUT',
              body: { status: nowyStatus },
            });
            setOfflineQueueCount(queued);
            Alert.alert(t('notif.alert.offlineTitle'), t('order.offlineStatusQueued'));
          }
          finally { setChangingStatus(false); }
        }
      }
    ]);
  };

  const toggleFieldScopePreset = (preset: (typeof TASK_SCOPE_PRESETS)[number]) => {
    setFieldScopePresetKeys((prev) => (
      prev.includes(preset.key) ? prev.filter((key) => key !== preset.key) : [...prev, preset.key]
    ));
    setFieldScopeDraft((prev) => appendUniqueLine(prev, preset.scopeLine));
    void triggerHaptic('light');
  };

  const toggleFieldEquipment = (preset: (typeof TASK_EQUIPMENT_OPTIONS)[number]) => {
    setFieldEquipmentKeys((prev) => (
      prev.includes(preset.key) ? prev.filter((key) => key !== preset.key) : [...prev, preset.key]
    ));
    void triggerHaptic('light');
  };

  const appendFieldRiskPreset = (preset: (typeof TASK_RISK_PRESETS)[number]) => {
    setFieldRiskDraft((prev) => appendUniqueLine(prev, preset.note));
    void triggerHaptic('light');
  };

  const saveFieldPackage = async (sendToOffice = false) => {
    const scope = fieldScopeDraft.trim();
    if (!scope) {
      void triggerHaptic('warning');
      Alert.alert('Zakres prac', 'Wpisz krótki, konkretny zakres prac dla biura i ekipy.');
      return;
    }
    if (sendToOffice) {
      const missing: string[] = [];
      if (!fieldDraftPhotosReady) {
        missing.push(...fieldDraftPhotoChecklist.filter((row) => !row.done).map((row) => row.label));
      }
      if (!fieldTimeDraft.trim()) missing.push('czas pracy');
      if (!fieldBudgetDraft.trim()) missing.push('budżet');
      if (!fieldSettlementDraft.trim()) missing.push('warunki rozliczenia');
      if (!fieldClientAccepted) missing.push('akceptacja klienta');
      if (missing.length) {
        void triggerHaptic('warning');
        Alert.alert('Jeszcze nie do biura', `Uzupełnij: ${missing.join(', ')}.`);
        return;
      }
    }

    const selectedScopePresets = TASK_SCOPE_PRESETS
      .filter((preset) => fieldScopePresetKeys.includes(preset.key))
      .map((preset) => preset.label);
    const selectedEquipment = TASK_EQUIPMENT_OPTIONS
      .filter((preset) => fieldEquipmentKeys.includes(preset.key))
      .map((preset) => preset.label);
    const body = {
      opis: scope,
      zakres_prac: scope,
      czas_planowany_godziny: fieldTimeDraft.trim() || null,
      wartosc_planowana: fieldBudgetDraft.trim() || null,
      ryzyka: fieldRiskDraft.trim() || null,
      typy_prac: selectedScopePresets,
      sprzet: selectedEquipment,
      warunki_rozliczenia: fieldSettlementDraft.trim() || null,
      klient_zaakceptowal: fieldClientAccepted,
      send_to_office: sendToOffice,
    };
    const idempotencyKey = createOfflineRequestId(`task-${id}-field-package`);
    setFieldPackageSaving(true);
    try {
      if (!token) { router.replace('/login'); return; }
      const res = await fetch(`${API_URL}/tasks/${id}/field-package`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        setZlecenie((prev: any) => mergeTaskMutationResponse(prev, data, { id: Number(id) }));
        void triggerHaptic('success');
        await loadAll();
        Alert.alert('Gotowe', sendToOffice ? 'Pakiet wrócił do biura do planowania.' : 'Pakiet terenowy zapisany.');
      } else if (res.status >= 500) {
        const queued = await queueRequestWithOfflineFallback({
          id: idempotencyKey,
          dedupeKey: `task-field-package:${id}`,
          url: `${API_URL}/tasks/${id}/field-package`,
          method: 'PUT',
          body,
        });
        setOfflineQueueCount(queued);
        void triggerHaptic('warning');
        Alert.alert(t('notif.alert.offlineTitle'), 'Pakiet terenowy zapisano lokalnie. Wyśle się po odzyskaniu połączenia.');
      } else {
        void triggerHaptic('warning');
        const msg = await res.text().catch(() => '');
        Alert.alert(t('notif.alert.errorTitle'), msg.slice(0, 300) || `HTTP ${res.status}`);
      }
    } catch {
      const queued = await queueRequestWithOfflineFallback({
        id: idempotencyKey,
        dedupeKey: `task-field-package:${id}`,
        url: `${API_URL}/tasks/${id}/field-package`,
        method: 'PUT',
        body,
      });
      setOfflineQueueCount(queued);
      void triggerHaptic('warning');
      Alert.alert(t('notif.alert.offlineTitle'), 'Pakiet terenowy zapisano lokalnie. Wyśle się po odzyskaniu połączenia.');
    } finally {
      setFieldPackageSaving(false);
    }
  };

  const rozpocznij = async () => {
    const isTeam = user?.rola === 'Brygadzista' || user?.rola === 'Pomocnik';
    if (isTeam && !scopeConfirmed) {
      void triggerHaptic('warning');
      Alert.alert(
        'Potwierdź zakres',
        'Przed startem brygada musi potwierdzić, że widziała zakres, zdjęcia/szkic i punkty BHP.',
        [
          { text: 'Wróć do odprawy', style: 'cancel' },
          { text: 'Potwierdzam', onPress: () => { void confirmScopeBriefing(); } },
        ],
      );
      return;
    }
    if (isTeam && !safetyReady) {
      void triggerHaptic('warning');
      Alert.alert('BHP przed startem', 'Uzupelnij checkliste BHP przed rozpoczeciem pracy.');
      return;
    }
    const idempotencyKey = createOfflineRequestId(`task-${id}-start`);
    let startBody: Record<string, unknown> = {};
    setChangingStatus(true);
    try {
      if (!token) { router.replace('/login'); return; }
      if (isTeam) {
        const bhp_checklista = safetyChecklistRows.map((row) => ({
          key: row.key,
          label: row.label,
          hint: row.hint,
          done: row.done,
        }));
        const coords = await pobierzLokalizacje();
        if (!coords) {
          void triggerHaptic('warning');
          Alert.alert(t('notif.alert.errorTitle'), t('order.startGpsRequired'));
          return;
        }
        startBody = {
          lat: coords.lat,
          lng: coords.lng,
          dmuchawa_filtr_ok: true,
          rebak_zatankowany: true,
          kaski_zespol: true,
          bhp_potwierdzone: true,
          bhp_checklista,
        };
      }
      const res = await fetch(`${API_URL}/tasks/${id}/start`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify(startBody),
      });
      if (res.ok) { void triggerHaptic('success'); await loadAll(); Alert.alert(t('common.ok'), t('order.startedTitle')); }
      else if (res.status >= 500) {
        void triggerHaptic('warning');
        const queued = await queueRequestWithOfflineFallback({
          id: idempotencyKey,
          url: `${API_URL}/tasks/${id}/start`,
          method: 'POST',
          body: startBody,
        });
        setOfflineQueueCount(queued);
        Alert.alert(t('notif.alert.offlineTitle'), t('order.offlineStartQueued'));
      } else {
        void triggerHaptic('warning');
        const msg = await res.text().catch(() => '');
        Alert.alert(t('notif.alert.errorTitle'), msg.slice(0, 200) || `HTTP ${res.status}`);
      }
    } catch {
      void triggerHaptic('warning');
      const isTeam = user?.rola === 'Brygadzista' || user?.rola === 'Pomocnik';
      if (isTeam && startBody.lat == null) {
        const coords = await pobierzLokalizacje().catch(() => null);
        const bhp_checklista = safetyChecklistRows.map((row) => ({
          key: row.key,
          label: row.label,
          hint: row.hint,
          done: row.done,
        }));
        startBody = coords
          ? {
              lat: coords.lat,
              lng: coords.lng,
              dmuchawa_filtr_ok: true,
              rebak_zatankowany: true,
              kaski_zespol: true,
              bhp_potwierdzone: true,
              bhp_checklista,
            }
          : startBody;
      }
      const queued = await queueRequestWithOfflineFallback({
        id: idempotencyKey,
        url: `${API_URL}/tasks/${id}/start`,
        method: 'POST',
        body: startBody,
      });
      setOfflineQueueCount(queued);
      Alert.alert(t('notif.alert.offlineTitle'), t('order.offlineStartQueued'));
    }
    finally { setChangingStatus(false); }
  };

  /** M3 F3.9 — ekran płatności przed zakończeniem (ekipa). F3.5–F3.7 — zgodność z regułami serwera. */
  const zakoncz = () => {
    void triggerHaptic('light');
    const fr = finishRequirements;
    if (fr.require_po_photo && !fr.has_po_photo) {
      Alert.alert(t('order.finishBlockedPoTitle'), t('order.finishBlockedPoBody'), [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('order.takePhoto'),
          onPress: () => {
            setActiveTab('zdjecia');
            setZdjecieModal(true);
          },
        },
      ]);
      return;
    }
    if (fr.require_przed_photo && !fr.has_przed_photo) {
      Alert.alert(t('order.finishBlockedPrzedTitle'), t('order.finishBlockedPrzedBody'), [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('order.takePhoto'),
          onPress: () => {
            setActiveTab('zdjecia');
            setZdjecieModal(true);
          },
        },
      ]);
      return;
    }
    setFinishModal(true);
  };

  const submitFinish = async () => {
    const { forma_platnosc, kwota_odebrana, faktura_vat, nip } = payForm;
    if (forma_platnosc === 'Gotowka') {
      const k = parseFloat(String(kwota_odebrana).replace(',', '.'));
      if (!Number.isFinite(k) || k < 0) {
        Alert.alert('Uwaga', 'Podaj kwotę odebraną (gotówka).');
        return;
      }
    }
    if (faktura_vat || forma_platnosc === 'Faktura_VAT') {
      const n = String(nip || '').replace(/\s/g, '');
      if (n.length < 10) {
        Alert.alert('Uwaga', 'Podaj NIP przy fakturze VAT.');
        return;
      }
    }
    if (finishRequirements.require_material_usage && !finishUsageNazwa.trim()) {
      void triggerHaptic('warning');
      Alert.alert(t('notif.alert.errorTitle'), t('order.finishMaterialRequired'));
      return;
    }
    if (!finishAfterPhotoReady) {
      void triggerHaptic('warning');
      Alert.alert('Brakuje zdjęć po pracy', 'Dodaj minimum jedno zdjęcie po zakończeniu, żeby biuro i klient mieli jasny protokół odbioru.', [
        { text: 'Anuluj', style: 'cancel' },
        {
          text: 'Zrób zdjęcie po',
          onPress: () => {
            setFinishModal(false);
            setActiveTab('zdjecia');
            void zrobZdjecie('po', 'Zdjęcie po zakończeniu pracy', 'po,odbior');
          },
        },
      ]);
      return;
    }
    if (!finishClientAccepted && !hasClientSignature) {
      void triggerHaptic('warning');
      Alert.alert('Potwierdź odbiór klienta', 'Dodaj podpis klienta albo zaznacz, że klient odebrał pracę bez uwag.', [
        { text: 'Anuluj', style: 'cancel' },
        {
          text: 'Podpis klienta',
          onPress: () => {
            setFinishModal(false);
            setShowClientSignatureModal(true);
          },
        },
        { text: 'Klient odebrał', onPress: () => setFinishClientAccepted(true) },
      ]);
      return;
    }
    if (unresolvedIssuesCount > 0 && !finishIssuesReviewed) {
      void triggerHaptic('warning');
      Alert.alert('Są otwarte problemy', 'Przed zamknięciem zlecenia sprawdź problemy albo potwierdź, że przekazujesz je do biura.', [
        { text: 'Anuluj', style: 'cancel' },
        {
          text: 'Problemy',
          onPress: () => {
            setFinishModal(false);
            setActiveTab('problemy');
          },
        },
        { text: 'Przekazuję do biura', onPress: () => setFinishIssuesReviewed(true) },
      ]);
      return;
    }
    if (!token) { router.replace('/login'); return; }
    setChangingStatus(true);
    const idempotencyKey = createOfflineRequestId(`task-${id}-finish`);
    let finishBody: Record<string, unknown> | null = null;
    try {
      const coords = await pobierzLokalizacje();
      const usageNazwa = finishUsageNazwa.trim();
      const usageIloscRaw = finishUsageIlosc.trim().replace(',', '.');
      const usageIlosc = usageNazwa && usageIloscRaw ? parseFloat(usageIloscRaw) : NaN;
      const zuzyte_materialy =
        usageNazwa.length > 0
          ? [
              {
                nazwa: usageNazwa.slice(0, 200),
                ...(Number.isFinite(usageIlosc) ? { ilosc: usageIlosc, jednostka: 'szt' } : {}),
              },
            ]
          : undefined;
      const paymentNote = finishNotatki.trim();
      const safetyProtocolNote = [
        `BHP przed startem: ${safetyDoneCount}/${safetyChecklistRows.length} punktow.`,
        ...safetyChecklistRows.map((row) => `${row.done ? 'OK' : 'BRAK'} ${row.label}`),
      ].join('\n');
      const closeProtocolNote = [
        safetyProtocolNote,
        `Zamknięcie mobilne: zdjęcia po ${afterPhotosCount}; problemy otwarte ${unresolvedIssuesCount}.`,
        hasClientSignature
          ? `Odbiór klienta: podpis ${clientSignature?.signer_name || 'dodany'}.`
          : finishClientAccepted
            ? 'Odbiór klienta: potwierdzony bez podpisu.'
            : 'Odbiór klienta: brak potwierdzenia.',
        usageNazwa ? `Materiały: ${usageNazwa}${Number.isFinite(usageIlosc) ? ` (${usageIlosc} szt.)` : ''}.` : '',
      ].filter(Boolean).join('\n');
      const noteTrim = [paymentNote, closeProtocolNote].filter(Boolean).join('\n');
      finishBody = {
        lat: coords?.lat ?? null,
        lng: coords?.lng ?? null,
        notatki: noteTrim,
        ...(zuzyte_materialy ? { zuzyte_materialy } : {}),
        payment: {
          forma_platnosc,
          kwota_odebrana: forma_platnosc === 'Gotowka' ? parseFloat(String(kwota_odebrana).replace(',', '.')) : null,
          faktura_vat: !!faktura_vat,
          nip: nip || null,
          ...(paymentNote ? { notatki: paymentNote } : {}),
        },
      };
      const res = await fetch(`${API_URL}/tasks/${id}/finish`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify(finishBody),
      });
      if (res.ok) {
        void triggerHaptic('success');
        setFinishModal(false);
        setFinishNotatki('');
        setFinishUsageNazwa('');
        setFinishUsageIlosc('');
        setFinishIssuesReviewed(false);
        setFinishClientAccepted(false);
        await loadAll();
        Alert.alert(t('common.ok'), t('order.finishedTitle'));
      } else if (res.status >= 500) {
        void triggerHaptic('warning');
        const queued = await queueRequestWithOfflineFallback({
          id: idempotencyKey,
          url: `${API_URL}/tasks/${id}/finish`,
          method: 'POST',
          body: finishBody,
        });
        setOfflineQueueCount(queued);
        setFinishModal(false);
        setFinishNotatki('');
        setFinishUsageNazwa('');
        setFinishUsageIlosc('');
        setFinishIssuesReviewed(false);
        setFinishClientAccepted(false);
        Alert.alert(t('notif.alert.offlineTitle'), t('order.offlineFinishQueued'));
      } else {
        const j = await res.json().catch(() => ({}));
        void triggerHaptic('warning');
        Alert.alert(t('notif.alert.errorTitle'), (j as { error?: string }).error || `HTTP ${res.status}`);
      }
    } catch {
      void triggerHaptic('warning');
      if (finishBody) {
        try {
          const queued = await queueRequestWithOfflineFallback({
            id: idempotencyKey,
            url: `${API_URL}/tasks/${id}/finish`,
            method: 'POST',
            body: finishBody,
          });
          setOfflineQueueCount(queued);
          setFinishModal(false);
          setFinishNotatki('');
          setFinishUsageNazwa('');
          setFinishUsageIlosc('');
          setFinishIssuesReviewed(false);
          setFinishClientAccepted(false);
          Alert.alert(t('notif.alert.offlineTitle'), t('order.offlineFinishQueued'));
        } catch {
          Alert.alert(t('notif.alert.errorTitle'), t('order.loadFail'));
        }
      } else {
        Alert.alert(t('notif.alert.errorTitle'), t('order.loadFail'));
      }
    } finally {
      setChangingStatus(false);
    }
  };

  const submitExtraWork = async () => {
    if (!extraOpis.trim() || !token) return;
    const body = { opis: extraOpis.trim() };
    try {
      const res = await fetch(`${API_URL}/tasks/${id}/extra-work`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setExtraOpis('');
        await loadAll();
        Alert.alert('OK', 'Praca dodatkowa zgłoszona do wyceny.');
      } else if (res.status >= 500) {
        const queued = await queueRequestWithOfflineFallback({
          url: `${API_URL}/tasks/${id}/extra-work`,
          method: 'POST',
          body,
        });
        setOfflineQueueCount(queued);
        Alert.alert(t('notif.alert.offlineTitle'), t('order.offlineExtraWorkQueued'));
      } else {
        const txt = await res.text();
        Alert.alert(t('notif.alert.errorTitle'), txt.slice(0, 200));
      }
    } catch {
      try {
        const queued = await queueRequestWithOfflineFallback({
          url: `${API_URL}/tasks/${id}/extra-work`,
          method: 'POST',
          body,
        });
        setOfflineQueueCount(queued);
        Alert.alert(t('notif.alert.offlineTitle'), t('order.offlineExtraWorkQueued'));
      } catch {
        Alert.alert(t('notif.alert.errorTitle'), t('order.loadFail'));
      }
    }
  };

  const quoteExtraWork = async (ewId: number) => {
    if (!token) return;
    const raw = quoteAmount[ewId];
    const amt = parseFloat(String(raw || '').replace(',', '.'));
    if (!Number.isFinite(amt) || amt <= 0) {
      Alert.alert('Uwaga', 'Podaj kwotę w PLN.');
      return;
    }
    const body = { amount_pln: amt };
    try {
      const res = await fetch(`${API_URL}/tasks/${id}/extra-work/${ewId}/quote`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        await loadAll();
        Alert.alert('OK', 'Wycena przesłana do ekipy.');
      } else if (res.status >= 500) {
        const queued = await queueRequestWithOfflineFallback({
          url: `${API_URL}/tasks/${id}/extra-work/${ewId}/quote`,
          method: 'PATCH',
          body,
        });
        setOfflineQueueCount(queued);
        Alert.alert(t('notif.alert.offlineTitle'), t('order.offlineExtraQuoteQueued'));
      } else {
        Alert.alert(t('notif.alert.errorTitle'), await res.text());
      }
    } catch {
      try {
        const queued = await queueRequestWithOfflineFallback({
          url: `${API_URL}/tasks/${id}/extra-work/${ewId}/quote`,
          method: 'PATCH',
          body,
        });
        setOfflineQueueCount(queued);
        Alert.alert(t('notif.alert.offlineTitle'), t('order.offlineExtraQuoteQueued'));
      } catch {
        Alert.alert(t('notif.alert.errorTitle'), t('order.loadFail'));
      }
    }
  };

  const acceptExtraWork = async (ewId: number) => {
    if (!token) return;
    const body = { channel: 'na_miejscu' };
    try {
      const res = await fetch(`${API_URL}/tasks/${id}/extra-work/${ewId}/accept`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        await loadAll();
        Alert.alert('OK', 'Zaakceptowano — kwota dopisana do zlecenia.');
      } else if (res.status >= 500) {
        const queued = await queueRequestWithOfflineFallback({
          url: `${API_URL}/tasks/${id}/extra-work/${ewId}/accept`,
          method: 'POST',
          body,
        });
        setOfflineQueueCount(queued);
        Alert.alert(t('notif.alert.offlineTitle'), t('order.offlineExtraAcceptQueued'));
      } else {
        Alert.alert(t('notif.alert.errorTitle'), await res.text());
      }
    } catch {
      try {
        const queued = await queueRequestWithOfflineFallback({
          url: `${API_URL}/tasks/${id}/extra-work/${ewId}/accept`,
          method: 'POST',
          body,
        });
        setOfflineQueueCount(queued);
        Alert.alert(t('notif.alert.offlineTitle'), t('order.offlineExtraAcceptQueued'));
      } catch {
        Alert.alert(t('notif.alert.errorTitle'), t('order.loadFail'));
      }
    }
  };

  const rejectExtraWork = async (ewId: number) => {
    if (!token) return;
    const body = { reason: 'Brak akceptacji klienta' };
    try {
      const res = await fetch(`${API_URL}/tasks/${id}/extra-work/${ewId}/reject`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        await loadAll();
        Alert.alert('OK', 'Oznaczono jako wycenione bez akceptacji.');
      } else if (res.status >= 500) {
        const queued = await queueRequestWithOfflineFallback({
          url: `${API_URL}/tasks/${id}/extra-work/${ewId}/reject`,
          method: 'POST',
          body,
        });
        setOfflineQueueCount(queued);
        Alert.alert(t('notif.alert.offlineTitle'), 'Brak sieci — decyzja zostanie wysłana po synchronizacji.');
      } else {
        Alert.alert(t('notif.alert.errorTitle'), await res.text());
      }
    } catch {
      try {
        const queued = await queueRequestWithOfflineFallback({
          url: `${API_URL}/tasks/${id}/extra-work/${ewId}/reject`,
          method: 'POST',
          body,
        });
        setOfflineQueueCount(queued);
        Alert.alert(t('notif.alert.offlineTitle'), 'Brak sieci — decyzja zostanie wysłana po synchronizacji.');
      } catch {
        Alert.alert(t('notif.alert.errorTitle'), t('order.loadFail'));
      }
    }
  };

  const pobierzLokalizacje = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
        const coords = { lat: loc.coords.latitude, lng: loc.coords.longitude };
        setLokalizacja(coords);
        return coords;
      }
    } catch { /* GPS opcjonalne */ }
    return null;
  };

  const zrobZdjecie = async (typ: string, opisNote?: string, tagiNote?: string) => {
    const opisTrimmed = (opisNote ?? '').trim().slice(0, 4000);
    const tagiTrimmed = (tagiNote ?? '').trim().slice(0, 2000);
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      void triggerHaptic('warning');
      Alert.alert(t('order.cameraDeniedTitle'), t('order.cameraDeniedBody'));
      return;
    }

    const coords = await pobierzLokalizacje();
    const result = await ImagePicker.launchCameraAsync({ quality: 0.7 });

    if (!result.canceled && result.assets[0]) {
      const uri = result.assets[0].uri;
      const idempotencyKey = createOfflineRequestId(`task-${id}-photo`);
      setUploadingPhoto(true);
      try {
        if (!token) { router.replace('/login'); return; }
        const form = new FormData();
        form.append('typ', typ);
        form.append('zdjecie', { uri, name: 'photo.jpg', type: 'image/jpeg' } as any);
        if (coords) {
          form.append('lat', String(coords.lat));
          form.append('lon', String(coords.lng));
        }
        if (opisTrimmed) form.append('opis', opisTrimmed);
        if (tagiTrimmed) form.append('tagi', tagiTrimmed);
        const res = await fetch(`${API_URL}/tasks/${id}/zdjecia`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': idempotencyKey },
          body: form,
        });
        if (res.ok) {
          await loadAll();
          setPhotoOpisDraft('');
          setPhotoTagiDraft('');
          setZdjecieModal(false);
          const typLabel = PHOTO_TYPE_LABELS[typ as keyof typeof PHOTO_TYPE_LABELS] || t(`order.photoType.${typ}`);
          const coordsStr = coords
            ? t('order.photoSavedCoords', { lat: coords.lat.toFixed(5), lng: coords.lng.toFixed(5) })
            : '';
          void triggerHaptic('success');
          Alert.alert(t('order.photoSavedTitle'), t('order.photoSavedBody', { label: typLabel, coords: coordsStr }));
        } else if (res.status >= 500) {
          void triggerHaptic('warning');
          const n = await queueTaskPhotoOffline({
            id: idempotencyKey,
            url: `${API_URL}/tasks/${id}/zdjecia`,
            fileUri: uri,
            typ,
            lat: coords?.lat,
            lng: coords?.lng,
            opis: opisTrimmed || undefined,
            tagi: tagiTrimmed || undefined,
          });
          setOfflineQueueCount(n);
          setPhotoOpisDraft('');
          setPhotoTagiDraft('');
          setZdjecieModal(false);
          Alert.alert(t('notif.alert.offlineTitle'), t('order.offlinePhotoQueued'));
        } else {
          void triggerHaptic('warning');
          const msg = await res.text().catch(() => '');
          Alert.alert(t('notif.alert.errorTitle'), msg.slice(0, 200) || `HTTP ${res.status}`);
        }
      } catch {
        void triggerHaptic('warning');
        try {
          const n = await queueTaskPhotoOffline({
            id: idempotencyKey,
            url: `${API_URL}/tasks/${id}/zdjecia`,
            fileUri: uri,
            typ,
            lat: coords?.lat,
            lng: coords?.lng,
            opis: opisTrimmed || undefined,
            tagi: tagiTrimmed || undefined,
          });
          setOfflineQueueCount(n);
          setPhotoOpisDraft('');
          setPhotoTagiDraft('');
          setZdjecieModal(false);
          Alert.alert(t('notif.alert.offlineTitle'), t('order.offlinePhotoQueued'));
        } catch {
          Alert.alert(t('notif.alert.errorTitle'), t('order.photoUploadFail'));
        }
      }
      finally { setUploadingPhoto(false); }
    }
  };

  const zrobZdjecieZRysunkiem = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      void triggerHaptic('warning');
      Alert.alert(t('order.cameraDeniedTitle'), t('order.cameraDeniedBody'));
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.85 });
    if (!result.canceled && result.assets[0]) {
      void triggerHaptic('light');
      router.push(`/wycena-rysuj?uri=${encodeURIComponent(result.assets[0].uri)}&taskId=${encodeURIComponent(String(id))}&photoKind=szkic` as never);
    }
  };

  const checkin = async () => {
    Alert.alert(
      'Check-in u klienta',
      'Zrób zdjęcie potwierdzające przybycie na miejsce.',
      [
        { text: 'Anuluj', style: 'cancel' },
        { text: 'Zrób zdjęcie', onPress: () => zrobZdjecie('checkin') },
      ]
    );
  };

  const zglosProblem = async () => {
    if (!problemForm.opis.trim()) { void triggerHaptic('warning'); Alert.alert(t('notif.alert.errorTitle'), t('order.problemDescRequired')); return; }
    const idempotencyKey = createOfflineRequestId(`task-${id}-problem`);
    try {
      if (!token) { router.replace('/login'); return; }
      const res = await fetch(`${API_URL}/tasks/${id}/problemy`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify(problemForm),
      });
      if (res.ok) {
        setProblemModal(false);
        setProblemForm({ typ: 'usterka', opis: '' });
        await loadAll();
        void triggerHaptic('success');
        Alert.alert('OK', 'Problem zgłoszony');
      } else if (res.status >= 500) {
        void triggerHaptic('warning');
        const queued = await queueRequestWithOfflineFallback({
          id: idempotencyKey,
          url: `${API_URL}/tasks/${id}/problemy`,
          method: 'POST',
          body: problemForm as Record<string, unknown>,
        });
        setOfflineQueueCount(queued);
        setProblemModal(false);
        setProblemForm({ typ: 'usterka', opis: '' });
        Alert.alert(t('notif.alert.offlineTitle'), t('order.offlineProblemQueued'));
      } else {
        void triggerHaptic('warning');
        const msg = await res.text().catch(() => '');
        Alert.alert(t('notif.alert.errorTitle'), msg.slice(0, 200) || `HTTP ${res.status}`);
      }
    } catch {
      void triggerHaptic('warning');
      const queued = await queueRequestWithOfflineFallback({
        id: idempotencyKey,
        url: `${API_URL}/tasks/${id}/problemy`,
        method: 'POST',
        body: problemForm as Record<string, unknown>,
      });
      setOfflineQueueCount(queued);
      setProblemModal(false);
      setProblemForm({ typ: 'usterka', opis: '' });
      Alert.alert(t('notif.alert.offlineTitle'), t('order.offlineProblemQueued'));
    }
  };

  const saveClientSignature = async (payload: { signer_name: string; signature_data_url: string; note?: string }) => {
    if (!token) {
      router.replace('/login');
      return;
    }
    const signerName = payload.signer_name.trim();
    if (signerName.length < 2) {
      Alert.alert('Uwaga', 'Podaj imię i nazwisko klienta.');
      return;
    }
    const body = {
      signer_name: signerName,
      signature_data_url: payload.signature_data_url,
      signed_at: new Date().toISOString(),
      ...(payload.note ? { note: payload.note } : {}),
    };
    const idempotencyKey = createOfflineRequestId(`task-${id}-client-signature`);
    try {
      const res = await fetch(`${API_URL}/tasks/${id}/client-signature`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const data = await res.json().catch(() => null);
        setClientSignature(data || { ...body, updated_at: new Date().toISOString() });
        setShowClientSignatureModal(false);
        void triggerHaptic('success');
        Alert.alert('Podpis zapisany', 'Otwieram protokół PDF...');
        await openTaskProtocolPdf();
        return;
      }
      if (res.status >= 500) {
        const queued = await queueRequestWithOfflineFallback({
          id: idempotencyKey,
          dedupeKey: `task-client-signature:${id}`,
          url: `${API_URL}/tasks/${id}/client-signature`,
          method: 'PUT',
          body,
        });
        setOfflineQueueCount(queued);
        setClientSignature({ ...body, updated_at: new Date().toISOString() });
        setShowClientSignatureModal(false);
        void triggerHaptic('warning');
        Alert.alert(t('notif.alert.offlineTitle'), 'Podpis zapisano lokalnie. Wyśle się po odzyskaniu połączenia.');
        return;
      }
      const msg = await res.text().catch(() => '');
      void triggerHaptic('warning');
      Alert.alert(t('notif.alert.errorTitle'), msg.slice(0, 200) || `HTTP ${res.status}`);
    } catch {
      const queued = await queueRequestWithOfflineFallback({
        id: idempotencyKey,
        dedupeKey: `task-client-signature:${id}`,
        url: `${API_URL}/tasks/${id}/client-signature`,
        method: 'PUT',
        body,
      });
      setOfflineQueueCount(queued);
      setClientSignature({ ...body, updated_at: new Date().toISOString() });
      setShowClientSignatureModal(false);
      void triggerHaptic('warning');
      Alert.alert(t('notif.alert.offlineTitle'), 'Podpis zapisano lokalnie. Wyśle się po odzyskaniu połączenia.');
    }
  };

  const isBrygadzista = user?.rola === 'Brygadzista';
  const isEkipa = user?.rola === 'Brygadzista' || user?.rola === 'Pomocnik';
  const finishPhotoBlocked =
    !!isEkipa &&
    zlecenie?.status === 'W_Realizacji' &&
    ((finishRequirements.require_po_photo && !finishRequirements.has_po_photo) ||
      (finishRequirements.require_przed_photo && !finishRequirements.has_przed_photo));
  const mozeZmieniacStatus = ['Kierownik', 'Dyrektor', 'Administrator'].includes(user?.rola);
  const mobileStatusOptions = getNextTaskStatuses(zlecenie.status, {
    includeCurrent: true,
    allowCancel: mozeZmieniacStatus,
  });
  const S = makeStyles(theme);

  if (guard.ready && !guard.allowed) {
    return <View style={S.center} />;
  }
  if (!guard.ready) {
    return (
      <View style={S.center}>
        <ActivityIndicator size="large" color={theme.accent} />
      </View>
    );
  }

  if (loading) return (
    <View style={S.center}>
      <ActivityIndicator size="large" color={theme.accent} />
    </View>
  );

  if (!zlecenie) return (
    <View style={S.center}>
      <PlatinumIconBadge icon="alert-circle-outline" color={theme.textMuted} size={20} style={{ width: 48, height: 48, borderRadius: 14 }} />
      <Text style={S.notFoundTxt}>{t('order.notFound')}</Text>
      <TouchableOpacity onPress={() => router.back()} style={S.backLink}>
        <Text style={[S.backLinkTxt, { color: theme.accent }]}>{t('order.back')}</Text>
      </TouchableOpacity>
    </View>
  );

  const statusKolor = statusPalette[zlecenie.status as keyof typeof statusPalette] || theme.textMuted;
  const isAssignedEstimator =
    (user?.rola === 'Wyceniający' || user?.rola === 'Wyceniajacy') &&
    Number(zlecenie.wyceniajacy_id) === Number(user?.id);
  const isFieldDraft =
    zlecenie.status === TASK_STATUS.WYCENA_TERENOWA ||
    zlecenie.ankieta_uproszczona === true ||
    String(zlecenie.notatki_wewnetrzne || '').includes('TRYB TERENOWY');
  const showFieldPackageCard = isAssignedEstimator && zlecenie.status === TASK_STATUS.WYCENA_TERENOWA;
  const hasCheckin = zdjecia.some((z: any) => z.typ === 'checkin');
  const fieldWycenaPhotosCount = zdjecia.filter((z: any) => photoTypMatches(z?.typ, ['wycena', 'przed', 'checkin'])).length;
  const fieldSketchPhotosCount = zdjecia.filter((z: any) => photoTypMatches(z?.typ, ['szkic', 'sketch'])).length;
  const fieldAccessPhotosCount = zdjecia.filter((z: any) => photoTypMatches(z?.typ, ['dojazd', 'posesja', 'dojazd_posesja'])).length;
  const beforePhotosCount = zdjecia.filter((z: any) => photoTypMatches(z?.typ, ['przed', 'before', 'checkin'])).length;
  const afterPhotosCount = zdjecia.filter((z: any) => photoTypMatches(z?.typ, ['po', 'after'])).length;
  const unresolvedIssuesCount = problemy.filter((p: any) => p.status !== 'Rozwiązany').length;
  const pendingExtraWorkCount = (Array.isArray(zlecenie.extra_work) ? zlecenie.extra_work : []).filter((ew: any) =>
    ['OczekujeWyceny', 'Wycenione'].includes(String(ew?.status || '')),
  ).length;
  const hasClientSignature = !!clientSignature?.signer_name;
  const hasClientPayment = !!zlecenie.client_payment?.forma_platnosc;
  const finishCashAmount = parseFloat(String(payForm.kwota_odebrana).replace(',', '.'));
  const finishAfterPhotoReady = finishRequirements.require_po_photo
    ? finishRequirements.has_po_photo
    : afterPhotosCount > 0;
  const finishPaymentReady = payForm.forma_platnosc === 'Gotowka'
    ? Number.isFinite(finishCashAmount) && finishCashAmount >= 0
    : true;
  const finishMaterialReady = !finishRequirements.require_material_usage || !!finishUsageNazwa.trim();
  const finishIssuesReady = unresolvedIssuesCount === 0 || finishIssuesReviewed;
  const finishClientReady = finishClientAccepted || hasClientSignature;
  const finishChecklist = [
    {
      key: 'photos',
      label: 'Zdjęcia po pracy',
      done: finishAfterPhotoReady,
      hint: finishAfterPhotoReady
        ? `${afterPhotosCount} zdjęć po pracy`
        : 'Dodaj zdjęcie po wykonaniu, zanim zamkniesz zlecenie.',
      icon: 'camera-outline' as IoniconName,
      action: () => {
        setFinishModal(false);
        setActiveTab('zdjecia');
        void zrobZdjecie('po', 'Zdjęcie po zakończeniu pracy', 'po,odbior');
      },
    },
    {
      key: 'client',
      label: 'Odbiór klienta',
      done: finishClientReady,
      hint: hasClientSignature
        ? `Podpis: ${clientSignature?.signer_name || '-'}`
        : finishClientAccepted
          ? 'Klient odebrał pracę bez uwag.'
          : 'Dodaj podpis albo potwierdź odbiór bez podpisu.',
      icon: 'create-outline' as IoniconName,
      action: () => {
        setFinishModal(false);
        setShowClientSignatureModal(true);
      },
    },
    {
      key: 'payment',
      label: 'Płatność',
      done: finishPaymentReady,
      hint: payForm.forma_platnosc === 'Gotowka'
        ? (finishPaymentReady ? `${finishCashAmount.toFixed(2)} PLN gotówką` : 'Podaj kwotę gotówki.')
        : payForm.forma_platnosc.replace('_', ' '),
      icon: 'cash-outline' as IoniconName,
    },
    {
      key: 'issues',
      label: 'Problemy i uwagi',
      done: finishIssuesReady,
      hint: unresolvedIssuesCount === 0
        ? 'Brak otwartych problemów.'
        : finishIssuesReviewed
          ? `${unresolvedIssuesCount} otwarte, przekazane do biura.`
          : `${unresolvedIssuesCount} otwarte - sprawdź lub przekaż do biura.`,
      icon: 'warning-outline' as IoniconName,
      action: () => {
        setFinishModal(false);
        setActiveTab('problemy');
      },
    },
    {
      key: 'materials',
      label: 'Materiały',
      done: finishMaterialReady,
      hint: finishUsageNazwa.trim()
        ? `${finishUsageNazwa.trim()}${finishUsageIlosc.trim() ? `: ${finishUsageIlosc.trim()}` : ''}`
        : finishRequirements.require_material_usage
          ? 'Wpisz zużyty materiał.'
          : 'Opcjonalnie wpisz zużyte materiały.',
      icon: 'cube-outline' as IoniconName,
    },
  ];
  const finishReadyCount = finishChecklist.filter((row) => row.done).length;
  const finishReady = finishChecklist.every((row) => row.done);
  const internalNoteLines = compactLines(zlecenie.notatki_wewnetrzne || zlecenie.notatki || zlecenie.opis_pracy || '');
  const officeHandoffMarkerIndex = internalNoteLines.findIndex((line) => line.toUpperCase() === 'PRZEKAZANIE DO BIURA');
  const fieldProtocolMarkerIndex = internalNoteLines.findIndex((line) => line === 'FORMULARZ WYCENY TERENOWEJ');
  const officeHandoffEndIndex = fieldProtocolMarkerIndex > officeHandoffMarkerIndex
    ? fieldProtocolMarkerIndex
    : officeHandoffMarkerIndex + 9;
  const officeHandoffLines = officeHandoffMarkerIndex >= 0
    ? internalNoteLines
        .slice(officeHandoffMarkerIndex + 1, officeHandoffEndIndex)
        .filter((line) => line && line !== 'FORMULARZ WYCENY TERENOWEJ')
    : [];
  const fieldBriefLines = internalNoteLines.filter((line) =>
    !line.toUpperCase().startsWith('TRYB TERENOWY') &&
    line !== 'PRZEKAZANIE DO BIURA' &&
    line !== 'FORMULARZ WYCENY TERENOWEJ',
  ).filter((line) => !officeHandoffLines.includes(line));
  const scopeLine = fieldBriefLines.find((line) => line.toLowerCase().startsWith('zakres prac'));
  const riskLine = fieldBriefLines.find((line) => line.toLowerCase().startsWith('ryzyka'));
  const accessLine = fieldBriefLines.find((line) => line.toLowerCase().startsWith('dostęp') || line.toLowerCase().startsWith('dostep'));
  const equipmentLine = fieldBriefLines.find((line) => line.toLowerCase().startsWith('sprzęt') || line.toLowerCase().startsWith('sprzet'));
  const equipmentFromBrief = equipmentLine?.split(':').slice(1).join(':').split(',').map((item) => item.trim()).filter((item) => item && item !== '-') || [];
  const equipmentFromTask = [
    zlecenie.rebak ? 'Rębak' : '',
    zlecenie.pila_wysiegniku ? 'Piła wysięgniku' : '',
    zlecenie.nozyce_dlugie ? 'Nożyce długie' : '',
    zlecenie.kosiarka ? 'Kosiarka' : '',
    zlecenie.podkaszarka ? 'Podkaszarka' : '',
    zlecenie.lopata ? 'Łopata' : '',
    zlecenie.mulczer ? 'Mulczer' : '',
    zlecenie.arborysta ? 'Arborysta' : '',
  ];
  const taskEquipmentList = uniqueStrings([...equipmentFromTask, ...equipmentFromBrief]);
  const briefingPhotos = zdjecia
    .filter((photo: any) => photoTypMatches(photo?.typ, ['wycena', 'szkic', 'dojazd', 'przed', 'checkin']))
    .slice(0, 4);
  const safetyChecklistRows = SAFETY_CHECKLIST_ITEMS.map((item) => ({
    ...item,
    done: !!safetyChecks[item.key],
  }));
  const safetyDoneCount = safetyChecklistRows.filter((row) => row.done).length;
  const safetyReady = safetyDoneCount === safetyChecklistRows.length;
  const toggleSafetyCheck = async (key: string) => {
    const next = { ...safetyChecks, [key]: !safetyChecks[key] };
    setSafetyChecks(next);
    await AsyncStorage.setItem(safetyChecklistKey, JSON.stringify(next));
    void triggerHaptic(next[key] ? 'success' : 'light');
  };
  const crewBriefChecks = [
    {
      key: 'scope',
      label: 'Zakres prac',
      done: Boolean(scopeLine || zlecenie.opis || zlecenie.opis_pracy || zlecenie.typ_uslugi),
      hint: scopeLine || zlecenie.opis || zlecenie.opis_pracy || zlecenie.typ_uslugi || 'Brak opisu zakresu.',
      icon: 'list-outline' as IoniconName,
    },
    {
      key: 'photos',
      label: 'Zdjęcia z wyceny',
      done: fieldWycenaPhotosCount > 0,
      hint: `${fieldWycenaPhotosCount} szt.`,
      icon: 'camera-outline' as IoniconName,
    },
    {
      key: 'sketch',
      label: 'Szkic zakresu',
      done: fieldSketchPhotosCount > 0,
      hint: `${fieldSketchPhotosCount} szt.`,
      icon: 'create-outline' as IoniconName,
    },
    {
      key: 'access-photo',
      label: 'Dojazd / posesja',
      done: fieldAccessPhotosCount > 0,
      hint: `${fieldAccessPhotosCount} szt.`,
      icon: 'navigate-outline' as IoniconName,
    },
    {
      key: 'equipment',
      label: 'Sprzęt',
      done: taskEquipmentList.length > 0,
      hint: taskEquipmentList.length ? taskEquipmentList.join(', ') : 'Nie wskazano sprzętu.',
      icon: 'construct-outline' as IoniconName,
    },
    {
      key: 'risk',
      label: 'BHP / ryzyka',
      done: safetyReady,
      hint: safetyReady
        ? 'Checklist BHP potwierdzona.'
        : `${safetyDoneCount}/${safetyChecklistRows.length} punktow BHP potwierdzone.`,
      icon: 'shield-checkmark-outline' as IoniconName,
    },
  ];
  const crewProofCards = [
    {
      key: 'scope',
      label: 'Zakres',
      value: scopeLine ? 'OK' : 'opis',
      hint: scopeLine ? 'z wyceny' : 'sprawdz opis',
      done: Boolean(scopeLine || zlecenie.opis || zlecenie.opis_pracy || zlecenie.typ_uslugi),
      icon: 'list-outline' as IoniconName,
      onPress: () => setActiveTab('info' as const),
    },
    {
      key: 'wycena',
      label: 'Foto',
      value: String(fieldWycenaPhotosCount),
      hint: 'wycena',
      done: fieldWycenaPhotosCount > 0,
      icon: 'camera-outline' as IoniconName,
      onPress: () => {
        setPhotoFilter('wycena');
        setActiveTab('zdjecia' as const);
      },
    },
    {
      key: 'szkic',
      label: 'Szkic',
      value: String(fieldSketchPhotosCount),
      hint: 'ciecie',
      done: fieldSketchPhotosCount > 0,
      icon: 'create-outline' as IoniconName,
      onPress: () => {
        setPhotoFilter('szkic');
        setActiveTab('zdjecia' as const);
      },
    },
    {
      key: 'dojazd',
      label: 'Dojazd',
      value: String(fieldAccessPhotosCount),
      hint: 'posesja',
      done: fieldAccessPhotosCount > 0,
      icon: 'navigate-outline' as IoniconName,
      onPress: () => {
        setPhotoFilter('dojazd');
        setActiveTab('zdjecia' as const);
      },
    },
  ];
  const crewBriefReadyCount = crewBriefChecks.filter((row) => row.done).length;
  const confirmScopeBriefing = async () => {
    if (!safetyReady) {
      void triggerHaptic('warning');
      Alert.alert('BHP przed startem', 'Zaznacz wszystkie punkty BHP, zanim potwierdzisz odprawe ekipy.');
      return;
    }
    await AsyncStorage.setItem(scopeConfirmKey, '1');
    setScopeConfirmed(true);
    void triggerHaptic('success');
    Alert.alert('Odprawa potwierdzona', 'Zakres, zdjęcia i BHP są potwierdzone dla tej brygady.');
  };
  const fieldDraftPhotoChecklist = [
    {
      key: 'wycena',
      label: 'Zdjęcie ogólne / wycena',
      done: fieldWycenaPhotosCount > 0,
      hint: `${fieldWycenaPhotosCount} szt.`,
      type: 'wycena',
    },
    {
      key: 'szkic',
      label: 'Szkic zakresu',
      done: fieldSketchPhotosCount > 0,
      hint: `${fieldSketchPhotosCount} szt.`,
      type: 'szkic',
    },
    {
      key: 'dojazd',
      label: 'Dojazd / posesja',
      done: fieldAccessPhotosCount > 0,
      hint: `${fieldAccessPhotosCount} szt.`,
      type: 'dojazd',
    },
  ];
  const fieldDraftPhotosReady = fieldDraftPhotoChecklist.every((row) => row.done);
  const fieldPackageReadyForOffice =
    fieldDraftPhotosReady &&
    Boolean(fieldScopeDraft.trim()) &&
    Boolean(fieldTimeDraft.trim()) &&
    Boolean(fieldBudgetDraft.trim()) &&
    Boolean(fieldSettlementDraft.trim()) &&
    fieldClientAccepted;
  const evidenceQuickCards: {
    type: PhotoTypeKey;
    label: string;
    hint: string;
    count: number;
    required: boolean;
    tags: string;
    draw?: boolean;
  }[] = [
    {
      type: 'wycena',
      label: 'Wycena',
      hint: 'Ogólny widok drzewa i zakresu.',
      count: fieldWycenaPhotosCount,
      required: isFieldDraft,
      tags: 'wycena,teren',
    },
    {
      type: 'szkic',
      label: 'Szkic',
      hint: 'Rysunek cięcia albo zakres prac.',
      count: fieldSketchPhotosCount,
      required: isFieldDraft,
      tags: 'szkic,zakres',
      draw: true,
    },
    {
      type: 'dojazd',
      label: 'Dojazd',
      hint: 'Brama, posesja, dostęp dla ekipy.',
      count: fieldAccessPhotosCount,
      required: isFieldDraft,
      tags: 'dojazd,posesja',
    },
    {
      type: 'przed',
      label: 'Przed',
      hint: 'Stan przed rozpoczęciem pracy.',
      count: beforePhotosCount,
      required: finishRequirements.require_przed_photo || zlecenie.status === 'W_Realizacji',
      tags: 'przed,zakres',
    },
    {
      type: 'po',
      label: 'Po',
      hint: 'Efekt pracy i odbiór klienta.',
      count: afterPhotosCount,
      required: finishRequirements.require_po_photo || zlecenie.status === 'W_Realizacji',
      tags: 'po,odbior',
    },
    {
      type: 'inne',
      label: 'Inne',
      hint: 'Dodatkowy dowód lub uwaga.',
      count: zdjecia.filter((z: any) => photoTypMatches(z?.typ, ['inne', 'other', ''])).length,
      required: false,
      tags: 'inne',
    },
  ];
  const evidenceRequiredCards = evidenceQuickCards.filter((card) => card.required);
  const evidenceReadyCount = evidenceRequiredCards.filter((card) => card.count > 0).length;
  const evidenceTotalRequired = evidenceRequiredCards.length || 1;
  const evidenceMissingCards = evidenceRequiredCards.filter((card) => card.count === 0);
  const evidencePercent = Math.round((evidenceReadyCount / evidenceTotalRequired) * 100);
  const evidenceNextCard = evidenceMissingCards[0] || evidenceQuickCards.find((card) => card.count === 0) || null;
  const disputeShieldCards: {
    key: string;
    label: string;
    hint: string;
    done: boolean;
    required: boolean;
    icon: IoniconName;
    tone: string;
    photoFilter?: PhotoFilterKey;
  }[] = [
    {
      key: 'field-photo',
      label: 'Ustalenia u klienta',
      hint: fieldWycenaPhotosCount > 0 ? `${fieldWycenaPhotosCount} zdj.` : 'Brak zdjęcia wyceny.',
      done: fieldWycenaPhotosCount > 0,
      required: isFieldDraft,
      icon: 'camera-outline',
      tone: theme.accent,
      photoFilter: 'wycena',
    },
    {
      key: 'sketch',
      label: 'Szkic zakresu',
      hint: fieldSketchPhotosCount > 0 ? `${fieldSketchPhotosCount} szkic.` : 'Brak rysunku zakresu.',
      done: fieldSketchPhotosCount > 0,
      required: isFieldDraft,
      icon: 'create-outline',
      tone: theme.info,
      photoFilter: 'szkic',
    },
    {
      key: 'access',
      label: 'Dojazd i posesja',
      hint: fieldAccessPhotosCount > 0 ? `${fieldAccessPhotosCount} zdj.` : 'Brak dowodu dostępu.',
      done: fieldAccessPhotosCount > 0,
      required: isFieldDraft,
      icon: 'navigate-outline',
      tone: theme.warning,
      photoFilter: 'dojazd',
    },
    {
      key: 'before',
      label: 'Stan przed',
      hint: beforePhotosCount > 0 ? `${beforePhotosCount} zdj.` : 'Brak stanu przed pracą.',
      done: beforePhotosCount > 0,
      required: zlecenie.status === 'W_Realizacji' || isTaskDone(zlecenie.status),
      icon: 'scan-outline',
      tone: theme.warning,
      photoFilter: 'przed',
    },
    {
      key: 'after',
      label: 'Efekt po',
      hint: afterPhotosCount > 0 ? `${afterPhotosCount} zdj.` : 'Brak efektu po pracy.',
      done: afterPhotosCount > 0,
      required: zlecenie.status === 'W_Realizacji' || isTaskDone(zlecenie.status),
      icon: 'checkmark-circle-outline',
      tone: theme.success,
      photoFilter: 'po',
    },
    {
      key: 'issues',
      label: 'Uwagi i problemy',
      hint: unresolvedIssuesCount === 0 ? 'Brak otwartych problemow.' : `${unresolvedIssuesCount} otwarte.`,
      done: unresolvedIssuesCount === 0,
      required: true,
      icon: 'warning-outline',
      tone: unresolvedIssuesCount === 0 ? theme.success : theme.danger,
    },
  ];
  const disputeShieldRequired = disputeShieldCards.filter((card) => card.required);
  const disputeShieldTotal = disputeShieldRequired.length || 1;
  const disputeShieldReady = disputeShieldRequired.filter((card) => card.done).length;
  const disputeShieldPercent = Math.round((disputeShieldReady / disputeShieldTotal) * 100);
  const disputeShieldNext = disputeShieldRequired.find((card) => !card.done) || null;
  const evidenceTimeline = [
    {
      key: 'phone',
      label: 'Telefon',
      hint: zlecenie.klient_nazwa || 'Klient',
      done: true,
      icon: 'call-outline' as IoniconName,
    },
    {
      key: 'field',
      label: 'Oglendziny',
      hint: fieldWycenaPhotosCount > 0 ? `${fieldWycenaPhotosCount} foto` : 'brak foto',
      done: fieldWycenaPhotosCount > 0,
      icon: 'camera-outline' as IoniconName,
    },
    {
      key: 'proof',
      label: 'Dowody',
      hint: fieldDraftPhotosReady ? 'pakiet OK' : `${evidenceMissingCards.length} braki`,
      done: fieldDraftPhotosReady,
      icon: 'shield-checkmark-outline' as IoniconName,
    },
    {
      key: 'crew',
      label: 'Ekipa',
      hint: zlecenie.ekipa_nazwa || zlecenie.ekipa_id ? 'przypisana' : 'do wyboru',
      done: Boolean(zlecenie.ekipa_nazwa || zlecenie.ekipa_id),
      icon: 'people-outline' as IoniconName,
    },
  ];
  const photoGalleryFilters: {
    key: PhotoFilterKey;
    label: string;
    count: number;
    icon: IoniconName;
    color: string;
  }[] = [
    { key: 'all', label: 'Wszystkie', count: zdjecia.length, icon: 'images-outline', color: theme.accent },
    ...TYP_ZDJECIA_KEYS.map((key) => {
      const meta = photoTypeMeta[key];
      const count = zdjecia.filter((photo: any) =>
        key === 'inne'
          ? photoTypMatches(photo?.typ, ['inne', 'other', ''])
          : photoTypMatches(photo?.typ, [key]),
      ).length;
      return {
        key,
        label: PHOTO_TYPE_LABELS[key] || key,
        count,
        icon: meta.icon,
        color: meta.color,
      };
    }),
  ];
  const filteredGalleryPhotos = zdjecia.filter((photo: any) => {
    if (photoFilter === 'all') return true;
    if (photoFilter === 'inne') return photoTypMatches(photo?.typ, ['inne', 'other', '']);
    return photoTypMatches(photo?.typ, [photoFilter]);
  });
  const photoGalleryGroupKeys: readonly PhotoTypeKey[] = photoFilter === 'all'
    ? TYP_ZDJECIA_KEYS
    : [photoFilter as PhotoTypeKey];
  const activePreviewPhoto = photoPreview || filteredGalleryPhotos[0] || zdjecia[0] || null;
  const previewPhotoList = filteredGalleryPhotos.length ? filteredGalleryPhotos : zdjecia;
  const activePreviewIndex = activePreviewPhoto
    ? previewPhotoList.findIndex((photo: any) =>
        String(photo?.id || photo?.url || photo?.sciezka) ===
        String(activePreviewPhoto?.id || activePreviewPhoto?.url || activePreviewPhoto?.sciezka),
      )
    : -1;
  const safePreviewIndex = activePreviewIndex >= 0 ? activePreviewIndex : 0;
  const previewCounter = previewPhotoList.length ? `${safePreviewIndex + 1}/${previewPhotoList.length}` : '0/0';
  const goToPreviewPhoto = (direction: -1 | 1) => {
    if (previewPhotoList.length === 0) return;
    const nextIndex = (safePreviewIndex + direction + previewPhotoList.length) % previewPhotoList.length;
    setPhotoPreview(previewPhotoList[nextIndex]);
    void triggerHaptic('light');
  };
  const officeHandoffReady = fieldDraftPhotosReady &&
    Boolean(zlecenie.ekipa_id) &&
    Boolean(zlecenie.czas_planowany_godziny) &&
    Boolean(zlecenie.wartosc_planowana);
  const workflowStep = getTaskWorkflowStep(zlecenie.status);
  const workflowMissingItems = taskWorkflowMissingItems(zlecenie);
  const workflowRequiredMissing = workflowMissingItems.filter((item) => item.required !== false);
  const workflowFirstMissing = workflowRequiredMissing[0] || workflowMissingItems[0] || null;
  const workflowReadyForNext = typeof zlecenie.workflow_ready_for_next === 'boolean'
    ? zlecenie.workflow_ready_for_next
    : workflowRequiredMissing.length === 0;
  const workflowBlockersCount = Number.isFinite(Number(zlecenie.workflow_blockers_count))
    ? Number(zlecenie.workflow_blockers_count)
    : workflowRequiredMissing.length;
  const workflowStageLabel = String(zlecenie.workflow_stage_label || workflowStep.label || statusUi(zlecenie.status));
  const workflowStageDetail = String(zlecenie.workflow_stage_detail || workflowStep.detail || '');
  const workflowNextStatus = String(zlecenie.workflow_next_status || '');
  const workflowNextAction = String(
    zlecenie.workflow_next_action ||
    (workflowFirstMissing ? `Uzupelnij: ${workflowFirstMissing.label}` : workflowNextStatus ? `Przejdz do: ${workflowNextStatus}` : 'Otworz szczegoly'),
  );
  const workflowPrimaryTarget = workflowTargetFor(workflowFirstMissing || undefined);
  const workflowColor = workflowBlockersCount > 0
    ? theme.warning
    : workflowReadyForNext
      ? theme.success
      : theme.accent;
  const workflowPrimaryCta = workflowFirstMissing
    ? 'Uzupelnij'
    : workflowNextStatus && mozeZmieniacStatus
      ? 'Zmien etap'
      : showFieldPackageCard
        ? 'Pakiet'
        : 'Otworz';
  const runWorkflowPrimaryAction = () => {
    if (workflowFirstMissing) {
      if (workflowPrimaryTarget === 'photos') {
        setPhotoFilter(workflowPhotoFilterFor(workflowFirstMissing));
        setActiveTab('zdjecia');
      } else {
        setActiveTab('info');
      }
      return;
    }
    if (workflowNextStatus && mozeZmieniacStatus) {
      void zmienStatus(workflowNextStatus);
      return;
    }
    setActiveTab('info');
  };

  // Suma godzin z logów
  const totalGodziny = logi.reduce((sum: number, l: any) => sum + (parseFloat(l.duration_hours) || 0), 0);
  const dossierChecklist = [
    {
      key: 'checkin',
      label: 'Check-in GPS',
      done: hasCheckin,
      hint: hasCheckin ? 'Potwierdzono obecność na miejscu.' : 'Brak check-in.',
      onPress: () => setActiveTab('zdjecia' as const),
    },
    {
      key: 'przed',
      label: `Zdjęcia "przed"${finishRequirements.require_przed_photo ? ` (min ${MIN_FINISH_TYP_PHOTOS})` : ''}`,
      done: finishRequirements.require_przed_photo ? finishRequirements.has_przed_photo : beforePhotosCount > 0,
      hint: `${beforePhotosCount} szt.`,
      onPress: () => setActiveTab('zdjecia' as const),
    },
    {
      key: 'po',
      label: `Zdjęcia "po"${finishRequirements.require_po_photo ? ` (min ${MIN_FINISH_TYP_PHOTOS})` : ''}`,
      done: finishRequirements.require_po_photo ? finishRequirements.has_po_photo : afterPhotosCount > 0,
      hint: `${afterPhotosCount} szt.`,
      onPress: () => setActiveTab('zdjecia' as const),
    },
    {
      key: 'issues',
      label: 'Otwarte problemy',
      done: unresolvedIssuesCount === 0,
      hint: unresolvedIssuesCount === 0 ? 'Brak otwartych zgłoszeń.' : `${unresolvedIssuesCount} do zamknięcia.`,
      onPress: () => setActiveTab('problemy' as const),
    },
    {
      key: 'safety',
      label: 'Checklist BHP',
      done: safetyReady,
      hint: safetyReady
        ? 'BHP potwierdzone przed startem.'
        : `${safetyDoneCount}/${safetyChecklistRows.length} punktow potwierdzone.`,
      onPress: () => setActiveTab('info' as const),
    },
    {
      key: 'extra-work',
      label: 'Prace dodatkowe',
      done: pendingExtraWorkCount === 0,
      hint: pendingExtraWorkCount === 0 ? 'Brak oczekujących decyzji.' : `${pendingExtraWorkCount} wymaga decyzji.`,
      onPress: () => setActiveTab('info' as const),
    },
    {
      key: 'signature',
      label: 'Podpis klienta',
      done: hasClientSignature || !isTaskDone(zlecenie.status),
      hint: hasClientSignature
        ? `Podpisano: ${clientSignature?.signer_name || '-'}`
        : isTaskDone(zlecenie.status)
          ? 'Brak podpisu klienta.'
          : 'Uzupełnisz przy odbiorze.',
      onPress: () => setShowClientSignatureModal(true),
    },
    {
      key: 'payment',
      label: 'Płatność klienta',
      done: hasClientPayment || !isTaskDone(zlecenie.status),
      hint: hasClientPayment
        ? `Zapisano: ${zlecenie.client_payment?.forma_platnosc || '-'}`
        : isTaskDone(zlecenie.status)
          ? 'Brak zapisanej płatności.'
          : 'Uzupełnisz przy domknięciu.',
      onPress: () => {
        if (zlecenie.status === 'W_Realizacji' && isEkipa) {
          setFinishModal(true);
        } else {
          setActiveTab('info' as const);
        }
      },
    },
  ];
  const dossierDoneCount = dossierChecklist.filter((row) => row.done).length;
  const dossierReady = dossierChecklist.every((row) => row.done);
  const copyDossierSummary = async () => {
    const checklistLines = dossierChecklist
      .map((row) => `${row.done ? '✅' : '⬜'} ${row.label} — ${row.hint}`)
      .join('\n');
    const safetyLines = safetyChecklistRows
      .map((row) => `${row.done ? 'OK' : 'BRAK'} ${row.label}: ${row.hint}`)
      .join('\n');
    const summary = [
      `Zlecenie #${id} — ${zlecenie.klient_nazwa || '-'}`,
      `Status: ${statusUi(zlecenie.status)}`,
      `Gotowość dokumentacji: ${dossierDoneCount}/${dossierChecklist.length}`,
      checklistLines,
      `BHP: ${safetyDoneCount}/${safetyChecklistRows.length}`,
      safetyLines,
    ].join('\n');
    await Clipboard.setStringAsync(summary);
    Alert.alert('Skopiowano', 'Podsumowanie teczki zlecenia skopiowane do schowka.');
  };
  const copyCrewBrief = async () => {
    const plannedDate = zlecenie.data_planowana ? String(zlecenie.data_planowana).slice(0, 10) : 'brak terminu';
    const plannedTime = zlecenie.godzina_rozpoczecia || (String(zlecenie.data_planowana || '').includes('T') ? String(zlecenie.data_planowana).split('T')[1]?.slice(0, 5) : '');
    const brief = [
      `Zlecenie #${id}: ${zlecenie.klient_nazwa || '-'}`,
      `Telefon: ${zlecenie.klient_telefon || '-'}`,
      `Adres: ${[zlecenie.adres, zlecenie.miasto].filter(Boolean).join(', ') || '-'}`,
      `Termin: ${[plannedDate, plannedTime, zlecenie.czas_planowany_godziny ? `${zlecenie.czas_planowany_godziny} h` : ''].filter(Boolean).join(' | ')}`,
      `Ekipa: ${zlecenie.ekipa_nazwa || '-'}`,
      scopeLine || zlecenie.opis || zlecenie.opis_pracy ? `Zakres: ${scopeLine || zlecenie.opis || zlecenie.opis_pracy}` : null,
      accessLine ? `Dostep: ${accessLine}` : null,
      riskLine ? `Ryzyka: ${riskLine}` : null,
      taskEquipmentList.length ? `Sprzet: ${taskEquipmentList.join(', ')}` : null,
      `Zdjecia: wycena ${fieldWycenaPhotosCount}, szkic ${fieldSketchPhotosCount}, dojazd ${fieldAccessPhotosCount}`,
      `BHP: ${safetyDoneCount}/${safetyChecklistRows.length}`,
      `Problemy otwarte: ${unresolvedIssuesCount}`,
    ].filter(Boolean).join('\n');
    await Clipboard.setStringAsync(brief);
    void triggerHaptic('success');
    Alert.alert('Skopiowano', 'Odprawa ekipy jest w schowku.');
  };
  const suggestedAction = (() => {
    if (isEkipa) {
      if (!scopeConfirmed && (zlecenie.status === 'Zaplanowane' || zlecenie.status === 'W_Realizacji')) {
        return {
          icon: 'shield-checkmark-outline' as IoniconName,
          title: 'Sugerowany krok: Potwierdź odprawę',
          detail: 'Brygada musi zobaczyć zakres, zdjęcia/szkic i punkty BHP przed startem.',
          cta: 'Potwierdzam zakres',
          onPress: confirmScopeBriefing,
        };
      }
      if (!hasCheckin) {
        return {
          icon: 'location-outline' as IoniconName,
          title: 'Sugerowany krok: Check-in',
          detail: 'Potwierdź przybycie na miejsce zdjęciem GPS.',
          cta: 'Zrób check-in',
          onPress: checkin,
        };
      }
      if (zlecenie.status === 'Zaplanowane') {
        return {
          icon: 'play-circle-outline' as IoniconName,
          title: 'Sugerowany krok: Rozpocznij pracę',
          detail: 'Uruchom realizację i zacznij logować czas.',
          cta: 'Start realizacji',
          onPress: rozpocznij,
        };
      }
      if (zlecenie.status === 'W_Realizacji') {
        if (finishPhotoBlocked) {
          return {
            icon: 'camera-outline' as IoniconName,
            title: 'Sugerowany krok: Uzupełnij dokumentację',
            detail: 'Brakuje zdjęć wymaganych do domknięcia zlecenia.',
            cta: 'Dodaj zdjęcia',
            onPress: () => {
              setActiveTab('zdjecia');
              setZdjecieModal(true);
            },
          };
        }
        return {
          icon: 'checkmark-done-outline' as IoniconName,
          title: 'Sugerowany krok: Zakończ zlecenie',
          detail: 'Zamknij zlecenie i uzupełnij płatność klienta.',
          cta: 'Zakończ',
          onPress: zakoncz,
        };
      }
      return {
        icon: 'document-text-outline' as IoniconName,
        title: 'Sugerowany krok: Raport dnia',
        detail: 'Zlecenie domknięte. Uzupełnij raport dzienny ekipy.',
        cta: 'Otwórz raport',
        onPress: () => router.push('/raport-dzienny'),
      };
    }
    if (workflowFirstMissing) {
      return {
        icon: workflowPrimaryTarget === 'photos' ? 'camera-outline' as IoniconName : 'create-outline' as IoniconName,
        title: `Sugerowany krok: ${workflowNextAction}`,
        detail: `Etap "${workflowStageLabel}" nie pojdzie dalej bez tego pola.`,
        cta: workflowPrimaryCta,
        onPress: runWorkflowPrimaryAction,
      };
    }
    if (workflowReadyForNext && workflowNextStatus && mozeZmieniacStatus) {
      return {
        icon: 'arrow-forward-circle-outline' as IoniconName,
        title: `Sugerowany krok: ${workflowNextAction}`,
        detail: `Etap "${workflowStageLabel}" jest gotowy do kolejnego statusu.`,
        cta: workflowPrimaryCta,
        onPress: runWorkflowPrimaryAction,
      };
    }
    if (mozeZmieniacStatus) {
      if (zlecenie.status === 'Nowe') {
        return {
          icon: 'calendar-outline' as IoniconName,
          title: 'Sugerowany krok: Wyślij do wyceniającego',
          detail: 'Klient ma termin oględzin, teren może zebrać zdjęcia, zakres i cenę.',
          cta: 'Ustaw: Oględziny',
          onPress: () => zmienStatus('Wycena_Terenowa'),
        };
      }
      if (zlecenie.status === 'Wycena_Terenowa') {
        return {
          icon: 'camera-outline' as IoniconName,
          title: 'Sugerowany krok: Klient akceptuje',
          detail: 'Po zdjęciach i cenie zlecenie wraca do biura do zatwierdzenia.',
          cta: 'Ustaw: Do zatwierdzenia',
          onPress: () => zmienStatus('Do_Zatwierdzenia'),
        };
      }
      if (zlecenie.status === 'Do_Zatwierdzenia') {
        return {
          icon: 'checkmark-circle-outline' as IoniconName,
          title: 'Sugerowany krok: Plan ekipy',
          detail: 'Biuro dopina ekipę, datę i odprawę dla brygady.',
          cta: 'Ustaw: Zaplanowane',
          onPress: () => zmienStatus('Zaplanowane'),
        };
      }
      if (zlecenie.status === 'Zaplanowane') {
        return {
          icon: 'play-outline' as IoniconName,
          title: 'Sugerowany krok: Start realizacji',
          detail: 'Przenieś zlecenie do realizacji i monitoruj postęp.',
          cta: 'Ustaw: W realizacji',
          onPress: () => zmienStatus('W_Realizacji'),
        };
      }
      if (zlecenie.status === 'W_Realizacji') {
        return {
          icon: 'analytics-outline' as IoniconName,
          title: 'Sugerowany krok: Kontrola realizacji',
          detail: 'Sprawdź logi czasu, problemy i dokumentację.',
          cta: 'Przejdź do logów',
          onPress: () => setActiveTab('logi'),
        };
      }
    }
    if (
      user?.rola === 'Wyceniający' &&
      Number(zlecenie?.wyceniajacy_id) === Number(user?.id) &&
      Array.isArray(zlecenie.extra_work) &&
      zlecenie.extra_work.some((x: any) => x.status === 'OczekujeWyceny')
    ) {
      return {
        icon: 'cash-outline' as IoniconName,
        title: 'Sugerowany krok: Wyceń prace dodatkowe',
        detail: 'Na tym zleceniu są pozycje oczekujące na wycenę.',
        cta: 'Przejdź do sekcji',
        onPress: () => setActiveTab('info'),
      };
    }
    return {
      icon: 'information-circle-outline' as IoniconName,
      title: 'Sugerowany krok: Weryfikacja karty',
      detail: 'Sprawdź komplet danych i historię działań.',
      cta: 'Otwórz szczegóły',
      onPress: () => setActiveTab('info'),
    };
  })();
  const crewPrimaryAction = (() => {
    if (!isEkipa) return null;
    if (!scopeConfirmed && (zlecenie.status === 'Zaplanowane' || zlecenie.status === 'W_Realizacji')) {
      return {
        icon: 'shield-checkmark-outline' as IoniconName,
        label: 'Potwierdz odprawe',
        hint: 'Zakres, zdjęcia i BHP przed startem.',
        color: theme.accent,
        onPress: confirmScopeBriefing,
      };
    }
    if (!hasCheckin && (zlecenie.status === 'Zaplanowane' || zlecenie.status === 'W_Realizacji')) {
      return {
        icon: 'location-outline' as IoniconName,
        label: 'Check-in GPS',
        hint: 'Potwierdz obecnosc ekipy na miejscu.',
        color: theme.info,
        onPress: checkin,
      };
    }
    if (zlecenie.status === 'Zaplanowane') {
      return {
        icon: 'play-circle-outline' as IoniconName,
        label: 'Start pracy',
        hint: 'Rozpocznij realizacje i licz czas.',
        color: theme.success,
        onPress: rozpocznij,
      };
    }
    if (zlecenie.status === 'W_Realizacji' && beforePhotosCount === 0) {
      return {
        icon: 'camera-outline' as IoniconName,
        label: 'Zdjęcie przed',
        hint: 'Zabezpiecz dowod stanu przed praca.',
        color: theme.warning,
        onPress: () => {
          setActiveTab('zdjecia');
          void zrobZdjecie('przed', 'Zdjęcie przed rozpoczęciem pracy', 'przed,zakres');
        },
      };
    }
    if (zlecenie.status === 'W_Realizacji' && afterPhotosCount === 0) {
      return {
        icon: 'checkmark-circle-outline' as IoniconName,
        label: 'Zdjęcie po',
        hint: 'Pokaz efekt i przygotuj odbior.',
        color: theme.success,
        onPress: () => {
          setActiveTab('zdjecia');
          void zrobZdjecie('po', 'Zdjęcie po zakończeniu pracy', 'po,odbior');
        },
      };
    }
    if (zlecenie.status === 'W_Realizacji') {
      return {
        icon: 'checkmark-done-outline' as IoniconName,
        label: 'Zamknij zlecenie',
        hint: finishReady ? 'Dokumentacja gotowa do zamkniecia.' : `Do uzupelnienia: ${finishChecklist.length - finishReadyCount}`,
        color: finishReady ? theme.success : theme.danger,
        onPress: zakoncz,
      };
    }
    return {
      icon: 'document-text-outline' as IoniconName,
      label: 'Raport dnia',
      hint: 'Zlecenie zakonczone - uzupelnij raport ekipy.',
      color: theme.accent,
      onPress: () => router.push('/raport-dzienny'),
    };
  })();
  const crewProgressItems = [
    {
      key: 'checkin',
      label: 'Check-in',
      value: hasCheckin ? 'OK' : '-',
      done: hasCheckin,
      icon: 'location-outline' as IoniconName,
    },
    {
      key: 'before',
      label: 'Przed',
      value: String(beforePhotosCount),
      done: beforePhotosCount > 0,
      icon: 'camera-outline' as IoniconName,
    },
    {
      key: 'after',
      label: 'Po',
      value: String(afterPhotosCount),
      done: afterPhotosCount > 0,
      icon: 'checkmark-circle-outline' as IoniconName,
    },
    {
      key: 'issues',
      label: 'Problemy',
      value: String(unresolvedIssuesCount),
      done: unresolvedIssuesCount === 0,
      icon: 'warning-outline' as IoniconName,
    },
  ];
  const crewFastActions = [
    {
      key: 'checkin',
      icon: hasCheckin ? 'location' : 'location-outline' as IoniconName,
      label: hasCheckin ? 'Check-in OK' : 'Check-in',
      hint: hasCheckin ? 'Miejsce potwierdzone' : 'GPS + zdjęcie',
      color: hasCheckin ? theme.success : theme.info,
      backgroundColor: hasCheckin ? theme.successBg : theme.infoBg,
      borderColor: hasCheckin ? theme.success : theme.info,
      onPress: checkin,
    },
    zlecenie.status === 'Zaplanowane' ? {
      key: 'start',
      icon: 'play-circle-outline' as IoniconName,
      label: 'Start',
      hint: 'Rozpocznij prace',
      color: theme.success,
      backgroundColor: theme.successBg,
      borderColor: theme.success,
      onPress: rozpocznij,
      disabled: changingStatus,
    } : null,
    zlecenie.status === 'W_Realizacji' ? {
      key: 'before',
      icon: 'camera-outline' as IoniconName,
      label: 'Przed',
      hint: 'Zdjęcie stanu',
      color: theme.warning,
      backgroundColor: theme.warningBg,
      borderColor: theme.warning,
      onPress: () => {
        setActiveTab('zdjecia');
        void zrobZdjecie('przed', 'Zdjęcie przed rozpoczęciem pracy', 'przed,zakres');
      },
    } : null,
    zlecenie.status === 'W_Realizacji' ? {
      key: 'after',
      icon: 'checkmark-circle-outline' as IoniconName,
      label: 'Po',
      hint: 'Efekt pracy',
      color: theme.success,
      backgroundColor: theme.successBg,
      borderColor: theme.success,
      onPress: () => {
        setActiveTab('zdjecia');
        void zrobZdjecie('po', 'Zdjęcie po zakończeniu pracy', 'po,odbior');
      },
    } : null,
    {
      key: 'photos',
      icon: 'images-outline' as IoniconName,
      label: 'Pakiet',
      hint: 'Wybierz typ zdjęcia',
      color: theme.accent,
      backgroundColor: theme.accentLight,
      borderColor: theme.accent,
      onPress: () => {
        void triggerHaptic('light');
        setZdjecieModal(true);
      },
    },
    {
      key: 'problem',
      icon: 'warning-outline' as IoniconName,
      label: 'Problem',
      hint: 'Zglos do biura',
      color: theme.chartCyan,
      backgroundColor: theme.infoBg,
      borderColor: theme.chartCyan,
      onPress: () => {
        void triggerHaptic('light');
        setProblemModal(true);
      },
    },
    zlecenie.status === 'W_Realizacji' ? {
      key: 'finish',
      icon: 'flag-outline' as IoniconName,
      label: 'Zamknij',
      hint: finishPhotoBlocked ? 'Brakuje zdjec' : 'Odbior i platnosc',
      color: finishPhotoBlocked ? theme.warning : theme.danger,
      backgroundColor: finishPhotoBlocked ? theme.warningBg : theme.dangerBg,
      borderColor: finishPhotoBlocked ? theme.warning : theme.danger,
      onPress: zakoncz,
      disabled: changingStatus,
    } : null,
  ].filter(Boolean) as {
    key: string;
    icon: IoniconName;
    label: string;
    hint: string;
    color: string;
    backgroundColor: string;
    borderColor: string;
    onPress: () => void;
    disabled?: boolean;
  }[];
  const crewWorkSteps = [
    {
      key: 'brief',
      icon: 'shield-checkmark-outline' as IoniconName,
      title: 'Odprawa',
      hint: 'Zakres, zdjęcia, szkic i BHP potwierdzone przez brygadę.',
      done: scopeConfirmed,
      active: !scopeConfirmed && (zlecenie.status === 'Zaplanowane' || zlecenie.status === 'W_Realizacji'),
      blocked: false,
      action: confirmScopeBriefing,
      value: `${crewBriefReadyCount}/${crewBriefChecks.length}`,
    },
    {
      key: 'checkin',
      icon: 'location-outline' as IoniconName,
      title: 'Check-in GPS',
      hint: 'Potwierdzenie obecnosci ekipy na miejscu pracy.',
      done: hasCheckin,
      active: scopeConfirmed && !hasCheckin && (zlecenie.status === 'Zaplanowane' || zlecenie.status === 'W_Realizacji'),
      blocked: !scopeConfirmed && !hasCheckin && (zlecenie.status === 'Zaplanowane' || zlecenie.status === 'W_Realizacji'),
      action: checkin,
      value: hasCheckin ? 'OK' : '-',
    },
    {
      key: 'start',
      icon: 'play-circle-outline' as IoniconName,
      title: 'Start pracy',
      hint: 'Rozpoczecie realizacji i liczenia czasu pracy.',
      done: zlecenie.status === 'W_Realizacji' || isTaskDone(zlecenie.status),
      active: zlecenie.status === 'Zaplanowane' && scopeConfirmed && hasCheckin,
      blocked: zlecenie.status === 'Zaplanowane' && (!scopeConfirmed || !hasCheckin),
      action: rozpocznij,
      value: zlecenie.status === 'Zaplanowane' ? 'Start' : 'OK',
    },
    {
      key: 'evidence',
      icon: 'images-outline' as IoniconName,
      title: 'Dowody pracy',
      hint: 'Zdjecia przed, po i problemy widoczne dla biura.',
      done: beforePhotosCount > 0 && afterPhotosCount > 0 && unresolvedIssuesCount === 0,
      active: zlecenie.status === 'W_Realizacji' && (beforePhotosCount === 0 || afterPhotosCount === 0),
      blocked: zlecenie.status === 'W_Realizacji' && unresolvedIssuesCount > 0,
      action: () => {
        setActiveTab('zdjecia');
        setZdjecieModal(true);
      },
      value: `${beforePhotosCount}/${afterPhotosCount}`,
    },
    {
      key: 'finish',
      icon: 'flag-outline' as IoniconName,
      title: 'Odbior i zamkniecie',
      hint: 'Raport, platnosc, podpis klienta i kompletna teczka.',
      done: isTaskDone(zlecenie.status),
      active: zlecenie.status === 'W_Realizacji' && finishReady,
      blocked: zlecenie.status === 'W_Realizacji' && !finishReady,
      action: zakoncz,
      value: `${finishReadyCount}/${finishChecklist.length}`,
    },
  ];
  const taskHeroAddress = [zlecenie.adres, zlecenie.miasto].filter(Boolean).join(', ');
  const taskHeroDate = zlecenie.data_planowana ? String(zlecenie.data_planowana).split('T')[0] : 'Bez terminu';
  const taskHeroAmount = Number.parseFloat(String(zlecenie.wartosc_planowana || '').replace(',', '.'));
  const taskHeroValue = !isBrygadzista && Number.isFinite(taskHeroAmount)
    ? `${taskHeroAmount.toLocaleString('pl-PL')} PLN`
    : `${totalGodziny.toFixed(1)} h`;
  const taskHeroStats = [
    {
      key: 'photos',
      icon: 'images-outline' as IoniconName,
      label: 'Zdjęcia',
      value: String(zdjecia.length),
      done: zdjecia.length > 0,
    },
    {
      key: 'brief',
      icon: 'leaf-outline' as IoniconName,
      label: isFieldDraft ? 'Wycena' : 'Odprawa',
      value: isFieldDraft ? `${evidenceReadyCount}/${evidenceTotalRequired}` : `${crewBriefReadyCount}/${crewBriefChecks.length}`,
      done: isFieldDraft ? evidenceReadyCount >= evidenceTotalRequired : crewBriefReadyCount >= crewBriefChecks.length,
    },
    {
      key: 'safety',
      icon: 'shield-checkmark-outline' as IoniconName,
      label: 'BHP',
      value: `${safetyDoneCount}/${safetyChecklistRows.length}`,
      done: safetyReady,
    },
    {
      key: 'dossier',
      icon: 'folder-open-outline' as IoniconName,
      label: 'Teczka',
      value: `${dossierDoneCount}/${dossierChecklist.length}`,
      done: dossierReady,
    },
  ];
  const taskHeroActions = [
    zlecenie.klient_telefon ? {
      key: 'call',
      icon: 'call-outline' as IoniconName,
      label: 'Telefon',
      onPress: () => { void Linking.openURL(`tel:${zlecenie.klient_telefon}`); },
    } : null,
    taskHeroAddress ? {
      key: 'maps',
      icon: 'navigate-outline' as IoniconName,
      label: 'Mapa',
      onPress: () => { void openAddressInMaps(zlecenie.adres || '', zlecenie.miasto || ''); },
    } : null,
    {
      key: 'photos',
      icon: 'camera-outline' as IoniconName,
      label: 'Zdjęcia',
      onPress: () => {
        void triggerHaptic('light');
        setActiveTab('zdjecia');
        setZdjecieModal(true);
      },
    },
    {
      key: 'dossier',
      icon: 'document-text-outline' as IoniconName,
      label: 'Teczka',
      onPress: () => {
        void triggerHaptic('light');
        setActiveTab('info');
      },
    },
  ].filter(Boolean) as {
    key: string;
    icon: IoniconName;
    label: string;
    onPress: () => void;
  }[];

  return (
    <KeyboardSafeScreen style={{ flex: 1, backgroundColor: theme.bg }}>
    <View style={S.container}>
      <StatusBar
        barStyle={theme.name === 'dark' ? 'light-content' : 'dark-content'}
        backgroundColor={theme.headerBg}
      />

      {/* ── HEADER ── */}
      <View style={S.header}>
        <TouchableOpacity onPress={() => router.back()} style={S.backBtn}>
          <PlatinumIconBadge icon="arrow-back" color={theme.accent} size={13} style={{ width: 26, height: 26, borderRadius: 9 }} />
        </TouchableOpacity>
        <View style={S.headerCenter}>
          <Text style={S.headerTitle}>{t('order.headerTitle', { id })}</Text>
        </View>
        <View style={[S.statusBadgeH, { backgroundColor: statusKolor + '28', borderColor: statusKolor }]}>
          <Text style={[S.statusTextH, { color: statusKolor }]}>{statusUi(zlecenie.status)}</Text>
        </View>
      </View>
      <OfflineQueueBanner
        count={offlineQueueCount}
        warningColor={theme.warning}
        warningBackgroundColor={theme.warningBg}
        borderColor={theme.border}
      />

      <View style={S.taskHero}>
        <View style={S.taskHeroTop}>
          <View style={S.taskHeroIcon}>
            <Ionicons name="leaf-outline" size={24} color={theme.accent} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={S.taskHeroEyebrow}>ZLECENIE #{id} / {taskHeroDate}</Text>
            <Text style={S.taskHeroTitle} numberOfLines={2}>
              {zlecenie.klient_nazwa || zlecenie.typ_uslugi || 'Zlecenie terenowe'}
            </Text>
            <Text style={S.taskHeroSub} numberOfLines={2}>
              {taskHeroAddress || zlecenie.typ_uslugi || 'Brak adresu w karcie zlecenia'}
            </Text>
          </View>
          <View style={[S.taskHeroStatus, { backgroundColor: statusKolor + '18', borderColor: statusKolor }]}>
            <Text style={[S.taskHeroStatusText, { color: statusKolor }]}>{statusUi(zlecenie.status)}</Text>
          </View>
        </View>

        <View style={S.taskHeroStats}>
          {taskHeroStats.map((stat) => (
            <View key={stat.key} style={[S.taskHeroStat, stat.done && S.taskHeroStatDone]}>
              <Ionicons name={stat.icon} size={15} color={stat.done ? theme.success : theme.accent} />
              <Text style={S.taskHeroStatValue}>{stat.value}</Text>
              <Text style={S.taskHeroStatLabel} numberOfLines={1}>{stat.label}</Text>
            </View>
          ))}
        </View>

        <View
          style={[
            S.taskHeroProof,
            {
              backgroundColor: disputeShieldPercent >= 100 ? theme.successBg : theme.warningBg,
              borderColor: disputeShieldPercent >= 100 ? theme.success : theme.warning,
            },
          ]}
        >
          <View style={S.taskHeroProofHead}>
            <View
              style={[
                S.taskHeroProofIcon,
                {
                  backgroundColor: theme.cardBg,
                  borderColor: disputeShieldPercent >= 100 ? theme.success : theme.warning,
                },
              ]}
            >
              <Ionicons
                name={disputeShieldPercent >= 100 ? 'shield-checkmark-outline' : 'shield-outline'}
                size={18}
                color={disputeShieldPercent >= 100 ? theme.success : theme.warning}
              />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text
                style={[
                  S.taskHeroProofTitle,
                  { color: disputeShieldPercent >= 100 ? theme.success : theme.warning },
                ]}
              >
                Tarcza dowodowa
              </Text>
              <Text style={S.taskHeroProofSub} numberOfLines={2}>
                {disputeShieldPercent >= 100
                  ? 'Komplet zdjęć, ustaleń i odbioru chroni firmę przed sporem.'
                  : disputeShieldNext
                    ? `Następny brak: ${disputeShieldNext.label}.`
                    : 'Sprawdź pakiet dowodów przed dalszą pracą.'}
              </Text>
            </View>
            <View
              style={[
                S.taskHeroProofScore,
                {
                  backgroundColor: theme.cardBg,
                  borderColor: disputeShieldPercent >= 100 ? theme.success : theme.warning,
                },
              ]}
            >
              <Text
                style={[
                  S.taskHeroProofScoreValue,
                  { color: disputeShieldPercent >= 100 ? theme.success : theme.warning },
                ]}
              >
                {disputeShieldPercent}%
              </Text>
              <Text style={S.taskHeroProofScoreLabel}>ochrona</Text>
            </View>
          </View>

          <View style={S.taskHeroProofChips}>
            {disputeShieldRequired.slice(0, 4).map((card) => (
              <TouchableOpacity
                key={card.key}
                style={[
                  S.taskHeroProofChip,
                  {
                    backgroundColor: card.done ? theme.successBg : theme.cardBg,
                    borderColor: card.done ? theme.success : card.tone,
                  },
                ]}
                onPress={() => {
                  void triggerHaptic('light');
                  if (card.photoFilter) {
                    setPhotoFilter(card.photoFilter);
                    setActiveTab('zdjecia');
                  } else if (card.key === 'issues') {
                    setActiveTab('problemy');
                  } else {
                    setActiveTab('info');
                  }
                }}
              >
                <Ionicons
                  name={card.done ? 'checkmark-circle' : card.icon}
                  size={13}
                  color={card.done ? theme.success : card.tone}
                />
                <Text
                  style={[
                    S.taskHeroProofChipText,
                    { color: card.done ? theme.success : theme.textSub },
                  ]}
                  numberOfLines={1}
                >
                  {card.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <TouchableOpacity
            style={[
              S.taskHeroProofNext,
              {
                backgroundColor: theme.cardBg,
                borderColor: disputeShieldNext ? theme.warning : theme.success,
              },
            ]}
            onPress={() => {
              void triggerHaptic('light');
              if (disputeShieldNext?.photoFilter) {
                setPhotoFilter(disputeShieldNext.photoFilter);
                setActiveTab('zdjecia');
              } else if (disputeShieldNext?.key === 'issues') {
                setActiveTab('problemy');
              } else {
                setActiveTab('zdjecia');
              }
            }}
          >
            <Ionicons
              name={disputeShieldNext ? 'arrow-forward-circle-outline' : 'images-outline'}
              size={15}
              color={disputeShieldNext ? theme.warning : theme.success}
            />
            <Text
              style={[
                S.taskHeroProofNextText,
                { color: disputeShieldNext ? theme.warning : theme.success },
              ]}
              numberOfLines={1}
            >
              {disputeShieldNext ? `Uzupełnij: ${disputeShieldNext.label}` : 'Otwórz komplet dowodów'}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={S.taskHeroNext}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={S.taskHeroNextLabel}>Następny krok</Text>
            <Text style={S.taskHeroNextTitle} numberOfLines={1}>{suggestedAction.title.replace('Sugerowany krok: ', '')}</Text>
            <Text style={S.taskHeroNextDetail} numberOfLines={2}>{suggestedAction.detail}</Text>
          </View>
          <TouchableOpacity
            style={[S.taskHeroCta, changingStatus && S.taskHeroCtaDisabled]}
            onPress={() => {
              void triggerHaptic('light');
              suggestedAction.onPress();
            }}
            disabled={changingStatus}
          >
            <Text style={S.taskHeroCtaText}>{suggestedAction.cta}</Text>
            <Ionicons name="chevron-forward" size={14} color={theme.accentText} />
          </TouchableOpacity>
        </View>

        <View style={S.taskHeroActions}>
          {taskHeroActions.map((action) => (
            <TouchableOpacity key={action.key} style={S.taskHeroAction} onPress={action.onPress}>
              <Ionicons name={action.icon} size={16} color={theme.accent} />
              <Text style={S.taskHeroActionText}>{action.label}</Text>
            </TouchableOpacity>
          ))}
          <View style={S.taskHeroValuePill}>
            <Text style={S.taskHeroValueLabel}>{isBrygadzista ? 'Czas' : 'Wartość'}</Text>
            <Text style={S.taskHeroValue}>{taskHeroValue}</Text>
          </View>
        </View>
      </View>

      {user && isFeatureEnabledForOddzial(user.oddzial_id, '/rezerwacje-sprzetu') ? (
        <TouchableOpacity
          style={S.linkRow}
          onPress={() => {
            const raw = zlecenie?.data_planowana;
            const d = typeof raw === 'string' ? raw.split('T')[0] : '';
            router.push({
              pathname: '/rezerwacje-sprzetu',
              params: { prefData: d || '', prefZlecenie: String(id) },
            } as never);
          }}
        >
          <PlatinumIconBadge icon="calendar-number-outline" color={theme.accent} size={11} style={{ width: 24, height: 24, borderRadius: 8 }} />
          <Text style={[S.linkRowTxt, { color: theme.accent }]}>{t('order.linkReservations')}</Text>
          <PlatinumIconBadge icon="chevron-forward" color={theme.textMuted} size={11} style={{ width: 24, height: 24, borderRadius: 8 }} />
        </TouchableOpacity>
      ) : null}

      <View style={[S.workflowCard, { borderColor: workflowColor, backgroundColor: workflowBlockersCount > 0 ? theme.warningBg : theme.cardBg }]}>
        <View style={S.workflowHead}>
          <View style={[S.workflowIconWrap, { backgroundColor: workflowColor + '18', borderColor: workflowColor }]}>
            <Ionicons name={workflowReadyForNext ? 'checkmark-circle-outline' : 'git-network-outline'} size={17} color={workflowColor} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={S.workflowTitle}>{workflowStageLabel}</Text>
            <Text style={S.workflowDetail} numberOfLines={2}>{workflowStageDetail}</Text>
          </View>
          <View style={[S.workflowCountBadge, { borderColor: workflowColor, backgroundColor: theme.cardBg }]}>
            <Text style={[S.workflowCountValue, { color: workflowColor }]}>{workflowBlockersCount}</Text>
            <Text style={S.workflowCountLabel}>braki</Text>
          </View>
        </View>
        {workflowMissingItems.length ? (
          <View style={S.workflowMissingWrap}>
            {workflowMissingItems.slice(0, 4).map((item) => (
              <TouchableOpacity
                key={`${item.key}-${item.label}`}
                style={[S.workflowMissingChip, { borderColor: item.required === false ? theme.border : workflowColor, backgroundColor: theme.cardBg }]}
                onPress={() => {
                  if (workflowTargetFor(item) === 'photos') {
                    setPhotoFilter(workflowPhotoFilterFor(item));
                    setActiveTab('zdjecia');
                  } else {
                    setActiveTab('info');
                  }
                }}
              >
                <Ionicons name={item.required === false ? 'ellipse-outline' : 'alert-circle-outline'} size={13} color={item.required === false ? theme.textMuted : workflowColor} />
                <Text style={[S.workflowMissingText, { color: item.required === false ? theme.textMuted : theme.text }]} numberOfLines={1}>{item.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        ) : null}
        <View style={S.workflowFooter}>
          <Text style={[S.workflowNextText, { color: workflowColor }]} numberOfLines={2}>{workflowNextAction}</Text>
          <TouchableOpacity style={[S.workflowBtn, { backgroundColor: workflowColor, borderColor: workflowColor }]} onPress={runWorkflowPrimaryAction}>
            <Text style={S.workflowBtnText}>{workflowPrimaryCta}</Text>
            <Ionicons name="chevron-forward" size={14} color={theme.accentText} />
          </TouchableOpacity>
        </View>
      </View>

      {isFieldDraft && officeHandoffLines.length ? (
        <View style={[S.officeHandoffCard, { backgroundColor: officeHandoffReady ? theme.successBg : theme.warningBg, borderColor: officeHandoffReady ? theme.success : theme.warning }]}>
          <View style={S.officeHandoffHead}>
            <View style={[S.officeHandoffIcon, { backgroundColor: theme.cardBg, borderColor: officeHandoffReady ? theme.success : theme.warning }]}>
              <Ionicons name={officeHandoffReady ? 'checkmark-done-outline' : 'clipboard-outline'} size={18} color={officeHandoffReady ? theme.success : theme.warning} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[S.officeHandoffTitle, { color: officeHandoffReady ? theme.success : theme.warning }]}>
                {officeHandoffReady ? 'Gotowe dla biura' : 'Przekazanie do biura'}
              </Text>
              <Text style={[S.officeHandoffSub, { color: theme.textSub }]}>
                Cena, ekipa, termin i pakiet zdjęć z wyceny terenowej.
              </Text>
            </View>
            <TouchableOpacity style={[S.officeHandoffPhotosBtn, { backgroundColor: theme.cardBg, borderColor: theme.border }]} onPress={() => setActiveTab('zdjecia')}>
              <Ionicons name="images-outline" size={15} color={theme.accent} />
              <Text style={[S.officeHandoffPhotosText, { color: theme.accent }]}>{zdjecia.length}</Text>
            </TouchableOpacity>
          </View>
          <View style={S.officeHandoffLines}>
            {officeHandoffLines.slice(0, 8).map((line) => (
              <Text key={line} style={[S.officeHandoffLine, { color: theme.textSub }]} selectable>
                {line}
              </Text>
            ))}
          </View>
        </View>
      ) : null}

      {showFieldPackageCard ? (
        <View style={[S.fieldPackageCard, { backgroundColor: fieldPackageReadyForOffice ? theme.successBg : theme.cardBg, borderColor: fieldPackageReadyForOffice ? theme.success : theme.cardBorder }]}>
          <View style={S.fieldPackageHead}>
            <View style={[S.fieldPackageIcon, { backgroundColor: theme.accentLight, borderColor: theme.accent }]}>
              <Ionicons name="leaf-outline" size={20} color={theme.accent} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[S.fieldPackageTitle, { color: theme.text }]}>Pakiet wyceny terenowej</Text>
              <Text style={[S.fieldPackageSub, { color: theme.textMuted }]}>
                Zdjęcia, szkic, zakres, czas, budżet i ryzyka. Po akceptacji wraca do biura.
              </Text>
            </View>
          </View>

          <View style={S.fieldPackageChecks}>
            {fieldDraftPhotoChecklist.map((row) => (
              <TouchableOpacity
                key={row.key}
                style={[S.fieldPackageCheck, { backgroundColor: row.done ? theme.successBg : theme.warningBg, borderColor: row.done ? theme.success : theme.warning }]}
                onPress={() => {
                  setPhotoFilter(row.type as PhotoFilterKey);
                  setActiveTab('zdjecia');
                  void triggerHaptic('light');
                }}
              >
                <Ionicons name={row.done ? 'checkmark-circle' : 'camera-outline'} size={16} color={row.done ? theme.success : theme.warning} />
                <View style={{ flex: 1 }}>
                  <Text style={[S.fieldPackageCheckLabel, { color: theme.text }]} numberOfLines={1}>{row.label}</Text>
                  <Text style={[S.fieldPackageCheckHint, { color: theme.textMuted }]}>{row.hint}</Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={[S.fieldPackageLabel, { color: theme.textSub }]}>Typ prac</Text>
          <View style={S.fieldPackageChipRow}>
            {TASK_SCOPE_PRESETS.map((preset) => {
              const selected = fieldScopePresetKeys.includes(preset.key);
              return (
                <TouchableOpacity
                  key={preset.key}
                  style={[
                    S.fieldPackageChip,
                    {
                      backgroundColor: selected ? theme.accentLight : theme.surface2,
                      borderColor: selected ? theme.accent : theme.border,
                    },
                  ]}
                  onPress={() => toggleFieldScopePreset(preset)}
                >
                  <Text style={[S.fieldPackageChipText, { color: selected ? theme.accent : theme.textSub }]}>{preset.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={[S.fieldPackageLabel, { color: theme.textSub }]}>Zakres prac dla ekipy</Text>
          <TextInput
            style={[S.fieldPackageInput, S.fieldPackageTextarea, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surface2 }]}
            placeholder="np. przyciąć koronę od strony ogrodzenia, usunąć suche gałęzie, zabezpieczyć rabatę"
            placeholderTextColor={theme.textMuted}
            value={fieldScopeDraft}
            onChangeText={setFieldScopeDraft}
            multiline
          />
          <View style={S.fieldPackageTwoCol}>
            <View style={{ flex: 1 }}>
              <Text style={[S.fieldPackageLabel, { color: theme.textSub }]}>Czas pracy</Text>
              <TextInput
                style={[S.fieldPackageInput, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surface2 }]}
                placeholder="np. 3"
                placeholderTextColor={theme.textMuted}
                value={fieldTimeDraft}
                onChangeText={setFieldTimeDraft}
                keyboardType="decimal-pad"
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[S.fieldPackageLabel, { color: theme.textSub }]}>Budżet PLN</Text>
              <TextInput
                style={[S.fieldPackageInput, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surface2 }]}
                placeholder="np. 2500"
                placeholderTextColor={theme.textMuted}
                value={fieldBudgetDraft}
                onChangeText={setFieldBudgetDraft}
                keyboardType="decimal-pad"
              />
            </View>
          </View>
          <Text style={[S.fieldPackageLabel, { color: theme.textSub }]}>Sprzęt dla biura</Text>
          <View style={S.fieldPackageChipRow}>
            {TASK_EQUIPMENT_OPTIONS.map((preset) => {
              const selected = fieldEquipmentKeys.includes(preset.key);
              return (
                <TouchableOpacity
                  key={preset.key}
                  style={[
                    S.fieldPackageChip,
                    {
                      backgroundColor: selected ? theme.accentLight : theme.surface2,
                      borderColor: selected ? theme.accent : theme.border,
                    },
                  ]}
                  onPress={() => toggleFieldEquipment(preset)}
                >
                  <Text style={[S.fieldPackageChipText, { color: selected ? theme.accent : theme.textSub }]}>{preset.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <Text style={[S.fieldPackageLabel, { color: theme.textSub }]}>Warunki rozliczenia</Text>
          <View style={S.fieldPackageChipRow}>
            {TASK_SETTLEMENT_OPTIONS.map((preset) => {
              const selected = fieldSettlementDraft === preset.note;
              return (
                <TouchableOpacity
                  key={preset.key}
                  style={[
                    S.fieldPackageChip,
                    {
                      backgroundColor: selected ? theme.accentLight : theme.surface2,
                      borderColor: selected ? theme.accent : theme.border,
                    },
                  ]}
                  onPress={() => {
                    setFieldSettlementDraft(preset.note);
                    void triggerHaptic('light');
                  }}
                >
                  <Text style={[S.fieldPackageChipText, { color: selected ? theme.accent : theme.textSub }]}>{preset.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <Text style={[S.fieldPackageLabel, { color: theme.textSub }]}>Ryzyka / uwagi BHP</Text>
          <View style={S.fieldPackageChipRow}>
            {TASK_RISK_PRESETS.map((preset) => (
              <TouchableOpacity
                key={preset.key}
                style={[S.fieldPackageChip, { backgroundColor: fieldRiskDraft.includes(preset.note) ? theme.warningBg : theme.surface2, borderColor: fieldRiskDraft.includes(preset.note) ? theme.warning : theme.border }]}
                onPress={() => appendFieldRiskPreset(preset)}
              >
                <Text style={[S.fieldPackageChipText, { color: fieldRiskDraft.includes(preset.note) ? theme.warning : theme.textSub }]}>{preset.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TextInput
            style={[S.fieldPackageInput, S.fieldPackageTextareaSmall, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surface2 }]}
            placeholder="np. linia nad ogrodzeniem, wąski dojazd, auto klienta do przestawienia"
            placeholderTextColor={theme.textMuted}
            value={fieldRiskDraft}
            onChangeText={setFieldRiskDraft}
            multiline
          />
          <Text style={[S.fieldPackageSettlementText, { color: theme.textMuted }]}>{fieldSettlementDraft}</Text>
          <View style={[S.fieldPackageAcceptRow, { backgroundColor: theme.surface2, borderColor: fieldClientAccepted ? theme.success : theme.border }]}>
            <View style={{ flex: 1 }}>
              <Text style={[S.fieldPackageAcceptTitle, { color: theme.text }]}>Klient akceptuje zakres i budżet</Text>
              <Text style={[S.fieldPackageAcceptSub, { color: theme.textMuted }]}>Bez tego nie oddajemy zlecenia do biura jako gotowego do planowania.</Text>
            </View>
            <Switch value={fieldClientAccepted} onValueChange={setFieldClientAccepted} />
          </View>
          <View style={S.fieldPackageActions}>
            <TouchableOpacity
              style={[S.fieldPackageBtnSecondary, { borderColor: theme.border, backgroundColor: theme.surface2 }]}
              disabled={fieldPackageSaving}
              onPress={() => void saveFieldPackage(false)}
            >
              <Text style={[S.fieldPackageBtnSecondaryText, { color: theme.textSub }]}>Zapisz draft</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[S.fieldPackageBtnPrimary, { backgroundColor: fieldPackageReadyForOffice ? theme.success : theme.accent, opacity: fieldPackageSaving ? 0.65 : 1 }]}
              disabled={fieldPackageSaving}
              onPress={() => void saveFieldPackage(true)}
            >
              <Text style={S.fieldPackageBtnPrimaryText}>{fieldPackageSaving ? 'Zapisuję...' : 'Klient akceptuje - do biura'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

      {/* ── AKCJE EKIPY (brygadzista / pomocnik) ── */}
      {isEkipa ? (
        <View style={[S.crewBriefCard, { backgroundColor: scopeConfirmed ? theme.successBg : theme.surface2, borderColor: scopeConfirmed ? theme.success : theme.cardBorder }]}>
          <View style={S.crewBriefHead}>
            <View style={[S.crewBriefIcon, { backgroundColor: scopeConfirmed ? theme.successBg : theme.accentLight, borderColor: scopeConfirmed ? theme.success : theme.accent }]}>
              <Ionicons name={scopeConfirmed ? 'checkmark-done-outline' : 'shield-checkmark-outline'} size={20} color={scopeConfirmed ? theme.success : theme.accent} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[S.crewBriefTitle, { color: scopeConfirmed ? theme.success : theme.text }]}>Odprawa ekipy przed startem</Text>
              <Text style={[S.crewBriefSub, { color: theme.textMuted }]}>
                Zakres, zdjęcia, szkic i BHP muszą być jasne zanim brygada zacznie pracę.
              </Text>
            </View>
            <View style={[S.crewBriefScore, { backgroundColor: theme.cardBg, borderColor: scopeConfirmed ? theme.success : theme.border }]}>
              <Text style={[S.crewBriefScoreValue, { color: scopeConfirmed ? theme.success : theme.accent }]}>{crewBriefReadyCount}/{crewBriefChecks.length}</Text>
              <Text style={[S.crewBriefScoreLabel, { color: theme.textMuted }]}>punkty</Text>
            </View>
          </View>

          <View style={S.crewBriefQuickActions}>
            {zlecenie.klient_telefon ? (
              <TouchableOpacity style={[S.crewBriefActionBtn, { backgroundColor: theme.cardBg, borderColor: theme.border }]} onPress={() => Linking.openURL(`tel:${zlecenie.klient_telefon}`)}>
                <Ionicons name="call-outline" size={15} color={theme.success} />
                <Text style={[S.crewBriefActionText, { color: theme.success }]}>Telefon</Text>
              </TouchableOpacity>
            ) : null}
            {(zlecenie.adres || zlecenie.miasto) ? (
              <TouchableOpacity style={[S.crewBriefActionBtn, { backgroundColor: theme.cardBg, borderColor: theme.border }]} onPress={() => { void openAddressInMaps(zlecenie.adres || '', zlecenie.miasto || ''); }}>
                <Ionicons name="map-outline" size={15} color={theme.info} />
                <Text style={[S.crewBriefActionText, { color: theme.info }]}>Mapa</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity style={[S.crewBriefActionBtn, { backgroundColor: theme.cardBg, borderColor: theme.border }]} onPress={() => setActiveTab('zdjecia')}>
              <Ionicons name="images-outline" size={15} color={theme.accent} />
              <Text style={[S.crewBriefActionText, { color: theme.accent }]}>Zdjęcia</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[S.crewBriefActionBtn, { backgroundColor: theme.cardBg, borderColor: theme.border }]} onPress={() => { void copyCrewBrief(); }}>
              <Ionicons name="copy-outline" size={15} color={theme.warning} />
              <Text style={[S.crewBriefActionText, { color: theme.warning }]}>Kopiuj</Text>
            </TouchableOpacity>
          </View>

          <View style={S.crewProofGrid}>
            {crewProofCards.map((card) => (
              <TouchableOpacity
                key={card.key}
                style={[
                  S.crewProofCard,
                  {
                    backgroundColor: card.done ? theme.successBg : theme.warningBg,
                    borderColor: card.done ? theme.success : theme.warning,
                  },
                ]}
                onPress={() => {
                  void triggerHaptic('light');
                  card.onPress();
                }}
              >
                <View style={S.crewProofTop}>
                  <Ionicons name={card.done ? 'checkmark-circle' : card.icon} size={16} color={card.done ? theme.success : theme.warning} />
                  <Text style={[S.crewProofValue, { color: card.done ? theme.success : theme.warning }]}>{card.value}</Text>
                </View>
                <Text style={[S.crewProofLabel, { color: theme.text }]} numberOfLines={1}>{card.label}</Text>
                <Text style={[S.crewProofHint, { color: theme.textMuted }]} numberOfLines={1}>{card.hint}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={[S.crewScopeBox, { backgroundColor: theme.cardBg, borderColor: theme.border }]}>
            <Text style={[S.crewScopeTitle, { color: theme.text }]}>Zakres z wyceny</Text>
            {[scopeLine, accessLine, riskLine].filter(Boolean).slice(0, 4).map((line) => (
              <Text key={line} style={[S.crewScopeLine, { color: theme.textSub }]} selectable>
                {line}
              </Text>
            ))}
            {!scopeLine && (zlecenie.opis || zlecenie.opis_pracy) ? (
              <Text style={[S.crewScopeLine, { color: theme.textSub }]} selectable>
                {zlecenie.opis || zlecenie.opis_pracy}
              </Text>
            ) : null}
            {taskEquipmentList.length ? (
              <Text style={[S.crewScopeLine, { color: theme.textSub }]} selectable>
                Sprzęt: {taskEquipmentList.join(', ')}
              </Text>
            ) : null}
          </View>

          {briefingPhotos.length ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={S.crewPhotoStrip}>
              {briefingPhotos.map((photo: any) => (
                <TouchableOpacity key={photo.id || photo.url || photo.sciezka} style={[S.crewPhotoCard, { backgroundColor: theme.cardBg, borderColor: theme.border }]} onPress={() => setActiveTab('zdjecia')}>
                  <Image source={{ uri: absolutePhotoUrl(photo.url || photo.sciezka) }} style={S.crewPhotoImage} />
                  <Text style={[S.crewPhotoLabel, { color: theme.textSub }]} numberOfLines={1}>
                    {PHOTO_TYPE_LABELS[String(photo.typ || 'inne') as keyof typeof PHOTO_TYPE_LABELS] || 'Zdjęcie'}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          ) : null}

          <View style={S.crewBriefChecks}>
            {crewBriefChecks.map((check) => (
              <View key={check.key} style={[S.crewBriefCheck, { backgroundColor: theme.cardBg, borderColor: check.done ? theme.success : theme.warning }]}>
                <Ionicons name={check.done ? 'checkmark-circle' : check.icon} size={16} color={check.done ? theme.success : theme.warning} />
                <View style={{ flex: 1 }}>
                  <Text style={[S.crewBriefCheckTitle, { color: theme.text }]}>{check.label}</Text>
                  <Text style={[S.crewBriefCheckHint, { color: theme.textMuted }]} numberOfLines={2}>{check.hint}</Text>
                </View>
              </View>
            ))}
          </View>

          <View style={[S.safetyChecklistCard, { backgroundColor: theme.cardBg, borderColor: safetyReady ? theme.success : theme.warning }]}>
            <View style={S.safetyChecklistHead}>
              <View style={[S.safetyChecklistIcon, { backgroundColor: safetyReady ? theme.successBg : theme.warningBg, borderColor: safetyReady ? theme.success : theme.warning }]}>
                <Ionicons name={safetyReady ? 'shield-checkmark' : 'shield-outline'} size={19} color={safetyReady ? theme.success : theme.warning} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[S.safetyChecklistTitle, { color: safetyReady ? theme.success : theme.text }]}>BHP przed startem</Text>
                <Text style={[S.safetyChecklistSub, { color: theme.textMuted }]}>
                  {safetyDoneCount}/{safetyChecklistRows.length} punktow potwierdzone dla tej pracy.
                </Text>
              </View>
            </View>
            <View style={S.safetyChecklistRows}>
              {safetyChecklistRows.map((item) => (
                <TouchableOpacity
                  key={item.key}
                  style={[
                    S.safetyChecklistRow,
                    {
                      backgroundColor: item.done ? theme.successBg : theme.surface2,
                      borderColor: item.done ? theme.success : theme.border,
                    },
                  ]}
                  onPress={() => { void toggleSafetyCheck(item.key); }}
                >
                  <Ionicons name={(item.done ? 'checkmark-circle' : item.icon) as IoniconName} size={18} color={item.done ? theme.success : theme.textMuted} />
                  <View style={{ flex: 1 }}>
                    <Text style={[S.safetyChecklistRowTitle, { color: theme.text }]}>{item.label}</Text>
                    <Text style={[S.safetyChecklistRowHint, { color: theme.textMuted }]} numberOfLines={2}>{item.hint}</Text>
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <TouchableOpacity
            style={[S.scopeConfirmBtn, { backgroundColor: scopeConfirmed ? theme.successBg : theme.accent, borderColor: scopeConfirmed ? theme.success : theme.accentDark }]}
            onPress={() => { void confirmScopeBriefing(); }}
          >
            <Ionicons name={scopeConfirmed ? 'checkmark-done-outline' : 'shield-checkmark-outline'} size={17} color={scopeConfirmed ? theme.success : theme.accentText} />
            <Text style={[S.scopeConfirmText, { color: scopeConfirmed ? theme.success : theme.accentText }]}>
              {scopeConfirmed ? 'Zakres i BHP potwierdzone' : 'Potwierdzam zakres, zdjęcia i BHP'}
            </Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {isEkipa && finishPhotoBlocked ? (
        <View style={{ paddingHorizontal: 14, paddingBottom: 8 }}>
          <Text style={{ color: theme.warning, fontSize: 13, fontWeight: '600' }}>
            {t('order.finishReqBanner', {
              missing: [
                finishRequirements.require_po_photo && !finishRequirements.has_po_photo
                  ? t('order.finishReqMissingPo')
                  : '',
                finishRequirements.require_przed_photo && !finishRequirements.has_przed_photo
                  ? t('order.finishReqMissingPrzed')
                  : '',
              ]
                .filter(Boolean)
                .join(', '),
            })}
          </Text>
        </View>
      ) : null}
      {isEkipa && crewPrimaryAction ? (
        <View style={[S.crewCommandCard, { backgroundColor: theme.cardBg, borderColor: theme.cardBorder }]}>
          <View style={S.crewCommandHead}>
            <View style={[S.crewCommandIcon, { backgroundColor: crewPrimaryAction.color + '22', borderColor: crewPrimaryAction.color }]}>
              <Ionicons name={crewPrimaryAction.icon} size={21} color={crewPrimaryAction.color} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[S.crewCommandTitle, { color: theme.text }]}>Panel pracy ekipy</Text>
              <Text style={[S.crewCommandSub, { color: theme.textMuted }]} numberOfLines={2}>
                {crewPrimaryAction.hint}
              </Text>
            </View>
            <TouchableOpacity
              style={[S.crewPrimaryBtn, { backgroundColor: crewPrimaryAction.color, borderColor: crewPrimaryAction.color }]}
              onPress={() => {
                void triggerHaptic('light');
                crewPrimaryAction.onPress();
              }}
              disabled={changingStatus}
            >
              {changingStatus ? (
                <ActivityIndicator size="small" color={theme.accentText} />
              ) : (
                <>
                  <Text style={[S.crewPrimaryText, { color: theme.accentText }]}>{crewPrimaryAction.label}</Text>
                  <Ionicons name="chevron-forward" size={15} color={theme.accentText} />
                </>
              )}
            </TouchableOpacity>
          </View>

          <View style={S.crewCommandProgressGrid}>
            {crewProgressItems.map((item) => (
              <TouchableOpacity
                key={item.key}
                style={[
                  S.crewProgressTile,
                  {
                    backgroundColor: item.done ? theme.successBg : theme.surface2,
                    borderColor: item.done ? theme.success : theme.border,
                  },
                ]}
                onPress={() => {
                  if (item.key === 'issues') setActiveTab('problemy');
                  else setActiveTab('zdjecia');
                }}
              >
                <Ionicons name={item.done ? 'checkmark-circle' : item.icon} size={16} color={item.done ? theme.success : theme.textMuted} />
                <Text style={[S.crewProgressValue, { color: item.done ? theme.success : theme.text }]}>{item.value}</Text>
                <Text style={[S.crewProgressLabel, { color: theme.textMuted }]}>{item.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={[S.crewRoadmap, { backgroundColor: theme.surface2, borderColor: theme.border }]}>
            <View style={S.crewRoadmapHead}>
              <Ionicons name="git-branch-outline" size={16} color={theme.accent} />
              <View style={{ flex: 1 }}>
                <Text style={[S.crewRoadmapTitle, { color: theme.text }]}>Plan pracy krok po kroku</Text>
                <Text style={[S.crewRoadmapSub, { color: theme.textMuted }]}>
                  Brygada widzi kolejny ruch i blokady zamkniecia zlecenia.
                </Text>
              </View>
            </View>
            {crewWorkSteps.map((step, index) => {
              const tone = step.done ? theme.success : step.blocked ? theme.warning : step.active ? theme.accent : theme.textMuted;
              const background = step.done ? theme.successBg : step.blocked ? theme.warningBg : step.active ? theme.accentLight : theme.cardBg;
              const statusText = step.done ? 'OK' : step.blocked ? 'Braki' : step.active ? 'Teraz' : 'Dalej';
              return (
                <TouchableOpacity
                  key={step.key}
                  style={[S.crewRoadmapStep, { backgroundColor: background, borderColor: tone + '80' }]}
                  onPress={() => {
                    void triggerHaptic('light');
                    if (step.blocked && step.key === 'finish') {
                      setFinishModal(true);
                      return;
                    }
                    if (step.blocked && step.key === 'evidence') {
                      setActiveTab('problemy');
                      return;
                    }
                    if (!step.done) step.action();
                  }}
                  disabled={step.done && step.key !== 'evidence'}
                >
                  <View style={[S.crewRoadmapIndex, { borderColor: tone, backgroundColor: theme.cardBg }]}>
                    {step.done ? (
                      <Ionicons name="checkmark" size={14} color={theme.success} />
                    ) : (
                      <Text style={[S.crewRoadmapIndexText, { color: tone }]}>{index + 1}</Text>
                    )}
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={S.crewRoadmapStepTop}>
                      <Text style={[S.crewRoadmapStepTitle, { color: theme.text }]}>{step.title}</Text>
                      <View style={[S.crewRoadmapBadge, { backgroundColor: tone + '22', borderColor: tone + '70' }]}>
                        <Text style={[S.crewRoadmapBadgeText, { color: tone }]}>{statusText}</Text>
                      </View>
                    </View>
                    <Text style={[S.crewRoadmapHint, { color: theme.textMuted }]} numberOfLines={2}>{step.hint}</Text>
                    <View style={S.crewRoadmapMeta}>
                      <Ionicons name={step.icon} size={13} color={tone} />
                      <Text style={[S.crewRoadmapValue, { color: tone }]}>{step.value}</Text>
                    </View>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>

          <View style={S.crewFastGrid}>
            {crewFastActions.map((action) => (
              <TouchableOpacity
                key={action.key}
                style={[
                  S.crewFastBtn,
                  {
                    backgroundColor: action.backgroundColor,
                    borderColor: action.borderColor,
                    opacity: action.disabled ? 0.6 : 1,
                  },
                ]}
                onPress={() => {
                  void triggerHaptic('light');
                  action.onPress();
                }}
                disabled={action.disabled}
              >
                <View style={[S.crewFastIcon, { backgroundColor: theme.cardBg, borderColor: action.borderColor }]}>
                  <Ionicons name={action.icon} size={16} color={action.color} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[S.crewFastLabel, { color: action.color }]}>{action.label}</Text>
                  <Text style={[S.crewFastHint, { color: theme.textMuted }]} numberOfLines={1}>{action.hint}</Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      ) : null}
      {/* M3 F3.10 — praca dodatkowa (zgłoszenie + akceptacja na miejscu) */}
      {isEkipa && zlecenie.status === 'W_Realizacji' ? (
        <View style={{ paddingHorizontal: 14, paddingBottom: 10 }}>
          <Text style={{ color: theme.text, fontWeight: '700', marginBottom: 6 }}>Praca dodatkowa</Text>
          <TextInput
            style={[S.modalInput, { backgroundColor: theme.inputBg, borderColor: theme.inputBorder, color: theme.inputText, marginBottom: 8 }]}
            placeholder="Opis pracy do wyceny przez wyceniającego..."
            placeholderTextColor={theme.inputPlaceholder}
            value={extraOpis}
            onChangeText={setExtraOpis}
            multiline
          />
          <TouchableOpacity
            style={{ alignSelf: 'flex-start', backgroundColor: `${theme.accent}22`, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10 }}
            onPress={() => void submitExtraWork()}
          >
            <Text style={{ color: theme.accent, fontWeight: '600' }}>Zgłoś do wyceny</Text>
          </TouchableOpacity>
          {Array.isArray(zlecenie.extra_work) && zlecenie.extra_work.length > 0 ? (
            <View style={{ marginTop: 10 }}>
              {zlecenie.extra_work.map((ew: any) => (
                <View key={ew.id} style={{ padding: 10, marginTop: 8, borderRadius: 10, backgroundColor: theme.surface2, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border }}>
                  <Text style={{ color: theme.textMuted, fontSize: 12 }}>#{ew.id} · {ew.status}</Text>
                  <Text style={{ color: theme.text, marginTop: 4 }}>{ew.opis}</Text>
                  {ew.amount_pln != null ? <Text style={{ color: theme.accent, marginTop: 4 }}>{Number(ew.amount_pln).toFixed(2)} PLN</Text> : null}
                  {ew.status === 'Wycenione' ? (
                    <View style={{ marginTop: 8, flexDirection: 'row', gap: 12 }}>
                      <TouchableOpacity style={{ alignSelf: 'flex-start' }} onPress={() => void acceptExtraWork(ew.id)}>
                        <Text style={{ color: theme.success, fontWeight: '700' }}>Akceptuj u klienta</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={{ alignSelf: 'flex-start' }} onPress={() => void rejectExtraWork(ew.id)}>
                        <Text style={{ color: theme.danger, fontWeight: '700' }}>Odrzuć</Text>
                      </TouchableOpacity>
                    </View>
                  ) : null}
                  {user?.rola === 'Wyceniający' && Number(zlecenie.wyceniajacy_id) === Number(user?.id) && ew.status === 'OczekujeWyceny' ? (
                    <View style={{ marginTop: 8, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <TextInput
                        style={[S.modalInput, { flex: 1, backgroundColor: theme.inputBg, borderColor: theme.inputBorder, color: theme.inputText }]}
                        placeholder="Kwota PLN"
                        placeholderTextColor={theme.inputPlaceholder}
                        keyboardType="decimal-pad"
                        value={quoteAmount[ew.id] || ''}
                        onChangeText={(v) => setQuoteAmount((m) => ({ ...m, [ew.id]: v }))}
                      />
                      <TouchableOpacity onPress={() => void quoteExtraWork(ew.id)}>
                        <Text style={{ color: theme.accent, fontWeight: '700' }}>Wyceniaj</Text>
                      </TouchableOpacity>
                    </View>
                  ) : null}
                </View>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}

      {user?.rola === 'Wyceniający' && Number(zlecenie?.wyceniajacy_id) === Number(user?.id) && zlecenie.status === 'W_Realizacji' && Array.isArray(zlecenie.extra_work) && zlecenie.extra_work.some((x: any) => x.status === 'OczekujeWyceny') ? (
        <View style={{ paddingHorizontal: 14, paddingBottom: 6 }}>
          <Text style={{ color: theme.warning, fontSize: 13 }}>Masz prace dodatkowe do wyceny na tym zleceniu.</Text>
        </View>
      ) : null}

      {/* ── PASEK CZASU (jeśli są logi) ── */}
      {logi.length > 0 && (
        <View style={[S.timerBar, { backgroundColor: theme.surface }]}>
          <PlatinumIconBadge icon="time-outline" color={theme.accent} size={10} style={{ width: 22, height: 22, borderRadius: 7 }} />
          <Text style={[S.timerTxt, { color: theme.textSub }]}>
            Czas pracy: <Text style={{ color: theme.accent, fontWeight: '700' }}>{totalGodziny.toFixed(1)} godz.</Text>
            {'  '}|{'  '}
            <Text style={{ color: theme.textMuted }}>{logi.length} {logi.length === 1 ? 'wpis' : 'wpisów'}</Text>
          </Text>
        </View>
      )}

      {/* ── ZMIANA STATUSU (kierownik/dyrektor) ── */}
      {mozeZmieniacStatus && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false}
          style={[S.statusScroll, { backgroundColor: theme.surface, borderBottomColor: theme.border }]}
          contentContainerStyle={S.statusScrollContent}>
          {mobileStatusOptions.map(s => (
            <TouchableOpacity key={s}
              style={[
                S.statusBtn,
                { backgroundColor: theme.surface2, borderColor: theme.border },
                zlecenie.status === s && {
                  backgroundColor: statusPalette[s as keyof typeof statusPalette],
                  borderColor: statusPalette[s as keyof typeof statusPalette],
                }
              ]}
              onPress={() => s !== zlecenie.status && zmienStatus(s)}
              disabled={changingStatus || zlecenie.status === s}>
              <Text style={[S.statusBtnTxt, { color: theme.textSub }, zlecenie.status === s && { color: theme.accentText }]}>
                {s.replace('_', ' ')}
              </Text>
            </TouchableOpacity>
          ))}
          <View style={[S.statusHintPill, { backgroundColor: theme.warningBg, borderColor: theme.warning }]}>
            <Ionicons name="git-branch-outline" size={13} color={theme.warning} />
            <Text style={[S.statusHintText, { color: theme.warning }]}>tylko kolejny krok</Text>
          </View>
        </ScrollView>
      )}

      {/* ── TABY ── */}
      <View style={[S.tabs, { backgroundColor: theme.surface, borderBottomColor: theme.border }]}>
        {([
          { key: 'info',     icon: 'information-circle-outline' as IoniconName, label: 'Info' },
          { key: 'logi',     icon: 'time-outline' as IoniconName,               label: `Czas (${logi.length})` },
          { key: 'problemy', icon: 'warning-outline' as IoniconName,            label: `Problem (${problemy.length})` },
          { key: 'zdjecia',  icon: 'camera-outline' as IoniconName,             label: `Zdjęcia (${zdjecia.length})` },
        ] as const).map(tab => (
          <TouchableOpacity
            key={tab.key}
            style={[S.tab, activeTab === tab.key && { borderBottomColor: theme.accent }]}
            onPress={() => {
              void triggerHaptic('light');
              setActiveTab(tab.key as any);
            }}
          >
            <Ionicons
              name={tab.icon}
              size={16}
              color={activeTab === tab.key ? theme.accent : theme.textMuted}
            />
            <Text style={[S.tabTxt, { color: theme.textMuted }, activeTab === tab.key && { color: theme.accent, fontWeight: '700' }]}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* ── TREŚĆ ── */}
      <ScrollView
        style={[S.content, { backgroundColor: theme.bg }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.accent} colors={[theme.accent]} />}
      >
        {/* TAB: INFO */}
        {activeTab === 'info' && (
          <View>
            <View style={[S.card, { backgroundColor: theme.cardBg, borderColor: theme.cardBorder }]}>
              <View style={S.cardTitleRow}>
                <PlatinumIconBadge icon="person-circle-outline" color={theme.accent} size={10} style={{ width: 22, height: 22, borderRadius: 7 }} />
                <Text style={[S.cardTitle, { color: theme.text }]}>Klient</Text>
              </View>
              <Text style={[S.bigVal, { color: theme.text }]}>{zlecenie.klient_nazwa}</Text>
              {zlecenie.klient_telefon && (
                <View style={S.metaRow}>
                  <PlatinumIconBadge icon="call-outline" color={theme.textMuted} size={10} style={{ width: 22, height: 22, borderRadius: 7 }} />
                  <Text style={[S.metaTxt, { color: theme.textSub }]}> {zlecenie.klient_telefon}</Text>
                </View>
              )}
              <View style={S.metaRow}>
                <PlatinumIconBadge icon="location-outline" color={theme.textMuted} size={10} style={{ width: 22, height: 22, borderRadius: 7 }} />
                <Text style={[S.metaTxt, { color: theme.textSub }]}>
                  {' '}{zlecenie.adres}{zlecenie.miasto ? `, ${zlecenie.miasto}` : ''}
                </Text>
              </View>
              {(zlecenie.adres || zlecenie.miasto) ? (
                <TouchableOpacity
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 }}
                  onPress={() => { void openAddressInMaps(zlecenie.adres || '', zlecenie.miasto || ''); }}
                >
                  <PlatinumIconBadge icon="map-outline" color={theme.accent} size={11} style={{ width: 24, height: 24, borderRadius: 8 }} />
                  <Text style={{ color: theme.accent, fontWeight: '600' }}>{t('order.openMaps')}</Text>
                </TouchableOpacity>
              ) : null}
            </View>

            <View style={[S.card, { backgroundColor: theme.cardBg, borderColor: theme.cardBorder }]}>
              <View style={S.cardTitleRow}>
                <PlatinumIconBadge icon="construct-outline" color={theme.accent} size={11} style={{ width: 24, height: 24, borderRadius: 8 }} />
                <Text style={[S.cardTitle, { color: theme.text }]}>Zlecenie</Text>
              </View>
              <InfoRow theme={theme} label="Typ usługi" val={zlecenie.typ_uslugi} />
              <View style={S.row}>
                <Text style={[S.lbl, { color: theme.textMuted }]}>Priorytet:</Text>
                <View style={[S.prioBadge, { backgroundColor: (prioPalette[zlecenie.priorytet as keyof typeof prioPalette] || theme.textMuted) + '28' }]}>
                  <Text style={[S.prioBadgeTxt, { color: prioPalette[zlecenie.priorytet as keyof typeof prioPalette] || theme.textMuted }]}>
                    {zlecenie.priorytet}
                  </Text>
                </View>
              </View>
              {zlecenie.data_planowana && <InfoRow theme={theme} label="Data" val={zlecenie.data_planowana.split('T')[0]} />}
              {!isBrygadzista && zlecenie.wartosc_planowana && (
                <View style={S.row}>
                  <Text style={[S.lbl, { color: theme.textMuted }]}>Wartość:</Text>
                  <Text style={[S.val, { color: theme.accent, fontWeight: '700' }]}>
                    {parseFloat(zlecenie.wartosc_planowana).toLocaleString('pl-PL')} PLN
                  </Text>
                </View>
              )}
              {zlecenie.opis && (
                <Text style={[S.opisTxt, { color: theme.textSub, borderTopColor: theme.border }]}>{zlecenie.opis}</Text>
              )}
            </View>

            <View style={[S.card, { backgroundColor: theme.cardBg, borderColor: theme.cardBorder }]}>
              <View style={S.cardTitleRow}>
                <PlatinumIconBadge icon="folder-open-outline" color={theme.accent} size={11} style={{ width: 24, height: 24, borderRadius: 8 }} />
                <Text style={[S.cardTitle, { color: theme.text }]}>Teczka cyfrowa</Text>
              </View>
              <Text style={S.dossierSub}>
                Komplet dokumentacji mobilnej: {dossierDoneCount}/{dossierChecklist.length}
              </Text>
              <View style={[S.dossierProgressTrack, { backgroundColor: theme.surface2 }]}>
                <View
                  style={[
                    S.dossierProgressFill,
                    {
                      width: `${Math.round((dossierDoneCount / Math.max(1, dossierChecklist.length)) * 100)}%`,
                      backgroundColor: dossierReady ? theme.success : theme.accent,
                    },
                  ]}
                />
              </View>
              {dossierChecklist.map((row) => (
                <TouchableOpacity key={row.key} style={S.dossierRow} onPress={row.onPress}>
                  <Ionicons
                    name={row.done ? 'checkmark-circle' : 'ellipse-outline'}
                    size={17}
                    color={row.done ? theme.success : theme.textMuted}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={[S.dossierRowLabel, row.done && { color: theme.text }]}>
                      {row.label}
                    </Text>
                    <Text style={S.dossierRowHint}>{row.hint}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={15} color={theme.textMuted} />
                </TouchableOpacity>
              ))}
              <View style={S.dossierActions}>
                <TouchableOpacity
                  style={[S.dossierActionBtn, { borderColor: theme.border, backgroundColor: theme.surface2 }]}
                  onPress={() => { void copyDossierSummary(); }}
                >
                  <Ionicons name="copy-outline" size={14} color={theme.textSub} />
                  <Text style={[S.dossierActionText, { color: theme.textSub }]}>Kopiuj podsumowanie</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[S.dossierActionBtn, { borderColor: dossierReady ? theme.success : theme.warning, backgroundColor: dossierReady ? theme.successBg : theme.warningBg }]}
                  onPress={() => {
                    void triggerHaptic('light');
                    if (dossierReady) {
                      Alert.alert('Teczka kompletna', 'Możesz bezpiecznie domknąć zlecenie i przekazać dalej.');
                    } else {
                      Alert.alert('Braki w teczce', 'Otwieram elementy wymagające uzupełnienia.');
                      const firstMissing = dossierChecklist.find((row) => !row.done);
                      firstMissing?.onPress();
                    }
                  }}
                >
                  <Ionicons name={dossierReady ? 'checkmark-done-outline' : 'alert-circle-outline'} size={14} color={dossierReady ? theme.success : theme.warning} />
                  <Text style={[S.dossierActionText, { color: dossierReady ? theme.success : theme.warning }]}>
                    {dossierReady ? 'Gotowe do rozliczenia' : 'Prowadź do kompletności'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={[S.card, { backgroundColor: theme.cardBg, borderColor: theme.cardBorder }]}>
              <View style={S.cardTitleRow}>
                <PlatinumIconBadge icon="create-outline" color={theme.accent} size={11} style={{ width: 24, height: 24, borderRadius: 8 }} />
                <Text style={[S.cardTitle, { color: theme.text }]}>Podpis klienta</Text>
              </View>
              {clientSignature ? (
                <View style={[S.clientSignatureBox, { backgroundColor: theme.successBg, borderColor: theme.success }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={[S.clientSignatureTitle, { color: theme.success }]}>Podpis dodany</Text>
                    <Text style={[S.clientSignatureMeta, { color: theme.textSub }]}>
                      {clientSignature.signer_name}
                    </Text>
                    {clientSignature.signed_at ? (
                      <Text style={[S.clientSignatureMeta, { color: theme.textMuted }]}>
                        {new Date(clientSignature.signed_at).toLocaleString('pl-PL')}
                      </Text>
                    ) : null}
                    <TouchableOpacity onPress={() => { void openTaskProtocolPdf(); }} style={{ marginTop: 8 }}>
                      <Text style={{ color: theme.accent, fontWeight: '700', fontSize: 12 }}>Otwórz protokół PDF</Text>
                    </TouchableOpacity>
                  </View>
                  <TouchableOpacity
                    onPress={() => setShowClientSignatureModal(true)}
                    style={[S.clientSignatureChangeBtn, { borderColor: theme.border, backgroundColor: theme.surface2 }]}
                  >
                    <Text style={[S.clientSignatureChangeText, { color: theme.textSub }]}>Zmień</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity
                  style={[S.clientSignatureAddBtn, { borderColor: theme.border, backgroundColor: theme.surface2 }]}
                  onPress={() => setShowClientSignatureModal(true)}
                >
                  <Ionicons name="create-outline" size={18} color={theme.textMuted} />
                  <Text style={[S.clientSignatureAddText, { color: theme.textMuted }]}>Dodaj podpis klienta</Text>
                </TouchableOpacity>
              )}
            </View>

            <View style={[S.card, { backgroundColor: theme.cardBg, borderColor: theme.cardBorder }]}>
              <View style={S.cardTitleRow}>
                <PlatinumIconBadge icon="document-text-outline" color={theme.accent} size={11} style={{ width: 24, height: 24, borderRadius: 8 }} />
                <Text style={[S.cardTitle, { color: theme.text }]}>{t('order.cmrTitle')}</Text>
              </View>
              <Text style={[S.metaTxt, { color: theme.textMuted, marginBottom: 10 }]}>{t('order.cmrHint')}</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
                <TouchableOpacity
                  style={[S.addBtn, { backgroundColor: theme.surface, borderColor: theme.border, marginBottom: 0, flex: 0 }]}
                  onPress={() => { void triggerHaptic('light'); void openCmrInBrowser(`/cmr/nowy?zlecenie=${id}`); }}
                >
                  <PlatinumIconBadge icon="add-circle-outline" color={theme.accent} size={11} style={{ width: 24, height: 24, borderRadius: 8 }} />
                  <Text style={[S.addBtnTxt, { color: theme.accent }]}>{t('order.cmrNewWeb')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[S.addBtn, { backgroundColor: theme.surface, borderColor: theme.border, marginBottom: 0, flex: 0 }]}
                  onPress={() => { void triggerHaptic('light'); void openCmrInBrowser(`/cmr?task_id=${id}`); }}
                >
                  <PlatinumIconBadge icon="list-outline" color={theme.info} size={11} style={{ width: 24, height: 24, borderRadius: 8 }} />
                  <Text style={[S.addBtnTxt, { color: theme.info }]}>{t('order.cmrListForTaskWeb')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[S.addBtn, { backgroundColor: theme.surface, borderColor: theme.border, marginBottom: 0, flex: 0 }]}
                  onPress={() => { void triggerHaptic('light'); void openCmrInBrowser('/cmr'); }}
                >
                  <PlatinumIconBadge icon="albums-outline" color={theme.textSub} size={11} style={{ width: 24, height: 24, borderRadius: 8 }} />
                  <Text style={[S.addBtnTxt, { color: theme.textSub }]}>{t('order.cmrFullRegistryWeb')}</Text>
                </TouchableOpacity>
              </View>
              {cmrLista.length === 0 ? (
                <Text style={[S.metaTxt, { color: theme.textMuted }]}>{t('order.cmrEmpty')}</Text>
              ) : (
                cmrLista.map((c: any) => (
                  <TouchableOpacity
                    key={c.id}
                    style={{ paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border }}
                    onPress={() => { void triggerHaptic('light'); void openCmrInBrowser(`/cmr/${c.id}?task_id=${id}`); }}
                  >
                    <Text style={{ color: theme.accent, fontWeight: '600' }}>{c.numer || `CMR #${c.id}`}</Text>
                    {c.status ? <Text style={[S.metaTxt, { color: theme.textMuted }]}>{c.status}</Text> : null}
                  </TouchableOpacity>
                ))
              )}
            </View>

            {(zlecenie.ekipa_nazwa || zlecenie.brygadzista_nazwa) && (
              <View style={[S.card, { backgroundColor: theme.cardBg, borderColor: theme.cardBorder }]}>
                <View style={S.cardTitleRow}>
                  <PlatinumIconBadge icon="people-outline" color={theme.accent} size={11} style={{ width: 24, height: 24, borderRadius: 8 }} />
                  <Text style={[S.cardTitle, { color: theme.text }]}>Ekipa</Text>
                </View>
                {zlecenie.oddzial_nazwa && <InfoRow theme={theme} label="Oddział" val={zlecenie.oddzial_nazwa} />}
                {zlecenie.ekipa_nazwa && <InfoRow theme={theme} label="Ekipa" val={zlecenie.ekipa_nazwa} />}
                {zlecenie.brygadzista_nazwa && <InfoRow theme={theme} label="Brygadzista" val={zlecenie.brygadzista_nazwa} />}
                {pomocnicy.map((p: any) => (
                  <View key={p.id} style={S.metaRow}>
                    <PlatinumIconBadge icon="person-outline" color={theme.textMuted} size={10} style={{ width: 22, height: 22, borderRadius: 7 }} />
                    <Text style={[S.metaTxt, { color: theme.textMuted }]}> {p.imie} {p.nazwisko}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        )}

        {/* TAB: LOGI CZASU */}
        {activeTab === 'logi' && (
          <View>
            {/* Podsumowanie */}
            {logi.length > 0 && (
              <View style={[S.summaryCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
                <View style={S.summaryItem}>
                  <PlatinumIconBadge icon="time" color={theme.accent} size={12} style={{ width: 24, height: 24, borderRadius: 8 }} />
                  <Text style={[S.summaryNum, { color: theme.accent }]}>{totalGodziny.toFixed(1)}</Text>
                  <Text style={[S.summaryLbl, { color: theme.textMuted }]}>godzin łącznie</Text>
                </View>
                <View style={[S.summaryDiv, { backgroundColor: theme.border }]} />
                <View style={S.summaryItem}>
                  <PlatinumIconBadge icon="list-outline" color={theme.info} size={12} style={{ width: 24, height: 24, borderRadius: 8 }} />
                  <Text style={[S.summaryNum, { color: theme.info }]}>{logi.length}</Text>
                  <Text style={[S.summaryLbl, { color: theme.textMuted }]}>wpisów</Text>
                </View>
              </View>
            )}
            {logi.length === 0
              ? (
                <View style={S.empty}>
                  <PlatinumIconBadge icon="time-outline" color={theme.textMuted} size={18} style={{ width: 44, height: 44, borderRadius: 12 }} />
                  <Text style={[S.emptyTxt, { color: theme.textMuted }]}>Brak logów pracy</Text>
                </View>
              )
              : logi.map((log: any) => (
                <View key={log.id} style={[S.logCard, { backgroundColor: theme.cardBg, borderColor: theme.cardBorder }]}>
                  <View style={S.logTop}>
                    <View style={S.metaRow}>
                      <PlatinumIconBadge icon="person-outline" color={theme.accent} size={10} style={{ width: 22, height: 22, borderRadius: 7 }} />
                      <Text style={[S.logPrac, { color: theme.text }]}> {log.pracownik || 'Nieznany'}</Text>
                    </View>
                    {log.duration_hours && (
                      <View style={[S.durBadge, { backgroundColor: theme.successBg }]}>
                        <Text style={[S.durTxt, { color: theme.success }]}>
                          {parseFloat(log.duration_hours).toFixed(2)} godz.
                        </Text>
                      </View>
                    )}
                  </View>
                  <View style={S.metaRow}>
                    <PlatinumIconBadge icon="calendar-outline" color={theme.textMuted} size={10} style={{ width: 22, height: 22, borderRadius: 7 }} />
                    <Text style={[S.logTime, { color: theme.textSub }]}>
                      {' '}{new Date(log.start_time).toLocaleString('pl-PL')}
                    </Text>
                  </View>
                  {log.end_time && (
                    <View style={S.metaRow}>
                      <PlatinumIconBadge icon="flag-outline" color={theme.textMuted} size={10} style={{ width: 22, height: 22, borderRadius: 7 }} />
                      <Text style={[S.logTime, { color: theme.textSub }]}>
                        {' '}{new Date(log.end_time).toLocaleString('pl-PL')}
                      </Text>
                    </View>
                  )}
                  {!log.end_time && (
                    <View style={S.metaRow}>
                      <PlatinumIconBadge icon="ellipse" color={theme.warning} size={6} style={{ width: 16, height: 16, borderRadius: 5 }} />
                      <Text style={[S.logTime, { color: theme.warning }]}> W trakcie...</Text>
                    </View>
                  )}
                  {(() => {
                    const safetyRows = parseSafetyLogRows(log.bhp_checklista);
                    const legacyConfirmed = log.bhp_potwierdzone === true || log.bhp_potwierdzone === 'true';
                    if (!safetyRows.length && !legacyConfirmed) return null;
                    const confirmedCount = safetyRows.filter((row) => row.done).length;
                    return (
                      <View style={[S.logSafetyBox, { backgroundColor: theme.successBg, borderColor: theme.success + '55' }]}>
                        <View style={S.logSafetyHead}>
                          <View style={S.metaRow}>
                            <Ionicons name="shield-checkmark-outline" size={16} color={theme.success} />
                            <Text style={[S.logSafetyTitle, { color: theme.text }]}>Protokol BHP startu</Text>
                          </View>
                          <Text style={[S.logSafetyCount, { color: theme.success }]}>
                            {safetyRows.length ? `${confirmedCount}/${safetyRows.length}` : 'OK'}
                          </Text>
                        </View>
                        {safetyRows.length > 0 ? (
                          <View style={S.logSafetyList}>
                            {safetyRows.map((row) => (
                              <View key={`${log.id}-${row.key}`} style={S.logSafetyRow}>
                                <Ionicons name={row.done ? 'checkmark-circle' : 'alert-circle-outline'} size={15} color={row.done ? theme.success : theme.warning} />
                                <View style={S.logSafetyTextBox}>
                                  <Text style={[S.logSafetyLabel, { color: theme.text }]}>{row.label}</Text>
                                  {row.hint ? <Text style={[S.logSafetyHint, { color: theme.textMuted }]}>{row.hint}</Text> : null}
                                </View>
                              </View>
                            ))}
                          </View>
                        ) : (
                          <Text style={[S.logSafetyHint, { color: theme.textMuted }]}>Stary zapis: BHP potwierdzone przy starcie pracy.</Text>
                        )}
                      </View>
                    );
                  })()}
                </View>
              ))
            }
          </View>
        )}

        {/* TAB: PROBLEMY */}
        {activeTab === 'problemy' && (
          <View>
            <TouchableOpacity
              style={[S.addBtn, { backgroundColor: theme.surface, borderColor: theme.border }]}
              onPress={() => {
                void triggerHaptic('light');
                setProblemModal(true);
              }}
            >
              <PlatinumIconBadge icon="add-circle-outline" color={theme.accent} size={11} style={{ width: 24, height: 24, borderRadius: 8 }} />
              <Text style={[S.addBtnTxt, { color: theme.accent }]}>Zgłoś problem</Text>
            </TouchableOpacity>
            {problemy.length === 0
              ? (
                <View style={S.empty}>
                  <PlatinumIconBadge icon="checkmark-circle-outline" color={theme.success} size={18} style={{ width: 44, height: 44, borderRadius: 12 }} />
                  <Text style={[S.emptyTxt, { color: theme.textMuted }]}>Brak problemów</Text>
                </View>
              )
              : problemy.map((p: any) => (
                <View key={p.id} style={[S.problemCard, { backgroundColor: theme.cardBg, borderColor: theme.cardBorder, borderLeftColor: p.status === 'Rozwiązany' ? theme.success : theme.danger }]}>
                  <View style={S.problemTop}>
                    <Text style={[S.problemTyp, { color: theme.textSub }]}>{p.typ}</Text>
                    <View style={[S.problemBadge, { backgroundColor: (p.status === 'Rozwiązany' ? theme.success : theme.danger) + '28' }]}>
                      <Text style={[S.problemBadgeTxt, { color: p.status === 'Rozwiązany' ? theme.success : theme.danger }]}>
                        {p.status}
                      </Text>
                    </View>
                  </View>
                  <Text style={[S.problemOpis, { color: theme.textSub }]}>{p.opis}</Text>
                  <Text style={[S.problemMeta, { color: theme.textMuted }]}>
                    {p.zglaszajacy} • {new Date(p.created_at).toLocaleDateString('pl-PL')}
                  </Text>
                </View>
              ))
            }
          </View>
        )}

        {/* TAB: ZDJĘCIA */}
        {activeTab === 'zdjecia' && (
          <View>
            <View style={[S.evidenceCommandCard, { backgroundColor: theme.cardBg, borderColor: evidenceReadyCount >= evidenceTotalRequired ? theme.success : theme.warning }]}>
              <View style={S.evidenceCommandHead}>
                <View style={[S.evidenceCommandIcon, { backgroundColor: evidenceReadyCount >= evidenceTotalRequired ? theme.successBg : theme.warningBg, borderColor: evidenceReadyCount >= evidenceTotalRequired ? theme.success : theme.warning }]}>
                  <Ionicons name={evidenceReadyCount >= evidenceTotalRequired ? 'checkmark-done-outline' : 'images-outline'} size={21} color={evidenceReadyCount >= evidenceTotalRequired ? theme.success : theme.warning} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[S.evidenceCommandTitle, { color: theme.text }]}>Pakiet dowodów z terenu</Text>
                  <Text style={[S.evidenceCommandSub, { color: theme.textMuted }]}>
                    Zdjęcia z wyceny, szkic, dojazd, stan przed i po pracy w jednym miejscu.
                  </Text>
                </View>
                <View style={[S.evidenceScore, { backgroundColor: theme.surface2, borderColor: evidenceReadyCount >= evidenceTotalRequired ? theme.success : theme.warning }]}>
                  <Text style={[S.evidenceScoreValue, { color: evidenceReadyCount >= evidenceTotalRequired ? theme.success : theme.warning }]}>
                    {evidenceReadyCount}/{evidenceTotalRequired}
                  </Text>
                  <Text style={[S.evidenceScoreLabel, { color: theme.textMuted }]}>ważne</Text>
                </View>
              </View>

              <View style={S.evidenceQuickGrid}>
                {evidenceQuickCards.map((card) => {
                  const meta = photoTypeMeta[card.type];
                  const missing = card.required && card.count === 0;
                  return (
                    <TouchableOpacity
                      key={card.type}
                      style={[
                        S.evidenceQuickCard,
                        {
                          backgroundColor: missing ? theme.warningBg : theme.surface2,
                          borderColor: missing ? theme.warning : card.count > 0 ? theme.success : theme.border,
                        },
                      ]}
                      onPress={() => {
                        void triggerHaptic('light');
                        if (card.draw) void zrobZdjecieZRysunkiem();
                        else void zrobZdjecie(card.type, card.hint, card.tags);
                      }}
                      disabled={uploadingPhoto}
                    >
                      <View style={[S.evidenceQuickIcon, { backgroundColor: meta.color + '22', borderColor: meta.color }]}>
                        <Ionicons name={card.count > 0 ? 'checkmark-circle' : meta.icon} size={17} color={card.count > 0 ? theme.success : meta.color} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <View style={S.evidenceQuickTitleRow}>
                          <Text style={[S.evidenceQuickTitle, { color: missing ? theme.warning : theme.text }]}>{card.label}</Text>
                          <Text style={[S.evidenceQuickCount, { color: card.count > 0 ? theme.success : theme.textMuted }]}>{card.count}</Text>
                        </View>
                        <Text style={[S.evidenceQuickHint, { color: theme.textMuted }]} numberOfLines={2}>{card.hint}</Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <View style={S.evidenceActionRow}>
                <TouchableOpacity
                  style={[S.evidenceActionBtn, { backgroundColor: theme.accent, borderColor: theme.accentDark }]}
                  onPress={() => {
                    void triggerHaptic('light');
                    setZdjecieModal(true);
                  }}
                >
                  <Ionicons name="camera-outline" size={16} color={theme.accentText} />
                  <Text style={[S.evidenceActionText, { color: theme.accentText }]}>{t('order.takePhotoGps')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[S.evidenceActionBtn, { backgroundColor: theme.accentLight, borderColor: theme.accent }]}
                  onPress={() => void zrobZdjecieZRysunkiem()}
                >
                  <Ionicons name="create-outline" size={16} color={theme.accent} />
                  <Text style={[S.evidenceActionText, { color: theme.accent }]}>Rysuj szkic</Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={[S.evidenceHandoffCard, { backgroundColor: theme.cardBg, borderColor: evidencePercent >= 100 ? theme.success : theme.warning }]}>
              <View style={S.evidenceHandoffHead}>
                <View style={[S.evidenceHandoffIcon, { backgroundColor: evidencePercent >= 100 ? theme.successBg : theme.warningBg, borderColor: evidencePercent >= 100 ? theme.success : theme.warning }]}>
                  <Ionicons name={evidencePercent >= 100 ? 'shield-checkmark-outline' : 'alert-circle-outline'} size={19} color={evidencePercent >= 100 ? theme.success : theme.warning} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[S.evidenceHandoffTitle, { color: theme.text }]}>
                    {evidencePercent >= 100 ? 'Gotowe dla ekipy' : 'Do domkniecia przed przekazaniem'}
                  </Text>
                  <Text style={[S.evidenceHandoffSub, { color: theme.textMuted }]}>
                    {evidencePercent >= 100
                      ? 'Ekipa widzi zakres, zdjęcia i dojazd bez szukania w rozmowach.'
                      : `Następny brak: ${evidenceNextCard?.label || 'sprawdź pakiet'}.`}
                  </Text>
                </View>
                <View style={[S.evidencePercentBadge, { backgroundColor: theme.surface2, borderColor: evidencePercent >= 100 ? theme.success : theme.warning }]}>
                  <Text style={[S.evidencePercentText, { color: evidencePercent >= 100 ? theme.success : theme.warning }]}>{evidencePercent}%</Text>
                </View>
              </View>

              <View style={[S.evidenceProgressTrack, { backgroundColor: theme.surface2 }]}>
                <View style={[S.evidenceProgressFill, { width: `${evidencePercent}%`, backgroundColor: evidencePercent >= 100 ? theme.success : theme.warning }]} />
              </View>

              <View style={S.evidenceTimeline}>
                {evidenceTimeline.map((step, index) => (
                  <View key={step.key} style={S.evidenceTimelineStep}>
                    <View style={[S.evidenceTimelineDot, { backgroundColor: step.done ? theme.successBg : theme.surface2, borderColor: step.done ? theme.success : theme.border }]}>
                      <Ionicons name={step.done ? 'checkmark' : step.icon} size={13} color={step.done ? theme.success : theme.textMuted} />
                    </View>
                    {index < evidenceTimeline.length - 1 ? (
                      <View style={[S.evidenceTimelineLine, { backgroundColor: step.done ? theme.success + '55' : theme.border }]} />
                    ) : null}
                    <Text style={[S.evidenceTimelineLabel, { color: step.done ? theme.text : theme.textMuted }]} numberOfLines={1}>{step.label}</Text>
                    <Text style={[S.evidenceTimelineHint, { color: theme.textMuted }]} numberOfLines={1}>{step.hint}</Text>
                  </View>
                ))}
              </View>

              {evidenceNextCard ? (
                <TouchableOpacity
                  style={[S.evidenceNextBtn, { backgroundColor: theme.accentLight, borderColor: theme.accent }]}
                  onPress={() => {
                    void triggerHaptic('light');
                    if (evidenceNextCard.draw) void zrobZdjecieZRysunkiem();
                    else void zrobZdjecie(evidenceNextCard.type, evidenceNextCard.hint, evidenceNextCard.tags);
                  }}
                  disabled={uploadingPhoto}
                >
                  <Ionicons name={evidenceNextCard.draw ? 'create-outline' : 'camera-outline'} size={16} color={theme.accent} />
                  <Text style={[S.evidenceNextText, { color: theme.accent }]}>
                    Dodaj teraz: {evidenceNextCard.label}
                  </Text>
                </TouchableOpacity>
              ) : null}
            </View>

            <View style={[S.disputeShieldCard, { backgroundColor: theme.cardBg, borderColor: disputeShieldPercent >= 100 ? theme.success : theme.warning }]}>
              <View style={S.disputeShieldHead}>
                <View style={[S.disputeShieldIcon, { backgroundColor: disputeShieldPercent >= 100 ? theme.successBg : theme.warningBg, borderColor: disputeShieldPercent >= 100 ? theme.success : theme.warning }]}>
                  <Ionicons name={disputeShieldPercent >= 100 ? 'shield-checkmark-outline' : 'shield-outline'} size={20} color={disputeShieldPercent >= 100 ? theme.success : theme.warning} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[S.disputeShieldTitle, { color: theme.text }]}>Tarcza przed sporem</Text>
                  <Text style={[S.disputeShieldSub, { color: theme.textMuted }]}>
                    Dowody, które pokazują co klient zaakceptował i co ekipa wykonała.
                  </Text>
                </View>
                <View style={[S.disputeShieldScore, { backgroundColor: theme.surface2, borderColor: disputeShieldPercent >= 100 ? theme.success : theme.warning }]}>
                  <Text style={[S.disputeShieldScoreText, { color: disputeShieldPercent >= 100 ? theme.success : theme.warning }]}>{disputeShieldPercent}%</Text>
                  <Text style={[S.disputeShieldScoreLabel, { color: theme.textMuted }]}>ochrona</Text>
                </View>
              </View>
              <View style={S.disputeShieldGrid}>
                {disputeShieldCards.map((card) => {
                  const importantMissing = card.required && !card.done;
                  return (
                    <TouchableOpacity
                      key={card.key}
                      style={[
                        S.disputeShieldItem,
                        {
                          backgroundColor: importantMissing ? theme.warningBg : theme.surface2,
                          borderColor: card.done ? theme.success : importantMissing ? theme.warning : theme.border,
                        },
                      ]}
                      onPress={() => {
                        void triggerHaptic('light');
                        if (card.photoFilter) {
                          setPhotoFilter(card.photoFilter);
                          setActiveTab('zdjecia');
                        } else {
                          setActiveTab('problemy');
                        }
                      }}
                    >
                      <View style={[S.disputeShieldItemIcon, { backgroundColor: card.tone + '22', borderColor: card.tone + '66' }]}>
                        <Ionicons name={card.done ? 'checkmark-circle' : card.icon} size={15} color={card.done ? theme.success : card.tone} />
                      </View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={[S.disputeShieldItemTitle, { color: importantMissing ? theme.warning : theme.text }]} numberOfLines={1}>{card.label}</Text>
                        <Text style={[S.disputeShieldItemHint, { color: theme.textMuted }]} numberOfLines={1}>{card.hint}</Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
              {disputeShieldNext ? (
                <TouchableOpacity
                  style={[S.disputeShieldNext, { backgroundColor: theme.accentLight, borderColor: theme.accent }]}
                  onPress={() => {
                    void triggerHaptic('light');
                    if (disputeShieldNext.photoFilter) {
                      setPhotoFilter(disputeShieldNext.photoFilter);
                      setActiveTab('zdjecia');
                    } else {
                      setActiveTab('problemy');
                    }
                  }}
                >
                  <Ionicons name="alert-circle-outline" size={15} color={theme.accent} />
                  <Text style={[S.disputeShieldNextText, { color: theme.accent }]}>
                    Następny brak: {disputeShieldNext.label}
                  </Text>
                </TouchableOpacity>
              ) : null}
            </View>

            <View style={[S.photoGalleryCard, { backgroundColor: theme.cardBg, borderColor: theme.cardBorder }]}>
              <View style={S.photoGalleryHead}>
                <View style={[S.photoGalleryIcon, { backgroundColor: theme.accentLight, borderColor: theme.accent }]}>
                  <Ionicons name="albums-outline" size={20} color={theme.accent} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[S.photoGalleryTitle, { color: theme.text }]}>Galeria dowodów</Text>
                  <Text style={[S.photoGallerySub, { color: theme.textMuted }]}>
                    Filtruj zdjęcia i pokaż ekipie najważniejszy kadr.
                  </Text>
                </View>
                <View style={[S.photoGalleryScore, { backgroundColor: theme.surface2, borderColor: theme.border }]}>
                  <Text style={[S.photoGalleryScoreText, { color: theme.accent }]}>{filteredGalleryPhotos.length}</Text>
                </View>
              </View>

              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={S.photoFilterStrip}>
                {photoGalleryFilters.map((filter) => {
                  const active = photoFilter === filter.key;
                  const disabled = filter.count === 0 && filter.key !== 'all';
                  return (
                    <TouchableOpacity
                      key={filter.key}
                      style={[
                        S.photoFilterChip,
                        {
                          borderColor: active ? filter.color : theme.border,
                          backgroundColor: active ? filter.color + '18' : theme.surface2,
                          opacity: disabled ? 0.45 : 1,
                        },
                      ]}
                      onPress={() => {
                        void triggerHaptic('light');
                        setPhotoFilter(filter.key);
                        setPhotoPreview(null);
                      }}
                      disabled={disabled}
                    >
                      <Ionicons name={filter.icon} size={14} color={active ? filter.color : theme.textMuted} />
                      <Text style={[S.photoFilterText, { color: active ? filter.color : theme.textSub }]} numberOfLines={1}>
                        {filter.label}
                      </Text>
                      <Text style={[S.photoFilterCount, { color: active ? filter.color : theme.textMuted }]}>
                        {filter.count}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              {activePreviewPhoto ? (
                <TouchableOpacity
                  style={[S.photoHeroCard, { backgroundColor: theme.surface2, borderColor: theme.border }]}
                  onPress={() => {
                    void triggerHaptic('light');
                    setPhotoPreview(activePreviewPhoto);
                  }}
                >
                  <Image source={{ uri: absolutePhotoUrl(activePreviewPhoto.url || activePreviewPhoto.sciezka) }} style={S.photoHeroImage} />
                  <View style={S.photoHeroOverlay}>
                    <View style={[S.photoHeroTypeBadge, { backgroundColor: theme.cardBg + 'EE' }]}>
                      <Ionicons
                        name={photoTypeMeta[String(activePreviewPhoto.typ || 'inne') as PhotoTypeKey]?.icon || 'image-outline'}
                        size={14}
                        color={theme.accent}
                      />
                      <Text style={[S.photoHeroTypeText, { color: theme.text }]} numberOfLines={1}>
                        {PHOTO_TYPE_LABELS[String(activePreviewPhoto.typ || 'inne') as PhotoTypeKey] || 'Zdjęcie'}
                      </Text>
                    </View>
                    <Text style={S.photoHeroOpen}>Podgląd</Text>
                  </View>
                  <View style={S.photoHeroCaption}>
                    <Text style={[S.photoHeroTitle, { color: theme.text }]} numberOfLines={2}>
                      {activePreviewPhoto.opis || 'Bez opisu - kliknij, żeby pokazać większy podgląd.'}
                    </Text>
                    <Text style={[S.photoHeroMeta, { color: theme.textMuted }]} numberOfLines={1}>
                      {new Date(activePreviewPhoto.data_dodania || activePreviewPhoto.created_at || Date.now()).toLocaleString('pl-PL')}
                      {activePreviewPhoto.lokalizacja ? ` · GPS: ${activePreviewPhoto.lokalizacja}` : ''}
                    </Text>
                  </View>
                </TouchableOpacity>
              ) : (
                <View style={[S.photoGalleryEmpty, { backgroundColor: theme.surface2, borderColor: theme.border }]}>
                  <Ionicons name="images-outline" size={22} color={theme.textMuted} />
                  <Text style={[S.photoGalleryEmptyText, { color: theme.textMuted }]}>Brak zdjęć w tym filtrze.</Text>
                </View>
              )}
            </View>

            {isFieldDraft ? (
              <View style={[S.fieldPhotoChecklist, { backgroundColor: fieldDraftPhotosReady ? theme.successBg : theme.warningBg, borderColor: fieldDraftPhotosReady ? theme.success : theme.warning }]}>
                <View style={S.fieldPhotoHead}>
                  <PlatinumIconBadge
                    icon={fieldDraftPhotosReady ? 'checkmark-circle-outline' : 'alert-circle-outline'}
                    color={fieldDraftPhotosReady ? theme.success : theme.warning}
                    size={12}
                    style={{ width: 26, height: 26, borderRadius: 9 }}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={[S.fieldPhotoTitle, { color: fieldDraftPhotosReady ? theme.success : theme.warning }]}>
                      {fieldDraftPhotosReady ? 'Komplet zdjęć terenowych' : 'Brakuje zdjęć do biura'}
                    </Text>
                    <Text style={[S.fieldPhotoSub, { color: fieldDraftPhotosReady ? theme.success : theme.warning }]}>
                      Minimum: zdjęcie wyceny, szkic zakresu i dojazd/posesja.
                    </Text>
                  </View>
                </View>
                <View style={S.fieldPhotoRows}>
                  {fieldDraftPhotoChecklist.map((row) => (
                    <TouchableOpacity
                      key={row.key}
                      style={[S.fieldPhotoRow, { backgroundColor: theme.cardBg, borderColor: row.done ? theme.success : theme.warning }]}
                      onPress={() => {
                        if (row.type === 'szkic') void zrobZdjecieZRysunkiem();
                        else void zrobZdjecie(row.type, row.label, 'wycena,teren');
                      }}
                    >
                      <Ionicons name={row.done ? 'checkmark-circle' : 'camera-outline'} size={16} color={row.done ? theme.success : theme.warning} />
                      <Text style={[S.fieldPhotoRowText, { color: theme.text }]}>{row.label}</Text>
                      <Text style={[S.fieldPhotoCount, { color: row.done ? theme.success : theme.warning }]}>{row.hint}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            ) : null}

            {lokalizacja && (
              <View style={[S.gpsInfo, { backgroundColor: theme.successBg }]}>
                <PlatinumIconBadge icon="location" color={theme.success} size={10} style={{ width: 22, height: 22, borderRadius: 7 }} />
                <Text style={[S.gpsTxt, { color: theme.success }]}>
                  {' '}GPS: {lokalizacja.lat.toFixed(5)}, {lokalizacja.lng.toFixed(5)}
                </Text>
              </View>
            )}

            {/* Grupuj zdjęcia wg typu */}
            {photoGalleryGroupKeys.map((key) => {
              const typ = { key, ...photoTypeMeta[key], label: PHOTO_TYPE_LABELS[key] || t(`order.photoType.${key}`) };
              const grupa = filteredGalleryPhotos.filter((z: any) => z.typ === typ.key || (!z.typ && typ.key === 'inne'));
              if (grupa.length === 0) return null;
              return (
                <View key={typ.key}>
                  <View style={S.grupaTitleRow}>
                    <PlatinumIconBadge icon={typ.icon} color={typ.color} size={10} style={{ width: 22, height: 22, borderRadius: 7 }} />
                    <Text style={[S.grupaTitle, { color: typ.color }]}>{typ.label} ({grupa.length})</Text>
                  </View>
                  <View style={S.grid}>
                    {grupa.map((z: any) => (
                      <TouchableOpacity
                        key={z.id}
                        style={[
                          S.zdjecieCard,
                          {
                            backgroundColor: theme.cardBg,
                            borderColor: photoPreview?.id === z.id ? theme.accent : theme.cardBorder,
                          },
                        ]}
                        onPress={() => {
                          void triggerHaptic('light');
                          setPhotoPreview(z);
                        }}
                      >
                        <Image source={{ uri: absolutePhotoUrl(z.url || z.sciezka) }} style={S.zdjecieImg} />
                        {z.opis && <Text style={[S.zdjecieOpis, { color: theme.textSub }]}>{z.opis}</Text>}
                        {Array.isArray(z.tagi) && z.tagi.length > 0 ? (
                          <Text style={[S.zdjecieOpis, { color: theme.textMuted, fontSize: 11 }]} numberOfLines={2}>
                            {z.tagi.join(' · ')}
                          </Text>
                        ) : null}
                        <Text style={[S.zdjecieMeta, { color: theme.textMuted }]}>
                          {new Date(z.data_dodania || z.created_at || Date.now()).toLocaleDateString('pl-PL')}
                        </Text>
                        {z.lokalizacja && (
                          <View style={S.metaRow}>
                            <PlatinumIconBadge icon="location-outline" color={theme.textMuted} size={10} style={{ width: 22, height: 22, borderRadius: 7 }} />
                            <Text style={[S.zdjecieGps, { color: theme.textMuted }]}> {z.lokalizacja}</Text>
                          </View>
                        )}
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              );
            })}

            {zdjecia.length === 0 && (
              <View style={S.empty}>
                <PlatinumIconBadge icon="camera-outline" color={theme.textMuted} size={18} style={{ width: 44, height: 44, borderRadius: 12 }} />
                <Text style={[S.emptyTxt, { color: theme.textMuted }]}>{t('order.noPhotos')}</Text>
              </View>
            )}
          </View>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* ── MODAL: WYBÓR TYPU ZDJĘCIA ── */}
      <Modal visible={zdjecieModal} animationType="slide" transparent>
        <View style={S.overlay}>
          <View style={[S.modalBox, { backgroundColor: theme.surface }]}>
            <View style={S.modalHeader}>
              <Text style={[S.modalTitle, { color: theme.text }]}>{t('order.choosePhotoType')}</Text>
              <TouchableOpacity
                onPress={() => {
                  setPhotoOpisDraft('');
                  setPhotoTagiDraft('');
                  setZdjecieModal(false);
                }}
              >
                <PlatinumIconBadge icon="close" color={theme.textMuted} size={12} style={{ width: 26, height: 26, borderRadius: 9 }} />
              </TouchableOpacity>
            </View>
            <Text style={[S.modalLbl, { color: theme.textSub }]}>{t('order.photoOpisLabel')}</Text>
            <TextInput
              style={[S.modalInput, { borderColor: theme.border, color: theme.text, backgroundColor: theme.surface2, minHeight: 72, marginBottom: 12 }]}
              placeholder={t('order.photoOpisPlaceholder')}
              placeholderTextColor={theme.textMuted}
              value={photoOpisDraft}
              onChangeText={setPhotoOpisDraft}
              maxLength={2000}
              multiline
              editable={!uploadingPhoto}
            />
            <Text style={[S.modalLbl, { color: theme.textSub }]}>{t('order.photoTagiLabel')}</Text>
            <TextInput
              style={[S.modalInput, { borderColor: theme.border, color: theme.text, backgroundColor: theme.surface2, minHeight: 44, marginBottom: 12 }]}
              placeholder={t('order.photoTagiPlaceholder')}
              placeholderTextColor={theme.textMuted}
              value={photoTagiDraft}
              onChangeText={setPhotoTagiDraft}
              maxLength={2000}
              editable={!uploadingPhoto}
            />
            {TYP_ZDJECIA_KEYS.map((key) => {
              const typ = { key, ...photoTypeMeta[key], label: PHOTO_TYPE_LABELS[key] || t(`order.photoType.${key}`) };
              const evidence = evidenceQuickCards.find((card) => card.type === typ.key);
              const count = evidence?.count ?? zdjecia.filter((z: any) => z.typ === typ.key || (!z.typ && typ.key === 'inne')).length;
              return (
              <TouchableOpacity
                key={typ.key}
                style={[S.zdjecieTypBtn, { backgroundColor: theme.surface2, borderColor: theme.border }]}
                onPress={() => void zrobZdjecie(typ.key, photoOpisDraft, photoTagiDraft)}
                disabled={uploadingPhoto}
              >
                <View style={[S.zdjecieTypIcon, { backgroundColor: typ.color + '22' }]}>
                  <PlatinumIconBadge icon={typ.icon} color={typ.color} size={12} style={{ width: 24, height: 24, borderRadius: 8 }} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[S.zdjecieTypLabel, { color: theme.text }]}>{typ.label}</Text>
                  {evidence?.hint ? (
                    <Text style={[S.zdjecieTypHint, { color: theme.textMuted }]} numberOfLines={1}>{evidence.hint}</Text>
                  ) : null}
                </View>
                <Text style={[S.zdjecieTypCount, { color: count > 0 ? theme.success : theme.textMuted }]}>{count}</Text>
                <PlatinumIconBadge icon="chevron-forward" color={theme.textMuted} size={11} style={{ width: 24, height: 24, borderRadius: 8 }} />
              </TouchableOpacity>
            );})}
            {uploadingPhoto && (
              <View style={S.uploadingRow}>
                <ActivityIndicator color={theme.accent} />
                <Text style={[S.uploadingTxt, { color: theme.textMuted }]}>{t('order.savingPhoto')}</Text>
              </View>
            )}
          </View>
        </View>
      </Modal>

      <Modal visible={!!photoPreview} animationType="fade" transparent onRequestClose={() => setPhotoPreview(null)}>
        <View style={S.photoPreviewOverlay}>
          <TouchableOpacity style={S.photoPreviewCloseLayer} activeOpacity={1} onPress={() => setPhotoPreview(null)} />
          {photoPreview ? (
            <View style={[S.photoPreviewBox, { backgroundColor: theme.cardBg, borderColor: theme.cardBorder }]}>
              <View style={S.photoPreviewHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={[S.photoPreviewTitle, { color: theme.text }]}>Podgląd zdjęcia</Text>
                  <Text style={[S.photoPreviewSub, { color: theme.textMuted }]}>
                    {PHOTO_TYPE_LABELS[String(photoPreview.typ || 'inne') as PhotoTypeKey] || 'Zdjęcie'}
                  </Text>
                </View>
                <View style={[S.photoPreviewCounter, { backgroundColor: theme.surface2, borderColor: theme.border }]}>
                  <Text style={[S.photoPreviewCounterText, { color: theme.accent }]}>{previewCounter}</Text>
                </View>
                <TouchableOpacity onPress={() => setPhotoPreview(null)}>
                  <PlatinumIconBadge icon="close" color={theme.textMuted} size={12} style={{ width: 28, height: 28, borderRadius: 9 }} />
                </TouchableOpacity>
              </View>
              <View style={S.photoPreviewStage}>
                <Image source={{ uri: absolutePhotoUrl(photoPreview.url || photoPreview.sciezka) }} style={S.photoPreviewImage} />
                {previewPhotoList.length > 1 ? (
                  <>
                    <TouchableOpacity
                      style={[S.photoPreviewNavBtn, S.photoPreviewNavPrev]}
                      onPress={() => goToPreviewPhoto(-1)}
                    >
                      <Ionicons name="chevron-back" size={24} color="#FFFFFF" />
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[S.photoPreviewNavBtn, S.photoPreviewNavNext]}
                      onPress={() => goToPreviewPhoto(1)}
                    >
                      <Ionicons name="chevron-forward" size={24} color="#FFFFFF" />
                    </TouchableOpacity>
                  </>
                ) : null}
              </View>
              <View style={S.photoPreviewInfo}>
                {photoPreview.opis ? (
                  <Text style={[S.photoPreviewDescription, { color: theme.text }]} selectable>
                    {photoPreview.opis}
                  </Text>
                ) : null}
                {Array.isArray(photoPreview.tagi) && photoPreview.tagi.length > 0 ? (
                  <Text style={[S.photoPreviewMeta, { color: theme.textMuted }]} selectable>
                    {photoPreview.tagi.join(' · ')}
                  </Text>
                ) : null}
                <Text style={[S.photoPreviewMeta, { color: theme.textMuted }]} selectable>
                  {new Date(photoPreview.data_dodania || photoPreview.created_at || Date.now()).toLocaleString('pl-PL')}
                  {photoPreview.lokalizacja ? ` · GPS: ${photoPreview.lokalizacja}` : ''}
                </Text>
                {previewPhotoList.length > 1 ? (
                  <View style={S.photoPreviewActions}>
                    <TouchableOpacity
                      style={[S.photoPreviewActionBtn, { borderColor: theme.border, backgroundColor: theme.surface2 }]}
                      onPress={() => goToPreviewPhoto(-1)}
                    >
                      <Ionicons name="chevron-back" size={15} color={theme.textSub} />
                      <Text style={[S.photoPreviewActionText, { color: theme.textSub }]}>Poprzednie</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[S.photoPreviewActionBtn, { borderColor: theme.accent, backgroundColor: theme.accentLight }]}
                      onPress={() => goToPreviewPhoto(1)}
                    >
                      <Text style={[S.photoPreviewActionText, { color: theme.accent }]}>Następne</Text>
                      <Ionicons name="chevron-forward" size={15} color={theme.accent} />
                    </TouchableOpacity>
                  </View>
                ) : null}
              </View>
            </View>
          ) : null}
        </View>
      </Modal>

      {/* M3 F3.9 - mobilny protokol zamkniecia pracy */}
      <Modal visible={finishModal} animationType="slide" transparent onRequestClose={() => setFinishModal(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={S.overlay}>
            <View style={[S.modalBox, { backgroundColor: theme.surface }]}>
              <View style={S.modalHeader}>
                <Text style={[S.modalTitle, { color: theme.text }]}>Zamknięcie po pracy</Text>
                <TouchableOpacity onPress={() => setFinishModal(false)}>
                  <PlatinumIconBadge icon="close" color={theme.textMuted} size={12} style={{ width: 26, height: 26, borderRadius: 9 }} />
                </TouchableOpacity>
              </View>

              <ScrollView
                style={S.finishModalScroll}
                contentContainerStyle={S.finishModalContent}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
              >
                <View style={[S.finishHero, { backgroundColor: finishReady ? theme.successBg : theme.accentLight, borderColor: finishReady ? theme.success : theme.accent }]}>
                  <View style={S.finishHeroTop}>
                    <View style={[S.finishHeroIcon, { backgroundColor: theme.cardBg, borderColor: finishReady ? theme.success : theme.accent }]}>
                      <Ionicons name={finishReady ? 'checkmark-done-outline' : 'clipboard-outline'} size={22} color={finishReady ? theme.success : theme.accent} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[S.finishHeroTitle, { color: finishReady ? theme.success : theme.text }]}>Protokół odbioru dla biura</Text>
                      <Text style={[S.finishHeroSub, { color: theme.textMuted }]}>
                        Zdjęcia po, płatność, odbiór klienta, materiały i problemy w jednym szybkim zamknięciu.
                      </Text>
                    </View>
                    <View style={[S.finishHeroScore, { backgroundColor: theme.cardBg, borderColor: finishReady ? theme.success : theme.border }]}>
                      <Text style={[S.finishHeroScoreValue, { color: finishReady ? theme.success : theme.accent }]}>{finishReadyCount}/{finishChecklist.length}</Text>
                      <Text style={[S.finishHeroScoreLabel, { color: theme.textMuted }]}>gotowe</Text>
                    </View>
                  </View>
                </View>

                <View style={S.finishChecklist}>
                  {finishChecklist.map((row) => {
                    const rowStyle = [
                      S.finishChecklistRow,
                      { backgroundColor: theme.cardBg, borderColor: row.done ? theme.success : theme.warning },
                    ];
                    const content = (
                      <>
                        <Ionicons name={row.done ? 'checkmark-circle' : row.icon} size={18} color={row.done ? theme.success : theme.warning} />
                        <View style={{ flex: 1 }}>
                          <Text style={[S.finishChecklistTitle, { color: theme.text }]}>{row.label}</Text>
                          <Text style={[S.finishChecklistHint, { color: theme.textMuted }]} numberOfLines={2}>{row.hint}</Text>
                        </View>
                        {row.action ? <Ionicons name="chevron-forward" size={16} color={theme.textMuted} /> : null}
                      </>
                    );
                    return row.action ? (
                      <TouchableOpacity key={row.key} style={rowStyle} onPress={row.action}>
                        {content}
                      </TouchableOpacity>
                    ) : (
                      <View key={row.key} style={rowStyle}>
                        {content}
                      </View>
                    );
                  })}
                </View>

                <View style={S.finishQuickRow}>
                  <TouchableOpacity
                    style={[S.finishQuickBtn, { backgroundColor: theme.accent, borderColor: theme.accentDark }]}
                    onPress={() => {
                      setFinishModal(false);
                      setActiveTab('zdjecia');
                      void zrobZdjecie('po', 'Zdjęcie po zakończeniu pracy', 'po,odbior');
                    }}
                  >
                    <Ionicons name="camera-outline" size={16} color={theme.accentText} />
                    <Text style={[S.finishQuickText, { color: theme.accentText }]}>Zdjęcie po</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[S.finishQuickBtn, { backgroundColor: theme.cardBg, borderColor: theme.border }]}
                    onPress={() => {
                      setFinishModal(false);
                      setShowClientSignatureModal(true);
                    }}
                  >
                    <Ionicons name="create-outline" size={16} color={theme.info} />
                    <Text style={[S.finishQuickText, { color: theme.info }]}>Podpis</Text>
                  </TouchableOpacity>
                </View>

                <View style={[S.finishSwitchRow, { backgroundColor: theme.cardBg, borderColor: finishClientReady ? theme.success : theme.border }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={[S.finishSwitchTitle, { color: theme.text }]}>Klient odebrał pracę bez uwag</Text>
                    <Text style={[S.finishSwitchHint, { color: theme.textMuted }]}>
                      {hasClientSignature ? `Podpis zapisany: ${clientSignature?.signer_name || '-'}` : 'Zaznacz tylko wtedy, kiedy klient potwierdził odbiór.'}
                    </Text>
                  </View>
                  <Switch
                    value={finishClientAccepted || hasClientSignature}
                    disabled={hasClientSignature}
                    onValueChange={setFinishClientAccepted}
                  />
                </View>

                {unresolvedIssuesCount > 0 ? (
                  <View style={[S.finishSwitchRow, { backgroundColor: theme.cardBg, borderColor: finishIssuesReviewed ? theme.success : theme.warning }]}>
                    <View style={{ flex: 1 }}>
                      <Text style={[S.finishSwitchTitle, { color: theme.text }]}>Otwarte problemy przekazane do biura</Text>
                      <Text style={[S.finishSwitchHint, { color: theme.textMuted }]}>
                        Zostaje {unresolvedIssuesCount} otwartych tematów. Potwierdź, jeśli ekipa nie może ich zamknąć na miejscu.
                      </Text>
                    </View>
                    <Switch value={finishIssuesReviewed} onValueChange={setFinishIssuesReviewed} />
                  </View>
                ) : null}

              <Text style={[S.modalLbl, { color: theme.textSub }]}>Forma płatności</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }} contentContainerStyle={{ gap: 8 }}>
                {(['Gotowka', 'Przelew', 'Faktura_VAT', 'Brak'] as const).map((f) => (
                  <TouchableOpacity
                    key={f}
                    style={[
                      S.typBtn,
                      { backgroundColor: theme.surface2, borderColor: theme.border },
                      payForm.forma_platnosc === f && { backgroundColor: theme.accentLight, borderColor: theme.accent },
                    ]}
                    onPress={() => setPayForm((p) => ({ ...p, forma_platnosc: f }))}
                  >
                    <Text style={[S.typBtnTxt, { color: theme.textSub }, payForm.forma_platnosc === f && { color: theme.accent }]}>
                      {f.replace('_', ' ')}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
              {payForm.forma_platnosc === 'Gotowka' ? (
                <>
                  <Text style={[S.modalLbl, { color: theme.textSub }]}>Kwota odebrana (PLN)</Text>
                  <TextInput
                    style={[S.modalInput, { backgroundColor: theme.inputBg, borderColor: theme.inputBorder, color: theme.inputText }]}
                    keyboardType="decimal-pad"
                    value={payForm.kwota_odebrana}
                    onChangeText={(v) => setPayForm((p) => ({ ...p, kwota_odebrana: v }))}
                  />
                  <Text style={[S.modalLbl, { color: theme.textSub, marginTop: 10 }]}>{t('order.finishPaymentNoteLabel')}</Text>
                  <TextInput
                    style={[
                      S.modalInput,
                      {
                        backgroundColor: theme.inputBg,
                        borderColor: theme.inputBorder,
                        color: theme.inputText,
                        minHeight: 72,
                        textAlignVertical: 'top',
                      },
                    ]}
                    multiline
                    placeholder={t('order.finishPaymentNotePlaceholder')}
                    placeholderTextColor={theme.inputPlaceholder}
                    value={finishNotatki}
                    onChangeText={setFinishNotatki}
                  />
                </>
              ) : null}
              <View style={{ flexDirection: 'row', alignItems: 'center', marginVertical: 10, gap: 10 }}>
                <Text style={{ color: theme.text }}>Faktura VAT</Text>
                <Switch value={payForm.faktura_vat} onValueChange={(v) => setPayForm((p) => ({ ...p, faktura_vat: v }))} />
              </View>
              <Text style={[S.modalLbl, { color: theme.textSub }]}>NIP (jeśli faktura)</Text>
              <TextInput
                style={[S.modalInput, { backgroundColor: theme.inputBg, borderColor: theme.inputBorder, color: theme.inputText }]}
                value={payForm.nip}
                onChangeText={(v) => setPayForm((p) => ({ ...p, nip: v }))}
                autoCapitalize="characters"
              />
              <Text style={[S.modalLbl, { color: theme.textSub, marginTop: 10 }]}>{t('order.finishPaymentNoteLabel')}</Text>
              <TextInput
                style={[
                  S.modalInput,
                  {
                    backgroundColor: theme.inputBg,
                    borderColor: theme.inputBorder,
                    color: theme.inputText,
                    minHeight: 72,
                    textAlignVertical: 'top',
                  },
                ]}
                multiline
                placeholder={t('order.finishPaymentNotePlaceholder')}
                placeholderTextColor={theme.inputPlaceholder}
                value={finishNotatki}
                onChangeText={setFinishNotatki}
              />
              <Text style={[S.modalLbl, { color: theme.textSub, marginTop: 12 }]}>
                {finishRequirements.require_material_usage
                  ? t('order.finishUsageRequiredHint')
                  : t('order.finishUsageHint')}
              </Text>
              <TextInput
                style={[S.modalInput, { backgroundColor: theme.inputBg, borderColor: theme.inputBorder, color: theme.inputText }]}
                placeholder={t('order.finishUsageNazwa')}
                placeholderTextColor={theme.inputPlaceholder}
                value={finishUsageNazwa}
                onChangeText={setFinishUsageNazwa}
              />
              <Text style={[S.modalLbl, { color: theme.textSub }]}>{t('order.finishUsageIlosc')}</Text>
              <TextInput
                style={[S.modalInput, { backgroundColor: theme.inputBg, borderColor: theme.inputBorder, color: theme.inputText }]}
                placeholder="0"
                placeholderTextColor={theme.inputPlaceholder}
                keyboardType="decimal-pad"
                value={finishUsageIlosc}
                onChangeText={setFinishUsageIlosc}
              />
              </ScrollView>
              <View style={S.modalBtns}>
                <TouchableOpacity
                  style={[S.cancelBtn, { backgroundColor: theme.surface2, borderColor: theme.border }]}
                  onPress={() => setFinishModal(false)}
                >
                  <Text style={[S.cancelTxt, { color: theme.textSub }]}>Anuluj</Text>
                </TouchableOpacity>
                <PlatinumCTA
                  style={S.submitBtn}
                  label={changingStatus ? '…' : finishReady ? 'Zamknij zlecenie' : `Uzupełnij ${finishChecklist.length - finishReadyCount}`}
                  onPress={() => void submitFinish()}
                  disabled={changingStatus}
                />
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <TaskClientSignatureModal
        visible={showClientSignatureModal}
        onClose={() => setShowClientSignatureModal(false)}
        onSave={(payload) => { void saveClientSignature(payload); }}
        defaultSignerName={String(zlecenie?.klient_nazwa || '').trim()}
        theme={theme}
      />

      {/* ── MODAL: ZGŁOŚ PROBLEM ── */}
      <Modal visible={problemModal} animationType="slide" transparent>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={S.overlay}>
          <View style={[S.modalBox, { backgroundColor: theme.surface }]}>
            <View style={S.modalHeader}>
              <View style={S.metaRow}>
                <PlatinumIconBadge icon="warning" color={theme.warning} size={11} style={{ width: 24, height: 24, borderRadius: 8 }} />
                <Text style={[S.modalTitle, { color: theme.text, marginLeft: 8 }]}>Zgłoś problem</Text>
              </View>
              <TouchableOpacity onPress={() => setProblemModal(false)}>
                <PlatinumIconBadge icon="close" color={theme.textMuted} size={12} style={{ width: 26, height: 26, borderRadius: 9 }} />
              </TouchableOpacity>
            </View>
            <Text style={[S.modalLbl, { color: theme.textSub }]}>Typ:</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 14 }}
              contentContainerStyle={{ gap: 8 }}>
              {['usterka', 'bezpieczeństwo', 'sprzęt', 'klient', 'inne'].map(t => (
                <TouchableOpacity key={t}
                  style={[
                    S.typBtn,
                    { backgroundColor: theme.surface2, borderColor: theme.border },
                    problemForm.typ === t && { backgroundColor: theme.accentLight, borderColor: theme.accent }
                  ]}
                  onPress={() => setProblemForm(f => ({ ...f, typ: t }))}>
                  <Text style={[S.typBtnTxt, { color: theme.textSub }, problemForm.typ === t && { color: theme.accent }]}>
                    {t}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <Text style={[S.modalLbl, { color: theme.textSub }]}>Opis:</Text>
            <TextInput
              style={[S.modalInput, { backgroundColor: theme.inputBg, borderColor: theme.inputBorder, color: theme.inputText }]}
              placeholder="Opisz problem..."
              placeholderTextColor={theme.inputPlaceholder}
              value={problemForm.opis}
              onChangeText={t => setProblemForm(f => ({ ...f, opis: t }))}
              multiline
              numberOfLines={4}
            />
            <View style={S.modalBtns}>
              <TouchableOpacity
                style={[S.cancelBtn, { backgroundColor: theme.surface2, borderColor: theme.border }]}
                onPress={() => setProblemModal(false)}
              >
                <Text style={[S.cancelTxt, { color: theme.textSub }]}>Anuluj</Text>
              </TouchableOpacity>
                <PlatinumCTA
                  style={S.submitBtn}
                  label="Zgłoś"
                  onPress={zglosProblem}
                />
            </View>
          </View>
        </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
    </KeyboardSafeScreen>
  );
}

function TaskClientSignatureModal({
  visible,
  onClose,
  onSave,
  defaultSignerName,
  theme,
}: {
  visible: boolean;
  onClose: () => void;
  onSave: (payload: { signer_name: string; signature_data_url: string; note?: string }) => void;
  defaultSignerName?: string;
  theme: Theme;
}) {
  const [signerName, setSignerName] = useState('');
  const [note, setNote] = useState('');
  const [strokes, setStrokes] = useState<string[]>([]);
  const [currentPath, setCurrentPath] = useState('');
  const [capturing, setCapturing] = useState(false);
  const currentPathRef = useRef('');
  const signatureShotRef = useRef<any>(null);
  const signed = strokes.length > 0 || currentPath.length > 0;

  useEffect(() => {
    if (!visible) return;
    setSignerName(defaultSignerName || '');
    setNote('');
    setStrokes([]);
    setCurrentPath('');
    currentPathRef.current = '';
  }, [visible, defaultSignerName]);

  const beginStroke = useCallback((x: number, y: number) => {
    const first = `M ${x.toFixed(1)} ${y.toFixed(1)}`;
    currentPathRef.current = first;
    setCurrentPath(first);
  }, []);

  const appendStroke = useCallback((x: number, y: number) => {
    if (!currentPathRef.current) {
      beginStroke(x, y);
      return;
    }
    currentPathRef.current = `${currentPathRef.current} L ${x.toFixed(1)} ${y.toFixed(1)}`;
    setCurrentPath(currentPathRef.current);
  }, [beginStroke]);

  const commitStroke = useCallback(() => {
    const finalPath = currentPathRef.current;
    if (!finalPath) return;
    setStrokes((prev) => [...prev, finalPath]);
    currentPathRef.current = '';
    setCurrentPath('');
  }, []);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (evt) => {
          const { locationX, locationY } = evt.nativeEvent;
          beginStroke(locationX, locationY);
        },
        onPanResponderMove: (evt) => {
          const { locationX, locationY } = evt.nativeEvent;
          appendStroke(locationX, locationY);
        },
        onPanResponderRelease: () => commitStroke(),
        onPanResponderTerminate: () => commitStroke(),
      }),
    [appendStroke, beginStroke, commitStroke],
  );

  const handleSave = async () => {
    const cleanName = signerName.trim();
    if (cleanName.length < 2) {
      Alert.alert('Uwaga', 'Podaj imię i nazwisko klienta.');
      return;
    }
    if (capturing) return;

    const mergedStrokes = currentPathRef.current ? [...strokes, currentPathRef.current] : strokes;
    if (mergedStrokes.length <= 0) {
      Alert.alert('Brak podpisu', 'Potwierdź podpis w polu podpisu.');
      return;
    }
    if (currentPathRef.current) {
      setStrokes(mergedStrokes);
      currentPathRef.current = '';
      setCurrentPath('');
    }

    setCapturing(true);
    let dataUrl = '';
    try {
      await new Promise((resolve) => setTimeout(resolve, 40));
      const base64 = await signatureShotRef.current?.capture?.();
      if (!base64 || typeof base64 !== 'string') {
        throw new Error('Pusty podpis');
      }
      dataUrl = `data:image/png;base64,${base64}`;
    } catch {
      setCapturing(false);
      Alert.alert('Błąd podpisu', 'Nie udało się zapisać podpisu. Spróbuj ponownie.');
      return;
    }

    const safeNote = note.trim().replace(/[<>&"]/g, ' ').slice(0, 1000);
    onSave({
      signer_name: cleanName,
      signature_data_url: dataUrl,
      ...(safeNote ? { note: safeNote } : {}),
    });
    setCapturing(false);
  };

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={{ flex: 1, backgroundColor: 'rgba(5,8,15,0.9)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: theme.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 20, paddingBottom: 44 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <Text style={{ color: theme.text, fontSize: 18, fontWeight: '700' }}>Podpis klienta</Text>
              <TouchableOpacity onPress={onClose}>
                <PlatinumIconBadge icon="close" color={theme.textMuted} size={12} style={{ width: 26, height: 26, borderRadius: 9 }} />
              </TouchableOpacity>
            </View>

            <Text style={{ color: theme.textSub, fontSize: 13, fontWeight: '600', marginBottom: 6 }}>Imię i nazwisko klienta</Text>
            <TextInput
              style={{ borderWidth: 1, borderRadius: 10, borderColor: theme.inputBorder, backgroundColor: theme.inputBg, color: theme.inputText, padding: 12, marginBottom: 10 }}
              placeholder="np. Jan Kowalski"
              placeholderTextColor={theme.inputPlaceholder}
              value={signerName}
              onChangeText={setSignerName}
            />

            <Text style={{ color: theme.textSub, fontSize: 13, fontWeight: '600', marginBottom: 6 }}>Pole podpisu</Text>
            <View
              style={{
                height: 130,
                borderRadius: 12,
                borderWidth: 2,
                borderColor: signed ? theme.success : theme.border,
                backgroundColor: theme.surface2,
                marginBottom: 10,
                overflow: 'hidden',
              }}
            >
              <ViewShot
                ref={signatureShotRef}
                options={{ format: 'png', quality: 1, result: 'base64' }}
                style={{ flex: 1, backgroundColor: '#ffffff' }}
              >
                <View
                  style={{ flex: 1 }}
                  {...panResponder.panHandlers}
                >
                  <Svg width="100%" height="100%">
                    {strokes.map((stroke, idx) => (
                      <SvgPath
                        key={`${idx}-${stroke.length}`}
                        d={stroke}
                        stroke="#111111"
                        strokeWidth={2.4}
                        fill="none"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    ))}
                    {currentPath ? (
                      <SvgPath
                        d={currentPath}
                        stroke="#111111"
                        strokeWidth={2.4}
                        fill="none"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    ) : null}
                  </Svg>
                  {!signed ? (
                    <View style={{ pointerEvents: 'none', position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'center', alignItems: 'center' }}>
                      <Text style={{ color: '#6b7280' }}>Podpisz palcem lub rysikiem →</Text>
                    </View>
                  ) : null}
                </View>
              </ViewShot>
            </View>

            <Text style={{ color: theme.textSub, fontSize: 13, fontWeight: '600', marginBottom: 6 }}>Uwagi (opcjonalnie)</Text>
            <TextInput
              style={{
                borderWidth: 1,
                borderRadius: 10,
                borderColor: theme.inputBorder,
                backgroundColor: theme.inputBg,
                color: theme.inputText,
                padding: 12,
                minHeight: 70,
                textAlignVertical: 'top',
                marginBottom: 14,
              }}
              multiline
              value={note}
              onChangeText={setNote}
              placeholder="Np. odbiór bez uwag"
              placeholderTextColor={theme.inputPlaceholder}
            />

            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity
                style={{ flex: 1, borderRadius: 10, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surface2, padding: 12, alignItems: 'center' }}
                onPress={() => {
                  currentPathRef.current = '';
                  setCurrentPath('');
                  setStrokes([]);
                }}
                disabled={capturing}
              >
                <Text style={{ color: theme.textSub, fontWeight: '600' }}>Wyczyść</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{ flex: 1, borderRadius: 10, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surface2, padding: 12, alignItems: 'center' }}
                onPress={onClose}
                disabled={capturing}
              >
                <Text style={{ color: theme.textSub, fontWeight: '600' }}>Anuluj</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{ flex: 1, borderRadius: 10, borderWidth: 1, borderColor: theme.accentDark, backgroundColor: theme.accent, padding: 12, alignItems: 'center' }}
                onPress={() => { void handleSave(); }}
                disabled={capturing}
              >
                {capturing ? (
                  <ActivityIndicator color={theme.accentText} size="small" />
                ) : (
                  <Text style={{ color: theme.accentText, fontWeight: '700' }}>Zapisz</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function InfoRow({ label, val, theme }: { label: string; val: string; theme: Theme }) {
  if (!val) return null;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
      <Text style={{ fontSize: 13, color: theme.textMuted, width: 100 }}>{label}:</Text>
      <Text style={{ fontSize: 13, color: theme.text, flex: 1 }}>{val}</Text>
    </View>
  );
}

const makeStyles = (t: Theme) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: t.bg, gap: 12 },
  notFoundTxt: { fontSize: 15, color: t.textMuted },
  backLink: { marginTop: 4 },
  backLinkTxt: { fontSize: 15, fontWeight: '600' },

  // Header
  header: {
    backgroundColor: t.headerBg, paddingHorizontal: 14,
    paddingTop: 56, paddingBottom: 16,
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: t.border,
    ...shadowStyle(t, {
      opacity: t.shadowOpacity * 0.08,
      radius: t.shadowRadius * 0.24,
      offsetY: 1,
      elevation: Math.max(1, t.cardElevation - 1),
    }),
  },
  backBtn: {
    width: 48,
    height: 48,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: t.cardBorder,
    backgroundColor: t.surface2,
  },
  headerCenter: { flex: 1 },
  headerTitle: { color: t.headerText, fontSize: 18, fontWeight: '800' },
  statusBadgeH: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10, borderWidth: 1 },
  statusTextH: { fontSize: 11, fontWeight: '700' },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 14,
    marginTop: 10,
    marginBottom: 2,
    paddingHorizontal: 14,
    paddingVertical: 11,
    backgroundColor: t.surface2,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: t.cardBorder,
    borderBottomWidth: 1,
    borderBottomColor: t.cardBorder,
  },
  linkRowTxt: { flex: 1, fontSize: 14, fontWeight: '700' },
  taskHero: {
    marginHorizontal: 14,
    marginTop: 12,
    marginBottom: 10,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: t.cardBorder,
    backgroundColor: t.cardBg,
    padding: 14,
    gap: 12,
    ...shadowStyle(t, {
      opacity: t.shadowOpacity * 0.18,
      radius: t.shadowRadius * 0.52,
      offsetY: 3,
      elevation: t.cardElevation + 1,
    }),
  },
  taskHeroTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  taskHeroIcon: {
    width: 46,
    height: 46,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: t.accent,
    backgroundColor: t.accentLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  taskHeroEyebrow: {
    color: t.textMuted,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0,
    textTransform: 'uppercase',
  },
  taskHeroTitle: {
    color: t.text,
    fontSize: 20,
    lineHeight: 24,
    fontWeight: '900',
    marginTop: 3,
  },
  taskHeroSub: {
    color: t.textSub,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    marginTop: 4,
  },
  taskHeroStatus: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 9,
    paddingVertical: 6,
    maxWidth: 118,
  },
  taskHeroStatusText: {
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '900',
    textAlign: 'center',
  },
  taskHeroStats: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  taskHeroStat: {
    flexGrow: 1,
    flexBasis: '22%',
    minWidth: 72,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: t.border,
    backgroundColor: t.surface2,
    paddingHorizontal: 9,
    paddingVertical: 10,
    alignItems: 'center',
    gap: 3,
  },
  taskHeroStatDone: {
    borderColor: t.success,
    backgroundColor: t.successBg,
  },
  taskHeroStatValue: {
    color: t.text,
    fontSize: 15,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  taskHeroStatLabel: {
    color: t.textMuted,
    fontSize: 10,
    fontWeight: '800',
    textAlign: 'center',
  },
  taskHeroProof: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 11,
    gap: 10,
  },
  taskHeroProofHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  taskHeroProofIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  taskHeroProofTitle: { fontSize: 13.5, fontWeight: '900' },
  taskHeroProofSub: {
    color: t.textSub,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '700',
    marginTop: 2,
  },
  taskHeroProofScore: {
    minWidth: 58,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 6,
    alignItems: 'center',
  },
  taskHeroProofScoreValue: {
    fontSize: 15,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  taskHeroProofScoreLabel: {
    color: t.textMuted,
    fontSize: 8.5,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  taskHeroProofChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
  },
  taskHeroProofChip: {
    flexGrow: 1,
    flexBasis: '47%',
    minHeight: 34,
    borderWidth: 1,
    borderRadius: 11,
    paddingHorizontal: 9,
    paddingVertical: 7,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  taskHeroProofChipText: {
    flex: 1,
    fontSize: 11,
    fontWeight: '900',
  },
  taskHeroProofNext: {
    minHeight: 38,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  taskHeroProofNextText: {
    flexShrink: 1,
    fontSize: 12,
    fontWeight: '900',
  },
  taskHeroNext: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: t.accent,
    backgroundColor: t.accentLight,
    padding: 11,
  },
  taskHeroNextLabel: {
    color: t.accentDark,
    fontSize: 10,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  taskHeroNextTitle: {
    color: t.text,
    fontSize: 14,
    fontWeight: '900',
    marginTop: 2,
  },
  taskHeroNextDetail: {
    color: t.textSub,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '700',
    marginTop: 2,
  },
  taskHeroCta: {
    minHeight: 38,
    borderRadius: 12,
    backgroundColor: t.accent,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    maxWidth: 132,
  },
  taskHeroCtaDisabled: {
    opacity: 0.55,
  },
  taskHeroCtaText: {
    color: t.accentText,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '900',
    textAlign: 'center',
  },
  taskHeroActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    alignItems: 'center',
  },
  taskHeroAction: {
    minHeight: 38,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: t.border,
    backgroundColor: t.surface2,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  taskHeroActionText: {
    color: t.text,
    fontSize: 12,
    fontWeight: '900',
  },
  taskHeroValuePill: {
    minHeight: 38,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: t.border,
    backgroundColor: t.cardBg,
    paddingHorizontal: 10,
    paddingVertical: 7,
    justifyContent: 'center',
    marginLeft: 'auto',
  },
  taskHeroValueLabel: {
    color: t.textMuted,
    fontSize: 9,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  taskHeroValue: {
    color: t.text,
    fontSize: 12,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  workflowCard: {
    marginHorizontal: 14,
    marginTop: 10,
    marginBottom: 10,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: t.cardBorder,
    backgroundColor: t.surface2 + 'EE',
    padding: 12,
    gap: 10,
    ...shadowStyle(t, {
      opacity: t.shadowOpacity * 0.12,
      radius: t.shadowRadius * 0.42,
      offsetY: 1,
      elevation: t.cardElevation + 1,
    }),
  },
  workflowHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  workflowIconWrap: {
    width: 30,
    height: 30,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.infoBg,
  },
  workflowTitle: { color: t.text, fontSize: 13, fontWeight: '800' },
  workflowDetail: { color: t.textMuted, fontSize: 12, marginTop: 2 },
  workflowCountBadge: {
    minWidth: 48,
    minHeight: 38,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  workflowCountValue: { fontSize: 15, fontWeight: '900', fontVariant: ['tabular-nums'] },
  workflowCountLabel: { color: t.textMuted, fontSize: 9, fontWeight: '800', textTransform: 'uppercase' },
  workflowMissingWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
  },
  workflowMissingChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 9,
    paddingVertical: 7,
    maxWidth: '100%',
  },
  workflowMissingText: { fontSize: 11.5, fontWeight: '800' },
  workflowFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  workflowNextText: { flex: 1, fontSize: 12, lineHeight: 16, fontWeight: '800' },
  workflowBtn: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: t.accentDark,
    backgroundColor: t.accent,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  workflowBtnText: { color: t.accentText, fontSize: 12, fontWeight: '800' },
  officeHandoffCard: {
    marginHorizontal: 14,
    marginBottom: 10,
    borderRadius: 16,
    borderWidth: 1,
    padding: 12,
    gap: 10,
  },
  officeHandoffHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  officeHandoffIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  officeHandoffTitle: { fontSize: 14, fontWeight: '900' },
  officeHandoffSub: { fontSize: 12, lineHeight: 17, marginTop: 2 },
  officeHandoffPhotosBtn: {
    minWidth: 48,
    minHeight: 38,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: 8,
  },
  officeHandoffPhotosText: { fontSize: 12, fontWeight: '900', fontVariant: ['tabular-nums'] },
  officeHandoffLines: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: t.border,
    backgroundColor: t.cardBg,
    padding: 10,
    gap: 5,
  },
  officeHandoffLine: { fontSize: 12, lineHeight: 17, fontWeight: '700' },
  fieldPackageCard: {
    marginHorizontal: 14,
    marginBottom: 10,
    borderRadius: 16,
    borderWidth: 1,
    padding: 12,
    gap: 10,
  },
  fieldPackageHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  fieldPackageIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fieldPackageTitle: { fontSize: 15, fontWeight: '900' },
  fieldPackageSub: { fontSize: 12, lineHeight: 17, marginTop: 2 },
  fieldPackageChecks: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  fieldPackageCheck: {
    flexGrow: 1,
    flexBasis: '31%',
    minHeight: 62,
    borderRadius: 12,
    borderWidth: 1,
    padding: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  fieldPackageCheckLabel: { fontSize: 11.5, fontWeight: '900' },
  fieldPackageCheckHint: { fontSize: 10.5, marginTop: 2, fontWeight: '700' },
  fieldPackageLabel: { fontSize: 12, fontWeight: '900', marginTop: 2 },
  fieldPackageChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
  },
  fieldPackageChip: {
    minHeight: 34,
    borderRadius: 11,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 7,
    justifyContent: 'center',
  },
  fieldPackageChipText: {
    fontSize: 11.5,
    fontWeight: '900',
  },
  fieldPackageInput: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 11,
    paddingVertical: 9,
    fontSize: 13,
    fontWeight: '700',
  },
  fieldPackageTextarea: { minHeight: 92, textAlignVertical: 'top', lineHeight: 18 },
  fieldPackageTextareaSmall: { minHeight: 70, textAlignVertical: 'top', lineHeight: 18 },
  fieldPackageTwoCol: { flexDirection: 'row', gap: 10 },
  fieldPackageSettlementText: { fontSize: 11, lineHeight: 15, fontWeight: '700' },
  fieldPackageAcceptRow: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  fieldPackageAcceptTitle: { fontSize: 13, fontWeight: '900' },
  fieldPackageAcceptSub: { fontSize: 11, lineHeight: 15, marginTop: 2 },
  fieldPackageActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  fieldPackageBtnSecondary: {
    flexGrow: 1,
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  fieldPackageBtnSecondaryText: { fontSize: 12, fontWeight: '900' },
  fieldPackageBtnPrimary: {
    flexGrow: 2,
    minHeight: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  fieldPackageBtnPrimaryText: { color: t.accentText, fontSize: 12, fontWeight: '900' },
  crewBriefCard: {
    marginHorizontal: 14,
    marginBottom: 10,
    borderRadius: 16,
    borderWidth: 1,
    padding: 12,
    gap: 10,
  },
  crewBriefHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  crewBriefIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  crewBriefTitle: { fontSize: 15, fontWeight: '900' },
  crewBriefSub: { fontSize: 12, lineHeight: 17, marginTop: 2 },
  crewBriefScore: {
    minWidth: 58,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 6,
    paddingHorizontal: 8,
    alignItems: 'center',
  },
  crewBriefScoreValue: {
    fontSize: 16,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  crewBriefScoreLabel: { fontSize: 9, fontWeight: '800', textTransform: 'uppercase' },
  crewBriefQuickActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  crewBriefActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 11,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  crewBriefActionText: { fontSize: 12, fontWeight: '900' },
  crewProofGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  crewProofCard: {
    flexGrow: 1,
    flexBasis: '47%',
    minHeight: 76,
    borderWidth: 1,
    borderRadius: 13,
    paddingHorizontal: 10,
    paddingVertical: 9,
    justifyContent: 'space-between',
  },
  crewProofTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  crewProofValue: {
    fontSize: 13,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  crewProofLabel: { fontSize: 12, fontWeight: '900', marginTop: 5 },
  crewProofHint: { fontSize: 10, fontWeight: '800', marginTop: 2 },
  crewScopeBox: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 11,
    gap: 5,
  },
  crewScopeTitle: { fontSize: 12, fontWeight: '900', textTransform: 'uppercase' },
  crewScopeLine: { fontSize: 12, lineHeight: 17, fontWeight: '700' },
  crewPhotoStrip: { gap: 9, paddingVertical: 2 },
  crewPhotoCard: {
    width: 104,
    borderWidth: 1,
    borderRadius: 12,
    overflow: 'hidden',
  },
  crewPhotoImage: { width: '100%', height: 74 },
  crewPhotoLabel: { fontSize: 10, fontWeight: '800', paddingHorizontal: 7, paddingVertical: 6 },
  crewBriefChecks: { gap: 8 },
  crewBriefCheck: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  crewBriefCheckTitle: { fontSize: 12, fontWeight: '900' },
  crewBriefCheckHint: { fontSize: 11, lineHeight: 15, marginTop: 2 },
  safetyChecklistCard: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 11,
    gap: 10,
  },
  safetyChecklistHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  safetyChecklistIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  safetyChecklistTitle: { fontSize: 13, fontWeight: '900' },
  safetyChecklistSub: { fontSize: 11, lineHeight: 15, marginTop: 2 },
  safetyChecklistRows: { gap: 7 },
  safetyChecklistRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  safetyChecklistRowTitle: { fontSize: 12, fontWeight: '900' },
  safetyChecklistRowHint: { fontSize: 11, lineHeight: 15, marginTop: 2 },
  scopeConfirmBtn: {
    minHeight: 46,
    borderWidth: 1,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  scopeConfirmText: { fontSize: 13, fontWeight: '900' },
  crewCommandCard: {
    marginHorizontal: 14,
    marginBottom: 10,
    borderRadius: 16,
    borderWidth: 1,
    padding: 12,
    gap: 12,
    ...shadowStyle(t, {
      opacity: t.shadowOpacity * 0.1,
      radius: t.shadowRadius * 0.34,
      offsetY: 1,
      elevation: Math.max(1, t.cardElevation - 1),
    }),
  },
  crewCommandHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  crewCommandIcon: {
    width: 42,
    height: 42,
    borderRadius: 13,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  crewCommandTitle: { fontSize: 15, fontWeight: '900' },
  crewCommandSub: { fontSize: 12, lineHeight: 16, marginTop: 2 },
  crewPrimaryBtn: {
    minHeight: 42,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  crewPrimaryText: { fontSize: 12, fontWeight: '900' },
  crewCommandProgressGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  crewProgressTile: {
    flexGrow: 1,
    flexBasis: '22%',
    minWidth: 72,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 9,
    alignItems: 'center',
    gap: 3,
  },
  crewProgressValue: {
    fontSize: 16,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  crewProgressLabel: { fontSize: 10, fontWeight: '800', textTransform: 'uppercase' },
  crewRoadmap: {
    borderWidth: 1,
    borderRadius: 15,
    padding: 10,
    gap: 8,
  },
  crewRoadmapHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 2,
  },
  crewRoadmapTitle: { fontSize: 13, fontWeight: '900' },
  crewRoadmapSub: { fontSize: 11, lineHeight: 15, marginTop: 1 },
  crewRoadmapStep: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
    borderWidth: 1,
    borderRadius: 13,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  crewRoadmapIndex: {
    width: 26,
    height: 26,
    borderRadius: 9,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  crewRoadmapIndexText: { fontSize: 11, fontWeight: '900', fontVariant: ['tabular-nums'] },
  crewRoadmapStepTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  crewRoadmapStepTitle: { flex: 1, fontSize: 12.5, fontWeight: '900' },
  crewRoadmapBadge: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  crewRoadmapBadgeText: { fontSize: 9.5, fontWeight: '900', textTransform: 'uppercase' },
  crewRoadmapHint: { fontSize: 11, lineHeight: 15, marginTop: 3 },
  crewRoadmapMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 5,
  },
  crewRoadmapValue: { fontSize: 10.5, fontWeight: '900', fontVariant: ['tabular-nums'] },
  crewFastGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  crewFastBtn: {
    flexGrow: 1,
    flexBasis: '47%',
    minWidth: 132,
    minHeight: 54,
    borderWidth: 1,
    borderRadius: 13,
    paddingHorizontal: 10,
    paddingVertical: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  crewFastIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  crewFastLabel: { fontSize: 13, fontWeight: '900' },
  crewFastHint: { fontSize: 11, lineHeight: 14, marginTop: 1 },

  // Timer bar
  timerBar: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 16, paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: t.cardBorder,
  },
  timerTxt: { fontSize: 12 },

  // Status scroll
  statusScroll: { borderBottomWidth: 1, maxHeight: 48 },
  statusScrollContent: { paddingHorizontal: 12, paddingVertical: 8, gap: 8 },
  statusBtn: {
    paddingHorizontal: 14, paddingVertical: 6,
    borderRadius: 20, borderWidth: 1,
  },
  statusBtnTxt: { fontSize: 12, fontWeight: '500' },
  statusHintPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
  },
  statusHintText: { fontSize: 11, fontWeight: '800' },

  // Taby
  tabs: {
    flexDirection: 'row', borderBottomWidth: 1,
  },
  tab: {
    flex: 1, paddingVertical: 10, alignItems: 'center',
    borderBottomWidth: 2, borderBottomColor: 'transparent', gap: 2,
  },
  tabTxt: { fontSize: 9, fontWeight: '500' },

  // Treść
  content: { flex: 1, padding: 12 },

  // Karty info
  card: {
    borderRadius: 18, padding: 14, marginBottom: 12,
    borderWidth: 1,
    ...shadowStyle(t, {
      opacity: t.shadowOpacity * 0.1,
      radius: t.shadowRadius * 0.34,
      offsetY: 1,
      elevation: Math.max(1, t.cardElevation - 1),
    }),
  },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  cardTitle: { fontSize: 14, fontWeight: '700' },
  bigVal: { fontSize: 17, fontWeight: '700', marginBottom: 6 },
  metaRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 3 },
  metaTxt: { fontSize: 13, flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  lbl: { fontSize: 13, width: 100 },
  val: { fontSize: 13, flex: 1 },
  prioBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  prioBadgeTxt: { fontSize: 11, fontWeight: '700' },
  opisTxt: { fontSize: 13, lineHeight: 20, marginTop: 10, paddingTop: 10, borderTopWidth: 1 },
  dossierSub: { color: t.textMuted, fontSize: 12, marginBottom: 8 },
  dossierProgressTrack: { height: 8, borderRadius: 999, overflow: 'hidden', marginBottom: 10 },
  dossierProgressFill: { height: '100%', borderRadius: 999 },
  dossierRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingVertical: 7 },
  dossierRowLabel: { color: t.textSub, fontSize: 13, fontWeight: '700' },
  dossierRowHint: { color: t.textMuted, fontSize: 11, marginTop: 2 },
  dossierActions: { marginTop: 6, flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  dossierActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  dossierActionText: { fontSize: 12, fontWeight: '700' },
  clientSignatureBox: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  clientSignatureTitle: { fontSize: 14, fontWeight: '800' },
  clientSignatureMeta: { fontSize: 12, marginTop: 2 },
  clientSignatureChangeBtn: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  clientSignatureChangeText: { fontSize: 12, fontWeight: '700' },
  clientSignatureAddBtn: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
  },
  clientSignatureAddText: { fontSize: 14, fontWeight: '600' },

  // Summary card (logi)
  summaryCard: {
    flexDirection: 'row', borderRadius: 14, padding: 16,
    marginBottom: 12, borderWidth: 1, alignItems: 'center',
  },
  summaryItem: { flex: 1, alignItems: 'center', gap: 6 },
  summaryDiv: { width: 1, height: 40 },
  summaryNum: { fontSize: 24, fontWeight: '800' },
  summaryLbl: { fontSize: 11 },

  // Log cards
  logCard: {
    borderRadius: 12, padding: 14, marginBottom: 8, borderWidth: 1,
  },
  logTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  logPrac: { fontSize: 14, fontWeight: '600' },
  logTime: { fontSize: 12 },
  durBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  durTxt: { fontSize: 12, fontWeight: '700' },
  logSafetyBox: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 10,
    marginTop: 10,
    gap: 8,
  },
  logSafetyHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  logSafetyTitle: { fontSize: 13, fontWeight: '800' },
  logSafetyCount: { fontSize: 12, fontWeight: '900' },
  logSafetyList: { gap: 7 },
  logSafetyRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  logSafetyTextBox: { flex: 1, gap: 2 },
  logSafetyLabel: { fontSize: 12, fontWeight: '700' },
  logSafetyHint: { fontSize: 11, lineHeight: 15 },

  // Problem cards
  problemCard: { borderRadius: 12, padding: 14, marginBottom: 8, borderWidth: 1, borderLeftWidth: 4 },
  problemTop: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  problemTyp: { fontSize: 13, fontWeight: '600', textTransform: 'capitalize' },
  problemBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  problemBadgeTxt: { fontSize: 11, fontWeight: '600' },
  problemOpis: { fontSize: 13, lineHeight: 18, marginBottom: 6 },
  problemMeta: { fontSize: 11 },

  // Zdjęcia
  grupaTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8, marginTop: 4 },
  grupaTitle: { fontSize: 13, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 12 },
  zdjecieCard: { width: '48%', borderRadius: 12, overflow: 'hidden', borderWidth: 1 },
  zdjecieImg: { width: '100%', height: 158 },
  zdjecieOpis: { fontSize: 12, padding: 8 },
  zdjecieMeta: { fontSize: 11, paddingHorizontal: 8, paddingBottom: 4 },
  zdjecieGps: { fontSize: 10, paddingHorizontal: 8, paddingBottom: 8 },
  photoGalleryCard: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 12,
    marginBottom: 12,
    gap: 11,
  },
  photoGalleryHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  photoGalleryIcon: {
    width: 42,
    height: 42,
    borderRadius: 13,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoGalleryTitle: { fontSize: 15, fontWeight: '900' },
  photoGallerySub: { fontSize: 11, lineHeight: 16, marginTop: 2 },
  photoGalleryScore: {
    minWidth: 44,
    minHeight: 36,
    borderWidth: 1,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  photoGalleryScoreText: { fontSize: 15, fontWeight: '900', fontVariant: ['tabular-nums'] },
  photoFilterStrip: { gap: 8, paddingRight: 4 },
  photoFilterChip: {
    minHeight: 38,
    maxWidth: 148,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 7,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  photoFilterText: { fontSize: 11.5, fontWeight: '900', maxWidth: 82 },
  photoFilterCount: { fontSize: 11, fontWeight: '900', fontVariant: ['tabular-nums'] },
  photoHeroCard: {
    borderWidth: 1,
    borderRadius: 15,
    overflow: 'hidden',
  },
  photoHeroImage: { width: '100%', height: 230 },
  photoHeroOverlay: {
    position: 'absolute',
    left: 10,
    right: 10,
    top: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  photoHeroTypeBadge: {
    maxWidth: '70%',
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  photoHeroTypeText: { fontSize: 11, fontWeight: '900' },
  photoHeroOpen: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '900',
    backgroundColor: 'rgba(0,0,0,0.48)',
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 6,
    overflow: 'hidden',
  },
  photoHeroCaption: { padding: 11, gap: 3 },
  photoHeroTitle: { fontSize: 13, fontWeight: '800', lineHeight: 18 },
  photoHeroMeta: { fontSize: 10.5, lineHeight: 15 },
  photoGalleryEmpty: {
    minHeight: 118,
    borderWidth: 1,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  photoGalleryEmptyText: { fontSize: 12, fontWeight: '800' },
  photoPreviewOverlay: {
    flex: 1,
    backgroundColor: 'rgba(4,8,16,0.9)',
    justifyContent: 'center',
    padding: 16,
  },
  photoPreviewCloseLayer: {
    ...StyleSheet.absoluteFillObject,
  },
  photoPreviewBox: {
    borderWidth: 1,
    borderRadius: 20,
    overflow: 'hidden',
  },
  photoPreviewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  photoPreviewTitle: { fontSize: 15, fontWeight: '900' },
  photoPreviewSub: { fontSize: 11, marginTop: 2 },
  photoPreviewCounter: {
    minWidth: 48,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 5,
    alignItems: 'center',
  },
  photoPreviewCounterText: { fontSize: 11, fontWeight: '900', fontVariant: ['tabular-nums'] },
  photoPreviewStage: {
    position: 'relative',
    backgroundColor: '#05080F',
  },
  photoPreviewImage: { width: '100%', height: 430 },
  photoPreviewNavBtn: {
    position: 'absolute',
    top: '45%',
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.48)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoPreviewNavPrev: { left: 10 },
  photoPreviewNavNext: { right: 10 },
  photoPreviewInfo: { padding: 14, gap: 6 },
  photoPreviewDescription: { fontSize: 13, lineHeight: 19, fontWeight: '700' },
  photoPreviewMeta: { fontSize: 11.5, lineHeight: 16 },
  photoPreviewActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 6,
  },
  photoPreviewActionBtn: {
    flexGrow: 1,
    flexBasis: '45%',
    minHeight: 40,
    borderWidth: 1,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  photoPreviewActionText: { fontSize: 12, fontWeight: '900' },

  // Przyciski dodaj
  addBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, borderRadius: 12, padding: 12, marginBottom: 12, borderWidth: 1,
  },
  addBtnTxt: { fontWeight: '700', fontSize: 14 },
  evidenceCommandCard: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 12,
    marginBottom: 12,
    gap: 12,
  },
  evidenceCommandHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  evidenceCommandIcon: {
    width: 42,
    height: 42,
    borderWidth: 1,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  evidenceCommandTitle: { fontSize: 15, fontWeight: '900' },
  evidenceCommandSub: { fontSize: 11, lineHeight: 16, marginTop: 2 },
  evidenceScore: {
    minWidth: 58,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 6,
    alignItems: 'center',
  },
  evidenceScoreValue: { fontSize: 16, fontWeight: '900', fontVariant: ['tabular-nums'] },
  evidenceScoreLabel: { fontSize: 9, fontWeight: '800', textTransform: 'uppercase' },
  evidenceQuickGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  evidenceQuickCard: {
    flexGrow: 1,
    flexBasis: '47%',
    minWidth: 138,
    borderWidth: 1,
    borderRadius: 13,
    padding: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  evidenceQuickIcon: {
    width: 34,
    height: 34,
    borderWidth: 1,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  evidenceQuickTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  evidenceQuickTitle: { flex: 1, fontSize: 12, fontWeight: '900' },
  evidenceQuickCount: { fontSize: 12, fontWeight: '900', fontVariant: ['tabular-nums'] },
  evidenceQuickHint: { fontSize: 10.5, lineHeight: 14, marginTop: 2 },
  evidenceActionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  evidenceActionBtn: {
    flexGrow: 1,
    flexBasis: '47%',
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  evidenceActionText: { fontSize: 12, fontWeight: '900' },
  evidenceHandoffCard: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 12,
    marginBottom: 12,
    gap: 11,
  },
  evidenceHandoffHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  evidenceHandoffIcon: {
    width: 42,
    height: 42,
    borderWidth: 1,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  evidenceHandoffTitle: { fontSize: 14, fontWeight: '900' },
  evidenceHandoffSub: { fontSize: 11, lineHeight: 16, marginTop: 2 },
  evidencePercentBadge: {
    minWidth: 52,
    minHeight: 36,
    borderWidth: 1,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  evidencePercentText: { fontSize: 14, fontWeight: '900', fontVariant: ['tabular-nums'] },
  evidenceProgressTrack: {
    height: 8,
    borderRadius: 999,
    overflow: 'hidden',
  },
  evidenceProgressFill: { height: '100%', borderRadius: 999 },
  evidenceTimeline: {
    flexDirection: 'row',
    gap: 6,
  },
  evidenceTimelineStep: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
    position: 'relative',
  },
  evidenceTimelineDot: {
    width: 28,
    height: 28,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  evidenceTimelineLine: {
    position: 'absolute',
    top: 14,
    left: '55%',
    right: '-55%',
    height: 2,
    borderRadius: 999,
  },
  evidenceTimelineLabel: { fontSize: 10.5, fontWeight: '900', textAlign: 'center' },
  evidenceTimelineHint: { fontSize: 9.5, fontWeight: '700', textAlign: 'center' },
  evidenceNextBtn: {
    minHeight: 42,
    borderWidth: 1,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  evidenceNextText: { fontSize: 12, fontWeight: '900' },
  disputeShieldCard: {
    marginBottom: 12,
    borderRadius: 16,
    borderWidth: 1,
    padding: 12,
    gap: 11,
  },
  disputeShieldHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  disputeShieldIcon: {
    width: 40,
    height: 40,
    borderRadius: 13,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disputeShieldTitle: { fontSize: 15, fontWeight: '900' },
  disputeShieldSub: { fontSize: 11, lineHeight: 16, marginTop: 2 },
  disputeShieldScore: {
    minWidth: 58,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 6,
    alignItems: 'center',
  },
  disputeShieldScoreText: { fontSize: 14, fontWeight: '900', fontVariant: ['tabular-nums'] },
  disputeShieldScoreLabel: { fontSize: 8.5, fontWeight: '900', textTransform: 'uppercase' },
  disputeShieldGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  disputeShieldItem: {
    flexGrow: 1,
    flexBasis: '47%',
    minHeight: 58,
    borderRadius: 13,
    borderWidth: 1,
    paddingHorizontal: 9,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  disputeShieldItemIcon: {
    width: 30,
    height: 30,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disputeShieldItemTitle: { fontSize: 11.5, fontWeight: '900' },
  disputeShieldItemHint: { fontSize: 10, lineHeight: 14, marginTop: 1 },
  disputeShieldNext: {
    minHeight: 38,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  disputeShieldNextText: { fontSize: 12, fontWeight: '900' },
  fieldPhotoChecklist: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    marginBottom: 12,
    gap: 10,
  },
  fieldPhotoHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  fieldPhotoTitle: { fontSize: 13, fontWeight: '900' },
  fieldPhotoSub: { fontSize: 11, marginTop: 2, lineHeight: 16 },
  fieldPhotoRows: { gap: 8 },
  fieldPhotoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 11,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  fieldPhotoRowText: { flex: 1, fontSize: 12, fontWeight: '800' },
  fieldPhotoCount: { fontSize: 11, fontWeight: '900' },
  finishModalScroll: { maxHeight: 560, marginBottom: 14 },
  finishModalContent: { gap: 10, paddingBottom: 4 },
  finishHero: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 12,
  },
  finishHeroTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  finishHeroIcon: {
    width: 42,
    height: 42,
    borderRadius: 13,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  finishHeroTitle: { fontSize: 15, fontWeight: '900' },
  finishHeroSub: { fontSize: 11, lineHeight: 16, marginTop: 2 },
  finishHeroScore: {
    minWidth: 58,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 6,
    paddingHorizontal: 8,
    alignItems: 'center',
  },
  finishHeroScoreValue: {
    fontSize: 16,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  finishHeroScoreLabel: { fontSize: 9, fontWeight: '800', textTransform: 'uppercase' },
  finishChecklist: { gap: 8 },
  finishChecklistRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  finishChecklistTitle: { fontSize: 12, fontWeight: '900' },
  finishChecklistHint: { fontSize: 11, lineHeight: 15, marginTop: 2 },
  finishQuickRow: { flexDirection: 'row', gap: 8 },
  finishQuickBtn: {
    flex: 1,
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  finishQuickText: { fontSize: 12, fontWeight: '900' },
  finishSwitchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  finishSwitchTitle: { fontSize: 12, fontWeight: '900' },
  finishSwitchHint: { fontSize: 11, lineHeight: 15, marginTop: 2 },
  gpsInfo: { flexDirection: 'row', alignItems: 'center', borderRadius: 8, padding: 10, marginBottom: 10 },
  gpsTxt: { fontSize: 12 },

  // Empty
  empty: { alignItems: 'center', paddingTop: 48, gap: 10 },
  emptyTxt: { fontSize: 14 },

  // Modal
  overlay: { flex: 1, backgroundColor: 'rgba(5,8,15,0.9)', justifyContent: 'flex-end' },
  modalBox: {
    borderTopLeftRadius: 22, borderTopRightRadius: 22,
    padding: 20, paddingBottom: 44,
    maxHeight: '94%',
  },
  modalHeader: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: 18,
  },
  modalTitle: { fontSize: 18, fontWeight: '700' },
  modalLbl: { fontSize: 13, fontWeight: '600', marginBottom: 6 },
  modalInput: {
    borderWidth: 1, borderRadius: 10, padding: 12,
    fontSize: 14, minHeight: 90, textAlignVertical: 'top', marginBottom: 16,
  },
  typBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1 },
  typBtnTxt: { fontSize: 12 },
  modalBtns: { flexDirection: 'row', gap: 10 },
  cancelBtn: { flex: 1, padding: 14, borderRadius: 12, alignItems: 'center', borderWidth: 1 },
  cancelTxt: { fontWeight: '600' },
  submitBtn: { flex: 1, padding: 14, borderRadius: 12, alignItems: 'center' },
  // Modal zdjęcia
  zdjecieTypBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    padding: 14, borderRadius: 14, marginBottom: 10, borderWidth: 1,
  },
  zdjecieTypIcon: {
    width: 44, height: 44, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
  },
  zdjecieTypLabel: { fontSize: 15, fontWeight: '700' },
  zdjecieTypHint: { fontSize: 11, marginTop: 2 },
  zdjecieTypCount: { fontSize: 13, fontWeight: '900', fontVariant: ['tabular-nums'] },
  uploadingRow: { flexDirection: 'row', alignItems: 'center', gap: 10, justifyContent: 'center', marginTop: 8 },
  uploadingTxt: { fontSize: 13 },
});
