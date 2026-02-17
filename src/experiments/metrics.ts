import type { BacktestResult, Trade } from '../backtest/engine.js';

export type ExperimentMetrics = {
  totalReturnPct: number;
  maxDrawdownPct: number;
  winRatePct: number;
  profitFactor: number;
  numTrades: number;
  avgTradePct: number;
  avgPnl: number;
  expectancy: number;
};

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function averageWinLossPnL(trades: Trade[]): { avgWin: number; avgLoss: number } {
  const wins = trades.filter((trade) => trade.pnl > 0).map((trade) => trade.pnl);
  const losses = trades.filter((trade) => trade.pnl < 0).map((trade) => Math.abs(trade.pnl));
  return {
    avgWin: mean(wins),
    avgLoss: mean(losses)
  };
}

export function calculateExpectancy(trades: Trade[]): number {
  if (trades.length === 0) return 0;
  const winRate = trades.filter((trade) => trade.pnl > 0).length / trades.length;
  const { avgWin, avgLoss } = averageWinLossPnL(trades);
  return winRate * avgWin - (1 - winRate) * avgLoss;
}

export function toExperimentMetrics(result: BacktestResult): ExperimentMetrics {
  const trades = result.trades;
  const avgTradePct = mean(trades.map((trade) => trade.pnlPct)) * 100;
  const avgPnl = mean(trades.map((trade) => trade.pnl));

  return {
    totalReturnPct: result.metrics.totalReturn * 100,
    maxDrawdownPct: result.metrics.maxDrawdown * 100,
    winRatePct: result.metrics.winRate * 100,
    profitFactor: result.metrics.profitFactor,
    numTrades: result.metrics.numberOfTrades,
    avgTradePct,
    avgPnl,
    expectancy: calculateExpectancy(trades)
  };
}
