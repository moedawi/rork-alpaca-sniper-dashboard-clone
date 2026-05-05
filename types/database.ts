export interface Trade {
  id: string;
  created_at: string;
  symbol?: string;
  pnl: number;
  side?: string;
  qty?: number;
  entry_price?: number;
  exit_price?: number;
}

export interface Event {
  id: string;
  created_at: string;
  type: string;
  symbol?: string;
  message: string;
}

export interface Position {
  id: string;
  symbol: string;
  entry_price: number;
  current_price: number;
  pnl_pct: number;
  qty: number;
}

export interface Command {
  command: string;
  symbol: string;
  created_at?: string;
}

export interface MarketMover {
  id?: string | number;
  symbol: string;
  price: number;
  change_pct: number;
  change?: number;
  prev_close?: number;
  open?: number;
  high?: number;
  low?: number;
  volume?: number | bigint;
  signal?: string;
  exchange?: string;
  created_at?: string;
  updated_at?: string;
}
