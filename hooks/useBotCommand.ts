import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { enqueueBotCommand, getCurrentCommand, BotCommand } from '@/lib/botCommand';
import { supabase } from '@/lib/supabase';

/**
 * Mutation hook for sending a bot command. Goes through the serial queue,
 * so multiple parallel calls (e.g. tapping SELL on 4 cards) execute one at
 * a time without overwriting bot_control.
 */
export function useBotCommand() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (command: BotCommand) => {
      const res = await enqueueBotCommand(command);
      if (!res.ok) throw new Error(res.error || 'send failed');
      return { acked: res.acked };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['positions'] });
      qc.invalidateQueries({ queryKey: ['dashboard-positions'] });
      qc.invalidateQueries({ queryKey: ['equity_snapshots'] });
      qc.invalidateQueries({ queryKey: ['bot_control'] });
    },
  });
}

/**
 * Live read of the current bot_control.command. Polls every 1s while
 * a command is mid-flight, every 5s otherwise.
 */
export function useCurrentBotCommand() {
  return useQuery({
    queryKey: ['bot_control'],
    queryFn: getCurrentCommand,
    refetchInterval: (query) => (query.state.data && query.state.data !== 'IDLE' ? 1000 : 5000),
    staleTime: 500,
  });
}

/**
 * Heartbeat — derive bot health from the most recent equity_snapshot timestamp.
 * Bot writes one each iteration, so a recent timestamp means bot is alive.
 *
 *   < 90s   → 'live'   (green)
 *   < 10min → 'stale'  (yellow)
 *   else    → 'offline' (red, or no data ever)
 */
export type HeartbeatState = 'live' | 'stale' | 'offline' | 'unknown';

export interface HeartbeatInfo {
  state: HeartbeatState;
  ageSeconds: number | null;
  lastSeen: string | null;
}

async function fetchHeartbeat(): Promise<HeartbeatInfo> {
  const { data, error } = await supabase
    .from('equity_snapshots')
    .select('timestamp')
    .order('timestamp', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return { state: 'unknown', ageSeconds: null, lastSeen: null };
  const ts = data.timestamp as string;
  const ageMs = Date.now() - new Date(ts).getTime();
  const ageSec = Math.floor(ageMs / 1000);
  let state: HeartbeatState;
  if (ageSec < 90) state = 'live';
  else if (ageSec < 600) state = 'stale';
  else state = 'offline';
  return { state, ageSeconds: ageSec, lastSeen: ts };
}

export function useBotHeartbeat() {
  return useQuery({
    queryKey: ['bot_heartbeat'],
    queryFn: fetchHeartbeat,
    refetchInterval: 10_000, // every 10s
    staleTime: 5_000,
  });
}
