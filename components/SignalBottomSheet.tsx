import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  TouchableWithoutFeedback,
  Animated,
  Easing,
  ActivityIndicator,
  Dimensions,
  Alert,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useMutation } from '@tanstack/react-query';
import Svg, { Path, Defs, LinearGradient, Stop, Text as SvgText, Line, Circle } from 'react-native-svg';
import { X } from 'lucide-react-native';
import { useChartCrosshair } from '@/hooks/useChartCrosshair';

const { height: SCREEN_H, width: SCREEN_W } = Dimensions.get('window');
const SHEET_H = SCREEN_H * 0.84;
const CHART_H = 210;
const Y_AXIS_W = 50;
const X_AXIS_H = 24;
const PAD_TOP = 12;

const SUPABASE_URL = 'https://oarghsfryihwvqnvxntx.supabase.co';
const SUPABASE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9hcmdoc2ZyeWlod3ZxbnZ4bnR4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU0NDE3NTgsImV4cCI6MjA5MTAxNzc1OH0.q-0a35zj4pmtuOFQ4PerJLV8a7P9xhMcfHm6PBZBTwE';

const YELLOW = '#ffd600';
const BG = '#07090e';
const SHEET_BG = '#0b0d14';
const GLASS = 'rgba(255,255,255,0.04)';
const BORDER = 'rgba(255,255,255,0.07)';
const TEXT_PRIMARY = '#f0f0f0';
const TEXT_SECONDARY = '#4a5568';
const GREEN = '#22c97a';
const GRID_COLOR = 'rgba(255,255,255,0.05)';
const TEAL = '#00d4aa';

const SIGNAL_COLORS: Record<string, string> = {
  BUY: '#22c97a',
  HOLD: '#fbbf24',
  SELL: '#f87171',
  OVEREXTENDED: '#fb923c',
};

const SIGNAL_GLOW: Record<string, string> = {
  BUY: 'rgba(34,201,122,0.15)',
  HOLD: 'rgba(251,191,36,0.12)',
  SELL: 'rgba(248,113,113,0.15)',
  OVEREXTENDED: 'rgba(251,146,60,0.12)',
};

type CandleTF = '1m' | '5m' | '15m';

const TF_TABS: { label: string; value: CandleTF }[] = [
  { label: '1M', value: '1m' },
  { label: '5M', value: '5m' },
  { label: '15M', value: '15m' },
];

interface Candle {
  symbol: string;
  timeframe: string;
  ts: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export interface SignalSheetData {
  symbol: string;
  signal: 'BUY' | 'HOLD' | 'SELL' | 'OVEREXTENDED';
  price: number | null;
  change_8am: number | null;
  change_last?: number | null;
  rvol: number | null;
  rsi: number | null;
  vwap: number | null;
  volume: number | null;
}

interface Props {
  data: SignalSheetData | null;
  onClose: () => void;
}

interface ChartData {
  line: string;
  fill: string;
  yLabels: { y: number; text: string }[];
  xLabels: { x: number; text: string }[];
}

function getETHour(ts: string): number {
  try {
    const formatted = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hour: 'numeric',
      hour12: false,
    }).format(new Date(ts));
    const h = parseInt(formatted, 10);
    return isNaN(h) ? 0 : h % 24;
  } catch {
    return 0;
  }
}

function getETTimeLabel(ts: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(ts));
  } catch {
    return '';
  }
}

function filterSessionBars(candles: Candle[]): Candle[] {
  return candles.filter((c) => {
    const h = getETHour(c.ts);
    return h >= 8 && h < 20;
  });
}

function buildChartData(
  prices: number[],
  timestamps: string[],
  w: number,
  h: number
): ChartData {
  if (prices.length < 2) return { line: '', fill: '', yLabels: [], xLabels: [] };

  const plotX0 = Y_AXIS_W;
  const plotW = w - Y_AXIS_W;
  const plotY0 = PAD_TOP;
  const plotH = h - PAD_TOP - X_AXIS_H;
  const minV = Math.min(...prices);
  const maxV = Math.max(...prices);
  const range = maxV - minV || 1;

  const pts = prices.map((v, i) => ({
    x: plotX0 + (i / (prices.length - 1)) * plotW,
    y: plotY0 + plotH - ((v - minV) / range) * plotH,
  }));

  let line = `M${pts[0].x.toFixed(2)},${pts[0].y.toFixed(2)}`;
  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1];
    const curr = pts[i];
    const cpx = ((prev.x + curr.x) / 2).toFixed(2);
    line += ` C${cpx},${prev.y.toFixed(2)} ${cpx},${curr.y.toFixed(2)} ${curr.x.toFixed(2)},${curr.y.toFixed(2)}`;
  }

  const baseline = (plotY0 + plotH).toFixed(2);
  let fill = `M${pts[0].x.toFixed(2)},${baseline}`;
  fill += ` L${pts[0].x.toFixed(2)},${pts[0].y.toFixed(2)}`;
  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1];
    const curr = pts[i];
    const cpx = ((prev.x + curr.x) / 2).toFixed(2);
    fill += ` C${cpx},${prev.y.toFixed(2)} ${cpx},${curr.y.toFixed(2)} ${curr.x.toFixed(2)},${curr.y.toFixed(2)}`;
  }
  fill += ` L${pts[pts.length - 1].x.toFixed(2)},${baseline} Z`;

  const yLabels: { y: number; text: string }[] = [];
  for (let i = 0; i < 4; i++) {
    const frac = i / 3;
    const val = minV + frac * range;
    const yPos = plotY0 + plotH - frac * plotH;
    yLabels.push({ y: yPos, text: `$${val.toFixed(2)}` });
  }

  const xLabels: { x: number; text: string }[] = [];
  for (let i = 0; i < 5; i++) {
    const idx = Math.round((i / 4) * (prices.length - 1));
    const xPos = pts[idx].x;
    const label = timestamps[idx] ? getETTimeLabel(timestamps[idx]) : '';
    xLabels.push({ x: xPos, text: label });
  }

  return { line, fill, yLabels, xLabels };
}

async function fetchCandles(symbol: string, tf: CandleTF): Promise<Candle[]> {
  console.log('[SignalSheet] Fetching candles:', symbol, tf);
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/candles?symbol=eq.${encodeURIComponent(symbol)}&timeframe=eq.${tf}&order=ts.asc&limit=2000`,
    {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
      },
    }
  );
  if (!res.ok) {
    const text = await res.text();
    console.error('[SignalSheet] candles error:', res.status, text);
    return [];
  }
  const json = await res.json();
  console.log('[SignalSheet] raw candles fetched:', Array.isArray(json) ? json.length : 0);
  return Array.isArray(json) ? (json as Candle[]) : [];
}

function formatVol(v: number | null): string {
  if (v == null) return '—';
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(0)}K`;
  return v.toFixed(0);
}

function formatNum(v: number | null | undefined, decimals = 2): string {
  if (v == null) return '—';
  return v.toFixed(decimals);
}

const TOOLTIP_W = 136;

export default function SignalBottomSheet({ data, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const slideAnim = useRef(new Animated.Value(SHEET_H)).current;
  const backdropAnim = useRef(new Animated.Value(0)).current;
  const [visible, setVisible] = useState<boolean>(false);
  const [tf, setTf] = useState<CandleTF>('1m');
  const [chartWidth, setChartWidth] = useState<number>(SCREEN_W - 32);
  const [buyDone, setBuyDone] = useState<boolean>(false);

  const isOpen = data !== null;

  useEffect(() => {
    if (isOpen) {
      setTf('1m');
      setBuyDone(false);
      setVisible(true);
      Animated.parallel([
        Animated.timing(slideAnim, {
          toValue: 0,
          duration: 340,
          easing: Easing.out(Easing.bezier(0.25, 0.46, 0.45, 0.94)),
          useNativeDriver: true,
        }),
        Animated.timing(backdropAnim, {
          toValue: 1,
          duration: 280,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(slideAnim, {
          toValue: SHEET_H,
          duration: 280,
          easing: Easing.in(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(backdropAnim, {
          toValue: 0,
          duration: 240,
          useNativeDriver: true,
        }),
      ]).start(() => setVisible(false));
    }
  }, [isOpen]);

  const { data: candles = [], isLoading: candlesLoading } = useQuery({
    queryKey: ['sheet-candles', data?.symbol ?? '', tf],
    queryFn: () => fetchCandles(data!.symbol, tf),
    enabled: isOpen && !!data?.symbol,
    staleTime: 30000,
    retry: 1,
  });

  const sessionCandles = useMemo(() => {
    const filtered = filterSessionBars(candles);
    console.log('[SignalSheet] session bars after 8AM-8PM ET filter:', filtered.length, '/', candles.length);
    return filtered;
  }, [candles]);

  const closePrices = useMemo(() => sessionCandles.map((c) => c.c), [sessionCandles]);
  const timestamps = useMemo(() => sessionCandles.map((c) => c.ts), [sessionCandles]);

  const { line: linePath, fill: fillPath, yLabels, xLabels } = useMemo(
    () => buildChartData(closePrices, timestamps, chartWidth, CHART_H),
    [closePrices, timestamps, chartWidth]
  );

  const { crosshair, panResponder: chartPanResponder } = useChartCrosshair(
    closePrices,
    timestamps,
    chartWidth,
    CHART_H,
    Y_AXIS_W,
    PAD_TOP,
    X_AXIS_H,
  );

  const tooltipLeft = crosshair
    ? Math.max(Y_AXIS_W, Math.min(crosshair.x - TOOLTIP_W / 2, chartWidth - TOOLTIP_W - 4))
    : 0;

  const buyMutation = useMutation({
    mutationFn: async () => {
      if (!data) throw new Error('No symbol');
      console.log('[SignalSheet] Posting BUY command for', data.symbol);
      const res = await fetch(`${SUPABASE_URL}/rest/v1/commands`, {
        method: 'POST',
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({
          cmd: 'BUY',
          symbol: data.symbol,
          source: 'rork-app',
          ts: new Date().toISOString(),
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Command failed: ${res.status} ${text}`);
      }
    },
    onSuccess: () => {
      console.log('[SignalSheet] BUY command sent for', data?.symbol);
      setBuyDone(true);
      setTimeout(() => {
        onClose();
        setBuyDone(false);
      }, 1100);
    },
    onError: (err: Error) => {
      console.error('[SignalSheet] BUY error:', err.message);
      Alert.alert('Order Error', err.message);
    },
  });

  if (!visible && !isOpen) return null;

  const sigColor = data ? (SIGNAL_COLORS[data.signal] ?? GREEN) : GREEN;
  const sigGlow = data ? (SIGNAL_GLOW[data.signal] ?? SIGNAL_GLOW.BUY) : SIGNAL_GLOW.BUY;
  const sigLabel = data?.signal === 'OVEREXTENDED' ? 'OVER' : (data?.signal ?? 'BUY');
  const changeVal = data?.change_last ?? data?.change_8am ?? null;
  const changePositive = changeVal !== null && changeVal >= 0;
  const priceDisplay = data?.price != null ? `$${data.price.toFixed(2)}` : '—';

  const plotH = CHART_H - PAD_TOP - X_AXIS_H;
  const plotY0 = PAD_TOP;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <TouchableWithoutFeedback onPress={onClose}>
          <Animated.View style={[styles.backdrop, { opacity: backdropAnim }]} />
        </TouchableWithoutFeedback>

        <Animated.View
          style={[
            styles.sheet,
            { transform: [{ translateY: slideAnim }], paddingBottom: insets.bottom + 16 },
          ]}
        >
          {/* Handle */}
          <View style={styles.handle} />

          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <Text style={styles.headerSymbol}>{data?.symbol ?? ''}</Text>
              <View
                style={[
                  styles.sigBadge,
                  { backgroundColor: sigGlow, borderColor: sigColor + '50' },
                ]}
              >
                <Text style={[styles.sigBadgeText, { color: sigColor }]}>{sigLabel}</Text>
              </View>
            </View>
            <View style={styles.headerRight}>
              <View style={styles.headerPriceCol}>
                <Text style={styles.headerPrice}>
                  {crosshair != null
                    ? `$${crosshair.price.toFixed(2)}`
                    : priceDisplay}
                </Text>
                {crosshair != null ? (
                  <Text
                    style={[
                      styles.headerChange,
                      { color: crosshair.pctChange >= 0 ? GREEN : '#f87171' },
                    ]}
                  >
                    {crosshair.pctChange >= 0 ? '+' : ''}
                    {crosshair.pctChange.toFixed(2)}%
                  </Text>
                ) : changeVal !== null ? (
                  <Text
                    style={[
                      styles.headerChange,
                      { color: changePositive ? GREEN : '#f87171' },
                    ]}
                  >
                    {changePositive ? '+' : ''}
                    {changeVal.toFixed(2)}%
                  </Text>
                ) : null}
              </View>
              <TouchableOpacity
                style={styles.closeBtn}
                onPress={onClose}
                hitSlop={12}
                testID="sheet-close"
              >
                <X size={16} color={TEXT_SECONDARY} strokeWidth={1.5} />
              </TouchableOpacity>
            </View>
          </View>

          {/* TF Tabs */}
          <View style={styles.tfRow}>
            {TF_TABS.map(({ label, value }) => {
              const active = tf === value;
              return (
                <TouchableOpacity
                  key={value}
                  style={[styles.tfTab, active && styles.tfTabActive]}
                  onPress={() => setTf(value)}
                  activeOpacity={0.7}
                  testID={`sheet-tf-${value}`}
                >
                  <Text style={[styles.tfText, active && styles.tfTextActive]}>{label}</Text>
                  {active && <View style={[styles.tfDot, { backgroundColor: YELLOW }]} />}
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Chart wrapper — tooltip sits outside clipped chartArea */}
          <View style={styles.chartWrapper}>
            <View
              style={styles.chartArea}
              onLayout={(e) => setChartWidth(e.nativeEvent.layout.width)}
              {...chartPanResponder.panHandlers}
            >
              {candlesLoading ? (
                <View style={styles.chartCenter}>
                  <ActivityIndicator color={YELLOW} size="small" />
                </View>
              ) : closePrices.length >= 2 ? (
                <Svg width={chartWidth} height={CHART_H}>
                  <Defs>
                    <LinearGradient id="sheetFill" x1="0" y1="0" x2="0" y2="1">
                      <Stop offset="0%" stopColor={YELLOW} stopOpacity={0.38} />
                      <Stop offset="60%" stopColor={YELLOW} stopOpacity={0.06} />
                      <Stop offset="100%" stopColor={YELLOW} stopOpacity={0} />
                    </LinearGradient>
                  </Defs>

                  {/* Y-axis grid lines + labels */}
                  {yLabels.map((lbl, i) => (
                    <React.Fragment key={`y-${i}`}>
                      <Line
                        x1={Y_AXIS_W}
                        y1={lbl.y}
                        x2={chartWidth}
                        y2={lbl.y}
                        stroke={GRID_COLOR}
                        strokeWidth={1}
                        strokeDasharray="3 4"
                      />
                      <SvgText
                        x={Y_AXIS_W - 4}
                        y={lbl.y + 4}
                        textAnchor="end"
                        fontSize={9}
                        fill={TEXT_SECONDARY}
                        fontFamily={Platform.OS === 'ios' ? 'Menlo' : 'monospace'}
                      >
                        {lbl.text}
                      </SvgText>
                    </React.Fragment>
                  ))}

                  {/* Fill area */}
                  <Path d={fillPath} fill="url(#sheetFill)" />

                  {/* Line */}
                  <Path
                    d={linePath}
                    fill="none"
                    stroke={YELLOW}
                    strokeWidth={2}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />

                  {/* X-axis labels — hide when crosshair is active */}
                  {!crosshair && xLabels.map((lbl, i) => (
                    <SvgText
                      key={`x-${i}`}
                      x={lbl.x}
                      y={CHART_H - 4}
                      textAnchor={i === 0 ? 'start' : i === xLabels.length - 1 ? 'end' : 'middle'}
                      fontSize={9}
                      fill={TEXT_SECONDARY}
                      fontFamily={Platform.OS === 'ios' ? 'Menlo' : 'monospace'}
                    >
                      {lbl.text}
                    </SvgText>
                  ))}

                  {/* Crosshair */}
                  {crosshair && (
                    <>
                      <Line
                        x1={crosshair.x}
                        y1={PAD_TOP}
                        x2={crosshair.x}
                        y2={plotY0 + plotH}
                        stroke="rgba(255,255,255,0.5)"
                        strokeWidth={1}
                      />
                      <Line
                        x1={Y_AXIS_W}
                        y1={crosshair.y}
                        x2={chartWidth}
                        y2={crosshair.y}
                        stroke="rgba(255,255,255,0.25)"
                        strokeWidth={1}
                        strokeDasharray="3 4"
                      />
                      <Circle cx={crosshair.x} cy={crosshair.y} r={11} fill={TEAL} opacity={0.15} />
                      <Circle cx={crosshair.x} cy={crosshair.y} r={5} fill={TEAL} />
                      <Circle cx={crosshair.x} cy={crosshair.y} r={2.5} fill="#ffffff" />
                    </>
                  )}
                </Svg>
              ) : (
                <View style={styles.chartCenter}>
                  <Text style={styles.chartEmpty}>No chart data yet — bot is fetching</Text>
                </View>
              )}
            </View>

            {/* Crosshair tooltip — outside clipped chartArea */}
            {crosshair && (
              <View style={[styles.crosshairTooltip, { left: tooltipLeft }]}>
                <Text style={styles.crosshairPrice}>
                  ${crosshair.price.toFixed(2)}
                </Text>
                <Text style={styles.crosshairTime}>
                  {getETTimeLabel(crosshair.timestamp)}
                </Text>
                <Text
                  style={[
                    styles.crosshairPct,
                    { color: crosshair.pctChange >= 0 ? GREEN : '#f87171' },
                  ]}
                >
                  {crosshair.pctChange >= 0 ? '+' : ''}
                  {crosshair.pctChange.toFixed(2)}%
                </Text>
              </View>
            )}
          </View>

          {/* Stats row */}
          <View style={styles.statsRow}>
            <View style={styles.statCard}>
              <Text style={styles.statLabel}>RVOL</Text>
              <Text style={[styles.statValue, { color: YELLOW }]}>
                {formatNum(data?.rvol, 1)}
              </Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statLabel}>RSI</Text>
              <Text
                style={[
                  styles.statValue,
                  {
                    color:
                      data?.rsi != null
                        ? data.rsi > 70
                          ? '#f87171'
                          : data.rsi < 30
                          ? GREEN
                          : '#fbbf24'
                        : TEXT_SECONDARY,
                  },
                ]}
              >
                {formatNum(data?.rsi, 1)}
              </Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statLabel}>VWAP</Text>
              <Text style={[styles.statValue, { color: TEXT_PRIMARY }]}>
                {data?.vwap != null ? `$${data.vwap.toFixed(2)}` : '—'}
              </Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statLabel}>VOL</Text>
              <Text style={[styles.statValue, { color: TEXT_PRIMARY }]}>
                {formatVol(data?.volume ?? null)}
              </Text>
            </View>
          </View>

          {/* BUY Button */}
          <TouchableOpacity
            style={[
              styles.buyBtn,
              (buyMutation.isPending || buyDone) && { opacity: 0.6 },
              buyDone && { backgroundColor: '#059669' },
            ]}
            onPress={() => buyMutation.mutate()}
            disabled={buyMutation.isPending || buyDone}
            activeOpacity={0.8}
            testID={`sheet-buy-${data?.symbol ?? ''}`}
          >
            {buyDone ? (
              <Text style={styles.buyBtnText}>✓  ORDER SENT</Text>
            ) : buyMutation.isPending ? (
              <ActivityIndicator color="#000" size="small" />
            ) : (
              <Text style={styles.buyBtnText}>BUY {data?.symbol ?? ''}</Text>
            )}
          </TouchableOpacity>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.72)',
  },
  sheet: {
    height: SHEET_H,
    backgroundColor: SHEET_BG,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 20,
    paddingTop: 12,
  },

  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.14)',
    alignSelf: 'center',
    marginBottom: 16,
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerSymbol: {
    color: '#ffffff',
    fontSize: 30,
    fontWeight: '200' as const,
    letterSpacing: -0.5,
  },
  sigBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    borderWidth: 1,
  },
  sigBadgeText: {
    fontSize: 10,
    fontWeight: '500' as const,
    letterSpacing: 1.5,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  headerPriceCol: {
    alignItems: 'flex-end',
    gap: 2,
  },
  headerPrice: {
    color: TEXT_PRIMARY,
    fontSize: 17,
    fontWeight: '300' as const,
    fontVariant: ['tabular-nums'] as const,
    letterSpacing: 0.2,
  },
  headerChange: {
    fontSize: 12,
    fontWeight: '300' as const,
    fontVariant: ['tabular-nums'] as const,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    justifyContent: 'center',
    alignItems: 'center',
  },

  tfRow: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 12,
  },
  tfTab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 7,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'transparent',
    gap: 4,
  },
  tfTabActive: {
    backgroundColor: 'rgba(255,214,0,0.06)',
    borderColor: 'rgba(255,214,0,0.2)',
  },
  tfText: {
    color: TEXT_SECONDARY,
    fontSize: 11,
    fontWeight: '400' as const,
    letterSpacing: 1,
  },
  tfTextActive: {
    color: YELLOW,
    fontWeight: '500' as const,
  },
  tfDot: {
    width: 3,
    height: 3,
    borderRadius: 1.5,
  },

  chartWrapper: {
    marginBottom: 12,
  },
  chartArea: {
    height: CHART_H,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.02)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  chartCenter: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  chartEmpty: {
    color: TEXT_SECONDARY,
    fontSize: 12,
    fontWeight: '300' as const,
    letterSpacing: 0.5,
    textAlign: 'center',
  },

  crosshairTooltip: {
    position: 'absolute' as const,
    top: 8,
    width: TOOLTIP_W,
    backgroundColor: 'rgba(4,6,16,0.92)',
    borderRadius: 10,
    paddingVertical: 7,
    paddingHorizontal: 10,
    alignItems: 'center' as const,
    borderWidth: 1,
    borderColor: 'rgba(255,214,0,0.22)',
  },
  crosshairPrice: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600' as const,
    letterSpacing: 0.2,
    fontVariant: ['tabular-nums'] as const,
  },
  crosshairTime: {
    color: '#4a5568',
    fontSize: 10,
    marginTop: 2,
    letterSpacing: 0.5,
    fontVariant: ['tabular-nums'] as const,
  },
  crosshairPct: {
    fontSize: 11,
    fontWeight: '700' as const,
    marginTop: 2,
    letterSpacing: 0.4,
  },

  statsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  statCard: {
    flex: 1,
    backgroundColor: GLASS,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BORDER,
    paddingVertical: 12,
    paddingHorizontal: 8,
    alignItems: 'center',
    gap: 5,
  },
  statLabel: {
    color: TEXT_SECONDARY,
    fontSize: 8,
    fontWeight: '400' as const,
    letterSpacing: 1.8,
  },
  statValue: {
    color: TEXT_PRIMARY,
    fontSize: 15,
    fontWeight: '300' as const,
    fontVariant: ['tabular-nums'] as const,
    letterSpacing: 0.2,
  },

  buyBtn: {
    backgroundColor: GREEN,
    borderRadius: 18,
    paddingVertical: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
    shadowColor: GREEN,
    shadowRadius: 20,
    shadowOpacity: 0.35,
    shadowOffset: { width: 0, height: 4 },
  },
  buyBtnText: {
    color: '#000000',
    fontSize: 15,
    fontWeight: '600' as const,
    letterSpacing: 2,
  },
});
