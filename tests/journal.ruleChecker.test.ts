import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzePaperEntries } from '../src/journal/ruleChecker.js';
import { toLocalDateKey } from '../src/paper/risk.js';

test('journal rule checker returns deterministic violations for paper log entries', () => {
  const baseTs = new Date(2026, 1, 13, 10, 0, 0, 0).getTime();
  const date = toLocalDateKey(baseTs);
  const rows = [
    { ts: baseTs, event: 'CONFIG', maxTradesPerHour: 3, cooldownMs: 60_000, maxNotional: 20 },
    { ts: baseTs + 1_000, event: 'BUY', notional: 10, fee: 0.1, fill: 100, qty: 0.1 },
    { ts: baseTs + 2_000, event: 'SELL', notional: 9, fee: 0.1, fill: 99, qty: 0.1, realizedPnl: -1 },
    { ts: baseTs + 3_000, event: 'BUY', notional: 10, fee: 0.1, fill: 99, qty: 0.101 },
    { ts: baseTs + 4_000, event: 'SELL', notional: 9.5, fee: 0.1, fill: 98, qty: 0.101, realizedPnl: -0.5 },
    { ts: baseTs + 5_000, event: 'BUY', notional: 10, fee: 0.1, fill: 98, qty: 0.102 },
    { ts: baseTs + 6_000, event: 'SELL', notional: 9.8, fee: 0.1, fill: 97, qty: 0.102, realizedPnl: -0.2 },
    { ts: baseTs + 6_500, event: 'REJECT', side: 'BUY', code: 'COOLDOWN_ACTIVE', reason: 'cooldown active' },
    { ts: baseTs + 7_000, event: 'REJECT', side: 'BUY', code: 'MAX_NOTIONAL', reason: 'too big' },
    { ts: baseTs + 8_000, event: 'TICK', equity: 100 },
    { ts: baseTs + 9_000, event: 'TICK', equity: 99 },
    { ts: baseTs + 10_000, event: 'TICK', equity: 97 }
  ];

  const analysis = analyzePaperEntries(rows, date, baseTs + 10_000);
  assert.equal(analysis.pnl, -1.7);
  assert.equal(analysis.trades, 3);
  assert.equal(analysis.winRate, 0);
  assert.ok(analysis.maxDrawdown > 0);

  const codes = analysis.violations.map((row) => row.code);
  assert.deepEqual(codes, ['MAX_TRADES_PER_HOUR', 'COOLDOWN_BREACH', 'MAX_NOTIONAL', 'CONSECUTIVE_LOSS']);
  assert.ok(analysis.recommendations.length >= 3);
  assert.equal(analysis.notes.length, 0);
});
