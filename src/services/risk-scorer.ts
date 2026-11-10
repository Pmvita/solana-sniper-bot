// Risk scorer — evaluates token risk before sniping
// Unknown fields get a small uncertainty penalty instead of hard-failing as "bad"

export interface TokenRiskInput {
  mint: string;
  liquidityUsd: number;
  holderCount: number | null;
  topHolderPct: number | null; // % held by top holder
  tokenAgeSeconds: number;
  hasRenouncedOwnership: boolean | null;
  hasLockedLiquidity: boolean | null;
  taxBuyPct: number;
  taxSellPct: number;
  unknowns?: string[];
}

export interface RiskScore {
  score: number; // 0-100, higher = riskier
  pass: boolean;
  reasons: string[];
}

export function scoreTokenRisk(
  input: TokenRiskInput,
  profile: { minLiquidityUsd: number; maxTokenAgeSeconds: number }
): RiskScore {
  let score = 0;
  const reasons: string[] = [];

  // Liquidity check (0 liquidity from missing data is still a fail vs min)
  if (input.liquidityUsd < profile.minLiquidityUsd) {
    score += 30;
    reasons.push(
      `Low liquidity: $${input.liquidityUsd.toFixed(2)} < $${profile.minLiquidityUsd}`
    );
  }

  // Token age
  if (input.tokenAgeSeconds > profile.maxTokenAgeSeconds) {
    score += 20;
    reasons.push(
      `Token too old: ${input.tokenAgeSeconds.toFixed(0)}s > ${profile.maxTokenAgeSeconds}s`
    );
  }

  // Concentration risk — only when known
  if (input.topHolderPct !== null) {
    if (input.topHolderPct > 20) {
      score += 25;
      reasons.push(`High concentration: top holder owns ${input.topHolderPct}%`);
    }
  } else {
    score += 5;
    reasons.push("Unknown top-holder concentration (soft penalty)");
  }

  // Ownership — unknown is soft; known-false is hard
  if (input.hasRenouncedOwnership === false) {
    score += 15;
    reasons.push("Ownership not renounced");
  } else if (input.hasRenouncedOwnership === null) {
    score += 4;
    reasons.push("Ownership status unknown (soft penalty)");
  }

  // Liquidity lock — unknown soft; known-false hard
  if (input.hasLockedLiquidity === false) {
    score += 20;
    reasons.push("Liquidity not locked");
  } else if (input.hasLockedLiquidity === null) {
    score += 4;
    reasons.push("Liquidity lock unknown (soft penalty)");
  }

  // High taxes
  if (input.taxBuyPct > 5 || input.taxSellPct > 5) {
    score += 15;
    reasons.push(`High tax: buy=${input.taxBuyPct}%, sell=${input.taxSellPct}%`);
  }

  // Holder count — only when known
  if (input.holderCount !== null) {
    if (input.holderCount < 50) {
      score += 10;
      reasons.push(`Low holder count: ${input.holderCount}`);
    }
  } else {
    score += 3;
    reasons.push("Holder count unknown (soft penalty)");
  }

  const pass = score < 50;
  return { score, pass, reasons };
}
