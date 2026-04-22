# Consensus Workflow Reference

This document describes the full consensus-driven planning workflow used by RALPLAN.

## Overview

RALPLAN uses three specialized roles — Planner, Architect, and Critic — to iteratively refine an implementation plan until all three agree it is sound.

**Hard rule:** Approval and consensus signatures MUST come from actual subagent output. The parent agent MUST NOT generate approvals, simulate consensus, or append signatures to documents it produced.

## Roles

**CRITICAL:** Each role MUST be executed by a separately spawned subagent. The parent agent MUST NOT perform the work of any role itself. Self-approval is strictly prohibited.

### Planner
- Creates the initial implementation plan from the spec
- Revises the plan based on Architect and Critic feedback
- Responsible for task specificity and completeness

### Architect
- Reviews for technical feasibility
- Validates design patterns and tech stack choices
- Checks dependency graphs and execution order
- Must provide strongest steelman antithesis; never rubber-stamp

### Critic
- Challenges assumptions
- Identifies edge cases and gaps
- Verifies security and operational concerns
- Must reject shallow alternatives and weak verification; never rubber-stamp

## Iteration Loop

Each arrow represents spawning a subagent with the relevant role prompt and the current artifact. The parent agent MUST NOT perform reviews or revisions itself.

```
Spawn Planner subagent → creates plan
    ↓
Spawn Architect subagent → reviews → REJECTED? → Spawn Planner subagent → revises
    ↓ APPROVED
Spawn Critic subagent → reviews → REJECTED? → Spawn Planner subagent → revises
    ↓ APPROVED
Consensus reached → Save final plan
```

## Termination Conditions

- **Success**: All three roles approve
- **Failure**: Max iterations reached (default 5 rounds)
- **Escalation**: Fundamental disagreement that requires user input

## Output Artifacts

1. **spec.md** — Combined requirements + technical specification
2. **plan.md** — Consensus-approved implementation plan

## Quality Gates

The plan must include:
- Task breakdown with file paths
- Dependency graph
- Acceptance criteria per task
- Risk register

The spec must include:
- Acceptance criteria section
- Requirement coverage map
