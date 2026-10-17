import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ApiError, DEMO, JERSEY_PRICE, api, formatPkr, type InventoryView } from '../api/client';
import { Button } from '../components/Button';
import { FadeIn } from '../components/PressableCard';
import { Card, LoadingBars, Screen } from '../components/Screen';
import { colors, spacing } from '../theme/tenant';

export default function StoreScreen({ active = true }: { active?: boolean }) {
  const [sizes, setSizes] = useState<{ M: InventoryView; L: InventoryView } | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<{ id: string; total: string } | null>(null);
  const loaded = useRef(false);

  const load = useCallback(async (mode: 'initial' | 'refresh' = 'initial') => {
    if (mode === 'refresh') setRefreshing(true);
    else if (!loaded.current) setLoading(true);
    setError(null);
    try {
      const [medium, large] = await Promise.all([api.inventory(DEMO.variants.M), api.inventory(DEMO.variants.L)]);
      setSizes({ M: medium, L: large });
      loaded.current = true;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the store.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (active) void load('initial');
  }, [active, load]);

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

  const soldOut = sizes?.M.stock === 0;

  return (
    <Screen title="Store" refreshing={refreshing} onRefresh={() => void load('refresh')}>
      {loading && !loaded.current ? <Card><LoadingBars label="Loading store" /></Card> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {receipt ? (
        <FadeIn>
          <View style={styles.receipt}>
            <View style={styles.perforation}>
              {Array.from({ length: 12 }, (_, notch) => <View key={notch} style={styles.notch} />)}
            </View>
            <Ionicons name="receipt" size={22} color="#047857" accessibilityElementsHidden />
            <Text style={styles.receiptId}>{receipt.id}</Text>
            <Text style={styles.paid}>Paid</Text>
            <Text style={styles.receiptPrice}>{receipt.total}</Text>
          </View>
        </FadeIn>
      ) : null}
      {sizes ? (
        <>
          <View style={styles.product}>
            <View style={styles.band}>
              <Ionicons name="shirt" size={28} color="#FFFFFF" />
            </View>
            <View style={styles.productBody}>
              <Text style={styles.title}>Home jersey</Text>
              <View style={styles.pill}><Text style={styles.pillText}>Size M</Text></View>
              <Text style={styles.price}>{JERSEY_PRICE}</Text>
              <View style={styles.stockRow}>
                <Ionicons name="cube-outline" size={16} color="#4B5563" accessibilityElementsHidden />
                <Text style={styles.muted}>{soldOut ? 'Sold out' : `${sizes.M.stock} in stock`}</Text>
              </View>
              <Button label={soldOut ? 'Sold out' : 'Pay'} color="#0B6E4F" disabled={soldOut} loading={paying} onPress={() => void pay()} />
            </View>
          </View>
          <Card>
            <Ionicons name="shirt-outline" size={22} color="#4B5563" />
            <Text style={styles.secondaryTitle}>Home jersey</Text>
            <View style={styles.pillMuted}><Text style={styles.pillMutedText}>Size L</Text></View>
            <Text style={styles.secondaryPrice}>{JERSEY_PRICE}</Text>
            <Text style={styles.muted}>{sizes.L.stock === 0 ? 'Sold out' : `${sizes.L.stock} in stock`}</Text>
          </Card>
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  product: {
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: '#FFFFFF',
  },
  band: { height: 72, backgroundColor: '#0B6E4F', alignItems: 'center', justifyContent: 'center' },
  productBody: { padding: spacing.md, gap: spacing.sm },
  title: { fontSize: 20, fontWeight: '800', color: colors.text },
  secondaryTitle: { fontSize: 16, fontWeight: '700', color: colors.text },
  pill: { alignSelf: 'flex-start', borderRadius: 999, backgroundColor: '#E8F5E9', paddingHorizontal: 10, paddingVertical: 4 },
  pillText: { color: '#0B6E4F', fontWeight: '700', fontSize: 13 },
  pillMuted: { alignSelf: 'flex-start', borderRadius: 999, backgroundColor: '#F3F4F6', paddingHorizontal: 10, paddingVertical: 4 },
  pillMutedText: { color: '#4B5563', fontWeight: '700', fontSize: 13 },
  price: { fontSize: 18, fontWeight: '800', color: colors.text },
  secondaryPrice: { fontSize: 16, fontWeight: '700', color: colors.text },
  muted: { fontSize: 15, color: colors.muted },
  stockRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  error: { fontSize: 15, color: colors.danger },
  receipt: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#047857',
    borderStyle: 'dashed',
    padding: spacing.md,
    gap: 4,
  },
  perforation: { flexDirection: 'row', justifyContent: 'space-between', marginHorizontal: -6, marginBottom: spacing.sm },
  notch: { width: 12, height: 6, borderBottomLeftRadius: 6, borderBottomRightRadius: 6, backgroundColor: '#E5E7EB' },
  receiptId: { fontSize: 15, color: colors.text },
  paid: { fontSize: 16, fontWeight: '800', color: '#047857' },
  receiptPrice: { fontSize: 22, fontWeight: '800', color: colors.text },
});