import { useCallback, useRef, type Dispatch, type SetStateAction } from "react";

import { toolCallDeltaSlotsToDrafts, type ToolCallDeltaSlot } from "../../utils/toolCallStream";
import type { ToolCallDraft } from "../../ui-contracts";

type ToolCallDeltaBufferByRequest = Record<string, Map<number, ToolCallDeltaSlot>>;

function toolCallDraftBufferKey(sessionId: string, requestId: string) {
  return `${sessionId}::${requestId}`;
}

export function useToolCallDraftBuffers(
  setToolCallDraftsBySession: Dispatch<SetStateAction<Record<string, ToolCallDraft[]>>>,
) {
  const toolCallDeltaBufferRef = useRef<ToolCallDeltaBufferByRequest>({});

  const getOrCreateToolCallBuffer = useCallback((sessionId: string, requestId: string) => {
    const key = toolCallDraftBufferKey(sessionId, requestId);
    if (!toolCallDeltaBufferRef.current[key]) {
      toolCallDeltaBufferRef.current[key] = new Map();
    }
    return toolCallDeltaBufferRef.current[key];
  }, []);

  const syncToolCallDraftsForRequest = useCallback(
    (sessionId: string, requestId: string) => {
      const buffer = toolCallDeltaBufferRef.current[toolCallDraftBufferKey(sessionId, requestId)];
      const drafts = buffer ? toolCallDeltaSlotsToDrafts(buffer) : [];
      setToolCallDraftsBySession((prev) => ({ ...prev, [sessionId]: drafts }));
    },
    [setToolCallDraftsBySession],
  );

  const clearToolCallDraftsForRequest = useCallback(
    (sessionId: string, requestId: string) => {
      delete toolCallDeltaBufferRef.current[toolCallDraftBufferKey(sessionId, requestId)];
      setToolCallDraftsBySession((prev) => ({ ...prev, [sessionId]: [] }));
    },
    [setToolCallDraftsBySession],
  );

  const clearToolCallDraftsForSession = useCallback((sessionId: string) => {
    for (const key of Object.keys(toolCallDeltaBufferRef.current)) {
      if (key.startsWith(`${sessionId}::`)) {
        delete toolCallDeltaBufferRef.current[key];
      }
    }
  }, []);

  const resetToolCallDraftBuffers = useCallback(() => {
    toolCallDeltaBufferRef.current = {};
    setToolCallDraftsBySession({});
  }, [setToolCallDraftsBySession]);

  return {
    getOrCreateToolCallBuffer,
    syncToolCallDraftsForRequest,
    clearToolCallDraftsForRequest,
    clearToolCallDraftsForSession,
    resetToolCallDraftBuffers,
  };
}
