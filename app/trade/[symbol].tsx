import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  PanResponder,
  Dimensions,
  Alert,
  Animated,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import Svg, {
  Path,
  Defs,
  LinearGradient as SvgLinearGradient,
  Stop,
  Line,
  Rect,
  Text as SvgText,
} from 'react-native-svg';
import { ChevronLeft, Star, Settings2 } from 'lucide-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { formatDollar, formatScaledDollar } from '@/lib/formatters';

const SUPABASE_URL = 'https://oarghsfryihwvqnvxntx.supabase.co';
const SUPABASE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9hcmdoc2ZyeWlod3ZxbnZ4bnR4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU0NDE3NTgsImV4cCI6MjA5MTAxNzc1OH0.q-0a35zj4pmtuOFQ4PerJLV8a7P9xhMcfHm6PBZBTwE';

const BG = '#0a0a0a';
const CARD = '#141414';
const TEXT_PRIMARY = '#ffffff';
const TEXT_DIM = '#888888';
const SEP = '#1a1a1a';
const GREEN = '#00c853';
const RED = '#ff1744';
const YELLOW = '#ffd600';

const { width: SCREEN_W } = Dimensions.get('window');

const CHART_H = 280;
const VOL_H = 28;
const BAR_W = 4;
const VOL_GAP = 2;
const BAR_STEP = BAR_W + VOL_GAP;
const PAD_LEFT = 6;
const PAD_RIGHT = 58;
const PAD_TOP = 12;
const PAD_BOTTOM = 24;

const PLOT_W = SCREEN_W - PAD_LEFT - PAD_RIGHT;
const PLOT_H = CHART_H - PAD_TOP - PAD_BOTTOM;

type TF = '1m' | '5m' | '15m' | '1h' | '4H' | '1D' | '1W';
const TIMEFRAMES: TF[] = ['1m', '5m', '15m', '1h', '4H', '1D', '1W'];
const TF_SUPABASE: Partial<Record<TF, string>> = {
  '1m': '1Min',
  '5m': '5Min',
  '15m': '15Min',
  '1h': '15Min',
  '4H': '15Min',
  '1D': '15Min',
  '1W': '15Min',
};

const DURATIONS = ['15M', '30M', '1H', '2H', '4H', '1D'];
const QUICK_AMOUNTS = [20, 200, 400, 1000];

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

function filterSession(candles: Candle[]): Candle[] {
  return candles.filter((c) => {
    try {
      const d = new Date(c.ts);
      const hour = parseInt(
        new Intl.DateTimeFormat('en-US', {
          timeZone: 'America/New_York',
          hour: 'numeric',
          hour12: false,
        }).format(d),
        10
      );
      return hour >= 8 && hour < 20;
    } catch {
      return false;
    }
  });
}

function formatTimeET(ts: string): string {
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

function buildChartPaths(
  data: number[],
  w: number,
  h: number
): { line: string; fill: string } {
  if (data.length < 2) return { line: '', fill: '' };
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) => [
    PAD_LEFT + (i / (data.length - 1)) * w,
    PAD_TOP + (1 - (v - min) / range) * h,
  ] as [number, number]);
  const line = pts
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(2)},${p[1].toFixed(2)}`)
    .join(' ');
  const fill =
    `${line} L${pts[pts.length - 1][0].toFixed(2)},${CHART_H - PAD_BOTTOM}` +
    ` L${pts[0][0].toFixed(2)},${CHART_H - PAD_BOTTOM} Z`;
  return { line, fill };
}

function computeVolBars(
  volumes: number[],
  maxBars: number
): { x: number; y: number; h: number; isAboveAvg: boolean }[] {
  if (volumes.length === 0) return [];
  const step = Math.max(1, Math.ceil(volumes.length / maxBars));
  const sampled: number[] = [];
  for (let i = 0; i < volumes.length; i += step) sampled.push(volumes[i]);
  const maxVol = Math.max(...sampled) || 1;
  const avgVol = sampled.reduce((a, b) => a + b, 0) / sampled.length;
  const totalW = sampled.length * BAR_STEP - VOL_GAP;
  const startX = PAD_LEFT + Math.max(0, (PLOT_W - totalW) / 2);
  return sampled.map((v, i) => {
    const barH = Math.max(2, (v / maxVol) * 24);
    return {
      x: startX + i * BAR_STEP,
      y: VOL_H - barH,
      h: barH,
      isAboveAvg: v > avgVol,
    };
  });
}

function priceAtX(
  cx: number,
  data: number[],
  w: number
): { price: number; index: number; x: number; y: number } | null {
  if (data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const relX = cx - PAD_LEFT;
  const idx = Math.round((relX / w) * (data.length - 1));
  const clampedIdx = Math.max(0, Math.min(data.length - 1, idx));
  const price = data[clampedIdx];
  const px = PAD_LEFT + (clampedIdx / (data.length - 1)) * w;
  const py = PAD_TOP + (1 - (price - min) / range) * PLOT_H;
  return { price, index: clampedIdx, x: px, y: py };
}

async function fetchCandles(symbol: string, tf: string): Promise<Candle[]> {
  console.log('[Trade] Fetching candles', symbol, tf);
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/candles?symbol=eq.${encodeURIComponent(symbol)}&timeframe=eq.${tf}&order=ts.asc&limit=2000`,
    {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
      },
    }
  );
  if (!res.ok) throw new Error(`Candles fetch failed: ${res.status}`);
  const data = await res.json();
  return Array.isArray(data) ? (data as Candle[]) : [];
}

async function sendCommand(
  cmd: 'BUY' | 'SELL',
  symbol: string,
  amount: number,
  duration: string
): Promise<void> {
  console.log('[Trade] Sending', cmd, symbol, amount, duration);
  const res = await fetch(`${SUPABASE_URL}/rest/v1/commands`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({
      cmd,
      symbol,
      amount,
      duration,
      source: 'rork-app',
      ts: new Date().toISOString(),
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${cmd} failed: ${res.status} ${text}`);
  }
}

export default function TradeScreen() {
  const { symbol } = useLocalSearchParams<{ symbol: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [activeTF, setActiveTF] = useState<TF>('5m');
  const [candles, setCandles] = useState<Candle[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isFavorite, setIsFavorite] = useState<boolean>(false);
  const [isSending, setIsSending] = useState<boolean>(false);

  const [durationIdx, setDurationIdx] = useState<number>(2);
  const [amount, setAmount] = useState<number>(100);

  const [crosshairX, setCrosshairX] = useState<number | null>(null);
  const [crosshairVisible, setCrosshairVisible] = useState<boolean>(false);
  const crosshairTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const crosshairActiveRef = useRef<boolean>(false);
  const closesRef = useRef<number[]>([]);

  const toastAnim = useRef(new Animated.Value(0)).current;
  const [toastMsg, setToastMsg] = useState<string>('');

  const sym = symbol ?? '';

  useEffect(() => {
    AsyncStorage.getItem('market_favorites')
      .then((v) => {
        if (v) {
          try {
            const arr: string[] = JSON.parse(v);
            setIsFavorite(arr.includes(sym));
          } catch {
            // ignore
          }
        }
      })
      .catch(() => {});
  }, [sym]);

  const toggleFavorite = useCallback(() => {
    setIsFavorite((prev) => {
      const next = !prev;
      AsyncStorage.getItem('market_favorites')
        .then((v) => {
          const arr: string[] = v ? JSON.parse(v) : [];
          const updated = next ? [...new Set([...arr, sym])] : arr.filter((s) => s !== sym);
          return AsyncStorage.setItem('market_favorites', JSON.stringify(updated));
        })
        .catch(() => {});
      return next;
    });
  }, [sym]);

  const showToast = useCallback(
    (msg: string) => {
      setToastMsg(msg);
      Animated.sequence([
        Animated.timing(toastAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
        Animated.delay(1800),
        Animated.timing(toastAnim, { toValue: 0, duration: 300, useNativeDriver: true }),
      ]).start();
    },
    [toastAnim]
  );

  const loadCandles = useCallback(async (tf: TF) => {
    setIsLoading(true);
    try {
      const supaTF = TF_SUPABASE[tf] ?? '5Min';
      const raw = await fetchCandles(sym, supaTF);
      const filtered = filterSession(raw);
      console.log('[Trade] Candles after session filter:', filtered.length);
      setCandles(filtered);
    } catch (e) {
      console.log('[Trade] Candle error:', e);
      setCandles([]);
    } finally {
      setIsLoading(false);
    }
  }, [sym]);

  useEffect(() => {
    void loadCandles(activeTF);
  }, [activeTF, loadCandles]);

  const closes = useMemo(() => {
    const result = candles.map((c) => c.c);
    closesRef.current = result;
    return result;
  }, [candles]);
  const volumes = useMemo(() => candles.map((c) => c.v), [candles]);

  const lineColor = useMemo(() => {
    if (closes.length < 2) return GREEN;
    return closes[closes.length - 1] >= closes[0] ? GREEN : RED;
  }, [closes]);

  const changeStr = useMemo(() => {
    if (closes.length < 2) return '';
    const pct = ((closes[closes.length - 1] - closes[0]) / closes[0]) * 100;
    return `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
  }, [closes]);

  const lastPrice = closes.length > 0 ? closes[closes.length - 1] : null;
  const lastPriceY = useMemo(() => {
    if (closes.length < 2 || lastPrice == null) return CHART_H / 2;
    const min = Math.min(...closes);
    const max = Math.max(...closes);
    const range = max - min || 1;
    return PAD_TOP + (1 - (lastPrice - min) / range) * PLOT_H;
  }, [closes, lastPrice]);

  const yLabels = useMemo(() => {
    if (closes.length < 2) return [];
    const min = Math.min(...closes);
    const max = Math.max(...closes);
    const range = max - min || 1;
    return [0, 1, 2, 3, 4].map((i) => {
      const price = min + (range * i) / 4;
      const y = PAD_TOP + (1 - (price - min) / range) * PLOT_H;
      return { price, y };
    });
  }, [closes]);

  const xLabels = useMemo(() => {
    if (candles.length < 4) return [];
    const n = candles.length;
    return [0, 1, 2, 3].map((i) => {
      const idx = Math.round((i / 3) * (n - 1));
      return {
        label: formatTimeET(candles[idx].ts),
        x: PAD_LEFT + (idx / (n - 1)) * PLOT_W,
      };
    });
  }, [candles]);

  const { line: chartLine, fill: chartFill } = useMemo(
    () => buildChartPaths(closes, PLOT_W, PLOT_H),
    [closes]
  );

  const maxVolBars = Math.floor(PLOT_W / BAR_STEP);

  const volBars = useMemo(
    () => computeVolBars(volumes, maxVolBars),
    [volumes, maxVolBars]
  );

  const crosshairData = useMemo(() => {
    if (!crosshairVisible || crosshairX == null || closes.length < 2) return null;
    return priceAtX(Math.max(PAD_LEFT, Math.min(crosshairX, PAD_LEFT + PLOT_W)), closes, PLOT_W);
  }, [crosshairX, closes, crosshairVisible]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => closesRef.current.length >= 2,
      onStartShouldSetPanResponderCapture: () => false,
      onMoveShouldSetPanResponder: () => crosshairActiveRef.current,
      onMoveShouldSetPanResponderCapture: () => crosshairActiveRef.current,
      onPanResponderGrant: () => {
        crosshairActiveRef.current = true;
        if (crosshairTimer.current) clearTimeout(crosshairTimer.current);
      },
      onPanResponderMove: (_, gs) => {
        if (crosshairTimer.current) clearTimeout(crosshairTimer.current);
        setCrosshairX(gs.moveX);
        setCrosshairVisible(true);
      },
      onPanResponderRelease: () => {
        crosshairActiveRef.current = false;
        crosshairTimer.current = setTimeout(() => {
          setCrosshairVisible(false);
          setCrosshairX(null);
        }, 1500);
      },
      onPanResponderTerminate: () => {
        crosshairActiveRef.current = false;
        setCrosshairVisible(false);
        setCrosshairX(null);
      },
    })
  ).current;

  useEffect(() => {
    return () => {
      if (crosshairTimer.current) clearTimeout(crosshairTimer.current);
    };
  }, []);

  const handleOrder = useCallback(
    async (cmd: 'BUY' | 'SELL') => {
      if (isSending) return;
      setIsSending(true);
      try {
        await sendCommand(cmd, sym, amount, DURATIONS[durationIdx]);
        showToast(`${cmd} order sent`);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Order failed';
        if (Platform.OS === 'web') {
          showToast(msg);
        } else {
          Alert.alert('Order Error', msg);
        }
      } finally {
        setIsSending(false);
      }
    },
    [isSending, sym, amount, durationIdx, showToast]
  );

  const volColor = useCallback((idx: number): string => {
    if (volumes.length === 0) return YELLOW;
    const maxVol = Math.max(...volumes);
    const rvol = volumes[idx] / (maxVol / 4);
    if (rvol >= 3) return GREEN;
    if (rvol >= 2) return '#80e070';
    if (rvol >= 1) return '#c8d840';
    return YELLOW;
  }, [volumes]);

  const avgVolume = useMemo(() => {
    if (volumes.length === 0) return 1;
    return volumes.reduce((a, b) => a + b, 0) / volumes.length;
  }, [volumes]);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* ── Top Bar ─────────────────────────────────────────────── */}
      <View style={styles.topBar}>
        <TouchableOpacity
          onPress={() => router.back()}
          hitSlop={10}
          style={styles.backBtn}
          testID="back-btn"
        >
          <ChevronLeft size={22} color={TEXT_PRIMARY} strokeWidth={2} />
        </TouchableOpacity>

        <View style={styles.topCenter}>
          <Text style={styles.topSymbol}>{sym}</Text>
          <Text
            style={[
              styles.topChange,
              { color: changeStr.startsWith('+') ? GREEN : RED },
            ]}
          >
            {changeStr || 'Daily Change'}
          </Text>
        </View>

        <View style={styles.topRight}>
          <TouchableOpacity onPress={toggleFavorite} hitSlop={8} testID="fav-btn">
            <Star
              size={18}
              color={isFavorite ? YELLOW : TEXT_DIM}
              fill={isFavorite ? YELLOW : 'transparent'}
              strokeWidth={1.5}
            />
          </TouchableOpacity>
          <Settings2 size={18} color={TEXT_DIM} strokeWidth={1.5} style={{ marginLeft: 14 }} />
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} bounces={false} scrollEnabled={!crosshairVisible}>
        {/* ── Timeframe Bar ──────────────────────────────────────── */}
        <View style={styles.tfBar}>
          {TIMEFRAMES.map((tf) => {
            const active = activeTF === tf;
            return (
              <TouchableOpacity
                key={tf}
                style={styles.tfBtn}
                onPress={() => setActiveTF(tf)}
                activeOpacity={0.7}
                testID={`tf-${tf}`}
              >
                <Text style={[styles.tfText, active && styles.tfTextActive]}>
                  {tf}
                </Text>
                {active && <View style={styles.tfUnderline} />}
              </TouchableOpacity>
            );
          })}
        </View>

        {/* ── Chart ──────────────────────────────────────────────── */}
        <View style={styles.chartWrapper}>
          {isLoading ? (
            <View style={styles.chartLoading}>
              <ActivityIndicator color={GREEN} size="large" />
            </View>
          ) : closes.length < 2 ? (
            <View style={styles.chartLoading}>
              <Text style={styles.noDataText}>No chart data yet</Text>
            </View>
          ) : (
            <View
              style={styles.chartArea}
              {...panResponder.panHandlers}
              testID="chart-area"
            >
              <Svg width={SCREEN_W} height={CHART_H}>
                <Defs>
                  <SvgLinearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1">
                    <Stop offset="0" stopColor={lineColor} stopOpacity="0.35" />
                    <Stop offset="1" stopColor={lineColor} stopOpacity="0" />
                  </SvgLinearGradient>
                </Defs>

                {/* Fill */}
                <Path d={chartFill} fill="url(#chartFill)" />

                {/* Line */}
                <Path
                  d={chartLine}
                  stroke={lineColor}
                  strokeWidth={2.5}
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />

                {/* X-axis labels */}
                {xLabels.map((lbl, i) => (
                  <SvgText
                    key={i}
                    x={lbl.x}
                    y={CHART_H - 6}
                    fill={TEXT_DIM}
                    fontSize={9}
                    textAnchor="middle"
                  >
                    {lbl.label}
                  </SvgText>
                ))}

                {/* Crosshair */}
                {crosshairVisible && crosshairData && (
                  <>
                    <Line
                      x1={crosshairData.x}
                      y1={PAD_TOP}
                      x2={crosshairData.x}
                      y2={CHART_H - PAD_BOTTOM}
                      stroke={TEXT_DIM}
                      strokeWidth={1}
                      strokeDasharray="3,3"
                    />
                    <Line
                      x1={PAD_LEFT}
                      y1={crosshairData.y}
                      x2={SCREEN_W - PAD_RIGHT}
                      y2={crosshairData.y}
                      stroke={TEXT_DIM}
                      strokeWidth={1}
                      strokeDasharray="3,3"
                    />
                    <Rect
                      x={crosshairData.x - 28}
                      y={crosshairData.y - 10}
                      width={56}
                      height={20}
                      rx={4}
                      fill={CARD}
                      stroke={TEXT_DIM}
                      strokeWidth={0.5}
                    />
                    <SvgText
                      x={crosshairData.x}
                      y={crosshairData.y + 5}
                      fill={TEXT_PRIMARY}
                      fontSize={9}
                      textAnchor="middle"
                      fontWeight="600"
                    >
                      {formatDollar(crosshairData.price)}
                    </SvgText>
                  </>
                )}
              </Svg>

              {/* Y-axis labels (right side) */}
              {yLabels.map((lbl, i) => (
                <Text
                  key={i}
                  style={[styles.yLabel, { top: lbl.y - 7 }]}
                >
                  {formatDollar(lbl.price)}
                </Text>
              ))}

              {/* Last price tag */}
              {lastPrice != null && (
                <View
                  style={[
                    styles.priceTag,
                    {
                      top: lastPriceY - 11,
                      backgroundColor: lineColor,
                    },
                  ]}
                >
                  <Text style={styles.priceTagText}>
                    {formatDollar(lastPrice)}
                  </Text>
                </View>
              )}
            </View>
          )}


        </View>

        {/* ── Volume Bars ────────────────────────────────────────── */}
        {!isLoading && closes.length >= 2 && (
          <View style={styles.volContainer}>
            <Svg width={SCREEN_W} height={VOL_H}>
              {volBars.map((bar, i) => (
                <Rect
                  key={i}
                  x={bar.x}
                  y={bar.y}
                  width={BAR_W}
                  height={bar.h}
                  rx={1}
                  fill={bar.isAboveAvg ? GREEN : '#4a5a3a'}
                />
              ))}
              {(['0x', '1x', '2x', '3x'] as const).map((label, i) => (
                <SvgText
                  key={label}
                  x={SCREEN_W - 4}
                  y={VOL_H - (i / 3) * 24 - 2}
                  fill="#555555"
                  fontSize={8}
                  textAnchor="end"
                >
                  {label}
                </SvgText>
              ))}
            </Svg>
          </View>
        )}

        {/* ── Order Entry ────────────────────────────────────────── */}
        <View style={styles.orderEntry}>
          {/* Duration row */}
          <View style={styles.orderSection}>
            <Text style={styles.orderLabel}>Time Duration</Text>
            <View style={styles.orderControlRow}>
              <TouchableOpacity
                style={styles.stepBtn}
                onPress={() => setDurationIdx((p) => Math.max(0, p - 1))}
                activeOpacity={0.7}
              >
                <Text style={styles.stepBtnText}>−</Text>
              </TouchableOpacity>
              <View style={styles.controlPill}>
                <Text style={styles.controlPillText}>{DURATIONS[durationIdx]}</Text>
              </View>
              <TouchableOpacity
                style={styles.stepBtn}
                onPress={() => setDurationIdx((p) => Math.min(DURATIONS.length - 1, p + 1))}
                activeOpacity={0.7}
              >
                <Text style={styles.stepBtnText}>+</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.orderDivider} />

          {/* Amount row */}
          <View style={styles.orderSection}>
            <Text style={styles.orderLabel}>Amount</Text>
            <View style={styles.orderControlRow}>
              <TouchableOpacity
                style={styles.stepBtn}
                onPress={() => setAmount((p) => Math.max(10, p - 20))}
                activeOpacity={0.7}
              >
                <Text style={styles.stepBtnText}>−</Text>
              </TouchableOpacity>
              <View style={styles.controlPill}>
                <Text style={styles.amountPillText}>{formatScaledDollar(amount)}</Text>
              </View>
              <TouchableOpacity
                style={styles.stepBtn}
                onPress={() => setAmount((p) => p + 20)}
                activeOpacity={0.7}
              >
                <Text style={styles.stepBtnText}>+</Text>
              </TouchableOpacity>
            </View>

            {/* Quick amount pills */}
            <View style={styles.quickAmountRow}>
              {QUICK_AMOUNTS.map((qa) => (
                <TouchableOpacity
                  key={qa}
                  style={styles.quickAmountBtn}
                  onPress={() => setAmount((p) => p + qa)}
                  activeOpacity={0.7}
                  testID={`quick-${qa}`}
                >
                  <Text style={styles.quickAmountText}>+{formatScaledDollar(qa)}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>

        {/* ── BUY / SELL Buttons ─────────────────────────────────── */}
        <View style={styles.tradeButtons}>
          <TouchableOpacity
            style={[styles.sellBtn, isSending && { opacity: 0.6 }]}
            onPress={() => handleOrder('SELL')}
            disabled={isSending}
            activeOpacity={0.85}
            testID="sell-btn"
          >
            {isSending ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <>
                <Text style={styles.tradeArrow}>↘</Text>
                <Text style={styles.tradeBtnText}>SELL</Text>
              </>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.buyBtn, isSending && { opacity: 0.6 }]}
            onPress={() => handleOrder('BUY')}
            disabled={isSending}
            activeOpacity={0.85}
            testID="buy-btn"
          >
            {isSending ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <>
                <Text style={styles.tradeArrow}>↗</Text>
                <Text style={styles.tradeBtnText}>BUY</Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        <View style={{ height: insets.bottom + 20 }} />
      </ScrollView>

      {/* ── Toast ─────────────────────────────────────────────────── */}
      <Animated.View
        style={[
          styles.toast,
          {
            opacity: toastAnim,
            transform: [
              {
                translateY: toastAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [20, 0],
                }),
              },
            ],
          },
        ]}
        pointerEvents="none"
      >
        <Text style={styles.toastText}>{toastMsg}</Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BG,
  },

  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: SEP,
  },
  backBtn: {
    marginRight: 4,
  },
  topCenter: {
    flex: 1,
    alignItems: 'center',
  },
  topSymbol: {
    color: TEXT_PRIMARY,
    fontSize: 18,
    fontWeight: '700' as const,
    letterSpacing: 0.5,
  },
  topChange: {
    fontSize: 12,
    fontWeight: '600' as const,
    marginTop: 2,
    letterSpacing: 0.3,
  },
  topRight: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 4,
  },

  tfBar: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: SEP,
    backgroundColor: BG,
  },
  tfBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    position: 'relative',
  },
  tfText: {
    color: TEXT_DIM,
    fontSize: 12,
    fontWeight: '500' as const,
    letterSpacing: 0.3,
  },
  tfTextActive: {
    color: TEXT_PRIMARY,
    fontWeight: '700' as const,
  },
  tfUnderline: {
    position: 'absolute',
    bottom: 0,
    left: '20%',
    right: '20%',
    height: 2,
    backgroundColor: GREEN,
    borderRadius: 1,
  },

  chartWrapper: {
    backgroundColor: BG,
  },
  chartLoading: {
    height: CHART_H,
    justifyContent: 'center',
    alignItems: 'center',
  },
  noDataText: {
    color: TEXT_DIM,
    fontSize: 13,
    letterSpacing: 0.5,
  },
  chartArea: {
    width: SCREEN_W,
    height: CHART_H,
    position: 'relative',
  },
  yLabel: {
    position: 'absolute',
    right: 4,
    color: TEXT_DIM,
    fontSize: 9,
    fontWeight: '500' as const,
  },
  priceTag: {
    position: 'absolute',
    right: 2,
    paddingHorizontal: 5,
    paddingVertical: 3,
    borderRadius: 4,
  },
  priceTagText: {
    color: '#fff',
    fontSize: 9,
    fontWeight: '700' as const,
    letterSpacing: 0.2,
  },
  volContainer: {
    width: SCREEN_W,
    height: VOL_H,
    marginTop: 6,
  },

  orderEntry: {
    backgroundColor: CARD,
    marginHorizontal: 16,
    marginTop: 16,
    borderRadius: 14,
    overflow: 'hidden',
  },
  orderSection: {
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  orderDivider: {
    height: 1,
    backgroundColor: SEP,
  },
  orderLabel: {
    color: TEXT_DIM,
    fontSize: 11,
    fontWeight: '600' as const,
    letterSpacing: 1,
    marginBottom: 10,
  },
  orderControlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  stepBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: BG,
  },
  stepBtnText: {
    color: TEXT_PRIMARY,
    fontSize: 18,
    fontWeight: '300' as const,
    lineHeight: 22,
  },
  controlPill: {
    flex: 1,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    backgroundColor: BG,
    paddingVertical: 8,
    alignItems: 'center',
  },
  controlPillText: {
    color: TEXT_PRIMARY,
    fontSize: 15,
    fontWeight: '600' as const,
    letterSpacing: 0.5,
  },
  amountPillText: {
    color: GREEN,
    fontSize: 18,
    fontWeight: '700' as const,
    letterSpacing: 0.5,
  },
  quickAmountRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  quickAmountBtn: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    backgroundColor: BG,
    paddingVertical: 8,
    alignItems: 'center',
  },
  quickAmountText: {
    color: TEXT_DIM,
    fontSize: 11,
    fontWeight: '500' as const,
  },

  tradeButtons: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingTop: 14,
    gap: 10,
  },
  sellBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 64,
    borderRadius: 14,
    backgroundColor: RED,
    gap: 8,
  },
  buyBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 64,
    borderRadius: 14,
    backgroundColor: GREEN,
    gap: 8,
  },
  tradeArrow: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '700' as const,
  },
  tradeBtnText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '800' as const,
    letterSpacing: 1,
  },

  toast: {
    position: 'absolute',
    bottom: 100,
    alignSelf: 'center',
    backgroundColor: '#1a2a1a',
    borderWidth: 1,
    borderColor: GREEN + '44',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
  },
  toastText: {
    color: GREEN,
    fontSize: 13,
    fontWeight: '600' as const,
    letterSpacing: 0.3,
  },
});
