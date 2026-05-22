---
name: ralplan
description: |
  Consensus-driven implementation planning via strict Planner/Architect/Critic iteration.
  Use when the user needs a detailed spec and implementation plan before coding.
  Trigger with /ralplan or by saying "ralplan".
  Execution-agnostic: RALPLAN defines roles, workflow, and artifact formats only.
  The host environment provides agent execution via any available method.
---

# RALPLAN — Consensus Planning Protocol

**Protocol only.** RALPLAN defines roles, states, transitions, and artifact formats.
Execution is delegated to the host environment which provides any available agent mechanism
(subagent, Task(), direct LLM calls, etc.). RALPLAN does not prescribe how agents are spawned.

## Core Directive

You are executing a strict multi-agent state machine. Your primary goal is to prevent
"Simulated Consensus" (hallucinating approvals in a single generation). True consensus
requires adversarial pushback, isolated reasoning, and verifiable file-system checkpoints.
Self-approval is strictly prohibited.

## 🛑 Hard Constraints

1. **Isolated Roles**: Each role (Planner, Architect, Critic) MUST be executed by a
   separately invoked agent. The parent agent MUST NOT perform the work of any role itself.
2. **No Single-Turn Consensus**: You MUST NOT generate the Planner's draft, the
   Architect's review, and the Critic's approval in the same output block.
3. **Mandatory Pushback**: The Architect or Critic must provide genuine pushback.
   They must never rubber-stamp a first draft.

## The Iteration Loop

Each step represents an independent evaluation by a separately invoked agent.

1. **State 1 (Planner)**: Creates or revises the plan based on the spec and previous
   feedback. Writes to `plans/drafts/plan_draft.md`. MUST include RALPLAN-DR summary.
2. **State 2 (Architect)**: Reviews `plans/drafts/plan_draft.md` for technical feasibility.
   Must provide the strongest steelman antithesis.
   - _If REVISION NEEDED_: Route back to State 1 (Planner) with feedback.
   - _If APPROVE_: Proceed to State 3.
   - **SEQUENTIAL requirement:** Await Architect's complete verdict before invoking Critic.
3. **State 3 (Critic)**: Reviews the Architect-approved draft. Challenges assumptions,
   identifies edge cases, verifies security/ops.
   - _If REVISION NEEDED / REJECT_: Route back to State 1 (Planner) with feedback.
   - _If APPROVE_: Consensus reached. Save to `plans/plan.md`.
4. **Re-review loop**: Any non-APPROVE verdict loops back to State 1 (Planner).
   Max 5 iterations total.

## Termination Conditions

- **Success**: All three roles approve. Output exactly: `PIPELINE_RALPLAN_COMPLETE`
- **Failure**: Max iterations reached (Default: 5 rounds).
- **Escalation**: Fundamental disagreement between Architect and Critic. Halt and
  request human user input to break the tie.

## Output Artifacts & Quality Gates

### 1. The Specification (`plans/spec.md`)

The foundational requirements document. MUST include:

- `## Acceptance Criteria` (Testable boolean statements)
- `## Requirement Coverage Map`

### 2. The Plan Draft (`plans/drafts/plan_draft.md`)

The working plan during consensus review. MUST include:

- Implementation plan (task breakdown, dependency graph, acceptance criteria, risk register)
- **RALPLAN-DR Summary** (see below) — placed before Architect review

### 3. The Final Plan (`plans/plan.md`)

The consensus-approved implementation guide. MUST include:

- `## Architecture Decision Record (ADR)`:
  - **Decision:** One-sentence decision statement
  - **Drivers:** Top 3 decision drivers with rationale
  - **Alternatives Considered:** Rejected options with reasons
  - **Why Chosen:** Explanation of the selected path
  - **Consequences:** Positive and negative effects
  - **Follow-ups:** Action items requiring future attention
- `## Task Breakdown` (Must include exact file paths)
- `## Dependency Graph` (Execution order of tasks)
- `## Acceptance Criteria per Task`
- `## Risk Register` (Identified risks and concrete mitigations)

---

## RALPLAN-DR Protocol (Planner Step)

The Planner MUST generate this summary block BEFORE Architect review:

```markdown
## RALPLAN-DR Summary

**Mode:** SHORT (default) | DELIBERATE (high-risk signals detected)

### Principles (3–5)

- [P1] Principle statement
- [P2] Principle statement

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

_(If only 1 option survives: explicit invalidation rationale for rejected alternatives)_

### Pre-Mortem (DELIBERATE mode only — 3 failure scenarios)

- **Scenario 1:** [How it fails] → Mitigation: [...]
- **Scenario 2:** [How it fails] → Mitigation: [...]
- **Scenario 3:** [How it fails] → Mitigation: [...]

### Expanded Test Plan (DELIBERATE mode only)

- Unit tests: [...]
- Integration tests: [...]
- E2E tests: [...]
- Observability/logging: [...]
```

### DELIBERATE Mode Triggers

Auto-triggered by high-risk signals in the idea:

- `auth`, `security`, `credential`, `secret`, `password`, `token`
- `migration`, `schema`, `database`, `production`
- `destroy`, `delete`, `rm`, `remove everything`
- `compliance`, `PII`, `GDPR`, `HIPAA`
- `public API`, `breaking change`
- `--deliberate` flag explicitly provided

---

## Agent Contract (Execution-Agnostic)

RALPLAN specifies what each agent receives and produces. The host environment
decides how to invoke agents (subagent, Task(), direct API, etc.).

### Planner

- **Receives:** Original idea, spec path, previous feedback (if any), role prompt
- **Produces:** `plans/drafts/plan_draft.md` with RALPLAN-DR Summary

### Architect

- **Receives:** `plans/drafts/plan_draft.md`, role prompt
- **Produces:** `plans/drafts/architect_review.md` with verdict (`APPROVE` | `REVISION NEEDED`)

### Critic

- **Receives:** `plans/drafts/plan_draft.md`, `plans/drafts/architect_review.md`, role prompt
- **Produces:** `plans/drafts/critic_review.md` with verdict (`APPROVE` | `ITERATE` | `REJECT`)

### Role Prompt Locations

- `/skill:ralplan/prompts/planner.md`
- `/skill:ralplan/prompts/architect.md`
- `/skill:ralplan/prompts/critic.md`

The host environment passes these to the respective agents.

---

## Fallback Mode (No agent invocation available)

If no agent mechanism is available, perform genuine sequential deliberation:

1. Adopt the Planner persona, write the draft, and **STOP**. Ask user to type "continue".
2. Adopt the Architect persona, write the review, and **STOP**. Ask user to type "continue".
3. Adopt the Critic persona, issue the verdict, and **STOP**.
   Never simulate all three personas in a single continuous text generation.
