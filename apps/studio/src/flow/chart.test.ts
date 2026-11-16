import type { Step, StepTypeDef } from "@spellsheet/schema";
import { describe, expect, it } from "vitest";
import { type Chart, layoutChart } from "./chart";

const def = (type: string, category: string): [string, StepTypeDef] => [type, { type, category, label: type } as unknown as StepTypeDef];
const defs = new Map([
  def("browser.click", "browser"),
  def("excel.appendRows", "office"),
  def("variable.set", "variable"),
  def("control.forEach", "control"),
  def("control.if", "control"),
  def("control.switch", "control"),
  def("control.case", "control"),
  def("control.continue", "control"),
  def("control.try", "control"),
  def("control.fail", "control"),
  def("control.group", "control"),
  def("control.parallel", "control"),
]);
let n = 0;
const s = (type: string, blocks?: Record<string, Step[]>, name?: string): Step =>
  ({
    id: `s${++n}`,
    type,
    params: {},
    ...(name ? { name } : {}),
    ...(blocks ? { blocks } : {}),
  }) as Step;

const kinds = (chart: Chart) => chart.shapes.map((x) => (x.kind === "pill" ? `pill:${x.pill}` : x.kind));
const numbersIn = (chart: Chart) => [
  chart.width,
  chart.height,
  ...chart.shapes.flatMap((x) => [x.x, x.y, x.w, x.h]),
  ...chart.frames.flatMap((f) => [f.x, f.y, f.w, f.h]),
  ...chart.lines.flatMap((l) => l.points.flat()),
];
/** Two boxes overlap. */
const overlap = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe("layoutChart", () => {
  it("runs from a start to an end, a box for each step and an arrow between each", () => {
    const chart = layoutChart([s("browser.click"), s("variable.set"), s("excel.appendRows")], defs);
    expect(kinds(chart)).toEqual(["pill:start", "step", "step", "step", "pill:end"]);
    // Down one line: every shape centred on it, each under the one before.
    const mids = chart.shapes.map((x) => x.x + x.w / 2);
    expect(new Set(mids).size).toBe(1);
    chart.shapes.slice(1).forEach((x, i) => expect(x.y).toBeGreaterThan(chart.shapes[i]!.y + chart.shapes[i]!.h));
    expect(chart.lines.filter((l) => l.head)).toHaveLength(4);
    expect(chart.stages).toBe(1);
  });

  it("parts the line under a question into one way for each answer, side by side, named on the line", () => {
    const chart = layoutChart(
      [
        s("control.if", {
          then: [s("browser.click")],
          else: [s("excel.appendRows")],
        }),
      ],
      defs,
      {
        words: {
          answer: (_s, block) => (block === "then" ? "はい" : "いいえ"),
        },
      },
    );
    const [yes, no] = chart.shapes.filter((x) => x.kind === "step");
    expect(yes!.y).toBe(no!.y);
    expect(yes!.x + yes!.w).toBeLessThan(no!.x);
    expect(chart.lines.flatMap((l) => (l.answer ? [l.answer.text] : []))).toEqual(["はい", "いいえ"]);
    // They meet again under both.
    expect(chart.joins).toHaveLength(1);
  });

  it("sends the answer that only stops out to the right, and goes on down with the other", () => {
    const chart = layoutChart([s("control.if", { then: [s("control.fail")], else: [] }), s("browser.click")], defs);
    const ask = chart.shapes.find((x) => x.kind === "ask")!;
    const out = chart.shapes.find((x) => x.kind === "pill" && x.pill === "fail")!;
    expect(out.x).toBeGreaterThan(ask.x + ask.w);
    expect(out.y + out.h / 2).toBe(ask.y + ask.h / 2);
    // The other answer is said on the arrow down to the next step.
    const next = chart.shapes.find((x) => x.kind === "step")!;
    expect(chart.lines.some((l) => l.answer?.text === "else" && l.points.at(-1)![1] === next.y)).toBe(true);
  });

  it("frames what repeats, with an arrow going back up its left side", () => {
    const chart = layoutChart(
      [
        s("control.forEach", {
          body: [s("browser.click"), s("excel.appendRows")],
        }),
      ],
      defs,
    );
    expect(chart.frames.map((f) => f.kind)).toEqual(["loop"]);
    const back = chart.lines.filter((l) => l.tone === "back");
    expect(back).toHaveLength(1);
    const frame = chart.frames[0]!;
    const xs = back[0]!.points.map(([x]) => x);
    expect(Math.min(...xs)).toBeGreaterThan(frame.x);
    for (const step of chart.shapes.filter((x) => x.kind === "step")) expect(Math.min(...xs)).toBeLessThan(step.x);
  });

  it("stands what runs on failure to the right of what it covers, reached by a dashed arrow", () => {
    const chart = layoutChart(
      [
        s("control.try", {
          try: [s("browser.click")],
          catch: [s("variable.set")],
        }),
      ],
      defs,
    );
    const covered = chart.frames.find((f) => f.kind === "try")!;
    const head = chart.shapes.find((x) => x.kind === "pill" && x.pill === "caught")!;
    expect(head.x).toBeGreaterThan(covered.x + covered.w);
    expect(chart.lines.filter((l) => l.tone === "fail")).toHaveLength(1);
  });

  it("runs branches side by side between two bars", () => {
    const chart = layoutChart(
      [
        s("control.parallel", {
          branches: [s("browser.click"), s("excel.appendRows")],
        }),
      ],
      defs,
    );
    expect(chart.shapes.filter((x) => x.kind === "bar")).toHaveLength(2);
    const [a, b] = chart.shapes.filter((x) => x.kind === "step");
    expect(a!.y).toBe(b!.y);
  });

  it("stands each named group in a column of its own when the flow is made of them", () => {
    const chart = layoutChart(
      [s("browser.click"), s("control.group", { body: [s("browser.click"), s("browser.click")] }, "STEP1"), s("control.group", { body: [s("excel.appendRows")] }, "STEP2")],
      defs,
    );
    expect(chart.stages).toBe(3);
    const [first, second] = chart.frames;
    expect(first!.y).toBe(second!.y);
    expect(first!.x + first!.w).toBeLessThan(second!.x);
    // The line goes on from one column to the next.
    expect(chart.lines.filter((l) => l.head && l.points.length === 6)).toHaveLength(2);
  });

  it("draws nothing wrong for empty and switched-off parts", () => {
    const off = { ...s("browser.click"), disabled: true } as Step;
    const chart = layoutChart(
      [
        s("control.if", { then: [], else: [] }),
        s("control.forEach", { body: [] }),
        s("control.try", { try: [], catch: [off] }),
        s("control.parallel", { branches: [] }),
        s("control.switch", { cases: [] }),
        s("control.group", { body: [] }),
        off,
        s("unknown.type"),
        s("control.fail"),
        s("browser.click"),
      ],
      new Map(),
    );
    for (const v of numbersIn(chart)) expect(Number.isFinite(v)).toBe(true);
    // After a stop nothing runs: no arrow goes into what stands there, and the flow has no end to reach.
    expect(kinds(chart)).not.toContain("pill:end");
    const empty = layoutChart([], defs);
    expect(kinds(empty)).toEqual(["pill:start", "pill:end"]);
  });

  it("lays no two boxes over one another", () => {
    const chart = layoutChart(
      [
        s("browser.click"),
        s("control.if", {
          then: [
            s("browser.click"),
            s("control.forEach", {
              body: [s("excel.appendRows"), s("control.if", { then: [s("control.continue")], else: [] })],
            }),
          ],
          else: [
            s("control.try", {
              try: [s("browser.click")],
              catch: [s("variable.set"), s("control.fail")],
            }),
          ],
        }),
        s("control.switch", {
          cases: [s("control.case", { body: [s("browser.click")] }), s("control.case", { body: [] })],
          default: [s("variable.set")],
        }),
      ],
      defs,
      { facts: () => 2 },
    );
    const boxes = chart.shapes.filter((x) => x.kind !== "bar");
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) expect(overlap(boxes[i]!, boxes[j]!)).toBe(false);
    for (const b of boxes) {
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.x + b.w).toBeLessThanOrEqual(chart.width + 0.5);
      expect(b.y + b.h).toBeLessThanOrEqual(chart.height + 0.5);
    }
  });
});
