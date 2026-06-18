import { getDefaultArtifactFilename } from "./artifacts.js";
import {
  readFileSync,
  writeFileSync,
  existsSync,
  unlinkSync,
  mkdirSync,
} from "node:fs";
import { dirname } from "node:path";
import { resolveStatePath, resolveAnswersPath } from "./utils.js";
import type { PipelineTracking } from "./pipeline.js";
import type { BrainstormState } from "./brainstorm.js";

export type RalplanMode = "ralplan" | "brainstorm";

export interface RalplanState {
  version: number;
  active: boolean;
  mode: RalplanMode;
  pipeline: PipelineTracking;
  originalIdea: string;
  specPath?: string | undefined;
  planPath?: string | undefined;
  answersPath?: string | undefined;
  brainstorm?: BrainstormState | undefined;
  sessionId?: string | undefined;
  startedAt: string;
  completedAt?: string | undefined;
  worktreePath?: string | undefined; // Associated worktree for this plan
  sessionCwd?: string | undefined; // Original directory where the session started (for worktree path derivation)
}

const CURRENT_VERSION = 3;

/**
 * Validate that a parsed JSON object is a usable RalplanState.
 * Returns the value narrowed to RalplanState on success, or null on failure.
 * Handles v1→v2 and v2→v3 migrations. Used by both the file-based reader
 * and the session-replay code path so the two can't drift.
 */
export function validateRalplanState(
  parsed: Record<string, unknown>,
): RalplanState | null {
  // Reject non-numbers, future versions, and anything below the migration
  // floor (v1). v0 was never a schema; v<1 means corrupted or hand-crafted.
  if (
    typeof parsed.version !== "number" ||
    parsed.version < 1 ||
    parsed.version > CURRENT_VERSION
  ) {
    return null;
  }
  // v1 → v2 migration
  if (parsed.version === 1) {
    parsed.version = 2;
    parsed.mode = "ralplan";
    // brainstorm and answersPath are undefined — correct for v1
  }
  // v2 → v3 migration: worktreePath field was added in v3
  // v2 sessions didn't have worktree support, so undefined is correct
  // Note: sessionCwd is also a v3+ field; older sessions fall back to process.cwd()
  if (parsed.version === 2) {
    parsed.version = 3;
  }
  // Validate critical fields
  if (
    typeof parsed.active !== "boolean" ||
    typeof parsed.pipeline !== "object" ||
    !Array.isArray((parsed.pipeline as Record<string, unknown>)?.stages) ||
    (parsed.sessionId != null && typeof parsed.sessionId !== "string") ||
    typeof parsed.mode !== "string"
  ) {
    return null;
  }
  return parsed as unknown as RalplanState;
}

/** Read ralplan state from file */
export function readRalplanStateFile(directory: string): RalplanState | null {
  const path = resolveStatePath(directory);
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const validated = validateRalplanState(parsed);
    if (!validated) {
      console.warn("[ralplan] State file has invalid shape, treating as empty");
      return null;
    }
    return validated;
  } catch (error) {
    // State file read failed - could be corruption, permissions, etc.
    // Return null to treat as no state
    console.warn(
      "[ralplan] Failed to read state file:",
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

/**
 * Type guard for the PersistedState shape used in session entries.
 * Session data is JSON-deserialized and asserted as PersistedState, but the
 * actual value may be malformed (e.g. a corrupted session log, a customType
 * written by an older extension version). Use this guard before reading
 * fields — if it returns false, fall back to file-based state instead of
 * crashing the extension.
 */
export function isPersistedState(data: unknown): data is {
  active: boolean;
  tracking: PipelineTracking;
  originalIdea: string;
  specPath: string;
  planPath: string;
  mode?: RalplanMode;
  sessionId?: string;
  answersPath?: string;
  brainstorm?: BrainstormState;
  worktreePath?: string;
  sessionCwd?: string;
} {
  if (typeof data !== "object" || data === null) return false;
  const d = data as Record<string, unknown>;
  return (
    typeof d.active === "boolean" &&
    typeof d.tracking === "object" &&
    d.tracking !== null &&
    Array.isArray((d.tracking as Record<string, unknown>).stages) &&
    typeof d.originalIdea === "string" &&
    typeof d.specPath === "string" &&
    typeof d.planPath === "string" &&
    (d.mode === undefined || typeof d.mode === "string") &&
    (d.sessionId === undefined || typeof d.sessionId === "string") &&
    (d.answersPath === undefined || typeof d.answersPath === "string")
  );
}

/** Write ralplan state to file */
export function writeRalplanStateFile(
  directory: string,
  state: RalplanState,
): void {
  const path = resolveStatePath(directory);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(state, null, 2), "utf-8");
}

/** Clear ralplan state file */
export function clearRalplanStateFile(directory: string): void {
  const path = resolveStatePath(directory);
  try {
    if (existsSync(path)) {
      unlinkSync(path);
    }
  } catch {
    // ignore
  }
}

import { createBrainstormState } from "./brainstorm.js";

/** Build default state for a new ralplan session */
export function buildDefaultState(
  idea: string,
  pipeline: PipelineTracking,
  sessionId?: string,
  mode: RalplanMode = "ralplan",
  sessionCwd?: string,
): RalplanState {
  const state: RalplanState = {
    version: CURRENT_VERSION,
    active: true,
    mode,
    pipeline,
    originalIdea: idea,
    specPath: `plans/${getDefaultArtifactFilename("spec")}`,
    planPath: `plans/${getDefaultArtifactFilename("plan")}`,
    sessionId,
    startedAt: new Date().toISOString(),
    worktreePath: undefined, // Set after worktree creation
    sessionCwd, // Original directory (for worktree path derivation)
  };

  if (mode === "brainstorm") {
    state.brainstorm = createBrainstormState();
    state.answersPath = sessionCwd
      ? resolveAnswersPath(sessionCwd)
      : "plans/answers.md";
  }

  return state;
}
