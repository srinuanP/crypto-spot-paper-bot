export type DashboardHealth = {
  ok: true;
  ts: string;
};

export type BacktestReport = {
  generatedAt?: string;
  symbol?: string;
  interval?: string;
  strategy?: string;
  metrics?: {
    totalReturn?: number;
    maxDrawdown?: number;
    winRate?: number;
    profitFactor?: number;
    numberOfTrades?: number;
  };
  equityCurve?: number[];
  trades?: Array<Record<string, unknown>>;
};

export type PaperLogRow = {
  ts?: number;
  event?: string;
  symbol?: string;
  strategy?: string;
  side?: string;
  reason?: string;
  [key: string]: unknown;
};

export type JournalLatest =
  | { format: 'json'; data: Record<string, unknown> }
  | { format: 'markdown'; data: string };

export type PaperTailResponse = {
  ok: true;
  items: PaperLogRow[];
  message?: string;
};
