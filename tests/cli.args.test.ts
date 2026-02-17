import test from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs } from '../src/cli/args.js';

test('parseArgs supports --key value and --key=value', () => {
  const args = parseArgs([
    '--symbol', 'BTCUSDT',
    '--flag',
    '--i-know-what-im-doing=YES',
    '--empty='
  ]);

  assert.deepEqual(args, {
    symbol: 'BTCUSDT',
    flag: 'true',
    'i-know-what-im-doing': 'YES',
    empty: 'true'
  });
});
