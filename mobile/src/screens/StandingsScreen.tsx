import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Ionicons } from '@expo/vector-icons';

import { ApiError, DEMO, api, type StandingsView } from '../api/client';
import { loadStandings, saveStandings } from '../db';
import { IconBadge } from '../components/IconBadge';
import { useSession } from '../auth/session';
import { Card, LoadingBars, Screen, StatusPill } from '../components/Screen';
import { useSyncStatus } from '../sync/status';
import { displayName } from '../theme/names';
import { teamColor } from '../theme/teams';
import { colors, spacing, tenantTheme } from '../theme/tenant';

export default function StandingsScreen({ active = true }: { active?: boolean }) {
  const { claims } = useSession();
  const theme = tenantTheme(claims?.tenant_id);
  const [table, setTable] = useState<StandingsView | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loaded = useRef(false);
  const { setStatus } = useSyncStatus();

  const load = useCallback(async (mode: 'initial' | 'refresh' = 'initial') => {
    if (mode === 'refresh') setRefreshing(true);
    else if (!loaded.current) setLoading(true);
    setError(null);
    try {
      const next = await api.standings(DEMO.leagueId);
      await saveStandings(DEMO.leagueId, next);
      setTable(next);
      loaded.current = true;
    } catch (err) {
      const cached = await loadStandings<StandingsView>(DEMO.leagueId);
      if (cached) {
        setTable(cached);
        setStatus('offline');
        loaded.current = true;
      } else {
        setError(err instanceof ApiError ? err.message : 'Could not load standings.');
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [setStatus]);

  useEffect(() => {
    if (active) void load('initial');
  }, [active, load]);

  return (
    <Screen title="Standings" refreshing={refreshing} onRefresh={() => void load('refresh')}>
      {loading && !loaded.current ? <Card><LoadingBars label="Loading standings" /></Card> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {table ? (
        <Card tone={theme.secondary}>
          <View style={styles.header}>
            <IconBadge name="trophy" />
            <View>
              <Text style={styles.league}>{displayName(table.league_id)}</Text>
              <Text style={styles.muted}>{table.qualification_spots} qualification spots</Text>
            </View>
          </View>
        </Card>
      ) : null}
      {table?.table.map((row) => row.rank === 1 ? (
        <View key={row.team_id} style={styles.champion}>
          <View style={styles.championBar} />
          <View style={styles.championBody}>
            <View style={styles.championTop}>
              <View style={[styles.dot, { backgroundColor: teamColor(row.team_id) }]} />
              <Text style={styles.name}>{displayName(row.team_id)}</Text>
              <Ionicons name="ribbon" size={16} color="#0B6E4F" accessibilityElementsHidden />
              <Text style={styles.championPts}>{row.points}</Text>
            </View>
            <Text style={styles.record}>W {row.won}  D {row.drawn}  L {row.lost}</Text>
            <StatusPill status={row.status} />
            <Text style={styles.detail}>Scored {row.scored}, conceded {row.conceded}, diff {row.diff}</Text>
          </View>
        </View>
      ) : (
        <View key={row.team_id} style={styles.compact}>
          <Text style={styles.rank}>{row.rank}</Text>
          <View style={[styles.dot, { backgroundColor: teamColor(row.team_id) }]} />
          <Text style={styles.compactName}>{displayName(row.team_id)}</Text>
          <Text style={styles.compactStat}>{row.played}</Text>
          <Text style={styles.compactStat}>{row.won}</Text>
          <Text style={styles.compactStat}>{row.drawn}</Text>
          <Text style={styles.compactStat}>{row.lost}</Text>
          <Text style={styles.compactPts}>{row.points}</Text>
          <StatusPill status={row.status} />
        </View>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  league: { fontSize: 20, fontWeight: '800', color: colors.text },
  muted: { fontSize: 14, color: colors.muted },
  error: { fontSize: 15, color: colors.danger },
  champion: {
    minHeight: 72,
    flexDirection: 'row',
    backgroundColor: colors.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  championBar: { width: 4, backgroundColor: '#0B6E4F' },
  championBody: { flex: 1, padding: spacing.md, gap: 4 },
  championTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  name: { flex: 1, fontSize: 18, fontWeight: '800', color: colors.text },
  championPts: { fontSize: 22, fontWeight: '800', color: '#0B6E4F' },
  record: { fontSize: 14, color: colors.text },
  detail: { fontSize: 14, color: colors.muted },
  dot: { width: 14, height: 14, borderRadius: 7 },
  compact: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rank: { width: 16, fontSize: 14, fontWeight: '700', color: colors.muted },
  compactName: { flex: 1, fontSize: 15, fontWeight: '700', color: colors.text },
  compactStat: { width: 18, textAlign: 'center', fontSize: 13, color: colors.text },
  compactPts: { width: 24, textAlign: 'right', fontSize: 15, fontWeight: '800', color: colors.text },
});
