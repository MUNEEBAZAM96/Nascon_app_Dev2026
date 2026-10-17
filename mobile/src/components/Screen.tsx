import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { colors, spacing } from '../theme/tenant';

interface ScreenProps {
  title: string;
  emptyText?: string;
  children?: ReactNode;
}

export function Screen({ title, emptyText, children }: ScreenProps) {
  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Text style={styles.title} accessibilityRole="header">
        {title}
      </Text>
      {emptyText ? <Text style={styles.empty}>{emptyText}</Text> : null}
      {children}
    </ScrollView>
  );
}

export function Section({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle} accessibilityRole="header">
        {title}
      </Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, gap: spacing.md },
  title: { fontSize: 26, fontWeight: '700', color: colors.text },
  empty: { fontSize: 16, color: colors.muted },
  section: {
    padding: spacing.md,
    borderRadius: 12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
  },
  sectionTitle: { fontSize: 18, fontWeight: '600', color: colors.text },
});
