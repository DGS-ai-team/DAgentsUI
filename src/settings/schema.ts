export interface UserSettings {
  /** 为 true 时与原先一致：流式展示 reasoning 全文 */
  showReasoningDetail: boolean;
  /** Electron：真实 DAgents API 根地址（可选，写入设置文件后重启仍生效） */
  backendBaseUrl?: string;
}

export const DEFAULT_USER_SETTINGS: UserSettings = {
  showReasoningDetail: true,
};

export function mergeUserSettings(raw: unknown): UserSettings {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const backendRaw = o.backendBaseUrl;
  const backendBaseUrl =
    typeof backendRaw === "string" && backendRaw.trim() ? backendRaw.trim().replace(/\/+$/, "") : undefined;
  return {
    showReasoningDetail:
      typeof o.showReasoningDetail === "boolean"
        ? o.showReasoningDetail
        : DEFAULT_USER_SETTINGS.showReasoningDetail,
    ...(backendBaseUrl ? { backendBaseUrl } : {}),
  };
}
