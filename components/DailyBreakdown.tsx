import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import { ChevronRight, ChevronDown } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import type { EnrichedTrade } from '@/lib/pnl';

const TEXT_PRIMARY = '#ffffff';
const TEXT_DIM = '#888899';
const TEAL = '#00d4aa';
const RED = '#FF6B6B';

// ─── Trading day boundary: 8 PM ET ──────────────────────────────────────────
// A trade at 7:59 PM ET counts as "today". A trade at 8:00 PM ET or later
// counts as the next trading day. Independent of the user's phone timezone.

function getETHour(d: Date): number {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    hour12: false,
  });
  // formatToParts is more reliable than parseInt(format(d)) when the value is "24"
  const parts = fmt.formatToParts(d);
  const hourPart = parts.find((p) => p.type === 'hour');
  return parseInt(hourPart?.value ?? '0', 10) % 24;
}

function getETDateParts(d: Date): { y: number; m: number; dd: number } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = fmt.formatToParts(d);
  const y = parseInt(parts.find((p) => p.type === 'year')!.value, 10);
  const m = parseInt(parts.find((p) => p.type === 'month')!.value, 10);
  const dd = parseInt(parts.find((p) => p.type === 'day')!.value, 10);
  return { y, m, dd };
}

/** Group key (YYYY-MM-DD ET) for a trade. After 8 PM ET, rolls to next day. */
function getTradingDayKey(dateISO: string): string {
  const d = new Date(dateISO);
  if (Number.isNaN(d.getTime())) return 'invalid';
  const hour = getETHour(d);
  const target = hour >= 20 ? new Date(d.getTime() + 24 * 60 * 60 * 1000) : d;
  const { y, m, dd } = getETDateParts(target);
  return `${y}-${m.toString().padStart(2, '0')}-${dd.toString().padStart(2, '0')}`;
}

function dayLabelFromKey(key: string): string {
  // Build a Date from the key in ET noon to dodge DST edge cases
  const [y, m, d] = key.split('-').map(Number);
  if (!y || !m || !d) return key;
  const utcNoon = new Date(Date.UTC(y, m - 1, d, 17, 0)); // 17:00 UTC ≈ noon ET-ish
  const today = todayKey();
  const yesterday = yesterdayKey();
  if (key === today) return 'Today';
  if (key === yesterday) return 'Yesterday';
  return utcNoon.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function todayKey(): string {
  return getTradingDayKey(new Date().toISOString());
}
function yesterdayKey(): string {
  const d = new Date(Date.now() - 24 * 60 * 60 * 1000);
  return getTradingDayKey(d.toISOString());
}

// ─── Bucketing ──────────────────────────────────────────────────────────────

interface DayBucket {
  dateKey: string;
  dayLabel: string;
  trades: EnrichedTrade[];
  pnlDollar: number;
}

function bucketByTradingDay(trades: EnrichedTrade[]): DayBucket[] {
  const map = new Map<string, EnrichedTrade[]>();
  for (const t of trades) {
    if (!t.is_closed) continue;
    const key = getTradingDayKey(t.created_at);
    if (key === 'invalid') continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(t);
  }
  const buckets: DayBucket[] = [];
  for (const [key, list] of map.entries()) {
    const pnlDollar = list.reduce((s, t) => s + t.pnl_dollar, 0);
    buckets.push({
      dateKey: key,
      dayLabel: dayLabelFromKey(key),
      trades: list.sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      ),
      pnlDollar,
    });
  }
  buckets.sort((a, b) => (a.dateKey < b.dateKey ? 1 : -1));
  return buckets;
}

function formatDollar(v: number): string {
  const sign = v >= 0 ? '+' : '−';
  return `${sign}$${Math.abs(v).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

// ─── Card component ─────────────────────────────────────────────────────────

type DayMode = 'wins' | 'losses' | 'all';

interface DayCardProps {
  bucket: DayBucket;
  mode: DayMode;
}

function DayCard({ bucket, mode }: DayCardProps) {
  const [expanded, setExpanded] = useState(false);
  const accent = mode === 'losses' ? RED : mode === 'wins' ? TEAL : bucket.pnlDollar >= 0 ? TEAL : RED;
  const verb = mode === 'wins' ? 'won' : mode === 'losses' ? 'lost' : 'P&L';
  const tradeNoun = bucket.trades.length === 1 ? 'trade' : 'trades';

  const toggle = () => {
    if (Platform.OS !== 'web') Haptics.selectionAsync();
    setExpanded((v) => !v);
  };

  return (
    <View style={[styles.card, { borderLeftColor: accent + 'CC' }]}>
      <TouchableOpacity onPress={toggle} activeOpacity={0.75} style={styles.headerRow}>
        <View style={styles.headerLeft}>
          <Text style={styles.dayLabel}>{bucket.dayLabel}</Text>
          <Text style={styles.subText}>
            {bucket.trades.length} {tradeNoun}
            {mode !== 'all' ? ` ${verb}` : ''}
          </Text>
        </View>
        <View style={styles.headerRight}>
          <Text style={[styles.pnlBig, { color: accent }]}>
            {formatDollar(bucket.pnlDollar)}
          </Text>
          {expanded ? (
            <ChevronDown size={16} color={TEXT_DIM} />
          ) : (
            <ChevronRight size={16} color={TEXT_DIM} />
          )}
        </View>
      </TouchableOpacity>

      {expanded && (
        <View style={styles.expandedBody}>
          {bucket.trades.map((t, i) => {
            const tColor = t.pnl_dollar >= 0 ? TEAL : RED;
            const time = new Date(t.created_at).toLocaleTimeString('en-US', {
              hour: 'numeric',
              minute: '2-digit',
              hour12: true,
              timeZone: 'America/New_York',
            });
            return (
              <View
                key={t.id}
                style={[
                  styles.tradeRow,
                  i === bucket.trades.length - 1 && { borderBottomWidth: 0 },
                ]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.tradeSym}>{t.symbol}</Text>
                  <Text style={styles.tradeMeta}>
                    {t.qty} @ ${t.entry_price.toFixed(2)} → ${t.exit_price.toFixed(2)} · {time}
                  </Text>
                </View>
                <View style={styles.tradePnl}>
                  <Text style={[styles.tradePnlDollar, { color: tColor }]}>
                    {formatDollar(t.pnl_dollar)}
                  </Text>
                  <Text style={[styles.tradePnlPct, { color: tColor }]}>
                    {t.pnl_pct >= 0 ? '+' : ''}
                    {t.pnl_pct.toFixed(2)}%
                  </Text>
                </View>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

// ─── Main component ─────────────────────────────────────────────────────────

interface DailyBreakdownProps {
  closedTrades: EnrichedTrade[];
  /** Filter trades for the day cards. WINS/LOSSES tabs use the matching filter. */
  filter?: DayMode;
}

export default function DailyBreakdown({
  closedTrades,
  filter = 'all',
}: DailyBreakdownProps) {
  const filtered = useMemo(() => {
    if (filter === 'wins') return closedTrades.filter((t) => t.pnl_dollar > 0);
    if (filter === 'losses') return closedTrades.filter((t) => t.pnl_dollar < 0);
    return closedTrades;
  }, [closedTrades, filter]);

  const buckets = useMemo(() => bucketByTradingDay(filtered), [filtered]);

  if (buckets.length === 0) {
    const emptyText =
      filter === 'wins'
        ? 'No winning trades yet'
        : filter === 'losses'
          ? 'No losing trades yet'
          : 'No closed trades yet';
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>{emptyText}</Text>
      </View>
    );
  }

  return (
    <View>
      {buckets.map((b) => (
        <DayCard key={b.dateKey} bucket={b} mode={filter} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  empty: {
    paddingVertical: 28,
    alignItems: 'center',
  },
  emptyText: {
    color: TEXT_DIM,
    fontSize: 12,
  },
  card: {
    marginHorizontal: 12,
    marginBottom: 8,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
    borderLeftWidth: 3,
    overflow: 'hidden',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 12,
  },
  headerLeft: {
    flex: 1,
  },
  dayLabel: {
    color: TEXT_PRIMARY,
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  subText: {
    color: TEXT_DIM,
    fontSize: 11,
    marginTop: 2,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  pnlBig: {
    fontSize: 15,
    fontWeight: '700',
  },
  expandedBody: {
    paddingHorizontal: 12,
    paddingBottom: 8,
    paddingTop: 2,
  },
  tradeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.04)',
  },
  tradeSym: {
    color: TEXT_PRIMARY,
    fontSize: 12,
    fontWeight: '700',
  },
  tradeMeta: {
    color: TEXT_DIM,
    fontSize: 10,
    marginTop: 1,
  },
  tradePnl: {
    alignItems: 'flex-end',
  },
  tradePnlDollar: {
    fontSize: 12,
    fontWeight: '700',
  },
  tradePnlPct: {
    fontSize: 10,
    fontWeight: '600',
    marginTop: 1,
  },
});
