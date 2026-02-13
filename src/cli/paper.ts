import { appendFile } from 'node:fs/promises';
import { parseArgs } from './args.js';
import { fetchKlines, fetchPrice } from '../exchange/binancePublic.js';
import { createSmaCrossStrategy } from '../strategy/smaCross.js';
import { createRsiMeanReversionStrategy } from '../strategy/rsiMeanReversion.js';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const symbol = args.symbol ?? 'BTCUSDT';
  const interval = args.interval ?? '15m';
  const strategyName = args.strategy ?? 'smaCross';
  const pollMs = Number(args.pollMs ?? 5000);
  const maxTicks = Number(args.maxTicks ?? 20);
  const dailyLossLimitPct = Number(args.dailyLossLimitPct ?? 0.03);
  const riskPct = Number(args.riskPct ?? 0.1);
  const feeBps = Number(args.feeBps ?? 10);
  const slippageBps = Number(args.slippageBps ?? 5);

  const strategy = strategyName === 'rsiMeanReversion'
    ? createRsiMeanReversionStrategy()
    : createSmaCrossStrategy();

  let cash = Number(args.initialCapital ?? 10_000);
  let qty = 0;
  const startEquity = cash;
  const feeRate = feeBps / 10_000;
  const slippageRate = slippageBps / 10_000;

  for (let tick = 1; tick <= maxTicks; tick += 1) {
    const [price, candles] = await Promise.all([
      fetchPrice(symbol),
      fetchKlines(symbol, interval, 250)
    ]);

    const signal = strategy(candles, candles.length - 2);

    if (signal.action === 'BUY' && qty === 0) {
      const spend = cash * riskPct;
      const fill = price * (1 + slippageRate);
      const buyQty = spend / fill;
      const fee = spend * feeRate;
      if (spend + fee <= cash) {
        cash -= spend + fee;
        qty = buyQty;
        await appendFile('paper-log.jsonl', `${JSON.stringify({
          ts: Date.now(),
          event: 'BUY',
          symbol,
          fill,
          qty,
          reason: signal.reason,
          cash
        })}\n`);
      }
    } else if (signal.action === 'SELL' && qty > 0) {
      const fill = price * (1 - slippageRate);
      const notional = qty * fill;
      const fee = notional * feeRate;
      cash += notional - fee;
      await appendFile('paper-log.jsonl', `${JSON.stringify({
        ts: Date.now(),
        event: 'SELL',
        symbol,
        fill,
        qty,
        reason: signal.reason,
        cash
      })}\n`);
      qty = 0;
    }

    const equity = cash + qty * price;
    const drawdownFromStart = 1 - equity / startEquity;
    await appendFile('paper-log.jsonl', `${JSON.stringify({
      ts: Date.now(),
      event: 'TICK',
      tick,
      symbol,
      price,
      equity,
      cash,
      qty,
      signal: signal.action
    })}\n`);

    if (drawdownFromStart >= dailyLossLimitPct) {
      await appendFile('paper-log.jsonl', `${JSON.stringify({
        ts: Date.now(),
        event: 'KILL_SWITCH',
        reason: 'DAILY_LOSS_LIMIT',
        drawdownFromStart,
        dailyLossLimitPct
      })}\n`);
      console.log('Kill switch triggered. Stopping paper loop.');
      break;
    }

    if (tick < maxTicks) await sleep(pollMs);
  }

  console.log('Paper simulation complete. Log file: paper-log.jsonl');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
