import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { SessionProvider, useSession } from '../src/auth/session';
import { SyncBanner } from '../src/components/SyncBanner';
import { initDb } from '../src/db';
import { SyncStatusProvider } from '../src/sync/status';

export default function RootLayout() {
  useEffect(() => {
    initDb().catch((err) => console.error('Local database failed to open', err));
  }, []);

  return (
    <SafeAreaProvider>
      <SessionProvider>
        <SyncStatusProvider>
          <StatusBar style="light" />
          <SyncBanner />
          <RootNavigator />
        </SyncStatusProvider>
      </SessionProvider>
    </SafeAreaProvider>
  );
}

function RootNavigator() {
  const { isLoaded, token } = useSession();

  if (!isLoaded) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator accessibilityLabel="Loading" />
      </View>
    );
  }

  return (
    <Stack screenOptions={{ headerBackTitle: 'Back' }}>
      <Stack.Protected guard={!!token}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="match/[id]" options={{ title: 'Match' }} />
        <Stack.Screen name="roster/index" options={{ title: 'Roster' }} />
        <Stack.Screen name="score/index" options={{ title: 'Scoring' }} />
      </Stack.Protected>
      <Stack.Protected guard={!token}>
        <Stack.Screen name="(auth)/login" options={{ headerShown: false }} />
      </Stack.Protected>
      <Stack.Screen name="settings" options={{ title: 'Settings' }} />
      <Stack.Screen name="index" options={{ headerShown: false }} />
    </Stack>
  );
}
