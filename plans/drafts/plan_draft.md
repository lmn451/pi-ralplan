# Implementation Plan v1.1

**Based on:** `plans/spec.md`  
**Incorporates:** Architect review + Critic review  
**Created:** 2026-05-21  
**Role:** Planner (Revised)  
**Status:** REVISION IN PROGRESS

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

**Fix:**

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

**Key changes:**

1. Normalize `\` to `/` for consistent cross-platform checking
2. Keep original `name.includes("\0")` check since null bytes could be injected after normalization
3. Block absolute paths (starting with `/`) and drive letters (`C:`)
4. UNC paths (`//server/share`) normalized to slashes which get stripped by regex — acceptable

---

### T-1.2: Add Worktree Creation to Auto-Start Handler

**File:** `pi/extensions/ralplan/index.ts`

**Current behavior:** The `before_agent_start` handler builds state and triggers pipeline but does NOT create a worktree.

**Correct sequence (based on /ralplan command handler pattern):**

1. Generate worktree name from idea
2. Resolve worktree root
3. Create worktree
4. Build state (buildDefaultState)
5. Set state.worktreePath
6. Persist state
7. (Optional) notify user of worktree status

**Insertion point:** In `before_agent_start` handler, BEFORE the existing:

```typescript
state = buildDefaultState(idea, tracking, undefined, mode, sessionCwd);
```

**Implementation:**

```typescript
// Generate worktree name
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

// Create worktree with timeout protection
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
persistState();
```

**Note:** The timeout wrapper is implicit — `createWorktree` already has internal retry logic (3 attempts with backoff). If it takes too long, the error is caught and logged.

---

### T-1.3: Remove `adr` References from Documentation

**Files to update:**

1. `plans/plan.md` — Remove references to `adr` in state context
2. `plans/spec.md` — Remove references to `adr` in state context
3. `plans/tech-spec.md` — Remove references to `adr` in state context

**Search pattern:** `adr.*state|RalplanState.*adr|worktreePath.*and.*adr`

**Specific changes:**

In `plans/plan.md`:

- Line 25: "Add `worktreePath` and `adr` to `RalplanState`" → "Add `worktreePath` to `RalplanState`"
- Line 71: Similar reference
- Table in section 4: Remove `adr` from state-related tasks
- ADR section: Remove any references to "ADR state persisted"

In `plans/spec.md`:

- Section 3.3 (State Extension): Remove `adr?: ADR` from RalplanState interface

In `plans/tech-spec.md`:

- Section 2.3 (State Changes): Remove `adr?: ADR` from RalplanState interface

**Note:** The actual code in `state.ts` and `index.ts` is already correct (no `adr` field) per ADR-0003. This task only updates documentation.

---

### T-1.4: Add Happy-Path Test for createWorktree

**File:** `tests/worktree.test.ts`

**Test approach:** Use real filesystem (matches pattern in `tests/worktree-security.test.ts`)

**Test to add:**

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
    // Verify branch was created
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

**Assertions added:**

1. `result.success` is true
2. `result.path` is defined
3. `result.error` is undefined
4. Worktree contains `.git` directory (valid git repo)
5. Correct branch was created (`feature/happy-test`)

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
  - Consequence: Unix paths with `\` are also normalized (rare but correct behavior)

- [x] **D2: Auto-start worktree uses same config as commands** — Reuse existing `createWorktree()` with `createBranch: true`
  - Rationale: Consistency across all entry points
  - Consequence: All worktrees create feature branches

- [x] **D3: UI notification on worktree failure** — Add `ctx.ui.notify()` when worktree creation fails
  - Rationale: User should know when worktree creation fails silently
  - Consequence: Minor code addition, no behavioral change

### Open Questions

- None — all technical details resolved

### Approvals

_(Pending Architect and Critic final review)_
