const { contextBridge, ipcRenderer } = require("electron");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const rootDir = path.resolve(__dirname, "..");
const clientIdFile = path.join(rootDir, ".electron-client-id");

function readRuntimeApiBaseUrl() {
  const envPath = path.join(rootDir, ".env");
  if (!fs.existsSync(envPath)) {
    return null;
  }
  const content = fs.readFileSync(envPath, "utf8");
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const idx = trimmed.indexOf("=");
    if (idx < 0) {
      continue;
    }
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (key === "API_BASE_URL") {
      return value || null;
    }
  }
  return null;
}

function getOrCreateClientId() {
  if (fs.existsSync(clientIdFile)) {
    const saved = fs.readFileSync(clientIdFile, "utf8").trim();
    if (saved) {
      return saved;
    }
  }

  const next = crypto.randomUUID();
  fs.writeFileSync(clientIdFile, next, "utf8");
  return next;
}

contextBridge.exposeInMainWorld("electronRuntime", {
  getRuntimeApiBaseUrl: () => readRuntimeApiBaseUrl(),
  getOrCreateClientId: () => getOrCreateClientId(),
  readUserSettings: () => ipcRenderer.invoke("settings:read"),
  writeUserSettings: (patch) => ipcRenderer.invoke("settings:write", patch),
  getUserSettingsFilePath: () => ipcRenderer.invoke("settings:path"),
  setProxyTarget: (url) => ipcRenderer.invoke("proxy:setTarget", url),
  getLocalApiProxyBaseUrl: () => ipcRenderer.invoke("proxy:getBaseUrl"),
});
