import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { useSession } from '../auth/session';
import { loadProfile, saveProfile } from '../db';
import { Button } from '../components/Button';
import { IconBadge } from '../components/IconBadge';
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
  const [cachedEmail, setCachedEmail] = useState<string | null>(null);
  const [cachedRole, setCachedRole] = useState<string | null>(null);
  const isAdmin = (claims?.role ?? cachedRole) === 'super_admin';
  const theme = tenantTheme(claims?.tenant_id);
  const barColor = isAdmin ? '#0B6E4F' : theme.primary;

  useEffect(() => {
    if (!claims) return;
    const profile = { email: claims.email, role: claims.role, tenant_id: claims.tenant_id };
    void saveProfile('phone', profile);
  }, [claims]);

  useEffect(() => {
    if (claims) return;
    void loadProfile<{ email: string; role: string }>('phone').then((row) => {
      if (!row) return;
      setCachedEmail(row.email);
      setCachedRole(row.role);
    });
  }, [claims]);

  function confirmSignOut() {
    Alert.alert('Sign out?', 'You will need to sign in again to see your league.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => void signOut() },
    ]);
  }

  return (
    <Screen title="Profile">
      <View
        style={[styles.tenantBar, { backgroundColor: barColor }]}
        accessibilityLabel={isAdmin ? 'Platform owner' : `Tenant ${theme.name}`}
      >
        <View style={styles.tenantRow}>
          <Ionicons name="shield-checkmark" size={22} color="#FFFFFF" accessibilityElementsHidden />
          <Text style={styles.tenantName}>{isAdmin ? 'Platform' : theme.name}</Text>
        </View>
        <Text style={styles.tenantSub}>{isAdmin ? 'All tenants' : 'Alpha United · Alpha Arena'}</Text>
      </View>

      <Section title="Signed in as">
        <View style={styles.signedIn}>
          <IconBadge name="person" />
          <Text style={styles.value}>{claims?.email ?? cachedEmail ?? 'Unknown user'}</Text>
        </View>
        <Text style={styles.role}>{claims ? ROLE_LABELS[claims.role] ?? claims.role : cachedRole ? ROLE_LABELS[cachedRole] ?? cachedRole : 'No role'}</Text>
        <Text style={styles.muted}>{claims ? ROLE_HELP[claims.role] ?? '' : cachedRole ? ROLE_HELP[cachedRole] ?? '' : ''}</Text>
      </Section>

      {isAdmin ? (
        <Section title="Tenants">
          <View style={[styles.tenantChoice, { backgroundColor: '#E8F5E9' }]}>
            <View style={[styles.swatch, { backgroundColor: '#0B6E4F' }]} />
            <View>
              <Text style={styles.value}>Alpha Sports</Text>
              <Text style={styles.muted}>tenant-alpha</Text>
            </View>
          </View>
          <View style={[styles.tenantChoice, { backgroundColor: '#E3F2FD' }]}>
            <View style={[styles.swatch, { backgroundColor: '#1D4E89' }]} />
            <View>
              <Text style={styles.value}>Beta Athletics</Text>
              <Text style={styles.muted}>tenant-beta</Text>
            </View>
          </View>
        </Section>
      ) : (
        <Section title="Club">
          <Text style={styles.value}>Alpha United</Text>
          <Text style={styles.muted}>Home ground: Alpha Arena</Text>
          <Text style={styles.muted}>Coach · Club manager · Physio</Text>
        </Section>
      )}

      <View style={styles.actions}>
        {claims?.role === 'club_manager' || isAdmin ? (
          <View style={styles.actionRow}>
            <Ionicons name="people" size={20} color="#0B6E4F" accessibilityElementsHidden />
            <View style={styles.actionButton}><Button label="Manage roster" onPress={() => router.push('/roster')} color="#0B6E4F" /></View>
          </View>
        ) : null}
        {claims?.role === 'league_organizer' || isAdmin ? (
          <View style={styles.actionRow}>
            <Ionicons name="create" size={20} color="#0B6E4F" accessibilityElementsHidden />
            <View style={styles.actionButton}><Button label="Enter a score" onPress={() => router.push('/score')} color="#0B6E4F" /></View>
          </View>
        ) : null}
        <View style={styles.actionRow}>
          <Ionicons name="settings-outline" size={20} color={colors.text} accessibilityElementsHidden />
          <View style={styles.actionButton}><Button label="Settings" variant="secondary" onPress={() => router.push('/settings')} /></View>
        </View>
        <View style={styles.actionRow}>
          <Ionicons name="log-out" size={20} color="#B91C1C" accessibilityElementsHidden />
          <View style={styles.actionButton}><Button label="Sign out" variant="secondary" color={colors.danger} onPress={confirmSignOut} /></View>
        </View>
      </View>

      {isAdmin ? (
        <Section title="Platform">
          <View style={styles.tenantRow}>
            <Ionicons name="shield-checkmark" size={20} color="#0B6E4F" accessibilityElementsHidden />
            <Text style={styles.value}>Platform</Text>
          </View>
          <Text style={styles.muted}>This account can edit any league, any club, and any player.</Text>
        </Section>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  tenantBar: { borderRadius: 12, padding: spacing.md, gap: 4 },
  tenantRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  tenantChoice: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderRadius: 12, padding: spacing.sm },
  swatch: { width: 28, height: 28, borderRadius: 14 },
  signedIn: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  actionButton: { flex: 1 },
  tenantName: { color: '#FFFFFF', fontSize: 22, fontWeight: '800' },
  tenantSub: { color: '#E8F5E9', fontSize: 15 },
  value: { fontSize: 16, fontWeight: '700', color: colors.text },
  role: { fontSize: 16, color: colors.text },
  muted: { fontSize: 15, color: colors.muted, lineHeight: 22 },
  actions: { gap: spacing.sm },
});
