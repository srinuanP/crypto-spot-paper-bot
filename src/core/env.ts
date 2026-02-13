export type AppEnv = {
  executionMode: 'paper' | 'testnet';
  testnetBaseUrl: string;
  testnetApiKey: string;
  testnetApiSecret: string;
  testnetTradingEnabled: 'YES' | 'NO';
  recvWindow: number;
  maxNotional: number;
  maxOrdersPerMin: number;
};

const toNumber = (v: string | undefined, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

export function loadEnv(): AppEnv {
  return {
    executionMode: process.env.EXECUTION_MODE === 'testnet' ? 'testnet' : 'paper',
    testnetBaseUrl: process.env.BINANCE_TESTNET_BASE_URL ?? 'https://testnet.binance.vision/api',
    testnetApiKey: process.env.BINANCE_TESTNET_API_KEY ?? '',
    testnetApiSecret: process.env.BINANCE_TESTNET_API_SECRET ?? '',
    testnetTradingEnabled: process.env.BINANCE_TESTNET_TRADING_ENABLED === 'YES' ? 'YES' : 'NO',
    recvWindow: Math.min(60_000, Math.max(1, toNumber(process.env.BINANCE_TESTNET_RECV_WINDOW, 5000))),
    maxNotional: toNumber(process.env.BINANCE_TESTNET_MAX_NOTIONAL, 20),
    maxOrdersPerMin: toNumber(process.env.BINANCE_TESTNET_MAX_ORDERS_PER_MIN, 5)
  };
}
