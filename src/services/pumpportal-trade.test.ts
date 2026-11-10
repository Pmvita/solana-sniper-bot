import { describe, expect, it } from "vitest";
import { slippageBpsToPct, PUMPPORTAL_TRADE_LOCAL, PUMPPORTAL_WS } from "./pumpportal-trade.js";

describe("pumpportal-trade helpers", () => {
  it("documents live endpoints", () => {
    expect(PUMPPORTAL_TRADE_LOCAL).toBe("https://pumpportal.fun/api/trade-local");
    expect(PUMPPORTAL_WS).toBe("wss://pumpportal.fun/api/data");
  });

  it("converts bps to percent", () => {
    expect(slippageBpsToPct(500)).toBe(5);
    expect(slippageBpsToPct(1)).toBe(0.1);
  });
});
