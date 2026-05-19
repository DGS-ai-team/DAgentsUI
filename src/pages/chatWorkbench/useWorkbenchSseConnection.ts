import { useCallback, useRef, useState } from "react";

import type { WorkbenchBootstrapLog } from "./resolveApiBaseUrl";

export function useWorkbenchSseConnection(log: WorkbenchBootstrapLog) {
  const [sseConnected, setSseConnected] = useState(false);
  const [sseGeneration, setSseGeneration] = useState(0);
  const globalStreamRef = useRef<EventSource | null>(null);

  const closeGlobalSse = useCallback(() => {
    const es = globalStreamRef.current;
    if (!es) {
      return;
    }
    log("sse:global:close");
    es.close();
    globalStreamRef.current = null;
    setSseConnected(false);
  }, [log]);

  const openGlobalSse = useCallback(
    (streamUrl: string) => {
      closeGlobalSse();
      const es = new EventSource(streamUrl);
      globalStreamRef.current = es;
      setSseGeneration((value) => value + 1);
      return es;
    },
    [closeGlobalSse],
  );

  return {
    globalStreamRef,
    sseConnected,
    sseGeneration,
    setSseConnected,
    closeGlobalSse,
    openGlobalSse,
  };
}
