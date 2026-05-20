import type { ToolCallDraft, ToolCallItem } from "../ui-contracts";

/** OpenAI 流式 tool_calls 分片在缓冲区的单槽位。 */
export type ToolCallDeltaSlot = {
  index: number;
  toolCallId?: string;
  toolName?: string;
  argumentParts: string[];
};

type OpenAiToolCallChunk = {
  index?: number;
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string };
  name?: string;
  arguments?: unknown;
};

/** 从 done 事件 payload 解析 finish_reason（小写）。 */
export function parseFinishReason(payload: Record<string, unknown>): string {
  const raw = payload.finish_reason ?? payload.finishReason;
  return typeof raw === "string" ? raw.trim().toLowerCase() : "";
}

/** 整轮任务正常结束。 */
export function isTerminalTurnFinishReason(reason: string): boolean {
  return reason === "stop";
}

/** 整轮任务异常结束。 */
export function isErrorTurnFinishReason(reason: string): boolean {
  return reason === "error" || reason === "resume_rejected";
}

/** 当前模型输出段结束，但 Agent 仍在执行工具或等待后续输出。 */
export function isSegmentEndFinishReason(reason: string): boolean {
  return reason === "tool_calls";
}

/** tool_call 事件中的 assistant 说明文案。 */
export function extractAssistantContentFromToolPayload(payload: Record<string, unknown>): string {
  if (typeof payload.assistant_content === "string") {
    return payload.assistant_content;
  }
  if (typeof payload.content === "string") {
    return payload.content;
  }
  return "";
}

function readArgumentDelta(chunk: OpenAiToolCallChunk): string {
  if (typeof chunk.function?.arguments === "string") {
    return chunk.function.arguments;
  }
  if (typeof chunk.arguments === "string") {
    return chunk.arguments;
  }
  return "";
}

function readToolName(chunk: OpenAiToolCallChunk): string | undefined {
  const fromFn = chunk.function?.name;
  if (typeof fromFn === "string" && fromFn.trim()) {
    return fromFn.trim();
  }
  if (typeof chunk.name === "string" && chunk.name.trim()) {
    return chunk.name.trim();
  }
  return undefined;
}

/**
 * 将单条 tool_call_delta 的 tool_calls 数组合并进缓冲区（按 index）。
 * 返回是否有更新。
 */
export function applyToolCallDeltaChunks(
  buffer: Map<number, ToolCallDeltaSlot>,
  toolCalls: unknown[],
): boolean {
  if (!Array.isArray(toolCalls) || toolCalls.length === 0) {
    return false;
  }
  let changed = false;
  for (const raw of toolCalls) {
    if (!raw || typeof raw !== "object") {
      continue;
    }
    const chunk = raw as OpenAiToolCallChunk;
    const index = Number.isFinite(Number(chunk.index)) ? Number(chunk.index) : 0;
    const slot = buffer.get(index) ?? {
      index,
      argumentParts: [],
    };
    let slotChanged = false;
    if (typeof chunk.id === "string" && chunk.id.trim() && chunk.id !== slot.toolCallId) {
      slot.toolCallId = chunk.id.trim();
      slotChanged = true;
    }
    const name = readToolName(chunk);
    if (name && name !== slot.toolName) {
      slot.toolName = name;
      slotChanged = true;
    }
    const argDelta = readArgumentDelta(chunk);
    if (argDelta) {
      const currentArgs = slot.argumentParts.join("");
      if (!currentArgs || argDelta.startsWith(currentArgs)) {
        slot.argumentParts = [argDelta];
        slotChanged = argDelta !== currentArgs;
      } else if (argDelta !== currentArgs) {
        slot.argumentParts.push(argDelta);
        slotChanged = true;
      }
    }
    if (slotChanged) {
      buffer.set(index, slot);
      changed = true;
    } else if (!buffer.has(index)) {
      buffer.set(index, slot);
      changed = true;
    }
  }
  return changed;
}

export function toolCallDeltaSlotsToDrafts(buffer: Map<number, ToolCallDeltaSlot>): ToolCallDraft[] {
  const now = Date.now();
  return [...buffer.values()]
    .sort((a, b) => a.index - b.index)
    .map((slot) => ({
      index: slot.index,
      toolCallId: slot.toolCallId,
      toolName: slot.toolName,
      argumentsPreview: slot.argumentParts.join(""),
      updatedAt: now,
    }));
}

/** 将定稿 tool_calls 合并进 delta 缓冲（回合末 tool_call 覆盖分片）。 */
export function finalizeToolCallBufferFromItems(
  buffer: Map<number, ToolCallDeltaSlot>,
  toolCalls: ToolCallItem[],
): void {
  toolCalls.forEach((tc, idx) => {
    const index = idx;
    const id = String(tc.id ?? "").trim();
    const slot = buffer.get(index) ?? { index, argumentParts: [] };
    if (id) {
      slot.toolCallId = id;
    }
    if (tc.name) {
      slot.toolName = tc.name;
    }
    const argsRaw = tc.arguments;
    if (typeof argsRaw === "string") {
      slot.argumentParts = [argsRaw];
    } else if (argsRaw && typeof argsRaw === "object") {
      try {
        slot.argumentParts = [JSON.stringify(argsRaw)];
      } catch {
        slot.argumentParts = [];
      }
    }
    buffer.set(index, slot);
  });
}
