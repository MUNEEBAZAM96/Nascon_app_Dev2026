import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';

import { colors, minTapTarget, spacing } from '../theme/tenant';

interface ButtonProps {
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  variant?: 'primary' | 'secondary';
  color?: string;
}

export function Button({ label, onPress, loading, disabled, variant = 'primary', color = colors.text }: ButtonProps) {
  const isPrimary = variant === 'primary';
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      style={({ pressed }) => [
        styles.base,
        isPrimary ? { backgroundColor: color } : { borderColor: color, borderWidth: 1.5 },
        (pressed || disabled) && styles.dimmed,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={isPrimary ? '#FFFFFF' : color} />
      ) : (
        <Text style={[styles.label, { color: isPrimary ? '#FFFFFF' : color }]}>{label}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: minTapTarget,
    borderRadius: 10,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { fontSize: 16, fontWeight: '600' },
  dimmed: { opacity: 0.7 },
});
