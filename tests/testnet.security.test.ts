import test from 'node:test';
import assert from 'node:assert/strict';
import { TimeSync } from '../src/core/timeSync.js';
import { RiskGuards } from '../src/core/riskGuards.js';
import { assertLiveTradingAllowed } from '../src/core/safetySwitch.js';
import {
  BinanceTestnetRestClient,
  buildQuery,
  normalizeParams,
  sign,
  signQuery
} from '../src/exchange/binanceTestnetRest.js';

test('normalizeParams removes undefined/null and stringifies values', () => {
  const normalized = normalizeParams({
    a: 1,
    b: 'x y',
    c: undefined,
    d: null,
    e: false
  });
  assert.deepEqual(normalized, {
    a: '1',
    b: 'x y',
    e: 'false'
  });
});

test('buildQuery sorts keys and excludes undefined/null', () => {
  const query = buildQuery({ b: 2, a: 'x y', c: undefined, d: null });
  assert.equal(query, 'a=x%20y&b=2');
});

test('sign helpers are deterministic', () => {
  const sig1 = sign('a=1&b=2', 'secret');
  const sig2 = signQuery('secret', 'a=1&b=2');
  assert.equal(sig1, sig2);
  assert.equal(sig1.length, 64);
});

test('riskGuards reject by notional and rate limit', () => {
  const guards = new RiskGuards(20, 2);

  const tooBig = guards.validate({ symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', quoteOrderQty: 25 });
  assert.equal(tooBig.ok, false);

  const ok1 = guards.validate({ symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', quoteOrderQty: 10 });
  const ok2 = guards.validate({ symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', quoteOrderQty: 10 });
  const rateBlocked = guards.validate({ symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', quoteOrderQty: 10 });

  assert.equal(ok1.ok, true);
  assert.equal(ok2.ok, true);
  assert.equal(rateBlocked.ok, false);
});

test('safety switch rejects unless all conditions met', () => {
  const prevMode = process.env.EXECUTION_MODE;
  const prevEnabled = process.env.BINANCE_TESTNET_TRADING_ENABLED;

  process.env.EXECUTION_MODE = 'paper';
  process.env.BINANCE_TESTNET_TRADING_ENABLED = 'NO';
  assert.throws(() => assertLiveTradingAllowed('YES'));

  process.env.EXECUTION_MODE = 'testnet';
  process.env.BINANCE_TESTNET_TRADING_ENABLED = 'YES';
  assert.throws(() => assertLiveTradingAllowed('NO'));

  assert.doesNotThrow(() => assertLiveTradingAllowed('YES'));

  if (typeof prevMode === 'string') process.env.EXECUTION_MODE = prevMode;
  else delete process.env.EXECUTION_MODE;
  if (typeof prevEnabled === 'string') process.env.BINANCE_TESTNET_TRADING_ENABLED = prevEnabled;
  else delete process.env.BINANCE_TESTNET_TRADING_ENABLED;
});

test('signed request includes recvWindow/timestamp/signature and retries once on -1021', async () => {
  const calls: Array<{ url: string; headers: Headers; method: string }> = [];
  let accountAttempts = 0;
  const fetchMock: typeof fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const headers = new Headers(init?.headers ?? {});
    calls.push({ url, headers, method });

    const path = new URL(url).pathname;
    if (path.endsWith('/v3/account')) {
      accountAttempts += 1;
      if (accountAttempts === 1) {
        return new Response(JSON.stringify({ code: -1021, msg: 'Timestamp for this request was outside of the recvWindow.' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      return new Response(JSON.stringify({ balances: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (path.endsWith('/v3/time')) {
      return new Response(JSON.stringify({ serverTime: 1_700_000_000_000 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  const client = new BinanceTestnetRestClient({
    baseUrl: 'https://testnet.binance.vision/api',
    apiKey: 'api-key',
    apiSecret: 'secret',
    recvWindow: 5000,
    timeSync: new TimeSync(),
    riskGuards: new RiskGuards(20, 5),
    fetchImpl: fetchMock
  });

  const result = await client.account();
  assert.deepEqual(result, { balances: [] });

  const accountCalls = calls.filter((row) => new URL(row.url).pathname.endsWith('/v3/account'));
  const timeCalls = calls.filter((row) => new URL(row.url).pathname.endsWith('/v3/time'));
  assert.equal(accountCalls.length, 2);
  assert.equal(timeCalls.length, 1);

  const first = accountCalls[0];
  assert.equal(first.method, 'GET');
  assert.equal(first.headers.get('X-MBX-APIKEY'), 'api-key');

  const firstUrl = new URL(first.url);
  const params = Object.fromEntries(firstUrl.searchParams.entries()) as Record<string, string>;
  assert.equal(params.recvWindow, '5000');
  assert.ok(params.timestamp);
  assert.ok(params.signature);

  const signature = params.signature;
  delete params.signature;
  assert.equal(sign(buildQuery(params), 'secret'), signature);
});
