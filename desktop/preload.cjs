const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("sniper", {
  send(command) {
    return ipcRenderer.invoke("bot:send", command);
  },
  restartRunner() {
    return ipcRenderer.invoke("bot:restart-runner");
  },
  onEvent(handler) {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on("bot:event", listener);
    return () => ipcRenderer.removeListener("bot:event", listener);
  },
  wallet: {
    status(rpcUrl) {
      return ipcRenderer.invoke("wallet:status", { rpcUrl });
    },
    generate(rpcUrl) {
      return ipcRenderer.invoke("wallet:generate", { rpcUrl });
    },
    importKey(secret, rpcUrl) {
      return ipcRenderer.invoke("wallet:importKey", { secret, rpcUrl });
    },
    importFile(rpcUrl) {
      return ipcRenderer.invoke("wallet:importFile", { rpcUrl });
    },
    disconnect() {
      return ipcRenderer.invoke("wallet:disconnect");
    },
    refresh(rpcUrl) {
      return ipcRenderer.invoke("wallet:refresh", { rpcUrl });
    },
    copyAddress() {
      return ipcRenderer.invoke("wallet:copyAddress");
    },
  },
});
