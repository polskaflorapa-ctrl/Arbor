import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView,
  Platform, StyleSheet, Text, TextInput,
  TouchableOpacity, View, StatusBar,
} from 'react-native';
import { PlatinumCTA } from '../components/ui/platinum-cta';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLanguage } from '../constants/LanguageContext';
import { useTheme } from '../constants/ThemeContext';
import { API_URL } from '../constants/api';
import type { Theme } from '../constants/theme';
import { triggerHaptic } from '../utils/haptics';
import { saveStoredSession } from '../utils/session';
import { tryRegisterPushTokenAfterAuth } from '../utils/expo-push-backend';

const LAST_LOGIN_KEY = 'last_login_value';
const REMEMBER_LOGIN_KEY = 'remember_login_enabled';

export default function Login() {
  const { theme } = useTheme();
  const { t } = useLanguage();
  const [login, setLogin] = useState('');
  const [haslo, setHaslo] = useState('');
  const [showHaslo, setShowHaslo] = useState(false);
  const [loading, setLoading] = useState(false);
  const [checkingServer, setCheckingServer] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [capsLockOn, setCapsLockOn] = useState(false);
  const [rememberLogin, setRememberLogin] = useState(true);
  const [serverStatus, setServerStatus] = useState<'checking' | 'online' | 'offline'>('checking');
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [lockUntil, setLockUntil] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState(Date.now());
  const [lastAttemptLogin, setLastAttemptLogin] = useState<string>('');
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const isLocked = lockUntil !== null && nowMs < lockUntil;
  const lockSecondsLeft = isLocked ? Math.max(1, Math.ceil((lockUntil! - nowMs) / 1000)) : 0;
  const canSubmit = Boolean(login.trim()) && Boolean(haslo) && !loading && serverStatus !== 'offline' && !isLocked;

  const checkServer = async () => {
    setCheckingServer(true);
    setServerStatus('checking');
    try {
      const res = await fetch(`${API_URL}/auth/me`);
      if (res.status === 401 || res.status === 403 || res.ok) {
        setServerStatus('online');
      } else {
        setServerStatus('offline');
      }
    } catch {
      setServerStatus('offline');
    } finally {
      setCheckingServer(false);
    }
  };

  useEffect(() => {
    void checkServer();
    AsyncStorage.multiGet([LAST_LOGIN_KEY, REMEMBER_LOGIN_KEY]).then((pairs) => {
      const savedLogin = pairs[0]?.[1] ?? '';
      const savedRemember = pairs[1]?.[1];
      const remember = savedRemember === null ? true : savedRemember === 'true';
      setRememberLogin(remember);
      if (remember && savedLogin) setLogin(savedLogin);
    });
  }, []);

  useEffect(() => {
    if (serverStatus !== 'offline' || checkingServer) return;
    const intervalId = setInterval(() => {
      void checkServer();
    }, 10000);
    return () => clearInterval(intervalId);
  }, [serverStatus, checkingServer]);

  useEffect(() => {
    if (!isLocked) return;
    const intervalId = setInterval(() => {
      const now = Date.now();
      setNowMs(now);
      if (lockUntil && now >= lockUntil) {
        setLockUntil(null);
        setFailedAttempts(0);
      }
    }, 1000);
    return () => clearInterval(intervalId);
  }, [isLocked, lockUntil]);

  const handleLogin = async () => {
    if (isLocked) {
      void triggerHaptic('warning');
      setErrorMessage(t('login.lockError', { seconds: lockSecondsLeft }));
      return;
    }
    if (!login.trim() || !haslo) {
      void triggerHaptic('warning');
      setErrorMessage(t('login.missingCredentials'));
      return;
    }
    setErrorMessage(null);
    setLoading(true);
    try {
      const normalizedLogin = login.trim().toLowerCase();
      if (lastAttemptLogin && lastAttemptLogin !== normalizedLogin) {
        setFailedAttempts(0);
        setLockUntil(null);
      }

      const response = await fetch(`${API_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login: login.trim(), haslo }),
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok) {
        if (!data?.token || !data?.user) {
          throw new Error(t('login.invalidResponse'));
        }
        setFailedAttempts(0);
        setLockUntil(null);
        if (rememberLogin) {
          await AsyncStorage.multiSet([
            [LAST_LOGIN_KEY, login.trim()],
            [REMEMBER_LOGIN_KEY, 'true'],
          ]);
        } else {
          await AsyncStorage.multiRemove([LAST_LOGIN_KEY, REMEMBER_LOGIN_KEY]);
        }
        await saveStoredSession(data.token, data.user);
        void triggerHaptic('success');
        const { fetchAndApplyMobileRemoteConfig } = await import('../utils/mobile-remote-config');
        void fetchAndApplyMobileRemoteConfig(data.token);
        void tryRegisterPushTokenAfterAuth(data.token);
        router.replace('/dashboard');
      } else {
        const backendMessage =
          (typeof data?.error === 'string' && data.error) ||
          (typeof data?.message === 'string' && data.message) ||
          null;
        const defaultMessage = response.status === 401
          ? t('login.badCredentials')
          : t('login.serverError', { status: response.status });
        const nextFailedAttempts = (response.status === 401 || response.status === 403)
          ? failedAttempts + 1
          : failedAttempts;
        setLastAttemptLogin(normalizedLogin);
        setFailedAttempts(nextFailedAttempts);
        if (nextFailedAttempts >= 5) {
          void triggerHaptic('error');
          const nextLockUntil = Date.now() + 30000;
          setLockUntil(nextLockUntil);
          setNowMs(Date.now());
          setErrorMessage(t('login.locked30'));
        } else {
          void triggerHaptic('warning');
          setErrorMessage(backendMessage || defaultMessage);
        }
      }
    } catch {
      void triggerHaptic('error');
      setErrorMessage(t('login.networkError'));
    } finally {
      setLoading(false);
    }
  };

  const S = makeStyles(theme);

  return (
    <KeyboardAvoidingView
      style={S.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top : 0}
    >
      <StatusBar
        barStyle={theme.name === 'dark' ? 'light-content' : 'dark-content'}
        backgroundColor={theme.bg}
      />

      <View style={S.brandArea}>
        <View style={S.logoCircle}>
          <Ionicons name="leaf" size={40} color={theme.accentText} />
        </View>
        <Text style={S.appName}>ARBOR-OS</Text>
        <Text style={S.tagline}>{t('login.subtitle')}</Text>
      </View>

      <View style={S.card}>
        <Text style={S.cardTitle}>{t('login.title')}</Text>
        <View style={S.serverRow}>
          <Ionicons
            name={serverStatus === 'online' ? 'cloud-done-outline' : serverStatus === 'offline' ? 'cloud-offline-outline' : 'sync-outline'}
            size={14}
            color={serverStatus === 'online' ? theme.success : serverStatus === 'offline' ? theme.danger : theme.textMuted}
          />
          <Text style={[S.serverText, { color: serverStatus === 'online' ? theme.success : serverStatus === 'offline' ? theme.danger : theme.textMuted }]}>
            {serverStatus === 'online' ? t('login.backendOnline') : serverStatus === 'offline' ? t('login.backendOffline') : t('login.backendChecking')}
          </Text>
        </View>
        {serverStatus === 'offline' ? (
          <TouchableOpacity style={S.retryBtn} onPress={() => void checkServer()} disabled={checkingServer}>
            {checkingServer ? <ActivityIndicator size="small" color={theme.accentText} /> : <Ionicons name="refresh-outline" size={14} color={theme.accentText} />}
            <Text style={S.retryBtnText}>{t('login.retryConnection')}</Text>
          </TouchableOpacity>
        ) : null}

        <View style={S.inputWrap}>
          <Ionicons name="person-outline" size={18} color={theme.textMuted} style={S.inputIcon} />
          <TextInput
            style={S.input}
            placeholder={t('login.loginPlaceholder')}
            placeholderTextColor={theme.inputPlaceholder}
            value={login}
            onChangeText={(value) => {
              setLogin(value);
              if (errorMessage) setErrorMessage(null);
            }}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="next"
          />
        </View>

        <View style={S.inputWrap}>
          <Ionicons name="lock-closed-outline" size={18} color={theme.textMuted} style={S.inputIcon} />
          <TextInput
            style={S.inputFlex}
            placeholder={t('login.passwordPlaceholder')}
            placeholderTextColor={theme.inputPlaceholder}
            value={haslo}
            onChangeText={(value) => {
              setHaslo(value);
              if (errorMessage) setErrorMessage(null);
            }}
            secureTextEntry={!showHaslo}
            returnKeyType="done"
            onSubmitEditing={handleLogin}
            onKeyPress={(event) => {
              if (Platform.OS !== 'web') return;
              const native = event?.nativeEvent as unknown as { getModifierState?: (key: string) => boolean };
              if (typeof native?.getModifierState === 'function') {
                setCapsLockOn(native.getModifierState('CapsLock'));
              }
            }}
            onBlur={() => setCapsLockOn(false)}
          />
          <TouchableOpacity onPress={() => setShowHaslo(v => !v)} style={S.eyeBtn}>
            <Ionicons
              name={showHaslo ? 'eye-off-outline' : 'eye-outline'}
              size={20}
              color={theme.textMuted}
            />
          </TouchableOpacity>
        </View>
        {capsLockOn ? (
          <View style={S.capsLockRow}>
            <Ionicons name="warning-outline" size={14} color={theme.warning} />
            <Text style={S.capsLockText}>{t('login.capsLock')}</Text>
          </View>
        ) : null}
        <TouchableOpacity
          style={S.rememberRow}
          onPress={() => {
            setRememberLogin((prev) => {
              const next = !prev;
              AsyncStorage.setItem(REMEMBER_LOGIN_KEY, next ? 'true' : 'false');
              if (!next) {
                AsyncStorage.removeItem(LAST_LOGIN_KEY);
              }
              return next;
            });
          }}
        >
          <Ionicons
            name={rememberLogin ? 'checkbox-outline' : 'square-outline'}
            size={18}
            color={rememberLogin ? theme.accent : theme.textMuted}
          />
          <Text style={S.rememberText}>{t('login.rememberMe')}</Text>
        </TouchableOpacity>
        {errorMessage ? (
          <View style={S.errorBox}>
            <Ionicons name="alert-circle-outline" size={16} color={theme.danger} />
            <Text style={S.errorText}>{errorMessage}</Text>
          </View>
        ) : null}
        {isLocked ? (
          <View style={S.lockInfoRow}>
            <Ionicons name="time-outline" size={14} color={theme.warning} />
            <Text style={S.lockInfoText}>{t('login.lockedIn', { seconds: lockSecondsLeft })}</Text>
          </View>
        ) : null}

        <PlatinumCTA
          style={[S.btn, !canSubmit && S.btnDisabled]}
          label={t('login.submit')}
          onPress={handleLogin}
          disabled={!canSubmit}
          loading={loading}
        />
      </View>

      <Text style={S.footer}>Arbor Services © 2025</Text>
    </KeyboardAvoidingView>
  );
}

const makeStyles = (t: Theme) => StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: t.bg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  brandArea: { alignItems: 'center', marginBottom: 36 },
  logoCircle: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: t.accent,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 16,
    shadowColor: t.shadowColor,
    shadowOpacity: t.shadowOpacity * 0.6,
    shadowRadius: t.shadowRadius + 2,
    shadowOffset: { width: 0, height: t.shadowOffsetY + 1 },
    elevation: 8,
  },
  appName: {
    fontSize: 30, fontWeight: '800',
    color: t.text, letterSpacing: 2, marginBottom: 4,
  },
  tagline: { fontSize: 14, color: t.textSub },
  card: {
    width: '100%',
    backgroundColor: t.surface,
    borderRadius: 24, padding: 24,
    borderWidth: 1, borderColor: t.border,
    shadowColor: t.shadowColor,
    shadowOpacity: t.shadowOpacity * 0.85,
    shadowRadius: t.shadowRadius + 3,
    shadowOffset: { width: 0, height: t.shadowOffsetY + 2 },
    elevation: 6,
  },
  cardTitle: {
    fontSize: 20, fontWeight: '700',
    color: t.text, marginBottom: 20,
  },
  serverRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: -8,
    marginBottom: 12,
  },
  serverText: { fontSize: 12, fontWeight: '600' },
  retryBtn: {
    marginTop: -2,
    marginBottom: 12,
    alignSelf: 'flex-start',
    backgroundColor: t.accent,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  retryBtnText: { color: t.accentText, fontSize: 12, fontWeight: '700' },
  inputWrap: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: t.inputBg,
    borderWidth: 1.5, borderColor: t.inputBorder,
    borderRadius: 14, paddingHorizontal: 14,
    marginBottom: 14, height: 52,
  },
  inputIcon: { marginRight: 10 },
  input: { flex: 1, fontSize: 16, color: t.inputText },
  inputFlex: { flex: 1, fontSize: 16, color: t.inputText },
  eyeBtn: { padding: 4 },
  capsLockRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: -2,
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  capsLockText: { fontSize: 12, color: t.warning, fontWeight: '600' },
  rememberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: -2,
    marginBottom: 10,
    paddingHorizontal: 2,
  },
  rememberText: { fontSize: 13, color: t.textSub, fontWeight: '600' },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: t.dangerBg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: t.danger + '66',
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: -2,
    marginBottom: 8,
  },
  errorText: { flex: 1, fontSize: 13, color: t.danger, fontWeight: '600' },
  lockInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: -2,
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  lockInfoText: { fontSize: 12, color: t.warning, fontWeight: '600' },
  btn: {
    backgroundColor: t.accent, borderRadius: 14,
    height: 52, alignItems: 'center', justifyContent: 'center',
    marginTop: 6,
    shadowColor: t.shadowColor,
    shadowOpacity: t.shadowOpacity * 0.5,
    shadowRadius: t.shadowRadius,
    shadowOffset: { width: 0, height: t.shadowOffsetY },
    elevation: 5,
  },
  btnDisabled: { opacity: 0.6 },
  footer: { marginTop: 32, fontSize: 12, color: t.textMuted },
});
