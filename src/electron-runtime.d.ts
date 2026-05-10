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
    };
  }
}
