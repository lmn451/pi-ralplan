# Requirements Analysis

**Original Idea:** "1) we want to start the new plans in the new worktree; 2) we want to have plan names with readable date; 3) we want Architecture Decision Record so all the open questions and approvals and rejection should be covered in the artifact near plan"

---

## 1. Functional Requirements

### 1.1 Git Worktree Integration
- **FR-1:** Create a new Git worktree before starting any new plan
- **FR-2:** Worktree naming convention: `{project-name}/feature-{short-description}`
- **FR-3:** Worktree should be created from the main/base branch
- **FR-4:** Automatic cleanup or isolation of worktree on session end

### 1.2 Date-Based Plan Naming
- **FR-5:** Plan filenames must include a readable date format
- **FR-6:** Date format: `YYYY-MM-DD` (e.g., `2026-05-05`)
- **FR-7:** Combined naming: `{date}-{short-description}.md` (e.g., `2026-05-05-git-worktree-integration.md`)
- **FR-8:** Support both spec and plan files with date-based naming

### 1.3 Architecture Decision Record (ADR)
- **FR-9:** ADR must be embedded within or alongside the plan artifact
- **FR-10:** ADR should capture:
  - Open questions with status (pending, answered)
  - Decisions made
  - Approvals (with approver name and date)
  - Rejections (with reason and date)
- **FR-11:** ADR should support linking to related decisions
- **FR-12:** ADR status tracking: PENDING → APPROVED/REJECTED

---

## 2. Non-Functional Requirements

### 2.1 Performance
- **NFR-1:** Worktree creation should complete within 5 seconds
- **NFR-2:** File operations should be synchronous and reliable

### 2.2 User Experience
- **NFR-3:** Clear visual feedback when worktree is created
- **NFR-4:** Human-readable filenames for easy navigation
- **NFR-5:** ADR entries should be scannable and well-structured

### 2.3 Reliability
- **NFR-6:** Graceful handling if worktree already exists
- **NFR-7:** Idempotent operations where possible

---

## 3. Implicit Requirements

### 3.1 Configuration
- **IR-1:** Allow configurable base branch for worktree creation
- **IR-2:** Allow configurable worktree directory location

### 3.2 Tracking
- **IR-3:** Track which worktree each plan belongs to
- **IR-4:** State persistence for pipeline continuity

### 3.3 History
- **IR-5:** Preserve historical plans with dates
- **IR-6:** Easy retrieval of past decisions

---

## 4. Out of Scope

- **OOS-1:** Git branch management (creation, deletion)
- **OOS-2:** CI/CD pipeline integration
- **OOS-3:** Remote worktree operations
- **OOS-4:** Multi-repo support

---

## 5. Open Questions

## Technical Approach - 2026-05-05
- [ ] Should worktrees be created in a dedicated `worktrees/` directory or alongside the main repo? — Impacts repository structure and CI/CD assumptions
- [ ] What happens if the user aborts mid-plan? Should the worktree be cleaned up? — Data integrity vs. cleanup convenience
- [ ] Should ADR entries be versioned within the plan or as separate files? — Simplicity vs. traceability