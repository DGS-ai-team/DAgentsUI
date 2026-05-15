import { normalizeTextNewlines } from "./textNewlines";

export type ReadFileMetaRow = { label: string; value: string };

export type ReadFileBodyRow =
  | { kind: "line"; lineNumber: string; content: string }
  | { kind: "gap" };

/**
 * 解析 read_file 类工具的「元信息 + --- + 行号>内容」展示格式。
 * 解析失败返回 null，由调用方回退到通用 DisplayTypeContentPreview。
 */
export function tryParseReadFileStructuredDisplay(raw: string): {
  meta: ReadFileMetaRow[];
  rows: ReadFileBodyRow[];
} | null {
  const text = normalizeTextNewlines(String(raw ?? ""));
  if (!text.trim()) {
    return null;
  }
  const lines = text.split("\n");

  let sep = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      sep = i;
      break;
    }
  }

  let metaLines: string[];
  let bodyLines: string[];
  if (sep >= 0) {
    metaLines = lines.slice(0, sep);
    bodyLines = lines.slice(sep + 1);
  } else {
    let firstNum = -1;
    for (let i = 0; i < lines.length; i++) {
      if (/^\s*\d+>/.test(lines[i])) {
        firstNum = i;
        break;
      }
    }
    if (firstNum < 0) {
      return null;
    }
    metaLines = lines.slice(0, firstNum);
    bodyLines = lines.slice(firstNum);
  }

  const meta: ReadFileMetaRow[] = [];
  for (const line of metaLines) {
    const t = line.trim();
    if (!t) {
      continue;
    }
    const ci = t.indexOf(":");
    if (ci > 0) {
      meta.push({ label: t.slice(0, ci).trim(), value: t.slice(ci + 1).trim() });
    }
  }

  const rows: ReadFileBodyRow[] = [];
  for (const line of bodyLines) {
    if (!line.trim()) {
      rows.push({ kind: "gap" });
      continue;
    }
    const m = line.match(/^\s*(\d+)>(.*)$/);
    if (!m) {
      return null;
    }
    rows.push({ kind: "line", lineNumber: m[1], content: m[2] });
  }

  if (rows.length === 0) {
    return null;
  }
  return { meta, rows };
}

/** 右下角仅展示：含「修改时间」与「展示行区间」的元数据行（其余丢弃）。 */
export function pickReadFileCornerMetaRows(meta: ReadFileMetaRow[]): ReadFileMetaRow[] {
  const time = meta.find((m) => m.label.includes("修改时间"));
  const range = meta.find((m) => m.label.includes("展示行区间"));
  const out: ReadFileMetaRow[] = [];
  if (time) {
    out.push(time);
  }
  if (range) {
    out.push(range);
  }
  return out;
}
