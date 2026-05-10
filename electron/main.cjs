const { app, BrowserWindow, ipcMain } = require("electron");
const fs = require("fs");
const path = require("path");

const { createApiProxy, DEFAULT_PORT, stripTrailingSlash } = require("./api-proxy.cjs");

const DEFAULT_USER_SETTINGS = Object.freeze({
  showReasoningDetail: true,
});

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
    const { server, port } = await createApiProxy({
      getTargetUrl: () => proxyUpstreamUrl,
      port: DEFAULT_PORT,
    });
    apiProxyServer = server;
    apiProxyPort = port;
    console.log(`[DAgentsUI] API reverse proxy listening on http://127.0.0.1:${port} -> ${proxyUpstreamUrl}`);
  } catch (err) {
    console.error("[DAgentsUI] API reverse proxy failed to start:", err);
  }
}

function createWindow() {
  const win = new BrowserWindow({
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
  registerSettingsIpc();
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
