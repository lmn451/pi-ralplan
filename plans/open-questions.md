## Open Questions — 2026-06-01

**Scope (per user):** Disable the prompt-content-based auto-start. Instead, only show a notification message suggesting `/ralplan`.

This narrows the original 4-item review down to one focused change.

### Behavior to change

Currently in `index.ts:863-903` (`detectRalplanSkillUsage`) and the `before_agent_start` handler: when a user prompt contains keywords like `ralplan`, `brainstorm`, `consensus planning`, `architect review`, `critic review`, `plans/spec`, `plan.md`, etc., the extension auto-starts a RALPLAN pipeline.

**Goal:** Replace that auto-start with a notification, similar to what `looksLikeBroadRequest` (gate.ts) already does for broad requests.

### Open Questions

- [x] ~~Should the new behavior preserve the `--ralplan` / `--brainstorm` flag paths?~~ — **DECIDED:** Yes. Flag paths must still auto-start.
- [x] ~~What wording should the suggestion notification use?~~ — **DECIDED:** `"This prompt mentions RALPLAN. Run /ralplan to start a planning session."`
- [x] ~~Should the notification be `info` or `warning` level?~~ — **DECIDED:** `info` — it's a hint, not an error.
- [x] ~~Do we keep the `detectRalplanSkillUsage` function for any purpose?~~ — **DECIDED:** Yes — it still classifies the prompt (ralplan vs brainstorm) and may be useful for telemetry, so leave it in place but route to `notify` only.

### Implementation Notes

- `before_agent_start` should NOT mutate `autoStartMode` when only the prompt is detected.
- All 7 call sites of `deactivateState()` must be updated to pass `ctx` so the cleanup notify works.
- The `deactivateState(notifyCtx?)` signature is the only public change to that helper.
- Tests: add a T-5 regression test that asserts no `ralplan-state` session entry is appended when a prompt contains "ralplan" but no flag is set, and that a notification containing "/ralplan" is shown.

## Technical Approach - 2026-05-05

- [x] ~~Should worktrees be created in a dedicated `worktrees/` directory or alongside the main repo?~~ — **DECIDED:** `./worktrees/` within main repo for easy cleanup
- [x] ~~What happens if the user aborts mid-plan? Should the worktree be cleaned up?~~ — **DECIDED:** Optional cleanup on cancel via `autoCleanup` config
- [x] ~~Should ADR entries be versioned within the plan or as separate files?~~ — **DECIDED:** Embedded in plan for simplicity

## Implementation Details - 2026-05-05

- [x] ~~Should the worktree be created at the START of ralplan or at the START of execution?~~ — **DECIDED:** At planning start (ralplan stage) per user intent
- [x] ~~What should happen if worktree creation fails?~~ — **DECIDED:** Retry 3x with backoff, then hard fail

## Remaining Open Questions

None — all questions resolved in plan.
