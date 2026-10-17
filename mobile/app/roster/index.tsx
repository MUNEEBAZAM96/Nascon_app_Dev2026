import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, StyleSheet, Text } from 'react-native';

import { ApiError, DEMO, api, type PlayerHistory } from '../../src/api/client';
import { Button } from '../../src/components/Button';
import { Screen, Section } from '../../src/components/Screen';
import { colors } from '../../src/theme/tenant';

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
  const [player, setPlayer] = useState<PlayerHistory | null>(null);
  const [loading, setLoading] = useState(true);
  const [moving, setMoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setPlayer(await readOrCreate());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the roster.');
    } finally {
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
    try {
      await api.transfer({
        request_id: `tr-demo-${Date.now()}`,
        league_id: 'lg-demo',
        player_id: DEMO.rosterPlayer,
        type: 'transfer',
        from_squad_id: fromSquadId,
        to_squad_id: 'sq-demo-b',
        effective_date: DEMO.asOf,
        requested_by: 'user-manager',
        reason: 'Demo move',
      });
      setPlayer(await api.playerHistory(DEMO.rosterPlayer, DEMO.asOf));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The move could not be completed.');
    } finally {
      setMoving(false);
    }
  }

  return (
    <Screen title="Roster">
      {loading ? <Text style={styles.muted}>Loading roster…</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {player ? (
        <Section title={player.player_id}>
          <Text style={styles.line}>Squad {player.current_squad_id ?? 'none'}</Text>
          <Text style={styles.line}>Role {player.role ?? 'none'}</Text>
          {player.current_squad_id && player.current_squad_id !== 'sq-demo-b' ? (
            <Button label="Move to Demo Rovers" onPress={confirmMove} loading={moving} />
          ) : null}
        </Section>
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
  muted: { fontSize: 16, color: colors.muted },
  error: { fontSize: 15, color: colors.danger },
  line: { fontSize: 16, color: colors.text },
});
