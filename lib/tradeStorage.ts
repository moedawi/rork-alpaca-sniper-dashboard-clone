export const TRADES_STORAGE_KEY = '@alpaca_trader_trades_v2';

export interface StoredTrade {
  id: string;
  symbol: string;
  side: string;
  entry_price: number;
  exit_price: number;
  quantity: number;
  pnl_dollar: number;
  pnl_pct: number;
  date_time: string;
  is_win: boolean;
  fill_price: number;
}

export function supabaseTradeToStored(t: {
  id?: string | number;
  symbol?: string;
  side?: string;
  qty?: number | string;
  price?: number | string;
  fill_price?: number | string;
  entry_price?: number | string;
  exit_price?: number | string;
  pnl?: number | string;
  created_at?: string;
}): StoredTrade {
  const side = t.side ?? 'buy';
  const isSell = side === 'sell' || side === 'partial';

  const fillPrice =
    typeof t.fill_price === 'number'
      ? t.fill_price
      : parseFloat(String(t.fill_price ?? '0')) || 0;
  const rawPrice =
    typeof t.price === 'number' ? t.price : parseFloat(String(t.price ?? '0')) || 0;
  const price = fillPrice > 0 ? fillPrice : rawPrice;

  const qty =
    typeof t.qty === 'number' ? t.qty : parseFloat(String(t.qty ?? '0')) || 0;

  const entry =
    typeof t.entry_price === 'number'
      ? t.entry_price
      : parseFloat(String(t.entry_price ?? '0')) || 0;
  const exit =
    typeof t.exit_price === 'number'
      ? t.exit_price
      : parseFloat(String(t.exit_price ?? '0')) || (isSell ? price : 0);

  // pnl field from Supabase IS the percentage already (e.g., 2.5 = +2.5%)
  const pnlPct = isSell
    ? (typeof t.pnl === 'number' ? t.pnl : parseFloat(String(t.pnl ?? '0')) || 0)
    : 0;

  // Dollar P&L for sells: (exit - entry) * qty
  // entry may be 0 if not stored; context will patch it from matching BUY
  const pnlDollar = isSell && entry > 0 && exit > 0 ? (exit - entry) * qty : 0;

  console.log('[tradeStorage] side:', side, 'symbol:', t.symbol, 'pnlPct:', pnlPct, 'pnlDollar:', pnlDollar, 'entry:', entry, 'exit:', exit, 'qty:', qty);

  return {
    id: String(t.id ?? `trade_${Date.now()}_${Math.random().toString(36).slice(2)}`),
    symbol: t.symbol ?? 'UNKNOWN',
    side,
    entry_price: entry,
    exit_price: exit,
    quantity: qty,
    pnl_dollar: pnlDollar,
    pnl_pct: pnlPct,
    date_time: t.created_at ?? new Date().toISOString(),
    is_win: isSell ? pnlPct > 0 : false,
    fill_price: price,
  };
}
