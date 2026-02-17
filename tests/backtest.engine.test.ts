import test from 'node:test';
import assert from 'node:assert/strict';
import type { Candle, StrategyFn } from '../src/types.js';
import { calculateMaxDrawdown, runBacktest } from '../src/backtest/engine.js';

const candles: Candle[] = [
  { t: 1, o: 100, h: 101, l: 99, c: 100, v: 10 },
  { t: 2, o: 110, h: 111, l: 109, c: 110, v: 10 },
  { t: 3, o: 120, h: 121, l: 119, c: 120, v: 10 },
  { t: 4, o: 130, h: 131, l: 129, c: 130, v: 10 }
];

test('enters on next candle open (no lookahead)', () => {
  const strat: StrategyFn = (_, index) => {
    if (index === 0) return { action: 'BUY', reason: 'test-buy' };
    if (index === 2) return { action: 'SELL', reason: 'test-sell' };
    return { action: 'HOLD' };
  };

  const res = runBacktest(candles, strat, {
    initialCapital: 1000,
    feeBps: 0,
    slippageBps: 0,
    riskPerTradePct: 1
  });

  assert.equal(res.trades[0].entryTime, 2);
  assert.equal(res.trades[0].entryPrice, 110);
});

test('fee and slippage reduce pnl', () => {
  const strat: StrategyFn = (_, index) => {
    if (index === 0) return { action: 'BUY' };
    if (index === 2) return { action: 'SELL' };
    return { action: 'HOLD' };
  };

  const noCost = runBacktest(candles, strat, {
    initialCapital: 1000,
    feeBps: 0,
    slippageBps: 0,
    riskPerTradePct: 1
  });

  const withCost = runBacktest(candles, strat, {
    initialCapital: 1000,
    feeBps: 10,
    slippageBps: 5,
    riskPerTradePct: 1
  });

  assert.ok(withCost.trades[0].pnl < noCost.trades[0].pnl);
});

test('calculates max drawdown correctly', () => {
  const dd = calculateMaxDrawdown([100, 120, 90, 110]);
  assert.ok(Math.abs(dd - 0.25) < 1e-6);
});
