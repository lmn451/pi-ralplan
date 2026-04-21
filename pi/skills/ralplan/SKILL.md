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

## Workflow

### Phase 1: Idea Expansion
1. Spawn an `analyst` subagent to extract requirements
2. Spawn an `architect` subagent for technical design
3. Combine into a spec document at `.pi/ralplan/plans/spec.md`

### Phase 2: Consensus Planning
1. **Planner** creates initial implementation plan from spec
2. **Architect** reviews for technical feasibility
3. **Critic** challenges assumptions, identifies gaps
4. Iterate until all three approve
5. Save final plan to `.pi/ralplan/plans/plan.md`

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
