// Risk profile definitions — configurable per snipe
export interface RiskProfile {
  name: string;
  maxPositionPct: number; // % of wallet per snipe
  maxSlippageBps: number; // basis points
  priorityFeeMultiplier: number;
  maxJitoTipLamports: number;
  minLiquidityUsd: number; // skip if below
  maxTokenAgeSeconds: number; // skip if older than
  honeypotCheck: boolean;
  stopLossPct: number;
  takeProfitPct: number;
  trailingStopPct: number;
  maxConcurrentPositions: number;
  dailyLossLimitPct: number; // circuit breaker
}

export const RISK_PROFILES: Record<string, RiskProfile> = {
  /** Default for Live Pump.fun sniping (bonding-curve SOL → USD) */
  sniper: {
    name: "sniper",
    maxPositionPct: 3,
    maxSlippageBps: 500,
    priorityFeeMultiplier: 3,
    maxJitoTipLamports: 25000,
    minLiquidityUsd: 75,
    maxTokenAgeSeconds: 120,
    honeypotCheck: true,
    stopLossPct: 20,
    takeProfitPct: 35,
    trailingStopPct: 12,
    maxConcurrentPositions: 2,
    dailyLossLimitPct: 15,
  },
  /** Optional offline / paper-safe profile */
  paper: {
    name: "paper",
    maxPositionPct: 5,
    maxSlippageBps: 300,
    priorityFeeMultiplier: 2,
    maxJitoTipLamports: 10000,
    minLiquidityUsd: 50,
    maxTokenAgeSeconds: 600,
    honeypotCheck: true,
    stopLossPct: 15,
    takeProfitPct: 25,
    trailingStopPct: 10,
    maxConcurrentPositions: 3,
    dailyLossLimitPct: 20,
  },
  conservative: {
    name: "conservative",
    maxPositionPct: 2,
    maxSlippageBps: 100,
    priorityFeeMultiplier: 1.5,
    maxJitoTipLamports: 5000,
    minLiquidityUsd: 500,
    maxTokenAgeSeconds: 300,
    honeypotCheck: true,
    stopLossPct: 10,
    takeProfitPct: 20,
    trailingStopPct: 8,
    maxConcurrentPositions: 1,
    dailyLossLimitPct: 5,
  },
  moderate: {
    name: "moderate",
    maxPositionPct: 5,
    maxSlippageBps: 300,
    priorityFeeMultiplier: 3,
    maxJitoTipLamports: 20000,
    minLiquidityUsd: 200,
    maxTokenAgeSeconds: 600,
    honeypotCheck: true,
    stopLossPct: 25,
    takeProfitPct: 50,
    trailingStopPct: 12,
    maxConcurrentPositions: 3,
    dailyLossLimitPct: 10,
  },
  aggressive: {
    name: "aggressive",
    maxPositionPct: 15,
    maxSlippageBps: 1000,
    priorityFeeMultiplier: 5,
    maxJitoTipLamports: 100000,
    minLiquidityUsd: 50,
    maxTokenAgeSeconds: 1800,
    honeypotCheck: false,
    stopLossPct: 50,
    takeProfitPct: 200,
    trailingStopPct: 20,
    maxConcurrentPositions: 10,
    dailyLossLimitPct: 25,
  },
};

export function getRiskProfile(name: string): RiskProfile {
  const profile = RISK_PROFILES[name];
  if (!profile) throw new Error(`Unknown risk profile: ${name}`);
  return profile;
}

export function listRiskProfiles(): string[] {
  return Object.keys(RISK_PROFILES);
}
