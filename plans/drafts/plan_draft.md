# Implementation Plan Draft v1

**Based on:** `plans/spec.md`  
**Created:** 2026-05-05  
**Role:** Planner

---

## 1. Task Breakdown

### Phase 1: Core Infrastructure

| Task | File(s) | Description |
|------|---------|-------------|
| T-1.1 | `pi/extensions/ralplan/naming.ts` | Date formatting and filename generation |
| T-1.2 | `pi/extensions/ralplan/worktree.ts` | Git worktree creation and management |
| T-1.3 | `pi/extensions/ralplan/adr.ts` | ADR data structure and utilities |

### Phase 2: State Extension

| Task | File(s) | Description |
|------|---------|-------------|
| T-2.1 | `pi/extensions/ralplan/state.ts` | Add `worktreePath` and `adr` to `RalplanState` |
| T-2.2 | `pi/extensions/ralplan/utils.ts` | Add worktree path resolution utilities |

### Phase 3: Adapter Integration

| Task | File(s) | Description |
|------|---------|-------------|
| T-3.1 | `pi/extensions/ralplan/adapters.ts` | Integrate worktree creation at planning start |
| T-3.2 | `pi/extensions/ralplan/adapters.ts` | Add date-based filename to prompts |
| T-3.3 | `pi/extensions/ralplan/adapters.ts` | Embed ADR template in plan prompts |

### Phase 4: Artifacts & Config

| Task | File(s) | Description |
|------|---------|-------------|
| T-4.1 | `pi/extensions/ralplan/artifacts.ts` | Update filename generation for date-based naming |
| T-4.2 | `pi/extensions/ralplan/index.ts` | Register new tools (`ralplan_create_worktree`) |
| T-4.3 | Create `ralplan.config.ts` | Configuration file for worktree settings |

### Phase 5: Testing

| Task | File(s) | Description |
|------|---------|-------------|
| T-5.1 | `tests/naming.test.ts` | Unit tests for date formatting and filename generation |
| T-5.2 | `tests/worktree.test.ts` | Unit tests for worktree operations |
| T-5.3 | `tests/adr.test.ts` | Unit tests for ADR utilities |
| T-5.4 | `tests/integration.test.ts` | Integration tests for full pipeline |

---

## 2. Dependency Graph

```
T-1.1 (naming.ts)
    ↓
T-1.2 (worktree.ts)
    ↓
T-1.3 (adr.ts)
    ↓
T-2.1 (state.ts) ← T-2.2 (utils.ts)
    ↓
T-3.1 → T-3.2 → T-3.3 (adapters.ts)
    ↓
T-4.1 → T-4.2 → T-4.3
    ↓
T-5.1 → T-5.2 → T-5.3 → T-5.4
```

---

## 3. Exact File Implementations

### T-1.1: `naming.ts`

```typescript
/** Format date as YYYY-MM-DD */
export function formatDate(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Sanitize description for URL-safe filename */
export function sanitizeDescription(desc: string): string {
  return desc
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
}

/** Generate plan filename with date */
export function generatePlanFilename(description: string, date: Date = new Date()): string {
  const dateStr = formatDate(date);
  const slug = sanitizeDescription(description);
  return `plan-${dateStr}-${slug}.md`;
}

/** Generate spec filename with date */
export function generateSpecFilename(description: string, date: Date = new Date()): string {
  const dateStr = formatDate(date);
  const slug = sanitizeDescription(description);
  return `spec-${dateStr}-${slug}.md`;
}
```

### T-1.2: `worktree.ts`

```typescript
import { execSync } from "child_process";
import { join } from "path";
import { existsSync, mkdirSync } from "fs";

export interface WorktreeConfig {
  baseBranch: string;
  worktreeRoot: string;
}

export interface WorktreeResult {
  success: boolean;
  path?: string;
  error?: string;
}

export function createWorktree(config: WorktreeConfig, name: string): WorktreeResult {
  try {
    // Ensure worktree root exists
    mkdirSync(config.worktreeRoot, { recursive: true });
    
    const worktreePath = join(config.worktreeRoot, name);
    
    // Check if worktree already exists
    if (existsSync(worktreePath)) {
      return { success: true, path: worktreePath };
    }
    
    // Create worktree
    execSync(`git worktree add -b feature/${name} ${worktreePath} ${config.baseBranch}`, {
      stdio: "pipe",
    });
    
    return { success: true, path: worktreePath };
  } catch (error) {
    return { 
      success: false, 
      error: error instanceof Error ? error.message : "Unknown error" 
    };
  }
}

export function listWorktrees(): string[] {
  try {
    const output = execSync("git worktree list --porcelain", { encoding: "utf-8" });
    return output.split("\n\n").map((entry) => {
      const pathMatch = entry.match(/^worktree\s+(.+)$/m);
      return pathMatch ? pathMatch[1] : "";
    }).filter(Boolean);
  } catch {
    return [];
  }
}
```

### T-1.3: `adr.ts`

```typescript
import { randomUUID } from "crypto";

export type ADREntryType = "open-question" | "decision" | "approval" | "rejection";
export type ADRStatus = "pending" | "approved" | "rejected";

export interface ADREntry {
  id: string;
  type: ADREntryType;
  title: string;
  description: string;
  status: ADRStatus;
  author?: string;
  timestamp: string;
  reason?: string;  // For rejections
}

export interface ADR {
  entries: ADREntry[];
  addEntry(entry: Omit<ADREntry, "id" | "timestamp">): ADREntry;
  approve(id: string, author: string): void;
  reject(id: string, author: string, reason: string): void;
  toMarkdown(): string;
}

let _counter = 0;
function generateId(): string {
  return `ADR-${++_counter}-${Date.now()}`;
}

export function createADR(): ADR {
  const entries: ADREntry[] = [];
  
  return {
    entries,
    addEntry(entry) {
      const newEntry: ADREntry = {
        ...entry,
        id: generateId(),
        timestamp: new Date().toISOString(),
        status: entry.status ?? "pending",
      };
      entries.push(newEntry);
      return newEntry;
    },
    approve(id, author) {
      const entry = entries.find((e) => e.id === id);
      if (entry) {
        entry.status = "approved";
        entry.author = author;
        entry.timestamp = new Date().toISOString();
      }
    },
    reject(id, author, reason) {
      const entry = entries.find((e) => e.id === id);
      if (entry) {
        entry.status = "rejected";
        entry.author = author;
        entry.reason = reason;
        entry.timestamp = new Date().toISOString();
      }
    },
    toMarkdown() {
      const lines = ["## Architecture Decision Record\n"];
      
      const questions = entries.filter((e) => e.type === "open-question");
      const decisions = entries.filter((e) => e.type === "decision");
      const approvals = entries.filter((e) => e.type === "approval");
      const rejections = entries.filter((e) => e.type === "rejection");
      
      if (questions.length > 0) {
        lines.push("### Open Questions\n");
        for (const q of questions) {
          lines.push(`- [${q.status === "pending" ? " " : "x"}] **${q.title}** — ${q.description}`);
        }
        lines.push("");
      }
      
      if (decisions.length > 0) {
        lines.push("### Decisions\n");
        for (const d of decisions) {
          lines.push(`- **${d.title}** — ${d.description} (${d.status})`);
        }
        lines.push("");
      }
      
      if (approvals.length > 0) {
        lines.push("### Approvals\n");
        for (const a of approvals) {
          lines.push(`- ✓ **${a.title}** by ${a.author} at ${a.timestamp}`);
        }
        lines.push("");
      }
      
      if (rejections.length > 0) {
        lines.push("### Rejections\n");
        for (const r of rejections) {
          lines.push(`- ✗ **${r.title}** by ${r.author}: ${r.reason}`);
        }
        lines.push("");
      }
      
      return lines.join("\n");
    },
  };
}
```

---

## 4. Acceptance Criteria per Task

| Task | Criteria |
|------|----------|
| T-1.1 | `formatDate()` returns correct format; `generatePlanFilename()` produces `plan-YYYY-MM-DD-slug.md` |
| T-1.2 | `createWorktree()` creates worktree and returns path; handles existing worktrees gracefully |
| T-1.3 | ADR can add entries, approve/reject, and render to markdown |
| T-2.1 | State includes `worktreePath` and `adr` fields; persisted correctly |
| T-3.1 | Planning stage creates worktree before showing prompts |
| T-3.2 | Prompts use date-based filenames |
| T-3.3 | Plan template includes ADR section |
| T-4.1 | Artifacts use correct filenames |
| T-4.2 | Tool `ralplan_create_worktree` registered and functional |
| T-5.1-5.4 | All tests pass |

---

## 5. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Git not available | Low | High | Graceful error with clear message |
| Worktree creation fails | Medium | Medium | Fallback to main repo with warning |
| Filename collision on same day | Low | Low | Append increment `-1`, `-2` |
| Config file missing | High | Low | Use defaults, no hard failure |
| ADR state not persisted | Medium | High | Include in `persistState()` |

---

## 6. ADR (Architecture Decision Record)

### Open Questions

- [ ] **Q1: When to create worktree?** — At planning start vs. execution start
  - Decision: Create at planning start per user intent "start the new plans in the new worktree"

- [ ] **Q2: What if worktree creation fails?**
  - Decision: Hard fail with clear error; do not proceed with planning

### Decisions

- [ ] **D1: Worktree root location** — `./worktrees/` within main repo
  - Rationale: Keeps everything in one repo, easy cleanup

- [ ] **D2: Base branch** — Configurable, default "main"
  - Rationale: Industry default, allows override for legacy repos

- [ ] **D3: ADR embedded in plan** — Not separate files
  - Rationale: Keeps related content together, simpler tracking

### Approvals

_(To be filled during consensus with Architect and Critic)_

### Rejections

_(To be filled during consensus with Architect and Critic)_