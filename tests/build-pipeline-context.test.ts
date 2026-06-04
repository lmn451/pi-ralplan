import { describe, it, expect } from "vitest";
import { buildPipelineContext } from "../pi/extensions/ralplan/index.js";
import type { RalplanState } from "../pi/extensions/ralplan/state.js";
import { DEFAULT_PIPELINE_CONFIG } from "../pi/extensions/ralplan/pipeline.js";
import { getWorktreeCreationSection } from "../pi/extensions/ralplan/adapters.js";
import { resolveWorktreeRoot } from "../pi/extensions/ralplan/utils.js";

/**
 * Regression tests for the worktree path double-suffix bug.
 *
 * Bug: `buildContext` (in the extension closure) was passing `state.worktreePath`
 * as `context.directory`. The kickoff message then computed
 * `resolveWorktreeRoot(context.directory)` which adds a `-worktrees` suffix,
 * producing a doubled path like:
 *   /repo-worktrees/foo-worktrees/foo
 * instead of the actual:
 *   /repo-worktrees/foo
 *
 * Fix: `buildPipelineContext` is a pure exported function that takes
 * `sessionCwd` explicitly for `context.directory`, separate from
 * `worktreePath` (which feeds `context.cwd` and `context.worktreePath`).
 */

function makeState(overrides: Partial<RalplanState> = {}): RalplanState {
  return {
    version: 3,
    active: true,
    mode: "ralplan",
    pipeline: {
      pipelineConfig: DEFAULT_PIPELINE_CONFIG,
      stages: [],
      currentStageIndex: 0,
    },
    originalIdea: "test idea",
    specPath: "plans/spec.md",
    planPath: "plans/plan.md",
    startedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("buildPipelineContext", () => {
  it("uses sessionCwd for context.directory (not worktreePath)", () => {
    // The fix: directory is the ORIGINAL repo, not the worktree path.
    const ctx = buildPipelineContext(
      makeState({ sessionCwd: "/Users/applesucks/dev/pi-ralplan" }),
      "/Users/applesucks/dev/pi-ralplan",
      "/Users/applesucks/dev/pi-ralplan-worktrees/test-idea",
    );
    expect(ctx.directory).toBe("/Users/applesucks/dev/pi-ralplan");
  });

  it("sets context.cwd to worktreePath when a worktree exists", () => {
    const ctx = buildPipelineContext(
      makeState(),
      "/Users/applesucks/dev/pi-ralplan",
      "/Users/applesucks/dev/pi-ralplan-worktrees/test-idea",
    );
    expect(ctx.cwd).toBe(
      "/Users/applesucks/dev/pi-ralplan-worktrees/test-idea",
    );
  });

  it("falls back to sessionCwd for context.cwd when no worktree", () => {
    const ctx = buildPipelineContext(
      makeState(),
      "/Users/applesucks/dev/pi-ralplan",
      undefined,
    );
    expect(ctx.directory).toBe("/Users/applesucks/dev/pi-ralplan");
    expect(ctx.cwd).toBe("/Users/applesucks/dev/pi-ralplan");
  });

  it("preserves worktreePath in context.worktreePath", () => {
    const ctx = buildPipelineContext(
      makeState(),
      "/Users/applesucks/dev/pi-ralplan",
      "/Users/applesucks/dev/pi-ralplan-worktrees/test-idea",
    );
    expect(ctx.worktreePath).toBe(
      "/Users/applesucks/dev/pi-ralplan-worktrees/test-idea",
    );
  });

  it("joins specPath/planPath/answersPath under the worktree when present", () => {
    const ctx = buildPipelineContext(
      makeState({
        specPath: "plans/spec.md",
        planPath: "plans/plan.md",
        answersPath: "plans/answers.md",
      }),
      "/Users/applesucks/dev/pi-ralplan",
      "/Users/applesucks/dev/pi-ralplan-worktrees/test-idea",
    );
    expect(ctx.specPath).toBe(
      "/Users/applesucks/dev/pi-ralplan-worktrees/test-idea/plans/spec.md",
    );
    expect(ctx.planPath).toBe(
      "/Users/applesucks/dev/pi-ralplan-worktrees/test-idea/plans/plan.md",
    );
    expect(ctx.answersPath).toBe(
      "/Users/applesucks/dev/pi-ralplan-worktrees/test-idea/plans/answers.md",
    );
  });

  it("REGRESSION: getWorktreeCreationSection does NOT produce a doubled -worktrees suffix", () => {
    // This is the integration test for the original bug. The path emitted in
    // the kickoff message MUST equal the actual worktree path.
    const sessionCwd = "/Users/applesucks/dev/pi-ralplan";
    const worktreePath = "/Users/applesucks/dev/pi-ralplan-worktrees/test-idea";

    const ctx = buildPipelineContext(makeState(), sessionCwd, worktreePath);
    const section = getWorktreeCreationSection(ctx);

    // The path should appear exactly once and in the right place
    // Note: the source uses markdown `**Worktree Path:**` so the actual
    // substring is `Worktree Path:** \`...\`` (no space between `:` and `**`).
    expect(section).toContain(`Worktree Path:** \`${worktreePath}\``);
    expect(section).toContain("YOUR WORKING DIRECTORY");
    // No doubled suffix
    expect(section).not.toContain("-worktrees-worktrees");
    expect(section).not.toContain("/pi-ralplan-worktrees/test-idea-worktrees");
  });

  it("REGRESSION: when directory IS the worktree path (the bug), resolveWorktreeRoot still produces a doubled suffix (proving the bug exists at the function level)", () => {
    // This documents the bug at the function level: resolveWorktreeRoot is a
    // pure function that adds -worktrees. If you pass it a worktree path, you
    // get a doubled suffix. The fix is in the caller (buildPipelineContext),
    // not in resolveWorktreeRoot itself.
    const worktreePath = "/Users/applesucks/dev/pi-ralplan-worktrees/test-idea";
    const result = resolveWorktreeRoot(worktreePath);
    expect(result).toBe(
      "/Users/applesucks/dev/pi-ralplan-worktrees/test-idea-worktrees",
    );
  });

  it("REGRESSION: when directory is the original repo, resolveWorktreeRoot produces the correct worktree root (no doubling)", () => {
    // Sanity check: the helper is correct when given the right input.
    const result = resolveWorktreeRoot("/Users/applesucks/dev/pi-ralplan");
    expect(result).toBe("/Users/applesucks/dev/pi-ralplan-worktrees");
  });
});
