export {};

declare global {
  interface Window {
    electronRuntime?: {
      getRuntimeApiBaseUrl: () => string | null;
      getOrCreateClientId: () => string;
    };
  }
}
