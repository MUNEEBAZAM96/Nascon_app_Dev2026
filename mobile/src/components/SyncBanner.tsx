import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useSyncStatus, type SyncStatus } from '../sync/status';
import { colors, spacing } from '../theme/tenant';

const LABELS: Record<SyncStatus, { text: string; icon: string; color: string }> = {
  online: { text: 'Online', icon: '●', color: colors.online },
  offline: { text: 'Offline', icon: '○', color: colors.offline },
  syncing: { text: 'Syncing', icon: '↻', color: colors.syncing },
};

export function SyncBanner() {
  const { status } = useSyncStatus();
  const insets = useSafeAreaInsets();
  const label = LABELS[status];

  return (
    <View
      style={[styles.banner, { paddingTop: insets.top, backgroundColor: label.color }]}
      accessibilityRole="summary"
      accessibilityLabel={`Connection status: ${label.text}`}
    >
      <Text style={styles.text}>
        {label.icon} {label.text}
      </Text>
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
});
