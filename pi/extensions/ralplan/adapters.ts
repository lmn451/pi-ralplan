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
  getBrainstormExpansionPrompt,
  getBrainstormResumePrompt,
  getBrainstormSteeringPrompt,
  RALPLAN_COMPLETION_SIGNAL,
  EXECUTION_COMPLETION_SIGNAL,
  RALPH_COMPLETION_SIGNAL,
  QA_COMPLETION_SIGNAL,
} from "./prompts.js";
import {
  formatDate,
  generatePlanFilename,
  generateSpecFilename,
} from "./naming.js";
import { createWorktreeForRalplan } from "./worktree.js";
import { resolveWorktreeRoot } from "./utils.js";

export { RALPLAN_COMPLETION_SIGNAL };
export { EXECUTION_COMPLETION_SIGNAL };
export { RALPH_COMPLETION_SIGNAL };
export { QA_COMPLETION_SIGNAL };

/** Generate worktree name from idea */
export function generateWorktreeName(idea: string): string {
  // Sanitize and truncate for worktree name
  const sanitized = idea
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return sanitized || "plan";
}

export function getWorktreeCreationSection(context: PipelineContext): string {
  const worktreeName = generateWorktreeName(context.idea);
  const worktreeRoot = resolveWorktreeRoot(context.directory || ".");

  return `
### Worktree Creation

Before planning begins, a new Git worktree will be created for this plan.

- **Worktree Name:** \`${worktreeName}\`
- **Worktree Path:** \`${worktreeRoot}/${worktreeName}\`
- **Base Branch:** main (configurable)

The worktree isolates this plan's work from the main repository.

**YOUR WORKING DIRECTORY:** \`${worktreeRoot}/${worktreeName}\`
All planning artifacts (spec, plan, open-questions, answers) MUST be saved relative to this directory.
Do NOT save any files in the original repository directory.
`;
}

/** Get date-based filename section */
export function getDateBasedNamingSection(): string {
  const today = formatDate();
  return `
### Date-Based Naming

Plan and spec files use human-readable date-based filenames:
- Spec: \`spec-${today}-{short-description}.md\`
- Plan: \`plan-${today}-{short-description}.md\`

This ensures easy navigation and historical tracking.
`;
}

/** Get ADR template section */
function getADRSection(): string {
  return `
### Architecture Decision Record (ADR)

The plan artifact MUST include an ADR section that captures the full planning flow:

\`\`\`markdown
## Architecture Decision Record

### Open Questions
- [ ] **Question** — Why it matters

### Plan Iterations
- **Iteration N**: Title
  - Description of architect/critic feedback
  - Status: pending/approved/rejected

### Tradeoffs Discussed
- **Tradeoff Title**
  - Options considered:
    - Option A
    - Option B
  - Rejected alternatives:
    - ✗ Rejected option
  - Decision: Why this choice

### Architect Reviews
- **Review Title** [status]
  - Feedback: Architect's technical assessment

### Critic Reviews
- **Review Title** [status]
  - Feedback: Critic's challenge points

### Decisions
- **Decision Title** — Description [status: pending/approved/rejected]

### Approvals
- ✓ **Approved Item** by [author] at [timestamp]

### Rejections
- ✗ **Rejected Item** by [author]: [reason]
\`\`\`

Track all iterations, tradeoffs, reviews, decisions, approvals, and rejections.
`;
}

export const ralplanAdapter: PipelineStageAdapter = {
  id: "ralplan",
  name: "Planning (RALPLAN)",
  completionSignal: RALPLAN_COMPLETION_SIGNAL,

  shouldSkip(config: PipelineConfig): boolean {
    return config.planning === false;
  },

  // Note: worktree creation is handled in index.ts command handlers
  // to properly store the path in state
  onEnter(_context: PipelineContext): void {
    // Worktree is created in /ralplan or /brainstorm command handlers
  },

  getPrompt(context: PipelineContext): string {
    // Brainstorm mode dispatch
    if (context.mode === "brainstorm") {
      const sub = context.brainstorm?.subPhase ?? "expanding";
      switch (sub) {
        case "expanding":
          return getBrainstormExpansionPrompt(context);
        case "awaiting-answers":
          // Steering prompt to keep AI from going off-track
          return getBrainstormSteeringPrompt();
        case "planning":
          return getBrainstormResumePrompt(context);
        default:
          return getBrainstormExpansionPrompt(context);
      }
    }

    // Existing ralplan mode
    if (context.config.planning === "ralplan") {
      const basePrompt = getConsensusPlanningPrompt(context);
      return (
        getWorktreeCreationSection(context) +
        getDateBasedNamingSection() +
        getADRSection() +
        "\n---\n\n" +
        basePrompt
      );
    }

    // Direct planning mode
    const specPath = context.specPath || "plans/spec.md";
    const planPath = context.planPath || "plans/plan.md";
    return (
      getWorktreeCreationSection(context) +
      getDateBasedNamingSection() +
      getADRSection() +
      `
---

## PLANNING (Direct)

Your task: Expand the idea into a spec and create an implementation plan.

**Original Idea:** "${context.idea}"

### Part 1: Idea Expansion

Read the spec or create one at \`${specPath}\`

### Part 2: Direct Planning

${getDirectPlanningPrompt(specPath, planPath, context.config.verification !== false ? context.config.verification.maxIterations : 100)}

Save the plan to: \`${planPath}\`

### Completion

When both the spec AND the plan are complete:

Signal: ${RALPLAN_COMPLETION_SIGNAL}`
    );
  },
};

export const executionAdapter: PipelineStageAdapter = {
  id: "execution",
  name: "Execution",
  completionSignal: EXECUTION_COMPLETION_SIGNAL,

  shouldSkip(): boolean {
    return false;
  },

  onEnter(context: PipelineContext): void {
    // Only create worktree if not already created (e.g., via /ralplan command)
    if (context.worktreePath) return;

    // Create worktree when entering execution stage (lazy creation)
    const result = createWorktreeForRalplan(
      context.directory || ".",
      context.idea,
    );
    if (result.success && result.path) {
      context.worktreePath = result.path;
      console.log(
        `[ralplan] Worktree created at execution entry: ${result.path}`,
      );
    } else {
      console.warn(`[ralplan] Worktree creation failed: ${result.error}`);
    }
  },

  getPrompt(context: PipelineContext): string {
    const planPath = context.planPath || "plans/plan.md";
    const cwdNote =
      context.cwd !== context.directory
        ? `\n\n**Working Directory:** All work MUST happen in \`${context.cwd}\`.\n`
        : "\n";
    return (
      getExecutionPrompt(planPath, context.config.execution === "team") +
      cwdNote
    );
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
    const specPath = context.specPath || "plans/spec.md";
    const maxIterations =
      context.config.verification !== false
        ? context.config.verification.maxIterations
        : 100;
    const cwdNote =
      context.cwd !== context.directory
        ? `\n\n**Working Directory:** All verification MUST happen in \`${context.cwd}\`.\n`
        : "\n";
    return getRalphPrompt(specPath, maxIterations) + cwdNote;
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
