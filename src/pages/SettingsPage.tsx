import { useEffect, useState } from "react";

import { useSettings } from "../settings/SettingsContext";

type Props = {
  onBack: () => void;
};

export function SettingsPage({ onBack }: Props) {
  const { settings, loaded, saveSettings } = useSettings();
  const [showDetail, setShowDetail] = useState(settings.showReasoningDetail);
  const [backendDraft, setBackendDraft] = useState(settings.backendBaseUrl ?? "");
  const [settingsPath, setSettingsPath] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const isElectron = Boolean(
    typeof window !== "undefined" && window.electronRuntime?.getLocalApiProxyBaseUrl,
  );

  useEffect(() => {
    setShowDetail(settings.showReasoningDetail);
    setBackendDraft(settings.backendBaseUrl ?? "");
  }, [settings.showReasoningDetail, settings.backendBaseUrl]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (window.electronRuntime?.getUserSettingsFilePath) {
        try {
          const p = await window.electronRuntime.getUserSettingsFilePath();
          if (!cancelled) {
            setSettingsPath(p);
          }
        } catch {
          if (!cancelled) {
            setSettingsPath(null);
          }
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const onSave = async () => {
    setSaving(true);
    try {
      const patch: { showReasoningDetail: boolean; backendBaseUrl?: string } = {
        showReasoningDetail: showDetail,
      };
      if (isElectron) {
        patch.backendBaseUrl = backendDraft.trim();
      }
      await saveSettings(patch);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="app">
      <header className="app__header">
        <div className="app__brand">
          <div className="app__brand-mark" />
          <div>
            <div className="app__title">设置</div>
            <div className="app__subtitle">偏好写入本地文件（Electron）或浏览器存储（Web）</div>
          </div>
        </div>
        <div className="app__header-actions">
          <button type="button" className="btn btn--ghost" onClick={() => void onBack()}>
            返回工作台
          </button>
        </div>
      </header>

      <div className="settings-page">
        {!loaded ? (
          <p className="settings-page__hint">正在加载设置…</p>
        ) : (
          <>
            <section className="settings-section">
              <h2 className="settings-section__title">对话展示</h2>
              <label className="settings-toggle">
                <input
                  type="checkbox"
                  checked={showDetail}
                  onChange={(e) => setShowDetail(e.target.checked)}
                />
                <span>展示思考详情（流式输出 reasoning）</span>
              </label>
              <p className="settings-section__desc">
                关闭后，思考阶段仅显示「thinking」与等待动画，不再流式打印模型内部推理全文。
              </p>
            </section>

            {settingsPath ? (
              <section className="settings-section">
                <h2 className="settings-section__title">API 与反向代理</h2>
                <p className="settings-section__desc">
                  桌面版在 <code>127.0.0.1:37421</code> 启动内置反向代理，页面只访问该地址，由主进程转发到下方「真实后端」。
                  留空则使用默认 <code>http://127.0.0.1:8000</code>。项目根目录 <code>.env</code> 中的{" "}
                  <code>API_BASE_URL</code> 若存在，会在启动时覆盖此处（便于开发）。
                </p>
                <label className="settings-field">
                  <span className="settings-field__label">真实 DAgents API 根地址</span>
                  <input
                    type="url"
                    className="settings-field__input"
                    placeholder="http://127.0.0.1:8000"
                    value={backendDraft}
                    onChange={(e) => setBackendDraft(e.target.value)}
                  />
                </label>
              </section>
            ) : null}

            {settingsPath ? (
              <section className="settings-section">
                <h2 className="settings-section__title">配置文件</h2>
                <code className="settings-path">{settingsPath}</code>
              </section>
            ) : (
              <section className="settings-section">
                <h2 className="settings-section__title">存储位置</h2>
                <p className="settings-section__desc">当前为浏览器环境，设置保存在本机 localStorage 键名「dagents-ui-user-settings」。</p>
              </section>
            )}

            <div className="settings-actions">
              <button type="button" className="btn btn--primary" disabled={saving} onClick={() => void onSave()}>
                {saving ? "保存中…" : "保存设置"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
