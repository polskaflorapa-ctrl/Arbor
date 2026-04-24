import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import React, { useMemo } from 'react';
import { useTheme } from '../../constants/ThemeContext';

export default function TabLayout() {
  const { theme } = useTheme();

  const screenOptions = useMemo(
    () => ({
      tabBarActiveTintColor: theme.navActive,
      tabBarInactiveTintColor: theme.navInactive,
      tabBarStyle: {
        backgroundColor: theme.navBg,
        borderTopWidth: 1.25,
        borderTopColor: theme.navBorder,
        paddingBottom: 12,
        paddingTop: 10,
        height: 72,
        shadowColor: theme.shadowColor,
        shadowOpacity: theme.shadowOpacity * 0.75,
        shadowRadius: theme.shadowRadius,
        shadowOffset: { width: 0, height: -6 },
        elevation: theme.cardElevation + 2,
      },
      tabBarLabelStyle: {
        fontSize: theme.fontCaption,
        fontWeight: '800' as const,
        letterSpacing: 0.35,
      },
      headerShown: false,
      tabBarItemStyle: {
        borderRadius: 14,
        marginHorizontal: 3,
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
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="home-outline" size={size || 24} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="zlecenia"
        options={{
          title: 'Zlecenia',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="document-text-outline" size={size || 24} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="rozliczenia"
        options={{
          title: 'Rozliczenia',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="calculator-outline" size={size || 24} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="powiadomienia"
        options={{
          title: 'Powiadomienia',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="notifications-outline" size={size || 24} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="profil"
        options={{
          title: 'Profil',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="person-outline" size={size || 24} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
