import { createHmac, randomUUID } from 'node:crypto';
import { TimeSync } from '../core/timeSync.js';
import { RiskGuards } from '../core/riskGuards.js';
import { assertLiveTradingAllowed } from '../core/safetySwitch.js';
import type { ExecutionClient, ExecutionResponse, OrderRequest } from './types.js';

type HttpMethod = 'GET' | 'POST';

type RestConfig = {
  baseUrl: string;
  apiKey: string;
  apiSecret: string;
  recvWindow: number;
  timeSync: TimeSync;
  riskGuards: RiskGuards;
  fetchImpl?: typeof fetch;
};

type BinanceErrorBody = {
  code?: number;
  msg?: string;
  [k: string]: unknown;
};

export function normalizeParams(params: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(params)
      .filter(([, value]) => value !== undefined && value !== null)
      .map(([key, value]) => [key, String(value)])
  );
}

export function buildQuery(params: Record<string, unknown>): string {
  const normalized = normalizeParams(params);
  return Object.keys(normalized)
    .sort((a, b) => a.localeCompare(b))
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(normalized[key])}`)
    .join('&');
}

export function sign(queryString: string, secret: string): string {
  return createHmac('sha256', secret).update(queryString).digest('hex');
}

export function signQuery(secret: string, queryString: string): string {
  return sign(queryString, secret);
}

function clampRecvWindow(input: number): number {
  return Math.min(60_000, Math.max(1, input));
}

function toBinanceErrorBody(payload: unknown): BinanceErrorBody {
  if (!payload || typeof payload !== 'object') return {};
  return payload as BinanceErrorBody;
}

function getErrorMessage(status: number, payload: unknown, rawText: string): string {
  const body = toBinanceErrorBody(payload);
  if (typeof body.msg === 'string') return `Binance error ${status}: ${body.msg}`;
  if (rawText.length > 0) return `Binance error ${status}: ${rawText}`;
  return `Binance error ${status}`;
}

export class BinanceTestnetRestClient implements ExecutionClient {
  private readonly config: RestConfig;
  private readonly fetchImpl: typeof fetch;

  constructor(config: RestConfig) {
    this.config = config;
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  private ensureApiCredentials(): void {
    if (!this.config.apiKey || !this.config.apiSecret) {
      throw new Error('Missing Binance credentials: set BINANCE_TESTNET_API_KEY and BINANCE_TESTNET_API_SECRET');
    }
  }

  private parseResponseBody(text: string): unknown {
    if (!text) return {};
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return { raw: text };
    }
  }

  private buildSignedPayload(params: Record<string, unknown>): Record<string, unknown> {
    this.ensureApiCredentials();
    return {
      ...params,
      recvWindow: clampRecvWindow(this.config.recvWindow),
      timestamp: Date.now() + this.config.timeSync.getOffset()
    };
  }

  private async request<T>(options: {
    method: HttpMethod;
    path: string;
    params?: Record<string, unknown>;
    signed?: boolean;
    retryOnClockSkew?: boolean;
  }): Promise<T> {
    const method = options.method;
    const signed = options.signed === true;
    const retryOnClockSkew = options.retryOnClockSkew !== false;
    const baseParams = options.params ?? {};
    const headers: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded'
    };

    let payload = { ...baseParams };
    if (signed) {
      payload = this.buildSignedPayload(payload);
      const signatureBase = buildQuery(payload);
      payload = {
        ...payload,
        signature: sign(signatureBase, this.config.apiSecret)
      };
      headers['X-MBX-APIKEY'] = this.config.apiKey;
    }

    const query = buildQuery(payload);
    const url = method === 'GET'
      ? `${this.config.baseUrl}${options.path}${query ? `?${query}` : ''}`
      : `${this.config.baseUrl}${options.path}`;

    const response = await this.fetchImpl(url, {
      method,
      headers,
      body: method === 'GET' ? undefined : query
    });

    const text = await response.text();
    const body = this.parseResponseBody(text);

    if (!response.ok) {
      const errorBody = toBinanceErrorBody(body);
      if (signed && retryOnClockSkew && errorBody.code === -1021) {
        await this.syncTime();
        return this.request<T>({
          ...options,
          retryOnClockSkew: false
        });
      }
      throw new Error(getErrorMessage(response.status, body, text));
    }

    return body as T;
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

  private validateRisk(order: OrderRequest): void {
    const check = this.config.riskGuards.validate(order);
    if (!check.ok) {
      throw new Error(check.reason ?? 'Risk reject');
    }
  }

  async ping(): Promise<unknown> {
    return this.request<unknown>({ method: 'GET', path: '/v3/ping' });
  }

  async time(): Promise<{ serverTime: number }> {
    return this.request<{ serverTime: number }>({ method: 'GET', path: '/v3/time' });
  }

  async getServerTime(): Promise<number> {
    const data = await this.time();
    return data.serverTime;
  }

  async syncTime(): Promise<number> {
    return this.config.timeSync.resync(() => this.getServerTime());
  }

  async account(): Promise<unknown> {
    return this.request<unknown>({
      method: 'GET',
      path: '/v3/account',
      signed: true
    });
  }

  async orderTest(order: OrderRequest): Promise<unknown> {
    this.validateRisk(order);
    return this.request<unknown>({
      method: 'POST',
      path: '/v3/order/test',
      signed: true,
      params: this.buildOrderParams(order)
    });
  }

  async orderLive(order: OrderRequest, cliAck?: string): Promise<unknown> {
    this.validateRisk(order);
    assertLiveTradingAllowed(cliAck);
    console.warn('LIVE TESTNET ORDER ENABLED: sending POST /api/v3/order');
    return this.request<unknown>({
      method: 'POST',
      path: '/v3/order',
      signed: true,
      params: this.buildOrderParams(order)
    });
  }

  async placeOrder(order: OrderRequest, options?: { live?: boolean; cliAck?: string }): Promise<ExecutionResponse> {
    const live = options?.live === true;
    const params = this.buildOrderParams(order) as Record<string, string | number>;
    const data = live ? await this.orderLive(order, options?.cliAck) : await this.orderTest(order);
    const endpoint = live ? '/api/v3/order' : '/api/v3/order/test';

    return {
      ok: true,
      mode: 'testnet',
      validateOnly: !live,
      endpoint,
      request: params,
      data
    };
  }
}
