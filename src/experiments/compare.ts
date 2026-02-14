import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { SortKey } from './config.js';
import type { ExperimentReport, ExperimentRunEntry } from './runner.js';

export type CompareKey = SortKey;

export type CompareDiffRow = {
  id: string;
  symbol: string;
  interval: string;
  strategy: string;
  aValue: number;
  bValue: number;
  delta: number;
  improved: boolean;
};

export type CompareResult = {
  key: CompareKey;
  rows: CompareDiffRow[];
  addedInB: string[];
  removedInB: string[];
  improvedCount: number;
  worsenedCount: number;
  unchangedCount: number;
  meanDelta: number;
  medianDelta: number;
};

function metricFor(entry: ExperimentRunEntry, key: CompareKey): number | null {
  if (entry.status !== 'ok') return null;
  if (key === 'expectancy') return entry.metrics.expectancy;
  if (key === 'return') return entry.metrics.totalReturnPct;
  if (key === 'profitFactor') return entry.metrics.profitFactor;
  return entry.metrics.maxDrawdownPct;
}

function isImproved(key: CompareKey, delta: number): boolean {
  if (key === 'maxDrawdown') return delta < 0;
  return delta > 0;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

function strategyLabel(entry: ExperimentRunEntry): string {
  const params = Object.entries(entry.strategy.params).map(([key, value]) => `${key}=${value}`).join(',');
  return `${entry.strategy.name}(${params})`;
}

function mapOkEntries(report: ExperimentReport): Map<string, ExperimentRunEntry> {
  const out = new Map<string, ExperimentRunEntry>();
  for (const entry of report.results) {
    if (entry.status !== 'ok') continue;
    out.set(entry.id, entry);
  }
  return out;
}

function pad(value: string, width: number): string {
  return `${value}${' '.repeat(Math.max(0, width - value.length))}`;
}

function fmt(value: number, digits = 4): string {
  if (!Number.isFinite(value)) return 'INF';
  return value.toFixed(digits);
}

export function renderCompareTable(compare: CompareResult): string {
  if (compare.rows.length === 0) {
    return `No overlapping entries to compare for key=${compare.key}`;
  }

  const headers = ['symbol', 'interval', 'strategy', 'A', 'B', 'delta', 'trend'];
  const rows = compare.rows.map((row) => [
    row.symbol,
    row.interval,
    row.strategy,
    fmt(row.aValue),
    fmt(row.bValue),
    fmt(row.delta),
    row.improved ? 'UP' : (row.delta === 0 ? 'SAME' : 'DOWN')
  ]);
  const widths = headers.map((header, idx) => Math.max(header.length, ...rows.map((row) => row[idx].length)));

  const lines: string[] = [];
  lines.push(headers.map((header, idx) => pad(header, widths[idx])).join(' | '));
  lines.push(widths.map((width) => '-'.repeat(width)).join('-+-'));
  for (const row of rows) {
    lines.push(row.map((cell, idx) => pad(cell, widths[idx])).join(' | '));
  }
  lines.push('');
  lines.push(`Improved: ${compare.improvedCount}, Worsened: ${compare.worsenedCount}, Unchanged: ${compare.unchangedCount}`);
  lines.push(`Mean delta: ${fmt(compare.meanDelta)}, Median delta: ${fmt(compare.medianDelta)}`);
  if (compare.addedInB.length > 0) {
    lines.push(`Added in B (${compare.addedInB.length}):`);
    compare.addedInB.forEach((id) => lines.push(`- ${id}`));
  }
  if (compare.removedInB.length > 0) {
    lines.push(`Removed in B (${compare.removedInB.length}):`);
    compare.removedInB.forEach((id) => lines.push(`- ${id}`));
  }
  return lines.join('\n');
}

export function compareReports(reportA: ExperimentReport, reportB: ExperimentReport, key: CompareKey): CompareResult {
  const mapA = mapOkEntries(reportA);
  const mapB = mapOkEntries(reportB);

  const addedInB = Array.from(mapB.keys()).filter((id) => !mapA.has(id)).sort();
  const removedInB = Array.from(mapA.keys()).filter((id) => !mapB.has(id)).sort();

  const sharedIds = Array.from(mapA.keys()).filter((id) => mapB.has(id)).sort();
  const rows: CompareDiffRow[] = [];
  const deltas: number[] = [];
  let improvedCount = 0;
  let worsenedCount = 0;
  let unchangedCount = 0;

  for (const id of sharedIds) {
    const a = mapA.get(id)!;
    const b = mapB.get(id)!;
    const aValue = metricFor(a, key);
    const bValue = metricFor(b, key);
    if (aValue === null || bValue === null) continue;
    const delta = bValue - aValue;
    const improved = isImproved(key, delta);
    if (delta === 0) unchangedCount += 1;
    else if (improved) improvedCount += 1;
    else worsenedCount += 1;

    deltas.push(delta);
    rows.push({
      id,
      symbol: a.symbol,
      interval: a.interval,
      strategy: strategyLabel(a),
      aValue,
      bValue,
      delta,
      improved
    });
  }

  rows.sort((x, y) => {
    if (y.delta !== x.delta) return y.delta - x.delta;
    return x.id.localeCompare(y.id);
  });

  return {
    key,
    rows,
    addedInB,
    removedInB,
    improvedCount,
    worsenedCount,
    unchangedCount,
    meanDelta: mean(deltas),
    medianDelta: median(deltas)
  };
}

export async function loadExperimentReport(filePath: string): Promise<ExperimentReport> {
  const resolved = path.resolve(filePath);
  const raw = await readFile(resolved, 'utf8');
  return JSON.parse(raw) as ExperimentReport;
}
