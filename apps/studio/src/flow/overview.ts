// The flow as a flowchart to take in at a glance: the shape of the work, not each step.
//
// The sheet already says every step, one to a line. What it cannot show is how
// the work runs: where it asks, where it may stop, and where it ends. So the
// chart leaves the steps to the sheet and draws only that:
//
// - Steps that simply follow one another are one box, named after the part of
//   the flow they make up (a named group, "STEP1 申込者の情報を入力"), with the
//   numbers of the steps in it ("手順 6〜8"). A box opens its steps on the sheet.
// - A question is a diamond on the line. One whose answer only stops the flow
//   sends that answer down to a vermilion "止まる：…" under it; one whose answer
//   only skips some steps draws the skip as a line over them.
// - It begins at 開始 and ends at 終了, and runs left to right in rows, each row
//   under the one before, as text is read. The rows are as wide as the paper,
//   so it is read as it is, without zooming.
//
// Pure layout: what each node says is handed in (components/chart).
import type { Step } from "@spellsheet/schema";
import { BREAK, CONTINUE, FAIL, GROUP, IF, LOOP_TYPES, PARALLEL, SWITCH, TRY } from "../lib/stepTypes";

const WAIT_UNTIL = "wait.until";

/** What the layout is told about steps, in the reader's words. */
export type Words = {
  /** A step's name, or what it does. */
  title: (step: Step) => string;
  /** A question's words, ending in a question mark; `flipped` when they ask the opposite of the step's condition (its "then" is answered no). */
  question: (step: Step) => { text: string; flipped: boolean };
  /** Why the flow stops at a step that stops it. */
  stop: (step: Step) => string;
  /** The answer that takes a question's block ("はい", "いいえ"). */
  answer: (block: string) => string;
  /** "手順 6〜8", from the numbers of the steps in a box; "" when none has one. */
  range: (steps: Step[]) => string;
  /** Under a box's name: "3 回までやり直す" for a group tried again; "" for nothing. */
  note: (group: Step | null) => string;
  /** What a part of the flow that is its own box does with its steps: "1 件ずつ繰り返す", "同時に進める（2 つ）", "失敗に備える". */
  how: (step: Step, mark: Mark) => string;
  /** One way out of a question that has several ("はい：ユーザー名を入力ほか"): its answer, and the first of its steps. */
  way: (step: Step, block: string, steps: Step[]) => string;
};

/** A part of the flow drawn as one box, and how it runs its steps. */
export type Mark = "loop" | "try" | "parallel";

/** A box of steps that follow one another. `steps` are all of them, inner ones too; `open` is the step pressed to read them. */
export type BoxNode = {
  kind: "box";
  title: string;
  sub: string;
  steps: Step[];
  open: Step;
  /** A loop, a guard against failure, or branches at the same time. */
  mark?: Mark;
  /** For a guard: what runs when what it covers fails, said under it. */
  caught?: { text: string; step: Step };
};
/** A question on the line. `stop`: the answer that stops the flow, and why. `skip`: the answer that skips the next `over` nodes. */
export type AskNode = {
  kind: "ask";
  step: Step;
  text: string;
  /** The answer the line goes on with. */
  go: string;
  stop?: { answer: string; why: string; step: Step };
  skip?: { answer: string; over: number };
  /** A question with more than one real way: each way said under it. */
  ways?: { text: string; step: Step }[];
};
/** Where the flow stops on its main line (a fail with no question before it). */
export type StopNode = { kind: "stop"; why: string; step: Step };
export type TermNode = { kind: "start" | "end" };
export type Node = BoxNode | AskNode | StopNode | TermNode;

const STOPS: ReadonlySet<string> = new Set([BREAK, CONTINUE, FAIL]);
const live = (list: Step[] | undefined): Step[] => (list ?? []).filter((s) => !s.disabled);
const stops = (step: Step | undefined): boolean => !!step && STOPS.has(step.type);
/** Every step in a list, and in what each holds. */
const all = (list: Step[]): Step[] => list.flatMap((s) => [s, ...all(Object.values(s.blocks ?? {}).flatMap(live))]);
/** The step that stops a list, when taking it the flow does not go on: a stop in it, or in a group in it. */
const stopIn = (list: Step[]): Step | undefined => {
  for (const s of live(list)) {
    if (stops(s)) return s;
    if (s.type === GROUP) {
      const inner = stopIn(s.blocks?.body ?? []);
      if (inner) return inner;
    }
  }
  return undefined;
};
const ends = (list: Step[]): boolean => !!stopIn(list);
/** How a step runs what it holds, when it is drawn as a box of its own. */
const markOf = (step: Step): Mark | null => (LOOP_TYPES.has(step.type) || step.type === WAIT_UNTIL ? "loop" : step.type === TRY ? "try" : step.type === PARALLEL ? "parallel" : null);
/** Big enough to show: two steps or more inside. A loop round one step stays in the box it stands in. */
const big = (step: Step): boolean => all(Object.values(step.blocks ?? {}).flatMap(live)).length >= 2;

/** The nodes of the chart, start to end. */
export function outline(steps: Step[], words: Words): Node[] {
  const out: Node[] = [{ kind: "start" }];
  let open = true;
  /** Steps waiting to become a box, and the group they belong to. */
  let run: Step[] = [];
  let group: Step | null = null;
  let named = false;
  const flush = (last = false) => {
    if (run.length === 0) return;
    const inner = all(run);
    const name = group && !named ? (group.name ?? "").trim() : "";
    // Steps the sheet gives no number (keeping a value, writing to the log) make no box of their own:
    // they go with the box after them, or at the end with the box before.
    if (!name && !words.range(inner)) {
      if (!last) return;
      const before = [...out].reverse().find((n): n is BoxNode => n.kind === "box");
      if (before) {
        before.steps.push(...inner);
        run = [];
        return;
      }
    }
    named = named || !!name;
    const head = words.title(run[0]!);
    const title = name || head;
    const sub = [words.range(inner), words.note(name ? group : null)].filter(Boolean).join("・");
    out.push({ kind: "box", title, sub, steps: inner, open: run[0]! });
    run = [];
  };
  const walk = (list: Step[], within: Step | null) => {
    for (const step of live(list)) {
      if (!open) return;
      if (step.type === GROUP && (step.name ?? "").trim()) {
        flush();
        const [outer, wasNamed] = [group, named];
        group = step;
        named = false;
        walk(live(step.blocks?.body), step);
        flush();
        group = outer;
        named = wasNamed;
        continue;
      }
      if (step.type === IF) {
        const yes = live(step.blocks?.then);
        const no = live(step.blocks?.else);
        const asked = words.question(step);
        // Asked the other way round, "then" is the answer no.
        const way = (block: string) => words.answer(asked.flipped ? (block === "then" ? "else" : "then") : block);
        // One answer only stops: down to its stop, and on with the other.
        const stopping = ends(yes) && !ends(no) ? (["then", yes, "else", no] as const) : ends(no) && !ends(yes) ? (["else", no, "then", yes] as const) : null;
        if (stopping) {
          flush();
          const [stopBlock, stopList, goBlock, goList] = stopping;
          const last = stopIn(stopList)!;
          out.push({ kind: "ask", step, text: asked.text, go: way(goBlock), stop: { answer: way(stopBlock), why: words.stop(last), step: last } });
          walk(goList, within);
          continue;
        }
        // One answer does nothing: the other's steps are skipped on it.
        const skipping = yes.length > 0 && no.length === 0 ? (["else", yes, "then"] as const) : no.length > 0 && yes.length === 0 ? (["then", no, "else"] as const) : null;
        if (skipping) {
          flush();
          const [skipBlock, doList, doBlock] = skipping;
          const ask: AskNode = { kind: "ask", step, text: asked.text, go: way(doBlock), skip: { answer: way(skipBlock), over: 0 } };
          out.push(ask);
          const before = out.length;
          const [outer, wasNamed] = [group, named];
          // What the answer does is its own box, named after its first step.
          named = true;
          walk(doList, within);
          flush();
          group = outer;
          named = wasNamed;
          // The other answer goes on, whatever this one does.
          open = true;
          ask.skip!.over = out.length - before;
          if (ask.skip!.over === 0) delete ask.skip;
          continue;
        }
      }
      // A question with several real ways: each said under it, and on with the line.
      if ((step.type === IF || step.type === SWITCH) && big(step)) {
        flush();
        const asked = words.question(step);
        const blocks = step.type === IF ? (["then", "else"] as const).map((b) => [b, live(step.blocks?.[b])] as const) : [...live(step.blocks?.cases).map((c) => [c, live(c.blocks?.body)] as const), ["default", live(step.blocks?.default)] as const];
        const ways = blocks
          .filter(([, list]) => list.length > 0)
          .map(([b, list]) => ({ text: typeof b === "string" ? words.way(step, asked.flipped ? (b === "then" ? "else" : "then") : b, list) : words.way(b, "case", list), step: list[0]! }));
        out.push({ kind: "ask", step, text: asked.text, go: "", ways });
        continue;
      }
      const mark = markOf(step);
      if (mark && big(step)) {
        flush();
        const inner = all([step]);
        const name = (step.name ?? "").trim();
        const sub = [words.how(step, mark), words.range(inner)].filter(Boolean).join("・");
        const caught = mark === "try" ? live(step.blocks?.catch) : [];
        out.push({
          kind: "box",
          title: name || words.title(step),
          sub,
          steps: inner,
          open: step,
          mark,
          ...(caught.length > 0 ? { caught: { text: words.way(step, "catch", caught), step: caught[0]! } } : {}),
        });
        continue;
      }
      if (stops(step)) {
        flush();
        out.push({ kind: "stop", why: words.stop(step), step });
        open = false;
        return;
      }
      // Anything else (a step, a small loop or question) goes in the box it stands in.
      run.push(step);
    }
  };
  walk(steps, null);
  flush(true);
  if (open) out.push({ kind: "end" });
  return out;
}

/** Sizes on the chart. */
export const BOX_W = 216;
export const BOX_H = 72;
export const ASK_W = 132;
export const ASK_H = 84;
export const PILL_W = 84;
export const PILL_H = 32;
/** Between two nodes on a row: the arrow. */
export const GAP = 40;
/** Over a row: room for a skip's line. Under it: room for a stop. */
export const OVER = 44;
export const UNDER = 96;
/** Between rows: the line going round to the next. */
export const TURN = 36;

export type Placed = { node: Node; x: number; y: number; w: number; h: number; row: number; under?: number };
/** Under a row with no stop under it. */
export const UNDER_BARE = 24;
export type Overview = { placed: Placed[]; width: number; height: number };

const sizeOf = (node: Node): [number, number] => (node.kind === "box" ? [BOX_W, BOX_H] : node.kind === "ask" ? [ASK_W, ASK_H] : node.kind === "stop" ? [BOX_W, PILL_H] : [PILL_W, PILL_H]);

/**
 * The nodes in rows `width` wide, left to right, the next row under. A skip
 * never runs from one row to the next: its question starts a new row when
 * what it skips would not fit on this one. `y` is a node's middle.
 */
export function place(nodes: Node[], width: number): Overview {
  const rows: Node[][] = [[]];
  let used = 0;
  /** Where a row must start: after a skip too wide for one row, so the skip can come down to what follows it. */
  const starts = new Set<number>();
  const fits = (w: number) => used === 0 || used + GAP + w <= width;
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!;
    let need = sizeOf(node)[0];
    if (node.kind === "ask" && node.skip) {
      for (let k = 1; k <= node.skip.over && i + k < nodes.length; k++) need += GAP + sizeOf(nodes[i + k]!)[0];
      if (need > width) starts.add(i + node.skip.over + 1);
    }
    if ((!fits(need) || starts.has(i)) && rows.at(-1)!.length > 0) {
      rows.push([]);
      used = 0;
    }
    used += (used === 0 ? 0 : GAP) + sizeOf(node)[0];
    rows.at(-1)!.push(node);
  }
  const placed: Placed[] = [];
  let top = 0;
  rows.forEach((row, r) => {
    const mid = top + OVER + ASK_H / 2;
    let x = 0;
    for (const node of row) {
      const [w, h] = sizeOf(node);
      placed.push({ node, x, y: mid, w, h, row: r });
      x += w + GAP;
    }
    const under = row.some((n) => (n.kind === "ask" && (n.stop || n.ways)) || (n.kind === "box" && n.caught)) ? UNDER : UNDER_BARE;
    placed.filter((p) => p.row === r).forEach((p) => (p.under = under));
    top = mid + ASK_H / 2 + under + TURN;
  });
  const height = top - TURN;
  const right = Math.max(0, ...placed.map((p) => p.x + p.w));
  return { placed, width: Math.max(width, right), height };
}
