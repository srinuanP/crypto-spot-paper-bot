import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { loadExperimentsConfig } from '../src/experiments/config.js';

test('loadExperimentsConfig applies file config and CLI overrides', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'exp-config-'));
  const configPath = path.join(tempDir, 'config.json');

  try {
    await writeFile(
      configPath,
      JSON.stringify({
        symbols: ['BTCUSDT', 'ETHUSDT'],
        intervals: ['15m'],
        strategies: [{ name: 'smaCross', params: { short: 10, long: 30 } }],
        limit: 500,
        feeBps: 8
      }),
      'utf8'
    );

    const config = await loadExperimentsConfig({
      config: configPath,
      feeBps: '15',
      symbols: 'BNBUSDT',
      top: '10'
    });

    assert.deepEqual(config.symbols, ['BNBUSDT']);
    assert.equal(config.feeBps, 15);
    assert.equal(config.limit, 500);
    assert.equal(config.top, 10);
    assert.equal(config.strategies[0].name, 'smaCross');
    if (config.strategies[0].name === 'smaCross') {
      assert.equal(config.strategies[0].params.short, 10);
      assert.equal(config.strategies[0].params.long, 30);
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
