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
  specPath?: string;
  planPath?: string;
  answersPath?: string;
  brainstorm?: BrainstormState;
  sessionId?: string;
  startedAt: string;
  completedAt?: string;
  worktreePath?: string; // Associated worktree for this plan
  sessionCwd?: string; // Original directory where the session started (for worktree path derivation)
}

const CURRENT_VERSION = 3;

/** Read ralplan state from file */
export function readRalplanStateFile(directory: string): RalplanState | null {
  const path = resolveStatePath(directory);
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (
      typeof parsed.version !== "number" ||
      parsed.version > CURRENT_VERSION
    ) {
      // Future version, can't read
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
      console.warn("[ralplan] State file has invalid shape, treating as empty");
      return null;
    }

    return parsed as unknown as RalplanState;
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
