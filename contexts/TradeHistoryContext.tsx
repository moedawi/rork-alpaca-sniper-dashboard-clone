import createContextHook from '@nkzw/create-context-hook';
import { useState, useMemo, useCallback } from 'react';
import { StoredTrade, supabaseTradeToStored } from '@/lib/tradeStorage';
import { computeFifoTrades, RawTrade } from '@/lib/pnl';

export const [TradeHistoryProvider, useTradeHistory] = createContextHook(() => {
  const [trades, setTrades] = useState<StoredTrade[]>([]);
  const loaded = true;

  const mergeSupabaseTrades = useCallback((supabaseTrades: Record<string, unknown>[]) => {
    if (!supabaseTrades || supabaseTrades.length === 0) {
      setTrades([]);
      return;
    }
    const raw = supabaseTrades as unknown as RawTrade[];
    const enriched = computeFifoTrades(raw);

    const converted: StoredTrade[] = enriched.map(e => {
      const base = supabaseTradeToStored(
        supabaseTrades.find(r => String((r as { id?: unknown }).id) === e.id) as Parameters<typeof supabaseTradeToStored>[0]
      );
      return {
        ...base,
        entry_price: e.entry_price || base.entry_price,
        exit_price: e.exit_price || base.exit_price,
        pnl_dollar: e.pnl_dollar,
        pnl_pct: e.is_closed ? e.pnl_pct : base.pnl_pct,
        is_win: e.is_win,
      };
    });

    const sorted = converted.sort(
      (a, b) => new Date(b.date_time).getTime() - new Date(a.date_time).getTime()
    );
    console.log('[TradeHistory] Loaded', sorted.length, 'trades from Supabase (no cache)');
    setTrades(sorted);
  }, []);

  const allTrades = trades;

  const winTrades = useMemo(
    () => trades.filter(t => {
      const isSell = t.side === 'sell' || t.side === 'partial';
      if (!isSell) return false;
      // prefer dollar P&L if computed, fall back to percentage from Supabase
      if (t.pnl_dollar !== 0) return t.pnl_dollar > 0;
      return t.pnl_pct > 0;
    }),
    [trades]
  );

  const lossTrades = useMemo(
    () => trades.filter(t => {
      const isSell = t.side === 'sell' || t.side === 'partial';
      if (!isSell) return false;
      if (t.pnl_dollar !== 0) return t.pnl_dollar < 0;
      return t.pnl_pct < 0;
    }),
    [trades]
  );

  const todayTrades = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return trades.filter(t => new Date(t.date_time) >= start);
  }, [trades]);

  return {
    allTrades,
    winTrades,
    lossTrades,
    todayTrades,
    loaded,
    mergeSupabaseTrades,
  };
});
