import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { Candle } from '../types.js';

const BASE_URL = 'https://api.binance.com';
const CACHE_DIR = path.resolve('data-cache');
const DEFAULT_TIMEOUT_MS = 8_000;
const RETRY_BACKOFF_BASE_MS = 300;
const MAX_BACKOFF_MS = 5_000;
const ERROR_LOG_COOLDOWN_MS = 15_000;
const endpointRateLimitMs: Record<string, number> = {
  klines: 350,
  price: 200
};
const endpointLastRequestAt = new Map<string, number>();
const lastErrorLogAt = new Map<string, number>();

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function logNetworkError(key: string, message: string) {
  const now = Date.now();
  const lastLog = lastErrorLogAt.get(key) ?? 0;
  if (now - lastLog >= ERROR_LOG_COOLDOWN_MS) {
    console.warn(`[binancePublic] ${message}`);
    lastErrorLogAt.set(key, now);
  }
}

async function rateLimitWait(endpoint: string) {
  const minInterval = endpointRateLimitMs[endpoint] ?? 250;
  const lastAt = endpointLastRequestAt.get(endpoint) ?? 0;
  const elapsed = Date.now() - lastAt;
  if (elapsed < minInterval) {
    await sleep(minInterval - elapsed);
  }
  endpointLastRequestAt.set(endpoint, Date.now());
}

type RequestOptions = {
  endpoint: string;
  retries?: number;
  timeoutMs?: number;
};

async function fetchWithRetry(url: string, options: RequestOptions): Promise<Response> {
  const retries = options.retries ?? 3;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let attempt = 0;
  let lastError: Error | null = null;
  while (attempt <= retries) {
    await rateLimitWait(options.endpoint);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);
      if (response.ok) return response;
      if (response.status >= 400 && response.status < 500 && response.status !== 429) {
        const text = await response.text();
        throw new Error(`Binance client error ${response.status}: ${text}`);
      }
      lastError = new Error(`Binance retryable status ${response.status}`);
    } catch (error) {
      clearTimeout(timeout);
      if (error instanceof Error && error.message.startsWith('Binance client error')) {
        throw error;
      }
      if (error instanceof Error) {
        lastError = error;
      } else {
        lastError = new Error('Unknown fetch error');
      }
    }
    if (attempt === retries) break;
    const backoff = 300 * 2 ** attempt;
    const waitMs = Math.min(MAX_BACKOFF_MS, Math.max(RETRY_BACKOFF_BASE_MS, backoff));
    logNetworkError(options.endpoint, `retry ${attempt + 1}/${retries} in ${waitMs}ms for ${url}`);
    await sleep(waitMs);
    attempt += 1;
  }
  throw lastError ?? new Error(`Unable to fetch after ${retries + 1} attempts: ${url}`);
}

function buildSyntheticCandles(limit: number): Candle[] {
  const now = Date.now();
  let price = 40_000;
  return Array.from({ length: limit }).map((_, i) => {
    const drift = Math.sin(i / 7) * 120;
    const noise = ((i % 5) - 2) * 25;
    const open = price;
    const close = Math.max(1, open + drift + noise);
    const high = Math.max(open, close) + 30;
    const low = Math.min(open, close) - 30;
    price = close;
    return {
      t: now - (limit - i) * 60_000,
      o: Number(open.toFixed(2)),
      h: Number(high.toFixed(2)),
      l: Number(low.toFixed(2)),
      c: Number(close.toFixed(2)),
      v: 100 + i
    };
  });
}

function klinesCacheFile(symbol: string, interval: string, limit: number, startTime?: number, endTime?: number) {
  const file = `${symbol}_${interval}_${limit}_${startTime ?? 'na'}_${endTime ?? 'na'}.json`;
  return path.join(CACHE_DIR, file);
}

type FetchKlinesOptions = {
  cacheTtlMs?: number;
  retries?: number;
  timeoutMs?: number;
  fallbackMode?: 'synthetic' | 'stale' | 'none';
};

async function readCacheIfFresh(cachePath: string, cacheTtlMs: number): Promise<Candle[] | null> {
  if (!existsSync(cachePath)) return null;
  if (cacheTtlMs <= 0) return null;
  const fileStat = await stat(cachePath);
  if (Date.now() - fileStat.mtimeMs > cacheTtlMs) return null;
  const text = await readFile(cachePath, 'utf-8');
  return JSON.parse(text) as Candle[];
}

async function readCacheAny(cachePath: string): Promise<Candle[] | null> {
  if (!existsSync(cachePath)) return null;
  try {
    const text = await readFile(cachePath, 'utf-8');
    return JSON.parse(text) as Candle[];
  } catch {
    return null;
  }
}

export async function fetchKlines(
  symbol: string,
  interval: string,
  limit: number,
  startTime?: number,
  endTime?: number,
  options: FetchKlinesOptions = {}
): Promise<Candle[]> {
  await mkdir(CACHE_DIR, { recursive: true });
  const cachePath = klinesCacheFile(symbol, interval, limit, startTime, endTime);
  const cacheTtlMs = options.cacheTtlMs ?? 60_000;
  const fallbackMode = options.fallbackMode ?? 'synthetic';

  const freshCache = await readCacheIfFresh(cachePath, cacheTtlMs);
  if (freshCache) {
    return freshCache;
  }

  const query = new URLSearchParams({
    symbol,
    interval,
    limit: String(limit)
  });

  if (startTime) query.set('startTime', String(startTime));
  if (endTime) query.set('endTime', String(endTime));

  const url = `${BASE_URL}/api/v3/klines?${query.toString()}`;
  let candles: Candle[];
  try {
    const response = await fetchWithRetry(url, {
      endpoint: 'klines',
      retries: options.retries,
      timeoutMs: options.timeoutMs
    });
    const rows = (await response.json()) as Array<[number, string, string, string, string, string]>;

    candles = rows.map((row) => ({
      t: row[0],
      o: Number(row[1]),
      h: Number(row[2]),
      l: Number(row[3]),
      c: Number(row[4]),
      v: Number(row[5])
    }));
    await writeFile(cachePath, JSON.stringify(candles));
    return candles;
  } catch (error) {
    if (fallbackMode !== 'none') {
      const fallbackCache = await readCacheAny(cachePath);
      if (fallbackCache) {
        logNetworkError('klines-fallback', `using stale cache for ${symbol} ${interval} after fetch error`);
        return fallbackCache;
      }
    }

    if (fallbackMode === 'synthetic') {
      logNetworkError('klines-synthetic', `using synthetic candles for ${symbol} ${interval}`);
      candles = buildSyntheticCandles(limit);
      await writeFile(cachePath, JSON.stringify(candles));
      if (error instanceof Error) {
        logNetworkError('klines-error', `last error: ${error.message}`);
      }
      return candles;
    }

    if (error instanceof Error) {
      logNetworkError('klines-error', `fetch failed without fallback for ${symbol} ${interval}: ${error.message}`);
      throw error;
    }
    throw new Error(`Failed to fetch klines for ${symbol} ${interval}`);
  }
}

export async function fetchPrice(symbol: string): Promise<number> {
  const query = new URLSearchParams({ symbol });
  const url = `${BASE_URL}/api/v3/ticker/price?${query.toString()}`;
  try {
    const response = await fetchWithRetry(url, { endpoint: 'price' });
    const data = (await response.json()) as { price: string };
    return Number(data.price);
  } catch (error) {
    if (error instanceof Error) {
      logNetworkError('price-error', `fallback to klines for ${symbol}: ${error.message}`);
    } else {
      logNetworkError('price-error', `fallback to klines for ${symbol}`);
    }
    const candles = await fetchKlines(symbol, '1m', 2, undefined, undefined, { cacheTtlMs: 0 });
    return candles.at(-1)?.c ?? 0;
  }
}
