import { describe, expect, it } from "vitest";
import { newRun } from "../store/run";
import { followScroll, followWait, followedStep } from "./calmFollow";

const view = { height: 1000, scrollTop: 2000, maxScroll: 10000 };

describe("following a run on the sheet", () => {
  it("follows the step that started last, and stays there between two steps", () => {
    const run = newRun("r");
    expect(followedStep(run)).toBeUndefined();
    run.starts = [
      { stepId: "loop", seq: 1 },
      { stepId: "a", seq: 2 },
    ];
    run.steps = { loop: "running", a: "running" };
    expect(followedStep(run)).toBe("a");
    // `a` is done, the next one has not started: the loop is the only step running, but the page stays on `a`.
    run.steps = { loop: "running", a: "succeeded" };
    expect(followedStep(run)).toBe("a");
    expect(followedStep(null)).toBeUndefined();
  });

  it("does not move for a step in the calm middle of the desk", () => {
    expect(followScroll({ ...view, top: 300, bottom: 340 })).toBeNull();
    expect(followScroll({ ...view, top: 130, bottom: 790 })).toBeNull();
  });

  it("puts a step out of the middle a third of the way down", () => {
    expect(followScroll({ ...view, top: 900, bottom: 940 })).toBe(2000 + 900 - 333);
    expect(followScroll({ ...view, top: -500, bottom: -460 })).toBe(2000 - 500 - 333);
  });

  it("does not scroll past the ends of the desk", () => {
    expect(followScroll({ ...view, scrollTop: 100, top: -200, bottom: -150 })).toBe(0);
    expect(followScroll({ ...view, scrollTop: 9900, maxScroll: 9950, top: 900, bottom: 950 })).toBe(9950);
    // Already as far as it goes: nothing moves.
    expect(followScroll({ ...view, scrollTop: 9950, maxScroll: 9950, top: 900, bottom: 950 })).toBeNull();
  });

  it("leaves a step taller than the middle alone while it fills it", () => {
    expect(followScroll({ ...view, top: 50, bottom: 1200 })).toBeNull();
  });

  it("moves the page at most once in the gap", () => {
    expect(followWait(0, 5000)).toBe(0);
    expect(followWait(5000, 5300)).toBe(900);
    expect(followWait(5000, 6200)).toBe(0);
  });
});
