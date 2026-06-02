import { safeBack } from '../utils/navigation';
import { Ionicons } from '@expo/vector-icons';
import * as LocalAuthentication from 'expo-local-authentication';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { isPrivacyLockEnabled, setPrivacyLockEnabled } from '../components/app-privacy-lock';
import {
  getLiveGpsStatusSnapshot,
  isLiveGpsEnabled,
  setLiveGpsEnabled,
  subscribeLiveGpsStatusSnapshot,
  type LiveGpsStatusSnapshot,
} from '../components/live-gps-heartbeat';
import { useLanguage } from '../constants/LanguageContext';
import { useTheme } from '../constants/ThemeContext';
import { shadowStyle } from '../constants/elevation';
import { THEME_LABELS, ThemeName, themes, getRolaColor } from '../constants/theme';
import type { Theme } from '../constants/theme';
import { useOddzialFeatureGuard } from '../hooks/use-oddzial-feature-guard';
import { fetchAndApplyMobileRemoteConfig } from '../utils/mobile-remote-config';
import { getRoleDisplayName } from '../utils/role-display';
import { clearStoredSession, getStoredSession, type StoredUser } from '../utils/session';
import { unregisterExpoPushTokenWithBackend } from '../utils/expo-push-backend';

import { AppStatusBar } from '../components/ui/app-status-bar';
type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

export default function ProfilScreen() {
  const { theme, themeName, setTheme } = useTheme();
  const { language, setLanguage, t } = useLanguage();
  const rolaKolorMap = useMemo(() => ({
    Dyrektor: getRolaColor('Dyrektor'),
    Administrator: theme.warning,
    Kierownik: theme.info,
    Brygadzista: theme.success,
    Pomocnik: theme.textMuted,
  }), [theme]);
  const guard = useOddzialFeatureGuard('/profil');
  const [user, setUser] = useState<StoredUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [bioSupported, setBioSupported] = useState(false);
  const [bioOn, setBioOn] = useState(false);
  const [liveGpsOn, setLiveGpsOn] = useState(true);
  const [liveGpsStatus, setLiveGpsStatus] = useState<LiveGpsStatusSnapshot | null>(null);
  const [syncingRemote, setSyncingRemote] = useState(false);
  const [devTapCount, setDevTapCount] = useState(0);
  const router = useRouter();

  useEffect(() => { loadUser(); }, []);

  useEffect(() => {
    void (async () => {
      setBioOn(await isPrivacyLockEnabled());
      setLiveGpsOn(await isLiveGpsEnabled());
      setLiveGpsStatus(await getLiveGpsStatusSnapshot());
      const h = await LocalAuthentication.hasHardwareAsync();
      const e = await LocalAuthentication.isEnrolledAsync();
      setBioSupported(Boolean(h && e));
    })();
  }, []);

  useEffect(() => subscribeLiveGpsStatusSnapshot(setLiveGpsStatus), []);

  const loadUser = async () => {
    const { user: storedUser } = await getStoredSession();
    if (storedUser) setUser(storedUser);
    setLoading(false);
  };

  const handleDevTap = () => {
    const newCount = devTapCount + 1;
    setDevTapCount(newCount);
    if (newCount === 7) {
      setDevTapCount(0);
      router.push('/test-mode');
    }
  };

  const handleLogout = () => {
    Alert.alert(t('profile.logout.title'), t('profile.logout.confirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('profile.logout.action'), style: 'destructive',
        onPress: async () => {
          const { token } = await getStoredSession();
          if (token) await unregisterExpoPushTokenWithBackend(token);
          await clearStoredSession();
          router.replace('/login');
        },
      },
    ]);
  };

  const S = makeStyles(theme);

  if (guard.ready && !guard.allowed) {
    return <View style={S.root} />;
  }
  if (!guard.ready) {
    return <View style={S.center}><ActivityIndicator size="large" color={theme.accent} /></View>;
  }

  if (loading) return <View style={S.center}><ActivityIndicator size="large" color={theme.accent} /></View>;

  const rolaKolor = rolaKolorMap[user?.rola as keyof typeof rolaKolorMap] || theme.accent;
  const rolaLabel = getRoleDisplayName(user?.rola, '-');
  const initials = `${user?.imie?.[0] || ''}${user?.nazwisko?.[0] || ''}` || 'AR';
  const isManager = ['Dyrektor', 'Administrator', 'Kierownik'].includes(String(user?.rola || ''));
  const isFieldWorker = ['Brygadzista', 'Pomocnik'].includes(String(user?.rola || ''));
  const liveGpsStatusLabel = !liveGpsOn
    ? 'Wylaczony'
    : liveGpsStatus?.kind === 'active'
      ? 'Aktywny'
      : liveGpsStatus?.kind === 'blocked'
        ? liveGpsStatus.reason === 'permission_revoked'
          ? 'Zgoda cofnieta'
          : 'Brak zgody'
        : liveGpsStatus?.kind === 'warning'
          ? liveGpsStatus.reason === 'no_fix'
            ? 'Brak sygnalu GPS'
            : liveGpsStatus.reason === 'offline'
              ? 'Offline'
              : 'Problem z synchronizacja'
          : 'Gotowy';
  const liveGpsStatusColor = !liveGpsOn
    ? theme.textMuted
    : liveGpsStatus?.kind === 'active'
      ? theme.success
      : liveGpsStatus?.kind === 'blocked'
        ? theme.danger
        : liveGpsStatus?.kind === 'warning'
          ? theme.warning
          : theme.info;
  const liveGpsLastSync = liveGpsStatus?.sentAt
    ? new Date(liveGpsStatus.sentAt).toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
    : 'brak';
  const liveGpsPrivacyNote = 'GPS live dziala tylko w foreground: gdy aplikacja jest otwarta i aktywna. Nie wlacza sledzenia 24/7 w tle.';
  const profileStats = [
    { key: 'role', label: 'Rola', value: rolaLabel },
    { key: 'branch', label: 'Oddział', value: user?.oddzial_nazwa || 'Nieustawiony' },
    { key: 'mode', label: 'Tryb', value: guard.allowed ? 'Aktywny' : 'Ograniczony' },
  ];
  const workActions = [
    { key: 'tasks', icon: 'checkbox-outline' as IoniconName, label: 'Zadania', sub: 'Priorytety i polecenia', route: '/task-command-center' },
    { key: 'orders', icon: 'briefcase-outline' as IoniconName, label: 'Zlecenia', sub: 'Plan pracy i dowody', route: '/zlecenia' },
    { key: 'alerts', icon: 'notifications-outline' as IoniconName, label: 'Alerty', sub: 'Ryzyka i pilne sprawy', route: '/powiadomienia' },
    { key: 'docs', icon: 'document-text-outline' as IoniconName, label: 'Dokumenty', sub: 'Zdjęcia i protokoły', route: '/ogledziny-dokumentacja' },
  ];
  const managerActions = [
    { key: 'users', icon: 'people-outline' as IoniconName, label: 'Pracownicy', route: '/uzytkownicy-mobile' },
    { key: 'branches', icon: 'business-outline' as IoniconName, label: 'Oddziały', route: '/oddzialy-mobile' },
    { key: 'docs', icon: 'folder-open-outline' as IoniconName, label: 'Dokumenty', route: '/ogledziny-dokumentacja' },
    { key: 'api', icon: 'pulse-outline' as IoniconName, label: 'Diagnostyka', route: '/api-diagnostyka' },
  ];
  const rolePackageRows = isFieldWorker
    ? [
      { icon: 'shield-checkmark-outline' as IoniconName, label: 'BHP arborysty', value: 'PPE, strefa pracy, ryzyka' },
      { icon: 'construct-outline' as IoniconName, label: 'Sprzęt i uprawnienia', value: 'Piła, rębak, wysokość' },
      { icon: 'cash-outline' as IoniconName, label: 'Warunki rozliczenia', value: user?.rola === 'Brygadzista' ? `${user?.procent_wynagrodzenia || 15}% od zlecenia` : `${user?.stawka_godzinowa || 0} PLN/h` },
    ]
    : [
      { icon: 'document-text-outline' as IoniconName, label: 'Karta stanowiska', value: 'Obowiązki i odpowiedzialność' },
      { icon: 'desktop-outline' as IoniconName, label: 'Zakres biurowy', value: 'Klienci, zlecenia, kalendarz' },
      { icon: 'cash-outline' as IoniconName, label: 'Warunki rozliczenia', value: `${user?.stawka_godzinowa || 0} PLN/h` },
    ];

  return (
    <View style={S.root}>
      <AppStatusBar />

      {/* Header z awatarem */}
      <View style={S.heroHeader}>
        <TouchableOpacity onPress={() => safeBack()} style={S.backBtn}>
          <Ionicons name="arrow-back" size={22} color={theme.accent} />
        </TouchableOpacity>
        <View style={S.heroLeaf}>
          <Ionicons name="leaf-outline" size={20} color={theme.accent} />
        </View>
        <TouchableOpacity onPress={handleDevTap} style={S.avatar}>
          <Text style={S.avatarText}>{initials}</Text>
        </TouchableOpacity>
        <Text style={S.heroEyebrow}>Profil pracownika</Text>
        <Text style={S.name}>{user?.imie} {user?.nazwisko}</Text>
        <View style={[S.rolaBadge, { backgroundColor: rolaKolor + '33' }]}>
          <Text style={[S.rolaText, { color: rolaKolor }]}>{rolaLabel}</Text>
        </View>
        {user?.oddzial_nazwa ? (
          <View style={S.oddzialRow}>
            <Ionicons name="business-outline" size={13} color={theme.headerSub} />
            <Text style={S.oddzialText}> {user.oddzial_nazwa}</Text>
          </View>
        ) : null}
        <View style={S.profileStats}>
          {profileStats.map((stat) => (
            <View key={stat.key} style={S.profileStat}>
              <Text style={S.profileStatLabel}>{stat.label}</Text>
              <Text style={S.profileStatValue} numberOfLines={1}>{stat.value}</Text>
            </View>
          ))}
        </View>
      </View>

      <ScrollView style={S.scroll} showsVerticalScrollIndicator={false}>

        <View style={S.section}>
          <Text style={S.sectionTitle}>Centrum pracy</Text>
          <Text style={S.sectionSub}>Szybkie wejścia do codziennych modułów bez szukania po menu.</Text>
          <View style={S.workGrid}>
            {workActions.map((action) => (
              <TouchableOpacity
                key={action.key}
                style={S.workAction}
                onPress={() => router.push(action.route as never)}
                activeOpacity={0.86}
              >
                <View style={S.workActionIcon}>
                  <Ionicons name={action.icon} size={18} color={theme.accent} />
                </View>
                <Text style={S.workActionTitle}>{action.label}</Text>
                <Text style={S.workActionSub} numberOfLines={2}>{action.sub}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Dane kontaktowe */}
        <View style={S.section}>
          <Text style={S.sectionTitle}>{t('profile.title.contact')}</Text>
          {([
            { icon: 'mail-outline' as IoniconName, label: user?.email || t('profile.missingEmail') },
            { icon: 'call-outline' as IoniconName, label: user?.telefon || t('profile.missingPhone') },
            { icon: 'person-outline' as IoniconName, label: t('profile.loginLabel', { login: user?.login || '-' }) },
          ]).map((row, i) => (
            <View key={i} style={S.infoRow}>
              <View style={[S.infoIconBg, { backgroundColor: theme.surface2 }]}>
                <Ionicons name={row.icon} size={18} color={theme.accent} />
              </View>
              <Text style={S.infoText}>{row.label}</Text>
            </View>
          ))}
        </View>

        {/* Wynagrodzenie */}
        <View style={S.section}>
          <Text style={S.sectionTitle}>{t('profile.title.salary')}</Text>
          <View style={S.infoRow}>
            <View style={[S.infoIconBg, { backgroundColor: theme.surface2 }]}>
              <Ionicons name="cash-outline" size={18} color={theme.success} />
            </View>
            <Text style={S.infoText}>
              {user?.rola === 'Brygadzista'
                ? `${user?.procent_wynagrodzenia || 15}% od zlecenia`
                : `${user?.stawka_godzinowa || 0} PLN/h`}
            </Text>
          </View>
        </View>

        {/* ─── MOTYW APLIKACJI ─────────────────────────────────────────────── */}
        <View style={S.section}>
          <Text style={S.sectionTitle}>{isFieldWorker ? 'BHP i warunki pracy' : 'Karta stanowiska'}</Text>
          <Text style={S.sectionSub}>
            {isFieldWorker
              ? 'Pakiet terenowy: bezpieczeństwo, sprzęt i zasady rozliczenia.'
              : 'Pakiet biurowy: obowiązki, dostępy i zasady rozliczenia.'}
          </Text>
          <View style={S.rolePackage}>
            {rolePackageRows.map((row) => (
              <View key={row.label} style={S.rolePackageRow}>
                <View style={S.rolePackageIcon}>
                  <Ionicons name={row.icon} size={17} color={theme.accent} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={S.rolePackageTitle}>{row.label}</Text>
                  <Text style={S.rolePackageValue}>{row.value}</Text>
                </View>
                <View style={S.rolePackageStatus}>
                  <Text style={S.rolePackageStatusText}>aktywny</Text>
                </View>
              </View>
            ))}
          </View>
        </View>

        {isManager ? (
          <View style={S.section}>
            <Text style={S.sectionTitle}>Panel kierowniczy</Text>
            <Text style={S.sectionSub}>Szybkie przejścia do profili, oddziałów i diagnostyki aplikacji.</Text>
            <View style={S.managerGrid}>
              {managerActions.map((action) => (
                <TouchableOpacity
                  key={action.key}
                  style={S.managerAction}
                  onPress={() => router.push(action.route as never)}
                  activeOpacity={0.86}
                >
                  <View style={S.managerActionIcon}>
                    <Ionicons name={action.icon} size={18} color={theme.accent} />
                  </View>
                  <Text style={S.managerActionText}>{action.label}</Text>
                  <Ionicons name="chevron-forward" size={14} color={theme.textMuted} />
                </TouchableOpacity>
              ))}
            </View>
          </View>
        ) : null}

        <View style={S.section}>
          <Text style={S.sectionTitle}>{t('profile.title.theme')}</Text>
          <View style={S.themeRow}>
            {(['light', 'dark'] as const satisfies ThemeName[]).map((themeKey) => {
              const active = themeName === themeKey;
              const preview = themes[themeKey];
              return (
                <TouchableOpacity
                  key={themeKey}
                  style={[S.themeCard, active && { borderColor: theme.accent, borderWidth: 2.5 }]}
                  onPress={() => setTheme(themeKey)}
                  activeOpacity={0.8}
                >
                  {/* Miniaturka motywu */}
                  <View style={[S.themePrev, { backgroundColor: preview.bg }]}>
                    <View style={[S.themeDot, { backgroundColor: preview.accent }]} />
                  </View>
                  <Text style={[S.themeLabel, active && { color: theme.accent, fontWeight: '700' }]}>
                    {THEME_LABELS[themeKey]}
                  </Text>
                  {active && (
                    <View style={[S.themeCheck, { backgroundColor: theme.accent }]}>
                      <Ionicons name="checkmark" size={12} color={theme.accentText} />
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        <View style={S.section}>
          <Text style={S.sectionTitle}>{t('profile.title.language')}</Text>
          <View style={S.themeRow}>
            {(['pl', 'uk', 'ru'] as const).map((code) => {
              const active = language === code;
              return (
                <TouchableOpacity
                  key={code}
                  style={[S.themeCard, active && { borderColor: theme.accent, borderWidth: 2.5 }]}
                  onPress={() => setLanguage(code)}
                  activeOpacity={0.8}
                >
                  <Text style={[S.themeLabel, active && { color: theme.accent, fontWeight: '700' }]}>
                    {t(`profile.lang.${code}`)}
                  </Text>
                  {active && (
                    <View style={[S.themeCheck, { backgroundColor: theme.accent }]}>
                      <Ionicons name="checkmark" size={12} color={theme.accentText} />
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        <View style={S.section}>
          <Text style={S.sectionTitle}>{t('profile.biometric.title')}</Text>
          <Text style={{ color: theme.textMuted, fontSize: 13, marginBottom: 12 }}>{t('profile.biometric.sub')}</Text>
          {!bioSupported ? (
            <Text style={{ color: theme.textSub, fontSize: 13 }}>{t('profile.biometric.unavailable')}</Text>
          ) : (
            <TouchableOpacity
              style={[S.themeCard, { borderColor: theme.border, paddingVertical: 12, alignItems: 'center' }]}
              onPress={async () => {
                const next = !bioOn;
                await setPrivacyLockEnabled(next);
                setBioOn(next);
              }}
            >
              <Text style={{ fontWeight: '700', color: theme.accent }}>
                {bioOn ? t('profile.biometric.disable') : t('profile.biometric.enable')}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {isFieldWorker ? (
          <View style={S.section}>
            <Text style={S.sectionTitle}>GPS live</Text>
            <Text style={{ color: theme.textMuted, fontSize: 13, marginBottom: 12 }}>
              {liveGpsPrivacyNote}
            </Text>
            <View style={[S.settingRow, { borderColor: theme.border, backgroundColor: theme.cardBg }]}>
              <View style={{ flex: 1 }}>
                <Text style={[S.settingTitle, { color: theme.text }]}>Wysylaj pozycje podczas pracy</Text>
                <Text style={[S.settingSub, { color: theme.textMuted }]}>
                  Wylaczenie zatrzymuje wysylke pozycji bez zmiany zgod systemowych telefonu.
                </Text>
                <View style={S.gpsStatusRow}>
                  <View style={[S.gpsStatusDot, { backgroundColor: liveGpsStatusColor }]} />
                  <Text style={[S.gpsStatusText, { color: liveGpsStatusColor }]}>{liveGpsStatusLabel}</Text>
                  <Text style={[S.gpsStatusMeta, { color: theme.textMuted }]}>ostatni sync: {liveGpsLastSync}</Text>
                </View>
                {liveGpsOn && liveGpsStatus?.message ? (
                  <Text style={[S.settingSub, { color: theme.textMuted }]} numberOfLines={2}>
                    {liveGpsStatus.message}
                  </Text>
                ) : null}
                {liveGpsOn && liveGpsStatus?.kind === 'blocked' ? (
                  <Text style={[S.settingSub, { color: theme.danger }]} numberOfLines={3}>
                    Otworz ustawienia systemowe aplikacji i wlacz dostep do lokalizacji podczas uzywania aplikacji.
                  </Text>
                ) : null}
              </View>
              <Switch
                value={liveGpsOn}
                onValueChange={(next: boolean) => {
                  setLiveGpsOn(next);
                  void setLiveGpsEnabled(next);
                }}
              />
            </View>
          </View>
        ) : null}

        <View style={S.section}>
          <Text style={S.sectionTitle}>{t('profile.syncRemote.title')}</Text>
          <Text style={{ color: theme.textMuted, fontSize: 13, marginBottom: 12 }}>{t('profile.syncRemote.sub')}</Text>
          <TouchableOpacity
            style={[S.themeCard, { borderColor: theme.border, paddingVertical: 12, alignItems: 'center', opacity: syncingRemote ? 0.6 : 1 }]}
            disabled={syncingRemote}
            onPress={async () => {
              setSyncingRemote(true);
              try {
                const { token } = await getStoredSession();
                if (!token) {
                  Alert.alert('', t('profile.syncRemote.fail'));
                  return;
                }
                const r = await fetchAndApplyMobileRemoteConfig(token);
                if (!r.ok) Alert.alert('', t('profile.syncRemote.fail'));
                else if (r.applied) Alert.alert('', t('profile.syncRemote.ok'));
                else Alert.alert('', t('profile.syncRemote.partial'));
              } catch {
                Alert.alert('', t('profile.syncRemote.fail'));
              } finally {
                setSyncingRemote(false);
              }
            }}
          >
            <Text style={{ fontWeight: '700', color: theme.accent }}>{t('profile.syncRemote.btn')}</Text>
          </TouchableOpacity>
        </View>

        {/* Wyloguj */}
        <TouchableOpacity style={S.logoutBtn} onPress={handleLogout} activeOpacity={0.85}>
          <Ionicons name="log-out-outline" size={20} color={theme.danger} />
          <Text style={S.logoutText}>{t('profile.logout')}</Text>
        </TouchableOpacity>

        <View style={{ height: 50 }} />
      </ScrollView>
    </View>
  );
}

const makeStyles = (t: Theme) => StyleSheet.create({
  root: { flex: 1, backgroundColor: t.bg },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: t.bg },
  scroll: { flex: 1 },

  heroHeader: {
    backgroundColor: t.cardBg,
    alignItems: 'center',
    paddingTop: 58,
    paddingBottom: 18,
    paddingHorizontal: 18,
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: t.cardBorder,
    ...shadowStyle(t, {
      opacity: t.shadowOpacity * 0.16,
      radius: t.shadowRadius * 0.48,
      offsetY: 3,
      elevation: t.cardElevation + 1,
    }),
  },
  backBtn: {
    position: 'absolute',
    top: 14,
    left: 14,
    width: 42,
    height: 42,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: t.border,
    backgroundColor: t.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroLeaf: {
    position: 'absolute',
    top: 14,
    right: 14,
    width: 42,
    height: 42,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: t.accent,
    backgroundColor: t.accentLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatar: {
    width: 86, height: 86, borderRadius: 28,
    backgroundColor: t.accentLight,
    justifyContent: 'center', alignItems: 'center',
    marginBottom: 10,
    borderWidth: 2, borderColor: t.accent,
  },
  avatarText: { fontSize: 30, fontWeight: '900', color: t.accent },
  heroEyebrow: {
    color: t.textMuted,
    fontSize: 10,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 0,
    marginBottom: 4,
  },
  name: { fontSize: 23, fontWeight: '900', color: t.text, marginBottom: 8, textAlign: 'center' },
  rolaBadge: { borderRadius: 16, paddingHorizontal: 14, paddingVertical: 6, marginBottom: 8, borderWidth: 1, borderColor: t.border },
  rolaText: { fontSize: 12, fontWeight: '900' },
  oddzialRow: { flexDirection: 'row', alignItems: 'center' },
  oddzialText: { fontSize: 12, color: t.textSub, fontWeight: '700' },
  profileStats: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 14,
    width: '100%',
  },
  profileStat: {
    flex: 1,
    minHeight: 58,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: t.border,
    backgroundColor: t.surface2,
    paddingHorizontal: 8,
    paddingVertical: 9,
    justifyContent: 'center',
  },
  profileStatLabel: {
    color: t.textMuted,
    fontSize: 9,
    fontWeight: '900',
    textTransform: 'uppercase',
    marginBottom: 3,
  },
  profileStatValue: {
    color: t.text,
    fontSize: 12,
    fontWeight: '900',
  },

  section: {
    backgroundColor: t.cardBg, marginHorizontal: 16, marginTop: 14,
    borderRadius: 18, padding: 14, borderWidth: 1, borderColor: t.cardBorder,
    ...shadowStyle(t, {
      opacity: t.shadowOpacity * 0.1,
      radius: t.shadowRadius * 0.34,
      offsetY: 2,
      elevation: t.cardElevation,
    }),
  },
  sectionTitle: { fontSize: 15, fontWeight: '900', color: t.text, marginBottom: 12 },
  sectionSub: { color: t.textMuted, fontSize: 12, lineHeight: 17, fontWeight: '700', marginBottom: 12 },
  workGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  workAction: {
    flexGrow: 1,
    flexBasis: '47%',
    minHeight: 112,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: t.border,
    backgroundColor: t.surface2,
    padding: 12,
    justifyContent: 'space-between',
  },
  workActionIcon: {
    width: 38,
    height: 38,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: t.accent + '55',
    backgroundColor: t.accentLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  workActionTitle: { color: t.text, fontSize: 14, fontWeight: '900' },
  workActionSub: { color: t.textMuted, fontSize: 11.5, lineHeight: 16, fontWeight: '700', marginTop: 2 },
  rolePackage: { gap: 9 },
  rolePackageRow: {
    minHeight: 58,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: t.border,
    backgroundColor: t.surface2,
    paddingHorizontal: 10,
    paddingVertical: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  rolePackageIcon: {
    width: 38,
    height: 38,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: t.accent + '55',
    backgroundColor: t.accentLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rolePackageTitle: { color: t.text, fontSize: 13, fontWeight: '900' },
  rolePackageValue: { color: t.textMuted, fontSize: 11.5, lineHeight: 16, fontWeight: '700', marginTop: 1 },
  rolePackageStatus: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: t.success + '55',
    backgroundColor: t.successBg,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  rolePackageStatusText: { color: t.success, fontSize: 10, fontWeight: '900' },
  infoRow: {
    flexDirection: 'row', alignItems: 'center',
    gap: 12, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: t.border,
  },
  infoIconBg: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  infoText: { fontSize: 14, color: t.text, flex: 1, fontWeight: '700' },
  managerGrid: { gap: 9 },
  managerAction: {
    minHeight: 48,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: t.border,
    backgroundColor: t.surface2,
    paddingHorizontal: 10,
    paddingVertical: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  managerActionIcon: {
    width: 34,
    height: 34,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: t.accent,
    backgroundColor: t.accentLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  managerActionText: { flex: 1, color: t.text, fontSize: 13, fontWeight: '900' },

  // Motyw
  themeRow: { flexDirection: 'row', gap: 10 },
  themeCard: {
    flex: 1, alignItems: 'center', gap: 8,
    padding: 12, borderRadius: 14,
    backgroundColor: t.surface2,
    borderWidth: 1.5, borderColor: t.border,
    position: 'relative',
  },
  themePrev: {
    width: '100%', height: 44, borderRadius: 10,
    justifyContent: 'center', alignItems: 'center',
  },
  themeDot: { width: 18, height: 18, borderRadius: 9 },
  themeLabel: { fontSize: 11, color: t.textSub, textAlign: 'center' },
  themeCheck: {
    position: 'absolute', top: -6, right: -6,
    width: 20, height: 20, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
  },
  settingRow: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  settingTitle: { fontSize: 14, fontWeight: '800' },
  settingSub: { fontSize: 12, lineHeight: 17, marginTop: 3 },
  gpsStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 9,
    flexWrap: 'wrap',
  },
  gpsStatusDot: { width: 8, height: 8, borderRadius: 4 },
  gpsStatusText: { fontSize: 12, fontWeight: '900' },
  gpsStatusMeta: { fontSize: 11, fontWeight: '600' },

  logoutBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, margin: 16, padding: 16,
    borderRadius: 14, backgroundColor: t.dangerBg,
    borderWidth: 1, borderColor: t.danger + '44',
  },
  logoutText: {
    fontSize: 15, fontWeight: '700',
    color: t.danger,
  },
});
