# Consensus Workflow Reference

This document describes the full consensus-driven planning workflow used by RALPLAN.

## Overview

RALPLAN uses three specialized roles — Planner, Architect, and Critic — to iteratively refine an implementation plan until all three agree it is sound.

## Roles

### Planner
- Creates the initial implementation plan from the spec
- Revises the plan based on Architect and Critic feedback
- Responsible for task specificity and completeness

### Architect
- Reviews for technical feasibility
- Validates design patterns and tech stack choices
- Checks dependency graphs and execution order

### Critic
- Challenges assumptions
- Identifies edge cases and gaps
- Verifies security and operational concerns

## Iteration Loop

```
Planner creates plan
    ↓
Architect reviews → REJECTED? → Planner revises
    ↓ APPROVED
Critic reviews → REJECTED? → Planner revises
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
