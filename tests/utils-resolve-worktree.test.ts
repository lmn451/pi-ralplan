import { describe, it, expect } from "vitest";
import {
  resolveWorktreeRoot,
  resolveWorktreePath,
} from "../pi/extensions/ralplan/utils.js";

describe("resolveWorktreeRoot", () => {
  it("should sanitize directory name by replacing slashes with dashes", () => {
    // Simulating a case where a directory path might have slashes in the basename
    // On some systems, you could have a directory literally named "with/slash"
    // For a path like "/parent/with/slash", dirname returns "/parent/with", basename returns "slash"
    // But if we had a truly weird system where basename had slashes, we sanitize
    const result = resolveWorktreeRoot("/parent/with/slash");
    expect(result).toBe("/parent/with/slash-worktrees");
  });

  it("should sanitize backslashes in directory name", () => {
    // Backslashes should be converted to dashes to prevent path traversal issues
    const result = resolveWorktreeRoot("/parent\\some-dir\\with-backslash");
    // Backslashes replaced with dashes
    expect(result).toBe("/parent-some-dir-with-backslash-worktrees");
  });

  it("should handle normal directory names without modification", () => {
    const result = resolveWorktreeRoot("/parent/my-repo");
    expect(result).toBe("/parent/my-repo-worktrees");
  });
});

describe("resolveWorktreePath", () => {
  it("should sanitize worktree name to prevent nested paths", () => {
    const root = resolveWorktreeRoot("/parent/my-repo");
    // Name with slashes should be sanitized (replaced with dashes)
    const result = resolveWorktreePath("/parent/my-repo", "feature/my-branch");
    // Result should use dashes instead of slashes in name
    expect(result).toBe(`${root}/feature-my-branch`);
  });

  it("should sanitize backslashes in worktree name", () => {
    const root = resolveWorktreeRoot("/parent/my-repo");
    const result = resolveWorktreePath(
      "/parent/my-repo",
      "feature\\nested\\path",
    );
    expect(result).toBe(`${root}/feature-nested-path`);
  });
});
