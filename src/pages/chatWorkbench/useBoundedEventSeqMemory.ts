import { useCallback, useRef } from "react";

export function useBoundedEventSeqMemory(limit: number) {
  const seenEventSeqRef = useRef<Set<string>>(new Set());

  const rememberEventSeq = useCallback(
    (eventKey: string) => {
      const seen = seenEventSeqRef.current;
      if (seen.has(eventKey)) {
        return false;
      }
      if (seen.size >= limit) {
        const oldest = seen.values().next().value;
        if (typeof oldest === "string") {
          seen.delete(oldest);
        }
      }
      seen.add(eventKey);
      return true;
    },
    [limit],
  );

  const clearEventSeqMemory = useCallback(() => {
    seenEventSeqRef.current.clear();
  }, []);

  return { rememberEventSeq, clearEventSeqMemory };
}
