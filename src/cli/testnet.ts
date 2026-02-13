import { parseArgs } from './args.js';
import { loadEnv } from '../core/env.js';
import { TimeSync } from '../core/timeSync.js';
import { RiskGuards } from '../core/riskGuards.js';
import { BinanceTestnetRestClient } from '../exchange/binanceTestnetRest.js';
import { BinanceUserDataStreamClient } from '../exchange/binanceUserData.js';
import { createExecutionClient } from '../core/executionRouter.js';
import type { OrderRequest } from '../exchange/types.js';

function createRestClient() {
  const env = loadEnv();
  return new BinanceTestnetRestClient({
    baseUrl: env.testnetBaseUrl,
    apiKey: env.testnetApiKey,
    apiSecret: env.testnetApiSecret,
    recvWindow: env.recvWindow,
    timeSync: new TimeSync(),
    riskGuards: new RiskGuards(env.maxNotional, env.maxOrdersPerMin)
  });
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

async function run() {
  const [subcommand = 'ping', ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);

  if (subcommand === 'ping') {
    const client = createRestClient();
    console.log(await client.ping());
    return;
  }

  if (subcommand === 'time') {
    const client = createRestClient();
    const serverTime = await client.getServerTime();
    await client.syncTime();
    console.log({ serverTime, localTime: Date.now(), offsetMs: serverTime - Date.now() });
    return;
  }

  if (subcommand === 'account') {
    const client = createRestClient();
    await client.syncTime();
    console.log(JSON.stringify(await client.account(), null, 2));
    return;
  }

  if (subcommand === 'order:test') {
    const client = createExecutionClient();
    const result = await client.placeOrder(parseOrder(args), { live: false });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (subcommand === 'order:live') {
    const client = createExecutionClient();
    const result = await client.placeOrder(parseOrder(args), {
      live: true,
      cliAck: args['i-know-what-im-doing']
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (subcommand === 'ws:userdata') {
    const env = loadEnv();
    const timeSync = new TimeSync();
    const restClient = createRestClient();
    await timeSync.sync(() => restClient.getServerTime());

    const stream = new BinanceUserDataStreamClient({
      apiKey: env.testnetApiKey,
      apiSecret: env.testnetApiSecret,
      getTimestamp: () => Date.now() + timeSync.getOffset()
    });

    const durationMs = Number(args.durationMs ?? 60_000);
    console.log('Starting user data stream...');
    const stopper = setTimeout(async () => {
      await stream.stop();
      console.log('Stopped user data stream.');
    }, durationMs);

    await stream.start((event) => {
      console.log('event:', JSON.stringify(event));
    });

    clearTimeout(stopper);
    return;
  }

  throw new Error(`Unknown subcommand: ${subcommand}`);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
