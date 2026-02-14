import { parseArgs } from './args.js';
import { loadEnv } from '../core/env.js';
import { TimeSync } from '../core/timeSync.js';
import { RiskGuards } from '../core/riskGuards.js';
import { BinanceTestnetRestClient } from '../exchange/binanceTestnetRest.js';
import { BinanceUserDataStreamClient } from '../exchange/binanceUserData.js';
import { createExecutionClient } from '../core/executionRouter.js';
import { checkLiveTradingAllowed } from '../core/safetySwitch.js';
import type { OrderRequest } from '../exchange/types.js';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function printUsage() {
  console.log([
    'Usage: node dist/src/cli/testnet.js <subcommand> [options]',
    '',
    'Subcommands:',
    '  ping',
    '  time',
    '  account',
    '  order:test --symbol BTCUSDT --side BUY --type MARKET --quoteOrderQty 10',
    '  order:live --symbol BTCUSDT --side BUY --type MARKET --quoteOrderQty 10 --i-know-what-im-doing=YES',
    '  ws:userdata --durationMs 30000',
    '  smoke --durationMs 15000',
    '',
    'Safety for live order:',
    '  A/B: EXECUTION_MODE=testnet',
    '  C:   BINANCE_TESTNET_TRADING_ENABLED=YES',
    '  D:   --i-know-what-im-doing=YES',
    ''
  ].join('\n'));
}

function createRestClient(timeSync?: TimeSync) {
  const env = loadEnv();
  const sync = timeSync ?? new TimeSync();
  return new BinanceTestnetRestClient({
    baseUrl: env.testnetBaseUrl,
    apiKey: env.testnetApiKey,
    apiSecret: env.testnetApiSecret,
    recvWindow: env.recvWindow,
    timeSync: sync,
    riskGuards: new RiskGuards(env.maxNotional, env.maxOrdersPerMin)
  });
}

function requireCredentials(): void {
  const env = loadEnv();
  if (!env.testnetApiKey || !env.testnetApiSecret) {
    throw new Error('ยังไม่ได้ตั้ง BINANCE_TESTNET_API_KEY/BINANCE_TESTNET_API_SECRET ใน environment');
  }
}

function requireTestnetMode(): void {
  const env = loadEnv();
  if (env.executionMode !== 'testnet') {
    throw new Error('EXECUTION_MODE ยังเป็น paper (ตั้ง EXECUTION_MODE=testnet ก่อนใช้คำสั่ง testnet order/live)');
  }
}

function parseOrder(args: Record<string, string>): OrderRequest {
  return {
    symbol: args.symbol ?? 'BTCUSDT',
    side: (args.side ?? 'BUY') as 'BUY' | 'SELL',
    type: (args.type ?? 'MARKET') as 'MARKET' | 'LIMIT',
    quoteOrderQty: args.quoteOrderQty ? Number(args.quoteOrderQty) : undefined,
    quantity: args.quantity ? Number(args.quantity) : undefined,
    price: args.price ? Number(args.price) : undefined,
    timeInForce: (args.timeInForce as 'GTC' | 'IOC' | 'FOK' | undefined) ?? 'GTC'
  };
}

async function runPing(): Promise<void> {
  const client = createRestClient();
  console.log(await client.ping());
}

async function runTime(): Promise<void> {
  const timeSync = new TimeSync();
  const client = createRestClient(timeSync);
  const serverTime = await client.getServerTime();
  const offsetMs = await client.syncTime();
  console.log({
    serverTime,
    localTime: Date.now(),
    offsetMs
  });
}

async function runAccount(): Promise<void> {
  requireCredentials();
  const client = createRestClient();
  await client.syncTime();
  console.log(JSON.stringify(await client.account(), null, 2));
}

async function runOrderTest(args: Record<string, string>): Promise<void> {
  requireTestnetMode();
  requireCredentials();
  const client = createExecutionClient();
  const result = await client.placeOrder(parseOrder(args), { live: false });
  console.log(JSON.stringify(result, null, 2));
}

async function runOrderLive(args: Record<string, string>): Promise<void> {
  requireTestnetMode();
  requireCredentials();
  const safety = checkLiveTradingAllowed(args['i-know-what-im-doing']);
  if (!safety.ok) {
    throw new Error(`Safety ${safety.layer} reject: ${safety.reason}`);
  }

  const client = createExecutionClient();
  const result = await client.placeOrder(parseOrder(args), {
    live: true,
    cliAck: args['i-know-what-im-doing']
  });
  console.log(JSON.stringify(result, null, 2));
}

async function runWsUserData(args: Record<string, string>): Promise<void> {
  requireCredentials();
  const env = loadEnv();
  const timeSync = new TimeSync();
  const restClient = createRestClient(timeSync);
  await timeSync.resync(() => restClient.getServerTime());

  const stream = new BinanceUserDataStreamClient({
    apiKey: env.testnetApiKey,
    apiSecret: env.testnetApiSecret,
    getTimestamp: () => Date.now() + timeSync.getOffset()
  });

  const durationMs = Math.max(1000, Number(args.durationMs ?? 30_000));
  console.log(`Starting user data stream for ${durationMs} ms...`);
  await stream.start((event) => {
    console.log(JSON.stringify(event));
  });

  await sleep(durationMs);
  await stream.stop();
  console.log('Stopped user data stream.');
}

async function runSmoke(args: Record<string, string>): Promise<void> {
  console.log('[smoke] 1/5 ping');
  await runPing();

  console.log('[smoke] 2/5 time');
  await runTime();

  const env = loadEnv();
  if (!env.testnetApiKey || !env.testnetApiSecret) {
    console.log('[smoke] credentials missing: set BINANCE_TESTNET_API_KEY and BINANCE_TESTNET_API_SECRET');
    console.log('[smoke] skipped steps: account -> order:test -> ws:userdata');
    return;
  }

  console.log('[smoke] 3/5 account');
  await runAccount();

  if (env.executionMode !== 'testnet') {
    console.log('[smoke] EXECUTION_MODE is paper: skip order:test via execution router');
  } else {
    console.log('[smoke] 4/5 order:test');
    await runOrderTest(args);
  }

  console.log('[smoke] 5/5 ws:userdata');
  await runWsUserData({
    ...args,
    durationMs: args.durationMs ?? '15000'
  });
}

async function run() {
  const [subcommand = 'help', ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);

  switch (subcommand) {
    case 'help':
    case '--help':
    case '-h':
      printUsage();
      return;
    case 'ping':
      await runPing();
      return;
    case 'time':
      await runTime();
      return;
    case 'account':
      await runAccount();
      return;
    case 'order:test':
      await runOrderTest(args);
      return;
    case 'order:live':
      await runOrderLive(args);
      return;
    case 'ws:userdata':
      await runWsUserData(args);
      return;
    case 'smoke':
      await runSmoke(args);
      return;
    default:
      throw new Error(`Unknown subcommand: ${subcommand}. Run "npm run testnet:ping" or "node dist/src/cli/testnet.js help".`);
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
