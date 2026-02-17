import { loadEnv } from './env.js';
import { RiskGuards } from './riskGuards.js';
import { TimeSync } from './timeSync.js';
import { PaperExecutionClient } from '../exchange/paperExecution.js';
import { BinanceTestnetRestClient } from '../exchange/binanceTestnetRest.js';
import type { ExecutionClient } from '../exchange/types.js';

export function createExecutionClient(): ExecutionClient {
  const env = loadEnv();
  if (env.executionMode === 'testnet') {
    return new BinanceTestnetRestClient({
      baseUrl: env.testnetBaseUrl,
      apiKey: env.testnetApiKey,
      apiSecret: env.testnetApiSecret,
      recvWindow: env.recvWindow,
      timeSync: new TimeSync(),
      riskGuards: new RiskGuards(env.maxNotional, env.maxOrdersPerMin)
    });
  }
  return new PaperExecutionClient();
}
