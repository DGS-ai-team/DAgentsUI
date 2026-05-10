import { useState } from "react";

import { ChatWorkbench } from "./pages/ChatWorkbench";
import { SettingsPage } from "./pages/SettingsPage";
import { SettingsProvider } from "./settings/SettingsContext";

export function App() {
  const [view, setView] = useState<"chat" | "settings">("chat");

  return (
    <SettingsProvider>
      {view === "chat" ? (
        <ChatWorkbench onOpenSettings={() => setView("settings")} />
      ) : (
        <SettingsPage onBack={() => setView("chat")} />
      )}
    </SettingsProvider>
  );
}
