import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Ionicons } from '@expo/vector-icons';

import { ApiError, api, type ScoreView } from '../../src/api/client';
import { IconBadge } from '../../src/components/IconBadge';
import { useSession } from '../../src/auth/session';
import { Button } from '../../src/components/Button';
import { Card, LoadingBars, Screen, StatusPill } from '../../src/components/Screen';
import { loadFixture, saveFixture } from '../../src/db';
import { enqueue, list } from '../../src/queue/pending';
import { newActionId, stamp } from '../../src/queue/types';
import { useSyncStatus } from '../../src/sync/status';
import { displayName, outcomeLabel } from '../../src/theme/names';
import { colors, spacing, tenantTheme } from '../../src/theme/tenant';

const MATCH_ID = 'demo-match-2';

export default function ScoreScreen() {
  const { claims } = useSession();
  const theme = tenantTheme(claims?.tenant_id);
  const [score, setScore] = useState<ScoreView | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const { status, setStatus, refreshPending } = useSyncStatus();
  const savedLine = 'Saved on this phone. It will sync when you are back online.';

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await api.score(MATCH_ID);
      await saveFixture(MATCH_ID, next);
      setScore(next);
    } catch (err) {
      const cached = await loadFixture<ScoreView>(MATCH_ID);
      if (cached) {
        setScore(cached);
        setStatus('offline');
      } else {
        setError(err instanceof ApiError ? err.message : 'Could not load the match.');
      }
    } finally {
      const queued = await list();
      setSaved(queued.some((action) => action.type === 'score_event' && action.payload.match_id === MATCH_ID) ? savedLine : null);
      setLoading(false);
    }
  }, [setStatus]);

  useFocusEffect(useCallback(() => {
    void load();
  }, [load]));

  async function send(body: { event_id: string; type: string; payload: Record<string, unknown> }, queueable = false) {
    setBusy(true);
    setError(null);
    const eventBody = { match_id: MATCH_ID, ...body };
    try {
      if (queueable && status === 'offline') {
        await enqueue({
          action_id: newActionId(),
          type: 'score_event',
          queued_at: stamp(),
          base_version: score?.events.length ?? 0,
          payload: eventBody,
        });
        setSaved(savedLine);
        await refreshPending();
        return;
      }
      await api.postEvent(eventBody);
      const next = await api.score(MATCH_ID);
      await saveFixture(MATCH_ID, next);
      setScore(next);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The event was not accepted.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen title="Scoring">
      {loading ? <Card><LoadingBars label="Loading match" /></Card> : null}
      {score ? (
        <Card tone={theme.secondary}>
          <View style={styles.hero}>
            <IconBadge name="create" />
            <Text style={styles.team}>{displayName(score.home.team_id)}</Text>
            <Text style={styles.big}>{score.home.score} – {score.away.score}</Text>
            <Text style={styles.team}>{displayName(score.away.team_id)}</Text>
            <StatusPill status={score.status} />
            <Text style={styles.muted}>{outcomeLabel(score.outcome)}</Text>
          </View>
          {saved ? <Text style={styles.saved}>{saved}</Text> : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}
          {score.status === 'upcoming' ? (
            <View style={styles.actionRow}>
              <Ionicons name="play" size={18} color="#0B6E4F" accessibilityElementsHidden />
              <View style={styles.action}>
                <Button
                  label="Start match"
                  color={theme.primary}
                  loading={busy}
                  onPress={() => void send({ event_id: 'demo-match-2-start', type: 'match_start', payload: {} }, true)}
                />
              </View>
            </View>
          ) : null}
          <View style={styles.actionRow}>
            <Ionicons name="football" size={18} color="#0B6E4F" accessibilityElementsHidden />
            <View style={styles.action}>
          <Button
            label="Add goal for City"
            color={theme.primary}
            loading={busy}
            onPress={() => void send({
              event_id: `demo-match-2-g-${Date.now()}`,
              type: 'score',
              payload: { team_id: 'demo-t3', event_type: 'goal' },
            }, true)}
          />
            </View>
          </View>
          <Button
            label="Undo last goal"
            variant="secondary"
            color={theme.primary}
            loading={busy}
            onPress={() => {
              const last = [...score.events].reverse().find((event) => event.type === 'score' && !event.compensated);
              if (!last) {
                setError('Add a goal before you undo one.');
                return;
              }
              void send({
                event_id: `demo-match-2-c-${Date.now()}`,
                type: 'compensation',
                payload: { compensates: last.event_id, reason: 'Disallowed' },
              });
            }}
          />
        </Card>
      ) : null}
      {!score && error ? <Text style={styles.error}>{error}</Text> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: spacing.sm },
  team: { fontSize: 18, fontWeight: '700', color: colors.text },
  big: { fontSize: 56, fontWeight: '800', color: colors.text },
  muted: { fontSize: 15, color: colors.muted },
  error: { fontSize: 15, color: colors.danger },
  saved: { fontSize: 15, color: '#0B6E4F' },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  action: { flex: 1 },
});