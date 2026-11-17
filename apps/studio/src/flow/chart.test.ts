import type { Step, StepTypeDef } from "@spellsheet/schema";
import { describe, expect, it } from "vitest";
import { type Route, layoutRoute } from "./chart";

const def = (type: string, category: string): [string, StepTypeDef] => [
  type,
  { type, category, label: type } as unknown as StepTypeDef,
];
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
const s = (
  type: string,
  blocks?: Record<string, Step[]>,
  name?: string,
): Step =>
  ({
    id: `s${++n}`,
    type,
    params: {},
    ...(name ? { name } : {}),
    ...(blocks ? { blocks } : {}),
  }) as Step;

const numbersIn = (r: Route) => [
  r.width,
  r.height,
  ...r.stations.flatMap((x) => [x.x, x.y]),
  ...r.stops.flatMap((x) => [x.x, x.y, x.w]),
  ...r.tracks.flatMap((t) => t.points.flat()),
  ...r.spans.flatMap((x) => [x.x1, x.x2, x.y]),
  ...r.inserts.flatMap((x) => [x.x, x.y]),
];
/** Where on the map the line of the main tracks runs at `x`: the stations of a row stand on it. */
const rowsOf = (r: Route) => [
  ...new Set(r.stations.filter((x) => x.label === "below").map((x) => x.y)),
];

describe("layoutRoute", () => {
  it("runs from 開始 to 終了 with a station for each step, one after another on one line", () => {
    const steps = [
      s("browser.click"),
      s("variable.set"),
      s("excel.appendRows"),
    ];
    const r = layoutRoute(steps, defs);
    expect(r.pills.map((p) => p.kind)).toEqual(["start", "end"]);
    expect(r.stations.map((x) => x.step)).toEqual(steps);
    expect(new Set(r.stations.map((x) => x.y)).size).toBe(1);
    r.stations
      .slice(1)
      .forEach((x, i) => expect(x.x).toBeGreaterThan(r.stations[i]!.x));
    // Between start and the last station and the end, the line is unbroken.
    expect(r.tracks.filter((t) => t.tone === "main")).toHaveLength(1);
    expect(r.rows).toBe(1);
  });

  it("goes on in the next row when the line is longer than a row, as text does", () => {
    const steps = Array.from({ length: 20 }, () => s("browser.click"));
    const r = layoutRoute(steps, defs, { rowWidth: 900 });
    expect(r.rows).toBeGreaterThan(2);
    expect(rowsOf(r)).toHaveLength(r.rows);
    for (const x of r.stations) expect(x.x).toBeLessThanOrEqual(900);
    // Each row starts again at the left: the line goes back round under the row before.
    expect(r.tracks.filter((t) => t.tone === "wrap")).toHaveLength(r.rows - 1);
    expect(r.pills.find((p) => p.kind === "end")!.y).toBeGreaterThan(
      r.pills.find((p) => p.kind === "start")!.y,
    );
  });

  it("sends the answer that only stops down a spur to where the flow stops, and goes on along the line with the other", () => {
    const ask = s("control.if", { then: [s("control.fail")], else: [] });
    const next = s("browser.click");
    const r = layoutRoute([ask, next], defs, {
      words: { answer: (_s, block) => (block === "then" ? "はい" : "いいえ") },
    });
    const diamond = r.stations.find((x) => x.step === ask)!;
    expect(diamond.kind).toBe("ask");
    expect(r.stops).toHaveLength(1);
    expect(r.stops[0]!.y).toBeGreaterThan(diamond.y);
    expect(r.stops[0]!.fail).toBe(true);
    expect(r.tracks.some((t) => t.tone === "spur")).toBe(true);
    expect(r.notes.map((x) => x.text)).toEqual(["はい", "いいえ"]);
    expect(r.stations.find((x) => x.step === next)!.y).toBe(diamond.y);
  });

  it("parts the line for an answer with something to do: its steps on a track above that comes back down", () => {
    const yes = s("browser.click");
    const after = s("variable.set");
    const r = layoutRoute(
      [s("control.if", { then: [yes], else: [] }), after],
      defs,
    );
    const line = r.stations.find((x) => x.step === after)!.y;
    const up = r.stations.find((x) => x.step === yes)!;
    expect(up.y).toBeLessThan(line);
    expect(up.label).toBe("above");
    const side = r.tracks.find((t) => t.tone === "side")!;
    expect(side.points[0]![1]).toBe(line);
    expect(side.points.at(-1)![1]).toBe(line);
  });

  it("puts a bracket over what repeats, and names the parts of the work over their stretch of the line", () => {
    const loop = s(
      "control.forEach",
      { body: [s("browser.click"), s("excel.appendRows")] },
      "1 件ずつ",
    );
    const one = s("control.group", { body: [s("browser.click")] }, "読む");
    const two = s("control.group", { body: [loop] }, "登録する");
    const r = layoutRoute([one, two], defs, {
      stageOf: (x) => (x === one ? 0 : 1),
      words: { stage: (i) => ["読む", "登録する"][i]! },
    });
    expect(r.tags.map((t) => t.stage)).toEqual([0, 1]);
    // A part named on the line needs no bracket of its own; what repeats in it has one.
    expect(r.spans.map((x) => x.step)).toEqual([loop]);
    const span = r.spans[0]!;
    const inside = r.stations.filter((x) =>
      loop.blocks!.body!.includes(x.step),
    );
    for (const x of inside) {
      expect(x.x).toBeGreaterThan(span.x1);
      expect(x.x).toBeLessThan(span.x2);
      expect(span.y).toBeLessThan(x.y);
    }
    expect(
      new Set(r.tracks.filter((t) => t.tone === "main").map((t) => t.stage)),
    ).toEqual(new Set([0, 1]));
  });

  it("takes what runs on failure down a dashed track under the line", () => {
    const caught = s("variable.set");
    const r = layoutRoute(
      [s("control.try", { try: [s("browser.click")], catch: [caught] })],
      defs,
    );
    const line = r.stations[0]!.y;
    expect(r.stations.find((x) => x.step === caught)!.y).toBeGreaterThan(line);
    expect(r.tracks.some((t) => t.tone === "fail")).toBe(true);
    expect(r.spans.map((x) => x.kind)).toEqual(["try"]);
  });

  it("draws nothing wrong for empty and switched-off parts", () => {
    const off = { ...s("browser.click"), disabled: true } as Step;
    const r = layoutRoute(
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
      ],
      new Map(),
    );
    for (const v of numbersIn(r)) expect(Number.isFinite(v)).toBe(true);
    expect(r.stations.some((x) => x.step === off)).toBe(false);
    // The flow stops at its last step: there is no end to reach.
    expect(r.pills.map((p) => p.kind)).toEqual(["start"]);
    const empty = layoutRoute([], defs);
    expect(empty.pills.map((p) => p.kind)).toEqual(["start", "end"]);
  });

  it("stands no two stations on one place", () => {
    const r = layoutRoute(
      [
        s("browser.click"),
        s("control.if", {
          then: [
            s("browser.click"),
            s("control.forEach", {
              body: [
                s("excel.appendRows"),
                s("control.if", { then: [s("control.continue")], else: [] }),
              ],
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
          cases: [
            s("control.case", { body: [s("browser.click")] }),
            s("control.case", { body: [] }),
          ],
          default: [s("variable.set")],
        }),
        s("control.parallel", {
          branches: [
            s("browser.click"),
            s("excel.appendRows"),
            s("variable.set"),
          ],
        }),
      ],
      defs,
      { rowWidth: 1000 },
    );
    for (let i = 0; i < r.stations.length; i++)
      for (let j = i + 1; j < r.stations.length; j++) {
        const a = r.stations[i]!;
        const b = r.stations[j]!;
        expect(Math.abs(a.x - b.x) >= 60 || Math.abs(a.y - b.y) >= 40).toBe(
          true,
        );
      }
    for (const v of numbersIn(r)) expect(Number.isFinite(v)).toBe(true);
    for (const x of r.stations) {
      expect(x.x).toBeGreaterThanOrEqual(0);
      expect(x.x).toBeLessThanOrEqual(r.width);
      expect(x.y).toBeGreaterThanOrEqual(0);
      expect(x.y).toBeLessThanOrEqual(r.height);
    }
  });

  it("offers a place to add a step before the first, after each, and inside an empty part", () => {
    const a = s("browser.click");
    const b = s("variable.set");
    const loop = s("control.forEach", { body: [] });
    const r = layoutRoute([a, b, loop], defs);
    const slots = r.inserts.map((x) => x.slot);
    for (const index of [0, 1, 2])
      expect(slots).toContainEqual({ parentId: null, block: null, index });
    expect(slots).toContainEqual({
      parentId: loop.id,
      block: "body",
      index: 0,
    });
  });
});
