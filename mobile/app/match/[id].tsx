import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, Text } from 'react-native';

import { ApiError, JERSEY_PRICE, api, type ScoreView } from '../../src/api/client';
import { Button } from '../../src/components/Button';
import { Screen, Section } from '../../src/components/Screen';
import { colors } from '../../src/theme/tenant';

export default function MatchScreen() {
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
      {loading ? <Text style={styles.muted}>Loading match…</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {score ? (
        <>
          <Section title="Live score">
            <Text style={styles.score}>
              {score.home.team_id} {score.home.score} – {score.away.score} {score.away.team_id}
            </Text>
            <Text style={styles.muted}>{score.status} · {score.outcome}</Text>
          </Section>
          <Section title="Timeline">
            {score.events.length === 0 ? <Text style={styles.muted}>No events yet.</Text> : null}
            {score.events.map((event) => (
              <Text key={event.event_id} style={styles.event}>
                {event.sequence}. {event.type}
                {event.payload.event_type ? ` · ${event.payload.event_type}` : ''}
                {event.payload.team_id ? ` · ${event.payload.team_id}` : ''}
              </Text>
            ))}
          </Section>
        </>
      ) : null}
      <Section title="Pinned product">
        <Text style={styles.event}>Home jersey, {JERSEY_PRICE}</Text>
        <Button label="Open store" onPress={() => router.push('/store')} />
      </Section>
    </Screen>
  );
}

const styles = StyleSheet.create({
  score: { fontSize: 22, fontWeight: '800', color: colors.text },
  muted: { fontSize: 16, color: colors.muted },
  error: { fontSize: 15, color: colors.danger },
  event: { fontSize: 16, color: colors.text },
});
