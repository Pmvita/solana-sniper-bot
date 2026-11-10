import { describe, expect, it } from "vitest";
import { scoreTokenRisk } from "./risk-scorer.js";

describe("scoreTokenRisk", () => {
  it("does not hard-fail solely on unknown ownership/lock", () => {
    const result = scoreTokenRisk(
      {
        mint: "x",
        liquidityUsd: 5000,
        holderCount: null,
        topHolderPct: null,
        tokenAgeSeconds: 5,
        hasRenouncedOwnership: null,
        hasLockedLiquidity: true,
        taxBuyPct: 0,
        taxSellPct: 0,
      },
      { minLiquidityUsd: 50, maxTokenAgeSeconds: 600 }
    );
    expect(result.pass).toBe(true);
    expect(result.score).toBeLessThan(50);
  });

  it("fails high sell tax + low liquidity", () => {
    const result = scoreTokenRisk(
      {
        mint: "y",
        liquidityUsd: 10,
        holderCount: 1,
        topHolderPct: 90,
        tokenAgeSeconds: 1,
        hasRenouncedOwnership: false,
        hasLockedLiquidity: false,
        taxBuyPct: 0,
        taxSellPct: 20,
      },
      { minLiquidityUsd: 1000, maxTokenAgeSeconds: 300 }
    );
    expect(result.pass).toBe(false);
  });
});
