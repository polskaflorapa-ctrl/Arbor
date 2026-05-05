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
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useTheme } from '../constants/ThemeContext';
import {
  isTestModeEnabledMobile,
  toggleTestModeMobile,
  loginTestUserMobile,
  logoutTestUserMobile,
  getCurrentTestRoleMobile,
  TEST_USERS_MOBILE,
} from '../utils/testMode';

export default function TestModeScreen() {
  const router = useRouter();
  const { theme } = useTheme();
  const [testModeEnabled, setTestModeEnabled] = useState(false);
  const [selectedRole, setSelectedRole] = useState<keyof typeof TEST_USERS_MOBILE>('dyrektor');

  useEffect(() => {
    checkTestModeStatus();
  }, []);

  const checkTestModeStatus = async () => {
    const enabled = await isTestModeEnabledMobile();
    const storedRole = await getCurrentTestRoleMobile();
    if (storedRole) setSelectedRole(storedRole);
    setTestModeEnabled(enabled);
  };

  const handleTestModeToggle = async (value: boolean) => {
    try {
      if (value) {
        // Włącz tryb testowy
        const result = await loginTestUserMobile(selectedRole);
        if (result) {
          await toggleTestModeMobile(true);
          setTestModeEnabled(true);
          Alert.alert('✓ Tryb testowy włączony', `Zalogowano jako: ${result.user.rola}`);
          setTimeout(() => router.replace('/'), 1000);
        }
      } else {
        // Wyłącz tryb testowy
        await logoutTestUserMobile();
        await toggleTestModeMobile(false);
        setTestModeEnabled(false);
        Alert.alert('✗ Tryb testowy wyłączony', 'Wylogowano testowego użytkownika');
        setTimeout(() => router.replace('/login'), 1000);
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      Alert.alert('Błąd', 'Nie udało się zmienić trybu testowego: ' + message);
    }
  };

  const handleRoleChange = async (role: keyof typeof TEST_USERS_MOBILE) => {
    setSelectedRole(role);
    if (testModeEnabled) {
      try {
        const result = await loginTestUserMobile(role);
        if (result) {
          Alert.alert(
            '✓ Zmieniono rolę',
            `Teraz jesteś: ${result.user.rola}`,
            [{ text: 'OK', onPress: () => setTimeout(() => router.replace('/'), 500) }]
          );
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        Alert.alert('Błąd', 'Nie udało się zmienić roli: ' + message);
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

      <View style={[styles.section, { backgroundColor: theme.cardBg }]}>
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: theme.text }]}>
            Status trybu testowego
          </Text>
          <Switch
            value={testModeEnabled}
            onValueChange={handleTestModeToggle}
            trackColor={{ false: theme.textMuted, true: theme.accent }}
            thumbColor={testModeEnabled ? '#4CAF50' : '#f4f3f4'}
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
                    color: selectedRole === key ? '#fff' : theme.text,
                    fontWeight: selectedRole === key ? '700' : '500',
                  },
                ]}
              >
                {user.rola}
              </Text>
              <Text
                style={[
                  styles.roleButtonSubtext,
                  {
                    color: selectedRole === key ? '#eee' : theme.textMuted,
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
        onPress={() => router.back()}
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
    borderRadius: 12,
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
  section: {
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderRadius: 12,
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
    borderRadius: 10,
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
    borderRadius: 10,
    alignItems: 'center',
    marginBottom: 32,
  },
  backButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
});
