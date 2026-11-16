// The flow as a chart to look at (see flow/chart.ts for what it shows and why).
// It is drawn on the sheet's paper (components/sheet/SheetView.tsx): a box for
// each step with its app's icon, a pointed box for each question with the line
// parting under it, frames round what repeats and what belongs together, and
// arrows between them all.
import type { Step } from "@spellsheet/schema";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  AppWindow,
  CircleX,
  Columns2,
  FileInput,
  FileOutput,
  Flag,
  Globe,
  KeyRound,
  LogOut,
  Maximize2,
  Minus,
  MousePointerClick,
  Play,
  Plus,
  Repeat,
  RotateCw,
  ShieldAlert,
  StepForward,
  Timer,
  TriangleAlert,
  Layers,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useStudio } from "../../context";
import type { RunState } from "../../store/run";
import { type Chart, type Defs, FACT_H, type Frame, HEAD_H, type Line, LINE_H, BOX_PAD, layoutChart, appOf, type Shape, type Words } from "../../flow/chart";
import { chartWords, guardOutcome } from "../../lib/keywords";
import { type Fact, systemFacts } from "../../lib/systemFacts";
import { groupIcon, nodeIcon } from "../../lib/nodeIcons";
import { groupLabel, groupOf } from "../../lib/palette";
import { plain, sentence } from "../../lib/sentence";
import { BREAK, CONTINUE, FAIL } from "../../lib/stepTypes";
import { CATEGORY_COLOR } from "../CommandPalette";

/** The paper's margin round the chart. */
const PAD = 40;
const ZOOM_MIN = 0.4;
const ZOOM_MAX = 1.5;
const ZOOM_KEY = "spellsheet.chartZoom";

/** What a step is called on the chart: the name it was given, else what it does in a sentence. */
const title = (step: Step, defs: Defs): string => (step.name ?? "").trim() || plain(sentence(step, defs.get(step.type)));

/** What an if or a switch asks: its name as a question, else its condition. */
function question(step: Step, defs: Defs): string {
  const said = (step.name ?? "").trim().replace(/[？?]$/, "");
  const p = (step.params ?? {}) as Record<string, unknown>;
  const cond = String(p.condition ?? p.value ?? "").replace(/^\{\{\s*|\s*\}\}$/g, "");
  const text = said || cond || plain(sentence(step, defs.get(step.type)));
  return /[　-鿿]/.test(text) ? `${text}？` : `${text}?`;
}

const FACT_ICON: Record<Fact["kind"], LucideIcon> = {
  connect: Globe,
  launch: AppWindow,
  target: MousePointerClick,
  read: FileInput,
  write: FileOutput,
  secret: KeyRound,
  wait: Timer,
  retry: RotateCw,
  take: ArrowDownToLine,
  give: ArrowUpFromLine,
};

/** One thing the system does at a step: what kind, then the value, on a quiet line under the step's name. */
function FactLine({ fact, numbers }: { fact: Fact; numbers?: ReadonlyMap<string, number> }) {
  const words = chartWords();
  const Icon = FACT_ICON[fact.kind];
  const at = (ids: string[]) => [...new Set(ids.map((id) => numbers?.get(id)).filter((n): n is number => n !== undefined))].sort((a, b) => a - b).join("・");
  const value = ((): string => {
    switch (fact.kind) {
      case "connect":
        return fact.host;
      case "launch":
        return fact.path;
      case "target":
        return fact.words;
      case "read":
      case "write":
        return fact.path;
      case "secret":
        return fact.name;
      case "wait":
        return words.upTo(fact.seconds);
      case "retry":
        return words.attempts(fact.attempts);
      case "take": {
        const from = fact.from === null ? words.atStart : at([fact.from]) && words.fromStep(at([fact.from]));
        return from ? `${fact.variable}（${from}）` : fact.variable;
      }
      case "give": {
        const to = [at(fact.to) && words.toSteps(at(fact.to)), fact.out && words.flowOutput].filter(Boolean).join("、");
        return to ? `${fact.variable}（${to}）` : fact.variable;
      }
    }
  })();
  return (
    <span className="flex items-center gap-1 text-[11.5px] leading-none text-slate-500" style={{ height: FACT_H }} title={`${words.facts[fact.kind]} ${value}`}>
      <Icon size={11} strokeWidth={1.75} aria-hidden="true" className="shrink-0 text-slate-400" />
      <span className="shrink-0 text-slate-400">{words.facts[fact.kind]}</span>
      <span className="truncate">{value}</span>
    </span>
  );
}

/** What a set of steps works on: the sites and files they name. */
function targets(steps: Step[]): string[] {
  const found: string[] = [];
  for (const step of steps) {
    const p = (step.params ?? {}) as Record<string, unknown>;
    const win = (p.target as Record<string, unknown> | undefined)?.window as Record<string, unknown> | undefined;
    for (const value of [p.url, p.path, win?.process]) {
      if (typeof value !== "string" || value.includes("{{")) continue;
      const name = /^https?:\/\//.test(value) ? value.replace(/^https?:\/\//, "").split("/")[0]! : value.split(/[\\/]/).at(-1)!;
      if (name && !found.includes(name)) found.push(name);
    }
  }
  return found;
}

/** Every step of the flow that runs, inner ones too. */
function allSteps(list: Step[], into: Step[] = []): Step[] {
  for (const step of list) {
    if (step.disabled) continue;
    into.push(step);
    for (const inner of Object.values(step.blocks ?? {})) allSteps(inner, into);
  }
  return into;
}

const color = (group: string) => CATEGORY_COLOR[group] ?? CATEGORY_COLOR.other!;

/** The arrow's head at the end of a line, pointing the way its last piece runs. */
function headAt(points: [number, number][]): string {
  const [x2, y2] = points.at(-1)!;
  const [x1, y1] = points.at(-2)!;
  const dx = Math.sign(x2 - x1);
  const dy = Math.sign(y2 - y1);
  const s = 5;
  // Back along the line, and out to each side.
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
    const into = Math.min(r, Math.abs(x - px) / 2 + Math.abs(y - py) / 2);
    const out = Math.min(r, Math.abs(next[0] - x) / 2 + Math.abs(next[1] - y) / 2);
    const k = Math.min(into, out);
    const ax = x - Math.sign(x - px) * k;
    const ay = y - Math.sign(y - py) * k;
    const bx = x + Math.sign(next[0] - x) * k;
    const by = y + Math.sign(next[1] - y) * k;
    d += ` L ${ax} ${ay} Q ${x} ${y} ${bx} ${by}`;
  }
  return d;
}

const TONE: Record<Line["tone"], { stroke: string; dash?: string; width: number }> = {
  line: { stroke: "var(--chart-line)", width: 1.5 },
  fail: { stroke: "var(--color-shu-500)", dash: "4 4", width: 1.5 },
  back: { stroke: "var(--chart-back)", width: 1.75 },
};

/**
 * The chart itself, as wide and as high as it is: what lies under a sheet's
 * heading when the sheet is read as a chart.
 * `numbers`: each step's number on the sheet, so a box here and a line there are found from one another.
 * `run`: the run that is going, or the last one: how far it got is said on the boxes.
 * `onOpen`: a box pressed is read on the sheet, where its settings open under its line.
 */
export function ChartBody({ numbers, run, onOpen }: { numbers?: ReadonlyMap<string, number>; run?: RunState | null; onOpen?: () => void }) {
  const flow = useStudio((s) => s.flow);
  const stepTypes = useStudio((s) => s.stepTypes);
  const selection = useStudio((s) => s.selection);
  const goTo = useStudio((s) => s.goTo);
  const defs: Defs = useMemo(() => new Map(stepTypes.map((d) => [d.type, d] as const)), [stepTypes]);
  // What the system does at each step, said in its box.
  const facts = useMemo(() => (flow ? systemFacts(flow, defs) : new Map<string, Fact[]>()), [flow, defs]);
  const words = chartWords();
  const chart: Chart = useMemo(() => {
    const w: Words = {
      title: (s) => title(s, defs),
      question: (s) => question(s, defs),
      frame: (s, kind) => `${frameName(s, kind, defs)}  ${frameNote(s, kind)}`,
      stop: (s) => (s.type === FAIL ? title(s, defs) : guardOutcome(s)),
      answer: (_s, block, child) => (child ? title(child, defs) : block === "then" ? words.yes : block === "else" ? words.no : words.other),
      pill: (k) => (k === "start" ? words.start : k === "end" ? words.end : k === "caught" ? words.failed : words.together()),
    };
    return layoutChart(flow?.steps ?? [], defs, {
      facts: (s) => facts.get(s.id ?? "")?.length ?? 0,
      // A step on an app the sheet gives no number is a wait or a check said in place: quieter here too.
      minor: (s) => !!numbers && !numbers.has(s.id ?? "") && !s.blocks && appOf(s, defs) !== null,
      words: w,
    });
    // `words` follow the language, which does not change while the chart is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flow, defs, facts, numbers]);

  // How big the chart is drawn: fitted to the desk at first, then as the person sets it.
  const box = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState<number | null>(() => {
    try {
      const saved = Number(localStorage.getItem(ZOOM_KEY));
      return saved >= ZOOM_MIN && saved <= ZOOM_MAX ? saved : null;
    } catch {
      return null;
    }
  });
  const [room, setRoom] = useState(0);
  useLayoutEffect(() => {
    const desk = box.current?.closest(".flow-chart");
    if (!desk) return;
    const see = () => setRoom(desk.clientWidth);
    see();
    const watch = new ResizeObserver(see);
    watch.observe(desk);
    return () => watch.disconnect();
  }, []);
  const width = chart.width + PAD * 2;
  const height = chart.height + PAD * 2;
  // The paper's own margins and the desk's round it.
  const fitted = room > 0 ? Math.max(ZOOM_MIN, Math.min(1, (room - 40 - 80 - 4) / width)) : 1;
  const scale = zoom ?? fitted;
  const set = (z: number | null) => {
    const next = z === null ? null : Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z)) * 20) / 20;
    setZoom(next);
    try {
      if (next === null) localStorage.removeItem(ZOOM_KEY);
      else localStorage.setItem(ZOOM_KEY, String(next));
    } catch {
      // Not remembered: it still works this time.
    }
  };
  // Ctrl with the wheel zooms, as in Office.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      set(scale * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  });

  if (!flow) return null;
  const picked = selection?.kind === "step" ? selection.stepId : null;
  const select = (id: string | undefined) => {
    if (!id) return;
    goTo(id);
    onOpen?.();
  };

  // The apps the flow works on, and what on them: a key over the chart.
  const apps = new Map<string, Step[]>();
  for (const step of allSteps(flow.steps ?? [])) {
    const app = appOf(step, defs);
    if (app) apps.set(app, [...(apps.get(app) ?? []), step]);
  }

  return (
    <div ref={box} className="flow-chart-body px-10 pb-10">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-slate-200 pb-3">
        {[...apps].map(([app, steps]) => {
          const Icon = groupIcon(app);
          const names = targets(steps);
          return (
            <span key={app} className="flex min-w-0 items-center gap-2">
              <Tile icon={Icon} group={app} />
              <span className="text-[13px] font-semibold whitespace-nowrap text-ink">{groupLabel(app)}</span>
              {names.length > 0 && (
                <span className="max-w-[320px] truncate font-mono text-[11px] text-slate-500">
                  {names.slice(0, 2).join(" · ")}
                  {names.length > 2 ? ` ${words.more(names.length - 2)}` : ""}
                </span>
              )}
            </span>
          );
        })}
        <span className="ml-auto flex items-center rounded-[6px] border border-slate-200 bg-sheet text-[12px] text-slate-600">
          <button
            type="button"
            title={words.zoomOut}
            aria-label={words.zoomOut}
            disabled={scale <= ZOOM_MIN}
            onClick={() => set(scale / 1.15)}
            className="flex size-7 items-center justify-center hover:text-ink disabled:opacity-40"
          >
            <Minus size={14} strokeWidth={1.75} aria-hidden="true" />
          </button>
          <button type="button" title={words.actual} onClick={() => set(1)} className="w-12 border-x border-slate-200 py-1 text-center tabular-nums hover:text-ink">
            {Math.round(scale * 100)}%
          </button>
          <button
            type="button"
            title={words.zoomIn}
            aria-label={words.zoomIn}
            disabled={scale >= ZOOM_MAX}
            onClick={() => set(scale * 1.15)}
            className="flex size-7 items-center justify-center hover:text-ink disabled:opacity-40"
          >
            <Plus size={14} strokeWidth={1.75} aria-hidden="true" />
          </button>
          <button type="button" title={words.fit} onClick={() => set(null)} className={`flex h-7 items-center gap-1 border-l border-slate-200 px-2 hover:text-ink ${zoom === null ? "text-ink" : ""}`}>
            <Maximize2 size={13} strokeWidth={1.75} aria-hidden="true" />
            {words.fit}
          </button>
        </span>
      </div>

      {/* Wider than the paper, the chart scrolls sideways under the paper's heading, which stays where it is. */}
      <div className="mt-2 overflow-x-auto">
        <div className="relative" style={{ width: width * scale, height: height * scale }}>
          <div className="absolute top-0 left-0 origin-top-left" style={{ width, height, transform: `scale(${scale})` }}>
            <div
              className="absolute"
              style={{
                left: PAD,
                top: PAD,
                width: chart.width,
                height: chart.height,
              }}
            >
              {chart.frames.map((f, i) => (
                <FrameView key={i} frame={f} defs={defs} picked={picked} onPick={select} />
              ))}
              <svg className="pointer-events-none absolute inset-0 overflow-visible" width={chart.width} height={chart.height} aria-hidden="true">
                {chart.lines.map((l, i) => {
                  const tone = TONE[l.tone];
                  return (
                    <g key={i} fill="none" stroke={tone.stroke} strokeWidth={tone.width} strokeLinecap="round" strokeLinejoin="round">
                      <path d={pathOf(l.points)} strokeDasharray={tone.dash} />
                      {l.head && <path d={headAt(l.points)} />}
                    </g>
                  );
                })}
                {chart.joins.map(([x, y], i) => (
                  <circle key={i} cx={x} cy={y} r={3.5} fill="var(--chart-line)" />
                ))}
              </svg>
              {chart.lines.map((l, i) =>
                l.answer ? (
                  <span
                    key={i}
                    style={{ left: l.answer.at[0], top: l.answer.at[1] }}
                    className={`absolute z-20 -translate-x-1/2 -translate-y-1/2 rounded-full border bg-sheet px-2 text-[11.5px] leading-[18px] font-medium whitespace-nowrap ${l.tone === "fail" ? "border-shu-500/50 text-shu-600" : "border-slate-300 text-slate-600"}`}
                  >
                    {l.answer.text}
                  </span>
                ) : null,
              )}
              {chart.shapes.map((s, i) => (
                <ShapeView
                  key={i}
                  shape={s}
                  defs={defs}
                  picked={picked}
                  number={s.kind === "step" && numbers ? (numbers.get(s.step.id ?? "") ?? null) : undefined}
                  facts={s.kind === "step" ? facts.get(s.step.id ?? "") : undefined}
                  numbers={numbers}
                  state={s.kind === "step" || s.kind === "ask" ? (s.step.id ? run?.steps[s.step.id] : undefined) : undefined}
                  onPick={select}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** A frame's name: the name it was given, else what it is. */
function frameName(step: Step, kind: Frame["kind"], defs: Defs): string {
  const words = chartWords();
  if (kind === "always") return words.always;
  const name = (step.name ?? "").trim();
  if (kind === "try") return name || words.guarded;
  return name || title(step, defs);
}

/** What is said beside a frame's name: how a loop goes round, how often a group is tried. */
function frameNote(step: Step, kind: Frame["kind"]): string {
  const words = chartWords();
  if (kind === "loop") return words.loopNote(step);
  const tries = kind === "group" ? step.retry?.maxAttempts : undefined;
  return tries && tries > 1 ? words.tries(tries) : "";
}

/** An app's or a step's icon on a tint of its colour. */
function Tile({ icon: Icon, group, size = 22 }: { icon: LucideIcon; group: string; size?: number }) {
  const c = color(group);
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-[5px]"
      style={{
        width: size,
        height: size,
        color: c,
        background: `color-mix(in srgb, ${c} 14%, transparent)`,
      }}
    >
      <Icon size={Math.round(size * 0.6)} strokeWidth={1.9} aria-hidden={true} />
    </span>
  );
}

const FRAME_ICON: Record<Frame["kind"], LucideIcon> = {
  loop: Repeat,
  group: Layers,
  try: ShieldAlert,
  always: Flag,
};

function FrameView({ frame, defs, picked, onPick }: { frame: Frame; defs: Defs; picked: string | null; onPick: (id: string | undefined) => void }) {
  const { kind, step } = frame;
  const Icon = FRAME_ICON[kind];
  const tries = kind === "group" ? step.retry?.maxAttempts : undefined;
  const note = frameNote(step, kind);
  const on = picked !== null && picked === step.id;
  return (
    <div className={`flow-chart-frame flow-chart-frame-${kind} absolute rounded-[10px]`} style={{ left: frame.x, top: frame.y, width: frame.w, height: frame.h }}>
      <button
        type="button"
        title={plain(sentence(step, defs.get(step.type)))}
        onClick={() => onPick(step.id)}
        className="flow-chart-frame-head flex w-full items-center gap-2 rounded-t-[10px] px-3 text-left"
        style={{ height: HEAD_H }}
      >
        <Icon size={14} strokeWidth={1.9} aria-hidden="true" className="flow-chart-frame-icon shrink-0" />
        <span className={`truncate text-[12.5px] font-semibold text-ink ${on ? "flow-chart-on" : ""}`}>{frameName(step, kind, defs)}</span>
        {note && (
          <span className="flex shrink-0 items-center gap-1 text-[11.5px] text-slate-500">
            {tries && tries > 1 && <RotateCw size={11} strokeWidth={1.9} aria-hidden="true" />}
            {note}
          </span>
        )}
      </button>
    </div>
  );
}

const STOP_ICON: Record<string, LucideIcon> = {
  [CONTINUE]: StepForward,
  [BREAK]: LogOut,
  [FAIL]: CircleX,
};

function ShapeView({
  shape,
  defs,
  picked,
  number,
  facts,
  numbers,
  state,
  onPick,
}: {
  shape: Shape;
  defs: Defs;
  picked: string | null;
  /** The step's number on the sheet; null where the sheet gives it none. */
  number?: number | null;
  facts?: Fact[];
  numbers?: ReadonlyMap<string, number>;
  state?: string;
  onPick: (id: string | undefined) => void;
}) {
  const words = chartWords();
  const at = {
    left: shape.x,
    top: shape.y,
    width: shape.w,
    height: shape.h,
  } as const;
  const edge = state === "failed" ? "border-shu-500" : state === "succeeded" ? "border-moegi-600" : state === "running" ? "border-primary" : "";

  if (shape.kind === "bar") return <span className="absolute rounded-full bg-slate-500" style={at} />;

  if (shape.kind === "pill") {
    const { pill, step } = shape;
    const fail = pill === "fail" || pill === "caught";
    const Icon = pill === "start" ? Play : pill === "end" ? Flag : pill === "caught" ? TriangleAlert : step ? (STOP_ICON[step.type] ?? Columns2) : Columns2;
    const text =
      pill === "start" ? words.start : pill === "end" ? words.end : pill === "caught" ? words.failed : step ? (step.type === FAIL ? title(step, defs) : guardOutcome(step)) : words.together();
    const look =
      pill === "start" || pill === "end"
        ? "flow-chart-terminal border-transparent font-semibold"
        : fail
          ? `border-shu-500 text-shu-600 ${pill === "caught" ? "flow-chart-caught font-semibold" : "bg-sheet"}`
          : "border-slate-300 bg-sheet text-slate-600";
    const Tag = step ? "button" : "span";
    return (
      <Tag
        {...(step
          ? {
              type: "button" as const,
              onClick: () => onPick(step.id),
              title: plain(sentence(step, defs.get(step.type))),
            }
          : {})}
        style={at}
        className={`absolute z-10 flex items-center justify-center gap-1.5 rounded-full border px-3 text-[12.5px] whitespace-nowrap ${look}`}
      >
        <Icon size={13} strokeWidth={1.9} aria-hidden="true" className="shrink-0" />
        <span className="truncate">{text}</span>
      </Tag>
    );
  }

  const { step } = shape;
  const on = (picked !== null && picked === step.id) || state === "running" ? "flow-chart-on" : "";
  const tip = plain(sentence(step, defs.get(step.type)));

  if (shape.kind === "ask") {
    const w = shape.w;
    const h = shape.h;
    const tip2 = 16;
    return (
      <button type="button" title={tip} onClick={() => onPick(step.id)} style={at} className="flow-chart-ask group absolute z-10 flex items-center justify-center px-6 text-center">
        {/* A question: a box pointed at both ends. */}
        <svg className="absolute inset-0 overflow-visible" width={w} height={h} aria-hidden="true">
          <polygon
            points={`${tip2},0 ${w - tip2},0 ${w},${h / 2} ${w - tip2},${h} ${tip2},${h} 0,${h / 2}`}
            className="flow-chart-ask-shape"
            strokeWidth={state === "failed" || state === "succeeded" ? 1.75 : 1.25}
            stroke={state === "failed" ? "var(--color-shu-500)" : state === "succeeded" ? "var(--color-moegi-600)" : undefined}
            strokeLinejoin="round"
          />
        </svg>
        <span className={`relative line-clamp-2 text-[13px] leading-[17px] font-medium text-ink ${on}`}>{question(step, defs)}</span>
      </button>
    );
  }

  // A step's box: its app's icon, its number on the sheet, its name, and what the system does there.
  const def = defs.get(step.type);
  const group = def ? groupOf(def) : "other";
  const Icon = nodeIcon(step.type, group);
  const minor = shape.minor;
  return (
    <button
      type="button"
      title={tip}
      onClick={() => onPick(step.id)}
      style={at}
      className={`flow-chart-node absolute z-10 block rounded-[8px] border text-left ${edge || "border-slate-300"} ${minor ? "flow-chart-node-minor" : ""}`}
    >
      <span
        className="flex items-start gap-2 px-2.5"
        style={{
          paddingTop: BOX_PAD - 2,
          minHeight: shape.lines * LINE_H + BOX_PAD,
        }}
      >
        <Tile icon={Icon} group={group} size={minor ? 20 : 22} />
        {number != null && <span className="mt-[2px] min-w-[14px] shrink-0 text-[11.5px] text-slate-400 tabular-nums">{number}</span>}
        <span className={`mt-[1px] line-clamp-2 leading-[19px] ${minor ? "text-[12.5px] text-slate-600" : "text-[13.5px] font-medium text-ink"}`}>
          <span className={on}>{title(step, defs)}</span>
        </span>
      </span>
      {facts && facts.length > 0 && (
        <span className="block px-2.5 pt-0.5 pl-[42px]">
          {facts.map((fact, i) => (
            <FactLine key={i} fact={fact} numbers={numbers} />
          ))}
        </span>
      )}
    </button>
  );
}
