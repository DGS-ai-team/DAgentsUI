import type { ToolCallItem } from "../../ui-contracts";

export function pickToolArgumentsFromToolResultPayload(p: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const nested =
    p.arguments && typeof p.arguments === "object" && !Array.isArray(p.arguments)
      ? (p.arguments as Record<string, unknown>)
      : p.args && typeof p.args === "object" && !Array.isArray(p.args)
        ? (p.args as Record<string, unknown>)
        : null;
  if (nested) {
    Object.assign(out, nested);
  }
  for (const key of ["path", "file_path", "target_path", "filepath", "filename", "file"]) {
    const v = p[key];
    if (typeof v === "string" && v.trim()) {
      const cur = out[key];
      if (typeof cur !== "string" || !cur.trim()) {
        out[key] = v.trim();
      }
    }
  }
  return out;
}

export function normalizeToolCallItemArguments(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // ignore invalid JSON
    }
  }
  return {};
}

export function extractToolCallsFromPayload(payload: Record<string, unknown>): ToolCallItem[] {
  const root = payload.tool_calls;
  if (Array.isArray(root) && root.length > 0) {
    return root as ToolCallItem[];
  }
  const fromApproval = (payload.approval_args ?? {}) as { tool_calls?: unknown };
  if (Array.isArray(fromApproval.tool_calls) && fromApproval.tool_calls.length > 0) {
    return fromApproval.tool_calls as ToolCallItem[];
  }
  const fromArgs = (payload.args ?? {}) as { tool_calls?: unknown };
  if (Array.isArray(fromArgs.tool_calls) && fromArgs.tool_calls.length > 0) {
    return fromArgs.tool_calls as ToolCallItem[];
  }
  return [];
}
