export interface RawTrade {
  id: number | string;
  symbol: string;
  side: string;
  qty?: number | string;
  price?: number | string;
  fill_price?: number | string;
  entry_price?: number | string;
  exit_price?: number | string;
  pnl?: number | string;
  created_at: string;
}

export interface EnrichedTrade {
  id: string;
  symbol: string;
  side: string;
  qty: number;
  price: number;
  entry_price: number;
  exit_price: number;
  pnl_dollar: number;
  pnl_pct: number;
  is_win: boolean;
  is_closed: boolean;
  created_at: string;
}

function num(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const n = parseFloat(String(v ?? '0'));
  return Number.isFinite(n) ? n : 0;
}

export function computeFifoTrades(raw: RawTrade[]): EnrichedTrade[] {
  const sortedAsc = [...raw].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );
  const queues = new Map<string, { price: number; qty: number }[]>();
  const results: EnrichedTrade[] = [];

  for (const t of sortedAsc) {
    const side = String(t.side ?? '').toLowerCase();
    const fill = num(t.fill_price) > 0 ? num(t.fill_price) : num(t.price);
    const qty = num(t.qty);
    const isClose = side === 'sell' || side === 'partial';

    let entry = num(t.entry_price);
    let exit = isClose ? fill : num(t.exit_price);
    let pnlDollar = 0;
    let pnlPct = 0;

    if (side === 'buy' && fill > 0 && qty > 0) {
      if (!queues.has(t.symbol)) queues.set(t.symbol, []);
      queues.get(t.symbol)!.push({ price: fill, qty });
    } else if (isClose && fill > 0 && qty > 0) {
      const q = queues.get(t.symbol) ?? [];
      let remaining = qty;
      let costBasis = 0;
      while (remaining > 0 && q.length > 0) {
        const head = q[0];
        const take = Math.min(head.qty, remaining);
        costBasis += take * head.price;
        head.qty -= take;
        remaining -= take;
        if (head.qty <= 0) q.shift();
      }
      const matchedQty = qty - remaining;
      if (matchedQty > 0) {
        const avgEntry = costBasis / matchedQty;
        entry = avgEntry;
        exit = fill;
        pnlDollar = (fill - avgEntry) * matchedQty;
        pnlPct = avgEntry > 0 ? ((fill - avgEntry) / avgEntry) * 100 : 0;
      }
    }

    results.push({
      id: String(t.id),
      symbol: t.symbol,
      side,
      qty,
      price: fill,
      entry_price: entry,
      exit_price: exit,
      pnl_dollar: pnlDollar,
      pnl_pct: pnlPct,
      is_win: isClose ? pnlDollar > 0 : false,
      is_closed: isClose,
      created_at: t.created_at,
    });
  }

  return results;
}
