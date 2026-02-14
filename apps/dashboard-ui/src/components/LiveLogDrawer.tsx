type LiveLogDrawerProps = {
  open: boolean;
  statusText: string;
  message: string | null;
  logLines: string[];
  paused: boolean;
  onPauseToggle: () => void;
  onClear: () => void;
  onClose: () => void;
};

export function LiveLogDrawer({
  open,
  statusText,
  message,
  logLines,
  paused,
  onPauseToggle,
  onClear,
  onClose
}: LiveLogDrawerProps) {
  return (
    <div className={`drawer ${open ? 'is-open' : ''}`} aria-hidden={!open}>
      <button className="drawer-backdrop" onClick={onClose} aria-label="ปิด live log" />
      <aside className="drawer-panel" role="dialog" aria-label="แผงบันทึกสด">
        <div className="drawer-head">
          <h2>บันทึกสด Paper</h2>
          <div className="drawer-actions">
            <button className="btn btn-ghost" onClick={onPauseToggle}>
              {paused ? 'เล่นต่อ' : 'พัก'}
            </button>
            <button className="btn btn-ghost" onClick={onClear}>
              ล้าง
            </button>
            <button className="btn btn-secondary" onClick={onClose}>
              ปิด
            </button>
          </div>
        </div>

        <div className="drawer-meta">
          <span className="badge badge-neutral">{statusText}</span>
          <span className="muted-text">{message ?? ''}</span>
        </div>

        <pre className="live-log" tabIndex={0}>
          {logLines.length > 0 ? logLines.join('\n') : 'ยังไม่มีข้อมูล log'}
        </pre>
      </aside>
    </div>
  );
}
