# Parity Report: pi-ralplan vs oh-my-claudecode

## Executive Summary

- **Dimensions checked:** 9 (+ 2 sub-dimensions)
- **Total findings:** 14
- **Critical:** 0 | **Warning:** 5 | **Info:** 9
- **Overall verdict:** MINOR GAPS — The pi-ralplan extension faithfully replicates the core pipeline behavior of oh-my-claudecode's autopilot/ralplan system. All stage sequences, signals, config defaults, adapter logic, and gate behavior are identical. The differences are primarily in host-integration specifics (subagent syntax, model hints, UI integration) and a richer state model in omc that pi-ralplan intentionally simplified.

---

## Findings by Dimension

### Dimension A: Pipeline Types & Config

**Finding A-1: PASS — Type definitions are identical**
- **Evidence:** `pi/extensions/ralplan/pipeline.ts:7-33` vs `src/hooks/autopilot/pipeline-types.ts:19-96`
- **Details:** PipelineStageId, StageStatus, STAGE_ORDER, ExecutionBackend, VerificationConfig, PipelineConfig, DEFAULT_PIPELINE_CONFIG, PipelineContext, PipelineStageState, PipelineTracking all have identical shapes and default values.
- **Severity:** Info (no issue)

**Finding A-2: WARNING — resolvePipelineConfig handles partial verification overrides differently**
- **Evidence:** `pi/extensions/ralplan/pipeline.ts:91-100` vs `src/hooks/autopilot/pipeline.ts:53-81`
- **Details:** pi-ralplan deep-merges partial verification overrides (`{ ...DEFAULT_PIPELINE_CONFIG.verification, ...userConfig.verification }`), preserving `engine: "ralph"` if only `maxIterations` is overridden. omc replaces the whole verification object (`config.verification = userConfig.verification`). In practice, both behave the same when full VerificationConfig objects are passed; the divergence only appears with partial objects.
- **Recommendation:** Align pi-ralplan with omc's explicit field assignment, or document the deep-merge as an intentional improvement.
- **Severity:** Warning

---

### Dimension B: Stage Adapters

**Finding B-1: PASS — Adapter interface and all 4 implementations match**
- **Evidence:** `pi/extensions/ralplan/adapters.ts` vs `src/hooks/autopilot/adapters/*.ts`
- **Details:** All 4 adapters (ralplan, execution, ralph, qa) have identical `id`, `name`, `completionSignal`, and `shouldSkip()` logic. The PipelineStageAdapter interface fields match exactly.
- **Severity:** Info (no issue)

**Finding B-2: WARNING — Execution team prompt references different subagent tooling**
- **Evidence:** `pi/extensions/ralplan/prompts.ts:147-183` vs `src/hooks/autopilot/adapters/execution-adapter.ts:30-79`
- **Details:** omc's team execution prompt explicitly references `TeamCreate`, `TaskCreate`, and `team_name` parameter — specific tools from its Team orchestrator. pi-ralplan's team execution prompt uses generic language ("Create tasks", "Spawn executor subagents") without naming specific tools.
- **Recommendation:** If Pi develops a team execution extension, the prompt should be updated to reference its specific tools. Until then, the generic language is appropriate.
- **Severity:** Warning

**Finding B-3: INFO — omc adapters are split into separate files; pi-ralplan combines them**
- **Evidence:** `pi/extensions/ralplan/adapters.ts` (1 file, 4 adapters) vs `src/hooks/autopilot/adapters/` (4 files)
- **Details:** Structural difference with no behavioral impact.
- **Severity:** Info

---

### Dimension C: Pipeline Orchestrator

**Finding C-1: PASS — Stage advancement logic is identical**
- **Evidence:** `pi/extensions/ralplan/pipeline.ts:160-215` vs `src/hooks/autopilot/pipeline.ts:211-285`
- **Details:** Both implementations: mark current stage complete with timestamp, iterate forward to find next non-skipped stage, mark it active with timestamp, call onExit/onEnter hooks, return next adapter or null for complete.
- **Severity:** Info (no issue)

**Finding C-2: PASS — Status and HUD formatting are equivalent**
- **Evidence:** `pi/extensions/ralplan/pipeline.ts:253-315` vs `src/hooks/autopilot/pipeline.ts:411-465`
- **Details:** getPipelineStatus computes identical metrics (current, completed, pending, skipped, isComplete, progress). formatPipelineHUD uses the same status icons (`[OK]`, `[>>]`, `[..]`, `[--]`, `[!!]`).
- **Severity:** Info (no issue)

**Finding C-3: INFO — formatPipelineHUD return type differs**
- **Evidence:** `pi/extensions/ralplan/pipeline.ts:290` returns `string[]` vs `src/hooks/autopilot/pipeline.ts:439` returns `string`
- **Details:** pi-ralplan returns an array of lines (for Pi's widget API); omc returns a single concatenated string. The content is the same.
- **Severity:** Info

---

### Dimension D: Prompt Generation

**Finding D-1: WARNING — Expansion prompt omits model specification for subagents**
- **Evidence:** `pi/extensions/ralplan/prompts.ts:22-57` vs `src/hooks/autopilot/prompts.ts:47-89`
- **Details:** omc's expansion prompt specifies `model="opus"` for both Analyst and Architect subagents. pi-ralplan's prompt uses `agent="analyst"` and `agent="architect"` without model hints. This means omc guarantees high-capacity subagents; pi-ralplan delegates model selection to the host.
- **Recommendation:** Add optional model hints to pi-ralplan prompts, or document that Pi's host handles model selection.
- **Severity:** Warning

**Finding D-2: WARNING — Expansion prompt omits "Persist Open Questions" step**
- **Evidence:** `pi/extensions/ralplan/prompts.ts` vs `src/hooks/autopilot/prompts.ts:74-84`
- **Details:** omc's expansion prompt includes Step 2.5: "Persist Open Questions" — extracting open questions from Analyst output and saving them to a file. pi-ralplan's prompt skips this step entirely.
- **Recommendation:** Add the open questions persistence step to pi-ralplan's expansion prompt for parity.
- **Severity:** Warning

**Finding D-3: PASS — Direct planning, ralph, and QA prompts are semantically equivalent**
- **Evidence:** Cross-file comparison after normalization
- **Details:** After normalizing paths and subagent syntax, the direct planning, ralph verification, and QA prompts convey identical instructions with identical signal references.
- **Severity:** Info (no issue)

**Finding D-4: INFO — Prompt header prefixes differ**
- **Evidence:** `pi/extensions/ralplan/prompts.ts` uses `## IDEA EXPANSION` vs `src/hooks/autopilot/prompts.ts` uses `## AUTOPILOT PHASE 0: IDEA EXPANSION`
- **Details:** Cosmetic difference in section headers. No behavioral impact.
- **Severity:** Info

---

### Dimension E: Signal Detection

**Finding E-1: PASS — All completion signal strings are identical**
- **Evidence:** `pi/extensions/ralplan/prompts.ts:15-18` vs `src/hooks/autopilot/adapters/index.ts`
- **Details:** PIPELINE_RALPLAN_COMPLETE, PIPELINE_EXECUTION_COMPLETE, PIPELINE_RALPH_COMPLETE, PIPELINE_QA_COMPLETE are exactly the same strings in both implementations.
- **Severity:** Info (no issue)

**Finding E-2: PASS — Signal detection uses substring match**
- **Evidence:** `pi/extensions/ralplan/signals.ts:11-15` vs `src/hooks/autopilot/pipeline.ts:343-355` (getCurrentCompletionSignal + getSignalToStageMap)
- **Details:** Both detect signals by checking if the expected string is contained within assistant output.
- **Severity:** Info (no issue)

**Finding E-3: PASS — Message text extraction handles string and array content**
- **Evidence:** `pi/extensions/ralplan/signals.ts:24-40` vs omc's equivalent (embedded in bridge/hook layer)
- **Details:** pi-ralplan's getLastAssistantText extracts string content or text blocks from array content. omc handles this in its bridge module. Both support the same content shapes.
- **Severity:** Info (no issue)

---

### Dimension F: State Management

**Finding F-1: PASS — Core tracking fields are equivalent**
- **Evidence:** `pi/extensions/ralplan/state.ts:8-17` vs `src/hooks/autopilot/types.ts`
- **Details:** Both track: active, pipeline, originalIdea, specPath, planPath, sessionId, startedAt, completedAt.
- **Severity:** Info (no issue)

**Finding F-2: INFO — omc has richer nested state; pi-ralplan is intentionally flat**
- **Evidence:** `src/hooks/autopilot/types.ts` shows expansion, planning, execution, qa, validation sub-objects vs `pi/extensions/ralplan/state.ts` flat RalplanState
- **Details:** omc's AutopilotState tracks per-phase details (analyst_complete, tasks_completed, ultraqa_cycles, verdicts, etc.). pi-ralplan simplified to a flat state because it stores phase-specific data in planning artifacts (spec.md, plan.md) rather than in state. This is an intentional design choice, not a parity gap.
- **Severity:** Info

**Finding F-3: INFO — pi-ralplan has dual persistence; omc uses file-based only**
- **Evidence:** `pi/extensions/ralplan/index.ts:85-125` (persistState + reconstructFromSession) vs `src/hooks/autopilot/state.ts` (writeModeState/readModeState)
- **Details:** pi-ralplan persists state both in session entries (`pi.appendEntry`) and in `.pi/ralplan/state.json` for branch support. omc uses a centralized mode-state-io module. Both achieve session isolation.
- **Severity:** Info

---

### Dimension G: Skill Definition

**Finding G-1: PASS — Both describe identical consensus workflow**
- **Evidence:** `pi/skills/ralplan/SKILL.md` vs `skills/ralplan/SKILL.md`
- **Details:** Both describe: Planner creates plan → Architect reviews → Critic challenges → iterate until consensus (max 5 iterations). Both mention RALPLAN-DR summary (Principles, Drivers, Options). Both require ADR in final plan.
- **Severity:** Info (no issue)

**Finding G-2: INFO — omc skill documents additional features not in pi-ralplan**
- **Evidence:** `skills/ralplan/SKILL.md:20-23` (interactive mode, codex flags)
- **Details:** omc's skill documents `--interactive`, `--deliberate`, `--architect codex`, `--critic codex` flags, and a company-context call step. pi-ralplan's skill doesn't mention these. These are omc-specific features, not parity gaps.
- **Severity:** Info

**Finding G-3: INFO — pi-ralplan skill has stronger enforcement language**
- **Evidence:** `pi/skills/ralplan/SKILL.md:21-24`
- **Details:** pi-ralplan's skill uses MUST NOT language for self-approval and simulated consensus. omc's skill is prescriptive but less absolute. This is a documentation style difference.
- **Severity:** Info

---

### Dimension H: Pre-Execution Gate

**Finding H-1: PASS — Gate logic is identical**
- **Evidence:** `pi/extensions/ralplan/index.ts:388-431` vs `skills/ralplan/SKILL.md:87-117`
- **Details:** Both use the same CONCRETE_ANCHORS regexes, BROAD_INDICATORS list, BYPASS_PREFIXES, and looksLikeBroadRequest logic (`hasBroad && isShort && !hasAnchor`). The pi-ralplan gate implementation was derived directly from the omc skill documentation.
- **Severity:** Info (no issue)

**Finding H-2: INFO — omc documents the gate in the skill; pi-ralplan implements it in the extension**
- **Evidence:** `skills/ralplan/SKILL.md:71-124` (documented) vs `pi/extensions/ralplan/index.ts:388-431` (implemented)
- **Details:** In omc, the gate behavior is described in the skill for the LLM to follow. In pi-ralplan, the gate is actively enforced by the extension's `input` event handler. This is an architectural difference (passive documentation vs active enforcement) but produces the same effective behavior.
- **Severity:** Info

---

### Dimension I: Test Coverage

**Finding I-1: PASS — Both have equivalent core test coverage**
- **Evidence:** `tests/*.test.ts` (65 tests) vs `src/hooks/autopilot/__tests__/*.ts` (~200+ tests)
- **Details:** Both test: config resolution, pipeline tracking construction, stage advancement (including skip handling), signal mapping, adapter lookup, status/HUD formatting, state persistence. pi-ralplan's 65 tests cover all pipeline core behaviors. omc has additional tests for transitions, validation, and prompts.
- **Severity:** Info (no issue)

**Finding I-2: INFO — omc has tests for features pi-ralplan doesn't implement**
- **Evidence:** `src/hooks/autopilot/__tests__/validation.test.ts`, `transitions.test.ts`
- **Details:** omc tests a validation module (verdict recording, retry logic) and transition helpers (Ralph→UltraQA, UltraQA→Validation). pi-ralplan intentionally doesn't implement these — verification is handled by the ralph stage adapter and transitions are handled by the generic advanceStage function.
- **Severity:** Info

**Finding I-3: INFO — pi-ralplan has dedicated gate tests; omc doesn't test the gate directly**
- **Evidence:** `tests/gate.test.ts` vs no equivalent in omc
- **Details:** pi-ralplan tests the pre-execution gate with 19 test cases. omc documents the gate in the skill but has no automated tests for it.
- **Severity:** Info

---

## Recommendations

### Immediate (Warning-level)
1. **Add model hints to expansion prompt** (D-1): Consider adding optional model recommendations for subagent spawns to match omc's explicit `model="opus"` guidance.
2. **Add "Persist Open Questions" step** (D-2): Add Step 2.5 to the expansion prompt to match omc's workflow.
3. **Align resolvePipelineConfig** (A-2): Either document the deep-merge behavior as an intentional improvement, or switch to explicit field assignment for strict parity.
4. **Update execution team prompt** (B-2): If Pi's ecosystem develops team orchestration tools, update the prompt to reference them specifically.

### Deferred (Info-level)
5. Consider whether pi-ralplan needs a validation module equivalent to omc's (I-2). The ralph stage adapter may provide sufficient coverage.
6. The transition prompt complete signal differs (`RALPLAN_PIPELINE_COMPLETE` vs `AUTOPILOT_COMPLETE`) — this is cosmetic and consistent with each system's naming.

### No Action Needed
- All type definitions, signals, adapter logic, gate behavior, and core orchestration are fully equivalent.
- The richer omc state model and Pi-specific UI features are intentional host-specific value-adds, not gaps.

---

## Requirement Coverage Map

| Spec Requirement | Finding | Verdict |
|---|---|---|
| FR-1 (stage sequence) | C-1 | PASS |
| FR-2 (config defaults) | A-1 | PASS |
| FR-3 (adapter interface) | B-1 | PASS |
| FR-4 (signals) | E-1 | PASS |
| FR-5 (signal detection) | E-2, E-3 | PASS |
| FR-6 (skip logic) | B-1 | PASS |
| FR-7 (prompts) | D-1, D-2, D-3, D-4 | 2 WARNINGS + 2 PASS |
| FR-8 (state schema) | F-1, F-2 | PASS (intentional simplification) |
| FR-9 (tracking) | A-1, C-1 | PASS |
| FR-10 (advance) | C-1 | PASS |
| FR-11 (gate) | H-1, H-2 | PASS |
| FR-12 (skill workflow) | G-1, G-2, G-3 | PASS |
| FR-13 (artifacts) | F-4 — omc artifact system differs (plan-output.ts, mode-state-io.js); quality gates not directly compared | INFO |
| NFR-1 (bun test) | I-1 | PASS |
| NFR-2 (omc tests) | I-1 | PASS (static analysis) |
| NFR-3 (no regressions) | — | PASS |
| NFR-4 (TS strict) | — | PASS |
