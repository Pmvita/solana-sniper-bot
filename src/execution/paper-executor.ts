// Paper executor — simulated balances, buys, sells, and price paths

import type { ExecutionAdapter, BuyRequest, SellRequest, ExecutorBalances } from "./adapter.js";
import type { TradeResult } from "../bot/types.js";

export class PaperExecutor implements ExecutionAdapter {
  readonly mode = "paper" as const;
  private sol: number;
  private realizedPnlSol = 0;
  private holdings = new Map<string, number>();

  constructor(initialSol: number) {
    this.sol = initialSol;
  }

  async buy(req: BuyRequest): Promise<TradeResult> {
    if (req.solAmount <= 0) {
      return {
        ok: false,
        mode: "paper",
        mint: req.mint,
        side: "buy",
        solAmount: 0,
        tokenAmount: 0,
        price: req.priceSolPerToken,
        reason: "Invalid buy size",
        simulated: true,
      };
    }
    if (this.sol < req.solAmount) {
      return {
        ok: false,
        mode: "paper",
        mint: req.mint,
        side: "buy",
        solAmount: req.solAmount,
        tokenAmount: 0,
        price: req.priceSolPerToken,
        reason: `Insufficient paper SOL (${this.sol.toFixed(4)} < ${req.solAmount.toFixed(4)})`,
        simulated: true,
      };
    }

    // Apply slippage as slightly worse fill
    const slip = 1 + req.slippageBps / 10_000;
    const effectivePrice = req.priceSolPerToken * slip;
    const tokenAmount = effectivePrice > 0 ? req.solAmount / effectivePrice : 0;

    this.sol -= req.solAmount;
    this.holdings.set(req.mint, (this.holdings.get(req.mint) ?? 0) + tokenAmount);

    return {
      ok: true,
      signature: `paper-buy-${Date.now()}`,
      mode: "paper",
      mint: req.mint,
      side: "buy",
      solAmount: req.solAmount,
      tokenAmount,
      price: effectivePrice,
      simulated: true,
    };
  }

  async sell(req: SellRequest): Promise<TradeResult> {
    const held = this.holdings.get(req.mint) ?? 0;
    const sellAmt = Math.min(req.tokenAmount, held);
    if (sellAmt <= 0) {
      return {
        ok: false,
        mode: "paper",
        mint: req.mint,
        side: "sell",
        solAmount: 0,
        tokenAmount: 0,
        price: req.priceSolPerToken,
        reason: "No paper tokens to sell",
        simulated: true,
      };
    }

    const solOut = sellAmt * req.priceSolPerToken;
    this.sol += solOut;
    const remaining = held - sellAmt;
    if (remaining <= 1e-12) this.holdings.delete(req.mint);
    else this.holdings.set(req.mint, remaining);

    return {
      ok: true,
      signature: `paper-sell-${Date.now()}`,
      mode: "paper",
      mint: req.mint,
      side: "sell",
      solAmount: solOut,
      tokenAmount: sellAmt,
      price: req.priceSolPerToken,
      reason: req.reason,
      simulated: true,
    };
  }

  recordRealizedPnl(deltaSol: number): void {
    this.realizedPnlSol += deltaSol;
  }

  getBalances(): ExecutorBalances {
    return { sol: this.sol, realizedPnlSol: this.realizedPnlSol };
  }

  getTokenBalance(mint: string): number {
    return this.holdings.get(mint) ?? 0;
  }

  /**
   * Deterministic synthetic price path (same mint+elapsed → same price).
   * Mild oscillation + drift so TP/SL/trailing can fire in paper demos.
   */
  simulatePrice(mint: string, entryPrice: number, elapsedMs: number): number {
    let hash = 2166136261;
    for (let i = 0; i < mint.length; i++) {
      hash ^= mint.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    const n = (hash >>> 0) / 0xffffffff;
    const t = elapsedMs / 1000;
    const pump = Math.sin(t / 6 + n * 6) * 0.18;
    const drift = Math.min(1.2, t / 40) * (n > 0.4 ? 0.55 : -0.25);
    // Periodic soft shocks so stop-loss / take-profit both appear in demos
    const wave = Math.sin(t / 11 + n) * 0.12;
    const mult = Math.max(0.05, 1 + pump + drift + wave);
    return entryPrice * mult;
  }
}
