/**
 * 从按 session 分桶的 Record 中移除指定键。
 * 键不存在时返回原对象引用，避免触发下游无意义的重渲染。
 */
export function omitSessionKey<T>(prev: Record<string, T>, sessionId: string): Record<string, T> {
  if (!(sessionId in prev)) {
    return prev;
  }
  const next = { ...prev };
  delete next[sessionId];
  return next;
}
