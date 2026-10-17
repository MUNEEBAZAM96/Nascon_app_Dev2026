import { Link, router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { api } from '../../src/api/client';
import { useSession } from '../../src/auth/session';
import { Button } from '../../src/components/Button';
import { colors, minTapTarget, spacing } from '../../src/theme/tenant';

const BRAND = '#0B6E4F';
const DEMO_PASSWORD = 'Nascon@26';
const ACCOUNTS = [
  { label: 'Admin', email: 'admin@nascon.test' },
  { label: 'Organizer', email: 'organizer@nascon.test' },
  { label: 'Manager', email: 'manager@nascon.test' },
  { label: 'Player', email: 'player@nascon.test' },
  { label: 'Viewer', email: 'viewer@nascon.test' },
];

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
      <View style={styles.band}>
        <Text style={styles.title} accessibilityRole="header">Sideline</Text>
        <Text style={styles.bandSub}>Alpha Sports</Text>
      </View>
      <View style={styles.card}>
        <Text style={styles.label}>Demo account</Text>
        <View style={styles.chips}>
          {ACCOUNTS.map((account) => {
            const selected = email === account.email;
            return (
              <Pressable
                key={account.email}
                accessibilityRole="button"
                accessibilityLabel={account.label}
                accessibilityState={{ selected }}
                onPress={() => {
                  setEmail(account.email);
                  setPassword(DEMO_PASSWORD);
                  setError(null);
                }}
                style={[styles.chip, selected && styles.chipOn]}
              >
                <Text style={[styles.chipText, selected && styles.chipTextOn]}>{account.label}</Text>
              </Pressable>
            );
          })}
        </View>

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
          <Text style={styles.error} accessibilityLiveRegion="polite">{error}</Text>
        ) : null}

        <Button label="Sign in" onPress={onSubmit} loading={loading} color={BRAND} />
        <Link href="/settings" style={styles.link} accessibilityRole="link">
          Server settings
        </Link>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  band: { height: 160, backgroundColor: BRAND, justifyContent: 'flex-end', padding: spacing.lg, gap: spacing.xs },
  title: { fontSize: 32, fontWeight: '800', color: '#FFFFFF' },
  bandSub: { fontSize: 16, color: '#E8F5E9' },
  card: { gap: spacing.sm, padding: spacing.md, maxWidth: 480, width: '100%', alignSelf: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.sm },
  chip: {
    minHeight: minTapTarget,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: BRAND,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  chipOn: { backgroundColor: BRAND },
  chipText: { color: BRAND, fontWeight: '700', fontSize: 15 },
  chipTextOn: { color: '#FFFFFF' },
  label: { fontSize: 15, fontWeight: '600', color: colors.text },
  input: {
    minHeight: minTapTarget,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: spacing.md,
    fontSize: 16,
    backgroundColor: '#FFFFFF',
    color: colors.text,
  },
  error: { color: colors.danger, fontSize: 15 },
  link: { fontSize: 15, color: colors.muted, textDecorationLine: 'underline', paddingVertical: spacing.md, textAlign: 'center' },
});
