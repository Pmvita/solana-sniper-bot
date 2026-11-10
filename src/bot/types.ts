// Shared bot types and IPC event shapes

export type TradingMode = "paper" | "live";

export type BotLogLevel = "info" | "warn" | "error" | "trade" | "skip" | "debug";

export interface BotLogEvent {
  type: "log";
  level: BotLogLevel;
  message: string;
  ts: number;
}

export interface PositionSnapshot {
  mint: string;
  symbol: string;
  entryPrice: number;
  currentPrice: number;
  amountTokens: number;
  costSol: number;
  unrealizedPnlSol: number;
  unrealizedPnlPct: number;
  takeProfitPct: number;
  stopLossPct: number;
  trailingPct?: number;
  openedAt: number;
  mode: TradingMode;
  priceSource?: string;
}

export interface PositionsEvent {
  type: "positions";
  positions: PositionSnapshot[];
  balanceSol: number;
  realizedPnlSol: number;
  ts: number;
}

export interface StatusEvent {
  type: "status";
  running: boolean;
  mode: TradingMode;
  profile: string;
  circuitBreakerTripped: boolean;
  openPositions: number;
  feed: "pumpportal" | "mock";
  dryRun: boolean;
  ts: number;
}

export interface ErrorEvent {
  type: "error";
  message: string;
  ts: number;
}

export type BotOutboundEvent = BotLogEvent | PositionsEvent | StatusEvent | ErrorEvent;

export interface BotStartCommand {
  type: "start";
  mode?: TradingMode;
  profile?: string;
  rpcUrl?: string;
  fallbackRpcUrl?: string;
  walletBalanceSol?: number;
  solPriceUsd?: number;
  /** ONLY when MOCK_FEED=true / explicit offline test */
  useMockFeed?: boolean;
  liveTrading?: boolean;
  privateKey?: string;
  jitoUrl?: string;
  jitoTipLamports?: number;
  /** Build+simulate buys/sells without broadcasting */
  dryRun?: boolean;
}

export interface BotStopCommand {
  type: "stop";
}

export interface BotPingCommand {
  type: "ping";
}

export type BotInboundCommand = BotStartCommand | BotStopCommand | BotPingCommand;

export interface TradeResult {
  ok: boolean;
  signature?: string;
  mode: TradingMode;
  mint: string;
  side: "buy" | "sell";
  solAmount: number;
  tokenAmount: number;
  price: number;
  reason?: string;
  simulated?: boolean;
}
