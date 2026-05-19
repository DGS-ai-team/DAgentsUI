import type { WorkbenchBootstrapLog } from "./resolveApiBaseUrl";

export const workbenchSseEventTypes = [
  "assistant",
  "reasoning",
  "tool_call_delta",
  "tool_call",
  "tool_result",
  "approval_required",
  "usage",
  "error",
  "done",
  "subagent_started",
  "subagent_delta",
  "subagent_done",
  "subagent_error",
] as const;

export type WorkbenchSseEventType = (typeof workbenchSseEventTypes)[number];

export function parseWorkbenchSseEnvelope({
  eventType,
  rawData,
  lastEventId,
  clientId,
  rememberEventSeq,
  log,
}: {
  eventType: WorkbenchSseEventType;
  rawData: string;
  lastEventId: string;
  clientId: string;
  rememberEventSeq: (eventKey: string) => boolean;
  log: WorkbenchBootstrapLog;
}): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(rawData) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }

    const envelope = parsed as Record<string, unknown>;
    const parsedClientId = String(envelope.client_id ?? "").trim();
    if (parsedClientId && parsedClientId !== clientId) {
      return null;
    }

    const seqNumber = Number(envelope.seq ?? lastEventId);
    if (Number.isFinite(seqNumber) && seqNumber >= 0) {
      const eventKey = `${clientId}:${seqNumber}`;
      if (!rememberEventSeq(eventKey)) {
        log("sse:event:deduplicated", { eventType, seq: seqNumber });
        return null;
      }
    }

    return envelope;
  } catch (error) {
    log("sse:parse:error", {
      eventType,
      rawData,
      error: String(error),
    });
    return null;
  }
}
