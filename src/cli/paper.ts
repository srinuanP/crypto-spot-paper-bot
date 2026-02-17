import path from 'node:path';
import { appendFile, mkdir } from 'node:fs/promises';
import { parseArgs } from './args.js';
import { fetchKlines, fetchPrice } from '../exchange/binancePublic.js';
import { createSmaCrossStrategy } from '../strategy/smaCross.js';
import { createRsiMeanReversionStrategy } from '../strategy/rsiMeanReversion.js';
import type { Candle, Signal, StrategyFn } from '../types.js';
import {
  checkDailyLossKillSwitch,
  recordClosedTrade,
  recordFilledOrder,
  rollDailyStateIfNeeded,
  type PaperRiskConfig,
  validatePaperOrder
} from '../paper/risk.js';
import { createInitialPaperState, loadPaperState, savePaperState } from '../paper/state.js';
import type { PaperState } from '../paper/types.js';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const MAX_CONFIG_LOG_PREVIEW = 240;

type PaperConfig = {
  symbol: string;
  interval: string;
  strategyName: string;
  pollMs: number;
  maxTicks: number;
  historyLimit: number;
  riskPct: number;
  initialCapital: number;
  feeBps: number;
  slippageBps: number;
  stateFile: string;
  logFile: string;
  resetState: boolean;
  guard: PaperRiskConfig;
};

function printUsage(): void {
  const lines = [
    'Usage: npm run paper -- [options]',
    '',
    'Main options:',
    '  --symbol BTCUSDT           Trading symbol (default: BTCUSDT)',
    '  --interval 1m              Candle interval (default: 15m)',
    '  --strategy smaCross        Strategy: smaCross | rsiMeanReversion',
    '  --pollMs 5000              Poll interval in milliseconds',
    '  --maxTicks 100             Optional finite ticks; omit for continuous run',
    '',
    'Risk guards (paper only):',
    '  --maxNotional 20           Max notional per simulated order',
    '  --maxTradesPerHour 20      Max filled orders per rolling hour',
    '  --cooldownMs 120000        Cooldown after closing a deal',
    '  --dailyMaxLoss 2           Daily max loss in quote currency',
    '',
    'Portfolio and cost:',
    '  --initialCapital 10000',
    '  --riskPct 0.1',
    '  --feeBps 10',
    '  --slippageBps 5',
    '',
    'Persistence:',
    '  --stateFile paper-state.json',
    '  --logFile paper-log.jsonl',
    '  --resetState               Ignore old state and start fresh',
    '',
    'Examples:',
    '  npm run paper -- --symbol BTCUSDT --interval 1m --strategy smaCross --pollMs 5000 --maxNotional 20 --dailyMaxLoss 2',
    '  npm run paper -- --symbol BTCUSDT --interval 1m --maxTicks 12 --pollMs 5000',
    ''
  ];
  console.log(lines.join('\n'));
}

function parseNumberArg(args: Record<string, string>, key: string, fallback: number, min = 0): number {
  const parsed = Number(args[key]);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, parsed);
}

function parseMaxTicksArg(args: Record<string, string>): number {
  if (!args.maxTicks) return Number.POSITIVE_INFINITY;
  const parsed = Math.floor(Number(args.maxTicks));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : Number.POSITIVE_INFINITY;
}

function parsePaperConfig(args: Record<string, string>): PaperConfig {
  const initialCapital = parseNumberArg(args, 'initialCapital', 10_000, 1);
  const dailyLossLimitPct = parseNumberArg(args, 'dailyLossLimitPct', 0.0002, 0);
  const dailyMaxLoss = args.dailyMaxLoss
    ? parseNumberArg(args, 'dailyMaxLoss', 2, 0)
    : initialCapital * dailyLossLimitPct;

  return {
    symbol: args.symbol ?? 'BTCUSDT',
    interval: args.interval ?? '15m',
    strategyName: args.strategy ?? 'smaCross',
    pollMs: parseNumberArg(args, 'pollMs', 5000, 250),
    maxTicks: parseMaxTicksArg(args),
    historyLimit: parseNumberArg(args, 'historyLimit', 300, 50),
    riskPct: parseNumberArg(args, 'riskPct', 0.002, 0),
    initialCapital,
    feeBps: parseNumberArg(args, 'feeBps', 10, 0),
    slippageBps: parseNumberArg(args, 'slippageBps', 5, 0),
    stateFile: args.stateFile ?? 'paper-state.json',
    logFile: args.logFile ?? 'paper-log.jsonl',
    resetState: args.resetState === 'true',
    guard: {
      maxNotional: parseNumberArg(args, 'maxNotional', 20, 0.01),
      maxTradesPerHour: parseNumberArg(args, 'maxTradesPerHour', 20, 1),
      cooldownMsAfterClose: parseNumberArg(args, 'cooldownMs', 120_000, 0),
      dailyMaxLoss
    }
  };
}

function strategyFactory(strategyName: string): StrategyFn {
  if (strategyName === 'rsiMeanReversion') return createRsiMeanReversionStrategy();
  return createSmaCrossStrategy();
}

async function ensureParentDir(filePath: string): Promise<void> {
  const dir = path.dirname(path.resolve(filePath));
  await mkdir(dir, { recursive: true });
}

async function writeLog(logFile: string, payload: Record<string, unknown>): Promise<void> {
  await appendFile(logFile, `${JSON.stringify(payload)}\n`);
}

function createErrorLogger() {
  const lastLogAt = new Map<string, number>();
  return (key: string, message: string) => {
    const now = Date.now();
    const last = lastLogAt.get(key) ?? 0;
    if (now - last >= 10_000) {
      console.error(message);
      lastLogAt.set(key, now);
    }
  };
}

function currentEquity(state: PaperState, markPrice: number): number {
  return state.cash + (state.openPosition ? state.openPosition.qty * markPrice : 0);
}

type ProcessResult = {
  processed: number;
  lastSignal: Signal;
  killTriggered: boolean;
};

async function processPendingCandles(params: {
  config: PaperConfig;
  state: PaperState;
  strategy: StrategyFn;
  candles: Candle[];
  logFile: string;
}): Promise<ProcessResult> {
  const { config, state, strategy, candles, logFile } = params;
  const feeRate = config.feeBps / 10_000;
  const slippageRate = config.slippageBps / 10_000;
  let processed = 0;
  let lastSignal: Signal = { action: 'HOLD', reason: 'NO_NEW_CANDLE' };
  let killTriggered = false;

  for (let i = 1; i < candles.length - 1; i += 1) {
    const signalCandle = candles[i];
    const fillCandle = candles[i + 1];
    if (signalCandle.t <= state.lastProcessedCandleTime) continue;

    const equityAtSignal = currentEquity(state, signalCandle.c);
    rollDailyStateIfNeeded(state, signalCandle.t, equityAtSignal);

    const dailyLossCheck = checkDailyLossKillSwitch(config.guard, state, equityAtSignal);
    if (!dailyLossCheck.ok) {
      state.killSwitchTriggered = true;
      await writeLog(logFile, {
        ts: signalCandle.t,
        event: 'KILL_SWITCH',
        reason: dailyLossCheck.reason,
        code: dailyLossCheck.code,
        equity: equityAtSignal,
        dailyStartEquity: state.daily.startEquity,
        dailyRealizedPnl: state.daily.realizedPnl
      });
      state.lastProcessedCandleTime = signalCandle.t;
      killTriggered = true;
      break;
    }

    const signal = strategy(candles, i);
    lastSignal = signal;

    if (signal.action === 'BUY' && state.openPosition === null) {
      const spend = Math.min(state.cash, state.cash * config.riskPct);
      const fillPrice = fillCandle.o * (1 + slippageRate);
      const buyQty = spend > 0 ? spend / fillPrice : 0;
      const fee = spend * feeRate;

      const guard = validatePaperOrder(config.guard, state, {
        now: fillCandle.t,
        side: 'BUY',
        notional: spend,
        currentEquity: equityAtSignal,
        cash: state.cash
      });

      if (!guard.ok) {
        state.stats.rejects += 1;
        await writeLog(logFile, {
          ts: fillCandle.t,
          event: 'REJECT',
          side: 'BUY',
          code: guard.code,
          reason: guard.reason,
          symbol: config.symbol,
          signalReason: signal.reason,
          notional: spend
        });
      } else if (spend + fee > state.cash || buyQty <= 0) {
        state.stats.rejects += 1;
        await writeLog(logFile, {
          ts: fillCandle.t,
          event: 'REJECT',
          side: 'BUY',
          code: 'INSUFFICIENT_CASH',
          reason: `required ${(spend + fee).toFixed(4)} exceeds cash ${state.cash.toFixed(4)}`,
          symbol: config.symbol,
          signalReason: signal.reason,
          notional: spend
        });
      } else {
        state.cash -= spend + fee;
        state.openPosition = {
          qty: buyQty,
          entryPrice: fillPrice,
          entryTime: fillCandle.t,
          entryFee: fee,
          entryReason: signal.reason
        };
        state.stats.buys += 1;
        recordFilledOrder(state, fillCandle.t);
        await writeLog(logFile, {
          ts: fillCandle.t,
          event: 'BUY',
          symbol: config.symbol,
          fill: fillPrice,
          qty: buyQty,
          fee,
          notional: spend,
          reason: signal.reason,
          cash: state.cash
        });
      }
    } else if (signal.action === 'SELL' && state.openPosition !== null) {
      const fillPrice = fillCandle.o * (1 - slippageRate);
      const notional = state.openPosition.qty * fillPrice;
      const guard = validatePaperOrder(config.guard, state, {
        now: fillCandle.t,
        side: 'SELL',
        notional,
        currentEquity: currentEquity(state, fillPrice),
        cash: state.cash
      });

      if (!guard.ok) {
        state.stats.rejects += 1;
        await writeLog(logFile, {
          ts: fillCandle.t,
          event: 'REJECT',
          side: 'SELL',
          code: guard.code,
          reason: guard.reason,
          symbol: config.symbol,
          signalReason: signal.reason,
          notional
        });
      } else {
        const fee = notional * feeRate;
        const proceeds = notional - fee;
        const grossPnl = (fillPrice - state.openPosition.entryPrice) * state.openPosition.qty;
        const realizedPnl = grossPnl - state.openPosition.entryFee - fee;

        state.cash += proceeds;
        state.stats.sells += 1;
        recordFilledOrder(state, fillCandle.t);
        recordClosedTrade(state, fillCandle.t, realizedPnl);

        await writeLog(logFile, {
          ts: fillCandle.t,
          event: 'SELL',
          symbol: config.symbol,
          fill: fillPrice,
          qty: state.openPosition.qty,
          fee,
          notional,
          reason: signal.reason,
          cash: state.cash,
          realizedPnl,
          dailyRealizedPnl: state.daily.realizedPnl
        });
        state.openPosition = null;
      }
    }

    state.lastProcessedCandleTime = signalCandle.t;
    processed += 1;
  }

  return { processed, lastSignal, killTriggered };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help === 'true') {
    printUsage();
    return;
  }

  const config = parsePaperConfig(args);
  const strategy = strategyFactory(config.strategyName);
  const errorLog = createErrorLogger();
  const runStartedAt = Date.now();

  await ensureParentDir(config.stateFile);
  await ensureParentDir(config.logFile);

  const initialState = createInitialPaperState({
    symbol: config.symbol,
    interval: config.interval,
    strategy: config.strategyName,
    initialCapital: config.initialCapital,
    now: runStartedAt
  });

  const loaded = config.resetState
    ? { state: initialState, resumed: false, reason: 'resetState enabled by flag' }
    : await loadPaperState(config.stateFile, {
      symbol: config.symbol,
      interval: config.interval,
      strategy: config.strategyName,
      initialCapital: config.initialCapital,
      now: runStartedAt
    });

  const state = loaded.state;
  console.log('Paper mode only. No real order is sent.');
  console.log(`State: ${loaded.resumed ? 'resumed' : 'fresh'} (${loaded.reason ?? 'ok'})`);
  console.log(
    `Config: symbol=${config.symbol} interval=${config.interval} strategy=${config.strategyName} pollMs=${config.pollMs} maxNotional=${config.guard.maxNotional} dailyMaxLoss=${config.guard.dailyMaxLoss}`
  );

  await writeLog(config.logFile, {
    ts: runStartedAt,
    event: 'CONFIG',
    symbol: config.symbol,
    interval: config.interval,
    strategy: config.strategyName,
    pollMs: config.pollMs,
    maxTicks: Number.isFinite(config.maxTicks) ? config.maxTicks : 'INF',
    maxNotional: config.guard.maxNotional,
    maxTradesPerHour: config.guard.maxTradesPerHour,
    cooldownMs: config.guard.cooldownMsAfterClose,
    dailyMaxLoss: config.guard.dailyMaxLoss,
    stateFile: config.stateFile,
    resumed: loaded.resumed
  });

  let tick = 0;
  while (tick < config.maxTicks) {
    tick += 1;
    try {
      const candles = await fetchKlines(
        config.symbol,
        config.interval,
        config.historyLimit,
        undefined,
        undefined,
        { cacheTtlMs: Math.max(0, config.pollMs - 250), timeoutMs: 8_000, retries: 3 }
      );

      if (candles.length < 4) {
        errorLog('short-candles', `Not enough candles: ${candles.length}`);
        await sleep(config.pollMs);
        continue;
      }

      const { processed, lastSignal, killTriggered } = await processPendingCandles({
        config,
        state,
        strategy,
        candles,
        logFile: config.logFile
      });

      const price = await fetchPrice(config.symbol);
      const equity = currentEquity(state, price);
      rollDailyStateIfNeeded(state, Date.now(), equity);

      const killCheck = checkDailyLossKillSwitch(config.guard, state, equity);
      if (!killCheck.ok) {
        state.killSwitchTriggered = true;
        await writeLog(config.logFile, {
          ts: Date.now(),
          event: 'KILL_SWITCH',
          reason: killCheck.reason,
          code: killCheck.code,
          equity,
          dailyStartEquity: state.daily.startEquity,
          dailyRealizedPnl: state.daily.realizedPnl
        });
      }

      await writeLog(config.logFile, {
        ts: Date.now(),
        event: 'TICK',
        tick,
        symbol: config.symbol,
        price,
        equity,
        cash: state.cash,
        qty: state.openPosition?.qty ?? 0,
        signal: lastSignal.action,
        signalReason: lastSignal.reason,
        processedCandles: processed
      });

      state.updatedAt = Date.now();
      await savePaperState(config.stateFile, state);

      if (killTriggered || state.killSwitchTriggered) {
        console.log('Kill switch triggered. Stopping paper loop.');
        break;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errorLog('loop-error', `Paper loop error: ${message}`);
      await writeLog(config.logFile, {
        ts: Date.now(),
        event: 'ERROR',
        message
      });
    }

    if (tick < config.maxTicks) {
      await sleep(config.pollMs);
    }
  }

  await savePaperState(config.stateFile, state);
  const preview = JSON.stringify({ cash: state.cash, openPosition: state.openPosition, updatedAt: state.updatedAt });
  console.log(`Paper simulation complete. State: ${config.stateFile}. Snapshot: ${preview.slice(0, MAX_CONFIG_LOG_PREVIEW)}`);
  console.log(`Paper log: ${config.logFile}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
