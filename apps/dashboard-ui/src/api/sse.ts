export type SseStatus = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

export type PaperStreamPayload = {
  line?: string;
  row?: Record<string, unknown> | null;
};

export type PaperSseHandlers = {
  onStatus: (status: SseStatus) => void;
  onPaperLog: (payload: PaperStreamPayload) => void;
  onError?: (message: string) => void;
};

function parseData(raw: string): PaperStreamPayload | null {
  try {
    const data = JSON.parse(raw) as PaperStreamPayload;
    return {
      line: typeof data.line === 'string' ? data.line : undefined,
      row: data.row && typeof data.row === 'object' ? data.row : null
    };
  } catch {
    return {
      line: raw,
      row: null
    };
  }
}

export function createPaperSseClient(url: string, handlers: PaperSseHandlers): {
  start: () => void;
  stop: () => void;
} {
  let source: EventSource | null = null;
  let reconnectTimer: number | null = null;
  let attempts = 0;
  let stopped = false;

  const clearTimer = () => {
    if (reconnectTimer !== null) {
      window.clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  const closeSource = () => {
    if (source) {
      source.close();
      source = null;
    }
  };

  const scheduleReconnect = () => {
    if (stopped) return;
    clearTimer();
    attempts += 1;
    const base = Math.min(30_000, 1_000 * 2 ** Math.min(8, attempts));
    const jitter = Math.floor(Math.random() * 400);
    const waitMs = base + jitter;
    handlers.onStatus('reconnecting');
    reconnectTimer = window.setTimeout(() => {
      connect();
    }, waitMs);
  };

  const connect = () => {
    if (stopped) return;
    closeSource();
    handlers.onStatus(attempts === 0 ? 'connecting' : 'reconnecting');

    source = new EventSource(url);
    source.onopen = () => {
      attempts = 0;
      handlers.onStatus('connected');
    };

    source.onerror = () => {
      closeSource();
      scheduleReconnect();
    };

    source.addEventListener('paper-log', (event) => {
      const messageEvent = event as MessageEvent<string>;
      const parsed = parseData(messageEvent.data);
      if (!parsed) return;
      handlers.onPaperLog(parsed);
    });

    source.addEventListener('error', (event) => {
      const message = event instanceof MessageEvent ? String(event.data ?? '') : 'เกิดข้อผิดพลาด SSE';
      handlers.onError?.(message);
    });
  };

  return {
    start: () => {
      stopped = false;
      attempts = 0;
      connect();
    },
    stop: () => {
      stopped = true;
      clearTimer();
      closeSource();
      handlers.onStatus('disconnected');
    }
  };
}
