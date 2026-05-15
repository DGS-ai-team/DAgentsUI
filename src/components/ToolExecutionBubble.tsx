import type { ToolExecutionRecord } from "../ui-contracts";
import { DisplayTypeContentPreview } from "./DisplayTypeContentPreview";
import { ReadFileExpandablePreview } from "./ReadFileExpandablePreview";
import {
  fileDisplayName,
  isWriteFileToolName,
  omitWriteFileContentInArgsCopy,
  parseWriteFileArguments,
  resolveWriteFilePreviewText,
} from "../utils/writeFileTool";
import { isReadFileToolName, parseReadFileExecution } from "../utils/readFileTool";

export function ToolExecutionBubble({ item }: { item: ToolExecutionRecord }) {
  const isRunning = item.status === "running";
  const isSuccess = item.status === "success";
  const isRejected = item.status === "rejected";
  const isError = item.status === "error";
  const statusText = isRunning
    ? "执行中"
    : isSuccess
      ? "已完成"
      : isRejected
        ? "已拒绝"
        : "失败";

  const writeCtx =
    isWriteFileToolName(item.toolName)
      ? parseWriteFileArguments(item.arguments, item.displayType, item.detail)
      : null;
  const readCtx =
    !writeCtx && isReadFileToolName(item.toolName) ? parseReadFileExecution(item) : null;

  const previewText = writeCtx ? resolveWriteFilePreviewText(writeCtx.content, item.resultContent) : "";
  const previewDisplayType = writeCtx
    ? (item.displayType ?? writeCtx.displayType)
    : (item.displayType ?? "normal_text");

  const summaryNode = writeCtx ? (
    <div className="write-file-tool__preview">
      {previewText.trim() ? (
        <DisplayTypeContentPreview displayType={previewDisplayType} text={previewText} />
      ) : (
        <div className="write-file-tool__empty">（无写入内容）</div>
      )}
    </div>
  ) : readCtx ? (
    <ReadFileExpandablePreview displayType={readCtx.displayType} body={readCtx.body} />
  ) : null;

  const isDefaultToolLayout = !writeCtx && !readCtx;

  const argsForDetails = writeCtx ? omitWriteFileContentInArgsCopy(item.arguments) : item.arguments;

  const defaultOutputText = (() => {
    const raw = item.resultContent ?? item.summary ?? "";
    return String(raw);
  })();

  const statusIcon = isRunning ? (
    <span className="tool-exec-spinner" aria-hidden="true" />
  ) : (
    <span
      className={`tool-exec-status-icon ${isSuccess ? "tool-exec-status-icon--success" : ""} ${isRejected ? "tool-exec-status-icon--rejected" : ""} ${isError ? "tool-exec-status-icon--error" : ""}`}
      aria-hidden="true"
    >
      {isSuccess ? "✓" : isRejected ? "−" : "!"}
    </span>
  );

  const statusControl = (
    <>
      {statusIcon}
      <span>{statusText}</span>
    </>
  );

  const pathHead = writeCtx ? (
    <div className="write-file-tool__title-row">
      <span className="msg__meta-label write-file-tool__tag">write_file</span>
      <span className="write-file-tool__filename" title={writeCtx.path || undefined}>
        {writeCtx.path ? fileDisplayName(writeCtx.path) : "（未提供路径）"}
      </span>
    </div>
  ) : readCtx ? (
    <div className="write-file-tool__title-row">
      <span className="msg__meta-label write-file-tool__tag">read_file</span>
      <span className="write-file-tool__filename" title={readCtx.path || undefined}>
        {readCtx.path ? fileDisplayName(readCtx.path) : "（未提供路径）"}
      </span>
    </div>
  ) : (
    <span className="tool-exec-bubble__name">{item.toolName}</span>
  );

  const headModifier =
    writeCtx || readCtx ? " tool-exec-bubble__head--tool-path" : "";

  const showDetails = !readCtx;

  return (
    <div className="msg msg--tool-centered">
      <div className="msg__body msg__body--wide">
        <div className="msg__hint msg__hint--stream-meta">
          <span className="msg__meta-label">tool_call</span>
        </div>
        <div className="tool-exec-bubble">
          <div className={`tool-exec-bubble__head${headModifier}`}>
            {pathHead}
            <span className="tool-exec-bubble__status">{statusControl}</span>
          </div>

          {isDefaultToolLayout ? null : summaryNode}

          {showDetails ? (
            <details className="tool-exec-bubble__details">
              <summary>查看详情</summary>
              {isDefaultToolLayout ? (
                <div className="tool-exec-bubble__details-body">
                  <div className="tool-exec-bubble__details-kicker">工具输入</div>
                  <pre className="tool-card__args tool-card__args--compact" aria-label="工具输入">
                    {JSON.stringify(item.arguments ?? {}, null, 2)}
                  </pre>
                  <div className="tool-exec-bubble__details-kicker">工具输出</div>
                  {defaultOutputText.trim() ? (
                    <DisplayTypeContentPreview
                      displayType={item.displayType ?? "normal_text"}
                      text={defaultOutputText}
                    />
                  ) : (
                    <div className="tool-exec-bubble__empty">（无输出正文）</div>
                  )}
                </div>
              ) : (
                <div className="tool-exec-bubble__details-body">
                  <div className="tool-exec-bubble__details-kicker">工具输入</div>
                  <pre className="tool-card__args tool-card__args--compact">
                    {JSON.stringify(argsForDetails, null, 2)}
                  </pre>
                </div>
              )}
            </details>
          ) : null}
        </div>
      </div>
    </div>
  );
}
