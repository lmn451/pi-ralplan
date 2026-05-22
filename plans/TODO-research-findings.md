# RALPLAN Research Findings — Actionable TODO

> This file organizes all identified issues from the research findings into actionable sub-tasks.
> Each item has a clear problem statement, priority level, and specific implementation steps.

---

## Critical Issues (Must Fix Before Production)

### 1. Worktree created but not used as agent cwd

**Priority:** Critical

## The Problem

When `/ralplan` or `--ralplan` fires, a Git worktree is created and its path is stored in `state.worktreePath`, but the agent session continues running in the original `sessionCwd` rather than switching to the worktree. This means spec/plan artifacts are written to the main repo instead of the isolated worktree.

## Sub-Tasks

- [ ] **Add `cwd` field to pipeline context** — Add `cwd: string` to `PipelineContext` interface in `pipeline.ts`, initialized from `state.worktreePath ?? sessionCwd` (see `getWorkspaceDir()` in `index.ts`)
- [ ] **Thread `cwd` through adapter `getPrompt()` calls** — Update all adapter `getPrompt()` signatures to receive the workspace dir and include it in prompts: "Your working directory is `{worktreePath}`. All file operations must happen within this directory."
- [ ] **Set worktree as process.cwd() before agent start** — In `before_agent_start` handler (`index.ts` line ~871), add logic to `process.chdir(state.worktreePath)` when a worktree exists, before the agent begins execution
- [ ] **Add test: verify files land in worktree** — Write a test that calls `/ralplan`, submits a signal, and verifies spec/plan files exist under `worktreePath/plans/` not `sessionCwd/plans/`

---

### 2. No worktree cleanup — orphaned worktrees accumulate

**Priority:** Critical

## The Problem

Worktrees are created on every `/ralplan` invocation but never removed when the pipeline completes, fails, or is cancelled. Over time, the `worktrees/` directory accumulates orphaned feature branches and worktrees, polluting the repo.

## Sub-Tasks

- [ ] **Call `cleanupWorktree()` in `deactivateState()`** — Add `cleanupWorktree(state.worktreePath)` to `deactivateState()` in `index.ts` (line ~178). Guard with `if (state.worktreePath && existsSync(state.worktreePath))`
- [ ] **Add try/catch around cleanup with warning** — If cleanup fails (e.g., uncommitted files), log a warning but don't block deactivation. Notify user: "Worktree cleanup failed — you may need to manually remove `{path}`"
- [ ] **Add `ralplan:cleanup` command** — Register a new command `ralplan:cleanup` that calls `cleanupWorktree()` on a specified path or the current `state.worktreePath`, for manual cleanup escape hatch
- [ ] **Add `autoCleanup` to WorktreeConfig** — When `config.autoCleanup = true`, automatically attempt cleanup on `deactivateState()`. Default is `false` (per `DEFAULT_AUTO_CLEANUP` in `worktree.ts`)
- [ ] **Add test: verify cleanup on cancel** — Write a test that starts `/ralplan`, cancels it, and verifies the worktree was removed via `git worktree list`

---

### 3. Consensus loop described in docs/prompts but NOT implemented in code

**Priority:** Critical

## The Problem

The prompts describe a `Planner → Architect → Critic → iterate until consensus` loop, but the actual implementation in `prompts.ts` (`getDirectPlanningPrompt`) only mentions this loop in prose — there's no code implementation. The AI is told to "spawn Architect", "spawn Critic", and "retry" but no structured iteration mechanism exists. The loop is purely prompt-instructed, meaning it depends on the AI self-managing the cycle.

## Sub-Tasks

- [ ] **Define explicit iteration state** — Add to `PipelineStageState` in `pipeline.ts`: `{ iterations: number, approved: boolean, rejectionReasons: string[] }`. The `iterations` field already exists (line 53); add the other two.
- [ ] **Create `ConsensusLoop` module** — Create `pi/extensions/ralplan/consensus.ts` with: `ConsensusState` interface (`currentRole: "planner" | "architect" | "critic", iteration: number, approved: boolean, rejections: string[]`), `createConsensusState()` factory, and `advanceConsensusRole(state)` function that cycles Planner→Architect→Critic→Planner
- [ ] **Implement structured spawn calls** — In the adapter's `getPrompt()` for ralplan stage, instead of prose instructions like "Spawn Architect", generate explicit `Task()` calls with structured prompts for each role. Each role prompt should include the current iteration context and any previous rejection reasons
- [ ] **Add `consensusSignal` detection** — In `signals.ts`, add new signals: `CONSENSUS_APPROVED` and `CONSENSUS_REJECTED`. Update `detectSignal()` to parse these structured signals with rejection metadata
- [ ] **Wire iteration counting to consensus state** — In `agent_end` handler (`index.ts` line ~978), when `currentStage.id === "ralplan"` and `state.mode === "ralplan"`, check for `CONSENSUS_APPROVED` or `CONSENSUS_REJECTED` signals and increment `consensusState.iteration` accordingly
- [ ] **Enforce max iterations (5)** — When `iteration >= maxIterations` and no consensus reached, advance to next stage automatically (or escalate to user), rather than looping indefinitely
- [ ] **Add test: verify iteration cycles** — Write a test that mocks Architect and Critic responses, submits a REJECT signal, and verifies the iteration counter increments and Architect receives rejection feedback

---

### 4. Signal detection too loose (can fire from comments)

**Priority:** Critical

## The Problem

`detectSignal()` in `signals.ts` (line 14) does a simple `text.includes(signal)`. This means if a signal string like `PIPELINE_RALPLAN_COMPLETE` appears anywhere in assistant output — even in a code comment like `// TODO: remember to signal PIPELINE_RALPLAN_COMPLETE` — the stage advances prematurely.

## Sub-Tasks

- [ ] **Implement boundary-aware signal detection** — Replace `text.includes(signal)` with a regex that matches the signal only as a standalone "output" token. Pattern: `/(?:\n|^|\s)PIPELINE_RALPLAN_COMPLETE(?:\n|$|\s|[.,;])/i`. Use this pattern in `detectSignal()` and `detectBrainstormSignal()`
- [ ] **Add signal context check** — For extra safety, check that the signal appears in a meaningful context (not inside a code block or comment). Pattern: split text by triple backticks, only check segments that aren't inside code blocks
- [ ] **Add test: signal in comment must NOT fire** — Write a test with assistant output like `// remember to add PIPELINE_RALPLAN_COMPLETE when done` and assert `detectSignal()` returns `false`
- [ ] **Add test: signal in code block must NOT fire** — Write a test with output like ` ```js\nconsole.log("PIPELINE_RALPLAN_COMPLETE")\n``` ` and assert `detectSignal()` returns `false`
- [ ] **Add test: signal on own line MUST fire** — Write a test with output just containing `PIPELINE_RALPLAN_COMPLETE` and assert `detectSignal()` returns `true`

---

## Major Issues (Should Fix)

### 5. Eager worktree creation before any planning

**Priority:** Major

## The Problem

The `before_agent_start` handler (line ~871) creates a worktree immediately when `--ralplan` fires, before the spec is even written. If the user abandons the session or the spec phase fails, a worktree sits orphaned. The worktree should be created only when the spec is finalized and we're about to enter the planning stage.

## Sub-Tasks

- [ ] **Defer worktree creation to spec completion** — Move `createWorktree()` call out of the initial activation handlers (`/ralplan` command at line ~283 and `before_agent_start` at line ~871) into the `onEnter` callback of the execution adapter (in `adapters.ts`)
- [ ] **Add `worktreeCreated` flag to state** — Track `worktreeCreated: boolean` in `RalplanState` so the execution adapter knows whether to create vs reuse
- [ ] **Create worktree only when entering execution stage** — In `executionAdapter.onEnter()`, check if `!state.worktreePath`, then call `createWorktree()`. If already exists from spec phase (when we eventually create it), skip
- [ ] **Add test: verify no worktree before execution** — Write test that starts `/ralplan` and asserts no worktree exists until after spec is complete

---

### 6. Iteration count increments even when waiting for user input

**Priority:** Major

## The Problem

`incrementStageIteration()` in `pipeline.ts` (line 298) is called unconditionally on every `turn_end`. This means the iteration counter for the current stage increments even when the pipeline is paused waiting for user answers (brainstorm `awaiting-answers` sub-phase), inflating the count without actual work happening.

## Sub-Tasks

- [ ] **Guard iteration increment with active-sub-phase check** — In `turn_end` handler (`index.ts` line ~1191), add a check before calling `incrementStageIteration()`: only increment if the current sub-phase is NOT `awaiting-answers` (for brainstorm) AND the stage is `active`
- [ ] **Add `stageActive` field to `PipelineStageState`** — Add `isProcessing: boolean` to track whether the stage is doing work vs waiting. Set `isProcessing = true` at stage start, `false` when waiting for external input, `true` when resumed
- [ ] **Add test: verify no increment during awaiting-answers** — Write a test that triggers brainstorm, enters `awaiting-answers`, calls `turn_end` multiple times, and asserts iterations did NOT increase

---

### 7. Worktree path collision risk (duplicate names)

**Priority:** Major

## The Problem

`createWorktree()` in `worktree.ts` creates worktrees with names derived from the idea (slugified, 40-char max). If two sessions start with ideas that result in the same slug (e.g., "Implement user auth" and "Implement user login"), both worktrees would have the same path and collide.

## Sub-Tasks

- [ ] **Add UUID/suffix to worktree name** — Modify the worktree name generation in `index.ts` (line ~308-313) to append a short unique suffix: use `Date.now().toString(36)` or `crypto.randomUUID()` for uniqueness while keeping readability
- [ ] **Check for existing worktree with same name + handle collision** — In `createWorktree()`, before creating, check if `existsSync(worktreePath)`. If it does, append `-2`, `-3`, etc. (iterate until available name found)
- [ ] **Add `listWorktrees()` collision check** — When generating worktree name, call `listWorktrees()` and exclude any names that would collide
- [ ] **Add test: verify collision handled** — Write a test that creates two worktrees with the same slugified name and verifies both exist with unique paths

---

### 8. Auto-start mode vs session reconstruction race

**Priority:** Major

## The Problem

`autoStartMode` (line 120) and `session_start`/`session_tree` handlers both try to reconstruct or activate state, but `before_agent_start` also has its own auto-start logic. If a session is resumed with existing state AND the `--ralplan` flag is present in the new prompt, both the resume path and the auto-start path could fire, leading to duplicate worktree creation or state corruption.

## Sub-Tasks

- [ ] **Set autoStartMode to null after session reconstruction** — In `reconstructFromSession()` (line 230), after successfully reconstructing state, explicitly set `autoStartMode = null` to prevent `before_agent_start` from firing auto-start logic on a resumed session
- [ ] **Check `isActive()` before auto-start logic** — In `before_agent_start` (line 871), add `if (!isActive() && autoStartMode !== null)` guard (already present at line 881) but also check that we haven't just reconstructed: add `sessionManager.getEntries().some(e => e.type === "ralplan-state")` to skip auto-start if session already has ralplan state
- [ ] **Add test: resume with --ralplan flag must not double-create worktree** — Write a test that starts `/ralplan`, then simulates a resume with `--ralplan` flag, and asserts only one worktree exists

---

### 9. validateWorktree doesn't handle gitdir: file worktrees

**Priority:** Major

## The Problem

`validateWorktree()` in `worktree.ts` (line 72) only checks for `existsSync(join(path, ".git"))`. Git worktrees can also be created with the `gitdir: /path/to/actual/.git` file instead of a `.git` directory (bare worktrees, or worktrees on different filesystems). These worktrees pass the validation because `join(path, ".git")` returns a file path that `existsSync()` returns `false` for — but the worktree is valid.

## Sub-Tasks

- [ ] **Add gitdir: file detection to validateWorktree** — Check for both `.git` directory AND `.git` file (which contains `gitdir:` reference). If `.git` is a file, parse it and verify the referenced gitdir exists
- [ ] **Parse gitdir reference** — If `join(path, ".git")` exists as a file (not directory), read its contents, extract the path after `gitdir:`, and verify that path exists
- [ ] **Add test: validate worktree with gitdir: file** — Create a worktree with `gitdir:` file manually and verify `validateWorktree()` returns `true` for it
- [ ] **Update listWorktrees() parsing** — Ensure `listWorktrees()` in `worktree.ts` (line 156) correctly parses `gitdir:` entries from `git worktree list --porcelain` output

---

## Minor Issues (Nice to Fix)

### 10. No timeout on git execFileSync calls

**Priority:** Minor

## The Problem

All `execFileSync` calls in `worktree.ts` (lines 31, 43, 114, 122, 158, 175) and `detectDefaultBranch()` lack a timeout option. If Git operations hang (e.g., waiting for credentials, locked files), the entire Node process hangs indefinitely.

## Sub-Tasks

- [ ] **Add `{ timeout: 30000 }` to all execFileSync calls** — Add a 30-second timeout to every `execFileSync` call in `worktree.ts`. Use `execa` from `child_process` with proper timeout handling or wrap `execFileSync` with timeout signal
- [ ] **Handle timeout errors gracefully** — Catch `EMFILE` or timeout errors, log a clear message: "Git operation timed out after 30s — check your git configuration", and return `{ success: false, error: "timeout" }`

---

### 11. baseBranch regex too permissive-looking

**Priority:** Minor

## The Problem

In `worktree.ts` line 107, the regex `/^[a-zA-Z0-9._\/-]+$/` allows characters that are technically valid but unusual for branch names (e.g., `/`, `\`). While not a security issue (it's used to validate input, not pass to shell), it looks unintentional.

## Sub-Tasks

- [ ] **Update baseBranch validation regex** — Use the standard Git branch name rules: `^[a-zA-Z0-9._\/-]+$` is actually valid per Git documentation, but the slash is unusual. Consider splitting on `/` and validating each segment: `^[a-zA-Z0-9._-]+$` for each segment, or document why slashes are allowed
- [ ] **Add explicit comment** — Add a comment explaining that `baseBranch` can include `/` for branch paths like `feature/my-branch`

---

### 12. resolveWorktreeRoot creates nested dirs for worktree inputs

**Priority:** Minor

## The Problem

`resolveWorktreeRoot()` in `utils.ts` (line 32) returns `join(parent, `${name}-worktrees`)`. If `name` contains path separators, `join` will produce nested directories under the worktrees root (e.g., `myproject-worktrees/feature/plan` instead of `myproject-worktrees/feature-plan`).

## Sub-Tasks

- [ ] **Normalize worktree root name** — Before calling `join`, sanitize `name` to remove path separators: `name.replace(/[\/\\]/g, '-')` to prevent nested worktree roots
- [ ] **Add test: verify no nested worktree root** — Write a test with an idea that produces path separators and verify `resolveWorktreeRoot` doesn't create nested directories

---

### 13. autoCleanup config field never used

**Priority:** Minor

## The Problem

`autoCleanup` is defined in `WorktreeConfig` (line 18 in `worktree.ts`) and `DEFAULT_AUTO_CLEANUP` exists (line 12), but the field is never checked or used anywhere in the codebase. The cleanup decision is always manual.

## Sub-Tasks

- [ ] **Wire autoCleanup to deactivateState** — In `deactivateState()` (`index.ts` line 178), check `state.worktreeConfig?.autoCleanup` before calling `cleanupWorktree()`. If `true`, proceed; if `false` or `undefined`, skip and log a message like "Skipping auto-cleanup (run /ralplan:cleanup manually)"
- [ ] **Pass autoCleanup through to worktreeConfig** — In the handlers that create worktrees (`/ralplan` command, `before_agent_start`), populate the `autoCleanup` field from `state.pipeline.pipelineConfig.verification?.autoCleanup ?? false` (or add a dedicated config field)
- [ ] **Add test: verify autoCleanup respected** — Write a test that sets `autoCleanup: true`, calls `deactivateState()`, and asserts worktree was cleaned up

---

### 14. Max iterations (5) is advisory, not enforced

**Priority:** Minor

## The Problem

`DEFAULT_PIPELINE_CONFIG` in `pipeline.ts` (line 31) sets `maxIterations: 100` for verification, but `getRalphPrompt()` in `prompts.ts` (line 295) hardcodes "max 5 iterations". More importantly, the iteration count is never checked against `maxIterations` in the actual advancement logic — the pipeline just keeps looping.

## Sub-Tasks

- [ ] **Add iteration limit check before signal processing** — In `agent_end` (`index.ts` line ~978), before processing a consensus/signal, check `currentStage.iterations >= state.pipeline.pipelineConfig.verification?.maxIterations`. If exceeded, skip signal detection and either advance automatically or notify user
- [ ] **Use consistent maxIterations value** — Replace the hardcoded "5" in `getRalphPrompt()` with `${context.config.verification?.maxIterations ?? 100}` so prompts reflect actual config
- [ ] **Add escalation on max iterations** — When max is reached without consensus, send a message to the user: "Maximum iterations ({max}) reached without consensus. Please review and manually approve or restart." Do NOT auto-advance

---

_Last updated: 2026-05-22_
