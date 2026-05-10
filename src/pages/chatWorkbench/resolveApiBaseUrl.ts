/** 启动期解析 API 基址与 clientId 时的日志（与页面 wbLog 签名一致）。 */
export type WorkbenchBootstrapLog = (message: string, payload?: unknown) => void;

export type ResolveWorkbenchApiBaseResult = {
  apiBaseUrl: string;
  clientId: string;
};

const DEFAULT_REAL_BACKEND = "http://127.0.0.1:8000";

function generateFallbackClientId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `client-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 启动时确定最终 API Base URL 与 clientId。
 * 优先级：Electron 运行时 .env → 用户设置文件中的 backendBaseUrl → Vite 构建期 URL → 默认本机地址；
 * 在 Electron 且内嵌代理可用时，将真实后端注册到主进程代理并改用本地代理对外地址。
 */
export async function resolveWorkbenchApiBase(options: {
  resolvedViteUrl: string;
  log: WorkbenchBootstrapLog;
}): Promise<ResolveWorkbenchApiBaseResult> {
  const runtimeApiBaseUrl = String(window.electronRuntime?.getRuntimeApiBaseUrl?.() ?? "").trim();
  const runtimeClientId = String(window.electronRuntime?.getOrCreateClientId?.() ?? "").trim();

  let realBackend = options.resolvedViteUrl || DEFAULT_REAL_BACKEND;
  if (window.electronRuntime?.readUserSettings) {
    try {
      const s = (await window.electronRuntime.readUserSettings()) as { backendBaseUrl?: unknown };
      const fromFile = typeof s.backendBaseUrl === "string" ? s.backendBaseUrl.trim() : "";
      if (fromFile) {
        realBackend = fromFile.replace(/\/+$/, "");
      }
    } catch {
      // 设置文件缺失或损坏时不阻断启动
    }
  }
  if (runtimeApiBaseUrl) {
    realBackend = runtimeApiBaseUrl;
  }

  let nextApiBaseUrl = realBackend;
  if (window.electronRuntime?.setProxyTarget && window.electronRuntime?.getLocalApiProxyBaseUrl) {
    try {
      await window.electronRuntime.setProxyTarget(realBackend);
      nextApiBaseUrl = await window.electronRuntime.getLocalApiProxyBaseUrl();
    } catch (error) {
      options.log("bootstrap:api-proxy:failed", { error: String(error) });
      nextApiBaseUrl = realBackend;
    }
  }

  const nextClientId = runtimeClientId || generateFallbackClientId();
  return { apiBaseUrl: nextApiBaseUrl, clientId: nextClientId };
}
