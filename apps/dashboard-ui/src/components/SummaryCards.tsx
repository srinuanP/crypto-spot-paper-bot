import type { ReportPayload } from '../api/client';

type SummaryCardsProps = {
  loading: boolean;
  report: ReportPayload | null;
  reportMessage: string | null;
  lastUpdatedText: string;
};

function formatPercent(value: unknown): string {
  if (typeof value !== 'number' || Number.isNaN(value)) return '-';
  return `${(value * 100).toFixed(2)}%`;
}

function formatNumber(value: unknown, digits = 2): string {
  if (typeof value !== 'number' || Number.isNaN(value)) return '-';
  if (!Number.isFinite(value)) return 'INF';
  return value.toFixed(digits);
}

function calcExpectancy(report: ReportPayload | null): number | null {
  const trades = Array.isArray(report?.trades) ? report.trades : [];
  const pnls = trades.map((row) => Number(row?.pnl)).filter((value) => Number.isFinite(value));
  if (pnls.length === 0) return null;

  const wins = pnls.filter((value) => value > 0);
  const losses = pnls.filter((value) => value < 0).map((value) => Math.abs(value));
  const winRate = wins.length / pnls.length;
  const avgWin = wins.length ? wins.reduce((a, b) => a + b, 0) / wins.length : 0;
  const avgLoss = losses.length ? losses.reduce((a, b) => a + b, 0) / losses.length : 0;
  return winRate * avgWin - (1 - winRate) * avgLoss;
}

function MetricCard({ label, value, tone }: { label: string; value: string; tone?: 'pos' | 'neg' }) {
  return (
    <article className="metric-card">
      <div className="metric-label">{label}</div>
      <div className={`metric-value ${tone ?? ''}`.trim()}>{value}</div>
    </article>
  );
}

export function SummaryCards({ loading, report, reportMessage, lastUpdatedText }: SummaryCardsProps) {
  if (loading) {
    return (
      <div className="skeleton-grid" aria-label="กำลังโหลดสรุปผล">
        {Array.from({ length: 8 }).map((_, index) => (
          <div key={index} className="skeleton-card" />
        ))}
      </div>
    );
  }

  if (!report?.metrics) {
    return (
      <div className="empty-state">
        <h3>ยังไม่พบผล Backtest</h3>
        <p>{reportMessage ?? 'ให้รัน backtest ก่อนเพื่อสร้าง reports/latest.json'}</p>
        <code>npm run backtest -- --symbol BTCUSDT --interval 15m --limit 500 --strategy smaCross</code>
      </div>
    );
  }

  const expectancy = calcExpectancy(report);
  const generatedAt = report.generatedAt ? new Date(report.generatedAt).toLocaleString() : '-';

  return (
    <div className="summary-grid">
      <MetricCard
        label="ผลตอบแทนรวม"
        value={formatPercent(report.metrics.totalReturn)}
        tone={(report.metrics.totalReturn ?? 0) >= 0 ? 'pos' : 'neg'}
      />
      <MetricCard label="ดรอดาวน์สูงสุด" value={formatPercent(report.metrics.maxDrawdown)} tone="neg" />
      <MetricCard label="อัตราชนะ" value={formatPercent(report.metrics.winRate)} />
      <MetricCard label="ค่า Profit Factor" value={formatNumber(report.metrics.profitFactor)} />
      <MetricCard label="จำนวนดีล" value={String(report.metrics.numberOfTrades ?? '-')} />
      <MetricCard
        label="ค่าคาดหวัง"
        value={expectancy === null ? '-' : formatNumber(expectancy, 4)}
        tone={expectancy === null ? undefined : expectancy >= 0 ? 'pos' : 'neg'}
      />
      <MetricCard label="เวลารายงาน" value={generatedAt} />
      <MetricCard label="อัปเดตล่าสุด" value={lastUpdatedText} />
    </div>
  );
}
