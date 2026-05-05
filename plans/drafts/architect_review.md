# Architect Review — Plan Draft v1

**Reviewing:** `plans/drafts/plan_draft.md`  
**Role:** Architect  
**Date:** 2026-05-05  
**Verdict:** ⚠️ REVISION NEEDED

---

## 1. Technical Feasibility Assessment

### ✅ Strengths

- Clean modular separation: `naming.ts`, `worktree.ts`, `adr.ts`
- No new external dependencies (uses Node.js built-ins)
- State extension is minimal and non-breaking
- ADR interface is well-defined with clear entry types

### ⚠️ Concerns & Issues

#### Issue 1: Worktree Branch Naming (Critical)
**Problem:** The plan uses `feature/${name}` for branch name in worktree creation:
```typescript
execSync(`git worktree add -b feature/${name} ${worktreePath} ${config.baseBranch}`)
```
**Challenge:** 
- If `name` contains spaces or special characters, branch creation will fail
- The `-b` flag creates a NEW branch — what if user wants worktree on existing branch?
- Git worktree requires unique branch names per worktree

**Suggested Fix:**
```typescript
// Option A: No new branch (work on existing commit)
execSync(`git worktree add ${worktreePath}`, { cwd: config.baseBranch });

// Option B: Create branch with sanitized name
const sanitizedName = name.replace(/[^a-zA-Z0-9-_]/g, "-");
execSync(`git worktree add -b ${sanitizedName} ${worktreePath}`, { cwd: config.worktreeRoot });
```

#### Issue 2: ADR ID Generation (Medium)
**Problem:** Using a module-level counter with `Date.now()`:
```typescript
let _counter = 0;
function generateId(): string {
  return `ADR-${++_counter}-${Date.now()}`;
}
```
**Challenge:**
- Counter resets on module reload
- `Date.now()` collision possible if called rapidly
- Not portable across sessions

**Suggested Fix:** Use `crypto.randomUUID()`:
```typescript
import { randomUUID } from "node:crypto";
function generateId(): string {
  return `ADR-${randomUUID().slice(0, 8)}`;
}
```

#### Issue 3: Date Format Not Configurable (Low)
**Problem:** Hardcoded `YYYY-MM-DD` format:
```typescript
function formatDate(date: Date = new Date()): string {
  const y = date.getFullYear();
  // ...
}
```
**Challenge:** Users may want different formats (e.g., `DD-MM-YYYY`)

**Suggested Fix:** Add optional format parameter with default to ISO:
```typescript
export function formatDate(date: Date = new Date(), format: string = "YYYY-MM-DD"): string {
  // Simple template replacement
}
```

#### Issue 4: Worktree Path Resolution (Medium)
**Problem:** Using `join()` assumes relative paths work:
```typescript
const worktreePath = join(config.worktreeRoot, name);
```
**Challenge:**
- Relative paths may not resolve correctly from different CWDs
- No absolute path normalization

**Suggested Fix:**
```typescript
import { resolve } from "node:path";
const worktreePath = resolve(process.cwd(), config.worktreeRoot, name);
```

---

## 2. Design Quality Review

### Dependency Graph Issues

The current dependency graph:
```
T-1.1 (naming.ts)
    ↓
T-1.2 (worktree.ts)
    ↓
T-1.3 (adr.ts)
```

**Problem:** These modules are independent but ordered incorrectly. `naming.ts` should not depend on `worktree.ts` (no arrow needed).

**Suggested Refinement:**
```
T-1.1 (naming.ts)  ← No dependencies
T-1.2 (worktree.ts) ← No dependencies  
T-1.3 (adr.ts) ← No dependencies
    ↓
T-2.1 (state.ts) ← Uses naming, adr
```

### Interface Consistency

ADR's `addEntry` signature is inconsistent:
```typescript
addEntry(entry: Omit<ADREntry, "id" | "timestamp">): ADREntry
```

**Issue:** Type doesn't include `status` in Omit, but `status` is optional in interface. This means entries can be added without status, defaulting to "pending", which is good — but the type should reflect this explicitly.

---

## 3. Steelman Antithesis

### "Why not use git hooks?"

**Argument:** Instead of manually creating worktrees, use a git pre-commit hook to validate that commits come from worktrees.

**Counter:** This shifts validation to commit time rather than planning time. The user's intent is to ISOLATE the work, not just validate it.

### "Why not use Nix/NixOS for isolation?"

**Argument:** Docker/Nix provides stronger isolation than git worktrees.

**Counter:** Overkill for a planning tool. Git worktrees are native, lightweight, and require no additional setup.

### "Why not store ADR as separate YAML files?"

**Argument:** YAML is easier to parse and version-control differences.

**Counter:** Markdown is more human-readable in plain text, integrates with existing plan files, and doesn't require parsing for display.

---

## 4. Required Revisions

| Priority | Issue | Required Change |
|----------|-------|-----------------|
| Critical | Branch naming | Sanitize `name` or remove `-b` flag |
| Medium | ID generation | Use `randomUUID()` |
| Medium | Path resolution | Use `resolve()` for absolute paths |
| Low | Date format | Add format parameter |

---

## 5. Architect Verdict

**Status:** ⚠️ REVISION NEEDED

The plan is fundamentally sound, but requires fixes to:
1. Git command safety (sanitized branch names)
2. Robust ID generation
3. Proper path resolution

**Recommendation:** Proceed to revision after addressing Critical and Medium issues.

---

## 6. Open Questions for Planner

- **Q-A1:** Should worktrees be created with NEW branches (`-b` flag) or on detached HEAD/commit?
- **Q-A2:** Should we support custom branch naming patterns beyond `feature/{name}`?
- **Q-A3:** Should worktree creation fail the pipeline, or allow fallback to main repo?