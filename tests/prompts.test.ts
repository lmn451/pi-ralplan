import { describe, it, expect } from "vitest";
import {
  getExpansionPrompt,
  getDirectPlanningPrompt,
  getConsensusPlanningPrompt,
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
    expect(prompt).toContain(
      `Save the final approved plan to: \`${planPath}\``,
    );
  });
});
