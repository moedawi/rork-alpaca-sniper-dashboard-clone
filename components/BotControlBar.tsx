import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Platform,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { Pause, Play, RotateCcw, ShieldAlert } from 'lucide-react-native';
import { useQuery } from '@tanstack/react-query';
import Colors from '@/constants/colors';
import { useBotCommand, useBotHeartbeat, useCurrentBotCommand } from '@/hooks/useBotCommand';
import { enqueueBotCommand } from '@/lib/botCommand';
import { supabase } from '@/lib/supabase';

const TEAL = '#00d4aa';
const RED = '#FF6B6B';
const GOLD = '#FFD93D';
const TEXT_DIM = '#888899';

function tapHaptic() {
  if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
}

function HeartbeatDot() {
  const { data } = useBotHeartbeat();
  let color = '#555566';
  let label = 'Unknown';
  if (data?.state === 'live') {
    color = TEAL;
    label = data.ageSeconds != null ? `Live · ${data.ageSeconds}s ago` : 'Live';
  } else if (data?.state === 'stale') {
    color = GOLD;
    label = data.ageSeconds != null ? `Stale · ${Math.floor(data.ageSeconds / 60)}m ago` : 'Stale';
  } else if (data?.state === 'offline') {
    color = RED;
    label =
      data.ageSeconds != null && data.ageSeconds < 3600
        ? `Offline · ${Math.floor(data.ageSeconds / 60)}m ago`
        : 'Offline';
  }
  return (
    <View style={styles.heartbeatRow}>
      <View style={[styles.dot, { backgroundColor: color, shadowColor: color }]} />
      <Text style={[styles.heartbeatText, { color }]}>{label}</Text>
    </View>
  );
}

interface OpenPosRow {
  symbol: string;
}

function useOpenPositionSymbols() {
  return useQuery<string[]>({
    queryKey: ['open_position_symbols'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('open_positions')
        .select('symbol');
      if (error || !data) return [];
      return (data as OpenPosRow[]).map((r) => r.symbol).filter(Boolean);
    },
    refetchInterval: 30_000,
  });
}

export default function BotControlBar() {
  const sendCmd = useBotCommand();
  const currentCmd = useCurrentBotCommand();
  const openSymsQuery = useOpenPositionSymbols();
  const [killProgress, setKillProgress] = useState<{ done: number; total: number } | null>(null);
  const pending =
    sendCmd.isPending ||
    killProgress !== null ||
    (currentCmd.data && currentCmd.data !== 'IDLE');
  const pendingLabel = sendCmd.isPending
    ? 'Sending...'
    : currentCmd.data && currentCmd.data !== 'IDLE'
      ? `Pending: ${currentCmd.data}`
      : null;

  const handleHalt = () => {
    tapHaptic();
    sendCmd.mutate('HALT');
  };

  const handleResume = () => {
    tapHaptic();
    sendCmd.mutate('RESUME');
  };

  const handleReset = () => {
    tapHaptic();
    Alert.alert(
      'Full reset?',
      'This will:\n  • Close every open position\n  • Reset virtual capital to $1,000\n  • Wipe the equity chart\n\nWins/Losses history is preserved. Are you sure?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: () => sendCmd.mutate('RESET_VCAP'),
        },
      ],
    );
  };

  const handleKillSwitch = () => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    }
    const symbols = openSymsQuery.data ?? [];
    const positionLine =
      symbols.length === 0
        ? 'No open positions found.'
        : `Closing ${symbols.length} position${symbols.length === 1 ? '' : 's'}: ${symbols.join(', ')}`;
    Alert.alert(
      'KILL SWITCH',
      `HALT the bot AND force-close all open positions.\n\n${positionLine}\n\nAre you sure?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'KILL',
          style: 'destructive',
          onPress: async () => {
            const total = symbols.length + 1; // +1 for HALT
            setKillProgress({ done: 0, total });
            try {
              if (Platform.OS !== 'web') {
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
              }
              // 1. HALT first so no new entries fire while we're closing.
              await enqueueBotCommand('HALT');
              setKillProgress({ done: 1, total });

              // 2. SELL each open position in sequence (queue ensures serial).
              for (let i = 0; i < symbols.length; i++) {
                const sym = symbols[i];
                await enqueueBotCommand(`SELL_${sym}`);
                setKillProgress({ done: 2 + i, total });
              }
            } finally {
              setKillProgress(null);
            }
          },
        },
      ],
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Bot Controls</Text>
        <HeartbeatDot />
      </View>

      <View style={styles.row}>
        <TouchableOpacity
          style={[styles.btn, styles.btnHalt, pending && styles.btnDisabled]}
          onPress={handleHalt}
          disabled={!!pending}
          activeOpacity={0.7}
        >
          <Pause size={16} color={RED} strokeWidth={2.2} />
          <Text style={[styles.btnText, { color: RED }]}>HALT</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.btn, styles.btnResume, pending && styles.btnDisabled]}
          onPress={handleResume}
          disabled={!!pending}
          activeOpacity={0.7}
        >
          <Play size={16} color={TEAL} strokeWidth={2.2} />
          <Text style={[styles.btnText, { color: TEAL }]}>RESUME</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.btn, styles.btnReset, pending && styles.btnDisabled]}
          onPress={handleReset}
          disabled={!!pending}
          activeOpacity={0.7}
        >
          <RotateCcw size={16} color={GOLD} strokeWidth={2.2} />
          <Text style={[styles.btnText, { color: GOLD }]}>RESET</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity
        style={[styles.killBtn, pending && styles.btnDisabled]}
        onPress={handleKillSwitch}
        disabled={!!pending}
        activeOpacity={0.7}
      >
        <ShieldAlert size={15} color="#FF6B6B" strokeWidth={2.4} />
        <Text style={styles.killBtnText}>KILL SWITCH — HALT + CLOSE ALL</Text>
      </TouchableOpacity>

      {killProgress && (
        <View style={styles.pendingRow}>
          <ActivityIndicator size="small" color={RED} />
          <Text style={[styles.pendingText, { color: RED }]}>
            Closing positions: {killProgress.done} / {killProgress.total}
          </Text>
        </View>
      )}

      {pendingLabel && !killProgress && (
        <View style={styles.pendingRow}>
          <ActivityIndicator size="small" color={TEXT_DIM} />
          <Text style={styles.pendingText}>{pendingLabel}</Text>
        </View>
      )}

      {sendCmd.isError && (
        <Text style={styles.errorText}>
          {(sendCmd.error as Error)?.message ?? 'Command failed'}
        </Text>
      )}
      {sendCmd.isSuccess && !pending && (
        <Text style={styles.okText}>
          {sendCmd.data?.acked ? 'Bot acknowledged' : 'Sent (no ack within 8s)'}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginHorizontal: 12,
    marginTop: 4,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 7,
  },
  title: {
    color: Colors.text,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  heartbeatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 4,
    elevation: 4,
  },
  heartbeatText: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  row: {
    flexDirection: 'row',
    gap: 6,
  },
  btn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 9,
    borderRadius: 9,
    borderWidth: 1,
  },
  btnHalt: {
    backgroundColor: 'rgba(255,107,107,0.08)',
    borderColor: 'rgba(255,107,107,0.4)',
  },
  btnResume: {
    backgroundColor: 'rgba(0,212,170,0.08)',
    borderColor: 'rgba(0,212,170,0.4)',
  },
  btnReset: {
    backgroundColor: 'rgba(255,217,61,0.08)',
    borderColor: 'rgba(255,217,61,0.4)',
  },
  btnDisabled: {
    opacity: 0.4,
  },
  btnText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  killBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    marginTop: 7,
    paddingVertical: 9,
    borderRadius: 9,
    backgroundColor: 'rgba(255,107,107,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,107,107,0.55)',
  },
  killBtnText: {
    color: '#FF6B6B',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.7,
  },
  pendingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginTop: 7,
  },
  pendingText: {
    color: TEXT_DIM,
    fontSize: 10,
  },
  errorText: {
    color: RED,
    fontSize: 10,
    marginTop: 6,
  },
  okText: {
    color: TEAL,
    fontSize: 10,
    marginTop: 6,
  },
});
