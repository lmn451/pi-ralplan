# Technical Specification: pi-ralplan Bug Fixes & Enhancements

**Version:** 1.0  
**Date:** 2026-05-21  
**Role:** Architect  
**Status:** Draft

---

## 1. Tech Stack

### 1.1 Core Dependencies

| Package                       | Version | Purpose          | Rationale                                  |
| ----------------------------- | ------- | ---------------- | ------------------------------------------ |
| TypeScript                    | ^5.7.0  | Language         | Static typing, required by pi-coding-agent |
| vitest                        | ^3.0.0  | Testing          | Native ESM support, fast iteration         |
| @sinclair/typebox             | \*      | Type definitions | Schema-based types matching pi-ai          |
| @mariozechner/pi-ai           | \*      | Extension API    | Core framework peer dependency             |
| @mariozechner/pi-coding-agent | \*      | Extension API    | Extension host API                         |

### 1.2 Runtime Environment

- **Node.js:** ESM modules (`"type": "module"` in package.json)
- **Platforms:** Linux, macOS, Windows (cross-platform git worktree support required)

### 1.3 Key Architecture Decisions

| Decision            | Choice                            | Rationale                                        |
| ------------------- | --------------------------------- | ------------------------------------------------ |
| Path separator      | Normalize `\` to `/`              | Windows compatibility, prevents traversal bypass |
| Worktree validation | Check `.git` directory existence  | Simple, reliable, git-native                     |
| Test approach       | Real filesystem with temp dirs    | Proper integration testing, no mock brittleness  |
| Auto-start pattern  | Handler-based (not command-based) | Consistent with `--ralplan` flag behavior        |

---

## 2. Architecture Overview

### 2.1 Module Structure

```
pi/extensions/ralplan/
├── index.ts          # Extension entry point, event handlers
├── state.ts          # RalplanState type and persistence
├── worktree.ts       # Git worktree operations (CRUD)
├── pipeline.ts       # Pipeline stage management
├── adapters.ts       # Stage adapters (planner/architect/critic/qa)
├── signals.ts        # Signal detection utilities
├── brainstorm.ts     # Brainstorm mode state machine
├── prompts.ts        # Prompt templates
├── artifacts.ts      # File artifact management
├── naming.ts         # Date formatting, filename generation
├── adr.ts            # ADR data structures (kept for tests)
├── gate.ts           # Request filtering
└── utils.ts          # Path resolution utilities

tests/
├── worktree.test.ts        # Unit tests with mocks
├── worktree-security.test.ts  # Real filesystem integration tests
├── state.test.ts
├── pipeline.test.ts
└── ...
```

### 2.2 Data Flow

```
User starts --ralplan flag
        ↓
before_agent_start handler (index.ts:871)
        ↓
Auto-start mode detected → buildDefaultState() + worktree creation
        ↓
Pipeline stages execute via adapters
        ↓
agent_end handler detects completion signal → advanceStage()
```

### 2.3 Security Layer

The `sanitizeWorktreeName()` function is the primary defense against path traversal:

```
Input Name
    ↓
Check 1: Contains ".." → REJECT
Check 2: Contains "\0" → REJECT
Check 3: Contains "\" → REJECT (NEW: Windows path separator)
Check 4: Normalize → Allow only [a-zA-Z0-9-_], max 50 chars
    ↓
Output: sanitized name safe for use in resolve()
```

---

## 3. File Structure

```
pi-ralplan/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── pi/
│   ├── extensions/ralplan/
│   │   ├── index.ts          # MODIFIED: Add worktree to before_agent_start
│   │   ├── worktree.ts       # MODIFIED: Fix sanitizeWorktreeName (Windows)
│   │   ├── state.ts          # VERIFIED: No adr field (matches ADR-0003)
│   │   ├── adr.ts            # UNCHANGED: Keep for potential test use
│   │   └── ...
│   └── skills/ralplan/
│       └── prompts/
├── tests/
│   ├── worktree.test.ts      # MODIFIED: Add happy-path test
│   ├── worktree-security.test.ts
│   └── ...
├── docs/
│   └── decisions/
│       └── 0003-remove-adr-from-state.md  # Reference
└── plans/
    └── plan.md               # MODIFIED: Remove adr references
```

---

## 4. Dependencies List

### 4.1 Production Dependencies

None — all dependencies are peer dependencies declared in `package.json`.

### 4.2 Dev Dependencies

| Package     | Version | Purpose                  |
| ----------- | ------- | ------------------------ |
| typescript  | ^5.7.0  | TypeScript compilation   |
| vitest      | ^3.0.0  | Test runner              |
| @types/node | ^22.0.0 | Node.js type definitions |

### 4.3 Peer Dependencies

| Package                       | Purpose          |
| ----------------------------- | ---------------- |
| @mariozechner/pi-ai           | Extension API    |
| @mariozechner/pi-coding-agent | Extension host   |
| @sinclair/typebox             | Type definitions |

---

## 5. API/Interface Definitions

### 5.1 `sanitizeWorktreeName()` Changes

**Current (buggy):**

```typescript
function sanitizeWorktreeName(name: string): string {
  if (name.includes("..") || name.includes("\0")) {
    throw new Error("Invalid worktree name: directory traversal detected");
  }
  return name.replace(/[^a-zA-Z0-9-_]/g, "-").slice(0, 50);
}
```

**Fixed:**

```typescript
function sanitizeWorktreeName(name: string): string {
  // Block directory traversal, null bytes, and Windows path separators
  if (name.includes("..") || name.includes("\0") || name.includes("\\")) {
    throw new Error("Invalid worktree name: directory traversal detected");
  }
  return name.replace(/[^a-zA-Z0-9-_]/g, "-").slice(0, 50);
}
```

### 5.2 `before_agent_start` Handler Addition

**Location:** `index.ts` lines 871-941

**Pattern to follow (from `/ralplan` command, lines 307-338):**

```typescript
// Create worktree and store path in state
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
const worktreeResult = createWorktree(worktreeConfig, worktreeName);
if (worktreeResult.success && worktreeResult.path) {
  console.log(`[ralplan] Worktree created: ${worktreeResult.path}`);
} else {
  console.warn(`[ralplan] Worktree creation failed: ${worktreeResult.error}`);
}

// ... state.worktreePath assignment follows
```

### 5.3 Happy-Path Test for `createWorktree`

```typescript
it("should create valid worktree with .git directory", () => {
  const dir = mkdtempSync(join(tmpdir(), "ralplan-happy-"));
  const repo = join(dir, "repo");
  const worktrees = join(dir, "worktrees");
  mkdirSync(repo, { recursive: true });
  const prev = cwd();

  try {
    chdir(repo);
    execSync("git init -b main", { stdio: "pipe" });
    execSync("git config user.email test@example.com", { stdio: "pipe" });
    execSync("git config user.name test", { stdio: "pipe" });
    writeFileSync("README.md", "x\n", "utf-8");
    execSync("git add README.md && git commit -m init", { stdio: "pipe" });

    const result = createWorktree(
      { baseBranch: "main", worktreeRoot: worktrees, createBranch: true },
      "happy-path-test",
    );

    expect(result.success).toBe(true);
    expect(result.path).toBeDefined();
    expect(existsSync(join(result.path!, ".git"))).toBe(true);
  } finally {
    chdir(prev);
    rmSync(dir, { recursive: true, force: true });
  }
});
```

---

## 6. Edge Cases to Handle

### 6.1 Windows Path Traversal

| Input              | Current Behavior               | Expected Behavior |
| ------------------ | ------------------------------ | ----------------- |
| `..\..\etc\passwd` | PASSES (backslash not blocked) | REJECT with error |
| `C:\Users\foo`     | PASSES (drive letter allowed)  | REJECT with error |
| `\\server\share`   | PASSES (UNC not blocked)       | REJECT with error |

### 6.2 Auto-Start Worktree Creation

| Scenario                             | Behavior                               |
| ------------------------------------ | -------------------------------------- |
| `--ralplan` flag set, no prior state | Create worktree via handler            |
| `--brainstorm` flag set              | Same pattern, mode = "brainstorm"      |
| Worktree creation fails              | Log warning, continue without worktree |
| Worktree already exists (valid)      | Return existing path                   |

### 6.3 Test Edge Cases

| Test Case                 | Purpose                          |
| ------------------------- | -------------------------------- |
| Valid name: `my-feature`  | Ensure happy path works          |
| Contains `.git` directory | Verify worktree is real git repo |
| Non-existent path         | Should create parent dirs        |

---

## 7. plan.md Updates (ADR-0003 Alignment)

### 7.1 Tasks to Remove `adr` References

| Location        | Change                                           |
| --------------- | ------------------------------------------------ |
| Line 19 (T-1.3) | Remove `adr.ts` task row                         |
| Line 25 (T-2.1) | Change to "Add `worktreePath` to `RalplanState`" |
| Line 50 (T-5.3) | Remove `adr.test.ts` task                        |
| Line 61         | Remove `T-1.3 (adr.ts)` dependency               |
| Line 64         | Change to "Uses naming" (remove adr)             |
| Line 368        | Remove "and `adr`" from criteria                 |

### 7.2 Verify ADR-0003 Implementation

The following files already match ADR-0003 (no changes needed):

- `state.ts` - `RalplanState` does NOT have `adr` field ✓
- `index.ts` - `PersistedState` does NOT have `adr` field ✓

---

## 8. Implementation Order

1. **Fix `sanitizeWorktreeName`** (worktree.ts) — Security fix, no dependencies
2. **Add worktree to `before_agent_start`** (index.ts) — Follows fix #1 pattern
3. **Add happy-path test** (worktree.test.ts) — Independent, can parallelize
4. **Update plan.md** — Documentation only, after code changes verified

---

## 9. Acceptance Criteria

| ID   | Criterion                                              | Test               |
| ---- | ------------------------------------------------------ | ------------------ |
| AC-1 | `sanitizeWorktreeName("..\\..\\passwd")` throws        | `worktree.test.ts` |
| AC-2 | `sanitizeWorktreeName("C:\\Users")` throws             | `worktree.test.ts` |
| AC-3 | `--ralplan` flag triggers worktree creation in handler | Manual test        |
| AC-4 | Happy-path creates worktree with `.git` dir            | `worktree.test.ts` |
| AC-5 | plan.md has no `adr` references                        | Code review        |
| AC-6 | Tests pass on all platforms                            | CI/CD              |
