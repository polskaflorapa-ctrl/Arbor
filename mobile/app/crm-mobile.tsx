import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { ScreenHeader } from '../components/ui/screen-header';
import { useTheme } from '../constants/ThemeContext';
import type { Theme } from '../constants/theme';
import { useOddzialFeatureGuard } from '../hooks/use-oddzial-feature-guard';

import { AppStatusBar } from '../components/ui/app-status-bar';
type HubCard = {
  id: string;
  title: string;
  subtitle: string;
  path: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
};

const HUB_CARDS: HubCard[] = [
  {
    id: 'pipeline',
    title: 'Pipeline CRM',
    subtitle: 'Leady, etapy, aktywnosci i szybkie przesuniecia.',
    path: '/crm-pipeline-mobile',
    icon: 'funnel-outline',
  },
  {
    id: 'clients',
    title: 'Klienci',
    subtitle: 'Baza kontaktow, historia zlecen i ogledzin.',
    path: '/klienci-mobile',
    icon: 'people-outline',
  },
  {
    id: 'telephony',
    title: 'Telefonia',
    subtitle: 'Szybkie polaczenie, log rozmow i historia SMS.',
    path: '/telefonia-mobile',
    icon: 'call-outline',
  },
  {
    id: 'inspections',
    title: 'Ogledziny',
    subtitle: 'Plan i dokumentacja wizyt u klienta.',
    path: '/ogledziny',
    icon: 'search-outline',
  },
  {
    id: 'quotes',
    title: 'Kalendarz wycen',
    subtitle: 'Terminy wycen i obciazenie zespolu.',
    path: '/wycena-kalendarz',
    icon: 'calendar-outline',
  },
];

export default function CrmMobileScreen() {
  const { theme } = useTheme();
  const guard = useOddzialFeatureGuard('/crm-mobile');
  const S = makeStyles(theme);

  if (guard.ready && !guard.allowed) return <View style={S.center} />;
  if (!guard.ready) {
    return (
      <View style={S.center}>
        <ActivityIndicator size="large" color={theme.accent} />
      </View>
    );
  }

  return (
    <View style={S.root}>
      <AppStatusBar />
      <ScreenHeader title="CRM i klienci" />
      <ScrollView style={S.scroll} contentContainerStyle={S.content} showsVerticalScrollIndicator={false}>
        <View style={S.hero}>
          <View>
            <Text style={S.heroKicker}>Centrum relacji</Text>
            <Text style={S.heroTitle}>CRM</Text>
          </View>
          <View style={S.heroStats}>
            <Text style={S.heroStatValue}>{HUB_CARDS.length}</Text>
            <Text style={S.heroStatLabel}>modulow</Text>
          </View>
        </View>
        {HUB_CARDS.map((card) => (
          <TouchableOpacity
            key={card.id}
            style={S.card}
            activeOpacity={0.84}
            onPress={() => router.push(card.path as never)}
          >
            <View style={S.iconWrap}>
              <Ionicons name={card.icon} size={20} color={theme.accent} />
            </View>
            <View style={S.cardBody}>
              <Text style={S.cardTitle}>{card.title}</Text>
              <Text style={S.cardSubtitle}>{card.subtitle}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={theme.textMuted} />
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: t.bg },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: t.bg },
    scroll: { flex: 1 },
    content: { padding: 12, gap: 8, paddingBottom: 24 },
    hero: {
      minHeight: 84,
      borderRadius: 8,
      padding: 12,
      backgroundColor: t.cardBg,
      borderWidth: 1,
      borderColor: t.cardBorder,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 2,
    },
    heroKicker: {
      color: t.textSub,
      fontSize: 12,
      fontWeight: '800',
      textTransform: 'uppercase',
    },
    heroTitle: {
      color: t.text,
      fontSize: 24,
      fontWeight: '900',
      marginTop: 2,
    },
    heroStats: {
      minWidth: 72,
      minHeight: 58,
      borderRadius: 8,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: t.accentLight,
      borderWidth: 1,
      borderColor: t.accent + '44',
    },
    heroStatValue: {
      color: t.accent,
      fontSize: 20,
      fontWeight: '900',
    },
    heroStatLabel: {
      color: t.textSub,
      fontSize: 11,
      fontWeight: '800',
    },
    card: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      backgroundColor: t.cardBg,
      borderWidth: 1,
      borderColor: t.cardBorder,
      borderRadius: 8,
      minHeight: 76,
      paddingHorizontal: 12,
      paddingVertical: 12,
    },
    iconWrap: {
      width: 42,
      height: 42,
      borderRadius: 8,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: t.accentLight,
      borderWidth: 1,
      borderColor: t.accent + '33',
    },
    cardBody: { flex: 1 },
    cardTitle: { color: t.text, fontWeight: '900', fontSize: 15 },
    cardSubtitle: { color: t.textSub, fontSize: 12, lineHeight: 16, marginTop: 2 },
  });
