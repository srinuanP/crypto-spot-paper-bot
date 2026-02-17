import { useMemo } from 'react';
import type { TradeFilters, TradeRow } from '../state/store';

type TradesTableProps = {
  allRows: TradeRow[];
  rows: TradeRow[];
  filters: TradeFilters;
  page: number;
  pageSize: number;
  onFilterChange: (filters: Partial<TradeFilters>) => void;
  onResetFilters: () => void;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
};

function formatNumber(value: number | null, digits = 2): string {
  if (typeof value !== 'number' || Number.isNaN(value)) return '-';
  return value.toFixed(digits);
}

export function TradesTable({
  allRows,
  rows,
  filters,
  page,
  pageSize,
  onFilterChange,
  onResetFilters,
  onPageChange,
  onPageSizeChange
}: TradesTableProps) {
  const symbols = useMemo(() => Array.from(new Set(allRows.map((row) => row.symbol).filter(Boolean))).sort(), [allRows]);
  const strategies = useMemo(() => Array.from(new Set(allRows.map((row) => row.strategy).filter(Boolean))).sort(), [allRows]);

  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * pageSize;
  const pagedRows = rows.slice(start, start + pageSize);

  return (
    <section className="panel trades-panel">
      <div className="panel-head">
        <div>
          <h2>ดีลเทรด</h2>
          <p className="panel-subtext">
            แสดง {rows.length === 0 ? 0 : start + 1}-{Math.min(rows.length, start + pageSize)} จาก {rows.length} รายการ
          </p>
        </div>
      </div>

      <div className="toolbar-grid">
        <label className="field">
          <span>ค้นหา</span>
          <input
            value={filters.search}
            onChange={(event) => onFilterChange({ search: event.target.value })}
            placeholder="symbol / strategy / เหตุผล"
          />
        </label>

        <label className="field">
          <span>สัญลักษณ์</span>
          <select value={filters.symbol} onChange={(event) => onFilterChange({ symbol: event.target.value })}>
            <option value="">ทั้งหมด</option>
            {symbols.map((symbol) => (
              <option key={symbol} value={symbol}>
                {symbol}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>กลยุทธ์</span>
          <select value={filters.strategy} onChange={(event) => onFilterChange({ strategy: event.target.value })}>
            <option value="">ทั้งหมด</option>
            {strategies.map((strategy) => (
              <option key={strategy} value={strategy}>
                {strategy}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>ฝั่ง</span>
          <select value={filters.side} onChange={(event) => onFilterChange({ side: event.target.value as TradeFilters['side'] })}>
            <option value="">ทั้งหมด</option>
            <option value="BUY">ซื้อ (BUY)</option>
            <option value="SELL">ขาย (SELL)</option>
          </select>
        </label>

        <label className="field">
          <span>เรียงลำดับ</span>
          <select value={filters.sort} onChange={(event) => onFilterChange({ sort: event.target.value as TradeFilters['sort'] })}>
            <option value="timeDesc">เวลา (ใหม่สุด)</option>
            <option value="timeAsc">เวลา (เก่าสุด)</option>
            <option value="pnlDesc">PnL (มากไปน้อย)</option>
            <option value="pnlAsc">PnL (น้อยไปมาก)</option>
          </select>
        </label>

        <label className="field">
          <span>แถวต่อหน้า</span>
          <select value={String(pageSize)} onChange={(event) => onPageSizeChange(Number(event.target.value))}>
            <option value="10">10</option>
            <option value="25">25</option>
            <option value="50">50</option>
          </select>
        </label>

        <button className="btn btn-ghost field-btn" onClick={onResetFilters}>
          ล้างตัวกรอง
        </button>
      </div>

      <div className="table-shell" role="region" aria-label="ตารางรายการเทรด">
        <table className="table">
          <thead>
            <tr>
              <th>เวลา</th>
              <th>สัญลักษณ์</th>
              <th>กลยุทธ์</th>
              <th>ฝั่ง</th>
              <th>ราคา</th>
              <th>ปริมาณ</th>
              <th>PnL</th>
              <th>เหตุผล</th>
            </tr>
          </thead>
          <tbody>
            {pagedRows.length === 0 ? (
              <tr>
                <td className="empty-row" colSpan={8}>
                  ไม่พบรายการตามเงื่อนไขที่เลือก
                </td>
              </tr>
            ) : (
              pagedRows.map((row) => {
                const pnlClass = typeof row.pnl === 'number' && row.pnl < 0 ? 'pnl-negative' : 'pnl-positive';
                return (
                  <tr key={row.id}>
                    <td>{row.ts ? new Date(row.ts).toLocaleString() : '-'}</td>
                    <td>{row.symbol || '-'}</td>
                    <td>{row.strategy || '-'}</td>
                    <td>
                      <span className={`side-chip ${row.side === 'BUY' ? 'side-buy' : 'side-sell'}`}>{row.side}</span>
                    </td>
                    <td>{formatNumber(row.price, 4)}</td>
                    <td>{formatNumber(row.qty, 6)}</td>
                    <td className={typeof row.pnl === 'number' ? pnlClass : ''}>{formatNumber(row.pnl, 4)}</td>
                    <td>{row.reason || '-'}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="pagination">
        <button className="btn btn-ghost" disabled={safePage <= 1} onClick={() => onPageChange(safePage - 1)}>
          ก่อนหน้า
        </button>
        <span>
          หน้า {safePage}/{totalPages}
        </span>
        <button className="btn btn-ghost" disabled={safePage >= totalPages} onClick={() => onPageChange(safePage + 1)}>
          ถัดไป
        </button>
      </div>
    </section>
  );
}
