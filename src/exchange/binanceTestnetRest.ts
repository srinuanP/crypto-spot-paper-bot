import { createHmac, randomUUID } from 'node:crypto';
import { TimeSync } from '../core/timeSync.js';
import { RiskGuards } from '../core/riskGuards.js';
import { assertLiveTradingAllowed } from '../core/safetySwitch.js';
import type { ExecutionClient, ExecutionResponse, OrderRequest } from './types.js';

type RestConfig = {
  baseUrl: string;
  apiKey: string;
  apiSecret: string;
  recvWindow: number;
  timeSync: TimeSync;
  riskGuards: RiskGuards;
};

export function buildQuery(params: Record<string, unknown>): string {
  return Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => [key, String(value)] as const)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
}

export function signQuery(secret: string, queryString: string): string {
  return createHmac('sha256', secret).update(queryString).digest('hex');
}

export class BinanceTestnetRestClient implements ExecutionClient {
  private config: RestConfig;

  constructor(config: RestConfig) {
    this.config = config;
  }

  private async request(method: string, path: string, params: Record<string, unknown> = {}, signed = false, retry = true): Promise<unknown> {
    const headers: Record<string, string> = {};
    let payload = { ...params };

    if (signed) {
      if (!this.config.apiKey || !this.config.apiSecret) {
        throw new Error('Missing BINANCE_TESTNET_API_KEY or BINANCE_TESTNET_API_SECRET');
      }
      headers['X-MBX-APIKEY'] = this.config.apiKey;
      payload = {
        ...payload,
        recvWindow: Math.min(60_000, this.config.recvWindow),
        timestamp: Date.now() + this.config.timeSync.getOffset()
      };
      const q = buildQuery(payload);
      payload = { ...payload, signature: signQuery(this.config.apiSecret, q) };
    }

    const query = buildQuery(payload);
    const url = method === 'GET' ? `${this.config.baseUrl}${path}${query ? `?${query}` : ''}` : `${this.config.baseUrl}${path}`;

    const response = await fetch(url, {
      method,
      headers: {
        ...headers,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: method === 'GET' ? undefined : query
    });

    const text = await response.text();
    const json = text ? JSON.parse(text) : {};

    if (!response.ok) {
      if (signed && retry && typeof json?.code === 'number' && json.code === -1021) {
        await this.syncTime();
        return this.request(method, path, params, signed, false);
      }
      throw new Error(`Binance error ${response.status}: ${text}`);
    }

    return json;
  }

  async ping() {
    return this.request('GET', '/v3/ping');
  }

  async getServerTime(): Promise<number> {
    const data = (await this.request('GET', '/v3/time')) as { serverTime: number };
    return data.serverTime;
  }

  async syncTime() {
    return this.config.timeSync.sync(() => this.getServerTime());
  }

  async account() {
    return this.request('GET', '/v3/account', {}, true);
  }

  private buildOrderParams(order: OrderRequest): Record<string, unknown> {
    return {
      symbol: order.symbol,
      side: order.side,
      type: order.type,
      quantity: order.quantity,
      quoteOrderQty: order.quoteOrderQty,
      price: order.price,
      timeInForce: order.timeInForce,
      newClientOrderId: order.newClientOrderId ?? `bot-${randomUUID()}`
    };
  }

  async placeOrder(order: OrderRequest, options?: { live?: boolean; cliAck?: string }): Promise<ExecutionResponse> {
    const check = this.config.riskGuards.validate(order);
    if (!check.ok) throw new Error(check.reason);

    const params = this.buildOrderParams(order);
    const live = options?.live === true;

    if (live) {
      assertLiveTradingAllowed(options?.cliAck);
      console.warn('⚠️  LIVE TESTNET ORDER ENABLED: sending POST /api/v3/order');
    }

    const endpoint = live ? '/v3/order' : '/v3/order/test';
    const data = await this.request('POST', endpoint, params, true);

    return {
      ok: true,
      mode: 'testnet',
      validateOnly: !live,
      endpoint: `/api${endpoint}`,
      request: params as Record<string, string | number>,
      data
    };
  }
}
