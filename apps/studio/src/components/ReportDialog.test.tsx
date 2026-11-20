// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, api, type Report } from "../lib/api";
import { loadReports, useReports } from "../lib/reports";
import { ReportChip, ReportDialog } from "./ReportDialog";

const draft = (id: string, title: string): Report => ({
  id,
  kind: "missingNode",
  title,
  body: "excel.readRows で読んだ表を日付順に並べたかった。",
  stepType: "excel.readRows",
  status: "draft",
  hidden: 2,
  createdAt: "2026-11-20T02:00:00Z",
});

let onDisk: Report[] = [];
let canSend = true;

beforeEach(() => {
  onDisk = [draft("rpt_1", "並べ替えるノードがない"), draft("rpt_2", "結合セルを読み飛ばす")];
  canSend = true;
  vi.spyOn(api, "listReports").mockImplementation(async () => ({ reports: onDisk, canSend }));
  vi.spyOn(api, "discardReport").mockImplementation(async (id) => {
    onDisk = onDisk.filter((r) => r.id !== id);
  });
  vi.spyOn(api, "openReport").mockResolvedValue(undefined);
});

afterEach(() => {
  act(() => useReports.setState({ loaded: false, reports: [], open: false, edits: {}, justSent: null, sending: "idle", error: null }));
  cleanup();
  vi.restoreAllMocks();
});

function screenWith() {
  return render(
    <>
      <ReportChip className="chip" />
      <ReportDialog />
    </>,
  );
}

describe("ReportDialog", () => {
  it("shows nothing while loading or when no draft waits", async () => {
    screenWith();
    expect(screen.queryByRole("button", { name: /開発元への報告/ })).toBeNull();
    onDisk = [];
    await act(loadReports);
    expect(screen.queryByRole("button", { name: /開発元への報告/ })).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("sends only what the person edited, then shows where it went", async () => {
    screenWith();
    await act(loadReports);
    fireEvent.click(screen.getByRole("button", { name: "開発元への報告 2" }));
    const dialog = screen.getByRole("dialog", { name: "開発元への報告" });
    expect(dialog.textContent).toContain("1 / 2 件");
    expect(dialog.textContent).toContain("2 か所は自動で伏せました");
    // Focus starts in the text, so a stray Enter sends nothing.
    expect(document.activeElement?.tagName).toBe("TEXTAREA");

    const send = vi.spyOn(api, "sendReport").mockImplementation(async (id, title, body) => {
      onDisk = onDisk.filter((r) => r.id !== id);
      return { ...draft(id, title), body, status: "sent", issueUrl: "https://github.com/spellsheet/spellsheet/issues/9" };
    });
    fireEvent.change(screen.getByRole("textbox", { name: "本文" }), { target: { value: "書き直した本文" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "送る" })));
    expect(send).toHaveBeenCalledWith("rpt_1", "並べ替えるノードがない", "書き直した本文");
    expect(screen.getByRole("status").textContent).toContain("送りました");
    fireEvent.click(screen.getByRole("button", { name: "次の報告" }));
    expect(screen.getByRole("textbox", { name: "件名" })).toHaveProperty("value", "結合セルを読み飛ばす");
  });

  it("cannot send an empty title, and says why", async () => {
    screenWith();
    await act(loadReports);
    fireEvent.click(screen.getByRole("button", { name: /開発元への報告/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "件名" }), { target: { value: "  " } });
    expect(screen.getByRole("button", { name: "送る" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "GitHub で書く" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("alert").textContent).toBe("件名を入れてください");
  });

  it("keeps the draft when sending fails, and when the person decides later", async () => {
    screenWith();
    await act(loadReports);
    fireEvent.click(screen.getByRole("button", { name: /開発元への報告/ }));
    vi.spyOn(api, "sendReport").mockRejectedValue(new ApiError({ code: "REPORT_OFFLINE", message: "x" }));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "送る" })));
    expect(screen.getByRole("alert").textContent).toContain("つながりませんでした");
    expect(screen.getByRole("button", { name: "送る" })).toHaveProperty("disabled", false);

    fireEvent.change(screen.getByRole("textbox", { name: "本文" }), { target: { value: "途中まで直した" } });
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "開発元への報告 2" }));
    expect(screen.getByRole("textbox", { name: "本文" })).toHaveProperty("value", "途中まで直した");
  });

  it("does not let anything be pressed twice while sending", async () => {
    screenWith();
    await act(loadReports);
    fireEvent.click(screen.getByRole("button", { name: /開発元への報告/ }));
    let finish: (r: Report) => void = () => {};
    vi.spyOn(api, "sendReport").mockReturnValue(new Promise((ok) => (finish = ok)));
    fireEvent.click(screen.getByRole("button", { name: "送る" }));
    expect(screen.getByRole("button", { name: "送っています…" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "送らない" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "あとで決める" })).toHaveProperty("disabled", true);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.getByRole("dialog")).toBeTruthy();
    await act(async () => finish({ ...draft("rpt_1", "x"), status: "sent", issueUrl: "https://github.com/spellsheet/spellsheet/issues/1" }));
  });

  it("throws a draft away, and closes when none is left", async () => {
    onDisk = [draft("rpt_1", "一件だけ")];
    screenWith();
    await act(loadReports);
    fireEvent.click(screen.getByRole("button", { name: "開発元への報告 1" }));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "送らない" })));
    expect(api.discardReport).toHaveBeenCalledWith("rpt_1");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("button", { name: /開発元への報告/ })).toBeNull();
  });

  it("without a relay, offers only GitHub's own form", async () => {
    canSend = false;
    screenWith();
    await act(loadReports);
    fireEvent.click(screen.getByRole("button", { name: /開発元への報告/ }));
    expect(screen.queryByRole("button", { name: "送る" })).toBeNull();
    expect(screen.getByRole("dialog").textContent).toContain("送り先が設定されていません");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "GitHub で書く" })));
    expect(api.openReport).toHaveBeenCalledWith("rpt_1", "並べ替えるノードがない", draft("", "").body);
  });
});
