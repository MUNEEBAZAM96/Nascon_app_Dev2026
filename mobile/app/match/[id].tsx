import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ApiError, JERSEY_PRICE, api, type ScoreEvent, type ScoreView } from '../../src/api/client';
import { useSession } from '../../src/auth/session';
import { Button } from '../../src/components/Button';
import { Card, LoadingBars, Screen, StatusPill } from '../../src/components/Screen';
import { displayName, outcomeLabel } from '../../src/theme/names';
import { colors, spacing, tenantTheme } from '../../src/theme/tenant';

export default function MatchScreen() {
  const { claims } = useSession();
  const theme = tenantTheme(claims?.tenant_id);
  const { id } = useLocalSearchParams<{ id: string }>();
  const [score, setScore] = useState<ScoreView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      setScore(await api.score(id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load this match.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(useCallback(() => {
    void load();
  }, [load]));

  return (
    <Screen title="Match">
      {loading ? <Card><LoadingBars label="Loading match" /></Card> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {score ? (
        <>
          <Card tone={theme.secondary}>
            <View style={styles.hero}>
              <Text style={styles.team}>{displayName(score.home.team_id)}</Text>
              <Text style={styles.big}>{score.home.score} – {score.away.score}</Text>
              <Text style={styles.team}>{displayName(score.away.team_id)}</Text>
              <StatusPill status={score.status} />
              <Text style={styles.muted}>{outcomeLabel(score.outcome)}</Text>
            </View>
          </Card>
          <Card>
            <Text style={styles.section}>Timeline</Text>
            {score.events.length === 0 ? <Text style={styles.muted}>No events yet.</Text> : null}
            {score.events.map((event) => (
              <View key={event.event_id} style={styles.eventRow}>
                <View style={[styles.dot, { backgroundColor: event.compensated ? colors.muted : theme.primary }]} />
                <Text style={[styles.event, event.compensated && styles.struck]}>{eventLine(event)}</Text>
              </View>
            ))}
          </Card>
        </>
      ) : null}
      <Card>
        <Text style={styles.section}>Home jersey</Text>
        <Text style={styles.price}>{JERSEY_PRICE}</Text>
        <Button label="Open store" color={theme.primary} onPress={() => router.push('/store')} />
      </Card>
    </Screen>
  );
}

function eventLine(event: ScoreEvent): string {
  if (event.type === 'match_start') return 'Match started';
  if (event.type === 'match_end') return 'Match ended';
  if (event.type === 'compensation') return 'Goal disallowed';
  if (event.type === 'score' && event.payload.event_type === 'goal') {
    return `${event.compensated ? 'Goal removed' : 'Goal'} · ${displayName(event.payload.team_id)}`;
  }
  const team = event.payload.team_id ? ` · ${displayName(event.payload.team_id)}` : '';
  return `${event.type}${team}`;
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: spacing.sm },
  team: { fontSize: 18, fontWeight: '700', color: colors.text },
  big: { fontSize: 56, fontWeight: '800', color: colors.text },
  muted: { fontSize: 15, color: colors.muted },
  error: { fontSize: 15, color: colors.danger },
  section: { fontSize: 18, fontWeight: '700', color: colors.text },
  price: { fontSize: 16, fontWeight: '700', color: colors.text },
  eventRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dot: { width: 10, height: 10, borderRadius: 5 },
  event: { fontSize: 16, color: colors.text, flex: 1 },
  struck: { textDecorationLine: 'line-through', color: colors.muted },
});
