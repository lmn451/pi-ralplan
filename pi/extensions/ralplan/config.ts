/**
 * RALPLAN Configuration
 * 
 * This file provides default configuration for worktree and naming behavior.
 * Users can override by creating a `ralplan.config.js` in their project root.
 */

export interface WorktreeConfig {
  /** Base branch for creating worktrees (default: "main") */
  baseBranch: string;
  /** Root directory for worktrees (default: "./worktrees") */
  worktreeRoot: string;
  /** Whether to create a new branch for the worktree (default: true) */
  createBranch: boolean;
  /** Whether to auto-cleanup worktree on plan cancellation (default: false) */
  autoCleanup: boolean;
}

export interface NamingConfig {
  /** Date format for filenames (default: "YYYY-MM-DD") */
  dateFormat: string;
}

export interface RalplanConfig {
  worktree: WorktreeConfig;
  naming: NamingConfig;
}

export const DEFAULT_CONFIG: RalplanConfig = {
  worktree: {
    baseBranch: "main",
    worktreeRoot: "./worktrees",
    createBranch: true,
    autoCleanup: false,
  },
  naming: {
    dateFormat: "YYYY-MM-DD",
  },
};

/** Merge user config with defaults */
export function mergeConfig(userConfig: Partial<RalplanConfig>): RalplanConfig {
  return {
    worktree: {
      ...DEFAULT_CONFIG.worktree,
      ...userConfig.worktree,
    },
    naming: {
      ...DEFAULT_CONFIG.naming,
      ...userConfig.naming,
    },
  };
}

/** Load config from file (if exists) */
export async function loadConfig(cwd: string): Promise<RalplanConfig> {
  try {
    const { existsSync, readFileSync } = await import("node:fs");
    const configPath = `${cwd}/ralplan.config.js`;
    
    if (existsSync(configPath)) {
      const content = readFileSync(configPath, "utf-8");
      // Simple eval for JS config file - in production use proper import
      const userConfig = eval(`(function() { return (${content}); })()`);
      return mergeConfig(userConfig);
    }
  } catch {
    // Ignore errors, use defaults
  }
  
  return DEFAULT_CONFIG;
}