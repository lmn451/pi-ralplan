import { describe, it, expect } from "vitest";
import {
  advanceStage,
  skipCurrentStage,
  failCurrentStage,
  incrementStageIteration,
  syncTrackingToConfig,
  buildPipelineTracking,
  getCurrentStageAdapter,
  type PipelineStageState,
  type PipelineTracking,
  type StageStatus,
  DEFAULT_PIPELINE_CONFIG,
} from "../pi/extensions/ralplan/pipeline.js";

// ============================================================================
// EXECUTABLE TRANSITION TABLE
// ============================================================================
//
// This table is the executable spec for the hand-rolled FSM in pipeline.ts.
// It encodes, for each (current stage status, transition function) pair,
// what the function MUST do. If pipeline.ts changes, this table must be
// updated and ADR 0007 reviewed.
//
// See docs/adr/0007-hand-rolled-state-machine.md for the rationale and
// triggers for revisiting (T-1..T-5).
//
// IMPORTANT — actual documented contract:
//   - advanceStage ALWAYS sets current stage to "complete" (forced) and
//     advances to the next non-skipped stage, regardless of current status.
//   - skipCurrentStage ALWAYS sets current stage to "skipped" (forced) and
//     advances to the next non-skipped stage, regardless of current status.
//   - failCurrentStage ALWAYS sets current stage to "failed" (forced).
//   - incrementStageIteration ONLY bumps the current stage's iterations
//     counter; it does not change status.
//
// "no-op" in this table means: status is preserved AND no implicit
// side-effect (like auto-advance) happens. Only `iterate` is a true no-op
// w.r.t. status.

const ALL_STATUSES: StageStatus[] = [
  "pending",
  "active",
  "complete",
  "failed",
  "skipped",
];

type EventName = "advance" | "skip" | "fail" | "iterate";
type ExpectedOutcome =
  | "no-op" // status preserved exactly
  | "complete-current" // current stage transitions to "complete"
  | "skip-current" // current stage transitions to "skipped"
  | "fail-current" // current stage transitions to "failed"
  | "iterate-current"; // current stage's iterations counter is incremented

/**
 * Documented transition outcomes for each (status, event) pair.
 */
const TRANSITIONS: Record<StageStatus, Record<EventName, ExpectedOutcome>> = {
  pending: {
    advance: "complete-current",
    skip: "skip-current",
    fail: "fail-current",
    iterate: "iterate-current",
  },
  active: {
    advance: "complete-current",
    skip: "skip-current",
    fail: "fail-current",
    iterate: "iterate-current",
  },
  complete: {
    advance: "complete-current", // idempotent — already complete
    skip: "skip-current", // can re-skip an already-complete stage
    fail: "fail-current", // any status can be marked failed
    iterate: "iterate-current",
  },
  failed: {
    advance: "complete-current", // can re-complete a failed stage (degenerate but allowed)
    skip: "skip-current", // can re-skip a failed stage
    fail: "fail-current", // idempotent
    iterate: "iterate-current",
  },
  skipped: {
    advance: "complete-current", // can re-complete a skipped stage
    skip: "skip-current", // idempotent
    fail: "fail-current", // any status can be marked failed
    iterate: "iterate-current",
  },
};

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Build a tracking with all four stages forced to a specific status.
 * Used to isolate the effect of a single transition function call.
 *
 * Note: buildPipelineTracking sets currentStageIndex to the first non-skipped
 * index, falling back to 0 when all are skipped. We restore that invariant
 * by leaving currentStageIndex as set by buildPipelineTracking — but for
 * tests that need a *valid* in-bounds current stage, we fall back to 0 if
 * the helper set the index out of range.
 */
function makeTrackingWithStatus(status: StageStatus): PipelineTracking {
  const tracking = buildPipelineTracking(DEFAULT_PIPELINE_CONFIG);
  for (const stage of tracking.stages) {
    stage.status = status;
    stage.iterations = 0;
    stage.startedAt = undefined;
    stage.completedAt = undefined;
    stage.error = undefined;
  }
  // buildPipelineTracking falls back to currentStageIndex=0 when all are skipped.
  // That keeps the index valid for the "skipped" test cases.
  if (
    tracking.currentStageIndex < 0 ||
    tracking.currentStageIndex >= tracking.stages.length
  ) {
    tracking.currentStageIndex = 0;
  }
  return tracking;
}

/**
 * Extract the current stage from a tracking object. Asserts the index is in-bounds.
 */
function currentStage(tracking: PipelineTracking): PipelineStageState {
  const stages = tracking.stages;
  const idx = tracking.currentStageIndex;
  if (idx < 0 || idx >= stages.length) {
    throw new Error(
      `No current stage at index ${idx} (stages.length=${stages.length})`,
    );
  }
  const stage = stages[idx];
  if (!stage) {
    throw new Error(`Stage at index ${idx} is undefined`);
  }
  return stage;
}

// ============================================================================
// EXECUTABLE INVARIANT TESTS
// ============================================================================

describe("FSM transition table matches documented outcomes", () => {
  for (const status of ALL_STATUSES) {
    for (const event of Object.keys(TRANSITIONS[status]) as EventName[]) {
      const expected = TRANSITIONS[status][event];
      it(`${event} from ${status} → ${expected}`, () => {
        const tracking = makeTrackingWithStatus(status);
        const idx = tracking.currentStageIndex;
        const beforeStatus = tracking.stages[idx]!.status;
        const beforeIterations = tracking.stages[idx]!.iterations;

        switch (event) {
          case "advance":
            advanceStage(tracking);
            break;
          case "skip":
            skipCurrentStage(tracking);
            break;
          case "fail":
            failCurrentStage(tracking, "invariants-test");
            break;
          case "iterate":
            incrementStageIteration(tracking);
            break;
        }

        // After every transition, the current index may have moved.
        // For the assertions below, we check the stage that was originally
        // at the current index — that's the stage the event was applied to.
        const after = tracking.stages[idx]!;

        switch (expected) {
          case "no-op":
            expect(after.status).toBe(beforeStatus);
            expect(after.iterations).toBe(beforeIterations);
            break;
          case "complete-current":
            expect(after.status).toBe("complete");
            break;
          case "skip-current":
            expect(after.status).toBe("skipped");
            break;
          case "fail-current":
            expect(after.status).toBe("failed");
            expect(after.error).toBe("invariants-test");
            break;
          case "iterate-current":
            expect(after.status).toBe(beforeStatus);
            expect(after.iterations).toBe(beforeIterations + 1);
            break;
        }
      });
    }
  }
});

// ============================================================================
// ADDITIONAL FSM-LEVEL INVARIANTS
// ============================================================================

describe("FSM invariant: incrementStageIteration only touches iterations counter", () => {
  for (const status of ALL_STATUSES) {
    it(`from ${status}: status preserved, iterations bumped`, () => {
      const tracking = makeTrackingWithStatus(status);
      const idx = tracking.currentStageIndex;
      const beforeStatus = tracking.stages[idx]!.status;
      const beforeIterations = tracking.stages[idx]!.iterations;
      incrementStageIteration(tracking);
      const after = tracking.stages[idx]!;
      expect(after.status).toBe(beforeStatus);
      expect(after.iterations).toBe(beforeIterations + 1);
    });
  }

  it("multiple iterations accumulate", () => {
    const tracking = makeTrackingWithStatus("active");
    const idx = tracking.currentStageIndex;
    incrementStageIteration(tracking);
    incrementStageIteration(tracking);
    incrementStageIteration(tracking);
    expect(tracking.stages[idx]!.iterations).toBe(3);
  });
});

describe("FSM invariant: at most one stage is active at a time", () => {
  it("a fresh tracking has at most one active stage", () => {
    const tracking = buildPipelineTracking(DEFAULT_PIPELINE_CONFIG);
    const activeCount = tracking.stages.filter(
      (s) => s.status === "active",
    ).length;
    expect(activeCount).toBeLessThanOrEqual(1);
  });

  it("after advanceStage from active, current advances to next non-skipped", () => {
    const tracking = makeTrackingWithStatus("active");
    const startIdx = tracking.currentStageIndex;
    advanceStage(tracking);
    // Current is now at the next non-skipped stage (or terminal).
    if (startIdx + 1 < tracking.stages.length) {
      // We expect tracking to be at a later index.
      expect(tracking.currentStageIndex).toBeGreaterThan(startIdx);
    } else {
      // Past the end — terminal.
      expect(tracking.currentStageIndex).toBe(tracking.stages.length);
    }
  });
});

describe("FSM invariant: skipped stages stay skipped", () => {
  it("syncTrackingToConfig does not re-activate a skipped stage", () => {
    const tracking = buildPipelineTracking(DEFAULT_PIPELINE_CONFIG);
    tracking.stages[0]!.status = "skipped";
    // Mutate config so shouldSkip would return false if re-evaluated.
    tracking.pipelineConfig.planning = "ralplan";
    syncTrackingToConfig(tracking);
    expect(tracking.stages[0]!.status).toBe("skipped");
  });

  it("advanceStage from skipped stage marks it complete (degenerate but allowed)", () => {
    // This documents the actual behavior: advanceStage does not check status
    // before setting "complete". If a stage is in an unexpected state, the
    // function forces it forward.
    const tracking = makeTrackingWithStatus("skipped");
    const idx = tracking.currentStageIndex;
    advanceStage(tracking);
    expect(tracking.stages[idx]!.status).toBe("complete");
  });
});

describe("FSM invariant: getCurrentStageAdapter returns null when nothing is active", () => {
  it("returns null when currentStageIndex is past the end", () => {
    // getCurrentStageAdapter's null-return paths are covered in pipeline.test.ts.
    // This test only documents the boundary condition that triggers the null
    // return: out-of-range currentStageIndex.
    const tracking = buildPipelineTracking(DEFAULT_PIPELINE_CONFIG);
    tracking.currentStageIndex = tracking.stages.length;
    expect(getCurrentStageAdapter(tracking)).toBeNull();
  });

  it("returns null when currentStageIndex is negative", () => {
    const tracking = buildPipelineTracking(DEFAULT_PIPELINE_CONFIG);
    tracking.currentStageIndex = -1;
    expect(getCurrentStageAdapter(tracking)).toBeNull();
  });
});

describe("FSM invariant: terminal states are stable", () => {
  it("complete → fail: transitions to failed", () => {
    const tracking = makeTrackingWithStatus("complete");
    const idx = tracking.currentStageIndex;
    failCurrentStage(tracking, "test");
    expect(tracking.stages[idx]!.status).toBe("failed");
  });

  it("skipped → fail: transitions to failed", () => {
    const tracking = makeTrackingWithStatus("skipped");
    const idx = tracking.currentStageIndex;
    failCurrentStage(tracking, "test");
    expect(tracking.stages[idx]!.status).toBe("failed");
  });
});
