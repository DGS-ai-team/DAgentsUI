/** 启动期解析 API 基址与 clientId 时的日志（与页面 wbLog 签名一致）。 */
export type WorkbenchBootstrapLog = (message: string, payload?: unknown) => void;

export type ResolveWorkbenchApiBaseResult = {
  apiBaseUrl: string;
  clientId: string;
};

export const DEFAULT_REAL_BACKEND = "http://127.0.0.1:8000";

function isElectronRuntime(): boolean {
  return typeof window !== "undefined" && Boolean(window.electronRuntime);
}

function generateFallbackClientId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `client-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 启动时确定最终 API Base URL 与 clientId。
 *
 * Web：Vite 构建期 `VITE_API_BASE_URL` → 默认 8000。
 * Electron：不使用 `VITE_API_BASE_URL`（避免本地 .env 与 CI 构建不一致）；
 * 真实后端优先级为运行时 `.env` 的 `API_BASE_URL` → 用户设置 `backendBaseUrl` → 默认 8000。
 * Electron 下将真实后端注册到主进程代理，页面实际请求本地代理地址。
 */
export async function resolveWorkbenchApiBase(options: {
  resolvedViteUrl: string;
  log: WorkbenchBootstrapLog;
}): Promise<ResolveWorkbenchApiBaseResult> {
  const electron = isElectronRuntime();
  const runtimeClientId = String(
    (await window.electronRuntime?.getOrCreateClientId?.()) ?? "",
  ).trim();

  let realBackend = electron
    ? DEFAULT_REAL_BACKEND
    : options.resolvedViteUrl || DEFAULT_REAL_BACKEND;

  if (electron && window.electronRuntime?.getRealBackendUrl) {
    try {
      realBackend = (await window.electronRuntime.getRealBackendUrl()).replace(/\/+$/, "");
    } catch (error) {
      options.log("bootstrap:real-backend:failed", { error: String(error) });
    }
  }

  let nextApiBaseUrl = realBackend;
  if (window.electronRuntime?.setProxyTarget && window.electronRuntime?.getLocalApiProxyBaseUrl) {
    try {
      await window.electronRuntime.setProxyTarget(realBackend);
      nextApiBaseUrl = await window.electronRuntime.getLocalApiProxyBaseUrl();
      options.log("bootstrap:api-proxy", { realBackend, proxyBaseUrl: nextApiBaseUrl });
    } catch (error) {
      options.log("bootstrap:api-proxy:failed", { error: String(error) });
      nextApiBaseUrl = realBackend;
    }
  }

  const nextClientId = runtimeClientId || generateFallbackClientId();
  return { apiBaseUrl: nextApiBaseUrl, clientId: nextClientId };
}
