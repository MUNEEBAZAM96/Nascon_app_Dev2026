import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ApiError, DEMO, JERSEY_PRICE, api, formatPkr, type InventoryView } from '../api/client';
import { useSession } from '../auth/session';
import { Button } from '../components/Button';
import { Card, LoadingBars, Screen } from '../components/Screen';
import { colors, spacing, tenantTheme } from '../theme/tenant';

export default function StoreScreen({ active = true }: { active?: boolean }) {
  const { claims } = useSession();
  const theme = tenantTheme(claims?.tenant_id);
  const [sizes, setSizes] = useState<{ M: InventoryView; L: InventoryView } | null>(null);
  const [loading, setLoading] = useState(true);
  const [size, setSize] = useState<'M' | 'L'>('M');
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<{ id: string; total: string } | null>(null);

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

  useEffect(() => {
    if (active) void load();
  }, [active, load]);

  async function pay() {
    setPaying(true);
    setError(null);
    setReceipt(null);
    try {
      const order = await api.checkout({
        order_id: `ord-demo-${Date.now()}`,
        customer_id: 'cust-demo',
        items: [{ variant_id: DEMO.variants[size], quantity: 1 }],
        payment: { token: 'tok_success' },
      });
      setReceipt({ id: order.order_id, total: formatPkr(order.total_minor) });
      const [medium, large] = await Promise.all([api.inventory(DEMO.variants.M), api.inventory(DEMO.variants.L)]);
      setSizes({ M: medium, L: large });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Payment failed.');
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
      {loading ? <Card><LoadingBars label="Loading store" /></Card> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {receipt ? (
        <View style={styles.receipt}>
          <Text style={styles.paid}>Receipt</Text>
          <Text style={styles.receiptId}>Order {receipt.id}</Text>
          <Text style={styles.price}>{receipt.total}</Text>
        </View>
      ) : null}
      {sizes ? (
        <Card>
          <Text style={styles.title}>Home jersey</Text>
          <Text style={styles.price}>{JERSEY_PRICE}</Text>
          <Text style={styles.muted}>Choose a size, then pay with the practice card.</Text>
          <View style={styles.sizes}>
            {(['M', 'L'] as const).map((option) => {
              const selected = option === size;
              const stock = sizes[option].stock;
              return (
                <Pressable
                  key={option}
                  accessibilityRole="button"
                  accessibilityLabel={`Size ${option}, ${stock} in stock`}
                  accessibilityState={{ selected }}
                  onPress={() => setSize(option)}
                  style={[styles.sizeBtn, selected && { backgroundColor: theme.primary, borderColor: theme.primary }]}
                >
                  <Text style={[styles.sizeText, selected && styles.sizeTextOn]}>Size {option}</Text>
                  <Text style={[styles.sizeStock, selected && styles.sizeTextOn]}>{stock === 0 ? 'Sold out' : `${stock} left`}</Text>
                </Pressable>
              );
            })}
          </View>
          <Button
            label={sizes[size].stock === 0 ? 'Sold out' : `Buy size ${size}`}
            color={theme.primary}
            disabled={sizes[size].stock === 0}
            loading={paying}
            onPress={() => void pay()}
          />
        </Card>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 22, fontWeight: '800', color: colors.text },
  price: { fontSize: 28, fontWeight: '800', color: colors.text },
  muted: { fontSize: 15, color: colors.muted, lineHeight: 22 },
  sizes: { flexDirection: 'row', gap: spacing.sm },
  sizeBtn: {
    flex: 1,
    minHeight: 64,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  sizeText: { fontSize: 16, fontWeight: '800', color: colors.text },
  sizeStock: { fontSize: 13, color: colors.muted },
  sizeTextOn: { color: '#FFFFFF' },
  error: { fontSize: 15, color: colors.danger },
  receipt: {
    gap: 4,
    padding: spacing.md,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#047857',
    borderLeftWidth: 6,
    backgroundColor: '#FFFFFF',
  },
  receiptId: { fontSize: 15, color: colors.text },
  paid: { fontSize: 16, fontWeight: '800', color: '#047857' },
});
