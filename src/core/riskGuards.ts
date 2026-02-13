import type { OrderRequest } from '../exchange/types.js';

export class RiskGuards {
  private readonly maxNotional: number;
  private readonly maxOrdersPerMin: number;
  private readonly orderTimestamps: number[] = [];

  constructor(maxNotional: number, maxOrdersPerMin: number) {
    this.maxNotional = maxNotional;
    this.maxOrdersPerMin = maxOrdersPerMin;
  }

  private getNotional(order: OrderRequest): number {
    if (order.type === 'MARKET' && order.quoteOrderQty) return order.quoteOrderQty;
    if (order.type === 'LIMIT' && order.price && order.quantity) return order.price * order.quantity;
    if (order.quantity && order.price) return order.quantity * order.price;
    return 0;
  }

  validate(order: OrderRequest): { ok: boolean; reason?: string } {
    const now = Date.now();
    const windowStart = now - 60_000;
    while (this.orderTimestamps.length && this.orderTimestamps[0] < windowStart) {
      this.orderTimestamps.shift();
    }

    if (this.orderTimestamps.length >= this.maxOrdersPerMin) {
      const reason = `Risk reject: max orders/min exceeded (${this.maxOrdersPerMin})`;
      console.error(reason);
      return { ok: false, reason };
    }

    const notional = this.getNotional(order);
    if (notional > this.maxNotional) {
      const reason = `Risk reject: notional ${notional.toFixed(4)} exceeds ${this.maxNotional}`;
      console.error(reason);
      return { ok: false, reason };
    }

    this.orderTimestamps.push(now);
    return { ok: true };
  }
}
