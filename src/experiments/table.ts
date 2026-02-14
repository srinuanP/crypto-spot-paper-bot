import type { ExperimentRunEntry } from './runner.js';
import type { SortKey } from './config.js';

export type TableRenderOptions = {
  sort: SortKey;
  top: number;
  minTrades: number;
};

type Row = {
  marker: string;
  symbol: string;
  interval: string;
  strategy: string;
  returnPct: string;
  maxDdPct: string;
  winPct: string;
  pf: string;
  trades: string;
  expectancy: string;
};

function metricValue(entry: ExperimentRunEntry, sort: SortKey): number {
  if (entry.status !== 'ok') return Number.NEGATIVE_INFINITY;
  if (sort === 'expectancy') return entry.metrics.expectancy;
  if (sort === 'return') return entry.metrics.totalReturnPct;
  if (sort === 'profitFactor') return Number.isFinite(entry.metrics.profitFactor) ? entry.metrics.profitFactor : Number.MAX_SAFE_INTEGER;
  return entry.metrics.maxDrawdownPct;
}

function sortEntries(entries: ExperimentRunEntry[], sort: SortKey): ExperimentRunEntry[] {
  const ranked = [...entries];
  ranked.sort((a, b) => {
    if (a.status !== 'ok' || b.status !== 'ok') return 0;
    const av = metricValue(a, sort);
    const bv = metricValue(b, sort);
    if (sort === 'maxDrawdown') {
      if (av !== bv) return av - bv;
      return b.metrics.expectancy - a.metrics.expectancy;
    }
    if (sort === 'expectancy') {
      if (bv !== av) return bv - av;
      return a.metrics.maxDrawdownPct - b.metrics.maxDrawdownPct;
    }
    if (bv !== av) return bv - av;
    return a.metrics.maxDrawdownPct - b.metrics.maxDrawdownPct;
  });
  return ranked;
}

function fmt(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return 'INF';
  return value.toFixed(digits);
}

function pad(value: string, width: number): string {
  return `${value}${' '.repeat(Math.max(0, width - value.length))}`;
}

function toStrategyLabel(entry: ExperimentRunEntry): string {
  const params = Object.entries(entry.strategy.params)
    .map(([key, value]) => `${key}=${value}`)
    .join(',');
  return `${entry.strategy.name}(${params})`;
}

export function renderExperimentTable(entries: ExperimentRunEntry[], options: TableRenderOptions): string {
  if (entries.length === 0) {
    return 'No experiment entries.';
  }

  const success = entries.filter((entry) => entry.status === 'ok' && entry.metrics.numTrades >= options.minTrades);
  const failed = entries.filter((entry) => entry.status === 'failed');

  const ranked = sortEntries(success, options.sort);
  const topSet = new Set(ranked.slice(0, options.top).map((entry) => entry.id));
  const worstSet = new Set(ranked.slice(-options.top).map((entry) => entry.id));

  const rows: Row[] = ranked.map((entry) => ({
    marker: topSet.has(entry.id) ? 'TOP' : (worstSet.has(entry.id) ? 'LOW' : ''),
    symbol: entry.symbol,
    interval: entry.interval,
    strategy: toStrategyLabel(entry),
    returnPct: fmt(entry.metrics.totalReturnPct),
    maxDdPct: fmt(entry.metrics.maxDrawdownPct),
    winPct: fmt(entry.metrics.winRatePct),
    pf: fmt(entry.metrics.profitFactor),
    trades: String(entry.metrics.numTrades),
    expectancy: fmt(entry.metrics.expectancy, 4)
  }));

  const headers = ['mark', 'symbol', 'interval', 'strategy', 'return%', 'maxDD%', 'win%', 'PF', 'trades', 'expectancy'];
  const widths = headers.map((header, index) => {
    const values = rows.map((row) => {
      const tuple = [
        row.marker,
        row.symbol,
        row.interval,
        row.strategy,
        row.returnPct,
        row.maxDdPct,
        row.winPct,
        row.pf,
        row.trades,
        row.expectancy
      ];
      return tuple[index];
    });
    return Math.max(header.length, ...values.map((value) => value.length));
  });

  const lines: string[] = [];
  const headerLine = headers.map((header, index) => pad(header, widths[index])).join(' | ');
  const sepLine = widths.map((width) => '-'.repeat(width)).join('-+-');
  lines.push(headerLine);
  lines.push(sepLine);

  for (const row of rows) {
    const cells = [
      row.marker,
      row.symbol,
      row.interval,
      row.strategy,
      row.returnPct,
      row.maxDdPct,
      row.winPct,
      row.pf,
      row.trades,
      row.expectancy
    ];
    lines.push(cells.map((cell, index) => pad(cell, widths[index])).join(' | '));
  }

  if (failed.length > 0) {
    lines.push('');
    lines.push(`Failed entries (${failed.length}):`);
    for (const entry of failed) {
      lines.push(`- ${entry.symbol} ${entry.interval} ${toStrategyLabel(entry)} -> ${entry.error}`);
    }
  }

  if (entries.filter((entry) => entry.status === 'ok').length > success.length) {
    const skipped = entries.filter((entry) => entry.status === 'ok' && entry.metrics.numTrades < options.minTrades).length;
    lines.push('');
    lines.push(`Skipped by minTrades (${options.minTrades}): ${skipped}`);
  }

  return lines.join('\n');
}
