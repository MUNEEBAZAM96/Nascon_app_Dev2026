import { router } from 'expo-router';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { useSession } from '../../src/auth/session';
import { Button } from '../../src/components/Button';
import { Screen, Section } from '../../src/components/Screen';
import { colors, spacing, tenantTheme } from '../../src/theme/tenant';

const ROLE_LABELS: Record<string, string> = {
  super_admin: 'Platform Super-Admin',
  league_organizer: 'League Organizer',
  club_manager: 'Club Manager',
  player: 'Player',
  viewer: 'General Viewer',
};

export default function ProfileScreen() {
  const { claims, signOut } = useSession();
  const theme = tenantTheme(claims?.tenant_id);

  function confirmSignOut() {
    Alert.alert('Sign out?', 'You will need to sign in again to see your league.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => void signOut() },
    ]);
  }

  return (
    <Screen title="Profile">
      <View style={[styles.tenantBar, { backgroundColor: theme.primary }]} accessibilityLabel={`Tenant ${theme.name}`}>
        <Text style={styles.tenantName}>{theme.name}</Text>
      </View>

      <Section title="Signed in as">
        <Text style={styles.value}>{claims?.email ?? 'Unknown user'}</Text>
        <Text style={styles.muted}>{claims ? ROLE_LABELS[claims.role] ?? claims.role : 'No role'}</Text>
      </Section>

      <View style={styles.actions}>
        {claims?.role === 'club_manager' ? (
          <Button label="Roster (Club Manager)" onPress={() => router.push('/roster')} color={theme.primary} />
        ) : null}
        {claims?.role === 'league_organizer' ? (
          <Button label="Scoring (League Organizer)" onPress={() => router.push('/score')} color={theme.primary} />
        ) : null}
        <Button label="Settings" variant="secondary" onPress={() => router.push('/settings')} />
        <Button label="Sign out" variant="secondary" color={colors.danger} onPress={confirmSignOut} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  tenantBar: { borderRadius: 12, padding: spacing.md },
  tenantName: { color: '#FFFFFF', fontSize: 18, fontWeight: '700' },
  value: { fontSize: 16, color: colors.text },
  muted: { fontSize: 15, color: colors.muted },
  actions: { gap: spacing.sm },
});
