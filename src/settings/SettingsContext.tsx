import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { getDefaultUserSettings, loadUserSettings, saveUserSettings as persistSave } from "./persist";
import type { UserSettings } from "./schema";

type SettingsContextValue = {
  settings: UserSettings;
  loaded: boolean;
  saveSettings: (patch: Partial<UserSettings>) => Promise<void>;
};

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<UserSettings>(getDefaultUserSettings);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const next = await loadUserSettings();
        if (!cancelled) {
          setSettings(next);
        }
      } catch {
        if (!cancelled) {
          setSettings(getDefaultUserSettings());
        }
      } finally {
        if (!cancelled) {
          setLoaded(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const saveSettings = useCallback(async (patch: Partial<UserSettings>) => {
    const next = await persistSave(patch);
    setSettings(next);
  }, []);

  const value = useMemo(
    () => ({
      settings,
      loaded,
      saveSettings,
    }),
    [settings, loaded, saveSettings],
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) {
    throw new Error("useSettings must be used within SettingsProvider");
  }
  return ctx;
}
