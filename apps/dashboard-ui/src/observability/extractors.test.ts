import { describe, expect, it } from 'vitest';
import { extractEventsFromRow, extractEventsFromSsePayload } from './extractors';

describe('extractEventsFromRow', () => {
  it('maps trade row to TRADE event', () => {
    const events = extractEventsFromRow({ ts: 1000, event: 'BUY', symbol: 'BTCUSDT', fill: 50000, qty: 0.01 }, { source: 'paper' });
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('TRADE');
    expect(events[0].source).toBe('paper');
    expect(events[0].level).toBe('info');
  });

  it('maps reject + rate limit code into RISK_REJECT and RATE_LIMIT', () => {
    const events = extractEventsFromRow({
      ts: 1001,
      event: 'REJECT',
      code: 'RATE_LIMIT',
      reason: 'too many requests'
    });
    expect(events.map((event) => event.type)).toEqual(['RISK_REJECT', 'RATE_LIMIT']);
  });

  it('does not crash for malformed string and marks parseError', () => {
    const events = extractEventsFromRow('{broken json', { source: 'dashboard', nowTs: 1234 });
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('LOG_LINE');
    expect(events[0].level).toBe('warn');
    expect(events[0].meta?.parseError).toBe(true);
    expect(events[0].source).toBe('dashboard');
  });

  it('extracts from SSE payload safely', () => {
    const events = extractEventsFromSsePayload({ line: '{"ts":1002,"event":"ERROR","message":"network error"}' });
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('ERROR');
    expect(events[0].level).toBe('error');
  });
});
