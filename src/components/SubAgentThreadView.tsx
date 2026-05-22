import type { SubAgentThreadViewProps } from "../ui-contracts";
import { SubAgentStatusPill } from "./ui";

const CHUNK_LABEL = {
  delta: "输出",
  summary: "小结",
  tool: "工具",
  error: "错误",
} as const;

function sourceText(source: string | undefined): string {
  return source === "remote_a2a_agent" ? "远端 A2A" : "本地子 Agent";
}

function threadMeta(thread: NonNullable<SubAgentThreadViewProps["thread"]>): string {
  const parts = [`${thread.chunks.length} 条输出`, sourceText(thread.source), `agent=${thread.agentId}`];
  if (thread.targetSessionId) {
    parts.push(`session=${thread.targetSessionId}`);
  }
  if (thread.deliveryMode) {
    parts.push(`delivery=${thread.deliveryMode}`);
  }
  if (thread.finalState) {
    parts.push(`state=${thread.finalState}`);
  }
  return parts.join(" · ");
}

export function SubAgentThreadView({ thread }: SubAgentThreadViewProps) {
  if (!thread) {
    return <div className="thread__empty">请选择一个子线程查看实时输出</div>;
  }

  return (
    <div className="thread">
      <div className="thread__header">
        <div className="thread__title">{thread.title || thread.agentId}</div>
        <SubAgentStatusPill status={thread.status} />
      </div>
      <div className="thread__meta">{threadMeta(thread)}</div>
      <div className="thread__chunks">
        {thread.chunks.length === 0 ? (
          <div className="thread__empty">等待输出…</div>
        ) : (
          thread.chunks.map((chunk) => (
            <div key={chunk.id} className={`chunk chunk--${chunk.kind}`}>
              <div className="chunk__head">
                <span>{CHUNK_LABEL[chunk.kind]}</span>
                <span>{new Date(chunk.ts).toLocaleTimeString()}</span>
              </div>
              <div className="chunk__body">{chunk.content}</div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
