import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { startDashboardServer } from '../src/dashboard/server.js';

const PAPER_LOG_PATH = path.resolve('paper-log.jsonl');

async function withServer(fn: (baseUrl: string) => Promise<void>): Promise<void> {
  const server = await startDashboardServer({ host: '127.0.0.1', port: 0, silent: true });
  const baseUrl = `http://${server.host}:${server.port}`;
  try {
    await fn(baseUrl);
  } finally {
    await server.close();
  }
}

test('/api/runtime/status returns safe fields only', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/runtime/status`);
    assert.equal(response.status, 200);
    const body = await response.json() as { ok: boolean; data: Record<string, unknown> };

    assert.equal(body.ok, true);
    assert.deepEqual(Object.keys(body.data).sort(), ['mode', 'ts', 'validateOnly']);
    assert.ok(body.data.mode === 'paper' || body.data.mode === 'testnet');
    assert.equal(typeof body.data.validateOnly, 'boolean');
    assert.ok(Number.isFinite(Date.parse(String(body.data.ts))));
  });
});

test('/api/paper/read honors time range and maxLines', async () => {
  const hadOriginal = existsSync(PAPER_LOG_PATH);
  const original = hadOriginal ? await readFile(PAPER_LOG_PATH, 'utf8') : null;

  try {
    const sample = [
      JSON.stringify({ ts: 1000, event: 'TICK', symbol: 'BTCUSDT' }),
      JSON.stringify({ ts: 2000, event: 'BUY', symbol: 'BTCUSDT' }),
      'BROKEN_JSON_LINE',
      JSON.stringify({ ts: 3000, event: 'REJECT', code: 'RATE_LIMIT', reason: 'too many requests' }),
      JSON.stringify({ ts: 4000, event: 'SELL', symbol: 'BTCUSDT' })
    ].join('\n');
    await writeFile(PAPER_LOG_PATH, sample, 'utf8');

    await withServer(async (baseUrl) => {
      const ranged = await fetch(`${baseUrl}/api/paper/read?from=1500&to=3500&maxLines=1`);
      assert.equal(ranged.status, 200);
      const rangedBody = await ranged.json() as {
        ok: boolean;
        data: { items: Array<{ ts?: number }>; count: number; maxLines: number; from: number | null; to: number | null };
      };

      assert.equal(rangedBody.ok, true);
      assert.equal(rangedBody.data.count, 1);
      assert.equal(rangedBody.data.maxLines, 1);
      assert.equal(rangedBody.data.from, 1500);
      assert.equal(rangedBody.data.to, 3500);
      assert.equal(rangedBody.data.items[0]?.ts, 2000);

      const full = await fetch(`${baseUrl}/api/paper/read?from=0&to=5000&maxLines=10`);
      assert.equal(full.status, 200);
      const fullBody = await full.json() as {
        ok: boolean;
        data: { items: Array<{ ts?: number }>; count: number };
      };
      assert.equal(fullBody.ok, true);
      assert.equal(fullBody.data.count, 4);
      assert.deepEqual(fullBody.data.items.map((row) => row.ts), [1000, 2000, 3000, 4000]);
    });
  } finally {
    if (hadOriginal && original !== null) {
      await writeFile(PAPER_LOG_PATH, original, 'utf8');
    } else if (!hadOriginal) {
      await rm(PAPER_LOG_PATH, { force: true });
    }
  }
});
