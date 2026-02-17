import { buildQuery, sign } from './binanceTestnetRest.js';
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
  private readonly wsClient: BinanceWsApiClient;
  private readonly eventHandlers = new Set<(event: unknown) => void>();
  private running = false;
  private subscriptionId?: number;
  private disposeReconnect?: () => void;
  private disposeEvent?: () => void;
  private disposeStartHandler?: () => void;

  constructor(config: Config) {
    this.config = config;
    this.wsClient = new BinanceWsApiClient(config.wsUrl);
  }

  private ensureCredentials(): void {
    if (!this.config.apiKey || !this.config.apiSecret) {
      throw new Error('Missing Binance credentials: set BINANCE_TESTNET_API_KEY and BINANCE_TESTNET_API_SECRET');
    }
  }

  private signedParams(): { apiKey: string; timestamp: number; signature: string } {
    const params = {
      apiKey: this.config.apiKey,
      timestamp: this.config.getTimestamp()
    };
    const signature = sign(buildQuery(params), this.config.apiSecret);
    return {
      ...params,
      signature
    };
  }

  private emit(event: unknown): void {
    this.eventHandlers.forEach((handler) => handler(event));
  }

  onEvent(handler: (event: unknown) => void): () => void {
    this.eventHandlers.add(handler);
    return () => this.eventHandlers.delete(handler);
  }

  async subscribeSignature(): Promise<number> {
    this.ensureCredentials();
    const result = (await this.wsClient.request('userDataStream.subscribe.signature', this.signedParams())) as {
      subscriptionId?: number;
    };

    if (typeof result?.subscriptionId !== 'number') {
      throw new Error('Missing subscriptionId from userDataStream.subscribe.signature');
    }

    this.subscriptionId = result.subscriptionId;
    return result.subscriptionId;
  }

  async unsubscribe(subscriptionId?: number): Promise<void> {
    const params = typeof subscriptionId === 'number'
      ? { subscriptionId }
      : (typeof this.subscriptionId === 'number' ? { subscriptionId: this.subscriptionId } : {});

    await this.wsClient.request('userDataStream.unsubscribe', params);
    this.subscriptionId = undefined;
  }

  async start(onEvent: (event: unknown) => void): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.ensureCredentials();
    this.disposeStartHandler = this.onEvent(onEvent);

    this.disposeEvent = this.wsClient.onEvent((event) => this.emit(event));
    this.disposeReconnect = this.wsClient.onReconnect(async () => {
      if (!this.running) return;
      await this.subscribeSignature();
      this.emit({ event: 'USER_DATA_RESUBSCRIBED', subscriptionId: this.subscriptionId });
    });

    await this.wsClient.connect();
    await this.subscribeSignature();
    this.emit({ event: 'USER_DATA_SUBSCRIBED', subscriptionId: this.subscriptionId });
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;

    try {
      await this.unsubscribe();
    } catch {
      // best effort cleanup
    }

    this.disposeReconnect?.();
    this.disposeReconnect = undefined;
    this.disposeEvent?.();
    this.disposeEvent = undefined;
    this.disposeStartHandler?.();
    this.disposeStartHandler = undefined;
    this.wsClient.close();
  }
}
