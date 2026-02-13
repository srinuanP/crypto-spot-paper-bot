import { loadEnv } from './env.js';

export function assertLiveTradingAllowed(cliAck?: string) {
  const env = loadEnv();
  if (env.executionMode !== 'testnet') throw new Error('Safety A/B reject: EXECUTION_MODE must be testnet for live testnet order.');
  if (env.testnetTradingEnabled !== 'YES') throw new Error('Safety C reject: BINANCE_TESTNET_TRADING_ENABLED must be YES.');
  if (cliAck !== 'YES') throw new Error('Safety D reject: pass --i-know-what-im-doing=YES for live order.');
}
