import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { ApiError, DEMO, api, ensureDemoMatchPlayed, type ScoreView } from '../../src/api/client';
import { Screen } from '../../src/components/Screen';
import { colors, minTapTarget, spacing } from '../../src/theme/tenant';

export default function FixturesScreen() {
  const [scores, setScores] = useState<Record<string, ScoreView>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await ensureDemoMatchPlayed();
      const rows = await Promise.all(DEMO.matches.map(async (match) => [match.id, await api.score(match.id)] as const));
      setScores(Object.fromEntries(rows));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load fixtures.');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    void load();
  }, [load]));

  return (
    <Screen title="Fixtures">
      {loading ? <Text style={styles.muted}>Loading fixtures…</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {DEMO.matches.map((match) => {
        const score = scores[match.id];
        return (
          <Pressable
            key={match.id}
            accessibilityRole="button"
            accessibilityLabel={`${match.home} versus ${match.away}`}
            onPress={() => router.push(`/match/${match.id}`)}
            style={styles.row}
          >
            <Text style={styles.match}>{match.home} vs {match.away}</Text>
            <Text style={styles.muted}>{score ? `${score.status}  ${score.home.score}–${score.away.score}` : match.id}</Text>
          </Pressable>
        );
      })}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: minTapTarget,
    padding: spacing.md,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    gap: spacing.xs,
  },
  match: { fontSize: 17, fontWeight: '700', color: colors.text },
  muted: { fontSize: 15, color: colors.muted },
  error: { fontSize: 15, color: colors.danger },
});
