import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { ApiError, DEMO, api, type PlayerHistory } from '../../src/api/client';
import { useSession } from '../../src/auth/session';
import { Button } from '../../src/components/Button';
import { IconBadge } from '../../src/components/IconBadge';
import { Card, LoadingBars, Screen } from '../../src/components/Screen';
import { enqueue, list } from '../../src/queue/pending';
import { newActionId, stamp } from '../../src/queue/types';
import { useSyncStatus } from '../../src/sync/status';
import { displayName, roleLabel } from '../../src/theme/names';
import { colors, tenantTheme } from '../../src/theme/tenant';

const SETUP = {
  league: {
    league_id: 'lg-demo',
    tenant_id: 'tenant-alpha',
    sport_id: 'football',
    window: { open: '2026-10-01', close: '2026-10-31' },
    max_squad_size: 25,
    required_positions: { gk: 1 },
  },
  squads: [
    { squad_id: 'sq-demo-a', tenant_id: 'tenant-alpha', name: 'Demo United' },
    { squad_id: 'sq-demo-b', tenant_id: 'tenant-alpha', name: 'Demo Rovers' },
  ],
  players: [
    { player_id: 'p-demo-1', name: 'Demo Striker', position: 'mf', squad_id: 'sq-demo-a', role: 'starter' },
    { player_id: 'p-demo-gk', name: 'Demo Keeper', position: 'gk', squad_id: 'sq-demo-a', role: 'starter' },
    { player_id: 'p-demo-3', name: 'Demo Host', position: 'mf', squad_id: 'sq-demo-b', role: 'starter' },
  ],
  matches_in_progress: [],
};

export default function RosterScreen() {
  const { claims } = useSession();
  const theme = tenantTheme(claims?.tenant_id);
  const [player, setPlayer] = useState<PlayerHistory | null>(null);
  const [loading, setLoading] = useState(true);
  const [moving, setMoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const { status, refreshPending } = useSyncStatus();
  const savedLine = 'Saved on this phone. It will sync when you are back online.';

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setPlayer(await readOrCreate());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the roster.');
    } finally {
      const queued = await list();
      setSaved(queued.some((action) => action.type === 'roster_transfer') ? savedLine : null);
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    void load();
  }, [load]));

  function confirmMove() {
    const from = player?.current_squad_id;
    if (!from || from === 'sq-demo-b') return;
    Alert.alert('Move Demo Striker?', 'This sends the player to Demo Rovers.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Move', onPress: () => void move(from) },
    ]);
  }

  async function move(fromSquadId: string) {
    setMoving(true);
    setError(null);
    const body = {
      request_id: `tr-demo-${Date.now()}`,
      league_id: 'lg-demo',
      player_id: DEMO.rosterPlayer,
      type: 'transfer',
      from_squad_id: fromSquadId,
      to_squad_id: 'sq-demo-b',
      effective_date: DEMO.asOf,
      requested_by: 'user-manager',
      reason: 'Demo move',
    };
    try {
      if (status === 'offline') {
        await enqueue({
          action_id: newActionId(),
          type: 'roster_transfer',
          queued_at: stamp(),
          base_version: player ? player.history.length : 0,
          payload: body,
        });
        setSaved(savedLine);
        await refreshPending();
        return;
      }
      await api.transfer(body);
      setPlayer(await api.playerHistory(DEMO.rosterPlayer, DEMO.asOf));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The move could not be completed.');
    } finally {
      setMoving(false);
    }
  }

  return (
    <Screen title="Roster">
      {loading ? <Card><LoadingBars label="Loading roster" /></Card> : null}
      {saved ? <Text style={styles.saved}>{saved}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {player ? (
        <>
          <Card>
            <View style={styles.titleRow}>
              <IconBadge name="person" />
              <Text style={styles.title}>Demo Striker</Text>
            </View>
            <View style={styles.lineRow}>
              <Ionicons name="shirt-outline" size={18} color="#4B5563" accessibilityElementsHidden />
              <Text style={styles.line}>Squad {displayName(player.current_squad_id)}</Text>
            </View>
            <View style={styles.lineRow}>
              <Ionicons
                name={player.role === 'substitute' ? 'swap-horizontal' : 'star'}
                size={18}
                color={player.role === 'starter' || player.role === 'captain' ? '#D97706' : '#4B5563'}
                accessibilityElementsHidden
              />
              <Text style={styles.line}>Role {roleLabel(player.role)}</Text>
            </View>
          </Card>
          {SETUP.squads.map((squad) => (
            <Card key={squad.squad_id}>
              <Text style={styles.title}>{squad.name}</Text>
              {SETUP.players
                .filter((member) => (member.player_id === DEMO.rosterPlayer ? player.current_squad_id : member.squad_id) === squad.squad_id)
                .map((member) => (
                  <Text key={member.player_id} style={styles.line}>
                    {member.name} · {roleLabel(member.player_id === DEMO.rosterPlayer ? player.role : member.role)}
                  </Text>
                ))}
            </Card>
          ))}
          {player.current_squad_id && player.current_squad_id !== 'sq-demo-b' ? (
            <View style={styles.lineRow}>
              <Ionicons name="arrow-forward" size={18} color="#0B6E4F" accessibilityElementsHidden />
              <View style={styles.action}><Button label="Move Demo Striker to Demo Rovers" color={theme.primary} onPress={confirmMove} loading={moving} /></View>
            </View>
          ) : (
            <Text style={styles.line}>Demo Striker is already at Demo Rovers.</Text>
          )}
        </>
      ) : null}
    </Screen>
  );
}

async function readOrCreate(): Promise<PlayerHistory> {
  try {
    return await api.playerHistory(DEMO.rosterPlayer, DEMO.asOf);
  } catch (err) {
    if (!(err instanceof ApiError) || err.code !== 'PLAYER_NOT_FOUND') throw err;
    await api.setupRoster(SETUP);
    return api.playerHistory(DEMO.rosterPlayer, DEMO.asOf);
  }
}

const styles = StyleSheet.create({
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 20, fontWeight: '800', color: colors.text },
  lineRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  line: { fontSize: 16, color: colors.text },
  action: { flex: 1 },
  error: { fontSize: 15, color: colors.danger },
  saved: { fontSize: 15, color: '#0B6E4F' },
});
