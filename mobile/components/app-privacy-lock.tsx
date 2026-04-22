import AsyncStorage from '@react-native-async-storage/async-storage';
import * as LocalAuthentication from 'expo-local-authentication';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

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
      <View style={styles.backdrop}>
        <Text style={styles.title}>Aplikacja zablokowana</Text>
        <Text style={styles.sub}>Użyj biometrii lub ponów próbę.</Text>
        <TouchableOpacity style={styles.btn} onPress={() => { void tryUnlock(); }}>
          <Text style={styles.btnText}>Odblokuj</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  title: { color: '#fff', fontSize: 20, fontWeight: '700', marginBottom: 8 },
  sub: { color: '#ccc', fontSize: 14, textAlign: 'center', marginBottom: 24 },
  btn: {
    backgroundColor: '#2d6cdf',
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 12,
  },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
