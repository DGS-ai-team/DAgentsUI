import type { ToolResultDisplayType } from "../ui-contracts";
import { normalizeToolDisplayType } from "./displayType";
import { normalizeTextNewlines } from "./textNewlines";

/** 工具参数里常见路径字段（与后端约定对齐，可多键回退）。 */
export const TOOL_PATH_ARGUMENT_KEYS = [
  "path",
  "file_path",
  "target_path",
  "filepath",
  "filename",
  "file",
] as const;

export function isWriteFileToolName(name: string): boolean {
  return name.trim().toLowerCase() === "write_file";
}

function firstStringField(args: Record<string, unknown>, keys: readonly string[]): string {
  for (const key of keys) {
    const v = args[key];
    if (typeof v === "string" && v.trim()) {
      return v.trim();
    }
  }
  return "";
}

/** 从工具 arguments 对象中解析路径（首个非空字段）。 */
export function pathFromToolArguments(args: Record<string, unknown>): string {
  return firstStringField(args, TOOL_PATH_ARGUMENT_KEYS);
}

/**
 * 从 tool_result 落库的 detail（整段 payload JSON）中回退解析路径。
 * 因 SSE 里 `arguments` 可能不在与前端相同的字段上，或历史记录 arguments 为空。
 */
export function extractPathFromDetailJson(detail: string | undefined): string {
  if (!detail?.trim()) {
    return "";
  }
  try {
    const root = JSON.parse(detail) as Record<string, unknown>;
    const seen = new Set<object>();
    const queue: Record<string, unknown>[] = [root];
    const enqueue = (o: unknown) => {
      if (o && typeof o === "object" && !Array.isArray(o)) {
        const obj = o as object;
        if (!seen.has(obj)) {
          seen.add(obj);
          queue.push(o as Record<string, unknown>);
        }
      }
    };
    enqueue(root.data);
    const data = root.data as Record<string, unknown> | undefined;
    if (data) {
      enqueue(data.arguments);
      enqueue(data.args);
    }
    enqueue(root.arguments);
    enqueue(root.args);
    for (const blob of queue) {
      const p = pathFromToolArguments(blob);
      if (p) {
        return p;
      }
    }
  } catch {
    return "";
  }
  return "";
}

/** 路径展示用：取最后一段文件名。 */
export function fileDisplayName(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const i = normalized.lastIndexOf("/");
  return i >= 0 ? normalized.slice(i + 1) : normalized;
}

/**
 * 解析 write_file 的 arguments；可选传入 tool_result 上的 displayType（优先于参数内字段）。
 * `detailJson` 为落库的 SSE payload 字符串时，可在 arguments 为空时从中回退解析 path。
 */
export function parseWriteFileArguments(
  args: Record<string, unknown>,
  recordDisplayType?: ToolResultDisplayType,
  detailJson?: string,
): { path: string; content: string; displayType: ToolResultDisplayType } | null {
  const path = pathFromToolArguments(args) || extractPathFromDetailJson(detailJson);
  const rawContent = typeof args.content === "string" ? args.content : "";
  const content = normalizeTextNewlines(rawContent);
  const fromArgs = normalizeToolDisplayType(
    args.display_type !== undefined ? args.display_type : args.displayType,
  );
  const displayType = recordDisplayType ?? fromArgs;
  if (!path && !content.trim()) {
    return null;
  }
  return { path, content, displayType };
}

/** 正文优先 arguments.content，否则回退到 tool_result 的 result 文本。 */
export function resolveWriteFilePreviewText(argsContent: string, resultContent?: string): string {
  const fromArgs = normalizeTextNewlines(argsContent);
  if (fromArgs.trim()) {
    return fromArgs;
  }
  const fromResult = normalizeTextNewlines(resultContent ?? "");
  return fromResult.trim() ? fromResult : "";
}

/** 详情 JSON 中避免再次塞入整段 content，减少与上文预览重复。 */
export function omitWriteFileContentInArgsCopy(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...args };
  if (typeof out.content === "string" && out.content.length > 0) {
    out.content = `〈${out.content.length} 字符，正文见上文预览〉`;
  }
  return out;
}
