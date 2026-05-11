import { Fragment } from "react";

import { DisplayTypeContentPreview } from "./DisplayTypeContentPreview";
import { ReadFileStructuredView } from "./ReadFileStructuredView";
import type { ToolResultDisplayType } from "../ui-contracts";
import {
  pickReadFileCornerMetaRows,
  tryParseReadFileStructuredDisplay,
  type ReadFileMetaRow,
} from "../utils/parseReadFileStructured";
import { normalizeTextNewlines } from "../utils/textNewlines";

type Props = {
  displayType: ToolResultDisplayType;
  body: string;
};

function ReadFileStructuredMetaBar({ items }: { items: ReadFileMetaRow[] }) {
  if (items.length === 0) {
    return null;
  }
  return (
    <div className="read-file-structured-meta-bar" role="note" aria-label="读取元信息">
      {items.map((row, idx) => (
        <Fragment key={`${row.label}-${idx}`}>
          {idx > 0 ? <span className="read-file-structured-meta-bar__divider" aria-hidden="true" /> : null}
          <span className="read-file-structured-meta-bar__item">
            <span className="read-file-structured-meta-bar__label">{row.label}</span>
            <span className="read-file-structured-meta-bar__sep">: </span>
            <span className="read-file-structured-meta-bar__value">{row.value}</span>
          </span>
        </Fragment>
      ))}
    </div>
  );
}

/**
 * read_file 结果：全文展示、不截断。
 * 若为「元信息 + --- + 行号>」格式，使用 ReadFileStructuredView；否则按 display_type 渲染。
 */
export function ReadFileExpandablePreview({ displayType, body }: Props) {
  const normalized = normalizeTextNewlines(body);
  if (!normalized.trim()) {
    return <div className="write-file-tool__empty">（无文件内容）</div>;
  }

  const structured = tryParseReadFileStructuredDisplay(normalized);
  if (structured) {
    const cornerMeta = pickReadFileCornerMetaRows(structured.meta);
    return (
      <div className="read-file-tool">
        <div className="write-file-tool__preview read-file-structured__preview-wrap">
          <ReadFileStructuredView rows={structured.rows} />
        </div>
        <ReadFileStructuredMetaBar items={cornerMeta} />
      </div>
    );
  }

  return (
    <div className="read-file-tool">
      <div className="write-file-tool__preview">
        <DisplayTypeContentPreview displayType={displayType} text={normalized} />
      </div>
    </div>
  );
}
