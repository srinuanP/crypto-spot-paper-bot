import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  fetchHealth,
  fetchLatestJournal,
  fetchLatestReport,
  fetchPaperRead,
  fetchPaperTail,
  fetchRuntimeStatus
} from '../api/client';
import { createPaperSseClient, type PaperStreamPayload, type SseStatus } from '../api/sse';
import { extractEventsFromRow, extractEventsFromSsePayload } from '../observability/extractors';
import { ReplayEngine } from '../replay/engine';
import {
  buildTrades,
  defaultFilters,
  filterAndSortTrades,
  useDashboardStore
} from '../state/store';
import type { DashboardEvent, EventType, MonitoringAlert } from '../types/events';
import { DrawdownChart } from '../components/DrawdownChart';
import { EmptyState } from '../components/EmptyState';
import { EquityChart } from '../components/EquityChart';
import { LiveLogDrawer } from '../components/LiveLogDrawer';
import { MonitoringPanel, type MonitoringRules } from '../components/MonitoringPanel';
import { ReplayPanel, type ReplaySnapshot } from '../components/ReplayPanel';
import { SetupWizard } from '../components/SetupWizard';
import { SummaryCards } from '../components/SummaryCards';
import { TopBar } from '../components/TopBar';
import { Toasts } from '../components/Toasts';
import { TradesTable } from '../components/TradesTable';

const PREF_THEME_KEY = 'dashboard.theme';
const PREF_AUTO_REFRESH_KEY = 'dashboard.autoRefresh';
const PREF_WIZARD_KEY = 'dashboard.wizardDismissed';

const MAX_EVENTS_IN_MEMORY = 10_000;
const MAX_ALERTS = 50;
const REPLAY_DEFAULT_MAX_LINES = 5000;

const replayTypeDefaults: EventType[] = [
  'LOG_LINE',
  'TRADE',
  'ORDER_INTENT',
  'RISK_REJECT',
  'ERROR',
  'HEALTH',
  'KILL_SWITCH',
  'RATE_LIMIT'
];

type DashboardTab = 'dashboard' | 'monitoring' | 'replay';

type UpdatedMap = {
  report: number | null;
  paper: number | null;
  journal: number | null;
  health: number | null;
};

type AlertFlags = {
  errorStreakActive: boolean;
  rejectSpikeActive: boolean;
  sseDisconnectedActive: boolean;
  lastKillSwitchTs: number;
};

function resolveTheme(): 'light' | 'dark' {
  const fromStorage = localStorage.getItem(PREF_THEME_KEY);
  if (fromStorage === 'light' || fromStorage === 'dark') return fromStorage;
  if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) return 'dark';
  return 'light';
}

function computeDrawdown(curve: number[]): number[] {
  if (!Array.isArray(curve) || curve.length === 0) return [];
  let peak = Number(curve[0]) || 0;
  return curve.map((value) => {
    const current = Number(value) || 0;
    if (current > peak) peak = current;
    if (peak <= 0) return 0;
    return (current - peak) / peak;
  });
}

function eventTimeRangeFromPreset(preset: '1h' | '6h' | '24h' | 'custom'): { from?: number; to?: number } {
  const now = Date.now();
  if (preset === '1h') return { from: now - 60 * 60 * 1000, to: now };
  if (preset === '6h') return { from: now - 6 * 60 * 60 * 1000, to: now };
  if (preset === '24h') return { from: now - 24 * 60 * 60 * 1000, to: now };
  return {};
}

function formatNumberOrNA(value: unknown, digits = 4): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return 'ไม่มีข้อมูล';
  return n.toFixed(digits);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function buildReplaySnapshot(events: DashboardEvent[]): ReplaySnapshot {
  let position = 'ไม่มีข้อมูล';
  let cash = 'ไม่มีข้อมูล';
  let equity = 'ไม่มีข้อมูล';
  let lastTrade = 'ไม่มีข้อมูล';
  let lastReject = 'ไม่มีข้อมูล';

  for (const event of events) {
    const meta = asRecord(event.meta);
    if (event.type === 'TRADE') {
      lastTrade = `${event.message} (${new Date(event.ts).toLocaleTimeString()})`;
      const trade = asRecord(meta?.trade);
      const qty = Number(meta?.qty ?? trade?.qty);
      if (Number.isFinite(qty)) {
        position = `จำนวน ${qty.toFixed(6)}`;
      }
    }
    if (event.type === 'RISK_REJECT') {
      lastReject = event.message;
    }

    const nextCash = Number(meta?.cash);
    if (Number.isFinite(nextCash)) cash = nextCash.toFixed(4);
    const nextEquity = Number(meta?.equity);
    if (Number.isFinite(nextEquity)) equity = nextEquity.toFixed(4);
  }

  return { position, cash, equity, lastTrade, lastReject };
}

function downloadJson(filename: string, payload: unknown): void {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export default function App() {
  const [state, dispatch] = useDashboardStore();
  const [activeTab, setActiveTab] = useState<DashboardTab>('dashboard');
  const [logDrawerOpen, setLogDrawerOpen] = useState(false);
  const [updated, setUpdated] = useState<UpdatedMap>({ report: null, paper: null, journal: null, health: null });
  const [events, setEvents] = useState<DashboardEvent[]>([]);
  const [alerts, setAlerts] = useState<MonitoringAlert[]>([]);
  const [rules, setRules] = useState<MonitoringRules>({
    errorStreakThreshold: 5,
    errorWindowSec: 120,
    rejectThreshold: 8,
    rejectWindowSec: 120,
    sseDisconnectSec: 30
  });
  const [lastEventTs, setLastEventTs] = useState<number | null>(null);
  const [disconnectedSince, setDisconnectedSince] = useState<number | null>(null);

  const [replayPreset, setReplayPreset] = useState<'1h' | '6h' | '24h' | 'custom'>('1h');
  const [replayFromInput, setReplayFromInput] = useState('');
  const [replayToInput, setReplayToInput] = useState('');
  const [replayMaxLines, setReplayMaxLines] = useState(REPLAY_DEFAULT_MAX_LINES);
  const [replayLoading, setReplayLoading] = useState(false);
  const [replayError, setReplayError] = useState<string | null>(null);
  const [replayEvents, setReplayEvents] = useState<DashboardEvent[]>([]);
  const [replayVisibleEvents, setReplayVisibleEvents] = useState<DashboardEvent[]>([]);
  const [replayFilterTypes, setReplayFilterTypes] = useState<EventType[]>(replayTypeDefaults);
  const [replaySearch, setReplaySearch] = useState('');
  const [replayIsPlaying, setReplayIsPlaying] = useState(false);
  const [replaySpeed, setReplaySpeed] = useState(1);
  const [replayIndex, setReplayIndex] = useState(0);
  const [replayCurrentTime, setReplayCurrentTime] = useState(0);

  const toastSeqRef = useRef(1);
  const searchDebounceRef = useRef<number | null>(null);
  const sseStatusRef = useRef<SseStatus>('connecting');
  const alertFlagsRef = useRef<AlertFlags>({
    errorStreakActive: false,
    rejectSpikeActive: false,
    sseDisconnectedActive: false,
    lastKillSwitchTs: 0
  });
  const sseQueueRef = useRef<PaperStreamPayload[]>([]);
  const sseRafRef = useRef<number | null>(null);
  const replayEngineRef = useRef(new ReplayEngine([]));

  const addToast = useCallback(
    (message: string, tone: 'success' | 'warning' | 'danger' | 'neutral') => {
      const id = toastSeqRef.current;
      toastSeqRef.current += 1;
      dispatch({ type: 'addToast', toast: { id, tone, message } });
      window.setTimeout(() => {
        dispatch({ type: 'removeToast', id });
      }, 2800);
    },
    [dispatch]
  );

  const pushAlert = useCallback(
    (ruleId: string, severity: 'warning' | 'critical', message: string, meta?: Record<string, unknown>) => {
      const alert: MonitoringAlert = {
        id: `${Date.now()}-${ruleId}-${Math.random().toString(16).slice(2, 8)}`,
        ts: Date.now(),
        severity,
        ruleId,
        message,
        acknowledged: false,
        meta
      };
      setAlerts((prev) => [...prev, alert].slice(-MAX_ALERTS));
      addToast(message, severity === 'critical' ? 'danger' : 'warning');
    },
    [addToast]
  );

  const markUpdated = useCallback((key: keyof UpdatedMap) => {
    setUpdated((prev) => ({ ...prev, [key]: Date.now() }));
  }, []);

  const ingestEvents = useCallback((incoming: DashboardEvent[], mode: 'append' | 'replace' = 'append') => {
    if (incoming.length === 0) return;
    setLastEventTs(incoming[incoming.length - 1].ts);
    setEvents((prev) => {
      if (mode === 'replace') {
        return incoming.slice(-MAX_EVENTS_IN_MEMORY);
      }
      return [...prev, ...incoming].slice(-MAX_EVENTS_IN_MEMORY);
    });
  }, []);

  const loadRuntime = useCallback(async () => {
    const res = await fetchRuntimeStatus();
    dispatch({ type: 'setRuntimeStatus', data: res.ok ? (res.data ?? null) : null });
  }, [dispatch]);

  const loadHealth = useCallback(async () => {
    const res = await fetchHealth();
    dispatch({ type: 'setHealth', ok: res.ok, ts: res.ok ? res.data?.ts ?? null : null });
    if (res.ok) {
      markUpdated('health');
      ingestEvents([{
        id: `${Date.now()}-HEALTH-dashboard`,
        type: 'HEALTH',
        ts: Date.now(),
        level: 'info',
        source: 'dashboard',
        message: 'ระบบพร้อมใช้งาน',
        meta: { healthTs: res.data?.ts }
      }]);
    }
  }, [dispatch, ingestEvents, markUpdated]);

  const loadReport = useCallback(async () => {
    dispatch({ type: 'setReportLoading', loading: true });
    const res = await fetchLatestReport();
    if (!res.ok) {
      dispatch({ type: 'setReport', data: null, message: res.message ?? 'ไม่พบ report' });
      return;
    }
    dispatch({ type: 'setReport', data: res.data ?? null, message: res.message ?? null });
    markUpdated('report');
  }, [dispatch, markUpdated]);

  const loadPaperTailData = useCallback(async () => {
    const res = await fetchPaperTail(500);
    if (!res.ok) {
      dispatch({ type: 'setPaperTail', items: [], message: res.message ?? 'ไม่สามารถอ่าน paper log ได้' });
      return;
    }
    const items = res.data?.items ?? [];
    dispatch({ type: 'setPaperTail', items, message: res.data?.message ?? null });
    markUpdated('paper');

    const extracted = items.flatMap((row) => extractEventsFromRow(row, { source: 'paper' }));
    ingestEvents(extracted, 'replace');
  }, [dispatch, ingestEvents, markUpdated]);

  const loadJournal = useCallback(async () => {
    const res = await fetchLatestJournal();
    if (!res.ok) {
      dispatch({ type: 'setJournal', data: null, message: res.message ?? 'ไม่พบ journal ล่าสุด' });
      return;
    }
    dispatch({ type: 'setJournal', data: res.data ?? null, message: null });
    markUpdated('journal');
  }, [dispatch, markUpdated]);

  const refreshAll = useCallback(
    async (includePaper: boolean, emitToast: boolean) => {
      await loadRuntime();
      await loadHealth();
      await loadReport();
      await loadJournal();
      if (includePaper) {
        await loadPaperTailData();
      }
      if (emitToast) {
        addToast('รีเฟรชแดชบอร์ดแล้ว', 'success');
      }
    },
    [addToast, loadHealth, loadJournal, loadPaperTailData, loadReport, loadRuntime]
  );

  useEffect(() => {
    dispatch({ type: 'setTheme', theme: resolveTheme() });
    const autoRefresh = localStorage.getItem(PREF_AUTO_REFRESH_KEY);
    dispatch({ type: 'setAutoRefresh', enabled: autoRefresh === null ? true : autoRefresh === 'true' });
    dispatch({ type: 'dismissWizard', dismissed: localStorage.getItem(PREF_WIZARD_KEY) === 'true' });

    const presetRange = eventTimeRangeFromPreset('1h');
    setReplayFromInput(String(presetRange.from ?? ''));
    setReplayToInput(String(presetRange.to ?? ''));

    void refreshAll(true, false);
  }, [dispatch, refreshAll]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', state.theme);
    localStorage.setItem(PREF_THEME_KEY, state.theme);
  }, [state.theme]);

  useEffect(() => {
    localStorage.setItem(PREF_AUTO_REFRESH_KEY, state.autoRefresh ? 'true' : 'false');
    if (!state.autoRefresh) return;

    const timer = window.setInterval(() => {
      void refreshAll(false, false);
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [refreshAll, state.autoRefresh]);

  useEffect(() => {
    const flushSseQueue = () => {
      const queue = sseQueueRef.current.splice(0, sseQueueRef.current.length);
      sseRafRef.current = null;
      if (queue.length === 0) return;

      dispatch({ type: 'appendPaperLogsBatch', payloads: queue });
      const extracted = queue.flatMap((payload) => extractEventsFromSsePayload(payload, { source: 'paper' }));
      ingestEvents(extracted, 'append');
      markUpdated('paper');
    };

    const scheduleFlush = () => {
      if (sseRafRef.current !== null) return;
      sseRafRef.current = window.requestAnimationFrame(flushSseQueue);
    };

    const sse = createPaperSseClient('/api/paper/stream', {
      onStatus: (status) => {
        dispatch({ type: 'setSseStatus', status });
        if (status === 'connected') {
          setDisconnectedSince(null);
        } else if (status === 'reconnecting' || status === 'disconnected') {
          setDisconnectedSince((prev) => prev ?? Date.now());
        }
        if (sseStatusRef.current !== status) {
          if (status === 'connected') addToast('เชื่อมต่อสตรีม Paper แล้ว', 'success');
          else if (status === 'reconnecting') addToast('กำลังเชื่อมต่อสตรีม Paper ใหม่...', 'warning');
          else if (status === 'disconnected') addToast('สตรีม Paper ถูกตัดการเชื่อมต่อ', 'danger');
          sseStatusRef.current = status;
        }
      },
      onPaperLog: (payload) => {
        sseQueueRef.current.push(payload);
        scheduleFlush();
      },
      onError: (message) => {
        if (message) addToast(message, 'warning');
      }
    });

    sse.start();
    return () => {
      if (sseRafRef.current !== null) {
        window.cancelAnimationFrame(sseRafRef.current);
        sseRafRef.current = null;
      }
      sse.stop();
    };
  }, [addToast, dispatch, ingestEvents, markUpdated]);

  useEffect(() => {
    const evaluateAlerts = () => {
      const now = Date.now();
      const flags = alertFlagsRef.current;

      const errorCount = events.filter((event) => event.type === 'ERROR' && now - event.ts <= rules.errorWindowSec * 1000).length;
      if (errorCount >= rules.errorStreakThreshold && !flags.errorStreakActive) {
        flags.errorStreakActive = true;
        pushAlert('error_streak', 'critical', `พบ ERROR ต่อเนื่อง >= ${rules.errorStreakThreshold} ใน ${rules.errorWindowSec} วินาที`, { errorCount });
      }
      if (errorCount < rules.errorStreakThreshold) {
        flags.errorStreakActive = false;
      }

      const rejectCount = events.filter((event) => event.type === 'RISK_REJECT' && now - event.ts <= rules.rejectWindowSec * 1000).length;
      if (rejectCount >= rules.rejectThreshold && !flags.rejectSpikeActive) {
        flags.rejectSpikeActive = true;
        pushAlert('reject_spike', 'warning', `RISK_REJECT สูงผิดปกติ (${rejectCount} เหตุการณ์/${rules.rejectWindowSec} วินาที)`, { rejectCount });
      }
      if (rejectCount < rules.rejectThreshold) {
        flags.rejectSpikeActive = false;
      }

      if (state.sseStatus !== 'connected' && disconnectedSince !== null) {
        const disconnectedSec = (now - disconnectedSince) / 1000;
        if (disconnectedSec >= rules.sseDisconnectSec && !flags.sseDisconnectedActive) {
          flags.sseDisconnectedActive = true;
          pushAlert('sse_disconnected', 'warning', `SSE ตัดการเชื่อมต่อเกิน ${rules.sseDisconnectSec} วินาที`, { disconnectedSec: Math.floor(disconnectedSec) });
        }
      } else {
        flags.sseDisconnectedActive = false;
      }

      const killSwitchEvent = [...events].reverse().find((event) => event.type === 'KILL_SWITCH');
      if (killSwitchEvent && killSwitchEvent.ts > flags.lastKillSwitchTs) {
        flags.lastKillSwitchTs = killSwitchEvent.ts;
        pushAlert('kill_switch', 'critical', `คิลสวิตช์ทำงาน: ${killSwitchEvent.message}`, {
          eventTs: killSwitchEvent.ts
        });
      }
    };

    evaluateAlerts();
    const timer = window.setInterval(evaluateAlerts, 1000);
    return () => window.clearInterval(timer);
  }, [disconnectedSince, events, pushAlert, rules, state.sseStatus]);

  const trades = useMemo(() => buildTrades(state.paperRows, state.report), [state.paperRows, state.report]);
  const filteredTrades = useMemo(() => filterAndSortTrades(trades, state.filters), [trades, state.filters]);

  const equitySeries = useMemo(
    () => (Array.isArray(state.report?.equityCurve) ? state.report.equityCurve.map((value) => Number(value) || 0) : []),
    [state.report?.equityCurve]
  );
  const drawdownSeries = useMemo(() => computeDrawdown(equitySeries), [equitySeries]);

  const lastUpdatedText = useMemo(() => {
    const parts: string[] = [];
    if (updated.report) parts.push(`รายงาน ${new Date(updated.report).toLocaleTimeString()}`);
    if (updated.paper) parts.push(`paper ${new Date(updated.paper).toLocaleTimeString()}`);
    if (updated.journal) parts.push(`สมุดบันทึก ${new Date(updated.journal).toLocaleTimeString()}`);
    if (updated.health) parts.push(`สุขภาพระบบ ${new Date(updated.health).toLocaleTimeString()}`);
    return parts.join(' | ') || '-';
  }, [updated.health, updated.journal, updated.paper, updated.report]);

  const hasReport = Boolean(state.report?.metrics);
  const hasPaperLog = state.paperRows.length > 0;

  const onCopyCommand = useCallback(async (command: string) => {
    try {
      await navigator.clipboard.writeText(command);
      addToast('คัดลอกคำสั่งแล้ว', 'success');
    } catch {
      addToast('ไม่สามารถใช้คลิปบอร์ดได้', 'warning');
    }
  }, [addToast]);

  const onFilterChange = useCallback(
    (filters: Partial<typeof defaultFilters>) => {
      if (Object.prototype.hasOwnProperty.call(filters, 'search')) {
        if (searchDebounceRef.current !== null) {
          window.clearTimeout(searchDebounceRef.current);
        }
        searchDebounceRef.current = window.setTimeout(() => {
          dispatch({ type: 'setFilters', filters });
        }, 180);
        return;
      }
      dispatch({ type: 'setFilters', filters });
    },
    [dispatch]
  );

  const logStatusText = useMemo(() => {
    if (state.logPaused) return 'Paper: พักการแสดงผล';
    if (state.sseStatus === 'connected') return 'Paper: กำลังสตรีม';
    if (state.sseStatus === 'reconnecting') return 'Paper: กำลังเชื่อมต่อใหม่';
    if (state.sseStatus === 'disconnected') return 'Paper: ตัดการเชื่อมต่อ';
    return 'Paper: กำลังเชื่อมต่อ';
  }, [state.logPaused, state.sseStatus]);

  const quickActions = [
    'npm run backtest -- --symbol BTCUSDT --interval 15m --limit 500 --strategy smaCross',
    'npm run paper -- --symbol BTCUSDT --interval 1m --strategy smaCross --pollMs 5000',
    'npm run journal -- --input paper-log.jsonl'
  ];

  const onLogPauseToggle = useCallback(() => {
    if (state.logPaused) {
      dispatch({ type: 'setLogPaused', paused: false });
      dispatch({ type: 'flushQueuedEvents' });
      return;
    }
    dispatch({ type: 'setLogPaused', paused: true });
  }, [dispatch, state.logPaused]);

  const onDismissWizard = useCallback(() => {
    dispatch({ type: 'dismissWizard', dismissed: true });
    localStorage.setItem(PREF_WIZARD_KEY, 'true');
  }, [dispatch]);

  const onThemeToggle = useCallback(() => {
    dispatch({ type: 'setTheme', theme: state.theme === 'dark' ? 'light' : 'dark' });
  }, [dispatch, state.theme]);

  const onLoadReplay = useCallback(async () => {
    setReplayLoading(true);
    setReplayError(null);
    try {
      let from = Number(replayFromInput);
      let to = Number(replayToInput);
      if (replayPreset !== 'custom') {
        const range = eventTimeRangeFromPreset(replayPreset);
        from = range.from ?? Number.NaN;
        to = range.to ?? Number.NaN;
        setReplayFromInput(Number.isFinite(from) ? String(Math.floor(from)) : '');
        setReplayToInput(Number.isFinite(to) ? String(Math.floor(to)) : '');
      }

      const res = await fetchPaperRead({
        from: Number.isFinite(from) ? Math.floor(from) : undefined,
        to: Number.isFinite(to) ? Math.floor(to) : undefined,
        maxLines: replayMaxLines
      });

      if (!res.ok || !res.data) {
        setReplayError(res.message ?? 'โหลดรีเพลย์ไม่สำเร็จ');
        return;
      }

      const extracted = res.data.items.flatMap((row) => extractEventsFromRow(row, { source: 'paper' }));
      setReplayEvents(extracted);
      replayEngineRef.current.setEvents(extracted);
      setReplayVisibleEvents([]);
      setReplayIsPlaying(false);
      setReplayIndex(0);
      setReplayCurrentTime(extracted[0]?.ts ?? 0);
      setReplayFilterTypes(replayTypeDefaults);
      setReplaySearch('');
      addToast(`โหลดเหตุการณ์รีเพลย์ ${extracted.length} รายการ`, 'success');
    } finally {
      setReplayLoading(false);
    }
  }, [addToast, replayFromInput, replayMaxLines, replayPreset, replayToInput]);

  useEffect(() => {
    replayEngineRef.current.setSpeed(replaySpeed);
  }, [replaySpeed]);

  useEffect(() => {
    replayEngineRef.current.pause();
    setReplayIsPlaying(false);
    setReplayVisibleEvents([]);
    setReplayIndex(0);
    setReplayCurrentTime(replayEvents[0]?.ts ?? 0);
  }, [replayEvents]);

  useEffect(() => {
    if (!replayIsPlaying) return;
    replayEngineRef.current.play();
    const timer = window.setInterval(() => {
      const emitted = replayEngineRef.current.tick(200);
      if (emitted.length > 0) {
        setReplayVisibleEvents((prev) => [...prev, ...emitted]);
      }
      const replayState = replayEngineRef.current.getState();
      setReplayIndex(replayState.currentIndex);
      setReplayCurrentTime(replayState.currentTime);
      if (replayState.currentIndex >= replayState.total) {
        replayEngineRef.current.pause();
        setReplayIsPlaying(false);
      }
    }, 200);
    return () => window.clearInterval(timer);
  }, [replayIsPlaying]);

  const replayFilteredVisible = useMemo(() => {
    const search = replaySearch.trim().toLowerCase();
    return replayVisibleEvents.filter((event) => {
      if (!replayFilterTypes.includes(event.type)) return false;
      if (!search) return true;
      const text = `${event.message} ${JSON.stringify(event.meta ?? {})}`.toLowerCase();
      return text.includes(search);
    });
  }, [replayFilterTypes, replaySearch, replayVisibleEvents]);

  const replaySnapshot = useMemo(() => buildReplaySnapshot(replayVisibleEvents), [replayVisibleEvents]);

  const onReplaySeek = useCallback((index: number) => {
    replayEngineRef.current.jumpToIndex(index);
    const replayState = replayEngineRef.current.getState();
    setReplayIndex(replayState.currentIndex);
    setReplayCurrentTime(replayState.currentTime);
    setReplayVisibleEvents(replayEvents.slice(0, replayState.currentIndex));
  }, [replayEvents]);

  return (
    <div className="app-shell">
      <TopBar
        runtimeStatus={state.runtimeStatus}
        sseStatus={state.sseStatus}
        healthOk={state.healthOk}
        theme={state.theme}
        autoRefresh={state.autoRefresh}
        onToggleTheme={onThemeToggle}
        onSetAutoRefresh={(enabled) => dispatch({ type: 'setAutoRefresh', enabled })}
        onRefresh={() => {
          void refreshAll(true, true);
        }}
        onOpenLogs={() => setLogDrawerOpen(true)}
      />

      <div className="tabs">
        <button className={`tab-btn ${activeTab === 'dashboard' ? 'active' : ''}`} onClick={() => setActiveTab('dashboard')}>
          แดชบอร์ด
        </button>
        <button className={`tab-btn ${activeTab === 'monitoring' ? 'active' : ''}`} onClick={() => setActiveTab('monitoring')}>
          มอนิเตอร์
        </button>
        <button className={`tab-btn ${activeTab === 'replay' ? 'active' : ''}`} onClick={() => setActiveTab('replay')}>
          รีเพลย์
        </button>
      </div>

      <SetupWizard
        open={!state.wizardDismissed && (!state.healthOk || !hasReport || !hasPaperLog)}
        healthOk={state.healthOk}
        hasReport={hasReport}
        hasPaperLog={hasPaperLog}
        onCopy={onCopyCommand}
        onClose={onDismissWizard}
      />

      {activeTab === 'dashboard' ? (
        <>
          <section className="panel quick-actions-panel">
            <div className="panel-head">
              <div>
                <h2>คำสั่งด่วน</h2>
                <p className="panel-subtext">คัดลอกคำสั่งที่ใช้บ่อยได้ทันที</p>
              </div>
            </div>
            <div className="quick-actions-grid">
              {quickActions.map((command) => (
                <button key={command} className="quick-action" onClick={() => onCopyCommand(command)}>
                  {command}
                </button>
              ))}
            </div>
          </section>

          <main className="content-grid">
            <section className="panel summary-panel">
              <div className="panel-head">
                <div>
                  <h2>สรุปผลการเทรด</h2>
                  <p className="panel-subtext">ข้อมูลจาก reports/latest.json</p>
                </div>
                <span className={`badge ${hasReport ? 'badge-success' : 'badge-warning'}`}>
                  รายงาน: {hasReport ? 'พร้อมใช้งาน' : 'ไม่พบ'}
                </span>
              </div>
              <SummaryCards
                loading={state.reportLoading}
                report={state.report}
                reportMessage={state.reportMessage}
                lastUpdatedText={lastUpdatedText}
              />
            </section>

            <section className="panel charts-panel">
              <div className="panel-head">
                <div>
                  <h2>มูลค่าพอร์ตและดรอดาวน์</h2>
                  <p className="panel-subtext">กราฟตอบสนองทุกหน้าจอ พร้อม tooltip</p>
                </div>
              </div>
              <div className="chart-grid">
                <EquityChart values={equitySeries} />
                <DrawdownChart values={drawdownSeries} />
              </div>
            </section>

            <section className="panel journal-panel">
              <div className="panel-head">
                <div>
                  <h2>สมุดบันทึกรายวัน</h2>
                  <p className="panel-subtext">ข้อมูลจาก journal/latest.json หรือ journal/latest.md</p>
                </div>
                <span className={`badge ${state.journal ? 'badge-success' : 'badge-warning'}`}>
                  สมุดบันทึก: {state.journal ? state.journal.format : 'ไม่พบ'}
                </span>
              </div>
              {state.journal ? (
                <pre className="journal-view">
                  {state.journal.format === 'markdown' ? state.journal.data : JSON.stringify(state.journal.data, null, 2)}
                </pre>
              ) : (
                <EmptyState
                  title="ยังไม่พบ Journal ล่าสุด"
                  message={state.journalMessage ?? 'ให้รันคำสั่ง journal เพื่อสร้างไฟล์ล่าสุด'}
                  command="npm run journal -- --input paper-log.jsonl"
                />
              )}
            </section>

            <TradesTable
              allRows={trades}
              rows={filteredTrades}
              filters={state.filters}
              page={state.page}
              pageSize={state.pageSize}
              onFilterChange={onFilterChange}
              onResetFilters={() => dispatch({ type: 'resetFilters' })}
              onPageChange={(page) => dispatch({ type: 'setPage', page })}
              onPageSizeChange={(pageSize) => dispatch({ type: 'setPageSize', pageSize })}
            />
          </main>
        </>
      ) : null}

      {activeTab === 'monitoring' ? (
        <MonitoringPanel
          events={events}
          alerts={alerts}
          sseStatus={state.sseStatus}
          lastEventTs={lastEventTs}
          rules={rules}
          onRulesChange={(patch) => setRules((prev) => ({ ...prev, ...patch }))}
          onAcknowledge={(id) => setAlerts((prev) => prev.map((alert) => (alert.id === id ? { ...alert, acknowledged: true } : alert)))}
          onClearAlerts={() => setAlerts([])}
          onExportAlerts={() => downloadJson(`alerts-${Date.now()}.json`, alerts)}
        />
      ) : null}

      {activeTab === 'replay' ? (
        <ReplayPanel
          loading={replayLoading}
          loadError={replayError}
          fromInput={replayFromInput}
          toInput={replayToInput}
          maxLines={replayMaxLines}
          selectedPreset={replayPreset}
          events={replayEvents}
          visibleEvents={replayFilteredVisible}
          filterTypes={replayFilterTypes}
          search={replaySearch}
          playback={{
            isPlaying: replayIsPlaying,
            speed: replaySpeed,
            currentIndex: replayIndex,
            total: replayEvents.length,
            currentTime: replayCurrentTime
          }}
          snapshot={replaySnapshot}
          onPresetChange={(preset) => {
            setReplayPreset(preset);
            if (preset !== 'custom') {
              const range = eventTimeRangeFromPreset(preset);
              setReplayFromInput(String(range.from ?? ''));
              setReplayToInput(String(range.to ?? ''));
            }
          }}
          onFromInputChange={setReplayFromInput}
          onToInputChange={setReplayToInput}
          onMaxLinesChange={(value) => setReplayMaxLines(Math.max(100, Math.min(20_000, value)))}
          onLoad={() => {
            void onLoadReplay();
          }}
          onTogglePlay={() => {
            if (replayIsPlaying) {
              replayEngineRef.current.pause();
              setReplayIsPlaying(false);
              return;
            }
            replayEngineRef.current.play();
            setReplayIsPlaying(true);
          }}
          onStepForward={() => {
            replayEngineRef.current.pause();
            setReplayIsPlaying(false);
            replayEngineRef.current.stepForward();
            const replayState = replayEngineRef.current.getState();
            setReplayIndex(replayState.currentIndex);
            setReplayCurrentTime(replayState.currentTime);
            setReplayVisibleEvents(replayEvents.slice(0, replayState.currentIndex));
          }}
          onStepBackward={() => {
            replayEngineRef.current.pause();
            setReplayIsPlaying(false);
            replayEngineRef.current.stepBackward();
            const replayState = replayEngineRef.current.getState();
            setReplayIndex(replayState.currentIndex);
            setReplayCurrentTime(replayState.currentTime);
            setReplayVisibleEvents(replayEvents.slice(0, replayState.currentIndex));
          }}
          onSpeedChange={(speed) => {
            setReplaySpeed(speed);
            replayEngineRef.current.setSpeed(speed);
          }}
          onSeek={onReplaySeek}
          onFilterTypesChange={(types) => setReplayFilterTypes(types)}
          onSearchChange={setReplaySearch}
        />
      ) : null}

      <footer className="footer">
        <p>อัปเดตล่าสุด: {lastUpdatedText}</p>
      </footer>

      <LiveLogDrawer
        open={logDrawerOpen}
        statusText={logStatusText}
        message={state.paperMessage ?? state.reportMessage ?? null}
        logLines={state.logLines}
        paused={state.logPaused}
        onPauseToggle={onLogPauseToggle}
        onClear={() => dispatch({ type: 'clearLogs' })}
        onClose={() => setLogDrawerOpen(false)}
      />

      <Toasts toasts={state.toasts} onDismiss={(id) => dispatch({ type: 'removeToast', id })} />
    </div>
  );
}
