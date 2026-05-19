export const DEFAULT_SESSION_ID = "main";

export function buildSessionHistory(sessionIds: string[]): string[] {
  const hasDefaultSession = sessionIds.includes(DEFAULT_SESSION_ID);
  const others = sessionIds.filter((sid) => sid !== DEFAULT_SESSION_ID).reverse();
  return hasDefaultSession ? [DEFAULT_SESSION_ID, ...others] : others;
}

export function getSessionDisplayTitle({
  sessionId,
  sessionIds,
  sessionTitleById,
}: {
  sessionId: string;
  sessionIds: string[];
  sessionTitleById: Record<string, string>;
}): string {
  const custom = (sessionTitleById[sessionId] ?? "").trim();
  if (custom) {
    return custom;
  }
  if (sessionId === DEFAULT_SESSION_ID) {
    return "默认对话";
  }
  const order = sessionIds.findIndex((item) => item === sessionId);
  const displayOrder = order >= 0 ? order + 1 : 0;
  return displayOrder > 0 ? `对话 ${displayOrder}` : "对话";
}
