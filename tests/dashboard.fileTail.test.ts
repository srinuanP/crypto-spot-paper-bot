import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tailFileLines } from '../src/dashboard/fileTail.js';

test('tailFileLines returns requested line count from end of file', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'dash-tail-'));
  const filePath = path.join(tempDir, 'paper-log.jsonl');
  try {
    const lines = Array.from({ length: 10 }).map((_, i) => JSON.stringify({ i: i + 1 }));
    await writeFile(filePath, `${lines.join('\n')}\n`, 'utf8');

    const tail = await tailFileLines(filePath, 3);
    assert.equal(tail.length, 3);
    assert.deepEqual(tail, lines.slice(-3));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
