/** 将 CRLF / 孤立 CR 转为 LF，便于 Markdown、pre 与多行文本一致换行。 */
export function normalizeTextNewlines(text: string): string {
  return String(text).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}
