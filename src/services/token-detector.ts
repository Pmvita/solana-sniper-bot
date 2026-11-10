// Token detector — live PumpPortal WebSocket (default) + optional mock for offline tests

import WebSocket from "ws";
import { EventEmitter } from "node:events";
import { PUMPPORTAL_WS } from "./pumpportal-trade.js";

export interface NewTokenEvent {
  mint: string;
  name: string;
  symbol: string;
  creator: string;
  timestamp: number;
  initialLiquiditySol?: number;
  raw?: Record<string, unknown>;
}

export type TokenCallback = (token: NewTokenEvent) => void;

export class TokenDetector extends EventEmitter {
  private ws: WebSocket | null = null;
  private callbacks: TokenCallback[] = [];
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 20;
  private mockTimer: ReturnType<typeof setInterval> | null = null;
  private intentionalClose = false;
  private mockMode = false;

  onNewToken(cb: TokenCallback): void {
    this.callbacks.push(cb);
  }

  inject(token: NewTokenEvent): void {
    for (const cb of this.callbacks) {
      try {
        cb(token);
      } catch {
        // ignore listener errors
      }
    }
  }

  connect(options?: { mock?: boolean }): void {
    this.intentionalClose = false;
    this.mockMode = options?.mock === true;

    if (this.mockMode) {
      this.startMockFeed();
      return;
    }

    this.ws = new WebSocket(PUMPPORTAL_WS);

    this.ws.on("open", () => {
      console.log(`[TokenDetector] Connected to ${PUMPPORTAL_WS}`);
      this.reconnectAttempts = 0;
      this.ws?.send(JSON.stringify({ method: "subscribeNewToken" }));
      this.emit("connected");
    });

    this.ws.on("message", (data: WebSocket.Data) => {
      try {
        const msg = JSON.parse(data.toString()) as Record<string, unknown>;
        // New launches: subscribeNewToken payloads (txType/create or method newToken)
        if (msg.method === "newToken" || msg.type === "create" || msg.txType === "create") {
          const token = this.parseMessage(msg);
          if (token.mint) this.inject(token);
        }
      } catch {
        // ignore parse errors
      }
    });

    this.ws.on("close", () => {
      console.log("[TokenDetector] WebSocket closed");
      this.emit("disconnected");
      if (!this.intentionalClose) this.reconnect();
    });

    this.ws.on("error", (err) => {
      console.error("[TokenDetector] WebSocket error:", err.message);
      this.emit("error", err);
    });
  }

  private parseMessage(msg: Record<string, unknown>): NewTokenEvent {
    const solAmount =
      num(msg.solAmount) ??
      num(msg.initialBuy) ??
      num(msg.vSolInBondingCurve) ??
      undefined;

    return {
      mint: String(msg.mint ?? msg.tokenAddress ?? ""),
      name: String(msg.name ?? ""),
      symbol: String(msg.symbol ?? ""),
      creator: String(msg.creator ?? msg.traderPublicKey ?? ""),
      timestamp: Date.now(),
      initialLiquiditySol: solAmount,
      raw: msg,
    };
  }

  private startMockFeed(): void {
    console.log("[TokenDetector] MOCK feed (offline test only)");
    this.emit("connected");
    let i = 0;
    const push = () => {
      i += 1;
      const solLiq = 0.5 + (i % 5) * 0.8;
      const mint = `MockMint${i}${Date.now().toString(36)}`.slice(0, 32);
      this.inject({
        mint,
        name: `Offline Token ${i}`,
        symbol: i % 7 === 0 ? "HONEYPOT" : `OFF${i}`,
        creator: "MockCreator1111111111111111111111111",
        timestamp: Date.now(),
        initialLiquiditySol: solLiq,
        raw: {
          solAmount: solLiq,
          vSolInBondingCurve: solLiq,
          vTokensInBondingCurve: 1_000_000_000,
          marketCapSol: solLiq * 2,
          taxBuyPct: 0,
          taxSellPct: i % 7 === 0 ? 99 : 0,
        },
      });
    };
    push();
    this.mockTimer = setInterval(push, 4000);
  }

  private reconnect(): void {
    if (this.mockMode || this.intentionalClose) return;
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error("[TokenDetector] Max reconnect attempts reached");
      return;
    }
    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    setTimeout(() => this.connect({ mock: false }), delay);
  }

  disconnect(): void {
    this.intentionalClose = true;
    if (this.mockTimer) {
      clearInterval(this.mockTimer);
      this.mockTimer = null;
    }
    this.ws?.close();
    this.ws = null;
  }
}

function num(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return undefined;
}
