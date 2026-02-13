import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialPaperState } from '../src/paper/state.js';
import {
  checkDailyLossKillSwitch,
  recordClosedTrade,
  recordFilledOrder,
  type PaperRiskConfig,
  validatePaperOrder
} from '../src/paper/risk.js';

function baseState() {
  return createInitialPaperState({
    symbol: 'BTCUSDT',
    interval: '1m',
    strategy: 'smaCross',
    initialCapital: 100,
    now: Date.UTC(2026, 1, 13, 0, 0, 0)
  });
}

test('paper guards enforce max trades per hour and cooldown', () => {
  const config: PaperRiskConfig = {
    maxNotional: 20,
    maxTradesPerHour: 2,
    cooldownMsAfterClose: 60_000,
    dailyMaxLoss: 10
  };
  const state = baseState();
  const now = Date.UTC(2026, 1, 13, 10, 0, 0);

  const order1 = validatePaperOrder(config, state, {
    now,
    side: 'BUY',
    notional: 10,
    currentEquity: 100,
    cash: 100
  });
  assert.equal(order1.ok, true);
  recordFilledOrder(state, now);

  const order2 = validatePaperOrder(config, state, {
    now: now + 1_000,
    side: 'SELL',
    notional: 10,
    currentEquity: 100,
    cash: 90
  });
  assert.equal(order2.ok, true);
  recordFilledOrder(state, now + 1_000);
  recordClosedTrade(state, now + 1_000, 1);

  const blockedByRate = validatePaperOrder(config, state, {
    now: now + 2_000,
    side: 'BUY',
    notional: 10,
    currentEquity: 100,
    cash: 90
  });
  assert.equal(blockedByRate.ok, false);
  if (!blockedByRate.ok) assert.equal(blockedByRate.code, 'MAX_TRADES_PER_HOUR');

  state.orderTimestamps = [];
  const blockedByCooldown = validatePaperOrder(config, state, {
    now: now + 30_000,
    side: 'BUY',
    notional: 10,
    currentEquity: 100,
    cash: 90
  });
  assert.equal(blockedByCooldown.ok, false);
  if (!blockedByCooldown.ok) assert.equal(blockedByCooldown.code, 'COOLDOWN_ACTIVE');
});

test('daily max loss kill switch is triggered deterministically', () => {
  const config: PaperRiskConfig = {
    maxNotional: 20,
    maxTradesPerHour: 10,
    cooldownMsAfterClose: 0,
    dailyMaxLoss: 2
  };
  const state = baseState();
  const check = checkDailyLossKillSwitch(config, state, 97.9);

  assert.equal(check.ok, false);
  if (!check.ok) {
    assert.equal(check.code, 'DAILY_MAX_LOSS');
    assert.match(check.reason, /daily loss 2.1000 reached limit 2.0000/);
  }
});
