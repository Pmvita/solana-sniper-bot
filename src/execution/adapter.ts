// Execution adapter interface — paper vs live

import type { TradeResult, TradingMode } from "../bot/types.js";

export interface BuyRequest {
  mint: string;
  symbol: string;
  solAmount: number;
  /** Estimated SOL per token at entry */
  priceSolPerToken: number;
  slippageBps: number;
}

export interface SellRequest {
  mint: string;
  symbol: string;
  tokenAmount: number;
  /** Estimated SOL per token at exit */
  priceSolPerToken: number;
  reason: string;
}

export interface ExecutorBalances {
  sol: number;
  realizedPnlSol: number;
}

export interface ExecutionAdapter {
  readonly mode: TradingMode;
  buy(req: BuyRequest): Promise<TradeResult>;
  sell(req: SellRequest): Promise<TradeResult>;
  getBalances(): ExecutorBalances;
  /** Optional mark-to-market helper for paper price simulation */
  simulatePrice?(mint: string, entryPrice: number, elapsedMs: number): number;
}
