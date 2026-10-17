import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Ionicons } from '@expo/vector-icons';

import { ApiError, JERSEY_PRICE, api, type ScoreEvent, type ScoreView } from '../../src/api/client';
import { IconBadge } from '../../src/components/IconBadge';
import { useSession } from '../../src/auth/session';
import { Button } from '../../src/components/Button';
import { FadeIn } from '../../src/components/PressableCard';
import { Card, LoadingBars, Screen, StatusPill } from '../../src/components/Screen';
import { displayName, outcomeLabel } from '../../src/theme/names';
import { teamColor } from '../../src/theme/teams';
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

  const goals = score ? score.home.score + score.away.score : 0;

  return (
    <Screen title="Match">
      {loading && !score ? <Card><LoadingBars label="Loading match" /></Card> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {score ? (
        <>
          <Card tone={theme.secondary}>
            <View style={styles.hero}>
              <IconBadge name="football" />
              <Text style={styles.team}>{displayName(score.home.team_id)}</Text>
              <Text style={styles.big}>{score.home.score} – {score.away.score}</Text>
              <Text style={styles.team}>{displayName(score.away.team_id)}</Text>
              <View style={styles.chips}>
                <StatusPill status={score.status} />
                <View style={styles.chip}><Text style={styles.chipText}>{outcomeLabel(score.outcome)}</Text></View>
                <View style={styles.chip}><Text style={styles.chipText}>{goals === 1 ? '1 goal' : `${goals} goals`}</Text></View>
              </View>
            </View>
          </Card>
          <Card>
            <Text style={styles.section}>Timeline</Text>
            {score.events.length === 0 ? <Text style={styles.muted}>No events yet.</Text> : null}
            {score.events.map((event) => (
              <FadeIn key={event.event_id}>
                <TimelineRow event={event} />
              </FadeIn>
            ))}
          </Card>
        </>
      ) : null}
      <Card>
        <View style={styles.jersey}>
          <Ionicons name="shirt" size={22} color="#0B6E4F" accessibilityElementsHidden />
          <Text style={styles.section}>Home jersey</Text>
        </View>
        <Text style={styles.price}>{JERSEY_PRICE}</Text>
        <Button label="Open store" color={theme.primary} onPress={() => router.push('/store')} />
      </Card>
    </Screen>
  );
}

function TimelineRow({ event }: { event: ScoreEvent }) {
  if (event.type === 'match_start' || event.type === 'match_end' || event.type === 'compensation') {
    const label = event.type === 'match_start' ? 'Match started' : event.type === 'match_end' ? 'Match ended' : 'Goal disallowed';
    const icon = event.type === 'match_start' ? 'play' : event.type === 'match_end' ? 'flag' : 'close-circle';
    const tint = event.type === 'compensation' ? '#991B1B' : '#4B5563';
    return (
      <View style={styles.goal}>
        <Ionicons name={icon} size={16} color={tint} accessibilityElementsHidden />
        <Text style={styles.quiet}>{label}</Text>
      </View>
    );
  }
  if (event.type === 'score' && event.payload.event_type === 'goal') {
    return (
      <View style={styles.goal}>
        <View style={[styles.dot, { backgroundColor: teamColor(event.payload.team_id) }]} />
        <Ionicons name="football" size={16} color={teamColor(event.payload.team_id)} accessibilityElementsHidden />
        <Text style={[styles.event, event.compensated && styles.struck]}>Goal · {displayName(event.payload.team_id)}</Text>
        <Text style={styles.seq}>{event.sequence}</Text>
      </View>
    );
  }
  const team = event.payload.team_id ? ` · ${displayName(event.payload.team_id)}` : '';
  return (
    <View style={styles.goal}>
      <View style={[styles.dot, { backgroundColor: colors.muted }]} />
      <Text style={styles.event}>{event.type}{team}</Text>
      <Text style={styles.seq}>{event.sequence}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: spacing.sm },
  team: { fontSize: 18, fontWeight: '700', color: colors.text },
  big: { fontSize: 56, fontWeight: '800', color: colors.text },
  chips: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: spacing.sm },
  chip: { borderRadius: 999, backgroundColor: '#FFFFFF', paddingHorizontal: 10, paddingVertical: 4 },
  chipText: { fontSize: 13, fontWeight: '700', color: colors.text },
  muted: { fontSize: 15, color: colors.muted },
  error: { fontSize: 15, color: colors.danger },
  section: { fontSize: 18, fontWeight: '700', color: colors.text },
  jersey: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  price: { fontSize: 16, fontWeight: '700', color: colors.text },
  quiet: { fontSize: 14, color: colors.muted },
  goal: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dot: { width: 10, height: 10, borderRadius: 5 },
  event: { flex: 1, fontSize: 16, color: colors.text },
  seq: { fontSize: 13, color: colors.muted },
  struck: { textDecorationLine: 'line-through', color: colors.muted },
});
