import { useEffect, useMemo, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

import type {
  ApprovalTask,
  ChatMessage,
  MainChatPanelProps,
  MessageRole,
  ToolCallDraft,
  ToolExecutionRecord,
} from "../ui-contracts";
import { ApprovalToolBubble } from "./ApprovalToolBubble";
import { ToolCallDraftBubble } from "./ToolCallDraftBubble";
import { ToolExecutionBubble } from "./ToolExecutionBubble";

const ROLE_HINT: Partial<Record<MessageRole, string>> = {
  reasoning: "thinking",
  tool: "tool",
  system: "system",
};

function normalizeBubbleContent(message: ChatMessage): string {
  const raw = String(message.content ?? "").replace(/\r\n/g, "\n");
  if (message.role === "assistant" || message.role === "reasoning") {
    return raw.replace(/^\n+/, "").replace(/\n+$/, "");
  }
  return raw;
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const hint = ROLE_HINT[message.role];
  const content = normalizeBubbleContent(message);
  if (message.generatingPending) {
    return (
      <div className="msg msg--assistant msg--generating">
        <div className="msg__body msg__body--hint-only">
          <div className="msg__hint msg__hint--stream-meta">
            <span className="msg__meta-label">generating</span>
            <ThinkingDots />
          </div>
        </div>
      </div>
    );
  }
  if (message.role === "reasoning" && message.reasoningCollapsed) {
    return (
      <div className="msg msg--reasoning msg--reasoning-collapsed">
        <div className="msg__body msg__body--hint-only">
          <div className="msg__hint msg__hint--stream-meta">
            <span className="msg__meta-label">thinking</span>
            {message.reasoningPhaseActive ? <ThinkingDots /> : null}
          </div>
        </div>
      </div>
    );
  }
  if (message.role === "tool") {
    return (
      <div className="msg msg--tool-centered">
        <div className="msg__body msg__body--wide">
          {hint ? (
            <div className="msg__hint msg__hint--stream-meta">
              <span className="msg__meta-label">{hint}</span>
            </div>
          ) : null}
          <div className="msg__bubble msg__bubble--tool-centered">{content}</div>
        </div>
      </div>
    );
  }

  return (
    <div className={`msg msg--${message.role}`}>
      <div className="msg__body">
        {hint ? (
          <div
            className={`msg__hint${message.role === "reasoning" || message.role === "system" ? " msg__hint--stream-meta" : ""}`}
          >
            <span className={message.role === "reasoning" || message.role === "system" ? "msg__meta-label" : undefined}>
              {hint}
            </span>
            {message.reasoningPhaseActive ? <ThinkingDots /> : null}
          </div>
        ) : null}
        {message.role === "assistant" ? (
          <div className="msg__bubble msg__bubble--assistant-md">
            <div className="tool-exec-bubble__markdown assistant-msg__md">
              <Markdown
                remarkPlugins={[remarkGfm]}
                components={{
                  a: ({ href, children, ...rest }) => (
                    <a href={href} target="_blank" rel="noopener noreferrer" {...rest}>
                      {children}
                    </a>
                  ),
                  img: ({ src, alt, ...rest }) => (
                    <img src={src} alt={alt ?? ""} className="tool-exec-bubble__md-img" {...rest} />
                  ),
                }}
              >
                {content}
              </Markdown>
            </div>
          </div>
        ) : (
          <div className="msg__bubble">{content}</div>
        )}
      </div>
    </div>
  );
}

function ThinkingDots() {
  return (
    <span className="msg__meta-dots" aria-hidden="true">
      <span className="msg__meta-dot" />
      <span className="msg__meta-dot" />
      <span className="msg__meta-dot" />
    </span>
  );
}

type StreamItem =
  | { key: string; ts: number; kind: "message"; message: ChatMessage }
  | { key: string; ts: number; kind: "tool_call_draft"; draft: ToolCallDraft }
  | { key: string; ts: number; kind: "tool_execution"; execution: ToolExecutionRecord }
  | {
      key: string;
      ts: number;
      kind: "approval";
      task: ApprovalTask;
    };

function buildStream(
  messages: ChatMessage[],
  approvals: ApprovalTask[],
  toolExecutions: ToolExecutionRecord[],
  toolCallDrafts: ToolCallDraft[],
): StreamItem[] {
  const items: StreamItem[] = [];
  for (const m of messages) {
    if (m.generatingPending) {
      items.push({ key: `m:${m.id}`, ts: m.createdAt, kind: "message", message: m });
      continue;
    }
    if (m.role === "reasoning" && m.reasoningCollapsed) {
      items.push({ key: `m:${m.id}`, ts: m.createdAt, kind: "message", message: m });
      continue;
    }
    if (!String(m.content ?? "").trim()) {
      continue;
    }
    items.push({ key: `m:${m.id}`, ts: m.createdAt, kind: "message", message: m });
  }
  for (const draft of toolCallDrafts) {
    items.push({
      key: `d:${draft.index}:${draft.toolCallId ?? "pending"}`,
      ts: draft.updatedAt,
      kind: "tool_call_draft",
      draft,
    });
  }
  for (const execution of toolExecutions) {
    items.push({
      key: `x:${execution.id}`,
      ts: execution.createdAt,
      kind: "tool_execution",
      execution,
    });
  }
  for (const t of approvals) {
    items.push({ key: `a:${t.id}`, ts: t.createdAt, kind: "approval", task: t });
  }
  items.sort((a, b) => a.ts - b.ts);
  return items;
}

export function MainChatPanel({
  messages,
  approvals = [],
  toolExecutions = [],
  toolCallDrafts = [],
  submittingToolCallIds,
  runningToolCallIds,
  completedToolCallIds,
  disabled,
  sending,
  onSendMessage,
  onDecideToolCall,
}: MainChatPanelProps) {
  const [input, setInput] = useState("");
  const streamRef = useRef<HTMLDivElement | null>(null);

  const stream = useMemo(
    () => buildStream(messages, approvals, toolExecutions, toolCallDrafts),
    [messages, approvals, toolExecutions, toolCallDrafts],
  );

  useEffect(() => {
    const el = streamRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [stream.length]);

  const onSubmit = async () => {
    const content = input.trim();
    if (!content || disabled || sending) {
      return;
    }
    await onSendMessage(content);
    setInput("");
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.ctrlKey) {
      event.preventDefault();
      void onSubmit();
    } else {
      // Ctrl+Enter 保持 textarea 默认行为（插入换行）。
    }
  };

  const pendingApprovalCount = approvals.reduce((acc, task) => {
    if (task.handled) {
      return acc;
    }
    return acc + task.payload.args.tool_calls.length;
  }, 0);

  return (
    <section className="panel panel--flex chat">
      <header className="chat__header">
        <div className="chat__title">
          <span className="chat__title-main">主对话</span>
          <span className="chat__title-sub">当前对话</span>
        </div>
        <div className="chat__header-meta">
          {pendingApprovalCount > 0 && (
            <span className="pill pill--warn">{pendingApprovalCount} 待审批</span>
          )}
          <span className="pill">{messages.length} 条消息</span>
        </div>
      </header>

      <div ref={streamRef} className="chat__stream">
        {stream.length === 0 ? (
          <div className="chat__empty">开始输入，与 Agent 对话吧</div>
        ) : (
          stream.map((item) => {
            if (item.kind === "message") {
              return <MessageBubble key={item.key} message={item.message} />;
            }
            if (item.kind === "tool_call_draft") {
              return <ToolCallDraftBubble key={item.key} draft={item.draft} />;
            }
            if (item.kind === "tool_execution") {
              return <ToolExecutionBubble key={item.key} item={item.execution} />;
            }
            return (
              <ApprovalToolBubble
                key={item.key}
                task={item.task}
                submittingToolCallIds={submittingToolCallIds}
                runningToolCallIds={runningToolCallIds}
                completedToolCallIds={completedToolCallIds}
                onDecide={onDecideToolCall}
              />
            );
          })
        )}
      </div>

      <div className="chat__composer">
        <div className="chat__composer-input">
          <textarea
            className="chat__textarea"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={2}
            placeholder="输入消息（Enter 发送，Ctrl+Enter 换行）"
            disabled={disabled || sending}
          />
        </div>
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => void onSubmit()}
          disabled={disabled || sending || !input.trim()}
        >
          {sending ? "发送中…" : "发送"}
        </button>
      </div>
    </section>
  );
}
