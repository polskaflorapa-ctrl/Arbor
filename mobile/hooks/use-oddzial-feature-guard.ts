import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { getOddzialFeatureConfig, isFeatureEnabledForOddzial } from '../utils/oddzial-features';
import { getStoredSession } from '../utils/session';

type SessionUser = {
  oddzial_id?: string | number;
};

export function useOddzialFeatureGuard(requiredPath: string) {
  const [ready, setReady] = useState(false);
  const [allowed, setAllowed] = useState(false);
  const [oddzialName, setOddzialName] = useState<string>('Oddział');

  useEffect(() => {
    let mounted = true;
    const run = async () => {
      const { token, user } = await getStoredSession();
      if (!mounted) return;
      if (!token) {
        router.replace('/login');
        return;
      }
      const oddzialId = (user as SessionUser | null | undefined)?.oddzial_id;
      const config = getOddzialFeatureConfig(oddzialId);
      const isAllowed = isFeatureEnabledForOddzial(oddzialId, requiredPath);
      setOddzialName(config.name);
      setAllowed(isAllowed);
      setReady(true);
      if (!isAllowed) {
        router.replace('/dashboard');
      }
    };
    void run();
    return () => {
      mounted = false;
    };
  }, [requiredPath]);

  return { ready, allowed, oddzialName };
}
