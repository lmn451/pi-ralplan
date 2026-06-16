import { escapeForPrompt, resolvePlansDir } from "./utils.js";
import type { PipelineContext } from "./pipeline.js";
import { BRAINSTORM_OPEN_QUESTIONS_READY } from "./signals.js";
import { formatAnswersForPrompt, sanitizeForPrompt } from "./brainstorm.js";

export const RALPLAN_COMPLETION_SIGNAL = "PIPELINE_RALPLAN_COMPLETE";
export const EXECUTION_COMPLETION_SIGNAL = "PIPELINE_EXECUTION_COMPLETE";
export const RALPH_COMPLETION_SIGNAL = "PIPELINE_RALPH_COMPLETE";
export const QA_COMPLETION_SIGNAL = "PIPELINE_QA_COMPLETE";

/** Generate the expansion phase prompt (Phase 0) */
export function getExpansionPrompt(
  idea: string,
  specPath: string,
  openQuestionsPath?: string,
): string {
  const oqPath = openQuestionsPath || "plans/open-questions.md";
  return `## IDEA EXPANSION

Your task: Expand this product idea into detailed requirements and technical spec.

**Original Idea:** "${escapeForPrompt(idea)}"

### Step 1: Spawn Analyst Agent for Requirements

Spawn an agent with the **Analyst** role to extract requirements:

**Analyst Task: REQUIREMENTS ANALYSIS**
- Functional requirements (what it must do)
- Non-functional requirements (performance, UX, etc.)
- Implicit requirements (things user didn't say but needs)
- Out of scope items

Output as structured markdown with clear sections.

WAIT for the Analyst agent to complete before proceeding.

### Step 2: Spawn Architect Agent for Technical Spec

After the Analyst completes, spawn an agent with the **Architect** role:

**Architect Task: TECHNICAL SPECIFICATION**
Based on the requirements analysis above, create:
1. Tech stack decisions with rationale
2. Architecture overview (patterns, layers)
3. File structure (directory tree)
4. Dependencies list (packages)
5. API/interface definitions

Output as structured markdown.

### Step 2.5: Persist Open Questions
### Step 2.5: Persist Open Questions

If the Analyst output includes a \`## Open Questions\` section, extract those items and save them to \`plans/open-questions.md\` using the standard format:

\`\`\`
## [Topic] - [Date]
- [ ] [Question] — [Why it matters]
\`\`\`

The Analyst is read-only and cannot write files, so you must persist its open questions on its behalf.

Save to: \`${oqPath}\`

### Step 3: Save Combined Spec

Combine Analyst requirements + Architect technical spec into a single document.
Save to: \`${specPath}\`

### Step 4: Signal Completion

When the spec is saved, signal: EXPANSION_COMPLETE`;
}

/** Generate the direct planning prompt */
export function getDirectPlanningPrompt(
  specPath: string,
  planPath: string,
  maxIterations: number = 100,
): string {
  return `## DIRECT PLANNING

The spec is complete. Create implementation plan directly.

### Step 1: Read Spec

Read the specification at: ${specPath}

### Step 2: Create Plan via Architect

Spawn an agent with the **Architect** role to create the implementation plan:

**Architect Task: CREATE IMPLEMENTATION PLAN**
Read the specification at: ${specPath}

Generate a comprehensive implementation plan with:

1. **Task Breakdown**
   - Each task must be atomic (one clear deliverable)
   - Include file paths for each task
   - Estimate complexity (simple/medium/complex)

2. **Dependency Graph**
   - Which tasks depend on others
   - Optimal execution order
   - Tasks that can run in parallel

3. **Acceptance Criteria**
   - Testable criteria for each task
   - Definition of done

4. **Risk Register**
   - Identified risks
   - Mitigation strategies

Save to: ${planPath}
Signal completion with: PLAN_CREATED

### Step 3: Validate Plan via Critic

After the Architect creates the plan, spawn an agent with the **Critic** role:

**Critic Task: REVIEW IMPLEMENTATION PLAN**
Plan file: ${planPath}
Original spec: ${specPath}

Verify:
1. All requirements from spec have corresponding tasks
2. No ambiguous task descriptions
3. Acceptance criteria are testable
4. Dependencies are correctly identified
5. Risks are addressed

Verdict: OKAY or REJECT with specific issues
)
\`\`\`

### Iteration Loop

If Critic rejects, feed feedback back to Architect and retry (up to ${maxIterations} iterations).

When Critic approves: PLANNING_COMPLETE`;
}

/** Generate the execution phase prompt */
export function getExecutionPrompt(planPath: string, isTeam: boolean): string {
  if (isTeam) {
    return `## EXECUTION (Team Mode)

Execute the implementation plan using multi-worker team execution.

### Setup

Read the implementation plan at: \`${planPath}\`

### Team Execution

Use separate agents to execute tasks in parallel where possible:

1. **Create tasks** from the implementation plan
2. **Spawn executor agents** for independent tasks
3. **Monitor progress** as agents complete tasks
4. **Coordinate** dependencies between tasks

### Output Contract

Every spawned agent response must stay concise: return ONLY a short execution summary under 100 words covering what changed, files touched, verification status, and blockers. Store bulky logs/details in files or artifacts and reference them briefly.

### Agent Selection

Match agent types to task complexity:
- Simple tasks (single file, config): spawn with lightweight model
- Standard implementation: spawn with capable model
- Complex work (architecture, refactoring): spawn with strongest model
- Build issues: spawn debugger agent
- Test creation: spawn test engineer agent

### Progress Tracking

Track progress through the task list:
- Mark tasks in_progress when starting
- Mark tasks completed when verified
- Add discovered tasks as they emerge

### Completion

When ALL tasks from the plan are implemented:

Signal: ${EXECUTION_COMPLETION_SIGNAL}`;
  }

  return `## EXECUTION (Solo Mode)

Execute the implementation plan using single-session execution.

### Setup

Read the implementation plan at: \`${planPath}\`

### Solo Execution

Execute tasks sequentially (or with limited parallelism via background agents):

1. Read and understand each task from the plan
2. Execute tasks in dependency order
3. Use separate agents for independent tasks that can run in parallel
4. Track progress in a TODO list

### Output Contract

Every spawned agent response must return ONLY a short execution summary under 100 words covering: what changed, files touched, verification status, and blockers. Store bulky logs/details in files or artifacts and reference them briefly.

### Progress Tracking

Update TODO list as tasks complete:
- Mark task in_progress when starting
- Mark task completed when done
- Add new tasks if discovered during implementation

### Completion

When ALL tasks from the plan are implemented:

Signal: ${EXECUTION_COMPLETION_SIGNAL}`;
}

/** Generate the QA phase prompt */
export function getQAPrompt(): string {
  return `## QUALITY ASSURANCE

Run build/lint/test cycling until all checks pass.

### QA Sequence

1. **Build**: Run the project's build command:
   - JavaScript/TypeScript: \`npm run build\` (or yarn/pnpm equivalent)
   - Python: \`python -m build\` (if applicable)
   - Go: \`go build ./...\`
   - Rust: \`cargo build\`
   - Java: \`mvn compile\` or \`gradle build\`
2. **Lint**: Run the project's linter:
   - JavaScript/TypeScript: \`npm run lint\`
   - Python: \`ruff check .\` or \`flake8\`
   - Go: \`golangci-lint run\`
   - Rust: \`cargo clippy\`
3. **Test**: Run the project's tests:
   - JavaScript/TypeScript: \`npm test\`
   - Python: \`pytest\`
   - Go: \`go test ./...\`
   - Rust: \`cargo test\`
   - Java: \`mvn test\` or \`gradle test\`

### Fix Cycle

For each failure:

1. **Diagnose** - Understand the error
2. **Fix** - Apply the fix with minimal changes
3. **Re-run** - Verify the fix worked
4. **Repeat** - Until pass or max cycles (5)

### Exit Conditions

- All checks pass → Signal: ${QA_COMPLETION_SIGNAL}
- Max cycles reached → Report failures
- Same error 3 times → Escalate to user`;
}

/** Generate the ralph verification prompt */
export function getRalphPrompt(
  specPath: string,
  maxIterations: number,
): string {
  return `## VERIFICATION (RALPH)

Verify the implementation against the specification using the Ralph verification loop.

**Max Iterations:** ${maxIterations}

### Verification Process

Spawn parallel verification reviewers. Each reviewer runs as a separate agent and receives the spec and implementation to evaluate.

Each reviewer must return ONLY a concise review summary under 100 words covering verdict, evidence highlights, files checked, and blockers. Avoid dumping long logs or transcripts into the main session.

**Reviewer 1 — Functional Completeness**
Agent persona: Architect or equivalent
Read the original spec at: ${specPath}
Verify:
1. All functional requirements are implemented
2. All non-functional requirements are addressed
3. All acceptance criteria from the plan are met
4. No missing features or incomplete implementations

Verdict: APPROVE (all requirements met) or REJECTED (with specific gaps)

**Reviewer 2 — Security**
Agent persona: Security reviewer
Check the implementation for:
1. OWASP Top 10 vulnerabilities
2. Input validation and sanitization
3. Authentication/authorization issues
4. Sensitive data exposure
5. Injection vulnerabilities (SQL, command, XSS)
6. Hardcoded secrets or credentials

Verdict: APPROVE (no vulnerabilities) or REJECTED (with specific issues)

**Reviewer 3 — Code Quality**
Agent persona: Code reviewer
Review the implementation for:
1. Code organization and structure
2. Design patterns and best practices
3. Error handling completeness
4. Test coverage adequacy
5. Maintainability and readability

Verdict: APPROVE (high quality) or REJECTED (with specific issues)
### Fix and Re-verify Loop

If any reviewer rejects:
1. Collect all rejection reasons
2. Fix each issue identified
3. Re-run verification (up to ${maxIterations} iterations)

### Completion

When all reviewers approve:

Signal: ${RALPH_COMPLETION_SIGNAL}`;
}

/** RALPLAN-DR summary format for the Planner to generate */
export function getRalplanDRSummaryTemplate(context: PipelineContext): string {
  // Signals whose matching must be word-boundary (substrings cause false positives:
  // "rm" matched "format"/"charm"/"alarm"; "auth" matched "author"/"authentic".)
  const deliberateSignals = [
    "security",
    "credential",
    "secret",
    "password",
    "token",
    "migration",
    "schema",
    "database",
    "production",
    "destroy",
    "delete",
    "rm", // word-boundary checked below
    "remove", // long token, substring match is safe
    // "auth" alone is too ambiguous (matches "author"/"authentic"). Use the
    // unambiguous long forms for substring matching. "auth" as a standalone
    // word is intentionally NOT a signal.
    "authentication",
    "authorization",
    "authorized",
    "authorize",
    "authorizing",
    "compliance",
    "PII",
    "GDPR",
    "HIPAA",
    "public API",
    "breaking change",
  ];
  const idea = context.idea.toLowerCase();
  // Substring matching causes false positives for short signals
  // (charm/alarm → rm; thermostat → ?). Use word-boundary regex for short
  // signals (<=4 chars); keep substring matching for longer phrases that are
  // already unambiguous (e.g. "breaking change", "public API", "authentication").
  const SHORT_SIGNALS = new Set(["rm"]);
  const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const isDeliberate = deliberateSignals.some((s) => {
    if (SHORT_SIGNALS.has(s)) {
      return new RegExp(`\\b${escapeRegex(s)}\\b`).test(idea);
    }
    return idea.includes(s);
  });

  return `
### RALPLAN-DR Summary (REQUIRED — generate before Architect review)

**Mode:** ${isDeliberate ? "DELIBERATE (high-risk signals detected)" : "SHORT (default)"}

### Principles (3–5)
- [P1] Principle
- [P2] Principle
- [P3] Principle

### Top 3 Decision Drivers
1. [Driver name] — [why this drives the decision]
2. [Driver name] — [why this drives the decision]
3. [Driver name] — [why this drives the decision]

### Viable Options (≥2 required)
**Option A:** [name]
- Pros: ...
- Cons: ...
**Option B:** [name]
- Pros: ...
- Cons: ...

*(If only 1 option: explicit invalidation of alternatives)*

${
  isDeliberate
    ? `### Pre-Mortem (3 failure scenarios)
- **Scenario 1:** [How it fails] → Mitigation: [...]
- **Scenario 2:** [How it fails] → Mitigation: [...]
- **Scenario 3:** [How it fails] → Mitigation: [...]

### Expanded Test Plan
- Unit tests: [...]
- Integration tests: [...]
- E2E tests: [...]
- Observability: [...]`
    : ""
}
`;
}

/** Generate the consensus planning prompt (full ralplan mode) */
export function getConsensusPlanningPrompt(context: PipelineContext): string {
  const specPath = context.specPath || "plans/spec.md";
  const planPath = context.planPath || "plans/plan.md";

  const drSummary = getRalplanDRSummaryTemplate(context);

  return `## RALPLAN (Consensus Planning)

**BE BRIEF.** Concise reasoning, no filler.

Your task: Expand the idea into a detailed spec and implementation plan using consensus-driven planning.

**Original Idea:** "${escapeForPrompt(context.idea)}"

### Part 1: Idea Expansion (Spec Creation)

${getExpansionPrompt(context.idea, specPath, context.openQuestionsPath)}

### Part 2: Consensus Planning

After the spec is created at \`${specPath}\`, invoke the RALPLAN consensus workflow.

**HARD RULE: Each role MUST be executed by a separately invoked agent.** Do NOT simulate multiple roles in a single response. Use the available agent-spawning mechanism (separate agents, isolated contexts, etc.) to invoke each role independently. Self-approval is strictly prohibited.

**Role prompt files** (load and pass these to each spawned agent):
- **Planner**: \`/skill:ralplan/prompts/planner.md\`
- **Architect**: \`/skill:ralplan/prompts/architect.md\`
- **Critic**: \`/skill:ralplan/prompts/critic.md\`

1. **Planner** → Spawn an agent with the Planner role prompt. Pass it the spec at \`${specPath}\`. It produces a plan draft at \`plans/drafts/plan_draft.md\` with RALPLAN-DR Summary.
2. **Architect** → Spawn an agent with the Architect role prompt. It reads \`plans/drafts/plan_draft.md\` and produces \`plans/drafts/architect_review.md\` with verdict \`APPROVE\` | \`REVISION NEEDED\`.
   **SEQUENTIAL**: Wait for Architect to complete before spawning Critic. Do NOT run in parallel.
3. **Critic** → Spawn an agent with the Critic role prompt. It reads \`plans/drafts/plan_draft.md\` and \`plans/drafts/architect_review.md\`, produces \`plans/drafts/critic_review.md\` with verdict \`APPROVE\` | \`ITERATE\` | \`REJECT\`.
4. **Iteration**: Any non-APPROVE Critic verdict → loop back to step 1 with feedback from Architect + Critic. Max 5 iterations.


### Architect Review: SEQUENTIAL

Do NOT run Architect and Critic in parallel. Wait for Architect's full verdict before spawning Critic.

Architect verdict: \`APPROVE\` | \`REVISION NEEDED\`

### Critic Review

Critic verdict: \`APPROVE\` | \`ITERATE\` | \`REJECT\`

Critic MUST enforce:
- Principle-option consistency
- Fair alternatives (no shallow rejections)
- Risk mitigation clarity
- Testable acceptance criteria
- DELIBERATE mode: Reject missing pre-mortem or expanded test plan

### Iteration Loop (max 5)

Any non-APPROVE verdict → Planner revises → Architect reviews (SEQUENTIAL) → Critic evaluates → repeat.

### Final Plan ADR Format

When Critic approves, save \`${planPath}\` with this ADR section:

\`\`\`markdown
## Architecture Decision Record (ADR)

### Decision
[One-sentence decision statement]

### Drivers
- [Driver 1]
- [Driver 2]

### Alternatives Considered
- **Option A** — rejected because [reason]
- **Option B** — rejected because [reason]

### Why Chosen
[Paragraph explaining why this path was selected]

### Consequences
- **Positive:** [Benefits]
- **Negative:** [Trade-offs and risks]

### Follow-ups
- [ ] [Follow-up action]
\`\`\`

### Completion

When both the spec AND the consensus plan are complete and approved:

Signal: ${RALPLAN_COMPLETION_SIGNAL}`;
}

/** Generate the brainstorm expansion prompt (expanding sub-phase) */
export function getBrainstormExpansionPrompt(context: PipelineContext): string {
  const specPath = context.specPath || "plans/spec.md";
  const openQuestionsPath =
    context.openQuestionsPath || "plans/open-questions.md";

  return `## BRAINSTORM — Idea Expansion

Your task: Expand the idea into requirements and identify **open questions** that only the user can answer.

**Original Idea:** "${escapeForPrompt(context.idea)}"

### Step 1: Requirements Analysis

Spawn an agent with the **Analyst** role to extract functional and non-functional requirements.

### Step 2: Identify Open Questions

The Analyst MUST produce a \`## Open Questions\` section. For each question:
- Why it matters
- What decision is blocked until answered

### Step 3: Persist Questions

Save the open questions to: \`${openQuestionsPath}\` using this format:

\`\`\`markdown
## Open Questions — Date
- [ ] **Q:** [Question text]
  **Why:** [Why it matters]
\`\`\`

### Step 4: Signal

When questions are saved, output exactly:
${BRAINSTORM_OPEN_QUESTIONS_READY}

**IMPORTANT:** Do NOT proceed to consensus planning. Do NOT answer the open questions yourself. Stop and wait for the user.`;
}

/** Generate the brainstorm steering prompt (awaiting-answers sub-phase) */
export function getBrainstormSteeringPrompt(): string {
  return `## Brainstorm: Awaiting User Answers

The user is answering brainstorm questions. Acknowledge their response briefly. Do NOT implement, plan, or take action. Wait for the user to use /ralplan:done-answering to proceed, or /ralplan:skip-questions to skip.`;
}

/** Generate the brainstorm resume prompt (planning sub-phase) */
export function getBrainstormResumePrompt(context: PipelineContext): string {
  const specPath = context.specPath || "plans/spec.md";
  const planPath = context.planPath || "plans/plan.md";
  const answersBlock = context.brainstorm
    ? formatAnswersForPrompt(context.brainstorm.answers)
    : "";

  return `## BRAINSTORM — Continue Planning

The user has provided answers to the open questions.

**Original Idea:** "${escapeForPrompt(context.idea)}"

${answersBlock || "No specific answers were provided. Proceed with best-effort planning."}

### Your Task

1. Read the answers above.
2. Continue expanding the idea into a full spec at \`${specPath}\`.
3. Proceed with consensus planning (Planner → Architect → Critic).
4. Save the plan to: \`${planPath}\`

### Completion

When both the spec AND the consensus plan are complete and approved:

Signal: PIPELINE_RALPLAN_COMPLETE`;
}

/** Generate the brainstorm awaiting prompt (user-facing, not an AI prompt) */
export function getBrainstormAwaitingPrompt(questions: string[]): string {
  const questionList = questions.map((q, i) => `${i + 1}. **${q}**`).join("\n");

  return `## 🧠 Brainstorm — Awaiting Your Input

I've identified some open questions to help me plan better:

${questionList}

Please reply with your answers naturally. You can answer all at once or in separate messages.

When you're done answering, use /ralplan:done-answering to proceed to planning.
If you'd like to skip the questions, use /ralplan:skip-questions.`;
}

/** Generate a stage transition prompt */
export function getTransitionPrompt(
  fromStage: string,
  toStage: string | "complete",
): string {
  if (toStage === "complete") {
    return `## PIPELINE COMPLETE

All pipeline stages have completed successfully!
`;
  }

  return `## PIPELINE STAGE TRANSITION: ${fromStage.toUpperCase()} -> ${toStage.toUpperCase()}

The ${fromStage} stage is complete. Transitioning to: **${toStage}**

`;
}
