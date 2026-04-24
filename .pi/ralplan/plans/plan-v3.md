# Implementation Plan: Fix pi-pomodoro Review Findings (v3 — Final)

**Scope:** 9 findings across `pomodoro.ts`, test files, and `README.md`
**Complexity:** LOW-MEDIUM
**Estimated effort:** Small — localized fixes, no architecture changes
**Target project:** `~/dev/pi-pomodoro`

---

## RALPLAN-DR Consensus Summary

### Principles
1. **Minimal change** — Fix the finding, don't redesign adjacent code.
2. **Defensive over permissive** — Reject/cap bad input rather than silently accepting it.
3. **Test every behavioral change** — New behavior gets a new test.
4. **No breaking API changes** — Existing commands and tools keep working.
5. **DRY tests** — Extract shared infrastructure once, use everywhere.
6. **Session-safe state** — Module-level flags must reset on `session_start` to survive multi-session lifecycles.

### Decision Drivers
1. User experience: the auto-start feature was surprising; it needs to be less aggressive.
2. Safety: unbounded focus strings and durations can bloat prompts and state.
3. Maintainability: duplicated harness code is already drifting.

### Viable Options

| Option | Pros | Cons |
|---|---|---|
| **A. Fix all findings directly** (chosen) | Fast, low risk, focused | Doesn't address deeper timer precision issue |
| **B. Refactor extension architecture first** | Cleaner long-term code | Massive scope creep; rewrites working code |
| **C. Only fix critical findings (null ctx, duration cap)** | Smallest blast radius | Leaves README, harness duplication, auto-start unaddressed |
| **D. Add full config/settings support for auto-start** | Proper UX | Out of scope per spec; adds complexity |

**Invalidation rationale for B:** The review explicitly says "no major refactoring." The extension is production-ready; architectural refactoring is out of scope.
**Invalidation rationale for C:** The non-critical findings (README, harness duplication, auto-start aggressiveness) are quick fixes and directly improve UX and maintainability. Skipping them leaves known debt.
**Invalidation rationale for D:** Config system is out of scope. `hasAutoStarted` + `session_start` reset is the minimal viable fix.

---

## ADR

**Decision:** Implement all 9 findings as localized, tested fixes (Option A).
**Drivers:** Low complexity, high user-visible value, no API breakage.
**Alternatives considered:** B (refactor), C (subset only), D (config system).
**Why chosen:** Fastest path to resolving all known issues without scope creep. Config system deferred to follow-up.
**Consequences:** `setInterval` precision remains a known limitation documented in README. Auto-start is session-scoped via `session_start` reset.
**Follow-ups:** Consider adding `settings.json` support if users request configurable auto-start.

---

## Implementation Steps

### Step 1: Extract Shared Test Harness (with shortcut support)
**Files:** `tests/harness.ts` (new), `pomodoro.integration.test.ts`, `pomodoro.security.test.ts`

- Create `tests/harness.ts` exporting `createHarness(entries?)`.
- The harness must capture `registerShortcut` calls into a `shortcuts` map and expose a `triggerShortcut(name)` async helper.
- Remove duplicate `createHarness` from `pomodoro.integration.test.ts` and `pomodoro.security.test.ts`.
- Update imports in both files to use the shared harness.
- **NOTE:** `pomodoro.test.ts` remains standalone — its helpers are pure logic tests.

**Acceptance criteria:**
- [ ] `bun test` still passes 80 tests.
- [ ] Only one `createHarness` definition exists.
- [ ] Harness exposes `triggerShortcut("ctrl+shift+p")` that invokes the registered handler.

### Step 2: Fix Null `ctx` and Auto-Start Aggressiveness
**Files:** `pomodoro.ts`

- Add `let hasAutoStarted = false` at module scope.
- In `session_start` handler: reset `hasAutoStarted = false` after restoring state.
- In `agent_end` handler:
  - `if (hasAutoStarted || state.isRunning || state.sessionsCompleted > 0) return;`
  - `if (!ctx) return;`
- `agent_end` auto-start logic unchanged except for `hasAutoStarted = true` after firing.

**Acceptance criteria:**
- [ ] `agent_end` with `ctx === null` does not throw.
- [ ] Auto-start fires at most once per session.
- [ ] **NEW:** Auto-start fires again after a new `session_start` (multi-session test).

### Step 3: Cap Focus String Length and Durations
**Files:** `pomodoro.ts`

- Add `MAX_FOCUS_LENGTH = 200` constant.
- Add `truncateFocus(focus: string): string` helper.
- Apply `truncateFocus()` in: `startTimer`, command `focus` handler, `pomodoro_focus` tool.
- Add `MAX_DURATION_MINUTES = 180` constant.
- Apply `Math.min(minutes, MAX_DURATION_MINUTES)` in `parseDurationMinutes`.

**Acceptance criteria:**
- [ ] Focus "A".repeat(1000) stored as 200 chars.
- [ ] `/pomodoro set 999 999 999` caps to 180 min each.
- [ ] Tests verify both caps.

### Step 4: Add `help` Command and Shortcut Notifications
**Files:** `pomodoro.ts`

- Add `case "help":` to command switch.
- In `registerShortcut` handler: use `ctx?.ui.notify()` for both start and stop.

**Acceptance criteria:**
- [ ] `/pomodoro help` shows usage.
- [ ] **NEW:** Shortcut toggle shows notification via `triggerShortcut()` harness helper.

### Step 5: Update README
**Files:** `README.md`

- Update test count to 85+ across 3 files.
- List all test files.
- Add "Known Limitations" with `setInterval` drift note.
- Add `/pomodoro help` to command table.

**Acceptance criteria:**
- [ ] README accurate.

### Step 6: Verification
**Command:** `cd ~/dev/pi-pomodoro && bun test`

**Acceptance criteria:**
- [ ] All 85+ tests pass.
- [ ] `bun build pomodoro.ts` succeeds.

---

## Unit Coverage

| Behavior | Test File | Test Count |
|---|---|---|
| Shared harness with shortcut support | implicit | via suites |
| Auto-start deduplication per session | `pomodoro.integration.test.ts` | 2 new |
| Auto-start reset across sessions | `pomodoro.integration.test.ts` | 1 new |
| Focus truncation | `pomodoro.security.test.ts` | 1 new |
| Duration max cap | `pomodoro.integration.test.ts` | 1 new |
| Help command | `pomodoro.integration.test.ts` | 1 new |
| Shortcut notification | `pomodoro.integration.test.ts` | 1 new (via triggerShortcut) |

**Total new tests:** 7

## Verification Mapping

| Spec AC | Plan Step | Verification |
|---|---|---|
| AC-1 | Step 6 | `bun test` passes 85+ |
| AC-2 | Step 3 | Security test: long focus truncated |
| AC-3 | Step 3 | Integration test: set 999 999 999 → capped |
| AC-4 | Step 2 | Integration test: agent_end null ctx safe |
| AC-5 | Step 5 | Manual README review |
| AC-6 | Step 4 | Integration test: help command |
| AC-7 | Step 1 | grep shows only one createHarness definition |
| AC-8 | Step 4 | Integration test: triggerShortcut shows notification |
