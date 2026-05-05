import React, { useMemo, useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
  PanResponder,
  Platform,
  TouchableOpacity,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import Svg, {
  Polyline,
  Polygon,
  Line,
  Circle,
  Defs,
  LinearGradient as SvgGrad,
  Stop,
} from 'react-native-svg';

// ─── Time ranges (matches dashboard EquityChart) ────────────────────────────
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

// ─── Theme ──────────────────────────────────────────────────────────────────
const TEXT_PRIMARY = '#ffffff';
const TEXT_DIM = '#888899';
const TEAL = '#00d4aa';
const RED = '#FF6B6B';
const CARD_BG = 'rgba(255,255,255,0.03)';
const CARD_BORDER = 'rgba(255,255,255,0.07)';

// ─── Types ──────────────────────────────────────────────────────────────────
export interface FidelityTrade {
  id: number | string;
  symbol: string;
  qty: number;
  buy_price: number;
  sell_price: number | null;
  current_price: number | null;
  status: 'open' | 'signal' | 'closed';
  created_at: string;
  closed_at: string | null;
}

interface ChartPoint {
  t: number;
  v: number; // cumulative P&L $ at this point in time
  x: number;
  y: number;
}

// ─── Layout ─────────────────────────────────────────────────────────────────
const { width: SCREEN_W } = Dimensions.get('window');
const CHART_W = SCREEN_W - 32;
const CHART_H = 96;
const PAD = { top: 10, bottom: 10, left: 4, right: 4 };
const INNER_W = CHART_W - PAD.left - PAD.right;
const INNER_H = CHART_H - PAD.top - PAD.bottom;

function tapHaptic() {
  if (Platform.OS !== 'web') Haptics.selectionAsync();
}

function formatDollar(v: number): string {
  const sign = v >= 0 ? '+' : '−';
  return `${sign}$${Math.abs(v).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

// ─── Build P&L timeline from manual trades ──────────────────────────────────
// We treat the chart as cumulative-P&L-over-time. Algorithm:
//   1. Sort all events chronologically: each buy is a (t, 0) anchor (no
//      realized P&L yet), each close adds the realized P&L delta to the
//      running total at the close timestamp.
//   2. Add a final "now" point that includes unrealized P&L from any still-open
//      trades, computed against current_price.
// This produces a step-line whose last point reflects current open + closed P&L.
// Build the FULL all-time cumulative-P&L timeline once. The bracket just
// controls which section of this timeline we render — cost basis & P&L
// numbers stay consistent regardless of selected range.
function buildTimeline(trades: FidelityTrade[]): {
  points: { t: number; v: number }[];
  costBasis: number;
} {
  if (!trades || trades.length === 0) return { points: [], costBasis: 0 };

  type Event = { t: number; pnlDelta: number };
  const events: Event[] = [];
  let totalCostBasis = 0;

  for (const tr of trades) {
    const t0 = new Date(tr.created_at).getTime();
    if (Number.isNaN(t0)) continue;
    const buy = Number(tr.buy_price);
    const qty = Number(tr.qty);
    if (!(buy > 0) || !(qty > 0)) continue;

    totalCostBasis += buy * qty;
    events.push({ t: t0, pnlDelta: 0 });

    if (tr.status === 'closed' && tr.closed_at && tr.sell_price != null) {
      const t1 = new Date(tr.closed_at).getTime();
      const sell = Number(tr.sell_price);
      if (!Number.isNaN(t1) && sell > 0) {
        events.push({ t: t1, pnlDelta: (sell - buy) * qty });
      }
    }
  }

  events.sort((a, b) => a.t - b.t);
  let running = 0;
  const points: { t: number; v: number }[] = [];
  for (const e of events) {
    running += e.pnlDelta;
    points.push({ t: e.t, v: running });
  }

  // Add a final "now" point with unrealized P&L from any still-open trades.
  const nowMs = Date.now();
  let unrealized = 0;
  for (const tr of trades) {
    if (tr.status === 'closed') continue;
    const buy = Number(tr.buy_price);
    const cur = Number(tr.current_price);
    const qty = Number(tr.qty);
    if (buy > 0 && cur > 0 && qty > 0) {
      unrealized += (cur - buy) * qty;
    }
  }
  const lastT = points.length > 0 ? points[points.length - 1].t : 0;
  if (nowMs > lastT) {
    points.push({ t: nowMs, v: running + unrealized });
  } else if (points.length > 0) {
    points[points.length - 1] = { t: lastT, v: running + unrealized };
  }

  return { points, costBasis: totalCostBasis };
}

// Slice the all-time timeline down to a viewing window. If the window is
// empty (no events occurred in it), we still draw a flat horizontal line at
// the current cumulative P&L so the chart isn't blank.
function clipToRange(
  full: { t: number; v: number }[],
  rangeStartMs: number | null,
): { t: number; v: number }[] {
  if (rangeStartMs === null || full.length === 0) return full;
  const nowMs = Date.now();
  // Find the cumulative value as of rangeStartMs (last event before the window)
  let baseline = 0;
  for (const p of full) {
    if (p.t <= rangeStartMs) baseline = p.v;
    else break;
  }
  const inRange = full.filter((p) => p.t >= rangeStartMs);
  // Always anchor the line at the start of the window with `baseline`
  const result: { t: number; v: number }[] = [{ t: rangeStartMs, v: baseline }];
  for (const p of inRange) result.push(p);
  // Make sure there's a "now" tail point so the line extends to the right edge
  const last = result[result.length - 1];
  if (last.t < nowMs) {
    result.push({ t: nowMs, v: last.v });
  }
  return result;
}

function interpolateAtX(points: ChartPoint[], x: number): ChartPoint | null {
  if (points.length === 0) return null;
  if (points.length === 1) return points[0];
  if (x <= points[0].x) return points[0];
  if (x >= points[points.length - 1].x) return points[points.length - 1];
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
  const tt = (x - a.x) / span;
  return {
    x,
    y: a.y + (b.y - a.y) * tt,
    v: a.v + (b.v - a.v) * tt,
    t: a.t + (b.t - a.t) * tt,
  };
}

interface FidelityChartProps {
  trades: FidelityTrade[];
}

export default function FidelityChart({ trades }: FidelityChartProps) {
  const [range, setRange] = useState<TimeRange>('1D');
  const rangeStartMs = useMemo(() => {
    const cfg = RANGES.find((r) => r.id === range)!;
    return cfg.ms === null ? null : Date.now() - cfg.ms;
  }, [range]);
  // Build the all-time timeline once, then clip to the visible window.
  // Cost basis & P&L numbers don't change with range — only the chart's view does.
  const { points: fullPoints, costBasis } = useMemo(
    () => buildTimeline(trades),
    [trades],
  );
  const rawPoints = useMemo(
    () => clipToRange(fullPoints, rangeStartMs),
    [fullPoints, rangeStartMs],
  );

  const points: ChartPoint[] = useMemo(() => {
    if (rawPoints.length < 2) return [];
    const ts = rawPoints.map((p) => p.t);
    const vs = rawPoints.map((p) => p.v);
    const tMin = Math.min(...ts);
    const tMax = Math.max(...ts);
    const vMin = Math.min(...vs, 0);
    const vMax = Math.max(...vs, 0);
    const tSpan = tMax - tMin || 1;
    const vSpan = vMax - vMin || 1;
    return rawPoints.map((p, i) => {
      const x = PAD.left + ((ts[i] - tMin) / tSpan) * INNER_W;
      const y = PAD.top + INNER_H - ((vs[i] - vMin) / vSpan) * INNER_H;
      return { t: ts[i], v: vs[i], x, y };
    });
  }, [rawPoints]);

  const [crosshair, setCrosshair] = useState<ChartPoint | null>(null);

  const moveCrosshair = useCallback(
    (locX: number) => {
      const clamped = Math.max(PAD.left, Math.min(locX, PAD.left + INNER_W));
      const p = interpolateAtX(points, clamped);
      if (p) setCrosshair(p);
    },
    [points],
  );

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

  const lastPnl = rawPoints[rawPoints.length - 1]?.v ?? 0;
  const displayPnl = crosshair?.v ?? lastPnl;
  const pnlPct = costBasis > 0 ? (displayPnl / costBasis) * 100 : 0;
  const isUp = displayPnl >= 0;
  const lineColor = isUp ? TEAL : RED;

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

  // Find the y-coord that represents $0 P&L for a baseline
  const zeroY = useMemo(() => {
    if (rawPoints.length < 2) return null;
    const vs = rawPoints.map((p) => p.v);
    const vMin = Math.min(...vs, 0);
    const vMax = Math.max(...vs, 0);
    const span = vMax - vMin || 1;
    return PAD.top + INNER_H - ((0 - vMin) / span) * INNER_H;
  }, [rawPoints]);

  const last = points[points.length - 1] ?? null;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.label}>FIDELITY P&amp;L</Text>
        <Text style={[styles.delta, { color: lineColor }]}>
          {`${isUp ? '+' : '−'}${Math.abs(pnlPct).toFixed(2)}%`}
        </Text>
      </View>

      <View style={styles.bigValueRow}>
        <Text style={[styles.bigValue, { color: lineColor }]}>{formatDollar(displayPnl)}</Text>
        <Text style={styles.basis}>
          on {formatDollar(costBasis).replace('+', '')} cost basis
        </Text>
      </View>

      {points.length < 2 ? (
        <View style={[styles.chartArea, styles.emptyArea]}>
          <Text style={styles.emptyText}>
            {rawPoints.length === 0
              ? 'Log a trade to start the chart'
              : 'Need 2+ events to draw — log another trade or wait for a close'}
          </Text>
        </View>
      ) : (
        <View style={styles.chartArea} {...liveResponder.panHandlers}>
          <Svg width={CHART_W} height={CHART_H}>
            <Defs>
              <SvgGrad id="fidelityFill" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={lineColor} stopOpacity="0.28" />
                <Stop offset="1" stopColor={lineColor} stopOpacity="0" />
              </SvgGrad>
            </Defs>
            {zeroY !== null && (
              <Line
                x1={PAD.left}
                y1={zeroY}
                x2={PAD.left + INNER_W}
                y2={zeroY}
                stroke="rgba(255,255,255,0.10)"
                strokeWidth={0.5}
                strokeDasharray="3,4"
              />
            )}
            <Polygon points={fillPolygon} fill="url(#fidelityFill)" />
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

      {/* Time bracket selector — same set as the dashboard chart */}
      <View style={styles.brackets}>
        {RANGES.map((r) => {
          const active = r.id === range;
          return (
            <TouchableOpacity
              key={r.id}
              style={[
                styles.bracketBtn,
                active && {
                  backgroundColor: lineColor + '22',
                  borderColor: lineColor + '88',
                },
              ]}
              onPress={() => {
                if (Platform.OS !== 'web') Haptics.selectionAsync();
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
    marginBottom: 8,
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
  delta: {
    fontSize: 12,
    fontWeight: '700',
  },
  bigValueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  bigValue: {
    fontSize: 22,
    fontWeight: '700',
  },
  basis: {
    color: TEXT_DIM,
    fontSize: 10,
    fontWeight: '600',
  },
  chartArea: {
    width: CHART_W,
    height: CHART_H,
    alignSelf: 'center',
  },
  emptyArea: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    color: TEXT_DIM,
    fontSize: 11,
    textAlign: 'center',
    paddingHorizontal: 20,
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
