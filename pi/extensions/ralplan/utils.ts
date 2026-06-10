import { mkdirSync } from "node:fs";
import { join, dirname, basename } from "node:path";

/** Ensure the plans directory exists */
export function ensureRalplanDir(directory: string): string {
  const dir = join(directory, "plans");
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Resolve the plans directory */
export function resolvePlansDir(directory: string): string {
  return join(directory, "plans");
}

/** Resolve the answers file path */
export function resolveAnswersPath(directory: string): string {
  return join(directory, "plans", "answers.md");
}

/** Resolve the ralplan state file path */
export function resolveStatePath(directory: string): string {
  return join(directory, ".pi", "ralplan", "state.json");
}

/** Resolve the open questions file path */
export function resolveOpenQuestionsPath(directory: string): string {
  return join(directory, "plans", "open-questions.md");
}

/** Resolve the worktree root directory (sibling to repo, not inside) */
export function resolveWorktreeRoot(directory: string): string {
  const parent = dirname(directory);
  // Sanitize name to prevent nested worktree roots (e.g., if directory has / in name)
  const name = basename(directory).replace(/[\/\\]/g, "-");
  return join(parent, `${name}-worktrees`);
}

/** Resolve a specific worktree path */
export function resolveWorktreePath(directory: string, name: string): string {
  // Sanitize name to prevent nested worktree roots
  const sanitizedName = name.replace(/[\/\\]/g, "-");
  return join(resolveWorktreeRoot(directory), sanitizedName);
}

/** Escape special characters for embedding in prompts */
export function escapeForPrompt(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/`/g, "\\`")
    .replace(/\$/g, "\\$");
}

/** Get current ISO timestamp */
export function nowISO(): string {
  return new Date().toISOString();
}

/**
 * Derive a filesystem-safe worktree name from an idea string.
 * Single source of truth — used by both the prompt section (adapters.ts) and
 * the actual on-disk creation (worktree.ts).
 */
export function deriveWorktreeName(idea: string): string {
  const sanitized = idea
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return sanitized || "plan";
}
