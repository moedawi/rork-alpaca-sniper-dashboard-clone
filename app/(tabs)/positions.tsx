import React, { useMemo, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Dimensions,
  RefreshControl,
  ActivityIndicator,
  TouchableOpacity,
  Alert,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import Svg, {
  Path,
  Polyline,
  Line,
  Circle,
  Defs,
  LinearGradient as SvgLinearGradient,
  Stop,
} from 'react-native-svg';
import { Briefcase, X } from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import { formatDollar, formatScaledDollar } from '@/lib/formatters';
import { useBotCommand } from '@/hooks/useBotCommand';
import EquityChart from '@/components/EquityChart';

const BG_TOP = '#0a0a1a';
const BG_BOT = '#0d1117';
const TEXT_PRIMARY = '#ffffff';
const TEXT_DIM = '#888899';
const TEAL = '#00d4aa';
const RED = '#ff4d4d';
const GOLD = '#FFD93D';
const ACCENT_GREEN = '#2EE89A';
const ACCENT_ORANGE = '#FF9F43';
const ACCENT_RED = '#FF6B6B';

const CARD_ACCENTS = [ACCENT_GREEN, ACCENT_ORANGE, TEAL, ACCENT_RED, GOLD] as const;

const { width: SCREEN_W } = Dimensions.get('window');
const SPARK_W = 72;
const SPARK_H = 32;

interface Position {
  id?: string | number;
  symbol: string;
  qty: number;
  entry_price: number;
  current_price: number;
  pnl_pct?: number;
  peak_price?: number;
}

interface Trade {
  id: number;
  symbol: string;
  side: string;
  qty: number;
  price: number;
  pnl: number;
  exit_reason?: string;
  created_at: string;
}

async function fetchPositions(): Promise<Position[]> {
  // open_positions is the bot's authoritative table (rebuilt every 30s).
  // Avoids the ghost-position drift that the event-driven `positions` table has.
  console.log('[Positions] Fetching from Supabase (open_positions)');
  const { data, error } = await supabase
    .from('open_positions')
    .select('*')
    .order('symbol', { ascending: true });
  if (error) {
    console.log('[Positions] Error:', error.message);
    throw new Error(error.message);
  }
  return (data ?? []) as Position[];
}

function buildSparkPaths(data: number[], w: number, h: number): { line: string; fill: string } {
  if (data.length < 2) return { line: '', fill: '' };
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pad = h * 0.12;
  const pts = data.map((v, i) => [
    (i / (data.length - 1)) * w,
    h - pad - ((v - min) / range) * (h - pad * 2),
  ] as [number, number]);
  const line = pts
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`)
    .join(' ');
  const fill = `${line} L${pts[pts.length - 1][0].toFixed(1)},${h} L${pts[0][0].toFixed(1)},${h} Z`;
  return { line, fill };
}

function generateMiniSpark(entry: number, current: number): number[] {
  const isUp = current >= entry;
  const steps = 10;
  return Array.from({ length: steps }, (_, i) => {
    const progress = i / (steps - 1);
    const noise = (Math.sin(i * 2.3 + entry * 0.01) * 0.3 + Math.cos(i * 1.7) * 0.2) * Math.abs(current - entry) * 0.4;
    return entry + (current - entry) * progress + noise;
  });
}

const CHART_H = 120;

function PnlChartInline({ data }: { data: { x: string; y: number }[] }) {
  const chartW = SCREEN_W - 32;
  const padding = { top: 12, bottom: 24, left: 8, right: 8 };
  const innerW = chartW - padding.left - padding.right;
  const innerH = CHART_H - padding.top - padding.bottom;

  const { points, zeroY, minY, maxY } = useMemo(() => {
    if (data.length === 0) return { points: '', zeroY: 0, minY: 0, maxY: 0 };
    const yVals = data.map((d) => d.y);
    const minVal = Math.min(...yVals, 0);
    const maxVal = Math.max(...yVals, 0);
    const range = maxVal - minVal || 1;
    const pts = data
      .map((d, i) => {
        const x = padding.left + (i / Math.max(data.length - 1, 1)) * innerW;
        const y = padding.top + innerH - ((d.y - minVal) / range) * innerH;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
    const zLine = padding.top + innerH - ((0 - minVal) / range) * innerH;
    return { points: pts, zeroY: zLine, minY: minVal, maxY: maxVal };
  }, [data, innerW, innerH, padding.left, padding.top]);

  const lastPoint = useMemo(() => {
    if (data.length === 0) return null;
    const yVals = data.map((d) => d.y);
    const minVal = Math.min(...yVals, 0);
    const maxVal = Math.max(...yVals, 0);
    const range = maxVal - minVal || 1;
    const last = data[data.length - 1];
    const x = padding.left + ((data.length - 1) / Math.max(data.length - 1, 1)) * innerW;
    const y = padding.top + innerH - ((last.y - minVal) / range) * innerH;
    return { x, y, value: last.y };
  }, [data, innerW, innerH, padding.left, padding.top]);

  const isPositive = (data[data.length - 1]?.y ?? 0) >= 0;
  const strokeColor = isPositive ? TEAL : RED;

  return (
    <Svg width={chartW} height={CHART_H}>
      <Defs>
        <SvgLinearGradient id="inlineChartGrad" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={strokeColor} stopOpacity="0.18" />
          <Stop offset="1" stopColor={strokeColor} stopOpacity="0" />
        </SvgLinearGradient>
      </Defs>
      <Line
        x1={padding.left}
        y1={zeroY}
        x2={chartW - padding.right}
        y2={zeroY}
        stroke="rgba(255,255,255,0.12)"
        strokeWidth={0.5}
        strokeDasharray="4,4"
      />
      <Polyline
        points={points}
        fill="none"
        stroke={strokeColor}
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {lastPoint && (
        <>
          <Circle cx={lastPoint.x} cy={lastPoint.y} r={3.5} fill={strokeColor} />
          <Circle cx={lastPoint.x} cy={lastPoint.y} r={7} fill={strokeColor} opacity={0.2} />
        </>
      )}
    </Svg>
  );
}

interface SellButtonProps {
  symbol: string;
  currentPrice: number;
  plPct: number;
  plDollars: number;
}

export function SellButton({ symbol, currentPrice, plPct, plDollars }: SellButtonProps) {
  const sendCmd = useBotCommand();
  const isPending = sendCmd.isPending;

  const handlePress = () => {
    if (isPending) return;
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
    const plSign = plDollars >= 0 ? '+' : '';
    Alert.alert(
      `Sell ${symbol}?`,
      `Force-close at market.\nPrice: $${currentPrice.toFixed(2)}\nP&L: ${plSign}${plPct.toFixed(2)}% (${plSign}$${Math.abs(plDollars).toFixed(2)})`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sell',
          style: 'destructive',
          onPress: () => {
            if (Platform.OS !== 'web') {
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            }
            sendCmd.mutate(`SELL_${symbol}`);
          },
        },
      ],
    );
  };

  return (
    <TouchableOpacity
      style={[sellStyles.btn, isPending && sellStyles.btnPending]}
      onPress={handlePress}
      disabled={isPending}
      activeOpacity={0.7}
    >
      {isPending ? (
        <>
          <ActivityIndicator size="small" color="#FF6B6B" />
          <Text style={sellStyles.btnText}>SENDING...</Text>
        </>
      ) : (
        <>
          <X size={14} color="#FF6B6B" strokeWidth={2.4} />
          <Text style={sellStyles.btnText}>SELL {symbol}</Text>
        </>
      )}
    </TouchableOpacity>
  );
}

const sellStyles = StyleSheet.create({
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 12,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: 'rgba(255,107,107,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,107,107,0.4)',
  },
  btnPending: {
    opacity: 0.6,
  },
  btnText: {
    color: '#FF6B6B',
    fontSize: 12,
    fontWeight: '700' as const,
    letterSpacing: 0.6,
  },
});

interface PositionCardProps {
  position: Position;
  index: number;
}

function PositionCard({ position, index }: PositionCardProps) {
  const { symbol, qty, entry_price, current_price, peak_price } = position;
  const accentColor = CARD_ACCENTS[index % CARD_ACCENTS.length];

  const entryNum = typeof entry_price === 'number' ? entry_price : parseFloat(String(entry_price)) || 0;
  const currentNum = typeof current_price === 'number' ? current_price : parseFloat(String(current_price)) || 0;
  const qtyNum = typeof qty === 'number' ? qty : parseFloat(String(qty)) || 0;

  const marketValue = qtyNum * currentNum;
  const costBasis = qtyNum * entryNum;
  const plDollars = marketValue - costBasis;
  const plPct = costBasis > 0 ? (plDollars / costBasis) * 100 : 0;
  const isProfit = plDollars >= 0;
  const plColor = isProfit ? TEAL : RED;

  const sparkData = useMemo(
    () => generateMiniSpark(entryNum, currentNum),
    [entryNum, currentNum]
  );

  const { line, fill } = buildSparkPaths(sparkData, SPARK_W, SPARK_H);
  const gid = `pg_${symbol}`;

  return (
    <View style={[
      cardStyles.card,
      {
        borderLeftWidth: 3,
        borderLeftColor: accentColor + 'BB',
        shadowColor: accentColor,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.3,
        shadowRadius: 12,
        elevation: 5,
      },
    ]}>
      <View style={cardStyles.topRow}>
        <View style={cardStyles.topLeft}>
          <Text style={cardStyles.symbol}>{symbol}</Text>
          <Text style={cardStyles.sub}>
            {qtyNum} shares @ ${entryNum.toFixed(2)}
          </Text>
          {peak_price != null && (
            <Text style={cardStyles.peak}>
              Peak: ${(typeof peak_price === 'number' ? peak_price : parseFloat(String(peak_price))).toFixed(2)}
            </Text>
          )}
        </View>
        <View style={cardStyles.topRight}>
          <Svg width={SPARK_W} height={SPARK_H}>
            <Defs>
              <SvgLinearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={plColor} stopOpacity="0.3" />
                <Stop offset="1" stopColor={plColor} stopOpacity="0" />
              </SvgLinearGradient>
            </Defs>
            {fill ? <Path d={fill} fill={`url(#${gid})`} /> : null}
            {line ? (
              <Path
                d={line}
                stroke={plColor}
                strokeWidth={1.5}
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ) : null}
          </Svg>
        </View>
      </View>

      <View style={cardStyles.divider} />

      <View style={cardStyles.bottomRow}>
        <View style={cardStyles.bottomItem}>
          <Text style={cardStyles.itemLabel}>PRICE</Text>
          <Text style={cardStyles.itemValue}>${currentNum.toFixed(2)}</Text>
          <Text style={[cardStyles.itemPnl, { color: plDollars === 0 ? TEXT_DIM : plColor }]}>
            {plDollars >= 0 ? '+' : '-'}${Math.abs(plDollars).toFixed(2)} ({plPct >= 0 ? '+' : ''}{plPct.toFixed(2)}%)
          </Text>
        </View>
        <View style={cardStyles.bottomItem}>
          <Text style={cardStyles.itemLabel}>MKT VALUE</Text>
          <Text style={cardStyles.itemValue}>
            {formatScaledDollar(marketValue)}
          </Text>
        </View>
        <View style={cardStyles.bottomItem}>
          <Text style={cardStyles.itemLabel}>P&L</Text>
          <Text style={[cardStyles.itemValue, { color: plColor }]}>
            {isProfit ? '+' : '-'}{formatScaledDollar(plDollars)}
          </Text>
          <Text style={[cardStyles.itemSub, { color: plColor }]}>
            {isProfit ? '+' : ''}{plPct.toFixed(2)}%
          </Text>
        </View>
      </View>

      <SellButton
        symbol={symbol}
        currentPrice={currentNum}
        plPct={plPct}
        plDollars={plDollars}
      />
    </View>
  );
}

const cardStyles = StyleSheet.create({
  card: {
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(255,255,255,0.04)',
    padding: 16,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  topLeft: {
    flex: 1,
  },
  symbol: {
    color: TEXT_PRIMARY,
    fontSize: 22,
    fontWeight: '700' as const,
    letterSpacing: 0.5,
  },
  sub: {
    color: TEXT_DIM,
    fontSize: 12,
    marginTop: 3,
  },
  peak: {
    color: TEXT_DIM,
    fontSize: 11,
    marginTop: 2,
    opacity: 0.7,
  },
  topRight: {
    marginLeft: 12,
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.06)',
    marginBottom: 12,
  },
  bottomRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  bottomItem: {
    flex: 1,
    alignItems: 'center',
  },
  itemLabel: {
    color: TEXT_DIM,
    fontSize: 9,
    fontWeight: '600' as const,
    letterSpacing: 1.5,
    marginBottom: 4,
  },
  itemValue: {
    color: TEXT_PRIMARY,
    fontSize: 14,
    fontWeight: '600' as const,
  },
  itemSub: {
    fontSize: 11,
    fontWeight: '500' as const,
    marginTop: 2,
  },
  itemPnl: {
    fontSize: 11,
    fontWeight: '600' as const,
    marginTop: 3,
    letterSpacing: 0.1,
  },
});

export default function PositionsScreen() {
  const insets = useSafeAreaInsets();

  const queryClient = useQueryClient();

  const positionsQuery = useQuery({
    queryKey: ['positions'],
    queryFn: fetchPositions,
    refetchInterval: 30000,
  });

  const tradesQuery = useQuery<Trade[]>({
    queryKey: ['trades-chart'],
    queryFn: async () => {
      console.log('[Positions] Fetching trades for chart');
      const { data, error } = await supabase
        .from('trades')
        .select('*')
        .in('side', ['sell', 'partial'])
        .order('created_at', { ascending: true });
      if (error) {
        console.log('[Positions] Trades fetch error:', error.message);
        return [];
      }
      return (data ?? []) as Trade[];
    },
    refetchInterval: 30000,
  });

  useEffect(() => {
    console.log('[Positions] Setting up Supabase realtime subscriptions');
    const channel = supabase
      .channel('positions-realtime')
      .on(
        'postgres_changes' as const,
        { event: '*', schema: 'public', table: 'open_positions' },
        (payload) => {
          console.log('[Positions] Realtime open_positions change:', payload.eventType);
          void queryClient.invalidateQueries({ queryKey: ['positions'] });
        }
      )
      .on(
        'postgres_changes' as const,
        { event: '*', schema: 'public', table: 'trades' },
        (payload) => {
          console.log('[Positions] Realtime trades change:', payload.eventType);
          void queryClient.invalidateQueries({ queryKey: ['trades-chart'] });
        }
      )
      .subscribe((status) => {
        console.log('[Positions] Realtime channel status:', status);
      });

    return () => {
      console.log('[Positions] Removing realtime channel');
      void supabase.removeChannel(channel);
    };
  }, [queryClient]);

  const positions = positionsQuery.data ?? [];
  const hasPositions = positions.length > 0;

  const handleRefresh = useCallback(() => {
    void positionsQuery.refetch();
  }, [positionsQuery]);

  const summary = useMemo(() => {
    if (positions.length === 0) return { totalValue: 0, dayPl: 0, dayPlPct: 0 };
    let totalValue = 0;
    let totalCost = 0;
    for (const p of positions) {
      const qty = typeof p.qty === 'number' ? p.qty : parseFloat(String(p.qty)) || 0;
      const current = typeof p.current_price === 'number' ? p.current_price : parseFloat(String(p.current_price)) || 0;
      const entry = typeof p.entry_price === 'number' ? p.entry_price : parseFloat(String(p.entry_price)) || 0;
      totalValue += qty * current;
      totalCost += qty * entry;
    }
    const dayPl = totalValue - totalCost;
    const dayPlPct = totalCost > 0 ? (dayPl / totalCost) * 100 : 0;
    return { totalValue, dayPl, dayPlPct };
  }, [positions]);

  const plColor = summary.dayPl >= 0 ? TEAL : RED;

  const chartData = useMemo(() => {
    const trades = tradesQuery.data ?? [];
    let cumulative = 0;
    return trades.map((t) => {
      cumulative += typeof t.pnl === 'number' ? t.pnl : parseFloat(String(t.pnl)) || 0;
      return { x: t.created_at, y: cumulative };
    });
  }, [tradesQuery.data]);

  return (
    <LinearGradient colors={[BG_TOP, BG_BOT]} style={styles.gradient}>
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <Text style={styles.headerLabel}>POSITIONS</Text>
          <Text style={styles.headerCount}>
            {positionsQuery.isLoading ? '—' : `${positions.length} open`}
          </Text>
        </View>

        <EquityChart compact />

        <ScrollView
          style={styles.scroll}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingTop: 8, paddingBottom: 20 }}
          refreshControl={
            <RefreshControl
              refreshing={positionsQuery.isFetching && !positionsQuery.isLoading}
              onRefresh={handleRefresh}
              tintColor={TEAL}
            />
          }
        >
          {positionsQuery.isLoading ? (
            <View style={styles.loadingWrap}>
              <ActivityIndicator color={TEAL} size="large" />
            </View>
          ) : !hasPositions ? (
            // Treat genuine errors and empty results identically — an empty
            // open_positions table after-hours is the normal case, not a failure.
            <View style={styles.emptyCard}>
              <Briefcase size={36} color={TEXT_DIM} strokeWidth={1} />
              <Text style={styles.emptyTitle}>No open positions</Text>
              <Text style={styles.emptySub}>
                {positionsQuery.isError
                  ? 'Pull down to retry'
                  : 'Your positions will appear here once you place trades'}
              </Text>
            </View>
          ) : (
            positions.map((pos, i) => (
              <PositionCard key={pos.id ?? pos.symbol} position={pos} index={i} />
            ))
          )}
        </ScrollView>

        {hasPositions && (
          <View style={[styles.summaryBar, { paddingBottom: insets.bottom + 8 }]}>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryLabel}>TOTAL VALUE</Text>
              <Text style={styles.summaryValue}>
                {formatScaledDollar(summary.totalValue)}
              </Text>
            </View>
            <View style={styles.summarySep} />
            <View style={styles.summaryItem}>
              <Text style={styles.summaryLabel}>DAY P&L</Text>
              <Text style={[styles.summaryValue, { color: plColor }]}>
                {summary.dayPl >= 0 ? '+' : '-'}{formatScaledDollar(summary.dayPl)}{' '}
                <Text style={[styles.summaryPct, { color: plColor }]}>
                  ({summary.dayPlPct >= 0 ? '+' : ''}{summary.dayPlPct.toFixed(2)}%)
                </Text>
              </Text>
            </View>
          </View>
        )}
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  gradient: {
    flex: 1,
  },
  container: {
    flex: 1,
  },

  header: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 6,
  },
  headerLabel: {
    color: GOLD,
    fontSize: 16,
    fontWeight: '800' as const,
    letterSpacing: 1.1,
    opacity: 0.9,
  },
  headerCount: {
    color: TEXT_DIM,
    fontSize: 10,
    letterSpacing: 0.4,
  },

  scroll: {
    flex: 1,
  },

  loadingWrap: {
    paddingTop: 60,
    alignItems: 'center',
  },

  emptyCard: {
    marginHorizontal: 16,
    marginTop: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(255,255,255,0.04)',
    paddingVertical: 48,
    paddingHorizontal: 24,
    alignItems: 'center',
    gap: 12,
  },
  emptyTitle: {
    color: TEXT_PRIMARY,
    fontSize: 16,
    fontWeight: '600' as const,
    letterSpacing: 0.3,
  },
  emptySub: {
    color: TEXT_DIM,
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 18,
    letterSpacing: 0.2,
  },

  summaryBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(10,10,26,0.97)',
    shadowColor: TEAL,
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
  },
  summaryItem: {
    flex: 1,
  },
  summaryLabel: {
    color: GOLD,
    fontSize: 9,
    fontWeight: '600' as const,
    letterSpacing: 2,
    marginBottom: 4,
    opacity: 0.65,
  },
  summaryValue: {
    color: TEXT_PRIMARY,
    fontSize: 16,
    fontWeight: '600' as const,
    letterSpacing: 0.3,
  },
  summaryPct: {
    fontSize: 12,
    fontWeight: '500' as const,
  },
  summarySep: {
    width: 1,
    height: 36,
    backgroundColor: 'rgba(255,255,255,0.08)',
    marginHorizontal: 20,
  },
  chartWrap: {
    marginHorizontal: 16,
    marginBottom: 4,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
    backgroundColor: 'rgba(255,255,255,0.03)',
    paddingTop: 10,
    paddingBottom: 4,
    overflow: 'hidden' as const,
  },
  chartTitle: {
    color: TEXT_DIM,
    fontSize: 9,
    fontWeight: '600' as const,
    letterSpacing: 1.8,
    marginLeft: 12,
    marginBottom: 4,
  },
});
