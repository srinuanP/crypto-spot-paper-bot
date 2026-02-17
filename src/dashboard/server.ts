import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { open, readFile, stat } from 'node:fs/promises';
import { createReadStream, existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { parse as parseUrl } from 'node:url';
import { tailFileLines } from './fileTail.js';
import { parsePaperJsonl, safeParseJson } from './jsonl.js';
import type { BacktestReport, DashboardHealth, JournalLatest, PaperTailResponse } from './types.js';

const ROOT_DIR = path.resolve('.');
const LEGACY_PUBLIC_DIR = path.resolve(ROOT_DIR, 'src/dashboard/public');
const UI_DIST_DIR = path.resolve(ROOT_DIR, 'apps/dashboard-ui/dist');
const REPORT_LATEST_PATH = path.resolve(ROOT_DIR, 'reports/latest.json');
const PAPER_LOG_PATH = path.resolve(ROOT_DIR, 'paper-log.jsonl');
const JOURNAL_JSON_PATH = path.resolve(ROOT_DIR, 'journal/latest.json');
const JOURNAL_MD_PATH = path.resolve(ROOT_DIR, 'journal/latest.md');
const SSE_POLL_MS = 1000;
const SSE_HEARTBEAT_MS = 15_000;

type DashboardServerOptions = {
  host?: string;
  port?: number;
  silent?: boolean;
};

type RuntimeStatus = {
  mode: 'paper' | 'testnet';
  validateOnly: boolean;
  ts: string;
};

type SseClientState = {
  res: ServerResponse;
  heartbeat: NodeJS.Timeout;
};

class PaperLogStreamHub {
  private clients = new Set<SseClientState>();
  private pollTimer: NodeJS.Timeout | null = null;
  private offset = 0;
  private carry = '';
  private seq = 0;
  private syncedToEnd = false;

  private broadcast(event: string, data: unknown): void {
    const payload = typeof data === 'string' ? data : JSON.stringify(data);
    this.seq += 1;
    for (const client of this.clients) {
      client.res.write(`id: ${this.seq}\n`);
      client.res.write(`event: ${event}\n`);
      client.res.write(`data: ${payload}\n\n`);
    }
  }

  private startPolling(): void {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => {
      void this.poll().catch((error) => {
        this.broadcast('error', { message: (error as Error).message });
      });
    }, SSE_POLL_MS);
  }

  private stopPolling(): void {
    if (!this.pollTimer) return;
    clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  private async poll(): Promise<void> {
    if (this.clients.size === 0) return;
    if (!existsSync(PAPER_LOG_PATH)) {
      this.offset = 0;
      this.carry = '';
      this.syncedToEnd = false;
      return;
    }

    const info = await stat(PAPER_LOG_PATH);
    if (!this.syncedToEnd) {
      this.offset = info.size;
      this.syncedToEnd = true;
      return;
    }

    if (info.size < this.offset) {
      this.offset = 0;
      this.carry = '';
    }

    if (info.size === this.offset) return;
    const readLength = info.size - this.offset;
    if (readLength <= 0) return;

    const handle = await open(PAPER_LOG_PATH, 'r');
    try {
      const chunk = Buffer.alloc(readLength);
      await handle.read(chunk, 0, readLength, this.offset);
      this.offset = info.size;

      const text = this.carry + chunk.toString('utf8');
      const lines = text.split(/\r?\n/);
      this.carry = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const row = safeParseJson<Record<string, unknown>>(trimmed);
        this.broadcast('paper-log', {
          line: trimmed,
          row
        });
      }
    } finally {
      await handle.close();
    }
  }

  addClient(res: ServerResponse): () => void {
    const heartbeat = setInterval(() => {
      res.write(': heartbeat\n\n');
    }, SSE_HEARTBEAT_MS);

    const state: SseClientState = { res, heartbeat };
    this.clients.add(state);
    this.startPolling();
    this.broadcast('connected', { ok: true, ts: new Date().toISOString() });

    return () => {
      clearInterval(heartbeat);
      this.clients.delete(state);
      if (this.clients.size === 0) {
        this.stopPolling();
      }
    };
  }

  async close(): Promise<void> {
    this.stopPolling();
    for (const client of this.clients) {
      clearInterval(client.heartbeat);
      client.res.end();
    }
    this.clients.clear();
  }
}

const paperStreamHub = new PaperLogStreamHub();

function isFileNotFoundError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as { code?: string }).code === 'ENOENT';
}

function jsonResponse(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function resolveStaticFile(baseDir: string, requestPath: string): string | null {
  const relative = requestPath === '/' ? '/index.html' : requestPath;
  const normalized = path.normalize(relative).replace(/^(\.\.(\/|\\|$))+/, '');
  const resolved = path.resolve(baseDir, `.${normalized}`);
  if (!resolved.startsWith(baseDir)) return null;
  return resolved;
}

function hasUiDistBuild(): boolean {
  return existsSync(path.resolve(UI_DIST_DIR, 'index.html'));
}

function contentTypeByExt(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.js') return 'application/javascript; charset=utf-8';
  if (ext === '.css') return 'text/css; charset=utf-8';
  if (ext === '.json') return 'application/json; charset=utf-8';
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.ico') return 'image/x-icon';
  if (ext === '.txt') return 'text/plain; charset=utf-8';
  if (ext === '.map') return 'application/json; charset=utf-8';
  return 'application/octet-stream';
}

function getLineLimit(urlPath: string | undefined): number {
  if (!urlPath) return 500;
  const parsed = parseUrl(urlPath, true);
  const raw = parsed.query.lines;
  const value = Array.isArray(raw) ? raw[0] : raw;
  const n = Number(value ?? 500);
  if (!Number.isFinite(n)) return 500;
  return Math.max(1, Math.min(5000, Math.floor(n)));
}

function queryNumber(value: unknown): number | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

function getRuntimeStatus(): RuntimeStatus {
  const rawMode = String(process.env.EXECUTION_MODE ?? 'paper').toLowerCase();
  const mode: RuntimeStatus['mode'] = rawMode === 'testnet' ? 'testnet' : 'paper';
  const tradingEnabled = String(process.env.BINANCE_TESTNET_TRADING_ENABLED ?? 'NO').toUpperCase() === 'YES';
  const validateOnly = mode === 'paper' ? true : !tradingEnabled;
  return {
    mode,
    validateOnly,
    ts: new Date().toISOString()
  };
}

async function readPaperEventsByRange(options: {
  fromMs?: number;
  toMs?: number;
  maxLines: number;
}): Promise<{ items: Record<string, unknown>[]; scannedLines: number }> {
  const stream = createReadStream(PAPER_LOG_PATH, { encoding: 'utf8' });
  const rl = createInterface({
    input: stream,
    crlfDelay: Infinity
  });

  const items: Record<string, unknown>[] = [];
  let scannedLines = 0;
  for await (const line of rl) {
    scannedLines += 1;
    if (items.length >= options.maxLines) break;
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parsed = safeParseJson<Record<string, unknown>>(trimmed);
    if (!parsed) continue;

    const ts = Number(parsed.ts);
    if (options.fromMs !== undefined) {
      if (!Number.isFinite(ts) || ts < options.fromMs) continue;
    }
    if (options.toMs !== undefined) {
      if (!Number.isFinite(ts) || ts > options.toMs) continue;
    }

    items.push(parsed);
  }

  rl.close();
  stream.close();
  return { items, scannedLines };
}

async function handleApi(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const parsed = parseUrl(req.url ?? '', true);
  const pathname = parsed.pathname ?? '';

  if (pathname === '/api/runtime/status' && req.method === 'GET') {
    jsonResponse(res, 200, { ok: true, data: getRuntimeStatus() });
    return true;
  }

  if (pathname === '/api/health' && req.method === 'GET') {
    const health: DashboardHealth = { ok: true, ts: new Date().toISOString() };
    jsonResponse(res, 200, health);
    return true;
  }

  if (pathname === '/api/report/latest' && req.method === 'GET') {
    try {
      if (!existsSync(REPORT_LATEST_PATH)) {
        jsonResponse(res, 404, { ok: false, message: 'ไม่พบ reports/latest.json ให้รัน npm run backtest ก่อน' });
        return true;
      }

      const raw = await readFile(REPORT_LATEST_PATH, 'utf8');
      const data = JSON.parse(raw) as BacktestReport;
      jsonResponse(res, 200, { ok: true, data });
    } catch (error) {
      if (isFileNotFoundError(error)) {
        jsonResponse(res, 404, { ok: false, message: 'ไม่พบ reports/latest.json ให้รัน npm run backtest ก่อน' });
        return true;
      }
      throw error;
    }
    return true;
  }

  if (pathname === '/api/paper/tail' && req.method === 'GET') {
    if (!existsSync(PAPER_LOG_PATH)) {
      const payload: PaperTailResponse = {
        ok: true,
        items: [],
        message: 'ยังไม่พบ paper-log.jsonl ให้รัน npm run paper ก่อน'
      };
      jsonResponse(res, 200, payload);
      return true;
    }

    try {
      const lineLimit = getLineLimit(req.url);
      const lines = await tailFileLines(PAPER_LOG_PATH, lineLimit);
      const parsedRows = parsePaperJsonl(lines.join('\n'));
      const payload: PaperTailResponse = {
        ok: true,
        items: parsedRows.items,
        message: parsedRows.skipped > 0 ? `ข้ามบรรทัดที่ parse ไม่ได้ ${parsedRows.skipped} บรรทัด` : undefined
      };
      jsonResponse(res, 200, payload);
    } catch (error) {
      if (isFileNotFoundError(error)) {
        jsonResponse(res, 200, {
          ok: true,
          items: [],
          message: 'ยังไม่พบ paper-log.jsonl ให้รัน npm run paper ก่อน'
        } satisfies PaperTailResponse);
        return true;
      }
      throw error;
    }
    return true;
  }

  if (pathname === '/api/paper/read' && req.method === 'GET') {
    if (!existsSync(PAPER_LOG_PATH)) {
      jsonResponse(res, 404, { ok: false, message: 'paper-log.jsonl not found. Run npm run paper first.' });
      return true;
    }

    const fromMs = queryNumber(parsed.query.from);
    const toMs = queryNumber(parsed.query.to);
    const requestedMaxLines = queryNumber(parsed.query.maxLines) ?? 5000;
    const maxLines = Math.max(1, Math.min(20_000, Math.floor(requestedMaxLines)));

    try {
      const { items, scannedLines } = await readPaperEventsByRange({ fromMs, toMs, maxLines });
      jsonResponse(res, 200, {
        ok: true,
        data: {
          items,
          count: items.length,
          scannedLines,
          from: fromMs ?? null,
          to: toMs ?? null,
          maxLines
        }
      });
      return true;
    } catch (error) {
      if (isFileNotFoundError(error)) {
        jsonResponse(res, 404, { ok: false, message: 'paper-log.jsonl not found. Run npm run paper first.' });
        return true;
      }
      throw error;
    }
  }

  if (pathname === '/api/journal/latest' && req.method === 'GET') {
    if (existsSync(JOURNAL_JSON_PATH)) {
      const raw = await readFile(JOURNAL_JSON_PATH, 'utf8');
      const data = JSON.parse(raw) as Record<string, unknown>;
      const payload: JournalLatest = { format: 'json', data };
      jsonResponse(res, 200, { ok: true, ...payload });
      return true;
    }
    if (existsSync(JOURNAL_MD_PATH)) {
      const text = await readFile(JOURNAL_MD_PATH, 'utf8');
      const payload: JournalLatest = { format: 'markdown', data: text };
      jsonResponse(res, 200, { ok: true, ...payload });
      return true;
    }

    jsonResponse(res, 404, { ok: false, message: 'ไม่พบ journal/latest.json หรือ journal/latest.md' });
    return true;
  }

  if (pathname === '/api/paper/stream' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    res.write(': connected\n\n');

    const dispose = paperStreamHub.addClient(res);
    req.on('close', () => {
      dispose();
    });
    req.on('aborted', () => {
      dispose();
    });
    return true;
  }

  return false;
}

async function handleStatic(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!req.url) {
    jsonResponse(res, 400, { ok: false, message: 'Bad request' });
    return;
  }

  const parsed = parseUrl(req.url);
  const pathname = parsed.pathname ?? '/';
  const serveUiDist = hasUiDistBuild();
  const staticBaseDir = serveUiDist ? UI_DIST_DIR : LEGACY_PUBLIC_DIR;
  const filePath = resolveStaticFile(staticBaseDir, pathname);
  if (!filePath) {
    jsonResponse(res, 403, { ok: false, message: 'Forbidden' });
    return;
  }

  if (existsSync(filePath)) {
    const data = await readFile(filePath);
    res.writeHead(200, {
      'Content-Type': contentTypeByExt(filePath),
      'Content-Length': data.length,
      'Cache-Control': 'no-store'
    });
    res.end(data);
    return;
  }

  if (serveUiDist && path.extname(pathname) === '') {
    const spaIndex = path.resolve(UI_DIST_DIR, 'index.html');
    if (existsSync(spaIndex)) {
      const data = await readFile(spaIndex);
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Length': data.length,
        'Cache-Control': 'no-store'
      });
      res.end(data);
      return;
    }
  }

  jsonResponse(res, 404, { ok: false, message: 'Not found' });
}

export async function startDashboardServer(options: DashboardServerOptions = {}): Promise<{
  close: () => Promise<void>;
  port: number;
  host: string;
}> {
  const host = options.host ?? '127.0.0.1';
  const requestedPort = options.port ?? 8787;
  const silent = options.silent === true;

  const server = http.createServer((req, res) => {
    void (async () => {
      try {
        const handledApi = await handleApi(req, res);
        if (handledApi) return;
        await handleStatic(req, res);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Internal server error';
        jsonResponse(res, 500, { ok: false, message });
      }
    })();
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(requestedPort, host, () => {
      server.off('error', reject);
      resolve();
    });
  });

  const boundAddress = server.address();
  const port = typeof boundAddress === 'object' && boundAddress !== null
    ? boundAddress.port
    : requestedPort;

  if (!silent) {
    console.log(`Dashboard running at http://${host}:${port}`);
  }

  return {
    host,
    port,
    close: async () => {
      await paperStreamHub.close();
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    }
  };
}

async function main(): Promise<void> {
  const portEnv = Number(process.env.DASHBOARD_PORT ?? 8787);
  const port = Number.isFinite(portEnv) ? portEnv : 8787;
  await startDashboardServer({ port });
}

const isMain = process.argv[1] !== undefined
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
