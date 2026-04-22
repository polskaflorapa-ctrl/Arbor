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
        paddingBottom: 10,
        paddingTop: 8,
        height: 66,
        shadowColor: theme.shadowColor,
        shadowOpacity: theme.shadowOpacity * 0.55,
        shadowRadius: theme.shadowRadius,
        shadowOffset: { width: 0, height: -2 },
        elevation: theme.cardElevation + 1,
      },
      tabBarLabelStyle: {
        fontSize: theme.fontCaption,
        fontWeight: '700' as const,
        letterSpacing: 0.2,
      },
      headerShown: false,
      tabBarItemStyle: {
        borderRadius: 12,
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
