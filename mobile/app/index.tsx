import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useTheme } from '../constants/ThemeContext';
import { getOddzialStartPath } from '../utils/oddzial-features';
import { getStoredSession } from '../utils/session';

export default function Index() {
  const router = useRouter();
  const { theme } = useTheme();

  useEffect(() => {
    const checkAuth = async () => {
      const { token, user } = await getStoredSession();
      if (token) {
        const oddzialId =
          user && typeof user === 'object' && 'oddzial_id' in user
            ? (user as { oddzial_id?: string | number | null }).oddzial_id
            : null;
        router.replace(getOddzialStartPath(oddzialId) as any);
      } else {
        router.replace('/login');
      }
    };
    checkAuth();
  }, [router]);

  return (
    <View style={[styles.container, { backgroundColor: theme.bg }]}>
      <ActivityIndicator size="large" color={theme.accent} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
