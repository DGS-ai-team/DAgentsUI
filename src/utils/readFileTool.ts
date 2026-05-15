import type { ToolExecutionRecord, ToolResultDisplayType } from "../ui-contracts";
import { extractPathFromDetailJson, pathFromToolArguments } from "./writeFileTool";
import { normalizeToolDisplayType } from "./displayType";
import { normalizeTextNewlines } from "./textNewlines";

export function isReadFileToolName(name: string): boolean {
  return name.trim().toLowerCase() === "read_file";
}

/**
 * 解析 read_file 工具执行记录：路径来自 arguments，正文优先 resultContent；
 * arguments 为空时从 detail（整段 payload JSON）回退解析路径。
 */
export function parseReadFileExecution(item: ToolExecutionRecord): {
  path: string;
  body: string;
  displayType: ToolResultDisplayType;
} | null {
  const args = item.arguments as Record<string, unknown>;
  const path = pathFromToolArguments(args) || extractPathFromDetailJson(item.detail);
  const rawBody = item.resultContent ?? item.summary ?? "";
  const body = normalizeTextNewlines(String(rawBody));
  const fromArgs = normalizeToolDisplayType(
    args.display_type !== undefined ? args.display_type : args.displayType,
  );
  const displayType = item.displayType ?? fromArgs;
  if (!path && !body.trim()) {
    return null;
  }
  return { path, body, displayType };
}
