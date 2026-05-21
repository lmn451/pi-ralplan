# Critic Review — Plan Draft v1

**Review Date:** 2026-05-21  
**Plan:** `plans/drafts/plan_draft.md`  
**Status:** **REVISION NEEDED**

---

## 1. Edge Cases NOT Covered

### T-1.1 (Windows Path Traversal)

**ISSUE 1: The plan's fix is inconsistent with the current codebase**

The plan's proposed fix (lines 56-67) shows:

```typescript
const normalized = name.replace(/\\/g, "/").replace(/\0/g, "");
if (normalized.includes("..") || normalized.includes("\0")) { ... }
if (normalized.startsWith("/") || /^[a-zA-Z]:/.test(normalized)) { ... }
return normalized.replace(/[^a-zA-Z0-9._\/-]/g, "-").slice(0, 50);
```

**But** the current code at `worktree.ts:57-63`:

```typescript
function sanitizeWorktreeName(name: string): string {
  if (name.includes("..") || name.includes("\0")) {
    throw new Error("Invalid worktree name: directory traversal detected");
  }
  return name.replace(/[^a-zA-Z0-9-_]/g, "-").slice(0, 50); // Note: no \/ allowed
}
```

**The current code does NOT normalize backslashes**, does NOT check for absolute paths, and does NOT allow `/` in the character class. The plan's "fix" shows a different implementation than what currently exists.

**ISSUE 2: Invalid character stripping removes forward slashes**

The character class `[^a-zA-Z0-9._\/-]` includes `\/` but the current code uses `[^a-zA-Z0-9-_]` — no forward slash allowed at all. If worktrees are stored in subdirectories (e.g., `features/my-plan`), this would break.

**ISSUE 3: Missing special characters not addressed**

The plan doesn't mention:

- Device names (`CON`, `PRN`, `AUX`, `NUL`, `COM1-9`, `LPT1-9`) — reserved on Windows
- Unicode homoglyphs (Cyrillic 'а' vs Latin 'a')
- Leading/trailing dots or spaces
- Names exceeding 255 characters

---

### T-1.2 (Auto-start Worktree)

**ISSUE 4: No timeout handling**

The plan copies the pattern from lines 307-338 but does NOT address what happens if worktree creation takes too long. The `before_agent_start` handler awaits this operation synchronously (line 898 calls `buildDefaultState`, then worktree creation would follow). If `createWorktree()` hangs on a slow git operation, the agent never starts.

**ISSUE 5: Race condition between worktree creation and state persistence**

The plan says (line 104): "Store result in `state.worktreePath`". But at line 899, `persistState()` is called BEFORE worktree creation is added. The sequence in the plan:

1. `buildDefaultState()` → creates state with `worktreePath: undefined`
2. `persistState()` → writes state to disk
3. **Then** worktree creation would happen (per the pattern)

If the process crashes after persist but before worktree creation completes, the state file shows `worktreePath: undefined` but a worktree may have been partially created.

**ISSUE 6: Worktree creation failure is silent**

The pattern (lines 92-96) shows:

```typescript
if (worktreeResult.success && worktreeResult.path) {
  console.log(`[ralplan] Worktree created: ${worktreeResult.path}`);
} else {
  console.warn(`[ralplan] Worktree creation failed: ${worktreeResult.error}`);
}
state.worktreePath = worktreeResult.success ? worktreeResult.path : undefined;
```

If worktree creation fails, the user only sees a console.warn. There's no UI notification to alert the user that the worktree wasn't created. They may proceed with planning without realizing their work is not isolated.

---

### T-1.3 (plan.md cleanup)

**ISSUE 7: Incomplete scope of documentation cleanup**

The plan focuses on `plans/plan.md` but the grep results show:

- `plans/tech-spec.md` — lines 54, 108, 109, 119, 121, 269-278, 284, 305
- `plans/spec.md` — lines 70, 93, 120, 172
- `plans/drafts/architect_review.md` — lines 14, 106, 115, 117
- `plans/drafts/critic_review.md` — line 185

The plan only addresses `plans/plan.md`. The scope should explicitly include `plans/tech-spec.md` and `plans/spec.md` which have substantial `adr` references.

**ISSUE 8: docs/decisions/0003-remove-adr-from-state.md**

This ADR file references `adr.ts` and the decision to remove `adr` from state. This file is self-referential and doesn't need changes, but the plan doesn't acknowledge its existence.

---

### T-1.4 (Happy-path Test)

**ISSUE 9: Test cleanup not addressed**

The plan shows two test approaches but NEITHER addresses cleanup. The alternative approach (lines 151-180) creates a real git repo in `/tmp` but uses `rmSync(dir, { recursive: true, force: true })` in a `finally` block — this is correct for cleanup.

**However**, if the test runs with mocks (first approach), it doesn't clean up anything because no actual filesystem worktree is created. If the test uses the real filesystem approach, the cleanup is handled. The plan doesn't clarify which approach to use.

**ISSUE 10: Test doesn't verify the worktree content**

The proposed test only checks:

```typescript
expect(result.success).toBe(true);
expect(result.path).toBeDefined();
```

It doesn't verify:

- The worktree is actually a git repository (has `.git` directory)
- The branch name matches expected pattern (`feature/${name}`)
- The base branch is correct

---

## 2. Assumptions That Might Be Wrong

| Assumption                                          | Why It Might Be Wrong                                                                                                                                    |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Windows path separator is `\`"                     | The plan normalizes `\` to `/` — but on Unix systems, `\` in a worktree name is a valid character. The normalization could change behavior unexpectedly. |
| "Worktree creation is fast"                         | On large repos or slow filesystems, `git worktree add` can take several seconds. No timeout is specified.                                                |
| "User notices console.warn"                         | Users may not see console output. No UI feedback is planned for failure.                                                                                 |
| "plan.md is the only documentation needing updates" | `tech-spec.md` and `spec.md` both have substantial `adr` references that would create confusion if not updated.                                          |
| "Tests run in isolation"                            | If tests share a temp directory, parallel test runs could conflict.                                                                                      |

---

## 3. Risks That Could Go Wrong

| Risk                                                                | Likelihood | Impact | Mitigation in Plan?                              |
| ------------------------------------------------------------------- | ---------- | ------ | ------------------------------------------------ |
| Worktree creation hangs indefinitely                                | Low        | High   | **NO** — no timeout specified                    |
| State persisted before worktree ready → inconsistent state on crash | Medium     | Medium | **NO** — order of operations not specified       |
| Normalization breaks Unix paths containing `\`                      | Low        | Medium | **NO** — D1 in ADR addresses this but not tested |
| `tech-spec.md` and `spec.md` remain inconsistent after plan changes | High       | Low    | **NO** — scope limited to `plan.md` only         |
| Test cleanup leaves temp directories on failure                     | Medium     | Low    | **NO** — cleanup responsibility not clarified    |
| Users don't realize worktree failed and proceed anyway              | Medium     | Medium | **NO** — only console.warn, no UI notification   |

---

## 4. Weaknesses in the Plan

### Weakness 1: Inconsistent state between plan and codebase

The T-1.1 "Current code" section (lines 39-47) shows what exists in the codebase, but the "Fix" section (lines 54-68) shows code that doesn't match the current implementation. This is confusing — is the plan showing the diff correctly?

### Weakness 2: Missing implementation order for T-1.2

The plan says (line 100): "After line 898 where `state = buildDefaultState(...)` is called, add: [worktree creation]"

But it doesn't specify:

1. Whether to await worktree creation or fire-and-forget
2. What happens to `state.worktreePath` if worktree creation fails
3. The exact location to insert the code relative to `persistState()` call

### Weakness 3: No verification test for T-1.1 Windows-specific behavior

The acceptance criteria (line 189):

```
sanitizeWorktreeName("foo\\..\\..\\etc") throws
sanitizeWorktreeName("C:\\") throws
sanitizeWorktreeName("/absolute") throws
```

These are unit test criteria but the plan only assigns T-1.4 (happy-path test) to `worktree.test.ts`. There's no task to add Windows-specific traversal tests. The `worktree-security.test.ts` file exists (line 60 in tech-spec) but is not mentioned in the plan.

### Weakness 4: Missing test for normalization side effects

The plan changes `sanitizeWorktreeName` to normalize `\` to `/`. There's no test that verifies:

- A Unix path with `\` doesn't break
- The normalized path still works correctly with `resolve()`

---

## 5. Required Modifications

### REQUIRED CHANGE 1: Add timeout handling for T-1.2

Add explicit timeout handling to prevent indefinite blocking during worktree creation:

```typescript
// Example: wrap in Promise.race with timeout
const worktreePromise = createWorktree(config, worktreeName);
const timeoutPromise = new Promise<WorktreeResult>((_, reject) =>
  setTimeout(() => reject(new Error("Worktree creation timeout")), 30000),
);
const worktreeResult = await Promise.race([worktreePromise, timeoutPromise]);
```

### REQUIRED CHANGE 2: Fix order of operations for T-1.2

Clarify that worktree creation must complete BEFORE `persistState()`:

1. Create worktree
2. Update `state.worktreePath`
3. **Then** call `persistState()`

Or document why this order doesn't matter.

### REQUIRED CHANGE 3: Add UI notification for worktree failure

Change from `console.warn` to also call `ctx.ui.notify()` with error level so users see the failure in their UI.

### REQUIRED CHANGE 4: Expand T-1.3 scope

Update T-1.3 to explicitly include:

- `plans/plan.md` — remove `adr` references
- `plans/tech-spec.md` — remove `adr` references
- `plans/spec.md` — remove `adr` references

### REQUIRED CHANGE 5: Add Windows-specific traversal tests

Either add a task for `worktree-security.test.ts` to include Windows-specific cases, or clarify that T-1.4 includes these test cases.

### REQUIRED CHANGE 6: Clarify T-1.4 test approach

Specify whether to use mocked or real filesystem approach. If using real filesystem, document the cleanup strategy clearly. If using mocks, add verification that the mock was called correctly.

---

## 6. Missing from the Plan

1. **No mention of `worktree-security.test.ts`** — exists per tech-spec, not referenced in plan
2. **No timeout specification** for worktree creation
3. **No async handling clarification** — is `before_agent_start` handler async-capable?
4. **No rollback plan** — what if worktree is created but state persist fails?
5. **No rollback plan** — what if state is persisted but worktree creation fails?

---

## VERDICT

**REVISION NEEDED**

The plan has the right direction but incomplete implementation details and missing scope. Critical issues:

1. **T-1.2**: No timeout, incorrect order of operations (persist before worktree creation), no UI notification on failure
2. **T-1.3**: Scope too narrow — `tech-spec.md` and `spec.md` also need updates
3. **T-1.4**: No specification of which test approach to use, no cleanup clarity, insufficient assertions
4. **T-1.1**: Current code vs proposed fix are inconsistent; missing Windows-specific test task

The plan should be revised to address these gaps before Architect review.
