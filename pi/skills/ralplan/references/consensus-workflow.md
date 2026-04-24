# Consensus Workflow Reference

This document describes the full consensus-driven planning workflow used by RALPLAN.

## Overview

RALPLAN uses three specialized roles — Planner, Architect, and Critic — to iteratively refine an implementation plan until all three agree it is sound.

**Hard rule:** Approval and consensus signatures MUST come from actual independent evaluation. Prefer the `subagent` tool in chain mode to isolate each role in its own process. If `subagent` is unavailable, the parent agent must perform genuine sequential deliberation with strict persona separation — never single-pass simulation.

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

Each arrow represents an independent evaluation by the relevant role. Use the `subagent` tool in chain mode if available; otherwise perform as strict sequential passes.

```
Planner → creates plan
    ↓
Architect → reviews → REJECTED? → Planner → revises
    ↓ APPROVED
Critic → reviews → REJECTED? → Planner → revises
    ↓ APPROVED
Consensus reached → Save final plan
```

**If `subagent` tool is unavailable:** Each box above becomes a dedicated reasoning pass where the parent agent fully adopts that role's persona and prompt before producing output.

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
