import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useSession } from '../auth/session';
import { colors, tenantTheme } from '../theme/tenant';

const ITEMS = [
  { label: 'Fixtures', idle: 'calendar-outline', active: 'calendar' },
  { label: 'Standings', idle: 'trophy-outline', active: 'trophy' },
  { label: 'Store', idle: 'shirt-outline', active: 'shirt' },
  { label: 'Profile', idle: 'person-outline', active: 'person' },
] as const;

export function CoolTabBar({ index, onPress }: { index: number; onPress: (next: number) => void }) {
  const { claims } = useSession();
  const theme = tenantTheme(claims?.tenant_id);
  const insets = useSafeAreaInsets();
  const [width, setWidth] = useState(0);
  const shift = useRef(new Animated.Value(0)).current;
  const column = width / ITEMS.length;

  useEffect(() => {
    if (column <= 0) return;
    Animated.timing(shift, {
      toValue: index * column,
      duration: 280,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [column, index, shift]);

  return (
    <View style={[styles.wrap, { marginBottom: insets.bottom + 8 }]} pointerEvents="box-none">
      <View style={styles.bar} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
        {column > 0 ? (
          <Animated.View
            style={[
              styles.capsule,
              { width: column - 24, backgroundColor: theme.secondary, transform: [{ translateX: shift }] },
            ]}
          />
        ) : null}
        {ITEMS.map((item, itemIndex) => {
          const selected = itemIndex === index;
          const tint = selected ? theme.primary : '#4B5563';
          return (
            <Pressable
              key={item.label}
              accessibilityRole="tab"
              accessibilityLabel={item.label}
              accessibilityState={{ selected }}
              onPress={() => onPress(itemIndex)}
              style={styles.item}
            >
              <Ionicons name={selected ? item.active : item.idle} size={24} color={tint} />
              <Text style={[styles.label, { color: tint }]}>{item.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 16 },
  bar: {
    height: 64,
    borderRadius: 32,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#0B6E4F',
    shadowOpacity: 0.12,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  capsule: { position: 'absolute', left: 12, height: 44, borderRadius: 22 },
  item: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', gap: 2 },
  label: { fontSize: 11, fontWeight: '600', color: colors.muted },
});
