const BASE_URL = 'https://paper-api.alpaca.markets';

function getHeaders() {
  const apiKey = process.env.EXPO_PUBLIC_ALPACA_API_KEY ?? '';
  const secretKey = process.env.EXPO_PUBLIC_ALPACA_SECRET_KEY ?? '';
  console.log('[Alpaca] API Key present:', !!apiKey, 'Secret present:', !!secretKey);
  return {
    'APCA-API-KEY-ID': apiKey,
    'APCA-API-SECRET-KEY': secretKey,
    'Content-Type': 'application/json',
  };
}

export interface AlpacaAccount {
  id: string;
  account_number: string;
  status: string;
  currency: string;
  buying_power: string;
  cash: string;
  portfolio_value: string;
  equity: string;
  last_equity: string;
  long_market_value: string;
  short_market_value: string;
  initial_margin: string;
  maintenance_margin: string;
  daytrade_count: number;
  daytrading_buying_power: string;
}

export interface AlpacaPosition {
  asset_id: string;
  symbol: string;
  exchange: string;
  asset_class: string;
  avg_entry_price: string;
  qty: string;
  side: string;
  market_value: string;
  cost_basis: string;
  unrealized_pl: string;
  unrealized_plpc: string;
  current_price: string;
  lastday_price: string;
  change_today: string;
}

export interface AlpacaOrder {
  id: string;
  client_order_id: string;
  created_at: string;
  updated_at: string;
  submitted_at: string;
  filled_at: string | null;
  expired_at: string | null;
  canceled_at: string | null;
  failed_at: string | null;
  asset_id: string;
  symbol: string;
  asset_class: string;
  qty: string;
  filled_qty: string;
  filled_avg_price: string | null;
  order_class: string;
  order_type: string;
  type: string;
  side: string;
  time_in_force: string;
  limit_price: string | null;
  stop_price: string | null;
  status: string;
}

export interface AlpacaActivity {
  id: string;
  activity_type: string;
  symbol: string;
  side: string;
  qty: string;
  price: string;
  cum_qty: string;
  transaction_time: string;
  type: string;
  order_id: string;
  net_amount?: string;
}

export interface PortfolioHistoryPoint {
  timestamp: number[];
  equity: number[];
  profit_loss: number[];
  profit_loss_pct: number[];
  base_value: number;
  timeframe: string;
}

async function alpacaFetch<T>(url: string): Promise<T> {
  console.log('[Alpaca] Fetching:', url);
  const response = await fetch(url, { headers: getHeaders() });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[Alpaca] Error:', response.status, errorText);
    throw new Error(`Alpaca API error ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  return data as T;
}

export async function getAccount(): Promise<AlpacaAccount> {
  return alpacaFetch<AlpacaAccount>(`${BASE_URL}/v2/account`);
}

export async function getPositions(): Promise<AlpacaPosition[]> {
  return alpacaFetch<AlpacaPosition[]>(`${BASE_URL}/v2/positions`);
}

export async function getOrders(params?: {
  status?: string;
  limit?: number;
  after?: string;
  until?: string;
  direction?: string;
}): Promise<AlpacaOrder[]> {
  const searchParams = new URLSearchParams();
  if (params?.status) searchParams.set('status', params.status);
  if (params?.limit) searchParams.set('limit', String(params.limit));
  if (params?.after) searchParams.set('after', params.after);
  if (params?.until) searchParams.set('until', params.until);
  if (params?.direction) searchParams.set('direction', params.direction);

  const qs = searchParams.toString();
  return alpacaFetch<AlpacaOrder[]>(`${BASE_URL}/v2/orders${qs ? `?${qs}` : ''}`);
}

export async function getActivities(activityType?: string): Promise<AlpacaActivity[]> {
  const url = activityType
    ? `${BASE_URL}/v2/account/activities/${activityType}`
    : `${BASE_URL}/v2/account/activities`;
  return alpacaFetch<AlpacaActivity[]>(url);
}

export async function getPortfolioHistory(params?: {
  period?: string;
  timeframe?: string;
  date_end?: string;
  extended_hours?: boolean;
}): Promise<PortfolioHistoryPoint> {
  const searchParams = new URLSearchParams();
  if (params?.period) searchParams.set('period', params.period);
  if (params?.timeframe) searchParams.set('timeframe', params.timeframe);
  if (params?.date_end) searchParams.set('date_end', params.date_end);
  if (params?.extended_hours !== undefined) searchParams.set('extended_hours', String(params.extended_hours));

  const qs = searchParams.toString();
  return alpacaFetch<PortfolioHistoryPoint>(`${BASE_URL}/v2/account/portfolio/history${qs ? `?${qs}` : ''}`);
}

export async function closePosition(symbol: string): Promise<AlpacaOrder> {
  console.log('[Alpaca] Closing position:', symbol);
  const response = await fetch(`${BASE_URL}/v2/positions/${symbol}`, {
    method: 'DELETE',
    headers: getHeaders(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[Alpaca] Close position error:', response.status, errorText);
    throw new Error(`Failed to close position: ${errorText}`);
  }

  return response.json();
}

export interface PlaceOrderParams {
  symbol: string;
  qty: string;
  side: 'buy' | 'sell';
  type: 'market' | 'limit' | 'stop' | 'stop_limit';
  time_in_force: 'day' | 'gtc' | 'opg' | 'cls' | 'ioc' | 'fok';
  limit_price?: string;
  stop_price?: string;
}

export async function placeOrder(params: PlaceOrderParams): Promise<AlpacaOrder> {
  console.log('[Alpaca] Placing order:', params);
  const response = await fetch(`${BASE_URL}/v2/orders`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[Alpaca] Place order error:', response.status, errorText);
    throw new Error(`Failed to place order: ${errorText}`);
  }

  return response.json();
}

export async function getTodayOrders(): Promise<AlpacaOrder[]> {
  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];
  return getOrders({
    status: 'all',
    after: `${todayStr}T00:00:00Z`,
    direction: 'desc',
    limit: 500,
  });
}

export async function getFilledOrders(limit = 100): Promise<AlpacaOrder[]> {
  return getOrders({
    status: 'filled',
    limit,
    direction: 'desc',
  });
}

export interface AlpacaLatestTrade {
  t: string;
  x: string;
  p: number;
  s: number;
  c: string[];
  i: number;
  z: string;
}

export async function getLatestTrade(symbol: string): Promise<AlpacaLatestTrade> {
  console.log('[Alpaca] Fetching latest trade for:', symbol);
  const response = await fetch(`https://data.alpaca.markets/v2/stocks/${symbol}/trades/latest`, {
    headers: getHeaders(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[Alpaca] Latest trade error:', response.status, errorText);
    throw new Error(`Failed to get latest trade: ${errorText}`);
  }

  const data = await response.json();
  return data.trade as AlpacaLatestTrade;
}
