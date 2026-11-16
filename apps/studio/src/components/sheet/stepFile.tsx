// What a step that reads or writes a file works on, shown beside it on the
// sheet as a small picture of the file: the first rows of a table, the start
// of a document, a picture. So a step on a file reads as much at a glance as
// a step on a screen, which shows the screen. Only the first step that names
// a file shows it; a file that is not there yet (an output before the first
// run) shows nothing.
import type { Flow, Step } from "@spellsheet/schema";
import { FileSpreadsheet, FileText, ImageIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { type FilePreview, filePath, loadPreview, type Loaded } from "../../lib/preview";
import { DocumentView } from "../DocumentView";

/** Kinds of step that work on a file, by the start of their type. */
const FILE_KINDS = ["excel.", "word.", "pdf.", "csv.", "file.", "files.", "image.", "ocr."];
/** Params that name the file a step works on, most telling first. */
const PATH_KEYS = ["path", "template", "file", "source", "output", "to", "from"];
const ONLY = /^\{\{\s*([^{}\s]+)\s*\}\}$/;

/** The file a step works on, as a path the preview can read: written out, or an input variable's default. */
export function stepFile(step: Step, flow: Flow): string | null {
  if (!FILE_KINDS.some((k) => step.type.startsWith(k)) || /delete|remove|exists/i.test(step.type)) return null;
  const params = (step.params ?? {}) as Record<string, unknown>;
  for (const key of PATH_KEYS) {
    const value = params[key];
    if (typeof value !== "string") continue;
    const name = ONLY.exec(value.trim())?.[1];
    const given = name ? flow.variables?.find((v) => v.name === name && (v.direction === "input" || v.direction === "inOut"))?.default : value;
    const path = typeof given === "string" ? filePath(given) : null;
    if (path) return path;
  }
  return null;
}

/** The step of each file that shows it: the first one in the flow's order. */
export function fileSteps(flow: Flow): Map<string, string> {
  const shown = new Map<string, string>();
  const seen = new Set<string>();
  const walk = (steps: Step[]) => {
    for (const step of steps) {
      const path = stepFile(step, flow);
      if (path && step.id && !seen.has(path.toLowerCase())) {
        seen.add(path.toLowerCase());
        shown.set(step.id, path);
      }
      for (const inner of Object.values(step.blocks ?? {})) walk(inner);
    }
  };
  walk(flow.steps ?? []);
  return shown;
}

const SHOWN: FilePreview["kind"][] = ["table", "document", "image"];

/** The file, small, under its name. Nothing while it is read or when it cannot be shown. */
export function StepFile({ flowId, path, sheet, stamp }: { flowId: string; path: string; sheet?: string; stamp: string }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  // The stamp it first showed with: a later one means a run wrote the file since, so the kept read is old.
  const first = useRef(stamp);
  useEffect(() => {
    let live = true;
    void loadPreview(flowId, path, sheet, stamp !== first.current).then((l) => live && setLoaded(l));
    return () => {
      live = false;
    };
    // `stamp` changes when a run finishes: an output is read again.
  }, [flowId, path, sheet, stamp]);
  const preview = loaded?.preview;
  if (!preview || !SHOWN.includes(preview.kind)) return null;
  const name = path.replace(/\\/g, "/").split("/").pop() ?? path;
  const Icon = preview.kind === "table" ? FileSpreadsheet : preview.kind === "image" ? ImageIcon : FileText;
  return (
    <figure className="overflow-hidden rounded-[3px] border border-slate-200 bg-sheet" data-step-file>
      <figcaption className="flex items-center gap-1.5 border-b border-slate-200 px-2.5 py-1 text-[12px] text-slate-600">
        <Icon size={13} strokeWidth={1.75} className="shrink-0 text-slate-400" aria-hidden="true" />
        <span className="min-w-0 truncate" title={path}>
          {name}
        </span>
      </figcaption>
      {preview.kind === "table" ? (
        <table className="w-full table-fixed border-collapse text-[11px]">
          {preview.columns.length > 0 && (
            <thead className="bg-paper text-left text-slate-500">
              <tr>
                {preview.columns.slice(0, 4).map((c, i) => (
                  <th key={i} className="truncate border-b border-slate-200 px-2 py-0.5 font-semibold">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
          )}
          <tbody>
            {preview.rows.slice(0, 4).map((row, r) => (
              <tr key={r} className="border-b border-slate-100 last:border-0">
                {row.slice(0, 4).map((cell, c) => (
                  <td key={c} className="truncate px-2 py-0.5">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      ) : preview.kind === "document" ? (
        <DocumentView preview={{ ...preview, more: false, pages: undefined }} size={7.5} height={170} />
      ) : loaded?.picture ? (
        <img src={loaded.picture.src} alt={name} className="max-h-[180px] w-full object-contain" />
      ) : null}
    </figure>
  );
}
