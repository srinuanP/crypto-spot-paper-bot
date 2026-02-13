import type { Candle, Signal, StrategyFn } from '../types.js';

function computeRsi(candles: Candle[], index: number, period: number): number | null {
  if (index - period < 0) return null;

  let gains = 0;
  let losses = 0;

  for (let i = index - period + 1; i <= index; i += 1) {
    const diff = candles[i].c - candles[i - 1].c;
    if (diff >= 0) gains += diff;
    else losses += Math.abs(diff);
  }

  if (losses === 0) return 100;
  const rs = gains / losses;
  return 100 - 100 / (1 + rs);
}

export function createRsiMeanReversionStrategy(period = 14, low = 30, high = 70): StrategyFn {
  return (candles: Candle[], index: number): Signal => {
    const rsi = computeRsi(candles, index, period);
    if (rsi === null) return { action: 'HOLD', reason: 'NOT_ENOUGH_DATA' };

    if (rsi <= low) return { action: 'BUY', reason: `RSI ${rsi.toFixed(2)} <= ${low}` };
    if (rsi >= high) return { action: 'SELL', reason: `RSI ${rsi.toFixed(2)} >= ${high}` };
    return { action: 'HOLD', reason: `RSI ${rsi.toFixed(2)} neutral` };
  };
}
