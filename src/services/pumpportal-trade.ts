// PumpPortal Local Transaction API
// Docs: https://pumpportal.fun/local-trading-api/trading-api/
// POST https://pumpportal.fun/api/trade-local → serialized VersionedTransaction (unsigned)
// You sign + send with your own RPC. Works for fresh Pump.fun bonding-curve mints.

import { VersionedTransaction } from "@solana/web3.js";

export const PUMPPORTAL_TRADE_LOCAL = "https://pumpportal.fun/api/trade-local";
export const PUMPPORTAL_WS = "wss://pumpportal.fun/api/data";

export type PumpPool =
  | "pump"
  | "raydium"
  | "pump-amm"
  | "launchlab"
  | "raydium-cpmm"
  | "bonk"
  | "auto";

export interface TradeLocalParams {
  publicKey: string;
  action: "buy" | "sell";
  mint: string;
  amount: number | string;
  denominatedInSol: boolean;
  slippagePct: number;
  priorityFeeSol: number;
  pool?: PumpPool;
}

export interface TradeLocalResult {
  ok: boolean;
  tx?: VersionedTransaction;
  status: number;
  error?: string;
  rawBytes?: Uint8Array;
}

/**
 * Build an unsigned swap tx via PumpPortal trade-local.
 * Response body is raw serialized VersionedTransaction bytes (not JSON).
 */
export async function buildTradeLocalTx(params: TradeLocalParams): Promise<TradeLocalResult> {
  const body = {
    publicKey: params.publicKey,
    action: params.action,
    mint: params.mint,
    amount: params.amount,
    denominatedInSol: params.denominatedInSol ? "true" : "false",
    slippage: params.slippagePct,
    priorityFee: params.priorityFeeSol,
    pool: params.pool ?? "auto",
  };

  const response = await fetch(PUMPPORTAL_TRADE_LOCAL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (response.status !== 200) {
    let error = response.statusText;
    try {
      const text = await response.text();
      if (text) error = text.slice(0, 500);
    } catch {
      // ignore
    }
    return { ok: false, status: response.status, error };
  }

  const buf = new Uint8Array(await response.arrayBuffer());
  try {
    const tx = VersionedTransaction.deserialize(buf);
    return { ok: true, tx, status: 200, rawBytes: buf };
  } catch (err) {
    return {
      ok: false,
      status: 200,
      error: `Failed to deserialize trade-local tx: ${err instanceof Error ? err.message : String(err)}`,
      rawBytes: buf,
    };
  }
}

export function slippageBpsToPct(bps: number): number {
  return Math.max(0.1, bps / 100);
}
