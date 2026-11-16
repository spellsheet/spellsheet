// A Word document or a PDF as a small white page (its first paragraphs and
// tables), and a zip file as the list of what it holds. Shown where a run's
// files are (実行結果, the review, Runner, the sheet) and in the hover preview.
import { FileArchive } from "lucide-react";
import { t } from "../lib/i18n";
import type { DocBlock, FilePreview } from "../lib/preview";
import { sizeText } from "../lib/preview";

type DocumentPreview = Extract<FilePreview, { kind: "document" }>;
type ArchivePreview = Extract<FilePreview, { kind: "archive" }>;

function Block({ block }: { block: DocBlock }) {
  if (block.kind === "table")
    return (
      <table className="my-1.5 w-full border-collapse text-[0.92em]">
        <tbody>
          {block.rows.map((row, r) => (
            <tr key={r}>
              {row.map((cell, c) => (
                <td key={c} className="border border-slate-300 px-1.5 py-0.5 align-top whitespace-pre-wrap">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    );
  if (!block.text) return <div className="h-[0.8em]" aria-hidden="true" />;
  return <p className={`whitespace-pre-wrap ${block.heading ? "my-1 text-[1.25em] font-bold" : ""}`}>{block.text}</p>;
}

/**
 * The page: white, with the document's own words in a small type, cut at a
 * fixed height so a long document stays a glance. `size` is the type size in px.
 */
export function DocumentView({ preview, size = 11, height = 320 }: { preview: DocumentPreview; size?: number; height?: number }) {
  const empty = preview.blocks.every((b) => b.kind === "paragraph" && !b.text);
  return (
    <div className="bg-slate-100 px-4 py-3 dark:bg-slate-800/40">
      <div className="relative mx-auto max-w-[560px] overflow-hidden rounded-[3px] border border-slate-200 bg-white px-[7%] py-5 text-slate-900 shadow-sm" style={{ fontSize: size, lineHeight: 1.6, maxHeight: height }}>
        {empty ? <p className="text-slate-400">{t.preview.emptyDocument}</p> : preview.blocks.map((block, i) => <Block key={i} block={block} />)}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-white" aria-hidden="true" />
      </div>
      {(preview.more || preview.pages) && (
        <p className="mt-1.5 text-center text-[11.5px] text-slate-500">{[preview.pages ? t.preview.pages(preview.pages) : null, preview.more ? t.preview.moreDocument : null].filter(Boolean).join(" · ")}</p>
      )}
    </div>
  );
}

/** What a zip file holds: file names and sizes. */
export function ArchiveView({ preview, max = 12 }: { preview: ArchivePreview; max?: number }) {
  const shown = preview.entries.slice(0, max);
  const rest = preview.count - shown.length;
  return (
    <div className="px-3 py-2 text-[12.5px]">
      <p className="mb-1 text-[11.5px] text-slate-500">{t.preview.files(preview.count)}</p>
      <ul className="space-y-0.5">
        {shown.map((entry) => (
          <li key={entry.name} className="flex items-center gap-1.5">
            <FileArchive size={13} strokeWidth={1.75} className="shrink-0 text-slate-400" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate" title={entry.name}>
              {entry.name}
            </span>
            <span className="shrink-0 text-[11.5px] text-slate-500 tabular-nums">{sizeText(entry.bytes)}</span>
          </li>
        ))}
      </ul>
      {rest > 0 && <p className="mt-1 text-[11.5px] text-slate-500">{t.preview.moreFiles(rest)}</p>}
    </div>
  );
}
