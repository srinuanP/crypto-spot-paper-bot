import { useReducer, type Dispatch } from 'react';
import type { JournalPayload, ReportPayload, RuntimeStatus } from '../api/client';
import type { PaperStreamPayload, SseStatus } from '../api/sse';

export type ThemeMode = 'light' | 'dark';

export type TradeSide = 'BUY' | 'SELL';

export type TradeRow = {
  id: string;
  ts: number;
  symbol: string;
  strategy: string;
  side: TradeSide;
  price: number;
  qty: number;
  pnl: number | null;
  reason: string;
};

export type UiToast = {
  id: number;
  tone: 'success' | 'warning' | 'danger' | 'neutral';
  message: string;
};

export type TradeFilters = {
  search: string;
  symbol: string;
  strategy: string;
  side: '' | TradeSide;
  sort: 'timeDesc' | 'timeAsc' | 'pnlDesc' | 'pnlAsc';
};

export type DashboardState = {
  theme: ThemeMode;
  autoRefresh: boolean;
  wizardDismissed: boolean;
  runtimeStatus: RuntimeStatus | null;
  healthOk: boolean;
  healthTs: string | null;
  reportLoading: boolean;
  report: ReportPayload | null;
  reportMessage: string | null;
  journal: JournalPayload | null;
  journalMessage: string | null;
  paperRows: Record<string, unknown>[];
  paperMessage: string | null;
  logLines: string[];
  queuedEvents: PaperStreamPayload[];
  logPaused: boolean;
  sseStatus: SseStatus;
  filters: TradeFilters;
  page: number;
  pageSize: number;
  toasts: UiToast[];
};

const LOG_LIMIT = 500;
const PAPER_ROW_LIMIT = 6000;

export const MAX_TRADE_ROWS = 200;

export const defaultFilters: TradeFilters = {
  search: '',
  symbol: '',
  strategy: '',
  side: '',
  sort: 'timeDesc'
};

export const initialDashboardState: DashboardState = {
  theme: 'light',
  autoRefresh: true,
  wizardDismissed: false,
  runtimeStatus: null,
  healthOk: false,
  healthTs: null,
  reportLoading: true,
  report: null,
  reportMessage: null,
  journal: null,
  journalMessage: null,
  paperRows: [],
  paperMessage: null,
  logLines: [],
  queuedEvents: [],
  logPaused: false,
  sseStatus: 'connecting',
  filters: defaultFilters,
  page: 1,
  pageSize: 25,
  toasts: []
};

export type DashboardAction =
  | { type: 'setTheme'; theme: ThemeMode }
  | { type: 'setAutoRefresh'; enabled: boolean }
  | { type: 'dismissWizard'; dismissed: boolean }
  | { type: 'setRuntimeStatus'; data: RuntimeStatus | null }
  | { type: 'setHealth'; ok: boolean; ts: string | null }
  | { type: 'setReportLoading'; loading: boolean }
  | { type: 'setReport'; data: ReportPayload | null; message?: string | null }
  | { type: 'setJournal'; data: JournalPayload | null; message?: string | null }
  | { type: 'setPaperTail'; items: Record<string, unknown>[]; message?: string | null }
  | { type: 'appendPaperLog'; payload: PaperStreamPayload }
  | { type: 'appendPaperLogsBatch'; payloads: PaperStreamPayload[] }
  | { type: 'setLogPaused'; paused: boolean }
  | { type: 'flushQueuedEvents' }
  | { type: 'clearLogs' }
  | { type: 'setSseStatus'; status: SseStatus }
  | { type: 'setFilters'; filters: Partial<TradeFilters> }
  | { type: 'resetFilters' }
  | { type: 'setPage'; page: number }
  | { type: 'setPageSize'; pageSize: number }
  | { type: 'addToast'; toast: UiToast }
  | { type: 'removeToast'; id: number };

function safeStringify(row: unknown): string {
  try {
    return JSON.stringify(row);
  } catch {
    return String(row);
  }
}

function normalizeRows(items: Record<string, unknown>[]): Record<string, unknown>[] {
  return items.slice(-PAPER_ROW_LIMIT);
}

function normalizeLogs(logLines: string[]): string[] {
  return logLines.slice(-LOG_LIMIT);
}

function appendLogLines(current: string[], line: string): string[] {
  return normalizeLogs([...current, line]);
}

function sanitizeNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function toTradeFromPaperRow(
  row: Record<string, unknown>,
  fallbackSymbol: string,
  fallbackStrategy: string,
  index: number
): TradeRow | null {
  const rawEvent = String(row.event ?? '').toUpperCase();
  if (rawEvent !== 'BUY' && rawEvent !== 'SELL') return null;

  const ts = sanitizeNumber(row.ts);
  return {
    id: `${ts}-${rawEvent}-${index}`,
    ts,
    symbol: String(row.symbol ?? fallbackSymbol ?? ''),
    strategy: String(row.strategy ?? fallbackStrategy ?? ''),
    side: rawEvent,
    price: sanitizeNumber(row.fill ?? row.price),
    qty: sanitizeNumber(row.qty),
    pnl: typeof row.realizedPnl === 'number' ? row.realizedPnl : null,
    reason: String(row.reason ?? '')
  };
}

function toTradeFromReportRow(
  row: Record<string, unknown>,
  fallbackSymbol: string,
  fallbackStrategy: string,
  index: number
): TradeRow {
  const ts = sanitizeNumber(row.exitTime ?? row.entryTime);
  const pnlValue = Number(row.pnl);
  return {
    id: `${ts}-report-${index}`,
    ts,
    symbol: fallbackSymbol,
    strategy: fallbackStrategy,
    side: 'SELL',
    price: sanitizeNumber(row.exitPrice),
    qty: sanitizeNumber(row.qty),
    pnl: Number.isFinite(pnlValue) ? pnlValue : null,
    reason: String(row.reason ?? '')
  };
}

export function buildTrades(
  paperRows: Record<string, unknown>[],
  report: ReportPayload | null
): TradeRow[] {
  const fallbackSymbol = String(report?.symbol ?? '');
  const configRows = paperRows.filter((row) => row.event === 'CONFIG');
  const lastConfig = configRows.length > 0 ? configRows[configRows.length - 1] : undefined;
  const fallbackStrategy = String(lastConfig?.strategy ?? report?.strategy ?? '');

  const fromPaper = paperRows
    .map((row, index) => toTradeFromPaperRow(row, fallbackSymbol, fallbackStrategy, index))
    .filter((row): row is TradeRow => row !== null)
    .slice(-MAX_TRADE_ROWS)
    .sort((a, b) => b.ts - a.ts);

  if (fromPaper.length > 0) return fromPaper;

  const reportTrades = Array.isArray(report?.trades)
    ? report.trades
    : [];

  return reportTrades
    .map((row, index) => toTradeFromReportRow(row, fallbackSymbol, fallbackStrategy, index))
    .slice(-MAX_TRADE_ROWS)
    .sort((a, b) => b.ts - a.ts);
}

export function filterAndSortTrades(rows: TradeRow[], filters: TradeFilters): TradeRow[] {
  const search = filters.search.trim().toLowerCase();
  const out = rows.filter((row) => {
    if (filters.symbol && row.symbol !== filters.symbol) return false;
    if (filters.strategy && row.strategy !== filters.strategy) return false;
    if (filters.side && row.side !== filters.side) return false;
    if (!search) return true;
    const haystack = `${row.symbol} ${row.strategy} ${row.side} ${row.reason}`.toLowerCase();
    return haystack.includes(search);
  });

  out.sort((a, b) => {
    if (filters.sort === 'timeAsc') return a.ts - b.ts;
    if (filters.sort === 'pnlDesc') return (b.pnl ?? Number.NEGATIVE_INFINITY) - (a.pnl ?? Number.NEGATIVE_INFINITY);
    if (filters.sort === 'pnlAsc') return (a.pnl ?? Number.POSITIVE_INFINITY) - (b.pnl ?? Number.POSITIVE_INFINITY);
    return b.ts - a.ts;
  });
  return out;
}

export function dashboardReducer(state: DashboardState, action: DashboardAction): DashboardState {
  switch (action.type) {
    case 'setTheme':
      return { ...state, theme: action.theme };
    case 'setAutoRefresh':
      return { ...state, autoRefresh: action.enabled };
    case 'dismissWizard':
      return { ...state, wizardDismissed: action.dismissed };
    case 'setRuntimeStatus':
      return { ...state, runtimeStatus: action.data };
    case 'setHealth':
      return { ...state, healthOk: action.ok, healthTs: action.ts };
    case 'setReportLoading':
      return { ...state, reportLoading: action.loading };
    case 'setReport':
      return {
        ...state,
        report: action.data,
        reportMessage: action.message ?? null,
        reportLoading: false,
        page: 1
      };
    case 'setJournal':
      return {
        ...state,
        journal: action.data,
        journalMessage: action.message ?? null
      };
    case 'setPaperTail': {
      const rows = normalizeRows(action.items);
      const logLines = normalizeLogs(rows.slice(-200).map((row) => safeStringify(row)));
      return {
        ...state,
        paperRows: rows,
        paperMessage: action.message ?? null,
        logLines,
        queuedEvents: [],
        page: 1
      };
    }
    case 'appendPaperLog': {
      if (state.logPaused) {
        const queuedEvents = [...state.queuedEvents, action.payload].slice(-LOG_LIMIT);
        return {
          ...state,
          queuedEvents,
          paperMessage: `Paused (${queuedEvents.length} queued)`
        };
      }

      const line = action.payload.line ?? safeStringify(action.payload.row ?? {});
      const nextLogLines = appendLogLines(state.logLines, line);
      const nextRows = action.payload.row
        ? normalizeRows([...state.paperRows, action.payload.row])
        : state.paperRows;

      return {
        ...state,
        logLines: nextLogLines,
        paperRows: nextRows,
        paperMessage: `Events: ${nextRows.length}`
      };
    }
    case 'appendPaperLogsBatch': {
      if (action.payloads.length === 0) return state;
      let nextState = state;
      for (const payload of action.payloads) {
        nextState = dashboardReducer(nextState, { type: 'appendPaperLog', payload });
      }
      return nextState;
    }
    case 'setLogPaused':
      return { ...state, logPaused: action.paused };
    case 'flushQueuedEvents': {
      let merged = state;
      for (const payload of state.queuedEvents) {
        merged = dashboardReducer(merged, { type: 'appendPaperLog', payload });
      }
      return {
        ...merged,
        queuedEvents: []
      };
    }
    case 'clearLogs':
      return { ...state, logLines: [] };
    case 'setSseStatus':
      return { ...state, sseStatus: action.status };
    case 'setFilters':
      return {
        ...state,
        filters: { ...state.filters, ...action.filters },
        page: 1
      };
    case 'resetFilters':
      return {
        ...state,
        filters: defaultFilters,
        page: 1
      };
    case 'setPage':
      return { ...state, page: Math.max(1, action.page) };
    case 'setPageSize':
      return {
        ...state,
        pageSize: Math.max(10, Math.min(100, action.pageSize)),
        page: 1
      };
    case 'addToast':
      return {
        ...state,
        toasts: [...state.toasts, action.toast].slice(-6)
      };
    case 'removeToast':
      return {
        ...state,
        toasts: state.toasts.filter((toast) => toast.id !== action.id)
      };
    default:
      return state;
  }
}

export function useDashboardStore(initialState: DashboardState = initialDashboardState): [DashboardState, Dispatch<DashboardAction>] {
  return useReducer(dashboardReducer, initialState);
}

