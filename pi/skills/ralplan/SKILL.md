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

## Subagent Spawning

### If `subagent` tool is available
Use the `subagent` tool in **chain mode** to delegate each role to an isolated agent process:
- Step 1: `subagent` with `agent: "planner"`, task = spec + planner.md prompt
- Step 2: `subagent` with `agent: "architect"`, task = plan draft + architect.md prompt  
- Step 3: `subagent` with `agent: "critic"`, task = plan draft + architect feedback + critic.md prompt
- If rejected, chain back to planner with feedback, then re-run architect/critic

**Do NOT use MCP for subagent spawning.** The `subagent` tool is a native pi extension. If it is not in your available tools list, it is not loaded.

### If `subagent` tool is NOT available
The parent agent must perform **genuine sequential deliberation** with strict separation:
1. **Planner pass**: Generate the complete plan. STOP. Do not proceed to review in the same completion.
2. **Architect pass**: In a new reasoning block, adopt the Architect persona fully. Review the plan with steelman antithesis and tradeoff tension. Write out explicit findings.
3. **Critic pass**: In a new reasoning block, adopt the Critic persona fully. Challenge assumptions, identify gaps, enforce gate checks. Write out explicit verdict (REJECT / REVISE / ACCEPT).
4. **Revision loop**: If Architect or Critic issued REJECT or REVISE, go back to step 1 (Planner pass) with their feedback incorporated. Repeat until ACCEPT from both or max 5 iterations.

**CRITICAL**: "Simulating" the three roles in a single generation — outputting Planner → Architect → Critic sections all at once without stopping to actually evaluate — is **prohibited**. Each role must be given the opportunity to genuinely challenge the previous output.

## Workflow

### Phase 1: Idea Expansion
1. Delegate to an `analyst` (via `subagent` tool if available, otherwise perform as a dedicated pass) to extract requirements
2. Delegate to an `architect` (via `subagent` tool if available, otherwise perform as a dedicated pass) for technical design
3. Combine into a spec document at `.pi/ralplan/plans/spec.md`

### Phase 2: Consensus Planning
Follow the **Subagent Spawning** rules above. If using the `subagent` tool, chain Planner → Architect → Critic. If not available, perform genuine sequential deliberation with strict persona separation.

1. **Planner** creates initial implementation plan from spec with RALPLAN-DR summary:
   - **Principles** (3-5)
   - **Decision Drivers** (top 3)
   - **Viable Options** (>=2) with bounded pros/cons
   - If only 1 viable option, explicit invalidation rationale for alternatives
2. **Architect** reviews for technical feasibility — must provide strongest steelman antithesis + at least one real tradeoff tension
3. **Critic** challenges assumptions, identifies gaps — must enforce principle-option consistency, fair alternatives, risk mitigation clarity, testable acceptance criteria
4. **Iterate** with real back-and-forth until all three approve (max 5 iterations). Each iteration must re-invoke the role with the revised artifact and previous feedback.
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
