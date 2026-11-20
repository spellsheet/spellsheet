// A report to SpellSheet's developers that an AI drafted, read and decided
// by the person (docs/design/reports.md). The draft is theirs to correct:
// the title and the description are fields. 送る files it as a public
// GitHub issue through the relay; 送らない throws it away; あとで決める
// (Esc, the veil) leaves it waiting. Focus starts in the description, so
// nothing is sent or thrown away by a stray Enter.
import { ExternalLink, MessageSquareWarning } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef } from "react";
import { api, type Report } from "../lib/api";
import { t } from "../lib/i18n";
import {
  closeReports,
  discardReport,
  drafts,
  editReport,
  nextReport,
  openReports,
  sendReport,
  useReports,
  wording,
  writeOnGitHub,
} from "../lib/reports";

const base =
  "h-8 rounded-md px-3 text-[13px] font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-50";
const primary = `${base} bg-primary text-on-primary hover:bg-primary-hover disabled:hover:bg-primary`;
const secondary = `${base} border border-slate-300 bg-sheet text-slate-700 hover:bg-slate-50 disabled:hover:bg-sheet`;
const quiet = `${base} text-slate-600 hover:bg-slate-100 disabled:hover:bg-transparent`;
const field =
  "w-full rounded border border-slate-300 bg-sheet px-2 text-[13px] text-ink focus:border-primary focus:outline-none dark:bg-paper";

function Sent({ report, more }: { report: Report; more: boolean }) {
  return (
    <>
      <p className="mt-3 text-[13px] leading-relaxed text-ink" role="status">
        {report.duplicate ? t.report.sentDuplicate : t.report.sent}
      </p>
      <p className="mt-1 text-[13px] text-slate-600">{report.title}</p>
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" className={secondary} onClick={() => void api.openReport(report.id)}>
          <span className="flex items-center gap-1.5">
            <ExternalLink size={13} strokeWidth={1.75} aria-hidden="true" />
            {t.report.seeIssue}
          </span>
        </button>
        <button type="button" className={primary} onClick={nextReport} autoFocus>
          {more ? t.report.next : t.report.close}
        </button>
      </div>
    </>
  );
}

function Draft({ report, canSend }: { report: Report; canSend: boolean }) {
  const sending = useReports((s) => s.sending === "sending");
  const error = useReports((s) => s.error);
  // Re-read on every edit so the fields follow what was typed.
  useReports((s) => s.edits[report.id]);
  const { title, body } = wording(report);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const titleId = useId();
  const bodyId = useId();
  useEffect(() => {
    const box = bodyRef.current;
    if (!box) return;
    box.focus();
    box.setSelectionRange(0, 0);
    box.scrollTop = 0;
  }, [report.id]);
  const problem = !title.trim() ? t.report.subjectEmpty : !body.trim() ? t.report.bodyEmpty : null;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (canSend && !problem) void sendReport(report);
      }}
    >
      <dl className="mt-3 flex gap-4 text-[12px] text-slate-600">
        <div className="flex gap-1.5">
          <dt>{t.report.kindLabel}</dt>
          <dd className="font-medium text-ink">{t.report.kinds[report.kind]}</dd>
        </div>
        {report.stepType && (
          <div className="flex gap-1.5">
            <dt>{t.report.node}</dt>
            <dd className="font-mono text-ink">{report.stepType}</dd>
          </div>
        )}
      </dl>
      <label className="mt-3 block space-y-1">
        <span id={titleId} className="text-xs font-medium text-slate-600">
          {t.report.subject}
        </span>
        <input
          aria-labelledby={titleId}
          className={`${field} h-8`}
          value={title}
          maxLength={120}
          disabled={sending}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => editReport(report.id, e.target.value, body)}
        />
      </label>
      <label className="mt-3 block space-y-1">
        <span id={bodyId} className="text-xs font-medium text-slate-600">
          {t.report.body}
        </span>
        <textarea
          ref={bodyRef}
          aria-labelledby={bodyId}
          className={`${field} h-48 resize-y py-1.5 leading-relaxed`}
          value={body}
          maxLength={6000}
          disabled={sending}
          spellCheck={false}
          onChange={(e) => editReport(report.id, title, e.target.value)}
        />
      </label>
      <div className="mt-3 space-y-1 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[12px] leading-relaxed text-amber-700">
        <p>{t.report.check}</p>
        {report.hidden > 0 && <p>{t.report.hidden(report.hidden)}</p>}
      </div>
      <p className="mt-2 text-[12px] leading-relaxed text-slate-500">{canSend ? t.report.sends : t.report.noRelay}</p>
      <p className={`mt-2 min-h-[18px] text-xs ${error || problem ? "text-shu-600" : "text-transparent"}`} role="alert">
        {error ?? problem ?? " "}
      </p>
      <div className="mt-2 flex items-center gap-2">
        <button type="button" className={quiet} onClick={closeReports} disabled={sending}>
          {t.report.later}
        </button>
        <span className="flex-1" />
        <button type="button" className={secondary} onClick={() => void discardReport(report)} disabled={sending}>
          {t.report.discard}
        </button>
        <button type="button" className={secondary} onClick={() => void writeOnGitHub(report)} disabled={sending || !!problem}>
          <span className="flex items-center gap-1.5">
            <ExternalLink size={13} strokeWidth={1.75} aria-hidden="true" />
            {t.report.onGitHub}
          </span>
        </button>
        {canSend && (
          <button type="submit" className={primary} disabled={sending || !!problem}>
            {sending ? t.report.sending : t.report.send}
          </button>
        )}
      </div>
    </form>
  );
}

export function ReportDialog() {
  const open = useReports((s) => s.open);
  const reports = useReports((s) => s.reports);
  const canSend = useReports((s) => s.canSend);
  const justSent = useReports((s) => s.justSent);
  const boxRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const waiting = drafts(reports);
  const report = waiting[0];

  // Focus goes back to what had it (the chip) once the dialog closes.
  useLayoutEffect(() => {
    if (!open) return;
    const before = document.activeElement as HTMLElement | null;
    return () => {
      if (before?.isConnected) before.focus();
    };
  }, [open]);

  if (!open || (!report && !justSent)) return null;

  const onKeyDown = (e: React.KeyboardEvent) => {
    // The window's own keys (Delete removes a node, Ctrl+S saves…) wait until the dialog closes.
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      if (justSent) nextReport();
      else closeReports();
    } else if (e.key === "Tab") {
      const items = [...(boxRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), textarea:not(:disabled)") ?? [])];
      if (items.length === 0) return;
      const at = items.indexOf(document.activeElement as HTMLElement);
      const next = e.shiftKey ? (at <= 0 ? items.length - 1 : at - 1) : at === items.length - 1 ? 0 : at + 1;
      e.preventDefault();
      items[next]?.focus();
    }
  };

  return (
    <div
      className="fixed inset-0 z-[70] grid place-items-center bg-ink/30 p-4"
      onMouseDown={(e) => e.target === e.currentTarget && (justSent ? nextReport() : closeReports())}
      onKeyDown={onKeyDown}
    >
      <div
        ref={boxRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="max-h-full w-[560px] max-w-full overflow-y-auto rounded-lg border border-slate-200 bg-sheet p-5 shadow-dialog outline-none"
      >
        <div className="flex items-center gap-2">
          <MessageSquareWarning size={16} strokeWidth={1.75} className="text-slate-500" aria-hidden="true" />
          <h2 id={titleId} className="text-[15px] leading-snug font-semibold text-ink">
            {t.report.title}
          </h2>
          {!justSent && waiting.length > 1 && <span className="ml-auto text-xs text-slate-500">{t.report.counter(1, waiting.length)}</span>}
        </div>
        {justSent ? (
          <Sent report={justSent} more={waiting.length > 0} />
        ) : (
          report && (
            <>
              <p className="mt-2 text-[13px] leading-relaxed text-slate-600">{t.report.lead}</p>
              <Draft key={report.id} report={report} canSend={canSend} />
            </>
          )
        )}
      </div>
    </div>
  );
}

/** The chip in the window's bar while drafts wait: quiet, since nothing waits on the person's answer. */
export function ReportChip({ className }: { className: string }) {
  const loaded = useReports((s) => s.loaded);
  const count = useReports((s) => drafts(s.reports).length);
  if (!loaded || count === 0) return null;
  return (
    <button
      type="button"
      onClick={openReports}
      title={t.report.chipTitle}
      className={`${className} bg-slate-100 text-slate-700 hover:bg-slate-200`}
    >
      <MessageSquareWarning size={13} strokeWidth={1.75} aria-hidden="true" />
      {t.report.chip} {count}
    </button>
  );
}
