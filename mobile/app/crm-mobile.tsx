import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { ActivityIndicator, StatusBar, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { ScreenHeader } from '../components/ui/screen-header';
import { useTheme } from '../constants/ThemeContext';
import type { Theme } from '../constants/theme';
import { useOddzialFeatureGuard } from '../hooks/use-oddzial-feature-guard';

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
      <StatusBar barStyle={'light-content'} backgroundColor={theme.headerBg} />
      <ScreenHeader title="CRM i klienci" />
      <View style={S.content}>
        <Text style={S.hint}>
          Centrum relacji z klientem: jeden ekran do CRM, kontaktu i dziennika rozmow.
        </Text>
        {HUB_CARDS.map((card) => (
          <TouchableOpacity
            key={card.id}
            style={S.card}
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
      </View>
    </View>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: t.bg },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: t.bg },
    content: { padding: 14, gap: 10 },
    hint: {
      color: t.textSub,
      fontSize: 13,
      lineHeight: 18,
      marginBottom: 6,
    },
    card: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      backgroundColor: t.cardBg,
      borderWidth: 1,
      borderColor: t.cardBorder,
      borderRadius: 14,
      paddingHorizontal: 12,
      paddingVertical: 12,
    },
    iconWrap: {
      width: 38,
      height: 38,
      borderRadius: 11,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: t.accentLight,
      borderWidth: 1,
      borderColor: t.cardBorder,
    },
    cardBody: { flex: 1 },
    cardTitle: { color: t.text, fontWeight: '700', fontSize: 15 },
    cardSubtitle: { color: t.textSub, fontSize: 12, marginTop: 2 },
  });
