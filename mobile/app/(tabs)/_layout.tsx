import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { Tabs } from 'expo-router';
import React, { useMemo } from 'react';
import { Platform, View } from 'react-native';
import { HapticTab } from '../../components/haptic-tab';
import { useTheme } from '../../constants/ThemeContext';
import { shadowStyle } from '../../constants/elevation';

type IonName = ComponentProps<typeof Ionicons>['name'];

/** Większe niż domyślne RN — czytelne na telefonie bez okularów. */
const TAB_ICON_PX = Platform.select({ ios: 23, default: 22 }) ?? 22;

function TabGlyph({
  outline,
  solid,
  color,
  focused,
}: {
  outline: IonName;
  solid: IonName;
  color: string;
  focused: boolean;
}) {
  return (
    <View
      style={{
        alignItems: 'center',
        justifyContent: 'center',
        width: 38,
        height: 30,
        borderRadius: 11,
        backgroundColor: focused ? 'rgba(21,128,61,0.10)' : 'transparent',
      }}
    >
      <Ionicons name={focused ? solid : outline} size={TAB_ICON_PX} color={color} />
    </View>
  );
}

export default function TabLayout() {
  const { theme } = useTheme();

  const screenOptions = useMemo(
    () => ({
      tabBarActiveTintColor: theme.navActive,
      tabBarInactiveTintColor: theme.navInactive,
      tabBarButton: HapticTab,
      tabBarStyle: {
        backgroundColor: theme.navBg,
        borderTopWidth: 1,
        borderTopColor: theme.navBorder,
        borderRadius: 0,
        paddingBottom: Platform.select({ ios: 14, default: 10 }),
        paddingTop: 6,
        height: Platform.select({ ios: 74, default: 66 }),
        position: 'absolute' as const,
        left: 0,
        right: 0,
        bottom: 0,
        ...shadowStyle(theme, {
          opacity: theme.shadowOpacity * 0.35,
          radius: theme.shadowRadius * 0.6,
          offsetY: -3,
          elevation: theme.cardElevation,
        }),
      },
      tabBarLabelStyle: {
        fontSize: 11,
        fontWeight: '800' as const,
        letterSpacing: 0,
        marginTop: 0,
      },
      headerShown: false,
      tabBarItemStyle: {
        borderRadius: 12,
        marginHorizontal: 3,
      },
    }),
    [theme],
  );

  // Rejestrujemy wyłącznie te ekrany, których pliki faktycznie istnieją
  // w `app/(tabs)/`. Wcześniej były tu też dashboard / zlecenia / rozliczenia
  // / powiadomienia / profil, ale ich plików w (tabs)/ nie ma — Expo Router
  // pokazywałby pusty/martwy tab. Aktualne ekrany domenowe są w `app/_layout.tsx`
  // jako flat Stack i tam je wywołujemy przez `router.push('/dashboard')`.
  return (
    <Tabs screenOptions={screenOptions}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Start',
          tabBarIcon: ({ color, focused }) => (
            <TabGlyph outline="home-outline" solid="home" color={color} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="explore"
        options={{
          title: 'Raporty',
          tabBarIcon: ({ color, focused }) => (
            <TabGlyph outline="bar-chart-outline" solid="bar-chart" color={color} focused={focused} />
          ),
        }}
      />
    </Tabs>
  );
}
