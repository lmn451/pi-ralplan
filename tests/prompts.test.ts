import { describe, it, expect } from "vitest";
import {
  getExpansionPrompt,
  getDirectPlanningPrompt,
  getConsensusPlanningPrompt,
  getRalplanDRSummaryTemplate,
} from "../pi/extensions/ralplan/prompts.js";
import {
  buildPipelineTracking,
  DEFAULT_PIPELINE_CONFIG,
} from "../pi/extensions/ralplan/pipeline.js";

const specPath = "/tmp/worktree/plans/spec-2026-05-18-demo.md";
const planPath = "/tmp/worktree/plans/plan-2026-05-18-demo.md";

describe("prompts use dynamic artifact paths", () => {
  it("uses the provided spec path in the expansion prompt", () => {
    const prompt = getExpansionPrompt(
      "demo",
      specPath,
      "/tmp/worktree/plans/open-questions.md",
    );
    expect(prompt).toContain(`Save to: \`${specPath}\``);
    expect(prompt).not.toContain("Save to: `plans/spec.md`");
  });

  it("uses the provided plan path in the direct planning prompt", () => {
    const prompt = getDirectPlanningPrompt(specPath, planPath);
    expect(prompt).toContain(`Save to: ${planPath}`);
    expect(prompt).toContain(`Plan file: ${planPath}`);
    expect(prompt).not.toContain("plans/plan.md");
  });

  it("threads dynamic paths through the consensus prompt", () => {
    const prompt = getConsensusPlanningPrompt({
      idea: "demo",
      directory: "/tmp/worktree",
      cwd: "/tmp/worktree",
      specPath,
      planPath,
      openQuestionsPath: "/tmp/worktree/plans/open-questions.md",
      config: buildPipelineTracking(DEFAULT_PIPELINE_CONFIG).pipelineConfig,
      mode: "ralplan",
    });

    expect(prompt).toContain(`After the spec is created at \`${specPath}\``);
    expect(prompt).toContain(`save \`${planPath}\` with this ADR section`);
  });
});

describe("RALPLAN-DR summary template", () => {
  it("generates RALPLAN-DR summary with required sections", () => {
    const prompt = getRalplanDRSummaryTemplate({
      idea: "add user authentication",
      directory: "/tmp/worktree",
      cwd: "/tmp/worktree",
      config: buildPipelineTracking(DEFAULT_PIPELINE_CONFIG).pipelineConfig,
      mode: "ralplan",
    });

    expect(prompt).toContain("RALPLAN-DR Summary");
    expect(prompt).toContain("Principles");
    expect(prompt).toContain("Decision Drivers");
    expect(prompt).toContain("Viable Options");
  });

  it("detects DELIBERATE mode for security-related ideas", () => {
    const prompt = getRalplanDRSummaryTemplate({
      idea: "add JWT authentication",
      directory: "/tmp/worktree",
      cwd: "/tmp/worktree",
      config: buildPipelineTracking(DEFAULT_PIPELINE_CONFIG).pipelineConfig,
      mode: "ralplan",
    });

    expect(prompt).toContain("DELIBERATE");
    expect(prompt).toContain("Pre-Mortem");
    expect(prompt).toContain("Expanded Test Plan");
    // "auth" keyword in "JWT authentication" triggers DELIBERATE
    expect(prompt).toContain("DELIBERATE (high-risk signals detected)");
  });

  it("detects DELIBERATE mode for migration ideas", () => {
    const prompt = getRalplanDRSummaryTemplate({
      idea: "database migration to postgres",
      directory: "/tmp/worktree",
      cwd: "/tmp/worktree",
      config: buildPipelineTracking(DEFAULT_PIPELINE_CONFIG).pipelineConfig,
      mode: "ralplan",
    });

    expect(prompt).toContain("DELIBERATE");
    expect(prompt).toContain("Pre-Mortem");
    expect(prompt).toContain("DELIBERATE (high-risk signals detected)");
  });

  // Word-boundary regression tests for short signals (T-2 / T-3):
  // substring matching caused false positives (charm → rm, author → auth).
  it("does NOT trigger DELIBERATE for 'charm' (no 'rm' word)", () => {
    const prompt = getRalplanDRSummaryTemplate({
      idea: "add a lucky charm to the dashboard",
      directory: "/tmp/worktree",
      cwd: "/tmp/worktree",
      config: buildPipelineTracking(DEFAULT_PIPELINE_CONFIG).pipelineConfig,
      mode: "ralplan",
    });
    expect(prompt).toContain("SHORT (default)");
    expect(prompt).not.toContain("Pre-Mortem");
  });

  it("does NOT trigger DELIBERATE for 'alarm' (no 'rm' word)", () => {
    const prompt = getRalplanDRSummaryTemplate({
      idea: "configure the morning alarm clock",
      directory: "/tmp/worktree",
      cwd: "/tmp/worktree",
      config: buildPipelineTracking(DEFAULT_PIPELINE_CONFIG).pipelineConfig,
      mode: "ralplan",
    });
    expect(prompt).toContain("SHORT (default)");
  });

  it("does NOT trigger DELIBERATE for 'format' (no 'rm' word)", () => {
    const prompt = getRalplanDRSummaryTemplate({
      idea: "format the date as ISO",
      directory: "/tmp/worktree",
      cwd: "/tmp/worktree",
      config: buildPipelineTracking(DEFAULT_PIPELINE_CONFIG).pipelineConfig,
      mode: "ralplan",
    });
    expect(prompt).toContain("SHORT (default)");
  });

  it("does NOT trigger DELIBERATE for 'author' (auth prefix only, not author)", () => {
    const prompt = getRalplanDRSummaryTemplate({
      idea: "add the author bio to the article page",
      directory: "/tmp/worktree",
      cwd: "/tmp/worktree",
      config: buildPipelineTracking(DEFAULT_PIPELINE_CONFIG).pipelineConfig,
      mode: "ralplan",
    });
    expect(prompt).toContain("SHORT (default)");
  });

  it("DOES trigger DELIBERATE for 'authorize' (auth prefix)", () => {
    const prompt = getRalplanDRSummaryTemplate({
      idea: "authorize users via OAuth",
      directory: "/tmp/worktree",
      cwd: "/tmp/worktree",
      config: buildPipelineTracking(DEFAULT_PIPELINE_CONFIG).pipelineConfig,
      mode: "ralplan",
    });
    expect(prompt).toContain("DELIBERATE (high-risk signals detected)");
  });

  it("DOES trigger DELIBERATE for 'rm' as a standalone word (file deletion)", () => {
    const prompt = getRalplanDRSummaryTemplate({
      idea: "rm the old build artifacts",
      directory: "/tmp/worktree",
      cwd: "/tmp/worktree",
      config: buildPipelineTracking(DEFAULT_PIPELINE_CONFIG).pipelineConfig,
      mode: "ralplan",
    });
    expect(prompt).toContain("DELIBERATE (high-risk signals detected)");
  });

  it("DOES trigger DELIBERATE for 'remove' (newly added signal)", () => {
    const prompt = getRalplanDRSummaryTemplate({
      idea: "remove the deprecated API endpoint",
      directory: "/tmp/worktree",
      cwd: "/tmp/worktree",
      config: buildPipelineTracking(DEFAULT_PIPELINE_CONFIG).pipelineConfig,
      mode: "ralplan",
    });
    expect(prompt).toContain("DELIBERATE (high-risk signals detected)");
  });

  it("defaults to SHORT mode for simple ideas", () => {
    const prompt = getRalplanDRSummaryTemplate({
      idea: "add dark mode toggle",
      directory: "/tmp/worktree",
      cwd: "/tmp/worktree",
      config: buildPipelineTracking(DEFAULT_PIPELINE_CONFIG).pipelineConfig,
      mode: "ralplan",
    });

    expect(prompt).toContain("SHORT");
    expect(prompt).not.toContain("Pre-Mortem");
    expect(prompt).not.toContain("Expanded Test Plan");
  });

  it("requires at least 2 viable options", () => {
    const prompt = getRalplanDRSummaryTemplate({
      idea: "add caching layer",
      directory: "/tmp/worktree",
      cwd: "/tmp/worktree",
      config: buildPipelineTracking(DEFAULT_PIPELINE_CONFIG).pipelineConfig,
      mode: "ralplan",
    });

    expect(prompt).toContain("≥2");
    expect(prompt).toContain("Option A");
    expect(prompt).toContain("Option B");
    expect(prompt).toContain("Pros");
    expect(prompt).toContain("Cons");
  });
});

describe("RALPLAN consensus prompt — new behavior", () => {
  it("includes BE BRIEF directive", () => {
    const prompt = getConsensusPlanningPrompt({
      idea: "add feature",
      directory: "/tmp/worktree",
      cwd: "/tmp/worktree",
      config: buildPipelineTracking(DEFAULT_PIPELINE_CONFIG).pipelineConfig,
      mode: "ralplan",
    });

    expect(prompt).toContain("BE BRIEF");
    expect(prompt).toContain("Concise reasoning");
  });

  it("includes SEQUENTIAL requirement for Architect then Critic", () => {
    const prompt = getConsensusPlanningPrompt({
      idea: "add feature",
      directory: "/tmp/worktree",
      cwd: "/tmp/worktree",
      config: buildPipelineTracking(DEFAULT_PIPELINE_CONFIG).pipelineConfig,
      mode: "ralplan",
    });

    expect(prompt).toContain("SEQUENTIAL");
    expect(prompt).toContain("Do NOT run Architect and Critic in parallel");
    expect(prompt).toContain(
      "Wait for Architect to complete before spawning Critic",
    );
  });

  it("includes REVISION NEEDED as architect verdict option", () => {
    const prompt = getConsensusPlanningPrompt({
      idea: "add feature",
      directory: "/tmp/worktree",
      cwd: "/tmp/worktree",
      config: buildPipelineTracking(DEFAULT_PIPELINE_CONFIG).pipelineConfig,
      mode: "ralplan",
    });

    expect(prompt).toContain("REVISION NEEDED");
  });

  it("includes full ADR format on completion", () => {
    const prompt = getConsensusPlanningPrompt({
      idea: "add feature",
      directory: "/tmp/worktree",
      cwd: "/tmp/worktree",
      config: buildPipelineTracking(DEFAULT_PIPELINE_CONFIG).pipelineConfig,
      mode: "ralplan",
    });

    expect(prompt).toContain("### Decision");
    expect(prompt).toContain("### Drivers");
    expect(prompt).toContain("### Alternatives Considered");
    expect(prompt).toContain("### Why Chosen");
    expect(prompt).toContain("### Consequences");
    expect(prompt).toContain("### Follow-ups");
  });

  it("mentions save to drafts path for plan draft", () => {
    const prompt = getConsensusPlanningPrompt({
      idea: "add feature",
      directory: "/tmp/worktree",
      cwd: "/tmp/worktree",
      specPath: "plans/spec.md",
      planPath: "plans/plan.md",
      config: buildPipelineTracking(DEFAULT_PIPELINE_CONFIG).pipelineConfig,
      mode: "ralplan",
    });

    expect(prompt).toContain("plans/drafts/plan_draft.md");
  });

  it("includes iteration loop with max 5", () => {
    const prompt = getConsensusPlanningPrompt({
      idea: "add feature",
      directory: "/tmp/worktree",
      cwd: "/tmp/worktree",
      config: buildPipelineTracking(DEFAULT_PIPELINE_CONFIG).pipelineConfig,
      mode: "ralplan",
    });

    expect(prompt).toContain("max 5");
    expect(prompt).toContain("non-APPROVE");
  });

  it("includes deliberate mode reject criteria for Critic", () => {
    const prompt = getRalplanDRSummaryTemplate({
      idea: "add security audit",
      directory: "/tmp/worktree",
      cwd: "/tmp/worktree",
      config: buildPipelineTracking(DEFAULT_PIPELINE_CONFIG).pipelineConfig,
      mode: "ralplan",
    });

    // The DELIBERATE signal is present when security keyword detected
    expect(prompt).toContain("DELIBERATE");

    const consensusPrompt = getConsensusPlanningPrompt({
      idea: "add security audit",
      directory: "/tmp/worktree",
      cwd: "/tmp/worktree",
      config: buildPipelineTracking(DEFAULT_PIPELINE_CONFIG).pipelineConfig,
      mode: "ralplan",
    });

    expect(consensusPrompt).toContain("Reject missing pre-mortem");
    expect(consensusPrompt).toContain("DELIBERATE mode");
  });
});
