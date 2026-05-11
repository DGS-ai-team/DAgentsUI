import type { ReadFileBodyRow } from "../utils/parseReadFileStructured";

type Props = {
  rows: ReadFileBodyRow[];
};

export function ReadFileStructuredView({ rows }: Props) {
  return (
    <div className="read-file-structured">
      <div className="read-file-structured__lines" role="table" aria-label="文件内容（行号）">
        {rows.map((row, i) => {
          if (row.kind === "gap") {
            return <div key={`gap-${i}`} className="read-file-structured__gap" aria-hidden="true" />;
          }
          return (
            <div key={`line-${i}`} className="read-file-structured__line">
              <span className="read-file-structured__num">{row.lineNumber}</span>
              <span className="read-file-structured__text">{row.content}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
