/**
 * Git worktree management utilities.
 */

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

/** Sanitize worktree name for directory traversal */
function sanitizeWorktreeName(name: string): string {
  // Block directory traversal and null bytes
  if (name.includes("..") || name.includes("\0")) {
    throw new Error("Invalid worktree name: directory traversal detected");
  }
  return name.replace(/[^a-zA-Z0-9-_]/g, "-").slice(0, 50);
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

import { execSync } from "child_process";
import { resolve, join } from "node:path";
import { existsSync, mkdirSync } from "node:fs";

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

      // Validate and sanitize baseBranch - prevents command injection
      const baseBranch = config.baseBranch || DEFAULT_BASE_BRANCH;
      if (!/^[a-zA-Z0-9._\/-]+$/.test(baseBranch)) {
        throw new Error(`Invalid baseBranch: ${baseBranch}`);
      }

      // Build safe git commands with properly quoted arguments
      if (config.createBranch) {
        const branchName = `feature/${sanitizedName}`;
        execSync(
          `git worktree add -b "${branchName}" "${worktreePath}" "${baseBranch}"`,
          { stdio: "pipe", shell: "/bin/bash" },
        );
      } else {
        execSync(`git worktree add "${worktreePath}" "${baseBranch}"`, {
          stdio: "pipe",
          shell: "/bin/bash",
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
          execSync(`sleep ${delay / 1000}`, { stdio: "pipe" });
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
    const output = execSync("git worktree list --porcelain", {
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
    execSync(`git worktree remove "${path}"`, {
      stdio: "pipe",
      shell: "/bin/bash",
    });
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
