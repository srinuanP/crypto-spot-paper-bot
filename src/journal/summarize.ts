import { readFile } from 'node:fs/promises';
import { parseArgs } from '../cli/args.js';

type RuleCheck = { name: string; ok: boolean; detail: string };

async function summarizeBacktest(path: string): Promise<string> {
  const report = JSON.parse(await readFile(path, 'utf-8')) as {
    metrics: { totalReturn: number; maxDrawdown: number; winRate: number; numberOfTrades: number };
    config: { stopLossPct?: number; riskPerTradePct: number };
    trades: Array<{ pnl: number }>;
  };

  let consecutiveLosses = 0;
  let maxConsecutiveLosses = 0;
  for (const t of report.trades) {
    if (t.pnl < 0) {
      consecutiveLosses += 1;
      maxConsecutiveLosses = Math.max(maxConsecutiveLosses, consecutiveLosses);
    } else {
      consecutiveLosses = 0;
    }
  }

  const checks: RuleCheck[] = [
    {
      name: 'จำนวนเทรดไม่ถี่เกินไป',
      ok: report.metrics.numberOfTrades <= 100,
      detail: `จำนวนเทรดทั้งหมด ${report.metrics.numberOfTrades} ดีล`
    },
    {
      name: 'มีการตั้ง stop loss',
      ok: Boolean(report.config.stopLossPct),
      detail: report.config.stopLossPct ? `stopLossPct=${report.config.stopLossPct}` : 'ยังไม่ได้ตั้ง stop loss'
    },
    {
      name: 'ไม่ขาดทุนติดกันเกิน 5 ดีล',
      ok: maxConsecutiveLosses <= 5,
      detail: `ขาดทุนติดกันสูงสุด ${maxConsecutiveLosses} ดีล`
    },
    {
      name: 'ความเสี่ยงต่อดีลไม่เกิน 2%',
      ok: report.config.riskPerTradePct <= 0.02,
      detail: `riskPerTradePct=${(report.config.riskPerTradePct * 100).toFixed(2)}%`
    }
  ];

  const lines = [
    'สรุปผล Backtest (ภาษาไทย):',
    `- ผลตอบแทนรวม: ${(report.metrics.totalReturn * 100).toFixed(2)}%`,
    `- Max Drawdown: ${(report.metrics.maxDrawdown * 100).toFixed(2)}%`,
    `- Win Rate: ${(report.metrics.winRate * 100).toFixed(2)}%`,
    '',
    'ตรวจวินัยการเทรด:',
    ...checks.map((c) => `- [${c.ok ? 'ผ่าน' : 'ไม่ผ่าน'}] ${c.name}: ${c.detail}`),
    '',
    'ข้อเสนอแนะ:',
    '- ถ้าผลตอบแทนติดลบ ให้ลดความถี่เทรดหรือเพิ่มเงื่อนไขยืนยันก่อนเข้า.',
    '- เปิดใช้ stop loss เพื่อควบคุมความเสี่ยงทุกดีล.',
    '- ทดสอบหลายช่วงเวลาและหลายคู่เหรียญก่อนใช้งานจริง.'
  ];

  return lines.join('\n');
}

async function summarizePaperLog(path: string): Promise<string> {
  const raw = await readFile(path, 'utf-8');
  const rows = raw.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
  const buys = rows.filter((r) => r.event === 'BUY').length;
  const sells = rows.filter((r) => r.event === 'SELL').length;
  const killSwitch = rows.some((r) => r.event === 'KILL_SWITCH');

  return [
    'สรุปผล Paper Log (ภาษาไทย):',
    `- จำนวน BUY: ${buys}`,
    `- จำนวน SELL: ${sells}`,
    `- Kill switch: ${killSwitch ? 'ถูกเรียกใช้' : 'ไม่ถูกเรียกใช้'}`,
    '- ตรวจเพิ่ม: ดูว่ามีการเปิด position ค้างนานผิดปกติหรือไม่.'
  ].join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const mode = args.mode ?? 'backtest';
  const file = args.file ?? (mode === 'backtest' ? 'reports/latest.json' : 'paper-log.jsonl');

  const text = mode === 'paper' ? await summarizePaperLog(file) : await summarizeBacktest(file);
  console.log(text);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
