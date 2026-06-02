/**
 * State management for the RALPLAN extension.
 *
 * Holds the in-memory state, helpers, and lifecycle functions shared by
 * commands, tools, and event handlers. Built once in `index.ts` and
 * passed to each module via the `RalplanContext` interface.
 *
 * Per plans/spec-2026-06-01-v2.md T-11: extracted from the previous
 * 1,257-line god module.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import {
  getPipelineStatus,
  getCurrentStageAdapter,
  formatPipelineHUD,
  type PipelineContext,
  type PipelineTracking,
} from "./pipeline.js";

import {
  readRalplanStateFile,
  writeRalplanStateFile,
  clearRalplanStateFile,
  type RalplanState,
  type RalplanMode,
} from "./state.js";
import { cleanupWorktree, getAutoCleanup } from "./worktree.js";
import { resolveOpenQuestionsPath } from "./utils.js";
import type { BrainstormState } from "./brainstorm.js";


/** Custom entry type used to persist RALPLAN state into the session. */
export const CUSTOM_TYPE = "ralplan-state";

/** Shape of a persisted `ralplan-state` session entry. */
export interface PersistedState {
  active: boolean;
  tracking: PipelineTracking;
  originalIdea: string;
  specPath: string;
  planPath: string;
  sessionId?: string;
  mode?: RalplanMode;
  answersPath?: string;
  brainstorm?: BrainstormState;
  worktreePath?: string; // Associated worktree
}

/**
 * Type guard for session-entry data. Mirrors the critical-field
 * validation in `state.ts:validateRalplanState` so a malformed entry
 * falls back to the file-based state instead of crashing the extension.
 */
export function isPersistedState(x: unknown): x is PersistedState {
  if (typeof x !== "object" || x === null) return false;
  const obj = x as Record<string, unknown>;
  if (typeof obj.active !== "boolean") return false;
  if (typeof obj.tracking !== "object" || obj.tracking === null) return false;
  if (!Array.isArray((obj.tracking as Record<string, unknown>).stages)) return false;
  if (typeof obj.originalIdea !== "string") return false;
  if (typeof obj.specPath !== "string") return false;
  if (typeof obj.planPath !== "string") return false;
  if (obj.mode !== undefined && typeof obj.mode !== "string") return false;
  if (obj.sessionId !== undefined && typeof obj.sessionId !== "string") return false;
  return true;
}

/**
 * The shared context object passed to commands, tools, and handlers.
 *
 * State variables are accessed via getter/setter functions (not direct
 * properties) so the wiring module can keep them as `let` bindings in
 * its closure while commands/handlers see a stable interface.
 */
export interface RalplanContext {
  readonly pi: ExtensionAPI;

  // State accessors
  getState(): RalplanState | null;
  setState(s: RalplanState | null): void;
  getSessionCwd(): string;
  setSessionCwd(cwd: string): void;
  getLastAdvancedEntryId(): string | null;
  setLastAdvancedEntryId(id: string | null): void;
  getAutoStartMode(): "ralplan" | "brainstorm" | null;
  setAutoStartMode(mode: "ralplan" | "brainstorm" | null): void;

  // Helpers
  isActive(): boolean;
  getWorkspaceDir(): string;
  toWorkspacePath(path?: string): string | undefined;
  buildContext(): PipelineContext | null;
  persistState(): void;
  deactivateState(
    notifyCtx?: ExtensionContext,
    opts?: { suppressCleanup?: boolean },
  ): void;
  updateUI(ctx: ExtensionContext): void;
  reconstructFromSession(ctx: ExtensionContext): void;
}

/**
 * Create a fresh RalplanContext bound to the given ExtensionAPI.
 *
 * State variables are held in closure `let` bindings; getters/setters
 * expose them to the rest of the extension.
 */
export function createRalplanContext(pi: ExtensionAPI): RalplanContext {
  let state: RalplanState | null = null;
  let sessionCwd: string = process.cwd();
  let lastAdvancedEntryId: string | null = null;
  let autoStartMode: "ralplan" | "brainstorm" | null = null;

  function isActive(): boolean {
    return state?.active === true;
  }

  function getWorkspaceDir(): string {
    return state?.worktreePath ?? sessionCwd;
  }

  function toWorkspacePath(path?: string): string | undefined {
    if (!path || !state?.worktreePath) return path;
    return join(state.worktreePath, path);
  }

  function buildContext(): PipelineContext | null {
    if (!state) return null;
    return {
      idea: state.originalIdea,
      directory: getWorkspaceDir(),
      cwd: getWorkspaceDir(),
      sessionId: state.sessionId,
      specPath: toWorkspacePath(state.specPath),
      planPath: toWorkspacePath(state.planPath),
      openQuestionsPath: state.worktreePath
        ? resolveOpenQuestionsPath(state.worktreePath)
        : "plans/open-questions.md",
      answersPath: toWorkspacePath(state.answersPath),
      config: state.pipeline.pipelineConfig,
      mode: state.mode,
      brainstorm: state.brainstorm,
      worktreePath: state.worktreePath,
    };
  }

  function persistState(): void {
    if (!state) return;
    const persisted: PersistedState = {
      active: state.active,
      tracking: state.pipeline,
      originalIdea: state.originalIdea,
      specPath: state.specPath || "plans/spec.md",
      planPath: state.planPath || "plans/plan.md",
      sessionId: state.sessionId,
      mode: state.mode,
      answersPath: state.answersPath,
      brainstorm: state.brainstorm,
      worktreePath: state.worktreePath,
    };
    pi.appendEntry(CUSTOM_TYPE, persisted);
    writeRalplanStateFile(sessionCwd, state);
  }

  // T-9.2 + T-9.3: honor autoCleanup flag and accept suppressCleanup option.
  //   - autoCleanup (from worktree.ts:DEFAULT_AUTO_CLEANUP, default false):
  //     when true, the worktree is removed on completion. When false, the
  //     worktree (and its spec/plan/answers) is preserved for review.
  //   - suppressCleanup: explicit override for the cancel path so a user
  //     cancellation always preserves the worktree regardless of autoCleanup.
  function deactivateState(
    notifyCtx?: ExtensionContext,
    opts?: { suppressCleanup?: boolean },
  ): void {
    if (state) {
      const shouldCleanup =
        !opts?.suppressCleanup && getAutoCleanup() && !!state.worktreePath;
      if (shouldCleanup && state.worktreePath) {
        try {
          const result = cleanupWorktree(state.worktreePath);
          if (!result.success) {
            notifyCtx?.ui.notify(
              `Worktree cleanup failed: ${result.error}`,
              "warning",
            );
          } else {
            notifyCtx?.ui.notify(
              `Worktree cleaned up: ${state.worktreePath}`,
              "info",
            );
          }
        } catch {
          // cleanup not available or already removed
        }
      }
      state.active = false;
      state.completedAt = new Date().toISOString();
      persistState();
    }
    state = null;
    clearRalplanStateFile(sessionCwd);
  }

  function updateUI(ctx: ExtensionContext): void {
    if (!isActive() || !state) {
      ctx.ui.setStatus("ralplan", undefined);
      ctx.ui.setWidget("ralplan-progress", undefined);
      return;
    }

    // Brainstorm sub-phase status
    if (state.mode === "brainstorm" && state.brainstorm) {
      const sub = state.brainstorm.subPhase;
      let statusText: string;
      switch (sub) {
        case "expanding":
          statusText = "🧠 Expanding...";
          break;
        case "awaiting-answers":
          statusText = `🧠 Awaiting Answers (${state.brainstorm.questions.length} questions)`;
          break;
        case "planning":
          statusText = "🧠 Planning (Consensus)";
          break;
        default:
          statusText = "🧠 Brainstorm";
      }
      ctx.ui.setStatus("ralplan", ctx.ui.theme.fg("accent", statusText));
      ctx.ui.setWidget("ralplan-progress", formatPipelineHUD(state.pipeline));
      return;
    }

    const status = getPipelineStatus(state.pipeline);
    const currentName =
      getCurrentStageAdapter(state.pipeline)?.name ??
      (status.isComplete ? "Complete" : "None");

    ctx.ui.setStatus(
      "ralplan",
      ctx.ui.theme.fg("accent", `📋 ${currentName} (${status.progress})`),
    );

    const hud = formatPipelineHUD(state.pipeline);
    ctx.ui.setWidget("ralplan-progress", hud);
  }

  function reconstructFromSession(ctx: ExtensionContext): void {
    const entries = ctx.sessionManager.getEntries();

    // Find the most recent ralplan-state entry, validated by type guard
    // (T-7). Malformed entries fall through to the file-based fallback below.
    // The `as` is needed because SessionEntry is a discriminated union and
    // TypeScript can't narrow on string-literal filters alone in all cases.
    const ralplanEntry = entries
      .filter((e) => e.type === "custom" && e.customType === CUSTOM_TYPE)
      .pop() as { data?: PersistedState } | undefined;
    const data = ralplanEntry?.data;

    if (isPersistedState(data)) {
      const status = getPipelineStatus(data.tracking);
      state = {
        version: 3,
        active: status.isComplete ? false : data.active,
        mode: data.mode ?? "ralplan",
        pipeline: data.tracking,
        originalIdea: data.originalIdea,
        specPath: data.specPath,
        planPath: data.planPath,
        answersPath: data.answersPath,
        brainstorm: data.brainstorm,
        sessionId: data.sessionId,
        worktreePath: data.worktreePath,
        startedAt:
          data.tracking.stages[0]?.startedAt ?? new Date().toISOString(),
      };
      // Prevent auto-start logic from firing on a resumed session
      autoStartMode = null;
      return;
    }

    // Fallback to file-based state
    const fileState = readRalplanStateFile(sessionCwd);
    if (fileState) {
      state = fileState;
    }
  }

  return {
    pi,
    getState: () => state,
    setState: (s) => {
      state = s;
    },
    getSessionCwd: () => sessionCwd,
    setSessionCwd: (cwd) => {
      sessionCwd = cwd;
    },
    getLastAdvancedEntryId: () => lastAdvancedEntryId,
    setLastAdvancedEntryId: (id) => {
      lastAdvancedEntryId = id;
    },
    getAutoStartMode: () => autoStartMode,
    setAutoStartMode: (mode) => {
      autoStartMode = mode;
    },
    isActive,
    getWorkspaceDir,
    toWorkspacePath,
    buildContext,
    persistState,
    deactivateState,
    updateUI,
    reconstructFromSession,
  };
}
