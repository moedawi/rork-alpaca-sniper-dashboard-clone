import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Modal,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Animated,
  Alert,
  FlatList,
  RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import {
  BookOpen,
  Plus,
  TrendingUp,
  TrendingDown,
  X,
  Check,
  Bell,
  DollarSign,
  Hash,
  AlertTriangle,
  Clock,
  CheckCircle,
  Pencil,
  LogOut,
  Target,
  Zap,
  BarChart2,
  ChevronDown,
  Trophy,
} from 'lucide-react-native';
import * as Notifications from 'expo-notifications';
import { supabase } from '@/lib/supabase';
import FidelityChart, { FidelityTrade } from '@/components/FidelityChart';

// ─── Theme ────────────────────────────────────────────────────────────────────
const BG_TOP = '#0a0a1a';
const BG_BOT = '#0d1117';
const TEXT_PRIMARY = '#ffffff';
const TEXT_DIM = '#888899';
const TEAL = '#00d4aa';
const AMBER = '#F59E0B';
const ACCENT_GREEN = '#2EE89A';
const ACCENT_RED = '#FF6B6B';
const ACCENT_ORANGE = '#FF9F43';
const LIMIT_GOLD = '#FFD60A';
const LIMIT_ORANGE = '#FF9500';
const CARD_BG = 'rgba(255,255,255,0.04)';
const CARD_BORDER = 'rgba(255,255,255,0.08)';

// ─── Types ────────────────────────────────────────────────────────────────────
interface ManualTrade {
  id: number;
  symbol: string;
  qty: number;
  buy_price: number;
  sell_price: number | null;
  current_price: number | null;
  target_price: number | null;
  status: 'open' | 'signal' | 'closed';
  signal_type: string | null;
  pnl: number | null;
  pnl_pct: number | null;
  created_at: string;
  closed_at: string | null;
}

interface MarketMoverPrice {
  symbol: string;
  price: number;
  signal: string | null;
}

// ─── Notifications setup ──────────────────────────────────────────────────────
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

async function requestNotificationPermissions() {
  const { status } = await Notifications.requestPermissionsAsync({
    ios: {
      allowAlert: true,
      allowSound: true,
      allowBadge: false,
      allowProvisional: false,
    },
  });
  return status === 'granted';
}

async function sendLimitAlert(symbol: string, price: number, targetPrice: number) {
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: `🎯 LIMIT HIT: ${symbol}`,
        body: `Price ${price.toFixed(2)} reached your target of ${targetPrice.toFixed(2)}. Tap to sell.`,
        data: { symbol, price, targetPrice },
      },
      trigger: null,
    });
  } catch {
    // Notifications not available on all platforms
  }
}

async function sendSellAlert(symbol: string, signalType: string, price: number) {
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: `🚨 SELL SIGNAL: ${symbol}`,
        body: `${signalType} — Suggested sell @ $${price.toFixed(2)}. Tap to confirm.`,
        data: { symbol, signalType, price },
      },
      trigger: null,
    });
  } catch {
    // Notifications not available on all platforms
  }
}

// ─── Market hours helper (8 AM – 8 PM ET) ───────────────────────────────────
function isMarketHours(): boolean {
  try {
    const etHour = parseInt(
      new Intl.DateTimeFormat('en-US', {
        hour: 'numeric',
        hour12: false,
        timeZone: 'America/New_York',
      }).format(new Date()),
      10
    );
    return etHour >= 8 && etHour < 20;
  } catch {
    return false;
  }
}

// ─── Yahoo Finance price fetch ───────────────────────────────────────────────
async function fetchYahooPrice(symbol: string): Promise<number | null> {
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1m&range=1d`,
      { headers: { Accept: 'application/json' } }
    );
    if (!res.ok) return null;
    const json = await res.json() as { chart?: { result?: Array<{ meta?: { regularMarketPrice?: number } }> } };
    const price = json?.chart?.result?.[0]?.meta?.regularMarketPrice;
    return typeof price === 'number' ? price : null;
  } catch {
    return null;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatDate(ts: string): string {
  try {
    return new Date(ts).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return '';
  }
}

// ─── Animated pulsing border for signal alerts ────────────────────────────────
function PulsingBorder({ children }: { children: React.ReactNode }) {
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(anim, { toValue: 1, duration: 900, useNativeDriver: false }),
        Animated.timing(anim, { toValue: 0, duration: 900, useNativeDriver: false }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [anim]);

  const borderColor = anim.interpolate({
    inputRange: [0, 1],
    outputRange: ['rgba(255,107,107,0.3)', 'rgba(255,107,107,0.85)'],
  });

  return (
    <Animated.View style={[pulseStyles.wrap, { borderColor }]}>
      {children}
    </Animated.View>
  );
}

const pulseStyles = StyleSheet.create({
  wrap: {
    borderRadius: 16,
    borderWidth: 1.5,
    marginBottom: 10,
    overflow: 'hidden',
  },
});

// ─── Signal Alert Card ────────────────────────────────────────────────────────
interface SignalCardProps {
  trade: ManualTrade;
  currentPrice: number | undefined;
  yahooPrice?: number;
  onConfirmSell: (trade: ManualTrade) => void;
}

function SignalCard({ trade, currentPrice, yahooPrice, onConfirmSell }: SignalCardProps) {
  const livePrice = yahooPrice ?? trade.current_price ?? currentPrice;
  const suggestedPrice = trade.sell_price ?? livePrice ?? trade.buy_price;
  const livePnl = (suggestedPrice - trade.buy_price) * trade.qty;
  const livePnlPct = ((suggestedPrice - trade.buy_price) / trade.buy_price) * 100;
  const isProfit = livePnl >= 0;

  const hasTarget = trade.target_price != null && livePrice != null && livePrice > 0;
  const tgt = trade.target_price as number;
  const pctAway = hasTarget ? ((tgt - livePrice!) / livePrice!) * 100 : 0;
  const hit = hasTarget && livePrice! >= tgt;

  return (
    <View style={signalStyles.card}>
      {/* Header — symbol + how-far-from-target indicator (no AVWAP / no SELL SIGNAL) */}
      <View style={signalStyles.header}>
        <Text style={signalStyles.symbol}>{trade.symbol}</Text>
        {hasTarget ? (
          <View style={[signalStyles.targetChip, hit && signalStyles.targetChipHit]}>
            <Target size={9} color={hit ? LIMIT_GOLD : LIMIT_ORANGE} strokeWidth={2.4} />
            <Text style={[signalStyles.targetChipText, { color: hit ? LIMIT_GOLD : LIMIT_ORANGE }]}>
              {hit ? '🎯 HIT' : `${pctAway >= 0 ? '+' : ''}${pctAway.toFixed(2)}% to $${tgt.toFixed(2)}`}
            </Text>
          </View>
        ) : (
          <Text style={signalStyles.noTarget}>no target</Text>
        )}
      </View>

      {/* Prices row */}
      <View style={signalStyles.pricesRow}>
        <View style={signalStyles.priceItem}>
          <Text style={signalStyles.priceLabel}>BUY</Text>
          <Text style={signalStyles.priceValue}>${trade.buy_price.toFixed(2)}</Text>
        </View>
        <View style={signalStyles.arrow}>
          <TrendingUp size={13} color={TEXT_DIM} strokeWidth={2} />
        </View>
        <View style={signalStyles.priceItem}>
          <Text style={signalStyles.priceLabel}>NOW</Text>
          <Text style={[signalStyles.priceValue, { color: isProfit ? ACCENT_GREEN : ACCENT_RED }]}>
            ${suggestedPrice.toFixed(2)}
          </Text>
        </View>
        <View style={signalStyles.pnlItem}>
          <Text style={signalStyles.priceLabel}>P&L</Text>
          <Text style={[signalStyles.pnlValue, { color: isProfit ? ACCENT_GREEN : ACCENT_RED }]}>
            {isProfit ? '+' : '-'}${Math.abs(livePnl).toFixed(2)}
          </Text>
          <Text style={[signalStyles.pnlPct, { color: isProfit ? ACCENT_GREEN : ACCENT_RED }]}>
            {isProfit ? '+' : ''}{livePnlPct.toFixed(2)}%
          </Text>
        </View>
      </View>

      <TouchableOpacity
        style={signalStyles.confirmBtn}
        onPress={() => onConfirmSell(trade)}
        activeOpacity={0.8}
      >
        <Check size={12} color={TEXT_PRIMARY} strokeWidth={2.5} />
        <Text style={signalStyles.confirmBtnText}>LOG SELL · {trade.qty} shares</Text>
      </TouchableOpacity>
    </View>
  );
}

const signalStyles = StyleSheet.create({
  card: {
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    borderRadius: 12,
    padding: 9,
    marginBottom: 6,
    gap: 6,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  symbol: {
    color: TEXT_PRIMARY,
    fontSize: 13,
    fontWeight: '800' as const,
    letterSpacing: 0.3,
  },
  noTarget: {
    color: TEXT_DIM,
    fontSize: 10,
    fontStyle: 'italic',
  },
  targetChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 3,
    backgroundColor: 'rgba(255,149,0,0.08)',
    borderRadius: 5,
    borderWidth: 1,
    borderColor: 'rgba(255,149,0,0.3)',
  },
  targetChipHit: {
    backgroundColor: 'rgba(255,214,10,0.12)',
    borderColor: 'rgba(255,214,10,0.45)',
  },
  targetChipText: {
    fontSize: 10,
    fontWeight: '700' as const,
    letterSpacing: 0.2,
  },
  pricesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  priceItem: {
    gap: 1,
  },
  priceLabel: {
    color: TEXT_DIM,
    fontSize: 8,
    fontWeight: '600' as const,
    letterSpacing: 1,
  },
  priceValue: {
    color: TEXT_PRIMARY,
    fontSize: 11,
    fontWeight: '700' as const,
    letterSpacing: 0.2,
  },
  arrow: {
    opacity: 0.5,
  },
  pnlItem: {
    flex: 1,
    alignItems: 'flex-end',
    gap: 0,
  },
  pnlValue: {
    fontSize: 12,
    fontWeight: '800' as const,
    letterSpacing: 0.2,
  },
  pnlPct: {
    fontSize: 9,
    fontWeight: '600' as const,
    letterSpacing: 0.3,
  },
  confirmBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    backgroundColor: 'rgba(255,107,107,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,107,107,0.45)',
    paddingVertical: 7,
    borderRadius: 8,
  },
  confirmBtnText: {
    color: ACCENT_RED,
    fontSize: 10,
    fontWeight: '800' as const,
    letterSpacing: 0.6,
  },
});

// ─── closePosition: sends SELL command to bot_control ───────────────────────
async function closePosition(symbol: string): Promise<void> {
  const command = `SELL_${symbol.toUpperCase()}`;
  const { error } = await supabase
    .from('bot_control')
    .insert({ value: command });
  if (error) throw new Error(error.message);
}

// ─── Open Trade Row ───────────────────────────────────────────────────────────
interface OpenTradeRowProps {
  trade: ManualTrade;
  fallbackPrice: number | undefined;
  yahooPrice?: number;
  onSell: (trade: ManualTrade) => void;
  onEdit: (trade: ManualTrade) => void;
  onSetLimit: (trade: ManualTrade) => void;
  onClosePosition: (symbol: string) => void;
}

function OpenTradeRow({ trade, fallbackPrice, yahooPrice, onSell, onEdit, onSetLimit, onClosePosition }: OpenTradeRowProps) {
  const livePrice: number | null =
    yahooPrice != null
      ? yahooPrice
      : trade.current_price != null
      ? trade.current_price
      : (fallbackPrice ?? null);

  const pnlDollar = livePrice !== null ? (livePrice - trade.buy_price) * trade.qty : null;
  const pnlPct = livePrice !== null ? ((livePrice - trade.buy_price) / trade.buy_price) * 100 : null;
  const isProfit = pnlDollar !== null && pnlDollar >= 0;
  const pnlColor = pnlDollar === null ? TEXT_DIM : (isProfit ? ACCENT_GREEN : ACCENT_RED);

  const hasTarget = trade.target_price !== null && trade.target_price !== undefined;
  const limitHit = hasTarget && livePrice !== null && livePrice >= (trade.target_price as number);

  return (
    <View style={[openStyles.card, limitHit && openStyles.cardLimitHit]}>
      {/* LIMIT HIT banner */}
      {limitHit && (
        <View style={openStyles.limitHitBanner}>
          <Zap size={11} color='#0a0a1a' strokeWidth={2.5} />
          <Text style={openStyles.limitHitText}>LIMIT HIT — SELL NOW</Text>
          <Text style={openStyles.limitHitPrice}>${(trade.target_price as number).toFixed(2)}</Text>
        </View>
      )}

      {/* Top row: symbol + P&L */}
      <View style={openStyles.topRow}>
        <View style={openStyles.left}>
          <View style={openStyles.symbolRow}>
            <Text style={openStyles.symbol}>{trade.symbol}</Text>
            <View style={openStyles.openBadge}>
              <Text style={openStyles.openBadgeText}>OPEN</Text>
            </View>
          </View>
          <Text style={openStyles.date}>{trade.qty} sh · {formatDate(trade.created_at)}</Text>
        </View>
        <View style={openStyles.pnlBlock}>
          {pnlDollar !== null ? (
            <>
              <Text style={[openStyles.pnl, { color: pnlColor }]}>
                {isProfit ? '+' : '-'}${Math.abs(pnlDollar).toFixed(2)}
              </Text>
              <View style={[openStyles.pctBadge, { backgroundColor: pnlColor + '18' }]}>
                {isProfit
                  ? <TrendingUp size={9} color={pnlColor} strokeWidth={2.5} />
                  : <TrendingDown size={9} color={pnlColor} strokeWidth={2.5} />
                }
                <Text style={[openStyles.pct, { color: pnlColor }]}>
                  {isProfit ? '+' : ''}{(pnlPct as number).toFixed(2)}%
                </Text>
              </View>
            </>
          ) : (
            <Text style={[openStyles.pnl, { color: TEXT_DIM }]}>—</Text>
          )}
        </View>
      </View>

      {/* Price comparison row */}
      <View style={openStyles.priceRow}>
        <View style={openStyles.priceBlock}>
          <Text style={openStyles.priceLabel}>BUY</Text>
          <Text style={openStyles.priceValue}>${trade.buy_price.toFixed(2)}</Text>
        </View>
        <View style={openStyles.priceSep}>
          <TrendingUp size={10} color={TEXT_DIM} strokeWidth={2} opacity={0.4} />
        </View>
        <View style={openStyles.priceBlock}>
          <Text style={openStyles.priceLabel}>CURRENT</Text>
          {livePrice !== null ? (
            <Text style={[openStyles.priceValue, { color: isProfit ? ACCENT_GREEN : ACCENT_RED }]}>
              ${livePrice.toFixed(2)}
            </Text>
          ) : (
            <Text style={[openStyles.priceValue, { color: TEXT_DIM }]}>—</Text>
          )}
        </View>
        {hasTarget && !limitHit && (() => {
          const tgt = trade.target_price as number;
          const pctAway =
            livePrice !== null && livePrice > 0
              ? ((tgt - livePrice) / livePrice) * 100
              : null;
          return (
            <View style={openStyles.targetBlock}>
              <Target size={9} color={LIMIT_ORANGE} strokeWidth={2} />
              <Text style={openStyles.targetText}>
                ${tgt.toFixed(2)}
                {pctAway !== null && (
                  <Text style={{ color: TEXT_DIM, fontWeight: '500' as const }}>
                    {'  ('}+{pctAway.toFixed(2)}% away{')'}
                  </Text>
                )}
              </Text>
            </View>
          );
        })()}
        <View style={{ flex: 1 }} />
      </View>

      {/* Action buttons */}
      <View style={openStyles.actionRow}>
        <TouchableOpacity
          style={openStyles.editBtn}
          onPress={() => onEdit(trade)}
          activeOpacity={0.75}
        >
          <Pencil size={11} color={TEXT_DIM} strokeWidth={2} />
          <Text style={openStyles.editBtnText}>EDIT</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={openStyles.limitBtn}
          onPress={() => onSetLimit(trade)}
          activeOpacity={0.75}
        >
          <Target size={11} color={hasTarget ? LIMIT_ORANGE : TEXT_DIM} strokeWidth={2} />
          <Text style={[openStyles.limitBtnText, hasTarget && { color: LIMIT_ORANGE }]}>
            {hasTarget ? 'LIMIT' : 'SET LIMIT'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[openStyles.sellBtn, limitHit && openStyles.sellBtnHot]}
          onPress={() => onSell(trade)}
          activeOpacity={0.8}
        >
          <LogOut size={11} color={limitHit ? '#0a0a1a' : ACCENT_RED} strokeWidth={2.5} />
          <Text style={[openStyles.sellBtnText, limitHit && { color: '#0a0a1a' }]}>LOG SELL</Text>
        </TouchableOpacity>
      </View>

      {/* Bot SELL command button */}
      <TouchableOpacity
        style={openStyles.closePosBtn}
        onPress={() => onClosePosition(trade.symbol)}
        activeOpacity={0.8}
      >
        <Text style={openStyles.closePosBtnText}>❌ SELL {trade.symbol}</Text>
      </TouchableOpacity>
    </View>
  );
}

const openStyles = StyleSheet.create({
  card: {
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginBottom: 6,
    backgroundColor: CARD_BG,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    gap: 6,
    overflow: 'hidden',
  },
  cardLimitHit: {
    borderColor: LIMIT_GOLD + '80',
    backgroundColor: 'rgba(255,214,10,0.04)',
  },
  limitHitBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: LIMIT_GOLD,
    marginHorizontal: -14,
    marginTop: -14,
    paddingHorizontal: 14,
    paddingVertical: 7,
    marginBottom: 4,
  },
  limitHitText: {
    flex: 1,
    color: '#0a0a1a',
    fontSize: 11,
    fontWeight: '800' as const,
    letterSpacing: 0.8,
  },
  limitHitPrice: {
    color: '#0a0a1a',
    fontSize: 11,
    fontWeight: '800' as const,
    letterSpacing: 0.5,
  },
  targetBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginLeft: 4,
  },
  targetText: {
    color: LIMIT_ORANGE,
    fontSize: 10,
    fontWeight: '600' as const,
    letterSpacing: 0.3,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  left: {
    gap: 3,
  },
  symbolRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  symbol: {
    color: TEXT_PRIMARY,
    fontSize: 13,
    fontWeight: '700' as const,
    letterSpacing: 0.3,
  },
  openBadge: {
    backgroundColor: 'rgba(0,212,170,0.15)',
    paddingHorizontal: 4,
    paddingVertical: 1,
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
  date: {
    color: TEXT_DIM,
    fontSize: 10,
    opacity: 0.6,
    letterSpacing: 0.1,
  },
  pnlBlock: {
    alignItems: 'flex-end',
    gap: 4,
  },
  pnl: {
    fontSize: 12,
    fontWeight: '700' as const,
    letterSpacing: 0.2,
  },
  pctBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 5,
  },
  pct: {
    fontSize: 9,
    fontWeight: '700' as const,
    letterSpacing: 0.2,
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  priceBlock: {
    gap: 2,
  },
  priceLabel: {
    color: TEXT_DIM,
    fontSize: 8,
    fontWeight: '700' as const,
    letterSpacing: 1.2,
  },
  priceValue: {
    color: TEXT_PRIMARY,
    fontSize: 11,
    fontWeight: '700' as const,
    letterSpacing: 0.2,
  },
  priceSep: {
    paddingBottom: 2,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 8,
    paddingTop: 2,
  },
  editBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 7,
  },
  editBtnText: {
    color: TEXT_DIM,
    fontSize: 9,
    fontWeight: '700' as const,
    letterSpacing: 0.8,
  },
  limitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255,149,0,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,149,0,0.2)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 7,
  },
  limitBtnText: {
    color: TEXT_DIM,
    fontSize: 9,
    fontWeight: '700' as const,
    letterSpacing: 0.7,
  },
  sellBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: 'rgba(255,107,107,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255,107,107,0.3)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 7,
  },
  sellBtnHot: {
    backgroundColor: LIMIT_GOLD,
    borderColor: LIMIT_GOLD,
  },
  sellBtnText: {
    color: ACCENT_RED,
    fontSize: 9,
    fontWeight: '800' as const,
    letterSpacing: 0.7,
  },
  closePosBtn: {
    width: '100%',
    backgroundColor: '#FF4444',
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closePosBtnText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '800' as const,
    letterSpacing: 0.8,
  },
});

// ─── Closed Trade Row ─────────────────────────────────────────────────────────
function ClosedTradeRow({ trade }: { trade: ManualTrade }) {
  const pnl = trade.pnl ?? 0;
  const pnlPct = trade.pnl_pct ?? 0;
  const isProfit = pnl >= 0;
  const pnlColor = isProfit ? ACCENT_GREEN : ACCENT_RED;

  return (
    <View style={closedStyles.card}>
      {/* Header row */}
      <View style={closedStyles.headerRow}>
        <View style={closedStyles.symbolRow}>
          <CheckCircle size={14} color={pnlColor} strokeWidth={2} opacity={0.8} />
          <Text style={closedStyles.symbol}>{trade.symbol}</Text>
          <View style={[closedStyles.badge, { backgroundColor: pnlColor + '15', borderColor: pnlColor + '40' }]}>
            <Text style={[closedStyles.badgeText, { color: pnlColor }]}>
              {isProfit ? 'WIN' : 'LOSS'}
            </Text>
          </View>
        </View>
        <View style={closedStyles.pnlBlock}>
          <Text style={[closedStyles.pnlDollar, { color: pnlColor }]}>
            {isProfit ? '+' : '-'}${Math.abs(pnl).toFixed(2)}
          </Text>
          <Text style={[closedStyles.pnlPct, { color: pnlColor }]}>
            {isProfit ? '+' : ''}{pnlPct.toFixed(2)}%
          </Text>
        </View>
      </View>

      {/* Price row */}
      <View style={closedStyles.priceRow}>
        <View style={closedStyles.priceBlock}>
          <Text style={closedStyles.priceLabel}>BUY</Text>
          <Text style={closedStyles.priceValue}>${trade.buy_price.toFixed(2)}</Text>
        </View>
        <View style={closedStyles.arrow}>
          <TrendingUp size={10} color={TEXT_DIM} strokeWidth={2} opacity={0.4} />
        </View>
        <View style={closedStyles.priceBlock}>
          <Text style={closedStyles.priceLabel}>SOLD</Text>
          <Text style={[closedStyles.priceValue, { color: pnlColor }]}>
            ${(trade.sell_price ?? 0).toFixed(2)}
          </Text>
        </View>
        <View style={{ flex: 1 }} />
        <View style={closedStyles.sharesBlock}>
          <Text style={closedStyles.priceLabel}>SHARES</Text>
          <Text style={closedStyles.priceValue}>{trade.qty}</Text>
        </View>
      </View>

      {/* Date */}
      <Text style={closedStyles.date}>
        Closed {formatDate(trade.closed_at ?? trade.created_at)}
      </Text>
    </View>
  );
}

const closedStyles = StyleSheet.create({
  card: {
    paddingVertical: 14,
    paddingHorizontal: 14,
    marginBottom: 8,
    backgroundColor: CARD_BG,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    gap: 9,
    opacity: 0.9,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  symbolRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  symbol: {
    color: TEXT_PRIMARY,
    fontSize: 16,
    fontWeight: '700' as const,
    letterSpacing: 0.3,
  },
  badge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
  },
  badgeText: {
    fontSize: 8,
    fontWeight: '800' as const,
    letterSpacing: 1,
  },
  pnlBlock: {
    alignItems: 'flex-end',
    gap: 1,
  },
  pnlDollar: {
    fontSize: 15,
    fontWeight: '700' as const,
    letterSpacing: 0.2,
  },
  pnlPct: {
    fontSize: 11,
    fontWeight: '600' as const,
    letterSpacing: 0.2,
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  priceBlock: {
    gap: 2,
  },
  sharesBlock: {
    gap: 2,
    alignItems: 'flex-end',
  },
  arrow: {
    paddingBottom: 2,
  },
  priceLabel: {
    color: TEXT_DIM,
    fontSize: 8,
    fontWeight: '700' as const,
    letterSpacing: 1.2,
  },
  priceValue: {
    color: TEXT_PRIMARY,
    fontSize: 14,
    fontWeight: '700' as const,
    letterSpacing: 0.2,
  },
  date: {
    color: TEXT_DIM,
    fontSize: 10,
    opacity: 0.6,
    letterSpacing: 0.1,
  },
});

// ─── Section Header ───────────────────────────────────────────────────────────
function SectionHeader({ title, count, color = TEXT_DIM }: { title: string; count: number; color?: string }) {
  return (
    <View style={sectionStyles.header}>
      <Text style={[sectionStyles.title, { color }]}>{title}</Text>
      <View style={sectionStyles.countBadge}>
        <Text style={sectionStyles.countText}>{count}</Text>
      </View>
    </View>
  );
}

const sectionStyles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  title: {
    fontSize: 11,
    fontWeight: '700' as const,
    letterSpacing: 1.5,
  },
  countBadge: {
    minWidth: 20,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
  },
  countText: {
    color: TEXT_DIM,
    fontSize: 10,
    fontWeight: '700' as const,
  },
});

// ─── Sell Confirmation / Log Sell Modal ───────────────────────────────────────
interface SellModalProps {
  trade: ManualTrade;
  currentPrice: number | undefined;
  onConfirm: (tradeId: number, sellPrice: number) => void;
  onClose: () => void;
  isLoading: boolean;
}

function SellConfirmModal({ trade, currentPrice, onConfirm, onClose, isLoading }: SellModalProps) {
  const insets = useSafeAreaInsets();
  const suggestedPrice = trade.current_price ?? currentPrice ?? trade.sell_price ?? trade.buy_price;
  const [sellPrice, setSellPrice] = useState(suggestedPrice.toFixed(2));

  const spNum = parseFloat(sellPrice) || 0;
  const pnl = (spNum - trade.buy_price) * trade.qty;
  const pnlPct = ((spNum - trade.buy_price) / trade.buy_price) * 100;
  const isProfit = pnl >= 0;
  const pnlColor = isProfit ? ACCENT_GREEN : ACCENT_RED;

  return (
    <Modal transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <TouchableOpacity style={sellStyles.overlay} activeOpacity={1} onPress={onClose} />
        <View style={[sellStyles.sheet, { paddingBottom: insets.bottom + 24 }]}>
          <View style={sellStyles.handle} />

          <View style={sellStyles.header}>
            <View>
              <Text style={sellStyles.title}>Log Sell</Text>
              <Text style={sellStyles.subtitle}>{trade.symbol} · {trade.qty} shares</Text>
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <X size={20} color={TEXT_DIM} strokeWidth={2} />
            </TouchableOpacity>
          </View>

          <View style={sellStyles.summaryRow}>
            <View style={sellStyles.summaryItem}>
              <Text style={sellStyles.summaryLabel}>BUY PRICE</Text>
              <Text style={sellStyles.summaryValue}>${trade.buy_price.toFixed(2)}</Text>
            </View>
            <View style={sellStyles.summaryDivider} />
            <View style={sellStyles.summaryItem}>
              <Text style={sellStyles.summaryLabel}>SHARES</Text>
              <Text style={sellStyles.summaryValue}>{trade.qty}</Text>
            </View>
            <View style={sellStyles.summaryDivider} />
            <View style={sellStyles.summaryItem}>
              <Text style={sellStyles.summaryLabel}>P&L</Text>
              <Text style={[sellStyles.summaryValue, { color: pnlColor }]}>
                {isProfit ? '+' : '-'}${Math.abs(pnl).toFixed(2)}
              </Text>
              <Text style={[sellStyles.summaryPct, { color: pnlColor }]}>
                {isProfit ? '+' : ''}{pnlPct.toFixed(2)}%
              </Text>
            </View>
          </View>

          <View style={sellStyles.inputGroup}>
            <Text style={sellStyles.inputLabel}>SELL PRICE</Text>
            <View style={sellStyles.inputWrap}>
              <DollarSign size={16} color={AMBER} strokeWidth={2} />
              <TextInput
                style={sellStyles.input}
                value={sellPrice}
                onChangeText={setSellPrice}
                keyboardType="decimal-pad"
                placeholder="0.00"
                placeholderTextColor={TEXT_DIM}
                selectTextOnFocus
              />
            </View>
          </View>

          <TouchableOpacity
            style={[sellStyles.confirmBtn, isLoading && { opacity: 0.6 }]}
            onPress={() => onConfirm(trade.id, spNum)}
            disabled={isLoading || spNum <= 0}
            activeOpacity={0.8}
          >
            {isLoading ? (
              <ActivityIndicator color={TEXT_PRIMARY} size="small" />
            ) : (
              <>
                <Check size={16} color={TEXT_PRIMARY} strokeWidth={2.5} />
                <Text style={sellStyles.confirmBtnText}>CONFIRM SELL @ ${spNum.toFixed(2)}</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const sellStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  sheet: {
    backgroundColor: '#0f0f20',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    borderTopWidth: 1,
    borderColor: CARD_BORDER,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignSelf: 'center',
    marginBottom: 20,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  title: {
    color: TEXT_PRIMARY,
    fontSize: 20,
    fontWeight: '700' as const,
    letterSpacing: 0.3,
  },
  subtitle: {
    color: TEXT_DIM,
    fontSize: 13,
    marginTop: 2,
    letterSpacing: 0.2,
  },
  summaryRow: {
    flexDirection: 'row',
    backgroundColor: CARD_BG,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    padding: 16,
    marginBottom: 20,
  },
  summaryItem: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  summaryLabel: {
    color: TEXT_DIM,
    fontSize: 9,
    fontWeight: '600' as const,
    letterSpacing: 1.4,
  },
  summaryValue: {
    color: TEXT_PRIMARY,
    fontSize: 15,
    fontWeight: '700' as const,
  },
  summaryPct: {
    fontSize: 11,
    fontWeight: '600' as const,
  },
  summaryDivider: {
    width: 1,
    backgroundColor: CARD_BORDER,
    marginHorizontal: 8,
  },
  inputGroup: {
    marginBottom: 20,
    gap: 8,
  },
  inputLabel: {
    color: TEXT_DIM,
    fontSize: 10,
    fontWeight: '700' as const,
    letterSpacing: 1.5,
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: `${AMBER}40`,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  input: {
    flex: 1,
    color: TEXT_PRIMARY,
    fontSize: 20,
    fontWeight: '600' as const,
    letterSpacing: 0.3,
  },
  confirmBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: ACCENT_RED,
    paddingVertical: 14,
    borderRadius: 14,
  },
  confirmBtnText: {
    color: TEXT_PRIMARY,
    fontSize: 15,
    fontWeight: '800' as const,
    letterSpacing: 0.8,
  },
});

// ─── Edit Trade Modal ─────────────────────────────────────────────────────────
interface EditModalProps {
  trade: ManualTrade;
  onSave: (id: number, symbol: string, qty: number, buyPrice: number) => void;
  onClose: () => void;
  isLoading: boolean;
}

function EditTradeModal({ trade, onSave, onClose, isLoading }: EditModalProps) {
  const insets = useSafeAreaInsets();
  const [symbol, setSymbol] = useState(trade.symbol);
  const [qty, setQty] = useState(String(trade.qty));
  const [buyPrice, setBuyPrice] = useState(String(trade.buy_price));

  const canSave =
    symbol.trim().length > 0 && parseFloat(qty) > 0 && parseFloat(buyPrice) > 0;

  return (
    <Modal transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <TouchableOpacity style={editStyles.overlay} activeOpacity={1} onPress={onClose} />
        <View style={[editStyles.sheet, { paddingBottom: insets.bottom + 24 }]}>
          <View style={editStyles.handle} />

          <View style={editStyles.header}>
            <View>
              <Text style={editStyles.title}>Edit Trade</Text>
              <Text style={editStyles.subtitle}>Update position details</Text>
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <X size={20} color={TEXT_DIM} strokeWidth={2} />
            </TouchableOpacity>
          </View>

          {/* Symbol */}
          <View style={editStyles.inputGroup}>
            <Text style={editStyles.inputLabel}>SYMBOL</Text>
            <View style={editStyles.inputWrap}>
              <TextInput
                style={[editStyles.input, { letterSpacing: 1.2 }]}
                value={symbol}
                onChangeText={(t) => setSymbol(t.toUpperCase())}
                placeholder="AAPL"
                placeholderTextColor={TEXT_DIM}
                autoCapitalize="characters"
                autoCorrect={false}
              />
            </View>
          </View>

          {/* Qty */}
          <View style={editStyles.inputGroup}>
            <Text style={editStyles.inputLabel}>QUANTITY (SHARES)</Text>
            <View style={editStyles.inputWrap}>
              <Hash size={15} color={TEAL} strokeWidth={2} />
              <TextInput
                style={editStyles.input}
                value={qty}
                onChangeText={setQty}
                keyboardType="decimal-pad"
                placeholder="100"
                placeholderTextColor={TEXT_DIM}
                selectTextOnFocus
              />
            </View>
          </View>

          {/* Buy Price */}
          <View style={editStyles.inputGroup}>
            <Text style={editStyles.inputLabel}>BUY PRICE</Text>
            <View style={editStyles.inputWrap}>
              <DollarSign size={15} color={TEAL} strokeWidth={2} />
              <TextInput
                style={editStyles.input}
                value={buyPrice}
                onChangeText={setBuyPrice}
                keyboardType="decimal-pad"
                placeholder="0.00"
                placeholderTextColor={TEXT_DIM}
                selectTextOnFocus
              />
            </View>
          </View>

          <TouchableOpacity
            style={[editStyles.saveBtn, (!canSave || isLoading) && { opacity: 0.4 }]}
            onPress={() => {
              if (canSave) {
                onSave(trade.id, symbol.trim(), parseFloat(qty), parseFloat(buyPrice));
              }
            }}
            disabled={!canSave || isLoading}
            activeOpacity={0.8}
          >
            {isLoading ? (
              <ActivityIndicator color={'#0a0a1a'} size="small" />
            ) : (
              <>
                <Check size={16} color={'#0a0a1a'} strokeWidth={2.5} />
                <Text style={editStyles.saveBtnText}>SAVE CHANGES</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const editStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  sheet: {
    backgroundColor: '#0f0f20',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    borderTopWidth: 1,
    borderColor: CARD_BORDER,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignSelf: 'center',
    marginBottom: 20,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  title: {
    color: TEXT_PRIMARY,
    fontSize: 20,
    fontWeight: '700' as const,
    letterSpacing: 0.3,
  },
  subtitle: {
    color: TEXT_DIM,
    fontSize: 13,
    marginTop: 2,
    letterSpacing: 0.2,
  },
  inputGroup: {
    marginBottom: 16,
    gap: 8,
  },
  inputLabel: {
    color: TEXT_DIM,
    fontSize: 10,
    fontWeight: '700' as const,
    letterSpacing: 1.5,
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: `${TEAL}40`,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  input: {
    flex: 1,
    color: TEXT_PRIMARY,
    fontSize: 18,
    fontWeight: '600' as const,
    letterSpacing: 0.3,
  },
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: TEAL,
    paddingVertical: 14,
    borderRadius: 14,
    marginTop: 4,
  },
  saveBtnText: {
    color: '#0a0a1a',
    fontSize: 15,
    fontWeight: '800' as const,
    letterSpacing: 0.8,
  },
});

// ─── Set Limit Modal ─────────────────────────────────────────────────────────
interface SetLimitModalProps {
  trade: ManualTrade;
  currentPrice: number | undefined;
  onSave: (tradeId: number, targetPrice: number | null) => void;
  onClose: () => void;
  isLoading: boolean;
}

function SetLimitModal({ trade, currentPrice, onSave, onClose, isLoading }: SetLimitModalProps) {
  const insets = useSafeAreaInsets();
  const suggested = trade.target_price ?? currentPrice ?? trade.buy_price;
  const [targetPrice, setTargetPrice] = useState(
    trade.target_price != null ? String(trade.target_price) : ''
  );

  const tpNum = parseFloat(targetPrice);
  const isValid = !isNaN(tpNum) && tpNum > 0;
  const upside = isValid ? ((tpNum - trade.buy_price) / trade.buy_price) * 100 : null;

  return (
    <Modal transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <TouchableOpacity style={limitModalStyles.overlay} activeOpacity={1} onPress={onClose} />
        <View style={[limitModalStyles.sheet, { paddingBottom: insets.bottom + 24 }]}>
          <View style={limitModalStyles.handle} />

          <View style={limitModalStyles.header}>
            <View>
              <View style={limitModalStyles.titleRow}>
                <Target size={18} color={LIMIT_ORANGE} strokeWidth={2} />
                <Text style={limitModalStyles.title}>Set Limit Price</Text>
              </View>
              <Text style={limitModalStyles.subtitle}>{trade.symbol} · {trade.qty} shares</Text>
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <X size={20} color={TEXT_DIM} strokeWidth={2} />
            </TouchableOpacity>
          </View>

          {/* Info row */}
          <View style={limitModalStyles.infoRow}>
            <View style={limitModalStyles.infoItem}>
              <Text style={limitModalStyles.infoLabel}>BUY PRICE</Text>
              <Text style={limitModalStyles.infoValue}>${trade.buy_price.toFixed(2)}</Text>
            </View>
            {currentPrice != null && (
              <>
                <View style={limitModalStyles.infoDivider} />
                <View style={limitModalStyles.infoItem}>
                  <Text style={limitModalStyles.infoLabel}>CURRENT</Text>
                  <Text style={limitModalStyles.infoValue}>${currentPrice.toFixed(2)}</Text>
                </View>
              </>
            )}
            {isValid && upside !== null && (
              <>
                <View style={limitModalStyles.infoDivider} />
                <View style={limitModalStyles.infoItem}>
                  <Text style={limitModalStyles.infoLabel}>UPSIDE</Text>
                  <Text style={[limitModalStyles.infoValue, { color: upside >= 0 ? ACCENT_GREEN : ACCENT_RED }]}>
                    {upside >= 0 ? '+' : ''}{upside.toFixed(2)}%
                  </Text>
                </View>
              </>
            )}
          </View>

          {/* Target price input */}
          <View style={limitModalStyles.inputGroup}>
            <Text style={limitModalStyles.inputLabel}>TARGET PRICE</Text>
            <View style={limitModalStyles.inputWrap}>
              <Target size={16} color={LIMIT_ORANGE} strokeWidth={2} />
              <TextInput
                style={limitModalStyles.input}
                value={targetPrice}
                onChangeText={setTargetPrice}
                keyboardType="decimal-pad"
                placeholder={String(suggested.toFixed(2))}
                placeholderTextColor={TEXT_DIM}
                selectTextOnFocus
                autoFocus
              />
            </View>
            <Text style={limitModalStyles.hint}>
              Alert fires when current price ≥ target
            </Text>
          </View>

          <View style={limitModalStyles.btnRow}>
            {trade.target_price != null && (
              <TouchableOpacity
                style={limitModalStyles.clearBtn}
                onPress={() => onSave(trade.id, null)}
                disabled={isLoading}
                activeOpacity={0.8}
              >
                <X size={14} color={TEXT_DIM} strokeWidth={2} />
                <Text style={limitModalStyles.clearBtnText}>CLEAR</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[limitModalStyles.saveBtn, (!isValid || isLoading) && { opacity: 0.4 }, { flex: 1 }]}
              onPress={() => { if (isValid) onSave(trade.id, tpNum); }}
              disabled={!isValid || isLoading}
              activeOpacity={0.8}
            >
              {isLoading ? (
                <ActivityIndicator color='#0a0a1a' size="small" />
              ) : (
                <>
                  <Target size={15} color='#0a0a1a' strokeWidth={2.5} />
                  <Text style={limitModalStyles.saveBtnText}>
                    SET LIMIT @ ${isValid ? tpNum.toFixed(2) : '—'}
                  </Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const limitModalStyles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' },
  sheet: {
    backgroundColor: '#0f0f20',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    borderTopWidth: 1,
    borderColor: `${LIMIT_ORANGE}40`,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignSelf: 'center',
    marginBottom: 20,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  title: {
    color: TEXT_PRIMARY,
    fontSize: 20,
    fontWeight: '700' as const,
    letterSpacing: 0.3,
  },
  subtitle: {
    color: TEXT_DIM,
    fontSize: 13,
    letterSpacing: 0.2,
  },
  infoRow: {
    flexDirection: 'row',
    backgroundColor: CARD_BG,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    padding: 14,
    marginBottom: 20,
  },
  infoItem: { flex: 1, alignItems: 'center', gap: 4 },
  infoLabel: {
    color: TEXT_DIM,
    fontSize: 9,
    fontWeight: '600' as const,
    letterSpacing: 1.4,
  },
  infoValue: {
    color: TEXT_PRIMARY,
    fontSize: 14,
    fontWeight: '700' as const,
  },
  infoDivider: { width: 1, backgroundColor: CARD_BORDER, marginHorizontal: 8 },
  inputGroup: { marginBottom: 20, gap: 8 },
  inputLabel: {
    color: TEXT_DIM,
    fontSize: 10,
    fontWeight: '700' as const,
    letterSpacing: 1.5,
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: `${LIMIT_ORANGE}50`,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  input: {
    flex: 1,
    color: TEXT_PRIMARY,
    fontSize: 22,
    fontWeight: '600' as const,
    letterSpacing: 0.3,
  },
  hint: {
    color: TEXT_DIM,
    fontSize: 11,
    letterSpacing: 0.2,
    opacity: 0.7,
  },
  btnRow: { flexDirection: 'row', gap: 10 },
  clearBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: CARD_BORDER,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 14,
  },
  clearBtnText: {
    color: TEXT_DIM,
    fontSize: 13,
    fontWeight: '700' as const,
    letterSpacing: 0.5,
  },
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: LIMIT_GOLD,
    paddingVertical: 14,
    borderRadius: 14,
  },
  saveBtnText: {
    color: '#0a0a1a',
    fontSize: 15,
    fontWeight: '800' as const,
    letterSpacing: 0.6,
  },
});

// ─── Buy Form Modal ───────────────────────────────────────────────────────────
interface BuyFormProps {
  movers: MarketMoverPrice[];
  onSubmit: (symbol: string, qty: number, buyPrice: number) => void;
  onClose: () => void;
  isLoading: boolean;
}

function BuyFormModal({ movers: _movers, onSubmit, onClose, isLoading }: BuyFormProps) {
  const insets = useSafeAreaInsets();
  const [symbol, setSymbol] = useState('');
  const [qty, setQty] = useState('');
  const [buyPrice, setBuyPrice] = useState('');

  const canSubmit = symbol.trim().length > 0 && parseFloat(qty) > 0 && parseFloat(buyPrice) > 0;

  return (
    <Modal transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <TouchableOpacity style={buyStyles.overlay} activeOpacity={1} onPress={onClose} />
        <View style={[buyStyles.sheet, { paddingBottom: insets.bottom + 24 }]}>
          <View style={buyStyles.handle} />

          <View style={buyStyles.header}>
            <Text style={buyStyles.title}>Log Buy Trade</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <X size={20} color={TEXT_DIM} strokeWidth={2} />
            </TouchableOpacity>
          </View>

          {/* Symbol Input */}
          <View style={buyStyles.inputGroup}>
            <Text style={buyStyles.inputLabel}>SYMBOL</Text>
            <View style={buyStyles.inputWrap}>
              <TextInput
                style={[buyStyles.input, { letterSpacing: 1.2 }]}
                value={symbol}
                onChangeText={(t) => setSymbol(t.toUpperCase())}
                placeholder="AAPL"
                placeholderTextColor={TEXT_DIM}
                autoCapitalize="characters"
                autoCorrect={false}
                returnKeyType="next"
              />
            </View>
          </View>

          {/* Qty */}
          <View style={buyStyles.inputGroup}>
            <Text style={buyStyles.inputLabel}>QUANTITY (SHARES)</Text>
            <View style={buyStyles.inputWrap}>
              <Hash size={15} color={TEAL} strokeWidth={2} />
              <TextInput
                style={buyStyles.input}
                value={qty}
                onChangeText={setQty}
                keyboardType="decimal-pad"
                placeholder="100"
                placeholderTextColor={TEXT_DIM}
              />
            </View>
          </View>

          {/* Buy Price */}
          <View style={buyStyles.inputGroup}>
            <Text style={buyStyles.inputLabel}>BUY PRICE</Text>
            <View style={buyStyles.inputWrap}>
              <DollarSign size={15} color={TEAL} strokeWidth={2} />
              <TextInput
                style={buyStyles.input}
                value={buyPrice}
                onChangeText={setBuyPrice}
                keyboardType="decimal-pad"
                placeholder="0.00"
                placeholderTextColor={TEXT_DIM}
              />
            </View>
          </View>

          {/* Cost preview */}
          {canSubmit && (
            <View style={buyStyles.previewRow}>
              <Text style={buyStyles.previewLabel}>TOTAL COST</Text>
              <Text style={buyStyles.previewValue}>
                ${(parseFloat(qty) * parseFloat(buyPrice)).toFixed(2)}
              </Text>
            </View>
          )}

          <TouchableOpacity
            style={[buyStyles.submitBtn, (!canSubmit || isLoading) && { opacity: 0.4 }]}
            onPress={() => {
              if (canSubmit) {
                onSubmit(symbol.trim(), parseFloat(qty), parseFloat(buyPrice));
              }
            }}
            disabled={!canSubmit || isLoading}
            activeOpacity={0.8}
          >
            {isLoading ? (
              <ActivityIndicator color={TEXT_PRIMARY} size="small" />
            ) : (
              <>
                <Plus size={16} color={TEXT_PRIMARY} strokeWidth={2.5} />
                <Text style={buyStyles.submitBtnText}>LOG BUY · {symbol || '—'}</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const buyStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  sheet: {
    backgroundColor: '#0f0f20',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    borderTopWidth: 1,
    borderColor: CARD_BORDER,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignSelf: 'center',
    marginBottom: 20,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  title: {
    color: TEXT_PRIMARY,
    fontSize: 20,
    fontWeight: '700' as const,
    letterSpacing: 0.3,
  },
  inputGroup: {
    marginBottom: 16,
    gap: 8,
  },
  inputLabel: {
    color: TEXT_DIM,
    fontSize: 10,
    fontWeight: '700' as const,
    letterSpacing: 1.5,
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: `${TEAL}40`,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  input: {
    flex: 1,
    color: TEXT_PRIMARY,
    fontSize: 18,
    fontWeight: '600' as const,
    letterSpacing: 0.3,
  },
  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(0,212,170,0.06)',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(0,212,170,0.15)',
  },
  previewLabel: {
    color: TEAL,
    fontSize: 10,
    fontWeight: '700' as const,
    letterSpacing: 1.4,
  },
  previewValue: {
    color: TEAL,
    fontSize: 16,
    fontWeight: '700' as const,
    letterSpacing: 0.3,
  },
  submitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: TEAL,
    paddingVertical: 14,
    borderRadius: 14,
  },
  submitBtnText: {
    color: '#0a0a1a',
    fontSize: 15,
    fontWeight: '800' as const,
    letterSpacing: 0.8,
  },
});

// ─── helpers ─────────────────────────────────────────────────────────────────
function isTodayET(ts: string): boolean {
  try {
    const opts: Intl.DateTimeFormatOptions = {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    };
    return (
      new Date(ts).toLocaleDateString('en-US', opts) ===
      new Date().toLocaleDateString('en-US', opts)
    );
  } catch {
    return false;
  }
}

// ─── Bottom Summary Bar ────────────────────────────────────────────────────────
interface BottomSummaryBarProps {
  trades: ManualTrade[];
  openTrades: ManualTrade[];
  yahooPriceMap: Record<string, number>;
  priceMap: Record<string, number>;
  bottomInset: number;
}

function BottomSummaryBar({ trades, openTrades, yahooPriceMap, priceMap, bottomInset }: BottomSummaryBarProps) {
  const getLivePrice = (t: ManualTrade): number | null =>
    yahooPriceMap[t.symbol] ?? t.current_price ?? priceMap[t.symbol] ?? null;

  const todayClosedPnl = trades
    .filter((t) => t.status === 'closed' && t.closed_at != null && isTodayET(t.closed_at))
    .reduce((s, t) => s + (t.pnl ?? 0), 0);

  const todayOpenPnl = trades
    .filter((t) => (t.status === 'open' || t.status === 'signal') && isTodayET(t.created_at))
    .reduce((s, t) => {
      const lp = getLivePrice(t);
      return lp !== null ? s + (lp - t.buy_price) * t.qty : s;
    }, 0);

  const dailyPnl = todayClosedPnl + todayOpenPnl;

  const totalClosedPnl = trades
    .filter((t) => t.status === 'closed')
    .reduce((s, t) => s + (t.pnl ?? 0), 0);

  const totalOpenPnl = trades
    .filter((t) => t.status === 'open' || t.status === 'signal')
    .reduce((s, t) => {
      const lp = getLivePrice(t);
      return lp !== null ? s + (lp - t.buy_price) * t.qty : s;
    }, 0);

  const totalPnl = totalClosedPnl + totalOpenPnl;
  const openCount = trades.filter((t) => t.status === 'open' || t.status === 'signal').length;

  const dailyColor = dailyPnl >= 0 ? ACCENT_GREEN : ACCENT_RED;
  const totalColor = totalPnl >= 0 ? ACCENT_GREEN : ACCENT_RED;
  const dotColor = openCount > 0 ? TEAL : TEXT_DIM;

  const fmtPnl = (val: number) => `${val >= 0 ? '+' : '-'}${Math.abs(val).toFixed(2)}`;

  // ── At Target projection ──
  const atTargetInfo = useMemo(() => {
    const withLimit = openTrades.filter(
      (t) => t.target_price !== null && t.target_price !== undefined
    );
    if (withLimit.length === 0) return null;
    const gain = withLimit.reduce(
      (s, t) => s + ((t.target_price as number) - t.buy_price) * t.qty,
      0
    );
    const invested = withLimit.reduce((s, t) => s + t.buy_price * t.qty, 0);
    const pct = invested > 0 ? (gain / invested) * 100 : 0;
    return { gain, pct };
  }, [openTrades]);

  return (
    <View style={bottomBarStyles.container}>
      {/* Frosted top edge */}
      <View style={bottomBarStyles.topEdge} />

      <View style={bottomBarStyles.pillsRow}>
        {/* TODAY pill */}
        <View style={[bottomBarStyles.pill, { borderColor: dailyColor + '35' }]}>
          <Text style={bottomBarStyles.pillLabel}>TODAY</Text>
          <Text style={[bottomBarStyles.pillValue, { color: dailyColor }]}>
            {fmtPnl(dailyPnl)}
          </Text>
        </View>

        {/* TOTAL pill */}
        <View style={[bottomBarStyles.pill, { borderColor: totalColor + '35' }]}>
          <Text style={bottomBarStyles.pillLabel}>TOTAL</Text>
          <Text style={[bottomBarStyles.pillValue, { color: totalColor }]}>
            {fmtPnl(totalPnl)}
          </Text>
        </View>

        {/* OPEN pill */}
        <View style={[bottomBarStyles.pill, { borderColor: dotColor + '40' }]}>
          <Text style={bottomBarStyles.pillLabel}>OPEN</Text>
          <View style={bottomBarStyles.openRow}>
            <View style={[bottomBarStyles.openDot, { backgroundColor: dotColor }]} />
            <Text style={[bottomBarStyles.pillValue, { color: TEXT_PRIMARY }]}>
              {openCount}
            </Text>
          </View>
        </View>

      </View>
    </View>
  );
}

const bottomBarStyles = StyleSheet.create({
  container: {
    paddingTop: 3,
    paddingBottom: 3,
    paddingHorizontal: 10,
    backgroundColor: 'rgba(10,10,24,0.92)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.5,
    shadowRadius: 10,
    elevation: 20,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
  },
  topEdge: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  pillsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
  },
  // Pills now lay out as a single horizontal row: small label + value on one line.
  // Less vertical real estate, gives the rest of the screen more breathing room.
  pill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 14,
    borderWidth: 1,
    backgroundColor: 'rgba(255,255,255,0.02)',
  },
  pillLabel: {
    color: 'rgba(136,136,153,0.65)',
    fontSize: 8,
    fontWeight: '700' as const,
    letterSpacing: 1,
  },
  pillValue: {
    fontSize: 11,
    fontWeight: '800' as const,
    letterSpacing: 0.2,
  },
  openRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  openDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
  },
});

// ─── Performance Stats Bar ───────────────────────────────────────────────────
interface PerformanceStatsBarProps {
  closedTrades: ManualTrade[];
  openTrades: ManualTrade[];
}

function PerformanceStatsBar({ closedTrades, openTrades }: PerformanceStatsBarProps) {
  const [expanded, setExpanded] = useState(false);
  const animHeight = useRef(new Animated.Value(0)).current;
  const animRotate = useRef(new Animated.Value(0)).current;

  const toggle = useCallback(() => {
    const toExpanded = !expanded;
    setExpanded(toExpanded);
    Animated.parallel([
      Animated.spring(animHeight, {
        toValue: toExpanded ? 1 : 0,
        useNativeDriver: false,
        tension: 60,
        friction: 10,
      }),
      Animated.timing(animRotate, {
        toValue: toExpanded ? 1 : 0,
        duration: 220,
        useNativeDriver: true,
      }),
    ]).start();
  }, [expanded, animHeight, animRotate]);

  const rotate = animRotate.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '180deg'],
  });

  const expandedHeight = animHeight.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 348],
  });

  // ── Stat calculations from closed trades only ──
  const stats = useMemo(() => {
    const total = closedTrades.length;
    if (total === 0) return null;

    const winners = closedTrades.filter((t) => (t.pnl ?? 0) > 0);
    const losers = closedTrades.filter((t) => (t.pnl ?? 0) < 0);

    const winRate = (winners.length / total) * 100;

    const avgWinner =
      winners.length > 0
        ? winners.reduce((s, t) => s + (t.pnl ?? 0), 0) / winners.length
        : 0;

    const avgLoser =
      losers.length > 0
        ? losers.reduce((s, t) => s + (t.pnl ?? 0), 0) / losers.length
        : 0;

    const bestTrade = closedTrades.reduce<ManualTrade | null>(
      (best, t) => (best === null || (t.pnl ?? 0) > (best.pnl ?? 0) ? t : best),
      null
    );

    const worstTrade = closedTrades.reduce<ManualTrade | null>(
      (worst, t) => (worst === null || (t.pnl ?? 0) < (worst.pnl ?? 0) ? t : worst),
      null
    );

    const totalInvested = closedTrades.reduce(
      (s, t) => s + t.buy_price * t.qty,
      0
    );

    const totalReturned = closedTrades.reduce(
      (s, t) => s + (t.sell_price ?? t.buy_price) * t.qty,
      0
    );

    const totalPnl = closedTrades.reduce((s, t) => s + (t.pnl ?? 0), 0);

    return {
      winRate,
      avgWinner,
      avgLoser,
      bestTrade,
      worstTrade,
      total,
      totalInvested,
      totalReturned,
      totalPnl,
    };
  }, [closedTrades]);

  // ── "If all limits hit" projection from open trades ──
  const limitProjection = useMemo(() => {
    const tradesWithLimit = openTrades.filter(
      (t) => t.target_price !== null && t.target_price !== undefined
    );
    if (tradesWithLimit.length === 0) return null;

    const projectedGain = tradesWithLimit.reduce(
      (s, t) => s + ((t.target_price as number) - t.buy_price) * t.qty,
      0
    );
    const totalInvested = tradesWithLimit.reduce(
      (s, t) => s + t.buy_price * t.qty,
      0
    );
    const gainPct = totalInvested > 0 ? (projectedGain / totalInvested) * 100 : 0;

    return { projectedGain, gainPct, count: tradesWithLimit.length };
  }, [openTrades]);

  const totalPnl = stats?.totalPnl ?? 0;
  const winRate = stats?.winRate ?? 0;
  const totalPnlColor = totalPnl >= 0 ? ACCENT_GREEN : ACCENT_RED;
  const winRateColor = winRate >= 50 ? ACCENT_GREEN : ACCENT_RED;

  return (
    <View style={perfStyles.wrapper}>
      {/* Collapsed bar — always visible */}
      <TouchableOpacity
        style={perfStyles.collapsedBar}
        onPress={toggle}
        activeOpacity={0.85}
      >
        <View style={perfStyles.barLeft}>
          <BarChart2 size={13} color={AMBER} strokeWidth={2} />
          <Text style={perfStyles.barTitle}>PERFORMANCE</Text>
          {stats === null && (
            <Text style={perfStyles.noDataNote}>no closed trades</Text>
          )}
        </View>
        {stats !== null && (
          <View style={perfStyles.barRight}>
            <View style={perfStyles.collapsedStat}>
              <Text style={perfStyles.collapsedLabel}>WIN RATE</Text>
              <Text style={[perfStyles.collapsedValue, { color: winRateColor }]}>
                {winRate.toFixed(0)}%
              </Text>
            </View>
            <View style={perfStyles.barDivider} />
            <View style={perfStyles.collapsedStat}>
              <Text style={perfStyles.collapsedLabel}>TOTAL P&L</Text>
              <Text style={[perfStyles.collapsedValue, { color: totalPnlColor }]}>
                {totalPnl >= 0 ? '+' : '-'}${Math.abs(totalPnl).toFixed(2)}
              </Text>
            </View>
          </View>
        )}
        <Animated.View style={{ transform: [{ rotate }], marginLeft: 8 }}>
          <ChevronDown size={14} color={TEXT_DIM} strokeWidth={2} />
        </Animated.View>
      </TouchableOpacity>

      {/* Expandable grid */}
      <Animated.View style={[perfStyles.expandable, { maxHeight: expandedHeight, overflow: 'hidden' }]}>
        {stats !== null && (
          <View style={perfStyles.grid}>
            {/* Row 1 */}
            <View style={perfStyles.statCard}>
              <Text style={perfStyles.statLabel}>WIN RATE</Text>
              <Text style={[perfStyles.statValue, { color: winRateColor }]}>
                {stats.winRate.toFixed(1)}%
              </Text>
              <Text style={perfStyles.statSub}>
                {closedTrades.filter((t) => (t.pnl ?? 0) > 0).length}W ·{' '}
                {closedTrades.filter((t) => (t.pnl ?? 0) < 0).length}L
              </Text>
            </View>
            <View style={perfStyles.statCard}>
              <Text style={perfStyles.statLabel}>TOTAL TRADES</Text>
              <Text style={[perfStyles.statValue, { color: TEXT_PRIMARY }]}>
                {stats.total}
              </Text>
              <Text style={perfStyles.statSub}>closed positions</Text>
            </View>

            {/* Row 2 */}
            <View style={perfStyles.statCard}>
              <Text style={perfStyles.statLabel}>AVG WINNER</Text>
              <Text style={[perfStyles.statValue, { color: ACCENT_GREEN }]}>
                +${stats.avgWinner.toFixed(2)}
              </Text>
              <Text style={perfStyles.statSub}>per winning trade</Text>
            </View>
            <View style={perfStyles.statCard}>
              <Text style={perfStyles.statLabel}>AVG LOSER</Text>
              <Text style={[perfStyles.statValue, { color: stats.avgLoser < 0 ? ACCENT_RED : TEXT_DIM }]}>
                {stats.avgLoser < 0 ? '-' : ''}${Math.abs(stats.avgLoser).toFixed(2)}
              </Text>
              <Text style={perfStyles.statSub}>per losing trade</Text>
            </View>

            {/* Row 3 */}
            <View style={perfStyles.statCard}>
              <Text style={perfStyles.statLabel}>BEST TRADE</Text>
              {stats.bestTrade ? (
                <>
                  <Text style={[perfStyles.statValue, { color: ACCENT_GREEN, fontSize: 13 }]}>
                    {stats.bestTrade.symbol}
                  </Text>
                  <Text style={[perfStyles.statSub, { color: ACCENT_GREEN }]}>
                    +${(stats.bestTrade.pnl ?? 0).toFixed(2)}{' '}
                    ({(stats.bestTrade.pnl_pct ?? 0) >= 0 ? '+' : ''}{(stats.bestTrade.pnl_pct ?? 0).toFixed(1)}%)
                  </Text>
                </>
              ) : (
                <Text style={[perfStyles.statValue, { color: TEXT_DIM }]}>—</Text>
              )}
            </View>
            <View style={perfStyles.statCard}>
              <Text style={perfStyles.statLabel}>WORST TRADE</Text>
              {stats.worstTrade ? (
                <>
                  <Text style={[perfStyles.statValue, { color: ACCENT_RED, fontSize: 13 }]}>
                    {stats.worstTrade.symbol}
                  </Text>
                  <Text style={[perfStyles.statSub, { color: ACCENT_RED }]}>
                    {(stats.worstTrade.pnl ?? 0) < 0 ? '-' : '+'}${Math.abs(stats.worstTrade.pnl ?? 0).toFixed(2)}{' '}
                    ({(stats.worstTrade.pnl_pct ?? 0).toFixed(1)}%)
                  </Text>
                </>
              ) : (
                <Text style={[perfStyles.statValue, { color: TEXT_DIM }]}>—</Text>
              )}
            </View>

            {/* Row 4 */}
            <View style={perfStyles.statCard}>
              <Text style={perfStyles.statLabel}>TOTAL INVESTED</Text>
              <Text style={[perfStyles.statValue, { color: TEXT_PRIMARY, fontSize: 13 }]}>
                ${stats.totalInvested.toFixed(0)}
              </Text>
              <Text style={perfStyles.statSub}>capital deployed</Text>
            </View>
            <View style={perfStyles.statCard}>
              <Text style={perfStyles.statLabel}>TOTAL RETURNED</Text>
              <Text style={[perfStyles.statValue, { color: stats.totalReturned >= stats.totalInvested ? ACCENT_GREEN : ACCENT_RED, fontSize: 13 }]}>
                ${stats.totalReturned.toFixed(0)}
              </Text>
              <Text style={perfStyles.statSub}>gross proceeds</Text>
            </View>

            {/* If All Limits Hit */}
            {limitProjection !== null && (
              <View style={perfStyles.limitProjectionCard}>
                <View style={perfStyles.limitProjectionLeft}>
                  <Text style={perfStyles.limitProjectionEmoji}>🎯</Text>
                  <View style={perfStyles.limitProjectionText}>
                    <Text style={perfStyles.limitProjectionLabel}>IF ALL LIMITS HIT</Text>
                    <Text style={perfStyles.limitProjectionSub}>
                      {limitProjection.count} trade{limitProjection.count !== 1 ? 's' : ''} with target set
                    </Text>
                  </View>
                </View>
                <View style={perfStyles.limitProjectionRight}>
                  <Text style={[
                    perfStyles.limitProjectionValue,
                    { color: limitProjection.projectedGain >= 0 ? ACCENT_GREEN : ACCENT_RED },
                  ]}>
                    {limitProjection.projectedGain >= 0 ? '+' : '-'}${Math.abs(limitProjection.projectedGain).toFixed(2)}
                  </Text>
                  <Text style={[
                    perfStyles.limitProjectionPct,
                    { color: limitProjection.gainPct >= 0 ? ACCENT_GREEN : ACCENT_RED },
                  ]}>
                    {limitProjection.gainPct >= 0 ? '+' : ''}{limitProjection.gainPct.toFixed(1)}% on invested
                  </Text>
                </View>
              </View>
            )}
          </View>
        )}
      </Animated.View>
    </View>
  );
}

// ── Exposure summary bar — sibling of PerformanceStatsBar.
// Collapsible. Same calculation rules as BottomSummaryBar:
//   - live price preference: yahooPriceMap → trade.current_price → priceMap
//   - if no live price for a trade, that trade contributes 0 to unrealized
//     (and is excluded from cost basis too, so the % is honest about
//     "what we can actually measure right now").
interface ExposureBarProps {
  openTrades: ManualTrade[];
  yahooPriceMap: Record<string, number>;
  priceMap: Record<string, number>;
}

// Compact dollar format: $10972 → "$11.0K", $1234 → "$1234", $123 → "$123"
function compactDollar(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 10_000) return `$${(v / 1000).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
}

function ExposureBar({ openTrades, yahooPriceMap, priceMap }: ExposureBarProps) {
  const [expanded, setExpanded] = useState(false);
  const animHeight = useRef(new Animated.Value(0)).current;
  const animRotate = useRef(new Animated.Value(0)).current;

  const toggle = useCallback(() => {
    const next = !expanded;
    setExpanded(next);
    Animated.parallel([
      Animated.spring(animHeight, {
        toValue: next ? 1 : 0,
        useNativeDriver: false,
        tension: 60,
        friction: 10,
      }),
      Animated.timing(animRotate, {
        toValue: next ? 1 : 0,
        duration: 220,
        useNativeDriver: true,
      }),
    ]).start();
  }, [expanded, animHeight, animRotate]);

  const rotate = animRotate.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '180deg'],
  });

  const stats = useMemo(() => {
    const getLive = (t: ManualTrade): number | null =>
      yahooPriceMap[t.symbol] ?? t.current_price ?? priceMap[t.symbol] ?? null;

    let priceableCount = 0;
    let costBasis = 0;
    let currentValue = 0;
    const perTrade: { symbol: string; cost: number; value: number; unr: number }[] = [];

    for (const t of openTrades) {
      const live = getLive(t);
      if (live === null) continue; // skip — can't measure
      const cost = t.buy_price * t.qty;
      const value = live * t.qty;
      const unr = value - cost;
      costBasis += cost;
      currentValue += value;
      priceableCount += 1;
      perTrade.push({ symbol: t.symbol, cost, value, unr });
    }
    const unrealized = currentValue - costBasis;
    const pct = costBasis > 0 ? (unrealized / costBasis) * 100 : 0;
    perTrade.sort((a, b) => b.unr - a.unr);
    return {
      priceableCount,
      totalCount: openTrades.length,
      costBasis,
      currentValue,
      unrealized,
      pct,
      perTrade,
    };
  }, [openTrades, yahooPriceMap, priceMap]);

  // Expanded content: ~32px summary header + ~28px column headers + per-row 30px
  // (capped at 8 rows visible to keep the bar from dominating the screen).
  const perTradeRowHeight = 30;
  const expandedTarget = 90 + Math.min(stats.perTrade.length, 8) * perTradeRowHeight;
  const expandedHeight = animHeight.interpolate({
    inputRange: [0, 1],
    outputRange: [0, expandedTarget],
  });

  const upColor = stats.unrealized >= 0 ? ACCENT_GREEN : ACCENT_RED;
  const hasData = stats.totalCount > 0;
  const fmtUnreal = `${stats.unrealized >= 0 ? '+' : '-'}$${Math.abs(stats.unrealized).toFixed(2)}`;

  return (
    <View style={perfStyles.wrapper}>
      {/* Collapsed bar — single inline row, same vertical height as the
          PERFORMANCE "no closed trades" state. Title + value sit on one line. */}
      <TouchableOpacity
        style={perfStyles.collapsedBar}
        onPress={toggle}
        activeOpacity={0.85}
      >
        <View style={perfStyles.barLeft}>
          <BarChart2 size={13} color={AMBER} strokeWidth={2} />
          <Text style={perfStyles.barTitle} numberOfLines={1}>EXPOSURE</Text>
          {!hasData ? (
            <Text style={perfStyles.noDataNote} numberOfLines={1}>
              no open trades
            </Text>
          ) : (
            <Text
              style={[perfStyles.inlineValue, { color: upColor }]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.85}
            >
              {fmtUnreal} ({stats.pct >= 0 ? '+' : ''}
              {stats.pct.toFixed(2)}%)
            </Text>
          )}
        </View>
        <Animated.View style={{ transform: [{ rotate }], marginLeft: 8 }}>
          <ChevronDown size={14} color={TEXT_DIM} strokeWidth={2} />
        </Animated.View>
      </TouchableOpacity>

      {/* Expandable: full numbers + per-trade unrealized table */}
      <Animated.View style={[perfStyles.expandable, { maxHeight: expandedHeight, overflow: 'hidden' }]}>
        {hasData && (
          <View style={{ paddingHorizontal: 14, paddingBottom: 10 }}>
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'baseline',
                paddingBottom: 8,
                paddingTop: 2,
              }}
            >
              <Text style={[perfStyles.collapsedLabel]} numberOfLines={1}>
                $
                {stats.costBasis.toLocaleString('en-US', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}{' '}
                cost
              </Text>
              <Text style={{ color: upColor, fontSize: 12, fontWeight: '700' as const }} numberOfLines={1}>
                {fmtUnreal} ({stats.pct >= 0 ? '+' : ''}
                {stats.pct.toFixed(2)}%)
              </Text>
            </View>
            <View style={{ flexDirection: 'row', paddingBottom: 4, paddingTop: 2 }}>
              <Text style={[perfStyles.collapsedLabel, { flex: 1 }]}>SYMBOL</Text>
              <Text style={[perfStyles.collapsedLabel, { width: 80, textAlign: 'right' }]}>COST</Text>
              <Text style={[perfStyles.collapsedLabel, { width: 100, textAlign: 'right' }]}>UNREAL.</Text>
            </View>
            {stats.perTrade.map((row) => {
              const c = row.unr >= 0 ? ACCENT_GREEN : ACCENT_RED;
              return (
                <View
                  key={row.symbol}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    paddingVertical: 6,
                    borderTopWidth: 1,
                    borderTopColor: 'rgba(255,255,255,0.04)',
                  }}
                >
                  <Text
                    style={{ flex: 1, color: TEXT_PRIMARY, fontSize: 12, fontWeight: '700' as const }}
                  >
                    {row.symbol}
                  </Text>
                  <Text
                    style={{ width: 80, textAlign: 'right', color: TEXT_DIM, fontSize: 11 }}
                  >
                    ${row.cost.toFixed(2)}
                  </Text>
                  <Text
                    style={{ width: 100, textAlign: 'right', color: c, fontSize: 12, fontWeight: '700' as const }}
                  >
                    {row.unr >= 0 ? '+' : '-'}${Math.abs(row.unr).toFixed(2)}
                  </Text>
                </View>
              );
            })}
            {stats.priceableCount < stats.totalCount && (
              <Text style={[perfStyles.noDataNote, { marginTop: 6 }]}>
                {stats.totalCount - stats.priceableCount} trade(s) have no live price yet — pull to refresh.
              </Text>
            )}
          </View>
        )}
      </Animated.View>
    </View>
  );
}

const perfStyles = StyleSheet.create({
  wrapper: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(245,158,11,0.12)',
    backgroundColor: '#0b0b1e',
  },
  collapsedBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 7,
    gap: 6,
  },
  barLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    flex: 1,
  },
  barTitle: {
    color: AMBER,
    fontSize: 10,
    fontWeight: '800' as const,
    letterSpacing: 1.6,
  },
  noDataNote: {
    color: TEXT_DIM,
    fontSize: 10,
    letterSpacing: 0.3,
  },
  inlineValue: {
    fontSize: 12,
    fontWeight: '700' as const,
    letterSpacing: 0.2,
    flexShrink: 1,
  },
  barRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  barDivider: {
    width: 1,
    height: 24,
    backgroundColor: 'rgba(255,255,255,0.07)',
  },
  collapsedStat: {
    alignItems: 'flex-end',
    gap: 1,
  },
  collapsedLabel: {
    color: TEXT_DIM,
    fontSize: 8,
    fontWeight: '700' as const,
    letterSpacing: 1.4,
  },
  collapsedValue: {
    fontSize: 14,
    fontWeight: '800' as const,
    letterSpacing: 0.3,
  },
  expandable: {
    overflow: 'hidden',
  },
  limitProjectionCard: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(46,232,154,0.07)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(46,232,154,0.2)',
    paddingHorizontal: 14,
    paddingVertical: 11,
    gap: 8,
  },
  limitProjectionLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  limitProjectionEmoji: {
    fontSize: 18,
  },
  limitProjectionText: {
    gap: 2,
  },
  limitProjectionLabel: {
    color: ACCENT_GREEN,
    fontSize: 9,
    fontWeight: '800' as const,
    letterSpacing: 1.4,
  },
  limitProjectionSub: {
    color: TEXT_DIM,
    fontSize: 10,
    fontWeight: '500' as const,
    letterSpacing: 0.2,
  },
  limitProjectionRight: {
    alignItems: 'flex-end',
    gap: 2,
  },
  limitProjectionValue: {
    fontSize: 16,
    fontWeight: '800' as const,
    letterSpacing: 0.2,
  },
  limitProjectionPct: {
    fontSize: 11,
    fontWeight: '600' as const,
    letterSpacing: 0.2,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 12,
    paddingBottom: 12,
    gap: 8,
  },
  statCard: {
    width: '47.5%',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 3,
  },
  statLabel: {
    color: TEXT_DIM,
    fontSize: 8,
    fontWeight: '700' as const,
    letterSpacing: 1.4,
    marginBottom: 2,
  },
  statValue: {
    fontSize: 15,
    fontWeight: '800' as const,
    letterSpacing: 0.2,
  },
  statSub: {
    color: TEXT_DIM,
    fontSize: 10,
    fontWeight: '500' as const,
    letterSpacing: 0.2,
  },
});

// ─── Tab Switcher ─────────────────────────────────────────────────────────────
type ActiveTab = 'open' | 'closed';

interface TabSwitcherProps {
  active: ActiveTab;
  onChange: (tab: ActiveTab) => void;
  openCount: number;
  closedCount: number;
}

function TabSwitcher({ active, onChange, openCount, closedCount }: TabSwitcherProps) {
  return (
    <View style={tabStyles.row}>
      <TouchableOpacity
        style={[tabStyles.tab, active === 'open' && tabStyles.tabActive]}
        onPress={() => onChange('open')}
        activeOpacity={0.75}
      >
        <Text style={[tabStyles.tabText, active === 'open' && tabStyles.tabTextActive]}>
          OPEN
        </Text>
        <View style={[tabStyles.tabBadge, active === 'open' && tabStyles.tabBadgeActive]}>
          <Text style={[tabStyles.tabBadgeText, active === 'open' && tabStyles.tabBadgeTextActive]}>
            {openCount}
          </Text>
        </View>
      </TouchableOpacity>
      <TouchableOpacity
        style={[tabStyles.tab, active === 'closed' && tabStyles.tabActive]}
        onPress={() => onChange('closed')}
        activeOpacity={0.75}
      >
        <Text style={[tabStyles.tabText, active === 'closed' && tabStyles.tabTextActive]}>
          CLOSED
        </Text>
        <View style={[tabStyles.tabBadge, active === 'closed' && tabStyles.tabBadgeActive]}>
          <Text style={[tabStyles.tabBadgeText, active === 'closed' && tabStyles.tabBadgeTextActive]}>
            {closedCount}
          </Text>
        </View>
      </TouchableOpacity>
    </View>
  );
}

const tabStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginBottom: 4,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    padding: 3,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 9,
    borderRadius: 10,
  },
  tabActive: {
    backgroundColor: 'rgba(255,255,255,0.09)',
  },
  tabText: {
    color: TEXT_DIM,
    fontSize: 11,
    fontWeight: '700' as const,
    letterSpacing: 1.2,
  },
  tabTextActive: {
    color: TEXT_PRIMARY,
  },
  tabBadge: {
    minWidth: 18,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
  },
  tabBadgeActive: {
    backgroundColor: AMBER + '25',
  },
  tabBadgeText: {
    color: TEXT_DIM,
    fontSize: 10,
    fontWeight: '700' as const,
  },
  tabBadgeTextActive: {
    color: AMBER,
  },
});

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function FidelityScreen() {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<ActiveTab>('open');
  const [showBuyForm, setShowBuyForm] = useState(false);
  const [sellTrade, setSellTrade] = useState<ManualTrade | null>(null);
  const [editTrade, setEditTrade] = useState<ManualTrade | null>(null);
  const [limitTrade, setLimitTrade] = useState<ManualTrade | null>(null);
  const [yahooPriceMap, setYahooPriceMap] = useState<Record<string, number>>({});

  const notifiedSignals = useRef<Set<number>>(new Set());
  const notifiedLimits = useRef<Set<number>>(new Set());

  // ── Queries ──
  const moversQuery = useQuery<MarketMoverPrice[]>({
    queryKey: ['market-movers'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('market_movers')
        .select('symbol, price, signal')
        .order('change_pct', { ascending: false })
        .limit(20);
      if (error) throw new Error(error.message);
      return (data ?? []) as MarketMoverPrice[];
    },
    refetchInterval: 30000,
  });

  const tradesQuery = useQuery<ManualTrade[]>({
    queryKey: ['manual-trades'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('manual_trades')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as ManualTrade[];
    },
    refetchInterval: () => isMarketHours() ? 30000 : false,
  });

  // ── Mutations ──
  const logBuyMutation = useMutation({
    mutationFn: async ({ symbol, qty, buy_price }: { symbol: string; qty: number; buy_price: number }) => {
      const { error } = await supabase
        .from('manual_trades')
        .insert({ symbol, qty, buy_price, status: 'open' });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['manual-trades'] });
      setShowBuyForm(false);
    },
    onError: (err: Error) => {
      Alert.alert('Error', err.message);
    },
  });

  const confirmSellMutation = useMutation({
    mutationFn: async ({ id, sell_price, pnl, pnl_pct }: {
      id: number;
      sell_price: number;
      pnl: number;
      pnl_pct: number;
    }) => {
      const { error } = await supabase
        .from('manual_trades')
        .update({
          status: 'closed',
          sell_price,
          pnl,
          pnl_pct,
          closed_at: new Date().toISOString(),
        })
        .eq('id', id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['manual-trades'] });
      setSellTrade(null);
      // Auto-switch to closed tab after selling
      setActiveTab('closed');
    },
    onError: (err: Error) => {
      Alert.alert('Error', err.message);
    },
  });

  const editTradeMutation = useMutation({
    mutationFn: async ({ id, symbol, qty, buy_price }: {
      id: number;
      symbol: string;
      qty: number;
      buy_price: number;
    }) => {
      const { error } = await supabase
        .from('manual_trades')
        .update({ symbol, qty, buy_price })
        .eq('id', id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['manual-trades'] });
      setEditTrade(null);
    },
    onError: (err: Error) => {
      Alert.alert('Error', err.message);
    },
  });

  const setLimitMutation = useMutation({
    mutationFn: async ({ id, target_price }: { id: number; target_price: number | null }) => {
      const { error } = await supabase
        .from('manual_trades')
        .update({ target_price })
        .eq('id', id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['manual-trades'] });
      setLimitTrade(null);
    },
    onError: (err: Error) => {
      Alert.alert('Error', err.message);
    },
  });

  // ── Realtime subscription ──
  useEffect(() => {
    const channel = supabase
      .channel('manual_trades_realtime')
      .on('postgres_changes' as const, { event: '*', schema: 'public', table: 'manual_trades' }, () => {
        void queryClient.invalidateQueries({ queryKey: ['manual-trades'] });
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [queryClient]);

  // ── Notification permissions ──
  useEffect(() => {
    void requestNotificationPermissions();
  }, []);

  // ── Derived data ──
  const movers = moversQuery.data ?? [];

  const priceMap = useMemo(() => {
    const map: Record<string, number> = {};
    for (const m of movers) map[m.symbol] = m.price;
    return map;
  }, [movers]);

  // ── Trigger notifications for new signal trades + limit hits ──
  const trades = tradesQuery.data ?? [];
  useEffect(() => {
    const signalTrades = trades.filter((t) => t.status === 'signal');
    for (const t of signalTrades) {
      if (!notifiedSignals.current.has(t.id)) {
        notifiedSignals.current.add(t.id);
        const moversData = moversQuery.data ?? [];
        const mover = moversData.find((m) => m.symbol === t.symbol);
        const price = t.sell_price ?? mover?.price ?? t.buy_price;
        void sendSellAlert(t.symbol, t.signal_type ?? 'SELL', price);
      }
    }

    // Check limit hits on open trades
    const openOrSignal = trades.filter((t) => t.status === 'open' || t.status === 'signal');
    for (const t of openOrSignal) {
      if (t.target_price == null) continue;
      const liveP = yahooPriceMap[t.symbol] ?? t.current_price ?? priceMap[t.symbol];
      if (liveP != null && liveP >= t.target_price && !notifiedLimits.current.has(t.id)) {
        notifiedLimits.current.add(t.id);
        void sendLimitAlert(t.symbol, liveP, t.target_price);
      }
      // Reset notified if price drops back below (so it can alert again if it re-hits)
      if (liveP != null && liveP < t.target_price) {
        notifiedLimits.current.delete(t.id);
      }
    }
  }, [trades, moversQuery.data, yahooPriceMap, priceMap]);

  const signalTrades = useMemo(() => trades.filter((t) => t.status === 'signal'), [trades]);
  const openTrades = useMemo(() => trades.filter((t) => t.status === 'open'), [trades]);
  const closedTrades = useMemo(() => trades.filter((t) => t.status === 'closed'), [trades]);

  const totalOpenCount = signalTrades.length + openTrades.length;

  // ── Sell confirm handler ──
  const handleConfirmSell = useCallback((tradeId: number, sellPrice: number) => {
    const trade = trades.find((t) => t.id === tradeId);
    if (!trade) return;
    const pnl = (sellPrice - trade.buy_price) * trade.qty;
    const pnl_pct = ((sellPrice - trade.buy_price) / trade.buy_price) * 100;
    confirmSellMutation.mutate({ id: tradeId, sell_price: sellPrice, pnl, pnl_pct });
  }, [trades, confirmSellMutation]);

  // ── Edit handler ──
  const handleEditSave = useCallback((id: number, symbol: string, qty: number, buyPrice: number) => {
    editTradeMutation.mutate({ id, symbol, qty, buy_price: buyPrice });
  }, [editTradeMutation]);

  // ── Set limit handler ──
  const handleSetLimit = useCallback((tradeId: number, targetPrice: number | null) => {
    // Clear notification state when limit changes
    notifiedLimits.current.delete(tradeId);
    setLimitMutation.mutate({ id: tradeId, target_price: targetPrice });
  }, [setLimitMutation]);

  const handleRefresh = useCallback(() => {
    const activeTrades = [...signalTrades, ...openTrades];
    if (activeTrades.length > 0) {
      const symbols = [...new Set(activeTrades.map((t) => t.symbol))];
      void Promise.all(
        symbols.map(async (sym) => ({ sym, price: await fetchYahooPrice(sym) }))
      ).then((results) => {
        setYahooPriceMap((prev) => {
          const updated = { ...prev };
          for (const { sym, price } of results) {
            if (price !== null) updated[sym] = price;
          }
          return updated;
        });
      });
    }
    void tradesQuery.refetch();
    void moversQuery.refetch();
  }, [tradesQuery, moversQuery, signalTrades, openTrades]);

  const isRefreshing = (tradesQuery.isFetching && !tradesQuery.isLoading);

  return (
    <LinearGradient colors={[BG_TOP, BG_BOT]} style={styles.gradient}>
      <View style={[styles.container, { paddingTop: insets.top }]}>

        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <BookOpen size={14} color={AMBER} strokeWidth={2} />
            <Text style={styles.headerTitle}>FIDELITY LOG</Text>
          </View>
          <TouchableOpacity
            style={styles.logBtn}
            onPress={() => setShowBuyForm(true)}
            activeOpacity={0.8}
          >
            <Plus size={11} color='#0a0a1a' strokeWidth={2.5} />
            <Text style={styles.logBtnText}>LOG BUY</Text>
          </TouchableOpacity>
        </View>

        {/* Stats pills */}
        <View style={styles.statsRow}>
          <View style={[styles.statPill, { borderColor: 'rgba(0,212,170,0.3)', backgroundColor: 'rgba(0,212,170,0.08)' }]}>
            <Clock size={9} color={TEAL} strokeWidth={2.5} />
            <Text style={[styles.statText, { color: TEAL }]}>{totalOpenCount} OPEN</Text>
          </View>
          <View style={[styles.statPill, { borderColor: 'rgba(255,107,107,0.3)', backgroundColor: 'rgba(255,107,107,0.08)' }]}>
            <Bell size={9} color={ACCENT_RED} strokeWidth={2.5} />
            <Text style={[styles.statText, { color: ACCENT_RED }]}>{signalTrades.length} SIGNALS</Text>
          </View>
          <View style={[styles.statPill, { borderColor: 'rgba(255,255,255,0.15)', backgroundColor: 'rgba(255,255,255,0.05)' }]}>
            <CheckCircle size={9} color={TEXT_DIM} strokeWidth={2.5} />
            <Text style={[styles.statText, { color: TEXT_DIM }]}>{closedTrades.length} CLOSED</Text>
          </View>
        </View>

        {/* Fidelity P&L chart — fed by manual_trades enriched with live current_price */}
        <FidelityChart
          trades={trades.map<FidelityTrade>((t) => ({
            id: t.id,
            symbol: t.symbol,
            qty: t.qty,
            buy_price: t.buy_price,
            sell_price: t.sell_price,
            current_price:
              yahooPriceMap[t.symbol] ?? t.current_price ?? priceMap[t.symbol] ?? null,
            status: t.status,
            created_at: t.created_at,
            closed_at: t.closed_at,
          }))}
        />

        {/* Tab switcher */}
        <TabSwitcher
          active={activeTab}
          onChange={setActiveTab}
          openCount={totalOpenCount}
          closedCount={closedTrades.length}
        />

        <ScrollView
          style={styles.scroll}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 20 }}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={handleRefresh}
              tintColor={AMBER}
            />
          }
        >
          {tradesQuery.isLoading ? (
            <View style={styles.loadingWrap}>
              <ActivityIndicator color={AMBER} size="large" />
              <Text style={styles.loadingText}>Loading trades…</Text>
            </View>
          ) : activeTab === 'open' ? (
            <>
              {/* Signal Alerts */}
              {signalTrades.length > 0 && (
                <View style={styles.section}>
                  <SectionHeader title="SELL SIGNALS" count={signalTrades.length} color={ACCENT_RED} />
                  {signalTrades.map((trade) => (
                    <SignalCard
                      key={trade.id}
                      trade={trade}
                      currentPrice={priceMap[trade.symbol]}
                      yahooPrice={yahooPriceMap[trade.symbol]}
                      onConfirmSell={(t) => setSellTrade(t)}
                    />
                  ))}
                </View>
              )}

              {/* Open Trades */}
              {openTrades.length > 0 && (
                <View style={styles.section}>
                  <SectionHeader title="OPEN TRADES" count={openTrades.length} color={TEAL} />
                  {openTrades.map((trade) => (
                    <OpenTradeRow
                      key={trade.id}
                      trade={trade}
                      fallbackPrice={priceMap[trade.symbol]}
                      yahooPrice={yahooPriceMap[trade.symbol]}
                      onSell={(t) => setSellTrade(t)}
                      onEdit={(t) => setEditTrade(t)}
                      onSetLimit={(t) => setLimitTrade(t)}
                      onClosePosition={(symbol) => {
                        Alert.alert(
                          `Sell ${symbol}?`,
                          `This will send a SELL_${symbol} command to the bot.`,
                          [
                            { text: 'Cancel', style: 'cancel' },
                            {
                              text: 'SELL',
                              style: 'destructive',
                              onPress: () => {
                                closePosition(symbol).catch((err: Error) =>
                                  Alert.alert('Error', err.message)
                                );
                              },
                            },
                          ]
                        );
                      }}
                    />
                  ))}
                </View>
              )}

              {/* Empty state */}
              {signalTrades.length === 0 && openTrades.length === 0 && (
                <View style={styles.emptyWrap}>
                  <BookOpen size={44} color={TEXT_DIM} strokeWidth={1} style={{ opacity: 0.3 }} />
                  <Text style={styles.emptyTitle}>No open trades</Text>
                  <Text style={styles.emptySub}>
                    Tap "LOG BUY" to record a manual trade.{'\n'}Signals from your bot will appear here automatically.
                  </Text>
                  <TouchableOpacity
                    style={styles.emptyBtn}
                    onPress={() => setShowBuyForm(true)}
                    activeOpacity={0.8}
                  >
                    <Plus size={14} color='#0a0a1a' strokeWidth={2.5} />
                    <Text style={styles.emptyBtnText}>Log First Trade</Text>
                  </TouchableOpacity>
                </View>
              )}
            </>
          ) : (
            // Closed Tab
            <>
              {closedTrades.length > 0 ? (
                <View style={styles.section}>
                  <SectionHeader title="CLOSED TRADES" count={closedTrades.length} color={TEXT_DIM} />
                  {closedTrades.map((trade) => (
                    <ClosedTradeRow key={trade.id} trade={trade} />
                  ))}
                </View>
              ) : (
                <View style={styles.emptyWrap}>
                  <CheckCircle size={44} color={TEXT_DIM} strokeWidth={1} style={{ opacity: 0.3 }} />
                  <Text style={styles.emptyTitle}>No closed trades yet</Text>
                  <Text style={styles.emptySub}>
                    Closed trades will appear here once you log a sell.
                  </Text>
                </View>
              )}
            </>
          )}
        </ScrollView>

        {/* Performance Stats */}
        <PerformanceStatsBar closedTrades={closedTrades} openTrades={[...signalTrades, ...openTrades]} />

        {/* Exposure (open trades cost / unrealized) */}
        <ExposureBar
          openTrades={[...signalTrades, ...openTrades]}
          yahooPriceMap={yahooPriceMap}
          priceMap={priceMap}
        />

        {/* Summary bar */}
        <BottomSummaryBar
          trades={trades}
          openTrades={[...signalTrades, ...openTrades]}
          yahooPriceMap={yahooPriceMap}
          priceMap={priceMap}
          bottomInset={insets.bottom}
        />
      </View>

      {/* Buy Form */}
      {showBuyForm && (
        <BuyFormModal
          movers={movers}
          onSubmit={(symbol, qty, buyPrice) => logBuyMutation.mutate({ symbol, qty, buy_price: buyPrice })}
          onClose={() => setShowBuyForm(false)}
          isLoading={logBuyMutation.isPending}
        />
      )}

      {/* Sell Confirm */}
      {sellTrade && (
        <SellConfirmModal
          trade={sellTrade}
          currentPrice={priceMap[sellTrade.symbol]}
          onConfirm={handleConfirmSell}
          onClose={() => setSellTrade(null)}
          isLoading={confirmSellMutation.isPending}
        />
      )}

      {/* Edit Trade */}
      {editTrade && (
        <EditTradeModal
          trade={editTrade}
          onSave={handleEditSave}
          onClose={() => setEditTrade(null)}
          isLoading={editTradeMutation.isPending}
        />
      )}

      {/* Set Limit */}
      {limitTrade && (
        <SetLimitModal
          trade={limitTrade}
          currentPrice={yahooPriceMap[limitTrade.symbol] ?? priceMap[limitTrade.symbol]}
          onSave={handleSetLimit}
          onClose={() => setLimitTrade(null)}
          isLoading={setLimitMutation.isPending}
        />
      )}
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
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 6,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  headerTitle: {
    color: AMBER,
    fontSize: 16,
    fontWeight: '800' as const,
    letterSpacing: 1.1,
  },
  logBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: AMBER,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  logBtnText: {
    color: '#0a0a1a',
    fontSize: 10,
    fontWeight: '800' as const,
    letterSpacing: 0.5,
  },

  statsRow: {
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  statPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 7,
    borderWidth: 1,
  },
  statText: {
    fontSize: 9,
    fontWeight: '700' as const,
    letterSpacing: 0.4,
  },

  scroll: { flex: 1 },

  section: {
    marginBottom: 8,
  },

  loadingWrap: {
    paddingTop: 60,
    alignItems: 'center',
    gap: 14,
  },
  loadingText: {
    color: TEXT_DIM,
    fontSize: 13,
    letterSpacing: 0.2,
  },

  emptyWrap: {
    paddingTop: 60,
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 24,
  },
  emptyTitle: {
    color: TEXT_PRIMARY,
    fontSize: 18,
    fontWeight: '600' as const,
    letterSpacing: 0.3,
  },
  emptySub: {
    color: TEXT_DIM,
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 20,
    letterSpacing: 0.2,
  },
  emptyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: AMBER,
    paddingHorizontal: 20,
    paddingVertical: 11,
    borderRadius: 12,
    marginTop: 8,
  },
  emptyBtnText: {
    color: '#0a0a1a',
    fontSize: 14,
    fontWeight: '800' as const,
    letterSpacing: 0.5,
  },
});
