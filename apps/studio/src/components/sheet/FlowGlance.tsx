// What a flow takes in, does and gives back, side by side: the box at the head
// of the sheet, and of the flow Runner is about to run.
import { AppWindow, ArrowRight, FileSpreadsheet, FileText, Globe, Mail } from "lucide-react";
import { t } from "../../lib/i18n";
import type { ManualDoc } from "../../lib/manual";

/** A site by its address, a program by its .exe, mail by the word: each drawn as what it is. */
function siteIcon(name: string) {
  if (/^https?:|\.[a-z]{2,}(\/|$)/i.test(name) && !/\.exe$/i.test(name)) return Globe;
  if (/mail|メール|outlook/i.test(name)) return Mail;
  if (/\.exe$/i.test(name) || /アプリ|app/i.test(name)) return AppWindow;
  return Globe;
}

/** A file, a site or a value the flow takes in or gives back, as a small card. */
function Thing({ name, kind, out = false }: { name: string; kind: "file" | "site" | "value"; out?: boolean }) {
  const Icon = kind === "site" ? siteIcon(name) : /\.(xlsx?|xlsm|csv)$/i.test(name) ? FileSpreadsheet : FileText;
  // Only a file's name is split from its folder: a value's words may hold a slash ("A / B").
  const slash = kind === "file" ? Math.max(name.lastIndexOf("/"), name.lastIndexOf("\\")) : -1;
  return (
    <li className={`flex min-w-0 items-center gap-2.5 rounded-[4px] border bg-sheet px-2.5 py-2 ${out ? "border-[var(--color-role-output)] shadow-[inset_3px_0_0_var(--color-role-output)]" : "border-slate-300"}`}>
      {kind !== "value" && <Icon size={18} strokeWidth={1.5} aria-hidden="true" className={`shrink-0 ${Icon === FileSpreadsheet ? "text-moegi-600" : "text-slate-500"}`} />}
      <span className="min-w-0">
        <b className="block text-[13.5px] leading-[1.4] font-semibold break-words text-ink">{slash >= 0 ? name.slice(slash + 1) : name}</b>
        {slash >= 0 && <small className="block text-[11.5px] leading-[1.4] text-slate-500">{t.sheetView.inFolder(name.slice(0, slash))}</small>}
      </span>
    </li>
  );
}

/** Input, the work, output; nothing when the flow has none of them yet. */
export function FlowGlance({ doc, className = "mt-6" }: { doc: ManualDoc; className?: string }) {
  const w = t.sheetView;
  const work = doc.chapters.filter((c) => !c.role);
  const ins = [...doc.uses.inputFiles.map((name) => ({ name, kind: "file" as const })), ...doc.uses.apps.map((name) => ({ name, kind: "site" as const })), ...doc.inputs.map((name) => ({ name, kind: "value" as const }))];
  const outs = [...doc.uses.outputFiles.map((name) => ({ name, kind: "file" as const })), ...doc.outputs.map((name) => ({ name, kind: "value" as const }))];
  if ((ins.length === 0 && outs.length === 0) || work.length === 0) return null;
  const CAP = "mb-2 text-[11.5px] font-semibold tracking-[0.06em] text-slate-600";
  const arrow = <ArrowRight size={22} strokeWidth={1.5} aria-hidden="true" className="mx-auto hidden shrink-0 text-slate-400 @[52rem]/paper:block" />;
  return (
    <div className={`${className} grid gap-x-4 gap-y-4 rounded-[4px] border border-slate-200 bg-paper px-5 py-4 @[52rem]/paper:grid-cols-[minmax(0,1fr)_auto_minmax(0,1.1fr)_auto_minmax(0,1fr)] @[52rem]/paper:items-center`}>
      <div>
        <p className={CAP}>{w.input}</p>
        {ins.length > 0 ? (
          <ul className="space-y-1.5">
            {ins.map((x) => (
              <Thing key={`${x.kind}:${x.name}`} {...x} />
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-slate-500">{w.nothing}</p>
        )}
      </div>
      {arrow}
      <div>
        <p className={CAP}>{w.does}</p>
        <ol className="space-y-1.5 text-[13.5px] leading-[1.5] text-ink">
          {work.slice(0, 5).map((c) => (
            <li key={c.number} className="grid grid-cols-[22px_minmax(0,1fr)] items-baseline">
              <span className="grid size-[17px] place-items-center self-center rounded-full bg-[var(--manual-navy)] text-[10.5px] font-bold text-sheet tabular-nums">{c.number}</span>
              {c.title}
            </li>
          ))}
          {work.length > 5 && <li className="pl-[22px] text-[12.5px] text-slate-500">{w.more(work.length - 5)}</li>}
        </ol>
      </div>
      {arrow}
      <div>
        <p className={CAP}>{w.output}</p>
        {outs.length > 0 ? (
          <ul className="space-y-1.5">
            {outs.map((x) => (
              <Thing key={`${x.kind}:${x.name}`} {...x} out />
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-slate-500">{w.nothing}</p>
        )}
      </div>
    </div>
  );
}
