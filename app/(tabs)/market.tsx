import React, { useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  TouchableOpacity,
  Dimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import { TrendingUp, TrendingDown, Activity, RefreshCw, AlertCircle, Zap } from 'lucide-react-native';
import { supabase } from '@/lib/supabase';

const BG_TOP = '#0a0a1a';
const BG_BOT = '#0d1117';
const TEXT_PRIMARY = '#ffffff';
const TEXT_DIM = '#888899';
const TEAL = '#00d4aa';
const ACCENT_GREEN = '#2EE89A';
const ACCENT_RED = '#FF6B6B';
const ACCENT_ORANGE = '#FF9F43';
const ACCENT_GREY = '#555566';
const GOLD = '#FFD93D';

const { width: SCREEN_W } = Dimensions.get('window');

interface MarketMover {
  symbol: string;
  price: number;
  change_pct: number;
  volume: number;
  rsi: number | null;
  adx: number | null;
  signal: string | null;
  updated_at: string | null;
}

async function fetchMarketMovers(): Promise<MarketMover[]> {
  const { data, error } = await supabase
    .from('market_movers')
    .select('symbol, price, change_pct, volume, rsi, adx, signal, updated_at')
    .order('change_pct', { ascending: false })
    .limit(10);

  if (error) throw new Error(error.message);
  return (data ?? []) as MarketMover[];
}

function formatVolume(vol: number): string {
  if (vol >= 1_000_000) return `${(vol / 1_000_000).toFixed(1)}M`;
  if (vol >= 1_000) return `${(vol / 1_000).toFixed(0)}K`;
  return String(vol);
}

function formatUpdatedAt(ts: string | null): string {
  if (!ts) return '';
  try {
    const d = new Date(ts);
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(d) + ' ET';
  } catch {
    return '';
  }
}

type SignalType = 'BUY' | 'HOT' | 'WAIT' | null;

function parseSignal(signal: string | null): SignalType {
  if (!signal) return null;
  const s = signal.toUpperCase().trim();
  if (s === 'BUY') return 'BUY';
  if (s === 'HOT') return 'HOT';
  if (s === 'WAIT') return 'WAIT';
  return null;
}

function SignalBadge({ signal }: { signal: string | null }) {
  const type = parseSignal(signal);
  if (!type) return null;

  const config: Record<NonNullable<SignalType>, { bg: string; border: string; color: string; icon: React.ReactNode }> = {
    BUY: {
      bg: 'rgba(46,232,154,0.12)',
      border: 'rgba(46,232,154,0.35)',
      color: ACCENT_GREEN,
      icon: <TrendingUp size={9} color={ACCENT_GREEN} strokeWidth={2.5} />,
    },
    HOT: {
      bg: 'rgba(255,159,67,0.12)',
      border: 'rgba(255,159,67,0.35)',
      color: ACCENT_ORANGE,
      icon: <Zap size={9} color={ACCENT_ORANGE} strokeWidth={2.5} />,
    },
    WAIT: {
      bg: 'rgba(85,85,102,0.18)',
      border: 'rgba(85,85,102,0.35)',
      color: ACCENT_GREY,
      icon: <Activity size={9} color={ACCENT_GREY} strokeWidth={2.5} />,
    },
  };

  const c = config[type];
  return (
    <View style={[signalStyles.badge, { backgroundColor: c.bg, borderColor: c.border }]}>
      {c.icon}
      <Text style={[signalStyles.text, { color: c.color }]}>{type}</Text>
    </View>
  );
}

const signalStyles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
  },
  text: {
    fontSize: 9,
    fontWeight: '800' as const,
    letterSpacing: 0.8,
  },
});

function RsiBar({ rsi }: { rsi: number | null }) {
  if (rsi === null || rsi === undefined) return null;

  const clamped = Math.min(100, Math.max(0, rsi));
  const color = rsi >= 70 ? ACCENT_RED : rsi <= 30 ? ACCENT_GREEN : GOLD;
  const label = rsi >= 70 ? 'OB' : rsi <= 30 ? 'OS' : 'N';

  return (
    <View style={rsiStyles.wrap}>
      <View style={rsiStyles.track}>
        <View style={[rsiStyles.fill, { width: `${clamped}%` as any, backgroundColor: color }]} />
        {/* Overbought/Oversold lines */}
        <View style={[rsiStyles.marker, { left: '30%' as any }]} />
        <View style={[rsiStyles.marker, { left: '70%' as any }]} />
      </View>
      <Text style={[rsiStyles.value, { color }]}>
        RSI {rsi.toFixed(0)}
        <Text style={rsiStyles.label}> {label}</Text>
      </Text>
    </View>
  );
}

const rsiStyles = StyleSheet.create({
  wrap: {
    gap: 3,
    marginTop: 2,
  },
  track: {
    height: 3,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 2,
    overflow: 'hidden',
    position: 'relative',
  },
  fill: {
    position: 'absolute',
    top: 0,
    left: 0,
    bottom: 0,
    borderRadius: 2,
    opacity: 0.85,
  },
  marker: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  value: {
    fontSize: 9,
    fontWeight: '700' as const,
    letterSpacing: 0.3,
  },
  label: {
    fontSize: 8,
    fontWeight: '600' as const,
    opacity: 0.7,
  },
});

interface RowProps {
  item: MarketMover;
  rank: number;
}

function StockRow({ item, rank }: RowProps) {
  const price = item.price ?? 0;
  const changePct = item.change_pct ?? 0;
  const isPositive = changePct >= 0;
  const pnlColor = isPositive ? ACCENT_GREEN : ACCENT_RED;
  const borderLeft = isPositive ? ACCENT_GREEN : ACCENT_RED;

  return (
    <View style={[rowStyles.row, { borderLeftColor: borderLeft + '99' }]}>
      <View style={rowStyles.rankWrap}>
        <Text style={rowStyles.rank}>{rank}</Text>
      </View>

      <View style={rowStyles.left}>
        <View style={rowStyles.symbolRow}>
          <Text style={rowStyles.symbol}>{item.symbol}</Text>
          <SignalBadge signal={item.signal} />
        </View>
        <RsiBar rsi={item.rsi} />
      </View>

      <View style={rowStyles.right}>
        <Text style={rowStyles.price}>${price.toFixed(2)}</Text>
        <View style={[rowStyles.changePill, { backgroundColor: pnlColor + '18' }]}>
          {isPositive
            ? <TrendingUp size={10} color={pnlColor} strokeWidth={2.5} />
            : <TrendingDown size={10} color={pnlColor} strokeWidth={2.5} />
          }
          <Text style={[rowStyles.changePct, { color: pnlColor }]}>
            {isPositive ? '+' : ''}{changePct.toFixed(2)}%
          </Text>
        </View>
      </View>
    </View>
  );
}

const rowStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginHorizontal: 16,
    marginBottom: 8,
    backgroundColor: 'rgba(255,255,255,0.035)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
    borderLeftWidth: 3,
    gap: 10,
  },
  rankWrap: {
    width: 22,
    alignItems: 'center',
  },
  rank: {
    color: TEXT_DIM,
    fontSize: 11,
    fontWeight: '600' as const,
    opacity: 0.6,
  },
  left: {
    flex: 1,
    gap: 4,
  },
  symbolRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  symbol: {
    color: TEXT_PRIMARY,
    fontSize: 17,
    fontWeight: '800' as const,
    letterSpacing: 0.5,
  },
  right: {
    alignItems: 'flex-end',
    gap: 6,
  },
  price: {
    color: TEXT_PRIMARY,
    fontSize: 16,
    fontWeight: '600' as const,
    letterSpacing: 0.2,
  },
  changePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  changePct: {
    fontSize: 13,
    fontWeight: '800' as const,
    letterSpacing: 0.3,
  },
});

export default function MarketScreen() {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const query = useQuery({
    queryKey: ['market-movers'],
    queryFn: fetchMarketMovers,
    refetchInterval: 30000,
  });

  // Realtime subscription — invalidate query on any change
  useEffect(() => {
    const channel = supabase
      .channel('market_movers_realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'market_movers' },
        () => {
          void queryClient.invalidateQueries({ queryKey: ['market-movers'] });
        }
      )
      .subscribe();

    channelRef.current = channel;
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [queryClient]);

  const movers = query.data ?? [];

  const lastUpdated =
    movers.length > 0 ? formatUpdatedAt(movers[0].updated_at) : '';

  const handleRefresh = useCallback(() => {
    void query.refetch();
  }, [query]);

  const buys = movers.filter(m => parseSignal(m.signal) === 'BUY').length;
  const hot = movers.filter(m => parseSignal(m.signal) === 'HOT').length;

  return (
    <LinearGradient colors={[BG_TOP, BG_BOT]} style={styles.gradient}>
      <View style={[styles.container, { paddingTop: insets.top }]}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Text style={styles.headerTitle}>MARKET MOVERS</Text>
            <Text style={styles.headerSub}>Top 10 · Sorted by Gain</Text>
          </View>
          <View style={styles.headerRight}>
            {lastUpdated ? (
              <View style={styles.updatedWrap}>
                <RefreshCw size={10} color={TEAL} strokeWidth={2} />
                <Text style={styles.updatedText}>{lastUpdated}</Text>
              </View>
            ) : null}
            {query.isFetching && !query.isLoading && (
              <ActivityIndicator color={TEAL} size="small" style={{ marginTop: 4 }} />
            )}
          </View>
        </View>

        {/* Signal summary pills */}
        {movers.length > 0 && (
          <View style={styles.summaryRow}>
            <View style={[styles.summaryPill, { borderColor: 'rgba(46,232,154,0.3)', backgroundColor: 'rgba(46,232,154,0.08)' }]}>
              <TrendingUp size={10} color={ACCENT_GREEN} strokeWidth={2.5} />
              <Text style={[styles.summaryText, { color: ACCENT_GREEN }]}>{buys} BUY</Text>
            </View>
            <View style={[styles.summaryPill, { borderColor: 'rgba(255,159,67,0.3)', backgroundColor: 'rgba(255,159,67,0.08)' }]}>
              <Zap size={10} color={ACCENT_ORANGE} strokeWidth={2.5} />
              <Text style={[styles.summaryText, { color: ACCENT_ORANGE }]}>{hot} HOT</Text>
            </View>
            <View style={[styles.summaryPill, { borderColor: 'rgba(85,85,102,0.3)', backgroundColor: 'rgba(85,85,102,0.08)' }]}>
              <Activity size={10} color={ACCENT_GREY} strokeWidth={2.5} />
              <Text style={[styles.summaryText, { color: ACCENT_GREY }]}>{movers.length - buys - hot} WAIT</Text>
            </View>
          </View>
        )}

        {/* Column headers */}
        <View style={styles.colHeader}>
          <Text style={[styles.colLabel, { width: 22, marginLeft: 16, textAlign: 'center' }]}>#</Text>
          <Text style={[styles.colLabel, { flex: 1, marginLeft: 10 }]}>SYMBOL · RSI</Text>
          <Text style={[styles.colLabel, { marginRight: 16, textAlign: 'right' }]}>PRICE · CHANGE</Text>
        </View>

        <ScrollView
          style={styles.scroll}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingTop: 4, paddingBottom: insets.bottom + 24 }}
          refreshControl={
            <RefreshControl
              refreshing={query.isFetching && !query.isLoading}
              onRefresh={handleRefresh}
              tintColor={TEAL}
            />
          }
        >
          {query.isLoading ? (
            <View style={styles.centerState}>
              <ActivityIndicator color={TEAL} size="large" />
              <Text style={styles.stateText}>Loading market data…</Text>
            </View>
          ) : query.isError ? (
            <View style={styles.centerState}>
              <AlertCircle size={36} color={ACCENT_RED} strokeWidth={1} />
              <Text style={styles.stateTitle}>Failed to load</Text>
              <Text style={styles.stateText}>
                {query.error instanceof Error ? query.error.message : 'Unknown error'}
              </Text>
              <TouchableOpacity style={styles.retryBtn} onPress={handleRefresh} activeOpacity={0.75}>
                <Text style={styles.retryText}>Retry</Text>
              </TouchableOpacity>
            </View>
          ) : movers.length === 0 ? (
            <View style={styles.centerState}>
              <TrendingUp size={44} color={TEXT_DIM} strokeWidth={1} style={{ opacity: 0.4 }} />
              <Text style={styles.stateTitle}>No movers yet</Text>
              <Text style={styles.stateText}>
                The bot hasn't pushed any data to market_movers yet.{'\n'}Pull down to refresh or wait for the next cycle.
              </Text>
            </View>
          ) : (
            movers.map((item, i) => (
              <StockRow key={item.symbol} item={item} rank={i + 1} />
            ))
          )}
        </ScrollView>
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  gradient: { flex: 1 },
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 6,
  },
  headerLeft: { gap: 2 },
  headerTitle: {
    color: GOLD,
    fontSize: 16,
    fontWeight: '800' as const,
    letterSpacing: 1.1,
  },
  headerSub: {
    color: TEXT_DIM,
    fontSize: 10,
    letterSpacing: 0.3,
  },
  headerRight: {
    alignItems: 'flex-end',
    gap: 3,
  },
  updatedWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0,212,170,0.08)',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: 'rgba(0,212,170,0.2)',
  },
  updatedText: {
    color: TEAL,
    fontSize: 9,
    fontWeight: '600' as const,
    letterSpacing: 0.3,
  },
  summaryRow: {
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  summaryPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 7,
    borderWidth: 1,
  },
  summaryText: {
    fontSize: 9,
    fontWeight: '700' as const,
    letterSpacing: 0.4,
  },
  colHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
    marginBottom: 4,
  },
  colLabel: {
    color: TEXT_DIM,
    fontSize: 9,
    fontWeight: '700' as const,
    letterSpacing: 1.5,
  },
  scroll: { flex: 1 },
  centerState: {
    paddingTop: 60,
    alignItems: 'center',
    paddingHorizontal: 32,
    gap: 12,
  },
  stateTitle: {
    color: TEXT_PRIMARY,
    fontSize: 16,
    fontWeight: '600' as const,
    letterSpacing: 0.3,
  },
  stateText: {
    color: TEXT_DIM,
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 20,
    letterSpacing: 0.2,
  },
  retryBtn: {
    marginTop: 8,
    paddingHorizontal: 24,
    paddingVertical: 10,
    backgroundColor: 'rgba(0,212,170,0.12)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(0,212,170,0.3)',
  },
  retryText: {
    color: TEAL,
    fontSize: 13,
    fontWeight: '700' as const,
    letterSpacing: 0.5,
  },
});
