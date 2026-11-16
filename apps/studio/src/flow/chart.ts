// The flow as a chart to look at, laid out from nothing but the flow itself.
//
// It answers at a glance what the sheet's sentences cannot: where the work
// parts and meets again, what repeats, where it can fail and what then, and
// how the whole flow runs from start to end. So it is drawn the way a
// flowchart is drawn on paper, top to bottom:
//
// - It begins at 開始 and ends at 終了. A step is a box with its app's icon,
//   and an arrow runs from each box to the next.
// - A question (an if, a switch) is a pointed box, and the line parts under it:
//   one way for each answer, side by side, each named on its line, meeting
//   again under them. A question whose one answer only stops (fails, leaves a
//   loop, goes on to the next round) sends that answer out to its right.
// - What repeats is a tinted frame with an arrow going back up its left side.
// - A group of steps is a frame with its name at the top; one that is tried
//   again says so there.
// - What runs when something fails stands to the right of what it covers,
//   reached by a dashed vermilion arrow.
// - What runs at the same time parts at a bar into branches side by side and
//   meets at a bar again.
// - When the flow is made of named groups (STEP 1, STEP 2…), each stands in a
//   column of its own, left to right, so the whole flow fits the screen; the
//   line goes on from the foot of one column to the head of the next.
//
// Pure geometry: what each shape says is the component's (components/chart),
// which hands the words in only where their length decides a size.
import type { Step, StepTypeDef } from "@spellsheet/schema";
import { groupOf, isAppGroup } from "../lib/palette";
import { BREAK, CASE, CONTINUE, FAIL, GROUP, IF, LOOP_TYPES, PARALLEL, SWITCH, TRY } from "../lib/stepTypes";

export type Defs = ReadonlyMap<string, StepTypeDef>;

/** A step's box: how wide it is, and how high a line of its name is. */
export const BOX_W = 272;
export const LINE_H = 19;
/** Over and under the name in a box. */
export const BOX_PAD = 9;
/** A line of what the system does, under a step's name in its box, and the room under the last of them. */
export const FACT_H = 17;
export const FACT_PAD = 8;
/** A question's box. */
export const ASK_H = 44;
const ASK_MAX = 380;
/** A start, an end, a way out. */
export const PILL_H = 30;
/** A frame's name at its top. */
export const HEAD_H = 34;
/** The bar where branches that run at the same time part, and where they meet. */
export const BAR_H = 4;
/** Between two boxes: the arrow from one to the next. */
const GAP = 24;
/** Between branches side by side. */
const SIDE_GAP = 36;
/** From a question down to where its line parts, and from there to the branches (room for the answer's name). */
const PART = 14;
const INTO = 38;
/** Under the branches, to where they meet. */
const MEET = 20;
/** Inside a frame: beside what is in it, the room on the left for the arrow going back, and under it. */
const FRAME_X = 18;
const BACK_X = 34;
const FRAME_B = 18;
/** Between a frame and what runs when it fails, to its right. */
const FAIL_GAP = 64;
/** Between the columns of named groups, and over them for the line going on to the next. */
export const STAGE_GAP = 80;
export const STAGE_TOP = 28;

const WAIT_UNTIL = "wait.until";
const STOPS: ReadonlySet<string> = new Set([BREAK, CONTINUE, FAIL]);
const stops = (step: Step | undefined): boolean => !!step && STOPS.has(step.type) && !step.disabled;
const live = (list: Step[] | undefined): Step[] => (list ?? []).filter((s) => !s.disabled);
const blocksOf = (step: Step): [string, Step[]][] => Object.entries(step.blocks ?? {});

/** The app a step works on (a group of lib/palette), or null for work on nothing outside. */
export function appOf(step: Step, defs: Defs): string | null {
  const def = defs.get(step.type);
  if (!def) return null;
  const group = groupOf(def);
  return isAppGroup(group) ? group : null;
}

/** How wide a line of words is, near enough to size a box round it: Japanese a full square, Latin about half. */
export function textWidth(text: string, size: number): number {
  let w = 0;
  for (const ch of text) w += ch.charCodeAt(0) < 0x2e80 ? size * 0.58 : size;
  return Math.ceil(w);
}

export type FrameKind = "loop" | "group" | "try" | "always";
export type PillKind = "start" | "end" | "fail" | "stop" | "caught";

export type Shape =
  | /** A step. `minor`: a wait or check the sheet says in place without a number, drawn quieter. */ {
      kind: "step";
      step: Step;
      x: number;
      y: number;
      w: number;
      h: number;
      lines: number;
      minor: boolean;
    }
  | /** A question: an if or a switch. */ {
      kind: "ask";
      step: Step;
      x: number;
      y: number;
      w: number;
      h: number;
    }
  | /** A start, an end, a way out (a stop step, when there is one), or the head of what runs on failure. */ {
      kind: "pill";
      pill: PillKind;
      step?: Step;
      x: number;
      y: number;
      w: number;
      h: number;
    }
  | /** Where branches that run at the same time part or meet. */ {
      kind: "bar";
      step: Step;
      x: number;
      y: number;
      w: number;
      h: number;
    };

export type Frame = {
  kind: FrameKind;
  step: Step;
  x: number;
  y: number;
  w: number;
  h: number;
};

/** A line through `points`. `head`: an arrow's head at its end. `answer`: the answer it is, said on it at `at`. */
export type Line = {
  points: [number, number][];
  head: boolean;
  tone: "line" | "fail" | "back";
  answer?: { text: string; at: [number, number] };
};

export type Chart = {
  shapes: Shape[];
  frames: Frame[];
  lines: Line[];
  /** Small dots where lines meet. */
  joins: [number, number][];
  width: number;
  height: number;
  /** How many columns of named groups the flow stands in. */
  stages: number;
};

/** What the chart says where its length decides a size (components/chart gives the real words). */
export type Words = {
  /** A step's name in its box. */
  title: (step: Step) => string;
  /** A question. */
  question: (step: Step) => string;
  /** A frame's name and what is said beside it (how it repeats, how often it is tried), as one line. */
  frame: (step: Step, kind: FrameKind) => string;
  /** A way out: a stop step's own words. */
  stop: (step: Step) => string;
  /** The name of one answer of a question: `block` then/else, or a case (`child`), or default. */
  answer: (step: Step, block: string, child?: Step) => string;
  /** What is said on a pill that is not a step. */
  pill: (kind: "start" | "end" | "caught" | "together") => string;
};

export type Options = {
  /** How many lines of what the system does stand under a step's name. */
  facts?: (step: Step) => number;
  /** Whether a step is drawn quieter (a wait or check the sheet gives no number). */
  minor?: (step: Step) => boolean;
  words?: Partial<Words>;
};

const plainWords: Words = {
  title: (s) => (s.name ?? "").trim() || s.type,
  question: (s) => (s.name ?? "").trim() || s.type,
  frame: (s) => (s.name ?? "").trim() || s.type,
  stop: (s) => (s.name ?? "").trim() || s.type,
  answer: (_s, block, child) => (child ? (child.name ?? "").trim() || "case" : block),
  pill: (k) => k,
};

/** A part of the chart, drawn round its own line: x = 0 is the line it comes in and goes out on, y = 0 its top. */
type Block = {
  /** How far it reaches left (negative) and right of its line. */
  l: number;
  r: number;
  h: number;
  /** Whether the flow goes on out of its foot (a stop ends it). */
  open: boolean;
  /** The answer said on the arrow out of its foot (a question whose other answer leaves to the right). */
  out?: string;
  shapes: Shape[];
  frames: Frame[];
  lines: Line[];
  joins: [number, number][];
};

const empty = (): Block => ({
  l: 0,
  r: 0,
  h: 0,
  open: true,
  shapes: [],
  frames: [],
  lines: [],
  joins: [],
});

/** `b` into `into`, its line at `dx` and its top at `dy`. */
function put(into: Block, b: Block, dx: number, dy: number) {
  for (const s of b.shapes) into.shapes.push({ ...s, x: s.x + dx, y: s.y + dy });
  for (const f of b.frames) into.frames.push({ ...f, x: f.x + dx, y: f.y + dy });
  for (const l of b.lines)
    into.lines.push({
      ...l,
      points: l.points.map(([x, y]) => [x + dx, y + dy] as [number, number]),
      ...(l.answer
        ? {
            answer: {
              text: l.answer.text,
              at: [l.answer.at[0] + dx, l.answer.at[1] + dy] as [number, number],
            },
          }
        : {}),
    });
  for (const [x, y] of b.joins) into.joins.push([x + dx, y + dy]);
  into.l = Math.min(into.l, b.l + dx);
  into.r = Math.max(into.r, b.r + dx);
}

/** A pill's width round its words. */
const pillWidth = (text: string) => Math.min(320, textWidth(text, 12.5) + 58);

export function layoutChart(steps: Step[], defs: Defs, options: Options = {}): Chart {
  const words: Words = { ...plainWords, ...options.words };
  const factsOf = options.facts ?? (() => 0);
  const minorOf = options.minor ?? (() => false);
  void defs;

  /** A box's name: on one line, or on two when it is long. */
  const linesOf = (step: Step) => (textWidth(words.title(step), minorOf(step) ? 12.5 : 13.5) > BOX_W - 84 ? 2 : 1);

  const pill = (kind: PillKind, text: string, step?: Step): Block => {
    const w = pillWidth(text);
    const b = empty();
    b.shapes.push({
      kind: "pill",
      pill: kind,
      ...(step ? { step } : {}),
      x: -w / 2,
      y: 0,
      w,
      h: PILL_H,
    });
    b.l = -w / 2;
    b.r = w / 2;
    b.h = PILL_H;
    b.open = kind === "start" || kind === "caught";
    return b;
  };

  const box = (step: Step): Block => {
    const lines = linesOf(step);
    const facts = factsOf(step);
    const h = BOX_PAD * 2 + lines * LINE_H + (facts > 0 ? facts * FACT_H + FACT_PAD - 4 : 0);
    const b = empty();
    b.shapes.push({
      kind: "step",
      step,
      x: -BOX_W / 2,
      y: 0,
      w: BOX_W,
      h,
      lines,
      minor: minorOf(step),
    });
    b.l = -BOX_W / 2;
    b.r = BOX_W / 2;
    b.h = h;
    return b;
  };

  /** One after another down the line. */
  const seq = (list: Step[]): Block => {
    const out = empty();
    let y = 0;
    let first = true;
    let open = true;
    let label: string | undefined;
    for (const step of list) {
      if (step.disabled) continue;
      const b = one(step);
      if (!first) {
        // Nothing runs after a stop; what stands there is still drawn, without a way into it.
        if (open)
          out.lines.push({
            points: [[0, y], [0, y + GAP]],
            head: true,
            tone: "line",
            ...(label ? { answer: { text: label, at: [0, y + GAP / 2] } } : {}),
          });
        y += GAP;
      }
      put(out, b, 0, y);
      y += b.h;
      // Once the flow has stopped it stays stopped, whatever stands after.
      open = (first || open) && b.open;
      label = b.out;
      first = false;
    }
    out.h = y;
    out.open = open;
    if (label) out.out = label;
    return out;
  };

  /** A question, and the line parting under it into `ways`, side by side, meeting again under them. */
  const ask = (step: Step, ways: { answer: string; list: Step[] }[]): Block => {
    const out = empty();
    const w = Math.min(ASK_MAX, Math.max(BOX_W, textWidth(words.question(step), 13.5) + 64));
    out.shapes.push({ kind: "ask", step, x: -w / 2, y: 0, w, h: ASK_H });
    out.l = -w / 2;
    out.r = w / 2;
    // Each way: what is in it, or for an answer with nothing to do, just a line round (room for its name).
    const blocks = ways.map((way) => {
      const b = seq(way.list);
      if (b.h === 0) {
        const half = textWidth(way.answer, 11.5) / 2 + 14;
        b.l = -half;
        b.r = half;
      }
      return b;
    });
    // Side by side, the whole centred under the question.
    const xs: number[] = [];
    let at = 0;
    blocks.forEach((b, i) => {
      if (i > 0) at += SIDE_GAP;
      xs.push(at - b.l);
      at += b.r - b.l;
    });
    const shift = -at / 2;
    for (let i = 0; i < xs.length; i++) xs[i]! += shift;
    const part = ASK_H + PART;
    const top = part + INTO;
    const tallest = Math.max(0, ...blocks.map((b) => b.h));
    const meet = top + tallest + MEET;
    let open = false;
    const meeting: number[] = [];
    blocks.forEach((b, i) => {
      const x = xs[i]!;
      const way = ways[i]!;
      const into: [number, number][] =
        x === 0
          ? [[0, ASK_H], [0, top]]
          : [[0, ASK_H], [0, part], [x, part], [x, top]];
      if (b.h === 0) {
        // Nothing to do on this answer: the line goes straight on to where the ways meet.
        out.lines.push({
          points: [...into.slice(0, -1), [x, meet], ...(x === 0 ? [] : ([[0, meet]] as [number, number][]))],
          head: false,
          tone: "line",
          answer: { text: way.answer, at: [x, part + INTO / 2] },
        });
        open = true;
        meeting.push(x);
        return;
      }
      out.lines.push({
        points: into,
        head: true,
        tone: "line",
        answer: { text: way.answer, at: [x, part + INTO / 2] },
      });
      put(out, b, x, top);
      if (b.open) {
        open = true;
        meeting.push(x);
        const foot = top + b.h;
        out.lines.push({
          points:
            x === 0
              ? [[0, foot], [0, meet]]
              : [[x, foot], [x, meet], [0, meet]],
          head: false,
          tone: "line",
        });
      }
    });
    if (meeting.length > 1) out.joins.push([0, meet]);
    out.h = open ? meet : top + tallest;
    out.open = open;
    return out;
  };

  /** A question whose one answer only stops: that answer goes out to the right, the other on down the line. */
  const guard = (step: Step, leaves: string, stop: Step, stays: string, rest: Step[]): Block => {
    const out = empty();
    const w = Math.min(ASK_MAX, Math.max(BOX_W, textWidth(words.question(step), 13.5) + 64));
    out.shapes.push({ kind: "ask", step, x: -w / 2, y: 0, w, h: ASK_H });
    const text = words.stop(stop);
    const pw = pillWidth(text);
    const px = w / 2 + 56;
    out.shapes.push({
      kind: "pill",
      pill: stop.type === FAIL ? "fail" : "stop",
      step: stop,
      x: px,
      y: (ASK_H - PILL_H) / 2,
      w: pw,
      h: PILL_H,
    });
    out.lines.push({
      points: [[w / 2, ASK_H / 2], [px, ASK_H / 2]],
      head: true,
      tone: stop.type === FAIL ? "fail" : "line",
      answer: { text: leaves, at: [w / 2 + 28, ASK_H / 2] },
    });
    out.l = -w / 2;
    out.r = px + pw;
    const b = seq(rest);
    if (b.h === 0) {
      out.h = ASK_H;
      out.out = stays;
      return out;
    }
    out.lines.push({
      points: [[0, ASK_H], [0, ASK_H + GAP + 6]],
      head: true,
      tone: "line",
      answer: { text: stays, at: [0, ASK_H + (GAP + 6) / 2] },
    });
    put(out, b, 0, ASK_H + GAP + 6);
    out.h = ASK_H + GAP + 6 + b.h;
    out.open = b.open;
    if (b.out) out.out = b.out;
    return out;
  };

  /** A frame round `list`, its name at the top; a loop has an arrow going back up its left side. */
  const frame = (kind: FrameKind, step: Step, list: Step[]): Block => {
    const out = empty();
    const body = seq(list);
    const back = kind === "loop";
    const name = textWidth(words.frame(step, kind), 12.5) + 60;
    let l = Math.min(body.l, -BOX_W / 2) - (back ? BACK_X : FRAME_X);
    let r = Math.max(body.r, BOX_W / 2) + FRAME_X;
    if (r - l < name) {
      const more = (name - (r - l)) / 2;
      l -= more;
      r += more;
    }
    const top = HEAD_H + 16;
    let foot = top + body.h;
    if (body.h > 0) {
      out.lines.push({
        points: [[0, HEAD_H], [0, top]],
        head: true,
        tone: "line",
      });
      put(out, body, 0, top);
    }
    if (back && body.h > 0) {
      // Round again: from under the last step, up the left side, back in over the first.
      const under = foot + 12;
      const over = HEAD_H + 8;
      out.lines.push({
        points: [[0, foot], [0, under], [l + 14, under], [l + 14, over], [-10, over]],
        head: true,
        tone: "back",
      });
      foot = under;
    }
    const h = foot + FRAME_B;
    if (body.open && body.h > 0)
      out.lines.push({
        points: [[0, foot - (back ? 12 : 0)], [0, h]],
        head: false,
        tone: "line",
      });
    out.frames.unshift({ kind, step, x: l, y: 0, w: r - l, h });
    out.l = Math.min(out.l, l);
    out.r = Math.max(out.r, r);
    out.h = h;
    // A loop goes on when its rounds are done, whatever its last step does.
    out.open = back || body.open;
    return out;
  };

  /** What `step` covers, and to its right what runs when that fails. */
  const tried = (step: Step, body: Step[], caught: Step[]): Block => {
    const out = empty();
    const covered = frame("try", step, body);
    put(out, covered, 0, 0);
    const head = pill("caught", words.pill("caught"));
    const rest = seq(caught);
    const after = rest.h > 0 ? GAP : 0;
    const left = Math.min(head.l, rest.l);
    const x = covered.r + FAIL_GAP - left;
    put(out, head, x, 0);
    out.lines.push({
      points: [[covered.r, PILL_H / 2], [x + head.l, PILL_H / 2]],
      head: true,
      tone: "fail",
    });
    if (rest.h > 0) {
      out.lines.push({
        points: [[x, PILL_H], [x, PILL_H + after]],
        head: true,
        tone: "line",
      });
      put(out, rest, x, PILL_H + after);
    }
    const end = PILL_H + after + rest.h;
    if (rest.open) {
      // Handled: the flow goes on after the frame.
      const meet = Math.max(covered.h, end) + MEET;
      out.lines.push({
        points: [[x, end], [x, meet], [0, meet]],
        head: false,
        tone: "line",
      });
      out.lines.push({
        points: [[0, covered.h], [0, meet]],
        head: false,
        tone: "line",
      });
      out.joins.push([0, meet]);
      out.h = meet;
    } else {
      // What follows stands under both, so the way on runs down past what ran on failure.
      out.h = Math.max(covered.h, end);
      if (covered.open && covered.h < end)
        out.lines.push({
          points: [[0, covered.h], [0, end]],
          head: false,
          tone: "line",
        });
    }
    out.open = covered.open || rest.open;
    return out;
  };

  const parallel = (step: Step, branches: Step[]): Block => {
    const out = empty();
    const head = pill("stop", words.pill("together"));
    // The name over the bar, then the branches side by side.
    put(out, head, 0, 0);
    const blocks = branches.map((b) => seq([b]));
    const xs: number[] = [];
    let at = 0;
    blocks.forEach((b, i) => {
      if (i > 0) at += SIDE_GAP;
      xs.push(at - b.l);
      at += b.r - b.l;
    });
    for (let i = 0; i < xs.length; i++) xs[i]! -= at / 2;
    const barY = PILL_H + 14;
    const span = (list: number[]) => [Math.min(0, ...list) - 24, Math.max(0, ...list) + 24] as const;
    const [a, z] = span(xs);
    out.lines.push({
      points: [[0, PILL_H], [0, barY]],
      head: false,
      tone: "line",
    });
    out.shapes.push({ kind: "bar", step, x: a, y: barY, w: z - a, h: BAR_H });
    const top = barY + BAR_H + GAP;
    let tallest = 0;
    blocks.forEach((b, i) => {
      out.lines.push({
        points: [
          [xs[i]!, barY + BAR_H],
          [xs[i]!, top],
        ],
        head: true,
        tone: "line",
      });
      put(out, b, xs[i]!, top);
      tallest = Math.max(tallest, b.h);
    });
    const meet = top + tallest + MEET;
    blocks.forEach((b, i) => {
      if (b.open)
        out.lines.push({
          points: [
            [xs[i]!, top + b.h],
            [xs[i]!, meet],
          ],
          head: false,
          tone: "line",
        });
    });
    out.shapes.push({ kind: "bar", step, x: a, y: meet, w: z - a, h: BAR_H });
    out.l = Math.min(out.l, a);
    out.r = Math.max(out.r, z);
    out.h = meet + BAR_H;
    return out;
  };

  /** One step, as what it is. */
  const one = (step: Step): Block => {
    const blocks = step.blocks ?? {};
    if (step.type === IF) {
      const yes = live(blocks.then);
      const no = live(blocks.else);
      const only = (l: Step[]) => l.length === 1 && stops(l[0]);
      if (only(yes) && !only(no)) return guard(step, words.answer(step, "then"), yes[0]!, words.answer(step, "else"), no);
      if (only(no) && !only(yes)) return guard(step, words.answer(step, "else"), no[0]!, words.answer(step, "then"), yes);
      return ask(step, [
        { answer: words.answer(step, "then"), list: yes },
        { answer: words.answer(step, "else"), list: no },
      ]);
    }
    if (step.type === SWITCH) {
      const ways = live(blocks.cases)
        .filter((c) => c.type === CASE)
        .map((c) => ({
          answer: words.answer(step, "cases", c),
          list: blocksOf(c).flatMap(([, l]) => live(l)),
        }));
      ways.push({
        answer: words.answer(step, "default"),
        list: live(blocks.default),
      });
      return ask(step, ways);
    }
    if (step.type === TRY) {
      const caught = live(blocks.catch);
      const body = caught.length > 0 ? tried(step, live(blocks.try), caught) : seq(live(blocks.try));
      const last = live(blocks.finally);
      if (last.length === 0) return body;
      const out = empty();
      put(out, body, 0, 0);
      const end = frame("always", step, last);
      if (body.open)
        out.lines.push({
          points: [[0, body.h], [0, body.h + GAP]],
          head: true,
          tone: "line",
        });
      put(out, end, 0, body.h + GAP);
      out.h = body.h + GAP + end.h;
      out.open = end.open;
      return out;
    }
    if (step.type === PARALLEL) return parallel(step, live(blocks.branches));
    if (LOOP_TYPES.has(step.type) || step.type === WAIT_UNTIL)
      return frame(
        "loop",
        step,
        blocksOf(step).flatMap(([, l]) => live(l)),
      );
    const filled = blocksOf(step).filter(([, l]) => live(l).length > 0);
    if (filled.length > 0 || step.type === GROUP)
      return frame(
        "group",
        step,
        filled.flatMap(([, l]) => live(l)),
      );
    if (stops(step)) {
      const b = pill(step.type === FAIL ? "fail" : "stop", words.stop(step), step);
      b.open = false;
      return b;
    }
    return box(step);
  };

  // The flow cut into columns at its named groups, when it has two or more of them.
  const top = live(steps);
  const named = top.filter((s) => s.type === GROUP).length >= 2;
  const parts: Step[][] = [];
  for (const step of top) {
    const alone = named && step.type === GROUP;
    if (alone || parts.length === 0 || (named && parts.at(-1)!.at(-1)?.type === GROUP)) parts.push([step]);
    else parts.at(-1)!.push(step);
  }
  if (parts.length === 0) parts.push([]);

  const columns = parts.map((list, i) => {
    const out = empty();
    let y = 0;
    let open = true;
    let label: string | undefined;
    if (i === 0) {
      put(out, pill("start", words.pill("start")), 0, 0);
      y = PILL_H;
    }
    const body = seq(list);
    if (body.h > 0) {
      if (i === 0) {
        out.lines.push({
          points: [[0, y], [0, y + GAP]],
          head: true,
          tone: "line",
        });
        y += GAP;
      }
      put(out, body, 0, y);
      y += body.h;
      open = body.open;
      label = body.out;
    }
    if (i === parts.length - 1 && open) {
      out.lines.push({
        points: [[0, y], [0, y + GAP]],
        head: true,
        tone: "line",
        ...(label ? { answer: { text: label, at: [0, y + GAP / 2] } } : {}),
      });
      put(out, pill("end", words.pill("end")), 0, y + GAP);
      y += GAP + PILL_H;
    }
    out.h = y;
    out.open = open;
    if (label) out.out = label;
    return out;
  });

  const chart = empty();
  const lead = columns.length > 1 ? STAGE_TOP : 0;
  let at = 0;
  const xs: number[] = [];
  columns.forEach((c, i) => {
    if (i > 0) at += STAGE_GAP;
    xs.push(at - c.l);
    at += c.r - c.l;
  });
  columns.forEach((c, i) => {
    put(chart, c, xs[i]!, lead);
    const next = columns[i + 1];
    if (!next || !c.open) return;
    // On from the foot of this column, up the gap beside it, into the head of the next.
    const x = xs[i]!;
    const gap = x + c.r + STAGE_GAP / 2;
    const foot = lead + c.h;
    chart.lines.push({
      points: [
        [x, foot],
        [x, foot + 14],
        [gap, foot + 14],
        [gap, lead - 14],
        [xs[i + 1]!, lead - 14],
        [xs[i + 1]!, lead],
      ],
      head: true,
      tone: "line",
      ...(c.out ? { answer: { text: c.out, at: [x, foot + 7] } } : {}),
    });
  });
  const height = Math.max(0, ...columns.map((c) => lead + c.h + (c.open ? 14 : 0)));
  // Everything from x = 0.
  const dx = -chart.l;
  const result: Chart = {
    shapes: chart.shapes.map((s) => ({ ...s, x: s.x + dx })),
    frames: chart.frames.map((f) => ({ ...f, x: f.x + dx })),
    lines: chart.lines.map((l) => ({
      ...l,
      points: l.points.map(([x, y]) => [x + dx, y] as [number, number]),
      ...(l.answer
        ? {
            answer: {
              text: l.answer.text,
              at: [l.answer.at[0] + dx, l.answer.at[1]] as [number, number],
            },
          }
        : {}),
    })),
    joins: chart.joins.map(([x, y]) => [x + dx, y] as [number, number]),
    width: chart.r - chart.l,
    height,
    stages: columns.length,
  };
  return result;
}
