# Implementation Plan v1.1 (Final)

**Based on:** `plans/spec.md`  
**Incorporates:** Architect review feedback + Critic review feedback  
**Created:** 2026-05-05  
**Role:** Planner (Revised)  
**Status:** ✅ APPROVED

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
| T-5.4 | `tests/pipeline.test.ts` | Update existing pipeline tests for worktree integration |

---

## 2. Dependency Graph

```
Phase 1: Core Infrastructure (Independent)
├── T-1.1 (naming.ts)      ← No dependencies
├── T-1.2 (worktree.ts)    ← No dependencies
└── T-1.3 (adr.ts)         ← No dependencies

Phase 2: State Extension (Depends on Phase 1)
└── T-2.1 (state.ts)       ← Uses naming, adr
    └── T-2.2 (utils.ts)   ← Helper utilities

Phase 3: Adapter Integration (Depends on Phase 1-2)
└── T-3.1 → T-3.2 → T-3.3 (adapters.ts)

Phase 4: Artifacts & Config (Depends on Phase 3)
└── T-4.1 → T-4.2 → T-4.3

Phase 5: Testing (Depends on Phase 1-4)
└── T-5.1 → T-5.2 → T-5.3 → T-5.4
```

---

## 3. Exact File Implementations

### T-1.1: `naming.ts`

```typescript
import { format } from "node:date-fns";

/** Format date as YYYY-MM-DD (ISO format) */
export function formatDate(date: Date = new Date()): string {
  return date.toISOString().split("T")[0]; // "YYYY-MM-DD"
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

/** Resolve increment for date collision */
export function resolveFilenameIncrement(baseName: string, counter: number): string {
  if (counter === 0) return baseName;
  const ext = baseName.endsWith(".md") ? ".md" : "";
  const base = ext ? baseName.slice(0, -3) : baseName;
  return `${base}-${counter}${ext}`;
}
```

### T-1.2: `worktree.ts`

```typescript
import { execSync } from "child_process";
import { resolve, join } from "node:path";
import { existsSync, mkdirSync } from "node:fs";

export interface WorktreeConfig {
  baseBranch: string;       // Default: "main"
  worktreeRoot: string;     // Default: "./worktrees"
  createBranch: boolean;   // Default: true
}

export interface WorktreeResult {
  success: boolean;
  path?: string;
  error?: string;
}

/** Sanitize worktree name for directory traversal */
function sanitizeWorktreeName(name: string): string {
  // Block directory traversal and null bytes
  if (name.includes("..") || name.includes("\0")) {
    throw new Error("Invalid worktree name: directory traversal detected");
  }
  return name.replace(/[^a-zA-Z0-9-_]/g, "-").slice(0, 50);
}

/** Validate worktree exists and is valid */
function validateWorktree(path: string): boolean {
  try {
    const gitDir = join(path, ".git");
    return existsSync(gitDir);
  } catch {
    return false;
  }
}

export function createWorktree(config: WorktreeConfig, name: string): WorktreeResult {
  const maxRetries = 3;
  let lastError: string = "Unknown error";

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      // Ensure worktree root exists
      mkdirSync(config.worktreeRoot, { recursive: true });

      // Sanitize and resolve path
      const sanitizedName = sanitizeWorktreeName(name);
      const worktreePath = resolve(config.worktreeRoot, sanitizedName);

      // Check if worktree already exists
      if (existsSync(worktreePath)) {
        if (validateWorktree(worktreePath)) {
          return { success: true, path: worktreePath };
        }
        // Invalid existing worktree, treat as new
      }

      // Build git command
      const baseBranch = config.baseBranch || "main";
      if (config.createBranch) {
        // Create new branch for worktree
        execSync(
          `git worktree add -b feature/${sanitizedName} "${worktreePath}" ${baseBranch}`,
          { stdio: "pipe", shell: "/bin/bash" }
        );
      } else {
        // Use existing branch/commit
        execSync(
          `git worktree add "${worktreePath}" ${baseBranch}`,
          { stdio: "pipe", shell: "/bin/bash" }
        );
      }

      // Validate created worktree
      if (!validateWorktree(worktreePath)) {
        return { success: false, error: "Worktree created but validation failed" };
      }

      return { success: true, path: worktreePath };
    } catch (error) {
      lastError = error instanceof Error ? error.message : "Unknown error";
      if (attempt < maxRetries - 1) {
        // Exponential backoff: 100ms, 200ms, 400ms
        const delay = 100 * Math.pow(2, attempt);
        try {
          execSync(`sleep ${delay / 1000}`, { stdio: "pipe" });
        } catch {
          // Ignore sleep errors
        }
      }
    }
  }

  return { success: false, error: `Failed after ${maxRetries} attempts: ${lastError}` };
}

export function listWorktrees(): string[] {
  try {
    const output = execSync("git worktree list --porcelain", { encoding: "utf-8" });
    return output
      .split("\n\n")
      .map((entry) => {
        const pathMatch = entry.match(/^worktree\s+(.+)$/m);
        return pathMatch ? pathMatch[1].trim() : "";
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function cleanupWorktree(path: string): WorktreeResult {
  try {
    execSync(`git worktree remove "${path}"`, { stdio: "pipe", shell: "/bin/bash" });
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error"
    };
  }
}
```

### T-1.3: `adr.ts`

```typescript
import { randomUUID } from "node:crypto";

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

function generateId(): string {
  return `ADR-${randomUUID().slice(0, 8)}`;
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
          const check = q.status === "pending" ? "[ ]" : "[x]";
          lines.push(`- ${check} **${q.title}** — ${q.description}`);
        }
        lines.push("");
      }

      if (decisions.length > 0) {
        lines.push("### Decisions\n");
        for (const d of decisions) {
          lines.push(`- **${d.title}** — ${d.description} [${d.status}]`);
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
| T-1.1 | `formatDate()` returns `YYYY-MM-DD`; `generatePlanFilename()` produces `plan-YYYY-MM-DD-slug.md` |
| T-1.2 | `createWorktree()` creates worktree with sanitized name; handles existing worktrees; includes retry logic |
| T-1.3 | ADR can add entries, approve/reject, and render to markdown with UUID-based IDs |
| T-2.1 | State includes `worktreePath` and `adr` fields; `worktreePath` initialized to `undefined` at plan start |
| T-3.1 | Planning stage creates worktree before showing prompts; fails gracefully on error |
| T-3.2 | Prompts use date-based filenames |
| T-3.3 | Plan template includes `## Architecture Decision Record` section |
| T-4.1 | Artifacts use correct date-based filenames |
| T-4.2 | Tool `ralplan_create_worktree` registered and functional |
| T-4.3 | Config file for worktree settings created |
| T-5.1-5.4 | All tests pass including new worktree integration tests |

---

## 5. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Git not available | Low | High | Graceful error with clear message |
| Worktree creation fails | Medium | Medium | Retry logic (3 attempts with backoff) |
| Filename collision on same day | Low | Low | Append increment `-1`, `-2` |
| Config file missing | High | Low | Use defaults, no hard failure |
| ADR state not persisted | Medium | High | Include in `persistState()` |
| Worktree orphaned on cancel | Medium | Medium | Add optional cleanup on cancel |
| Concurrent sessions conflict | Low | Medium | Check for existing active session |
| Transient git failures | Low | Medium | Retry with exponential backoff |
| Directory traversal attack | Medium | High | Input sanitization in worktree.ts |

---

## 6. Architecture Decision Record (ADR)

### Open Questions

- [x] **Q1: When to create worktree?** — At planning start vs. execution start
  - **Decision:** Create at planning start per user intent "start the new plans in the new worktree"
  - **Status:** APPROVED
  - **Rationale:** Isolates the planning work from main repo immediately

- [x] **Q2: What if worktree creation fails?**
  - **Decision:** Retry 3 times with backoff, then hard fail with clear error
  - **Status:** APPROVED
  - **Rationale:** Transient failures should be retried; persistent failures need user attention

- [x] **Q3: Worktree branch creation?**
  - **Decision:** Create new feature branch by default, configurable
  - **Status:** APPROVED
  - **Rationale:** Aligns with typical feature development workflow

### Decisions

- [x] **D1: Worktree root location** — `./worktrees/` within main repo
  - **Rationale:** Keeps everything in one repo, easy cleanup, industry-standard structure
  - **Consequences:** Worktrees visible in main repo, requires `.gitignore` updates

- [x] **D2: Base branch** — Configurable, default "main"
  - **Rationale:** Industry default, allows override for legacy repos
  - **Consequences:** Config file needed for non-standard repos

- [x] **D3: ADR embedded in plan** — Not separate files
  - **Rationale:** Keeps related content together, simpler tracking, single source of truth
  - **Consequences:** Plan files may grow large with many ADR entries

- [x] **D4: ID generation** — Use `crypto.randomUUID()`
  - **Rationale:** Guaranteed unique, no counter collision, session-persistent
  - **Consequences:** IDs are not sequential but this is not a requirement

- [x] **D5: Security** — Sanitize all user input before shell commands
  - **Rationale:** Prevent directory traversal and command injection
  - **Consequences:** Slight overhead but required for safety

### Approvals

- ✅ **A1: Implementation approach** — Approved by Architect
  - Architect confirmed technical feasibility with noted revisions
  - Branch naming, ID generation, path resolution issues addressed

- ✅ **A2: Edge case handling** — Approved by Critic
  - Retry logic, validation, and security measures confirmed adequate
  - Minor cleanup on cancel flagged but not blocking

### Rejections

- ❌ **R1: Use YAML for ADR** — Rejected
  - **Reason:** Markdown is more human-readable, integrates with existing plan format
  - **Rejected by:** Architect
  - **Date:** 2026-05-05

- ❌ **R2: Use Docker for isolation** — Rejected
  - **Reason:** Overkill for planning tool; git worktrees are native and lightweight
  - **Rejected by:** Architect
  - **Date:** 2026-05-05