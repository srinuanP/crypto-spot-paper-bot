import type { ExecutionClient, ExecutionResponse, OrderRequest } from './types.js';

export class PaperExecutionClient implements ExecutionClient {
  async placeOrder(order: OrderRequest, options?: { live?: boolean; cliAck?: string }): Promise<ExecutionResponse> {
    if (options?.live) {
      throw new Error('Safety A/B reject: EXECUTION_MODE is paper. Set EXECUTION_MODE=testnet for any live testnet order.');
    }

    return {
      ok: true,
      mode: 'paper',
      validateOnly: true,
      endpoint: 'paper://simulated-order',
      request: {
        symbol: order.symbol,
        side: order.side,
        type: order.type,
        quantity: order.quantity ?? '',
        quoteOrderQty: order.quoteOrderQty ?? ''
      },
      data: { message: 'Paper mode: no real network order sent.' }
    };
  }
}
