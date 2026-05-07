import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Dimensions,
  ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { ChevronLeft, ArrowDownRight, ArrowUpRight } from 'lucide-react-native';
import Svg, { Rect, Line, Text as SvgText } from 'react-native-svg';
import { supabase } from '@/lib/supabase';
import { computeFifoTrades, EnrichedTrade } from '@/lib/pnl';

const BG_TOP = '#0a0a1a';
const BG_BOT = '#0d1117';
const TEXT_PRIMARY = '#ffffff';
const TEXT_DIM = '#888899';
const ACCENT_GREEN = '#2EE89A';
const ACCENT_RED = '#FF6B6B';
const TEAL = '#00d4aa';
const AMBER = '#F59E0B';
const CARD_BG = 'rgba(255,255,255,0.04)';
const CARD_BORDER = 'rgba(255,255,255,0.07)';

const SCREEN_W = Dimensions.get('window').width;
const CHART_W = SCREEN_W - 32;
const CHART_H = 200;
const CHART_PAD_TOP = 12;
const CHART_PAD_BOTTOM = 24;
const CHART_PAD_LEFT = 48;
const CHART_PAD_RIGHT = 8;
const PLOT_W = CHART_W - CHART_PAD_LEFT - CHART_PAD_RIGHT;
const PLOT_H = CHART_H - CHART_PAD_TOP - CHART_PAD_BOTTOM;

// ─── Timeframes ──────────────────────────────────────────────────────────────
interface Timeframe {
  label: string;
  interval: string;
  range: string;
}

const TIMEFRAMES: Timeframe[] = [
  { label: '1m',  interval: '1m',   range: '1d'  },
  { label: '5m',  interval: '5m',   range: '5d'  },
  { label: '15m', interval: '15m',  range: '60d' },
  { label: '30m', interval: '30m',  range: '60d' },
  { label: '1H',  interval: '60m',  range: '1mo' },
  { label: '4H',  interval: '60m',  range: '3mo' },
  { label: '1D',  interval: '1d',   range: '1y'  },
  { label: '1W',  interval: '1wk',  range: '5y'  },
  { label: '1M',  interval: '1mo',  range: 'max' },
];

// ─── Candle data ──────────────────────────────────────────────────────────────
interface Candle {
  t: number;   // timestamp ms
  o: number;
  h: number;
  l: number;
  c: number;
}

async function fetchCandles(symbol: string, interval: string, range: string): Promise<Candle[]> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}&includePrePost=false`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    if (!res.ok) return [];
    const json = await res.json();
    const result = json?.chart?.result?.[0];
    if (!result) return [];
    const timestamps: number[] = result.timestamp ?? [];
    const q = result.indicators?.quote?.[0];
    if (!q) return [];
    const { open, high, low, close } = q;
    const candles: Candle[] = [];
    for (let i = 0; i < timestamps.length; i++) {
      if (open[i] == null || high[i] == null || low[i] == null || close[i] == null) continue;
      candles.push({ t: timestamps[i] * 1000, o: open[i], h: high[i], l: low[i], c: close[i] });
    }
    return candles;
  } catch {
    return [];
  }
}

// ─── Candlestick Chart ────────────────────────────────────────────────────────
function CandlestickChart({ candles, loading }: { candles: Candle[]; loading: boolean }) {
  if (loading) {
    return (
      <View style={[chartStyles.wrap, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator color={AMBER} />
      </View>
    );
  }
  if (candles.length === 0) {
    return (
      <View style={[chartStyles.wrap, { justifyContent: 'center', alignItems: 'center' }]}>
        <Text style={{ color: TEXT_DIM, fontSize: 12 }}>No data available</Text>
      </View>
    );
  }

  // Limit to last N candles that fit
  const maxCandles = Math.floor(PLOT_W / 6);
  const visible = candles.length > maxCandles ? candles.slice(-maxCandles) : candles;

  const minPrice = Math.min(...visible.map((c) => c.l));
  const maxPrice = Math.max(...visible.map((c) => c.h));
  const priceRange = maxPrice - minPrice || 1;

  const toY = (price: number) =>
    CHART_PAD_TOP + PLOT_H - ((price - minPrice) / priceRange) * PLOT_H;

  const candleW = Math.max(2, Math.floor(PLOT_W / visible.length) - 1);
  const gap = Math.max(1, Math.floor(PLOT_W / visible.length) - candleW);
  const step = PLOT_W / visible.length;

  // Y-axis labels
  const yLabels = [0, 0.25, 0.5, 0.75, 1].map((f) => ({
    price: minPrice + f * priceRange,
    y: CHART_PAD_TOP + PLOT_H - f * PLOT_H,
  }));

  // Format price label
  const fmtPrice = (p: number) =>
    p >= 1000 ? `${(p / 1000).toFixed(1)}k` : p >= 10 ? p.toFixed(2) : p.toFixed(3);

  return (
    <View style={chartStyles.wrap}>
      <Svg width={CHART_W} height={CHART_H}>
        {/* Grid lines */}
        {yLabels.map(({ y }, i) => (
          <Line
            key={i}
            x1={CHART_PAD_LEFT}
            y1={y}
            x2={CHART_W - CHART_PAD_RIGHT}
            y2={y}
            stroke="rgba(255,255,255,0.06)"
            strokeWidth={1}
          />
        ))}

        {/* Y-axis labels */}
        {yLabels.map(({ price, y }, i) => (
          <SvgText
            key={i}
            x={CHART_PAD_LEFT - 4}
            y={y + 4}
            fill={TEXT_DIM}
            fontSize={9}
            textAnchor="end"
          >
            {fmtPrice(price)}
          </SvgText>
        ))}

        {/* Candles */}
        {visible.map((c, i) => {
          const x = CHART_PAD_LEFT + i * step + step / 2;
          const isGreen = c.c >= c.o;
          const color = isGreen ? ACCENT_GREEN : ACCENT_RED;
          const bodyTop = toY(Math.max(c.o, c.c));
          const bodyBot = toY(Math.min(c.o, c.c));
          const bodyH = Math.max(1, bodyBot - bodyTop);
          const wickTop = toY(c.h);
          const wickBot = toY(c.l);
          const halfW = Math.max(1, candleW / 2);

          return (
            <React.Fragment key={i}>
              {/* Wick */}
              <Line
                x1={x}
                y1={wickTop}
                x2={x}
                y2={wickBot}
                stroke={color}
                strokeWidth={1}
              />
              {/* Body */}
              <Rect
                x={x - halfW}
                y={bodyTop}
                width={candleW}
                height={bodyH}
                fill={isGreen ? color : color}
                opacity={0.9}
              />
            </React.Fragment>
          );
        })}
      </Svg>
    </View>
  );
}

const chartStyles = StyleSheet.create({
  wrap: {
    width: CHART_W,
    height: CHART_H,
    backgroundColor: CARD_BG,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    overflow: 'hidden',
  },
});

// ─── Ticker Chart with timeframe selector ────────────────────────────────────
function TickerChart({ symbol }: { symbol: string }) {
  const [tfIdx, setTfIdx] = useState(6); // default 1D
  const [candles, setCandles] = useState<Candle[]>([]);
  const [loading, setLoading] = useState(true);
  const tf = TIMEFRAMES[tfIdx];

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setCandles([]);
    fetchCandles(symbol, tf.interval, tf.range).then((data) => {
      if (!cancelled) {
        setCandles(data);
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [symbol, tf.interval, tf.range]);

  const lastCandle = candles[candles.length - 1];
  const firstCandle = candles[0];
  const priceChange = lastCandle && firstCandle
    ? ((lastCandle.c - firstCandle.o) / firstCandle.o) * 100
    : null;

  return (
    <View style={{ marginHorizontal: 16, marginBottom: 16 }}>
      {/* Price + change row */}
      {lastCandle && (
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
          <Text style={{ color: TEXT_PRIMARY, fontSize: 22, fontWeight: '700' }}>
            ${lastCandle.c.toFixed(lastCandle.c < 10 ? 3 : 2)}
          </Text>
          {priceChange !== null && (
            <Text style={{ color: priceChange >= 0 ? ACCENT_GREEN : ACCENT_RED, fontSize: 13, fontWeight: '600' }}>
              {priceChange >= 0 ? '+' : ''}{priceChange.toFixed(2)}%
            </Text>
          )}
        </View>
      )}

      {/* Chart */}
      <CandlestickChart candles={candles} loading={loading} />

      {/* Timeframe selector */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ marginTop: 10 }}
        contentContainerStyle={{ gap: 6, paddingHorizontal: 2 }}
      >
        {TIMEFRAMES.map((t, i) => {
          const active = i === tfIdx;
          return (
            <TouchableOpacity
              key={t.label}
              onPress={() => setTfIdx(i)}
              style={{
                paddingHorizontal: 12,
                paddingVertical: 5,
                borderRadius: 20,
                backgroundColor: active ? AMBER : 'rgba(255,255,255,0.06)',
                borderWidth: 1,
                borderColor: active ? AMBER : 'rgba(255,255,255,0.1)',
              }}
            >
              <Text style={{ color: active ? '#000' : TEXT_DIM, fontSize: 12, fontWeight: '600' }}>
                {t.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

// ─── Trade hook ───────────────────────────────────────────────────────────────
export function useTradesBySymbol(symbol: string) {
  const [trades, setTrades] = useState<EnrichedTrade[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('trades')
      .select('*')
      .eq('symbol', symbol)
      .order('created_at', { ascending: true });
    if (error) {
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
        () => void load(),
      )
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [symbol, load]);

  return { trades, loading };
}

// ─── Main screen ──────────────────────────────────────────────────────────────
export default function TickerDetailScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { symbol } = useLocalSearchParams<{ symbol: string }>();
  const sym = (symbol ?? '').toString().toUpperCase();
  const { trades, loading } = useTradesBySymbol(sym);

  const totalPnl = useMemo(
    () => trades.reduce((sum, t) => sum + (t.is_closed ? t.pnl_dollar : 0), 0),
    [trades],
  );
  const isPos = totalPnl >= 0;

  const renderItem = useCallback(({ item }: { item: EnrichedTrade }) => {
    const pnl = item.pnl_dollar;
    const pos = pnl >= 0;
    const d = new Date(item.created_at);
    const dateStr = d.toLocaleDateString(undefined, { month: 'short', day: '2-digit' });
    const timeStr = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    const isEntry = !item.is_closed;

    return (
      <View style={styles.row}>
        <View style={styles.rowIconWrap}>
          {isEntry
            ? <ArrowDownRight size={16} color={TEAL} />
            : <ArrowUpRight size={16} color={pos ? ACCENT_GREEN : ACCENT_RED} />}
        </View>
        <View style={styles.rowMid}>
          <Text style={styles.rowTitle}>{isEntry ? 'ENTRY' : 'EXIT'} · {item.qty} sh</Text>
          <Text style={styles.rowSub}>{dateStr} · {timeStr}</Text>
        </View>
        <View style={styles.rowRight}>
          <Text style={styles.rowPrice}>${Number(item.price).toFixed(2)}</Text>
          {!isEntry && (
            <Text style={[styles.rowPnl, { color: pos ? ACCENT_GREEN : ACCENT_RED }]}>
              {pos ? '+' : ''}${pnl.toFixed(2)} ({pos ? '+' : ''}{item.pnl_pct.toFixed(2)}%)
            </Text>
          )}
        </View>
      </View>
    );
  }, []);

  const ListHeader = useMemo(() => (
    <>
      {/* Chart */}
      <TickerChart symbol={sym} />

      {/* P&L summary */}
      <View style={styles.heroCard}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <View>
            <Text style={styles.heroLabel}>TOTAL REALIZED P&L</Text>
            <Text style={[styles.heroPnl, { color: isPos ? ACCENT_GREEN : ACCENT_RED }]}>
              {isPos ? '+' : ''}${totalPnl.toFixed(2)}
            </Text>
          </View>
          <Text style={styles.heroSymbol}>{sym}</Text>
        </View>
      </View>

      <Text style={styles.sectionTitle}>All Entries & Exits</Text>
    </>
  ), [sym, totalPnl, isPos]);

  return (
    <LinearGradient colors={[BG_TOP, BG_BOT]} style={styles.gradient}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.container, { paddingTop: insets.top }]}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
            <ChevronLeft size={26} color={TEXT_PRIMARY} />
          </TouchableOpacity>
          <Text style={styles.headerSym}>{sym}</Text>
          <View style={{ width: 26 }} />
        </View>

        {loading ? (
          <>
            {ListHeader}
            <ActivityIndicator color={TEAL} style={{ marginTop: 30 }} />
          </>
        ) : trades.length === 0 ? (
          <>
            {ListHeader}
            <View style={styles.empty}>
              <Text style={styles.emptyText}>No trades for {sym}</Text>
            </View>
          </>
        ) : (
          <FlatList
            data={trades}
            keyExtractor={(it) => String(it.id)}
            renderItem={renderItem}
            ListHeaderComponent={ListHeader}
            contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 20 }}
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
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 4,
  },
  headerSym: {
    color: TEXT_PRIMARY,
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: 1,
  },
  heroCard: {
    marginHorizontal: 16,
    marginBottom: 18,
    padding: 16,
    borderRadius: 16,
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: CARD_BORDER,
  },
  heroLabel: {
    color: TEXT_DIM,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.6,
    marginBottom: 4,
  },
  heroSymbol: {
    color: 'rgba(255,255,255,0.12)',
    fontSize: 40,
    fontWeight: '800',
    letterSpacing: 1,
  },
  heroPnl: {
    fontSize: 24,
    fontWeight: '700',
  },
  sectionTitle: {
    color: TEXT_PRIMARY,
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.4,
    marginHorizontal: 4,
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
  rowTitle: { color: TEXT_PRIMARY, fontSize: 13, fontWeight: '700', letterSpacing: 0.4 },
  rowSub: { color: TEXT_DIM, fontSize: 11 },
  rowRight: { alignItems: 'flex-end', gap: 2 },
  rowPrice: { color: TEXT_PRIMARY, fontSize: 13, fontWeight: '600' },
  rowPnl: { fontSize: 11, fontWeight: '700' },
  empty: { alignItems: 'center', paddingVertical: 40 },
  emptyText: { color: TEXT_DIM, fontSize: 13 },
});
