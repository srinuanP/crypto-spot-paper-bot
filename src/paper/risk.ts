import type { PaperState } from './types.js';

export type PaperRiskConfig = {
  maxNotional: number;
  maxTradesPerHour: number;
  cooldownMsAfterClose: number;
  dailyMaxLoss: number;
};

export type GuardRejectCode =
  | 'KILL_SWITCH_TRIGGERED'
  | 'DAILY_MAX_LOSS'
  | 'MAX_NOTIONAL'
  | 'MAX_TRADES_PER_HOUR'
  | 'COOLDOWN_ACTIVE'
  | 'INSUFFICIENT_CASH';

export type GuardResult =
  | { ok: true }
  | { ok: false; code: GuardRejectCode; reason: string; retryAfterMs?: number };

const HOUR_MS = 60 * 60 * 1000;

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

export function toLocalDateKey(ts: number): string {
  const date = new Date(ts);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function pruneOrderTimestamps(orderTimestamps: number[], now: number): number[] {
  const windowStart = now - HOUR_MS;
  return orderTimestamps.filter((ts) => ts >= windowStart);
}

export function computeDailyLoss(state: PaperState, currentEquity: number): number {
  return Math.max(0, state.daily.startEquity - currentEquity);
}

export function rollDailyStateIfNeeded(state: PaperState, now: number, currentEquity: number): boolean {
  const today = toLocalDateKey(now);
  if (state.daily.date === today) return false;
  state.daily = {
    date: today,
    startEquity: currentEquity,
    realizedPnl: 0,
    consecutiveLosses: 0,
    maxConsecutiveLosses: 0
  };
  state.killSwitchTriggered = false;
  return true;
}

export function checkDailyLossKillSwitch(
  config: PaperRiskConfig,
  state: PaperState,
  currentEquity: number
): GuardResult {
  if (state.killSwitchTriggered) {
    return { ok: false, code: 'KILL_SWITCH_TRIGGERED', reason: 'kill switch already triggered for this day' };
  }
  if (config.dailyMaxLoss <= 0) return { ok: true };
  const dailyLoss = computeDailyLoss(state, currentEquity);
  if (dailyLoss >= config.dailyMaxLoss) {
    return {
      ok: false,
      code: 'DAILY_MAX_LOSS',
      reason: `daily loss ${dailyLoss.toFixed(4)} reached limit ${config.dailyMaxLoss.toFixed(4)}`
    };
  }
  return { ok: true };
}

export type ValidateOrderInput = {
  now: number;
  side: 'BUY' | 'SELL';
  notional: number;
  currentEquity: number;
  cash: number;
};

export function validatePaperOrder(
  config: PaperRiskConfig,
  state: PaperState,
  input: ValidateOrderInput
): GuardResult {
  const killCheck = checkDailyLossKillSwitch(config, state, input.currentEquity);
  if (!killCheck.ok) return killCheck;

  if (input.side === 'BUY' && input.notional > config.maxNotional) {
    return {
      ok: false,
      code: 'MAX_NOTIONAL',
      reason: `order notional ${input.notional.toFixed(4)} exceeds max ${config.maxNotional.toFixed(4)}`
    };
  }

  if (input.side === 'BUY' && input.notional > input.cash) {
    return {
      ok: false,
      code: 'INSUFFICIENT_CASH',
      reason: `required cash ${input.notional.toFixed(4)} exceeds available ${input.cash.toFixed(4)}`
    };
  }

  state.orderTimestamps = pruneOrderTimestamps(state.orderTimestamps, input.now);
  if (state.orderTimestamps.length >= config.maxTradesPerHour) {
    return {
      ok: false,
      code: 'MAX_TRADES_PER_HOUR',
      reason: `max trades/hour exceeded (${config.maxTradesPerHour})`
    };
  }

  if (input.side === 'BUY' && state.lastCloseAt !== null && config.cooldownMsAfterClose > 0) {
    const elapsed = input.now - state.lastCloseAt;
    if (elapsed < config.cooldownMsAfterClose) {
      return {
        ok: false,
        code: 'COOLDOWN_ACTIVE',
        reason: `cooldown active, wait ${config.cooldownMsAfterClose - elapsed} ms`,
        retryAfterMs: config.cooldownMsAfterClose - elapsed
      };
    }
  }

  return { ok: true };
}

export function recordFilledOrder(state: PaperState, ts: number): void {
  state.orderTimestamps = pruneOrderTimestamps([...state.orderTimestamps, ts], ts);
}

export function recordClosedTrade(state: PaperState, ts: number, realizedPnl: number): void {
  state.lastCloseAt = ts;
  state.daily.realizedPnl += realizedPnl;
  if (realizedPnl < 0) {
    state.daily.consecutiveLosses += 1;
    if (state.daily.consecutiveLosses > state.daily.maxConsecutiveLosses) {
      state.daily.maxConsecutiveLosses = state.daily.consecutiveLosses;
    }
  } else {
    state.daily.consecutiveLosses = 0;
  }
}
