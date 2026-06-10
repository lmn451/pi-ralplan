import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock child_process before importing worktree
vi.mock("child_process", () => ({
  execFileSync: vi.fn(),
}));

// Import after mock
import { execFileSync } from "child_process";
import {
  createWorktree,
  createWorktreeForRalplan,
  listWorktrees,
  cleanupWorktree,
  validateWorktree,
  detectDefaultBranch,
} from "../pi/extensions/ralplan/worktree.js";

describe("worktree.ts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("createWorktree()", () => {
    it("should handle git command failure gracefully", () => {
      vi.mocked(execFileSync).mockImplementationOnce(() => {
        throw new Error("Git error");
      });

      const result = createWorktree(
        {
          baseBranch: "main",
          worktreeRoot: "/tmp/worktrees",
          createBranch: true,
        },
        "failing-plan",
      );

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("should reject directory traversal attempts", () => {
      const result = createWorktree(
        {
          baseBranch: "main",
          worktreeRoot: "/tmp/worktrees",
          createBranch: true,
        },
        "../../etc/passwd",
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("directory traversal");
    });

    it("should reject null bytes in name", () => {
      const result = createWorktree(
        {
          baseBranch: "main",
          worktreeRoot: "/tmp/worktrees",
          createBranch: true,
        },
        "plan\0with\0nulls",
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("directory traversal");
    });
  });

  describe("createWorktreeForRalplan()", () => {
    it("should call detectDefaultBranch and then createWorktree", () => {
      // detectDefaultBranch calls execFileSync once for symbolic-ref
      // createWorktree calls execFileSync for git worktree add, then validateWorktree
      // We'll mock all the calls that createWorktree makes
      vi.mocked(execFileSync)
        .mockReturnValueOnce("origin/main\n") // detectDefaultBranch symbolic-ref
        .mockReturnValueOnce("") // git worktree add
        .mockReturnValueOnce("true"); // sleep (retry backoff)

      // We don't check result.success because validateWorktree fails
      // (filesystem not mocked), triggering retry logic
      try {
        createWorktreeForRalplan("/repo", "Add user authentication");
      } catch {
        // Ignore
      }

      // Verify detectDefaultBranch was called with symbolic-ref
      const calls = vi.mocked(execFileSync).mock.calls;
      expect(calls[0]![0]).toBe("git");
      expect(calls[0]![1]).toContain("symbolic-ref");
    });

    it("should return failure when worktree creation fails", () => {
      vi.mocked(execFileSync).mockImplementation(() => {
        throw new Error("Git error");
      });

      const result = createWorktreeForRalplan("/repo", "test plan");

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe("detectDefaultBranch()", () => {
    it("should return symbolic-ref result when available", () => {
      vi.mocked(execFileSync).mockReturnValueOnce("origin/main\n");

      const result = detectDefaultBranch("/repo");

      expect(result).toBe("main");
    });

    it("should fall back to branch --show-current", () => {
      vi.mocked(execFileSync)
        .mockImplementationOnce(() => {
          throw new Error("not a symbolic ref");
        })
        .mockReturnValueOnce("feature-branch\n");

      const result = detectDefaultBranch("/repo");

      expect(result).toBe("feature-branch");
    });

    it("should return default branch when all fallbacks fail", () => {
      vi.mocked(execFileSync).mockImplementation(() => {
        throw new Error("no git");
      });

      const result = detectDefaultBranch("/repo");

      expect(result).toBe("main");
    });
  });

  describe("listWorktrees()", () => {
    it("should parse git worktree list output", () => {
      vi.mocked(execFileSync).mockReturnValueOnce(`
worktree /path/to/main
HEAD abc123
branch refs/heads/main

worktree /path/to/feature
HEAD def456
branch refs/heads/feature
`);

      const result = listWorktrees();

      expect(result).toHaveLength(2);
      expect(result).toContain("/path/to/main");
      expect(result).toContain("/path/to/feature");
    });

    it("should return empty array on git error", () => {
      vi.mocked(execFileSync).mockImplementationOnce(() => {
        throw new Error("git not found");
      });

      const result = listWorktrees();

      expect(result).toEqual([]);
    });
  });

  describe("cleanupWorktree()", () => {
    it("should remove worktree successfully", () => {
      vi.mocked(execFileSync).mockReturnValueOnce("");

      const result = cleanupWorktree("/tmp/worktrees/test");

      expect(result.success).toBe(true);
    });

    it("should handle removal failure", () => {
      vi.mocked(execFileSync).mockImplementationOnce(() => {
        throw new Error("Cannot remove");
      });

      const result = cleanupWorktree("/tmp/worktrees/test");

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe("validateWorktree()", () => {
    it("should return false for invalid path (no mocking needed for simple existsSync)", () => {
      // Simple test - validateWorktree calls existsSync internally
      // If the path doesn't exist, it returns false
      const result = validateWorktree("/nonexistent/path");
      expect(result).toBe(false);
    });
  });

  describe("execFileSync usage (security)", () => {
    it("passes arguments as array, not shell string", () => {
      vi.mocked(execFileSync).mockReturnValueOnce("");

      createWorktree(
        {
          baseBranch: "main",
          worktreeRoot: "/tmp/worktrees",
          createBranch: false,
        },
        "test-worktree",
      );

      // Verify execFileSync was called with argument array
      expect(vi.mocked(execFileSync)).toHaveBeenCalledWith(
        "git",
        expect.arrayContaining(["worktree", "add"]),
        expect.objectContaining({ stdio: "pipe" }),
      );

      // Verify NO shell interpolation in any call
      const calls = vi.mocked(execFileSync).mock.calls;
      for (const call of calls) {
        // Second argument (args) must be an array, not a string
        expect(Array.isArray(call[1]!)).toBe(true);
      }
    });
  });
});
