import type { PaperLogRow } from './types.js';

export type JsonlParseResult<T> = {
  items: T[];
  skipped: number;
};

export function splitLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function safeParseJson<T>(line: string): T | null {
  try {
    return JSON.parse(line) as T;
  } catch {
    return null;
  }
}

export function parseJsonl<T = Record<string, unknown>>(text: string): JsonlParseResult<T> {
  const lines = splitLines(text);
  const items: T[] = [];
  let skipped = 0;

  for (const line of lines) {
    const parsed = safeParseJson<T>(line);
    if (parsed === null) {
      skipped += 1;
      continue;
    }
    items.push(parsed);
  }

  return { items, skipped };
}

export function parsePaperJsonl(text: string): JsonlParseResult<PaperLogRow> {
  return parseJsonl<PaperLogRow>(text);
}
