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
import type { ConsensusState } from "./consensus.js";

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
  consensusState?: ConsensusState;
  sessionId?: string;
  startedAt: string;
  completedAt?: string;
  worktreePath?: string; // Associated worktree for this plan
}

const CURRENT_VERSION = 3;
/**
 * Validate and migrate a parsed state object. Shared by `readRalplanStateFile`
 * (file-based reader) and the session-entry type guard in `index.ts`.
 *
 * Returns the validated/migrated state, or `null` if the input is invalid.
 */
export function validateRalplanState(parsed: unknown): RalplanState | null {
  if (typeof parsed !== "object" || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.version !== "number" || obj.version > CURRENT_VERSION) {
    // Future version, can't read
    return null;
  }
  // v1 → v2 migration
  if (obj.version === 1) {
    obj.version = 2;
    obj.mode = "ralplan";
    // brainstorm and answersPath are undefined — correct for v1
  }
  // v2 → v3 migration: worktreePath field was added in v3
  if (obj.version === 2) {
    obj.version = 3;
  }
  // Validate critical fields
  if (
    typeof obj.active !== "boolean" ||
    typeof obj.pipeline !== "object" ||
    !Array.isArray((obj.pipeline as Record<string, unknown>)?.stages) ||
    (obj.sessionId != null && typeof obj.sessionId !== "string") ||
    typeof obj.mode !== "string"
  ) {
    return null;
  }
  return obj as unknown as RalplanState;
}

/** Read ralplan state from file */
export function readRalplanStateFile(directory: string): RalplanState | null {
  const path = resolveStatePath(directory);
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw);
    return validateRalplanState(parsed);
  } catch {
    // State file read failed (corruption, permissions, etc.) — caller handles null gracefully
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
  directory?: string,
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
  };

  if (mode === "brainstorm") {
    state.brainstorm = createBrainstormState();
    state.answersPath = directory
      ? resolveAnswersPath(directory)
      : "plans/answers.md";
  }

  return state;
}
