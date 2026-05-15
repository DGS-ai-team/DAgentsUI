export {};

declare global {
  interface Window {
    electronRuntime?: {
      getRuntimeApiBaseUrl: () => string | null;
      getOrCreateClientId: () => string;
      readUserSettings: () => Promise<Record<string, unknown>>;
      writeUserSettings: (patch: Record<string, unknown>) => Promise<Record<string, unknown>>;
      getUserSettingsFilePath: () => Promise<string>;
      setProxyTarget: (url: string) => Promise<{ ok: boolean; target: string }>;
      getLocalApiProxyBaseUrl: () => Promise<string>;
      /** 当前内置反向代理实际监听端口（与 .env / 环境变量 API_PROXY_PORT 一致，缺省为 37421）。 */
      getApiProxyListenPort: () => Promise<number>;
      /** 主进程日志目录与当前日志文件路径（Electron）。 */
      getLogPaths: () => Promise<{ dir: string; file: string }>;
    };
  }
}
