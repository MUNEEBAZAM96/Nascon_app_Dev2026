import { useLocalSearchParams } from 'expo-router';
import { StyleSheet, Text } from 'react-native';

import { Screen, Section } from '../../src/components/Screen';
import { colors } from '../../src/theme/tenant';

export default function MatchScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  return (
    <Screen title="Match">
      <Text style={styles.muted}>Match {id}</Text>
      <Section title="Live score">
        <Text style={styles.muted}>The score will appear here when the match starts.</Text>
      </Section>
      <Section title="Timeline">
        <Text style={styles.muted}>No events yet.</Text>
      </Section>
      <Section title="Pinned product">
        <Text style={styles.muted}>No product pinned.</Text>
      </Section>
    </Screen>
  );
}

const styles = StyleSheet.create({
  muted: { fontSize: 16, color: colors.muted },
});
