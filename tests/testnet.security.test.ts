import test from 'node:test';
import assert from 'node:assert/strict';
import { buildQuery, signQuery } from '../src/exchange/binanceTestnetRest.js';
import { RiskGuards } from '../src/core/riskGuards.js';
import { assertLiveTradingAllowed } from '../src/core/safetySwitch.js';

test('buildQuery sorts keys and excludes undefined/null', () => {
  const query = buildQuery({ b: 2, a: 'x y', c: undefined, d: null });
  assert.equal(query, 'a=x%20y&b=2');
});

test('signQuery deterministic', () => {
  const sig1 = signQuery('secret', 'a=1&b=2');
  const sig2 = signQuery('secret', 'a=1&b=2');
  assert.equal(sig1, sig2);
  assert.equal(sig1.length, 64);
});

test('riskGuards reject by notional and rate limit', async () => {
  const guards = new RiskGuards(20, 2);

  const tooBig = guards.validate({ symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', quoteOrderQty: 25 });
  assert.equal(tooBig.ok, false);

  const ok1 = guards.validate({ symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', quoteOrderQty: 10 });
  const ok2 = guards.validate({ symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', quoteOrderQty: 10 });
  const rateBlocked = guards.validate({ symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', quoteOrderQty: 10 });

  assert.equal(ok1.ok, true);
  assert.equal(ok2.ok, true);
  assert.equal(rateBlocked.ok, false);
});

test('safety switch rejects unless all conditions met', () => {
  process.env.EXECUTION_MODE = 'paper';
  process.env.BINANCE_TESTNET_TRADING_ENABLED = 'NO';
  assert.throws(() => assertLiveTradingAllowed('YES'));

  process.env.EXECUTION_MODE = 'testnet';
  process.env.BINANCE_TESTNET_TRADING_ENABLED = 'YES';
  assert.throws(() => assertLiveTradingAllowed('NO'));

  assert.doesNotThrow(() => assertLiveTradingAllowed('YES'));
});
