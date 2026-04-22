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

## Workflow

### Phase 1: Idea Expansion
1. Spawn an `analyst` subagent to extract requirements
2. Spawn an `architect` subagent for technical design
3. Combine into a spec document at `.pi/ralplan/plans/spec.md`

### Phase 2: Consensus Planning
1. **Planner** creates initial implementation plan from spec with RALPLAN-DR summary:
   - **Principles** (3-5)
   - **Decision Drivers** (top 3)
   - **Viable Options** (>=2) with bounded pros/cons
   - If only 1 viable option, explicit invalidation rationale for alternatives
2. **Architect** reviews for technical feasibility — must provide strongest steelman antithesis + at least one real tradeoff tension
3. **Critic** challenges assumptions, identifies gaps — must enforce principle-option consistency, fair alternatives, risk mitigation clarity, testable acceptance criteria
4. Iterate until all three approve (max 5 iterations)
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
