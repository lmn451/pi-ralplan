import type {
  PipelineStageAdapter,
  PipelineConfig,
  PipelineContext,
} from "./pipeline.js";
import {
  getConsensusPlanningPrompt,
  getDirectPlanningPrompt,
  getExecutionPrompt,
  getRalphPrompt,
  getQAPrompt,
  RALPLAN_COMPLETION_SIGNAL,
  EXECUTION_COMPLETION_SIGNAL,
  RALPH_COMPLETION_SIGNAL,
  QA_COMPLETION_SIGNAL,
} from "./prompts.js";

export { RALPLAN_COMPLETION_SIGNAL };
export { EXECUTION_COMPLETION_SIGNAL };
export { RALPH_COMPLETION_SIGNAL };
export { QA_COMPLETION_SIGNAL };

export const ralplanAdapter: PipelineStageAdapter = {
  id: "ralplan",
  name: "Planning (RALPLAN)",
  completionSignal: RALPLAN_COMPLETION_SIGNAL,

  shouldSkip(config: PipelineConfig): boolean {
    return config.planning === false;
  },

  getPrompt(context: PipelineContext): string {
    if (context.config.planning === "ralplan") {
      return getConsensusPlanningPrompt(context);
    }
    // Direct planning mode
    const specPath = context.specPath || ".pi/ralplan/plans/spec.md";
    const planPath = context.planPath || ".pi/ralplan/plans/plan.md";
    return `## PLANNING (Direct)

Your task: Expand the idea into a spec and create an implementation plan.

**Original Idea:** "${context.idea}"

### Part 1: Idea Expansion

Read the spec or create one at \`${specPath}\`

### Part 2: Direct Planning

${getDirectPlanningPrompt(specPath)}

Save the plan to: \`${planPath}\`

### Completion

When both the spec AND the plan are complete:

Signal: ${RALPLAN_COMPLETION_SIGNAL}`;
  },
};

export const executionAdapter: PipelineStageAdapter = {
  id: "execution",
  name: "Execution",
  completionSignal: EXECUTION_COMPLETION_SIGNAL,

  shouldSkip(): boolean {
    return false;
  },

  getPrompt(context: PipelineContext): string {
    const planPath = context.planPath || ".pi/ralplan/plans/plan.md";
    return getExecutionPrompt(planPath, context.config.execution === "team");
  },
};

export const ralphAdapter: PipelineStageAdapter = {
  id: "ralph",
  name: "Verification (RALPH)",
  completionSignal: RALPH_COMPLETION_SIGNAL,

  shouldSkip(config: PipelineConfig): boolean {
    return config.verification === false;
  },

  getPrompt(context: PipelineContext): string {
    const specPath = context.specPath || ".pi/ralplan/plans/spec.md";
    const maxIterations =
      context.config.verification !== false
        ? context.config.verification.maxIterations
        : 100;
    return getRalphPrompt(specPath, maxIterations);
  },
};

export const qaAdapter: PipelineStageAdapter = {
  id: "qa",
  name: "Quality Assurance",
  completionSignal: QA_COMPLETION_SIGNAL,

  shouldSkip(config: PipelineConfig): boolean {
    return !config.qa;
  },

  getPrompt(): string {
    return `## QA (Quality Assurance)

Run build/lint/test cycling until all checks pass.

${getQAPrompt()}

### Completion

When all QA checks pass:

Signal: ${QA_COMPLETION_SIGNAL}`;
  },
};
