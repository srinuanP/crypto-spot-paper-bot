import type { DashboardEvent, EventType } from '../types/events';

export type ReplaySnapshot = {
  position: string;
  cash: string;
  equity: string;
  lastTrade: string;
  lastReject: string;
};

type ReplayPanelProps = {
  loading: boolean;
  loadError: string | null;
  fromInput: string;
  toInput: string;
  maxLines: number;
  selectedPreset: '1h' | '6h' | '24h' | 'custom';
  events: DashboardEvent[];
  visibleEvents: DashboardEvent[];
  filterTypes: EventType[];
  search: string;
  playback: {
    isPlaying: boolean;
    speed: number;
    currentIndex: number;
    total: number;
    currentTime: number;
  };
  snapshot: ReplaySnapshot;
  onPresetChange: (preset: '1h' | '6h' | '24h' | 'custom') => void;
  onFromInputChange: (value: string) => void;
  onToInputChange: (value: string) => void;
  onMaxLinesChange: (value: number) => void;
  onLoad: () => void;
  onTogglePlay: () => void;
  onStepForward: () => void;
  onStepBackward: () => void;
  onSpeedChange: (speed: number) => void;
  onSeek: (index: number) => void;
  onFilterTypesChange: (types: EventType[]) => void;
  onSearchChange: (value: string) => void;
};

const replayTypes: EventType[] = [
  'LOG_LINE',
  'TRADE',
  'ORDER_INTENT',
  'RISK_REJECT',
  'ERROR',
  'HEALTH',
  'KILL_SWITCH',
  'RATE_LIMIT'
];

export function ReplayPanel(props: ReplayPanelProps) {
  return (
    <section className="panel replay-panel">
      <div className="panel-head">
        <div>
          <h2>รีเพลย์</h2>
          <p className="panel-subtext">ดีบักตามไทม์ไลน์จากล็อกในช่วงเวลาที่เลือก</p>
        </div>
      </div>

      <div className="replay-config-grid">
        <label className="field">
          <span>ช่วงเวลา</span>
          <select value={props.selectedPreset} onChange={(event) => props.onPresetChange(event.target.value as ReplayPanelProps['selectedPreset'])}>
            <option value="1h">ย้อนหลัง 1 ชั่วโมง</option>
            <option value="6h">ย้อนหลัง 6 ชั่วโมง</option>
            <option value="24h">ย้อนหลัง 24 ชั่วโมง</option>
            <option value="custom">กำหนดเอง</option>
          </select>
        </label>

        <label className="field">
          <span>เริ่มต้น (ms)</span>
          <input value={props.fromInput} onChange={(event) => props.onFromInputChange(event.target.value)} />
        </label>

        <label className="field">
          <span>สิ้นสุด (ms)</span>
          <input value={props.toInput} onChange={(event) => props.onToInputChange(event.target.value)} />
        </label>

        <label className="field">
          <span>จำนวนบรรทัดสูงสุด</span>
          <input
            type="number"
            min={100}
            max={20000}
            value={props.maxLines}
            onChange={(event) => props.onMaxLinesChange(Number(event.target.value) || 5000)}
          />
        </label>

        <button className="btn btn-primary replay-load-btn" onClick={props.onLoad} disabled={props.loading}>
          {props.loading ? 'กำลังโหลด...' : 'โหลดข้อมูล'}
        </button>
      </div>

      {props.loadError ? <p className="muted-text">{props.loadError}</p> : null}

      <div className="replay-controls">
        <button className="btn btn-secondary" onClick={props.onTogglePlay} disabled={props.playback.total === 0}>
          {props.playback.isPlaying ? 'หยุด' : 'เล่น'}
        </button>
        <button className="btn btn-ghost" onClick={props.onStepBackward} disabled={props.playback.total === 0}>
          ถอย 1 เหตุการณ์
        </button>
        <button className="btn btn-ghost" onClick={props.onStepForward} disabled={props.playback.total === 0}>
          เดิน 1 เหตุการณ์
        </button>
        <label className="field replay-speed-field">
          <span>ความเร็ว</span>
          <select value={String(props.playback.speed)} onChange={(event) => props.onSpeedChange(Number(event.target.value))}>
            <option value="1">1x</option>
            <option value="2">2x</option>
            <option value="5">5x</option>
            <option value="10">10x</option>
          </select>
        </label>
      </div>

      <label className="field">
        <span>ตัวเลื่อนไทม์ไลน์ ({props.playback.currentIndex}/{props.playback.total})</span>
        <input
          type="range"
          min={0}
          max={Math.max(0, props.playback.total)}
          value={Math.min(props.playback.currentIndex, props.playback.total)}
          onChange={(event) => props.onSeek(Number(event.target.value))}
          disabled={props.playback.total === 0}
        />
      </label>

      <div className="monitor-grid">
        <article className="panel panel-nested">
          <h3>สถานะขณะนี้</h3>
          <ul className="simple-list compact">
            <li><span>สถานะถือครอง</span><strong>{props.snapshot.position}</strong></li>
            <li><span>เงินสด</span><strong>{props.snapshot.cash}</strong></li>
            <li><span>มูลค่าพอร์ต</span><strong>{props.snapshot.equity}</strong></li>
            <li><span>ดีลล่าสุด</span><strong>{props.snapshot.lastTrade}</strong></li>
            <li><span>เหตุผล Reject ล่าสุด</span><strong>{props.snapshot.lastReject}</strong></li>
          </ul>
        </article>

        <article className="panel panel-nested">
          <h3>ตัวกรอง</h3>
          <div className="replay-type-filters">
            {replayTypes.map((type) => {
              const checked = props.filterTypes.includes(type);
              return (
                <label key={type} className="chip-check">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(event) => {
                      if (event.target.checked) {
                        props.onFilterTypesChange([...props.filterTypes, type]);
                      } else {
                        props.onFilterTypesChange(props.filterTypes.filter((item) => item !== type));
                      }
                    }}
                  />
                  {type}
                </label>
              );
            })}
          </div>
          <label className="field">
            <span>ค้นหา</span>
            <input value={props.search} onChange={(event) => props.onSearchChange(event.target.value)} placeholder="ข้อความ/meta" />
          </label>
        </article>
      </div>

      <article className="panel panel-nested">
        <h3>เหตุการณ์รีเพลย์ ({props.visibleEvents.length}/{props.events.length})</h3>
        <div className="events-list">
          {props.visibleEvents.length === 0 ? (
            <p className="muted-text">ยังไม่มีเหตุการณ์ในรีเพลย์</p>
          ) : (
            props.visibleEvents.map((event) => (
              <div key={event.id} className={`event-item level-${event.level}`}>
                <div className="event-meta">
                  <span>{new Date(event.ts).toLocaleString()}</span>
                  <span>{event.type}</span>
                  <span>{event.source}</span>
                </div>
                <p>{event.message}</p>
              </div>
            ))
          )}
        </div>
      </article>
    </section>
  );
}
