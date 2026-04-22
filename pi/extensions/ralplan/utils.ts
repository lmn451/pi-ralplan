import { mkdirSync } from "node:fs";
import { join } from "node:path";

/** Ensure the ralplan directory exists */
export function ensureRalplanDir(directory: string): string {
  const dir = join(directory, ".pi", "ralplan", "plans");
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Resolve the ralplan plans directory */
export function resolvePlansDir(directory: string): string {
  return join(directory, ".pi", "ralplan", "plans");
}

/** Resolve the ralplan state file path */
export function resolveStatePath(directory: string): string {
  return join(directory, ".pi", "ralplan", "state.json");
}

/** Resolve the open questions file path */
export function resolveOpenQuestionsPath(directory: string): string {
  return join(directory, ".pi", "ralplan", "plans", "open-questions.md");
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
