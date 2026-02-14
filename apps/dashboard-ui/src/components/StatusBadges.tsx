import type { RuntimeStatus } from '../api/client';
import type { SseStatus } from '../api/sse';

type StatusBadgesProps = {
  runtimeStatus: RuntimeStatus | null;
  sseStatus: SseStatus;
  healthOk: boolean;
};

function toneClass(tone: 'neutral' | 'success' | 'warning' | 'danger'): string {
  if (tone === 'success') return 'badge-success';
  if (tone === 'warning') return 'badge-warning';
  if (tone === 'danger') return 'badge-danger';
  return 'badge-neutral';
}

export function StatusBadges({ runtimeStatus, sseStatus, healthOk }: StatusBadgesProps) {
  const mode = runtimeStatus?.mode ?? 'paper';
  const validateOnly = runtimeStatus?.validateOnly ?? true;

  const sseTone: 'neutral' | 'success' | 'warning' | 'danger' =
    sseStatus === 'connected'
      ? 'success'
      : sseStatus === 'reconnecting'
        ? 'warning'
        : sseStatus === 'disconnected'
          ? 'danger'
          : 'neutral';
  const sseText = sseStatus === 'connected'
    ? 'เชื่อมต่อแล้ว'
    : sseStatus === 'reconnecting'
      ? 'กำลังเชื่อมต่อใหม่'
      : sseStatus === 'disconnected'
        ? 'ตัดการเชื่อมต่อ'
        : 'กำลังเชื่อมต่อ';

  return (
    <div className="status-badges" aria-label="สถานะระบบ">
      <span className={`badge ${mode === 'paper' ? 'badge-success' : 'badge-warning'}`}>
        โหมด: {mode.toUpperCase()}
      </span>
      <span className={`badge ${validateOnly ? 'badge-warning' : 'badge-danger'}`}>
        {validateOnly ? 'ตรวจสอบเท่านั้น' : 'ส่งคำสั่งจริง'}
      </span>
      <span className={`badge ${toneClass(sseTone)}`}>SSE: {sseText}</span>
      <span className={`badge ${healthOk ? 'badge-success' : 'badge-danger'}`}>
        ระบบ: {healthOk ? 'ปกติ' : 'ไม่พร้อม'}
      </span>
    </div>
  );
}
