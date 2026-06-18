import { safeBack } from '../utils/navigation';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, Image, Linking, Modal, PanResponder, Platform, ScrollView, StatusBar,
  StyleSheet, Text, TextInput, TouchableOpacity, useWindowDimensions, View
} from 'react-native';
import Svg, { Path as SvgPath } from 'react-native-svg';
import ViewShot, { type ViewShotRef } from 'react-native-view-shot';
import { ErrorBanner } from '../components/ui/app-state';
import { KeyboardSafeScreen } from '../components/ui/keyboard-safe-screen';
import { PlatinumCTA } from '../components/ui/platinum-cta';
import { useLanguage } from '../constants/LanguageContext';
import { useTheme } from '../constants/ThemeContext';
import { shadowStyle } from '../constants/elevation';
import {
  TASK_PRIORITIES,
  TASK_SERVICE_TYPES,
  buildTaskCreatePayload,
  createTaskFormDefaults,
  isTaskCreateFormValid,
} from '../constants/task-form';
import { TASK_STATUS } from '../constants/task-workflow';
import type { Theme } from '../constants/theme';
import { useOddzialFeatureGuard } from '../hooks/use-oddzial-feature-guard';
import {
  createOfflineRequestId,
  enqueueOfflineRequest,
  flushOfflineQueue,
  queueTaskPhotoOffline,
} from '../utils/offline-queue';
import {
  DEFAULT_FIELD_PROTOCOL,
  FIELD_PROTOCOL_EQUIPMENT_OPTIONS,
  FIELD_PROTOCOL_PRESETS,
  FIELD_PROTOCOL_RESULT_OPTIONS,
  FIELD_PROTOCOL_RISK_OPTIONS,
  FIELD_PROTOCOL_WORK_OPTIONS,
  buildFieldProtocolSummary,
  buildFieldProtocolTaskExtra,
  mergeUniqueProtocolValues,
  toggleProtocolValue,
  type FieldProtocolForm,
  type FieldProtocolPreset,
} from '../utils/field-protocol';
import { triggerHaptic } from '../utils/haptics';
import { openAddressInMaps } from '../utils/maps-link';
import { apiFetch, apiJsonFetch, apiUrl, authHeaders, fetchWithTimeout } from '../utils/api-client';
import { buildNewOrderRoute } from '../utils/new-order-route';
import { getStoredSession, type StoredUser } from '../utils/session';
import { isPositiveNumber, isValidIsoDate, isValidPolishPhone, isValidTimeHHMM } from '../utils/validators';

import { AppStatusBar } from '../components/ui/app-status-bar';
function paramString(value: unknown) {
  if (Array.isArray(value)) return String(value[0] || '');
  return String(value || '');
}

const FIELD_DRAFT_SOURCE_COPY: Record<string, { note: string; header: string }> = {
  'wyceny-terenowe': {
    note: 'Źródło: lista oględzin terenowych',
    header: 'Lista oględzin terenowych',
  },
  'wyceniajacy-hub': {
    note: 'Źródło: centrum specjalisty ds. wyceny',
    header: 'Centrum specjalisty ds. wyceny',
  },
  'wycena-kalendarz': {
    note: 'Źródło: kalendarz wycen',
    header: 'Kalendarz wycen',
  },
  'plan-ogledzin': {
    note: 'Źródło: plan oględzin',
    header: 'Plan oględzin',
  },
  ogledziny: {
    note: 'Źródło: karta oględzin',
    header: 'Karta oględzin',
  },
  'ogledziny-dokumentacja': {
    note: 'Źródło: dokumentacja oględzin',
    header: 'Dokumentacja oględzin',
  },
  harmonogram: {
    note: 'Źródło: harmonogram ekip',
    header: 'Harmonogram ekip',
  },
  wycena: {
    note: 'Źródło: moduł wycen',
    header: 'Moduł wycen',
  },
  zlecenia: {
    note: 'Źródło: centrum zleceń',
    header: 'Centrum zleceń',
  },
  'misja-dnia': {
    note: 'Źródło: misja dnia',
    header: 'Misja dnia',
  },
  'ogledziny-new': {
    note: 'Źródło: moduł oględzin',
    header: 'Moduł oględzin',
  },
  dashboard: {
    note: 'Źródło: pulpit mobilny',
    header: 'Pulpit mobilny',
  },
  'command-center': {
    note: 'Źródło: Command Center',
    header: 'Command Center',
  },
};

function fieldDraftSourceCopy(source: string) {
  if (!source) return { note: '', header: 'Nowe zgłoszenie' };
  return FIELD_DRAFT_SOURCE_COPY[source] || {
    note: `Źródło: ${source.replace(/-/g, ' ')}`,
    header: source.replace(/-/g, ' '),
  };
}

const FIELD_INTAKE_SOURCES = new Set([
  'wyceny-terenowe',
  'wyceniajacy-hub',
  'wycena-kalendarz',
  'plan-ogledzin',
  'ogledziny',
  'ogledziny-dokumentacja',
  'ogledziny-new',
  'next-ogledziny',
  'wycena',
]);

function shouldStartInFieldMode(source: string, inspectionId?: string) {
  return Boolean(String(inspectionId || '').trim()) || FIELD_INTAKE_SOURCES.has(String(source || '').trim());
}

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];
type FieldPreset = FieldProtocolPreset & { icon: IoniconName; typUslugi: string };
type FieldPhotoType = 'wycena' | 'szkic' | 'dojazd';
type FieldPhotoSource = 'camera' | 'gallery';
type AssignmentMode = 'auto' | 'manual';
type FieldPhotoDraft = {
  id: string;
  uri: string;
  typ: FieldPhotoType;
  label: string;
  opis: string;
  source: FieldPhotoSource;
  createdAt: string;
  lat?: number;
  lng?: number;
};
type DrawStroke = {
  path: string;
  color: string;
  width: number;
};
type TeamRecommendation = {
  team: any;
  score: number;
  memberCount: number;
  native: boolean;
  delegated: boolean;
  reasons: string[];
};
type NextInspectionCandidate = {
  id: number | string;
  status?: string;
  data_planowana?: string;
  oddzial_id?: number | string;
  wyceniajacy_id?: number | string;
  klient_nazwa?: string;
  klient_telefon?: string;
  adres?: string;
  miasto?: string;
  notatki?: string;
};

const FIELD_PRESET_META: Record<string, { icon: IoniconName; typUslugi: string }> = {
  'przycinka-ogrodzenie': { icon: 'git-branch-outline', typUslugi: TASK_SERVICE_TYPES[1] },
  'wycinka-wywoz': { icon: 'leaf-outline', typUslugi: TASK_SERVICE_TYPES[0] },
  'pien-frezowanie': { icon: 'settings-outline', typUslugi: TASK_SERVICE_TYPES[3] },
  'trudny-dojazd': { icon: 'navigate-outline', typUslugi: TASK_SERVICE_TYPES[1] },
};
const FIELD_PRESETS: FieldPreset[] = FIELD_PROTOCOL_PRESETS.map((preset) => ({
  ...preset,
  ...(FIELD_PRESET_META[preset.key] || { icon: 'leaf-outline', typUslugi: TASK_SERVICE_TYPES[1] }),
}));
type FieldBooleanKey = 'haul' | 'stumpRemoval' | 'banner';
const FIELD_WORK_OPTIONS = Array.from(new Set([
  ...FIELD_PROTOCOL_WORK_OPTIONS,
  'Wywoz',
  'Formowanie',
  'Pielegnacja zywoplotu',
]));
const FIELD_EQUIPMENT_OPTIONS = Array.from(new Set([
  ...FIELD_PROTOCOL_EQUIPMENT_OPTIONS,
  'Rebak',
  'Wysiegnik / pila na wysiegniku',
  'Dlugie nozyce',
  'Kosiarka',
  'Kosa reczna',
  'Lopata',
  'Mulczer',
  'Arborysta',
]));
const FIELD_QUICK_TOGGLES: { key: FieldBooleanKey; label: string; icon: IoniconName }[] = [
  { key: 'haul', label: 'Wywoz', icon: 'car-outline' },
  { key: 'stumpRemoval', label: 'Usuwanie pni', icon: 'disc-outline' },
  { key: 'banner', label: 'Baner', icon: 'flag-outline' },
];
const FIELD_RISK_OPTIONS = FIELD_PROTOCOL_RISK_OPTIONS;
const FIELD_RESULT_OPTIONS = FIELD_PROTOCOL_RESULT_OPTIONS;
const FIELD_PHOTO_TYPES: { key: FieldPhotoType; label: string; icon: IoniconName }[] = [
  { key: 'wycena', label: 'Wycena', icon: 'camera-outline' },
  { key: 'szkic', label: 'Szkic', icon: 'create-outline' },
  { key: 'dojazd', label: 'Dojazd', icon: 'navigate-outline' },
];
const REQUIRED_FIELD_PHOTO_TYPES: FieldPhotoType[] = ['wycena', 'szkic', 'dojazd'];
const DRAW_COLORS = ['#EF4444', '#F97316', '#FACC15', '#22C55E', '#3B82F6', '#111827', '#FFFFFF'];
const DRAW_WIDTHS = [3, 6, 10];
const NEW_ORDER_DRAFT_KEY = 'new_order_mobile_draft_v1';

const buildFieldQuoteSummary = (field: FieldProtocolForm) =>
  buildFieldProtocolSummary(field, 'FORMULARZ WYCENY TERENOWEJ');

function createLocalPhotoId() {
  return `field-photo-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function photoFileName(photo: FieldPhotoDraft) {
  const stamp = photo.createdAt.replace(/[^0-9T]/g, '').slice(0, 15) || String(Date.now());
  return `${photo.typ}_${stamp}.jpg`;
}

function datePart(value?: string) {
  return value?.split('T')[0] || new Date().toISOString().split('T')[0];
}

function timePart(value?: string) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
}

function isOpenInspection(item: NextInspectionCandidate) {
  return item.status !== 'Zakonczone' && item.status !== 'Anulowane';
}

function inspectionTimeValue(item: NextInspectionCandidate) {
  const ts = item.data_planowana ? new Date(item.data_planowana).getTime() : Number.MAX_SAFE_INTEGER;
  return Number.isFinite(ts) ? ts : Number.MAX_SAFE_INTEGER;
}

function teamMemberCount(team: any) {
  const explicit = Number(team?.liczba_czlonkow ?? team?.liczba_pracownikow ?? team?.members_count);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  if (Array.isArray(team?.pracownicy)) return team.pracownicy.length;
  if (Array.isArray(team?.czlonkowie)) return team.czlonkowie.length;
  return 0;
}

function teamDisplayName(team: any) {
  return String(team?.nazwa || team?.name || (team?.id ? `Ekipa #${team.id}` : 'Ekipa'));
}

function plannedMinutesFromHours(value: unknown, fallbackHours = 2) {
  const normalized = String(value || '').replace(',', '.');
  const n = Number(normalized);
  return Number.isFinite(n) && n > 0 ? Math.max(15, Math.round(n * 60)) : Math.round(fallbackHours * 60);
}

function teamLoadMinutes(team: any) {
  const raw = Number(team?.zajete_minuty_dzien ?? 0);
  return Number.isFinite(raw) && raw > 0 ? raw : 0;
}

function teamFreeMinutes(team: any) {
  const raw = Number(team?.wolne_minuty_dzien);
  if (Number.isFinite(raw) && raw >= 0) return raw;
  return Math.max(0, 480 - teamLoadMinutes(team));
}

function teamLoadPercent(team: any) {
  const raw = Number(team?.obciazenie_proc_dzien);
  if (Number.isFinite(raw) && raw >= 0) return Math.min(100, raw);
  return Math.min(100, Math.round((teamLoadMinutes(team) / 480) * 100));
}

function teamLoadLabel(team: any) {
  const load = teamLoadPercent(team);
  if (load >= 100) return 'pelny dzien';
  if (load >= 75) return 'mocno zajeta';
  if (load > 0) return `${load}% planu`;
  return 'wolna';
}

function isClientAcceptedForPlanning(result: string) {
  const normalized = String(result || '').trim();
  return [
    'Klient chce termin',
    'Klient zaakceptowal - planuj termin',
    'Klient zaakceptował - planuj termin',
  ].includes(normalized);
}

export default function NoweZlecenieScreen() {
  const { theme } = useTheme();
  const { t } = useLanguage();
  const { width: screenWidth } = useWindowDimensions();
  const guard = useOddzialFeatureGuard('/nowe-zlecenie');
  const params = useLocalSearchParams<{
    source?: string;
    inspectionId?: string;
    klient?: string;
    telefon?: string;
    adres?: string;
    miasto?: string;
    data?: string;
    godzina?: string;
    notatki?: string;
  }>();
  const startsInFieldQuoteMode = shouldStartInFieldMode(paramString(params.source), paramString(params.inspectionId));
  const hasRoutePrefill = Boolean(
    paramString(params.source) ||
    paramString(params.inspectionId) ||
    paramString(params.klient) ||
    paramString(params.telefon) ||
    paramString(params.adres) ||
    paramString(params.miasto) ||
    paramString(params.data) ||
    paramString(params.godzina) ||
    paramString(params.notatki)
  );
  const [oddzialy, setOddzialy] = useState<any[]>([]);
  const [ekipy, setEkipy] = useState<any[]>([]);
  const [ekipyLoading, setEkipyLoading] = useState(false);
  const [user, setUser] = useState<StoredUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldQuoteMode, setFieldQuoteMode] = useState(startsInFieldQuoteMode);
  const [prefillApplied, setPrefillApplied] = useState(false);
  const [fieldQuote, setFieldQuote] = useState<FieldProtocolForm>({ ...DEFAULT_FIELD_PROTOCOL });
  const [fieldPhotos, setFieldPhotos] = useState<FieldPhotoDraft[]>([]);
  const [photoType, setPhotoType] = useState<FieldPhotoType>('wycena');
  const [photoOpis, setPhotoOpis] = useState('');
  const [photoBusy, setPhotoBusy] = useState(false);
  const [drawPhoto, setDrawPhoto] = useState<FieldPhotoDraft | null>(null);
  const [drawStrokes, setDrawStrokes] = useState<DrawStroke[]>([]);
  const [drawCurrentPath, setDrawCurrentPath] = useState('');
  const [drawColor, setDrawColor] = useState(DRAW_COLORS[0]);
  const [drawWidth, setDrawWidth] = useState(6);
  const [drawSaving, setDrawSaving] = useState(false);
  const [assignmentMode, setAssignmentMode] = useState<AssignmentMode>('auto');
  const drawShotRef = useRef<ViewShotRef | null>(null);
  const drawPathRef = useRef('');
  const [form, setForm] = useState(createTaskFormDefaults({
    data_planowana: new Date().toISOString().split('T')[0],
    status: startsInFieldQuoteMode ? TASK_STATUS.WYCENA_TERENOWA : TASK_STATUS.NOWE,
    ankieta_uproszczona: startsInFieldQuoteMode,
  }));
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [draftNotice, setDraftNotice] = useState('');
  const switchIntakeMode = useCallback((nextFieldMode: boolean, haptic = true) => {
    setFieldQuoteMode(nextFieldMode);
    setForm((current) => ({
      ...current,
      status: nextFieldMode ? TASK_STATUS.WYCENA_TERENOWA : TASK_STATUS.NOWE,
      ankieta_uproszczona: nextFieldMode,
    }));
    if (haptic) void triggerHaptic('light');
  }, []);

  useEffect(() => {
    if (prefillApplied) return;
    const klient = paramString(params.klient);
    const telefon = paramString(params.telefon);
    const adres = paramString(params.adres);
    const miasto = paramString(params.miasto);
    const data = paramString(params.data);
    const godzina = paramString(params.godzina);
    const inspectionId = paramString(params.inspectionId);
    const notatki = paramString(params.notatki);
    const source = paramString(params.source);
    const sourceLabel = fieldDraftSourceCopy(source).note;
    if (!hasRoutePrefill) return;

    switchIntakeMode(shouldStartInFieldMode(source, inspectionId), false);
    setForm((current) => ({
      ...current,
      klient_nazwa: klient || current.klient_nazwa,
      klient_telefon: telefon || current.klient_telefon,
      adres: adres || current.adres,
      miasto: miasto || current.miasto,
      data_planowana: data || current.data_planowana,
      godzina_rozpoczecia: godzina || current.godzina_rozpoczecia,
      notatki_wewnetrzne: [
        sourceLabel,
        inspectionId ? `Źródło: oględziny #${inspectionId}` : '',
        notatki ? `Notatka z oględzin: ${notatki}` : '',
        current.notatki_wewnetrzne,
      ].filter(Boolean).join('\n'),
    }));
    setPrefillApplied(true);
  }, [hasRoutePrefill, params, prefillApplied, switchIntakeMode]);

  useEffect(() => {
    let active = true;
    if (hasRoutePrefill) {
      setDraftLoaded(true);
      return () => {
        active = false;
      };
    }
    AsyncStorage.getItem(NEW_ORDER_DRAFT_KEY)
      .then((raw) => {
        if (!active) return;
        if (!raw) return;
        const parsed = JSON.parse(raw) as {
          form?: typeof form;
          fieldQuoteMode?: boolean;
          fieldQuote?: FieldProtocolForm;
          fieldPhotos?: FieldPhotoDraft[];
          savedAt?: string;
        };
        if (parsed?.form && typeof parsed.form === 'object') setForm((current) => ({ ...current, ...parsed.form }));
        if (typeof parsed?.fieldQuoteMode === 'boolean') setFieldQuoteMode(parsed.fieldQuoteMode);
        if (parsed?.fieldQuote && typeof parsed.fieldQuote === 'object') {
          setFieldQuote((current) => ({ ...current, ...parsed.fieldQuote }));
        }
        if (Array.isArray(parsed?.fieldPhotos)) {
          setFieldPhotos(parsed.fieldPhotos.filter((photo) => photo && typeof photo.uri === 'string').slice(0, 24));
        }
        const savedAt = parsed?.savedAt ? new Date(parsed.savedAt) : null;
        const savedLabel = savedAt && !Number.isNaN(savedAt.getTime())
          ? savedAt.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })
          : '';
        setDraftNotice(`Przywrocono lokalny szkic formularza${savedLabel ? ` z ${savedLabel}` : ''}.`);
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setDraftLoaded(true);
      });
    return () => {
      active = false;
    };
  }, [hasRoutePrefill]);

  useEffect(() => {
    if (!draftLoaded || hasRoutePrefill) return;
    const handle = setTimeout(() => {
      const payload = {
        savedAt: new Date().toISOString(),
        form,
        fieldQuoteMode,
        fieldQuote,
        fieldPhotos,
      };
      void AsyncStorage.setItem(NEW_ORDER_DRAFT_KEY, JSON.stringify(payload)).catch(() => undefined);
    }, 600);
    return () => clearTimeout(handle);
  }, [draftLoaded, fieldPhotos, fieldQuote, fieldQuoteMode, form, hasRoutePrefill]);

  const clearLocalDraft = useCallback(async () => {
    await AsyncStorage.removeItem(NEW_ORDER_DRAFT_KEY).catch(() => undefined);
    setDraftNotice('');
  }, []);

  const loadBranchResources = useCallback(async (storedToken: string, oddzialId: string, dateValue?: string) => {
    if (!oddzialId) return;
    setEkipyLoading(true);
    try {
      const day = dateValue || new Date().toISOString().split('T')[0];
      const res = await apiFetch(`/oddzialy/${oddzialId}/zasoby?date=${encodeURIComponent(day)}`, { token: storedToken });
      if (!res.ok) throw new Error('branch_resources_failed');
      const data = await res.json();
      setEkipy(Array.isArray(data?.ekipy) ? data.ekipy : []);
    } catch {
      try {
        const fallback = await apiFetch(`/ekipy?oddzial_id=${encodeURIComponent(oddzialId)}&include_delegacje=1&date=${encodeURIComponent(dateValue || new Date().toISOString().split('T')[0])}`, { token: storedToken });
        if (fallback.ok) {
          const data = await fallback.json();
          setEkipy(Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : []);
        }
      } catch {
        setEkipy([]);
      }
    } finally {
      setEkipyLoading(false);
    }
  }, []);

  const loadData = useCallback(async () => {
    setError(null);
    try {
      const { token: storedToken, user: u } = await getStoredSession();
      if (!storedToken) { router.replace('/login'); return; }
      setToken(storedToken);
      await flushOfflineQueue(storedToken);
      setUser(u);
      const [oRes, eRes] = await Promise.all([
        apiFetch('/oddzialy', { token: storedToken }),
        apiFetch('/ekipy', { token: storedToken }),
      ]);
      if (oRes.ok) setOddzialy(await oRes.json());
      if (eRes.ok) setEkipy(await eRes.json());
      const userOddzialId = typeof u?.oddzial_id === 'number' || typeof u?.oddzial_id === 'string'
        ? String(u.oddzial_id)
        : '';
      if (userOddzialId) {
        setForm(f => ({ ...f, oddzial_id: userOddzialId }));
        await loadBranchResources(storedToken, userOddzialId, paramString(params.data) || new Date().toISOString().split('T')[0]);
      }
    } catch {
      setError('Nie udało się pobrać danych pomocniczych.');
    }
  }, [loadBranchResources, params.data]);

  const isDyrektor = user?.rola === 'Dyrektor' || user?.rola === 'Administrator';
  const ekipyFiltered = form.oddzial_id
    ? ekipy.filter(e => String(e.oddzial_id) === String(form.oddzial_id) || e.delegowany || e.natywny_oddzial)
    : ekipy;
  const requestedPlanMinutes = plannedMinutesFromHours(form.czas_planowany_godziny || fieldQuote.time);
  const teamRecommendations: TeamRecommendation[] = [...ekipyFiltered]
    .map((team) => {
      const memberCount = teamMemberCount(team);
      const native = Boolean(team.natywny_oddzial || String(team.oddzial_id) === String(form.oddzial_id));
      const delegated = Boolean(team.delegowany);
      const hasLeader = Boolean(team.brygadzista_id || team.brygadzista_imie || team.brygadzista_nazwisko);
      const loadPercent = teamLoadPercent(team);
      const freeMinutes = teamFreeMinutes(team);
      const canFit = freeMinutes >= requestedPlanMinutes;
      const score =
        (native ? 48 : 0) +
        (delegated ? 28 : 0) +
        Math.min(memberCount, 5) * 9 +
        (hasLeader ? 8 : 0) +
        (team.kolor ? 2 : 0) +
        Math.max(0, 35 - Math.round(loadPercent / 3)) +
        (canFit ? 12 : -28) -
        (loadPercent >= 100 ? 55 : 0);
      const reasons = [
        native ? 'oddział' : delegated ? 'delegacja' : 'lista',
        teamLoadLabel(team),
        canFit ? 'ma okno' : 'brak okna',
        memberCount ? `${memberCount} os.` : 'sklad do sprawdzenia',
        hasLeader ? 'brygadzista' : '',
      ].filter(Boolean);
      return { team, score, memberCount, native, delegated, reasons };
    })
    .sort((a, b) => b.score - a.score || teamDisplayName(a.team).localeCompare(teamDisplayName(b.team), 'pl'));
  const suggestedRecommendation = teamRecommendations[0] || null;
  const suggestedTeam = suggestedRecommendation?.team || null;
  const suggestedTeamId = suggestedTeam?.id != null ? String(suggestedTeam.id) : '';
  const suggestedTeamName = suggestedTeam ? teamDisplayName(suggestedTeam) : '';

  useEffect(() => {
    if (!fieldQuoteMode || assignmentMode !== 'auto') return;
    setForm((current) => {
      if (current.ekipa_id === suggestedTeamId) return current;
      return { ...current, ekipa_id: suggestedTeamId };
    });
  }, [assignmentMode, fieldQuoteMode, suggestedTeamId]);

  const fieldQuoteSummary = useMemo(() => buildFieldQuoteSummary(fieldQuote), [fieldQuote]);
  const fieldPhotoTypeStats = FIELD_PHOTO_TYPES
    .map((type) => ({
      ...type,
      count: fieldPhotos.filter((photo) => photo.typ === type.key).length,
    }));
  const missingRequiredPhotoTypes = fieldPhotoTypeStats.filter(
    (type) => REQUIRED_FIELD_PHOTO_TYPES.includes(type.key) && type.count === 0,
  );
  const photoPackageReady = missingRequiredPhotoTypes.length === 0;
  const photoPackageLabel = photoPackageReady
    ? 'Pakiet dowodowy kompletny'
    : `Brakuje: ${missingRequiredPhotoTypes.map((type) => type.label).join(', ')}`;
  const nextRequiredPhotoType = missingRequiredPhotoTypes[0] || fieldPhotoTypeStats[0];
  const fieldPhotoGpsCount = fieldPhotos.filter((photo) => typeof photo.lat === 'number' && typeof photo.lng === 'number').length;
  const fieldPhotoSketchCount = fieldPhotos.filter((photo) => photo.typ === 'szkic').length;
  const photoCaptureTitle = photoPackageReady
    ? 'Pakiet foto jest kompletny'
    : `Następne ujęcie: ${nextRequiredPhotoType.label}`;
  const photoCaptureSub = photoPackageReady
    ? 'Możesz dodać kolejne zdjęcie, jeżeli ekipa ma widzieć więcej detali.'
    : 'Aparat zapisze zdjęcie, typ dowodu i lokalizację GPS, jeżeli telefon ją udostępni.';
  const photoStats: { key: string; label: string; value: string; icon: IoniconName; ok: boolean }[] = [
    { key: 'all', label: 'Zdjęcia', value: String(fieldPhotos.length), icon: 'images-outline', ok: fieldPhotos.length > 0 },
    { key: 'gps', label: 'GPS', value: `${fieldPhotoGpsCount}/${fieldPhotos.length || 0}`, icon: 'navigate-outline', ok: fieldPhotoGpsCount > 0 },
    { key: 'sketch', label: 'Szkic', value: String(fieldPhotoSketchCount), icon: 'create-outline', ok: fieldPhotoSketchCount > 0 },
    { key: 'missing', label: 'Braki', value: String(missingRequiredPhotoTypes.length), icon: 'alert-circle-outline', ok: photoPackageReady },
  ];
  const latestPhotoForSketch = [...fieldPhotos].reverse().find((photo) => photo.typ !== 'szkic') || fieldPhotos[fieldPhotos.length - 1] || null;
  const fieldRiskReady = fieldQuote.risks.length > 0 || !!fieldQuote.access.trim() || !!fieldQuote.notes.trim();
  const fieldRiskSummary = fieldQuote.risks.length
    ? fieldQuote.risks.join(', ')
    : fieldRiskReady
      ? 'opisane w uwagach'
      : 'brak';
  const fieldQuoteProgress = [
    fieldQuote.work.length > 0,
    fieldQuote.equipment.length > 0,
    fieldQuote.people.trim().length > 0,
    fieldQuote.time.trim().length > 0,
    fieldQuote.budget.trim().length > 0,
    fieldRiskReady,
    fieldQuote.result.trim().length > 0,
    photoPackageReady,
  ].filter(Boolean).length;
  const fieldQuoteProgressLabel = `${fieldQuoteProgress}/8`;
  const fieldReadyChecks = [
    { key: 'client', label: 'Klient', ok: !!form.klient_nazwa.trim(), icon: 'person-outline' as IoniconName },
    { key: 'address', label: 'Adres', ok: !!form.adres.trim() && !!form.miasto.trim(), icon: 'location-outline' as IoniconName },
    { key: 'scope', label: 'Zakres', ok: fieldQuote.work.length > 0, icon: 'list-outline' as IoniconName },
    { key: 'time', label: 'Czas', ok: !!fieldQuote.time.trim() || !!form.czas_planowany_godziny.trim(), icon: 'time-outline' as IoniconName },
    { key: 'risk', label: 'BHP', ok: fieldRiskReady, icon: 'shield-checkmark-outline' as IoniconName },
    { key: 'photos', label: 'Zdjęcia', ok: photoPackageReady, icon: 'camera-outline' as IoniconName },
  ];
  const fieldReadyCount = fieldReadyChecks.filter((item) => item.ok).length;
  const fieldPhotoSummary = fieldPhotos.length
    ? `Dokumentacja terenowa: ${fieldPhotos.length} zdjęć (${fieldPhotoTypeStats.map((type) => `${type.label}: ${type.count}`).join(', ')}).`
    : 'Dokumentacja terenowa: brak zdjęć w momencie zapisu.';
  const selectedTeam = form.ekipa_id
    ? ekipy.find((team) => String(team.id) === String(form.ekipa_id))
    : null;
  const selectedTeamName = selectedTeam?.nazwa || (form.ekipa_id ? `Ekipa #${form.ekipa_id}` : '');
  const selectedTeamLoadMinutes = selectedTeam ? teamLoadMinutes(selectedTeam) : 0;
  const selectedTeamFreeMinutes = selectedTeam ? teamFreeMinutes(selectedTeam) : 0;
  const selectedTeamLoadPercent = selectedTeam ? teamLoadPercent(selectedTeam) : 0;
  const planWindowCanFit = !selectedTeam || selectedTeamFreeMinutes >= requestedPlanMinutes;
  const planWindowTitle = !selectedTeam
    ? 'Biuro dobierze ekipę'
    : planWindowCanFit
      ? 'Termin wyglada bezpiecznie'
      : 'Ryzyko konfliktu terminu';
  const planWindowSub = !selectedTeam
    ? 'Zapiszesz draft bez obsady albo wybierzesz ekipę ręcznie.'
    : planWindowCanFit
      ? `Potrzeba ${requestedPlanMinutes} min, wolne ${selectedTeamFreeMinutes} min.`
      : `Potrzeba ${requestedPlanMinutes} min, wolne tylko ${selectedTeamFreeMinutes} min.`;
  const assignmentModeTitle = assignmentMode === 'auto' ? 'Auto dobiera ekipę' : 'Wybór ręczny';
  const assignmentModeSub = assignmentMode === 'auto'
    ? suggestedTeamName
      ? `${suggestedTeamName} - ${suggestedRecommendation?.reasons.join(' / ') || 'najlepsza propozycja'}`
      : 'Brak dostępnej ekipy w oddziale lub delegacji.'
    : selectedTeamName
      ? `${selectedTeamName} wybrana ręcznie`
      : 'Biuro może dobrać ekipę później.';
  const fieldPlannedValue = form.wartosc_planowana || fieldQuote.acceptedPrice || fieldQuote.budget;
  const fieldPlannedTime = form.czas_planowany_godziny || fieldQuote.time;
  const clientWantsTerm = isClientAcceptedForPlanning(fieldQuote.result);
  const officeHandoffChecks = [
    { key: 'result', label: 'Akceptacja', ok: clientWantsTerm, icon: 'flag-outline' as IoniconName },
    { key: 'price', label: 'Cena', ok: !!fieldPlannedValue.trim(), icon: 'cash-outline' as IoniconName },
    { key: 'slot', label: 'Termin', ok: !!form.data_planowana.trim() && !!form.godzina_rozpoczecia.trim() && !!fieldPlannedTime.trim(), icon: 'calendar-outline' as IoniconName },
    { key: 'team', label: 'Ekipa', ok: !!form.ekipa_id.trim(), icon: 'people-outline' as IoniconName },
    { key: 'photos', label: 'Dowody', ok: photoPackageReady, icon: 'camera-outline' as IoniconName },
    { key: 'risk', label: 'BHP', ok: fieldRiskReady, icon: 'shield-checkmark-outline' as IoniconName },
  ];
  const officeHandoffReadyCount = officeHandoffChecks.filter((check) => check.ok).length;
  const officeHandoffReady = officeHandoffReadyCount === officeHandoffChecks.length;
  const fieldCreateStatus = fieldQuoteMode
    ? (officeHandoffReady ? TASK_STATUS.DO_ZATWIERDZENIA : TASK_STATUS.WYCENA_TERENOWA)
    : TASK_STATUS.NOWE;
  const fieldCreateStatusLabel = fieldCreateStatus === TASK_STATUS.DO_ZATWIERDZENIA
    ? 'Do zatwierdzenia w biurze'
    : clientWantsTerm
      ? 'Wycena terenowa - akceptacja jest, plan do dopięcia'
      : 'Wycena terenowa - czeka na akceptację albo opracowanie';
  const quickSprintSteps = [
    {
      key: 'client',
      label: 'Klient i adres',
      detail: form.klient_nazwa.trim() && form.adres.trim() ? 'dane są' : 'wpisz minimum',
      ok: !!form.klient_nazwa.trim() && !!form.adres.trim() && !!form.miasto.trim(),
      icon: 'person-outline' as IoniconName,
    },
    {
      key: 'scope',
      label: 'Zakres prac',
      detail: fieldQuote.work.length ? fieldQuote.work.join(', ') : 'wybierz zakres',
      ok: fieldQuote.work.length > 0,
      icon: 'list-outline' as IoniconName,
    },
    {
      key: 'photos',
      label: 'Zdjęcia',
      detail: photoPackageReady ? 'pakiet kompletny' : photoPackageLabel,
      ok: photoPackageReady,
      icon: 'camera-outline' as IoniconName,
    },
    {
      key: 'numbers',
      label: 'Cena i czas',
      detail: fieldPlannedValue && fieldPlannedTime ? `${fieldPlannedValue} PLN · ${fieldPlannedTime} h` : 'uzupełnij szacunek',
      ok: !!fieldPlannedValue.trim() && !!fieldPlannedTime.trim(),
      icon: 'calculator-outline' as IoniconName,
    },
    {
      key: 'risk',
      label: 'Ryzyka / BHP',
      detail: fieldRiskReady ? fieldRiskSummary : 'zaznacz ryzyko albo brak ryzyk',
      ok: fieldRiskReady,
      icon: 'shield-checkmark-outline' as IoniconName,
    },
    {
      key: 'handoff',
      label: 'Akceptacja',
      detail: clientWantsTerm ? 'klient chce termin' : fieldQuote.result || 'wynik rozmowy',
      ok: clientWantsTerm,
      icon: 'flag-outline' as IoniconName,
    },
  ];
  const quickSprintReadyCount = quickSprintSteps.filter((step) => step.ok).length;
  const quickSprintNextStep = quickSprintSteps.find((step) => !step.ok);
  const officeHandoffTitle = officeHandoffReady
    ? 'Gotowe do zatwierdzenia przez biuro'
    : clientWantsTerm
      ? 'Klient zaakceptował - dopnij plan'
      : 'Oględziny zapiszą się jako draft';
  const officeHandoffSub = [
    fieldQuote.result || 'Bez wyniku rozmowy',
    selectedTeamName || 'ekipa do wyboru',
    form.data_planowana ? `${form.data_planowana}${form.godzina_rozpoczecia ? ` ${form.godzina_rozpoczecia}` : ''}` : 'termin do ustalenia',
  ].join(' · ');
  const officeHandoffSummary = [
    'PRZEKAZANIE DO BIURA',
    `Gotowosc: ${officeHandoffReadyCount}/${officeHandoffChecks.length}`,
    `Status po zapisie: ${fieldCreateStatusLabel}`,
    `Akceptacja klienta: ${clientWantsTerm ? 'TAK - planowac termin' : 'NIE / do decyzji'}`,
    `Wynik rozmowy: ${fieldQuote.result || '-'}`,
    `Proponowana ekipa: ${selectedTeamName || '-'}`,
    `Proponowany termin: ${form.data_planowana || '-'} ${form.godzina_rozpoczecia || ''}`.trim(),
    `Szacowany czas: ${fieldPlannedTime ? `${fieldPlannedTime} h` : '-'}`,
    `Cena / budzet: ${fieldPlannedValue ? `${fieldPlannedValue} PLN` : '-'}`,
    `Ryzyka / BHP: ${fieldRiskSummary}`,
    `Pakiet zdjęć: ${photoPackageLabel}`,
    clientWantsTerm ? 'Priorytet biura: klient jest gotowy na termin, sprawdzić kalendarz i potwierdzić.' : '',
  ].filter(Boolean).join('\n');
  const photoPackageShort = photoPackageReady
    ? 'komplet'
    : `${missingRequiredPhotoTypes.length} brak`;
  const fieldHeroMetrics = [
    {
      key: 'photos',
      label: 'Dowody',
      value: String(fieldPhotos.length),
      sub: photoPackageShort,
      icon: 'camera-outline' as IoniconName,
      ok: photoPackageReady,
    },
    {
      key: 'scope',
      label: 'Zakres',
      value: String(fieldQuote.work.length),
      sub: fieldQuote.work.length ? 'wybrano' : 'brak',
      icon: 'list-outline' as IoniconName,
      ok: fieldQuote.work.length > 0,
    },
    {
      key: 'estimate',
      label: 'Cena / czas',
      value: fieldPlannedValue || '-',
      sub: fieldPlannedTime ? `${fieldPlannedTime} h` : 'czas?',
      icon: 'calculator-outline' as IoniconName,
      ok: !!fieldPlannedValue.trim() && !!fieldPlannedTime.trim(),
    },
    {
      key: 'team',
      label: 'Ekipa',
      value: selectedTeamName || 'Biuro',
      sub: selectedTeamName ? 'propozycja' : 'dobierze',
      icon: 'people-outline' as IoniconName,
      ok: !!selectedTeamName,
    },
    {
      key: 'risk',
      label: 'BHP',
      value: fieldQuote.risks.length ? String(fieldQuote.risks.length) : '-',
      sub: fieldRiskReady ? 'opisane' : 'brak',
      icon: 'shield-checkmark-outline' as IoniconName,
      ok: fieldRiskReady,
    },
  ];
  const drawCanvasWidth = Math.max(280, Math.min(screenWidth - 24, 520));
  const drawCanvasHeight = Math.round(drawCanvasWidth * 1.16);
  const prefillInspectionId = paramString(params.inspectionId);
  const intakeSourceRaw = paramString(params.source);
  const intakeSourceLabel = prefillInspectionId
    ? `Oględziny #${prefillInspectionId}`
    : fieldDraftSourceCopy(intakeSourceRaw).header;
  const intakeModeLabel = fieldQuoteMode ? 'Tryb terenowy' : 'Tryb biurowy';
  const intakeChecks: { key: string; label: string; ok: boolean; icon: IoniconName }[] = [
    {
      key: 'client',
      label: 'Klient',
      ok: !!form.klient_nazwa.trim() && !!form.klient_telefon.trim(),
      icon: 'person-outline',
    },
    {
      key: 'address',
      label: 'Adres',
      ok: !!form.adres.trim() && !!form.miasto.trim(),
      icon: 'location-outline',
    },
    {
      key: 'scope',
      label: fieldQuoteMode ? 'Zakres' : 'Usługa',
      ok: fieldQuoteMode ? fieldQuote.work.length > 0 : !!form.typ_uslugi.trim(),
      icon: 'list-outline',
    },
    {
      key: 'proof',
      label: fieldQuoteMode ? 'Foto' : 'Plan',
      ok: fieldQuoteMode
        ? photoPackageReady
        : !!form.data_planowana.trim() && !!form.godzina_rozpoczecia.trim(),
      icon: fieldQuoteMode ? 'camera-outline' : 'calendar-outline',
    },
  ];
  const intakeReadyCount = intakeChecks.filter((check) => check.ok).length;
  const nextIntakeCheck = intakeChecks.find((check) => !check.ok);
  const intakeHint = nextIntakeCheck
    ? `Następny krok: ${nextIntakeCheck.label.toLowerCase()}`
    : fieldQuoteMode
      ? 'Pakiet terenowy gotowy do przekazania'
      : 'Formularz biurowy jest gotowy do zapisu';
  const officeIntakeChecks: { key: string; label: string; detail: string; ok: boolean; icon: IoniconName }[] = [
    {
      key: 'client',
      label: 'Klient',
      detail: form.klient_nazwa.trim() ? form.klient_nazwa.trim() : 'wpisz imie, nazwisko albo firme',
      ok: !!form.klient_nazwa.trim(),
      icon: 'person-outline',
    },
    {
      key: 'phone',
      label: 'Telefon',
      detail: form.klient_telefon.trim() ? form.klient_telefon.trim() : 'numer do oddzwonienia',
      ok: !!form.klient_telefon.trim(),
      icon: 'call-outline',
    },
    {
      key: 'address',
      label: 'Adres',
      detail: form.adres.trim() && form.miasto.trim() ? [form.adres, form.miasto].filter(Boolean).join(', ') : 'adres ogledzin',
      ok: !!form.adres.trim() && !!form.miasto.trim(),
      icon: 'location-outline',
    },
    {
      key: 'slot',
      label: 'Termin',
      detail: form.godzina_rozpoczecia.trim()
        ? `${form.data_planowana || 'dzis'} ${form.godzina_rozpoczecia}`
        : 'data i godzina ogledzin',
      ok: !!form.data_planowana.trim() && !!form.godzina_rozpoczecia.trim(),
      icon: 'calendar-outline',
    },
    {
      key: 'service',
      label: 'Zakres wstepny',
      detail: form.typ_uslugi || 'typ uslugi',
      ok: !!form.typ_uslugi.trim(),
      icon: 'leaf-outline',
    },
  ];
  const officeIntakeReadyCount = officeIntakeChecks.filter((check) => check.ok).length;
  const officeIntakeNext = officeIntakeChecks.find((check) => !check.ok) || null;
  const fieldSubmitTitle = officeHandoffReady ? 'Komplet do biura' : clientWantsTerm ? 'Draft z akceptacją' : 'Draft terenowy';
  const fieldSubmitSub = officeHandoffReady
    ? 'Zdjęcia, decyzja, cena, termin i ekipa są gotowe do zatwierdzenia.'
    : `Możesz zapisać draft teraz. Brakuje jeszcze: ${officeHandoffChecks.filter((check) => !check.ok).map((check) => check.label).join(', ') || 'nic'}.`;
  const fieldPrimarySubmitLabel = officeHandoffReady
    ? 'Wyślij komplet do biura'
    : clientWantsTerm
      ? 'Zapisz draft z akceptacją'
      : 'Zapisz draft terenowy';
  const fieldJourneySteps = [
    {
      key: 'phone',
      title: 'Telefon',
      detail: form.klient_nazwa.trim() && form.klient_telefon.trim() ? 'zgłoszenie przyjęte' : 'wpisz klienta i telefon',
      ok: !!form.klient_nazwa.trim() && !!form.klient_telefon.trim(),
      icon: 'call-outline' as IoniconName,
    },
    {
      key: 'visit',
      title: 'Oględziny',
      detail: photoPackageReady && fieldQuote.work.length ? 'foto, szkic i zakres są' : photoPackageLabel,
      ok: photoPackageReady && fieldQuote.work.length > 0,
      icon: 'camera-outline' as IoniconName,
    },
    {
      key: 'office',
      title: 'Biuro',
      detail: officeHandoffReady ? 'tylko zatwierdzić plan' : clientWantsTerm ? 'dopięcie ekipy i terminu' : 'czeka na akceptację',
      ok: officeHandoffReady,
      icon: 'business-outline' as IoniconName,
    },
    {
      key: 'crew',
      title: 'Ekipa',
      detail: selectedTeamName ? selectedTeamName : 'biuro dobierze ekipę',
      ok: officeHandoffReady && !!selectedTeamName,
      icon: 'people-circle-outline' as IoniconName,
    },
  ];

  const drawPanResponder = useMemo(
    () => PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        const { locationX, locationY } = evt.nativeEvent;
        const next = `M ${locationX.toFixed(1)} ${locationY.toFixed(1)}`;
        drawPathRef.current = next;
        setDrawCurrentPath(next);
      },
      onPanResponderMove: (evt) => {
        if (!drawPathRef.current) return;
        const { locationX, locationY } = evt.nativeEvent;
        const next = `${drawPathRef.current} L ${locationX.toFixed(1)} ${locationY.toFixed(1)}`;
        drawPathRef.current = next;
        setDrawCurrentPath(next);
      },
      onPanResponderRelease: () => {
        if (!drawPathRef.current) return;
        const stroke = { path: drawPathRef.current, color: drawColor, width: drawWidth };
        setDrawStrokes((prev) => [...prev, stroke]);
        drawPathRef.current = '';
        setDrawCurrentPath('');
      },
      onPanResponderTerminate: () => {
        if (!drawPathRef.current) return;
        const stroke = { path: drawPathRef.current, color: drawColor, width: drawWidth };
        setDrawStrokes((prev) => [...prev, stroke]);
        drawPathRef.current = '';
        setDrawCurrentPath('');
      },
    }),
    [drawColor, drawWidth],
  );

  const openDrawEditor = (photo: FieldPhotoDraft) => {
    setDrawPhoto(photo);
    setDrawStrokes([]);
    setDrawCurrentPath('');
    drawPathRef.current = '';
    setDrawColor(DRAW_COLORS[0]);
    setDrawWidth(6);
    void triggerHaptic('light');
  };

  const openSketchShortcut = () => {
    if (latestPhotoForSketch) {
      openDrawEditor(latestPhotoForSketch);
      return;
    }
    setPhotoType('szkic');
    void addFieldPhoto('camera', 'szkic');
  };

  const callClient = async () => {
    const phone = form.klient_telefon.replace(/[^\d+]/g, '');
    if (!phone) {
      setError('Najpierw wpisz numer klienta.');
      return;
    }
    try {
      const url = `tel:${phone}`;
      const canOpen = await Linking.canOpenURL(url);
      if (!canOpen) throw new Error('tel_unavailable');
      await Linking.openURL(url);
    } catch {
      setError('Nie udało się otworzyć telefonu.');
    }
  };

  const openClientMap = async () => {
    if (!form.adres.trim() && !form.miasto.trim()) {
      setError('Najpierw wpisz adres albo miasto.');
      return;
    }
    const result = await openAddressInMaps(form.adres, form.miasto);
    if (!result.ok) {
      setError(result.reason === 'missing-address' ? 'Najpierw wpisz adres albo miasto.' : 'Nie udało się otworzyć map.');
    }
  };

  const applyFieldPreset = (preset: FieldPreset) => {
    setFieldQuote((prev) => ({
      ...prev,
      work: mergeUniqueProtocolValues(prev.work, preset.work),
      equipment: mergeUniqueProtocolValues(prev.equipment, preset.equipment),
      risks: mergeUniqueProtocolValues(prev.risks, preset.risks),
      people: preset.people || prev.people,
      time: preset.time || prev.time,
      notes: prev.notes
        ? `${prev.notes}\n${preset.notes}`
        : preset.notes,
    }));
    setForm((current) => ({
      ...current,
      typ_uslugi: preset.typUslugi || current.typ_uslugi,
      czas_planowany_godziny: preset.time || current.czas_planowany_godziny,
    }));
    void triggerHaptic('light');
  };

  useEffect(() => { void loadData(); }, [loadData]);

  const closeDrawEditor = () => {
    setDrawPhoto(null);
    setDrawStrokes([]);
    setDrawCurrentPath('');
    drawPathRef.current = '';
    setDrawSaving(false);
  };

  const saveDrawEditor = async () => {
    if (!drawPhoto || drawSaving) return;
    setDrawSaving(true);
    try {
      await new Promise((resolve) => setTimeout(resolve, 60));
      const capturedUri = await drawShotRef.current?.capture?.();
      if (!capturedUri) {
        setError('Nie udało się zapisać rysunku. Spróbuj jeszcze raz.');
        return;
      }
      const opis = drawPhoto.opis.includes('Szkic zakresu')
        ? drawPhoto.opis
        : `${drawPhoto.opis}\nSzkic zakresu dodany w aplikacji.`;
      setFieldPhotos((prev) =>
        prev.map((photo) =>
          photo.id === drawPhoto.id
            ? {
                ...photo,
                uri: capturedUri,
                typ: 'szkic',
                label: 'Szkic',
                opis,
                createdAt: new Date().toISOString(),
              }
            : photo,
        ),
      );
      void triggerHaptic('success');
      closeDrawEditor();
    } catch {
      setError('Nie udało się zapisać rysunku. Spróbuj jeszcze raz.');
      setDrawSaving(false);
    }
  };

  const capturePhotoGps = async () => {
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== 'granted') return null;
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      return { lat: pos.coords.latitude, lng: pos.coords.longitude };
    } catch {
      return null;
    }
  };

  const addPickedPhotos = async (
    assets: ImagePicker.ImagePickerAsset[],
    source: FieldPhotoSource,
    forcedType?: FieldPhotoType,
  ) => {
    const effectiveType = forcedType || photoType;
    const typeMeta = FIELD_PHOTO_TYPES.find((x) => x.key === effectiveType) || FIELD_PHOTO_TYPES[0];
    const coords = source === 'camera' ? await capturePhotoGps() : null;
    const opis = photoOpis.trim() || `Dokumentacja terenowa: ${typeMeta.label}`;
    const createdAt = new Date().toISOString();
    const next = assets
      .filter((asset) => !!asset.uri)
      .map((asset) => ({
        id: createLocalPhotoId(),
        uri: asset.uri,
        typ: effectiveType,
        label: typeMeta.label,
        opis,
        source,
        createdAt,
        ...(coords ? { lat: coords.lat, lng: coords.lng } : {}),
      }));
    if (!next.length) return;
    setFieldPhotos((prev) => [...prev, ...next]);
    const mergedPreview = [...fieldPhotos, ...next];
    const followUpType = REQUIRED_FIELD_PHOTO_TYPES.find(
      (type) => !mergedPreview.some((photo) => photo.typ === type),
    );
    setPhotoType(followUpType || effectiveType);
    setPhotoOpis('');
    void triggerHaptic('success');
    if (source === 'camera' && effectiveType === 'szkic' && next[0]) {
      setTimeout(() => openDrawEditor(next[0]), 280);
    }
  };

  const addFieldPhoto = async (source: FieldPhotoSource, forcedType?: FieldPhotoType) => {
    if (forcedType) setPhotoType(forcedType);
    setPhotoBusy(true);
    try {
      if (source === 'camera') {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (perm.status !== 'granted') {
          void triggerHaptic('warning');
          setError('Włącz dostęp do aparatu, żeby dodać zdjęcie z terenu.');
          return;
        }
        const picked = await ImagePicker.launchCameraAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Images,
          quality: 0.82,
          allowsEditing: false,
        });
        if (!picked.canceled && picked.assets?.[0]) {
          await addPickedPhotos([picked.assets[0]], source, forcedType);
        }
        return;
      }

      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (perm.status !== 'granted') {
        void triggerHaptic('warning');
        setError('Włącz dostęp do galerii, żeby dodać zdjęcia.');
        return;
      }
      const picked = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.82,
        allowsMultipleSelection: true,
      });
      if (!picked.canceled) {
        await addPickedPhotos(picked.assets || [], source, forcedType);
      }
    } finally {
      setPhotoBusy(false);
    }
  };

  const removeFieldPhoto = (photoId: string) => {
    setFieldPhotos((prev) => prev.filter((p) => p.id !== photoId));
  };

  const uploadFieldPhotosForTask = async (taskId: string, authToken: string) => {
    let uploaded = 0;
    let queued = 0;
    let failed = 0;

    for (const photo of fieldPhotos) {
      const idempotencyKey = createOfflineRequestId(`task-${taskId}-${photo.typ}`);
      try {
        const formData = new FormData();
        formData.append('typ', photo.typ);
        formData.append('opis', photo.opis);
        formData.append('tagi', `wycena,teren,${photo.typ}`);
        if (photo.lat != null && Number.isFinite(photo.lat)) formData.append('lat', String(photo.lat));
        if (photo.lng != null && Number.isFinite(photo.lng)) formData.append('lon', String(photo.lng));
        formData.append('zdjecie', {
          uri: photo.uri,
          name: photoFileName(photo),
          type: 'image/jpeg',
        } as any);

        const res = await fetchWithTimeout(apiUrl(`/tasks/${taskId}/zdjecia`), {
          method: 'POST',
          headers: authHeaders(authToken, { 'Idempotency-Key': idempotencyKey }),
          body: formData,
        }, 45_000);

        if (res.ok) {
          uploaded += 1;
        } else if (res.status >= 500) {
          queued = await queueTaskPhotoOffline({
            id: idempotencyKey,
            url: apiUrl(`/tasks/${taskId}/zdjecia`),
            fileUri: photo.uri,
            typ: photo.typ,
            lat: photo.lat,
            lng: photo.lng,
            opis: photo.opis,
            tagi: `wycena,teren,${photo.typ}`,
          });
        } else {
          failed += 1;
        }
      } catch {
        queued = await queueTaskPhotoOffline({
          id: idempotencyKey,
          url: apiUrl(`/tasks/${taskId}/zdjecia`),
          fileUri: photo.uri,
          typ: photo.typ,
          lat: photo.lat,
          lng: photo.lng,
          opis: photo.opis,
          tagi: `wycena,teren,${photo.typ}`,
        });
      }
    }

    return { uploaded, queued, failed };
  };

  const saveInspectionStatusNote = async (
    inspectionId: string,
    authToken: string,
    note: string,
  ) => {
    const requestId = createOfflineRequestId(`ogledziny-${inspectionId}-draft-status`);
    const body = {
      status: 'Zakonczone',
      notatki_wyniki: note,
    };
    try {
      const res = await apiJsonFetch(`/ogledziny/${inspectionId}/status`, {
        method: 'PUT',
        token: authToken,
        headers: { 'Idempotency-Key': requestId },
        body: JSON.stringify(body),
      });
      if (res.ok) return { ok: true, queued: false };
      if (res.status >= 500) {
        await enqueueOfflineRequest({
          id: requestId,
          dedupeKey: `ogledziny:${inspectionId}:draft-status`,
          url: apiUrl(`/ogledziny/${inspectionId}/status`),
          method: 'PUT',
          body,
        });
        return { ok: true, queued: true };
      }
      return { ok: false, queued: false };
    } catch {
      await enqueueOfflineRequest({
        id: requestId,
        dedupeKey: `ogledziny:${inspectionId}:draft-status`,
        url: apiUrl(`/ogledziny/${inspectionId}/status`),
        method: 'PUT',
        body,
      });
      return { ok: true, queued: true };
    }
  };

  const linkInspectionWithDraft = async (args: {
    inspectionId: string;
    authToken: string;
    taskId?: string | number | null;
    wycenaId?: string | number | null;
    photoResult?: { uploaded: number; queued: number; failed: number } | null;
  }) => {
    const inspectionId = String(args.inspectionId || '').trim();
    if (!inspectionId) return '';

    const taskId = args.taskId ? String(args.taskId) : '';
    const wycenaId = args.wycenaId ? Number(args.wycenaId) : NaN;
    const note = [
      `Draft terenowy zapisany w aplikacji mobilnej${taskId ? ` jako zlecenie #${taskId}` : ''}.`,
      Number.isFinite(wycenaId) ? `Powiązana wycena: #${wycenaId}.` : 'Brak ID wyceny z odpowiedzi serwera - zapisano samo zakończenie oględzin.',
      args.photoResult
        ? `Zdjęcia terenowe: wysłano ${args.photoResult.uploaded}, kolejka offline ${args.photoResult.queued}, błędy ${args.photoResult.failed}.`
        : `Zdjęcia terenowe: ${fieldPhotos.length}.`,
      'Dla biura: sprawdzić opis, termin ekipy, rezerwację czasu i szczegóły z klientem.',
    ].join('\n');

    let linked = false;
    let queued = false;
    if (Number.isFinite(wycenaId) && wycenaId > 0) {
      const requestId = createOfflineRequestId(`ogledziny-${inspectionId}-wycena-${wycenaId}`);
      const body = { wycena_id: wycenaId };
      try {
        const res = await apiJsonFetch(`/ogledziny/${inspectionId}/wycena`, {
          method: 'POST',
          token: args.authToken,
          headers: { 'Idempotency-Key': requestId },
          body: JSON.stringify(body),
        });
        if (res.ok) {
          linked = true;
        } else if (res.status >= 500) {
          await enqueueOfflineRequest({
            id: requestId,
            dedupeKey: `ogledziny:${inspectionId}:wycena`,
            url: apiUrl(`/ogledziny/${inspectionId}/wycena`),
            method: 'POST',
            body,
          });
          queued = true;
        }
      } catch {
        await enqueueOfflineRequest({
          id: requestId,
          dedupeKey: `ogledziny:${inspectionId}:wycena`,
          url: apiUrl(`/ogledziny/${inspectionId}/wycena`),
          method: 'POST',
          body,
        });
        queued = true;
      }
    }

    const statusResult = await saveInspectionStatusNote(inspectionId, args.authToken, note);
    queued = queued || statusResult.queued;

    if (linked && statusResult.ok) return 'powiązano z wyceną i zamknięto wizytę.';
    if (queued) return 'powiązanie/zamknięcie zapisane w kolejce offline.';
    if (statusResult.ok) return 'zamknięto wizytę i zapisano notatkę dla biura.';
    return 'draft zapisany, ale nie udało się domknąć oględzin automatycznie.';
  };

  const nextInspectionRoute = (item: NextInspectionCandidate) =>
    buildNewOrderRoute({
      source: 'next-ogledziny',
      inspectionId: String(item.id),
      klient: item.klient_nazwa || '',
      telefon: item.klient_telefon || '',
      adres: item.adres || '',
      miasto: item.miasto || '',
      data: datePart(item.data_planowana),
      godzina: timePart(item.data_planowana),
      notatki: item.notatki || '',
    });

  const nextInspectionLabel = (item: NextInspectionCandidate) => {
    const when = [datePart(item.data_planowana), timePart(item.data_planowana)].filter(Boolean).join(' ');
    const client = item.klient_nazwa || `Ogledziny #${item.id}`;
    const place = [item.adres, item.miasto].filter(Boolean).join(', ');
    return [when, client, place].filter(Boolean).join(' - ');
  };

  const loadNextInspectionCandidate = async (authToken: string) => {
    const currentId = prefillInspectionId ? String(prefillInspectionId) : '';
    try {
      const res = await apiFetch('/ogledziny', { token: authToken });
      if (!res.ok) return null;
      const data = await res.json();
      const list: NextInspectionCandidate[] = Array.isArray(data) ? data : [];
      const todayKey = new Date().toISOString().split('T')[0];
      const userId = user?.id != null ? String(user.id) : '';
      const userOddzialId = user?.oddzial_id != null ? String(user.oddzial_id) : '';
      const current = list.find((item) => String(item.id) === currentId) || null;
      const currentTime = current ? inspectionTimeValue(current) : 0;
      const candidates = list
        .filter((item) => {
          const sameDay = !!item.data_planowana && datePart(item.data_planowana) === todayKey;
          const sameOddzial = !userOddzialId || !item.oddzial_id || String(item.oddzial_id) === userOddzialId;
          const assignedToUser = !item.wyceniajacy_id || !userId || String(item.wyceniajacy_id) === userId;
          return sameDay && sameOddzial && assignedToUser && isOpenInspection(item) && String(item.id) !== currentId;
        })
        .sort((a, b) => inspectionTimeValue(a) - inspectionTimeValue(b));
      return candidates.find((item) => inspectionTimeValue(item) >= currentTime) || candidates[0] || null;
    } catch {
      return null;
    }
  };

  const showFieldDraftSavedAlert = (args: {
    message: string;
    createdId?: string | number | null;
    nextInspection?: NextInspectionCandidate | null;
    afterCreate: 'back' | 'photos';
    readyForOffice?: boolean;
    photoResult?: { uploaded: number; queued: number; failed: number } | null;
  }) => {
    const buttons: { text: string; style?: 'default' | 'cancel' | 'destructive'; onPress?: () => void }[] = [];
    if (args.nextInspection) {
      buttons.push({
        text: 'Nastepne ogledziny',
        onPress: () => router.replace(nextInspectionRoute(args.nextInspection!) as never),
      });
    }
    if (args.createdId) {
      buttons.push({
        text: args.afterCreate === 'photos' ? 'Zdjęcia' : 'Karta zlecenia',
        onPress: () => router.replace(`/zlecenie/${args.createdId}${args.afterCreate === 'photos' ? '?tab=zdjecia' : ''}` as never),
      });
    }
    buttons.push({
      text: args.nextInspection ? 'Plan dnia' : 'Plan ogledzin',
      onPress: () => router.replace({ pathname: '/plan-ogledzin' as never, params: { pickNext: '1' } } as never),
    });
    if (!args.createdId && !args.nextInspection) {
      buttons.push({
        text: 'Zostań',
        style: 'cancel',
      });
    }
    const statusLine = args.readyForOffice
      ? 'Status: komplet do biura, mozna planowac ekipe.'
      : 'Status: draft terenowy, biuro widzi co jeszcze trzeba domknac.';
    const uploadLine = args.photoResult
      ? `Zdjecia: ${args.photoResult.uploaded} wyslano, ${args.photoResult.queued} w kolejce, ${args.photoResult.failed} bledy.`
      : '';
    const nextLine = args.nextInspection
      ? `Nastepne: ${nextInspectionLabel(args.nextInspection)}`
      : 'Nastepne: wybierz kolejna wizyte z planu dnia.';
    Alert.alert(
      'Pakiet terenowy zapisany',
      [statusLine, args.message, uploadLine, nextLine].filter(Boolean).join('\n'),
      buttons.slice(0, 3),
    );
  };

  const handleSubmit = async (
    afterCreate: 'back' | 'photos' = 'back',
    options: { allowMissingPhotos?: boolean; allowIncompleteHandoff?: boolean; forceNoTeam?: boolean } = {},
  ) => {
    setError(null);
    const effectiveForm = options.forceNoTeam ? { ...form, ekipa_id: '' } : form;
    const plannedValue = effectiveForm.wartosc_planowana || (fieldQuoteMode ? fieldQuote.acceptedPrice || fieldQuote.budget : '');
    const plannedTime = effectiveForm.czas_planowany_godziny || (fieldQuoteMode ? fieldQuote.time : '');
    if (!isTaskCreateFormValid(effectiveForm)) {
      setError(t('newOrder.alert.required'));
      return;
    }
    if (effectiveForm.klient_telefon && !isValidPolishPhone(effectiveForm.klient_telefon)) {
      setError(t('newOrder.alert.badPhone'));
      return;
    }
    if (effectiveForm.data_planowana && !isValidIsoDate(effectiveForm.data_planowana)) {
      setError(t('newOrder.alert.badDate'));
      return;
    }
    if (effectiveForm.godzina_rozpoczecia && !isValidTimeHHMM(effectiveForm.godzina_rozpoczecia)) {
      setError(t('newOrder.alert.badTime'));
      return;
    }
    if (
      (plannedValue && !isPositiveNumber(plannedValue)) ||
      (plannedTime && !isPositiveNumber(plannedTime))
    ) {
      setError(t('newOrder.alert.badNumbers'));
      return;
    }
    if (fieldQuoteMode && fieldPhotos.length === 0) {
      void triggerHaptic('warning');
      setError('Dodaj minimum jedno zdjęcie z oględzin. To jest dowód zakresu dla klienta i instrukcja dla ekipy.');
      return;
    }
    if (fieldQuoteMode && missingRequiredPhotoTypes.length > 0 && !options.allowMissingPhotos) {
      void triggerHaptic('warning');
      Alert.alert(
        'Brakuje pakietu zdjęć',
        `${photoPackageLabel}. Najlepiej dodaj komplet przed zapisem, wtedy biuro i ekipa od razu widzą zakres bez dopisywania w Kommo.`,
        [
          { text: 'Dodam teraz', style: 'cancel' },
          {
            text: 'Zapisz mimo braków',
            style: 'destructive',
            onPress: () => {
              void handleSubmit(afterCreate, { ...options, allowMissingPhotos: true });
            },
          },
        ],
      );
      return;
    }
    const bookingIncomplete = clientWantsTerm && (!effectiveForm.ekipa_id || !effectiveForm.godzina_rozpoczecia || !plannedTime);
    if (fieldQuoteMode && bookingIncomplete && !options.allowIncompleteHandoff) {
      void triggerHaptic('warning');
      Alert.alert(
        'Klient chce termin',
        'Brakuje ekipy, godziny albo czasu pracy. Możesz zapisać draft, ale biuro będzie musiało dopiąć plan ręcznie.',
        [
          { text: 'Uzupelnie', style: 'cancel' },
          {
            text: 'Zapisz draft',
            onPress: () => {
              void handleSubmit(afterCreate, { ...options, allowIncompleteHandoff: true });
            },
          },
        ],
      );
      return;
    }
    const fieldNote = fieldQuoteMode
      ? 'TRYB TERENOWY: draft z wyceny u klienta. Biuro powinno zweryfikować opis prac, termin ekipy, rezerwację czasu i szczegóły z klientem.'
      : '';
    const inspectionNote = fieldQuoteMode && prefillInspectionId
      ? `Źródło mobilne: oględziny #${prefillInspectionId}. Po utworzeniu draftu aplikacja zamyka oględziny i podpina wycenę do tej wizyty.`
      : '';
    const conflictFallbackNote = options.forceNoTeam
      ? 'KONFLIKT OBSADY: wybrana ekipa miala zajety termin. Draft zapisano bez ekipy, biuro powinno dobrac inna brygade albo zmienic godzine.'
      : '';
    const notes = [
      fieldNote,
      inspectionNote,
      conflictFallbackNote,
      fieldQuoteMode ? officeHandoffSummary : '',
      fieldQuoteMode ? fieldQuoteSummary : '',
      fieldQuoteMode ? fieldPhotoSummary : '',
      effectiveForm.notatki_wewnetrzne.trim(),
    ].filter(Boolean).join('\n\n');
    const fieldProtocolPayload = fieldQuoteMode ? buildFieldProtocolTaskExtra(fieldQuote) : {};
    const payload = buildTaskCreatePayload(
      {
        ...effectiveForm,
        wartosc_planowana: plannedValue || '',
        czas_planowany_godziny: plannedTime || '',
        ankieta_uproszczona: fieldQuoteMode,
      },
      user,
      {
        initialStatus: fieldCreateStatus,
        extra: {
          ...fieldProtocolPayload,
          wyceniajacy_id: fieldQuoteMode ? user?.id : effectiveForm.wyceniajacy_id || undefined,
          source_ogledziny_id: fieldQuoteMode && prefillInspectionId ? prefillInspectionId : undefined,
          ankieta_uproszczona: fieldQuoteMode,
          notatki_wewnetrzne: notes || null,
        },
      },
    );
    setSaving(true);
    try {
      if (!token) { router.replace('/login'); return; }
      const res = await apiJsonFetch('/tasks/nowe', {
        method: 'POST',
        token,
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        const createdId = data?.id || data?.task?.id || data?.zlecenie?.id;
        const createdWycenaId = data?.wycena_id || data?.wycena?.id || data?.task?.wycena_id || null;
        const photoResult = createdId && fieldPhotos.length
          ? await uploadFieldPhotosForTask(String(createdId), token)
          : null;
        const inspectionLine = prefillInspectionId && createdId
          ? `\nOględziny: ${await linkInspectionWithDraft({
              inspectionId: prefillInspectionId,
              authToken: token,
              taskId: createdId,
              wycenaId: createdWycenaId,
              photoResult,
            })}`
          : '';
        const photoLine = photoResult
          ? `\nZdjęcia: wysłano ${photoResult.uploaded}/${fieldPhotos.length}${photoResult.queued ? `, kolejka offline: ${photoResult.queued}` : ''}${photoResult.failed ? `, błędy: ${photoResult.failed}` : ''}.`
          : fieldPhotos.length && !createdId
            ? '\nZdjęcia nie zostały wysłane, bo serwer nie zwrócił ID zlecenia.'
            : '';
        const nextInspection = fieldQuoteMode ? await loadNextInspectionCandidate(token) : null;
        void triggerHaptic('success');
        await clearLocalDraft();
        if (fieldQuoteMode) {
          const message = fieldPhotos.length || (afterCreate === 'photos' && createdId)
            ? `Dokumentacja terenowa jest podpięta do zlecenia.${photoLine}${inspectionLine}`
            : `${t('newOrder.alert.createdBody', { id: createdId || data.id })}${inspectionLine}`;
          showFieldDraftSavedAlert({
            message,
            createdId,
            nextInspection,
            afterCreate,
            readyForOffice: officeHandoffReady,
            photoResult,
          });
          return;
        }
        if (fieldPhotos.length || (afterCreate === 'photos' && createdId)) {
          if (afterCreate === 'photos' && createdId) {
            Alert.alert('Draft zapisany', `Dokumentacja terenowa jest podpieta do zlecenia.${photoLine}${inspectionLine}`, [
              { text: t('common.ok'), onPress: () => router.replace(`/zlecenie/${createdId}?tab=zdjecia` as never) },
            ]);
          } else {
            Alert.alert(t('newOrder.alert.createdTitle'), `${t('newOrder.alert.createdBody', { id: createdId || data.id })}${photoLine}${inspectionLine}`, [
              { text: t('common.ok'), onPress: () => safeBack() }
            ]);
          }
          return;
        }
        if (afterCreate === 'photos' && createdId) {
          Alert.alert('Draft zapisany', `Teraz dodaj zdjęcia i szkic zakresu dla biura i ekipy.${inspectionLine}`, [
            { text: t('common.ok'), onPress: () => router.replace(`/zlecenie/${createdId}?tab=zdjecia` as never) },
          ]);
        } else {
          Alert.alert(t('newOrder.alert.createdTitle'), `${t('newOrder.alert.createdBody', { id: createdId || data.id })}${inspectionLine}`, [
            { text: t('common.ok'), onPress: () => safeBack() }
          ]);
        }
      } else {
        if (data?.code === 'TASK_PLAN_CONFLICT') {
          void triggerHaptic('warning');
          Alert.alert(
            'Konflikt terminu ekipy',
            data.error || 'Ta ekipa ma juz zaplanowana prace albo aktywna rezerwacje w wybranym przedziale.',
            [
              {
                text: 'Inna ekipa',
                style: 'cancel',
                onPress: () => {
                  setAssignmentMode('manual');
                },
              },
              {
                text: 'Plan dnia',
                onPress: () => router.replace({ pathname: '/plan-ogledzin' as never, params: { pickNext: '1' } } as never),
              },
              {
                text: 'Zapisz bez ekipy',
                onPress: () => {
                  setAssignmentMode('manual');
                  setForm((current) => ({ ...current, ekipa_id: '' }));
                  void handleSubmit(afterCreate, {
                    ...options,
                    allowIncompleteHandoff: true,
                    forceNoTeam: true,
                  });
                },
              },
            ],
          );
          return;
        }
        void triggerHaptic('error');
        Alert.alert(t('notif.alert.errorTitle'), data.error || t('newOrder.alert.saveError'));
      }
    } catch {
      await enqueueOfflineRequest({
        url: apiUrl('/tasks/nowe'),
        method: 'POST',
        body: payload as Record<string, unknown>,
      });
      void triggerHaptic('warning');
      if (fieldPhotos.length) {
        Alert.alert(
          t('notif.alert.offlineTitle'),
          'Zlecenie zapisane w kolejce offline. Zostawiam ten formularz otwarty, żeby nie zgubić zdjęć; po synchronizacji wejdź w zlecenie i dodaj je z zakładki Media.',
        );
        return;
      }
      Alert.alert(
        t('notif.alert.offlineTitle'),
        afterCreate === 'photos'
          ? 'Zlecenie zapisane w kolejce offline. Zdjęcia dodasz po synchronizacji.'
          : t('newOrder.alert.offlineBody')
      );
      safeBack();
    } finally {
      setSaving(false);
    }
  };

  const S = makeStyles(theme);

  if (guard.ready && !guard.allowed) {
    return <View style={{ flex: 1, backgroundColor: theme.bg }} />;
  }
  if (!guard.ready) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: theme.bg }}>
        <ActivityIndicator size="large" color={theme.accent} />
      </View>
    );
  }

  return (
    <KeyboardSafeScreen style={{ flex: 1, backgroundColor: theme.bg }}>
      <AppStatusBar />
      <ScrollView
        style={S.container}
        contentContainerStyle={{ paddingBottom: 48, flexGrow: 1 }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
      >
        {error ? <ErrorBanner message={error} /> : null}
        {draftNotice ? (
          <View style={S.draftNotice}>
            <Ionicons name="save-outline" size={16} color={theme.info} />
            <Text style={S.draftNoticeText}>{draftNotice}</Text>
            <TouchableOpacity onPress={() => void clearLocalDraft()} style={S.draftNoticeBtn}>
              <Text style={S.draftNoticeBtnText}>Wyczyść</Text>
            </TouchableOpacity>
          </View>
        ) : null}
        <View style={S.header}>
          <TouchableOpacity onPress={() => safeBack()} style={S.backBtn}>
            <Ionicons name="arrow-back" size={21} color={theme.accent} />
          </TouchableOpacity>
          <View style={S.headerIcon}>
            <Ionicons name={fieldQuoteMode ? 'leaf-outline' : 'business-outline'} size={20} color={theme.accent} />
          </View>
          <View style={S.headerTextBox}>
            <Text style={S.headerEyebrow}>{intakeModeLabel}</Text>
            <Text style={S.headerTitle}>{t('newOrder.title')}</Text>
            <Text style={S.headerSub} numberOfLines={1}>{intakeSourceLabel}</Text>
          </View>
          <View style={S.headerScore}>
            <Text style={S.headerScoreValue}>{intakeReadyCount}/{intakeChecks.length}</Text>
            <Text style={S.headerScoreLabel}>gotowe</Text>
          </View>
        </View>

        {prefillInspectionId ? (
          <View style={S.prefillBanner}>
            <Ionicons name="link-outline" size={16} color={theme.info} />
            <Text style={S.prefillText}>Dane wczytane z oględzin #{prefillInspectionId}. Po zapisie aplikacja podepnie wycenę i zamknie wizytę dla biura.</Text>
          </View>
        ) : null}

        <View style={S.intakePanel}>
          <View style={S.intakePanelHead}>
            <View style={S.intakeBadge}>
              <Ionicons name={fieldQuoteMode ? 'flash-outline' : 'business-outline'} size={17} color={theme.accent} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={S.intakeTitle}>{fieldQuoteMode ? 'Szybka wycena u klienta' : 'Pełne zlecenie biurowe'}</Text>
              <Text style={S.intakeSub}>{intakeHint}</Text>
            </View>
            <View style={S.intakeScore}>
              <Text style={S.intakeScoreText}>{intakeReadyCount}/{intakeChecks.length}</Text>
            </View>
          </View>

          <View style={S.intakeChecks}>
            {intakeChecks.map((check) => (
              <View key={check.key} style={[S.intakeCheck, check.ok && S.intakeCheckOk]}>
                <Ionicons
                  name={check.ok ? 'checkmark-circle' : check.icon}
                  size={14}
                  color={check.ok ? theme.success : theme.textMuted}
                />
                <Text style={[S.intakeCheckText, check.ok && { color: theme.success }]}>{check.label}</Text>
              </View>
            ))}
          </View>

          <View style={S.modeSegment}>
            <TouchableOpacity
              style={[S.modeSegmentBtn, fieldQuoteMode && S.modeSegmentBtnActive]}
              onPress={() => switchIntakeMode(true)}
            >
              <Ionicons name="leaf-outline" size={16} color={fieldQuoteMode ? theme.accentText : theme.textMuted} />
              <Text style={[S.modeSegmentText, fieldQuoteMode && S.modeSegmentTextActive]}>Teren</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[S.modeSegmentBtn, !fieldQuoteMode && S.modeSegmentBtnActive]}
              onPress={() => switchIntakeMode(false)}
            >
              <Ionicons name="desktop-outline" size={16} color={!fieldQuoteMode ? theme.accentText : theme.textMuted} />
              <Text style={[S.modeSegmentText, !fieldQuoteMode && S.modeSegmentTextActive]}>Biuro</Text>
            </TouchableOpacity>
          </View>
        </View>

        {!fieldQuoteMode && (
          <View style={S.officeIntakeCard}>
            <View style={S.officeIntakeHead}>
              <View style={S.officeIntakeIcon}>
                <Ionicons name="call-outline" size={19} color={theme.accent} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={S.officeIntakeTitle}>Telefon od klienta</Text>
                <Text style={S.officeIntakeSub}>
                  To zapisze zgłoszenie jako etap Telefon. Specjalista dostanie potem oględziny w mobilce.
                </Text>
              </View>
              <View style={S.officeIntakeScore}>
                <Text style={S.officeIntakeScoreValue}>{officeIntakeReadyCount}/{officeIntakeChecks.length}</Text>
                <Text style={S.officeIntakeScoreLabel}>start</Text>
              </View>
            </View>
            <View style={S.officeIntakeGrid}>
              {officeIntakeChecks.map((check) => (
                <View key={check.key} style={[S.officeIntakeCheck, check.ok ? S.officeIntakeCheckOk : S.officeIntakeCheckWarn]}>
                  <View style={S.officeIntakeCheckTop}>
                    <Ionicons name={check.ok ? 'checkmark-circle' : check.icon} size={15} color={check.ok ? theme.success : theme.warning} />
                    <Text style={[S.officeIntakeCheckLabel, { color: check.ok ? theme.success : theme.warning }]}>{check.label}</Text>
                  </View>
                  <Text style={S.officeIntakeCheckDetail} numberOfLines={1}>{check.detail}</Text>
                </View>
              ))}
            </View>
            <View style={[S.officeIntakeNext, { borderColor: officeIntakeNext ? theme.warning + '66' : theme.success + '66', backgroundColor: officeIntakeNext ? theme.warningBg : theme.successBg }]}>
              <Ionicons name={officeIntakeNext ? officeIntakeNext.icon : 'checkmark-done-outline'} size={16} color={officeIntakeNext ? theme.warning : theme.success} />
              <Text style={[S.officeIntakeNextText, { color: officeIntakeNext ? theme.warning : theme.success }]} numberOfLines={2}>
                {officeIntakeNext
                  ? `Następny brak: ${officeIntakeNext.label.toLowerCase()}`
                  : 'Zgłoszenie gotowe do zapisania i przekazania na oględziny.'}
              </Text>
            </View>
            <View style={S.officeIntakeActions}>
              <TouchableOpacity
                style={[S.officeIntakePrimary, saving && { opacity: 0.62 }]}
                onPress={() => void handleSubmit('back')}
                disabled={saving}
              >
                <Ionicons name="save-outline" size={16} color={theme.accentText} />
                <Text style={S.officeIntakePrimaryText}>{saving ? 'Zapisuję...' : 'Zapisz zgłoszenie'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={S.officeIntakeSecondary} onPress={() => switchIntakeMode(true)}>
                <Ionicons name="leaf-outline" size={16} color={theme.accent} />
                <Text style={S.officeIntakeSecondaryText}>Tryb terenowy</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {fieldQuoteMode && (
          <View style={S.journeyPanel}>
            <View style={S.journeyHead}>
              <View style={S.journeyIcon}>
                <Ionicons name="trail-sign-outline" size={18} color={theme.accent} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={S.journeyTitle}>Jedna ścieżka zlecenia</Text>
                <Text style={S.journeySub}>Od telefonu do ekipy, bez osobnych formularzy i przepisywania danych.</Text>
              </View>
            </View>
            <View style={S.journeySteps}>
              {fieldJourneySteps.map((step, index) => (
                <View key={step.key} style={[S.journeyStep, step.ok ? S.journeyStepOk : S.journeyStepPending]}>
                  <View style={[S.journeyStepNumber, { backgroundColor: step.ok ? theme.success : theme.warning }]}>
                    <Text style={S.journeyStepNumberText}>{index + 1}</Text>
                  </View>
                  <View style={S.journeyStepIcon}>
                    <Ionicons name={step.ok ? 'checkmark-circle' : step.icon} size={17} color={step.ok ? theme.success : theme.warning} />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={S.journeyStepTitle}>{step.title}</Text>
                    <Text style={S.journeyStepDetail} numberOfLines={2}>{step.detail}</Text>
                  </View>
                </View>
              ))}
            </View>
          </View>
        )}

        <View style={S.legacyModeSection}>
          <View style={S.sectionTitleRow}>
            <Ionicons name="flash-outline" size={15} color={theme.accent} />
            <Text style={S.sectionTitle}>Tryb terenowy</Text>
          </View>
          <Text style={S.helperText}>
            Specjalista ds. wyceny tworzy szybki draft u klienta, dodaje zdjęcia i szkic zakresu. Biuro później dopina cenę, ekipę i kalendarz.
          </Text>
          <TouchableOpacity
            style={[S.modeSwitch, fieldQuoteMode && S.modeSwitchActive]}
            onPress={() => switchIntakeMode(!fieldQuoteMode)}
          >
            <View style={[S.modeIcon, { backgroundColor: fieldQuoteMode ? theme.accent + '22' : theme.bg }]}>
              <Ionicons
                name={fieldQuoteMode ? 'flash' : 'business-outline'}
                size={18}
                color={fieldQuoteMode ? theme.accent : theme.textMuted}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[S.modeTitle, fieldQuoteMode && { color: theme.accent }]}>
                {fieldQuoteMode ? 'Szybka wycena u klienta' : 'Pełne zlecenie biurowe'}
              </Text>
              <Text style={S.modeDesc}>
                {fieldQuoteMode ? 'Minimum pól teraz, zdjęcia od razu po zapisie.' : 'Pełne dane bez automatycznego oznaczenia wyceny terenowej.'}
              </Text>
            </View>
            <Ionicons name={fieldQuoteMode ? 'checkmark-circle' : 'ellipse-outline'} size={22} color={fieldQuoteMode ? theme.accent : theme.textMuted} />
          </TouchableOpacity>
        </View>

        {fieldQuoteMode && (
          <View style={S.fieldHero}>
            <View style={S.fieldHeroTop}>
              <View style={S.fieldHeroIcon}>
                <Ionicons name="leaf-outline" size={20} color={theme.accent} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={S.fieldHeroTitle}>Protokół u klienta</Text>
                <Text style={S.fieldHeroSub} selectable>
                  {form.klient_nazwa.trim() || 'Klient nie wpisany'}
                  {form.adres.trim() || form.miasto.trim() ? ` · ${[form.adres, form.miasto].filter(Boolean).join(', ')}` : ''}
                </Text>
              </View>
              <View style={S.fieldHeroScore}>
                <Text style={S.fieldHeroScoreValue}>{fieldReadyCount}/{fieldReadyChecks.length}</Text>
                <Text style={S.fieldHeroScoreLabel}>gotowe</Text>
              </View>
            </View>
            <View style={S.fieldHeroChecks}>
              {fieldReadyChecks.map((check) => (
                <View
                  key={check.key}
                  style={[
                    S.fieldHeroCheck,
                    check.ok ? S.fieldHeroCheckOk : S.fieldHeroCheckWarn,
                  ]}
                >
                  <Ionicons name={check.ok ? 'checkmark-circle' : check.icon} size={14} color={check.ok ? theme.success : theme.warning} />
                  <Text style={[S.fieldHeroCheckText, { color: check.ok ? theme.success : theme.warning }]}>
                    {check.label}
                  </Text>
                </View>
              ))}
            </View>
            <View style={S.fieldHeroMetrics}>
              {fieldHeroMetrics.map((metric) => (
                <View
                  key={metric.key}
                  style={[S.fieldHeroMetric, metric.ok ? S.fieldHeroMetricOk : S.fieldHeroMetricWarn]}
                >
                  <View style={S.fieldHeroMetricTop}>
                    <Ionicons name={metric.icon} size={14} color={metric.ok ? theme.success : theme.warning} />
                    <Text style={S.fieldHeroMetricLabel} numberOfLines={1}>{metric.label}</Text>
                  </View>
                  <Text style={S.fieldHeroMetricValue} numberOfLines={1}>{metric.value}</Text>
                  <Text style={S.fieldHeroMetricSub} numberOfLines={1}>{metric.sub}</Text>
                </View>
              ))}
            </View>
            <View style={S.fieldHeroActions}>
              <TouchableOpacity
                style={S.fieldHeroPrimary}
                onPress={() => void addFieldPhoto('camera', nextRequiredPhotoType.key)}
                disabled={photoBusy}
              >
                <Ionicons name="camera-outline" size={18} color={theme.accentText} />
                <Text style={S.fieldHeroPrimaryText}>Dodaj: {nextRequiredPhotoType.label}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={S.fieldHeroSecondary}
                onPress={openSketchShortcut}
                disabled={photoBusy}
              >
                <Ionicons name="create-outline" size={17} color={theme.accent} />
                <Text style={S.fieldHeroSecondaryText}>{latestPhotoForSketch ? 'Rysuj zakres' : 'Zrób szkic'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {fieldQuoteMode && (
          <View style={S.quickClientCard}>
            <View style={S.quickClientHead}>
              <View style={S.quickClientIcon}>
                <Ionicons name="speedometer-outline" size={18} color={theme.accent} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={S.quickClientTitle}>Szybka karta u klienta</Text>
                <Text style={S.quickClientSub}>Minimum danych na miejscu. Resztę biuro może dopracować po wysłaniu draftu.</Text>
              </View>
            </View>
            <View style={S.quickClientGrid}>
              <View style={[S.quickInputBox, S.quickInputWide]}>
                <Text style={S.quickInputLabel}>Klient</Text>
                <TextInput
                  style={S.quickInput}
                  value={form.klient_nazwa}
                  onChangeText={(v) => setForm({ ...form, klient_nazwa: v })}
                  placeholder="imię, nazwisko albo firma"
                  placeholderTextColor={theme.inputPlaceholder}
                />
              </View>
              <View style={S.quickInputBox}>
                <Text style={S.quickInputLabel}>Telefon</Text>
                <TextInput
                  style={S.quickInput}
                  value={form.klient_telefon}
                  onChangeText={(v) => setForm({ ...form, klient_telefon: v })}
                  placeholder="500-100-200"
                  placeholderTextColor={theme.inputPlaceholder}
                  keyboardType="phone-pad"
                />
              </View>
              <View style={S.quickInputBox}>
                <Text style={S.quickInputLabel}>Miasto</Text>
                <TextInput
                  style={S.quickInput}
                  value={form.miasto}
                  onChangeText={(v) => setForm({ ...form, miasto: v })}
                  placeholder="Kraków"
                  placeholderTextColor={theme.inputPlaceholder}
                />
              </View>
              <View style={[S.quickInputBox, S.quickInputWide]}>
                <Text style={S.quickInputLabel}>Adres</Text>
                <TextInput
                  style={S.quickInput}
                  value={form.adres}
                  onChangeText={(v) => setForm({ ...form, adres: v })}
                  placeholder="ulica, numer, punkt wejścia"
                  placeholderTextColor={theme.inputPlaceholder}
                />
              </View>
            </View>
            <View style={S.clientQuickActions}>
              <TouchableOpacity
                style={[S.clientQuickAction, !form.klient_telefon.trim() && S.clientQuickActionDisabled]}
                onPress={() => void callClient()}
                disabled={!form.klient_telefon.trim()}
              >
                <Ionicons name="call-outline" size={16} color={form.klient_telefon.trim() ? theme.accent : theme.textMuted} />
                <Text style={[S.clientQuickActionText, !form.klient_telefon.trim() && { color: theme.textMuted }]}>Telefon</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[S.clientQuickAction, (!form.adres.trim() && !form.miasto.trim()) && S.clientQuickActionDisabled]}
                onPress={() => void openClientMap()}
                disabled={!form.adres.trim() && !form.miasto.trim()}
              >
                <Ionicons name="map-outline" size={16} color={form.adres.trim() || form.miasto.trim() ? theme.accent : theme.textMuted} />
                <Text style={[S.clientQuickActionText, (!form.adres.trim() && !form.miasto.trim()) && { color: theme.textMuted }]}>Mapa</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {fieldQuoteMode && (
          <View style={S.sprintCard}>
            <View style={S.sprintTop}>
              <View style={[S.sprintIcon, { backgroundColor: quickSprintNextStep ? theme.warningBg : theme.successBg }]}>
                <Ionicons
                  name={quickSprintNextStep ? quickSprintNextStep.icon : 'checkmark-done-outline'}
                  size={18}
                  color={quickSprintNextStep ? theme.warning : theme.success}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={S.sprintTitle}>{quickSprintNextStep ? `Następne: ${quickSprintNextStep.label}` : 'Paczka gotowa do biura'}</Text>
                <Text style={S.sprintSub} numberOfLines={2}>
                  {quickSprintNextStep ? quickSprintNextStep.detail : 'Możesz wysłać draft, zdjęcia i protokół do opracowania.'}
                </Text>
              </View>
              <View style={[S.sprintScore, { borderColor: quickSprintNextStep ? theme.warning : theme.success }]}>
                <Text style={[S.sprintScoreText, { color: quickSprintNextStep ? theme.warning : theme.success }]}>
                  {quickSprintReadyCount}/{quickSprintSteps.length}
                </Text>
              </View>
            </View>

            <View style={S.sprintSteps}>
              {quickSprintSteps.map((step, idx) => (
                <View key={step.key} style={[S.sprintStep, step.ok ? S.sprintStepOk : S.sprintStepWarn]}>
                  <View style={[S.sprintStepDot, { backgroundColor: step.ok ? theme.success : theme.warning }]}>
                    <Text style={S.sprintStepDotText}>{idx + 1}</Text>
                  </View>
                  <Text style={[S.sprintStepText, { color: step.ok ? theme.success : theme.warning }]} numberOfLines={1}>
                    {step.label}
                  </Text>
                </View>
              ))}
            </View>

            <View style={S.sprintActions}>
              <TouchableOpacity
                style={S.sprintPrimary}
                onPress={() => void addFieldPhoto('camera', nextRequiredPhotoType.key)}
                disabled={photoBusy}
              >
                <Ionicons name="camera-outline" size={16} color={theme.accentText} />
                <Text style={S.sprintPrimaryText}>Następne zdjęcie</Text>
              </TouchableOpacity>
              <TouchableOpacity style={S.sprintSecondary} onPress={openSketchShortcut} disabled={photoBusy}>
                <Ionicons name="create-outline" size={16} color={theme.accent} />
                <Text style={S.sprintSecondaryText}>Szkic</Text>
              </TouchableOpacity>
              <TouchableOpacity style={S.sprintSecondary} onPress={() => void addFieldPhoto('gallery')} disabled={photoBusy}>
                <Ionicons name="images-outline" size={16} color={theme.accent} />
                <Text style={S.sprintSecondaryText}>Galeria</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              style={[S.sprintSubmit, officeHandoffReady && { backgroundColor: theme.success, borderColor: theme.success }]}
              onPress={() => void handleSubmit('back')}
              disabled={saving}
            >
              <Ionicons name="send-outline" size={16} color={theme.accentText} />
              <Text style={S.sprintSubmitText}>{officeHandoffReady ? 'Wyślij gotowe do biura' : 'Wyślij draft do biura'}</Text>
            </TouchableOpacity>
          </View>
        )}

        {fieldQuoteMode && (
          <View style={[S.handoffPanel, officeHandoffReady ? S.handoffPanelReady : S.handoffPanelWarn]}>
            <View style={S.handoffTop}>
              <View style={[S.handoffIcon, { backgroundColor: officeHandoffReady ? theme.successBg : theme.warningBg }]}>
                <Ionicons
                  name={officeHandoffReady ? 'checkmark-done-outline' : 'trail-sign-outline'}
                  size={19}
                  color={officeHandoffReady ? theme.success : theme.warning}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={S.handoffTitle}>{officeHandoffTitle}</Text>
                <Text style={S.handoffSub} numberOfLines={2}>{officeHandoffSub}</Text>
              </View>
              <View style={[S.handoffScore, { borderColor: officeHandoffReady ? theme.success : theme.warning }]}>
                <Text style={[S.handoffScoreText, { color: officeHandoffReady ? theme.success : theme.warning }]}>
                  {officeHandoffReadyCount}/{officeHandoffChecks.length}
                </Text>
              </View>
            </View>
            <View style={S.handoffGrid}>
              {officeHandoffChecks.map((check) => (
                <View key={check.key} style={[S.handoffCheck, check.ok ? S.handoffCheckOk : S.handoffCheckWarn]}>
                  <Ionicons
                    name={check.ok ? 'checkmark-circle' : check.icon}
                    size={14}
                    color={check.ok ? theme.success : theme.warning}
                  />
                  <Text style={[S.handoffCheckText, { color: check.ok ? theme.success : theme.warning }]}>
                    {check.label}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {fieldQuoteMode && (
          <View style={S.section}>
            <View style={S.sectionTitleRow}>
              <Ionicons name="list-outline" size={15} color={theme.accent} />
              <Text style={S.sectionTitle}>Formularz wyceny terenowej</Text>
              <View style={S.progressPill}>
                <Text style={S.progressText}>{fieldQuoteProgressLabel}</Text>
              </View>
            </View>
            <Text style={S.helperText}>
              Szybko jak w Telegramie: zakres, sprzęt, ryzyka, budżet i wynik rozmowy. To zapisze się w notatce dla biura.
            </Text>

            <Text style={S.fieldGroupTitle}>Szybkie presety</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={S.presetRow}>
              {FIELD_PRESETS.map((preset) => (
                <TouchableOpacity key={preset.key} style={S.presetChip} onPress={() => applyFieldPreset(preset)}>
                  <Ionicons name={preset.icon} size={15} color={theme.accent} />
                  <Text style={S.presetChipText}>{preset.label}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <Text style={S.fieldGroupTitle}>Zakres prac</Text>
            <View style={S.checkGrid}>
              {FIELD_WORK_OPTIONS.map((option) => {
                const active = fieldQuote.work.includes(option);
                return (
                  <TouchableOpacity
                    key={option}
                    style={[S.checkChip, active && S.checkChipActive]}
                    onPress={() => setFieldQuote((prev) => ({ ...prev, work: toggleProtocolValue(prev.work, option) }))}
                  >
                    <Ionicons name={active ? 'checkmark-circle' : 'ellipse-outline'} size={16} color={active ? theme.accent : theme.textMuted} />
                    <Text style={[S.checkText, active && { color: theme.accent }]}>{option}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={S.fieldGroupTitle}>Decyzje terenowe</Text>
            <View style={S.checkGrid}>
              {FIELD_QUICK_TOGGLES.map((option) => {
                const active = Boolean(fieldQuote[option.key]);
                return (
                  <TouchableOpacity
                    key={option.key}
                    style={[S.checkChip, active && S.checkChipActive]}
                    onPress={() => setFieldQuote((prev) => ({ ...prev, [option.key]: !prev[option.key] }))}
                  >
                    <Ionicons name={active ? 'checkmark-circle' : option.icon} size={16} color={active ? theme.accent : theme.textMuted} />
                    <Text style={[S.checkText, active && { color: theme.accent }]}>{option.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Field label="Szczegoly pracy / instrukcja dla ekipy" theme={theme}>
              <TextInput
                style={[S.input, { minHeight: 72, textAlignVertical: 'top' }]}
                value={fieldQuote.workDetails}
                onChangeText={(v) => setFieldQuote((prev) => ({ ...prev, workDetails: v }))}
                placeholder="np. z obu stron, sciagnac bluszcz, przyciac do linii ze zdjecia"
                placeholderTextColor={theme.inputPlaceholder}
                multiline
              />
            </Field>

            <Text style={S.fieldGroupTitle}>Sprzęt i zasoby</Text>
            <View style={S.checkGrid}>
              {FIELD_EQUIPMENT_OPTIONS.map((option) => {
                const active = fieldQuote.equipment.includes(option);
                return (
                  <TouchableOpacity
                    key={option}
                    style={[S.checkChip, active && S.checkChipActive]}
                    onPress={() => setFieldQuote((prev) => ({ ...prev, equipment: toggleProtocolValue(prev.equipment, option) }))}
                  >
                    <Ionicons name={active ? 'checkmark-circle' : 'ellipse-outline'} size={16} color={active ? theme.accent : theme.textMuted} />
                    <Text style={[S.checkText, active && { color: theme.accent }]}>{option}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={S.quickGrid}>
              <View style={S.quickField}>
                <Text style={S.fieldGroupTitle}>Ludzie</Text>
                <TextInput
                  style={S.input}
                  value={fieldQuote.people}
                  onChangeText={(v) => setFieldQuote((prev) => ({ ...prev, people: v }))}
                  keyboardType="numeric"
                  placeholder="np. 3"
                  placeholderTextColor={theme.inputPlaceholder}
                />
              </View>
              <View style={S.quickField}>
                <Text style={S.fieldGroupTitle}>Czas (h)</Text>
                <TextInput
                  style={S.input}
                  value={fieldQuote.time}
                  onChangeText={(v) => {
                    setFieldQuote((prev) => ({ ...prev, time: v }));
                    setForm((current) => ({ ...current, czas_planowany_godziny: v }));
                  }}
                  keyboardType="numeric"
                  placeholder="np. 3"
                  placeholderTextColor={theme.inputPlaceholder}
                />
              </View>
            </View>

            <View style={S.quickGrid}>
              <View style={S.quickField}>
                <Text style={S.fieldGroupTitle}>Budżet / cena</Text>
                <TextInput
                  style={S.input}
                  value={fieldQuote.budget}
                  onChangeText={(v) => {
                    setFieldQuote((prev) => ({ ...prev, budget: v }));
                    setForm((current) => ({ ...current, wartosc_planowana: v }));
                  }}
                  keyboardType="numeric"
                  placeholder="np. 1000"
                  placeholderTextColor={theme.inputPlaceholder}
                />
              </View>
              <View style={S.quickField}>
                <Text style={S.fieldGroupTitle}>Rabat %</Text>
                <TextInput
                  style={S.input}
                  value={fieldQuote.discount}
                  onChangeText={(v) => setFieldQuote((prev) => ({ ...prev, discount: v }))}
                  keyboardType="numeric"
                  placeholder="np. 10"
                  placeholderTextColor={theme.inputPlaceholder}
                />
              </View>
            </View>

            <View style={S.quickGrid}>
              <View style={S.quickField}>
                <Text style={S.fieldGroupTitle}>Minimalna cena</Text>
                <TextInput
                  style={S.input}
                  value={fieldQuote.minPrice}
                  onChangeText={(v) => setFieldQuote((prev) => ({ ...prev, minPrice: v }))}
                  keyboardType="numeric"
                  placeholder="np. 2200"
                  placeholderTextColor={theme.inputPlaceholder}
                />
              </View>
              <View style={S.quickField}>
                <Text style={S.fieldGroupTitle}>Cena klienta</Text>
                <TextInput
                  style={S.input}
                  value={fieldQuote.acceptedPrice}
                  onChangeText={(v) => {
                    setFieldQuote((prev) => ({ ...prev, acceptedPrice: v }));
                    setForm((current) => ({ ...current, wartosc_planowana: v || fieldQuote.budget }));
                  }}
                  keyboardType="numeric"
                  placeholder="np. 2600"
                  placeholderTextColor={theme.inputPlaceholder}
                />
              </View>
            </View>

            <View style={S.quickGrid}>
              <View style={S.quickField}>
                <Text style={S.fieldGroupTitle}>Zrebki</Text>
                <TextInput
                  style={S.input}
                  value={fieldQuote.chips}
                  onChangeText={(v) => setFieldQuote((prev) => ({ ...prev, chips: v }))}
                  keyboardType="numeric"
                  placeholder="np. 3"
                  placeholderTextColor={theme.inputPlaceholder}
                />
              </View>
              <View style={S.quickField}>
                <Text style={S.fieldGroupTitle}>Drewno</Text>
                <TextInput
                  style={S.input}
                  value={fieldQuote.wood}
                  onChangeText={(v) => setFieldQuote((prev) => ({ ...prev, wood: v }))}
                  placeholder="np. zostaje / wywoz"
                  placeholderTextColor={theme.inputPlaceholder}
                />
              </View>
            </View>

            <Field label="Arborysta / kto potrzebny" theme={theme}>
              <TextInput
                style={S.input}
                value={fieldQuote.arborist}
                onChangeText={(v) => setFieldQuote((prev) => ({ ...prev, arborist: v }))}
                placeholder="np. Nazar, Wszyscy, nie"
                placeholderTextColor={theme.inputPlaceholder}
              />
            </Field>

            <Text style={S.fieldGroupTitle}>Ryzyka / sprawdzić</Text>
            <View style={[S.riskReadinessBox, { borderColor: fieldRiskReady ? theme.success + '66' : theme.warning + '66', backgroundColor: fieldRiskReady ? theme.successBg : theme.warningBg }]}>
              <Ionicons name={fieldRiskReady ? 'shield-checkmark-outline' : 'alert-circle-outline'} size={17} color={fieldRiskReady ? theme.success : theme.warning} />
              <View style={{ flex: 1 }}>
                <Text style={[S.riskReadinessTitle, { color: fieldRiskReady ? theme.success : theme.warning }]}>
                  {fieldRiskReady ? 'BHP opisane dla biura i ekipy' : 'Zaznacz ryzyka albo brak ryzyk'}
                </Text>
                <Text style={S.riskReadinessSub} numberOfLines={2}>
                  {fieldRiskReady ? fieldRiskSummary : 'To chroni firme przed sporem i daje brygadzie instrukcje przed wyjazdem.'}
                </Text>
              </View>
            </View>
            <View style={S.checkGrid}>
              {FIELD_RISK_OPTIONS.map((option) => {
                const active = fieldQuote.risks.includes(option);
                const noRiskOption = option.toLowerCase().startsWith('brak');
                const activeRiskColor = noRiskOption ? theme.success : theme.warning;
                return (
                  <TouchableOpacity
                    key={option}
                    style={[S.checkChip, active && (noRiskOption ? S.noRiskChipActive : S.riskChipActive)]}
                    onPress={() => setFieldQuote((prev) => ({ ...prev, risks: toggleProtocolValue(prev.risks, option) }))}
                  >
                    <Ionicons name={active ? (noRiskOption ? 'checkmark-circle' : 'warning') : 'ellipse-outline'} size={16} color={active ? activeRiskColor : theme.textMuted} />
                    <Text style={[S.checkText, active && { color: activeRiskColor }]}>{option}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={S.fieldGroupTitle}>Wynik rozmowy</Text>
            <View style={S.checkGrid}>
              {FIELD_RESULT_OPTIONS.map((option) => {
                const active = fieldQuote.result === option;
                return (
                  <TouchableOpacity
                    key={option}
                    style={[S.checkChip, active && S.checkChipActive]}
                    onPress={() => {
                      setFieldQuote((prev) => ({ ...prev, result: option }));
                      if (option === 'Klient chce termin' && form.priorytet !== 'Pilny') {
                        setForm((current) => ({ ...current, priorytet: 'Wysoki' }));
                      }
                    }}
                  >
                    <Ionicons name={active ? 'radio-button-on' : 'radio-button-off'} size={16} color={active ? theme.accent : theme.textMuted} />
                    <Text style={[S.checkText, active && { color: theme.accent }]}>{option}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Field label="Dostęp / parking / uwagi posesji" theme={theme}>
              <TextInput
                style={[S.input, { minHeight: 72, textAlignVertical: 'top' }]}
                value={fieldQuote.access}
                onChangeText={(v) => setFieldQuote((prev) => ({ ...prev, access: v }))}
                placeholder="np. wjazd od bramy, auto można zostawić przy ogrodzeniu"
                placeholderTextColor={theme.inputPlaceholder}
                multiline
              />
            </Field>
            <Field label="Dodatkowe notatki specjalisty ds. wyceny" theme={theme}>
              <TextInput
                style={[S.input, { minHeight: 72, textAlignVertical: 'top' }]}
                value={fieldQuote.notes}
                onChangeText={(v) => setFieldQuote((prev) => ({ ...prev, notes: v }))}
                placeholder="np. klient chce szybko, sąsiedzi proszą o ciszę rano"
                placeholderTextColor={theme.inputPlaceholder}
                multiline
              />
            </Field>

            <View style={S.summaryBox}>
              <Text style={S.summaryTitle}>Podsumowanie dla biura</Text>
              <Text style={S.summaryText}>{fieldQuoteSummary}</Text>
            </View>

            <View style={S.photoBox}>
              <View style={S.photoHead}>
                <View style={{ flex: 1 }}>
                  <Text style={S.photoTitle}>Zdjęcia dla biura i ekipy</Text>
                  <Text style={S.photoSub}>
                    Dodaj od razu dowody z wyceny: ogólne zdjęcie, szkic zakresu albo dojazd do posesji.
                  </Text>
                </View>
                <View style={S.photoCounter}>
                  <Text style={S.photoCounterText}>{fieldPhotos.length}</Text>
                </View>
              </View>

              <View style={S.photoCaptureCard}>
                <View style={S.photoCaptureIcon}>
                  <Ionicons name={photoPackageReady ? 'shield-checkmark-outline' : nextRequiredPhotoType.icon} size={20} color={photoPackageReady ? theme.success : theme.accent} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={S.photoCaptureTitle}>{photoCaptureTitle}</Text>
                  <Text style={S.photoCaptureSub}>{photoCaptureSub}</Text>
                </View>
                <TouchableOpacity
                  style={[S.photoCaptureBtn, photoPackageReady && { backgroundColor: theme.success }]}
                  onPress={() => void addFieldPhoto('camera', nextRequiredPhotoType.key)}
                  disabled={photoBusy}
                >
                  <Ionicons name="camera-outline" size={16} color={theme.accentText} />
                  <Text style={S.photoCaptureBtnText}>Aparat</Text>
                </TouchableOpacity>
              </View>

              <View style={S.photoStatRow}>
                {photoStats.map((stat) => (
                  <View key={stat.key} style={[S.photoStatCard, stat.ok && S.photoStatCardOk]}>
                    <Ionicons name={stat.icon} size={15} color={stat.ok ? theme.success : theme.textMuted} />
                    <Text style={[S.photoStatValue, stat.ok && { color: theme.success }]}>{stat.value}</Text>
                    <Text style={S.photoStatLabel} numberOfLines={1}>{stat.label}</Text>
                  </View>
                ))}
              </View>

              <View style={[S.photoEvidencePanel, photoPackageReady ? S.photoEvidencePanelOk : S.photoEvidencePanelWarn]}>
                <View style={S.photoEvidenceHead}>
                  <View style={{ flex: 1 }}>
                    <Text style={S.photoEvidenceTitle}>Pakiet dowodowy</Text>
                    <Text style={[S.photoEvidenceSub, { color: photoPackageReady ? theme.success : theme.warning }]}>
                      {photoPackageLabel}
                    </Text>
                  </View>
                  <View style={[S.photoEvidenceScore, { borderColor: photoPackageReady ? theme.success : theme.warning }]}>
                    <Text style={[S.photoEvidenceScoreText, { color: photoPackageReady ? theme.success : theme.warning }]}>
                      {REQUIRED_FIELD_PHOTO_TYPES.length - missingRequiredPhotoTypes.length}/{REQUIRED_FIELD_PHOTO_TYPES.length}
                    </Text>
                  </View>
                </View>
                <View style={S.photoEvidenceList}>
                  {fieldPhotoTypeStats.map((type) => {
                    const ok = type.count > 0;
                    return (
                      <TouchableOpacity
                        key={type.key}
                        style={[S.photoEvidenceItem, { borderColor: ok ? theme.success : theme.warning, backgroundColor: ok ? theme.successBg : theme.warningBg }]}
                        onPress={() => void addFieldPhoto('camera', type.key)}
                        disabled={photoBusy}
                      >
                        <Ionicons name={ok ? 'checkmark-circle' : type.icon} size={18} color={ok ? theme.success : theme.warning} />
                        <View style={{ flex: 1 }}>
                          <Text style={[S.photoEvidenceItemTitle, { color: ok ? theme.success : theme.warning }]}>{type.label}</Text>
                          <Text style={S.photoEvidenceItemSub}>{ok ? `${type.count} dodane` : 'tapnij: aparat'}</Text>
                        </View>
                        <Ionicons name="camera-outline" size={16} color={ok ? theme.success : theme.warning} />
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              <View style={S.photoTypeRow}>
                {FIELD_PHOTO_TYPES.map((type) => {
                  const active = photoType === type.key;
                  return (
                    <TouchableOpacity
                      key={type.key}
                      style={[S.photoTypeChip, active && S.photoTypeChipActive]}
                      onPress={() => setPhotoType(type.key)}
                    >
                      <Ionicons name={type.icon} size={14} color={active ? theme.accent : theme.textMuted} />
                      <Text style={[S.photoTypeText, active && { color: theme.accent }]}>{type.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <TextInput
                style={[S.input, S.photoNoteInput]}
                value={photoOpis}
                onChangeText={setPhotoOpis}
                placeholder="Opis do kolejnego zdjęcia, np. brzoza przy ogrodzeniu"
                placeholderTextColor={theme.inputPlaceholder}
              />

              <View style={S.photoActionGrid}>
                <TouchableOpacity
                  style={S.photoActionBtn}
                  onPress={() => void addFieldPhoto('camera')}
                  disabled={photoBusy}
                >
                  <Ionicons name="camera-outline" size={18} color={theme.accent} />
                  <Text style={S.photoActionText}>Aparat + GPS</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={S.photoActionBtn}
                  onPress={() => void addFieldPhoto('gallery')}
                  disabled={photoBusy}
                >
                  <Ionicons name="images-outline" size={18} color={theme.accent} />
                  <Text style={S.photoActionText}>Galeria</Text>
                </TouchableOpacity>
              </View>

              {photoBusy ? (
                <View style={S.photoBusyRow}>
                  <ActivityIndicator color={theme.accent} size="small" />
                  <Text style={S.photoBusyText}>Dodawanie zdjęcia...</Text>
                </View>
              ) : null}

              {fieldPhotos.length ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={S.photoThumbRow}>
                  {fieldPhotos.map((photo) => (
                    <View key={photo.id} style={S.photoThumbCard}>
                      <Image source={{ uri: photo.uri }} style={S.photoThumbImage} />
                      <View style={S.photoBadge}>
                        <Text style={S.photoBadgeText}>{photo.label}</Text>
                      </View>
                      <TouchableOpacity style={S.photoRemoveBtn} onPress={() => removeFieldPhoto(photo.id)}>
                        <Ionicons name="close" size={13} color={theme.accentText} />
                      </TouchableOpacity>
                      <TouchableOpacity style={S.photoSketchBtn} onPress={() => openDrawEditor(photo)}>
                        <Ionicons name="create-outline" size={12} color={theme.accent} />
                        <Text style={S.photoSketchText}>Rysuj</Text>
                      </TouchableOpacity>
                      <Text style={S.photoThumbText} numberOfLines={2}>
                        {photo.opis}
                      </Text>
                    </View>
                  ))}
                </ScrollView>
              ) : (
                <View style={S.photoEmpty}>
                  <Ionicons name="image-outline" size={18} color={theme.textMuted} />
                  <Text style={S.photoEmptyText}>Minimum jedno zdjęcie mocno pomaga ekipie i chroni przed sporami z klientem.</Text>
                </View>
              )}
            </View>
          </View>
        )}

        {fieldQuoteMode && (
          <View style={S.fieldOfficePlan}>
            <View style={S.fieldOfficePlanHead}>
              <View style={S.fieldOfficePlanIcon}>
                <Ionicons name="calendar-outline" size={18} color={theme.accent} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={S.fieldOfficePlanTitle}>Plan i obsada</Text>
                <Text style={S.fieldOfficePlanSub}>
                  Opcjonalnie wybierz termin i ekipę już u klienta. Biuro może to potem tylko zatwierdzić.
                </Text>
              </View>
            </View>

            <View style={S.quickGrid}>
              <View style={S.quickField}>
                <Text style={S.fieldGroupTitle}>Data</Text>
                <TextInput
                  style={S.input}
                  value={form.data_planowana}
                  onChangeText={v => {
                    setForm({ ...form, data_planowana: v });
                    if (token && form.oddzial_id && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
                      void loadBranchResources(token, form.oddzial_id, v);
                    }
                  }}
                  placeholder="RRRR-MM-DD"
                  placeholderTextColor={theme.inputPlaceholder}
                />
              </View>
              <View style={S.quickField}>
                <Text style={S.fieldGroupTitle}>Start</Text>
                <TextInput
                  style={S.input}
                  value={form.godzina_rozpoczecia}
                  onChangeText={v => setForm({ ...form, godzina_rozpoczecia: v })}
                  placeholder="08:00"
                  placeholderTextColor={theme.inputPlaceholder}
                />
              </View>
            </View>

            <View style={S.assignmentBox}>
              <View style={S.assignmentHead}>
                <View style={S.assignmentIcon}>
                  <Ionicons name="people-outline" size={17} color={theme.accent} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={S.assignmentTitle}>{assignmentModeTitle}</Text>
                  <Text style={S.assignmentSub} numberOfLines={2}>{assignmentModeSub}</Text>
                </View>
              </View>
              <View style={S.assignmentSegment}>
                <TouchableOpacity
                  style={[S.assignmentSegmentBtn, assignmentMode === 'auto' && S.assignmentSegmentBtnActive]}
                  onPress={() => {
                    setAssignmentMode('auto');
                    setForm((current) => ({ ...current, ekipa_id: suggestedTeamId }));
                    void triggerHaptic('light');
                  }}
                >
                  <Ionicons name="sparkles-outline" size={15} color={assignmentMode === 'auto' ? theme.accentText : theme.textMuted} />
                  <Text style={[S.assignmentSegmentText, assignmentMode === 'auto' && S.assignmentSegmentTextActive]}>Auto</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[S.assignmentSegmentBtn, assignmentMode === 'manual' && S.assignmentSegmentBtnActive]}
                  onPress={() => {
                    setAssignmentMode('manual');
                    void triggerHaptic('light');
                  }}
                >
                  <Ionicons name="hand-left-outline" size={15} color={assignmentMode === 'manual' ? theme.accentText : theme.textMuted} />
                  <Text style={[S.assignmentSegmentText, assignmentMode === 'manual' && S.assignmentSegmentTextActive]}>Recznie</Text>
                </TouchableOpacity>
              </View>

              {assignmentMode === 'auto' ? (
                <View style={S.autoTeamCard}>
                  <View style={S.autoTeamTop}>
                    <Ionicons
                      name={suggestedTeam ? 'checkmark-circle-outline' : 'alert-circle-outline'}
                      size={18}
                      color={suggestedTeam ? theme.success : theme.warning}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={S.autoTeamTitle}>
                        {suggestedTeam ? suggestedTeamName : 'Brak propozycji auto'}
                      </Text>
                      <Text style={S.autoTeamSub}>
                        {suggestedTeam
                          ? `Powod: ${suggestedRecommendation?.reasons.join(' / ') || 'najwyzszy wynik'}`
                          : 'Wybierz oddział albo przejdź na tryb ręczny.'}
                      </Text>
                      {suggestedTeam ? (
                        <Text style={S.autoTeamLoad}>
                          Zajete {teamLoadMinutes(suggestedTeam)} min, wolne {teamFreeMinutes(suggestedTeam)} min
                        </Text>
                      ) : null}
                    </View>
                    {suggestedTeam ? (
                      <Text style={S.autoTeamScore}>{suggestedRecommendation?.score || 0}</Text>
                    ) : null}
                  </View>
                  {teamRecommendations.length > 1 ? (
                    <View style={S.autoAlternatives}>
                      {teamRecommendations.slice(1, 4).map((item) => (
                        <TouchableOpacity
                          key={item.team.id}
                          style={S.autoAltChip}
                          onPress={() => {
                            setAssignmentMode('manual');
                            setForm((current) => ({ ...current, ekipa_id: String(item.team.id) }));
                            void triggerHaptic('light');
                          }}
                        >
                          <Text style={S.autoAltText} numberOfLines={1}>{teamDisplayName(item.team)}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  ) : null}
                </View>
              ) : null}
            </View>

            <View style={[S.planWindowCard, planWindowCanFit ? S.planWindowCardOk : S.planWindowCardWarn]}>
              <View style={S.planWindowTop}>
                <View
                  style={[
                    S.planWindowIcon,
                    { backgroundColor: planWindowCanFit ? theme.successBg : theme.warningBg },
                  ]}
                >
                  <Ionicons
                    name={planWindowCanFit ? 'time-outline' : 'warning-outline'}
                    size={17}
                    color={planWindowCanFit ? theme.success : theme.warning}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={S.planWindowTitle}>{planWindowTitle}</Text>
                  <Text style={S.planWindowSub}>{planWindowSub}</Text>
                </View>
                <Text style={[S.planWindowPct, { color: planWindowCanFit ? theme.success : theme.warning }]}>
                  {selectedTeam ? `${selectedTeamLoadPercent}%` : '-'}
                </Text>
              </View>
              {selectedTeam ? (
                <>
                  <View style={S.planWindowTrack}>
                    <View
                      style={[
                        S.planWindowFill,
                        {
                          width: `${Math.min(100, selectedTeamLoadPercent)}%`,
                          backgroundColor: planWindowCanFit ? theme.success : theme.warning,
                        },
                      ]}
                    />
                  </View>
                  <View style={S.planWindowMetaRow}>
                    <Text style={S.planWindowMeta}>Zajete {selectedTeamLoadMinutes} min</Text>
                    <Text style={S.planWindowMeta}>Potrzeba {requestedPlanMinutes} min</Text>
                    <Text style={S.planWindowMeta}>Wolne {selectedTeamFreeMinutes} min</Text>
                  </View>
                </>
              ) : null}
              {selectedTeam && !planWindowCanFit && suggestedTeam && String(suggestedTeam.id) !== String(selectedTeam.id) ? (
                <TouchableOpacity
                  style={S.planWindowAction}
                  onPress={() => {
                    setAssignmentMode('auto');
                    setForm((current) => ({ ...current, ekipa_id: suggestedTeamId }));
                    void triggerHaptic('light');
                  }}
                >
                  <Ionicons name="sparkles-outline" size={15} color={theme.accent} />
                  <Text style={S.planWindowActionText}>Wroc do propozycji Auto</Text>
                </TouchableOpacity>
              ) : null}
            </View>

            {isDyrektor && (
            <Field label="Oddział" theme={theme}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View style={S.chipRow}>
                    {oddzialy.map(o => (
                      <TouchableOpacity
                        key={o.id}
                        style={[S.chip, form.oddzial_id === o.id.toString() && { backgroundColor: theme.accent + '22', borderColor: theme.accent }]}
                        onPress={() => {
                          const nextOddzial = o.id.toString();
                          setForm({ ...form, oddzial_id: nextOddzial, ekipa_id: '' });
                          if (token) void loadBranchResources(token, nextOddzial, form.data_planowana);
                        }}
                      >
                        <Text style={[S.chipText, form.oddzial_id === o.id.toString() && { color: theme.accent, fontWeight: '700' }]}>
                          {o.nazwa}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </ScrollView>
              </Field>
            )}

            <Field label="Proponowana ekipa" theme={theme}>
              {ekipyLoading && (
                <Text style={S.helperText}>Pobieram zasoby oddziału...</Text>
              )}
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={S.chipRow}>
                  {assignmentMode === 'manual' ? (
                    <TouchableOpacity
                      style={[S.chip, form.ekipa_id === '' && { backgroundColor: theme.accent + '22', borderColor: theme.accent }]}
                      onPress={() => setForm({ ...form, ekipa_id: '' })}
                    >
                      <Text style={[S.chipText, form.ekipa_id === '' && { color: theme.accent, fontWeight: '700' }]}>Dobierze biuro</Text>
                    </TouchableOpacity>
                  ) : null}
                  {ekipyFiltered.map(e => (
                    <TouchableOpacity
                      key={e.id}
                      style={[S.chip, form.ekipa_id === e.id.toString() && { backgroundColor: theme.accent + '22', borderColor: theme.accent }]}
                      onPress={() => {
                        setAssignmentMode('manual');
                        setForm({ ...form, ekipa_id: e.id.toString() });
                      }}
                    >
                      <Text style={[S.chipText, form.ekipa_id === e.id.toString() && { color: theme.accent, fontWeight: '700' }]}>
                        {e.nazwa}{e.delegowany ? ' - delegacja' : ''}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>
            </Field>
          </View>
        )}

        {!fieldQuoteMode && (
          <>
        {/* Dane klienta */}
        <View style={S.section}>
          <View style={S.sectionTitleRow}>
            <Ionicons name="person-outline" size={15} color={theme.accent} />
            <Text style={S.sectionTitle}>Dane klienta</Text>
          </View>
          <Field label="Klient *" theme={theme}>
            <TextInput value={form.klient_nazwa}
              onChangeText={v => setForm({ ...form, klient_nazwa: v })}
              placeholder="Imię i nazwisko lub firma"
              placeholderTextColor={theme.inputPlaceholder}
              style={S.input} />
          </Field>
          <Field label="Telefon klienta" theme={theme}>
            <TextInput style={S.input} value={form.klient_telefon}
              onChangeText={v => setForm({ ...form, klient_telefon: v })}
              placeholder="np. 500-100-200"
              placeholderTextColor={theme.inputPlaceholder}
              keyboardType="phone-pad" />
          </Field>
          <Field label="Adres *" theme={theme}>
            <TextInput style={S.input} value={form.adres}
              onChangeText={v => setForm({ ...form, adres: v })}
              placeholder="ul. Przykładowa 1"
              placeholderTextColor={theme.inputPlaceholder} />
          </Field>
          <Field label="Miasto *" theme={theme}>
            <TextInput style={S.input} value={form.miasto}
              onChangeText={v => setForm({ ...form, miasto: v })}
              placeholder="np. Kraków"
              placeholderTextColor={theme.inputPlaceholder} />
          </Field>
        </View>

        {/* Szczegóły */}
        <View style={S.section}>
          <View style={S.sectionTitleRow}>
            <Ionicons name="clipboard-outline" size={15} color={theme.accent} />
            <Text style={S.sectionTitle}>Szczegóły zlecenia</Text>
          </View>
          <Field label="Typ usługi" theme={theme}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={S.chipRow}>
                {TASK_SERVICE_TYPES.map(t => (
                  <TouchableOpacity key={t}
                    style={[S.chip, form.typ_uslugi === t && { backgroundColor: theme.accent + '22', borderColor: theme.accent }]}
                    onPress={() => setForm({ ...form, typ_uslugi: t })}>
                    <Text style={[S.chipText, form.typ_uslugi === t && { color: theme.accent, fontWeight: '700' }]}>{t}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>
          </Field>
          <Field label="Priorytet" theme={theme}>
            <View style={S.chipRow}>
              {TASK_PRIORITIES.map(p => (
                <TouchableOpacity key={p}
                  style={[S.chip, form.priorytet === p && { backgroundColor: theme.accent + '22', borderColor: theme.accent }]}
                  onPress={() => setForm({ ...form, priorytet: p })}>
                  <Text style={[S.chipText, form.priorytet === p && { color: theme.accent, fontWeight: '700' }]}>{p}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </Field>
          <Field label="Wartość (PLN)" theme={theme}>
            <TextInput style={S.input} value={form.wartosc_planowana}
              onChangeText={v => setForm({ ...form, wartosc_planowana: v })}
              placeholder="np. 3500"
              placeholderTextColor={theme.inputPlaceholder}
              keyboardType="numeric" />
          </Field>
          <Field label="Czas planowany (godz)" theme={theme}>
            <TextInput style={S.input} value={form.czas_planowany_godziny}
              onChangeText={v => setForm({ ...form, czas_planowany_godziny: v })}
              placeholder="np. 4"
              placeholderTextColor={theme.inputPlaceholder}
              keyboardType="numeric" />
          </Field>
          <Field label="Data realizacji *" theme={theme}>
            <TextInput style={S.input} value={form.data_planowana}
              onChangeText={v => {
                setForm({ ...form, data_planowana: v });
                if (token && form.oddzial_id && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
                  void loadBranchResources(token, form.oddzial_id, v);
                }
              }}
              placeholder="RRRR-MM-DD"
              placeholderTextColor={theme.inputPlaceholder} />
          </Field>
          <Field label="Godzina rozpoczęcia" theme={theme}>
            <TextInput style={S.input} value={form.godzina_rozpoczecia}
              onChangeText={v => setForm({ ...form, godzina_rozpoczecia: v })}
              placeholder="np. 08:00"
              placeholderTextColor={theme.inputPlaceholder} />
          </Field>
        </View>

        {/* Przypisanie */}
        <View style={S.section}>
          <View style={S.sectionTitleRow}>
            <Ionicons name="people-outline" size={15} color={theme.accent} />
            <Text style={S.sectionTitle}>Przypisanie</Text>
          </View>
          {isDyrektor && (
            <Field label="Oddział" theme={theme}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={S.chipRow}>
                  {oddzialy.map(o => (
                    <TouchableOpacity key={o.id}
                      style={[S.chip, form.oddzial_id === o.id.toString() && { backgroundColor: theme.accent + '22', borderColor: theme.accent }]}
                      onPress={() => {
                        const nextOddzial = o.id.toString();
                        setForm({ ...form, oddzial_id: nextOddzial, ekipa_id: '' });
                        if (token) void loadBranchResources(token, nextOddzial, form.data_planowana);
                      }}>
                      <Text style={[S.chipText, form.oddzial_id === o.id.toString() && { color: theme.accent, fontWeight: '700' }]}>
                        {o.nazwa}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>
            </Field>
          )}
          <Field label="Ekipa (opcjonalne)" theme={theme}>
            {ekipyLoading && (
              <Text style={S.helperText}>Pobieram zasoby oddziału...</Text>
            )}
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={S.chipRow}>
                <TouchableOpacity
                  style={[S.chip, form.ekipa_id === '' && { backgroundColor: theme.accent + '22', borderColor: theme.accent }]}
                  onPress={() => setForm({ ...form, ekipa_id: '' })}>
                  <Text style={[S.chipText, form.ekipa_id === '' && { color: theme.accent, fontWeight: '700' }]}>Brak</Text>
                </TouchableOpacity>
                {ekipyFiltered.map(e => (
                  <TouchableOpacity key={e.id}
                    style={[S.chip, form.ekipa_id === e.id.toString() && { backgroundColor: theme.accent + '22', borderColor: theme.accent }]}
                    onPress={() => setForm({ ...form, ekipa_id: e.id.toString() })}>
                    <Text style={[S.chipText, form.ekipa_id === e.id.toString() && { color: theme.accent, fontWeight: '700' }]}>
                      {e.nazwa}{e.delegowany ? ' · delegacja' : ''}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>
          </Field>
        </View>

        {/* Notatki */}
        <View style={S.section}>
          <View style={S.sectionTitleRow}>
            <Ionicons name="document-text-outline" size={15} color={theme.accent} />
            <Text style={S.sectionTitle}>Notatki</Text>
          </View>
          <TextInput
            style={[S.input, { height: 100, textAlignVertical: 'top' }]}
            value={form.notatki_wewnetrzne}
            onChangeText={v => setForm({ ...form, notatki_wewnetrzne: v })}
            placeholder="Instrukcje dla ekipy, dostęp do posesji..."
            placeholderTextColor={theme.inputPlaceholder}
            multiline />
        </View>
          </>
        )}

        {/* Buttons */}
        {fieldQuoteMode && (
          <View style={S.fieldSubmitPanel}>
            <View style={S.fieldSubmitTop}>
              <View style={[S.fieldSubmitIcon, { backgroundColor: officeHandoffReady ? theme.successBg : theme.warningBg }]}>
                <Ionicons
                  name={officeHandoffReady ? 'checkmark-done-outline' : 'cloud-upload-outline'}
                  size={19}
                  color={officeHandoffReady ? theme.success : theme.warning}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={S.fieldSubmitTitle}>{fieldSubmitTitle}</Text>
                <Text style={S.fieldSubmitSub}>{fieldSubmitSub}</Text>
              </View>
              <View style={[S.fieldSubmitScore, { borderColor: officeHandoffReady ? theme.success : theme.warning }]}>
                <Text style={[S.fieldSubmitScoreValue, { color: officeHandoffReady ? theme.success : theme.warning }]}>
                  {officeHandoffReadyCount}/{officeHandoffChecks.length}
                </Text>
                <Text style={S.fieldSubmitScoreLabel}>biuro</Text>
              </View>
            </View>

            <View style={S.fieldSubmitActions}>
              <TouchableOpacity style={S.fieldSubmitCancel} onPress={() => safeBack()} disabled={saving}>
                <Ionicons name="close-outline" size={16} color={theme.textMuted} />
                <Text style={S.fieldSubmitCancelText}>Anuluj</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={S.fieldSubmitAlt}
                onPress={() => handleSubmit('photos')}
                disabled={saving}
              >
                {saving ? (
                  <ActivityIndicator color={theme.accent} size="small" />
                ) : (
                  <Ionicons name="images-outline" size={16} color={theme.accent} />
                )}
                <Text style={S.fieldSubmitAltText}>Zapisz i media</Text>
              </TouchableOpacity>
            </View>

            <PlatinumCTA
              label={fieldPrimarySubmitLabel}
              style={S.fullSubmitBtn}
              onPress={() => handleSubmit('back')}
              disabled={saving}
              loading={saving}
            />
          </View>
        )}
        {!fieldQuoteMode && (
          <View style={S.btnRow}>
            <TouchableOpacity style={S.cancelBtn} onPress={() => safeBack()}>
              <Text style={S.cancelText}>Anuluj</Text>
            </TouchableOpacity>
            <PlatinumCTA
              label="Utwórz zlecenie"
              style={S.submitBtn}
              onPress={() => handleSubmit('back')}
              disabled={saving}
              loading={saving}
            />
          </View>
        )}
      </ScrollView>

      <Modal visible={!!drawPhoto} animationType="slide" onRequestClose={closeDrawEditor}>
        <View style={S.drawModalRoot}>
          <StatusBar barStyle="light-content" backgroundColor="#05080f" />
          <View style={S.drawModalHeader}>
            <TouchableOpacity style={S.drawHeaderBtn} onPress={closeDrawEditor} disabled={drawSaving}>
              <Ionicons name="close" size={22} color={theme.headerText} />
            </TouchableOpacity>
            <View style={{ flex: 1 }}>
              <Text style={S.drawModalTitle}>Rysunek na zdjęciu</Text>
              <Text style={S.drawModalSub}>Zaznacz drzewo, kierunek cięcia albo problem na posesji.</Text>
            </View>
            <TouchableOpacity style={S.drawSaveBtn} onPress={() => void saveDrawEditor()} disabled={drawSaving}>
              {drawSaving ? (
                <ActivityIndicator color={theme.accentText} size="small" />
              ) : (
                <Text style={S.drawSaveText}>Zapisz</Text>
              )}
            </TouchableOpacity>
          </View>

          <View style={S.drawBody}>
            <ViewShot
              ref={drawShotRef}
              options={{ format: 'jpg', quality: 0.9 }}
              style={[S.drawShot, { width: drawCanvasWidth, height: drawCanvasHeight }]}
            >
              <View
                style={[S.drawCanvas, { width: drawCanvasWidth, height: drawCanvasHeight }]}
                {...drawPanResponder.panHandlers}
              >
                {drawPhoto?.uri ? (
                  <Image source={{ uri: drawPhoto.uri }} style={S.drawImage} resizeMode="cover" />
                ) : (
                  <View style={S.drawImage} />
                )}
                <Svg width={drawCanvasWidth} height={drawCanvasHeight} style={StyleSheet.absoluteFill}>
                  {drawStrokes.map((stroke, idx) => (
                    <SvgPath
                      key={`${idx}-${stroke.path.length}`}
                      d={stroke.path}
                      stroke={stroke.color}
                      strokeWidth={stroke.width}
                      fill="none"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  ))}
                  {drawCurrentPath ? (
                    <SvgPath
                      d={drawCurrentPath}
                      stroke={drawColor}
                      strokeWidth={drawWidth}
                      fill="none"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  ) : null}
                </Svg>
              </View>
            </ViewShot>
          </View>

          <View style={S.drawTools}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={S.drawColorRow}>
              {DRAW_COLORS.map((color) => (
                <TouchableOpacity
                  key={color}
                  style={[
                    S.drawColorDot,
                    { backgroundColor: color, borderColor: color === '#FFFFFF' ? theme.border : color },
                    drawColor === color && S.drawColorDotActive,
                  ]}
                  onPress={() => setDrawColor(color)}
                />
              ))}
            </ScrollView>
            <View style={S.drawWidthRow}>
              {DRAW_WIDTHS.map((width) => (
                <TouchableOpacity
                  key={width}
                  style={[S.drawWidthBtn, drawWidth === width && S.drawWidthBtnActive]}
                  onPress={() => setDrawWidth(width)}
                >
                  <View style={[S.drawWidthLine, { height: width, backgroundColor: drawWidth === width ? theme.text : theme.textMuted }]} />
                </TouchableOpacity>
              ))}
              <TouchableOpacity
                style={S.drawUndoBtn}
                onPress={() => setDrawStrokes((prev) => prev.slice(0, -1))}
                disabled={!drawStrokes.length}
              >
                <Ionicons name="arrow-undo-outline" size={16} color={drawStrokes.length ? theme.textSub : theme.textMuted} />
                <Text style={[S.drawUndoText, !drawStrokes.length && { opacity: 0.45 }]}>Cofnij</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={S.drawUndoBtn}
                onPress={() => {
                  setDrawStrokes([]);
                  setDrawCurrentPath('');
                  drawPathRef.current = '';
                }}
              >
                <Ionicons name="trash-outline" size={16} color={theme.danger} />
                <Text style={[S.drawUndoText, { color: theme.danger }]}>Wyczyść</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </KeyboardSafeScreen>
  );
}

function Field({ label, children, theme }: { label: string; children: React.ReactNode; theme: Theme }) {
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={{ fontSize: 12, fontWeight: '900', color: theme.textMuted, marginBottom: 7, textTransform: 'uppercase', letterSpacing: 0 }}>{label}</Text>
      {children}
    </View>
  );
}

const makeStyles = (t: Theme) => StyleSheet.create({
  container: { flex: 1 },
  header: {
    backgroundColor: t.cardBg,
    margin: 14,
    marginBottom: 0,
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: t.cardBorder,
    borderRadius: 16,
    ...shadowStyle(t, {
      opacity: t.shadowOpacity * 0.45,
      radius: t.shadowRadius * 0.75,
      offsetY: Math.max(1, Math.round(t.shadowOffsetY * 0.55)),
      elevation: Math.max(1, t.cardElevation - 1),
    }),
  },
  backBtn: {
    width: 42,
    height: 42,
    borderRadius: 999,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: t.accentLight,
    borderWidth: 1,
    borderColor: t.accent + '33',
  },
  headerIcon: {
    width: 42,
    height: 42,
    borderRadius: 13,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: t.successBg,
    borderWidth: 1,
    borderColor: t.accent + '33',
  },
  headerTextBox: { flex: 1, minWidth: 0 },
  headerEyebrow: {
    color: t.accent,
    fontSize: 10,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 0,
  },
  headerTitle: { color: t.text, fontSize: 17, fontWeight: '900', marginTop: 2 },
  headerSub: { color: t.textMuted, fontSize: 12, fontWeight: '700', marginTop: 2 },
  headerScore: {
    minWidth: 54,
    minHeight: 46,
    borderRadius: 12,
    backgroundColor: t.accent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  headerScoreValue: {
    color: t.accentText,
    fontSize: 14,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  headerScoreLabel: {
    color: t.accentText,
    opacity: 0.78,
    fontSize: 8,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  prefillBanner: {
    margin: 12,
    marginBottom: 0,
    borderWidth: 1,
    borderColor: t.info + '66',
    backgroundColor: t.infoBg,
    borderRadius: 12,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  prefillText: { color: t.info, fontSize: 12, lineHeight: 17, fontWeight: '700', flex: 1 },
  draftNotice: {
    marginHorizontal: 14,
    marginTop: 10,
    marginBottom: 0,
    borderWidth: 1,
    borderColor: t.info + '66',
    backgroundColor: t.infoBg,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  draftNoticeText: { color: t.info, fontSize: 12, lineHeight: 17, fontWeight: '700', flex: 1 },
  draftNoticeBtn: {
    borderWidth: 1,
    borderColor: t.info + '55',
    borderRadius: 8,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  draftNoticeBtnText: { color: t.info, fontSize: 11, fontWeight: '900' },
  intakePanel: {
    marginHorizontal: 14,
    marginTop: 10,
    borderWidth: 1,
    borderColor: t.accent + '3f',
    backgroundColor: t.cardBg,
    borderRadius: 16,
    padding: 14,
    gap: 12,
    ...shadowStyle(t, {
      opacity: t.shadowOpacity * 0.35,
      radius: t.shadowRadius * 0.65,
      offsetY: Math.max(1, Math.round(t.shadowOffsetY * 0.45)),
      elevation: 1,
    }),
  },
  intakePanelHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  intakeBadge: {
    width: 42,
    height: 42,
    borderRadius: 13,
    backgroundColor: t.accentLight,
    borderWidth: 1,
    borderColor: t.accent + '44',
    alignItems: 'center',
    justifyContent: 'center',
  },
  intakeTitle: { color: t.text, fontSize: 15.5, fontWeight: '900' },
  intakeSub: { color: t.textMuted, fontSize: 12, lineHeight: 17, marginTop: 2 },
  intakeScore: {
    minWidth: 46,
    height: 38,
    borderRadius: 12,
    backgroundColor: t.successBg,
    borderWidth: 1,
    borderColor: t.success + '55',
    alignItems: 'center',
    justifyContent: 'center',
  },
  intakeScoreText: {
    color: t.success,
    fontSize: 14,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  intakeChecks: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  intakeCheck: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: 1,
    borderColor: t.border,
    backgroundColor: t.surface2,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 7,
  },
  intakeCheckOk: {
    borderColor: t.success + '55',
    backgroundColor: t.successBg,
  },
  intakeCheckText: { color: t.textMuted, fontSize: 11, fontWeight: '900' },
  modeSegment: {
    minHeight: 48,
    flexDirection: 'row',
    gap: 8,
    borderWidth: 1,
    borderColor: t.border,
    backgroundColor: t.bg,
    borderRadius: 15,
    padding: 5,
  },
  modeSegmentBtn: {
    flex: 1,
    borderRadius: 11,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  modeSegmentBtnActive: {
    backgroundColor: t.accent,
  },
  modeSegmentText: { color: t.textMuted, fontSize: 13, fontWeight: '900' },
  modeSegmentTextActive: { color: t.accentText },
  officeIntakeCard: {
    marginHorizontal: 12,
    marginTop: 10,
    borderWidth: 1,
    borderColor: t.accent + '3f',
    backgroundColor: t.cardBg,
    borderRadius: 18,
    padding: 14,
    gap: 12,
    ...shadowStyle(t, {
      opacity: 0.07,
      radius: 14,
      offsetY: 8,
      elevation: 1,
    }),
  },
  officeIntakeHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  officeIntakeIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: t.accent + '44',
    backgroundColor: t.accentLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  officeIntakeTitle: { color: t.text, fontSize: 16, fontWeight: '900' },
  officeIntakeSub: { color: t.textMuted, fontSize: 12, lineHeight: 17, marginTop: 2 },
  officeIntakeScore: {
    minWidth: 56,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: t.accent + '55',
    backgroundColor: t.accentLight,
    paddingHorizontal: 8,
    paddingVertical: 7,
    alignItems: 'center',
  },
  officeIntakeScoreValue: {
    color: t.accent,
    fontSize: 14,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  officeIntakeScoreLabel: { color: t.textMuted, fontSize: 8.5, fontWeight: '900', textTransform: 'uppercase' },
  officeIntakeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  officeIntakeCheck: {
    flexGrow: 1,
    flexBasis: '47%',
    minHeight: 58,
    borderRadius: 13,
    borderWidth: 1,
    paddingHorizontal: 9,
    paddingVertical: 8,
    gap: 4,
  },
  officeIntakeCheckOk: { borderColor: t.success + '55', backgroundColor: t.successBg },
  officeIntakeCheckWarn: { borderColor: t.warning + '55', backgroundColor: t.warningBg },
  officeIntakeCheckTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  officeIntakeCheckLabel: { fontSize: 11.5, fontWeight: '900' },
  officeIntakeCheckDetail: { color: t.textMuted, fontSize: 10.5, fontWeight: '800' },
  officeIntakeNext: {
    minHeight: 42,
    borderRadius: 13,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  officeIntakeNextText: { flex: 1, fontSize: 12, lineHeight: 16, fontWeight: '900' },
  officeIntakeActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  officeIntakePrimary: {
    flex: 1.2,
    minWidth: 164,
    minHeight: 46,
    borderRadius: 13,
    backgroundColor: t.accent,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingHorizontal: 12,
  },
  officeIntakePrimaryText: { color: t.accentText, fontSize: 13, fontWeight: '900' },
  officeIntakeSecondary: {
    flex: 1,
    minWidth: 132,
    minHeight: 46,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: t.accent + '66',
    backgroundColor: t.accentLight,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingHorizontal: 12,
  },
  officeIntakeSecondaryText: { color: t.accent, fontSize: 13, fontWeight: '900' },
  journeyPanel: {
    display: 'none',
    marginHorizontal: 12,
    marginTop: 10,
    borderWidth: 1,
    borderColor: t.accent + '35',
    backgroundColor: t.surface,
    borderRadius: 16,
    padding: 14,
    gap: 12,
  },
  journeyHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  journeyIcon: {
    width: 40,
    height: 40,
    borderRadius: 13,
    backgroundColor: t.accentLight,
    borderWidth: 1,
    borderColor: t.accent + '44',
    alignItems: 'center',
    justifyContent: 'center',
  },
  journeyTitle: { color: t.text, fontSize: 15, fontWeight: '900' },
  journeySub: { color: t.textMuted, fontSize: 12, lineHeight: 17, marginTop: 2 },
  journeySteps: { gap: 8 },
  journeyStep: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  journeyStepOk: {
    borderColor: t.success + '44',
    backgroundColor: t.successBg,
  },
  journeyStepPending: {
    borderColor: t.warning + '44',
    backgroundColor: t.warningBg,
  },
  journeyStepNumber: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  journeyStepNumberText: {
    color: t.accentText,
    fontSize: 11,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  journeyStepIcon: {
    width: 30,
    height: 30,
    borderRadius: 10,
    backgroundColor: t.cardBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  journeyStepTitle: { color: t.text, fontSize: 13, fontWeight: '900' },
  journeyStepDetail: { color: t.textMuted, fontSize: 11, lineHeight: 15, marginTop: 1 },
  legacyModeSection: { display: 'none' },
  fieldHero: {
    marginHorizontal: 12,
    marginTop: 12,
    borderWidth: 1,
    borderColor: t.accent + '44',
    backgroundColor: t.surface,
    borderRadius: 16,
    padding: 14,
    gap: 12,
  },
  fieldHeroTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  fieldHeroIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: t.accentLight,
    borderWidth: 1,
    borderColor: t.accent + '55',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fieldHeroTitle: { color: t.text, fontSize: 16, fontWeight: '900' },
  fieldHeroSub: { color: t.textMuted, fontSize: 12, lineHeight: 17, marginTop: 2 },
  fieldHeroScore: {
    minWidth: 58,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: t.border,
    backgroundColor: t.bg,
    paddingVertical: 6,
    paddingHorizontal: 8,
    alignItems: 'center',
  },
  fieldHeroScoreValue: {
    color: t.accent,
    fontSize: 16,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  fieldHeroScoreLabel: { color: t.textMuted, fontSize: 9, fontWeight: '800', textTransform: 'uppercase' },
  fieldHeroChecks: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  fieldHeroCheck: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 6,
  },
  fieldHeroCheckOk: {
    borderColor: t.success + '55',
    backgroundColor: t.successBg,
  },
  fieldHeroCheckWarn: {
    borderColor: t.warning + '55',
    backgroundColor: t.warningBg,
  },
  fieldHeroCheckText: { fontSize: 11, fontWeight: '900' },
  fieldHeroMetrics: {
    display: 'none',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  fieldHeroMetric: {
    flexGrow: 1,
    flexBasis: '47%',
    minHeight: 72,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  fieldHeroMetricOk: {
    borderColor: t.success + '44',
    backgroundColor: t.successBg,
  },
  fieldHeroMetricWarn: {
    borderColor: t.warning + '44',
    backgroundColor: t.warningBg,
  },
  fieldHeroMetricTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: 4,
  },
  fieldHeroMetricLabel: {
    color: t.textSub,
    fontSize: 10,
    fontWeight: '900',
    textTransform: 'uppercase',
    flexShrink: 1,
  },
  fieldHeroMetricValue: {
    color: t.text,
    fontSize: 16,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  fieldHeroMetricSub: {
    color: t.textMuted,
    fontSize: 11,
    fontWeight: '800',
    marginTop: 1,
  },
  fieldHeroActions: { flexDirection: 'row', gap: 8 },
  fieldHeroPrimary: {
    flex: 1.25,
    minHeight: 48,
    borderRadius: 12,
    backgroundColor: t.accent,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  fieldHeroPrimaryText: { color: t.accentText, fontSize: 13, fontWeight: '900' },
  fieldHeroSecondary: {
    flex: 1,
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: t.accent + '66',
    backgroundColor: t.accentLight,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  fieldHeroSecondaryText: { color: t.accent, fontSize: 13, fontWeight: '900' },
  quickClientCard: {
    marginHorizontal: 12,
    marginTop: 8,
    borderWidth: 1,
    borderColor: t.cardBorder,
    backgroundColor: t.cardBg,
    borderRadius: 13,
    padding: 12,
    gap: 10,
  },
  quickClientHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  quickClientIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: t.accentLight,
    borderWidth: 1,
    borderColor: t.accent + '55',
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickClientTitle: { color: t.text, fontSize: 15, fontWeight: '900' },
  quickClientSub: { color: t.textMuted, fontSize: 12, lineHeight: 17, marginTop: 2 },
  quickClientGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  quickInputBox: {
    flexGrow: 1,
    flexBasis: '47%',
    borderWidth: 1,
    borderColor: t.inputBorder,
    backgroundColor: t.inputBg,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingTop: 9,
    paddingBottom: 9,
  },
  quickInputWide: { flexBasis: '100%' },
  quickInputLabel: { color: t.textMuted, fontSize: 10, fontWeight: '900', textTransform: 'uppercase' },
  quickInput: {
    minHeight: 38,
    color: t.text,
    fontSize: 15,
    fontWeight: '800',
    paddingVertical: 2,
  },
  clientQuickActions: {
    flexDirection: 'row',
    gap: 8,
  },
  clientQuickAction: {
    flex: 1,
    minHeight: 48,
    borderWidth: 1,
    borderColor: t.accent + '55',
    backgroundColor: t.accentLight,
    borderRadius: 999,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  clientQuickActionDisabled: {
    borderColor: t.border,
    backgroundColor: t.surface2,
    opacity: 0.72,
  },
  clientQuickActionText: { color: t.accent, fontSize: 13, fontWeight: '900' },
  sprintCard: {
    marginHorizontal: 14,
    marginTop: 10,
    borderWidth: 1,
    borderColor: t.accent + '55',
    backgroundColor: t.surface,
    borderRadius: 15,
    padding: 14,
    gap: 12,
  },
  sprintTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  sprintIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: t.border,
  },
  sprintTitle: { color: t.text, fontSize: 15, fontWeight: '900' },
  sprintSub: { color: t.textSub, fontSize: 12, lineHeight: 17, marginTop: 2 },
  sprintScore: {
    minWidth: 52,
    borderRadius: 12,
    borderWidth: 1,
    backgroundColor: t.cardBg,
    paddingHorizontal: 8,
    paddingVertical: 7,
    alignItems: 'center',
  },
  sprintScoreText: { fontSize: 13, fontWeight: '900', fontVariant: ['tabular-nums'] },
  sprintSteps: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  sprintStep: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 6,
    maxWidth: '48%',
  },
  sprintStepOk: { borderColor: t.success + '55', backgroundColor: t.successBg },
  sprintStepWarn: { borderColor: t.warning + '55', backgroundColor: t.warningBg },
  sprintStepDot: {
    width: 18,
    height: 18,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sprintStepDotText: { color: t.accentText, fontSize: 10, fontWeight: '900', fontVariant: ['tabular-nums'] },
  sprintStepText: { flexShrink: 1, fontSize: 11, fontWeight: '900' },
  sprintActions: { flexDirection: 'row', gap: 8 },
  sprintPrimary: {
    flex: 1.25,
    minHeight: 46,
    borderRadius: 12,
    backgroundColor: t.accent,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  sprintPrimaryText: { color: t.accentText, fontSize: 12, fontWeight: '900' },
  sprintSecondary: {
    flex: 1,
    minHeight: 46,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: t.accent + '66',
    backgroundColor: t.accentLight,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  sprintSecondaryText: { color: t.accent, fontSize: 12, fontWeight: '900' },
  sprintSubmit: {
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: t.accent,
    backgroundColor: t.accent,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  sprintSubmitText: { color: t.accentText, fontSize: 13, fontWeight: '900' },
  handoffPanel: {
    marginHorizontal: 12,
    marginTop: 10,
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    gap: 12,
  },
  handoffPanelReady: { borderColor: t.success + '66', backgroundColor: t.successBg },
  handoffPanelWarn: { borderColor: t.warning + '66', backgroundColor: t.warningBg },
  handoffTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  handoffIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: t.border,
  },
  handoffTitle: { color: t.text, fontSize: 15, fontWeight: '900' },
  handoffSub: { color: t.textSub, fontSize: 12, lineHeight: 17, marginTop: 2 },
  handoffScore: {
    minWidth: 54,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 7,
    alignItems: 'center',
    backgroundColor: t.cardBg,
  },
  handoffScoreText: { fontSize: 13, fontWeight: '900', fontVariant: ['tabular-nums'] },
  handoffGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  handoffCheck: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 6,
  },
  handoffCheckOk: { borderColor: t.success + '55', backgroundColor: t.cardBg },
  handoffCheckWarn: { borderColor: t.warning + '55', backgroundColor: t.cardBg },
  handoffCheckText: { fontSize: 11, fontWeight: '900' },
  fieldOfficePlan: {
    marginHorizontal: 12,
    marginTop: 10,
    borderWidth: 1,
    borderColor: t.accent + '3f',
    backgroundColor: t.cardBg,
    borderRadius: 16,
    padding: 14,
    gap: 12,
  },
  fieldOfficePlanHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  fieldOfficePlanIcon: {
    width: 40,
    height: 40,
    borderRadius: 13,
    backgroundColor: t.accentLight,
    borderWidth: 1,
    borderColor: t.accent + '44',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fieldOfficePlanTitle: { color: t.text, fontSize: 15, fontWeight: '900' },
  fieldOfficePlanSub: { color: t.textMuted, fontSize: 12, lineHeight: 17, marginTop: 2 },
  assignmentBox: {
    borderWidth: 1,
    borderColor: t.accent + '44',
    backgroundColor: t.surface,
    borderRadius: 14,
    padding: 12,
    gap: 10,
  },
  assignmentHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  assignmentIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: t.accentLight,
    borderWidth: 1,
    borderColor: t.accent + '55',
    alignItems: 'center',
    justifyContent: 'center',
  },
  assignmentTitle: { color: t.text, fontSize: 14, fontWeight: '900' },
  assignmentSub: { color: t.textMuted, fontSize: 12, lineHeight: 16, marginTop: 2 },
  assignmentSegment: {
    minHeight: 44,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: t.border,
    backgroundColor: t.bg,
    flexDirection: 'row',
    gap: 5,
    padding: 5,
  },
  assignmentSegmentBtn: {
    flex: 1,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  assignmentSegmentBtnActive: { backgroundColor: t.accent },
  assignmentSegmentText: { color: t.textMuted, fontSize: 12, fontWeight: '900' },
  assignmentSegmentTextActive: { color: t.accentText },
  autoTeamCard: {
    borderWidth: 1,
    borderColor: t.success + '44',
    backgroundColor: t.cardBg,
    borderRadius: 13,
    padding: 10,
    gap: 8,
  },
  autoTeamTop: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  autoTeamTitle: { color: t.text, fontSize: 13, fontWeight: '900' },
  autoTeamSub: { color: t.textMuted, fontSize: 11, lineHeight: 15, marginTop: 2 },
  autoTeamLoad: { color: t.textSub, fontSize: 10, lineHeight: 14, marginTop: 3, fontWeight: '800' },
  autoTeamScore: {
    minWidth: 34,
    textAlign: 'center',
    color: t.success,
    fontSize: 13,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  autoAlternatives: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  autoAltChip: {
    borderWidth: 1,
    borderColor: t.border,
    backgroundColor: t.surface2,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 6,
    maxWidth: '48%',
  },
  autoAltText: { color: t.textSub, fontSize: 11, fontWeight: '800' },
  planWindowCard: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    gap: 10,
  },
  planWindowCardOk: {
    borderColor: t.success + '55',
    backgroundColor: t.successBg,
  },
  planWindowCardWarn: {
    borderColor: t.warning + '66',
    backgroundColor: t.warningBg,
  },
  planWindowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  planWindowIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: t.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  planWindowTitle: { color: t.text, fontSize: 14, fontWeight: '900' },
  planWindowSub: { color: t.textMuted, fontSize: 12, lineHeight: 16, marginTop: 2 },
  planWindowPct: {
    minWidth: 42,
    textAlign: 'right',
    fontSize: 14,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  planWindowTrack: {
    height: 7,
    borderRadius: 999,
    backgroundColor: t.surface,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: t.border,
  },
  planWindowFill: {
    height: '100%',
    borderRadius: 999,
  },
  planWindowMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  planWindowMeta: {
    color: t.textSub,
    fontSize: 11,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  planWindowAction: {
    minHeight: 38,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: t.accent + '55',
    backgroundColor: t.cardBg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  planWindowActionText: { color: t.accent, fontSize: 12, fontWeight: '900' },
  section: {
    backgroundColor: t.cardBg,
    marginHorizontal: 12,
    marginTop: 10,
    borderRadius: 18,
    padding: 15,
    borderWidth: 1,
    borderColor: t.cardBorder,
    ...shadowStyle(t, {
      opacity: 0.05,
      radius: 12,
      offsetY: 4,
      elevation: 1,
    }),
  },
  sectionTitleRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginBottom: 12, paddingBottom: 9,
    borderBottomWidth: 1, borderBottomColor: t.border,
  },
  sectionTitle: { fontSize: 15, fontWeight: '900', color: t.text },
  progressPill: {
    marginLeft: 'auto',
    borderWidth: 1,
    borderColor: t.accent,
    backgroundColor: t.accentLight,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  progressText: { color: t.accent, fontSize: 11, fontWeight: '900' },
  helperText: { color: t.textSub, fontSize: 13, lineHeight: 18, marginBottom: 10 },
  fieldGroupTitle: { color: t.textSub, fontSize: 12, fontWeight: '800', marginBottom: 8, marginTop: 4 },
  presetRow: { gap: 8, paddingBottom: 12 },
  presetChip: {
    minHeight: 42,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: t.border,
    backgroundColor: t.surface2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 11,
    paddingVertical: 8,
  },
  presetChipText: { color: t.textSub, fontSize: 12, fontWeight: '800' },
  checkGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  checkChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: t.border,
    backgroundColor: t.surface2,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  checkChipActive: { borderColor: t.accent, backgroundColor: t.accentLight },
  riskChipActive: { borderColor: t.warning, backgroundColor: t.warningBg },
  noRiskChipActive: { borderColor: t.success, backgroundColor: t.successBg },
  riskReadinessBox: {
    borderWidth: 1,
    borderRadius: 13,
    paddingHorizontal: 10,
    paddingVertical: 9,
    marginBottom: 9,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  riskReadinessTitle: { fontSize: 12, fontWeight: '900' },
  riskReadinessSub: { color: t.textSub, fontSize: 11, lineHeight: 15, marginTop: 2, fontWeight: '700' },
  checkText: { color: t.textMuted, fontSize: 12, fontWeight: '700' },
  quickGrid: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  quickField: { flex: 1 },
  summaryBox: {
    borderWidth: 1,
    borderColor: t.cardBorder,
    backgroundColor: t.surface2,
    borderRadius: 12,
    padding: 12,
    marginTop: 4,
  },
  summaryTitle: { color: t.text, fontSize: 13, fontWeight: '900', marginBottom: 6 },
  summaryText: { color: t.textSub, fontSize: 12, lineHeight: 18 },
  photoBox: {
    borderWidth: 1,
    borderColor: t.cardBorder,
    backgroundColor: t.surface2,
    borderRadius: 12,
    padding: 12,
    marginTop: 12,
    gap: 10,
  },
  photoHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  photoTitle: { color: t.text, fontSize: 13, fontWeight: '900' },
  photoSub: { color: t.textMuted, fontSize: 12, lineHeight: 17, marginTop: 3 },
  photoCounter: {
    minWidth: 30,
    height: 30,
    borderRadius: 10,
    backgroundColor: t.accentLight,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: t.accent,
  },
  photoCounterText: { color: t.accent, fontSize: 13, fontWeight: '900' },
  photoCaptureCard: {
    minHeight: 78,
    borderWidth: 1,
    borderColor: t.accent + '55',
    backgroundColor: t.cardBg,
    borderRadius: 16,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  photoCaptureIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: t.accentLight,
    borderWidth: 1,
    borderColor: t.accent + '44',
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoCaptureTitle: { color: t.text, fontSize: 14, fontWeight: '900' },
  photoCaptureSub: { color: t.textMuted, fontSize: 11, lineHeight: 16, marginTop: 2 },
  photoCaptureBtn: {
    minHeight: 42,
    borderRadius: 13,
    backgroundColor: t.accent,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  photoCaptureBtnText: { color: t.accentText, fontSize: 12, fontWeight: '900' },
  photoStatRow: { flexDirection: 'row', gap: 7 },
  photoStatCard: {
    flex: 1,
    minHeight: 62,
    borderWidth: 1,
    borderColor: t.border,
    backgroundColor: t.cardBg,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
    paddingVertical: 7,
  },
  photoStatCardOk: {
    borderColor: t.success + '55',
    backgroundColor: t.successBg,
  },
  photoStatValue: {
    color: t.text,
    fontSize: 14,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
    marginTop: 2,
  },
  photoStatLabel: { color: t.textMuted, fontSize: 9, fontWeight: '900', textTransform: 'uppercase', marginTop: 1 },
  photoEvidencePanel: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 10,
    gap: 9,
  },
  photoEvidencePanelOk: { borderColor: t.success + '66', backgroundColor: t.successBg },
  photoEvidencePanelWarn: { borderColor: t.warning + '66', backgroundColor: t.warningBg },
  photoEvidenceHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  photoEvidenceTitle: { color: t.text, fontSize: 12, fontWeight: '900' },
  photoEvidenceSub: { fontSize: 11, fontWeight: '800', marginTop: 2 },
  photoEvidenceScore: {
    minWidth: 42,
    height: 32,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.cardBg,
  },
  photoEvidenceScoreText: { fontSize: 12, fontWeight: '900', fontVariant: ['tabular-nums'] },
  photoEvidenceList: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  photoEvidenceItem: {
    flexGrow: 1,
    flexBasis: '31%',
    minHeight: 50,
    borderWidth: 1,
    borderRadius: 11,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  photoEvidenceItemTitle: { fontSize: 12, fontWeight: '900' },
  photoEvidenceItemSub: { color: t.textMuted, fontSize: 10, fontWeight: '800', marginTop: 1 },
  photoTypeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  photoTypeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: t.border,
    backgroundColor: t.cardBg,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  photoTypeChipActive: { borderColor: t.accent, backgroundColor: t.accentLight },
  photoTypeText: { color: t.textMuted, fontSize: 12, fontWeight: '800' },
  photoNoteInput: { minHeight: 44 },
  photoActionGrid: { flexDirection: 'row', gap: 8 },
  photoActionBtn: {
    flex: 1,
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: t.accent,
    backgroundColor: t.cardBg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  photoActionText: { color: t.accent, fontSize: 12, fontWeight: '900' },
  photoBusyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 6 },
  photoBusyText: { color: t.textMuted, fontSize: 12, fontWeight: '700' },
  photoThumbRow: { gap: 10, paddingVertical: 2 },
  photoThumbCard: {
    width: 118,
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: 12,
    backgroundColor: t.cardBg,
    overflow: 'hidden',
  },
  photoThumbImage: { width: '100%', height: 86, backgroundColor: t.bg },
  photoBadge: {
    position: 'absolute',
    left: 6,
    top: 6,
    borderRadius: 999,
    backgroundColor: t.accent,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  photoBadgeText: { color: t.accentText, fontSize: 9, fontWeight: '900' },
  photoRemoveBtn: {
    position: 'absolute',
    right: 6,
    top: 6,
    width: 23,
    height: 23,
    borderRadius: 999,
    backgroundColor: t.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoSketchBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    borderTopWidth: 1,
    borderTopColor: t.border,
    backgroundColor: t.accentLight,
    paddingVertical: 7,
  },
  photoSketchText: { color: t.accent, fontSize: 11, fontWeight: '900' },
  photoThumbText: { color: t.textSub, fontSize: 10, lineHeight: 14, padding: 7 },
  photoEmpty: {
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: 12,
    backgroundColor: t.cardBg,
    padding: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  photoEmptyText: { color: t.textMuted, fontSize: 12, lineHeight: 17, flex: 1 },
  drawModalRoot: { flex: 1, backgroundColor: t.bg },
  drawModalHeader: {
    paddingTop: 52,
    paddingBottom: 12,
    paddingHorizontal: 12,
    backgroundColor: t.surface,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.12)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  drawHeaderBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  drawModalTitle: { color: t.headerText, fontSize: 16, fontWeight: '900' },
  drawModalSub: { color: t.headerSub, fontSize: 11, marginTop: 2 },
  drawSaveBtn: {
    minWidth: 76,
    height: 42,
    borderRadius: 12,
    backgroundColor: t.accent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  drawSaveText: { color: t.accentText, fontSize: 13, fontWeight: '900' },
  drawBody: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 12 },
  drawShot: {
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  drawCanvas: { position: 'relative', overflow: 'hidden' },
  drawImage: { ...StyleSheet.absoluteFill, backgroundColor: '#111827' },
  drawTools: {
    backgroundColor: '#0b1220',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.12)',
    paddingTop: 10,
    paddingBottom: 28,
  },
  drawColorRow: { gap: 9, paddingHorizontal: 12, paddingBottom: 10 },
  drawColorDot: {
    width: 44,
    height: 44,
    borderRadius: 999,
    borderWidth: 2,
  },
  drawColorDotActive: { borderColor: '#ffffff', borderWidth: 4, transform: [{ scale: 1.08 }] },
  drawWidthRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12 },
  drawWidthBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  drawWidthBtnActive: { borderColor: t.accent, backgroundColor: t.accentLight },
  drawWidthLine: { width: 24, borderRadius: 999 },
  drawUndoBtn: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 12,
    paddingHorizontal: 10,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  drawUndoText: { color: t.textSub, fontSize: 12, fontWeight: '800' },
  modeSwitch: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderWidth: 1, borderColor: t.border, borderRadius: 12,
    padding: 12, backgroundColor: t.surface,
  },
  modeSwitchActive: {
    borderColor: t.accent,
    backgroundColor: t.accentLight,
  },
  modeIcon: {
    width: 36, height: 36, borderRadius: 10,
    justifyContent: 'center', alignItems: 'center',
  },
  modeTitle: { color: t.text, fontSize: 14, fontWeight: '800' },
  modeDesc: { color: t.textMuted, fontSize: 12, marginTop: 2 },
  input: {
    minHeight: 50,
    borderWidth: 1,
    borderColor: t.inputBorder,
    borderRadius: 14,
    paddingHorizontal: 13,
    paddingVertical: 11,
    fontSize: 15,
    fontWeight: '700',
    backgroundColor: t.inputBg,
    color: t.inputText,
  },
  chipRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: t.surface2,
    borderWidth: 1,
    borderColor: t.border,
  },
  chipText: { fontSize: 13, color: t.textMuted, fontWeight: '800' },
  fieldSubmitPanel: {
    marginHorizontal: 14,
    marginTop: 4,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: t.accent + '44',
    backgroundColor: t.cardBg,
    borderRadius: 16,
    padding: 14,
    gap: 12,
    ...shadowStyle(t, {
      opacity: t.shadowOpacity * 0.45,
      radius: t.shadowRadius * 0.75,
      offsetY: Math.max(1, Math.round(t.shadowOffsetY * 0.55)),
      elevation: Math.max(1, t.cardElevation - 1),
    }),
  },
  fieldSubmitTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  fieldSubmitIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: t.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fieldSubmitTitle: { color: t.text, fontSize: 15, fontWeight: '900' },
  fieldSubmitSub: { color: t.textMuted, fontSize: 12, lineHeight: 17, marginTop: 2 },
  fieldSubmitScore: {
    minWidth: 54,
    borderRadius: 13,
    borderWidth: 1,
    backgroundColor: t.bg,
    paddingHorizontal: 8,
    paddingVertical: 7,
    alignItems: 'center',
  },
  fieldSubmitScoreValue: {
    fontSize: 13,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  fieldSubmitScoreLabel: {
    color: t.textMuted,
    fontSize: 8,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  fieldSubmitActions: { flexDirection: 'row', gap: 8 },
  fieldSubmitCancel: {
    flex: 1,
    minHeight: 44,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: t.border,
    backgroundColor: t.bg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  fieldSubmitCancelText: { color: t.textMuted, fontSize: 12, fontWeight: '900' },
  fieldSubmitAlt: {
    flex: 1.35,
    minHeight: 44,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: t.accent + '66',
    backgroundColor: t.accentLight,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  fieldSubmitAltText: { color: t.accent, fontSize: 12, fontWeight: '900' },
  btnRow: { flexDirection: 'row', gap: 10, marginHorizontal: 14, marginTop: 8, marginBottom: 16 },
  cancelBtn: {
    flex: 1, backgroundColor: t.cardBg, padding: 16, borderRadius: 14,
    alignItems: 'center', borderWidth: 1, borderColor: t.border,
  },
  cancelText: { color: t.textMuted, fontWeight: '600', fontSize: 15 },
  submitBtn: { flex: 2 },
  fullSubmitBtn: { width: '100%' },
});
