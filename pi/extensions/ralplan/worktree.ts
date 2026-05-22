/**
 * Git worktree management utilities.
 */

import { execFileSync } from "child_process";
import { resolve, join } from "node:path";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname } from "node:path";

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
    try {
      const stats = statSync(gitDir);
      if (stats.isDirectory()) {
        return true;
      }
      // It's a file - read and check for gitdir: reference
      const content = readFileSync(gitDir, "utf-8");
      const match = content.match(/^gitdir:\s*(.+)$/m);
      if (match) {
        const gitdirPath = match[1].trim();
        // Resolve relative paths from the .git file's directory
        const resolvedGitdir = resolve(dirname(gitDir), gitdirPath);
        return existsSync(resolvedGitdir);
      }
    } catch {
      // statSync or readFileSync failed - not a valid worktree
    }
    return false;
  } catch {
    return false;
  }
}

function generateUniqueWorktreePath(basePath: string): string {
  let path = basePath;
  let suffix = 2;
  while (existsSync(path)) {
    path = `${basePath}-${suffix}`;
    suffix++;
  }
  return path;
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

      // Sanitize and resolve path with unique suffix for collision handling
      const sanitizedName = sanitizeWorktreeName(name);
      const baseWorktreePath = resolve(config.worktreeRoot, sanitizedName);
      // Generate unique path if collision exists
      let worktreePath = generateUniqueWorktreePath(baseWorktreePath);
      const uniqueSuffix =
        worktreePath !== baseWorktreePath ? `-${Date.now().toString(36)}` : "";

      // Check if worktree already exists
      if (existsSync(worktreePath)) {
        if (validateWorktree(worktreePath)) {
          return { success: true, path: worktreePath };
        }
        // Invalid existing worktree, treat as new
      }

      // Validate and sanitize baseBranch
      // Note: / is allowed for branch paths like feature/my-branch
      const baseBranch = config.baseBranch || DEFAULT_BASE_BRANCH;
      const baseBranchPattern = /^[a-zA-Z0-9._-]+(\/[a-zA-Z0-9._-]+)*$/;
      if (!baseBranchPattern.test(baseBranch)) {
        throw new Error(`Invalid baseBranch: ${baseBranch}`);
      }

      // Build safe git commands using argument arrays (no shell interpolation)
      if (config.createBranch) {
        const branchName = `feature/${sanitizedName}${uniqueSuffix}`;
        execFileSync(
          "git",
          ["worktree", "add", "-b", branchName, worktreePath, baseBranch],
          {
            stdio: "pipe",
            timeout: 30000,
          },
        );
      } else {
        execFileSync("git", ["worktree", "add", worktreePath, baseBranch], {
          stdio: "pipe",
          timeout: 30000,
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

function parseWorktreeEntry(entry: string): string {
  const pathMatch = entry.match(/^worktree\s+(.+)$/m);
  if (!pathMatch) return "";
  let worktreePath = pathMatch[1].trim();
  // Check if there's a gitdir reference pointing to a different location
  const gitdirMatch = entry.match(/^gitdir\s+(.+)$/m);
  if (gitdirMatch) {
    const gitdirPath = gitdirMatch[1].trim();
    // If gitdir is relative, resolve it relative to the worktree path
    if (!resolve(gitdirPath).startsWith(resolve(worktreePath))) {
      // The gitdir is in a different location, resolve it
      worktreePath = resolve(worktreePath, gitdirPath);
    }
  }
  return worktreePath;
}

export function listWorktrees(): string[] {
  try {
    const output = execFileSync("git", ["worktree", "list", "--porcelain"], {
      encoding: "utf-8",
      timeout: 30000,
    });
    return output.split("\n\n").map(parseWorktreeEntry).filter(Boolean);
  } catch {
    return [];
  }
}

export function cleanupWorktree(path: string): WorktreeResult {
  try {
    execFileSync("git", ["worktree", "remove", path], {
      stdio: "pipe",
      timeout: 30000,
    });
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
