import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { calculateMaxDrawdown } from '../backtest/engine.js';
import { toLocalDateKey } from '../paper/risk.js';

type JsonLike = Record<string, unknown>;

export type JournalFormat = 'paper' | 'backtest';

export type JournalViolation = {
  code: string;
  detail: string;
};

export type JournalAnalysis = {
  source: JournalFormat;
  date: string;
  pnl: number;
  trades: number;
  winRate: number;
  maxDrawdown: number;
  violations: JournalViolation[];
  recommendations: string[];
  notes: string[];
};

export type BacktestReport = {
  generatedAt?: string;
  metrics: {
    totalReturn: number;
    maxDrawdown: number;
    winRate: number;
    numberOfTrades: number;
  };
  config: {
    stopLossPct?: number;
    riskPerTradePct?: number;
  };
  trades: Array<{ pnl: number }>;
};

export type PaperLogEntry = JsonLike & {
  ts?: number;
  event?: string;
};

const DAY_MS = 24 * 60 * 60 * 1000;

function toNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function toStringValue(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function ensureDate(date: string | undefined, now: number): string {
  if (!date) return toLocalDateKey(now);
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  throw new Error(`Invalid --date format: ${date}. Expected YYYY-MM-DD`);
}

function maxCountInRollingWindow(timestamps: number[], windowMs: number): number {
  if (timestamps.length === 0) return 0;
  const sorted = [...timestamps].sort((a, b) => a - b);
  let left = 0;
  let maxCount = 1;
  for (let right = 0; right < sorted.length; right += 1) {
    while (sorted[right] - sorted[left] > windowMs) left += 1;
    maxCount = Math.max(maxCount, right - left + 1);
  }
  return maxCount;
}

function sum(values: number[]): number {
  return values.reduce((acc, value) => acc + value, 0);
}

function finalizeRecommendations(items: string[]): string[] {
  const unique = Array.from(new Set(items));
  const fallback = [
    'ลดความเสี่ยงต่อดีลด้วยการปรับ `--riskPct` ให้ต่ำลงแล้ววัดผลซ้ำ',
    'เพิ่มการยืนยันสัญญาณ เช่นใช้ timeframe สูงขึ้นเพื่อลดสัญญาณรบกวน',
    'ทบทวนผลทุกวันด้วยกติกาเดิมและปรับพารามิเตอร์ครั้งละ 1 ค่า'
  ];
  for (const item of fallback) {
    if (unique.length >= 5) break;
    unique.push(item);
  }
  return unique.slice(0, 5);
}

function buildPaperTrades(rows: PaperLogEntry[]): Array<{ pnl: number; exitTs: number }> {
  const sells = rows
    .filter((row) => row.event === 'SELL')
    .map((row) => ({
      pnl: toNumber(row.realizedPnl) ?? 0,
      exitTs: toNumber(row.ts) ?? 0
    }));
  if (sells.length > 0) return sells;

  const sorted = [...rows]
    .filter((row) => typeof row.event === 'string' && toNumber(row.ts) !== null)
    .sort((a, b) => (toNumber(a.ts) ?? 0) - (toNumber(b.ts) ?? 0));

  let openBuy: { qty: number; fill: number; fee: number } | null = null;
  const trades: Array<{ pnl: number; exitTs: number }> = [];
  for (const row of sorted) {
    if (row.event === 'BUY') {
      const fill = toNumber(row.fill) ?? 0;
      const qty = toNumber(row.qty) ?? 0;
      const fee = toNumber(row.fee) ?? 0;
      openBuy = { fill, qty, fee };
    } else if (row.event === 'SELL' && openBuy) {
      const fill = toNumber(row.fill) ?? 0;
      const qty = toNumber(row.qty) ?? openBuy.qty;
      const fee = toNumber(row.fee) ?? 0;
      const pnl = (fill - openBuy.fill) * qty - openBuy.fee - fee;
      trades.push({ pnl, exitTs: toNumber(row.ts) ?? 0 });
      openBuy = null;
    }
  }
  return trades;
}

function computeConsecutiveLosses(tradePnls: number[]): number {
  let maxLosses = 0;
  let current = 0;
  for (const pnl of tradePnls) {
    if (pnl < 0) {
      current += 1;
      if (current > maxLosses) maxLosses = current;
    } else {
      current = 0;
    }
  }
  return maxLosses;
}

function buildPaperRecommendations(violations: JournalViolation[], maxDrawdown: number): string[] {
  const items: string[] = [];
  for (const violation of violations) {
    if (violation.code === 'MAX_TRADES_PER_HOUR') {
      items.push('ลดความถี่ของสัญญาณหรือเพิ่ม `--maxTradesPerHour` อย่างมีเหตุผลตามสภาพตลาด');
    } else if (violation.code === 'COOLDOWN_BREACH') {
      items.push('เพิ่ม `--cooldownMs` และบังคับปิดรับสัญญาณ BUY จนกว่าจะพ้นช่วงพัก');
    } else if (violation.code === 'MAX_NOTIONAL') {
      items.push('ลดขนาดออเดอร์ด้วย `--riskPct` หรือกำหนด `--maxNotional` ให้สัมพันธ์กับทุน');
    } else if (violation.code === 'CONSECUTIVE_LOSS') {
      items.push('เพิ่ม stop rule หยุดเทรดชั่วคราวเมื่อแพ้ติดกันเกินเกณฑ์ที่กำหนด');
    } else if (violation.code === 'DAILY_MAX_LOSS') {
      items.push('ลดเพดานขาดทุนรายวันและหยุดระบบทันทีเมื่อแตะ limit เพื่อลด tail risk');
    }
  }
  if (maxDrawdown > 0.05) {
    items.push('ลดความผันผวนของพอร์ตด้วยการลด `--riskPct` หรือเพิ่มเงื่อนไขกรองก่อนเข้าเทรด');
  }
  return finalizeRecommendations(items);
}

function buildBacktestRecommendations(violations: JournalViolation[], maxDrawdown: number): string[] {
  const items: string[] = [];
  for (const violation of violations) {
    if (violation.code === 'NO_STOP_LOSS') {
      items.push('ควรกำหนด stop loss ใน backtest เพื่อจำกัด downside ต่อดีล');
    } else if (violation.code === 'RISK_TOO_HIGH') {
      items.push('ลด `riskPerTradePct` ให้ไม่เกิน 2% ต่อดีลเพื่อความทนทานของพอร์ต');
    } else if (violation.code === 'CONSECUTIVE_LOSS') {
      items.push('เพิ่มเงื่อนไขหยุดเทรดเมื่อขาดทุนติดกันเกินเกณฑ์');
    } else if (violation.code === 'OVERTRADING') {
      items.push('ลดจำนวนดีลด้วยการเพิ่มตัวกรองแนวโน้มก่อนส่งสัญญาณ');
    }
  }
  if (maxDrawdown > 0.2) {
    items.push('ปรับพารามิเตอร์กลยุทธ์เพื่อลด max drawdown ก่อนนำไปใช้ paper ต่อ');
  }
  return finalizeRecommendations(items);
}

export function analyzePaperEntries(rows: PaperLogEntry[], date: string, now = Date.now()): JournalAnalysis {
  const targetDate = ensureDate(date, now);
  const dayRows = rows.filter((row) => {
    const ts = toNumber(row.ts);
    return ts !== null && toLocalDateKey(ts) === targetDate;
  });

  const trades = buildPaperTrades(dayRows);
  const tradePnls = trades.map((trade) => trade.pnl);
  const pnl = sum(tradePnls);
  const wins = tradePnls.filter((value) => value > 0).length;
  const winRate = trades.length ? wins / trades.length : 0;

  const equityCurve = dayRows
    .filter((row) => row.event === 'TICK')
    .map((row) => toNumber(row.equity))
    .filter((value): value is number => value !== null);
  const maxDrawdown = equityCurve.length > 1 ? calculateMaxDrawdown(equityCurve) : 0;

  const configRow = dayRows.find((row) => row.event === 'CONFIG');
  const maxTradesPerHour = toNumber(configRow?.maxTradesPerHour) ?? 20;
  const cooldownMs = toNumber(configRow?.cooldownMs) ?? 120_000;
  const maxNotional = toNumber(configRow?.maxNotional) ?? 20;

  const orderTs = dayRows
    .filter((row) => row.event === 'BUY' || row.event === 'SELL')
    .map((row) => toNumber(row.ts))
    .filter((value): value is number => value !== null);
  const peakOrdersPerHour = maxCountInRollingWindow(orderTs, 60 * 60 * 1000);

  const cooldownBreaches = dayRows
    .filter((row) => row.event === 'REJECT' && row.code === 'COOLDOWN_ACTIVE')
    .length;
  const maxNotionalRejects = dayRows
    .filter((row) => row.event === 'REJECT' && row.code === 'MAX_NOTIONAL')
    .length;
  const dailyLossKills = dayRows
    .filter((row) => row.event === 'KILL_SWITCH' && typeof toStringValue(row.code) === 'string')
    .length;

  const violations: JournalViolation[] = [];
  if (peakOrdersPerHour > maxTradesPerHour) {
    violations.push({
      code: 'MAX_TRADES_PER_HOUR',
      detail: `พบออเดอร์สูงสุด ${peakOrdersPerHour} รายการ/ชั่วโมง (limit ${maxTradesPerHour})`
    });
  }
  if (cooldownBreaches > 0) {
    violations.push({
      code: 'COOLDOWN_BREACH',
      detail: `พบการฝืน cooldown ${cooldownBreaches} ครั้ง (cooldown ${cooldownMs} ms)`
    });
  }
  if (maxNotionalRejects > 0) {
    violations.push({
      code: 'MAX_NOTIONAL',
      detail: `พบคำสั่งถูกปฏิเสธเพราะเกิน max notional ${maxNotionalRejects} ครั้ง (limit ${maxNotional})`
    });
  }

  const maxConsecutiveLosses = computeConsecutiveLosses(tradePnls);
  if (maxConsecutiveLosses >= 3) {
    violations.push({
      code: 'CONSECUTIVE_LOSS',
      detail: `ขาดทุนติดกันสูงสุด ${maxConsecutiveLosses} ดีล`
    });
  }
  if (dailyLossKills > 0) {
    violations.push({
      code: 'DAILY_MAX_LOSS',
      detail: `kill switch รายวันถูกเรียกใช้งาน ${dailyLossKills} ครั้ง`
    });
  }

  const recommendations = buildPaperRecommendations(violations, maxDrawdown);
  const notes: string[] = [];
  if (dayRows.length === 0) {
    notes.push(`ไม่พบข้อมูลสำหรับวันที่ ${targetDate}`);
  }
  if (dayRows.length > 0) {
    const firstTs = toNumber(dayRows[0].ts) ?? now;
    const lastTs = toNumber(dayRows[dayRows.length - 1].ts) ?? firstTs;
    if (lastTs - firstTs > DAY_MS) {
      notes.push('log ครอบคลุมเวลามากกว่า 1 วัน ควรระบุ --date ให้ชัดเจน');
    }
  }

  return {
    source: 'paper',
    date: targetDate,
    pnl,
    trades: trades.length,
    winRate,
    maxDrawdown,
    violations,
    recommendations,
    notes
  };
}

export function analyzeBacktestReport(report: BacktestReport, date: string, now = Date.now()): JournalAnalysis {
  const defaultDate = report.generatedAt ? toLocalDateKey(Date.parse(report.generatedAt)) : toLocalDateKey(now);
  const targetDate = ensureDate(date || defaultDate, now);

  const pnl = sum(report.trades.map((trade) => trade.pnl));
  const trades = report.metrics.numberOfTrades || report.trades.length;
  const winRate = report.metrics.winRate;
  const maxDrawdown = report.metrics.maxDrawdown;
  const maxConsecutiveLosses = computeConsecutiveLosses(report.trades.map((trade) => trade.pnl));

  const violations: JournalViolation[] = [];
  if (!report.config.stopLossPct) {
    violations.push({ code: 'NO_STOP_LOSS', detail: 'ยังไม่กำหนด stop loss ใน config' });
  }
  if ((report.config.riskPerTradePct ?? 0) > 0.02) {
    violations.push({
      code: 'RISK_TOO_HIGH',
      detail: `riskPerTradePct=${((report.config.riskPerTradePct ?? 0) * 100).toFixed(2)}% สูงกว่า 2%`
    });
  }
  if (maxConsecutiveLosses > 5) {
    violations.push({ code: 'CONSECUTIVE_LOSS', detail: `ขาดทุนติดกันสูงสุด ${maxConsecutiveLosses} ดีล` });
  }
  if (trades > 100) {
    violations.push({ code: 'OVERTRADING', detail: `จำนวนดีลสูง (${trades} ดีล)` });
  }

  return {
    source: 'backtest',
    date: targetDate,
    pnl,
    trades,
    winRate,
    maxDrawdown,
    violations,
    recommendations: buildBacktestRecommendations(violations, maxDrawdown),
    notes: report.generatedAt ? [`รายงานสร้างเมื่อ ${report.generatedAt}`] : []
  };
}

export function detectJournalFormat(raw: string, inputPath: string): JournalFormat {
  const ext = path.extname(inputPath).toLowerCase();
  if (ext === '.jsonl') return 'paper';

  try {
    const parsed = JSON.parse(raw) as JsonLike;
    if (parsed && typeof parsed === 'object' && parsed.metrics && Array.isArray(parsed.trades)) {
      return 'backtest';
    }
  } catch {
    // fall through
  }

  const firstLine = raw.split('\n').find((line) => line.trim().length > 0);
  if (firstLine) {
    const row = JSON.parse(firstLine) as JsonLike;
    if (typeof row.event === 'string') return 'paper';
  }

  throw new Error('Unable to autodetect input format. Use reports/latest.json or paper-log.jsonl');
}

function parsePaperJsonl(raw: string): PaperLogEntry[] {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as PaperLogEntry);
}

export async function analyzeInputFile(inputPath: string, date?: string, now = Date.now()): Promise<JournalAnalysis> {
  const raw = await readFile(inputPath, 'utf-8');
  const format = detectJournalFormat(raw, inputPath);
  if (format === 'paper') {
    return analyzePaperEntries(parsePaperJsonl(raw), date ?? toLocalDateKey(now), now);
  }
  const report = JSON.parse(raw) as BacktestReport;
  return analyzeBacktestReport(report, date ?? '', now);
}

function renderViolations(violations: JournalViolation[]): string[] {
  if (violations.length === 0) return ['- ไม่พบการผิดกฎสำคัญในข้อมูลวันที่เลือก'];
  return violations.map((violation) => `- [ผิดกฎ] ${violation.code}: ${violation.detail}`);
}

export function renderThaiJournal(analysis: JournalAnalysis): string {
  const lines = [
    `สรุปรายวัน (${analysis.source === 'paper' ? 'Paper Trading' : 'Backtest'}) วันที่ ${analysis.date}`,
    `- PnL: ${analysis.pnl.toFixed(4)}`,
    `- จำนวนดีล: ${analysis.trades}`,
    `- Win rate: ${(analysis.winRate * 100).toFixed(2)}%`,
    `- Max drawdown: ${(analysis.maxDrawdown * 100).toFixed(2)}%`,
    '',
    'ตรวจผิดกฎ:',
    ...renderViolations(analysis.violations),
    '',
    'ข้อเสนอแนะเชิงระบบ:',
    ...analysis.recommendations.slice(0, 5).map((item) => `- ${item}`)
  ];
  if (analysis.notes.length > 0) {
    lines.push('', 'หมายเหตุ:');
    for (const note of analysis.notes) {
      lines.push(`- ${note}`);
    }
  }
  return lines.join('\n');
}
