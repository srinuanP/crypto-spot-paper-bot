import { randomInt } from 'node:crypto';
import { buildQuery, signQuery } from './binanceTestnetRest.js';
import { BinanceWsApiClient } from './binanceWsApi.js';
import type { UserDataClient } from './types.js';

type Config = {
  apiKey: string;
  apiSecret: string;
  wsUrl?: string;
  getTimestamp: () => number;
};

export class BinanceUserDataStreamClient implements UserDataClient {
  private readonly config: Config;
  private wsClient: BinanceWsApiClient;
  private running = false;
  private subscriptionId?: number;
  private reconnectAttempt = 0;

  constructor(config: Config) {
    this.config = config;
    this.wsClient = new BinanceWsApiClient(config.wsUrl);
  }

  private signParams(): { apiKey: string; timestamp: number; signature: string } {
    const params = {
      apiKey: this.config.apiKey,
      timestamp: this.config.getTimestamp()
    };
    const payload = buildQuery(params);
    return {
      ...params,
      signature: signQuery(this.config.apiSecret, payload)
    };
  }

  private async subscribe() {
    const result = (await this.wsClient.request('userDataStream.subscribe.signature', this.signParams())) as { subscriptionId?: number };
    if (typeof result?.subscriptionId !== 'number') throw new Error('Missing subscriptionId in response');
    this.subscriptionId = result.subscriptionId;
    this.reconnectAttempt = 0;
  }

  private nextBackoffMs() {
    const base = Math.min(30_000, 1_000 * 2 ** this.reconnectAttempt);
    const jitter = randomInt(0, 300);
    this.reconnectAttempt += 1;
    return base + jitter;
  }

  async start(onEvent: (event: unknown) => void): Promise<void> {
    this.running = true;

    while (this.running) {
      try {
        await this.wsClient.connect();
        this.wsClient.onEvent(onEvent);
        await this.subscribe();

        await new Promise<void>((resolve) => {
          const poll = setInterval(() => {
            const anyWs = this.wsClient as unknown as { ws?: WebSocket | null };
            if (!this.running || !anyWs.ws || anyWs.ws.readyState !== WebSocket.OPEN) {
              clearInterval(poll);
              resolve();
            }
          }, 500);
        });
      } catch (error) {
        if (!this.running) break;
        console.error(`UserData WS reconnecting: ${(error as Error).message}`);
        await new Promise((resolve) => setTimeout(resolve, this.nextBackoffMs()));
        this.wsClient.close();
        this.wsClient = new BinanceWsApiClient(this.config.wsUrl);
      }
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    try {
      if (typeof this.subscriptionId === 'number') {
        await this.wsClient.request('userDataStream.unsubscribe', { subscriptionId: this.subscriptionId });
      } else {
        await this.wsClient.request('userDataStream.unsubscribe', {});
      }
    } catch {
      // ignore cleanup errors
    }
    this.wsClient.close();
  }
}
