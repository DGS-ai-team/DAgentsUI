import { pathFromToolArguments } from "./writeFileTool";
import { normalizeTextNewlines } from "./textNewlines";

/** 与后端约定一致：工具名 `edit_file`。 */
export function isEditFileToolName(name: string): boolean {
  return name.trim().toLowerCase() === "edit_file";
}

export interface NormalizedEditEntry {
  action: string;
  start_line?: number;
  end_line?: number;
  /** 展示用正文（已做换行规范化） */
  content: string;
}

export interface EditFileApprovalModel {
  path: string;
  edits: NormalizedEditEntry[];
}

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    return v as Record<string, unknown>;
  }
  return null;
}

function coerceEditsRoot(args: Record<string, unknown>): { root: Record<string, unknown> | null; rawString?: string } {
  const raw = args.edits_json;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) {
      return { root: null };
    }
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      return { root: asRecord(parsed), rawString: trimmed };
    } catch {
      return { root: null, rawString: trimmed };
    }
  }
  if (raw !== undefined && raw !== null) {
    const rec = asRecord(raw);
    return { root: rec };
  }
  if (Array.isArray(args.edits)) {
    return { root: { edits: args.edits } };
  }
  const nested = asRecord(args.args);
  if (nested && Array.isArray(nested.edits)) {
    return { root: nested };
  }
  return { root: null };
}

function numField(obj: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "number" && Number.isFinite(v)) {
      return v;
    }
    if (typeof v === "string" && v.trim()) {
      const n = Number(v);
      if (Number.isFinite(n)) {
        return n;
      }
    }
  }
  return undefined;
}

function strField(obj: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string") {
      return v;
    }
  }
  return "";
}

/** 将参数里的字面量 `\\n` 等转为换行（JSON 已解析一层后仍可能含转义序列）。 */
function normalizeEditContent(raw: string): string {
  if (!raw) {
    return "";
  }
  const unescaped = raw
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\\\/g, "\\");
  return normalizeTextNewlines(unescaped);
}

/**
 * 解析审批卡片中的 edit_file 参数。
 * 约定：`edits_json` 为 `{"edits":[...]}`；行号从 1 起；delete/replace 为闭区间；insert 在 start_line 行前插入。
 */
export function parseEditFileApprovalArguments(args: Record<string, unknown>): EditFileApprovalModel {
  const path = pathFromToolArguments(args);
  const { root } = coerceEditsRoot(args);

  if (!root) {
    return {
      path,
      edits: [],
    };
  }

  const editsRaw = root.edits;
  if (!Array.isArray(editsRaw)) {
    return {
      path,
      edits: [],
    };
  }

  const edits: NormalizedEditEntry[] = [];
  for (const item of editsRaw) {
    const row = asRecord(item);
    if (!row) {
      continue;
    }
    const action = String(row.action ?? row.type ?? "unknown").trim() || "unknown";
    const start_line = numField(row, "start_line", "startLine", "start");
    const end_line = numField(row, "end_line", "endLine", "end");
    const rawContent =
      typeof row.content === "string"
        ? row.content
        : typeof row.content === "number" && Number.isFinite(row.content)
          ? String(row.content)
          : strField(row, "text", "body");
    const content = normalizeEditContent(rawContent);
    edits.push({ action, start_line, end_line, content });
  }

  return {
    path,
    edits,
  };
}
