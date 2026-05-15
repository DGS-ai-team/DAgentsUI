import type { EditFileApprovalModel, NormalizedEditEntry } from "../utils/editFileTool";

function actionBadgeClass(action: string): string {
  const a = action.trim().toLowerCase();
  if (a === "delete") {
    return "edit-file-approval__badge edit-file-approval__badge--delete";
  }
  if (a === "replace") {
    return "edit-file-approval__badge edit-file-approval__badge--replace";
  }
  if (a === "insert") {
    return "edit-file-approval__badge edit-file-approval__badge--insert";
  }
  return "edit-file-approval__badge edit-file-approval__badge--other";
}

/** 仅展示目标行号区间或锚点（insert 为 start_line 行前插入点）。 */
function formatTargetLines(entry: NormalizedEditEntry): string {
  const act = entry.action.trim().toLowerCase();
  const a = entry.start_line;
  const b = entry.end_line;

  if (act === "insert") {
    return a !== undefined ? `L${a}` : "—";
  }
  if (act === "delete" || act === "replace") {
    if (a !== undefined && b !== undefined) {
      return a === b ? `L${a}` : `L${a}–L${b}`;
    }
    if (a !== undefined) {
      return `L${a}`;
    }
    return "—";
  }
  if (a !== undefined && b !== undefined) {
    return `L${a}–L${b}`;
  }
  if (a !== undefined) {
    return `L${a}`;
  }
  return "—";
}

function EditFrame({ entry }: { entry: NormalizedEditEntry }) {
  const act = entry.action.trim().toLowerCase();
  const showContent = entry.content.trim() && (act === "replace" || act === "insert");

  return (
    <div className="edit-file-approval__frame">
      <div className="edit-file-approval__frame-head">
        <span className={actionBadgeClass(entry.action)}>{entry.action}</span>
        <span className="edit-file-approval__lines">{formatTargetLines(entry)}</span>
      </div>
      {showContent ? (
        <pre className="edit-file-approval__frame-content" tabIndex={0}>
          {entry.content}
        </pre>
      ) : null}
    </div>
  );
}

export function EditFileApprovalArgsPreview({ model }: { model: EditFileApprovalModel }) {
  if (model.edits.length === 0) {
    return <div className="edit-file-approval edit-file-approval--empty" />;
  }

  return (
    <div className="edit-file-approval">
      <div className="edit-file-approval__frames">
        {model.edits.map((e, i) => (
          <EditFrame key={`edit-frame-${i}`} entry={e} />
        ))}
      </div>
    </div>
  );
}
