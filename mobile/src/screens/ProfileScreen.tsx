import { router } from 'expo-router';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { useSession } from '../auth/session';
import { Button } from '../components/Button';
import { Screen, Section } from '../components/Screen';
import { colors, spacing, tenantTheme } from '../theme/tenant';

const ROLE_LABELS: Record<string, string> = {
  super_admin: 'Platform Super-Admin',
  league_organizer: 'League Organizer',
  club_manager: 'Club Manager',
  player: 'Player',
  viewer: 'General Viewer',
};

const ROLE_HELP: Record<string, string> = {
  super_admin: 'You can change every club and every league.',
  league_organizer: 'You can enter scores for your league. Roster stays with the club manager.',
  club_manager: 'You can move players for your club. Scoring stays with the organizer.',
  player: 'You can view the league and edit only your own profile.',
  viewer: 'You can look at fixtures, standings, and the store. Changes stay hidden.',
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
        <Text style={styles.tenantSub}>Alpha United · Alpha Arena</Text>
      </View>

      <Section title="Signed in as">
        <Text style={styles.value}>{claims?.email ?? 'Unknown user'}</Text>
        <Text style={styles.role}>{claims ? ROLE_LABELS[claims.role] ?? claims.role : 'No role'}</Text>
        <Text style={styles.muted}>{claims ? ROLE_HELP[claims.role] ?? '' : ''}</Text>
      </Section>

      <Section title="Club">
        <Text style={styles.value}>Alpha United</Text>
        <Text style={styles.muted}>Home ground: Alpha Arena</Text>
        <Text style={styles.muted}>Coach · Club manager · Physio</Text>
      </Section>

      <View style={styles.actions}>
        {claims?.role === 'club_manager' ? (
          <Button label="Manage roster" onPress={() => router.push('/roster')} color={theme.primary} />
        ) : null}
        {claims?.role === 'league_organizer' ? (
          <Button label="Enter a score" onPress={() => router.push('/score')} color={theme.primary} />
        ) : null}
        <Button label="Settings" variant="secondary" onPress={() => router.push('/settings')} />
        <Button label="Sign out" variant="secondary" color={colors.danger} onPress={confirmSignOut} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  tenantBar: { borderRadius: 12, padding: spacing.md },
  tenantName: { color: '#FFFFFF', fontSize: 22, fontWeight: '800' },
  tenantSub: { color: '#E8F5E9', fontSize: 15 },
  value: { fontSize: 16, fontWeight: '700', color: colors.text },
  role: { fontSize: 16, color: colors.text },
  muted: { fontSize: 15, color: colors.muted, lineHeight: 22 },
  actions: { gap: spacing.sm },
});
