import type { Candle, StrategyFn } from '../types.js';

export type BacktestConfig = {
  initialCapital: number;
  feeBps: number;
  slippageBps: number;
  riskPerTradePct: number;
  stopLossPct?: number;
};

export type Trade = {
  entryTime: number;
  entryPrice: number;
  exitTime: number;
  exitPrice: number;
  qty: number;
  pnl: number;
  pnlPct: number;
  reason?: string;
};

export type BacktestResult = {
  trades: Trade[];
  equityCurve: number[];
  metrics: {
    totalReturn: number;
    maxDrawdown: number;
    winRate: number;
    profitFactor: number;
    numberOfTrades: number;
  };
};

export function calculateMaxDrawdown(equityCurve: number[]): number {
  if (equityCurve.length === 0) return 0;
  let peak = equityCurve[0];
  let maxDd = 0;
  for (const value of equityCurve) {
    if (value > peak) peak = value;
    const dd = (value - peak) / peak;
    if (dd < maxDd) maxDd = dd;
  }
  return Math.abs(maxDd);
}

export function runBacktest(candles: Candle[], strategy: StrategyFn, config: BacktestConfig): BacktestResult {
  if (candles.length < 3) throw new Error('Not enough candles for backtest.');

  let cash = config.initialCapital;
  let qty = 0;
  let entryPrice = 0;
  let entryTime = 0;
  let entryReason = '';

  const trades: Trade[] = [];
  const equityCurve: number[] = [];
  const feeRate = config.feeBps / 10_000;
  const slippageRate = config.slippageBps / 10_000;

  for (let i = 0; i < candles.length - 1; i += 1) {
    const candle = candles[i];

    if (qty > 0 && config.stopLossPct && candle.l <= entryPrice * (1 - config.stopLossPct)) {
      const stopFillPrice = entryPrice * (1 - config.stopLossPct) * (1 - slippageRate);
      const notional = qty * stopFillPrice;
      const fee = notional * feeRate;
      const proceeds = notional - fee;
      cash += proceeds;
      const pnl = (stopFillPrice - entryPrice) * qty;
      trades.push({
        entryTime,
        entryPrice,
        exitTime: candle.t,
        exitPrice: stopFillPrice,
        qty,
        pnl: pnl - (entryPrice * qty + notional) * feeRate,
        pnlPct: pnl / (entryPrice * qty),
        reason: 'STOP_LOSS'
      });
      qty = 0;
      entryPrice = 0;
    }

    const signal = strategy(candles, i);
    const nextOpen = candles[i + 1].o;

    if (signal.action === 'BUY' && qty === 0) {
      const capitalAtRisk = Math.min(cash, cash * config.riskPerTradePct);
      if (capitalAtRisk > 0) {
        const fillPrice = nextOpen * (1 + slippageRate);
        const buyQty = capitalAtRisk / fillPrice;
        const notional = buyQty * fillPrice;
        const fee = notional * feeRate;
        cash -= notional + fee;
        qty = buyQty;
        entryPrice = fillPrice;
        entryTime = candles[i + 1].t;
        entryReason = signal.reason ?? 'BUY_SIGNAL';
      }
    } else if (signal.action === 'SELL' && qty > 0) {
      const fillPrice = nextOpen * (1 - slippageRate);
      const notional = qty * fillPrice;
      const fee = notional * feeRate;
      const proceeds = notional - fee;
      cash += proceeds;
      const gross = (fillPrice - entryPrice) * qty;
      const totalFees = (entryPrice * qty + notional) * feeRate;
      trades.push({
        entryTime,
        entryPrice,
        exitTime: candles[i + 1].t,
        exitPrice: fillPrice,
        qty,
        pnl: gross - totalFees,
        pnlPct: gross / (entryPrice * qty),
        reason: signal.reason ?? entryReason
      });
      qty = 0;
      entryPrice = 0;
    }

    const markedToMarket = cash + qty * candle.c;
    equityCurve.push(markedToMarket);
  }

  if (qty > 0) {
    const last = candles[candles.length - 1];
    const fillPrice = last.c * (1 - slippageRate);
    const notional = qty * fillPrice;
    const fee = notional * feeRate;
    cash += notional - fee;
    const gross = (fillPrice - entryPrice) * qty;
    const totalFees = (entryPrice * qty + notional) * feeRate;
    trades.push({
      entryTime,
      entryPrice,
      exitTime: last.t,
      exitPrice: fillPrice,
      qty,
      pnl: gross - totalFees,
      pnlPct: gross / (entryPrice * qty),
      reason: 'FORCE_CLOSE_END_OF_TEST'
    });
    equityCurve.push(cash);
  }

  const finalEquity = equityCurve.at(-1) ?? cash;
  const totalReturn = finalEquity / config.initialCapital - 1;
  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl < 0);
  const grossProfit = wins.reduce((sum, t) => sum + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((sum, t) => sum + t.pnl, 0));

  return {
    trades,
    equityCurve,
    metrics: {
      totalReturn,
      maxDrawdown: calculateMaxDrawdown(equityCurve),
      winRate: trades.length ? wins.length / trades.length : 0,
      profitFactor: grossLoss === 0 ? (grossProfit > 0 ? Infinity : 0) : grossProfit / grossLoss,
      numberOfTrades: trades.length
    }
  };
}
