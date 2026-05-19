import type { ChatMessage } from "../../ui-contracts";

export function createMessage(
  sessionId: string,
  role: ChatMessage["role"],
  content: string,
  requestId?: string,
): ChatMessage {
  return {
    id: `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    sessionId,
    requestId,
    createdAt: Date.now(),
    role,
    content,
  };
}

export function buildToolExecutionSummary(
  toolName: string,
  status: "running" | "success" | "rejected" | "error",
  rawText?: string,
): string {
  const name = (toolName || "工具").trim();
  if (status === "running") {
    return `${name} 正在执行`;
  }
  if (status === "rejected") {
    return `${name} 已拒绝`;
  }
  if (status === "error") {
    return `${name} 执行失败`;
  }
  const text = String(rawText ?? "").trim();
  if (!text) {
    return `${name} 已完成`;
  }
  const compact = text.replace(/\s+/g, " ");
  const clipped = compact.length > 56 ? `${compact.slice(0, 56)}...` : compact;
  return `${name}：${clipped}`;
}
