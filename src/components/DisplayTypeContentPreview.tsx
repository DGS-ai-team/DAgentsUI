import type { ReactNode } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

import type { ToolResultDisplayType } from "../ui-contracts";
import { normalizeTextNewlines } from "../utils/textNewlines";

type Props = {
  displayType: ToolResultDisplayType;
  text: string;
};

/**
 * 按 display_type 渲染一段文本（工具结果气泡与 write_file 审批预览共用）。
 * 换行：统一 CRLF/CR → LF，再渲染（空串仍不展示）。
 */
export function DisplayTypeContentPreview({ displayType, text }: Props): ReactNode {
  const normalized = normalizeTextNewlines(String(text ?? ""));
  if (!normalized.trim()) {
    return null;
  }
  if (displayType === "terminal") {
    return <pre className="tool-exec-bubble__terminal">{normalized}</pre>;
  }
  if (displayType === "code") {
    return <pre className="tool-exec-bubble__code">{normalized}</pre>;
  }
  if (displayType === "markdown") {
    return (
      <div className="tool-exec-bubble__markdown">
        <Markdown
          remarkPlugins={[remarkGfm]}
          components={{
            a: ({ node, href, children, ...rest }) => (
              <a href={href} target="_blank" rel="noopener noreferrer" {...rest}>
                {children}
              </a>
            ),
            img: ({ node, src, alt, ...rest }) => (
              <img src={src} alt={alt ?? ""} className="tool-exec-bubble__md-img" {...rest} />
            ),
          }}
        >
          {normalized}
        </Markdown>
      </div>
    );
  }
  if (displayType === "image") {
    return <img src={normalized.trim()} alt="tool result" className="tool-exec-bubble__image" />;
  }
  return <div className="tool-exec-bubble__summary">{normalized}</div>;
}
