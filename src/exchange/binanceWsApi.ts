import { randomUUID } from 'node:crypto';

type Pending = {
  resolve: (data: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

export class BinanceWsApiClient {
  private readonly url: string;
  private ws: WebSocket | null = null;
  private pending = new Map<string, Pending>();
  private eventHandlers = new Set<(event: unknown) => void>();

  constructor(url = 'wss://ws-api.testnet.binance.vision/ws-api/v3') {
    this.url = url;
  }

  async connect(): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(this.url);
      ws.onopen = () => {
        this.ws = ws;
        resolve();
      };
      ws.onerror = () => reject(new Error('WS connection failed'));
      ws.onmessage = (message) => {
        const payload = JSON.parse(String(message.data)) as { id?: string; status?: number; error?: { msg: string }; result?: unknown; [k: string]: unknown };
        if (payload.id && this.pending.has(payload.id)) {
          const p = this.pending.get(payload.id)!;
          clearTimeout(p.timer);
          this.pending.delete(payload.id);
          if (payload.status && payload.status >= 400) p.reject(new Error(payload.error?.msg ?? 'WS API error'));
          else p.resolve(payload.result);
          return;
        }
        this.eventHandlers.forEach((h) => h(payload));
      };
      ws.onclose = () => {
        this.ws = null;
      };
    });
  }

  onEvent(handler: (event: unknown) => void) {
    this.eventHandlers.add(handler);
    return () => this.eventHandlers.delete(handler);
  }

  async request(method: string, params: Record<string, unknown>, timeoutMs = 15_000): Promise<unknown> {
    await this.connect();
    const id = randomUUID();
    const payload = { id, method, params };

    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`WS API timeout: ${method}`));
      }, timeoutMs);

      this.pending.set(id, { resolve, reject, timer });
      this.ws!.send(JSON.stringify(payload));
    });
  }

  close() {
    this.ws?.close();
    this.ws = null;
  }
}
