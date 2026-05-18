import type { ToolCallDraft } from "../ui-contracts";

function ThinkingDots() {
  return (
    <span className="msg__meta-dots" aria-hidden="true">
      <span className="msg__meta-dot" />
      <span className="msg__meta-dot" />
      <span className="msg__meta-dot" />
    </span>
  );
}

export function ToolCallDraftBubble({ draft }: { draft: ToolCallDraft }) {
  const name = (draft.toolName || "工具").trim();
  const args = draft.argumentsPreview.trim();

  return (
    <div className="msg msg--tool-centered tool-call-draft">
      <div className="msg__body msg__body--wide">
        <div className="msg__hint msg__hint--stream-meta">
          <span className="msg__meta-label">tool_call_delta</span>
          <span className="tool-status-chip tool-status-chip--pending">生成中</span>
          <ThinkingDots />
        </div>
        <div className="msg__bubble msg__bubble--tool-centered tool-call-draft__bubble">
          <div className="tool-call-draft__title">{name}</div>
          {draft.toolCallId ? (
            <div className="tool-call-draft__meta">
              <code>{draft.toolCallId}</code>
            </div>
          ) : null}
          <pre className="tool-call-draft__args">{args || "（正在生成参数…）"}</pre>
        </div>
      </div>
    </div>
  );
}
