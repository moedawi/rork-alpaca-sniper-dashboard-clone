import createContextHook from '@nkzw/create-context-hook';
import { useState, useEffect, useRef, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/lib/supabase';

const SCAN_TIME_KEY = '@ticker_scan_time_v3';
const SCAN_DATA_KEY = '@ticker_scan_data_v3';

export const TICKER_NAMES: Record<string, string> = {};

export interface TickerData {
  symbol: string;
  price: number;
  prevClose: number;
  change: number;
  changePct: number;
  volume: number;
  open: number;
  high: number;
  low: number;
  exchange?: string;
  signal?: string;
}

interface MarketMoverRow {
  symbol: string;
  price: number | string;
  change_pct?: number | string;
  pct_change?: number | string;
  percent_change?: number | string;
  change?: number | string;
  volume?: number | string;
  prev_close?: number | string;
  open?: number | string;
  high?: number | string;
  low?: number | string;
  exchange?: string;
  signal?: string;
}

function toNum(val: number | string | null | undefined, fallback = 0): number {
  if (val == null) return fallback;
  if (typeof val === 'number') return val;
  return parseFloat(String(val)) || fallback;
}

async function fetchAllMarketMovers(): Promise<TickerData[]> {
  console.log('[TickerScan] Fetching all rows from Supabase market_movers...');

  const { data, error } = await supabase
    .from('market_movers')
    .select('*')
    .order('change_pct', { ascending: false });

  if (error) {
    console.log('[TickerScan] Supabase error:', error.message);
    throw new Error(`Supabase market_movers: ${error.message}`);
  }

  const rows = (data ?? []) as MarketMoverRow[];
  console.log('[TickerScan] Rows from Supabase:', rows.length);

  const results: TickerData[] = rows.map(row => {
    const price = toNum(row.price);
    const changePct =
      toNum(row.change_pct) ||
      toNum(row.pct_change) ||
      toNum(row.percent_change);
    const prevClose = toNum(row.prev_close);
    const change = toNum(row.change) || (price - prevClose) || (changePct / 100) * price;

    return {
      symbol: row.symbol,
      price,
      prevClose: prevClose || price - change,
      change,
      changePct,
      volume: toNum(row.volume),
      open: toNum(row.open, price),
      high: toNum(row.high, price),
      low: toNum(row.low, price),
      exchange: row.exchange ?? undefined,
      signal: row.signal ?? undefined,
    };
  });

  console.log('[TickerScan] Mapped tickers:', results.length);
  return results;
}

export const [TickerScanProvider, useTickerScan] = createContextHook(() => {
  const [tickers, setTickers] = useState<TickerData[]>([]);
  const [lastScanTime, setLastScanTime] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const mountedRef = useRef<boolean>(true);

  useEffect(() => {
    mountedRef.current = true;
    void doScan();
    const interval = setInterval(() => void doScan(), 30_000);
    return () => {
      mountedRef.current = false;
      clearInterval(interval);
    };
  }, []);

  const loadCached = useCallback(async () => {
    if (!mountedRef.current) return;
    try {
      const raw = await AsyncStorage.getItem(SCAN_DATA_KEY);
      const time = await AsyncStorage.getItem(SCAN_TIME_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as TickerData[];
        if (mountedRef.current) setTickers(parsed);
      }
      if (time && mountedRef.current) setLastScanTime(time);
    } catch (e) {
      console.log('[TickerScan] Load cached error:', e);
    }
  }, []);

  const doScan = useCallback(async () => {
    if (!mountedRef.current) return;
    setIsScanning(true);
    setScanError(null);
    try {
      const data = await fetchAllMarketMovers();
      if (!mountedRef.current) return;

      const now = new Date();
      const timeStr = now.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      });

      await AsyncStorage.setItem(SCAN_DATA_KEY, JSON.stringify(data));
      await AsyncStorage.setItem(SCAN_TIME_KEY, timeStr);

      if (mountedRef.current) {
        setTickers(data);
        setLastScanTime(timeStr);
      }
      console.log('[TickerScan] Fetch complete at', timeStr, '—', data.length, 'rows');
    } catch (e) {
      const msg = String(e);
      console.log('[TickerScan] Fetch error:', msg);
      if (mountedRef.current) setScanError(msg);
      await loadCached();
    } finally {
      if (mountedRef.current) setIsScanning(false);
    }
  }, [loadCached]);

  const forceRefresh = useCallback(async () => {
    await doScan();
  }, [doScan]);

  return { tickers, lastScanTime, isScanning, scanError, forceRefresh };
});
