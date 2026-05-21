# Implementation Plan v1.2 (Final)

**Based on:** `plans/spec.md`  
**Incorporates:** Architect review (APPROVED) + Critic review notes  
**Created:** 2026-05-21  
**Role:** Planner (Final)  
**Status:** ✅ APPROVED

---

## 1. Task Breakdown

| Task  | File(s)                              | Description                                           |
| ----- | ------------------------------------ | ----------------------------------------------------- |
| T-1.1 | `worktree.ts`                        | Fix Windows path traversal in `sanitizeWorktreeName`  |
| T-1.2 | `index.ts`                           | Add worktree creation to `before_agent_start` handler |
| T-1.3 | `plan.md`, `spec.md`, `tech-spec.md` | Remove outdated `adr` references                      |
| T-1.4 | `worktree.test.ts`                   | Add happy-path test for `createWorktree`              |

---

## 2. Dependency Graph

```
T-1.1 (worktree.ts fix)    ← Independent
T-1.3 (docs cleanup)       ← Independent
T-1.2 (index.ts update)    ← Depends on T-1.1 (uses sanitizeWorktreeName)
T-1.4 (test addition)      ← Depends on T-1.1 (tests the fix)
```

All tasks are independent and can be implemented in parallel once the plan is approved.

---

## 3. Implementation Details

### T-1.1: Fix Windows Path Traversal

**File:** `pi/extensions/ralplan/worktree.ts`

**Current code (line 57-63):**

```typescript
function sanitizeWorktreeName(name: string): string {
  // Block directory traversal and null bytes
  if (name.includes("..") || name.includes("\0")) {
    throw new Error("Invalid worktree name: directory traversal detected");
  }
  return name.replace(/[^a-zA-Z0-9-_]/g, "-").slice(0, 50);
}
```

**Fix — replace with:**

```typescript
function sanitizeWorktreeName(name: string): string {
  // Block directory traversal, null bytes, and Windows-specific patterns
  // Normalize backslashes to forward slashes for cross-platform check
  const normalized = name.replace(/\\/g, "/").replace(/\0/g, "");
  if (normalized.includes("..") || name.includes("\0")) {
    throw new Error("Invalid worktree name: directory traversal detected");
  }
  // Block absolute paths and drive letters
  if (normalized.startsWith("/") || /^[a-zA-Z]:/.test(normalized)) {
    throw new Error("Invalid worktree name: absolute paths not allowed");
  }
  return normalized.replace(/[^a-zA-Z0-9_./-]/g, "-").slice(0, 50);
}
```

---

### T-1.2: Add Worktree Creation to Auto-Start Handler

**File:** `pi/extensions/ralplan/index.ts`

**Location:** In `before_agent_start` handler, BEFORE line `state = buildDefaultState(...)`

**Insert this code:**

```typescript
// Create worktree for this session (same pattern as /ralplan command)
const worktreeName =
  idea
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "plan";
const worktreeRoot = resolveWorktreeRoot(sessionCwd);
const worktreeConfig: WorktreeConfig = {
  baseBranch: detectDefaultBranch(sessionCwd),
  worktreeRoot,
  createBranch: true,
};

let worktreePath: string | undefined;
try {
  const worktreeResult = createWorktree(worktreeConfig, worktreeName);
  if (worktreeResult.success && worktreeResult.path) {
    worktreePath = worktreeResult.path;
    console.log(`[ralplan] Worktree created: ${worktreePath}`);
  } else {
    console.warn(`[ralplan] Worktree creation failed: ${worktreeResult.error}`);
    ctx.ui.notify(
      `Worktree creation failed: ${worktreeResult.error}`,
      "warning",
    );
  }
} catch (error) {
  console.warn(`[ralplan] Worktree creation error: ${error}`);
}

// Build state
state = buildDefaultState(idea, tracking, undefined, mode, sessionCwd);
state.worktreePath = worktreePath;
```

---

### T-1.3: Remove `adr` References from Documentation

**Files to update:**

1. `plans/plan.md` — Remove references to `adr` in state context
2. `plans/spec.md` — Remove references to `adr` in state context
3. `plans/tech-spec.md` — Remove references to `adr` in state context

**In each file, remove or replace references to:**

- `adr?: ADR` in state interface descriptions
- Tasks that mention "add adr to RalplanState"
- ADR section entries about "ADR state persisted"

**Note:** The actual code in `state.ts` and `index.ts` is already correct (no `adr` field) per ADR-0003. This task only updates documentation to match.

---

### T-1.4: Add Happy-Path Test for createWorktree

**File:** `tests/worktree.test.ts`

**Add this test:**

```typescript
it("should return success and valid path for successful worktree creation", () => {
  const dir = mkdtempSync(join(tmpdir(), "ralplan-happy-"));
  const repo = join(dir, "repo");
  mkdirSync(repo, { recursive: true });
  const prev = cwd();

  try {
    chdir(repo);
    execSync("git init -b main", { stdio: "pipe" });
    execSync("git config user.email test@example.com", { stdio: "pipe" });
    execSync("git config user.name test", { stdio: "pipe" });
    writeFileSync("README.md", "x\n", "utf-8");
    execSync("git add README.md && git commit -m init", { stdio: "pipe" });

    const worktreesDir = join(dir, "worktrees");
    const result = createWorktree(
      { baseBranch: "main", worktreeRoot: worktreesDir, createBranch: true },
      "happy-test",
    );

    expect(result.success).toBe(true);
    expect(result.path).toBeDefined();
    expect(result.error).toBeUndefined();
    // Verify worktree is valid (contains .git)
    expect(existsSync(join(result.path!, ".git"))).toBe(true);
    // Verify correct branch was created
    const branches = execSync("git branch", {
      cwd: result.path,
      encoding: "utf-8",
    });
    expect(branches).toContain("feature/happy-test");
  } finally {
    chdir(prev);
    rmSync(dir, { recursive: true, force: true });
  }
});
```

---

## 4. Acceptance Criteria

| Task  | Criteria                                                                                                                                                                              |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T-1.1 | `sanitizeWorktreeName("foo\\..\\..\\etc")` throws; `sanitizeWorktreeName("C:\\")` throws; `sanitizeWorktreeName("/absolute")` throws; `sanitizeWorktreeName("//server/share")` throws |
| T-1.2 | Using `--ralplan` flag creates worktree and stores path in state; failure triggers UI warning                                                                                         |
| T-1.3 | `plans/plan.md`, `plans/spec.md`, `plans/tech-spec.md` have no references to `adr` in state context                                                                                   |
| T-1.4 | `npm test` passes with new happy-path test                                                                                                                                            |

---

## 5. Risk Register

| Risk                                   | Likelihood | Impact | Mitigation                                |
| -------------------------------------- | ---------- | ------ | ----------------------------------------- |
| Regex change breaks existing tests     | Low        | Medium | Run tests after change                    |
| Worktree creation timeout              | Low        | Low    | createWorktree has 3-retry internal logic |
| Documentation update missed references | Medium     | Low    | Use grep to verify all references removed |
| Test CWD pollution                     | Low        | Low    | Use try/finally to restore CWD            |

---

## 6. Architecture Decision Record (ADR)

### Decisions

- [x] **D1: Normalize backslashes before check** — Normalize `\` to `/` in `sanitizeWorktreeName` to catch Windows traversal on all platforms
  - Rationale: Cross-platform consistency, simpler validation
  - Consequence: Unix paths with `\` are also normalized (acceptable)

- [x] **D2: Auto-start worktree uses same config as commands** — Reuse existing `createWorktree()` with `createBranch: true`
  - Rationale: Consistency across all entry points
  - Consequence: All worktrees create feature branches

- [x] **D3: UI notification on worktree failure** — Add `ctx.ui.notify()` when worktree creation fails
  - Rationale: User should know when worktree creation fails
  - Consequence: Minor code addition, no behavioral change

### Approvals

- ✅ **A1:** Architect approved T-1.1, T-1.2, T-1.3, T-1.4 technical approach
- ✅ **A2:** Critic noted improvements but did not block (Architect verdict takes precedence)

---

## 7. Notes

- **T-1.1 and T-1.4 are related**: The happy-path test (T-1.4) validates the fix from T-1.1
- **T-1.3 is documentation only**: No code changes required for ADR-0003 cleanup
- **Parallel implementation**: T-1.1 and T-1.3 are independent and can be implemented simultaneously
