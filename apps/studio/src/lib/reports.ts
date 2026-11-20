// Reports to SpellSheet's developers that AI clients drafted
// (report_to_developers, docs/design/reports.md). The person decides each
// one in <ReportDialog />: send it (it becomes a public GitHub issue through
// the relay server), throw it away, or leave it for later. Nothing is sent
// without that decision.
import { create } from "zustand";
import { ApiError, api, type Report } from "./api";
import { t } from "./i18n";

export type Sending = "idle" | "sending";

interface ReportsState {
  /** False until the first list arrived: no chip while loading. */
  loaded: boolean;
  reports: Report[];
  /** The build knows the relay's address. */
  canSend: boolean;
  /** The dialog is open. */
  open: boolean;
  /** What the person typed, per draft, kept while Writer runs (closing the dialog keeps it). */
  edits: Record<string, { title: string; body: string }>;
  /** A report sent while the dialog is open: shown with its link until they move on. */
  justSent: Report | null;
  sending: Sending;
  error: string | null;
}

export const useReports = create<ReportsState>(() => ({
  loaded: false,
  reports: [],
  canSend: false,
  open: false,
  edits: {},
  justSent: null,
  sending: "idle",
  error: null,
}));

const set = useReports.setState;
const get = useReports.getState;

/** Drafts waiting for the person, newest first. */
export function drafts(reports: Report[]): Report[] {
  return reports.filter((r) => r.status === "draft");
}

export async function loadReports() {
  try {
    const { reports, canSend } = await api.listReports();
    set({ reports, canSend, loaded: true });
  } catch {
    // A convenience: the drafts stay on disk and show on the next load.
    set({ loaded: true });
  }
}

export function openReports() {
  if (drafts(get().reports).length === 0) return;
  set({ open: true, error: null, justSent: null });
}

/** あとで決める, Esc, the veil: the draft stays, with what was typed. */
export function closeReports() {
  if (get().sending === "sending") return;
  set({ open: false, error: null, justSent: null });
}

export function editReport(id: string, title: string, body: string) {
  set((s) => ({ edits: { ...s.edits, [id]: { title, body } }, error: null }));
}

/** The wording to show: what the person typed, else the AI's draft. */
export function wording(report: Report): { title: string; body: string } {
  return get().edits[report.id] ?? { title: report.title, body: report.body };
}

function forget(id: string) {
  set((s) => {
    const { [id]: _, ...edits } = s.edits;
    return { edits };
  });
}

/** What went wrong, in the person's words. */
export function sendError(e: unknown): string {
  const code = e instanceof ApiError ? e.code : "";
  if (code === "REPORT_OFFLINE") return t.report.failed.offline;
  if (code === "REPORT_TOO_MANY") return t.report.failed.tooMany;
  if (code === "REPORT_NOT_CONFIGURED") return t.report.failed.notConfigured;
  return t.report.failed.other(e instanceof Error ? e.message : String(e));
}

export async function sendReport(report: Report) {
  if (get().sending === "sending") return;
  const { title, body } = wording(report);
  set({ sending: "sending", error: null });
  try {
    const sent = await api.sendReport(report.id, title, body);
    forget(report.id);
    set({ justSent: sent, sending: "idle" });
    await loadReports();
  } catch (e) {
    set({ sending: "idle", error: sendError(e) });
  }
}

export async function discardReport(report: Report) {
  if (get().sending === "sending") return;
  try {
    await api.discardReport(report.id);
    forget(report.id);
    await loadReports();
    set({ error: null });
    if (drafts(get().reports).length === 0) set({ open: false });
  } catch (e) {
    set({ error: e instanceof Error ? e.message : String(e) });
  }
}

/** GitHub's own form with the person's wording, for their own account. */
export async function writeOnGitHub(report: Report) {
  const { title, body } = wording(report);
  try {
    await api.openReport(report.id, title, body);
  } catch (e) {
    set({ error: e instanceof Error ? e.message : String(e) });
  }
}

/** After a report was sent: the next draft, or close when none is left. */
export function nextReport() {
  set({ justSent: null, error: null });
  if (drafts(get().reports).length === 0) set({ open: false });
}
