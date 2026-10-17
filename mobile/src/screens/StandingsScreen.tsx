import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ApiError, DEMO, api, type StandingsView } from '../api/client';
import { useSession } from '../auth/session';
import { Card, LoadingBars, Screen, StatusPill } from '../components/Screen';
import { displayName } from '../theme/names';
import { colors, spacing, tenantTheme } from '../theme/tenant';

export default function StandingsScreen({ active = true }: { active?: boolean }) {
  const { claims } = useSession();
  const theme = tenantTheme(claims?.tenant_id);
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

  useEffect(() => {
    if (active) void load();
  }, [active, load]);

  return (
    <Screen title="Standings">
      {loading ? <Card><LoadingBars label="Loading standings" /></Card> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {table ? (
        <Card tone={theme.secondary}>
          <Text style={styles.league}>{displayName(table.league_id)}</Text>
          <Text style={styles.muted}>{table.qualification_spots} qualification spots</Text>
        </Card>
      ) : null}
      {table ? (
        <Card>
          <View style={styles.head}>
            <Text style={[styles.headCell, styles.teamCol]}>Team</Text>
            <Text style={styles.headCell}>P</Text>
            <Text style={styles.headCell}>W</Text>
            <Text style={styles.headCell}>D</Text>
            <Text style={styles.headCell}>L</Text>
            <Text style={styles.headCell}>Pts</Text>
          </View>
          {table.table.map((row, index) => (
            <View key={row.team_id} style={[styles.line, index % 2 === 1 && styles.lineAlt]}>
              <View style={styles.teamCol}>
                <Text style={styles.name}>{row.rank}  {displayName(row.team_id)}</Text>
                <StatusPill status={row.status} />
              </View>
              <Text style={styles.cell}>{row.played}</Text>
              <Text style={styles.cell}>{row.won}</Text>
              <Text style={styles.cell}>{row.drawn}</Text>
              <Text style={styles.cell}>{row.lost}</Text>
              <Text style={[styles.cell, styles.pts, { color: theme.primary }]}>{row.points}</Text>
            </View>
          ))}
        </Card>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  league: { fontSize: 20, fontWeight: '800', color: colors.text },
  muted: { fontSize: 14, color: colors.muted },
  head: { flexDirection: 'row', alignItems: 'center', paddingBottom: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  headCell: { width: 28, textAlign: 'center', fontSize: 12, fontWeight: '700', color: colors.muted },
  line: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm, gap: 4 },
  lineAlt: { backgroundColor: colors.surface, borderRadius: 8 },
  teamCol: { flex: 1, gap: 4 },
  name: { fontSize: 16, fontWeight: '700', color: colors.text },
  cell: { width: 28, textAlign: 'center', fontSize: 15, color: colors.text },
  pts: { fontSize: 18, fontWeight: '800' },
  error: { fontSize: 15, color: colors.danger },
});
