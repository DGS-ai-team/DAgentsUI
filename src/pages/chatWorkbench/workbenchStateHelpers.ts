import type {
  ApprovalTask,
  RuntimeState,
  ToolCallItem,
  ToolExecutionRecord,
  ToolResultDisplayType,
} from "../../ui-contracts";
import { buildToolExecutionSummary } from "./messageHelpers";
import { extractToolCallsFromPayload } from "./toolPayload";

export function appendUniqueId(current: string[], id: string): string[] {
  return current.includes(id) ? current : [...current, id];
}

export function appendUniqueIds(current: string[], ids: string[]): string[] {
  const next = [...current];
  for (const id of ids) {
    if (id && !next.includes(id)) {
      next.push(id);
    }
  }
  return next;
}

export function removeIds(current: string[], ids: string[]): string[] {
  if (ids.length === 0) {
    return current;
  }
  return current.filter((id) => !ids.includes(id));
}

export function upsertToolExecutionRecord(
  current: ToolExecutionRecord[],
  item: ToolExecutionRecord,
): ToolExecutionRecord[] {
  const index = current.findIndex((row) => row.id === item.id);
  if (index < 0) {
    return [...current, item];
  }
  const existing = current[index];
  if (
    item.status === "running" &&
    (existing.status === "success" || existing.status === "rejected" || existing.status === "error")
  ) {
    return current;
  }
  const next = [...current];
  next[index] = item;
  return next;
}

export function upsertToolResultExecutionRecord(args: {
  current: ToolExecutionRecord[];
  sessionId: string;
  requestId: string;
  toolCallId: string;
  toolName: string;
  content: string;
  rejected: boolean;
  displayType: ToolResultDisplayType;
  rawRef: string;
  truncated: boolean;
  sensitiveFiltered: boolean;
  payload: Record<string, unknown>;
  fromPendingSnapshot: Record<string, unknown>;
  pickedArgs: Record<string, unknown>;
  now: number;
}): ToolExecutionRecord[] {
  const idx = args.current.findIndex((row) => row.toolCallId === args.toolCallId);
  const status = args.rejected ? "rejected" : "success";
  if (idx < 0) {
    const mergedArguments = { ...args.fromPendingSnapshot, ...args.pickedArgs };
    const created: ToolExecutionRecord = {
      id: `${args.requestId}:${args.toolCallId}`,
      sessionId: args.sessionId,
      requestId: args.requestId,
      createdAt: args.now,
      toolCallId: args.toolCallId,
      toolName: args.toolName,
      arguments: mergedArguments,
      status,
      summary: buildToolExecutionSummary(args.toolName, status, args.content),
      resultContent: args.content,
      displayType: args.displayType,
      rawRef: args.rawRef,
      truncated: args.truncated,
      sensitiveFiltered: args.sensitiveFiltered,
      detail: JSON.stringify(args.payload, null, 2),
      finishedAt: args.now,
    };
    return [...args.current, created];
  }

  const next = [...args.current];
  const existing = next[idx];
  const mergedArguments = {
    ...args.fromPendingSnapshot,
    ...existing.arguments,
    ...args.pickedArgs,
  };
  next[idx] = {
    ...existing,
    status,
    summary: buildToolExecutionSummary(existing.toolName || args.toolName, status, args.content),
    resultContent: args.content,
    displayType: args.displayType,
    rawRef: args.rawRef,
    truncated: args.truncated,
    sensitiveFiltered: args.sensitiveFiltered,
    detail: JSON.stringify(args.payload, null, 2),
    finishedAt: args.now,
    arguments: mergedArguments,
  };
  return next;
}

export function createApprovalTaskFromPayload(args: {
  sessionId: string;
  requestId: string;
  payload: Record<string, unknown>;
  createdAt: number;
}): ApprovalTask | null {
  const toolCalls = extractToolCallsFromPayload(args.payload);
  if (toolCalls.length === 0) {
    return null;
  }
  const idRaw = typeof args.payload.approval_id === "string" ? args.payload.approval_id : "";
  const approvalId = idRaw || `${args.requestId}-${args.createdAt}`;
  return {
    id: approvalId,
    sessionId: args.sessionId,
    requestId: args.requestId,
    createdAt: args.createdAt,
    payload: {
      message: typeof args.payload.content === "string" ? args.payload.content : "工具调用",
      description: typeof args.payload.description === "string" ? args.payload.description : "",
      args: { tool_calls: toolCalls as ToolCallItem[] },
    },
    handled: false,
  };
}

export function upsertApprovalTask(current: ApprovalTask[], task: ApprovalTask): ApprovalTask[] {
  const exists = current.some((item) => item.id === task.id);
  return exists ? current.map((item) => (item.id === task.id ? task : item)) : [...current, task];
}

export function usageRuntimeState(args: {
  previous?: RuntimeState;
  fallback: RuntimeState;
  payload: Record<string, unknown>;
}): RuntimeState {
  const prev = args.previous ?? args.fallback;
  const input = Number(args.payload.prompt_tokens ?? 0);
  const output = Number(args.payload.completion_tokens ?? 0);
  const total = Number(args.payload.total_tokens ?? input + output);
  return {
    ...prev,
    usage: {
      inputTokens: Number.isFinite(input) ? input : prev.usage.inputTokens,
      outputTokens: Number.isFinite(output) ? output : prev.usage.outputTokens,
      totalTokens: Number.isFinite(total) ? total : prev.usage.totalTokens,
    },
  };
}
