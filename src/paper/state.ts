import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { PaperState, PaperStateInit } from './types.js';
import { toLocalDateKey } from './risk.js';

type LoadStateResult = {
  state: PaperState;
  resumed: boolean;
  reason?: string;
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isPaperState(value: unknown): value is PaperState {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<PaperState>;
  if (row.version !== 1) return false;
  if (typeof row.symbol !== 'string' || typeof row.interval !== 'string' || typeof row.strategy !== 'string') return false;
  if (!isFiniteNumber(row.cash) || !isFiniteNumber(row.lastProcessedCandleTime)) return false;
  if (!Array.isArray(row.orderTimestamps)) return false;
  if (!row.daily || typeof row.daily !== 'object') return false;
  if (typeof row.daily.date !== 'string') return false;
  if (!isFiniteNumber(row.daily.startEquity) || !isFiniteNumber(row.daily.realizedPnl)) return false;
  if (!isFiniteNumber(row.daily.consecutiveLosses) || !isFiniteNumber(row.daily.maxConsecutiveLosses)) return false;
  if (!row.stats || typeof row.stats !== 'object') return false;
  if (!isFiniteNumber(row.stats.buys) || !isFiniteNumber(row.stats.sells) || !isFiniteNumber(row.stats.rejects)) return false;
  if (row.openPosition !== null && row.openPosition !== undefined) {
    if (typeof row.openPosition !== 'object') return false;
    if (!isFiniteNumber(row.openPosition.qty)) return false;
    if (!isFiniteNumber(row.openPosition.entryPrice)) return false;
    if (!isFiniteNumber(row.openPosition.entryTime)) return false;
    if (!isFiniteNumber(row.openPosition.entryFee)) return false;
  }
  return true;
}

export function createInitialPaperState(init: PaperStateInit): PaperState {
  const date = toLocalDateKey(init.now);
  return {
    version: 1,
    symbol: init.symbol,
    interval: init.interval,
    strategy: init.strategy,
    createdAt: init.now,
    updatedAt: init.now,
    lastProcessedCandleTime: 0,
    cash: init.initialCapital,
    openPosition: null,
    lastCloseAt: null,
    orderTimestamps: [],
    killSwitchTriggered: false,
    daily: {
      date,
      startEquity: init.initialCapital,
      realizedPnl: 0,
      consecutiveLosses: 0,
      maxConsecutiveLosses: 0
    },
    stats: {
      buys: 0,
      sells: 0,
      rejects: 0
    }
  };
}

export async function loadPaperState(statePath: string, init: PaperStateInit): Promise<LoadStateResult> {
  const fresh = createInitialPaperState(init);
  if (!existsSync(statePath)) {
    return { state: fresh, resumed: false, reason: 'state file not found' };
  }

  try {
    const text = await readFile(statePath, 'utf-8');
    const parsed = JSON.parse(text) as unknown;
    if (!isPaperState(parsed)) {
      return { state: fresh, resumed: false, reason: 'invalid state schema, reset to defaults' };
    }
    if (parsed.symbol !== init.symbol || parsed.interval !== init.interval || parsed.strategy !== init.strategy) {
      return { state: fresh, resumed: false, reason: 'state config mismatch, reset to defaults' };
    }
    return { state: parsed, resumed: true };
  } catch {
    return { state: fresh, resumed: false, reason: 'failed to read state file, reset to defaults' };
  }
}

export async function savePaperState(statePath: string, state: PaperState): Promise<void> {
  const fullPath = path.resolve(statePath);
  const dir = path.dirname(fullPath);
  await mkdir(dir, { recursive: true });
  const tempPath = `${fullPath}.tmp`;
  await writeFile(tempPath, JSON.stringify(state, null, 2));
  await rename(tempPath, fullPath);
}
