import { randomInt, randomUUID } from 'node:crypto';

type Pending = {
  resolve: (data: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

type WsMessage = {
  id?: string;
  status?: number;
  error?: { msg?: string };
  result?: unknown;
  [k: string]: unknown;
};

const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

export class BinanceWsApiClient {
  private url: string;
  private ws: WebSocket | null = null;
  private pending = new Map<string, Pending>();
  private eventHandlers = new Set<(event: unknown) => void>();
  private reconnectHandlers = new Set<() => void | Promise<void>>();
  private connectPromise: Promise<void> | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempt = 0;
  private closedByUser = false;
  private hasConnectedOnce = false;

  constructor(url = 'wss://ws-api.testnet.binance.vision/ws-api/v3') {
    this.url = url;
  }

  private isOpen(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  private nextBackoffMs(): number {
    const base = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * (2 ** this.reconnectAttempt));
    const jitter = randomInt(0, 500);
    this.reconnectAttempt += 1;
    return base + jitter;
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private failAllPending(reason: string): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error(reason));
      this.pending.delete(id);
    }
  }

  private handleMessage(raw: unknown): void {
    const payload = JSON.parse(String(raw)) as WsMessage;
    if (payload.id && this.pending.has(payload.id)) {
      const pending = this.pending.get(payload.id)!;
      clearTimeout(pending.timer);
      this.pending.delete(payload.id);
      if (typeof payload.status === 'number' && payload.status >= 400) {
        pending.reject(new Error(payload.error?.msg ?? `WS API error status ${payload.status}`));
      } else {
        pending.resolve(payload.result);
      }
      return;
    }
    this.eventHandlers.forEach((handler) => handler(payload));
  }

  private async invokeReconnectHandlers(): Promise<void> {
    for (const handler of this.reconnectHandlers) {
      await handler();
    }
  }

  private scheduleReconnect(): void {
    if (this.closedByUser || this.connectPromise) return;
    if (this.reconnectTimer) return;
    const waitMs = this.nextBackoffMs();
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect().catch(() => {
        this.scheduleReconnect();
      });
    }, waitMs);
  }

  async connect(url?: string): Promise<void> {
    if (url) this.url = url;
    if (this.isOpen()) return;
    if (this.connectPromise) return this.connectPromise;

    this.closedByUser = false;
    this.clearReconnectTimer();

    this.connectPromise = new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(this.url);
      this.ws = ws;

      ws.onopen = () => {
        const isReconnect = this.hasConnectedOnce;
        this.hasConnectedOnce = true;
        this.reconnectAttempt = 0;
        this.connectPromise = null;
        resolve();
        if (isReconnect) {
          void this.invokeReconnectHandlers().catch((error) => {
            console.error(`WS reconnect handler error: ${(error as Error).message}`);
          });
        }
      };

      ws.onmessage = (message) => {
        try {
          this.handleMessage(message.data);
        } catch (error) {
          console.error(`WS message parse error: ${(error as Error).message}`);
        }
      };

      ws.onerror = () => {
        if (!this.isOpen()) {
          this.connectPromise = null;
          reject(new Error('WS connection failed'));
        }
      };

      ws.onclose = () => {
        this.ws = null;
        this.connectPromise = null;
        this.failAllPending('WS disconnected');
        if (!this.closedByUser) {
          this.scheduleReconnect();
        }
      };
    });

    return this.connectPromise;
  }

  onEvent(handler: (event: unknown) => void): () => void {
    this.eventHandlers.add(handler);
    return () => this.eventHandlers.delete(handler);
  }

  onReconnect(handler: () => void | Promise<void>): () => void {
    this.reconnectHandlers.add(handler);
    return () => this.reconnectHandlers.delete(handler);
  }

  async request(method: string, params: Record<string, unknown>, timeoutMs = 15_000): Promise<unknown> {
    if (!this.isOpen()) {
      await this.connect();
    }
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error(`WS not connected: ${method}`);
    }

    const id = randomUUID();
    const payload = { id, method, params };

    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`WS API timeout: ${method}`));
      }, timeoutMs);

      this.pending.set(id, { resolve, reject, timer });

      try {
        this.ws!.send(JSON.stringify(payload));
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error as Error);
      }
    });
  }

  close(): void {
    this.closedByUser = true;
    this.clearReconnectTimer();
    this.failAllPending('WS closed by user');
    this.ws?.close();
    this.ws = null;
    this.connectPromise = null;
  }
}
