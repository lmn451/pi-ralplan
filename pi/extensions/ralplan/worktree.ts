/**
 * Git worktree management utilities.
 */

import { execFileSync } from "child_process";
import { resolve, join } from "node:path";
import { existsSync, mkdirSync } from "node:fs";

// Default worktree settings
export const DEFAULT_BASE_BRANCH = "main";
export const DEFAULT_CREATE_BRANCH = true;
export const DEFAULT_AUTO_CLEANUP = false;

export interface WorktreeConfig {
  baseBranch: string;
  worktreeRoot: string;
  createBranch: boolean;
  autoCleanup?: boolean;
}

export interface WorktreeResult {
  success: boolean;
  path?: string;
  error?: string;
}

/** Detect the default branch of a git repository */
export function detectDefaultBranch(cwd: string): string {
  try {
    // First try: symbolic-ref for remote HEAD (works for cloned repos)
    const symbolicRef = execFileSync(
      "git",
      ["symbolic-ref", "refs/remotes/origin/HEAD", "--short"],
      { cwd, stdio: "pipe", encoding: "utf-8" },
    ).trim();
    if (symbolicRef) return symbolicRef.replace("origin/", "");
  } catch {
    // Fall through
  }

  try {
    // Second try: branch --show-current (works for local repos)
    const currentBranch = execFileSync("git", ["branch", "--show-current"], {
      cwd,
      stdio: "pipe",
      encoding: "utf-8",
    }).trim();
    if (currentBranch) return currentBranch;
  } catch {
    // Fall through
  }

  return DEFAULT_BASE_BRANCH;
}

/** Sanitize worktree name for directory traversal */
function sanitizeWorktreeName(name: string): string {
  // Block directory traversal, null bytes, and Windows-specific patterns
  // Normalize backslashes to forward slashes for cross-platform check
  const normalized = name.replace(/\\/g, "/").replace(/\0/g, "");
  if (normalized.includes("..") || name.includes("\0")) {
    throw new Error("Invalid worktree name: directory traversal detected");
  }
  // Block absolute paths and drive letters
  if (normalized.startsWith("/") || /^[a-zA-Z]:/.test(normalized)) {
    throw new Error("Invalid worktree name: absolute paths not allowed");
  }
  return normalized.replace(/[^a-zA-Z0-9_./-]/g, "-").slice(0, 50);
}

/** Validate worktree exists and is valid */
export function validateWorktree(path: string): boolean {
  try {
    const gitDir = join(path, ".git");
    return existsSync(gitDir);
  } catch {
    return false;
  }
}

export function createWorktree(
  config: WorktreeConfig,
  name: string,
): WorktreeResult {
  const maxRetries = 3;
  let lastError: string = "Unknown error";

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      // Ensure worktree root exists
      mkdirSync(config.worktreeRoot, { recursive: true });

      // Sanitize and resolve path
      const sanitizedName = sanitizeWorktreeName(name);
      const worktreePath = resolve(config.worktreeRoot, sanitizedName);

      // Check if worktree already exists
      if (existsSync(worktreePath)) {
        if (validateWorktree(worktreePath)) {
          return { success: true, path: worktreePath };
        }
        // Invalid existing worktree, treat as new
      }

      // Validate and sanitize baseBranch
      const baseBranch = config.baseBranch || DEFAULT_BASE_BRANCH;
      if (!/^[a-zA-Z0-9._\/-]+$/.test(baseBranch)) {
        throw new Error(`Invalid baseBranch: ${baseBranch}`);
      }

      // Build safe git commands using argument arrays (no shell interpolation)
      if (config.createBranch) {
        const branchName = `feature/${sanitizedName}`;
        execFileSync(
          "git",
          ["worktree", "add", "-b", branchName, worktreePath, baseBranch],
          {
            stdio: "pipe",
          },
        );
      } else {
        execFileSync("git", ["worktree", "add", worktreePath, baseBranch], {
          stdio: "pipe",
        });
      }

      // Validate created worktree
      if (!validateWorktree(worktreePath)) {
        return {
          success: false,
          error: "Worktree created but validation failed",
        };
      }

      return { success: true, path: worktreePath };
    } catch (error) {
      lastError = error instanceof Error ? error.message : "Unknown error";
      if (attempt < maxRetries - 1) {
        // Exponential backoff: 100ms, 200ms, 400ms
        const delay = 100 * Math.pow(2, attempt);
        try {
          execFileSync("sleep", [String(delay / 1000)], { stdio: "pipe" });
        } catch {
          // Ignore sleep errors
        }
      }
    }
  }

  return {
    success: false,
    error: `Failed after ${maxRetries} attempts: ${lastError}`,
  };
}

export function listWorktrees(): string[] {
  try {
    const output = execFileSync("git", ["worktree", "list", "--porcelain"], {
      encoding: "utf-8",
    });
    return output
      .split("\n\n")
      .map((entry) => {
        const pathMatch = entry.match(/^worktree\s+(.+)$/m);
        return pathMatch ? pathMatch[1].trim() : "";
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function cleanupWorktree(path: string): WorktreeResult {
  try {
    execFileSync("git", ["worktree", "remove", path], {
      stdio: "pipe",
    });
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
