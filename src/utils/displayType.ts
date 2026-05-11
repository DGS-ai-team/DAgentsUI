import type { ToolResultDisplayType } from "../ui-contracts";

/** 将后端 display_type 归一化为受支持的枚举；未知值回退为 normal_text。 */
export function normalizeToolDisplayType(value: unknown): ToolResultDisplayType {
  const raw = String(value ?? "").trim();
  if (raw === "terminal" || raw === "code" || raw === "normal_text" || raw === "image" || raw === "markdown") {
    return raw;
  }
  return "normal_text";
}
