import { describe, it, expect } from "vitest";
import {
  buildPipelineTracking,
  DEFAULT_PIPELINE_CONFIG,
  type PipelineContext,
} from "../pi/extensions/ralplan/pipeline.js";
import {
  generateWorktreeName,
  getWorktreeCreationSection,
  getDateBasedNamingSection,
} from "../pi/extensions/ralplan/adapters.js";
import { resolveWorktreeRoot } from "../pi/extensions/ralplan/utils.js";

function createMockContext(
  idea: string,
  directory = "/tmp/test-worktree",
): PipelineContext {
  return {
    idea,
    directory,
    cwd: directory,
    specPath: `${directory}/plans/spec.md`,
    planPath: `${directory}/plans/plan.md`,
    openQuestionsPath: `${directory}/plans/open-questions.md`,
    config: buildPipelineTracking(DEFAULT_PIPELINE_CONFIG).pipelineConfig,
    mode: "ralplan",
  };
}

describe("generateWorktreeName", () => {
  it("converts idea to lowercase slug", () => {
    expect(generateWorktreeName("My Test Plan")).toBe("my-test-plan");
  });

  it("replaces spaces with hyphens", () => {
    expect(generateWorktreeName("hello world test")).toBe("hello-world-test");
  });

  it("removes special characters", () => {
    expect(generateWorktreeName("Plan #1: Build API!")).toBe(
      "plan-1-build-api",
    );
  });

  it("trims leading and trailing hyphens", () => {
    expect(generateWorktreeName("  leading and trailing  ")).toBe(
      "leading-and-trailing",
    );
  });

  it("truncates to 40 characters", () => {
    const longIdea = "a".repeat(50);
    expect(generateWorktreeName(longIdea)).toHaveLength(40);
  });

  it("returns 'plan' for empty string", () => {
    expect(generateWorktreeName("")).toBe("plan");
  });

  it("handles mixed special characters", () => {
    expect(generateWorktreeName("Test@#$%^&*()Plan")).toBe("test-plan");
  });
});

describe("getWorktreeCreationSection", () => {
  it("includes worktree name in output", () => {
    const context = createMockContext("My Test Plan");
    const section = getWorktreeCreationSection(context);
    expect(section).toContain("**Worktree Name:** `my-test-plan`");
  });

  it("includes worktree path in output", () => {
    const context = createMockContext("My Test Plan", "/tmp/test-worktree");
    const section = getWorktreeCreationSection(context);
    const worktreeRoot = resolveWorktreeRoot("/tmp/test-worktree");
    expect(section).toContain(
      `**Worktree Path:** \`${worktreeRoot}/my-test-plan\``,
    );
  });

  it("includes working directory instruction", () => {
    const context = createMockContext("My Test Plan");
    const section = getWorktreeCreationSection(context);
    expect(section).toContain("**YOUR WORKING DIRECTORY:**");
  });

  it("mentions worktree isolation", () => {
    const context = createMockContext("My Test Plan");
    const section = getWorktreeCreationSection(context);
    expect(section).toContain("worktree isolates");
  });

  it("includes base branch information", () => {
    const context = createMockContext("My Test Plan");
    const section = getWorktreeCreationSection(context);
    expect(section).toContain("**Base Branch:** main");
  });
});

describe("getDateBasedNamingSection", () => {
  it("includes date-based naming header", () => {
    const section = getDateBasedNamingSection();
    expect(section).toContain("### Date-Based Naming");
  });

  it("mentions spec filename pattern", () => {
    const section = getDateBasedNamingSection();
    expect(section).toContain("spec-");
  });

  it("mentions plan filename pattern", () => {
    const section = getDateBasedNamingSection();
    expect(section).toContain("plan-");
  });

  it("mentions date-based filenames", () => {
    const section = getDateBasedNamingSection();
    expect(section).toContain("human-readable date-based filenames");
  });
});
