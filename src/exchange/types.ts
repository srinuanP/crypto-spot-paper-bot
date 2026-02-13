export type Side = 'BUY' | 'SELL';
export type OrderType = 'MARKET' | 'LIMIT';

export type OrderRequest = {
  symbol: string;
  side: Side;
  type: OrderType;
  quantity?: number;
  quoteOrderQty?: number;
  price?: number;
  timeInForce?: 'GTC' | 'IOC' | 'FOK';
  newClientOrderId?: string;
};

export type ExecutionResponse = {
  ok: boolean;
  mode: 'paper' | 'testnet';
  validateOnly: boolean;
  endpoint: string;
  request: Record<string, string | number>;
  data: unknown;
};

export interface ExecutionClient {
  placeOrder(order: OrderRequest, options?: { live?: boolean; cliAck?: string }): Promise<ExecutionResponse>;
}

export interface UserDataClient {
  start(onEvent: (event: unknown) => void): Promise<void>;
  stop(): Promise<void>;
}
