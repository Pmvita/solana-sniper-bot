// Live price oracle for open positions (Pump.fun bonding curve + trade ticks)

import WebSocket from "ws";
import { PUMPPORTAL_WS } from "./pumpportal-trade.js";

export interface PriceQuote {
  mint: string;
  priceSolPerToken: number;
  source: "pumpportal-trade" | "bonding-curve" | "entry-fallback";
  ts: number;
}

/**
 * Tracks last-seen SOL-per-token prices from PumpPortal trade events
 * and optional bonding-curve math from create payloads.
 */
export class PriceOracle {
  private prices = new Map<string, PriceQuote>();
  private ws: WebSocket | null = null;
  private intentionalClose = false;
  private subscribed = new Set<string>();

  /** Seed price from create/buy metrics */
  setPrice(mint: string, priceSolPerToken: number, source: PriceQuote["source"] = "bonding-curve"): void {
    if (!mint || !(priceSolPerToken > 0)) return;
    this.prices.set(mint, { mint, priceSolPerToken, source, ts: Date.now() });
  }

  getPrice(mint: string): PriceQuote | undefined {
    return this.prices.get(mint);
  }

  /** Connect (or reuse) PumpPortal WS and subscribe to trades for these mints */
  ensureTradeFeed(mints: string[]): void {
    for (const m of mints) this.subscribed.add(m);
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.sendSubscribe(mints);
      return;
    }
    if (this.ws && this.ws.readyState === WebSocket.CONNECTING) return;

    this.intentionalClose = false;
    this.ws = new WebSocket(PUMPPORTAL_WS);

    this.ws.on("open", () => {
      this.sendSubscribe([...this.subscribed]);
    });

    this.ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString()) as Record<string, unknown>;
        this.ingestTradeMessage(msg);
      } catch {
        // ignore
      }
    });

    this.ws.on("close", () => {
      this.ws = null;
      if (!this.intentionalClose && this.subscribed.size > 0) {
        setTimeout(() => this.ensureTradeFeed([...this.subscribed]), 2000);
      }
    });

    this.ws.on("error", () => {
      // reconnect via close handler
    });
  }

  private sendSubscribe(mints: string[]): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || mints.length === 0) return;
    this.ws.send(
      JSON.stringify({
        method: "subscribeTokenTrade",
        keys: mints,
      })
    );
  }

  private ingestTradeMessage(msg: Record<string, unknown>): void {
    const mint = String(msg.mint ?? "");
    if (!mint || !this.subscribed.has(mint)) return;

    const solAmount = num(msg.solAmount) ?? num(msg.vSolInBondingCurve);
    const tokenAmount =
      num(msg.tokenAmount) ??
      num(msg.vTokensInBondingCurve) ??
      num(msg.tokenAmountOut) ??
      num(msg.tokenAmountIn);

    // Prefer spot from trade: sol / tokens
    const tradeSol = num(msg.solAmount);
    const tradeTok = num(msg.tokenAmount);
    if (tradeSol !== null && tradeTok !== null && tradeTok > 0) {
      this.setPrice(mint, tradeSol / tradeTok, "pumpportal-trade");
      return;
    }

    const vSol = num(msg.vSolInBondingCurve);
    const vTok = num(msg.vTokensInBondingCurve);
    if (vSol !== null && vTok !== null && vTok > 0) {
      this.setPrice(mint, vSol / vTok, "bonding-curve");
      return;
    }

    if (solAmount !== null && tokenAmount !== null && tokenAmount > 0) {
      this.setPrice(mint, solAmount / tokenAmount, "pumpportal-trade");
    }
  }

  /** Resolve mark price for exits; falls back to entry if no live tick yet */
  resolve(mint: string, entryPrice: number): PriceQuote {
    const q = this.prices.get(mint);
    if (q && q.priceSolPerToken > 0) return q;
    return {
      mint,
      priceSolPerToken: entryPrice,
      source: "entry-fallback",
      ts: Date.now(),
    };
  }

  stop(): void {
    this.intentionalClose = true;
    this.ws?.close();
    this.ws = null;
    this.subscribed.clear();
  }
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}
