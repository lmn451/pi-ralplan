import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { validateWorktree } from "./worktree.js";
import {
  writeFileSync,
  mkdirSync,
  rmdirSync,
  unlinkSync,
  existsSync,
  statSync,
  lstatSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

describe("validateWorktree", () => {
  function createTestDir() {
    return join(tmpdir(), `worktree-test-${randomUUID()}`);
  }

  function cleanup(path: string) {
    const gitPath = join(path, ".git");
    try {
      if (existsSync(gitPath)) {
        const stats = lstatSync(gitPath);
        if (stats.isDirectory()) {
          rmdirSync(gitPath, { recursive: true });
        } else {
          unlinkSync(gitPath);
        }
      }
    } catch {
      // Ignore
    }
    try {
      rmdirSync(path, { recursive: true });
    } catch {
      // Ignore
    }
  }

  it("should return true for valid worktree with .git directory", () => {
    const testDir = createTestDir();
    mkdirSync(testDir, { recursive: true });
    const gitDir = join(testDir, ".git");
    mkdirSync(gitDir);
    writeFileSync(join(gitDir, "HEAD"), "ref: refs/heads/main\n");

    try {
      expect(validateWorktree(testDir)).toBe(true);
    } finally {
      cleanup(testDir);
    }
  });

  it("should return true for worktree with .git file containing gitdir: reference to existing directory", () => {
    const testDir = createTestDir();
    mkdirSync(testDir, { recursive: true });
    const gitPath = join(testDir, ".git");
    const realGitDir = join(testDir, ".git-real");
    mkdirSync(realGitDir);
    writeFileSync(join(realGitDir, "HEAD"), "ref: refs/heads/main\n");
    writeFileSync(gitPath, `gitdir: ${realGitDir}\n`);

    try {
      expect(validateWorktree(testDir)).toBe(true);
    } finally {
      cleanup(testDir);
    }
  });

  it("should return true for worktree with .git file containing relative gitdir: reference", () => {
    const testDir = createTestDir();
    mkdirSync(testDir, { recursive: true });
    const gitPath = join(testDir, ".git");
    const realGitDir = join(testDir, ".real-git");
    mkdirSync(realGitDir);
    writeFileSync(join(realGitDir, "HEAD"), "ref: refs/heads/main\n");
    writeFileSync(gitPath, `gitdir: .real-git\n`);

    try {
      expect(validateWorktree(testDir)).toBe(true);
    } finally {
      cleanup(testDir);
    }
  });

  it("should return false for worktree with .git file containing gitdir: reference to non-existent directory", () => {
    const testDir = createTestDir();
    mkdirSync(testDir, { recursive: true });
    const gitPath = join(testDir, ".git");
    writeFileSync(gitPath, `gitdir: /non/existent/path\n`);

    try {
      expect(validateWorktree(testDir)).toBe(false);
    } finally {
      cleanup(testDir);
    }
  });

  it("should return false for non-existent path", () => {
    const testDir = createTestDir();
    // Don't create testDir, just use a path that doesn't exist
    expect(validateWorktree(join(testDir, "non-existent"))).toBe(false);
  });

  it("should return false for path without .git", () => {
    const testDir = createTestDir();
    mkdirSync(testDir, { recursive: true });

    try {
      expect(validateWorktree(testDir)).toBe(false);
    } finally {
      cleanup(testDir);
    }
  });
});

describe("parseWorktreeEntry (gitdir: handling)", () => {
  it("should parse standard worktree entry without gitdir", () => {
    const entry = `worktree /path/to/worktree
HEAD abc123
branch refs/heads/main
`;
    const pathMatch = entry.match(/^worktree\s+(.+)$/m);
    expect(pathMatch?.[1]?.trim()).toBe("/path/to/worktree");
  });

  it("should parse worktree entry with absolute gitdir reference", () => {
    const entry = `worktree /path/to/worktree
gitdir /absolute/path/to/.git
HEAD abc123
`;
    const pathMatch = entry.match(/^worktree\s+(.+)$/m);
    const gitdirMatch = entry.match(/^gitdir\s+(.+)$/m);

    expect(pathMatch?.[1]?.trim()).toBe("/path/to/worktree");
    expect(gitdirMatch?.[1]?.trim()).toBe("/absolute/path/to/.git");
  });

  it("should parse worktree entry with relative gitdir reference", () => {
    const entry = `worktree /path/to/worktree
gitdir ../common/.git
HEAD abc123
`;
    const pathMatch = entry.match(/^worktree\s+(.+)$/m);
    const gitdirMatch = entry.match(/^gitdir\s+(.+)$/m);

    expect(pathMatch?.[1]?.trim()).toBe("/path/to/worktree");
    expect(gitdirMatch?.[1]?.trim()).toBe("../common/.git");
  });
});
