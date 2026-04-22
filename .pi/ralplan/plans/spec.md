# Specification: Fix pi-pomodoro Review Findings

Address all issues identified in the comprehensive code review of `~/dev/pi-pomodoro`.

## 1. Requirements Analysis

### 1.1 Functional Requirements

| ID | Requirement | Priority | Finding # |
|---|---|---|---|
| FR-1 | Guard `agent_end` handler against null/undefined `ctx` before calling UI methods | Must | #1 |
| FR-2 | Make `agent_end` auto-start behavior configurable or less aggressive | Must | #2 |
| FR-3 | Extract shared `createHarness` test utility into a single module | Must | #3 |
| FR-4 | Cap focus string length to prevent UI/prompt bloat (max ~200 chars) | Must | #4 |
| FR-5 | Add reasonable upper bound to `set` command duration values | Must | #6 |
| FR-6 | Update README test count and test file references to reflect 80 tests | Must | #7 |
| FR-7 | Add explicit `help` subcommand to `/pomodoro` command handler | Should | #10 |
| FR-8 | Ensure `registerShortcut` toggle handler has access to `ctx` for notifications | Should | #9 |
| FR-9 | Document `setInterval` precision limitation in README or code comments | Could | #5 |

### 1.2 Non-Functional Requirements

| ID | Requirement | Priority |
|---|---|---|
| NFR-1 | All 80 existing tests must continue to pass | Must |
| NFR-2 | New tests must be added for any changed behavior (focus cap, duration cap, null ctx) | Must |
| NFR-3 | No breaking changes to public command or tool API | Must |
| NFR-4 | Maintain TypeScript strict mode compatibility | Must |

### 1.3 Implicit Requirements

- Test utility extraction must not change test semantics
- Focus truncation must preserve meaningful content (truncate, not reject)
- Duration upper bound should be generous enough for real use (e.g., 180 min) but prevent abuse
- `agent_end` null ctx fix should be defensive, not a redesign

### 1.4 Out of Scope

- Replacing `setInterval` with a high-precision timer (noted as limitation only)
- Major architectural refactoring of the extension
- Adding new features beyond fixing reviewed issues
- Rewriting test framework or switching test runner

## 2. Technical Specification

### 2.1 Tech Stack

| Layer | Technology | Rationale |
|---|---|---|
| Language | TypeScript | Existing codebase standard |
| Testing | bun:test | Already in use, zero config |
| Extension API | `@mariozechner/pi-coding-agent` | Native Pi integration |

### 2.2 Architecture

No architectural changes. All fixes are localized to existing modules:
- `pomodoro.ts` — main extension logic
- `pomodoro.test.ts` — core unit tests (reuses extracted harness)
- `pomodoro.integration.test.ts` — integration tests (uses extracted harness)
- `pomodoro.security.test.ts` — security tests (uses extracted harness)
- `tests/harness.ts` — **NEW** shared test harness
- `README.md` — documentation fixes

### 2.3 File Structure

```
pi-pomodoro/
├── pomodoro.ts                     # Main extension (fixes FR-1,2,4,5,7,8,9)
├── pomodoro.test.ts                # Core tests (uses new harness)
├── pomodoro.integration.test.ts    # Integration tests (uses new harness)
├── pomodoro.security.test.ts       # Security tests (uses new harness)
├── tests/
│   └── harness.ts                  # NEW: shared createHarness utility
├── README.md                       # Updated test counts
└── package.json
```

### 2.4 API / Interface Changes

**No breaking changes.**

**Behavioral changes:**
- `/pomodoro focus <task>` — tasks longer than 200 chars are silently truncated
- `/pomodoro set <work> <break> <long>` — each duration capped at 180 minutes max
- `agent_end` auto-start — disabled when `ctx` is null; may also be gated by session count
- `/pomodoro help` — now an explicit alias for the default help message

## Acceptance Criteria

- [ ] AC-1: `bun test` passes with 80+ tests (existing + new)
- [ ] AC-2: Focus strings >200 chars are truncated in state, status, and notifications
- [ ] AC-3: `/pomodoro set 200 200 200` caps to max allowed duration
- [ ] AC-4: `agent_end` handler does not throw if `ctx` is null
- [ ] AC-5: README accurately states total test count and lists all test files
- [ ] AC-6: `/pomodoro help` displays usage information
- [ ] AC-7: No duplicate `createHarness` definitions across test files
- [ ] AC-8: Keyboard shortcut toggle shows notification when stopping

## Requirement Coverage Map

| Requirement | Files Changed | Tests Added |
|---|---|---|
| FR-1 (null ctx) | `pomodoro.ts` | integration test for `agent_end` with null ctx |
| FR-2 (auto-start) | `pomodoro.ts` | integration test for aggressive auto-start gate |
| FR-3 (shared harness) | `tests/harness.ts`, `*.test.ts` | verify harness exports all needed properties |
| FR-4 (focus cap) | `pomodoro.ts` | security + integration tests for truncation |
| FR-5 (duration cap) | `pomodoro.ts` | integration test for max duration rejection |
| FR-6 (README) | `README.md` | — |
| FR-7 (help cmd) | `pomodoro.ts` | integration test for help command |
| FR-8 (shortcut ctx) | `pomodoro.ts` | integration test for shortcut notification |
| FR-9 (precision note) | `README.md` | — |
