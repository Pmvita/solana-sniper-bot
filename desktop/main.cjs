// Electron main process — spawns bot runner, bridges IPC, owns hot wallet secrets

const { app, BrowserWindow, ipcMain, dialog, clipboard } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { spawn } = require("node:child_process");
const readline = require("node:readline");
const walletStore = require("./wallet-store.cjs");

let mainWindow = null;
let botProc = null;
let botRl = null;

/**
 * App root: project root in dev; asar.unpacked in packaged builds so the
 * child runner can be spawned outside the virtual asar filesystem.
 */
function getAppRoot() {
  if (!app.isPackaged) {
    return path.join(__dirname, "..");
  }
  const appPath = app.getAppPath();
  if (appPath.includes(`${path.sep}app.asar`)) {
    return appPath.replace(`${path.sep}app.asar`, `${path.sep}app.asar.unpacked`);
  }
  return appPath;
}

function resolveRunnerSpawn() {
  const root = getAppRoot();

  if (app.isPackaged) {
    const runner = path.join(root, "dist", "bot", "runner.js");
    if (!fs.existsSync(runner)) {
      throw new Error(`Packaged runner missing: ${runner}`);
    }
    return {
      execPath: process.execPath,
      args: [runner],
      cwd: root,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
      },
    };
  }

  const tsxCli = path.join(root, "node_modules", "tsx", "dist", "cli.mjs");
  const runnerTs = path.join(root, "src", "bot", "runner.ts");
  const runnerJs = path.join(root, "dist", "bot", "runner.js");

  if (fs.existsSync(tsxCli) && fs.existsSync(runnerTs)) {
    return {
      execPath: process.execPath,
      args: [tsxCli, runnerTs],
      cwd: root,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
      },
    };
  }

  if (fs.existsSync(runnerJs)) {
    return {
      execPath: process.execPath,
      args: [runnerJs],
      cwd: root,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
      },
    };
  }

  throw new Error(
    "Bot runner not found. Run `npm install` (dev) or ensure dist/bot/runner.js exists."
  );
}

function sendToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function stopBotProcess() {
  if (botRl) {
    botRl.close();
    botRl = null;
  }
  if (botProc) {
    try {
      botProc.stdin.write(`${JSON.stringify({ type: "stop" })}\n`);
    } catch {
      // ignore
    }
    const proc = botProc;
    botProc = null;
    setTimeout(() => {
      try {
        proc.kill();
      } catch {
        // ignore
      }
    }, 500);
  }
}

function startBotProcess() {
  stopBotProcess();

  let spawnSpec;
  try {
    spawnSpec = resolveRunnerSpawn();
  } catch (err) {
    sendToRenderer("bot:event", {
      type: "log",
      level: "error",
      message: err instanceof Error ? err.message : String(err),
      ts: Date.now(),
    });
    return;
  }

  botProc = spawn(spawnSpec.execPath, spawnSpec.args, {
    cwd: spawnSpec.cwd,
    env: spawnSpec.env,
    stdio: ["pipe", "pipe", "pipe"],
  });

  botRl = readline.createInterface({ input: botProc.stdout });
  botRl.on("line", (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      const event = JSON.parse(trimmed);
      sendToRenderer("bot:event", event);
    } catch {
      sendToRenderer("bot:event", {
        type: "log",
        level: "debug",
        message: trimmed,
        ts: Date.now(),
      });
    }
  });

  botProc.stderr.on("data", (buf) => {
    const msg = buf.toString();
    sendToRenderer("bot:event", {
      type: "log",
      level: "error",
      message: msg.trim(),
      ts: Date.now(),
    });
  });

  botProc.on("exit", (code) => {
    sendToRenderer("bot:event", {
      type: "log",
      level: "warn",
      message: `Bot process exited (code=${code})`,
      ts: Date.now(),
    });
    sendToRenderer("bot:event", {
      type: "status",
      running: false,
      mode: "live",
      profile: "-",
      circuitBreakerTripped: false,
      openPositions: 0,
      feed: "pumpportal",
      dryRun: false,
      ts: Date.now(),
    });
    botProc = null;
  });
}

function writeBotCommand(command) {
  return new Promise((resolve) => {
    if (!botProc || !botProc.stdin.writable) {
      startBotProcess();
    }
    setTimeout(() => {
      if (!botProc || !botProc.stdin.writable) {
        resolve({ ok: false, error: "Bot process not available" });
        return;
      }
      try {
        botProc.stdin.write(`${JSON.stringify(command)}\n`);
        resolve({ ok: true });
      } catch (err) {
        resolve({ ok: false, error: String(err) });
      }
    }, botProc ? 0 : 400);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1220,
    height: 860,
    minWidth: 960,
    minHeight: 680,
    title: "Solana Sniper Bot",
    backgroundColor: "#0f1419",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createWindow();
  startBotProcess();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  stopBotProcess();
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  stopBotProcess();
});

ipcMain.handle("bot:send", async (_evt, command) => {
  // Inject hot-wallet secret for live starts — never expose key to renderer
  if (command && command.type === "start" && command.mode === "live") {
    const hotSecret = await walletStore.getSecretBase58();
    const privateKey = hotSecret || process.env.PRIVATE_KEY || command.privateKey;
    if (!privateKey) {
      return {
        ok: false,
        error: "Live mode needs a loaded hot wallet (Generate/Import) or PRIVATE_KEY in .env",
      };
    }
    command = { ...command, privateKey, liveTrading: true };
  } else if (command && command.privateKey) {
    // Strip any accidental privateKey from renderer for non-live
    const { privateKey: _drop, ...rest } = command;
    command = rest;
  }
  return writeBotCommand(command);
});

ipcMain.handle("bot:restart-runner", () => {
  startBotProcess();
  return { ok: true };
});

ipcMain.handle("wallet:status", async (_evt, { rpcUrl } = {}) => {
  return walletStore.getStatus(rpcUrl);
});

ipcMain.handle("wallet:generate", async (_evt, { rpcUrl } = {}) => {
  return walletStore.generate(rpcUrl);
});

ipcMain.handle("wallet:importKey", async (_evt, { secret, rpcUrl } = {}) => {
  if (!secret || !String(secret).trim()) {
    return { ok: false, error: "No secret provided" };
  }
  try {
    const status = await walletStore.importSecret(secret, rpcUrl);
    return { ok: true, ...status };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("wallet:importFile", async (_evt, { rpcUrl } = {}) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Import Solana keyfile",
    filters: [
      { name: "Keyfiles", extensions: ["json"] },
      { name: "All files", extensions: ["*"] },
    ],
    properties: ["openFile"],
  });
  if (result.canceled || !result.filePaths[0]) {
    return { ok: false, cancelled: true };
  }
  try {
    const raw = fs.readFileSync(result.filePaths[0], "utf8");
    const status = await walletStore.importSecret(raw, rpcUrl);
    return { ok: true, ...status };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("wallet:disconnect", async () => {
  return walletStore.disconnect();
});

ipcMain.handle("wallet:refresh", async (_evt, { rpcUrl } = {}) => {
  return walletStore.getStatus(rpcUrl);
});

ipcMain.handle("wallet:copyAddress", async () => {
  const pk = walletStore.getPublicKey();
  if (!pk) {
    const status = await walletStore.getStatus();
    if (!status.publicKey) return { ok: false, error: "No wallet loaded" };
    clipboard.writeText(status.publicKey);
    return { ok: true, publicKey: status.publicKey };
  }
  clipboard.writeText(pk);
  return { ok: true, publicKey: pk };
});
