import { loadEnv } from './env.js';

export type SafetyCheckResult =
  | { ok: true }
  | { ok: false; layer: 'A/B' | 'C' | 'D'; reason: string };

export function checkLiveTradingAllowed(cliAck?: string): SafetyCheckResult {
  const env = loadEnv();
  if (env.executionMode !== 'testnet') {
    return {
      ok: false,
      layer: 'A/B',
      reason: 'EXECUTION_MODE ยังเป็น paper (ต้องตั้ง EXECUTION_MODE=testnet ก่อน)'
    };
  }
  if (env.testnetTradingEnabled !== 'YES') {
    return {
      ok: false,
      layer: 'C',
      reason: 'BINANCE_TESTNET_TRADING_ENABLED ยังไม่เป็น YES'
    };
  }
  if (cliAck !== 'YES') {
    return {
      ok: false,
      layer: 'D',
      reason: 'ขาด --i-know-what-im-doing=YES'
    };
  }
  return { ok: true };
}

export function assertLiveTradingAllowed(cliAck?: string) {
  const check = checkLiveTradingAllowed(cliAck);
  if (!check.ok) {
    throw new Error(`Safety ${check.layer} reject: ${check.reason}`);
  }
}
