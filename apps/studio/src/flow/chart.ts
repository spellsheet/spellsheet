// The flow as a chart to look at, laid out from nothing but the flow itself.
//
// It is drawn as a railway map is drawn: the flow is a line from 開始 to 終了,
// each step a station on it, each part of the work (a chapter of the sheet) a
// stretch of the line in a colour of its own. It answers at a glance what the
// sheet's sentences cannot: how long the work is, where it parts and meets
// again, what repeats, where it can stop, and how far a run has got.
//
// - A step is a station, its name under it. A wait or a check the sheet gives
//   no number is a small one.
// - A question whose one answer only stops is a diamond on the line; that
//   answer goes down a short dashed spur to where the flow stops.
// - A question with something to do on an answer parts the line: the other
//   answers' steps run on a track of their own above, and come back down to the
//   line after; the answer with nothing to do (or the last, else) stays on it.
//   Branches that run at the same time part the same way, from a bar.
// - What repeats has a bracket over its stations with an arrow going back to its
//   start; a group, what is guarded against failure and what runs at the end
//   always have one too, with their names on it.
// - What runs when something fails goes down from the end of what it covers on
//   a dashed track under the line.
// - The line runs left to right and, when it is longer than a row, goes on in
//   the next row as text does, so the whole flow fits the screen.
//
// Pure geometry: what each station says is the component's (components/chart),
// which hands the words in only where their length decides a size.
import type { Step, StepTypeDef } from "@spellsheet/schema";
import { groupOf, isAppGroup } from "../lib/palette";
import {
  BREAK,
  CASE,
  CONTINUE,
  FAIL,
  GROUP,
  IF,
  LOOP_TYPES,
  PARALLEL,
  SWITCH,
  TRY,
} from "../lib/stepTypes";

export type Defs = ReadonlyMap<string, StepTypeDef>;

const WAIT_UNTIL = "wait.until";
const STOPS: ReadonlySet<string> = new Set([BREAK, CONTINUE, FAIL]);
const stops = (step: Step | undefined): boolean =>
  !!step && STOPS.has(step.type) && !step.disabled;
const live = (list: Step[] | undefined): Step[] =>
  (list ?? []).filter((s) => !s.disabled);
const blocksOf = (step: Step): [string, Step[]][] =>
  Object.entries(step.blocks ?? {});

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

/** A place in the flow: `index` in the block `block` of the step `parentId` (null, null: the flow's own steps). */
export type Slot = {
  parentId: string | null;
  block: string | null;
  index: number;
};

/** How far apart stations stand, and how wide a station's name may be under it. */
export const STATION_W = 136;
export const MINOR_W = 100;
export const LABEL_W = 124;
/** Where the first row's line starts (after 開始), and where every row's starts. */
export const ROW_X = 116;
/** The start and end. */
export const PILL_W = 80;
export const PILL_H = 30;
/** How high a track that parts from the line runs over it. */
export const SIDE_UP = 100;
/** How far a dashed spur runs down to where the flow stops. */
export const SPUR = 92;
/** How far the track of what runs on failure runs under the line. */
export const CATCH_DOWN = 104;
const RAMP = 48;
const ROW_GAP = 44;

export type StationKind = "step" | "minor" | "ask" | "bar";
export type Station = {
  kind: StationKind;
  step: Step;
  x: number;
  y: number;
  stage: number;
  /** Where its words stand: under it on the line, over it on a track above. */
  label: "below" | "above";
  /** A fork's diamond: its question is a note under it, the line's own words being its stations'. */
  quiet?: boolean;
};
/** Where the flow stops: a pill at the end of a dashed spur, or at the end of a track. */
export type Stop = {
  step: Step;
  x: number;
  y: number;
  w: number;
  fail: boolean;
};
export type TrackTone = "main" | "side" | "wrap" | "fail" | "spur";
export type Track = {
  points: [number, number][];
  stage: number;
  tone: TrackTone;
};
export type SpanKind = "loop" | "group" | "try" | "always";
/** A bracket over what belongs together; `from`/`to` false where it goes on from or to another row. */
export type Span = {
  step: Step;
  kind: SpanKind;
  x1: number;
  x2: number;
  y: number;
  stage: number;
  from: boolean;
  to: boolean;
};
/** A part's name over where its stretch of the line starts. */
export type Tag = { stage: number; x: number; y: number };
/** Words on the map that are not a station's: an answer on its line, a question under a fork. */
export type Note = {
  text: string;
  x: number;
  y: number;
  tone: "line" | "fail" | "ask";
  anchor: "start" | "middle" | "end";
  step?: Step;
};
export type Insert = { slot: Slot; x: number; y: number };

export type Route = {
  stations: Station[];
  stops: Stop[];
  tracks: Track[];
  spans: Span[];
  tags: Tag[];
  notes: Note[];
  inserts: Insert[];
  pills: { kind: "start" | "end"; x: number; y: number }[];
  width: number;
  height: number;
  rows: number;
};

/** What the map says where its length decides a size (components/chart gives the real words). */
export type Words = {
  title: (step: Step) => string;
  question: (step: Step) => string;
  frame: (step: Step, kind: SpanKind) => string;
  stop: (step: Step) => string;
  answer: (step: Step, block: string, child?: Step) => string;
  /** A part's name over its stretch of the line. */
  stage: (stage: number) => string;
};

export type Options = {
  /** How long a row may run before the line goes on in the next. */
  rowWidth?: number;
  /** Which part of the work (a chapter of the sheet) a step of the flow's own is in; -1 to draw no part names. */
  stageOf?: (step: Step) => number;
  /** Whether a step is drawn as a small station (a wait or check the sheet gives no number). */
  minor?: (step: Step) => boolean;
  words?: Partial<Words>;
};

const plainWords: Words = {
  title: (s) => (s.name ?? "").trim() || s.type,
  question: (s) => (s.name ?? "").trim() || s.type,
  frame: (s) => (s.name ?? "").trim() || s.type,
  stop: (s) => (s.name ?? "").trim() || s.type,
  answer: (_s, block, child) =>
    child ? (child.name ?? "").trim() || "case" : block,
  stage: (n) => String(n + 1),
};

/** What stands on the line, in order, before it is cut into rows. */
type Atom =
  | { k: "stage"; stage: number }
  | { k: "st"; step: Step; minor: boolean; after?: Slot }
  | {
      k: "ask";
      step: Step;
      stop?: { step: Step; answer: string };
      stays?: string;
    }
  | {
      k: "fork";
      step: Step;
      bar: boolean;
      main: Atom[];
      mainAnswer?: string;
      ways: { answer: string; atoms: Atom[] }[];
    }
  | { k: "catch"; step: Step; atoms: Atom[]; open: boolean }
  | { k: "term"; step: Step }
  | { k: "s0"; step: Step; kind: SpanKind }
  | { k: "s1"; step: Step; kind: SpanKind }
  | { k: "hole"; slot: Slot };

const stopW = (text: string) => Math.min(280, textWidth(text, 12.5) + 48);

export function layoutRoute(
  steps: Step[],
  defs: Defs,
  options: Options = {},
): Route {
  const words: Words = { ...plainWords, ...options.words };
  const minorOf = options.minor ?? (() => false);
  const stageOf = options.stageOf ?? (() => -1);
  const rowWidth = Math.max(STATION_W * 3, options.rowWidth ?? 1500);
  void defs;

  // Where each step stands, for the places before and after it.
  const where = new Map<Step, Slot>();
  const place = (list: Step[], parentId: string | null, block: string | null) =>
    list.forEach((step, index) => {
      where.set(step, { parentId, block, index });
      for (const [name, inner] of blocksOf(step))
        place(inner, step.id ?? null, name);
    });
  place(steps, null, null);
  const after = (step: Step): Slot | undefined => {
    const at = where.get(step);
    return at && { ...at, index: at.index + 1 };
  };
  const inside = (step: Step): Slot | undefined => {
    const [first] = blocksOf(step);
    return first && step.id
      ? { parentId: step.id, block: first[0], index: 0 }
      : undefined;
  };

  /** The steps of a list as atoms on the line. `top`: the flow's own steps (a group there is a part, not a bracket). */
  const atoms = (list: Step[], top = false): Atom[] => {
    const out: Atom[] = [];
    let stage = -2;
    for (const step of list) {
      if (step.disabled) continue;
      if (top) {
        const s = stageOf(step);
        if (s >= 0 && s !== stage) out.push({ k: "stage", stage: s });
        if (s >= 0) stage = s;
      }
      out.push(...one(step, top));
    }
    return out;
  };
  const one = (step: Step, top: boolean): Atom[] => {
    const blocks = step.blocks ?? {};
    if (step.type === IF) {
      const yes = live(blocks.then);
      const no = live(blocks.else);
      const only = (l: Step[]) => l.length === 1 && stops(l[0]);
      if (only(yes) && !only(no))
        return [
          {
            k: "ask",
            step,
            stop: { step: yes[0]!, answer: words.answer(step, "then") },
            stays: words.answer(step, "else"),
          },
          ...atoms(no),
        ];
      if (only(no) && !only(yes))
        return [
          {
            k: "ask",
            step,
            stop: { step: no[0]!, answer: words.answer(step, "else") },
            stays: words.answer(step, "then"),
          },
          ...atoms(yes),
        ];
      if (yes.length === 0 && no.length === 0) return [{ k: "ask", step }];
      // The answer with nothing to do (else the second) stays on the line, unless it stops and the other goes on.
      const [first, second] =
        no.length === 0 || yes.length > 0
          ? ([
              [no, "else"],
              [yes, "then"],
            ] as const)
          : ([
              [yes, "then"],
              [no, "else"],
            ] as const);
      const [[stay, stayBlock], [part, partBlock]] =
        ends(atoms(first[0])) && !ends(atoms(second[0]))
          ? [second, first]
          : [first, second];
      return [
        {
          k: "fork",
          step,
          bar: false,
          main: atoms(stay),
          mainAnswer: words.answer(step, stayBlock),
          ways: [{ answer: words.answer(step, partBlock), atoms: atoms(part) }],
        },
      ];
    }
    if (step.type === SWITCH) {
      const cases = live(blocks.cases).filter((c) => c.type === CASE);
      const ways = cases.map((c) => ({
        answer: words.answer(step, "cases", c),
        atoms: atoms(blocksOf(c).flatMap(([, l]) => live(l))),
      }));
      return [
        {
          k: "fork",
          step,
          bar: false,
          main: atoms(live(blocks.default)),
          mainAnswer: words.answer(step, "default"),
          ways,
        },
      ];
    }
    if (step.type === PARALLEL) {
      const [first, ...rest] = live(blocks.branches);
      return [
        {
          k: "fork",
          step,
          bar: true,
          main: first ? atoms([first]) : [],
          ways: rest.map((b) => ({ answer: "", atoms: atoms([b]) })),
        },
      ];
    }
    if (step.type === TRY) {
      const body = live(blocks.try);
      const caught = live(blocks.catch);
      const last = live(blocks.finally);
      const out: Atom[] =
        caught.length > 0
          ? [
              { k: "s0", step, kind: "try" },
              ...atoms(body),
              { k: "s1", step, kind: "try" },
              {
                k: "catch",
                step,
                atoms: atoms(caught),
                open: !caught.some((s) => s.type === FAIL),
              },
            ]
          : atoms(body);
      if (last.length > 0)
        out.push({ k: "s0", step, kind: "always" }, ...atoms(last), {
          k: "s1",
          step,
          kind: "always",
        });
      return out;
    }
    const loop = LOOP_TYPES.has(step.type) || step.type === WAIT_UNTIL;
    const filled = blocksOf(step).filter(([, l]) => live(l).length > 0);
    if (loop || filled.length > 0 || step.type === GROUP) {
      const kind: SpanKind = loop ? "loop" : "group";
      const body = atoms(filled.flatMap(([, l]) => live(l)));
      const hole: Atom[] =
        body.length === 0 && inside(step)
          ? [{ k: "hole", slot: inside(step)! }]
          : [];
      // A part of the work named on the line needs no bracket, unless it is tried again.
      if (
        kind === "group" &&
        top &&
        stageOf(step) >= 0 &&
        !((step.retry?.maxAttempts ?? 0) > 1)
      )
        return [...body, ...hole];
      return [
        { k: "s0", step, kind },
        ...body,
        ...hole,
        { k: "s1", step, kind },
      ];
    }
    if (stops(step)) return [{ k: "term", step }];
    return [
      {
        k: "st",
        step,
        minor: minorOf(step),
        ...(after(step) ? { after: after(step)! } : {}),
      },
    ];
  };

  /** Whether a run of atoms stops the flow at its end (nothing after it is reached). */
  const ends = (list: Atom[]): boolean => {
    const last = list.filter((b) => b.k !== "stage" && b.k !== "s1").at(-1);
    if (!last) return false;
    if (last.k === "term") return true;
    if (last.k === "fork")
      return (
        !last.bar &&
        ends(last.main) &&
        last.ways.length > 0 &&
        last.ways.every((w) => ends(w.atoms))
      );
    return false;
  };
  /** How far over a fork's line each way's track runs: past what the track under it reaches up and what it hangs down. */
  const lift = (a: Extract<Atom, { k: "fork" }>): number[] => {
    let reach = Math.max(0, ...a.main.map(up));
    return a.ways.map((w) => {
      const at =
        reach + Math.max(SIDE_UP, Math.max(0, ...w.atoms.map(down)) + 64);
      reach = at + Math.max(0, ...w.atoms.map(up));
      return at;
    });
  };
  /** How far under its line a catch track runs: past what climbs from it. */
  const sink = (a: Extract<Atom, { k: "catch" }>): number =>
    Math.max(CATCH_DOWN, Math.max(0, ...a.atoms.map(up)) + 64);

  /** How far an atom runs along the line. */
  const width = (a: Atom): number => {
    switch (a.k) {
      case "st":
        return a.minor ? MINOR_W : STATION_W;
      case "ask":
        return a.stop
          ? Math.max(STATION_W, stopW(words.stop(a.stop.step)) + 16)
          : STATION_W;
      case "term":
        return Math.max(STATION_W, stopW(words.stop(a.step)) + 16);
      case "hole":
        return 64;
      case "fork": {
        const main = a.main.reduce((n, x) => n + width(x), 0);
        const side = Math.max(
          0,
          ...a.ways.map(
            (w) =>
              w.atoms.reduce((n, x) => n + width(x), 0) +
              (w.atoms.length === 0 ? 60 : 0),
          ),
        );
        return 120 + Math.max(main + 20, side + RAMP * 2 - 60);
      }
      case "catch":
        return Math.max(
          80,
          a.atoms.reduce((n, x) => n + width(x), 0) + RAMP * 2,
        );
      default:
        return 0;
    }
  };
  /** How high over the line an atom reaches (tracks that part from it), and how far under (spurs and failure tracks). */
  function up(a: Atom): number {
    if (a.k === "fork") {
      const at = lift(a);
      if (at.length === 0) return Math.max(0, ...a.main.map(up)) + SIDE_UP;
      return at.at(-1)! + Math.max(0, ...a.ways.at(-1)!.atoms.map(up));
    }
    return 0;
  }
  function down(a: Atom): number {
    if ((a.k === "ask" && a.stop) || a.k === "term") return SPUR + PILL_H;
    if (a.k === "catch")
      return sink(a) + Math.max(56, Math.max(0, ...a.atoms.map(down)));
    if (a.k === "fork") return Math.max(0, ...a.main.map(down));
    return 0;
  }

  const line = atoms(steps, true);
  const stagesUsed = line.filter((a) => a.k === "stage").length;

  // Cut into rows, as text is cut into lines. A fork is never cut; what repeats is moved whole to the next row when it fits there.
  const rows: Atom[][] = [[]];
  let x = ROW_X;
  let tagEnd = -Infinity;
  for (let i = 0; i < line.length; i++) {
    const a = line[i]!;
    let need = width(a);
    if (a.k === "s0") {
      let depth = 0;
      need = 0;
      for (let j = i; j < line.length; j++) {
        const b = line[j]!;
        if (b.k === "s0") depth++;
        if (b.k === "s1" && --depth === 0) break;
        need += width(b);
      }
      if (need > rowWidth - ROW_X) need = 0;
    }
    if (a.k === "stage" && stagesUsed > 1) {
      // A part's name needs room over the line before the next part's name.
      const own = textWidth(words.stage(a.stage), 13) + 48;
      x = Math.max(x, tagEnd);
      tagEnd = x + own;
      need = STATION_W;
    }
    if (x + need > rowWidth && rows.at(-1)!.length > 0 && a.k !== "s1") {
      // A part's name left at the end of a row goes on with its part.
      const prev = rows.at(-1)!;
      const name =
        prev.at(-1)?.k === "stage" && prev.length > 1 ? prev.pop()! : null;
      rows.push(name ? [name] : []);
      x = ROW_X;
      const named = a.k === "stage" ? a : name;
      tagEnd =
        named?.k === "stage"
          ? ROW_X + textWidth(words.stage(named.stage), 13) + 48
          : -Infinity;
    }
    rows.at(-1)!.push(a);
    if (a.k !== "stage") x += width(a);
  }

  // How high each row reaches over and under its line.
  const spanDepth = (list: Atom[]): number => {
    let d = 0;
    let most = 0;
    const walk = (l: Atom[]) => {
      for (const a of l) {
        if (a.k === "s0") most = Math.max(most, ++d);
        if (a.k === "s1") d = Math.max(0, d - 1);
        if (a.k === "fork") {
          walk(a.main);
          for (const w of a.ways) walk(w.atoms);
        }
      }
    };
    walk(list);
    return most;
  };
  const out: Route = {
    stations: [],
    stops: [],
    tracks: [],
    spans: [],
    tags: [],
    notes: [],
    inserts: [],
    pills: [],
    width: 0,
    height: 0,
    rows: rows.length,
  };
  const metrics = rows.map((row, r) => {
    const fork = Math.max(0, ...row.map(up));
    const ask = row.some((a) => a.k === "ask" && a.stop) ? 56 : 0;
    const spans =
      spanDepth(row) + (r > 0 && openSpans(rows.slice(0, r)) > 0 ? 1 : 0);
    const tag = stagesUsed > 1 && row.some((a) => a.k === "stage") ? 30 : 0;
    const over =
      Math.max(40, fork + (fork > 0 ? 84 : 0), ask) + spans * 22 + tag + 8;
    const under = Math.max(
      52,
      ...row.map(down).map((d) => (d > 0 ? d + 20 : 0)),
    );
    return { over, under, spans };
  });
  function openSpans(before: Atom[][]): number {
    let d = 0;
    for (const row of before)
      for (const a of row) d += a.k === "s0" ? 1 : a.k === "s1" ? -1 : 0;
    return Math.max(0, d);
  }

  // Lay each row out from the left.
  let stage = 0;
  let run: [number, number][] = [];
  let runStage = 0;
  const endRun = () => {
    if (run.length > 1)
      out.tracks.push({ points: run, stage: runStage, tone: "main" });
    run = [];
  };
  const toStage = (s: number, px: number, py: number) => {
    if (s === stage && run.length > 0) return;
    if (run.length > 0) {
      run.push([px, py]);
      endRun();
    }
    stage = s;
    runStage = s;
    run = [[px, py]];
  };
  const open: {
    step: Step;
    kind: SpanKind;
    x: number;
    level: number;
    stage: number;
    row: number;
  }[] = [];
  let level = 0;
  let lastStop: number | undefined;
  let top = 0;
  let maxX = 0;
  const rowY: number[] = [];
  rows.forEach((row, r) => {
    const m = metrics[r]!;
    const y = top + m.over;
    rowY.push(y);
    const spanTop =
      y -
      m.over +
      (stagesUsed > 1 && row.some((a) => a.k === "stage") ? 30 : 0) +
      12;
    const spanY = (lv: number) => spanTop + (m.spans - lv) * 22;
    let x = ROW_X;
    let tagFrom = -Infinity;
    if (r === 0) {
      out.pills.push({ kind: "start", x: 0, y: y - PILL_H / 2 });
      run = [[PILL_W, y]];
      runStage = stage;
      if (steps.length > 0)
        out.inserts.push({
          slot: { parentId: null, block: null, index: 0 },
          x: (PILL_W + ROW_X) / 2 + 4,
          y,
        });
    } else {
      // Brackets still open from the row before go on over this one.
      for (const o of open) o.x = ROW_X - 30;
      run = [[ROW_X - 30, y]];
      runStage = stage;
    }
    const lay = (
      list: Atom[],
      ly: number,
      onLine: boolean,
      side: "below" | "above",
    ) => {
      for (const a of list) {
        switch (a.k) {
          case "stage": {
            if (onLine) toStage(a.stage, x, ly);
            if (stagesUsed > 1) {
              // A part's name never runs into the one before it on the row.
              const tx = Math.max(x, tagFrom);
              out.tags.push({ stage: a.stage, x: tx, y: y - m.over + 4 });
              tagFrom = tx + textWidth(words.stage(a.stage), 13) + 48;
            }
            break;
          }
          case "st": {
            const w = width(a);
            const cx = x + w / 2;
            out.stations.push({
              kind: a.minor ? "minor" : "step",
              step: a.step,
              x: cx,
              y: ly,
              stage,
              label: side,
            });
            if (onLine && a.after)
              out.inserts.push({ slot: a.after, x: x + w, y: ly });
            x += w;
            break;
          }
          case "ask": {
            const w = width(a);
            const cx = x + w / 2;
            out.stations.push({
              kind: "ask",
              step: a.step,
              x: cx,
              y: ly,
              stage,
              label: a.stop ? "above" : side,
            });
            if (a.stop) {
              const text = words.stop(a.stop.step);
              const sw = stopW(text);
              out.tracks.push({
                points: [
                  [cx, ly + 12],
                  [cx, ly + SPUR],
                ],
                stage,
                tone: "spur",
              });
              out.stops.push({
                step: a.stop.step,
                x: cx - sw / 2,
                y: ly + SPUR,
                w: sw,
                fail: a.stop.step.type === FAIL,
              });
              out.notes.push({
                text: a.stop.answer,
                x: cx + 8,
                y: ly + 34,
                tone: "fail",
                anchor: "start",
              });
              if (a.stays)
                out.notes.push({
                  text: a.stays,
                  x: cx + 22,
                  y: ly - 7,
                  tone: "line",
                  anchor: "start",
                });
            }
            x += w;
            break;
          }
          case "term": {
            const w = width(a);
            const cx = x + w / 2;
            const sw = stopW(words.stop(a.step));
            if (onLine) {
              lastStop = cx;
              out.tracks.push({
                points: [
                  [cx, ly],
                  [cx, ly + SPUR],
                ],
                stage,
                tone: "spur",
              });
              out.stops.push({
                step: a.step,
                x: cx - sw / 2,
                y: ly + SPUR,
                w: sw,
                fail: a.step.type === FAIL,
              });
            } else
              out.stops.push({
                step: a.step,
                x: cx - sw / 2,
                y: ly - PILL_H / 2,
                w: sw,
                fail: a.step.type === FAIL,
              });
            x += w;
            break;
          }
          case "hole": {
            out.inserts.push({ slot: a.slot, x: x + 32, y: ly });
            x += 64;
            break;
          }
          case "s0": {
            open.push({
              step: a.step,
              kind: a.kind,
              x: x + 14,
              level: level++,
              stage,
              row: r,
            });
            break;
          }
          case "s1": {
            const o = open.pop();
            level = Math.max(0, level - 1);
            if (!o) break;
            out.spans.push({
              step: o.step,
              kind: o.kind,
              x1: o.x,
              x2: x - 14,
              y: spanY(o.level),
              stage: o.stage,
              from: o.row === r,
              to: true,
            });
            break;
          }
          case "fork": {
            const w = width(a);
            const x0 = x;
            out.stations.push({
              kind: a.bar ? "bar" : "ask",
              step: a.step,
              x: x0 + 18,
              y: ly,
              stage,
              label: "below",
              quiet: true,
            });
            out.notes.push({
              // Over the line, left of the diamond: the side track climbs away to the right.
              // (At the head of a row nothing stands under it, and the row's turn is on the left: under it.)
              text: a.bar ? words.title(a.step) : words.question(a.step),
              ...(x0 - ROW_X < 24 || side === "above"
                ? { x: x0 + 18, y: ly + 30, anchor: "middle" as const }
                : { x: x0 + 4, y: ly - 12, anchor: "end" as const }),
              tone: "ask",
              step: a.step,
            });
            const lifts = lift(a);
            a.ways.forEach((way, i) => {
              const ty = ly - lifts[i]!;
              const len =
                way.atoms.reduce((n, b) => n + width(b), 0) +
                (way.atoms.length === 0 ? 60 : 0);
              const sx = x0 + 18;
              const ex = x0 + w - 12;
              const track = {
                points: [
                  [sx, ly],
                  [sx + RAMP, ty],
                  [ex - RAMP, ty],
                  [ex, ly],
                ] as [number, number][],
                stage,
                tone: "side" as const,
              };
              out.tracks.push(track);
              if (way.answer)
                out.notes.push({
                  text: way.answer,
                  x: sx + RAMP / 2 + 10,
                  y: (ly + ty) / 2,
                  tone: "line",
                  anchor: "start",
                });
              const save = x;
              x = sx + RAMP + Math.max(0, (ex - sx - RAMP * 2 - len) / 2);
              const stopsBefore = out.stops.length;
              lay(way.atoms, ty, false, "above");
              // A way that stops does not come back to the line: its track ends at the stop.
              const stop = out.stops.slice(stopsBefore).at(-1);
              if (ends(way.atoms) && stop && stop.y < ty)
                track.points = [
                  [sx, ly],
                  [sx + RAMP, ty],
                  [Math.max(sx + RAMP, stop.x + 6), ty],
                ];
              x = save;
            });
            if (a.mainAnswer && a.ways.length > 0)
              out.notes.push({
                text: a.mainAnswer,
                x: x0 + 40,
                y: ly - 8,
                tone: "line",
                anchor: "start",
              });
            const mainLen = a.main.reduce((n, b) => n + width(b), 0);
            x = x0 + 100 + Math.max(0, (w - 120 - mainLen) / 2);
            lay(a.main, ly, onLine, side);
            x = x0 + w;
            break;
          }
          case "catch": {
            const w = width(a);
            const ty = ly + sink(a);
            const sx = x;
            const ex = x + w;
            const points: [number, number][] = [
              [sx - 14, ly],
              [sx + RAMP - 14, ty],
            ];
            const save = x;
            x = sx + RAMP;
            const before = out.stations.length;
            lay(a.atoms, ty, false, "below");
            for (const s of out.stations.slice(before)) s.label = "below";
            x = save;
            if (a.open) points.push([ex - RAMP, ty], [ex, ly]);
            else points.push([Math.max(sx + RAMP, ex - RAMP), ty]);
            out.tracks.push({ points, stage, tone: "fail" });
            x += w;
            break;
          }
        }
      }
    };
    lay(row, y, true, "below");
    // Brackets left open at the end of the row: drawn to its end, and on in the next.
    for (const o of open)
      out.spans.push({
        step: o.step,
        kind: o.kind,
        x1: o.x,
        x2: x + 6,
        y: spanY(o.level),
        stage: o.stage,
        from: o.row === r,
        to: false,
      });
    maxX = Math.max(maxX, x);
    if (r < rows.length - 1) {
      // On to the next row: out to the right, down under this row, back to the left, into the next.
      run.push([x + 8, y]);
      endRun();
      const next = top + m.over + m.under + ROW_GAP + metrics[r + 1]!.over;
      const mid = y + m.under + ROW_GAP / 2;
      out.tracks.push({
        points: [
          [x + 8, y],
          [x + 28, y],
          [x + 28, mid],
          [ROW_X - 50, mid],
          [ROW_X - 50, next],
          [ROW_X - 30, next],
        ],
        stage,
        tone: "wrap",
      });
    } else {
      // A flow whose last step stops has no end to reach.
      if (ends(line)) {
        run.push([lastStop ?? x - STATION_W / 2, y]);
        endRun();
      } else {
        run.push([x + 24, y]);
        endRun();
        out.pills.push({ kind: "end", x: x + 24, y: y - PILL_H / 2 });
        maxX = Math.max(maxX, x + 24 + PILL_W);
      }
    }
    top += m.over + m.under + ROW_GAP;
  });
  out.width = Math.max(maxX, ...out.stops.map((s) => s.x + s.w)) + 8;
  out.height = top - ROW_GAP;
  void rowY;
  return out;
}
