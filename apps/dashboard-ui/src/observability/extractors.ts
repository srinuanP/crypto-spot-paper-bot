import type { DashboardEvent, EventLevel, EventSource, EventType } from '../types/events';

type ExtractOptions = {
  source?: EventSource;
  nowTs?: number;
};

function toLevel(type: EventType, row?: Record<string, unknown>): EventLevel {
  if (type === 'ERROR' || type === 'KILL_SWITCH') return 'error';
  if (type === 'RISK_REJECT' || type === 'RATE_LIMIT') return 'warn';
  if (typeof row?.level === 'string') {
    const level = row.level.toLowerCase();
    if (level === 'error' || level === 'warn' || level === 'info') return level;
  }
  return 'info';
}

function asTimestamp(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function containsText(value: unknown, pattern: RegExp): boolean {
  if (typeof value !== 'string') return false;
  return pattern.test(value);
}

function inferTypeFromRow(row: Record<string, unknown>): EventType {
  const eventName = String(row.event ?? row.type ?? '').toUpperCase();
  const message = String(row.message ?? row.reason ?? row.error ?? '');
  const combined = `${eventName} ${message}`;

  if (eventName === 'BUY' || eventName === 'SELL' || eventName === 'TRADE') return 'TRADE';
  if (eventName === 'ORDER_INTENT' || eventName === 'INTENT' || eventName === 'SIGNAL') return 'ORDER_INTENT';
  if (eventName === 'REJECT' || eventName === 'RISK_REJECT') return 'RISK_REJECT';
  if (containsText(combined, /kill\s*switch|KILL_SWITCH/i)) return 'KILL_SWITCH';
  if (containsText(combined, /rate\s*limit|429|too many requests/i) || String(row.code ?? '').toUpperCase().includes('RATE_LIMIT')) {
    return 'RATE_LIMIT';
  }
  if (eventName === 'TICK' || eventName === 'HEALTH' || eventName === 'HEARTBEAT') return 'HEALTH';
  if (
    eventName === 'ERROR'
    || 'stack' in row
    || containsText(combined, /^ERROR[:\s]/i)
    || containsText(combined, /exception|failed|network error|api error/i)
  ) {
    return 'ERROR';
  }
  return 'LOG_LINE';
}

function inferMessage(type: EventType, row: Record<string, unknown>): string {
  const msg = row.message ?? row.reason ?? row.error;
  if (typeof msg === 'string' && msg.trim().length > 0) {
    return msg;
  }

  if (type === 'TRADE') {
    const side = String(row.event ?? row.side ?? 'TRADE').toUpperCase();
    const symbol = String(row.symbol ?? '');
    const price = Number(row.fill ?? row.price);
    return `${side} ${symbol} @ ${Number.isFinite(price) ? price : '-'}`.trim();
  }

  if (type === 'RISK_REJECT') {
    const code = String(row.code ?? 'REJECT');
    return `${code}: ${String(row.reason ?? 'Risk guard rejected')}`;
  }

  if (type === 'HEALTH') {
    return `Heartbeat ${String(row.symbol ?? '')}`.trim();
  }

  return String(row.event ?? row.type ?? 'log line');
}

function normalizeMeta(type: EventType, row: Record<string, unknown>): Record<string, unknown> {
  const meta: Record<string, unknown> = { ...row };
  if (type === 'TRADE') {
    meta.trade = {
      symbol: row.symbol,
      side: row.event ?? row.side,
      price: row.fill ?? row.price,
      qty: row.qty,
      pnl: row.realizedPnl ?? row.pnl
    };
  }
  return meta;
}

function createEvent(
  type: EventType,
  source: EventSource,
  ts: number,
  message: string,
  meta?: Record<string, unknown>
): DashboardEvent {
  return {
    id: `${ts}-${type}-${Math.random().toString(16).slice(2, 10)}`,
    type,
    ts,
    level: toLevel(type, meta),
    source,
    message,
    meta
  };
}

export function extractEventsFromRow(input: unknown, options: ExtractOptions = {}): DashboardEvent[] {
  const source = options.source ?? 'paper';
  const now = options.nowTs ?? Date.now();

  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      return extractEventsFromRow(parsed, options);
    } catch {
      const type: EventType = /^ERROR[:\s]/i.test(trimmed) ? 'ERROR' : 'LOG_LINE';
      const level: EventLevel = type === 'ERROR' ? 'error' : 'warn';
      return [{
        id: `${now}-${type}-plain`,
        type,
        ts: now,
        level,
        source,
        message: trimmed,
        meta: { parseError: true }
      }];
    }
  }

  if (!isObject(input)) {
    return [{
      id: `${now}-LOG_LINE-primitive`,
      type: 'LOG_LINE',
      ts: now,
      level: 'warn',
      source,
      message: String(input),
      meta: { parseError: true }
    }];
  }

  const ts = asTimestamp(input.ts ?? input.timestamp, now);
  const type = inferTypeFromRow(input);
  const message = inferMessage(type, input);
  const event = createEvent(type, source, ts, message, normalizeMeta(type, input));

  if (type === 'RISK_REJECT' && String(input.code ?? '').toUpperCase().includes('RATE_LIMIT')) {
    const rateEvent = createEvent('RATE_LIMIT', source, ts, 'Rate limit hit', normalizeMeta('RATE_LIMIT', input));
    return [event, rateEvent];
  }

  return [event];
}

export function extractEventsFromSsePayload(payload: { line?: string; row?: Record<string, unknown> | null }, options: ExtractOptions = {}): DashboardEvent[] {
  if (payload.row && isObject(payload.row)) {
    return extractEventsFromRow(payload.row, options);
  }
  if (typeof payload.line === 'string') {
    return extractEventsFromRow(payload.line, options);
  }
  return [];
}
