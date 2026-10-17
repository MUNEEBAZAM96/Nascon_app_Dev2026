import { Tabs } from 'expo-router';
import { Text } from 'react-native';

import { useSession } from '../../src/auth/session';
import { minTapTarget, tenantTheme } from '../../src/theme/tenant';

function TabIcon({ glyph, color }: { glyph: string; color: string }) {
  return <Text style={{ fontSize: 20, color }}>{glyph}</Text>;
}

export default function TabsLayout() {
  const { claims } = useSession();
  const theme = tenantTheme(claims?.tenant_id);

  return (
    <Tabs
      screenOptions={{
        headerShown: true,
        tabBarActiveTintColor: theme.primary,
        tabBarLabelStyle: { fontSize: 12, fontWeight: '600' },
        tabBarStyle: { minHeight: minTapTarget + 8 },
      }}
    >
      <Tabs.Screen
        name="fixtures"
        options={{ title: 'Fixtures', tabBarIcon: ({ color }) => <TabIcon glyph="📅" color={color} /> }}
      />
      <Tabs.Screen
        name="standings"
        options={{ title: 'Standings', tabBarIcon: ({ color }) => <TabIcon glyph="🏆" color={color} /> }}
      />
      <Tabs.Screen
        name="store"
        options={{ title: 'Store', tabBarIcon: ({ color }) => <TabIcon glyph="🛍" color={color} /> }}
      />
      <Tabs.Screen
        name="profile"
        options={{ title: 'Profile', tabBarIcon: ({ color }) => <TabIcon glyph="👤" color={color} /> }}
      />
    </Tabs>
  );
}
