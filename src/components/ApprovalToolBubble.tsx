import type { ApprovalTask, ToolCallDecision, ToolCallItem } from "../ui-contracts";
import { DisplayTypeContentPreview } from "./DisplayTypeContentPreview";
import { EditFileApprovalArgsPreview } from "./EditFileApprovalArgsPreview";
import { isEditFileToolName, parseEditFileApprovalArguments } from "../utils/editFileTool";
import { fileDisplayName, isWriteFileToolName, parseWriteFileArguments } from "../utils/writeFileTool";

export interface ApprovalToolBubbleProps {
  task: ApprovalTask;
  submittingToolCallIds?: string[];
  runningToolCallIds?: string[];
  completedToolCallIds?: string[];
  onDecide?: (
    taskId: string,
    toolCallId: string,
    decision: ToolCallDecision,
  ) => Promise<void>;
}

function decisionForToolCall(
  task: ApprovalTask,
  toolCallId: string,
): ToolCallDecision | null {
  if (task.decision === "approve_all") {
    return "approve";
  }
  if (task.decision === "reject_all") {
    return "reject";
  }
  if (task.approvedIds?.includes(toolCallId)) {
    return "approve";
  }
  if (task.rejectedIds?.includes(toolCallId)) {
    return "reject";
  }
  if (!task.handled) {
    return null;
  }
  return null;
}

function ToolStatusPill({
  decision,
  running,
  completed,
}: {
  decision: ToolCallDecision | null;
  running: boolean;
  completed: boolean;
}) {
  if (decision === "reject") {
    return <span className="tool-status-chip tool-status-chip--reject">已拒绝</span>;
  }
  if (completed) {
    return <span className="tool-status-chip tool-status-chip--done">已返回</span>;
  }
  if (running) {
    return <span className="tool-status-chip tool-status-chip--running">执行中</span>;
  }
  if (decision === "approve") {
    return <span className="tool-status-chip tool-status-chip--approved">已批准</span>;
  }
  return <span className="tool-status-chip tool-status-chip--pending">待审批</span>;
}

function ToolCallRow({
  task,
  toolCall,
  submitting,
  running,
  completed,
  onDecide,
}: {
  task: ApprovalTask;
  toolCall: ToolCallItem;
  submitting: boolean;
  running: boolean;
  completed: boolean;
  onDecide?: (
    taskId: string,
    toolCallId: string,
    decision: ToolCallDecision,
  ) => Promise<void>;
}) {
  const decision = decisionForToolCall(task, toolCall.id);
  const handled = decision !== null;
  const writeFileArgs = isWriteFileToolName(toolCall.name)
    ? parseWriteFileArguments(toolCall.arguments)
    : null;
  const editFileModel = isEditFileToolName(toolCall.name)
    ? parseEditFileApprovalArguments(toolCall.arguments)
    : null;

  return (
    <li className="approval-tool-item">
      <header className="approval-tool-item__head">
        {writeFileArgs ? (
          <div className="write-file-tool__title-row">
            <span className="msg__meta-label write-file-tool__tag">write_file</span>
            <span className="write-file-tool__filename" title={writeFileArgs.path || undefined}>
              {writeFileArgs.path ? fileDisplayName(writeFileArgs.path) : "（未提供路径）"}
            </span>
          </div>
        ) : editFileModel ? (
          <div className="write-file-tool__title-row">
            <span className="msg__meta-label write-file-tool__tag">edit_file</span>
            <span className="write-file-tool__filename" title={editFileModel.path || undefined}>
              {editFileModel.path ? fileDisplayName(editFileModel.path) : "（未提供路径）"}
            </span>
          </div>
        ) : (
          <div className="approval-bubble__title">
            <span className="approval-bubble__name">{toolCall.name}</span>
          </div>
        )}
        <div className="approval-tool-item__right">
          <ToolStatusPill decision={decision} running={running} completed={completed} />
          {!handled && onDecide ? (
            <div className="approval-tool-item__inline-actions">
              <button
                type="button"
                className="approval-action-btn approval-action-btn--reject"
                disabled={submitting}
                onClick={() => void onDecide(task.id, toolCall.id, "reject")}
              >
                拒绝
              </button>
              <button
                type="button"
                className="approval-action-btn approval-action-btn--approve"
                disabled={submitting}
                onClick={() => void onDecide(task.id, toolCall.id, "approve")}
              >
                {submitting ? "处理中…" : "批准"}
              </button>
            </div>
          ) : null}
        </div>
      </header>

      {writeFileArgs ? (
        <div className="write-file-tool__preview">
          {writeFileArgs.content.trim() ? (
            <DisplayTypeContentPreview displayType={writeFileArgs.displayType} text={writeFileArgs.content} />
          ) : (
            <div className="write-file-tool__empty">（无写入内容）</div>
          )}
        </div>
      ) : editFileModel ? (
        <div className="edit-file-approval__wrap">
          <EditFileApprovalArgsPreview model={editFileModel} />
        </div>
      ) : (
        <pre className="tool-card__args tool-card__args--compact">
          {JSON.stringify(toolCall.arguments, null, 2)}
        </pre>
      )}
    </li>
  );
}

export function ApprovalToolBubble({
  task,
  submittingToolCallIds,
  runningToolCallIds,
  completedToolCallIds,
  onDecide,
}: ApprovalToolBubbleProps) {
  const submittingSet = new Set(submittingToolCallIds ?? []);
  const runningSet = new Set(runningToolCallIds ?? []);
  const completedSet = new Set(completedToolCallIds ?? []);

  return (
    <div className="msg msg--approval">
      <div className="msg__body msg__body--wide">
        <div className="msg__hint msg__hint--stream-meta">
          <span className="msg__meta-label">tool_call</span>
        </div>
        <div className="approval-bubble">
          <ul className="approval-tool-list">
            {task.payload.args.tool_calls.map((toolCall) => (
              <ToolCallRow
                key={toolCall.id}
                task={task}
                toolCall={toolCall}
                submitting={submittingSet.has(toolCall.id)}
                running={runningSet.has(toolCall.id) && !completedSet.has(toolCall.id)}
                completed={completedSet.has(toolCall.id)}
                onDecide={onDecide}
              />
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
