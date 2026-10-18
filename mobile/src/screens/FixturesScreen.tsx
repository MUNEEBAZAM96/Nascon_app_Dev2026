import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ApiError, DEMO, api, ensureDemoMatchPlayed, type ScoreView } from '../api/client';
import { loadFixture, saveFixture } from '../db';
import { IconBadge } from '../components/IconBadge';
import { PressableCard } from '../components/PressableCard';
import { Card, LoadingBars, Screen, StatusPill } from '../components/Screen';
import { useSyncStatus } from '../sync/status';
import { displayName } from '../theme/names';
import { teamColor } from '../theme/teams';
import { colors, spacing } from '../theme/tenant';

export default function FixturesScreen({ active = true }: { active?: boolean }) {
  const [scores, setScores] = useState<Record<string, ScoreView>>({});
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
      await ensureDemoMatchPlayed();
      const rows = await Promise.all(DEMO.matches.map(async (match) => [match.id, await api.score(match.id)] as const));
      await Promise.all(rows.map(([id, score]) => saveFixture(id, score)));
      setScores(Object.fromEntries(rows));
      loaded.current = true;
    } catch (err) {
      const cached: Record<string, ScoreView> = {};
      for (const match of DEMO.matches) {
        const row = await loadFixture<ScoreView>(match.id);
        if (row) cached[match.id] = row;
      }
      if (Object.keys(cached).length > 0) {
        setScores(cached);
        setStatus('offline');
        loaded.current = true;
      } else {
        setError(err instanceof ApiError ? err.message : 'Could not load fixtures.');
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
    <Screen title="Fixtures" refreshing={refreshing} onRefresh={() => void load('refresh')}>
      {loading && !loaded.current ? <Card><LoadingBars label="Loading fixtures" /></Card> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Card tone="#E8F5E9">
        <View style={styles.header}>
          <IconBadge name="football-outline" />
          <View>
            <Text style={styles.headerTitle}>Sideline Demo League</Text>
            <Text style={styles.headerSub}>Match day</Text>
          </View>
        </View>
      </Card>
      {DEMO.matches.map((match) => {
        const score = scores[match.id];
        return (
          <PressableCard
            key={match.id}
            accessibilityLabel={`${displayName(match.home)} versus ${displayName(match.away)}`}
            onPress={() => router.push(`/match/${match.id}`)}
          >
            <Card flush>
              <View style={[styles.stripe, { backgroundColor: teamColor(match.home) }]} />
              <View style={styles.body}>
                <View style={styles.row}>
                  <View style={styles.side}>
                    <View style={[styles.dot, { backgroundColor: teamColor(match.home) }]} />
                    <Text style={styles.team}>{displayName(match.home)}</Text>
                  </View>
                  <View style={styles.scoreBox}>
                    <Ionicons
                      name={score && (score.status === 'completed' || score.status === 'in_progress') ? 'football-outline' : 'time-outline'}
                      size={16}
                      color={score && (score.status === 'completed' || score.status === 'in_progress') ? '#0B6E4F' : '#4B5563'}
                      accessibilityElementsHidden
                    />
                    <Text style={styles.score}>{score ? `${score.home.score} – ${score.away.score}` : '–'}</Text>
                  </View>
                  <View style={[styles.side, styles.away]}>
                    <Text style={[styles.team, styles.awayText]}>{displayName(match.away)}</Text>
                    <View style={[styles.dot, { backgroundColor: teamColor(match.away) }]} />
                  </View>
                </View>
                <View style={styles.meta}>
                  {score ? <StatusPill status={score.status} /> : null}
                  <Text style={styles.chevron}>›</Text>
                </View>
                <Text style={styles.id}>{match.id}</Text>
              </View>
            </Card>
          </PressableCard>
        );
      })}
    </Screen>
  );
}

const styles = StyleSheet.create({
  stripe: { width: 4 },
  body: { flex: 1, padding: spacing.md, gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  side: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  away: { justifyContent: 'flex-end' },
  team: { flexShrink: 1, fontSize: 17, fontWeight: '700', color: colors.text },
  awayText: { textAlign: 'right' },
  dot: { width: 14, height: 14, borderRadius: 7 },
  scoreBox: {
    minWidth: 72,
    borderRadius: 12,
    backgroundColor: '#E8F5E9',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    alignItems: 'center',
  },
  score: { fontSize: 22, fontWeight: '800', color: '#0B6E4F' },
  meta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  chevron: { fontSize: 22, color: '#4B5563', fontWeight: '600' },
  id: { fontSize: 11, color: '#4B5563' },
  error: { fontSize: 15, color: colors.danger },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  headerTitle: { fontSize: 18, fontWeight: '800', color: colors.text },
  headerSub: { fontSize: 14, color: colors.muted },
});
