# Critic Review — Plan Draft v1 (Architect-Revised)

**Reviewing:** `plans/drafts/plan_draft.md` + `plans/drafts/architect_review.md`  
**Role:** Critic  
**Date:** 2026-05-05  
**Verdict:** ✅ APPROVED with minor suggestions

---

## 1. Edge Case & Gap Analysis

### ✅ Well-Handled Cases

- **Existing worktrees:** Returns success with existing path — correct
- **Git unavailable:** `execSync` will throw, caught and returned as error — correct
- **Filename sanitization:** `sanitizeDescription()` handles special chars — correct
- **ADR state persistence:** Included in state extension — correct

### ⚠️ Edge Cases Missing

#### Gap 1: Worktree Cleanup on Cancellation
**Issue:** If user runs `/ralplan:cancel` mid-plan, worktree is orphaned.

```typescript
// Current state.ts
pi.registerCommand("ralplan:cancel", {
  handler: async (_args, ctx) => {
    // ... no worktree cleanup
    deactivateState();
  }
});
```

**Suggestion:** Add optional cleanup in `deactivateState()`:
```typescript
function deactivateState(): void {
  if (state?.worktreePath && state.pipeline.autoCleanup) {
    cleanupWorktree(state.worktreePath);
  }
  // ... rest of cleanup
}
```

#### Gap 2: Concurrent Plan Sessions
**Issue:** Multiple `/ralplan` sessions could create conflicting worktrees.

**Suggestion:** Add worktree lock or check for existing active session's worktree:
```typescript
if (state.active && state.worktreePath) {
  // Notify user existing session is active
}
```

#### Gap 3: Worktree Path in State but not in PersistedState
**Issue:** Looking at `buildDefaultState()`:
```typescript
const state: RalplanState = {
  // ... no worktreePath initialized
};
```

**Suggestion:** Initialize `worktreePath` at plan start:
```typescript
state = {
  // ...
  worktreePath: undefined, // Set after creation
};
```

#### Gap 4: ADR Rendering in Plan Template
**Issue:** The plan draft shows ADR `toMarkdown()` but doesn't specify where in the plan file this is embedded.

**Suggestion:** Add to acceptance criteria:
- Plan template MUST include `## Architecture Decision Record` section
- ADR markdown appended at end of plan file

---

## 2. Security Concerns

### ✅ Secure Practices

- Using `execSync` with `stdio: "pipe"` — prevents command injection via output
- Sanitizing description before use in shell commands — good
- No user-provided shell commands executed directly

### ⚠️ Minor Security Notes

- Git command arguments should also be sanitized (not just filename)
- Consider validating `name` against directory traversal patterns (`../`)

```typescript
// Add security check
if (name.includes("..") || name.includes("/")) {
  return { success: false, error: "Invalid worktree name" };
}
```

---

## 3. Operational Concerns

### ✅ Well Documented

- Risk register is comprehensive
- Edge case handling table is clear
- Test coverage plan includes all modules

### ⚠️ Operations Missing

#### Ops Gap 1: Monitoring & Debugging
**Issue:** No logging or tracing for worktree operations.

**Suggestion:** Add optional debug logging:
```typescript
import { debug } from "debug";
const log = debug("ralplan:worktree");

export function createWorktree(...) {
  log("Creating worktree: %s", name);
  // ... operations
  log("Worktree created: %s", worktreePath);
}
```

#### Ops Gap 2: No Health Check
**Issue:** No way to check worktree status before plan operations.

**Suggestion:** Add `ralplan:worktree-status` command:
```typescript
pi.registerCommand("ralplan:worktree-status", {
  handler: async (_args, ctx) => {
    const worktrees = listWorktrees();
    ctx.ui.notify(`Active worktrees: ${worktrees.join(", ")}`);
  }
});
```

---

## 4. Weaknesses in Current Approach

### Weakness 1: No Retry Logic
**Issue:** If `git worktree add` fails transiently (network, temporary lock), the pipeline fails hard.

**Suggestion:** Add simple retry:
```typescript
const maxRetries = 3;
for (let i = 0; i < maxRetries; i++) {
  try {
    // git command
    return { success: true, path };
  } catch {
    if (i === maxRetries - 1) return { success: false, error };
    await new Promise(r => setTimeout(r, 100 * (i + 1)));
  }
}
```

### Weakness 2: No Worktree Validation
**Issue:** Worktree might be created but in broken state.

**Suggestion:** Add post-creation validation:
```typescript
export function validateWorktree(path: string): boolean {
  try {
    const gitDir = join(path, ".git");
    return existsSync(gitDir);
  } catch {
    return false;
  }
}
```

---

## 5. Risk Re-Assessment

| Risk | Original Assessment | Critic Assessment |
|------|---------------------|------------------|
| Git not available | Low likelihood | **Low** — correct |
| Worktree creation fails | Medium impact | **Medium** — correct, but no retry |
| Filename collision | Low impact | **Low** — correct |
| Config file missing | High likelihood | **High** — correct |
| ADR state not persisted | Medium impact | **High** — correct (state includes adr now) |

**New Risks Identified:**
| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Worktree orphaned on cancel | Medium | Medium | Add cleanup on cancel |
| Concurrent sessions conflict | Low | Medium | Add session lock check |
| Transient git failures | Low | Medium | Add retry logic |

---

## 6. Critic Verdict

**Status:** ✅ APPROVED

The plan is well-structured and addresses the core requirements. Minor operational gaps identified but do not prevent implementation.

### Required Minor Changes:
1. Add worktree cleanup option on cancel
2. Add retry logic for git operations
3. Add security validation for worktree name

### Optional Improvements:
1. Debug logging
2. Worktree status command
3. Health check validation

---

## 7. Consensus Confirmation

I, as Critic, confirm:
- ✅ Technical feasibility is confirmed by Architect (with revisions)
- ✅ Edge cases are adequately addressed
- ✅ Security concerns are minor and addressable
- ✅ Operational concerns are acceptable for MVP

**Recommend proceeding to implementation with minor changes noted above.**