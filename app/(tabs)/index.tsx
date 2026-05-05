import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Dimensions,
  RefreshControl,
  ActivityIndicator,
  PanResponder,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Polyline, Line, Circle, Defs, LinearGradient as SvgGrad, Stop } from 'react-native-svg';
import {
  Activity,
  Trophy,
  ThumbsDown,
  ChevronRight,
  Briefcase,
} from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import PortfolioValue from '@/components/PortfolioValue';
import BotControlBar from '@/components/BotControlBar';
import EquityChart from '@/components/EquityChart';
import DailyBreakdown from '@/components/DailyBreakdown';
import { useTradeHistory } from '@/contexts/TradeHistoryContext';
import { computeFifoTrades, EnrichedTrade } from '@/lib/pnl';

const BG_TOP = '#0a0a1a';
const BG_BOT = '#0d1117';
const TEXT_PRIMARY = '#ffffff';
const TEXT_DIM = '#888899';
const TEAL = '#00d4aa';
const RED = '#ff4d4d';
const ACCENT_GREEN = '#2EE89A';
const ACCENT_RED = '#FF6B6B';
const GOLD = '#FFD93D';

const { width: SCREEN_W } = Dimensions.get('window');
const CHART_H = 280;

interface EquitySnapshot {
  id?: number;
  timestamp: string;
  equity: number;
  daily_pnl?: number;
}

interface SupabasePosition {
  id?: string | number;
  symbol: string;
  qty: number;
  entry_price: number;
  current_price: number;
  pnl_pct?: number;
  updated_at?: string;
}

interface SupabaseTrade {
  id: number;
  symbol: string;
  side: string;
  qty: number;
  price: number;
  pnl: number;
  created_at: string;
}

function PnlChartInline({ data }: { data: { x: string; y: number }[] }) {
  const chartW = SCREEN_W - 32;
  const padding = { top: 12, bottom: 24, left: 8, right: 8 };
  const innerW = chartW - padding.left - padding.right;
  const innerH = CHART_H - padding.top - padding.bottom;

  const [crosshair, setCrosshair] = useState<{ x: number; y: number; value: number; index: number } | null>(null);

  const baseline = data[0]?.y ?? 0;

  const pointsArr = useMemo(() => {
    if (data.length === 0) return [] as { x: number; y: number; value: number }[];
    const yVals = data.map((d) => d.y);
    const minVal = Math.min(...yVals, baseline);
    const maxVal = Math.max(...yVals, baseline);
    const range = maxVal - minVal || 1;
    return data.map((d, i) => {
      const x = padding.left + (i / Math.max(data.length - 1, 1)) * innerW;
      const y = padding.top + innerH - ((d.y - minVal) / range) * innerH;
      return { x, y, value: d.y };
    });
  }, [data, innerW, innerH, padding.left, padding.top, baseline]);

  const updateCrosshair = useCallback((locX: number) => {
    if (pointsArr.length === 0) return;
    const clamped = Math.max(padding.left, Math.min(locX, padding.left + innerW));
    const rel = (clamped - padding.left) / Math.max(innerW, 1);
    const idx = Math.round(rel * (pointsArr.length - 1));
    const p = pointsArr[Math.max(0, Math.min(idx, pointsArr.length - 1))];
    setCrosshair({ x: p.x, y: p.y, value: p.value, index: idx });
  }, [pointsArr, innerW, padding.left]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => updateCrosshair(e.nativeEvent.locationX),
      onPanResponderMove: (e) => updateCrosshair(e.nativeEvent.locationX),
      onPanResponderRelease: () => setCrosshair(null),
      onPanResponderTerminate: () => setCrosshair(null),
    })
  ).current;

  const { points, zeroY } = useMemo(() => {
    if (data.length === 0) return { points: '', zeroY: 0 };
    const yVals = data.map((d) => d.y);
    const minVal = Math.min(...yVals, baseline);
    const maxVal = Math.max(...yVals, baseline);
    const range = maxVal - minVal || 1;
    const pts = data
      .map((d, i) => {
        const x = padding.left + (i / Math.max(data.length - 1, 1)) * innerW;
        const y = padding.top + innerH - ((d.y - minVal) / range) * innerH;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
    const zLine = padding.top + innerH - ((baseline - minVal) / range) * innerH;
    return { points: pts, zeroY: zLine };
  }, [data, innerW, innerH, padding.left, padding.top, baseline]);

  const lastPoint = useMemo(() => {
    if (data.length === 0) return null;
    const yVals = data.map((d) => d.y);
    const minVal = Math.min(...yVals, baseline);
    const maxVal = Math.max(...yVals, baseline);
    const range = maxVal - minVal || 1;
    const last = data[data.length - 1];
    const x = padding.left + ((data.length - 1) / Math.max(data.length - 1, 1)) * innerW;
    const y = padding.top + innerH - ((last.y - minVal) / range) * innerH;
    return { x, y };
  }, [data, innerW, innerH, padding.left, padding.top, baseline]);

  const isPositive = (data[data.length - 1]?.y ?? 0) >= baseline;
  const strokeColor = isPositive ? TEAL : RED;

  const TOOLTIP_W = 96;
  const tooltipLeft = crosshair
    ? Math.max(4, Math.min(crosshair.x - TOOLTIP_W / 2, chartW - TOOLTIP_W - 4))
    : 0;

  return (
    <View style={{ width: chartW, height: CHART_H }} {...panResponder.panHandlers}>
      <Svg width={chartW} height={CHART_H}>
        <Defs>
          <SvgGrad id="dashChartGrad" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={strokeColor} stopOpacity="0.18" />
            <Stop offset="1" stopColor={strokeColor} stopOpacity="0" />
          </SvgGrad>
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
        {lastPoint && !crosshair && (
          <>
            <Circle cx={lastPoint.x} cy={lastPoint.y} r={3.5} fill={strokeColor} />
            <Circle cx={lastPoint.x} cy={lastPoint.y} r={7} fill={strokeColor} opacity={0.2} />
          </>
        )}
        {crosshair && (
          <>
            <Line
              x1={crosshair.x}
              y1={padding.top}
              x2={crosshair.x}
              y2={padding.top + innerH}
              stroke="rgba(255,255,255,0.35)"
              strokeWidth={1}
              strokeDasharray="3,3"
            />
            <Circle cx={crosshair.x} cy={crosshair.y} r={7} fill={strokeColor} opacity={0.2} />
            <Circle cx={crosshair.x} cy={crosshair.y} r={3.5} fill={strokeColor} />
          </>
        )}
      </Svg>
      {crosshair && (
        <View
          pointerEvents="none"
          style={[styles.tooltip, { left: tooltipLeft, width: TOOLTIP_W }]}
        >
          <Text style={styles.tooltipText}>
            ${crosshair.value.toFixed(2)}
          </Text>
        </View>
      )}
    </View>
  );
}

type HistoryTab = 'positions' | 'wins' | 'losses' | 'trades';

export default function DashboardScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { allTrades, winTrades, lossTrades, mergeSupabaseTrades } = useTradeHistory();

  const [activeTab, setActiveTab] = useState<HistoryTab>('positions');

  const latestSnapshotQuery = useQuery<EquitySnapshot | null>({
    queryKey: ['latest-equity-snapshot'],
    queryFn: async () => {
      console.log('[Dashboard] Fetching latest equity snapshot');
      const { data, error } = await supabase
        .from('equity_snapshots')
        .select('*')
        .order('timestamp', { ascending: false })
        .limit(1);
      if (error) {
        console.log('[Dashboard] Equity snapshot error:', error.message);
        return null;
      }
      if (!data || data.length === 0) return null;
      return data[0] as EquitySnapshot;
    },
    refetchInterval: 10000,
  });

  // Disabled: the bot writes equity to `equity_snapshots`, not a `portfolio` table.
  // The fallback below uses latestSnapshotQuery.data.equity, so this is a no-op.
  // Keeping the variable to avoid restructuring the value-derivation chain.
  const portfolioQuery = useQuery<{ net_liquidation_value: number } | null>({
    queryKey: ['portfolio-latest'],
    queryFn: async () => null,
    refetchInterval: false,
    staleTime: Infinity,
  });

  const positionsQuery = useQuery<SupabasePosition[]>({
    queryKey: ['dashboard-positions'],
    queryFn: async () => {
      // Reading open_positions (authoritative, rebuilt every 30s) instead of
      // the event-driven `positions` table that can have ghost rows.
      console.log('[Dashboard] Fetching open_positions');
      const { data, error } = await supabase
        .from('open_positions')
        .select('*')
        .order('symbol', { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as SupabasePosition[];
    },
    refetchInterval: 10000,
  });

  const allTradesQuery = useQuery<SupabaseTrade[]>({
    queryKey: ['supabase-trades-sync'],
    queryFn: async () => {
      console.log('[Dashboard] Fetching all trades');
      const { data, error } = await supabase
        .from('trades')
        .select('*')
        .order('created_at', { ascending: true });
      if (error) {
        console.log('[Dashboard] Trades fetch error:', error.message);
        return [];
      }
      return (data ?? []) as SupabaseTrade[];
    },
    refetchInterval: 10000,
  });

  const enrichedTrades: EnrichedTrade[] = useMemo(() => {
    return computeFifoTrades(allTradesQuery.data ?? []);
  }, [allTradesQuery.data]);

  const closedTrades = useMemo(
    () => enrichedTrades.filter((t) => t.is_closed),
    [enrichedTrades],
  );

  const wins = useMemo(
    () => [...closedTrades].filter((t) => t.pnl_dollar > 0).reverse(),
    [closedTrades],
  );
  const losses = useMemo(
    () => [...closedTrades].filter((t) => t.pnl_dollar < 0).reverse(),
    [closedTrades],
  );


  useEffect(() => {
    if (allTradesQuery.data && allTradesQuery.data.length > 0) {
      mergeSupabaseTrades(allTradesQuery.data as Record<string, unknown>[]);
    }
  }, [allTradesQuery.data, mergeSupabaseTrades]);

  useEffect(() => {
    const channel = supabase
      .channel('dashboard-realtime')
      .on('postgres_changes' as const, { event: '*', schema: 'public', table: 'open_positions' }, () => {
        console.log('[Dashboard] Realtime open_positions change');
        void queryClient.invalidateQueries({ queryKey: ['dashboard-positions'] });
      })
      .on('postgres_changes' as const, { event: '*', schema: 'public', table: 'trades' }, () => {
        console.log('[Dashboard] Realtime trades change');
        void queryClient.invalidateQueries({ queryKey: ['supabase-trades-sync'] });
      })
      .on('postgres_changes' as const, { event: '*', schema: 'public', table: 'equity_snapshots' }, () => {
        console.log('[Dashboard] Realtime equity snapshot change');
        void queryClient.invalidateQueries({ queryKey: ['latest-equity-snapshot'] });
      })
      .on('postgres_changes' as const, { event: '*', schema: 'public', table: 'portfolio' }, (payload) => {
        console.log('[Dashboard] Realtime portfolio change', payload.eventType);
        void queryClient.invalidateQueries({ queryKey: ['portfolio-latest'] });
      })
      .subscribe((status) => {
        console.log('[Dashboard] Realtime channel status:', status);
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [queryClient]);

  const portfolioValue =
    portfolioQuery.data?.net_liquidation_value ??
    latestSnapshotQuery.data?.equity ??
    1000;
  const positions = positionsQuery.data ?? [];
  const closedCount = wins.length + losses.length;

  const prevClose = useMemo<number>(() => {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const startMs = startOfToday.getTime();
    const cumPriorToToday = closedTrades
      .filter((t) => new Date(t.created_at).getTime() < startMs)
      .reduce((s, t) => s + t.pnl_dollar, 0);
    const cumToday = closedTrades
      .filter((t) => new Date(t.created_at).getTime() >= startMs)
      .reduce((s, t) => s + t.pnl_dollar, 0);
    return portfolioValue - cumToday;
  }, [closedTrades, portfolioValue]);

  const chartData = useMemo(() => {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const startMs = startOfToday.getTime();
    const todayTrades = closedTrades.filter(
      (t) => new Date(t.created_at).getTime() >= startMs,
    );
    const points: { x: string; y: number }[] = [
      { x: startOfToday.toISOString(), y: prevClose },
    ];
    let running = prevClose;
    for (const t of todayTrades) {
      running += t.pnl_dollar;
      points.push({ x: t.created_at, y: running });
    }
    if (points.length === 1 || running !== portfolioValue) {
      points.push({ x: new Date().toISOString(), y: portfolioValue });
    }
    return points;
  }, [closedTrades, prevClose, portfolioValue]);

  const totalTradesCount = allTrades.length;

  const handleRefresh = useCallback(() => {
    void latestSnapshotQuery.refetch();
    void portfolioQuery.refetch();
    void positionsQuery.refetch();
    void allTradesQuery.refetch();
  }, [latestSnapshotQuery, portfolioQuery, positionsQuery, allTradesQuery]);

  const isRefreshing =
    (latestSnapshotQuery.isFetching && !latestSnapshotQuery.isLoading) ||
    (positionsQuery.isFetching && !positionsQuery.isLoading) ||
    (allTradesQuery.isFetching && !allTradesQuery.isLoading);

  return (
    <LinearGradient colors={[BG_TOP, BG_BOT]} style={styles.gradient}>
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <ScrollView
          style={styles.scroll}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: insets.bottom + 20 }}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={handleRefresh}
              tintColor={TEAL}
            />
          }
        >
          <EquityChart />

          <BotControlBar />

          <View style={styles.historyHeader}>
            <Text style={styles.historyTitle}>Trade History</Text>
            <Text style={styles.historyCount}>{closedCount} closed</Text>
          </View>

          <View style={styles.tabBar}>
            <TouchableOpacity
              style={[styles.tab, activeTab === 'positions' && styles.tabActive]}
              onPress={() => setActiveTab('positions')}
              activeOpacity={0.7}
            >
              <Text style={[styles.tabText, activeTab === 'positions' && styles.tabTextActive]} numberOfLines={1}>
                POS
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.tab, activeTab === 'wins' && styles.tabActive]}
              onPress={() => setActiveTab('wins')}
              activeOpacity={0.7}
              testID="wins-pill"
            >
              <Text style={[styles.tabText, activeTab === 'wins' && styles.tabTextActive]} numberOfLines={1}>
                WINS
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.tab, activeTab === 'losses' && styles.tabActive]}
              onPress={() => setActiveTab('losses')}
              activeOpacity={0.7}
              testID="losses-pill"
            >
              <Text style={[styles.tabText, activeTab === 'losses' && styles.tabTextActive]} numberOfLines={1}>
                LOSSES
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.tab, activeTab === 'trades' && styles.tabActive]}
              onPress={() => setActiveTab('trades')}
              activeOpacity={0.7}
            >
              <Text style={[styles.tabText, activeTab === 'trades' && styles.tabTextActive]} numberOfLines={1}>
                TRADES
              </Text>
            </TouchableOpacity>
          </View>

          <View style={styles.countsRow}>
            <View style={styles.countCell}>
              <View style={styles.countBadge}>
                <Text style={styles.countBadgeText}>{positions.length}</Text>
              </View>
            </View>
            <View style={styles.countCell}>
              <View style={styles.countBadge}>
                <Text style={styles.countBadgeText}>{wins.length}</Text>
              </View>
            </View>
            <View style={styles.countCell}>
              <View style={styles.countBadge}>
                <Text style={styles.countBadgeText}>{losses.length}</Text>
              </View>
            </View>
            <View style={styles.countCell}>
              <View style={styles.countBadge}>
                <Text style={styles.countBadgeText}>{totalTradesCount}</Text>
              </View>
            </View>
          </View>

          {activeTab === 'positions' && (
            <View style={styles.tabContent}>
              {positionsQuery.isLoading ? (
                <ActivityIndicator color={TEAL} style={styles.loader} />
              ) : positions.length === 0 ? (
                <View style={styles.emptyState}>
                  <Briefcase size={28} color={TEXT_DIM} strokeWidth={1} />
                  <Text style={styles.emptyText}>No open positions</Text>
                </View>
              ) : (
                positions.map((pos) => {
                  const pnl = pos.pnl_pct ?? 0;
                  const isPos = pnl >= 0;
                  return (
                    <TouchableOpacity
                      key={String(pos.id ?? pos.symbol)}
                      style={styles.historyRow}
                      onPress={() => router.push(`/ticker/${pos.symbol}`)}
                      activeOpacity={0.7}
                    >
                      <View style={styles.historyRowLeft}>
                        <View style={styles.symbolRow}>
                          <Text style={styles.symbolText}>{pos.symbol}</Text>
                          <View style={styles.openBadge}>
                            <Text style={styles.openBadgeText}>OPEN</Text>
                          </View>
                        </View>
                        <Text style={styles.historyRowSub}>
                          {pos.qty} shares · Entry ${Number(pos.entry_price).toFixed(2)} · Now ${Number(pos.current_price).toFixed(2)}
                        </Text>
                      </View>
                      <View style={styles.historyRowRight}>
                        <Text style={[styles.pnlText, { color: isPos ? ACCENT_GREEN : ACCENT_RED }]}>
                          {isPos ? '+' : ''}{pnl.toFixed(2)}%
                        </Text>
                        <ChevronRight size={14} color={TEXT_DIM} />
                      </View>
                    </TouchableOpacity>
                  );
                })
              )}
            </View>
          )}

          {activeTab === 'wins' && (
            <View style={styles.tabContent}>
              {allTradesQuery.isLoading ? (
                <ActivityIndicator color={TEAL} style={styles.loader} />
              ) : (
                <DailyBreakdown closedTrades={closedTrades} filter="wins" />
              )}
            </View>
          )}

          {activeTab === 'losses' && (
            <View style={styles.tabContent}>
              {allTradesQuery.isLoading ? (
                <ActivityIndicator color={TEAL} style={styles.loader} />
              ) : (
                <DailyBreakdown closedTrades={closedTrades} filter="losses" />
              )}
            </View>
          )}

          {activeTab === 'trades' && (
            <View style={styles.tabContent}>
              {allTrades.length === 0 ? (
                <View style={styles.emptyState}>
                  <Activity size={28} color={TEXT_DIM} strokeWidth={1} />
                  <Text style={styles.emptyText}>No trades yet</Text>
                </View>
              ) : (
                allTrades.map((t) => {
                  const pnlNum = t.pnl_pct || 0;
                  const isPos = pnlNum >= 0;
                  const sideLabel = t.side ? t.side.toUpperCase() : '';
                  const displayPrice = t.fill_price > 0 ? t.fill_price : t.entry_price;
                  return (
                    <TouchableOpacity
                      key={String(t.id)}
                      style={styles.historyRow}
                      onPress={() => router.push(`/ticker/${t.symbol}`)}
                      activeOpacity={0.7}
                    >
                      <View style={styles.historyRowLeft}>
                        <View style={styles.symbolRow}>
                          <Text style={styles.symbolText}>{t.symbol}</Text>
                          {sideLabel ? (
                            <View style={styles.openBadge}>
                              <Text style={styles.openBadgeText}>{sideLabel}</Text>
                            </View>
                          ) : null}
                        </View>
                        <Text style={styles.historyRowSub}>
                          {t.quantity} shares · ${Number(displayPrice).toFixed(2)}
                        </Text>
                      </View>
                      <View style={styles.historyRowRight}>
                        <Text style={[styles.pnlText, { color: pnlNum === 0 ? TEXT_DIM : isPos ? ACCENT_GREEN : ACCENT_RED }]}>
                          {pnlNum === 0 ? '—' : `${isPos ? '+' : ''}${pnlNum.toFixed(2)}%`}
                        </Text>
                        <ChevronRight size={14} color={TEXT_DIM} />
                      </View>
                    </TouchableOpacity>
                  );
                })
              )}
            </View>
          )}
        </ScrollView>
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  gradient: { flex: 1 },
  container: { flex: 1 },
  scroll: { flex: 1 },

  portfolioWrap: {
    paddingTop: 12,
  },

  chartCard: {
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
    backgroundColor: 'rgba(255,255,255,0.03)',
    paddingTop: 10,
    paddingBottom: 4,
    overflow: 'hidden' as const,
  },
  chartLabel: {
    color: TEXT_DIM,
    fontSize: 9,
    fontWeight: '600' as const,
    letterSpacing: 1.8,
    marginLeft: 12,
    marginBottom: 4,
  },
  tooltip: {
    position: 'absolute' as const,
    top: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: 'rgba(10,10,26,0.95)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center' as const,
  },
  tooltipText: {
    color: TEXT_PRIMARY,
    fontSize: 12,
    fontWeight: '700' as const,
    letterSpacing: 0.3,
  },

  tilesRow: {
    flexDirection: 'row' as const,
    marginHorizontal: 16,
    gap: 10,
    marginBottom: 12,
  },
  bigCard: {
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 14,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
  },
  bigCardHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    marginBottom: 8,
  },
  bigCardValue: {
    fontSize: 22,
    fontWeight: '800' as const,
    letterSpacing: 0.3,
  },
  bigCardLabel: {
    color: TEXT_DIM,
    fontSize: 11,
    fontWeight: '700' as const,
    letterSpacing: 1.5,
  },
  bigCardSub: {
    color: TEXT_DIM,
    fontSize: 10,
    fontWeight: '700' as const,
    letterSpacing: 1.4,
    marginBottom: 10,
  },
  pillsRow: {
    flexDirection: 'row' as const,
    gap: 8,
    paddingRight: 4,
  },
  pill: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
  pillWin: {
    backgroundColor: 'rgba(46,232,154,0.10)',
    borderColor: 'rgba(46,232,154,0.30)',
  },
  pillLoss: {
    backgroundColor: 'rgba(255,107,107,0.10)',
    borderColor: 'rgba(255,107,107,0.30)',
  },
  pillSymbol: {
    color: TEXT_PRIMARY,
    fontSize: 12,
    fontWeight: '800' as const,
    letterSpacing: 0.5,
  },
  pillPct: {
    fontSize: 12,
    fontWeight: '700' as const,
  },
  emptyPillText: {
    color: TEXT_DIM,
    fontSize: 12,
    paddingVertical: 6,
  },
  tile: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
    paddingVertical: 16,
    paddingHorizontal: 12,
    alignItems: 'center' as const,
    gap: 6,
  },
  tileBlue: {
    backgroundColor: 'rgba(77,163,255,0.10)',
    borderColor: 'rgba(77,163,255,0.30)',
  },
  tileGreen: {
    backgroundColor: 'rgba(46,232,154,0.10)',
    borderColor: 'rgba(46,232,154,0.30)',
  },
  tileRed: {
    backgroundColor: 'rgba(255,107,107,0.10)',
    borderColor: 'rgba(255,107,107,0.30)',
  },
  tileValue: {
    color: TEXT_PRIMARY,
    fontSize: 22,
    fontWeight: '700' as const,
  },
  tileLabel: {
    color: TEXT_DIM,
    fontSize: 9,
    fontWeight: '700' as const,
    letterSpacing: 1.5,
  },

  historyHeader: {
    flexDirection: 'row' as const,
    alignItems: 'baseline' as const,
    justifyContent: 'space-between' as const,
    marginHorizontal: 20,
    marginBottom: 10,
  },
  historyTitle: {
    color: TEXT_PRIMARY,
    fontSize: 18,
    fontWeight: '700' as const,
    letterSpacing: 0.3,
  },
  historyCount: {
    color: TEXT_DIM,
    fontSize: 12,
    letterSpacing: 0.3,
  },

  tabBar: {
    flexDirection: 'row' as const,
    marginHorizontal: 12,
    marginBottom: 8,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 10,
    padding: 2,
  },
  tab: {
    flex: 1,
    paddingVertical: 7,
    paddingHorizontal: 2,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    borderRadius: 8,
    minWidth: 0, // allow flex children to shrink
  },
  tabActive: {
    backgroundColor: 'rgba(0,212,170,0.15)',
  },
  tabText: {
    color: TEXT_DIM,
    fontSize: 9,
    fontWeight: '700' as const,
    letterSpacing: 0.3,
    textAlign: 'center' as const,
  },
  tabTextActive: {
    color: TEAL,
  },
  countsRow: {
    flexDirection: 'row' as const,
    marginHorizontal: 12,
    marginBottom: 10,
    marginTop: -2,
  },
  countCell: {
    flex: 1,
    alignItems: 'center' as const,
  },
  countBadge: {
    minWidth: 22,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 9,
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  countBadgeText: {
    color: TEXT_DIM,
    fontSize: 10,
    fontWeight: '700' as const,
    letterSpacing: 0.2,
  },

  tabContent: {
    marginHorizontal: 16,
  },
  loader: {
    marginTop: 30,
  },
  emptyState: {
    alignItems: 'center' as const,
    paddingVertical: 40,
    gap: 10,
  },
  emptyText: {
    color: TEXT_DIM,
    fontSize: 13,
    letterSpacing: 0.2,
  },

  historyRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    paddingVertical: 14,
    paddingHorizontal: 14,
    marginBottom: 8,
    backgroundColor: 'rgba(255,255,255,0.035)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
  },
  historyRowLeft: {
    flex: 1,
    gap: 4,
  },
  symbolRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
  },
  symbolText: {
    color: TEXT_PRIMARY,
    fontSize: 15,
    fontWeight: '700' as const,
    letterSpacing: 0.3,
  },
  openBadge: {
    backgroundColor: 'rgba(0,212,170,0.15)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: 'rgba(0,212,170,0.3)',
  },
  openBadgeText: {
    color: TEAL,
    fontSize: 8,
    fontWeight: '800' as const,
    letterSpacing: 1,
  },
  historyRowSub: {
    color: TEXT_DIM,
    fontSize: 11,
    letterSpacing: 0.1,
  },
  historyRowRight: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
  },
  pnlText: {
    fontSize: 14,
    fontWeight: '700' as const,
    letterSpacing: 0.2,
  },
});
