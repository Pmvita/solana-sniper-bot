// Sniper strategy — core snipe evaluation

import { RiskProfile } from "../config/risk-profiles.js";
import { SolanaRpcClient } from "../services/rpc-client.js";
import { scoreTokenRisk, TokenRiskInput } from "../services/risk-scorer.js";
import { CircuitBreaker } from "../safety/circuit-breaker.js";
import { PositionLimiter } from "../safety/position-limiter.js";

export interface SnipeTarget {
  mint: string;
  liquidityUsd: number;
  tokenAgeSeconds: number;
  riskInput: TokenRiskInput;
}

export interface SnipeEvaluation {
  shouldSnipe: boolean;
  reasons: string[];
  riskScore: number;
}

export class Sniper {
  private rpc: SolanaRpcClient;
  private circuitBreaker: CircuitBreaker;
  private positionLimiter: PositionLimiter;
  private profile: RiskProfile;

  constructor(rpc: SolanaRpcClient, profile: RiskProfile, walletBalanceSol: number) {
    this.rpc = rpc;
    this.profile = profile;
    this.circuitBreaker = new CircuitBreaker(profile.dailyLossLimitPct, walletBalanceSol);
    this.positionLimiter = new PositionLimiter(profile.maxConcurrentPositions);
  }

  setProfile(profile: RiskProfile, walletBalanceSol: number): void {
    this.profile = profile;
    this.circuitBreaker = new CircuitBreaker(profile.dailyLossLimitPct, walletBalanceSol);
    this.positionLimiter = new PositionLimiter(profile.maxConcurrentPositions);
  }

  async evaluate(target: SnipeTarget): Promise<SnipeEvaluation> {
    if (this.circuitBreaker.isTripped()) {
      return {
        shouldSnipe: false,
        reasons: ["Circuit breaker tripped — daily loss limit reached"],
        riskScore: 100,
      };
    }

    if (!this.positionLimiter.canOpen()) {
      return {
        shouldSnipe: false,
        reasons: ["Max concurrent positions reached"],
        riskScore: 100,
      };
    }

    const risk = scoreTokenRisk(target.riskInput, {
      minLiquidityUsd: this.profile.minLiquidityUsd,
      maxTokenAgeSeconds: this.profile.maxTokenAgeSeconds,
    });

    if (!risk.pass) {
      return { shouldSnipe: false, reasons: risk.reasons, riskScore: risk.score };
    }

    if (target.liquidityUsd < this.profile.minLiquidityUsd) {
      return {
        shouldSnipe: false,
        reasons: [`Liquidity too low: $${target.liquidityUsd.toFixed(2)}`],
        riskScore: risk.score,
      };
    }

    if (target.tokenAgeSeconds > this.profile.maxTokenAgeSeconds) {
      return {
        shouldSnipe: false,
        reasons: [`Token too old: ${target.tokenAgeSeconds.toFixed(0)}s`],
        riskScore: risk.score,
      };
    }

    return {
      shouldSnipe: true,
      reasons: ["All checks passed", ...risk.reasons.filter((r) => r.includes("soft"))],
      riskScore: risk.score,
    };
  }

  getProfile(): RiskProfile {
    return this.profile;
  }

  getCircuitBreaker(): CircuitBreaker {
    return this.circuitBreaker;
  }

  getPositionLimiter(): PositionLimiter {
    return this.positionLimiter;
  }

  /** Expose rpc for live honeypot sims later */
  getRpc(): SolanaRpcClient {
    return this.rpc;
  }
}
