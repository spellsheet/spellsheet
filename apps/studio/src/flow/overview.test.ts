import type { Step } from "@spellsheet/schema";
import { describe, expect, it } from "vitest";
import { type AskNode, type BoxNode, type Node, outline, place, type Words } from "./overview";

let n = 0;
const s = (type: string, extra: Partial<Step> = {}): Step => ({ id: `s${++n}`, type, params: {}, ...extra }) as Step;
const named = (type: string, name: string, blocks?: Record<string, Step[]>, params: Record<string, unknown> = {}) => s(type, { name, params, ...(blocks ? { blocks } : {}) });

/** Every step numbered, as the sheet numbers what it shows. */
const numbered = new Set<string>();
const words: Words = {
  title: (step) => step.name ?? step.type,
  question: (step) => {
    const cond = String(step.params?.condition ?? "");
    return cond.startsWith("!") ? { text: `${cond.slice(1)}？`, flipped: true } : { text: `${step.name ?? cond}？`, flipped: false };
  },
  stop: (step) => step.name ?? "stop",
  answer: (block) => (block === "then" ? "はい" : "いいえ"),
  range: (steps) => {
    const ids = steps.filter((x) => numbered.has(x.id ?? "")).length;
    return ids > 0 ? `手順 ${ids}` : "";
  },
  note: (group) => (group?.retry?.maxAttempts ? `${group.retry.maxAttempts} 回までやり直す` : ""),
  how: (_step, mark) => mark,
  way: (_step, block, steps) => `${block}：${steps[0]!.name ?? ""}`,
};
const step = (name: string) => {
  const x = named("browser.click", name);
  numbered.add(x.id!);
  return x;
};
const kinds = (nodes: Node[]) => nodes.map((x) => x.kind);
const boxes = (nodes: Node[]) => nodes.filter((x): x is BoxNode => x.kind === "box");
const asks = (nodes: Node[]) => nodes.filter((x): x is AskNode => x.kind === "ask");

describe("outline", () => {
  it("draws steps that follow one another as one box, named after their group", () => {
    const nodes = outline([named("control.group", "STEP1 申込者の情報", { body: [step("貴社名を入力"), step("部署名を入力"), step("郵便番号を入力")] })], words);
    expect(kinds(nodes)).toEqual(["start", "box", "end"]);
    expect(boxes(nodes)[0]!.title).toBe("STEP1 申込者の情報");
    expect(boxes(nodes)[0]!.steps).toHaveLength(3);
  });

  it("puts a question whose one answer stops on the line, with the stop under it, asked the right way round", () => {
    const fail = named("control.fail", "住所が入らなかった");
    const nodes = outline([step("郵便番号を入力"), s("control.if", { params: { condition: "!住所が入った" }, blocks: { then: [fail], else: [] } }), step("電話番号を入力")], words);
    expect(kinds(nodes)).toEqual(["start", "box", "ask", "box", "end"]);
    const ask = asks(nodes)[0]!;
    expect(ask.text).toBe("住所が入った？");
    expect(ask.stop).toEqual({ answer: "いいえ", why: "住所が入らなかった", step: fail });
    expect(ask.go).toBe("はい");
  });

  it("draws an answer that only skips steps as a skip over their boxes", () => {
    const nodes = outline([step("ページを開く"), named("control.if", "未サインイン", { then: [step("サインインを押す"), named("control.group", "サインイン", { body: [step("メール"), step("パスワード")] })], else: [] }), step("入力")], words);
    expect(kinds(nodes)).toEqual(["start", "box", "ask", "box", "box", "box", "end"]);
    expect(asks(nodes)[0]!.skip).toEqual({ answer: "いいえ", over: 2 });
  });

  it("gives a loop, a guard and branches at the same time boxes of their own when they hold two steps or more", () => {
    const loop = named("control.forEach", "1 件ずつ", { body: [step("a"), step("b")] });
    const guard = named("control.try", "失敗に備える", { try: [step("c"), step("d")], catch: [named("log.message", "記録する")] });
    const both = named("control.parallel", "同時に", { branches: [step("e"), step("f")] });
    const small = named("control.repeat", "1 文字打つ", { body: [step("g")] });
    const nodes = outline([step("first"), small, loop, guard, both], words);
    expect(boxes(nodes).map((b) => b.mark ?? null)).toEqual([null, "loop", "try", "parallel"]);
    // The small loop stays in the box it stands in.
    expect(boxes(nodes)[0]!.steps.map((x) => x.name)).toEqual(["first", "1 文字打つ", "g"]);
    expect(boxes(nodes)[2]!.caught?.text).toBe("catch：記録する");
  });

  it("says each way of a question with several under it", () => {
    const nodes = outline([named("control.if", "ログイン済み", { then: [step("a"), step("b")], else: [step("c")] })], words);
    expect(asks(nodes)[0]!.ways?.map((w) => w.text)).toEqual(["then：a", "else：c"]);
  });

  it("makes no box of steps the sheet gives no number, and ends where the flow stops", () => {
    const nodes = outline([step("a"), named("variable.set", "値を覚える"), named("control.fail", "止める"), step("never")], words);
    expect(kinds(nodes)).toEqual(["start", "box", "stop"]);
    expect(boxes(nodes)[0]!.steps.map((x) => x.name)).toEqual(["a", "値を覚える"]);
    expect(kinds(outline([], words))).toEqual(["start", "end"]);
  });
});

describe("place", () => {
  it("wraps the nodes into rows as wide as it is given, and keeps a skip on one row", () => {
    const nodes = outline(
      [step("1"), named("control.if", "q", { then: [step("2"), named("control.group", "g", { body: [step("3")] })], else: [] }), step("4"), step("5"), step("6")],
      words,
    );
    const ov = place(nodes, 900);
    for (const p of ov.placed) expect(p.x + p.w).toBeLessThanOrEqual(900);
    expect(new Set(ov.placed.map((p) => p.row)).size).toBeGreaterThan(1);
    const at = ov.placed.findIndex((p) => p.node.kind === "ask");
    const ask = ov.placed[at]!;
    expect(ov.placed[at + 1]!.row).toBe(ask.row);
    expect(ov.placed[at + 2]!.row).toBe(ask.row);
    for (const v of ov.placed.flatMap((p) => [p.x, p.y, p.w, p.h])) expect(Number.isFinite(v)).toBe(true);
  });
});
