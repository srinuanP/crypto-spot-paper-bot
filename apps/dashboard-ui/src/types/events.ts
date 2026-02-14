export type EventType =
  | 'LOG_LINE'
  | 'TRADE'
  | 'ORDER_INTENT'
  | 'RISK_REJECT'
  | 'ERROR'
  | 'HEALTH'
  | 'KILL_SWITCH'
  | 'RATE_LIMIT';

export type EventLevel = 'info' | 'warn' | 'error';

export type EventSource = 'paper' | 'backtest' | 'testnet' | 'dashboard';

export type DashboardEvent = {
  id: string;
  type: EventType;
  ts: number;
  level: EventLevel;
  source: EventSource;
  message: string;
  meta?: Record<string, unknown>;
};

export type AlertSeverity = 'warning' | 'critical';

export type MonitoringAlert = {
  id: string;
  ts: number;
  severity: AlertSeverity;
  ruleId: string;
  message: string;
  acknowledged: boolean;
  meta?: Record<string, unknown>;
};
