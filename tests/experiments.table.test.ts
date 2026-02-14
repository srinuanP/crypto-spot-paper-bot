import test from 'node:test';
import assert from 'node:assert/strict';
import { renderExperimentTable } from '../src/experiments/table.js';
import type { ExperimentRunEntry } from '../src/experiments/runner.js';

test('renderExperimentTable returns stable table output and does not crash', () => {
  const entries: ExperimentRunEntry[] = [
    {
      id: 'BTC|1h|sma',
      symbol: 'BTCUSDT',
      interval: '1h',
      strategy: { name: 'smaCross', params: { short: 9, long: 21 } },
      status: 'ok',
      metrics: {
        totalReturnPct: 3.2,
        maxDrawdownPct: 1.5,
        winRatePct: 55,
        profitFactor: 1.4,
        numTrades: 24,
        avgTradePct: 0.4,
        avgPnl: 4.2,
        expectancy: 1.2
      }
    },
    {
      id: 'ETH|1h|rsi',
      symbol: 'ETHUSDT',
      interval: '1h',
      strategy: { name: 'rsiMeanReversion', params: { rsiPeriod: 14, buyBelow: 30, sellAbove: 70 } },
      status: 'failed',
      error: 'network down'
    }
  ];

  const table = renderExperimentTable(entries, {
    sort: 'expectancy',
    top: 5,
    minTrades: 0
  });

  assert.match(table, /symbol/);
  assert.match(table, /BTCUSDT/);
  assert.match(table, /Failed entries/);
  assert.match(table, /network down/);
});
