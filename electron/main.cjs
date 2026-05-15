const { app, BrowserWindow, ipcMain } = require("electron");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const appVersion = (() => {
  try {
    return require(path.join(__dirname, "../package.json")).version ?? "0.1.0";
  } catch {
    return "0.1.0";
  }
})();

const { createApiProxy, DEFAULT_PORT, stripTrailingSlash } = require("./api-proxy.cjs");
const logger = require("./logger.cjs");

const DEFAULT_USER_SETTINGS = Object.freeze({
  showReasoningDetail: true,
});

const DEFAULT_REAL_BACKEND = "http://127.0.0.1:8000";

/** 项目根目录 `.env` 解析结果缓存（仅主进程启动时读一次，用于 API_PROXY_PORT 等）。 */
let rootDotEnvCache = null;

function normalizeEnvValue(raw) {
  let s = String(raw ?? "").trim();
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    s = s.slice(1, -1).trim();
  }
  return s;
}

function parseEnvContent(content, into) {
  let text = content;
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
  }
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const idx = trimmed.indexOf("=");
    if (idx < 0) {
      continue;
    }
    const key = trimmed.slice(0, idx).trim();
    const value = normalizeEnvValue(trimmed.slice(idx + 1));
    if (key) {
      into[key] = value;
    }
  }
}

function rootDotEnvCandidatePaths() {
  const list = [];
  if (app.isPackaged) {
    // 优先级从低到高：后读到的覆盖先读到的
    list.push(path.join(path.dirname(app.getPath("exe")), ".env"));
    list.push(path.join(process.resourcesPath, ".env"));
  } else {
    list.push(path.join(__dirname, "..", ".env"));
  }
  return list;
}

function readRootDotEnv() {
  if (rootDotEnvCache) {
    return rootDotEnvCache;
  }
  const out = {};
  const loadedPaths = [];
  for (const envPath of rootDotEnvCandidatePaths()) {
    if (!fs.existsSync(envPath)) {
      continue;
    }
    try {
      parseEnvContent(fs.readFileSync(envPath, "utf8"), out);
      loadedPaths.push(envPath);
    } catch {
      // try next candidate
    }
  }
  if (loadedPaths.length > 0) {
    logger.log("[DAgentsUI] Loaded .env from", loadedPaths);
    if (out.API_BASE_URL) {
      logger.log("[DAgentsUI] API_BASE_URL from .env", normalizeEnvValue(out.API_BASE_URL));
    }
  } else if (app.isPackaged) {
    logger.log("[DAgentsUI] No .env found; checked", rootDotEnvCandidatePaths());
  }
  rootDotEnvCache = out;
  return out;
}

function apiBaseUrlFromDotEnvFiles() {
  const value = normalizeEnvValue(readRootDotEnv().API_BASE_URL);
  return stripTrailingSlash(value) || null;
}

/** 真实 DAgents API 根地址（与渲染进程 bootstrap 使用同一套优先级）。 */
function resolveRealBackendUrl() {
  const fromProcess = stripTrailingSlash(normalizeEnvValue(process.env.API_BASE_URL));
  if (fromProcess) {
    return fromProcess;
  }
  const fromDotEnv = apiBaseUrlFromDotEnvFiles();
  if (fromDotEnv) {
    return fromDotEnv;
  }
  const disk = readUserSettingsFromDisk();
  const fromSettings = stripTrailingSlash(
    typeof disk.backendBaseUrl === "string" ? disk.backendBaseUrl : "",
  );
  if (fromSettings) {
    return fromSettings;
  }
  return DEFAULT_REAL_BACKEND;
}

function syncProxyUpstreamFromConfig() {
  proxyUpstreamUrl = resolveRealBackendUrl();
  return proxyUpstreamUrl;
}

/**
 * 内置反向代理监听端口。
 * 优先级：process.env.API_PROXY_PORT（或 ELECTRON_API_PROXY_PORT）→ 项目根 .env 中 API_PROXY_PORT → 缺省使用 api-proxy 模块内 DEFAULT_PORT。
 */
function resolveApiProxyListenPort() {
  const raw =
    process.env.API_PROXY_PORT ??
    process.env.ELECTRON_API_PROXY_PORT ??
    readRootDotEnv().API_PROXY_PORT ??
    "";
  const s = String(raw).trim();
  if (!s) {
    return undefined;
  }
  const n = Number(s);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    logger.warn(`[DAgentsUI] Invalid API_PROXY_PORT "${s}", falling back to default ${DEFAULT_PORT}`);
    return undefined;
  }
  return n;
}

/** 当前代理转发的真实 API 根地址（由 resolveRealBackendUrl / setProxyTarget 维护）。 */
let proxyUpstreamUrl = DEFAULT_REAL_BACKEND;

/** @type {import("http").Server | null} */
let apiProxyServer = null;
let apiProxyPort = DEFAULT_PORT;

function userSettingsPath() {
  return path.join(app.getPath("userData"), "user-settings.json");
}

function readUserSettingsFromDisk() {
  const p = userSettingsPath();
  if (!fs.existsSync(p)) {
    return {};
  }
  try {
    const raw = fs.readFileSync(p, "utf8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function writeUserSettingsToDisk(obj) {
  const p = userSettingsPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, null, 2), "utf8");
}

function registerSettingsIpc() {
  ipcMain.handle("settings:read", () => {
    const disk = readUserSettingsFromDisk();
    return { ...DEFAULT_USER_SETTINGS, ...disk };
  });

  ipcMain.handle("settings:write", (_event, patch) => {
    const safe = patch && typeof patch === "object" ? patch : {};
    const disk = readUserSettingsFromDisk();
    const next = { ...DEFAULT_USER_SETTINGS, ...disk, ...safe };
    if (Object.prototype.hasOwnProperty.call(safe, "backendBaseUrl")) {
      if (typeof safe.backendBaseUrl === "string" && stripTrailingSlash(safe.backendBaseUrl)) {
        next.backendBaseUrl = stripTrailingSlash(safe.backendBaseUrl);
      } else {
        delete next.backendBaseUrl;
      }
    }
    writeUserSettingsToDisk(next);
    syncProxyUpstreamFromConfig();
    return next;
  });

  ipcMain.handle("settings:path", () => userSettingsPath());
}

function registerLogIpc() {
  ipcMain.handle("log:getPaths", () => ({
    dir: logger.getLogDir(),
    file: logger.getLogFilePath(),
  }));
}

function clientIdCandidatePaths() {
  const list = [];
  if (app.isPackaged) {
    list.push(path.join(path.dirname(app.getPath("exe")), ".electron-client-id"));
    list.push(path.join(process.resourcesPath, ".electron-client-id"));
  }
  list.push(path.join(__dirname, "..", ".electron-client-id"));
  return list;
}

function clientIdFilePath() {
  return path.join(app.getPath("userData"), ".electron-client-id");
}

function readClientIdFromDisk() {
  const userDataPath = clientIdFilePath();
  if (fs.existsSync(userDataPath)) {
    const saved = fs.readFileSync(userDataPath, "utf8").trim();
    if (saved) {
      return saved;
    }
  }
  for (const legacyPath of clientIdCandidatePaths()) {
    if (!fs.existsSync(legacyPath)) {
      continue;
    }
    try {
      const saved = fs.readFileSync(legacyPath, "utf8").trim();
      if (saved) {
        fs.mkdirSync(path.dirname(userDataPath), { recursive: true });
        fs.writeFileSync(userDataPath, saved, "utf8");
        return saved;
      }
    } catch {
      // try next candidate
    }
  }
  return null;
}

function getOrCreateClientId() {
  const existing = readClientIdFromDisk();
  if (existing) {
    return existing;
  }
  const next = crypto.randomUUID();
  const userDataPath = clientIdFilePath();
  fs.mkdirSync(path.dirname(userDataPath), { recursive: true });
  fs.writeFileSync(userDataPath, next, "utf8");
  return next;
}

function registerRuntimeIpc() {
  ipcMain.handle("runtime:getApiBaseUrl", () => apiBaseUrlFromDotEnvFiles());

  ipcMain.handle("runtime:getRealBackendUrl", () => resolveRealBackendUrl());

  ipcMain.handle("runtime:getOrCreateClientId", () => getOrCreateClientId());
}

function registerProxyIpc() {
  ipcMain.handle("proxy:setTarget", (_event, url) => {
    const next = stripTrailingSlash(typeof url === "string" ? url : "");
    if (next) {
      proxyUpstreamUrl = next;
    } else {
      proxyUpstreamUrl = "http://127.0.0.1:8000";
    }
    return { ok: true, target: proxyUpstreamUrl };
  });

  ipcMain.handle("proxy:getBaseUrl", () => `http://127.0.0.1:${apiProxyPort}`);

  ipcMain.handle("proxy:getListenPort", () => apiProxyPort);
}

async function startEmbeddedApiProxy() {
  try {
    syncProxyUpstreamFromConfig();
    const proxyOpts = { getTargetUrl: () => proxyUpstreamUrl };
    const listenPort = resolveApiProxyListenPort();
    if (listenPort !== undefined) {
      proxyOpts.port = listenPort;
    }
    const { server, port } = await createApiProxy(proxyOpts);
    apiProxyServer = server;
    apiProxyPort = port;
    logger.log(`[DAgentsUI] API reverse proxy listening on http://127.0.0.1:${port} -> ${proxyUpstreamUrl}`);
  } catch (err) {
    logger.error("[DAgentsUI] API reverse proxy failed to start:", err);
  }
}

function createWindow() {
  const win = new BrowserWindow({
    title: `DAgentsUI v${appVersion}`,
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (devUrl) {
    win.loadURL(devUrl);
  } else {
    win.loadFile(path.resolve(__dirname, "../dist/index.html"));
  }
}

app.whenReady().then(async () => {
  logger.initLogger();
  logger.log("[DAgentsUI] App starting", { version: appVersion, packaged: app.isPackaged });
  registerSettingsIpc();
  registerLogIpc();
  registerRuntimeIpc();
  registerProxyIpc();
  await startEmbeddedApiProxy();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  if (apiProxyServer) {
    try {
      apiProxyServer.close();
    } catch {
      // ignore
    }
    apiProxyServer = null;
  }
});
