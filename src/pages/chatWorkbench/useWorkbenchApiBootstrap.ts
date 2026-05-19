import { useEffect, useMemo, useState } from "react";

import { DAgentsApiClient } from "../../api/client";
import {
  DEFAULT_REAL_BACKEND,
  resolveWorkbenchApiBase,
  type WorkbenchBootstrapLog,
} from "./resolveApiBaseUrl";

const resolvedApiBaseUrl = String(import.meta.env.VITE_API_BASE_URL ?? "").trim();
const isElectronShell = typeof window !== "undefined" && Boolean(window.electronRuntime);
const initialApiBaseUrl = isElectronShell
  ? DEFAULT_REAL_BACKEND
  : resolvedApiBaseUrl || DEFAULT_REAL_BACKEND;

export function useWorkbenchApiBootstrap(log: WorkbenchBootstrapLog) {
  const [apiBaseUrl, setApiBaseUrl] = useState<string>(initialApiBaseUrl);
  const [apiReady, setApiReady] = useState(false);
  const [clientId, setClientId] = useState<string>("");
  const [clientReady, setClientReady] = useState(false);

  const api = useMemo(
    () =>
      new DAgentsApiClient({
        baseUrl: apiBaseUrl,
      }),
    [apiBaseUrl],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await resolveWorkbenchApiBase({
        resolvedViteUrl: resolvedApiBaseUrl,
        log,
      });
      if (!cancelled) {
        setApiBaseUrl(result.apiBaseUrl);
        setClientId(result.clientId);
        setClientReady(true);
        setApiReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [log]);

  return {
    api,
    apiBaseUrl,
    apiReady,
    clientId,
    clientReady,
    configuredApiBaseUrl: resolvedApiBaseUrl,
  };
}
