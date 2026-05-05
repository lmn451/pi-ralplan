# Specification

**Original Idea:** "1) we want to start the new plans in the new worktree; 2) we want to have plan names with redable date; 3) we want Architecture Decision Record so all the open quesstion and approvals and rejeaction should be covered in the artifact near plan"

**Date:** 2026-05-05

---

## 1. Overview

This specification defines the enhancements to the RALPLAN pipeline to support:
1. Git worktree isolation for new plans
2. Human-readable date-based filenames
3. Integrated Architecture Decision Records (ADR)

---

## 2. Requirements

### 2.1 Functional Requirements

| ID | Requirement | Description |
|----|-------------|-------------|
| FR-1 | Worktree Creation | Create a new Git worktree before starting any new plan |
| FR-2 | Worktree Naming | Convention: `{project}/feature-{short-description}` |
| FR-3 | Base Branch | Worktree created from configurable base branch (default: main) |
| FR-4 | Date-Based Naming | Plan filenames include `YYYY-MM-DD` format |
| FR-5 | Combined Naming | Format: `{date}-{short-description}.md` |
| FR-6 | ADR Integration | ADR embedded within or alongside plan artifact |
| FR-7 | ADR Open Questions | Track open questions with status (pending, answered) |
| FR-8 | ADR Decisions | Record decisions with context and rationale |
| FR-9 | ADR Approvals | Capture approvals with approver and date |
| FR-10 | ADR Rejections | Capture rejections with reason and date |

### 2.2 Non-Functional Requirements

| ID | Requirement | Target |
|----|-------------|--------|
| NFR-1 | Performance | Worktree creation < 5 seconds |
| NFR-2 | Reliability | Graceful handling of existing worktrees |
| NFR-3 | UX Feedback | Clear feedback on worktree creation |
| NFR-4 | Maintainability | Clear, well-structured ADR entries |

### 2.3 Implicit Requirements

| ID | Requirement | Description |
|----|-------------|-------------|
| IR-1 | Configurable Base Branch | Allow override of default "main" branch |
| IR-2 | Configurable Worktree Root | Allow override of default `./worktrees` |
| IR-3 | Worktree Tracking | State must track associated worktree path |
| IR-4 | Historical Preservation | Preserve past plans with dates for retrieval |

### 2.4 Out of Scope

- Git branch management (creation/deletion)
- CI/CD pipeline integration
- Remote worktree operations
- Multi-repo support

---

## 3. Technical Specification

### 3.1 New Modules

```
pi/extensions/ralplan/
├── worktree.ts    # Git worktree management
├── naming.ts      # Date-based naming utilities
├── adr.ts         # ADR structure and utilities
└── ...modified existing files...
```

### 3.2 Core Types

**worktree.ts:**
```typescript
interface WorktreeConfig {
  baseBranch: string;       // Default: "main"
  worktreeRoot: string;     // Default: "./worktrees"
}

function createWorktree(config: WorktreeConfig, name: string): string
```

**naming.ts:**
```typescript
function formatDate(date?: Date): string  // Returns "YYYY-MM-DD"
function generatePlanFilename(description: string, date?: Date): string
function sanitizeDescription(desc: string): string
```

**adr.ts:**
```typescript
interface ADREntry {
  id: string;
  type: "open-question" | "decision" | "approval" | "rejection";
  title: string;
  status?: "pending" | "approved" | "rejected";
  author?: string;
  timestamp: string;
}

interface ADR {
  entries: ADREntry[];
  addEntry(entry: Omit<ADREntry, "id" | "timestamp">): void;
  approve(id: string, author: string): void;
  reject(id: string, author: string, reason: string): void;
  toMarkdown(): string;
}
```

### 3.3 State Extension

Extend `RalplanState`:
```typescript
interface RalplanState {
  // ... existing fields
  worktreePath?: string;  // NEW
  adr?: ADR;              // NEW
}
```

### 3.4 Configuration

Optional `ralplan.config.js`:
```javascript
module.exports = {
  worktree: {
    baseBranch: "main",
    root: "./worktrees"
  }
};
```

---

## 4. File Structure

```
plans/
├── open-questions.md          # Open questions tracking
├── spec-{date}-{desc}.md      # Date-based specs
├── plan-{date}-{desc}.md      # Date-based plans (with embedded ADR)
└── answers.md                 # Brainstorm answers (existing)

worktrees/                     # Worktree root (if using default)
├── feature-worktree-integration/
└── ...
```

---

## 5. Acceptance Criteria

- [ ] AC-1: When `/ralplan` is invoked, a new worktree is created before planning begins
- [ ] AC-2: Plan filenames follow format `{YYYY-MM-DD}-{slug-description}.md`
- [ ] AC-3: Plan artifacts contain an ADR section with entries for questions, decisions, approvals, rejections
- [ ] AC-4: State correctly tracks the associated worktree path
- [ ] AC-5: If worktree creation fails, pipeline fails gracefully with clear error message
- [ ] AC-6: All ADR entries include timestamp and author
- [ ] AC-7: ADR status transitions: PENDING → APPROVED/REJECTED

---

## 6. Requirement Coverage Map

| Requirement | Implementation |
|-------------|----------------|
| FR-1, FR-2, FR-3 | `worktree.ts` - `createWorktree()` |
| FR-4, FR-5 | `naming.ts` - `generatePlanFilename()` |
| FR-6, FR-7, FR-8, FR-9, FR-10 | `adr.ts` - ADR class and embedded in plan template |
| NFR-1, NFR-2, NFR-3 | Integration in `adapters.ts` with error handling |
| IR-1, IR-2 | `WorktreeConfig` with defaults, configurable via config file |
| IR-3, IR-4 | State persistence in `state.ts` |

---

## 7. Open Questions

See `plans/open-questions.md` for current unresolved questions.

---

## 8. Edge Cases

| Scenario | Handling |
|----------|----------|
| Worktree already exists | Return existing path, log warning |
| Git not available | Fail gracefully with clear error |
| Invalid description chars | Sanitize to URL-safe format |
| Date conflict (same day) | Append increment: `-1`, `-2` |
| Plan without worktree | Allow fallback to main repo |