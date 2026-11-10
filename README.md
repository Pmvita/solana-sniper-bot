# Solana Sniper Bot

**Windows-first Electron desktop app** that snipes new [Pump.fun](https://pump.fun) tokens using the live [PumpPortal](https://pumpportal.fun) data + trade APIs.

> **Live = real money.** Most snipes lose capital (rugs, latency, MEV, failed txs). This is research software, not financial advice. Use a **burner wallet** only.

**License:** [Proprietary — All Rights Reserved](./LICENSE). Public viewing allowed; no grant to copy, modify, distribute, or use commercially without written permission from **Pmvita**.

---

## What is truly live

| Capability | Status |
|---|---|
| New-token feed | **Live** `wss://pumpportal.fun/api/data` → `subscribeNewToken` |
| Metrics | From PumpPortal create payload (`vSolInBondingCurve`, `solAmount`, age, etc.). Unknown fields soft-penalized — not hardcoded zeros that always skip |
| Buy / sell | **PumpPortal Local Transaction API** `POST https://pumpportal.fun/api/trade-local` → you sign & send on your RPC. Jupiter v6 is fallback only (often fails on fresh bonding-curve mints) |
| Hot wallet | Generate / import in Electron; OS-encrypted (`safeStorage` / DPAPI); key never sent to renderer |
| Exits | TP / SL / trailing using live PumpPortal trade ticks (`subscribeTokenTrade`) when available |
| Honeypot | Best-effort trade-local build + RPC simulate. Outcomes: **pass / fail / unknown** (never fakes OK) |
| Paper mode | Optional safe toggle (simulated balances). Mock feed **only** if you check “Mock feed” or `MOCK_FEED=true` |

### Still risky / incomplete

- Landing rate depends on your RPC / fees / congestion
- Sell simulation without token balance is often **unknown**, not a hard pass
- Token amounts after buy are estimated from curve price until chain balance sync improves
- PumpPortal may charge fees / rate-limit; APIs can change
- No guarantee of profit — expect losses

---

## Quick start (Live desktop)

```bash
git clone https://github.com/Pmvita/solana-sniper-bot.git
cd solana-sniper-bot
copy .env.example .env
npm install
npm run desktop
```

### Exact Live steps

1. **Generate** a burner hot wallet in the UI (or Import).
2. **Copy address** → send a **small** amount of SOL from Phantom/exchange.
3. Set **RPC URL** (recommended: Helius/Triton private RPC) in Settings or `.env` `SOLANA_RPC_URL`.
4. Mode = **Live (real money)**, profile = **sniper**.
5. Optional: enable **Dry-run** to build/simulate without broadcasting.
6. Click **Start** and confirm the warning.
7. Watch the log for real `[New]` events from PumpPortal, then risk eval and buys.

CLI live listen proof (no spend):

```bash
npm run listen
# optional: DRY_BUILD_TX=true npm run listen   # also dry-build trade-local on first event
```

Offline mock smoke (not the product path):

```bash
npm run offline-smoke
```

---

## Architecture

```
desktop/                 Electron UI (wallet, Start/Stop, logs, PnL)
  main.cjs               Spawns bot runner; injects hot-wallet secret for Live
  wallet-store.cjs       Generate/import + OS encrypt
src/bot/engine.ts        Listen → enrich → risk → honeypot → buy → exits
src/services/
  token-detector.ts      PumpPortal WS
  pumpportal-trade.ts    trade-local client
  price-oracle.ts        Trade-tick mark prices
  live-honeypot.ts       Honest sim / unknown
src/execution/
  live-executor.ts       PumpPortal primary, Jupiter fallback
  paper-executor.ts      Simulated (optional)
```

### Trade API (documented)

**Primary:** [PumpPortal Local Transaction API](https://pumpportal.fun/local-trading-api/trading-api/)

```http
POST https://pumpportal.fun/api/trade-local
Content-Type: application/json

{
  "publicKey": "<wallet>",
  "action": "buy" | "sell",
  "mint": "<token mint>",
  "amount": 0.01,
  "denominatedInSol": "true",
  "slippage": 10,
  "priorityFee": 0.00005,
  "pool": "auto"
}
```

Response: raw serialized `VersionedTransaction` bytes → sign with hot keypair → `connection.sendTransaction`.

**Data:** `wss://pumpportal.fun/api/data` methods `subscribeNewToken`, `subscribeTokenTrade`.

---

## Live vs Paper

| | Live | Paper |
|---|---|---|
| Feed | PumpPortal (default) | PumpPortal, or mock if enabled |
| Money | Real SOL | Simulated |
| Exec | trade-local (+ Jupiter fallback) | PaperExecutor |
| Gate | Hot wallet + RPC + Live confirm / `LIVE_TRADING=true` | Always allowed |

---

## Security

- Burner wallet only — never import main savings
- Private keys stay in Electron main / encrypted userData
- Never commit `.env`, keyfiles, `hot-wallet.enc`
- Confirm Live Start dialog — irreversible capital risk

---

## Scripts

| Command | Purpose |
|---|---|
| `npm run desktop` | Electron app (primary) |
| `npm run listen` | Live WS smoke (real events) |
| `npm run dev` | CLI bot |
| `npm run offline-smoke` | Mock paper path (dev only) |
| `npm run build` / `npm test` | Typecheck + unit tests |

---

## Disclaimer

Trading memecoins is extremely high risk. You can lose all funds in the hot wallet. Authors are not liable for losses. Proprietary license — see [LICENSE](./LICENSE).
