const { app, BrowserWindow, ipcMain } = require("electron");
const fs = require("fs");
const path = require("path");

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

/** 项目根目录 `.env` 解析结果缓存（仅主进程启动时读一次，用于 API_PROXY_PORT 等）。 */
let rootDotEnvCache = null;

function rootDotEnvCandidatePaths() {
  const list = [];
  if (app.isPackaged) {
    // 与便携 exe / .app 内可执行文件同目录（用户最常把 .env 放在这里）
    list.push(path.join(path.dirname(app.getPath("exe")), ".env"));
    // electron-builder extraFiles 等多在 resources（Windows: app/resources；mac: Contents/Resources）
    list.push(path.join(process.resourcesPath, ".env"));
  }
  list.push(path.join(__dirname, "..", ".env"));
  return list;
}

function readRootDotEnv() {
  if (rootDotEnvCache) {
    return rootDotEnvCache;
  }
  const out = {};
  let loadedPath = null;
  for (const envPath of rootDotEnvCandidatePaths()) {
    if (!fs.existsSync(envPath)) {
      continue;
    }
    try {
      const content = fs.readFileSync(envPath, "utf8");
      for (const line of content.split(/\r?\n/)) {
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
        if (key) {
          out[key] = value;
        }
      }
      loadedPath = envPath;
      break;
    } catch {
      // try next candidate
    }
  }
  if (loadedPath) {
    logger.log("[DAgentsUI] Loaded .env from", loadedPath);
  }
  rootDotEnvCache = out;
  return out;
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

/** 当前代理转发的真实 API 根地址（由渲染进程 bootstrap 时同步）。 */
let proxyUpstreamUrl = "http://127.0.0.1:8000";

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
        proxyUpstreamUrl = next.backendBaseUrl;
      } else {
        delete next.backendBaseUrl;
        proxyUpstreamUrl = "http://127.0.0.1:8000";
      }
    }
    writeUserSettingsToDisk(next);
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
    const disk = readUserSettingsFromDisk();
    const fromSettings = stripTrailingSlash(
      typeof disk.backendBaseUrl === "string" ? disk.backendBaseUrl : "",
    );
    if (fromSettings) {
      proxyUpstreamUrl = fromSettings;
    }
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
