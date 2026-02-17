type SetupWizardProps = {
  open: boolean;
  healthOk: boolean;
  hasReport: boolean;
  hasPaperLog: boolean;
  onCopy: (command: string) => void;
  onClose: () => void;
};

const COMMANDS = {
  backtest: 'npm run backtest -- --symbol BTCUSDT --interval 15m --limit 500 --strategy smaCross',
  paper: 'npm run paper -- --symbol BTCUSDT --interval 1m --strategy smaCross --pollMs 5000',
  journal: 'npm run journal -- --input paper-log.jsonl'
};

function Step({ done, title, detail }: { done: boolean; title: string; detail: string }) {
  return (
    <li className={`wizard-step ${done ? 'done' : ''}`}>
      <span className="wizard-check" aria-hidden="true">{done ? '✓' : '•'}</span>
      <div>
        <strong>{title}</strong>
        <p>{detail}</p>
      </div>
    </li>
  );
}

export function SetupWizard({ open, healthOk, hasReport, hasPaperLog, onCopy, onClose }: SetupWizardProps) {
  if (!open) return null;

  return (
    <section className="panel wizard-panel" aria-label="ตัวช่วยตั้งค่า">
      <div className="panel-head">
        <div>
          <h2>ตัวช่วยตั้งค่า</h2>
          <p className="panel-subtext">ช่วยเตรียมข้อมูลก่อนใช้งานแดชบอร์ดให้ครบ</p>
        </div>
        <button className="btn btn-secondary" onClick={onClose}>
          ปิดตัวช่วย
        </button>
      </div>

      <ol className="wizard-list">
        <Step done={healthOk} title="1) เซิร์ฟเวอร์แดชบอร์ดต้องพร้อม" detail="ตรวจ /api/health ให้ตอบกลับปกติ" />
        <Step done={hasReport} title="2) สร้างรายงาน backtest" detail="ต้องมีไฟล์ reports/latest.json" />
        <Step done={hasPaperLog} title="3) รัน paper log" detail="ต้องมีข้อมูลใน paper-log.jsonl เพื่อดู realtime" />
      </ol>

      <div className="wizard-actions">
        <button className="quick-action" onClick={() => onCopy(COMMANDS.backtest)}>
          คัดลอกคำสั่ง backtest
        </button>
        <button className="quick-action" onClick={() => onCopy(COMMANDS.paper)}>
          คัดลอกคำสั่ง paper
        </button>
        <button className="quick-action" onClick={() => onCopy(COMMANDS.journal)}>
          คัดลอกคำสั่ง journal
        </button>
      </div>
    </section>
  );
}
