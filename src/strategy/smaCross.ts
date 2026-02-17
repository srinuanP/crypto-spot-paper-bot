import type { Candle, Signal, StrategyFn } from '../types.js';

const sma = (candles: Candle[], endIndex: number, length: number): number | null => {
  if (endIndex - length + 1 < 0) return null;
  let sum = 0;
  for (let i = endIndex - length + 1; i <= endIndex; i += 1) {
    sum += candles[i].c;
  }
  return sum / length;
};

export function createSmaCrossStrategy(shortPeriod = 9, longPeriod = 21): StrategyFn {
  return (candles: Candle[], index: number): Signal => {
    const shortNow = sma(candles, index, shortPeriod);
    const longNow = sma(candles, index, longPeriod);
    const shortPrev = sma(candles, index - 1, shortPeriod);
    const longPrev = sma(candles, index - 1, longPeriod);

    if ([shortNow, longNow, shortPrev, longPrev].some((v) => v === null)) {
      return { action: 'HOLD', reason: 'NOT_ENOUGH_DATA' };
    }

    if (shortPrev! <= longPrev! && shortNow! > longNow!) {
      return { action: 'BUY', reason: `SMA${shortPeriod} crossed above SMA${longPeriod}` };
    }

    if (shortPrev! >= longPrev! && shortNow! < longNow!) {
      return { action: 'SELL', reason: `SMA${shortPeriod} crossed below SMA${longPeriod}` };
    }

    return { action: 'HOLD', reason: 'NO_CROSS' };
  };
}
