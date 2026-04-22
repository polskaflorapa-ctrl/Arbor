import AsyncStorage from '@react-native-async-storage/async-storage';
import * as LocalAuthentication from 'expo-local-authentication';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTheme } from '../constants/ThemeContext';

export const PRIVACY_LOCK_KEY = 'privacy_lock_biometric_v1';

export async function isPrivacyLockEnabled(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(PRIVACY_LOCK_KEY)) === '1';
  } catch {
    return false;
  }
}

export async function setPrivacyLockEnabled(on: boolean): Promise<void> {
  await AsyncStorage.setItem(PRIVACY_LOCK_KEY, on ? '1' : '0');
}

/**
 * Po przejściu aplikacji w tło — opcjonalnie wymaga biometrii przed dalszą pracą.
 */
export function AppPrivacyLock() {
  const { theme } = useTheme();
  const [locked, setLocked] = useState(false);
  const appState = useRef(AppState.currentState);

  const tryUnlock = useCallback(async () => {
    const enabled = await isPrivacyLockEnabled();
    if (!enabled) {
      setLocked(false);
      return;
    }
    const has = await LocalAuthentication.hasHardwareAsync();
    if (!has) {
      setLocked(false);
      return;
    }
    const enrolled = await LocalAuthentication.isEnrolledAsync();
    if (!enrolled) {
      setLocked(false);
      return;
    }
    const r = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Odblokuj Arbor',
      cancelLabel: 'Anuluj',
    });
    if (r.success) setLocked(false);
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener('change', async (next) => {
      const prev = appState.current;
      appState.current = next;
      if (prev === 'active' && (next === 'background' || next === 'inactive')) {
        if (await isPrivacyLockEnabled()) setLocked(true);
      }
    });
    return () => sub.remove();
  }, []);

  if (!locked) return null;

  return (
    <Modal visible animationType="fade" onShow={() => { void tryUnlock(); }}>
      <View style={[styles.backdrop, { backgroundColor: 'rgba(5,8,15,0.92)' }]}>
        <View
          style={[
            styles.card,
            {
              backgroundColor: theme.surface,
              borderColor: theme.accent,
              shadowColor: theme.shadowColor,
              shadowOpacity: theme.shadowOpacity,
              shadowRadius: theme.shadowRadius,
              shadowOffset: { width: 0, height: theme.shadowOffsetY },
              elevation: theme.cardElevation + 1,
            },
          ]}
        >
          <Text style={[styles.title, { color: theme.text }]}>Aplikacja zablokowana</Text>
          <Text style={[styles.sub, { color: theme.textSub }]}>Użyj biometrii lub ponów próbę.</Text>
          <TouchableOpacity style={[styles.btn, { backgroundColor: theme.accent }]} onPress={() => { void tryUnlock(); }}>
            <Text style={[styles.btnText, { color: theme.accentText }]}>Odblokuj</Text>
          </TouchableOpacity>
          <View style={[styles.ribbon, { backgroundColor: theme.accentLight, borderColor: theme.accent }]}>
            <Text style={[styles.ribbonTxt, { color: theme.accent }]}>PLATINUM SECURITY</Text>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 380,
    borderRadius: 16,
    borderWidth: 1.25,
    paddingHorizontal: 20,
    paddingTop: 22,
    paddingBottom: 18,
    alignItems: 'center',
  },
  title: { fontSize: 20, fontWeight: '800', marginBottom: 8, letterSpacing: 0.3 },
  sub: { fontSize: 14, textAlign: 'center', marginBottom: 18 },
  btn: {
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 12,
  },
  btnText: { fontWeight: '800', fontSize: 15, letterSpacing: 0.2 },
  ribbon: {
    marginTop: 14,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderWidth: 1,
  },
  ribbonTxt: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
});
