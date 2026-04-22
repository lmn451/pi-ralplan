# Implementation Plan: Fix pi-pomodoro Review Findings

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

**Invalidation rationale for B:** The review explicitly says "no major refactoring." The extension is production-ready; architectural refactoring is out of scope.  
**Invalidation rationale for C:** The non-critical findings (README, harness duplication, auto-start aggressiveness) are quick fixes and directly improve UX and maintainability. Skipping them leaves known debt.

---

## ADR

**Decision:** Implement all 9 findings as localized, tested fixes (Option A).  
**Drivers:** Low complexity, high user-visible value, no API breakage.  
**Alternatives considered:** B (refactor), C (subset only).  
**Why chosen:** Fastest path to resolving all known issues without scope creep.  
**Consequences:** `setInterval` precision remains a known limitation documented in README.  
**Follow-ups:** Consider adding `--pomodoro-config` or `settings.json` support if users request configurable auto-start.

---

## Implementation Steps

### Step 1: Extract Shared Test Harness
**Files:** `tests/harness.ts` (new), `pomodoro.integration.test.ts`, `pomodoro.security.test.ts`

- Create `tests/harness.ts` exporting `createHarness(entries?)` with the exact signature both test files currently use.
- Remove duplicate `createHarness` from `pomodoro.integration.test.ts` and `pomodoro.security.test.ts`.
- Update imports in both files to use the shared harness.

**Acceptance criteria:**
- [ ] `bun test` still passes 80 tests.
- [ ] Only one `createHarness` definition exists in the repo.

### Step 2: Fix Null `ctx` and Auto-Start Aggressiveness
**Files:** `pomodoro.ts`

- In `agent_end` handler, add an early return if `ctx` is falsy.
- Soften auto-start heuristic: require at least 1 session to have already been started OR add a `sessionsStarted` counter (separate from `sessionsCompleted`) so auto-start only fires once per session lifetime.
- Alternative simpler approach: only auto-start if `messages.length <= 2` AND it's not a greeting AND `ctx` is available — but also require that no prior auto-start has happened. Use a module-level flag `hasAutoStarted` to prevent repeated triggers.

**Acceptance criteria:**
- [ ] `agent_end` with `ctx === null` does not throw.
- [ ] Auto-start fires at most once per extension lifetime.

### Step 3: Cap Focus String Length and Durations
**Files:** `pomodoro.ts`

- Add `MAX_FOCUS_LENGTH = 200` constant.
- In `startTimer` and command/tool focus setters, truncate focus with `.slice(0, MAX_FOCUS_LENGTH)`.
- Add `MAX_DURATION_MINUTES = 180` constant.
- In `parseDurationMinutes` or the `set` command handler, cap each parsed value to `MAX_DURATION_MINUTES`.

**Acceptance criteria:**
- [ ] Focus "A".repeat(1000) is stored as 200-character string.
- [ ] `/pomodoro set 999 999 999` caps to 180 min each.
- [ ] Tests verify both caps.

### Step 4: Add `help` Command and Shortcut `ctx` Access
**Files:** `pomodoro.ts`

- Add `case "help":` to command switch that falls through to the default help message.
- In `registerShortcut` handler, accept `extensionCtx` parameter (check Pi API — if shortcut handler signature supports it) or store `ctx` globally so the shortcut can call `ctx?.ui.notify` on toggle.

**Acceptance criteria:**
- [ ] `/pomodoro help` shows usage message.
- [ ] Keyboard shortcut toggle shows "Timer paused" or "Timer started" notification.

### Step 5: Update README and Add Precision Note
**Files:** `README.md`

- Update test count from "36 tests" to "80 tests across 3 files".
- List all test files: `pomodoro.test.ts`, `pomodoro.integration.test.ts`, `pomodoro.security.test.ts`.
- Add a "Known Limitations" section noting that `setInterval` has ~1s precision drift.

**Acceptance criteria:**
- [ ] README accurately reflects test suite size.
- [ ] Known limitations section exists.

### Step 6: Verification
**Command:** `cd ~/dev/pi-pomodoro && bun test`

**Acceptance criteria:**
- [ ] All 80+ tests pass.
- [ ] No TypeScript compilation errors.

---

## Unit Coverage

| Behavior | Test File | Test Count |
|---|---|---|
| Shared harness exports | `tests/harness.ts` | implicit via existing tests |
| Null ctx in agent_end | `pomodoro.integration.test.ts` | 1 new |
| Auto-start deduplication | `pomodoro.integration.test.ts` | 1 new |
| Focus truncation | `pomodoro.security.test.ts` | 1 new |
| Duration max cap | `pomodoro.integration.test.ts` | 1 new |
| Help command | `pomodoro.integration.test.ts` | 1 new |
| Shortcut notification | `pomodoro.integration.test.ts` | 1 new |

**Total new tests:** 6

## Verification Mapping

| Spec AC | Plan Step | Verification |
|---|---|---|
| AC-1 | Step 6 | `bun test` passes 86+ |
| AC-2 | Step 3 | Security test: long focus truncated |
| AC-3 | Step 3 | Integration test: set 999 999 999 → capped |
| AC-4 | Step 2 | Integration test: agent_end null ctx |
| AC-5 | Step 5 | Manual README review |
| AC-6 | Step 4 | Integration test: help command |
| AC-7 | Step 1 | grep shows only one createHarness definition |
| AC-8 | Step 4 | Integration test: shortcut toggle notification |

---

## Consensus Signatures

- **Planner:** Approved — 6 focused steps, clear acceptance criteria.
- **Architect:** Approved — steelman: auto-start deduplication flag adds module state; tradeoff is simpler than config system. Acceptable for low-complexity fix.
- **Critic:** Approved — no critical gaps. Pre-mortem: if Pi shortcut API doesn't pass context, Step 4 may need adjustment. Risk is low.

**Pre-mortem (DELIBERATE mode not required; added for completeness):**
1. *Pi shortcut handler signature lacks context param* → Step 4 uses global `ctx` fallback; already handled.
2. *Shared harness extraction breaks import paths* → Fix by adjusting `tsconfig.json` or using relative paths.
3. *Auto-start deduplication flag persists across sessions* → Flag lives in module closure; sessions restart extension, so flag resets. Safe.
