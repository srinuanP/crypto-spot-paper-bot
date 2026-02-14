import test from 'node:test';
import assert from 'node:assert/strict';
import { compareReports } from '../src/experiments/compare.js';
import type { ExperimentReport } from '../src/experiments/runner.js';

function report(results: ExperimentReport['results']): ExperimentReport {
  return {
    metadata: {
      generatedAt: '2026-02-13T00:00:00.000Z',
      seed: 42,
      nodeVersion: process.version,
      gitCommitHash: 'abc123',
      config: {
        symbols: ['BTCUSDT'],
        intervals: ['1h'],
        strategies: [{ name: 'smaCross', params: { short: 9, long: 21 } }],
        limit: 300,
        feeBps: 10,
        slippageBps: 5,
        initialCapital: 10_000,
        riskPerTradePct: 0.1,
        concurrency: 1,
        top: 5,
        sort: 'expectancy',
        minTrades: 0,
        cacheTtlMs: 1000,
        outputDir: 'reports/experiments',
        saveDetails: false,
        seed: 42
      }
    },
    results
  };
}

test('compareReports detects added/removed/changed entries', () => {
  const a = report([
    {
      id: 'BTC|1h|sma',
      symbol: 'BTCUSDT',
      interval: '1h',
      strategy: { name: 'smaCross', params: { short: 9, long: 21 } },
      status: 'ok',
      metrics: {
        totalReturnPct: 1,
        maxDrawdownPct: 2,
        winRatePct: 50,
        profitFactor: 1.1,
        numTrades: 10,
        avgTradePct: 0.1,
        avgPnl: 1,
        expectancy: 0.5
      }
    },
    {
      id: 'ETH|1h|sma',
      symbol: 'ETHUSDT',
      interval: '1h',
      strategy: { name: 'smaCross', params: { short: 9, long: 21 } },
      status: 'ok',
      metrics: {
        totalReturnPct: 0.5,
        maxDrawdownPct: 3,
        winRatePct: 40,
        profitFactor: 1.0,
        numTrades: 10,
        avgTradePct: 0.05,
        avgPnl: 0.5,
        expectancy: 0.2
      }
    }
  ]);

  const b = report([
    {
      id: 'BTC|1h|sma',
      symbol: 'BTCUSDT',
      interval: '1h',
      strategy: { name: 'smaCross', params: { short: 9, long: 21 } },
      status: 'ok',
      metrics: {
        totalReturnPct: 2,
        maxDrawdownPct: 2.5,
        winRatePct: 55,
        profitFactor: 1.4,
        numTrades: 12,
        avgTradePct: 0.12,
        avgPnl: 1.2,
        expectancy: 0.8
      }
    },
    {
      id: 'BNB|1h|sma',
      symbol: 'BNBUSDT',
      interval: '1h',
      strategy: { name: 'smaCross', params: { short: 9, long: 21 } },
      status: 'ok',
      metrics: {
        totalReturnPct: 3,
        maxDrawdownPct: 1,
        winRatePct: 60,
        profitFactor: 1.6,
        numTrades: 8,
        avgTradePct: 0.2,
        avgPnl: 2.5,
        expectancy: 1.1
      }
    }
  ]);

  const diff = compareReports(a, b, 'expectancy');
  assert.equal(diff.rows.length, 1);
  assert.equal(diff.rows[0].id, 'BTC|1h|sma');
  assert.ok(diff.rows[0].delta > 0);
  assert.deepEqual(diff.addedInB, ['BNB|1h|sma']);
  assert.deepEqual(diff.removedInB, ['ETH|1h|sma']);
  assert.equal(diff.improvedCount, 1);
});
