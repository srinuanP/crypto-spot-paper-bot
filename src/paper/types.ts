export type PaperOpenPosition = {
  qty: number;
  entryPrice: number;
  entryTime: number;
  entryFee: number;
  entryReason?: string;
};

export type PaperDailyState = {
  date: string;
  startEquity: number;
  realizedPnl: number;
  consecutiveLosses: number;
  maxConsecutiveLosses: number;
};

export type PaperStats = {
  buys: number;
  sells: number;
  rejects: number;
};

export type PaperState = {
  version: 1;
  symbol: string;
  interval: string;
  strategy: string;
  createdAt: number;
  updatedAt: number;
  lastProcessedCandleTime: number;
  cash: number;
  openPosition: PaperOpenPosition | null;
  lastCloseAt: number | null;
  orderTimestamps: number[];
  killSwitchTriggered: boolean;
  daily: PaperDailyState;
  stats: PaperStats;
};

export type PaperStateInit = {
  symbol: string;
  interval: string;
  strategy: string;
  initialCapital: number;
  now: number;
};
