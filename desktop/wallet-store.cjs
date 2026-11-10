// Hot wallet store for Electron main process.
// Private keys never go to the renderer. Encrypted at rest via Electron safeStorage (DPAPI on Windows).

const fs = require("node:fs");
const path = require("node:path");
const { safeStorage, app } = require("electron");

let cachedSecretBase58 = null;
let cachedPublicKey = null;

function walletPath() {
  return path.join(app.getPath("userData"), "hot-wallet.enc");
}

function metaPath() {
  return path.join(app.getPath("userData"), "hot-wallet.meta.json");
}

async function loadSolana() {
  const web3 = await import("@solana/web3.js");
  const bs58mod = await import("bs58");
  const bs58 = bs58mod.default ?? bs58mod;
  return { Keypair: web3.Keypair, Connection: web3.Connection, PublicKey: web3.PublicKey, bs58, LAMPORTS_PER_SOL: web3.LAMPORTS_PER_SOL };
}

function encryptAndPersist(secretBase58, publicKey) {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(
      "OS encryption unavailable — refusing to save wallet to disk. Keep the key only in memory this session, or enable Windows Credential encryption."
    );
  }
  const encrypted = safeStorage.encryptString(secretBase58);
  fs.writeFileSync(walletPath(), encrypted);
  fs.writeFileSync(
    metaPath(),
    JSON.stringify(
      {
        publicKey,
        savedAt: new Date().toISOString(),
        encrypted: true,
        warning: "Burner wallet only — never your main savings",
      },
      null,
      2
    ),
    "utf8"
  );
}

function clearPersisted() {
  for (const p of [walletPath(), metaPath()]) {
    try {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    } catch {
      // ignore
    }
  }
}

function setMemory(secretBase58, publicKey) {
  cachedSecretBase58 = secretBase58;
  cachedPublicKey = publicKey;
}

function clearMemory() {
  cachedSecretBase58 = null;
  cachedPublicKey = null;
}

async function keypairFromSecretInput(input) {
  const { Keypair, bs58 } = await loadSolana();
  const trimmed = String(input || "").trim();
  if (!trimmed) throw new Error("Empty private key");

  // JSON byte-array keyfile (Solana CLI style)
  if (trimmed.startsWith("[")) {
    const arr = JSON.parse(trimmed);
    if (!Array.isArray(arr)) throw new Error("Keyfile JSON must be a byte array");
    const bytes = Uint8Array.from(arr);
    if (bytes.length === 64) return Keypair.fromSecretKey(bytes);
    if (bytes.length === 32) return Keypair.fromSeed(bytes);
    throw new Error(`Unsupported keyfile length: ${bytes.length}`);
  }

  // Object with secretKey field
  if (trimmed.startsWith("{")) {
    const obj = JSON.parse(trimmed);
    if (typeof obj.secretKey === "string") {
      return Keypair.fromSecretKey(bs58.decode(obj.secretKey));
    }
    if (Array.isArray(obj)) {
      return Keypair.fromSecretKey(Uint8Array.from(obj));
    }
    throw new Error("Unrecognized key JSON shape");
  }

  // Base58 secret
  const decoded = bs58.decode(trimmed);
  if (decoded.length === 64) return Keypair.fromSecretKey(decoded);
  if (decoded.length === 32) return Keypair.fromSeed(decoded);
  throw new Error(`Unsupported secret length: ${decoded.length}`);
}

async function fetchBalance(publicKey, rpcUrl) {
  const { Connection, PublicKey, LAMPORTS_PER_SOL } = await loadSolana();
  const url = rpcUrl || process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
  const connection = new Connection(url, "confirmed");
  const lamports = await connection.getBalance(new PublicKey(publicKey));
  return {
    balanceSol: lamports / LAMPORTS_PER_SOL,
    rpcUrl: url,
  };
}

async function loadFromDiskIfNeeded() {
  if (cachedSecretBase58 && cachedPublicKey) {
    return { publicKey: cachedPublicKey, source: "memory" };
  }
  const wp = walletPath();
  if (!fs.existsSync(wp)) return null;
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("Encrypted wallet exists but OS decryption is unavailable");
  }
  const encrypted = fs.readFileSync(wp);
  const secret = safeStorage.decryptString(encrypted);
  const { Keypair, bs58 } = await loadSolana();
  const kp = Keypair.fromSecretKey(bs58.decode(secret));
  setMemory(secret, kp.publicKey.toBase58());
  return { publicKey: cachedPublicKey, source: "disk" };
}

async function getStatus(rpcUrl) {
  try {
    await loadFromDiskIfNeeded();
  } catch (err) {
    return {
      connected: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  if (!cachedPublicKey) {
    return {
      connected: false,
      encryptionAvailable: safeStorage.isEncryptionAvailable(),
      userDataHint: app.getPath("userData"),
    };
  }

  let balanceSol = null;
  let balanceError = null;
  try {
    const bal = await fetchBalance(cachedPublicKey, rpcUrl);
    balanceSol = bal.balanceSol;
  } catch (err) {
    balanceError = err instanceof Error ? err.message : String(err);
  }

  return {
    connected: true,
    publicKey: cachedPublicKey,
    balanceSol,
    balanceError,
    encryptionAvailable: safeStorage.isEncryptionAvailable(),
    persisted: fs.existsSync(walletPath()),
    userDataHint: app.getPath("userData"),
  };
}

async function generate(rpcUrl) {
  const { Keypair, bs58 } = await loadSolana();
  const kp = Keypair.generate();
  const secret = bs58.encode(kp.secretKey);
  const publicKey = kp.publicKey.toBase58();
  setMemory(secret, publicKey);
  let persistError = null;
  try {
    encryptAndPersist(secret, publicKey);
  } catch (err) {
    persistError = err instanceof Error ? err.message : String(err);
  }
  const status = await getStatus(rpcUrl);
  return { ...status, persistError, generated: true };
}

async function importSecret(secretInput, rpcUrl) {
  const { bs58 } = await loadSolana();
  const kp = await keypairFromSecretInput(secretInput);
  const secret = bs58.encode(kp.secretKey);
  const publicKey = kp.publicKey.toBase58();
  setMemory(secret, publicKey);
  let persistError = null;
  try {
    encryptAndPersist(secret, publicKey);
  } catch (err) {
    persistError = err instanceof Error ? err.message : String(err);
  }
  const status = await getStatus(rpcUrl);
  return { ...status, persistError, imported: true };
}

async function disconnect() {
  clearMemory();
  clearPersisted();
  return {
    connected: false,
    encryptionAvailable: safeStorage.isEncryptionAvailable(),
    userDataHint: app.getPath("userData"),
  };
}

/** Returns secret for LiveExecutor injection — main process only, never send to renderer */
async function getSecretBase58() {
  await loadFromDiskIfNeeded();
  return cachedSecretBase58;
}

function getPublicKey() {
  return cachedPublicKey;
}

module.exports = {
  getStatus,
  generate,
  importSecret,
  disconnect,
  getSecretBase58,
  getPublicKey,
  fetchBalance,
};
