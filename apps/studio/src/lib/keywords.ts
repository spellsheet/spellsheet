// The programming keyword of each control step (forEach, try, …): the chart
// never shows it (people read 繰り返し・条件分岐), but the palette finds a
// node by it, since the AI and the docs use those words. Block labels spell
// out the condition in plain words, so a loop says what it walks over.
import type { Step } from "@spellsheet/schema";
import { blockName, locale } from "./i18n";

export const KEYWORD: Record<string, string> = {
  "control.if": "if",
  "control.switch": "switch",
  "control.case": "case",
  "control.while": "while",
  "control.repeat": "repeat",
  "control.forEach": "forEach",
  "control.try": "try",
  "control.parallel": "parallel",
  "control.break": "break",
  "control.continue": "continue",
  "control.fail": "throw",
  "flow.call": "call",
};

const MAX = 36;

function text(value: unknown): string {
  const s = typeof value === "string" ? value : value == null ? "" : JSON.stringify(value);
  return s.length > MAX ? `${s.slice(0, MAX - 1)}…` : s;
}

/** The label of `block` of `step`, falling back to the registry's `label`. */
export function blockLabel(step: Step, block: string, label: string): string {
  return locale === "ja" ? blockLabelJa(step, block, label) : blockLabelEn(step, block, label);
}

function blockLabelEn(step: Step, block: string, label: string): string {
  const p = (step.params ?? {}) as Record<string, unknown>;
  switch (`${step.type}:${block}`) {
    case "control.if:then":
      return "when the condition holds";
    case "control.if:else":
      return "otherwise";
    case "control.while:body": {
      const max = p.maxIterations ? ` (up to ${p.maxIterations} times)` : "";
      return `while ${text(p.condition)}${max}`;
    }
    case "control.repeat:body":
      return `${text(p.count)} times${p.indexVar ? ` (count → ${p.indexVar})` : ""}`;
    case "control.forEach:body": {
      const at = p.concurrency && Number(p.concurrency) > 1 ? `, ${p.concurrency} at a time` : "";
      return `each of ${text(p.items)} → ${p.itemVar ?? "item"}${at}`;
    }
    case "control.switch:cases":
      return "by value";
    case "control.switch:default":
      return "when none match";
    case "control.case:body":
      return "";
    case "control.try:try":
      return "run first";
    case "control.try:catch":
      return `on failure (error → ${p.errorVar ?? "error"})`;
    case "control.try:finally":
      return "always, at the end";
    default:
      return blockName(step.type, block, label);
  }
}

function blockLabelJa(step: Step, block: string, label: string): string {
  const p = (step.params ?? {}) as Record<string, unknown>;
  switch (`${step.type}:${block}`) {
    case "control.if:then":
      return "条件が成り立つとき";
    case "control.if:else":
      return "成り立たないとき";
    case "control.while:body": {
      const max = p.maxIterations ? `（最大 ${p.maxIterations} 回）` : "";
      return `${text(p.condition)} の間${max}`;
    }
    case "control.repeat:body":
      return `${text(p.count)} 回${p.indexVar ? `（何回目 → ${p.indexVar}）` : ""}`;
    case "control.forEach:body": {
      const at = p.concurrency && Number(p.concurrency) > 1 ? `・${p.concurrency} 件ずつ同時` : "";
      return `${text(p.items)} の 1 件ずつ → ${p.itemVar ?? "item"}${at}`;
    }
    case "control.switch:cases":
      return "値ごと";
    case "control.switch:default":
      return "どれにも該当しないとき";
    case "control.case:body":
      return "";
    case "control.try:try":
      return "まず実行";
    case "control.try:catch":
      return `失敗したら（内容 → ${p.errorVar ?? "error"}）`;
    case "control.try:finally":
      return "成功でも失敗でも最後に";
    default:
      return label;
  }
}

/**
 * The short heading of a block's column on the chart, under the head of its
 * frame: はい／いいえ for an if, 実行／失敗したとき for a try. Empty where the
 * head already says it (a loop's body, a group's) or the column has its own
 * tab (a switch's cases).
 */
export function laneLabel(step: Step, block: string, label: string): string {
  const ja = locale === "ja";
  const p = (step.params ?? {}) as Record<string, unknown>;
  switch (`${step.type}:${block}`) {
    case "control.if:then":
      return ja ? "はい" : "Yes";
    case "control.if:else":
      return ja ? "いいえ" : "No";
    case "control.switch:default":
      return ja ? "その他" : "Other";
    case "control.try:try":
      return ja ? "実行" : "Run";
    case "control.try:catch":
      return ja ? `失敗したとき（→ ${p.errorVar ?? "error"}）` : `On failure (→ ${p.errorVar ?? "error"})`;
    case "control.try:finally":
      return ja ? "最後に必ず" : "Always at the end";
    case "control.switch:cases":
    case "control.case:body":
    case "control.group:body":
    case "control.parallel:branches":
    case "control.forEach:body":
    case "control.repeat:body":
    case "control.while:body":
    case "wait.until:check":
      return "";
    default:
      return blockLabel(step, block, label);
  }
}

/** On the foot of a loop's frame: it goes round again. */
export function loopBackLabel(step: Step): string {
  const ja = locale === "ja";
  if (step.type === "control.forEach") return ja ? "次の 1 件へ" : "Next item";
  if (step.type === "wait.until") return ja ? "もう一度確かめる" : "Check again";
  return ja ? "次の回へ" : "Next round";
}

/** What a loop asks each time round (on its decision), and its two answers. */
export function loopQuestion(step: Step): { question: string; yes: string; no: string } {
  const ja = locale === "ja";
  const p = (step.params ?? {}) as Record<string, unknown>;
  const answers = ja ? { yes: "はい", no: "いいえ" } : { yes: "Yes", no: "No" };
  switch (step.type) {
    case "control.forEach":
      return { question: ja ? "次の 1 件がある？" : "Another item?", ...answers };
    case "control.repeat":
      return { question: ja ? "まだ回数が残っている？" : "Rounds left?", ...answers };
    default: {
      const condition = plainExpr(p.condition);
      return { question: condition ? `${condition}${ja ? "？" : "?"}` : ja ? "条件を満たす？" : "Condition holds?", ...answers };
    }
  }
}

/** What an if or a switch asks, in the decision under its head: "amount > 10000？", "region は？". */
export function branchQuestion(step: Step): string {
  const ja = locale === "ja";
  const p = (step.params ?? {}) as Record<string, unknown>;
  if (step.type === "control.switch") {
    const value = plainExpr(p.value);
    return value ? (ja ? `${value} は？` : `${value}?`) : ja ? "値は？" : "Which value?";
  }
  const condition = plainExpr(p.condition);
  return condition ? `${condition}${ja ? "？" : "?"}` : ja ? "条件を満たす？" : "Condition holds?";
}

/** On the line out of a loop's frame: when it leaves. */
export function loopExitLabel(step: Step): string {
  const ja = locale === "ja";
  if (step.type === "control.forEach") return ja ? "すべて終わったら" : "When all are done";
  if (step.type === "control.while") return ja ? "条件が外れたら" : "When the condition fails";
  if (step.type === "wait.until") return ja ? "条件を満たしたら" : "When the condition holds";
  const count = (step.params as Record<string, unknown> | undefined)?.count;
  if (typeof count === "number") return ja ? `${count} 回終えたら` : `After ${count} rounds`;
  return ja ? "回数を終えたら" : "After the last round";
}

/** On a loop's foot: where it ends, however it ends (all done, or a break). */
export function loopEndLabel(): string {
  return locale === "ja" ? "繰り返し終了" : "End of loop";
}

/** How a loop's rounds went in a run, for its foot. */
export type LoopOutcome = "running" | "done" | "left" | "failed" | "stopped";

/**
 * How far a loop got, on its foot: 「12 件中 12 件」 when it went round
 * them all, 「12 件中 7 件目で抜けた」 after a break, 「3 / 12 件目」 while it runs.
 */
export function loopRoundsText(type: string, round: number, total: number | null, how: LoopOutcome): string {
  const ja = locale === "ja";
  const unit = type === "control.forEach" ? (ja ? "件" : "items") : ja ? "回" : "rounds";
  const of = total === null ? "" : ja ? `${total} ${unit}中 ` : ` of ${total}`;
  if (!ja) {
    if (how === "running") return total === null ? `Round ${round}` : `${round} / ${total}`;
    if (how === "done") return total === null ? `${round} ${unit}` : `${round}${of}`;
    const at = `at ${round}${of}`;
    return how === "left" ? `Left ${at}` : how === "failed" ? `Error ${at}` : `Stopped ${at}`;
  }
  if (how === "running") return total === null ? `${round} ${unit}目` : `${round} / ${total} ${unit}目`;
  if (how === "done") return `${of}${round} ${unit}`;
  const at = `${of}${round} ${unit}目で`;
  return how === "left" ? `${at}抜けた` : how === "failed" ? `${at}エラー` : `${at}中止`;
}

/** What the head of a frame says after its name: the condition of an if, the value a switch compares, what a loop walks over. */
export function headSummary(step: Step): string {
  const p = (step.params ?? {}) as Record<string, unknown>;
  switch (step.type) {
    case "control.if":
      return plainExpr(p.condition);
    case "control.switch":
      return plainExpr(p.value);
    case "control.forEach":
    case "control.repeat":
    case "control.while":
      return blockLabel(step, "body", "").replace(/\{\{\s*([\s\S]*?)\s*\}\}/g, "$1");
    default:
      return "";
  }
}

/** `{{ a > 1 }}` as `a > 1`. */
function plainExpr(value: unknown): string {
  const s = text(value).trim();
  const m = /^\{\{\s*([\s\S]*?)\s*\}\}$/.exec(s);
  return m ? (m[1] ?? "") : s;
}

/** On the chart to read, beside a guard (flow/chart.ts): where the flow goes when it leaves the line there. */
export function guardOutcome(stop: Step): string {
  const ja = locale === "ja";
  if (stop.type === "control.continue") return ja ? "次の回へ進む" : "On to the next round";
  if (stop.type === "control.break") return ja ? "繰り返しを抜ける" : "Leave the loop";
  return ja ? "失敗として終える" : "Stop as failed";
}

/** The words of the chart to read (components/chart). */
export function chartWords() {
  const ja = locale === "ja";
  return {
    yes: ja ? "はい" : "Yes",
    no: ja ? "いいえ" : "No",
    other: ja ? "その他のとき" : "Otherwise",
    more: (n: number) => (ja ? `ほか ${n}` : `+${n}`),
    start: ja ? "開始" : "Start",
    end: ja ? "終了" : "End",
    /** Under a loop's name: how it goes round. */
    loopNote: (step: Step): string => {
      const p = (step.params ?? {}) as Record<string, unknown>;
      if (step.type === "control.forEach") return ja ? "1 件ずつ繰り返す" : "for each item";
      if (step.type === "control.repeat") return typeof p.count === "number" ? (ja ? `${p.count} 回繰り返す` : `${p.count} times`) : ja ? "決まった回数繰り返す" : "a set number of times";
      if (step.type === "wait.until") return ja ? "条件を満たすまで確かめる" : "until the condition holds";
      return ja ? "条件を満たす間繰り返す" : "while the condition holds";
    },
    /** Under a guard against failure that has no name of its own. */
    guarded: ja ? "失敗に備える" : "Guarded",
    /** Under branches that run at the same time. */
    together: ja ? "同時に進める" : "At the same time",
    /** Under a box of the chart: the numbers of its steps on the sheet. */
    stepRange: (from: number, to: number) => (ja ? (from === to ? `手順 ${from}` : `手順 ${from}〜${to}`) : from === to ? `Step ${from}` : `Steps ${from}–${to}`),
    /** Under a box of the chart, when its group is tried again: `n` tries in all. */
    triesShort: (n: number) => (ja ? `${n} 回までやり直す` : `up to ${n} tries`),
    /** Where the flow stops, and why. */
    stopsWith: (why: string) => (ja ? `止まる：${why}` : `Stops: ${why}`),
    /** On a box of the chart: how far a run got in it. */
    runningHere: ja ? "実行中" : "Running",
    failedHere: ja ? "ここで失敗" : "Failed here",
    /** After the first step of a way that has more: "ほか". */
    andMore: ja ? " ほか" : " and more",
    /** Under a guard against failure: what runs when it fails. */
    whenFailed: (what: string) => (ja ? `失敗したとき：${what}` : `On failure: ${what}`),
  };
}
