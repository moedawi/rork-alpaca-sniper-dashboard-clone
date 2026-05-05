import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { ChevronLeft, ArrowDownRight, ArrowUpRight } from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import { computeFifoTrades, EnrichedTrade } from '@/lib/pnl';

const BG_TOP = '#0a0a1a';
const BG_BOT = '#0d1117';
const TEXT_PRIMARY = '#ffffff';
const TEXT_DIM = '#888899';
const ACCENT_GREEN = '#2EE89A';
const ACCENT_RED = '#FF6B6B';
const TEAL = '#00d4aa';

export function useTradesBySymbol(symbol: string) {
  const [trades, setTrades] = useState<EnrichedTrade[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  const load = useCallback(async () => {
    console.log('[TickerDetail] Fetching trades for', symbol);
    const { data, error } = await supabase
      .from('trades')
      .select('*')
      .eq('symbol', symbol)
      .order('created_at', { ascending: true });
    if (error) {
      console.log('[TickerDetail] fetch error', error.message);
      setTrades([]);
    } else {
      const enriched = computeFifoTrades((data ?? []) as Parameters<typeof computeFifoTrades>[0]);
      setTrades([...enriched].reverse());
    }
    setLoading(false);
  }, [symbol]);

  useEffect(() => {
    void load();
    const channel = supabase
      .channel(`ticker-detail-${symbol}`)
      .on(
        'postgres_changes' as const,
        { event: '*', schema: 'public', table: 'trades', filter: `symbol=eq.${symbol}` },
        () => {
          console.log('[TickerDetail] Realtime update for', symbol);
          void load();
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [symbol, load]);

  return { trades, loading };
}

export default function TickerDetailScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { symbol } = useLocalSearchParams<{ symbol: string }>();
  const sym = (symbol ?? '').toString().toUpperCase();
  const { trades, loading } = useTradesBySymbol(sym);

  const totalPnl = useMemo(() => {
    return trades.reduce((sum, t) => sum + (t.is_closed ? t.pnl_dollar : 0), 0);
  }, [trades]);

  const isPos = totalPnl >= 0;

  const renderItem = useCallback(
    ({ item }: { item: EnrichedTrade }) => {
      const pnl = item.pnl_dollar;
      const pos = pnl >= 0;
      const d = new Date(item.created_at);
      const dateStr = d.toLocaleDateString(undefined, {
        month: 'short',
        day: '2-digit',
      });
      const timeStr = d.toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
      });
      const isEntry = !item.is_closed;

      return (
        <View style={styles.row} testID={`trade-row-${item.id}`}>
          <View style={styles.rowIconWrap}>
            {isEntry ? (
              <ArrowDownRight size={16} color={TEAL} />
            ) : (
              <ArrowUpRight size={16} color={pos ? ACCENT_GREEN : ACCENT_RED} />
            )}
          </View>
          <View style={styles.rowMid}>
            <Text style={styles.rowTitle}>
              {isEntry ? 'ENTRY' : 'EXIT'} · {item.qty} sh
            </Text>
            <Text style={styles.rowSub}>
              {dateStr} · {timeStr}
            </Text>
          </View>
          <View style={styles.rowRight}>
            <Text style={styles.rowPrice}>${Number(item.price).toFixed(2)}</Text>
            {!isEntry && (
              <Text
                style={[
                  styles.rowPnl,
                  { color: pos ? ACCENT_GREEN : ACCENT_RED },
                ]}
              >
                {pos ? '+' : ''}${pnl.toFixed(2)} ({pos ? '+' : ''}
                {item.pnl_pct.toFixed(2)}%)
              </Text>
            )}
          </View>
        </View>
      );
    },
    [],
  );

  return (
    <LinearGradient colors={[BG_TOP, BG_BOT]} style={styles.gradient}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => router.back()}
            hitSlop={12}
            testID="ticker-back-btn"
          >
            <ChevronLeft size={26} color={TEXT_PRIMARY} />
          </TouchableOpacity>
          <View style={{ flex: 1 }} />
        </View>

        <View style={styles.heroCard}>
          <Text style={styles.heroLabel}>TICKER</Text>
          <Text style={styles.heroSymbol}>{sym}</Text>
          <Text
            style={[
              styles.heroPnl,
              { color: isPos ? ACCENT_GREEN : ACCENT_RED },
            ]}
          >
            {isPos ? '+' : ''}${totalPnl.toFixed(2)}
          </Text>
          <Text style={styles.heroSub}>Total realized P&L</Text>
        </View>

        <Text style={styles.sectionTitle}>All Entries & Exits</Text>

        {loading ? (
          <ActivityIndicator color={TEAL} style={{ marginTop: 30 }} />
        ) : trades.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No trades for {sym}</Text>
          </View>
        ) : (
          <FlatList
            data={trades}
            keyExtractor={(it) => String(it.id)}
            renderItem={renderItem}
            contentContainerStyle={{
              paddingHorizontal: 16,
              paddingBottom: insets.bottom + 20,
            }}
            ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
          />
        )}
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  gradient: { flex: 1 },
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  heroCard: {
    marginHorizontal: 16,
    marginTop: 4,
    marginBottom: 18,
    padding: 20,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
  },
  heroLabel: {
    color: TEXT_DIM,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.8,
  },
  heroSymbol: {
    color: TEXT_PRIMARY,
    fontSize: 36,
    fontWeight: '800',
    letterSpacing: 1,
    marginTop: 6,
  },
  heroPnl: {
    fontSize: 28,
    fontWeight: '700',
    marginTop: 10,
  },
  heroSub: {
    color: TEXT_DIM,
    fontSize: 12,
    marginTop: 2,
  },
  sectionTitle: {
    color: TEXT_PRIMARY,
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.4,
    marginHorizontal: 20,
    marginBottom: 10,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: 'rgba(255,255,255,0.035)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
    gap: 12,
  },
  rowIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  rowMid: { flex: 1, gap: 2 },
  rowTitle: {
    color: TEXT_PRIMARY,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  rowSub: { color: TEXT_DIM, fontSize: 11 },
  rowRight: { alignItems: 'flex-end', gap: 2 },
  rowPrice: {
    color: TEXT_PRIMARY,
    fontSize: 13,
    fontWeight: '600',
  },
  rowPnl: {
    fontSize: 11,
    fontWeight: '700',
  },
  empty: { alignItems: 'center', paddingVertical: 40 },
  emptyText: { color: TEXT_DIM, fontSize: 13 },
});
