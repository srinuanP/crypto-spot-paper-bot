import test from 'node:test';
import assert from 'node:assert/strict';
import { parseJsonl } from '../src/dashboard/jsonl.js';

test('parseJsonl parses valid lines and skips broken lines without crash', () => {
  const raw = [
    '{"event":"BUY","ts":1}',
    '{bad json line}',
    '{"event":"SELL","ts":2}',
    '',
    '{"event":"TICK","ts":3}'
  ].join('\n');

  const result = parseJsonl<{ event: string; ts: number }>(raw);
  assert.equal(result.items.length, 3);
  assert.equal(result.skipped, 1);
  assert.deepEqual(result.items.map((row) => row.event), ['BUY', 'SELL', 'TICK']);
});
