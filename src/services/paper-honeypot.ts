// Paper / heuristic honeypot check when we do not have real buy+sell txs yet

import type { TokenRiskInput } from "./risk-scorer.js";
import type { HoneypotResult } from "./honeypot-checker.js";

export interface PaperHoneypotInput {
  risk: TokenRiskInput;
  liquiditySol: number | null;
  symbol: string;
}

/**
 * Lightweight sellability heuristic for paper mode.
 * Flags obvious red patterns; otherwise passes with simulated OK.
 */
export function checkPaperHoneypot(input: PaperHoneypotInput): HoneypotResult {
  const { risk, liquiditySol, symbol } = input;

  if (risk.taxSellPct > 10) {
    return {
      isHoneypot: true,
      buySimOk: true,
      sellSimOk: false,
      sellError: `Sell tax ${risk.taxSellPct}% looks unsellable`,
    };
  }

  if (risk.taxBuyPct > 25) {
    return {
      isHoneypot: true,
      buySimOk: false,
      sellSimOk: false,
      buyError: `Buy tax ${risk.taxBuyPct}% extreme`,
    };
  }

  if (liquiditySol !== null && liquiditySol < 0.01) {
    return {
      isHoneypot: true,
      buySimOk: false,
      sellSimOk: false,
      buyError: "Near-zero liquidity — likely unsellable",
    };
  }

  // Suspicious ticker patterns (very soft)
  const sym = symbol.toUpperCase();
  if (/(HONEYPOT|SCAM|RUG)/.test(sym)) {
    return {
      isHoneypot: true,
      buySimOk: true,
      sellSimOk: false,
      sellError: "Suspicious symbol name",
    };
  }

  return {
    isHoneypot: false,
    buySimOk: true,
    sellSimOk: true,
    estimatedOutput: 1n,
  };
}
