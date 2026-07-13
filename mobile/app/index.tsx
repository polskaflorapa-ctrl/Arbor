import { useRootNavigationState, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { BrandLogo } from '../components/ui/brand-logo';
import { useTheme } from '../constants/ThemeContext';
import { getStoredSession } from '../utils/session';

export default function Index() {
  const router = useRouter();
  const rootNav = useRootNavigationState();
  const { theme } = useTheme();

  useEffect(() => {
    if (!rootNav?.key) return;

    const checkAuth = async () => {
      const { token } = await getStoredSession();
      if (token) {
        router.replace('/dashboard');
      } else {
        router.replace('/login');
      }
    };
    void checkAuth();
  }, [router, rootNav?.key]);

  return (
    <View style={[styles.container, { backgroundColor: theme.bg }]}>
      <BrandLogo orientation="vertical" descriptor={false} style={styles.logo} />
      <ActivityIndicator size="large" color={theme.accent} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 24,
  },
  logo: { width: 132 },
});
