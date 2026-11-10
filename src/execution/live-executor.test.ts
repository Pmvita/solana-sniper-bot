import { describe, expect, it } from "vitest";
import { assertLiveTradingAllowed } from "./live-executor.js";

describe("assertLiveTradingAllowed", () => {
  it("blocks when not confirmed and env off", () => {
    const r = assertLiveTradingAllowed({
      env: { LIVE_TRADING: "false", SOLANA_RPC_URL: "https://api.mainnet-beta.solana.com" },
      privateKey: "abc",
      rpcUrl: "https://api.mainnet-beta.solana.com",
    });
    expect(r.ok).toBe(false);
  });

  it("allows UI liveConfirmed + hot key + rpc", () => {
    const r = assertLiveTradingAllowed({
      env: {},
      privateKey: "secret",
      rpcUrl: "https://api.mainnet-beta.solana.com",
      liveConfirmed: true,
    });
    expect(r.ok).toBe(true);
  });

  it("allows LIVE_TRADING=true in env", () => {
    const r = assertLiveTradingAllowed({
      env: { LIVE_TRADING: "true" },
      privateKey: "secret",
      rpcUrl: "https://api.mainnet-beta.solana.com",
    });
    expect(r.ok).toBe(true);
  });

  it("blocks without wallet key", () => {
    const r = assertLiveTradingAllowed({
      env: { LIVE_TRADING: "true" },
      rpcUrl: "https://api.mainnet-beta.solana.com",
      liveConfirmed: true,
    });
    expect(r.ok).toBe(false);
    expect(r.reasons.some((x) => x.includes("Hot wallet"))).toBe(true);
  });
});
