---
name: ralplan
description: |
  Consensus-driven implementation planning via strict Planner/Architect/Critic iteration.
  Use when the user needs a detailed spec and implementation plan before coding.
  Trigger with /ralplan or by saying "ralplan".
---

# RALPLAN — Consensus Planning Protocol

## Core Directive

You are executing a strict multi-agent state machine. Your primary goal is to prevent "Simulated Consensus" (hallucinating approvals in a single generation). True consensus requires adversarial pushback, isolated reasoning, and verifiable file-system checkpoints. Self-approval is strictly prohibited.

## 🛑 Hard Constraints

1. **Real Subagents Only**: Each role MUST be executed by a separately spawned subagent. The parent agent MUST NOT perform the work of any role itself.
2. **No Single-Turn Consensus**: You MUST NOT generate the Planner's draft, the Architect's review, and the Critic's approval in the same output block.
3. **Mandatory Pushback**: The Architect or Critic must provide genuine pushback. They must never rubber-stamp a first draft.

## The Iteration Loop (The Waterfall)

Each step represents an independent evaluation. Use the `subagent` tool in chain mode.

1. **State 1 (Planner)**: Creates or revises the plan based on the spec and previous feedback. Writes to `.pi/ralplan/drafts/plan_draft.md`.
2. **State 2 (Architect)**: Reviews `plan_draft.md` for technical feasibility, design patterns, dependency graphs, and execution order. Must provide the strongest steelman antithesis.
   - _If REJECTED_: Route back to State 1 (Planner) with feedback.
   - _If APPROVED_: Proceed to State 3.
3. **State 3 (Critic)**: Reviews the Architect-approved draft. Challenges assumptions, identifies edge cases, and verifies security/ops. Must reject shallow alternatives.
   - _If REJECTED_: Route back to State 1 (Planner) with feedback.
   - _If APPROVED_: Consensus reached. Save to `.pi/ralplan/plans/plan.md`.

## Termination Conditions

- **Success**: All three roles approve. Output exactly: `PIPELINE_RALPLAN_COMPLETE`
- **Failure**: Max iterations reached (Default: 5 rounds).
- **Escalation**: Fundamental disagreement between Architect and Critic that cannot be resolved. The system MUST halt and request human user input to break the tie.

## Output Artifacts & Quality Gates

### 1. The Specification (`.pi/ralplan/plans/spec.md`)

The foundational requirements document. It MUST include:

- `## Acceptance Criteria` (Testable boolean statements)
- `## Requirement Coverage Map`

### 2. The Final Plan (`.pi/ralplan/plans/plan.md`)

The consensus-approved implementation guide. It MUST include:

- `## Architecture Decision Record (ADR)` (Decision, Drivers, Alternatives, Consequences)
- `## Task Breakdown` (Must include exact file paths)
- `## Dependency Graph` (Execution order of tasks)
- `## Acceptance Criteria per Task`
- `## Risk Register` (Identified risks and concrete mitigations)

## Fallback Mode (If `subagent` tool is unavailable)

If you cannot spawn isolated processes, you must perform genuine sequential deliberation.

1. Adopt the Planner persona, write the draft, and **STOP**. Ask the user to type "continue".
2. Adopt the Architect persona, write the review, and **STOP**. Ask the user to type "continue".
3. Adopt the Critic persona, issue the verdict, and **STOP**.
   Never simulate all three personas in a single continuous text generation.
