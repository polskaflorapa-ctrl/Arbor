import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  ScrollView,
  Share,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { KeyboardSafeScreen } from '../components/ui/keyboard-safe-screen';
import { useLanguage } from '../constants/LanguageContext';
import { useTheme } from '../constants/ThemeContext';
import type { Theme } from '../constants/theme';
import { useOddzialFeatureGuard } from '../hooks/use-oddzial-feature-guard';
import {
  clearOddzialFeatureOverride,
  exportOddzialOverrides,
  getOddzialFeatureAuditSync,
  hydrateOddzialFeatureOverrides,
  importOddzialOverrides,
  setOddzialFeatureOverride,
} from '../utils/oddzial-feature-overrides';
import {
  getAllFeatureKeys,
  getOddzialFeatureConfig,
  getOddzialIds,
  type OddzialFeatureKey,
} from '../utils/oddzial-features';
import { getStoredSession } from '../utils/session';

export default function OddzialFunkcjeAdminScreen() {
  const { theme } = useTheme();
  const { t } = useLanguage();
  const guard = useOddzialFeatureGuard('/oddzial-funkcje-admin');
  const [loading, setLoading] = useState(true);
  const [selectedOddzial, setSelectedOddzial] = useState<string>('1');
  const [name, setName] = useState('');
  const [mission, setMission] = useState('');
  const [focus, setFocus] = useState('');
  const [startPath, setStartPath] = useState('/dashboard');
  const [allowed, setAllowed] = useState<OddzialFeatureKey[]>([]);
  const [saving, setSaving] = useState(false);
  const [adminActor, setAdminActor] = useState<{ id?: string | number | null; name?: string | null }>({});
  const [showImport, setShowImport] = useState(false);
  const [importPayload, setImportPayload] = useState('');
  const [auditList, setAuditList] = useState(getOddzialFeatureAuditSync());

  const oddzialIds = useMemo(() => getOddzialIds(), []);
  const allFeatures = useMemo(() => getAllFeatureKeys(), []);

  const loadConfig = (oddzialId: string) => {
    const cfg = getOddzialFeatureConfig(oddzialId);
    setName(cfg.name);
    setMission(cfg.mission);
    setFocus(cfg.focus);
    setStartPath(cfg.startPath);
    setAllowed(cfg.allowed);
  };

  useEffect(() => {
    const init = async () => {
      const { token, user } = await getStoredSession();
      if (!token) {
        router.replace('/login');
        return;
      }
      if (!user || (user.rola !== 'Dyrektor' && user.rola !== 'Administrator')) {
        Alert.alert(t('branchAdmin.accessTitle'), t('branchAdmin.accessBody'));
        router.replace('/dashboard');
        return;
      }
      const login = typeof user?.login === 'string' ? user.login : '';
      const fullName = [user?.imie, user?.nazwisko]
        .filter((val): val is string => typeof val === 'string' && val.trim().length > 0)
        .join(' ');
      setAdminActor({
        id: user?.id ?? null,
        name: fullName || login || null,
      });
      await hydrateOddzialFeatureOverrides();
      setAuditList(getOddzialFeatureAuditSync());
      const first = oddzialIds[0] ?? '1';
      setSelectedOddzial(first);
      loadConfig(first);
      setLoading(false);
    };
    void init();
  }, [oddzialIds, t]);

  const toggleFeature = (path: OddzialFeatureKey) => {
    setAllowed((prev) => (prev.includes(path) ? prev.filter((p) => p !== path) : [...prev, path]));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await setOddzialFeatureOverride(selectedOddzial, {
        name,
        mission,
        focus,
        startPath,
        allowed,
        priorityOrder: allowed,
      }, adminActor);
      setAuditList(getOddzialFeatureAuditSync());
      Alert.alert(t('wyceny.alert.savedTitle'), t('branchAdmin.savedOverride', { id: selectedOddzial }));
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    setSaving(true);
    try {
      await clearOddzialFeatureOverride(selectedOddzial, adminActor);
      loadConfig(selectedOddzial);
      setAuditList(getOddzialFeatureAuditSync());
      Alert.alert(t('branchAdmin.resetTitle'), t('branchAdmin.restored', { id: selectedOddzial }));
    } finally {
      setSaving(false);
    }
  };

  const handleExport = async () => {
    const payload = exportOddzialOverrides();
    await Clipboard.setStringAsync(payload);
    try {
      await Share.share({
        title: t('branchAdmin.shareTitle'),
        message: payload,
      });
    } catch {
      // Ignorujemy anulowanie systemowego share sheet.
    }
    Alert.alert(t('common.copy'), t('branchAdmin.exportCopied'));
  };

  const handleImport = async () => {
    setSaving(true);
    try {
      await importOddzialOverrides(importPayload, adminActor);
      await hydrateOddzialFeatureOverrides();
      loadConfig(selectedOddzial);
      setAuditList(getOddzialFeatureAuditSync());
      setShowImport(false);
      setImportPayload('');
      Alert.alert(t('branchAdmin.importDoneTitle'), t('branchAdmin.importOk'));
    } catch {
      Alert.alert(t('branchAdmin.importErrorTitle'), t('branchAdmin.importFail'));
    } finally {
      setSaving(false);
    }
  };

  const S = makeStyles(theme);

  if (guard.ready && !guard.allowed) {
    return <View style={S.root} />;
  }

  if (!guard.ready || loading) {
    return (
      <View style={S.center}>
        <ActivityIndicator size="large" color={theme.accent} />
      </View>
    );
  }

  return (
    <KeyboardSafeScreen style={S.root}>
      <StatusBar barStyle={theme.name === 'dark' ? 'light-content' : 'dark-content'} backgroundColor={theme.headerBg} />
      <View style={S.header}>
        <TouchableOpacity onPress={() => router.back()} style={S.backBtn}>
          <Ionicons name="arrow-back" size={22} color={theme.headerText} />
        </TouchableOpacity>
        <Text style={S.title}>Funkcje oddziałów (Admin)</Text>
      </View>

      <ScrollView
        style={S.scroll}
        contentContainerStyle={{ padding: 12, gap: 12, paddingBottom: 32 }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
      >
        <View style={S.card}>
          <Text style={S.label}>Wybierz oddział</Text>
          <View style={S.rowWrap}>
            {oddzialIds.map((id) => (
              <TouchableOpacity
                key={id}
                style={[S.chip, selectedOddzial === id && { borderColor: theme.accent, backgroundColor: theme.accent + '1f' }]}
                onPress={() => {
                  setSelectedOddzial(id);
                  loadConfig(id);
                }}
              >
                <Text style={[S.chipText, selectedOddzial === id && { color: theme.accent }]}>Oddział #{id}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={S.card}>
          <Text style={S.label}>Nazwa</Text>
          <TextInput style={S.input} value={name} onChangeText={setName} />
          <Text style={S.label}>Misja</Text>
          <TextInput style={S.input} value={mission} onChangeText={setMission} />
          <Text style={S.label}>Fokus</Text>
          <TextInput style={S.input} value={focus} onChangeText={setFocus} />
          <Text style={S.label}>Start path</Text>
          <TextInput style={S.input} value={startPath} onChangeText={setStartPath} />
        </View>

        <View style={S.card}>
          <Text style={S.label}>Dozwolone moduły</Text>
          <View style={S.rowWrap}>
            {allFeatures.map((path) => {
              const active = allowed.includes(path);
              return (
                <TouchableOpacity
                  key={path}
                  style={[S.chip, active && { borderColor: theme.accent, backgroundColor: theme.accent + '1f' }]}
                  onPress={() => toggleFeature(path)}
                >
                  <Text style={[S.chipText, active && { color: theme.accent }]}>{path}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        <View style={S.actions}>
          <TouchableOpacity style={[S.btn, { backgroundColor: theme.surface2 }]} onPress={handleReset} disabled={saving}>
            <Text style={[S.btnText, { color: theme.text }]}>Reset oddziału</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[S.btn, { backgroundColor: theme.accent }]} onPress={handleSave} disabled={saving}>
            <Text style={[S.btnText, { color: theme.accentText }]}>Zapisz nadpisanie</Text>
          </TouchableOpacity>
        </View>

        <View style={S.actions}>
          <TouchableOpacity style={[S.btn, { backgroundColor: theme.infoBg }]} onPress={handleExport}>
            <Text style={[S.btnText, { color: theme.info }]}>Eksport (kopiuj JSON)</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[S.btn, { backgroundColor: theme.surface2 }]} onPress={() => setShowImport((v) => !v)}>
            <Text style={[S.btnText, { color: theme.text }]}>Import JSON</Text>
          </TouchableOpacity>
        </View>

        {showImport ? (
          <View style={S.card}>
            <Text style={S.label}>Wklej payload eksportu</Text>
            <TextInput
              style={[S.input, { minHeight: 140, textAlignVertical: 'top' }]}
              value={importPayload}
              onChangeText={setImportPayload}
              multiline
            />
            <TouchableOpacity style={[S.btn, { backgroundColor: theme.warningBg }]} onPress={handleImport} disabled={saving}>
              <Text style={[S.btnText, { color: theme.warning }]}>Wykonaj import</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        <View style={S.card}>
          <Text style={S.label}>Audit trail (ostatnie zmiany)</Text>
          {auditList.length === 0 ? (
            <Text style={{ color: theme.textSub, fontSize: 12 }}>Brak wpisów audytu.</Text>
          ) : auditList.slice(0, 12).map((entry) => (
            <View key={entry.id} style={S.auditRow}>
              <Text style={S.auditMain}>
                {entry.action} {entry.oddzialId ? `• oddział ${entry.oddzialId}` : ''}
              </Text>
              <Text style={S.auditSub}>
                {new Date(entry.ts).toLocaleString('pl-PL')} • {entry.actorName || 'system'}
              </Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </KeyboardSafeScreen>
  );
}

const makeStyles = (t: Theme) => StyleSheet.create({
  root: { flex: 1, backgroundColor: t.bg },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: t.bg },
  header: {
    backgroundColor: t.headerBg,
    paddingTop: 54,
    paddingBottom: 12,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: t.border,
  },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 17, fontWeight: '800', color: t.headerText },
  scroll: { flex: 1 },
  card: { borderWidth: 1, borderColor: t.border, borderRadius: 12, backgroundColor: t.surface, padding: 12 },
  label: { fontSize: 12, fontWeight: '700', color: t.textSub, marginBottom: 6, marginTop: 4 },
  input: {
    borderWidth: 1,
    borderColor: t.inputBorder,
    backgroundColor: t.inputBg,
    color: t.inputText,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 9,
    marginBottom: 6,
  },
  rowWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    borderWidth: 1,
    borderColor: t.border,
    backgroundColor: t.surface2,
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  chipText: { fontSize: 12, color: t.textSub, fontWeight: '600' },
  actions: { flexDirection: 'row', gap: 8, marginBottom: 24 },
  btn: { flex: 1, borderRadius: 10, paddingVertical: 12, alignItems: 'center', justifyContent: 'center' },
  btnText: { fontSize: 13, fontWeight: '700' },
  auditRow: {
    borderTopWidth: 1,
    borderTopColor: t.border,
    paddingTop: 8,
    marginTop: 8,
  },
  auditMain: { fontSize: 12, color: t.text, fontWeight: '700' },
  auditSub: { fontSize: 11, color: t.textSub, marginTop: 2 },
});
