import test from 'node:test';
import assert from 'node:assert/strict';
import { toExperimentMetrics } from '../src/experiments/metrics.js';
import type { BacktestResult } from '../src/backtest/engine.js';

test('toExperimentMetrics computes deterministic values from sample result', () => {
  const sample: BacktestResult = {
    trades: [
      { entryTime: 1, entryPrice: 100, exitTime: 2, exitPrice: 110, qty: 1, pnl: 10, pnlPct: 0.1 },
      { entryTime: 3, entryPrice: 110, exitTime: 4, exitPrice: 105, qty: 1, pnl: -5, pnlPct: -0.0454545 }
    ],
    equityCurve: [100, 110, 105],
    metrics: {
      totalReturn: 0.05,
      maxDrawdown: 0.0454545,
      winRate: 0.5,
      profitFactor: 2,
      numberOfTrades: 2
    }
  };

  const metrics = toExperimentMetrics(sample);
  assert.equal(metrics.totalReturnPct, 5);
  assert.ok(Math.abs(metrics.maxDrawdownPct - 4.54545) < 1e-4);
  assert.equal(metrics.winRatePct, 50);
  assert.equal(metrics.profitFactor, 2);
  assert.equal(metrics.numTrades, 2);
  assert.ok(Math.abs(metrics.avgPnl - 2.5) < 1e-9);
  assert.ok(Math.abs(metrics.expectancy - 2.5) < 1e-9);
});
