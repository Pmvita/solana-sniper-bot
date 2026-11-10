// Live executor — PumpPortal trade-local (primary) + Jupiter fallback
// Docs: https://pumpportal.fun/local-trading-api/trading-api/
// Never logs private keys.

import {
  Connection,
  Keypair,
  VersionedTransaction,
} from "@solana/web3.js";
import bs58 from "bs58";
import type { ExecutionAdapter, BuyRequest, SellRequest, ExecutorBalances } from "./adapter.js";
import type { TradeResult } from "../bot/types.js";
import type { JitoBundler } from "../services/jito-bundler.js";
import {
  buildTradeLocalTx,
  slippageBpsToPct,
  type TradeLocalResult,
} from "../services/pumpportal-trade.js";

const JUPITER_QUOTE = "https://quote-api.jup.ag/v6/quote";
const JUPITER_SWAP = "https://quote-api.jup.ag/v6/swap";
const WSOL = "So11111111111111111111111111111111111111112";
const LAMPORTS_PER_SOL = 1_000_000_000;

export interface LiveExecutorConfig {
  rpcUrl: string;
  privateKeyBase58: string;
  jito?: JitoBundler | null;
  /** If true, build+simulate only — do not broadcast */
  dryRun?: boolean;
  priorityFeeSol?: number;
}

export function assertLiveTradingAllowed(options?: {
  env?: NodeJS.ProcessEnv;
  privateKey?: string;
  rpcUrl?: string;
  /** Explicit UI confirm counts as LIVE_TRADING opt-in */
  liveConfirmed?: boolean;
}): {
  ok: boolean;
  reasons: string[];
} {
  const env = options?.env ?? process.env;
  const reasons: string[] = [];
  const liveFlag =
    options?.liveConfirmed === true ||
    env.LIVE_TRADING === "true" ||
    env.LIVE === "true";
  if (!liveFlag) {
    reasons.push("Live not confirmed (set LIVE_TRADING=true or confirm Live in desktop)");
  }
  const key = (options?.privateKey ?? env.PRIVATE_KEY ?? "").trim();
  if (!key) {
    reasons.push("Hot wallet not loaded and PRIVATE_KEY missing");
  }
  const rpc = (options?.rpcUrl ?? env.SOLANA_RPC_URL ?? "").trim();
  if (!rpc || rpc.includes("YOUR_KEY")) {
    reasons.push("SOLANA_RPC_URL is missing or still a placeholder");
  }
  return { ok: reasons.length === 0, reasons };
}

export class LiveExecutor implements ExecutionAdapter {
  readonly mode = "live" as const;
  private connection: Connection;
  private keypair: Keypair;
  private jito: JitoBundler | null;
  private dryRun: boolean;
  private priorityFeeSol: number;
  private realizedPnlSol = 0;
  private cachedSol = 0;
  private tokenBalances = new Map<string, number>();

  constructor(config: LiveExecutorConfig) {
    this.connection = new Connection(config.rpcUrl, "confirmed");
    this.keypair = Keypair.fromSecretKey(bs58.decode(config.privateKeyBase58));
    this.jito = config.jito ?? null;
    this.dryRun = config.dryRun === true;
    this.priorityFeeSol = config.priorityFeeSol ?? 0.00005;
  }

  getPublicKey(): string {
    return this.keypair.publicKey.toBase58();
  }

  getKeypair(): Keypair {
    return this.keypair;
  }

  isDryRun(): boolean {
    return this.dryRun;
  }

  async buy(req: BuyRequest): Promise<TradeResult> {
    const portal = await this.pumpPortalSwap({
      side: "buy",
      mint: req.mint,
      amount: req.solAmount,
      denominatedInSol: true,
      slippageBps: req.slippageBps,
      fallbackPrice: req.priceSolPerToken,
    });
    if (portal.ok) return portal;

    try {
      const lamports = Math.floor(req.solAmount * LAMPORTS_PER_SOL);
      const quote = await this.fetchQuote(WSOL, req.mint, lamports, req.slippageBps);
      if (!quote) {
        return this.fail(
          "buy",
          req.mint,
          req.solAmount,
          0,
          req.priceSolPerToken,
          `PumpPortal: ${portal.reason}; Jupiter quote failed`
        );
      }
      const sig = await this.sendJupiterSwap(quote);
      const outAmt = Number(quote.outAmount ?? 0);
      const price = outAmt > 0 ? req.solAmount / outAmt : req.priceSolPerToken;
      this.cachedSol = Math.max(0, this.cachedSol - req.solAmount);
      this.tokenBalances.set(req.mint, (this.tokenBalances.get(req.mint) ?? 0) + outAmt);
      return {
        ok: true,
        signature: sig,
        mode: "live",
        mint: req.mint,
        side: "buy",
        solAmount: req.solAmount,
        tokenAmount: outAmt,
        price,
        reason: "jupiter",
        simulated: this.dryRun,
      };
    } catch (err) {
      return this.fail(
        "buy",
        req.mint,
        req.solAmount,
        0,
        req.priceSolPerToken,
        `PumpPortal: ${portal.reason}; Jupiter: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  async sell(req: SellRequest): Promise<TradeResult> {
    const portal = await this.pumpPortalSwap({
      side: "sell",
      mint: req.mint,
      amount: "100%",
      denominatedInSol: false,
      slippageBps: 800,
      fallbackPrice: req.priceSolPerToken,
      tokenAmountHint: req.tokenAmount,
      sellReason: req.reason,
    });
    if (portal.ok) {
      this.tokenBalances.delete(req.mint);
      return portal;
    }

    try {
      const amount = Math.floor(req.tokenAmount);
      const quote = await this.fetchQuote(req.mint, WSOL, amount, 800);
      if (!quote) {
        return this.fail(
          "sell",
          req.mint,
          0,
          req.tokenAmount,
          req.priceSolPerToken,
          `PumpPortal: ${portal.reason}; Jupiter quote failed`
        );
      }
      const sig = await this.sendJupiterSwap(quote);
      const solOut = Number(quote.outAmount ?? 0) / LAMPORTS_PER_SOL;
      this.cachedSol += solOut;
      this.tokenBalances.delete(req.mint);
      return {
        ok: true,
        signature: sig,
        mode: "live",
        mint: req.mint,
        side: "sell",
        solAmount: solOut,
        tokenAmount: req.tokenAmount,
        price: req.priceSolPerToken,
        reason: `${req.reason}|jupiter`,
        simulated: this.dryRun,
      };
    } catch (err) {
      return this.fail(
        "sell",
        req.mint,
        0,
        req.tokenAmount,
        req.priceSolPerToken,
        `PumpPortal: ${portal.reason}; Jupiter: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  getBalances(): ExecutorBalances {
    return { sol: this.cachedSol, realizedPnlSol: this.realizedPnlSol };
  }

  recordRealizedPnl(delta: number): void {
    this.realizedPnlSol += delta;
  }

  async refreshSolBalance(): Promise<number> {
    const lamports = await this.connection.getBalance(this.keypair.publicKey);
    this.cachedSol = lamports / LAMPORTS_PER_SOL;
    return this.cachedSol;
  }

  async dryBuildBuy(mint: string, solAmount: number, slippageBps: number): Promise<TradeLocalResult> {
    return buildTradeLocalTx({
      publicKey: this.keypair.publicKey.toBase58(),
      action: "buy",
      mint,
      amount: solAmount,
      denominatedInSol: true,
      slippagePct: slippageBpsToPct(slippageBps),
      priorityFeeSol: this.priorityFeeSol,
      pool: "auto",
    });
  }

  private async pumpPortalSwap(opts: {
    side: "buy" | "sell";
    mint: string;
    amount: number | string;
    denominatedInSol: boolean;
    slippageBps: number;
    fallbackPrice: number;
    tokenAmountHint?: number;
    sellReason?: string;
  }): Promise<TradeResult> {
    try {
      const built = await buildTradeLocalTx({
        publicKey: this.keypair.publicKey.toBase58(),
        action: opts.side,
        mint: opts.mint,
        amount: opts.amount,
        denominatedInSol: opts.denominatedInSol,
        slippagePct: slippageBpsToPct(opts.slippageBps),
        priorityFeeSol: this.priorityFeeSol,
        pool: "auto",
      });

      if (!built.ok || !built.tx) {
        return this.fail(
          opts.side,
          opts.mint,
          typeof opts.amount === "number" && opts.denominatedInSol ? opts.amount : 0,
          opts.tokenAmountHint ?? 0,
          opts.fallbackPrice,
          built.error ?? "trade-local build failed"
        );
      }

      built.tx.sign([this.keypair]);

      if (this.dryRun) {
        const sim = await this.connection.simulateTransaction(built.tx, {
          replaceRecentBlockhash: true,
          commitment: "confirmed",
        });
        if (sim.value.err) {
          return this.fail(
            opts.side,
            opts.mint,
            typeof opts.amount === "number" && opts.denominatedInSol ? opts.amount : 0,
            opts.tokenAmountHint ?? 0,
            opts.fallbackPrice,
            `dry-run sim failed: ${JSON.stringify(sim.value.err)}`
          );
        }
        const solAmount =
          opts.side === "buy" && typeof opts.amount === "number" ? opts.amount : 0;
        const tokenAmount =
          opts.side === "buy" && opts.fallbackPrice > 0
            ? solAmount / opts.fallbackPrice
            : opts.tokenAmountHint ?? 0;
        return {
          ok: true,
          signature: `dry-run-pumpportal-${Date.now()}`,
          mode: "live",
          mint: opts.mint,
          side: opts.side,
          solAmount:
            opts.side === "sell"
              ? (opts.tokenAmountHint ?? 0) * opts.fallbackPrice
              : solAmount,
          tokenAmount,
          price: opts.fallbackPrice,
          reason: `pumpportal-trade-local|dry-run|${opts.sellReason ?? ""}`,
          simulated: true,
        };
      }

      let signature: string;
      if (this.jito) {
        try {
          signature = await this.jito.sendBundle(built.tx);
        } catch {
          signature = await this.connection.sendTransaction(built.tx, {
            skipPreflight: false,
            maxRetries: 3,
          });
        }
      } else {
        signature = await this.connection.sendTransaction(built.tx, {
          skipPreflight: false,
          maxRetries: 3,
        });
      }

      try {
        await this.connection.confirmTransaction(signature, "confirmed");
      } catch {
        // may land later
      }

      if (opts.side === "buy" && typeof opts.amount === "number") {
        const tokenAmount = opts.fallbackPrice > 0 ? opts.amount / opts.fallbackPrice : 0;
        this.cachedSol = Math.max(0, this.cachedSol - opts.amount);
        this.tokenBalances.set(
          opts.mint,
          (this.tokenBalances.get(opts.mint) ?? 0) + tokenAmount
        );
        return {
          ok: true,
          signature,
          mode: "live",
          mint: opts.mint,
          side: "buy",
          solAmount: opts.amount,
          tokenAmount,
          price: opts.fallbackPrice,
          reason: "pumpportal-trade-local",
        };
      }

      const tokenAmount = opts.tokenAmountHint ?? 0;
      const solOut = tokenAmount * opts.fallbackPrice;
      this.cachedSol += solOut;
      return {
        ok: true,
        signature,
        mode: "live",
        mint: opts.mint,
        side: "sell",
        solAmount: solOut,
        tokenAmount,
        price: opts.fallbackPrice,
        reason: `pumpportal-trade-local|${opts.sellReason ?? ""}`,
      };
    } catch (err) {
      return this.fail(
        opts.side,
        opts.mint,
        typeof opts.amount === "number" && opts.denominatedInSol ? opts.amount : 0,
        opts.tokenAmountHint ?? 0,
        opts.fallbackPrice,
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  private fail(
    side: "buy" | "sell",
    mint: string,
    solAmount: number,
    tokenAmount: number,
    price: number,
    reason: string
  ): TradeResult {
    return {
      ok: false,
      mode: "live",
      mint,
      side,
      solAmount,
      tokenAmount,
      price,
      reason,
    };
  }

  private async fetchQuote(
    inputMint: string,
    outputMint: string,
    amount: number,
    slippageBps: number
  ): Promise<Record<string, unknown> | null> {
    const url = new URL(JUPITER_QUOTE);
    url.searchParams.set("inputMint", inputMint);
    url.searchParams.set("outputMint", outputMint);
    url.searchParams.set("amount", String(amount));
    url.searchParams.set("slippageBps", String(slippageBps));
    const res = await fetch(url);
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  }

  private async sendJupiterSwap(quote: Record<string, unknown>): Promise<string> {
    if (this.dryRun) return `dry-run-jupiter-${Date.now()}`;

    const res = await fetch(JUPITER_SWAP, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        quoteResponse: quote,
        userPublicKey: this.keypair.publicKey.toBase58(),
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
      }),
    });
    if (!res.ok) throw new Error(`Jupiter swap HTTP ${res.status}`);
    const data = (await res.json()) as { swapTransaction?: string };
    if (!data.swapTransaction) throw new Error("No swapTransaction from Jupiter");

    const tx = VersionedTransaction.deserialize(Buffer.from(data.swapTransaction, "base64"));
    tx.sign([this.keypair]);

    if (this.jito) {
      try {
        return await this.jito.sendBundle(tx);
      } catch {
        // fall through
      }
    }
    return this.connection.sendTransaction(tx, { skipPreflight: false });
  }
}
