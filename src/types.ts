export type Candle = {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
};

export type SignalAction = 'BUY' | 'SELL' | 'HOLD';

export type Signal = {
  action: SignalAction;
  reason?: string;
};

export type StrategyFn = (candles: Candle[], index: number) => Signal;
