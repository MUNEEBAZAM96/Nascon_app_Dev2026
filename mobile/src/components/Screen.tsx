import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { colors, spacing } from '../theme/tenant';

const PILL: Record<string, { label: string; background: string; text: string }> = {
  clinched: { label: 'Clinched', background: '#E8F5E9', text: '#0B6E4F' },
  completed: { label: 'Completed', background: '#E8F5E9', text: '#0B6E4F' },
  still_possible: { label: 'Still possible', background: '#FEF3C7', text: '#92400E' },
  upcoming: { label: 'Upcoming', background: '#FEF3C7', text: '#92400E' },
  eliminated: { label: 'Eliminated', background: '#FEE2E2', text: '#991B1B' },
  in_progress: { label: 'Live', background: '#DBEAFE', text: '#1E40AF' },
};

interface ScreenProps {
  title: string;
  emptyText?: string;
  children?: ReactNode;
}

export function Screen({ title, emptyText, children }: ScreenProps) {
  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Text style={styles.srOnly} accessibilityRole="header">
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

export function Card({ children, tone }: { children?: ReactNode; tone?: string }) {
  return <View style={[styles.card, tone ? { backgroundColor: tone } : null]}>{children}</View>;
}

export function StatusPill({ status }: { status: string }) {
  const pill = PILL[status] ?? { label: status, background: '#F3F4F6', text: colors.text };
  return (
    <View style={[styles.pill, { backgroundColor: pill.background }]}>
      <Text style={[styles.pillText, { color: pill.text }]}>{pill.label}</Text>
    </View>
  );
}

export function LoadingBars({ label }: { label: string }) {
  return (
    <View accessibilityLabel={label} style={styles.loading}>
      <View style={styles.bar} />
      <View style={[styles.bar, styles.barShort]} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.lg },
  srOnly: { position: 'absolute', width: 1, height: 1, overflow: 'hidden' },
  empty: { fontSize: 16, color: colors.muted, lineHeight: 22 },
  section: {
    padding: spacing.md,
    borderRadius: 12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
  },
  sectionTitle: { fontSize: 18, fontWeight: '600', color: colors.text },
  card: {
    padding: spacing.md,
    borderRadius: 16,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
  },
  pill: { alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  pillText: { fontSize: 13, fontWeight: '700' },
  loading: { gap: spacing.sm },
  bar: { height: 14, borderRadius: 7, backgroundColor: '#E5E7EB', width: '100%' },
  barShort: { width: '62%' },
});
