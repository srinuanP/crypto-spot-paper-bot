import type { RuntimeStatus } from '../api/client';
import type { SseStatus } from '../api/sse';
import { StatusBadges } from './StatusBadges';

type TopBarProps = {
  runtimeStatus: RuntimeStatus | null;
  sseStatus: SseStatus;
  healthOk: boolean;
  theme: 'light' | 'dark';
  autoRefresh: boolean;
  onToggleTheme: () => void;
  onSetAutoRefresh: (enabled: boolean) => void;
  onRefresh: () => void;
  onOpenLogs: () => void;
};

export function TopBar({
  runtimeStatus,
  sseStatus,
  healthOk,
  theme,
  autoRefresh,
  onToggleTheme,
  onSetAutoRefresh,
  onRefresh,
  onOpenLogs
}: TopBarProps) {
  return (
    <header className="topbar panel" role="banner">
      <div className="topbar-left">
        <p className="eyebrow">CRYPTO SPOT PAPER BOT</p>
        <h1>แดชบอร์ดวิจัยในเครื่อง</h1>
        <p className="subtitle">สำหรับติดตาม Backtest, Paper และ Journal แบบเรียลไทม์</p>
        <p className="safety-banner">เพื่อการเรียนรู้ ไม่ส่งออเดอร์จริง</p>
      </div>
      <div className="topbar-right">
        <StatusBadges runtimeStatus={runtimeStatus} sseStatus={sseStatus} healthOk={healthOk} />
        <div className="toolbar-row">
          <button className="btn btn-secondary" onClick={onToggleTheme} aria-label="สลับธีม">
            ธีม: {theme === 'dark' ? 'มืด' : 'สว่าง'}
          </button>
          <button className="btn btn-secondary" onClick={onRefresh} aria-label="รีเฟรชข้อมูล">
            รีเฟรช
          </button>
          <label className="switch" htmlFor="auto-refresh-toggle">
            <input
              id="auto-refresh-toggle"
              type="checkbox"
              checked={autoRefresh}
              onChange={(event) => onSetAutoRefresh(event.target.checked)}
            />
            รีเฟรชอัตโนมัติ
          </label>
          <button className="btn btn-primary" onClick={onOpenLogs} aria-label="เปิดหน้าต่าง live log">
            บันทึกสด
          </button>
        </div>
      </div>
    </header>
  );
}
