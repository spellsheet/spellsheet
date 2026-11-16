// The flow as a flowchart to take in at a glance (see flow/overview.ts for what
// it shows and why), drawn on the sheet's paper under its heading.
import type { Step } from "@spellsheet/schema";
import { Columns2, Flag, Play, Repeat, ShieldAlert } from "lucide-react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useStudio } from "../../context";
import { findStep } from "../../store";
import { menuFor } from "../../lib/contextMenu";
import { useStepMenu } from "../menus";
import type { RunState } from "../../store/run";
import { ASK_H, type AskNode, type BoxNode, type Mark, type Node, outline, PILL_H, type Placed, place, UNDER, type Words } from "../../flow/overview";
import { chartWords, guardOutcome } from "../../lib/keywords";
import { plain, sentence } from "../../lib/sentence";
import { FAIL } from "../../lib/stepTypes";
import type { StepTypeDef } from "@spellsheet/schema";

type Defs = ReadonlyMap<string, StepTypeDef>;

/** Round the chart: room for the lines going round from one row to the next. */
const M = 24;
/** From a question down to the stop under it. */
const DROP = 54;

/** What a step is called: the name it was given, else what it does in a sentence. */
const title = (step: Step, defs: Defs): string => (step.name ?? "").trim() || plain(sentence(step, defs.get(step.type)));

/**
 * What an if asks. A condition that is just a value, or not one ("!住所が自動入力された"),
 * is asked as that value ("住所が自動入力された？"), the right way round; else the step's name is.
 */
function question(step: Step, defs: Defs): { text: string; flipped: boolean } {
  const p = (step.params ?? {}) as Record<string, unknown>;
  const cond = String(p.condition ?? "").replace(/^\{\{\s*|\s*\}\}$/g, "").trim();
  const bare = /^(!?)\s*([^\s!&|()<>=+\-*/'",.]+)$/u.exec(cond);
  const ask = (text: string) => (/[　-鿿]/.test(text) ? `${text}？` : `${text}?`);
  if (bare) return { text: ask(bare[2]!), flipped: bare[1] === "!" };
  const said = (step.name ?? "").trim().replace(/[？?]$/, "");
  return { text: ask(said || cond || plain(sentence(step, defs.get(step.type)))), flipped: false };
}

/** An arrowhead at the end of a line, pointing the way it goes. */
function headAt(points: [number, number][]): string {
  const [x2, y2] = points.at(-1)!;
  const [x1, y1] = points.at(-2)!;
  const dx = Math.sign(x2 - x1);
  const dy = Math.sign(y2 - y1);
  const s = 5;
  const bx = x2 - dx * (s + 1);
  const by = y2 - dy * (s + 1);
  return `M ${bx - dy * s} ${by + dx * s} L ${x2} ${y2} L ${bx + dy * s} ${by - dx * s}`;
}

/** A line through its points, its corners rounded. */
function pathOf(points: [number, number][]): string {
  const r = 6;
  let d = `M ${points[0]![0]} ${points[0]![1]}`;
  for (let i = 1; i < points.length; i++) {
    const [x, y] = points[i]!;
    const next = points[i + 1];
    if (!next) {
      d += ` L ${x} ${y}`;
      break;
    }
    const [px, py] = points[i - 1]!;
    const k = Math.min(r, Math.abs(x - px) / 2 + Math.abs(y - py) / 2, Math.abs(next[0] - x) / 2 + Math.abs(next[1] - y) / 2);
    d += ` L ${x - Math.sign(x - px) * k} ${y - Math.sign(y - py) * k} Q ${x} ${y} ${x + Math.sign(next[0] - x) * k} ${y + Math.sign(next[1] - y) * k}`;
  }
  return d;
}

type Line = { points: [number, number][]; head: boolean; stop?: boolean };
type Label = { text: string; x: number; y: number; stop?: boolean; center?: boolean };

/** The lines between the nodes, and the answers said on them. */
function linesOf(placed: Placed[]): { lines: Line[]; labels: Label[] } {
  const lines: Line[] = [];
  const labels: Label[] = [];
  const rowEnd = (row: number) => Math.max(...placed.filter((p) => p.row === row).map((p) => p.x + p.w));
  placed.forEach((cur, i) => {
    const prev = placed[i - 1];
    if (prev && prev.node.kind !== "stop" && prev.node.kind !== "end") {
      const from: [number, number] = [prev.x + prev.w, prev.y];
      if (prev.row === cur.row) lines.push({ points: [from, [cur.x, cur.y]], head: true });
      else {
        // Round to the next row: right, down under the stops, back left, and in.
        const turn = prev.y + ASK_H / 2 + (prev.under ?? UNDER) + 18;
        const right = rowEnd(prev.row) + 18;
        lines.push({
          points: [from, [right, prev.y], [right, turn], [cur.x - 18, turn], [cur.x - 18, cur.y], [cur.x, cur.y]],
          head: true,
        });
      }
      if (prev.node.kind === "ask" && (prev.node.stop || prev.node.skip)) labels.push({ text: prev.node.go, x: prev.x + prev.w + 6, y: prev.y - 11 });
    }
    if (cur.node.kind === "box" && cur.node.caught) {
      const cx = cur.x + cur.w / 2;
      lines.push({ points: [[cx, cur.y + cur.h / 2], [cx, cur.y + ASK_H / 2 + DROP]], head: true, stop: true });
    }
    if (cur.node.kind !== "ask") return;
    const ask = cur.node;
    const cx = cur.x + cur.w / 2;
    if (ask.stop) {
      lines.push({ points: [[cx, cur.y + ASK_H / 2], [cx, cur.y + ASK_H / 2 + DROP]], head: true, stop: true });
      labels.push({ text: ask.stop.answer, x: cx + 7, y: cur.y + ASK_H / 2 + 14, stop: true });
    }
    if (ask.skip) {
      const top = cur.y - ASK_H / 2;
      const over = top - 22;
      const target = placed[i + ask.skip.over + 1];
      if (target && target.row === cur.row) {
        const tx = target.x + target.w / 2;
        lines.push({ points: [[cx, top], [cx, over], [tx, over], [tx, target.y - target.h / 2]], head: true });
        labels.push({ text: ask.skip.answer, x: (cx + tx) / 2, y: over - 10, center: true });
      } else {
        // What follows the skipped steps is on the next row: the skip joins the line going round to it.
        const right = rowEnd(cur.row) + 18;
        lines.push({ points: [[cx, top], [cx, over], [right, over], [right, cur.y]], head: false });
        labels.push({ text: ask.skip.answer, x: (cx + right) / 2, y: over - 10, center: true });
      }
    }
  });
  return { lines, labels };
}

/**
 * The chart under a sheet's heading when the sheet is read as a chart.
 * `numbers`: each step's number on the sheet, said under the boxes ("手順 6〜8").
 * `run`: the run that is going, or the last one: how far it got shows on the boxes.
 * `onOpen`: a box pressed is read on the sheet, at its first step.
 */
export function OverviewBody({ numbers, run, onOpen }: { numbers?: ReadonlyMap<string, number>; run?: RunState | null; onOpen?: () => void }) {
  const flow = useStudio((s) => s.flow);
  const stepTypes = useStudio((s) => s.stepTypes);
  const goTo = useStudio((s) => s.goTo);
  const setSelection = useStudio((s) => s.select);
  const stepMenu = useStepMenu();
  const defs: Defs = useMemo(() => new Map(stepTypes.map((d) => [d.type, d] as const)), [stepTypes]);
  const words = chartWords();

  // The rows are as wide as the paper.
  const box = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState(0);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const see = () => setRoom(el.clientWidth);
    see();
    const watch = new ResizeObserver(see);
    watch.observe(el);
    return () => watch.disconnect();
  }, []);

  const nodes: Node[] = useMemo(() => {
    const w: Words = {
      title: (s) => title(s, defs),
      question: (s) => question(s, defs),
      stop: (s) => (s.type === FAIL ? title(s, defs) : guardOutcome(s)),
      answer: (block) => (block === "then" ? words.yes : words.no),
      range: (steps) => {
        const at = steps.map((s) => numbers?.get(s.id ?? "")).filter((n): n is number => n !== undefined);
        return at.length > 0 ? words.stepRange(Math.min(...at), Math.max(...at)) : "";
      },
      how: (step, mark) => (mark === "loop" ? words.loopNote(step) : mark === "parallel" ? words.together : words.guarded),
      way: (step, block, steps) => {
        const first = title(steps[0]!, defs);
        const more = steps.length > 1 ? words.andMore : "";
        if (block === "catch") return words.whenFailed(`${first}${more}`);
        const answer = block === "then" ? words.yes : block === "else" || block === "default" ? (block === "default" ? words.other : words.no) : title(step, defs);
        return `${answer}：${first}${more}`;
      },
      note: (group) => (group?.retry?.maxAttempts && group.retry.maxAttempts > 1 ? words.triesShort(group.retry.maxAttempts) : ""),
    };
    return outline(flow?.steps ?? [], w);
    // `words` follow the language, which does not change while the chart is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flow, defs, numbers]);
  const width = Math.max(320, room - 80 - M * 2);
  const ov = useMemo(() => place(nodes, width), [nodes, width]);
  const { lines, labels } = useMemo(() => linesOf(ov.placed), [ov]);

  if (!flow) return null;
  const open = (step: Step) => {
    if (!step.id) return;
    goTo(step.id);
    onOpen?.();
  };
  const menu = (step: Step) =>
    menuFor(() => {
      const found = step.id ? findStep(flow.steps ?? [], step.id) : null;
      if (!found) return [];
      setSelection({ kind: "step", stepId: found.id! });
      return stepMenu(found, { owner: flow.id });
    });
  const stateOf = (steps: Step[]): "running" | "failed" | "done" | null => {
    if (!run) return null;
    const states = steps.map((s) => (s.id ? run.steps[s.id] : undefined));
    if (states.includes("running") || states.includes("paused")) return "running";
    if (states.includes("failed")) return "failed";
    return states.some((s) => s === "succeeded") ? "done" : null;
  };

  return (
    <div ref={box} className="flow-chart-body px-10 pb-10">
      <div className="relative mt-2" style={{ width: ov.width + M * 2, height: ov.height + M }}>
        <div className="absolute" style={{ left: M, top: 0, width: ov.width, height: ov.height }}>
          <svg className="pointer-events-none absolute inset-0 overflow-visible" width={ov.width} height={ov.height} aria-hidden="true">
            {lines.map((l, i) => (
              <g key={i} fill="none" stroke={l.stop ? "var(--color-shu-500)" : "var(--chart-main)"} strokeWidth={l.stop ? 1.5 : 2} strokeLinecap="round" strokeLinejoin="round">
                <path d={pathOf(l.points)} strokeDasharray={l.stop ? "5 4" : undefined} />
                {l.head && <path d={headAt(l.points)} />}
              </g>
            ))}
          </svg>
          {labels.map((l, i) => (
            <span
              key={i}
              style={{ left: l.x, top: l.y }}
              className={`absolute -translate-y-1/2 text-[11.5px] font-semibold whitespace-nowrap ${l.center ? "-translate-x-1/2" : ""} ${l.stop ? "text-shu-600" : "text-[var(--chart-main)]"}`}
            >
              {l.text}
            </span>
          ))}
          {ov.placed.map((p, i) => (
            <NodeView key={i} placed={p} state={p.node.kind === "box" ? stateOf(p.node.steps) : p.node.kind === "ask" ? stateOf([p.node.step]) : null} defs={defs} onOpen={open} onMenu={menu} />
          ))}
        </div>
      </div>
    </div>
  );
}

function NodeView({
  placed,
  state,
  defs,
  onOpen,
  onMenu,
}: {
  placed: Placed;
  state: "running" | "failed" | "done" | null;
  defs: Defs;
  onOpen: (step: Step) => void;
  onMenu: (step: Step) => (e: React.MouseEvent) => void;
}) {
  const words = chartWords();
  const { node, x, y, w, h } = placed;
  const at = { left: x, top: y - h / 2, width: w, height: h } as const;
  if (node.kind === "start" || node.kind === "end") {
    const Icon = node.kind === "start" ? Play : Flag;
    return (
      <span style={at} className="flow-chart-terminal absolute z-10 flex items-center justify-center gap-1.5 rounded-full text-[13px] font-semibold">
        <Icon size={13} strokeWidth={2} aria-hidden="true" />
        {node.kind === "start" ? words.start : words.end}
      </span>
    );
  }
  if (node.kind === "stop") return <StopPill why={node.why} step={node.step} style={at} onOpen={onOpen} />;
  if (node.kind === "ask") return <AskView node={node} placed={placed} state={state} onOpen={onOpen} onMenu={onMenu} />;
  if (node.kind !== "box") return null;
  const caughtW = node.caught ? Math.min(300, Math.max(150, [...node.caught.text].length * 12.5 + 40)) : 0;
  return (
    <>
      <BoxView node={node} at={at} state={state} defs={defs} onOpen={onOpen} onMenu={onMenu} />
      {node.caught && (
        <button
          type="button"
          title={node.caught.text}
          onClick={() => onOpen(node.caught!.step)}
          style={{ left: x + w / 2 - caughtW / 2, top: y + ASK_H / 2 + DROP, width: caughtW, height: PILL_H - 4 }}
          className="absolute z-10 truncate rounded-full border border-dashed border-shu-500 bg-sheet px-3 text-[12px] font-medium text-shu-600"
        >
          {node.caught.text}
        </button>
      )}
    </>
  );
}

const MARK_ICON: Record<Mark, typeof Repeat> = { loop: Repeat, try: ShieldAlert, parallel: Columns2 };
const MARK_EDGE: Record<Mark, string> = { loop: "flow-chart-box-loop", try: "flow-chart-box-try", parallel: "border-slate-400" };

function BoxView({
  node,
  at,
  state,
  defs,
  onOpen,
  onMenu,
}: {
  node: BoxNode;
  at: React.CSSProperties;
  state: "running" | "failed" | "done" | null;
  defs: Defs;
  onOpen: (step: Step) => void;
  onMenu: (step: Step) => (e: React.MouseEvent) => void;
}) {
  const words = chartWords();
  const edge = state === "failed" ? "border-shu-500 border-2" : state === "running" ? "border-primary border-2" : state === "done" ? "border-moegi-600" : node.mark ? MARK_EDGE[node.mark] : "border-slate-300";
  const MarkIcon = node.mark ? MARK_ICON[node.mark] : null;
  // Pointed at, a box lists its steps, as the sheet says them.
  const tip = node.steps.map((s) => title(s, defs)).join("\n");
  return (
    <button
      type="button"
      title={tip}
      style={at}
      onClick={() => onOpen(node.open)}
      onContextMenu={node.steps.length === 1 ? onMenu(node.open) : undefined}
      className={`flow-chart-node absolute z-10 flex flex-col items-center justify-center gap-1 rounded-[8px] border text-center ${node.mark ? "px-6" : "px-3"} ${edge}`}
    >
      {state === "running" || state === "failed" ? (
        <span className={`absolute -top-2.5 left-2 rounded-full px-1.5 text-[10.5px] leading-[18px] font-semibold text-white ${state === "running" ? "bg-primary" : "bg-shu-500"}`}>{state === "running" ? words.runningHere : words.failedHere}</span>
      ) : null}
      {MarkIcon && <MarkIcon size={14} strokeWidth={1.9} aria-hidden="true" className={`absolute top-1.5 left-1.5 ${node.mark === "try" ? "text-shu-500" : "text-[var(--chart-main)]"}`} />}
      <span className="line-clamp-2 text-[13.5px] leading-[18px] font-semibold text-ink">{node.title}</span>
      {node.sub && <span className="max-w-full truncate text-[11.5px] text-slate-500">{node.sub}</span>}
    </button>
  );
}

function AskView({
  node,
  placed,
  state,
  onOpen,
  onMenu,
}: {
  node: AskNode;
  placed: Placed;
  state: "running" | "failed" | "done" | null;
  onOpen: (step: Step) => void;
  onMenu: (step: Step) => (e: React.MouseEvent) => void;
}) {
  const { x, y, w, h } = placed;
  const stroke = state === "failed" ? "var(--color-shu-500)" : state === "running" ? "var(--color-primary)" : undefined;
  const stopW = node.stop ? Math.min(300, Math.max(150, [...node.stop.why].length * 12.5 + 70)) : 0;
  return (
    <>
      <button type="button" title={node.text} onClick={() => onOpen(node.step)} onContextMenu={onMenu(node.step)} style={{ left: x, top: y - h / 2, width: w, height: h }} className="flow-chart-ask group absolute z-10 flex items-center justify-center px-5 text-center">
        <svg className="absolute inset-0" width={w} height={h} aria-hidden="true">
          <polygon points={`${w / 2},1 ${w - 1},${h / 2} ${w / 2},${h - 1} 1,${h / 2}`} className="flow-chart-ask-shape" strokeWidth={state ? 2 : 1.25} style={stroke ? { stroke } : undefined} />
        </svg>
        <span className="relative line-clamp-3 text-[12px] leading-[15px] font-semibold text-ink">{node.text}</span>
      </button>
      {node.ways && (
        <span className="absolute z-10 flex flex-col gap-1 border-l-2 border-[var(--chart-ask-edge)] pl-2" style={{ left: x + w / 2 - 1, top: y + ASK_H / 2 + 8, maxWidth: 260 }}>
          {node.ways.slice(0, 3).map((way, i) => (
            <button key={i} type="button" title={way.text} onClick={() => onOpen(way.step)} className="truncate rounded-full border border-slate-300 bg-sheet px-2 text-left text-[11.5px] leading-[20px] text-slate-700 hover:border-slate-500">
              {way.text}
            </button>
          ))}
          {node.ways.length > 3 && <span className="px-2 text-[11px] text-slate-500">{chartWords().more(node.ways.length - 3)}</span>}
        </span>
      )}
      {node.stop && <StopPill why={node.stop.why} step={node.stop.step} style={{ left: x + w / 2 - stopW / 2, top: y + ASK_H / 2 + DROP, width: stopW, height: PILL_H - 4 }} onOpen={onOpen} />}
    </>
  );
}

function StopPill({ why, step, style, onOpen }: { why: string; step: Step; style: React.CSSProperties; onOpen: (step: Step) => void }) {
  const words = chartWords();
  const text = words.stopsWith(why);
  return (
    <button type="button" title={text} onClick={() => onOpen(step)} style={style} className="flow-chart-caught absolute z-10 truncate rounded-full border border-shu-500 px-3 text-[12px] font-semibold text-shu-600">
      {text}
    </button>
  );
}
