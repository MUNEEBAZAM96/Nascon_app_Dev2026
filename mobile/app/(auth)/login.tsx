import { Link, router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, View } from 'react-native';

import { api } from '../../src/api/client';
import { useSession } from '../../src/auth/session';
import { Button } from '../../src/components/Button';
import { colors, minTapTarget, spacing } from '../../src/theme/tenant';

export default function LoginScreen() {
  const { signIn } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit() {
    setError(null);
    if (!email.trim() || !password) {
      setError('Enter your email and password.');
      return;
    }
    setLoading(true);
    try {
      const { token } = await api.login(email.trim(), password);
      await signIn(token);
      router.replace('/fixtures');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.card}>
        <Text style={styles.title} accessibilityRole="header">
          Sideline
        </Text>
        <Text style={styles.subtitle}>Sign in to follow your league.</Text>

        <Text style={styles.label}>Email</Text>
        <TextInput
          style={styles.input}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          placeholder="you@nascon.test"
          accessibilityLabel="Email"
        />

        <Text style={styles.label}>Password</Text>
        <TextInput
          style={styles.input}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="password"
          placeholder="Password"
          accessibilityLabel="Password"
          onSubmitEditing={onSubmit}
        />

        {error ? (
          <Text style={styles.error} accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}

        <Button label="Sign in" onPress={onSubmit} loading={loading} />
        <Link href="/settings" style={styles.link} accessibilityRole="link">
          Server settings
        </Link>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'center', padding: spacing.md, backgroundColor: colors.surface },
  card: { gap: spacing.sm, maxWidth: 480, width: '100%', alignSelf: 'center' },
  title: { fontSize: 32, fontWeight: '800', color: colors.text },
  subtitle: { fontSize: 16, color: colors.muted, marginBottom: spacing.md },
  label: { fontSize: 15, fontWeight: '600', color: colors.text },
  input: {
    minHeight: minTapTarget,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: spacing.md,
    fontSize: 16,
    backgroundColor: colors.background,
    color: colors.text,
  },
  error: { color: colors.danger, fontSize: 15 },
  link: { fontSize: 16, color: colors.text, textDecorationLine: 'underline', paddingVertical: spacing.md, textAlign: 'center' },
});
