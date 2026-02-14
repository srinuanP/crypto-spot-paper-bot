import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fetchKlines } from '../exchange/binancePublic.js';
import { createSmaCrossStrategy } from '../strategy/smaCross.js';
import { createRsiMeanReversionStrategy } from '../strategy/rsiMeanReversion.js';
import { runBacktest } from '../backtest/engine.js';
import type { StrategyFn } from '../types.js';
import type { ExperimentsConfig, StrategyConfig } from './config.js';
import { toExperimentMetrics, type ExperimentMetrics } from './metrics.js';

export type ExperimentStrategyDescriptor = {
  name: StrategyConfig['name'];
  params: Record<string, number>;
};

export type ExperimentRunEntryBase = {
  id: string;
  symbol: string;
  interval: string;
  strategy: ExperimentStrategyDescriptor;
};

export type ExperimentRunEntryOk = ExperimentRunEntryBase & {
  status: 'ok';
  metrics: ExperimentMetrics;
  detailsPath?: string;
};

export type ExperimentRunEntryFailed = ExperimentRunEntryBase & {
  status: 'failed';
  error: string;
};

export type ExperimentRunEntry = ExperimentRunEntryOk | ExperimentRunEntryFailed;

export type ExperimentReport = {
  metadata: {
    generatedAt: string;
    seed: number;
    nodeVersion: string;
    gitCommitHash: string | null;
    config: ExperimentsConfig;
  };
  results: ExperimentRunEntry[];
};

type Task = {
  symbol: string;
  interval: string;
  strategy: StrategyConfig;
  index: number;
};

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

function reportTimestamp(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}_${pad2(date.getHours())}-${pad2(date.getMinutes())}-${pad2(date.getSeconds())}`;
}

function getGitCommitHash(): string | null {
  const result = spawnSync('git', ['rev-parse', '--short', 'HEAD'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore']
  });
  if (result.status !== 0) return null;
  const hash = result.stdout.trim();
  return hash.length > 0 ? hash : null;
}

function strategyToDescriptor(strategy: StrategyConfig): ExperimentStrategyDescriptor {
  if (strategy.name === 'smaCross') {
    return { name: strategy.name, params: { ...strategy.params } };
  }
  return { name: strategy.name, params: { ...strategy.params } };
}

function strategyLabel(strategy: StrategyConfig): string {
  const params = Object.entries(strategy.params)
    .map(([key, value]) => `${key}=${value}`)
    .join(',');
  return `${strategy.name}:${params}`;
}

function makeEntryId(symbol: string, interval: string, strategy: StrategyConfig): string {
  return `${symbol}|${interval}|${strategyLabel(strategy)}`;
}

function createStrategyFn(strategy: StrategyConfig): StrategyFn {
  if (strategy.name === 'smaCross') {
    return createSmaCrossStrategy(strategy.params.short, strategy.params.long);
  }
  return createRsiMeanReversionStrategy(
    strategy.params.rsiPeriod,
    strategy.params.buyBelow,
    strategy.params.sellAbove
  );
}

async function runSingleTask(config: ExperimentsConfig, task: Task): Promise<{ entry: ExperimentRunEntry; details?: { trades: unknown; equityCurve: number[] } }> {
  const id = makeEntryId(task.symbol, task.interval, task.strategy);
  const descriptor = strategyToDescriptor(task.strategy);

  try {
    const candles = await fetchKlines(
      task.symbol,
      task.interval,
      config.limit,
      config.startTime,
      config.endTime,
      {
        cacheTtlMs: config.cacheTtlMs,
        retries: 3,
        timeoutMs: 10_000,
        fallbackMode: 'none'
      }
    );

    const strategyFn = createStrategyFn(task.strategy);
    const result = runBacktest(candles, strategyFn, {
      initialCapital: config.initialCapital,
      feeBps: config.feeBps,
      slippageBps: config.slippageBps,
      riskPerTradePct: config.riskPerTradePct,
      stopLossPct: config.stopLossPct
    });

    const metrics = toExperimentMetrics(result);
    return {
      entry: {
        id,
        symbol: task.symbol,
        interval: task.interval,
        strategy: descriptor,
        status: 'ok',
        metrics
      },
      details: {
        trades: result.trades,
        equityCurve: result.equityCurve
      }
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      entry: {
        id,
        symbol: task.symbol,
        interval: task.interval,
        strategy: descriptor,
        status: 'failed',
        error: message
      }
    };
  }
}

async function runWithConcurrency<T>(tasks: Array<() => Promise<T>>, concurrency: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let cursor = 0;

  async function worker(): Promise<void> {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= tasks.length) return;
      results[index] = await tasks[index]();
    }
  }

  const workers = Array.from({ length: Math.max(1, concurrency) }, () => worker());
  await Promise.all(workers);
  return results;
}

function buildMatrixTasks(config: ExperimentsConfig): Task[] {
  const tasks: Task[] = [];
  let index = 0;
  for (const symbol of config.symbols) {
    for (const interval of config.intervals) {
      for (const strategy of config.strategies) {
        tasks.push({ symbol, interval, strategy, index });
        index += 1;
      }
    }
  }
  return tasks;
}

async function persistDetails(
  outputDir: string,
  runStamp: string,
  results: Array<{ entry: ExperimentRunEntry; details?: { trades: unknown; equityCurve: number[] } }>
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const detailDir = path.resolve(outputDir, 'details');
  await mkdir(detailDir, { recursive: true });

  for (let i = 0; i < results.length; i += 1) {
    const row = results[i];
    if (!row.details || row.entry.status !== 'ok') continue;
    const fileName = `${runStamp}_${String(i + 1).padStart(3, '0')}.json`;
    const filePath = path.resolve(detailDir, fileName);
    await writeFile(
      filePath,
      JSON.stringify(
        {
          id: row.entry.id,
          symbol: row.entry.symbol,
          interval: row.entry.interval,
          strategy: row.entry.strategy,
          trades: row.details.trades,
          equityCurve: row.details.equityCurve
        },
        null,
        2
      ),
      'utf8'
    );
    out.set(row.entry.id, path.relative(path.resolve('.'), filePath));
  }
  return out;
}

export async function runExperiments(config: ExperimentsConfig): Promise<{
  report: ExperimentReport;
  reportPath: string;
}> {
  const tasks = buildMatrixTasks(config);
  const runStamp = reportTimestamp(new Date());
  const outputDir = path.resolve(config.outputDir);
  await mkdir(outputDir, { recursive: true });

  const runners = tasks.map((task) => async () => runSingleTask(config, task));
  const rawResults = await runWithConcurrency(runners, config.concurrency);

  let detailsMap = new Map<string, string>();
  if (config.saveDetails) {
    detailsMap = await persistDetails(outputDir, runStamp, rawResults);
  }

  const results: ExperimentRunEntry[] = rawResults.map((row) => {
    if (row.entry.status === 'ok') {
      return {
        ...row.entry,
        detailsPath: detailsMap.get(row.entry.id)
      };
    }
    return row.entry;
  });

  const report: ExperimentReport = {
    metadata: {
      generatedAt: new Date().toISOString(),
      seed: config.seed,
      nodeVersion: process.version,
      gitCommitHash: getGitCommitHash(),
      config
    },
    results
  };

  const reportPath = path.resolve(outputDir, `${runStamp}.json`);
  await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');
  return { report, reportPath };
}
