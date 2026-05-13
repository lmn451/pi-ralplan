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
  autoCleanup?: boolean;  // Optional for backward compatibility
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

/** Safely extract string value for a given key from config content */
function extractStringValue(content: string, key: string): string | undefined {
  const regex = new RegExp(`${key}\\s*:\\s*"([^"]*)"`);
  const match = content.match(regex);
  return match ? match[1] : undefined;
}

/** Safely extract boolean value */
function extractBooleanValue(content: string, key: string): boolean | undefined {
  const regex = new RegExp(`${key}\\s*:\\s*(true|false)`);
  const match = content.match(regex);
  return match ? match[1] === 'true' : undefined;
}

/** Safe config parser - extracts worktree and naming without eval */
export function parseConfig(content: string): { worktree: WorktreeConfig; naming: NamingConfig } | undefined {
  // Block dangerous patterns
  if (/\bfunction\b|\beval\b|\bexec\b|\bawait\b|\bnew\b|\bprototype\b|\bclass\b/i.test(content)) {
    return undefined;
  }
  
  const baseBranch = extractStringValue(content, 'baseBranch');
  const worktreeRoot = extractStringValue(content, 'worktreeRoot');
  const createBranch = extractBooleanValue(content, 'createBranch');
  const autoCleanup = extractBooleanValue(content, 'autoCleanup');
  const dateFormat = extractStringValue(content, 'dateFormat');
  
  const worktree: WorktreeConfig = { ...DEFAULT_CONFIG.worktree };
  const naming: NamingConfig = { ...DEFAULT_CONFIG.naming };
  
  let changed = false;
  
  if (baseBranch !== undefined) { worktree.baseBranch = baseBranch; changed = true; }
  if (worktreeRoot !== undefined) { worktree.worktreeRoot = worktreeRoot; changed = true; }
  if (createBranch !== undefined) { worktree.createBranch = createBranch; changed = true; }
  if (autoCleanup !== undefined) { worktree.autoCleanup = autoCleanup; changed = true; }
  if (dateFormat !== undefined) { naming.dateFormat = dateFormat; changed = true; }
  
  return changed ? { worktree, naming } : undefined;
}

/** Load config from file (if exists) */
export async function loadConfig(cwd: string): Promise<RalplanConfig> {
  try {
    const { existsSync, readFileSync } = await import("node:fs");
    const configPath = `${cwd}/ralplan.config.js`;
    
    if (existsSync(configPath)) {
      const content = readFileSync(configPath, "utf-8");
      const userConfig = parseConfig(content);
      if (userConfig) return mergeConfig(userConfig);
    }
  } catch {
    // Ignore errors, use defaults
  }
  
  return DEFAULT_CONFIG;
}
