import React, { useMemo, useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
  PanResponder,
  Platform,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { useQuery } from '@tanstack/react-query';
import Svg, {
  Polyline,
  Polygon,
  Line,
  Circle,
  Defs,
  LinearGradient as SvgGrad,
  Stop,
} from 'react-native-svg';
import { supabase } from '@/lib/supabase';

// ─── Theme (matches Dashboard) ──────────────────────────────────────────────
const TEXT_PRIMARY = '#ffffff';
const TEXT_DIM = '#888899';
const TEAL = '#00d4aa';
const RED = '#FF6B6B';
const CARD_BG = 'rgba(255,255,255,0.03)';
const CARD_BORDER = 'rgba(255,255,255,0.07)';

// ─── Time ranges ────────────────────────────────────────────────────────────
type TimeRange = '1H' | '1D' | '1W' | '1M' | '3M' | '1Y' | 'ALL';

const RANGES: { id: TimeRange; label: string; ms: number | null }[] = [
  { id: '1H', label: '1H', ms: 60 * 60 * 1000 },
  { id: '1D', label: '1D', ms: 24 * 60 * 60 * 1000 },
  { id: '1W', label: '1W', ms: 7 * 24 * 60 * 60 * 1000 },
  { id: '1M', label: '1M', ms: 30 * 24 * 60 * 60 * 1000 },
  { id: '3M', label: '3M', ms: 90 * 24 * 60 * 60 * 1000 },
  { id: '1Y', label: '1Y', ms: 365 * 24 * 60 * 60 * 1000 },
  { id: 'ALL', label: 'ALL', ms: null },
];

interface EquityRow {
  timestamp: string;
  equity: number;
}

interface ChartPoint {
  t: number; // ms epoch
  v: number; // equity value
  x: number; // pixel x
  y: number; // pixel y
}

// ─── Data fetch ─────────────────────────────────────────────────────────────
function useEquitySeries(range: TimeRange) {
  return useQuery<EquityRow[]>({
    queryKey: ['equity-series', range],
    queryFn: async () => {
      const cfg = RANGES.find((r) => r.id === range)!;
      let q = supabase
        .from('equity_snapshots')
        .select('timestamp, equity')
        .order('timestamp', { ascending: true });
      if (cfg.ms !== null) {
        const cutoff = new Date(Date.now() - cfg.ms).toISOString();
        q = q.gte('timestamp', cutoff);
      }
      const { data, error } = await q;
      if (error) {
        console.log('[EquityChart] fetch error:', error.message);
        return [];
      }
      const rows = (data ?? []) as EquityRow[];
      // Coerce equity to number; drop bad rows
      return rows
        .map((r) => ({ timestamp: r.timestamp, equity: Number(r.equity) }))
        .filter((r) => Number.isFinite(r.equity));
    },
    refetchInterval: 30_000,
    staleTime: 10_000,
  });
}

// ─── Smooth interpolated point lookup ───────────────────────────────────────
// Given finger x in pixels and a list of plotted points, find the value at
// that x by linearly interpolating between the two flanking data points.
function interpolateAtX(points: ChartPoint[], x: number): ChartPoint | null {
  if (points.length === 0) return null;
  if (points.length === 1) return points[0];
  if (x <= points[0].x) return points[0];
  if (x >= points[points.length - 1].x) return points[points.length - 1];
  // Binary search for the segment containing x
  let lo = 0;
  let hi = points.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid].x <= x) lo = mid;
    else hi = mid;
  }
  const a = points[lo];
  const b = points[hi];
  const span = b.x - a.x || 1;
  const t = (x - a.x) / span;
  return {
    x,
    y: a.y + (b.y - a.y) * t,
    v: a.v + (b.v - a.v) * t,
    t: a.t + (b.t - a.t) * t,
  };
}

// ─── Chart component ────────────────────────────────────────────────────────
const { width: SCREEN_W } = Dimensions.get('window');
const CHART_W = SCREEN_W - 32;
const CHART_H_FULL = 160;
const CHART_H_COMPACT = 96;
const PAD = { top: 10, bottom: 12, left: 4, right: 4 };
const INNER_W = CHART_W - PAD.left - PAD.right;

function tapHaptic() {
  if (Platform.OS !== 'web') Haptics.selectionAsync();
}

function formatRelativeTime(t: number, range: TimeRange): string {
  const d = new Date(t);
  if (range === '1H') {
    return d.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  }
  if (range === '1D') {
    return d.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  }
  if (range === '1W' || range === '1M') {
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', hour12: true });
  }
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
}

function formatDollar(v: number): string {
  return `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

interface EquityChartProps {
  /** Compact mode shrinks the chart to fit on the Positions screen alongside other content. */
  compact?: boolean;
}

export default function EquityChart({ compact = false }: EquityChartProps) {
  const [range, setRange] = useState<TimeRange>('1D');
  const seriesQuery = useEquitySeries(range);
  const CHART_H = compact ? CHART_H_COMPACT : CHART_H_FULL;
  const INNER_H = CHART_H - PAD.top - PAD.bottom;

  // Raw values from the data, regardless of whether the chart can draw.
  // We fall back to these when there's only 1 data point (chart needs ≥2 to
  // draw a line, but the big number at the top should still show the value).
  const rawRows = seriesQuery.data ?? [];
  const rawFirst = rawRows[0]?.equity ?? 0;
  const rawLast = rawRows[rawRows.length - 1]?.equity ?? rawFirst;

  // Project raw rows onto chart pixel space (only if 2+ points).
  const points: ChartPoint[] = useMemo(() => {
    const rows = seriesQuery.data ?? [];
    if (rows.length < 2) return [];
    const ts = rows.map((r) => new Date(r.timestamp).getTime());
    const vs = rows.map((r) => r.equity);
    const tMin = Math.min(...ts);
    const tMax = Math.max(...ts);
    const vMin = Math.min(...vs);
    const vMax = Math.max(...vs);
    const tSpan = tMax - tMin || 1;
    const vSpan = vMax - vMin || 1;
    return rows.map((r, i) => {
      const x = PAD.left + ((ts[i] - tMin) / tSpan) * INNER_W;
      const y = PAD.top + INNER_H - ((vs[i] - vMin) / vSpan) * INNER_H;
      return { t: ts[i], v: vs[i], x, y };
    });
  }, [seriesQuery.data, INNER_H]);

  const firstValue = points[0]?.v ?? rawFirst;
  const lastValue = points[points.length - 1]?.v ?? rawLast;
  const isUp = lastValue >= firstValue;
  const lineColor = isUp ? TEAL : RED;
  const deltaAbs = lastValue - firstValue;
  const deltaPct = firstValue > 0 ? (deltaAbs / firstValue) * 100 : 0;

  // Crosshair state — null when finger is up
  const [crosshair, setCrosshair] = useState<ChartPoint | null>(null);

  const moveCrosshair = useCallback(
    (locX: number) => {
      const clamped = Math.max(PAD.left, Math.min(locX, PAD.left + INNER_W));
      const p = interpolateAtX(points, clamped);
      if (p) setCrosshair(p);
    },
    [points],
  );

  // PanResponder needs a stable identity, but moveCrosshair is rebuilt every
  // time `points` changes. We bridge that with a ref so the handler always
  // calls the latest moveCrosshair without recreating the responder.
  const moveRef = useRef(moveCrosshair);
  moveRef.current = moveCrosshair;

  const liveResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        tapHaptic();
        moveRef.current(e.nativeEvent.locationX);
      },
      onPanResponderMove: (e) => moveRef.current(e.nativeEvent.locationX),
      onPanResponderRelease: () => setCrosshair(null),
      onPanResponderTerminate: () => setCrosshair(null),
    }),
  ).current;

  // Polyline points string + filled-area polygon for gradient fill
  const polyPoints = useMemo(
    () => points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '),
    [points],
  );
  const fillPolygon = useMemo(() => {
    if (points.length < 2) return '';
    const baseY = PAD.top + INNER_H;
    const head = `${points[0].x.toFixed(1)},${baseY.toFixed(1)}`;
    const body = points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    const tail = `${points[points.length - 1].x.toFixed(1)},${baseY.toFixed(1)}`;
    return `${head} ${body} ${tail}`;
  }, [points]);

  const last = points[points.length - 1] ?? null;

  const displayValue = crosshair?.v ?? lastValue;
  const displayDelta = displayValue - firstValue;
  const displayDeltaPct = firstValue > 0 ? (displayDelta / firstValue) * 100 : 0;
  const displayColor = displayDelta >= 0 ? TEAL : RED;

  // ─── Render ───
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.label}>EQUITY · {range}</Text>
        <Text style={[styles.deltaText, { color: displayColor }]}>
          {displayDelta >= 0 ? '+' : '−'}{formatDollar(Math.abs(displayDelta))} ({displayDelta >= 0 ? '+' : '−'}
          {Math.abs(displayDeltaPct).toFixed(2)}%)
        </Text>
      </View>

      <View style={styles.bigValueRow}>
        <Text style={styles.bigValue}>{formatDollar(displayValue)}</Text>
        {crosshair && (
          <Text style={styles.crosshairTime}>{formatRelativeTime(crosshair.t, range)}</Text>
        )}
      </View>

      {points.length < 2 ? (
        <View style={[styles.chartArea, styles.emptyArea, { height: CHART_H }]}>
          <Text style={styles.emptyText}>
            {seriesQuery.isLoading
              ? 'Loading…'
              : rawRows.length === 1
                ? 'One data point — chart will draw once the bot writes more'
                : 'Not enough data for this range yet'}
          </Text>
        </View>
      ) : (
        <View style={[styles.chartArea, { height: CHART_H }]} {...liveResponder.panHandlers}>
          <Svg width={CHART_W} height={CHART_H}>
            <Defs>
              <SvgGrad id="equityFill" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={lineColor} stopOpacity="0.28" />
                <Stop offset="1" stopColor={lineColor} stopOpacity="0" />
              </SvgGrad>
            </Defs>
            {/* baseline (start-of-range) reference dashed line */}
            {(() => {
              const yVals = points.map((p) => p.y);
              const minY = Math.min(...yVals);
              const maxY = Math.max(...yVals);
              const span = maxY - minY || 1;
              const startV = points[0].v;
              const baselineY =
                PAD.top + INNER_H -
                ((startV - Math.min(...points.map((p) => p.v))) /
                  (Math.max(...points.map((p) => p.v)) - Math.min(...points.map((p) => p.v)) || 1)) *
                  INNER_H;
              return (
                <Line
                  x1={PAD.left}
                  y1={baselineY}
                  x2={PAD.left + INNER_W}
                  y2={baselineY}
                  stroke="rgba(255,255,255,0.10)"
                  strokeWidth={0.5}
                  strokeDasharray="3,4"
                />
              );
            })()}
            <Polygon points={fillPolygon} fill="url(#equityFill)" />
            <Polyline
              points={polyPoints}
              fill="none"
              stroke={lineColor}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            {!crosshair && last && (
              <>
                <Circle cx={last.x} cy={last.y} r={3.5} fill={lineColor} />
                <Circle cx={last.x} cy={last.y} r={7} fill={lineColor} opacity={0.25} />
              </>
            )}
            {crosshair && (
              <>
                <Line
                  x1={crosshair.x}
                  y1={PAD.top}
                  x2={crosshair.x}
                  y2={PAD.top + INNER_H}
                  stroke="rgba(255,255,255,0.4)"
                  strokeWidth={1}
                  strokeDasharray="3,4"
                />
                <Circle cx={crosshair.x} cy={crosshair.y} r={7} fill={lineColor} opacity={0.22} />
                <Circle cx={crosshair.x} cy={crosshair.y} r={4} fill={lineColor} />
                <Circle cx={crosshair.x} cy={crosshair.y} r={2} fill={'#ffffff'} />
              </>
            )}
          </Svg>
        </View>
      )}

      <View style={styles.brackets}>
        {RANGES.map((r) => {
          const active = r.id === range;
          return (
            <TouchableOpacity
              key={r.id}
              style={[styles.bracketBtn, active && { backgroundColor: lineColor + '22', borderColor: lineColor + '88' }]}
              onPress={() => {
                tapHaptic();
                setRange(r.id);
                setCrosshair(null);
              }}
              activeOpacity={0.7}
            >
              <Text
                style={[
                  styles.bracketText,
                  active && { color: lineColor, fontWeight: '700' as const },
                ]}
              >
                {r.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginHorizontal: 12,
    marginTop: 8,
    marginBottom: 6,
    padding: 12,
    borderRadius: 14,
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: CARD_BORDER,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 2,
  },
  label: {
    color: TEXT_DIM,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.1,
  },
  deltaText: {
    fontSize: 11,
    fontWeight: '700',
  },
  bigValueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  bigValue: {
    color: TEXT_PRIMARY,
    fontSize: 24,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  crosshairTime: {
    color: TEXT_DIM,
    fontSize: 10,
    fontWeight: '600',
  },
  chartArea: {
    width: CHART_W,
    alignSelf: 'center',
  },
  emptyArea: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    color: TEXT_DIM,
    fontSize: 12,
  },
  brackets: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 6,
    gap: 3,
  },
  bracketBtn: {
    flex: 1,
    paddingVertical: 5,
    borderRadius: 6,
    alignItems: 'center',
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  bracketText: {
    color: TEXT_DIM,
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.4,
  },
});
