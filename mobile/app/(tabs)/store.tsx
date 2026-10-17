import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ApiError, DEMO, JERSEY_PRICE, api, formatPkr, type InventoryView } from '../../src/api/client';
import { Button } from '../../src/components/Button';
import { Screen } from '../../src/components/Screen';
import { colors, spacing } from '../../src/theme/tenant';

export default function StoreScreen() {
  const [sizes, setSizes] = useState<{ M: InventoryView; L: InventoryView } | null>(null);
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [medium, large] = await Promise.all([api.inventory(DEMO.variants.M), api.inventory(DEMO.variants.L)]);
      setSizes({ M: medium, L: large });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the store.');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    void load();
  }, [load]));

  async function pay() {
    setPaying(true);
    setError(null);
    setReceipt(null);
    try {
      const order = await api.checkout({
        order_id: `ord-demo-${Date.now()}`,
        customer_id: 'cust-demo',
        items: [{ variant_id: DEMO.variants.M, quantity: 1 }],
        payment: { token: 'tok_success' },
      });
      setReceipt(`${order.order_id} · ${order.status} · ${formatPkr(order.total_minor)}`);
      const [medium, large] = await Promise.all([api.inventory(DEMO.variants.M), api.inventory(DEMO.variants.L)]);
      setSizes({ M: medium, L: large });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Payment failed.';
      setError(message);
      if (err instanceof ApiError && err.code === 'OUT_OF_STOCK') {
        const [medium, large] = await Promise.all([api.inventory(DEMO.variants.M), api.inventory(DEMO.variants.L)]).catch(() => [null, null]);
        if (medium && large) setSizes({ M: medium, L: large });
      }
    } finally {
      setPaying(false);
    }
  }

  return (
    <Screen title="Store">
      {loading ? <Text style={styles.muted}>Loading store…</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {receipt ? <Text style={styles.receipt}>{receipt}</Text> : null}
      {sizes ? (
        <View style={styles.list}>
          <View style={styles.card}>
            <Text style={styles.title}>Size M</Text>
            <Text style={styles.price}>{JERSEY_PRICE}</Text>
            <Text style={styles.muted}>Stock {sizes.M.stock}</Text>
            <Button label="Pay" onPress={() => void pay()} loading={paying} />
          </View>
          <View style={styles.card}>
            <Text style={styles.title}>Size L</Text>
            <Text style={styles.price}>{JERSEY_PRICE}</Text>
            <Text style={styles.muted}>Stock {sizes.L.stock}</Text>
          </View>
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.md },
  card: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  title: { fontSize: 18, fontWeight: '700', color: colors.text },
  price: { fontSize: 16, fontWeight: '600', color: colors.text },
  muted: { fontSize: 15, color: colors.muted },
  error: { fontSize: 15, color: colors.danger },
  receipt: { fontSize: 16, fontWeight: '700', color: colors.online },
});
