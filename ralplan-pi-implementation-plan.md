# RALPLAN Feature Implementation Plan for Pi Agent

## Overview

This document outlines how to implement the `ralplan` (consensus-driven planning) feature from oh-my-claudecode as a **Pi extension + skill package**. The implementation follows Pi's philosophy of extensibility without forking core internals.

---

## 1. Architecture Mapping: OMC → Pi

| OMC Concept | Pi Equivalent | Implementation Approach |
|-------------|---------------|------------------------|
| Shell hook scripts (`keyword-detector`, `stop-continuation`) | Extension event handlers (`before_agent_start`, `agent_end`, `tool_call`) | TypeScript extension subscribing to lifecycle events |
| Bridge TypeScript module | Extension factory function receiving `ExtensionAPI` | Single extension entry point with event subscriptions |
| Pipeline orchestrator (`pipeline.ts`) | Extension state machine + `before_agent_start` prompt injection | In-memory stage tracking with session persistence via `pi.appendEntry()` |
| Stage adapters (`ralplan-adapter.ts`, `execution-adapter.ts`) | Prompt template functions + conditional logic in `before_agent_start` | Generate stage-specific prompts based on current pipeline state |
| Mode state files (`.omc/state/ralplan-state.json`) | Custom session entries via `pi.appendEntry("ralplan-state", {...})` + optional `.pi/ralplan/state.json` | Dual persistence: session-embedded for branching, file-based for cross-session resume |
| Workflow slots (`skill-active-state.json`) | Extension in-memory state + session entry markers | Track active ralplan sessions within the extension |
| Keyword detection | Extension `input` event handler | Detect `/ralplan` command and `ralplan` keyword in user prompts |
| Stop-hook enforcement | Extension `agent_end` handler + follow-up message injection | Detect incomplete stages, inject continuation prompts |
| Subagent spawning (`team` mode) | Pi's `subagent` extension pattern | Spawn separate `pi` processes for Planner/Architect/Critic roles |
| Planning artifacts (`.omc/plans/`) | `.pi/ralplan/` directory | Store PRD, test-spec, and implementation plans |

---

## 2. Directory Structure

```
.pi/                          # Project-local (or ~/.pi/agent/ for global)
├── extensions/
│   └── ralplan/
│       ├── index.ts          # Main extension entry point
│       ├── state.ts          # State management (file + session entries)
│       ├── pipeline.ts       # Pipeline orchestrator (stage machine)
│       ├── prompts.ts        # Stage prompt generators
│       ├── adapters.ts       # Stage adapter interface + implementations
│       ├── signals.ts        # Completion signal detection
│       ├── artifacts.ts      # Planning artifact reader/writer
│       └── utils.ts          # Helpers (escape, path resolution, etc.)
├── skills/
│   └── ralplan/
│       ├── SKILL.md          # Skill definition (consensus planning instructions)
│       ├── prompts/
│       │   ├── planner.md    # Planner role prompt
│       │   ├── architect.md  # Architect role prompt
│       │   ├── critic.md     # Critic role prompt
│       │   └── expansion.md  # Idea expansion prompt
│       └── references/
│           └── consensus-workflow.md  # Detailed workflow reference
└── ralplan/                  # Runtime artifacts (created by extension)
    ├── plans/
    │   ├── prd-<timestamp>.md
    │   ├── test-spec-<timestamp>.md
    │   └── plan-<timestamp>.md
    └── state.json            # Active ralplan state (mirrors session entry)
```

---

## 3. Core Components

### 3.1 Extension Entry Point (`index.ts`)

The extension exports a default factory function that registers commands, event handlers, and tools:

```typescript
export default function ralplanExtension(pi: ExtensionAPI): void {
  // Register /ralplan command
  pi.registerCommand("ralplan", { ... });

  // Register custom tools for stage advancement
  pi.registerTool({ name: "ralplan_advance", ... });
  pi.registerTool({ name: "ralplan_submit_artifact", ... });

  // Event handlers
  pi.on("input", handleRalplanInput);           // Detect /ralplan invocation
  pi.on("before_agent_start", injectStagePrompt); // Inject current stage instructions
  pi.on("tool_call", interceptAdvancement);      // Handle stage advancement tools
  pi.on("agent_end", handleStageCompletion);     // Detect signal-based completion
  pi.on("session_start", restoreState);          // Resume from session entries
}
```

### 3.2 Pipeline State Machine (`pipeline.ts`)

Mirrors OMC's pipeline but adapted for Pi's event model:

```typescript
type PipelineStageId = "ralplan" | "execution" | "ralph" | "qa";
type StageStatus = "pending" | "active" | "complete" | "failed" | "skipped";

interface PipelineConfig {
  planning: "ralplan" | "direct" | false;
  execution: "team" | "solo";
  verification: { engine: "ralph"; maxIterations: number } | false;
  qa: boolean;
}

interface PipelineTracking {
  pipelineConfig: PipelineConfig;
  stages: PipelineStageState[];
  currentStageIndex: number;
}

interface RalplanState {
  active: boolean;
  pipeline: PipelineTracking;
  originalIdea: string;
  specPath?: string;
  planPath?: string;
  sessionId?: string;
  startedAt: string;
  completedAt?: string;
}
```

Key functions:
- `initPipeline(idea, config)` — Initialize new ralplan session
- `advanceStage(directory, sessionId?)` — Move to next stage
- `getCurrentStageAdapter(tracking)` — Return current stage's prompt generator
- `generatePipelinePrompt(state)` — Build prompt for current stage
- `detectCompletionSignal(text, stageId)` — Check for stage completion signals

### 3.3 Stage Adapters (`adapters.ts`)

Each stage implements a uniform interface:

```typescript
interface PipelineStageAdapter {
  readonly id: PipelineStageId;
  readonly name: string;
  readonly completionSignal: string;
  shouldSkip(config: PipelineConfig): boolean;
  getPrompt(context: PipelineContext): string;
  onEnter?(context: PipelineContext): void;
  onExit?(context: PipelineContext): void;
}
```

**RALPLAN Stage Adapter:**
- Generates consensus planning prompt (Planner → Architect → Critic)
- Supports both `ralplan` (consensus) and `direct` (simpler) modes
- Completion signal: `PIPELINE_RALPLAN_COMPLETE`

**EXECUTION Stage Adapter:**
- Reads implementation plan, executes tasks
- Team mode: delegates to subagent tool
- Solo mode: sequential execution with agent spawning guidance
- Completion signal: `PIPELINE_EXECUTION_COMPLETE`

**RALPH Stage Adapter:**
- Verification/approval loop
- Completion signal: `PIPELINE_RALPH_COMPLETE`

**QA Stage Adapter:**
- Build/lint/test cycling
- Completion signal: `PIPELINE_QA_COMPLETE`

### 3.4 State Management (`state.ts`)

Dual persistence strategy for Pi's branching session model:

**Session-embedded state** (primary, for branching support):
```typescript
// Persist state in session entries
pi.appendEntry("ralplan-state", {
  version: 1,
  active: true,
  pipeline: tracking,
  originalIdea: "...",
  specPath: ".pi/ralplan/plans/spec.md",
  planPath: ".pi/ralplan/plans/plan.md",
});
```

**File-based state** (for cross-session resume):
```typescript
// Mirror to .pi/ralplan/state.json for durability
function writeRalplanStateFile(directory: string, state: RalplanState): void;
function readRalplanStateFile(directory: string): RalplanState | null;
```

**State reconstruction on session_start:**
1. Check session entries for `ralplan-state` custom entries
2. Fall back to `.pi/ralplan/state.json` if no session entries found
3. Reconcile: session entries take precedence (newer), file is backup

### 3.5 Prompt Generation (`prompts.ts`)

Stage-specific prompts that guide the LLM through each pipeline phase:

**Expansion Prompt (Phase 0):**
- Spawns Analyst subagent for requirements extraction
- Spawns Architect subagent for technical specification
- Saves combined spec to `.pi/ralplan/plans/spec.md`

**Consensus Planning Prompt (Phase 1 — RALPLAN mode):**
- Uses Pi's subagent pattern to spawn Planner, Architect, Critic agents
- Iterates until consensus reached
- Saves plan to `.pi/ralplan/plans/plan.md`

**Direct Planning Prompt (Phase 1 — direct mode):**
- Single Architect + Critic pass
- Faster but less thorough

**Execution Prompt (Phase 2):**
- Reads plan, executes tasks
- Provides agent spawning patterns for different complexity levels

**QA Prompt (Phase 3):**
- Build/lint/test cycling instructions
- Fix loop with max iterations

### 3.6 Signal Detection (`signals.ts`)

Detect completion signals in assistant messages:

```typescript
const STAGE_SIGNALS: Record<PipelineStageId, string> = {
  ralplan: "PIPELINE_RALPLAN_COMPLETE",
  execution: "PIPELINE_EXECUTION_COMPLETE",
  ralph: "PIPELINE_RALPH_COMPLETE",
  qa: "PIPELINE_QA_COMPLETE",
};

function detectSignal(text: string, stageId: PipelineStageId): boolean;
function getExpectedSignalForPhase(phase: PipelinePhase): string | null;
```

Integration with `agent_end` event:
```typescript
pi.on("agent_end", async (event, ctx) => {
  const state = readRalplanState(ctx.cwd);
  if (!state?.active) return;

  const currentStage = getCurrentStage(state.pipeline);
  const lastAssistant = getLastAssistantMessage(event.messages);

  if (lastAssistant && detectSignal(lastAssistant.text, currentStage.id)) {
    const next = advanceStage(ctx.cwd);
    if (next.phase === "complete") {
      // Pipeline complete
      pi.sendMessage({
        customType: "ralplan-complete",
        content: "RALPLAN pipeline complete! All stages finished.",
        display: true,
      });
      deactivateRalplanState(ctx.cwd);
    } else {
      // Inject next stage prompt as follow-up
      pi.sendUserMessage(next.prompt, { deliverAs: "followUp" });
    }
  }
});
```

### 3.7 Planning Artifacts (`artifacts.ts`)

Manages `.pi/ralplan/plans/` directory:

```typescript
interface PlanningArtifacts {
  prdPaths: string[];
  testSpecPaths: string[];
  planPaths: string[];
}

function readPlanningArtifacts(cwd: string): PlanningArtifacts;
function isPlanningComplete(artifacts: PlanningArtifacts): boolean;
function readApprovedExecutionLaunchHint(cwd: string, mode: "team" | "ralph"): LaunchHint | null;
```

Quality gate checks:
- PRD must have "Acceptance Criteria" and "Requirement Coverage Map" sections
- Test spec must have "Unit Coverage" and "Verification Mapping" sections

---

## 4. Skill Definition (`SKILL.md`)

The skill provides the consensus planning instructions loaded on-demand:

```markdown
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
- Before heavy execution modes (ralph, autopilot, team)

## Workflow

### Phase 1: Idea Expansion
1. Spawn `analyst` subagent to extract requirements
2. Spawn `architect` subagent for technical design
3. Combine into spec document at `.pi/ralplan/plans/spec.md`

### Phase 2: Consensus Planning
1. **Planner** creates initial implementation plan from spec
2. **Architect** reviews for technical feasibility
3. **Critic** challenges assumptions, identifies gaps
4. Iterate until all three approve
5. Save final plan to `.pi/ralplan/plans/plan.md`

### Phase 3: Execution (optional)
Use the approved plan with /ralph or execute directly.

## Completion Signal

When planning is complete, output exactly:
```
PIPELINE_RALPLAN_COMPLETE
```
```

---

## 5. Event Flow

```
User types: "ralplan build me a todo app"
         │
         ▼
┌─────────────────────────────────────────┐
│ input event handler                     │
│ - Detects "ralplan" keyword             │
│ - Or /ralplan command                   │
│ - Initializes ralplan state             │
└─────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────┐
│ before_agent_start event                │
│ - Reads ralplan state                   │
│ - Generates stage prompt                │
│ - Injects as system prompt addition     │
│   or persistent message                 │
└─────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────┐
│ Agent executes with stage prompt        │
│ - May spawn subagents for roles         │
│ - Writes artifacts to .pi/ralplan/      │
└─────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────┐
│ agent_end event                         │
│ - Checks for completion signal          │
│ - If found: advance stage               │
│ - Inject next stage prompt              │
└─────────────────────────────────────────┘
         │
         ▼
   (repeat until complete)
         │
         ▼
┌─────────────────────────────────────────┐
│ Pipeline complete                       │
│ - Send completion message               │
│ - Deactivate state                      │
│ - Allow normal operation                │
└─────────────────────────────────────────┘
```

---

## 6. Commands

| Command | Description |
|---------|-------------|
| `/ralplan [idea]` | Start consensus planning for an idea |
| `/ralplan:status` | Show current pipeline status |
| `/ralplan:cancel` | Cancel active ralplan session |
| `/ralplan:skip` | Skip current stage |
| `/ralplan:artifacts` | List planning artifacts |

---

## 7. Tools

| Tool | Description |
|------|-------------|
| `ralplan_advance` | Explicitly advance to next pipeline stage |
| `ralplan_submit_artifact` | Submit a planning artifact (spec, plan, test-spec) |
| `ralplan_set_config` | Modify pipeline configuration mid-flight |

---

## 8. UI Integration

### Status Line
Show current stage in footer:
```typescript
ctx.ui.setStatus("ralplan", `📋 ${currentStage.name} (${progress})`);
```

### Widget
Show pipeline progress above editor:
```typescript
ctx.ui.setWidget("ralplan-progress", [
  "[OK] Idea Expansion",
  ">>> Consensus Planning (iter 2)",
  "[..] Execution",
  "[--] QA",
]);
```

### Notifications
```typescript
ctx.ui.notify("RALPLAN: Moving to Execution stage", "info");
```

---

## 9. Subagent Integration

For consensus planning, use Pi's subagent pattern (spawn separate `pi` processes):

```typescript
async function spawnPlanner(specPath: string, task: string): Promise<string> {
  // Use pi's built-in subagent extension pattern
  // or spawn pi process with --mode json
  const result = await pi.exec("pi", [
    "-p",
    "--mode", "json",
    "--tools", "read,bash,write",
    `--system-prompt", "You are a Planner. Create implementation plans.",
    `Read ${specPath} and create an implementation plan for: ${task}`,
  ]);
  return result.stdout;
}
```

Alternatively, if the `subagent` extension is installed, use its tool:
```typescript
// The LLM calls the subagent tool with:
{
  agent: "planner",
  task: "Create implementation plan from spec.md",
  model: "opus"
}
```

---

## 10. Configuration

Project-level `.pi/settings.json`:
```json
{
  "ralplan": {
    "planning": "ralplan",
    "execution": "solo",
    "verification": {
      "engine": "ralph",
      "maxIterations": 100
    },
    "qa": true,
    "artifactsDir": ".pi/ralplan/plans"
  }
}
```

---

## 11. Implementation Phases

### Phase 1: Core Extension Skeleton (MVP)
- [ ] Create `ralplan` extension with basic event handlers
- [ ] Implement state management (session entries + file)
- [ ] Implement pipeline stage machine
- [ ] Register `/ralplan` command
- [ ] Implement signal detection
- [ ] Basic prompt injection via `before_agent_start`

### Phase 2: Stage Prompts
- [ ] Write expansion prompt (Phase 0)
- [ ] Write ralplan consensus prompt (Phase 1)
- [ ] Write direct planning prompt (Phase 1 alternate)
- [ ] Write execution prompt (Phase 2)
- [ ] Write QA prompt (Phase 3)

### Phase 3: Artifact Management
- [ ] Implement artifact reader/writer
- [ ] Create `.pi/ralplan/plans/` directory management
- [ ] Implement `isPlanningComplete()` quality gates
- [ ] Add artifact listing command

### Phase 4: Skill Package
- [ ] Create `SKILL.md` with consensus workflow
- [ ] Create role prompt templates (planner, architect, critic)
- [ ] Package as installable pi package

### Phase 5: Polish
- [ ] UI widgets and status line
- [ ] Configuration via settings.json
- [ ] Resume from interrupted sessions
- [ ] Cancel/skip stage commands
- [ ] Documentation and examples

---

## 12. Key Design Decisions

### Why Session Entries + File State?
Pi supports session branching (`/tree`, `/fork`). Session entries (`pi.appendEntry`) follow branches, while file state is global. Using both ensures:
- **Branching**: Each branch has its own ralplan state
- **Resume**: File state allows resuming even if session entries are lost

### Why Extension + Skill (not just Skill)?
- **Skill alone**: Can only provide instructions; cannot hook into lifecycle events
- **Extension alone**: Can manage state and inject prompts, but skill provides progressive disclosure (only load full instructions when needed)
- **Together**: Skill provides the "what" (planning workflow), extension provides the "how" (state management, prompt injection, signal detection)

### No Built-in Subagents?
Following Pi's philosophy: "No sub-agents. There's many ways to do this." The extension guides the LLM to spawn subagents using existing tools (bash to spawn `pi`, or the `subagent` extension if installed). This avoids baking in a specific subagent model.

### Ralplan-First Gate
Like OMC, if a user invokes heavy execution (implied by broad requests), the extension can inject a message suggesting ralplan first. However, this is advisory — Pi doesn't hard-block, it guides.

---

## 13. Testing Strategy

1. **Unit tests** for state machine transitions
2. **Integration tests** with mock `ExtensionAPI`
3. **Manual tests** for each pipeline stage
4. **Session resume tests** (branch, fork, resume)
5. **Artifact quality gate tests**

---

## 14. Files to Create

```
ralplan-pi-package/
├── package.json
├── pi
│   └── extensions/
│       └── ralplan/
│           ├── index.ts
│           ├── state.ts
│           ├── pipeline.ts
│           ├── prompts.ts
│           ├── adapters.ts
│           ├── signals.ts
│           ├── artifacts.ts
│           └── utils.ts
└── pi
    └── skills/
        └── ralplan/
            ├── SKILL.md
            └── prompts/
                ├── planner.md
                ├── architect.md
                └── critic.md
```

---

## Appendix: OMC → Pi Code Mapping

| OMC File | Pi File | Notes |
|----------|---------|-------|
| `src/hooks/autopilot/adapters/ralplan-adapter.ts` | `adapters.ts` — `ralplanAdapter` | Same interface, different injection mechanism |
| `src/hooks/autopilot/pipeline.ts` | `pipeline.ts` | Uses Pi events instead of shell hooks |
| `src/hooks/autopilot/pipeline-types.ts` | `pipeline.ts` (types inline) | Simpler — no need for separate types file |
| `src/hooks/autopilot/state.ts` | `state.ts` | Dual persistence: session entries + file |
| `src/hooks/autopilot/prompts.ts` | `prompts.ts` | Adapted for Pi's single-session model |
| `src/hooks/autopilot/adapters/execution-adapter.ts` | `adapters.ts` — `executionAdapter` | Subagent spawning via bash or subagent extension |
| `src/hooks/keyword-detector/index.ts` | `index.ts` — `input` event handler | Detect `/ralplan` and keyword |
| `src/hooks/bridge.ts` | `index.ts` — event handlers | Consolidated into single extension |
| `src/planning/artifacts.ts` | `artifacts.ts` | Path changed from `.omc/plans` to `.pi/ralplan/plans` |
| `src/lib/mode-names.ts` | `pipeline.ts` — constants | Simpler — only ralplan pipeline stages |
| `src/hooks/skill-state/index.ts` | `state.ts` | Workflow slots replaced with in-memory + session state |
