import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView,
  Platform, StyleSheet, Text, TextInput,
  TouchableOpacity, View,
} from 'react-native';
import { AppStatusBar } from '../components/ui/app-status-bar';
import { PlatinumCTA } from '../components/ui/platinum-cta';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLanguage } from '../constants/LanguageContext';
import { useTheme } from '../constants/ThemeContext';
import { CUSTOM_API_URL_STORAGE_KEY, setRuntimeApiUrl } from '../constants/api';
import { shadowStyle } from '../constants/elevation';
import type { Theme } from '../constants/theme';
import { triggerHaptic } from '../utils/haptics';
import { saveStoredSession } from '../utils/session';
import { tryRegisterPushTokenAfterAuth } from '../utils/expo-push-backend';
import { apiUrl } from '../utils/api-client';

const LAST_LOGIN_KEY = 'last_login_value';
const REMEMBER_LOGIN_KEY = 'remember_login_enabled';
const SERVER_PROBE_TIMEOUT_MS = 8000;
const LOGIN_TIMEOUT_MS = 20000;
const LOGIN_RETRY_DELAY_MS = 900;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const isRetriableLoginStatus = (status: number) => status >= 500 && status < 600;

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
  const canSubmit = Boolean(login.trim()) && Boolean(haslo) && !loading && !isLocked;

  const probeStatus = useCallback(async (path: string): Promise<number | null> => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), SERVER_PROBE_TIMEOUT_MS);
    try {
      const response = await fetch(apiUrl(path), { signal: controller.signal });
      return response.status;
    } catch {
      return null;
    } finally {
      clearTimeout(timeoutId);
    }
  }, []);

  const checkServer = useCallback(async () => {
    setCheckingServer(true);
    setServerStatus('checking');
    try {
      const [healthStatus, authStatus] = await Promise.all([
        probeStatus('/health'),
        probeStatus('/auth/me'),
      ]);
      const online =
        (healthStatus !== null && healthStatus !== 404) ||
        (authStatus !== null && authStatus !== 404);
      setServerStatus(online ? 'online' : 'offline');
    } catch {
      setServerStatus('offline');
    } finally {
      setCheckingServer(false);
    }
  }, [probeStatus]);

  useEffect(() => {
    void (async () => {
      const [customUrl, pairs] = await Promise.all([
        AsyncStorage.getItem(CUSTOM_API_URL_STORAGE_KEY).catch(() => null),
        AsyncStorage.multiGet([LAST_LOGIN_KEY, REMEMBER_LOGIN_KEY]),
      ]);
      if (customUrl) setRuntimeApiUrl(customUrl);
      await checkServer();
      const savedLogin = pairs[0]?.[1] ?? '';
      const savedRemember = pairs[1]?.[1];
      const remember = savedRemember === null ? true : savedRemember === 'true';
      setRememberLogin(remember);
      if (remember && savedLogin) setLogin(savedLogin);
    })();
  }, [checkServer]);

  useEffect(() => {
    if (serverStatus !== 'offline' || checkingServer) return;
    const intervalId = setInterval(() => {
      void checkServer();
    }, 10000);
    return () => clearInterval(intervalId);
  }, [serverStatus, checkingServer, checkServer]);

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

  const postLogin = useCallback(async () => {
    const loginController = new AbortController();
    const loginTimeout = setTimeout(() => loginController.abort(), LOGIN_TIMEOUT_MS);
    return fetch(apiUrl('/auth/login'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: login.trim(), haslo }),
      signal: loginController.signal,
    }).finally(() => clearTimeout(loginTimeout));
  }, [haslo, login]);

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

      let response = await postLogin();
      if (isRetriableLoginStatus(response.status)) {
        await sleep(LOGIN_RETRY_DELAY_MS);
        response = await postLogin();
      }
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
        const requestId = typeof data?.requestId === 'string' && data.requestId ? data.requestId : null;
        const defaultMessage = response.status === 401
          ? t('login.badCredentials')
          : t('login.serverError', { status: response.status });
        const messageWithRequestId = requestId ? `${backendMessage || defaultMessage} ID: ${requestId}` : backendMessage || defaultMessage;
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
          setErrorMessage(messageWithRequestId);
        }
      }
    } catch (err) {
      void triggerHaptic('error');
      const isTimeout = err instanceof Error && err.name === 'AbortError';
      setErrorMessage(isTimeout
        ? (t('login.timeout') || 'Serwer nie odpowiada — spróbuj za chwilę')
        : t('login.networkError'));
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
      <AppStatusBar backgroundColor={theme.bg} />

      <View style={S.shell}>
        <View style={S.brandArea}>
          <View style={S.logoCircle}>
            <Ionicons name="leaf" size={38} color={theme.accentText} />
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

        <Text style={S.footer}>Arbor Services 2026</Text>
      </View>
    </KeyboardAvoidingView>
  );
}

const makeStyles = (t: Theme) => StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: t.bg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  shell: {
    width: '100%',
    maxWidth: 460,
    alignSelf: 'center',
  },
  brandArea: { alignItems: 'center', marginBottom: 22 },
  logoCircle: {
    width: 74, height: 74, borderRadius: 20,
    backgroundColor: t.accent,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 12,
    ...shadowStyle(t, {
      opacity: t.shadowOpacity * 0.28,
      radius: t.shadowRadius * 0.5,
      offsetY: Math.max(2, t.shadowOffsetY - 1),
      elevation: 4,
    }),
  },
  appName: {
    fontSize: 29, fontWeight: '900',
    color: t.text, letterSpacing: 0, marginBottom: 5,
  },
  tagline: { fontSize: 13, color: t.textSub, letterSpacing: 0, fontWeight: '700' },
  card: {
    width: '100%',
    backgroundColor: t.surface,
    borderRadius: t.radiusLg, padding: 20,
    borderWidth: 1, borderColor: t.cardBorder,
    ...shadowStyle(t, {
      offsetY: Math.max(2, t.shadowOffsetY),
      elevation: 3,
    }),
  },
  cardTitle: {
    fontSize: 20, fontWeight: '900',
    color: t.text, marginBottom: 16, letterSpacing: 0,
  },
  serverRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: -6,
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
    borderWidth: 1, borderColor: t.inputBorder,
    borderRadius: 12, paddingHorizontal: 13,
    marginBottom: 12, height: 50,
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
    borderRadius: 14,
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
    backgroundColor: t.accent, borderRadius: 12,
    height: 50, alignItems: 'center', justifyContent: 'center',
    marginTop: 6,
    ...shadowStyle(t, {
      opacity: t.shadowOpacity * 0.2,
      radius: t.shadowRadius * 0.45,
      offsetY: t.shadowOffsetY,
      elevation: 2,
    }),
  },
  btnDisabled: { opacity: 0.6 },
  footer: { marginTop: 18, fontSize: 12, color: t.textMuted, textAlign: 'center' },
});
