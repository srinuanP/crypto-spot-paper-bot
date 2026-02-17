import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const VALID_INTERVALS = new Set([
  '1m', '3m', '5m', '15m', '30m',
  '1h', '2h', '4h', '6h', '8h', '12h',
  '1d', '3d', '1w', '1M'
]);

export type SortKey = 'expectancy' | 'maxDrawdown' | 'return' | 'profitFactor';
export type StrategyName = 'smaCross' | 'rsiMeanReversion';

export type SmaCrossParams = {
  short: number;
  long: number;
};

export type RsiMeanReversionParams = {
  rsiPeriod: number;
  buyBelow: number;
  sellAbove: number;
};

export type StrategyConfig =
  | { name: 'smaCross'; params: SmaCrossParams }
  | { name: 'rsiMeanReversion'; params: RsiMeanReversionParams };

export type ExperimentsConfig = {
  symbols: string[];
  intervals: string[];
  strategies: StrategyConfig[];
  limit: number;
  feeBps: number;
  slippageBps: number;
  initialCapital: number;
  riskPerTradePct: number;
  stopLossPct?: number;
  startTime?: number;
  endTime?: number;
  concurrency: number;
  top: number;
  sort: SortKey;
  minTrades: number;
  cacheTtlMs: number;
  outputDir: string;
  saveDetails: boolean;
  seed: number;
};

type PartialConfig = Partial<{
  symbols: string[];
  intervals: string[];
  strategies: Array<{ name: string; params?: Record<string, unknown> }>;
  limit: number;
  feeBps: number;
  slippageBps: number;
  initialCapital: number;
  riskPerTradePct: number;
  stopLossPct: number;
  startTime: number;
  endTime: number;
  concurrency: number;
  top: number;
  sort: SortKey;
  minTrades: number;
  cacheTtlMs: number;
  outputDir: string;
  saveDetails: boolean;
  seed: number;
}>;

const DEFAULT_CONFIG: ExperimentsConfig = {
  symbols: ['BTCUSDT'],
  intervals: ['15m'],
  strategies: [
    { name: 'smaCross', params: { short: 9, long: 21 } },
    { name: 'rsiMeanReversion', params: { rsiPeriod: 14, buyBelow: 30, sellAbove: 70 } }
  ],
  limit: 1000,
  feeBps: 10,
  slippageBps: 5,
  initialCapital: 10_000,
  riskPerTradePct: 0.1,
  concurrency: 3,
  top: 5,
  sort: 'expectancy',
  minTrades: 0,
  cacheTtlMs: 24 * 60 * 60 * 1000,
  outputDir: 'reports/experiments',
  saveDetails: true,
  seed: 42
};

function toNumber(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function parseCsv(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  const parsed = value
    .split(',')
    .map((row) => row.trim())
    .filter((row) => row.length > 0);
  return parsed.length ? parsed : undefined;
}

function parseBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  if (value === 'true' || value === '1' || value === 'YES') return true;
  if (value === 'false' || value === '0' || value === 'NO') return false;
  return undefined;
}

function parseSortKey(value: string | undefined): SortKey | undefined {
  if (!value) return undefined;
  if (value === 'expectancy' || value === 'maxDrawdown' || value === 'return' || value === 'profitFactor') {
    return value;
  }
  return undefined;
}

function parseStrategyNames(raw: string[] | undefined): Array<{ name: string; params?: Record<string, unknown> }> | undefined {
  if (!raw) return undefined;
  return raw.map((name) => ({ name }));
}

function normalizeSmaParams(params: Record<string, unknown> | undefined): SmaCrossParams {
  const defaults = { short: 9, long: 21 };
  if (params && (params.short === undefined || params.long === undefined)) {
    throw new Error('Invalid smaCross params: params.short and params.long are required when params is provided');
  }
  const short = Number(params?.short ?? defaults.short);
  const long = Number(params?.long ?? defaults.long);
  if (!Number.isFinite(short) || !Number.isFinite(long)) {
    throw new Error('Invalid smaCross params: short and long must be numbers');
  }
  if (short < 2 || long < 3 || short >= long) {
    throw new Error('Invalid smaCross params: require 2 <= short < long');
  }
  return { short: Math.floor(short), long: Math.floor(long) };
}

function normalizeRsiParams(params: Record<string, unknown> | undefined): RsiMeanReversionParams {
  const defaults = { rsiPeriod: 14, buyBelow: 30, sellAbove: 70 };
  if (params && (params.rsiPeriod === undefined || params.buyBelow === undefined || params.sellAbove === undefined)) {
    throw new Error('Invalid rsiMeanReversion params: rsiPeriod/buyBelow/sellAbove are required when params is provided');
  }
  const rsiPeriod = Number(params?.rsiPeriod ?? defaults.rsiPeriod);
  const buyBelow = Number(params?.buyBelow ?? defaults.buyBelow);
  const sellAbove = Number(params?.sellAbove ?? defaults.sellAbove);
  if (!Number.isFinite(rsiPeriod) || !Number.isFinite(buyBelow) || !Number.isFinite(sellAbove)) {
    throw new Error('Invalid rsiMeanReversion params: rsiPeriod/buyBelow/sellAbove must be numbers');
  }
  if (rsiPeriod < 2 || buyBelow <= 0 || sellAbove >= 100 || buyBelow >= sellAbove) {
    throw new Error('Invalid rsiMeanReversion params: require rsiPeriod>=2 and 0<buyBelow<sellAbove<100');
  }
  return {
    rsiPeriod: Math.floor(rsiPeriod),
    buyBelow,
    sellAbove
  };
}

function normalizeStrategies(input: Array<{ name: string; params?: Record<string, unknown> }>): StrategyConfig[] {
  if (input.length === 0) throw new Error('At least one strategy is required');
  return input.map((row) => {
    if (row.name === 'smaCross') {
      return {
        name: 'smaCross',
        params: normalizeSmaParams(row.params)
      };
    }
    if (row.name === 'rsiMeanReversion') {
      return {
        name: 'rsiMeanReversion',
        params: normalizeRsiParams(row.params)
      };
    }
    throw new Error(`Unsupported strategy: ${row.name}`);
  });
}

function validateIntervals(intervals: string[]): string[] {
  if (intervals.length === 0) throw new Error('At least one interval is required');
  for (const interval of intervals) {
    if (!VALID_INTERVALS.has(interval)) {
      throw new Error(`Unsupported interval: ${interval}`);
    }
  }
  return intervals;
}

function normalizeSymbols(symbols: string[]): string[] {
  if (symbols.length === 0) throw new Error('At least one symbol is required');
  const normalized = symbols.map((symbol) => symbol.trim().toUpperCase()).filter((symbol) => symbol.length > 0);
  if (normalized.length === 0) throw new Error('At least one symbol is required');
  return normalized;
}

function parseCliOverrides(args: Record<string, string>): PartialConfig {
  const out: PartialConfig = {};
  const entries: Array<[keyof PartialConfig, unknown]> = [
    ['symbols', parseCsv(args.symbols)],
    ['intervals', parseCsv(args.intervals)],
    ['strategies', parseStrategyNames(parseCsv(args.strategies))],
    ['limit', toNumber(args.limit)],
    ['feeBps', toNumber(args.feeBps)],
    ['slippageBps', toNumber(args.slippageBps)],
    ['initialCapital', toNumber(args.initialCapital)],
    ['riskPerTradePct', toNumber(args.riskPct)],
    ['stopLossPct', toNumber(args.stopLossPct)],
    ['startTime', toNumber(args.startTime)],
    ['endTime', toNumber(args.endTime)],
    ['concurrency', toNumber(args.concurrency)],
    ['top', toNumber(args.top)],
    ['sort', parseSortKey(args.sort)],
    ['minTrades', toNumber(args.minTrades)],
    ['cacheTtlMs', toNumber(args.cacheTtlMs)],
    ['outputDir', args.outputDir],
    ['saveDetails', parseBoolean(args.saveDetails)],
    ['seed', toNumber(args.seed)]
  ];

  for (const [key, value] of entries) {
    if (value !== undefined) {
      (out as Record<string, unknown>)[key] = value;
    }
  }
  return out;
}

function mergeConfig(base: PartialConfig, overrides: PartialConfig): PartialConfig {
  return {
    ...base,
    ...overrides,
    symbols: overrides.symbols ?? base.symbols,
    intervals: overrides.intervals ?? base.intervals,
    strategies: overrides.strategies ?? base.strategies
  };
}

async function readConfigFile(configPath: string): Promise<PartialConfig> {
  const resolved = path.resolve(configPath);
  const raw = await readFile(resolved, 'utf8');
  const parsed = JSON.parse(raw) as PartialConfig;
  return parsed;
}

function finalizeConfig(input: PartialConfig): ExperimentsConfig {
  const symbols = normalizeSymbols(input.symbols ?? DEFAULT_CONFIG.symbols);
  const intervals = validateIntervals(input.intervals ?? DEFAULT_CONFIG.intervals);
  const strategies = normalizeStrategies(input.strategies ?? DEFAULT_CONFIG.strategies);

  const limit = Math.floor(input.limit ?? DEFAULT_CONFIG.limit);
  if (limit < 100 || limit > 10_000) {
    throw new Error(`Invalid limit: ${limit}. Expected range 100..10000`);
  }

  const feeBps = input.feeBps ?? DEFAULT_CONFIG.feeBps;
  const slippageBps = input.slippageBps ?? DEFAULT_CONFIG.slippageBps;
  const initialCapital = input.initialCapital ?? DEFAULT_CONFIG.initialCapital;
  const riskPerTradePct = input.riskPerTradePct ?? DEFAULT_CONFIG.riskPerTradePct;

  if (feeBps < 0 || slippageBps < 0) throw new Error('feeBps and slippageBps must be >= 0');
  if (initialCapital <= 0) throw new Error('initialCapital must be > 0');
  if (riskPerTradePct <= 0 || riskPerTradePct > 1) throw new Error('riskPerTradePct must be in (0, 1]');

  const startTime = input.startTime;
  const endTime = input.endTime;
  if (startTime !== undefined && startTime <= 0) throw new Error('startTime must be > 0');
  if (endTime !== undefined && endTime <= 0) throw new Error('endTime must be > 0');
  if (startTime !== undefined && endTime !== undefined && startTime >= endTime) {
    throw new Error('startTime must be less than endTime');
  }

  const concurrency = Math.max(2, Math.min(4, Math.floor(input.concurrency ?? DEFAULT_CONFIG.concurrency)));
  const top = Math.max(1, Math.min(50, Math.floor(input.top ?? DEFAULT_CONFIG.top)));
  const minTrades = Math.max(0, Math.floor(input.minTrades ?? DEFAULT_CONFIG.minTrades));
  const cacheTtlMs = Math.max(0, Math.floor(input.cacheTtlMs ?? DEFAULT_CONFIG.cacheTtlMs));

  return {
    symbols,
    intervals,
    strategies,
    limit,
    feeBps,
    slippageBps,
    initialCapital,
    riskPerTradePct,
    stopLossPct: input.stopLossPct,
    startTime,
    endTime,
    concurrency,
    top,
    sort: input.sort ?? DEFAULT_CONFIG.sort,
    minTrades,
    cacheTtlMs,
    outputDir: input.outputDir ?? DEFAULT_CONFIG.outputDir,
    saveDetails: input.saveDetails ?? DEFAULT_CONFIG.saveDetails,
    seed: Math.floor(input.seed ?? DEFAULT_CONFIG.seed)
  };
}

export async function loadExperimentsConfig(args: Record<string, string>): Promise<ExperimentsConfig> {
  const fileConfig = args.config ? await readConfigFile(args.config) : {};
  const cliOverrides = parseCliOverrides(args);
  const merged = mergeConfig(fileConfig, cliOverrides);
  return finalizeConfig(merged);
}

export function getDefaultExperimentsConfig(): ExperimentsConfig {
  return finalizeConfig({});
}
