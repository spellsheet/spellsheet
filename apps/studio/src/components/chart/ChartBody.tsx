// The flow as a chart to look at (see flow/chart.ts for what it shows and why),
// drawn as a railway map: a station for each step, a stretch of the line in its
// own colour for each part of the work, tracks that part from the line and come
// back for what is done only on one answer, dashed spurs down to where the flow
// stops, and brackets over what repeats.
//
// It fills the desk as a map one moves about on: dragged with the pointer,
// scrolled with the wheel, zoomed with Ctrl and the wheel or the bar at the foot.
// What the flow is stands on a card at the top left, the whole map in small at
// the bottom right.
import type { Step } from "@spellsheet/schema";
import {
  CircleX,
  Flag,
  LogOut,
  Map as MapIcon,
  Maximize2,
  Minus,
  Play,
  Plus,
  Repeat,
  RotateCw,
  ShieldAlert,
  Sparkles,
  StepForward,
  Layers,
  type LucideIcon,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useStudio } from "../../context";
import { findStep, isActive } from "../../store";
import { menuFor } from "../../lib/contextMenu";
import { useFlowBusy } from "../../lib/useFlowBusy";
import { useStepMenu } from "../menus";
import type { RunState } from "../../store/run";
import {
  type Defs,
  type Route,
  type Span,
  type SpanKind,
  type Station,
  LABEL_W,
  PILL_H,
  PILL_W,
  appOf,
  layoutRoute,
  type Words,
} from "../../flow/chart";
import { chartWords, guardOutcome } from "../../lib/keywords";
import { groupIcon, nodeIcon } from "../../lib/nodeIcons";
import { groupLabel, groupOf } from "../../lib/palette";
import { plain, sentence } from "../../lib/sentence";
import { BREAK, CONTINUE, FAIL } from "../../lib/stepTypes";
import { CATEGORY_COLOR } from "../CommandPalette";

/** Round the map, so nothing is drawn against the desk's edge. */
const PAD = 48;
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 2;
/** The room the card at the top and the bar at the foot take from the desk when the map is fitted. */
const TOP_ROOM = 104;
const FOOT_ROOM = 72;
const MAP_W = 188;
const MAP_H = 116;
/** The rows tried when the map is fitted: the one that shows it largest is taken. */
const ROW_WIDTHS = [900, 1100, 1300, 1500, 1750, 2000, 2300, 2700, 3200];
const STAGES = 6;

/** What a step is called on the map: the name it was given, else what it does in a sentence. */
const title = (step: Step, defs: Defs): string =>
  (step.name ?? "").trim() || plain(sentence(step, defs.get(step.type)));

/** What an if or a switch asks: its name as a question, else its condition. */
function question(step: Step, defs: Defs): string {
  const said = (step.name ?? "").trim().replace(/[？?]$/, "");
  const p = (step.params ?? {}) as Record<string, unknown>;
  const cond = String(p.condition ?? p.value ?? "").replace(
    /^\{\{\s*|\s*\}\}$/g,
    "",
  );
  const text = said || cond || plain(sentence(step, defs.get(step.type)));
  return /[　-鿿]/.test(text) ? `${text}？` : `${text}?`;
}

/** What a set of steps works on: the sites and files they name. */
function targets(steps: Step[]): string[] {
  const found: string[] = [];
  for (const step of steps) {
    const p = (step.params ?? {}) as Record<string, unknown>;
    const win = (p.target as Record<string, unknown> | undefined)?.window as
      | Record<string, unknown>
      | undefined;
    for (const value of [p.url, p.path, win?.process]) {
      if (typeof value !== "string" || value.includes("{{")) continue;
      const name = /^https?:\/\//.test(value)
        ? value.replace(/^https?:\/\//, "").split("/")[0]!
        : value.split(/[\\/]/).at(-1)!;
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
/** A part's colour on the line. */
const stageColor = (stage: number) =>
  `var(--route-${(Math.max(0, stage) % STAGES) + 1})`;

/** A line through its points, its corners rounded. */
function pathOf(points: [number, number][], r = 14): string {
  let d = `M ${points[0]![0]} ${points[0]![1]}`;
  for (let i = 1; i < points.length; i++) {
    const [x, y] = points[i]!;
    const next = points[i + 1];
    if (!next) {
      d += ` L ${x} ${y}`;
      break;
    }
    const [px, py] = points[i - 1]!;
    const lin = Math.hypot(x - px, y - py);
    const lout = Math.hypot(next[0] - x, next[1] - y);
    const k = Math.min(r, lin / 2, lout / 2);
    const ax = x - ((x - px) / lin) * k;
    const ay = y - ((y - py) / lin) * k;
    const bx = x + ((next[0] - x) / lout) * k;
    const by = y + ((next[1] - y) / lout) * k;
    d += ` L ${ax} ${ay} Q ${x} ${y} ${bx} ${by}`;
  }
  return d;
}

const SPAN_ICON: Record<SpanKind, LucideIcon> = {
  loop: Repeat,
  group: Layers,
  try: ShieldAlert,
  always: Flag,
};
const STOP_ICON: Record<string, LucideIcon> = {
  [CONTINUE]: StepForward,
  [BREAK]: LogOut,
  [FAIL]: CircleX,
};

type View = { x: number; y: number; k: number };
type Menu = (
  id: string | undefined,
) => ((e: React.MouseEvent) => void) | undefined;

/**
 * The map, filling the desk it is put in.
 * `numbers`: each step's number on the sheet, so a station here and a line there are found from one another.
 * `stages`: the parts of the work as the sheet has them (its chapters): which part each of the flow's own steps is in, and their names.
 * `run`: the run that is going, or the last one: how far it got is said on the stations.
 * `plate`: what the flow is, on the card at the top left.
 * `onOpen`: a station pressed is read on the sheet, where its settings open under its line.
 */
export function ChartBody({
  numbers,
  stages,
  run,
  plate,
  onOpen,
}: {
  numbers?: ReadonlyMap<string, number>;
  stages?: { of: ReadonlyMap<string, number>; titles: string[] };
  run?: RunState | null;
  plate?: React.ReactNode;
  onOpen?: () => void;
}) {
  const flow = useStudio((s) => s.flow);
  const stepTypes = useStudio((s) => s.stepTypes);
  const selection = useStudio((s) => s.selection);
  const goTo = useStudio((s) => s.goTo);
  const setSelection = useStudio((s) => s.select);
  const setPaletteOpen = useStudio((s) => s.setPaletteOpen);
  const follow = useStudio((s) => s.followRun);
  const stepMenu = useStepMenu();
  // Steps are put on the map only while nothing else is changing the flow.
  const running = useStudio((s) => isActive(s.run));
  const aiBusy = useFlowBusy();
  const editable = !running && !aiBusy;
  const defs: Defs = useMemo(
    () => new Map(stepTypes.map((d) => [d.type, d] as const)),
    [stepTypes],
  );
  const words = chartWords();

  // The desk's size: the map is fitted to it.
  const desk = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = desk.current;
    if (!el) return;
    const see = () => setRoom({ w: el.clientWidth, h: el.clientHeight });
    see();
    const watch = new ResizeObserver(see);
    watch.observe(el);
    return () => watch.disconnect();
  }, []);

  const steps = flow?.steps ?? [];
  const many = (stages?.titles.length ?? 0) > 1;
  const layout = useCallback(
    (rowWidth: number): Route => {
      const w: Partial<Words> = {
        title: (s) => title(s, defs),
        question: (s) => question(s, defs),
        frame: (s, kind) => spanName(s, kind, defs),
        stop: (s) => (s.type === FAIL ? title(s, defs) : guardOutcome(s)),
        answer: (_s, block, child) =>
          child
            ? title(child, defs)
            : block === "then"
              ? words.yes
              : block === "else"
                ? words.no
                : words.other,
        stage: (n) => stages?.titles[n] ?? "",
      };
      return layoutRoute(steps, defs, {
        rowWidth,
        stageOf: (s) => (many ? (stages?.of.get(s.id ?? "") ?? -1) : -1),
        // A step the sheet gives no number (a wait, a check, a value kept) is a small station.
        minor: (s) => !!numbers && !numbers.has(s.id ?? "") && !s.blocks,
        words: w,
      });
    },
    // `words` follow the language, which does not change while the map is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [steps, defs, numbers, stages, many],
  );
  // The row length that shows the whole map largest on this desk.
  const fitOf = (r: Route) =>
    Math.min(
      (room.w - 40) / (r.width + PAD * 2),
      (room.h - TOP_ROOM - FOOT_ROOM) / (r.height + PAD * 2),
    );
  const route: Route = useMemo(() => {
    if (room.w === 0) return layout(1500);
    let best: { r: Route; k: number } | null = null;
    for (const w of ROW_WIDTHS) {
      const r = layout(w);
      const k = fitOf(r);
      if (!best || k > best.k + 0.005) best = { r, k };
      if (r.rows === 1) break;
    }
    return best!.r;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, room.w, room.h]);
  const W = route.width + PAD * 2;
  const H = route.height + PAD * 2;

  // Where the map is and how big: fitted at first and whenever the desk or the flow's shape changes, then as the person moves it.
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 });
  const [moved, setMoved] = useState(false);
  const fitted = useCallback((): View => {
    const k = Math.max(ZOOM_MIN, Math.min(1.15, fitOf(route)));
    return {
      k,
      x: (room.w - W * k) / 2,
      y: TOP_ROOM + Math.max(0, (room.h - TOP_ROOM - FOOT_ROOM - H * k) / 2),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route, room.w, room.h]);
  useLayoutEffect(() => {
    if (!moved && room.w > 0) setView(fitted());
  }, [fitted, moved, room.w]);
  const zoomAt = (f: number, cx = room.w / 2, cy = room.h / 2) => {
    setMoved(true);
    setView((v) => {
      const k = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, v.k * f));
      const r = k / v.k;
      return { k, x: cx - (cx - v.x) * r, y: cy - (cy - v.y) * r };
    });
  };
  // The wheel scrolls the map; Ctrl with it zooms, as in Office.
  useEffect(() => {
    const el = desk.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const box = el.getBoundingClientRect();
        zoomAt(
          Math.exp(-e.deltaY * 0.002),
          e.clientX - box.left,
          e.clientY - box.top,
        );
        return;
      }
      setMoved(true);
      setView((v) => ({
        ...v,
        x: v.x - (e.shiftKey ? e.deltaY : e.deltaX),
        y: v.y - (e.shiftKey ? 0 : e.deltaY),
      }));
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  });
  // Dragged with the pointer on the desk (not on a station).
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(
    null,
  );
  const [dragging, setDragging] = useState(false);
  const onDown = (e: React.PointerEvent) => {
    if (
      e.button !== 0 ||
      (e.target as HTMLElement).closest("button,[data-float]")
    )
      return;
    drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
    setDragging(true);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    setMoved(true);
    setView((v) => ({
      ...v,
      x: d.vx + e.clientX - d.x,
      y: d.vy + e.clientY - d.y,
    }));
  };
  const onUp = () => {
    drag.current = null;
    setDragging(false);
  };

  // The station a run is on is kept in sight while the run is followed.
  const at =
    run && isActive(run)
      ? [...run.starts]
          .reverse()
          .find(
            (x) =>
              run.steps[x.stepId] === "running" ||
              run.steps[x.stepId] === "paused",
          )?.stepId
      : undefined;
  useEffect(() => {
    if (!at || !follow) return;
    const s = route.stations.find((x) => x.step.id === at);
    if (!s) return;
    setView((v) => {
      const sx = v.x + (s.x + PAD) * v.k;
      const sy = v.y + (s.y + PAD) * v.k;
      if (
        sx > 60 &&
        sx < room.w - 60 &&
        sy > TOP_ROOM &&
        sy < room.h - FOOT_ROOM
      )
        return v;
      return {
        ...v,
        x: room.w / 2 - (s.x + PAD) * v.k,
        y: room.h / 2 - (s.y + PAD) * v.k,
      };
    });
  }, [at, follow, route, room.w, room.h]);

  const [showMap, setShowMap] = useState(true);

  if (!flow) return null;
  const picked = selection?.kind === "step" ? selection.stepId : null;
  const select = (id: string | undefined) => {
    if (!id) return;
    goTo(id);
    onOpen?.();
  };
  // Right-click on a station: the same menu as on the sheet.
  const menu: Menu = (id) =>
    id
      ? menuFor(() => {
          const step = findStep(flow.steps ?? [], id);
          if (!step) return [];
          setSelection({ kind: "step", stepId: id });
          return stepMenu(step, { owner: flow.id });
        })
      : undefined;

  // The apps the flow works on, and what on them: on the card, with the app's mark beside each station's name when there are more than one.
  const apps = new Map<string, Step[]>();
  for (const step of allSteps(steps)) {
    const app = appOf(step, defs);
    if (app) apps.set(app, [...(apps.get(app) ?? []), step]);
  }
  const empty = steps.filter((s) => !s.disabled).length === 0;
  // Counted as the sheet counts: the numbered steps.
  const counted = numbers?.size ?? 0;
  const done =
    run && numbers
      ? [...numbers.keys()].filter((id) => run.steps[id] === "succeeded").length
      : 0;
  const atStep = at ? findStep(steps, at) : null;

  return (
    <div
      ref={desk}
      className={`route-desk absolute inset-0 overflow-hidden select-none ${dragging ? "cursor-grabbing" : "cursor-grab"}`}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      data-chart="route"
    >
      <div
        className="absolute top-0 left-0 origin-top-left"
        style={{
          width: W,
          height: H,
          transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})`,
        }}
      >
        <div
          className="absolute"
          style={{
            left: PAD,
            top: PAD,
            width: route.width,
            height: route.height,
          }}
        >
          <svg
            className="pointer-events-none absolute inset-0 overflow-visible"
            width={route.width}
            height={route.height}
            aria-hidden="true"
          >
            {route.tracks.map((t, i) => (
              <path
                key={i}
                d={pathOf(t.points, t.tone === "side" ? 22 : 16)}
                fill="none"
                stroke={
                  t.tone === "spur" || t.tone === "fail"
                    ? "var(--color-shu-500)"
                    : stageColor(t.stage)
                }
                strokeWidth={
                  t.tone === "main"
                    ? 7
                    : t.tone === "side"
                      ? 4.5
                      : t.tone === "wrap"
                        ? 4
                        : 2.5
                }
                strokeOpacity={
                  t.tone === "wrap" ? 0.32 : t.tone === "side" ? 0.9 : 1
                }
                strokeDasharray={
                  t.tone === "spur"
                    ? "2 6"
                    : t.tone === "fail"
                      ? "6 5"
                      : undefined
                }
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ))}
            {route.spans.map((s, i) => (
              <SpanLine key={i} span={s} />
            ))}
          </svg>
          {route.spans.map((s, i) =>
            s.from || s.to ? (
              <SpanTag
                key={i}
                span={s}
                defs={defs}
                picked={picked}
                onPick={select}
                onMenu={menu}
              />
            ) : null,
          )}
          {many &&
            route.tags.map((t, i) => (
              <span
                key={i}
                className="absolute flex items-center gap-2 text-[13.5px] font-semibold whitespace-nowrap text-ink"
                style={{ left: t.x - 4, top: t.y }}
              >
                <span
                  className="grid size-[22px] place-items-center rounded-full text-[11.5px] font-bold text-white tabular-nums"
                  style={{ background: stageColor(t.stage) }}
                >
                  {t.stage + 1}
                </span>
                {stages?.titles[t.stage]}
              </span>
            ))}
          {route.notes.map((n, i) =>
            n.tone === "ask" ? (
              <span
                key={i}
                className={`route-ask-words absolute w-[116px] text-[12px] leading-[1.35] font-semibold ${n.anchor === "end" ? "-translate-x-full -translate-y-full text-right" : "-translate-x-1/2 text-center"}`}
                style={{ left: n.x, top: n.y }}
              >
                {n.text}
              </span>
            ) : (
              <span
                key={i}
                className={`absolute -translate-y-1/2 text-[11.5px] leading-none whitespace-nowrap ${n.anchor === "middle" ? "-translate-x-1/2" : ""} ${n.tone === "fail" ? "text-shu-600" : "text-slate-500"}`}
                style={{ left: n.x, top: n.y }}
              >
                {n.text}
              </span>
            ),
          )}
          {route.stops.map((s, i) => {
            const Icon = STOP_ICON[s.step.type] ?? CircleX;
            return (
              <button
                key={i}
                type="button"
                title={plain(sentence(s.step, defs.get(s.step.type)))}
                onClick={() => select(s.step.id)}
                onContextMenu={menu(s.step.id)}
                className={`route-stop absolute z-10 flex items-center justify-center gap-1.5 rounded-full px-3 text-[12px] whitespace-nowrap ${s.fail ? "route-stop-fail" : ""}`}
                style={{ left: s.x, top: s.y, width: s.w, height: 26 }}
              >
                <Icon
                  size={12}
                  strokeWidth={2}
                  aria-hidden="true"
                  className="shrink-0"
                />
                <span className="truncate">
                  {s.step.type === FAIL
                    ? title(s.step, defs)
                    : guardOutcome(s.step)}
                </span>
              </button>
            );
          })}
          {route.pills.map((p) => (
            <span
              key={p.kind}
              className={`route-pill absolute z-10 flex items-center justify-center gap-1.5 rounded-full text-[12.5px] font-semibold ${p.kind === "end" ? "route-pill-end" : ""}`}
              style={{ left: p.x, top: p.y, width: PILL_W, height: PILL_H }}
            >
              {p.kind === "start" ? (
                <Play size={12} strokeWidth={2.2} aria-hidden="true" />
              ) : (
                <Flag size={12} strokeWidth={2.2} aria-hidden="true" />
              )}
              {p.kind === "start" ? words.start : words.end}
            </span>
          ))}
          {route.stations.map((s, i) => (
            <StationView
              key={i}
              station={s}
              defs={defs}
              number={numbers?.get(s.step.id ?? "")}
              state={s.step.id ? run?.steps[s.step.id] : undefined}
              picked={picked === s.step.id}
              withApp={apps.size > 1}
              onPick={select}
              onMenu={menu}
            />
          ))}
          {editable &&
            route.inserts.map((p, i) => (
              // A place a step can be put: the "+" shows while the pointer is near it (or it has the keyboard).
              <span
                key={`add${i}`}
                className="group/add absolute z-20 flex size-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center"
                style={{ left: p.x, top: p.y }}
              >
                <button
                  type="button"
                  title={words.addHere}
                  aria-label={words.addHere}
                  onClick={() => setPaletteOpen(true, p.slot)}
                  className="flex size-5 items-center justify-center rounded-full border border-primary bg-sheet text-primary opacity-0 shadow-sm group-hover/add:opacity-100 hover:bg-primary hover:text-on-primary focus-visible:opacity-100"
                >
                  <Plus size={12} strokeWidth={2.25} aria-hidden="true" />
                </button>
              </span>
            ))}
          {empty && (
            <div
              data-float
              className="route-float absolute flex w-[340px] flex-col items-center gap-3 rounded-[12px] px-6 py-5 text-center"
              style={{ left: 0, top: (route.pills[0]?.y ?? 0) + PILL_H + 28 }}
            >
              <p className="text-[13px] leading-relaxed text-slate-600">
                {aiBusy ? words.aiMaking : words.emptyMap}
              </p>
              {editable && (
                <button
                  type="button"
                  onClick={() =>
                    setPaletteOpen(true, {
                      parentId: null,
                      block: null,
                      index: 0,
                    })
                  }
                  className="flex items-center gap-1.5 rounded-[6px] bg-primary px-3 py-1.5 text-[12.5px] font-semibold text-on-primary hover:bg-primary-hover"
                >
                  <Plus size={14} strokeWidth={2} aria-hidden="true" />
                  {words.addFirst}
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* What the flow is, and what it works on. */}
      <div
        data-float
        className="route-float absolute top-3 left-4 z-30 max-w-[min(760px,calc(100%-32px))] cursor-default rounded-[10px] px-4 py-2.5"
      >
        {plate}
        {apps.size > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {[...apps].map(([app, list]) => {
              const Icon = groupIcon(app);
              const names = targets(list);
              return (
                <span
                  key={app}
                  className="flex min-w-0 items-center gap-1.5 rounded-full border border-slate-200 bg-sheet py-[3px] pr-2.5 pl-1 text-[12px]"
                >
                  <Tile icon={Icon} group={app} size={20} round />
                  <span className="font-medium whitespace-nowrap text-ink">
                    {groupLabel(app)}
                  </span>
                  {names.length > 0 && (
                    <span className="max-w-[260px] truncate text-[11.5px] text-slate-500">
                      {names.slice(0, 2).join(" · ")}
                      {names.length > 2
                        ? ` ${words.more(names.length - 2)}`
                        : ""}
                    </span>
                  )}
                </span>
              );
            })}
          </div>
        )}
      </div>

      {/* While the AI makes the flow, or a run goes, said once at the top. */}
      {(aiBusy || (run && isActive(run))) && !empty && (
        <div
          data-float
          className="route-float absolute top-3 left-1/2 z-30 flex -translate-x-1/2 items-center gap-2.5 rounded-full px-4 py-2 text-[12.5px] whitespace-nowrap text-ink max-[1100px]:top-auto max-[1100px]:bottom-16"
        >
          <span className="route-ping size-2 rounded-full bg-primary" />
          {aiBusy ? (
            <>
              <Sparkles
                size={13}
                strokeWidth={1.9}
                aria-hidden="true"
                className="text-primary"
              />
              {words.aiMaking}
            </>
          ) : (
            <>
              {words.runningAt(Math.min(done + 1, counted), counted)}
              <span className="h-1 w-24 overflow-hidden rounded-full bg-slate-200">
                <span
                  className="block h-full rounded-full bg-primary"
                  style={{
                    width: `${counted ? Math.round((done / counted) * 100) : 0}%`,
                  }}
                />
              </span>
              {atStep && (
                <span className="max-w-[280px] truncate text-slate-500">
                  {title(atStep, defs)}
                </span>
              )}
            </>
          )}
        </div>
      )}

      {/* How big the map is drawn. */}
      <div
        data-float
        role="toolbar"
        aria-label={words.size}
        className="route-float absolute bottom-4 left-1/2 z-30 flex -translate-x-1/2 items-center gap-0.5 rounded-[12px] p-1 text-[12.5px] whitespace-nowrap text-ink"
      >
        <DockButton
          title={words.zoomOut}
          disabled={empty || view.k <= ZOOM_MIN}
          onClick={() => zoomAt(1 / 1.2)}
        >
          <Minus size={15} strokeWidth={2} aria-hidden="true" />
        </DockButton>
        <DockButton
          title={words.actual}
          disabled={empty}
          onClick={() => zoomAt(1 / view.k)}
          wide
        >
          <span className="tabular-nums">{Math.round(view.k * 100)}%</span>
        </DockButton>
        <DockButton
          title={words.zoomIn}
          disabled={empty || view.k >= ZOOM_MAX}
          onClick={() => zoomAt(1.2)}
        >
          <Plus size={15} strokeWidth={2} aria-hidden="true" />
        </DockButton>
        <span className="mx-1 h-5 w-px bg-slate-200" />
        <DockButton
          title={words.fit}
          disabled={empty}
          onClick={() => {
            setMoved(false);
            setView(fitted());
          }}
          label
        >
          <Maximize2 size={14} strokeWidth={2} aria-hidden="true" />
          {words.fit}
        </DockButton>
        <span className="mx-1 h-5 w-px bg-slate-200" />
        <DockButton
          title={words.map}
          disabled={empty}
          pressed={showMap && !empty}
          onClick={() => setShowMap((m) => !m)}
          label
        >
          <MapIcon size={14} strokeWidth={2} aria-hidden="true" />
          {words.map}
        </DockButton>
      </div>

      {showMap && !empty && room.w > 760 && (
        <MiniMap
          route={route}
          view={view}
          room={room}
          run={run}
          onGo={(x, y) => {
            setMoved(true);
            setView((v) => ({
              ...v,
              x: room.w / 2 - (x + PAD) * v.k,
              y: room.h / 2 - (y + PAD) * v.k,
            }));
          }}
        />
      )}
    </div>
  );
}

function DockButton({
  title,
  disabled,
  onClick,
  children,
  wide,
  label,
  pressed,
}: {
  title: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
  wide?: boolean;
  label?: boolean;
  pressed?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={label ? undefined : title}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={`flex h-8 items-center justify-center gap-1.5 rounded-[8px] ${wide ? "min-w-[54px]" : label ? "px-2.5" : "w-8"} hover:bg-slate-100 disabled:opacity-40 disabled:hover:bg-transparent aria-pressed:bg-[var(--color-brand-50)] aria-pressed:text-primary`}
    >
      {children}
    </button>
  );
}

/** The whole map in small, with where the desk shows it; pressed, the desk goes there. */
function MiniMap({
  route,
  view,
  room,
  run,
  onGo,
}: {
  route: Route;
  view: View;
  room: { w: number; h: number };
  run?: RunState | null;
  onGo: (x: number, y: number) => void;
}) {
  const W = route.width + PAD * 2;
  const H = route.height + PAD * 2;
  const k = Math.min((MAP_W - 16) / W, (MAP_H - 16) / H);
  const ox = (MAP_W - W * k) / 2;
  const oy = (MAP_H - H * k) / 2;
  const vx = (-view.x / view.k) * k + ox;
  const vy = (-view.y / view.k) * k + oy;
  return (
    <div
      data-float
      className="route-float absolute right-4 bottom-4 z-30 overflow-hidden rounded-[10px]"
      style={{ width: MAP_W, height: MAP_H }}
    >
      <svg
        width={MAP_W}
        height={MAP_H}
        className="cursor-pointer"
        aria-hidden="true"
        onClick={(e) => {
          const box = (
            e.currentTarget as SVGSVGElement
          ).getBoundingClientRect();
          onGo(
            (e.clientX - box.left - ox) / k - PAD,
            (e.clientY - box.top - oy) / k - PAD,
          );
        }}
      >
        <g transform={`translate(${ox + PAD * k} ${oy + PAD * k}) scale(${k})`}>
          {route.tracks
            .filter((t) => t.tone === "main" || t.tone === "side")
            .map((t, i) => (
              <path
                key={i}
                d={pathOf(t.points)}
                fill="none"
                stroke={stageColor(t.stage)}
                strokeWidth={
                  t.tone === "main" ? 14 / Math.max(1, k * 10) + 6 : 4
                }
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ))}
          {route.stations
            .filter((s) => s.step.id && run?.steps[s.step.id] === "running")
            .map((s, i) => (
              <circle
                key={i}
                cx={s.x}
                cy={s.y}
                r={16}
                fill="var(--color-primary)"
              />
            ))}
        </g>
        <rect
          x={vx}
          y={vy}
          width={(room.w / view.k) * k}
          height={(room.h / view.k) * k}
          rx={3}
          className="route-map-view"
        />
      </svg>
    </div>
  );
}

/** A bracket over what belongs together, an arrow back to its start when it repeats. */
function SpanLine({ span }: { span: Span }) {
  const { x1, x2, y, kind } = span;
  const c = kind === "try" ? "var(--color-shu-500)" : stageColor(span.stage);
  const foot = 10;
  const d = `${span.from ? `M ${x1} ${y + foot} Q ${x1} ${y} ${x1 + 8} ${y}` : `M ${x1} ${y}`} L ${x2 - (span.to ? 8 : 0)} ${y} ${span.to ? `Q ${x2} ${y} ${x2} ${y + foot}` : ""}`;
  return (
    <g
      fill="none"
      stroke={c}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeDasharray={kind === "loop" || kind === "try" ? "5 4" : undefined}
    >
      <path d={d} />
      {kind === "loop" && span.from && (
        <path
          d={`M ${x1 - 5} ${y + foot - 5} L ${x1} ${y + foot + 1} L ${x1 + 5} ${y + foot - 5}`}
          strokeDasharray={undefined}
        />
      )}
    </g>
  );
}

/** A bracket's name on it: what it is and how it goes round, and where it goes on from or to another row. */
function SpanTag({
  span,
  defs,
  picked,
  onPick,
  onMenu,
}: {
  span: Span;
  defs: Defs;
  picked: string | null;
  onPick: (id: string | undefined) => void;
  onMenu: Menu;
}) {
  const words = chartWords();
  const Icon =
    span.step.retry?.maxAttempts &&
    span.step.retry.maxAttempts > 1 &&
    span.kind === "group"
      ? RotateCw
      : SPAN_ICON[span.kind];
  const c =
    span.kind === "try" ? "var(--color-shu-600)" : stageColor(span.stage);
  const text = span.from
    ? spanName(span.step, span.kind, defs)
    : words.repeatTo;
  const note = span.from ? spanNote(span.step, span.kind) : "";
  const left =
    span.from && !span.to
      ? span.x1 + 8
      : span.to && !span.from
        ? span.x2 - 8
        : (span.x1 + span.x2) / 2;
  const shift =
    span.from && !span.to
      ? ""
      : span.to && !span.from
        ? "-translate-x-full"
        : "-translate-x-1/2";
  return (
    <button
      type="button"
      title={plain(sentence(span.step, defs.get(span.step.type)))}
      onClick={() => onPick(span.step.id)}
      onContextMenu={onMenu(span.step.id)}
      className={`route-span-tag absolute z-10 flex max-w-[360px] -translate-y-1/2 items-center gap-1 rounded-full px-2 text-[11.5px] leading-[18px] font-semibold whitespace-nowrap ${shift} ${picked === span.step.id ? "flow-chart-on" : ""}`}
      style={{ left, top: span.y, color: c }}
    >
      <Icon
        size={12}
        strokeWidth={2.2}
        aria-hidden="true"
        className="shrink-0"
      />
      <span className="truncate">{text}</span>
      {note && (
        <span className="shrink-0 font-normal text-slate-500">{note}</span>
      )}
    </button>
  );
}

/** A bracket's name: the name it was given, else what it is. */
function spanName(step: Step, kind: SpanKind, defs: Defs): string {
  const words = chartWords();
  if (kind === "always") return words.always;
  const name = (step.name ?? "").trim();
  if (kind === "try") return name || words.guarded;
  return name || title(step, defs);
}

/** What is said beside a bracket's name: how a loop goes round, how often a group is tried. */
function spanNote(step: Step, kind: SpanKind): string {
  const words = chartWords();
  if (kind === "loop") return words.loopNote(step);
  const tries = kind === "group" ? step.retry?.maxAttempts : undefined;
  return tries && tries > 1 ? words.tries(tries) : "";
}

/** An app's or a step's icon on a tint of its colour. */
function Tile({
  icon: Icon,
  group,
  size = 22,
  round,
}: {
  icon: LucideIcon;
  group: string;
  size?: number;
  round?: boolean;
}) {
  const c = color(group);
  return (
    <span
      className={`flex shrink-0 items-center justify-center ${round ? "rounded-full" : "rounded-[5px]"}`}
      style={{
        width: size,
        height: size,
        color: c,
        background: `color-mix(in srgb, ${c} 14%, transparent)`,
      }}
    >
      <Icon
        size={Math.round(size * 0.6)}
        strokeWidth={1.9}
        aria-hidden={true}
      />
    </span>
  );
}

/** A station: a ring on the line with the step's number in it, its name under it (over it on a track above). */
function StationView({
  station,
  defs,
  number,
  state,
  picked,
  withApp,
  onPick,
  onMenu,
}: {
  station: Station;
  defs: Defs;
  number?: number;
  state?: string;
  picked: boolean;
  withApp: boolean;
  onPick: (id: string | undefined) => void;
  onMenu: Menu;
}) {
  const { step, kind } = station;
  const c = stageColor(station.stage);
  const tip = plain(sentence(step, defs.get(step.type)));
  const def = defs.get(step.type);
  const group = def ? groupOf(def) : "other";
  const Icon = nodeIcon(step.type, group);
  const ran =
    state === "succeeded"
      ? "route-done"
      : state === "failed"
        ? "route-failed"
        : state === "running" || state === "paused"
          ? "route-now"
          : "";
  const name =
    kind === "ask"
      ? question(step, defs)
      : kind === "bar"
        ? step.name || chartWords().together()
        : title(step, defs);
  const mark =
    kind === "bar" ? (
      <span
        className={`route-bar block h-[34px] w-[7px] rounded-full ${ran}`}
        style={{ background: c }}
      />
    ) : kind === "ask" ? (
      <span
        className={`route-diamond block size-[20px] rotate-45 rounded-[4px] border-[3px] ${ran}`}
      />
    ) : kind === "minor" ? (
      <span
        className={`route-dot block size-[13px] rounded-full border-[3px] ${ran}`}
        style={{ borderColor: c }}
      />
    ) : (
      <span
        className={`route-station grid size-[30px] place-items-center rounded-full border-[4px] text-[11.5px] font-bold tabular-nums ${ran}`}
        style={{ borderColor: c }}
      >
        {number ?? ""}
      </span>
    );
  // A fork's question stands under it as a note; a station's words under or over it.
  const words = station.quiet ? null : (
    <span
      className={`line-clamp-2 text-center leading-[1.35] ${kind === "minor" ? "text-[11.5px] text-slate-500" : kind === "ask" ? "route-ask-words text-[12px] font-semibold" : "text-[12.5px] text-ink"} ${picked ? "flow-chart-on" : ""}`}
      style={{ width: kind === "minor" ? 96 : LABEL_W }}
    >
      {withApp && kind === "step" && (
        <span className="mr-1 inline-flex align-[-3px]">
          <Tile icon={Icon} group={group} size={15} round />
        </span>
      )}
      {name}
    </span>
  );
  const half = kind === "minor" ? 48 : LABEL_W / 2;
  const markH =
    kind === "step" ? 30 : kind === "minor" ? 13 : kind === "bar" ? 34 : 28;
  const above = station.label === "above";
  return (
    <button
      type="button"
      title={kind === "ask" ? `${name}\n${tip}` : tip}
      onClick={() => onPick(step.id)}
      onContextMenu={onMenu(step.id)}
      data-step={step.id}
      className={`route-stop-btn group absolute z-10 flex flex-col items-center ${above ? "flex-col-reverse" : ""} gap-1.5`}
      style={{
        left: station.x - half,
        width: half * 2,
        top: above ? station.y + markH / 2 : station.y - markH / 2,
        ...(above ? { transform: "translateY(-100%)" } : {}),
      }}
    >
      <span
        className={`relative grid place-items-center transition-transform group-hover:scale-110 ${picked ? "route-picked" : ""}`}
        style={{ height: markH }}
      >
        {mark}
      </span>
      {words && <span className="flex justify-center">{words}</span>}
    </button>
  );
}
