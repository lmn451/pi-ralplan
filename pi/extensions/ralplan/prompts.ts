import { escapeForPrompt, resolvePlansDir } from "./utils.js";
import type { PipelineContext } from "./pipeline.js";

export const RALPLAN_COMPLETION_SIGNAL = "PIPELINE_RALPLAN_COMPLETE";
export const EXECUTION_COMPLETION_SIGNAL = "PIPELINE_EXECUTION_COMPLETE";
export const RALPH_COMPLETION_SIGNAL = "PIPELINE_RALPH_COMPLETE";
export const QA_COMPLETION_SIGNAL = "PIPELINE_QA_COMPLETE";

/** Generate the expansion phase prompt (Phase 0) */
export function getExpansionPrompt(idea: string, openQuestionsPath?: string): string {
  const oqPath = openQuestionsPath || ".pi/ralplan/plans/open-questions.md";
  return `## IDEA EXPANSION

Your task: Expand this product idea into detailed requirements and technical spec.

**Original Idea:** "${escapeForPrompt(idea)}"

### Step 1: Spawn Analyst for Requirements

Spawn an analyst subagent to extract requirements:

\`\`\`
Task(
  agent="analyst",
  prompt="REQUIREMENTS ANALYSIS for: ${escapeForPrompt(idea)}

Extract and document:
1. Functional requirements (what it must do)
2. Non-functional requirements (performance, UX, etc.)
3. Implicit requirements (things user didn't say but needs)
4. Out of scope items

Output as structured markdown with clear sections."
)
\`\`\`

WAIT for Analyst to complete before proceeding.

### Step 2: Spawn Architect for Technical Spec

After Analyst completes, spawn Architect:

\`\`\`
Task(
  agent="architect",
  prompt="TECHNICAL SPECIFICATION for: ${escapeForPrompt(idea)}

Based on the requirements analysis above, create:
1. Tech stack decisions with rationale
2. Architecture overview (patterns, layers)
3. File structure (directory tree)
4. Dependencies list (packages)
5. API/interface definitions

Output as structured markdown."
)
\`\`\`

### Step 2.5: Persist Open Questions

If the Analyst output includes a \`### Open Questions\` section, extract those items and save them to \`.pi/ralplan/plans/open-questions.md\` using the standard format:

\`\`\`
## [Topic] - [Date]
- [ ] [Question] — [Why it matters]
\`\`\`

The Analyst is read-only and cannot write files, so you must persist its open questions on its behalf.

Save to: \`${oqPath}\`

### Step 3: Save Combined Spec

Combine Analyst requirements + Architect technical spec into a single document.
Save to: \`.pi/ralplan/plans/spec.md\`

### Step 4: Signal Completion

When the spec is saved, signal: EXPANSION_COMPLETE`;
}

/** Generate the direct planning prompt */
export function getDirectPlanningPrompt(specPath: string): string {
  return `## DIRECT PLANNING

The spec is complete. Create implementation plan directly.

### Step 1: Read Spec

Read the specification at: ${specPath}

### Step 2: Create Plan via Architect

Spawn Architect to create the implementation plan:

\`\`\`
Task(
  agent="architect",
  prompt="CREATE IMPLEMENTATION PLAN

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

Save to: .pi/ralplan/plans/plan.md
Signal completion with: PLAN_CREATED"
)
\`\`\`

### Step 3: Validate Plan via Critic

After Architect creates the plan:

\`\`\`
Task(
  agent="critic",
  prompt="REVIEW IMPLEMENTATION PLAN

Plan file: .pi/ralplan/plans/plan.md
Original spec: ${specPath}

Verify:
1. All requirements from spec have corresponding tasks
2. No ambiguous task descriptions
3. Acceptance criteria are testable
4. Dependencies are correctly identified
5. Risks are addressed

Verdict: OKAY or REJECT with specific issues"
)
\`\`\`

### Iteration Loop

If Critic rejects, feed feedback back to Architect and retry (max 5 iterations).

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

Use subagents to execute tasks in parallel where possible:

1. **Create tasks** from the implementation plan
2. **Spawn executor subagents** for independent tasks
3. **Monitor progress** as subagents complete tasks
4. **Coordinate** dependencies between tasks

### Output Contract

Every subagent response must stay concise: return ONLY a short execution summary under 100 words covering what changed, files touched, verification status, and blockers. Store bulky logs/details in files or artifacts and reference them briefly.

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
3. Use subagents for independent tasks that can run in parallel
4. Track progress in a TODO list

### Output Contract

Every spawned subagent response must return ONLY a short execution summary under 100 words covering: what changed, files touched, verification status, and blockers. Store bulky logs/details in files or artifacts and reference them briefly.

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
export function getRalphPrompt(specPath: string, maxIterations: number): string {
  return `## VERIFICATION (RALPH)

Verify the implementation against the specification using the Ralph verification loop.

**Max Iterations:** ${maxIterations}

### Verification Process

Spawn parallel verification reviewers:

Each reviewer must return ONLY a concise review summary under 100 words covering verdict, evidence highlights, files checked, and blockers. Avoid dumping long logs or transcripts into the main session.

\`\`\`
// Functional Completeness Review
Task(
  agent="architect",
  prompt="FUNCTIONAL COMPLETENESS REVIEW

Read the original spec at: ${specPath}

Verify:
1. All functional requirements are implemented
2. All non-functional requirements are addressed
3. All acceptance criteria from the plan are met
4. No missing features or incomplete implementations

Verdict: APPROVED (all requirements met) or REJECTED (with specific gaps)"
)

// Security Review
Task(
  agent="security-reviewer",
  prompt="SECURITY REVIEW

Check the implementation for:
1. OWASP Top 10 vulnerabilities
2. Input validation and sanitization
3. Authentication/authorization issues
4. Sensitive data exposure
5. Injection vulnerabilities (SQL, command, XSS)
6. Hardcoded secrets or credentials

Verdict: APPROVED (no vulnerabilities) or REJECTED (with specific issues)"
)

// Code Quality Review
Task(
  agent="code-reviewer",
  prompt="CODE QUALITY REVIEW

Review the implementation for:
1. Code organization and structure
2. Design patterns and best practices
3. Error handling completeness
4. Test coverage adequacy
5. Maintainability and readability

Verdict: APPROVED (high quality) or REJECTED (with specific issues)"
)
\`\`\`

### Fix and Re-verify Loop

If any reviewer rejects:
1. Collect all rejection reasons
2. Fix each issue identified
3. Re-run verification (up to ${maxIterations} iterations)

### Completion

When all reviewers approve:

Signal: ${RALPH_COMPLETION_SIGNAL}`;
}

/** Generate the consensus planning prompt (full ralplan mode) */
export function getConsensusPlanningPrompt(context: PipelineContext): string {
  const specPath = context.specPath || ".pi/ralplan/plans/spec.md";
  const planPath = context.planPath || ".pi/ralplan/plans/plan.md";

  return `## RALPLAN (Consensus Planning)

Your task: Expand the idea into a detailed spec and implementation plan using consensus-driven planning.

**Original Idea:** "${escapeForPrompt(context.idea)}"

### Part 1: Idea Expansion (Spec Creation)

${getExpansionPrompt(context.idea, context.openQuestionsPath)}

### Part 2: Consensus Planning

After the spec is created at \`${specPath}\`, invoke the RALPLAN consensus workflow:

1. **Planner** creates initial implementation plan from the spec
2. **Architect** reviews for technical feasibility and design quality
3. **Critic** challenges assumptions and identifies gaps
4. Iterate until consensus is reached

Save the final approved plan to: \`${planPath}\`

Use the \`/skill:ralplan\` skill for detailed consensus workflow instructions.

### Completion

When both the spec AND the consensus plan are complete and approved:

Signal: ${RALPLAN_COMPLETION_SIGNAL}`;
}

/** Generate a stage transition prompt */
export function getTransitionPrompt(fromStage: string, toStage: string | "complete"): string {
  if (toStage === "complete") {
    return `## PIPELINE COMPLETE

All pipeline stages have completed successfully!

Signal: ${RALPLAN_COMPLETION_SIGNAL}
`;
  }

  return `## PIPELINE STAGE TRANSITION: ${fromStage.toUpperCase()} -> ${toStage.toUpperCase()}

The ${fromStage} stage is complete. Transitioning to: **${toStage}**

`;
}
