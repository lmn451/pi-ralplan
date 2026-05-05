# Technical Specification

**Original Idea:** "1) we want to start the new plans in the new worktree; 2) we want to have plan names with redable date; 3) we want Architecture Decision Record so all the open quesstion and approvals and rejeaction should be covered in the artifact near plan"

---

## 1. Tech Stack Decisions

### 1.1 Language & Runtime
- **Language:** TypeScript
- **Runtime:** Node.js (>=18.0.0)
- **Package Manager:** npm

### 1.2 Core Dependencies
- `@mariozechner/pi-coding-agent` — Extension API
- `@sinclair/typebox` — Runtime type validation for tool parameters
- `@mariozechner/pi-ai` — StringEnum support

### 1.3 No New External Dependencies
- Use existing Node.js `child_process` for git operations
- Use existing `node:fs` for file operations
- No additional npm packages required

---

## 2. Architecture Overview

### 2.1 Extension Module Pattern
The changes are additive to the existing `ralplan` extension:

```
pi/extensions/ralplan/
├── worktree.ts        # NEW: Git worktree management
├── naming.ts          # NEW: Date-based naming utilities
├── adr.ts             # NEW: ADR structure and utilities
├── adapters.ts        # MODIFIED: Integrate worktree/naming/adr
├── artifacts.ts       # MODIFIED: Date-based filename handling
├── state.ts           # MODIFIED: Add worktree/adr state
└── ...existing...
```

### 2.2 Core Modules

#### `worktree.ts` — Worktree Management
```typescript
interface WorktreeConfig {
  baseBranch: string;           // Default: "main"
  worktreeRoot: string;         // Default: "./worktrees"
  autoCleanup: boolean;         // Default: false
}

function createWorktree(config: WorktreeConfig, name: string): string
function listWorktrees(): WorktreeInfo[]
function cleanupWorktree(path: string): void
```

#### `naming.ts` — Date-Based Naming
```typescript
function formatDate(date: Date = new Date()): string  // Returns "YYYY-MM-DD"
function generatePlanFilename(description: string, date: Date = new Date()): string
function generateSpecFilename(description: string, date: Date = new Date()): string
function sanitizeDescription(desc: string): string  // URL-safe, lowercase
```

#### `adr.ts` — Architecture Decision Record
```typescript
interface ADREntry {
  id: string;
  type: "open-question" | "decision" | "approval" | "rejection";
  title: string;
  description: string;
  status?: "pending" | "approved" | "rejected";
  author?: string;
  timestamp: string;
}

interface ADR {
  entries: ADREntry[];
  addEntry(entry: Omit<ADREntry, "id" | "timestamp">): void
  approve(id: string, author: string): void
  reject(id: string, author: string, reason: string): void
  toMarkdown(): string
}

function createADR(): ADR
function embedADRInPlan(planContent: string, adr: ADR): string
function extractADRFromPlan(content: string): ADR | null
```

### 2.3 State Changes

In `state.ts`, extend `RalplanState`:
```typescript
interface RalplanState {
  // ... existing fields
  worktreePath?: string;           // NEW: Associated worktree
  adr?: ADR;                       // NEW: ADR for current plan
}
```

### 2.4 Adapter Integration

In `adapters.ts`, modify `ralplanAdapter.getPrompt()`:
- Include worktree creation instructions
- Add date-based filename guidance
- Embed ADR template in prompts

---

## 3. File Structure

```
pi/extensions/ralplan/
├── index.ts              # MODIFIED: Register new modules
├── worktree.ts           # NEW: Git worktree operations
├── naming.ts             # NEW: Date formatting & filename gen
├── adr.ts                # NEW: ADR structure & utilities
├── adapters.ts           # MODIFIED: Integration
├── artifacts.ts           # MODIFIED: Date-based naming
├── state.ts              # MODIFIED: Extended state
└── utils.ts              # MODIFIED: Path helpers

plans/
├── open-questions.md     # EXISTING: Open questions tracking
├── requirements.md       # NEW: Requirements from Analyst
├── tech-spec.md          # NEW: This technical spec
├── spec-{date}-{desc}.md # DYNAMIC: Date-based specs
├── plan-{date}-{desc}.md # DYNAMIC: Date-based plans
└── adr-{date}-{desc}.md  # OPTIONAL: Standalone ADR if needed
```

---

## 4. Dependencies

**No new dependencies required.** All functionality uses:
- Node.js built-in modules: `child_process`, `fs`, `path`
- Existing pi-coding-agent APIs

---

## 5. API/Interface Definitions

### 5.1 Tool Registration
New tools to register in `index.ts`:

```typescript
pi.registerTool({
  name: "ralplan_create_worktree",
  label: "Create Worktree",
  description: "Create a new git worktree for this plan",
  parameters: Type.Object({
    name: Type.String({ description: "Worktree name" }),
    baseBranch: Type.Optional(Type.String({ description: "Base branch (default: main)" })),
  }),
  execute: async (_, params) => {
    // Implementation
  }
});
```

### 5.2 Configuration File
Optional `ralplan.config.js` in project root:
```javascript
module.exports = {
  worktree: {
    baseBranch: "main",
    root: "./worktrees",
    autoCleanup: false
  },
  naming: {
    dateFormat: "YYYY-MM-DD"
  }
};
```

---

## 6. Quality Gates

For spec.md:
- `## Acceptance Criteria` — Testable boolean statements
- `## Requirement Coverage Map` — FR/NFR/IR mapping

For plan.md:
- `## Architecture Decision Record (ADR)` — Decision, Drivers, Alternatives, Consequences
- `## Task Breakdown` — Exact file paths
- `## Dependency Graph` — Execution order
- `## Acceptance Criteria per Task`
- `## Risk Register`

---

## 7. Edge Cases

| Scenario | Handling |
|----------|----------|
| Worktree already exists | Return existing path, log warning |
| Git not available | Fail gracefully with clear error |
| Invalid description chars | Sanitize to URL-safe format |
| Date conflict (same day) | Append increment: `2026-05-05-1`, `2026-05-05-2` |
| Plan without worktree | Allow fallback to main repo |