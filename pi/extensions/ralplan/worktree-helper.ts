/**
 * Worktree creation helper.
 *
 * Consolidates the 3× worktree-creation blocks that previously lived in
 * `index.ts` (T-6 in plans/spec-2026-06-01-v2.md). The helper does the
 * worktree creation and user notification; the caller still sets
 * `state.worktreePath` and persists.
 *
 * Returns the worktree result so the caller can attach the path to state.
 */
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { createWorktreeForRalplan } from "./worktree.js";

export interface WorktreeAttachResult {
  ok: boolean;
  path?: string;
  error?: string;
}

/**
 * Create a worktree for a RALPLAN/brainstorm session and notify the user.
 *
 * Guards against double-creation in `executionAdapter.onEnter` (the adapter
 * checks `context.worktreePath` and skips if already set). Notifies the user
 * via `ctx.ui.notify` on success (info) or failure (warning).
 *
 * The caller is responsible for:
 * - Setting `state.worktreePath = result.path` on success
 * - Calling `persistState()` and `updateUI(ctx)`
 */
export function createAndAttachWorktree(
  ctx: ExtensionContext,
  sessionCwd: string,
  idea: string,
): WorktreeAttachResult {
  const worktreeResult = createWorktreeForRalplan(sessionCwd, idea);
  if (worktreeResult.success && worktreeResult.path) {
    ctx.ui.notify(`Worktree created: ${worktreeResult.path}`, "info");
    return { ok: true, path: worktreeResult.path };
  }
  ctx.ui.notify(
    `Worktree creation failed: ${worktreeResult.error}`,
    "warning",
  );
  return { ok: false, error: worktreeResult.error };
}
