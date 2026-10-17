import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

export function IconBadge({ name, tone = 'green' }: { name: keyof typeof Ionicons.glyphMap; tone?: 'green' | 'gray' }) {
  const green = tone === 'green';
  return (
    <View style={[styles.circle, { backgroundColor: green ? '#E8F5E9' : '#F3F4F6' }]}>
      <Ionicons name={name} size={20} color={green ? '#0B6E4F' : '#4B5563'} accessibilityElementsHidden />
    </View>
  );
}

const styles = StyleSheet.create({
  circle: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
});
