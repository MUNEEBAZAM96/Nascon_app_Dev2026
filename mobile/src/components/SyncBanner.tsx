import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useSyncStatus, type SyncStatus } from '../sync/status';
import { colors, spacing } from '../theme/tenant';

const LABELS: Record<SyncStatus, { text: string; icon: string; color: string }> = {
  online: { text: 'Online', icon: '●', color: colors.online },
  offline: { text: 'Offline', icon: '○', color: colors.offline },
  syncing: { text: 'Syncing', icon: '↻', color: colors.syncing },
};

export function SyncBanner() {
  const { status, pending, notice, syncNow } = useSyncStatus();
  const insets = useSafeAreaInsets();
  const label = LABELS[status];
  const text = pending > 0 ? `${label.text} · ${pending} pending` : label.text;

  return (
    <View style={[styles.banner, { paddingTop: insets.top, backgroundColor: label.color }]}>
      <Text style={styles.text} accessibilityRole="summary" accessibilityLabel={`Connection status: ${text}`}>
        {label.icon} {text}
      </Text>
      {pending > 0 ? (
        <Pressable onPress={() => void syncNow()} accessibilityRole="button" accessibilityLabel="Sync">
          <Text style={styles.sync}>Sync</Text>
        </Pressable>
      ) : null}
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    paddingBottom: spacing.xs,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
  },
  text: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  sync: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
    textDecorationLine: 'underline',
    marginTop: 2,
  },
  notice: {
    color: '#FFFFFF',
    fontSize: 13,
    textAlign: 'center',
    marginTop: 2,
  },
});
