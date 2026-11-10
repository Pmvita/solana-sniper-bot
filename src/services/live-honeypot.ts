// Best-effort live honeypot check via PumpPortal trade-local + RPC simulate
// Honest outcomes: pass | fail | skipped/unknown

import { Keypair } from "@solana/web3.js";
import type { SolanaRpcClient } from "./rpc-client.js";
import { buildTradeLocalTx, slippageBpsToPct } from "./pumpportal-trade.js";

export type LiveHoneypotStatus = "pass" | "fail" | "unknown";

export interface LiveHoneypotResult {
  status: LiveHoneypotStatus;
  buySimOk: boolean | null;
  sellSimOk: boolean | null;
  detail: string;
}

/**
 * Try to build tiny buy + sell txs and simulate them.
 * If we cannot build (API/RPC issues), returns status=unknown — never fakes OK.
 */
export async function checkLiveHoneypot(options: {
  rpc: SolanaRpcClient;
  keypair: Keypair;
  mint: string;
  sampleSol?: number;
  slippageBps: number;
  priorityFeeSol?: number;
}): Promise<LiveHoneypotResult> {
  const sampleSol = options.sampleSol ?? 0.001;
  const priorityFeeSol = options.priorityFeeSol ?? 0.00001;
  const pub = options.keypair.publicKey.toBase58();
  const slippagePct = slippageBpsToPct(options.slippageBps);

  try {
    const buyBuilt = await buildTradeLocalTx({
      publicKey: pub,
      action: "buy",
      mint: options.mint,
      amount: sampleSol,
      denominatedInSol: true,
      slippagePct,
      priorityFeeSol,
      pool: "auto",
    });

    if (!buyBuilt.ok || !buyBuilt.tx) {
      return {
        status: "unknown",
        buySimOk: null,
        sellSimOk: null,
        detail: `buy tx build failed: ${buyBuilt.error ?? "unknown"}`,
      };
    }

    // Sign with our key so simulation can run (sigVerify may still be relaxed by RPC options)
    buyBuilt.tx.sign([options.keypair]);
    const buySim = await options.rpc.simulateTransaction(buyBuilt.tx, true);
    if (buySim.hasError) {
      return {
        status: "fail",
        buySimOk: false,
        sellSimOk: null,
        detail: `buy sim failed: ${String(buySim.error)}`,
      };
    }

    // Sell 100% — may fail if buy wasn't actually executed; treat build/sim issues carefully
    const sellBuilt = await buildTradeLocalTx({
      publicKey: pub,
      action: "sell",
      mint: options.mint,
      amount: "100%",
      denominatedInSol: false,
      slippagePct,
      priorityFeeSol,
      pool: "auto",
    });

    if (!sellBuilt.ok || !sellBuilt.tx) {
      return {
        status: "unknown",
        buySimOk: true,
        sellSimOk: null,
        detail: `sell tx build failed after buy sim OK: ${sellBuilt.error ?? "unknown"} — not treating as pass`,
      };
    }

    sellBuilt.tx.sign([options.keypair]);
    const sellSim = await options.rpc.simulateTransaction(sellBuilt.tx, true);
    if (sellSim.hasError) {
      // Without holding tokens, sell sim often fails — mark unknown rather than hard honeypot
      const err = String(sellSim.error);
      const likelyNoBalance = /insufficient|custom program error|0x1/i.test(err);
      return {
        status: likelyNoBalance ? "unknown" : "fail",
        buySimOk: true,
        sellSimOk: false,
        detail: likelyNoBalance
          ? `sell sim inconclusive (no balance yet): ${err}`
          : `sell sim failed: ${err}`,
      };
    }

    return {
      status: "pass",
      buySimOk: true,
      sellSimOk: true,
      detail: "buy+sell trade-local simulations succeeded",
    };
  } catch (err) {
    return {
      status: "unknown",
      buySimOk: null,
      sellSimOk: null,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}
