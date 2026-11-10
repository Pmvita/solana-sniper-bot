const modeEl = document.getElementById("mode");
const profileEl = document.getElementById("profile");
const balanceEl = document.getElementById("balance");
const mockFeedEl = document.getElementById("mockFeed");
const dryRunEl = document.getElementById("dryRun");
const rpcUrlEl = document.getElementById("rpcUrl");
const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const clearLogBtn = document.getElementById("clearLog");
const logEl = document.getElementById("log");
const positionsEl = document.getElementById("positions");
const balLine = document.getElementById("balLine");
const statusPill = document.getElementById("statusPill");
const liveWarn = document.getElementById("liveWarn");

const walletStatusEl = document.getElementById("walletStatus");
const walletAddressEl = document.getElementById("walletAddress");
const walletBalanceEl = document.getElementById("walletBalance");
const genWalletBtn = document.getElementById("genWalletBtn");
const importKeyBtn = document.getElementById("importKeyBtn");
const importFileBtn = document.getElementById("importFileBtn");
const copyAddrBtn = document.getElementById("copyAddrBtn");
const refreshWalletBtn = document.getElementById("refreshWalletBtn");
const disconnectWalletBtn = document.getElementById("disconnectWalletBtn");

let running = false;
let hotWallet = { connected: false, publicKey: null, balanceSol: null };
let paperBalanceSol = Number(balanceEl.value) || 1;

function rpcUrl() {
  return rpcUrlEl.value.trim() || undefined;
}

function appendLog(level, message, ts) {
  const time = new Date(ts || Date.now()).toLocaleTimeString();
  const line = document.createElement("div");
  line.className = level || "info";
  line.textContent = `[${time}] ${message}`;
  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight;
  while (logEl.childElementCount > 500) {
    logEl.removeChild(logEl.firstChild);
  }
}

function setRunning(isRunning, mode) {
  running = isRunning;
  startBtn.disabled = isRunning;
  stopBtn.disabled = !isRunning;
  modeEl.disabled = isRunning;
  profileEl.disabled = isRunning;
  balanceEl.disabled = isRunning;
  mockFeedEl.disabled = isRunning || modeEl.value === "live";
  dryRunEl.disabled = isRunning;
  genWalletBtn.disabled = isRunning;
  importKeyBtn.disabled = isRunning;
  importFileBtn.disabled = isRunning;
  disconnectWalletBtn.disabled = isRunning || !hotWallet.connected;
  const m = mode || modeEl.value;
  statusPill.textContent = isRunning ? `Running · ${m.toUpperCase()}` : "Stopped";
  statusPill.classList.toggle("on", isRunning && m !== "live");
  statusPill.classList.toggle("live", isRunning && m === "live");
}

function renderWalletPanel() {
  const live = modeEl.value === "live";
  if (!live && !hotWallet.connected) {
    walletStatusEl.textContent = "Paper wallet (simulated)";
    walletAddressEl.textContent = "sim-paper-wallet";
    walletBalanceEl.textContent = `${paperBalanceSol.toFixed(4)} SOL (paper)`;
    copyAddrBtn.disabled = true;
    disconnectWalletBtn.disabled = true;
    return;
  }

  if (!hotWallet.connected) {
    walletStatusEl.textContent = "No hot wallet — required for Live";
    walletAddressEl.textContent = "—";
    walletBalanceEl.textContent = "—";
    copyAddrBtn.disabled = true;
    disconnectWalletBtn.disabled = running;
    return;
  }

  walletStatusEl.textContent = hotWallet.persisted
    ? "Hot wallet loaded (OS-encrypted)"
    : "Hot wallet loaded (memory)";
  walletAddressEl.textContent = hotWallet.publicKey || "—";
  if (hotWallet.balanceSol == null) {
    walletBalanceEl.textContent = hotWallet.balanceError
      ? `error: ${hotWallet.balanceError}`
      : "…";
  } else {
    walletBalanceEl.textContent = `${Number(hotWallet.balanceSol).toFixed(6)} SOL`;
  }
  copyAddrBtn.disabled = !hotWallet.publicKey;
  disconnectWalletBtn.disabled = running;
}

function applyWalletStatus(status) {
  if (!status) return;
  if (status.ok === false && status.error) {
    appendLog("error", status.error);
    return;
  }
  hotWallet = {
    connected: !!status.connected,
    publicKey: status.publicKey || null,
    balanceSol: status.balanceSol ?? null,
    balanceError: status.balanceError || null,
    persisted: !!status.persisted,
  };
  if (status.persistError) appendLog("warn", `Wallet not persisted: ${status.persistError}`);
  if (status.generated) appendLog("info", `Generated hot wallet ${shortAddr(status.publicKey)}`);
  if (status.imported) appendLog("info", `Imported hot wallet ${shortAddr(status.publicKey)}`);
  renderWalletPanel();
}

function shortAddr(addr) {
  if (!addr) return "";
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

function renderPositions(event) {
  paperBalanceSol = event.balanceSol;
  balLine.textContent = `Bal ${event.balanceSol.toFixed(4)} SOL · Realized ${
    event.realizedPnlSol >= 0 ? "+" : ""
  }${event.realizedPnlSol.toFixed(4)}`;

  if (modeEl.value === "paper" && !hotWallet.connected) renderWalletPanel();

  if (!event.positions.length) {
    positionsEl.className = "positions empty";
    positionsEl.textContent = "No open positions";
    return;
  }

  positionsEl.className = "positions";
  positionsEl.innerHTML = "";
  for (const p of event.positions) {
    const card = document.createElement("div");
    card.className = "pos-card";
    const pnlClass = p.unrealizedPnlSol >= 0 ? "pos" : "neg";
    card.innerHTML = `
      <div class="title">
        <strong>${escapeHtml(p.symbol)}</strong>
        <span class="pnl ${pnlClass}">${p.unrealizedPnlPct.toFixed(1)}% (${p.unrealizedPnlSol.toFixed(4)} SOL)</span>
      </div>
      <div class="row">cost ${p.costSol.toFixed(4)} SOL · TP ${p.takeProfitPct}% / SL ${p.stopLossPct}%</div>
      <div class="row">${escapeHtml(p.mint.slice(0, 12))}… · ${p.mode} · ${escapeHtml(p.priceSource || "")}</div>
    `;
    positionsEl.appendChild(card);
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function syncLiveUi() {
  const live = modeEl.value === "live";
  liveWarn.classList.toggle("hidden", !live);
  if (live) {
    mockFeedEl.checked = false;
    mockFeedEl.disabled = true;
  } else {
    mockFeedEl.disabled = running;
  }
  renderWalletPanel();
}

async function refreshWallet() {
  try {
    applyWalletStatus(await window.sniper.wallet.status(rpcUrl()));
  } catch (err) {
    appendLog("error", `Wallet status failed: ${err}`);
  }
}

modeEl.addEventListener("change", syncLiveUi);
balanceEl.addEventListener("change", () => {
  paperBalanceSol = Number(balanceEl.value) || 1;
  renderWalletPanel();
});

genWalletBtn.addEventListener("click", async () => {
  if (
    !window.confirm(
      "Generate a NEW burner hot wallet?\n\nFund with small SOL only. Never use main savings."
    )
  )
    return;
  appendLog("info", "Generating hot wallet…");
  applyWalletStatus(await window.sniper.wallet.generate(rpcUrl()));
});

importKeyBtn.addEventListener("click", async () => {
  const secret = window.prompt(
    "Paste base58 private key OR Solana CLI JSON byte-array.\n(Burner only.)"
  );
  if (secret == null) return;
  appendLog("info", "Importing hot wallet…");
  applyWalletStatus(await window.sniper.wallet.importKey(secret, rpcUrl()));
});

importFileBtn.addEventListener("click", async () => {
  const status = await window.sniper.wallet.importFile(rpcUrl());
  if (status?.cancelled) return;
  applyWalletStatus(status);
});

copyAddrBtn.addEventListener("click", async () => {
  const res = await window.sniper.wallet.copyAddress();
  if (res?.ok) appendLog("info", `Copied ${shortAddr(res.publicKey)} — fund from Phantom`);
  else appendLog("error", res?.error || "Copy failed");
});

refreshWalletBtn.addEventListener("click", () => void refreshWallet());

disconnectWalletBtn.addEventListener("click", async () => {
  if (!window.confirm("Disconnect and delete encrypted hot wallet from this PC?")) return;
  applyWalletStatus(await window.sniper.wallet.disconnect());
  hotWallet = { connected: false, publicKey: null, balanceSol: null };
  appendLog("warn", "Hot wallet wiped from userData");
  renderWalletPanel();
});

startBtn.addEventListener("click", async () => {
  const mode = modeEl.value;
  if (mode === "live") {
    if (!hotWallet.connected) {
      appendLog("error", "Generate/Import a hot wallet before Live");
      return;
    }
    if (!rpcUrl() && !window.confirm("No RPC override set — use .env / default public RPC?")) {
      return;
    }
    const ok = window.confirm(
      "START LIVE TRADING?\n\n• Real PumpPortal new-token feed\n• Real PumpPortal trade-local buys/sells\n• Spends SOL from your hot wallet\n\nConfirm only if you accept total loss risk."
    );
    if (!ok) return;
  }

  const command = {
    type: "start",
    mode,
    profile: profileEl.value,
    walletBalanceSol: Number(balanceEl.value) || 1,
    useMockFeed: mode === "paper" ? mockFeedEl.checked : false,
    liveTrading: mode === "live",
    dryRun: dryRunEl.checked,
    rpcUrl: rpcUrl(),
  };

  appendLog(
    "info",
    `Starting ${mode.toUpperCase()} | feed=${command.useMockFeed ? "mock" : "PumpPortal"} | dryRun=${command.dryRun}`
  );
  const res = await window.sniper.send(command);
  if (!res?.ok) appendLog("error", res?.error || "Failed to start");
});

stopBtn.addEventListener("click", async () => {
  appendLog("info", "Stopping…");
  await window.sniper.send({ type: "stop" });
});

clearLogBtn.addEventListener("click", () => {
  logEl.innerHTML = "";
});

window.sniper.onEvent((event) => {
  if (!event || typeof event !== "object") return;
  if (event.type === "log") {
    appendLog(event.level, event.message, event.ts);
    return;
  }
  if (event.type === "error") {
    appendLog("error", event.message, event.ts);
    return;
  }
  if (event.type === "status") {
    setRunning(!!event.running, event.mode);
    return;
  }
  if (event.type === "positions") renderPositions(event);
});

syncLiveUi();
setRunning(false);
appendLog(
  "info",
  "Ready. Default mode is LIVE. Feed = PumpPortal (mock unchecked). Generate wallet → fund → Start."
);
void refreshWallet();
