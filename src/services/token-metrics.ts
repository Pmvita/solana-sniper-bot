// Enrich PumpPortal / mock token events into risk inputs with safe unknowns

import type { NewTokenEvent } from "./token-detector.js";
import type { TokenRiskInput } from "./risk-scorer.js";

const DEFAULT_SOL_PRICE_USD = 150;

export interface EnrichedTokenMetrics {
  mint: string;
  name: string;
  symbol: string;
  creator: string;
  timestamp: number;
  liquiditySol: number | null;
  liquidityUsd: number;
  tokenAgeSeconds: number;
  entryPriceSolPerToken: number;
  riskInput: TokenRiskInput;
  unknowns: string[];
}

function numOrNull(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) {
    return Number(v);
  }
  return null;
}

/**
 * Build risk metrics from a new-token event.
 * Known fields are used; missing fields are marked unknown (null) so the
 * scorer does not treat absence as a hard failure.
 */
export function enrichTokenMetrics(
  token: NewTokenEvent,
  solPriceUsd = DEFAULT_SOL_PRICE_USD,
  raw?: Record<string, unknown>
): EnrichedTokenMetrics {
  const unknowns: string[] = [];
  const now = Date.now();
  const createdAt = token.timestamp || now;
  const tokenAgeSeconds = Math.max(0, (now - createdAt) / 1000);

  const liquiditySol =
    numOrNull(token.initialLiquiditySol) ??
    numOrNull(raw?.solAmount) ??
    numOrNull(raw?.initialBuy) ??
    numOrNull(raw?.vSolInBondingCurve) ??
    null;

  if (liquiditySol === null) unknowns.push("liquiditySol");

  const liquidityUsd =
    liquiditySol !== null ? liquiditySol * solPriceUsd : 0;

  const marketCapSol = numOrNull(raw?.marketCapSol);
  const vTokens = numOrNull(raw?.vTokensInBondingCurve);
  const vSol = numOrNull(raw?.vSolInBondingCurve) ?? liquiditySol;

  let entryPriceSolPerToken = 0;
  if (vSol !== null && vTokens !== null && vTokens > 0) {
    entryPriceSolPerToken = vSol / vTokens;
  } else if (liquiditySol !== null && liquiditySol > 0) {
    // Pump.fun style rough: assume ~1B token supply for paper pricing
    entryPriceSolPerToken = liquiditySol / 1_000_000_000;
  } else {
    entryPriceSolPerToken = 0.000000001;
    unknowns.push("entryPrice");
  }

  const holderCount = numOrNull(raw?.holderCount);
  if (holderCount === null) unknowns.push("holderCount");

  const topHolderPct = numOrNull(raw?.topHolderPct);
  if (topHolderPct === null) unknowns.push("topHolderPct");

  // Pump.fun bonding-curve launches: ownership/LP lock often N/A → unknown
  const hasRenouncedOwnership =
    typeof raw?.hasRenouncedOwnership === "boolean"
      ? raw.hasRenouncedOwnership
      : null;
  if (hasRenouncedOwnership === null) unknowns.push("hasRenouncedOwnership");

  const hasLockedLiquidity =
    typeof raw?.hasLockedLiquidity === "boolean"
      ? raw.hasLockedLiquidity
      : liquiditySol !== null
        ? true // bonding curve / pool exists → treat as "locked" for paper
        : null;
  if (hasLockedLiquidity === null) unknowns.push("hasLockedLiquidity");

  const taxBuyPct = numOrNull(raw?.taxBuyPct) ?? 0;
  const taxSellPct = numOrNull(raw?.taxSellPct) ?? 0;

  const riskInput: TokenRiskInput = {
    mint: token.mint,
    liquidityUsd,
    holderCount,
    topHolderPct,
    tokenAgeSeconds,
    hasRenouncedOwnership,
    hasLockedLiquidity,
    taxBuyPct,
    taxSellPct,
    unknowns,
  };

  return {
    mint: token.mint,
    name: token.name,
    symbol: token.symbol || token.mint.slice(0, 6),
    creator: token.creator,
    timestamp: createdAt,
    liquiditySol,
    liquidityUsd,
    tokenAgeSeconds,
    entryPriceSolPerToken,
    riskInput,
    unknowns,
  };
}

export { DEFAULT_SOL_PRICE_USD };
