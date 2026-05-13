import { useState } from "react";

import { ChatWorkbench } from "./pages/ChatWorkbench";
import { SettingsPage } from "./pages/SettingsPage";
import { SettingsProvider } from "./settings/SettingsContext";

export function App() {
  const [view, setView] = useState<"chat" | "settings">("chat");

  return (
    <SettingsProvider>
      <div className="app-shell">
        <div className={view === "settings" ? "app-shell__chat app-shell__chat--hidden" : "app-shell__chat"}>
          <ChatWorkbench onOpenSettings={() => setView("settings")} />
        </div>
        {view === "settings" ? (
          <div className="app-shell__settings">
            <SettingsPage onBack={() => setView("chat")} />
          </div>
        ) : null}
      </div>
    </SettingsProvider>
  );
}
