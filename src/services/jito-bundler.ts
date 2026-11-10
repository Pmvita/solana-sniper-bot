// Jito bundler — MEV protection via Jito block engine

import { VersionedTransaction } from "@solana/web3.js";

export interface JitoConfig {
  blockEngineUrl: string;
  tipLamports: number;
}

export class JitoBundler {
  private config: JitoConfig;

  constructor(config: JitoConfig) {
    this.config = config;
  }

  // Send a single transaction via Jito bundle (with tip)
  async sendBundle(tx: VersionedTransaction): Promise<string> {
    const serialized = Buffer.from(tx.serialize()).toString("base64");

    const response = await fetch(`${this.config.blockEngineUrl}/api/v1/bundles`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "sendBundle",
        params: [[serialized], { encoding: "base64" }],
      }),
    });

    const data = (await response.json()) as { result?: string; error?: { message: string } };
    if (data.error) throw new Error(`Jito bundle failed: ${data.error.message}`);
    return data.result ?? "";
  }

  // Check bundle status
  async getBundleStatus(bundleId: string): Promise<{ status: string; landed: boolean }> {
    const response = await fetch(`${this.config.blockEngineUrl}/api/v1/bundles`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getBundleStatuses",
        params: [[bundleId]],
      }),
    });

    const data = (await response.json()) as {
      result?: { value?: Array<{ confirmation_status: string }> };
    };
    const status = data.result?.value?.[0]?.confirmation_status ?? "unknown";
    return { status, landed: status === "confirmed" || status === "finalized" };
  }

  getTipLamports(): number {
    return this.config.tipLamports;
  }
}