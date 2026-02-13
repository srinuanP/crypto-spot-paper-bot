import { mkdir, writeFile } from 'node:fs/promises';
import { parseArgs } from './args.js';
import { fetchKlines } from '../exchange/binancePublic.js';
import { createSmaCrossStrategy } from '../strategy/smaCross.js';
import { createRsiMeanReversionStrategy } from '../strategy/rsiMeanReversion.js';
import { runBacktest } from '../backtest/engine.js';

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const symbol = args.symbol ?? 'BTCUSDT';
  const interval = args.interval ?? '15m';
  const limit = Number(args.limit ?? 500);
  const strategyName = args.strategy ?? 'smaCross';
  const feeBps = Number(args.feeBps ?? 10);
  const slippageBps = Number(args.slippageBps ?? 5);
  const riskPerTradePct = Number(args.riskPct ?? 0.1);
  const stopLossPct = args.stopLossPct ? Number(args.stopLossPct) : undefined;

  const candles = await fetchKlines(symbol, interval, limit);
  const strategy = strategyName === 'rsiMeanReversion'
    ? createRsiMeanReversionStrategy()
    : createSmaCrossStrategy();

  const result = runBacktest(candles, strategy, {
    initialCapital: Number(args.initialCapital ?? 10_000),
    feeBps,
    slippageBps,
    riskPerTradePct,
    stopLossPct
  });

  await mkdir('reports', { recursive: true });
  const report = {
    generatedAt: new Date().toISOString(),
    symbol,
    interval,
    limit,
    strategy: strategyName,
    config: { feeBps, slippageBps, riskPerTradePct, stopLossPct },
    ...result
  };
  await writeFile('reports/latest.json', JSON.stringify(report, null, 2));

  console.log('Backtest summary');
  console.table({
    totalReturnPct: `${(result.metrics.totalReturn * 100).toFixed(2)}%`,
    maxDrawdownPct: `${(result.metrics.maxDrawdown * 100).toFixed(2)}%`,
    winRatePct: `${(result.metrics.winRate * 100).toFixed(2)}%`,
    profitFactor: Number.isFinite(result.metrics.profitFactor)
      ? result.metrics.profitFactor.toFixed(2)
      : 'Infinity',
    trades: result.metrics.numberOfTrades
  });
  console.log('Saved report to reports/latest.json');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
