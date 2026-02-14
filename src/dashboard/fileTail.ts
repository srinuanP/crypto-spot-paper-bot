import { open } from 'node:fs/promises';

const DEFAULT_CHUNK_SIZE = 64 * 1024;

export async function tailFileLines(filePath: string, maxLines: number): Promise<string[]> {
  const safeMaxLines = Math.max(0, Math.floor(maxLines));
  if (safeMaxLines === 0) return [];

  const handle = await open(filePath, 'r');
  try {
    const stat = await handle.stat();
    if (stat.size <= 0) return [];

    let position = stat.size;
    let bufferText = '';

    while (position > 0) {
      const chunkLength = Math.min(DEFAULT_CHUNK_SIZE, position);
      position -= chunkLength;

      const chunk = Buffer.alloc(chunkLength);
      await handle.read(chunk, 0, chunkLength, position);
      bufferText = chunk.toString('utf8') + bufferText;

      const lineCount = bufferText.split(/\r?\n/).filter((line) => line.trim().length > 0).length;
      if (lineCount >= safeMaxLines + 1) {
        break;
      }
    }

    const lines = bufferText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    return lines.slice(-safeMaxLines);
  } finally {
    await handle.close();
  }
}
