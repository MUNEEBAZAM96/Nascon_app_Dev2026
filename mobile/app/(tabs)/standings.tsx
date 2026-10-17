import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ApiError, DEMO, api, statusLabel, type StandingsView } from '../../src/api/client';
import { Screen } from '../../src/components/Screen';
import { colors, spacing } from '../../src/theme/tenant';

export default function StandingsScreen() {
  const [table, setTable] = useState<StandingsView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setTable(await api.standings(DEMO.leagueId));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load standings.');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    void load();
  }, [load]));

  return (
    <Screen title="Standings">
      {loading ? <Text style={styles.muted}>Loading standings…</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {table ? (
        <Text style={styles.heading}>{table.league_id} · {table.qualification_spots} qualification spots</Text>
      ) : null}
      {table?.table.map((row) => (
        <View key={row.team_id} style={styles.row}>
          <Text style={styles.main}>
            {row.rank}. {row.team_id} · P{row.played} W{row.won} D{row.drawn} L{row.lost} · {row.points} pts · {statusLabel(row.status)}
          </Text>
          <Text style={styles.muted}>Scored {row.scored}, conceded {row.conceded}, diff {row.diff}</Text>
        </View>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: { fontSize: 16, fontWeight: '600', color: colors.text },
  row: {
    padding: spacing.md,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    gap: spacing.xs,
  },
  main: { fontSize: 16, fontWeight: '700', color: colors.text },
  muted: { fontSize: 14, color: colors.muted },
  error: { fontSize: 15, color: colors.danger },
});
