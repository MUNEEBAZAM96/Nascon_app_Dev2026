import { useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput } from 'react-native';

import { DEFAULT_BASE_URL, getBaseUrl, setBaseUrl } from '../src/api/client';
import { Button } from '../src/components/Button';
import { Screen } from '../src/components/Screen';
import { colors, minTapTarget, spacing } from '../src/theme/tenant';

export default function SettingsScreen() {
  const [url, setUrl] = useState('');
  const [message, setMessage] = useState<{ text: string; isError: boolean } | null>(null);

  useEffect(() => {
    getBaseUrl().then(setUrl);
  }, []);

  async function onSave() {
    const trimmed = url.trim();
    if (!/^https?:\/\/[^\s]+$/.test(trimmed)) {
      setMessage({ text: 'Enter a full address such as http://192.168.1.20:8080', isError: true });
      return;
    }
    await setBaseUrl(trimmed);
    setMessage({ text: 'Server address saved.', isError: false });
  }

  return (
    <Screen title="Settings">
      <Text style={styles.label}>Server address</Text>
      <Text style={styles.help}>
        iOS Simulator: http://127.0.0.1:8080. Android emulator: http://10.0.2.2:8080. Physical phone: your
        laptop's LAN IP, for example http://192.168.1.20:8080.
      </Text>
      <TextInput
        style={styles.input}
        value={url}
        onChangeText={setUrl}
        placeholder={DEFAULT_BASE_URL}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        accessibilityLabel="Server address "
      />
      {message ? (
        <Text style={[styles.help, { color: message.isError ? colors.danger : colors.online }]} accessibilityLiveRegion="polite">
          {message.text}
        </Text>
      ) : null}
      <Button label="Save" onPress={onSave} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 16, fontWeight: '600', color: colors.text },
  help: { fontSize: 15, color: colors.muted },
  input: {
    minHeight: minTapTarget,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: spacing.md,
    fontSize: 16,
    color: colors.text,
  },
});
