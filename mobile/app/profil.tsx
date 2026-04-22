import { Ionicons } from '@expo/vector-icons';
import * as LocalAuthentication from 'expo-local-authentication';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View, StatusBar } from 'react-native';
import { isPrivacyLockEnabled, setPrivacyLockEnabled } from '../components/app-privacy-lock';
import { useLanguage } from '../constants/LanguageContext';
import { useTheme } from '../constants/ThemeContext';
import { THEME_LABELS, ThemeName, themes } from '../constants/theme';
import type { Theme } from '../constants/theme';
import { useOddzialFeatureGuard } from '../hooks/use-oddzial-feature-guard';
import { fetchAndApplyMobileRemoteConfig } from '../utils/mobile-remote-config';
import { clearStoredSession, getStoredSession } from '../utils/session';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

export default function ProfilScreen() {
  const { theme, themeName, setTheme } = useTheme();
  const { language, setLanguage, t } = useLanguage();
  const rolaKolorMap = useMemo(() => ({
    Dyrektor: theme.chartViolet,
    Administrator: theme.warning,
    Kierownik: theme.info,
    Brygadzista: theme.success,
    Pomocnik: theme.textMuted,
  }), [theme]);
  const guard = useOddzialFeatureGuard('/profil');
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [bioSupported, setBioSupported] = useState(false);
  const [bioOn, setBioOn] = useState(false);
  const [syncingRemote, setSyncingRemote] = useState(false);
  const router = useRouter();

  useEffect(() => { loadUser(); }, []);

  useEffect(() => {
    void (async () => {
      setBioOn(await isPrivacyLockEnabled());
      const h = await LocalAuthentication.hasHardwareAsync();
      const e = await LocalAuthentication.isEnrolledAsync();
      setBioSupported(Boolean(h && e));
    })();
  }, []);

  const loadUser = async () => {
    const { user: storedUser } = await getStoredSession();
    if (storedUser) setUser(storedUser);
    setLoading(false);
  };

  const handleLogout = () => {
    Alert.alert(t('profile.logout.title'), t('profile.logout.confirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('profile.logout.action'), style: 'destructive',
        onPress: async () => {
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

  return (
    <View style={S.root}>
      <StatusBar barStyle={theme.name === 'dark' ? 'light-content' : 'dark-content'} backgroundColor={theme.headerBg} />

      {/* Header z awatarem */}
      <View style={S.heroHeader}>
        <TouchableOpacity onPress={() => router.back()} style={S.backBtn}>
          <Ionicons name="arrow-back" size={24} color={theme.headerText} />
        </TouchableOpacity>
        <View style={S.avatar}>
          <Text style={S.avatarText}>{user?.imie?.[0]}{user?.nazwisko?.[0]}</Text>
        </View>
        <Text style={S.name}>{user?.imie} {user?.nazwisko}</Text>
        <View style={[S.rolaBadge, { backgroundColor: rolaKolor + '33' }]}>
          <Text style={[S.rolaText, { color: rolaKolor }]}>{user?.rola}</Text>
        </View>
        {user?.oddzial_nazwa ? (
          <View style={S.oddzialRow}>
            <Ionicons name="business-outline" size={13} color={theme.headerSub} />
            <Text style={S.oddzialText}> {user.oddzial_nazwa}</Text>
          </View>
        ) : null}
      </View>

      <ScrollView style={S.scroll} showsVerticalScrollIndicator={false}>

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
          <Text style={S.sectionTitle}>{t('profile.title.theme')}</Text>
          <View style={S.themeRow}>
            {(['dark', 'light', 'green'] as ThemeName[]).map((themeKey) => {
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
    backgroundColor: t.headerBg,
    alignItems: 'center',
    paddingTop: 56, paddingBottom: 28,
    paddingHorizontal: 24,
    borderBottomWidth: 1, borderBottomColor: t.border,
  },
  backBtn: { position: 'absolute', top: 56, left: 16, width: 40, height: 40, justifyContent: 'center' },
  avatar: {
    width: 88, height: 88, borderRadius: 44,
    backgroundColor: t.accent + '33',
    justifyContent: 'center', alignItems: 'center',
    marginBottom: 12,
    borderWidth: 3, borderColor: t.accent,
  },
  avatarText: { fontSize: 34, fontWeight: '800', color: t.accent },
  name: { fontSize: 22, fontWeight: '800', color: t.headerText, marginBottom: 8 },
  rolaBadge: { borderRadius: 20, paddingHorizontal: 14, paddingVertical: 5, marginBottom: 8 },
  rolaText: { fontSize: 13, fontWeight: '700' },
  oddzialRow: { flexDirection: 'row', alignItems: 'center' },
  oddzialText: { fontSize: 12, color: t.headerSub },

  section: {
    backgroundColor: t.surface, marginHorizontal: 16, marginTop: 16,
    borderRadius: 18, padding: 18, borderWidth: 1, borderColor: t.border,
    shadowColor: t.shadowColor,
    shadowOpacity: t.shadowOpacity * 0.65,
    shadowRadius: t.shadowRadius,
    shadowOffset: { width: 0, height: t.shadowOffsetY },
    elevation: 3,
  },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: t.text, marginBottom: 14 },
  infoRow: {
    flexDirection: 'row', alignItems: 'center',
    gap: 12, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: t.border,
  },
  infoIconBg: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  infoText: { fontSize: 14, color: t.text, flex: 1 },

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
