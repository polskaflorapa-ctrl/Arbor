import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { Tabs } from 'expo-router';
import React, { useMemo } from 'react';
import { Platform, View } from 'react-native';
import { HapticTab } from '../../components/haptic-tab';
import { useTheme } from '../../constants/ThemeContext';

type IonName = ComponentProps<typeof Ionicons>['name'];

/** Większe niż domyślne RN — czytelne na telefonie bez okularów. */
const TAB_ICON_PX = Platform.select({ ios: 32, default: 34 }) ?? 32;

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
    <View style={{ alignItems: 'center', justifyContent: 'center', height: TAB_ICON_PX + 8 }}>
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
        borderTopWidth: 1.25,
        borderTopColor: theme.navBorder,
        paddingBottom: 14,
        paddingTop: 10,
        height: 86,
        shadowColor: theme.shadowColor,
        shadowOpacity: theme.shadowOpacity * 0.75,
        shadowRadius: theme.shadowRadius,
        shadowOffset: { width: 0, height: -6 },
        elevation: theme.cardElevation + 2,
      },
      tabBarLabelStyle: {
        fontSize: Math.max(13, theme.fontCaption + 1),
        fontWeight: '800' as const,
        letterSpacing: 0.35,
        marginTop: 2,
      },
      headerShown: false,
      tabBarItemStyle: {
        borderRadius: 14,
        marginHorizontal: 2,
      },
    }),
    [theme],
  );

  return (
    <Tabs screenOptions={screenOptions}>
      <Tabs.Screen
        name="dashboard"
        options={{
          title: 'Dashboard',
          tabBarIcon: ({ color, focused }) => (
            <TabGlyph outline="home-outline" solid="home" color={color} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="zlecenia"
        options={{
          title: 'Zlecenia',
          tabBarIcon: ({ color, focused }) => (
            <TabGlyph outline="clipboard-outline" solid="clipboard" color={color} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="rozliczenia"
        options={{
          title: 'Rozliczenia',
          tabBarIcon: ({ color, focused }) => (
            <TabGlyph outline="wallet-outline" solid="wallet" color={color} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="powiadomienia"
        options={{
          title: 'Powiadomienia',
          tabBarIcon: ({ color, focused }) => (
            <TabGlyph outline="notifications-outline" solid="notifications" color={color} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="profil"
        options={{
          title: 'Profil',
          tabBarIcon: ({ color, focused }) => (
            <TabGlyph outline="person-circle-outline" solid="person-circle" color={color} focused={focused} />
          ),
        }}
      />
    </Tabs>
  );
}
