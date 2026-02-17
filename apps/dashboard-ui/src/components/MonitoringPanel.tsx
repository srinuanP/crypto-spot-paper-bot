import { useMemo } from 'react';
import type { SseStatus } from '../api/sse';
import type { MonitoringAlert, DashboardEvent } from '../types/events';
import { Sparkline } from './Sparkline';

export type MonitoringRules = {
  errorStreakThreshold: number;
  errorWindowSec: number;
  rejectThreshold: number;
  rejectWindowSec: number;
  sseDisconnectSec: number;
};

type MonitoringPanelProps = {
  events: DashboardEvent[];
  alerts: MonitoringAlert[];
  sseStatus: SseStatus;
  lastEventTs: number | null;
  rules: MonitoringRules;
  onRulesChange: (patch: Partial<MonitoringRules>) => void;
  onAcknowledge: (id: string) => void;
  onClearAlerts: () => void;
  onExportAlerts: () => void;
};

function minuteBuckets(events: DashboardEvent[], predicate: (event: DashboardEvent) => boolean): number[] {
  const now = Date.now();
  const buckets = Array.from({ length: 30 }, () => 0);
  for (const event of events) {
    if (!predicate(event)) continue;
    const diff = now - event.ts;
    if (diff < 0 || diff > 30 * 60 * 1000) continue;
    const bucketIndex = 29 - Math.floor(diff / 60_000);
    if (bucketIndex >= 0 && bucketIndex < buckets.length) {
      buckets[bucketIndex] += 1;
    }
  }
  return buckets;
}

export function MonitoringPanel({
  events,
  alerts,
  sseStatus,
  lastEventTs,
  rules,
  onRulesChange,
  onAcknowledge,
  onClearAlerts,
  onExportAlerts
}: MonitoringPanelProps) {
  const now = Date.now();

  const stats = useMemo(() => {
    const errorsPerMinute = minuteBuckets(events, (event) => event.type === 'ERROR');
    const rejectsPerMinute = minuteBuckets(events, (event) => event.type === 'RISK_REJECT');
    const rateLimitHits = events.filter((event) => event.type === 'RATE_LIMIT').length;
    const killSwitchEvents = events.filter((event) => event.type === 'KILL_SWITCH');
    const latestKillSwitch = killSwitchEvents.length > 0 ? killSwitchEvents[killSwitchEvents.length - 1] : null;

    const recentRejects = events.filter((event) => event.type === 'RISK_REJECT' && now - event.ts <= 10 * 60 * 1000);
    const topReasonsMap = new Map<string, number>();
    for (const event of recentRejects) {
      const reason = String(event.meta?.reason ?? event.meta?.code ?? event.message).slice(0, 80);
      topReasonsMap.set(reason, (topReasonsMap.get(reason) ?? 0) + 1);
    }
    const topReasons = Array.from(topReasonsMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    return {
      errorsPerMinute,
      rejectsPerMinute,
      errorRateNow: errorsPerMinute[errorsPerMinute.length - 1] ?? 0,
      rejectRateNow: rejectsPerMinute[rejectsPerMinute.length - 1] ?? 0,
      rateLimitHits,
      latestKillSwitch,
      topReasons
    };
  }, [events, now]);

  return (
    <section className="panel monitoring-panel">
      <div className="panel-head">
        <div>
          <h2>มอนิเตอร์</h2>
          <p className="panel-subtext">สรุปสัญญาณผิดปกติแบบเรียลไทม์</p>
        </div>
      </div>

      <div className="summary-grid">
        <article className="metric-card">
          <div className="metric-label">สถานะ SSE</div>
          <div className="metric-value">{sseStatus}</div>
          <div className="metric-label">เหตุการณ์ล่าสุด: {lastEventTs ? new Date(lastEventTs).toLocaleTimeString() : '-'}</div>
        </article>
        <article className="metric-card">
          <div className="metric-label">ข้อผิดพลาด / นาที</div>
          <div className="metric-value neg">{stats.errorRateNow}</div>
          <Sparkline values={stats.errorsPerMinute} colorVar="--danger" />
        </article>
        <article className="metric-card">
          <div className="metric-label">Reject ความเสี่ยง / นาที</div>
          <div className="metric-value">{stats.rejectRateNow}</div>
          <Sparkline values={stats.rejectsPerMinute} colorVar="--warning" />
        </article>
        <article className="metric-card">
          <div className="metric-label">จำนวนชน Rate Limit</div>
          <div className="metric-value">{stats.rateLimitHits}</div>
          <div className="metric-label">สะสมจากเหตุการณ์ทั้งหมด</div>
        </article>
      </div>

      <div className="monitor-grid">
        <article className="panel panel-nested">
          <h3>คิลสวิตช์</h3>
          {stats.latestKillSwitch ? (
            <div>
              <p>
                ล่าสุด: {new Date(stats.latestKillSwitch.ts).toLocaleString()}
              </p>
              <p className="muted-text">{stats.latestKillSwitch.message}</p>
            </div>
          ) : (
            <p className="muted-text">ยังไม่พบเหตุการณ์คิลสวิตช์</p>
          )}
        </article>

        <article className="panel panel-nested">
          <h3>เหตุผล Reject สูงสุด (10 นาที)</h3>
          {stats.topReasons.length === 0 ? (
            <p className="muted-text">ยังไม่มีข้อมูลการปฏิเสธในช่วง 10 นาที</p>
          ) : (
            <ul className="simple-list">
              {stats.topReasons.map(([reason, count]) => (
                <li key={reason}>
                  <span>{reason}</span>
                  <strong>{count}</strong>
                </li>
              ))}
            </ul>
          )}
        </article>

        <article className="panel panel-nested">
          <h3>กฎแจ้งเตือน</h3>
          <div className="rule-grid">
            <label className="field">
              <span>เกณฑ์ ERROR ต่อเนื่อง</span>
              <input
                type="number"
                min={1}
                value={rules.errorStreakThreshold}
                onChange={(event) => onRulesChange({ errorStreakThreshold: Number(event.target.value) || 1 })}
              />
            </label>
            <label className="field">
              <span>ช่วงเวลา ERROR (วินาที)</span>
              <input
                type="number"
                min={30}
                value={rules.errorWindowSec}
                onChange={(event) => onRulesChange({ errorWindowSec: Number(event.target.value) || 120 })}
              />
            </label>
            <label className="field">
              <span>เกณฑ์ Reject</span>
              <input
                type="number"
                min={1}
                value={rules.rejectThreshold}
                onChange={(event) => onRulesChange({ rejectThreshold: Number(event.target.value) || 8 })}
              />
            </label>
            <label className="field">
              <span>ช่วงเวลา Reject (วินาที)</span>
              <input
                type="number"
                min={30}
                value={rules.rejectWindowSec}
                onChange={(event) => onRulesChange({ rejectWindowSec: Number(event.target.value) || 120 })}
              />
            </label>
            <label className="field">
              <span>SSE หลุดเกิน (วินาที)</span>
              <input
                type="number"
                min={10}
                value={rules.sseDisconnectSec}
                onChange={(event) => onRulesChange({ sseDisconnectSec: Number(event.target.value) || 30 })}
              />
            </label>
          </div>
        </article>
      </div>

      <article className="panel panel-nested">
        <div className="panel-head">
          <div>
            <h3>การแจ้งเตือน</h3>
            <p className="panel-subtext">เก็บประวัติสูงสุด 50 รายการ</p>
          </div>
          <div className="toolbar-row">
            <button className="btn btn-ghost" onClick={onExportAlerts}>ส่งออก JSON</button>
            <button className="btn btn-ghost" onClick={onClearAlerts}>ล้างทั้งหมด</button>
          </div>
        </div>

        {alerts.length === 0 ? (
          <p className="muted-text">ยังไม่มีการแจ้งเตือน</p>
        ) : (
          <ul className="alerts-list">
            {alerts.map((alert) => (
              <li key={alert.id} className={`alert-item ${alert.severity}`}>
                <div>
                  <strong>{alert.severity === 'critical' ? 'วิกฤต' : 'เตือน'}</strong>
                  <p>{alert.message}</p>
                  <small>{new Date(alert.ts).toLocaleString()}</small>
                </div>
                <button className="btn btn-ghost" onClick={() => onAcknowledge(alert.id)}>
                  {alert.acknowledged ? 'รับทราบแล้ว' : 'รับทราบ'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </article>
    </section>
  );
}
