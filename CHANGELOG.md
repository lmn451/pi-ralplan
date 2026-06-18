# Changelog

All notable changes to pi-ralplan are documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.5] - 2026-06-18

### Removed

- **Pre-execution "broad request" gate** — the heuristic that suggested `/ralplan` when a user typed a broad request (e.g. "build me X", "implement Y") has been removed. The role-prompt refactor (commit `8c518da`) plus the deep-interview skill (added in this release) make the heuristic obsolete: the user now has explicit entry points (`/ralplan`, `/brainstorm`, deep-interview) and agents can spawn planner/architect/critic directly. Users who relied on the "consider /ralplan first" hint will silently lose it. This is a UX change, not a correctness fix. See PR #4 and PR #5 in the closed PRs that introduced this.

### Added

- **Deep-interview skill** — structured multi-round interview workflow for capturing requirements before planning. Adds `pi/skills/deep-interview/SKILL.md` and six agent role prompts (`agents/analyst.md`, `agents/architect.md`, `agents/critic.md`, `agents/executor.md`, `agents/explore.md`, `agents/planner.md`). See PR #4.

### Fixed

- **DELIBERATE false-positives** — the `getRalplanDRSummaryTemplate` function used `idea.includes("rm")` to detect destructive prompts. "rm" matched `"format"`, `"charm"`, `"alarm"`, `"thermostat"`, `"firmware"`, and other benign substrings, forcing DELIBERATE mode on ideas that weren't actually destructive. Now uses word-boundary regex; the destructive intent must appear as a whole word.
- **`auth` ambiguity** — `"auth"` was too broad a substring (matched `"author"`, `"authentic"`, `"authority"`). Now uses the unambiguous long forms (`authentication`, `authorization`, `authorized`, `authorize`, `authorizing`).
- **`remove` signal** — added the destructive verb `remove` to the DELIBERATE signal list (was missing).
- **Worktree data loss on completion** — `deactivateState()` unconditionally ran `git worktree remove` after pipeline completion, surprising users who lost their work on accidental completion. Now respects the new `PipelineConfig.autoCleanup` flag (default `false` — preserve worktree on completion).
- **Worktree data loss on cancel** — `/ralplan:cancel` was also cleaning up the worktree, losing user work on accidental cancellation. Now always passes `suppressCleanup: true` so cancel preserves the worktree even when `autoCleanup` is on.
- **Per-stage iteration cap drift** — the runtime `turn_end` check and the prompt templates both read `config.verification.maxIterations`, but QA was capped at 100 instead of the 5 its prompt promised. Now a single `getStageMaxIterations(stageId, config)` helper is the source of truth for both.
- **Malformed session entry crash** — `reconstructFromSession` asserted session data as `PersistedState` via a cast, but the actual value could be malformed (corrupted session log, older extension version). Now uses an `isPersistedState` type guard and falls through to file-based state on failure.
- **Duplicate worktree-name sanitization** — `adapters.ts` and `worktree.ts` had identical sanitization logic; drift was possible. Now both call `deriveWorktreeName` in `utils.ts`.
- **Worktree config was dead code** — `WorktreeConfig.autoCleanup` was defined but never read. The `PipelineConfig.autoCleanup` field added in this release actually wires the cleanup behavior.

### Refactored

- **Pre-execution gate module removed** — `pi/extensions/ralplan/gate.ts` and `tests/gate.test.ts` deleted. The 17 tests covering the heuristics are gone with the code.
- **`generateWorktreeName` removed from adapters** — replaced by `deriveWorktreeName` in `utils.ts`; `adapters.ts` now imports it from the single source of truth.

### Changed

- **Console noise reduced** — three `console.log` calls in production paths removed; one replaced with `ctx.ui.notify` so the TUI user sees the worktree path. The four remaining `console.warn` calls are real error paths and stay.

[Unreleased]: https://github.com/lmn451/pi-ralplan/compare/v0.1.5...HEAD
[0.1.5]: https://github.com/lmn451/pi-ralplan/compare/v0.1.4...v0.1.5
