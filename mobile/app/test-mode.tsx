import { safeBack } from '../utils/navigation';
/**
 * Ekran testowy dla aplikacji mobilnej - dostępny z menu deweloperskiego.
 */
import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Switch,
} from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { useTheme } from '../constants/ThemeContext';
import {
  canUseTestMode,
  isTestModeEnabledMobile,
  toggleTestModeMobile,
  loginTestUserMobile,
  getCurrentTestRoleMobile,
  TEST_USERS_MOBILE,
} from '../utils/testMode';
import { getRoleDisplayName } from '../utils/role-display';

export default function TestModeScreen() {
  if (!canUseTestMode()) return <Redirect href="/" />;
  return <EnabledTestModeScreen />;
}

function EnabledTestModeScreen() {
  const router = useRouter();
  const { theme } = useTheme();
  const [testModeEnabled, setTestModeEnabled] = useState(false);
  const [selectedRole, setSelectedRole] = useState<keyof typeof TEST_USERS_MOBILE>('dyrektor');
  const [notice, setNotice] = useState<{ message: string; tone: 'success' | 'warning' } | null>(null);

  const showNotice = (message: string, tone: 'success' | 'warning' = 'success') => {
    setNotice({ message, tone });
  };

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 6500);
    return () => clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    void checkTestModeStatus();
  }, []);

  async function checkTestModeStatus() {
    const enabled = await isTestModeEnabledMobile();
    const storedRole = await getCurrentTestRoleMobile();
    if (storedRole) setSelectedRole(storedRole);
    setTestModeEnabled(enabled);
  }

  const handleTestModeToggle = async (value: boolean) => {
    try {
      if (value) {
        // Włącz tryb testowy
        const result = await loginTestUserMobile(selectedRole);
        if (result) {
          await toggleTestModeMobile(true);
          setTestModeEnabled(true);
          showNotice(`Zalogowano jako: ${getRoleDisplayName(result.user.rola)}`);
          setTimeout(() => router.replace('/'), 1000);
        }
      } else {
        // Wyłącz tryb testowy
        await toggleTestModeMobile(false);
        setTestModeEnabled(false);
        showNotice('Wylogowano testowego użytkownika', 'warning');
        setTimeout(() => router.replace('/login'), 1000);
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      showNotice('Nie udało się zmienić trybu testowego: ' + message, 'warning');
    }
  };

  const handleRoleChange = async (role: keyof typeof TEST_USERS_MOBILE) => {
    setSelectedRole(role);
    if (testModeEnabled) {
      try {
        const result = await loginTestUserMobile(role);
        if (result) {
          showNotice(`Teraz jesteś: ${getRoleDisplayName(result.user.rola)}`);
          setTimeout(() => router.replace('/'), 500);
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        showNotice('Nie udało się zmienić roli: ' + message, 'warning');
      }
    }
  };

  return (
    <ScrollView style={[styles.container, { backgroundColor: theme.bg }]}>
      <View style={[styles.header, { backgroundColor: theme.cardBg }]}>
        <Text style={[styles.title, { color: theme.text }]}>🛠️ Tryb Testowy</Text>
        <Text style={[styles.subtitle, { color: theme.textMuted }]}>
          Konfiguracja dla developmentu i testowania
        </Text>
      </View>
      {notice ? (
        <View
          style={[
            styles.notice,
            {
              backgroundColor: notice.tone === 'warning' ? theme.warningBg : theme.successBg,
              borderColor: notice.tone === 'warning' ? theme.warning : theme.success,
            },
          ]}
        >
          <Text
            style={[
              styles.noticeText,
              { color: notice.tone === 'warning' ? theme.warning : theme.success },
            ]}
          >
            {notice.message}
          </Text>
        </View>
      ) : null}

      <View style={[styles.section, { backgroundColor: theme.cardBg }]}>
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: theme.text }]}>
            Status trybu testowego
          </Text>
          <Switch
            value={testModeEnabled}
            onValueChange={handleTestModeToggle}
            trackColor={{ false: theme.textMuted, true: theme.accent }}
            thumbColor={testModeEnabled ? theme.accent : theme.surface}
          />
        </View>
        <Text style={[styles.sectionInfo, { color: theme.textMuted }]}>
          {testModeEnabled
            ? '✓ Tryb testowy jest aktywny. Pracujesz z mockowanymi danymi.'
            : '✗ Tryb testowy jest wyłączony. Połączenie z produkcją.'}
        </Text>
      </View>

      {testModeEnabled && (
        <View style={[styles.section, { backgroundColor: theme.cardBg }]}>
          <Text style={[styles.sectionTitle, { color: theme.text }]}>
            Wybierz testową rolę
          </Text>

          {(Object.entries(TEST_USERS_MOBILE) as [
            keyof typeof TEST_USERS_MOBILE,
            typeof TEST_USERS_MOBILE[keyof typeof TEST_USERS_MOBILE]
          ][]).map(([key, user]) => (
            <TouchableOpacity
              key={key}
              style={[
                styles.roleButton,
                {
                  backgroundColor: selectedRole === key ? theme.accent : theme.cardBg,
                  borderColor: theme.border,
                },
              ]}
              onPress={() => handleRoleChange(key)}
            >
              <Text
                style={[
                  styles.roleButtonText,
                  {
                    color: selectedRole === key ? theme.accentText : theme.text,
                    fontWeight: selectedRole === key ? '700' : '500',
                  },
                ]}
              >
                {getRoleDisplayName(user.rola)}
              </Text>
              <Text
                style={[
                  styles.roleButtonSubtext,
                  {
                    color: selectedRole === key ? theme.accentLight : theme.textMuted,
                  },
                ]}
              >
                {user.imie} {user.nazwisko}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      <View style={[styles.section, { backgroundColor: theme.cardBg }]}>
        <Text style={[styles.sectionTitle, { color: theme.text }]}>Informacje</Text>
        <Text style={[styles.info, { color: theme.textMuted }]}>
          • Tryb testowy zawiera mockowane dane zlecień, użytkowników i raportów{'\n'}
          • Żaden API call nie zostanie wysłany do backendu{'\n'}
          • Zmiana trybu wymaga przeładowania aplikacji{'\n'}
          • Tego panelu nie powinno być widać w wersji produkcyjnej
        </Text>
      </View>

      <TouchableOpacity
        style={[styles.backButton, { backgroundColor: theme.accent }]}
        onPress={() => safeBack()}
      >
        <Text style={styles.backButtonText}>← Wróć</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
  },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 20,
    borderRadius: 7,
    marginBottom: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    fontWeight: '500',
  },
  notice: {
    borderRadius: 7,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 16,
  },
  noticeText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },
  section: {
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderRadius: 7,
    marginBottom: 16,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 8,
  },
  sectionInfo: {
    fontSize: 13,
    lineHeight: 18,
  },
  roleButton: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 6,
    borderWidth: 1,
    marginBottom: 10,
  },
  roleButtonText: {
    fontSize: 15,
    marginBottom: 2,
  },
  roleButtonSubtext: {
    fontSize: 12,
  },
  info: {
    fontSize: 13,
    lineHeight: 18,
  },
  backButton: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 6,
    alignItems: 'center',
    marginBottom: 32,
  },
  backButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});
