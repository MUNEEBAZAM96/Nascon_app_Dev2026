import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, Text } from 'react-native';

import { ApiError, api, type ScoreView } from '../../src/api/client';
import { Button } from '../../src/components/Button';
import { Screen, Section } from '../../src/components/Screen';
import { colors } from '../../src/theme/tenant';

const MATCH_ID = 'demo-match-2';

export default function ScoreScreen() {
  const [score, setScore] = useState<ScoreView | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setScore(await api.score(MATCH_ID));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the match.');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    void load();
  }, [load]));

  async function send(body: { event_id: string; type: string; payload: Record<string, unknown> }) {
    setBusy(true);
    setError(null);
    try {
      await api.postEvent({ match_id: MATCH_ID, ...body });
      setScore(await api.score(MATCH_ID));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The event was not accepted.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen title="Scoring">
      {loading ? <Text style={styles.muted}>Loading match…</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {score ? (
        <Section title="demo-match-2">
          <Text style={styles.score}>
            {score.home.team_id} {score.home.score} – {score.away.score} {score.away.team_id}
          </Text>
          <Text style={styles.muted}>{score.status}</Text>
          {score.status === 'upcoming' ? (
            <Button
              label="Start match"
              loading={busy}
              onPress={() => void send({ event_id: 'demo-match-2-start', type: 'match_start', payload: {} })}
            />
          ) : null}
          <Button
            label="Goal for demo-t3"
            loading={busy}
            onPress={() => void send({
              event_id: `demo-match-2-g-${Date.now()}`,
              type: 'score',
              payload: { team_id: 'demo-t3', event_type: 'goal' },
            })}
          />
        </Section>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  score: { fontSize: 22, fontWeight: '800', color: colors.text },
  muted: { fontSize: 16, color: colors.muted },
  error: { fontSize: 15, color: colors.danger },
});