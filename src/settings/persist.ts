import { DEFAULT_USER_SETTINGS, mergeUserSettings, type UserSettings } from "./schema";

const STORAGE_KEY = "dagents-ui-user-settings";

function readWebRaw(): unknown {
  try {
    const s = localStorage.getItem(STORAGE_KEY);
    if (!s) {
      return {};
    } else {
      return JSON.parse(s) as unknown;
    }
  } catch {
    return {};
  }
}

export async function loadUserSettings(): Promise<UserSettings> {
  if (typeof window !== "undefined" && window.electronRuntime?.readUserSettings) {
    const disk = await window.electronRuntime.readUserSettings();
    return mergeUserSettings(disk);
  }
  return mergeUserSettings(readWebRaw());
}

export async function saveUserSettings(patch: Partial<UserSettings>): Promise<UserSettings> {
  if (typeof window !== "undefined" && window.electronRuntime?.writeUserSettings) {
    const next = await window.electronRuntime.writeUserSettings(patch);
    return mergeUserSettings(next);
  }
  const prev = mergeUserSettings(readWebRaw());
  const next: Record<string, unknown> = { ...prev, ...patch };
  if (Object.prototype.hasOwnProperty.call(patch, "backendBaseUrl") && patch.backendBaseUrl === "") {
    delete next.backendBaseUrl;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return mergeUserSettings(next);
}

export function getDefaultUserSettings(): UserSettings {
  return { ...DEFAULT_USER_SETTINGS };
}
