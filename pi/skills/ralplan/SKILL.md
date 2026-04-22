---
name: ralplan
description: |
  Consensus-driven implementation planning with Planner/Architect/Critic iteration.
  Use when the user needs a detailed spec and implementation plan before coding.
  Trigger with /ralplan or by saying "ralplan" in your request.
---

# RALPLAN — Consensus Planning

## When to Use

- The user's request is broad or underspecified
- Complex features requiring multi-file changes
- Before heavy execution modes or large refactors
- When you need a shared understanding before implementation
- High-risk work (auth/security, migrations, destructive changes, production incidents, compliance/PII, public API breakage)

## Hard Rules

1. **Real subagents only.** Planner, Architect, and Critic MUST each be a separately spawned subagent. The parent agent MUST NOT write plan content, perform design review, or conduct critique itself.
2. **Real debate only.** Consensus requires at least one full pass of Planner → Architect → Critic with substantive pushback. If all three approve on the first pass without revision, the Critic MUST be respawned with explicit instructions to find the strongest remaining objection.
3. **No self-approval.** The parent agent MUST NOT generate approval signatures, simulate subagent consensus, or append a "consensus signatures" section to documents it wrote. Approval must come from subagent output.
4. **Iterate for real.** If Architect or Critic rejects or requests revisions, the Planner MUST be respawned with the feedback to produce a revised plan. Simply editing the document yourself between "rounds" violates the protocol.

## Workflow

### Phase 1: Idea Expansion
1. Spawn an `analyst` subagent to extract requirements
2. Spawn an `architect` subagent for technical design
3. Combine into a spec document at `.pi/ralplan/plans/spec.md`

### Phase 2: Consensus Planning
**MANDATORY:** Each role MUST be executed by a separately spawned subagent using the role-specific prompts in `prompts/`. The parent agent MUST NOT perform the work of Planner, Architect, or Critic itself. Self-approval or generating consensus signatures without actual subagent execution is strictly prohibited.

1. **Planner** subagent creates initial implementation plan from spec with RALPLAN-DR summary:
   - **Principles** (3-5)
   - **Decision Drivers** (top 3)
   - **Viable Options** (>=2) with bounded pros/cons
   - If only 1 viable option, explicit invalidation rationale for alternatives
2. **Architect** subagent reviews for technical feasibility — must provide strongest steelman antithesis + at least one real tradeoff tension
3. **Critic** subagent challenges assumptions, identifies gaps — must enforce principle-option consistency, fair alternatives, risk mitigation clarity, testable acceptance criteria
4. **Iterate** with real back-and-forth until all three subagents approve (max 5 iterations). Each iteration must spawn subagents anew with the revised artifact and previous feedback.
5. Save final plan to `.pi/ralplan/plans/plan.md`

### Deliberate Mode

Auto-enables for high-risk signals (auth/security, migrations, destructive changes, production incidents, compliance/PII, public API breakage). Adds:
- **Pre-mortem**: 3 concrete failure scenarios
- **Expanded test plan**: unit / integration / e2e / observability coverage

### Phase 3: Execution (optional)
Use the approved plan with execution tools or subagents.

## Completion Signal

When planning is complete, output exactly:
```
PIPELINE_RALPLAN_COMPLETE
```

## Role Prompts

Use the role-specific prompts in the `prompts/` directory of this skill when spawning subagents:
- `planner.md` — for the Planner role
- `architect.md` — for the Architect role
- `critic.md` — for the Critic role

## Output Artifacts

Both the spec and the plan must include quality-gate sections:

**spec.md** must contain:
- `## Acceptance criteria`
- `## Requirement coverage map`

**plan.md** must contain:
- `## Unit coverage`
- `## Verification mapping`

**Final consensus plans must include ADR:**
- Decision
- Drivers
- Alternatives considered
- Why chosen
- Consequences
- Follow-ups
