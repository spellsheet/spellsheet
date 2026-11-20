import { useEffect, useRef, useState } from "react";
import type { RunState } from "../store/run";

/*
 * Following a run on the sheet without making anyone dizzy.
 *
 * A loop of short steps used to shake the page: every step (and, between two
 * steps, the loop's own heading, which stays running while its body runs) was
 * scrolled to on its own, smoothly, so the page swung up and down several
 * times a second. Moving pages are what upsets the inner ear, so the sheet
 * now moves as little as it can and never quickly:
 *
 * - it follows the step that started last, and stays put between two steps;
 * - a step already in the calm middle of the desk moves nothing;
 * - when the page does move, the step is put a third of the way down, so the
 *   next steps come into sight without moving again;
 * - it moves at most once in `FOLLOW_GAP_MS`; what started in between is
 *   caught up with at the end of the gap;
 * - a long way is jumped, not slid, and nothing slides when the person has
 *   asked their computer for less motion (prefers-reduced-motion).
 */

/** The least time between two moves of the page that follows a run. */
export const FOLLOW_GAP_MS = 1200;
/** How often at most the sheet redraws the marks of a run (the highlighter, the check marks). */
export const MARKS_GAP_MS = 300;

/** The step the run is on, as the sheet follows it: the one that started last, while the run has not ended. */
export function followedStep(run: RunState | null): string | undefined {
  return run?.starts.at(-1)?.stepId;
}

/** Where a step stands in the desk, and the desk itself (px, as `getBoundingClientRect` and `scrollTop` give them). */
export type FollowView = {
  /** The step's top and bottom, from the top of the desk's visible area. */
  top: number;
  bottom: number;
  /** How tall the desk's visible area is. */
  height: number;
  scrollTop: number;
  /** The most the desk scrolls. */
  maxScroll: number;
};

/**
 * Where to scroll the desk so the step is in sight, or `null` when it is
 * already comfortably in sight (inside the calm middle) and nothing moves.
 */
export function followScroll(v: FollowView): number | null {
  const calmTop = v.height * 0.12;
  const calmBottom = v.height * 0.8;
  if (v.top >= calmTop && v.bottom <= calmBottom) return null;
  // A step taller than the calm middle that already fills it is in sight.
  if (v.bottom - v.top > calmBottom - calmTop && v.top <= calmTop && v.bottom >= calmBottom) return null;
  const to = Math.round(Math.min(Math.max(0, v.scrollTop + v.top - v.height / 3), Math.max(0, v.maxScroll)));
  return Math.abs(to - v.scrollTop) < 2 ? null : to;
}

/** The person has asked their computer for less motion. */
export function reducedMotion(): boolean {
  return globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

/** Slide only a short way, and only for one who has not asked for less motion; anything else is a jump. */
export function scrollBehavior(distance: number, height: number): ScrollBehavior {
  return !reducedMotion() && distance <= height * 0.6 ? "smooth" : "auto";
}

/** Whether a scroll of the page at `now` may happen now, or how long to wait for it. */
export function followWait(last: number, now: number, gap = FOLLOW_GAP_MS): number {
  return Math.max(0, last + gap - now);
}

/**
 * A value that changes at most once in `ms`: the first change is shown at
 * once, those that come quicker are gathered and the latest is shown at the
 * end of the wait. A run's marks on the sheet redraw through it, so a fast
 * loop does not flash its lines several times a second.
 */
export function useSettled<T>(value: T, ms: number): T {
  const [shown, setShown] = useState(value);
  const last = useRef(0);
  useEffect(() => {
    const wait = followWait(last.current, Date.now(), ms);
    if (wait === 0) {
      last.current = Date.now();
      setShown(value);
      return;
    }
    const timer = setTimeout(() => {
      last.current = Date.now();
      setShown(value);
    }, wait);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return shown;
}
