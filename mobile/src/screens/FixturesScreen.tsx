import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ApiError, DEMO, api, ensureDemoMatchPlayed, type ScoreView } from '../api/client';
import { useSession } from '../auth/session';
import { Card, LoadingBars, Screen, StatusPill } from '../components/Screen';
import { displayName } from '../theme/names';
import { colors, minTapTarget, spacing, tenantTheme } from '../theme/tenant';

export default function FixturesScreen({ active = true }: { active?: boolean }) {
  const { claims } = useSession();
  const theme = tenantTheme(claims?.tenant_id);
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

  useEffect(() => {
    if (active) void load();
  }, [active, load]);

  return (
    <Screen title="Fixtures">
      {loading ? <Card><LoadingBars label="Loading fixtures" /></Card> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {DEMO.matches.map((match) => {
        const score = scores[match.id];
        return (
          <Pressable
            key={match.id}
            accessibilityRole="button"
            accessibilityLabel={`${displayName(match.home)} versus ${displayName(match.away)}`}
            onPress={() => router.push(`/match/${match.id}`)}
            style={styles.hit}
          >
            <Card>
              <View style={styles.row}>
                <Text style={styles.team}>{displayName(match.home)}</Text>
                <View style={styles.scoreCol}>
                  <Text style={[styles.score, { color: theme.primary }]}>{score ? `${score.home.score}–${score.away.score}` : '–'}</Text>
                  {score ? <StatusPill status={score.status} /> : <Text style={styles.vs}>Tap to open</Text>}
                </View>
                <Text style={[styles.team, styles.away]}>{displayName(match.away)}</Text>
              </View>
            </Card>
          </Pressable>
        );
      })}
    </Screen>
  );
}

const styles = StyleSheet.create({
  hit: { minHeight: minTapTarget },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  team: { flex: 1, fontSize: 17, fontWeight: '700', color: colors.text },
  away: { textAlign: 'right' },
  vs: { fontSize: 13, color: colors.muted },
  scoreCol: { alignItems: 'center', gap: spacing.sm, minWidth: 88 },
  score: { fontSize: 28, fontWeight: '800', color: colors.text },
  error: { fontSize: 15, color: colors.danger },
});
