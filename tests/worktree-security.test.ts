import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chdir, cwd } from "node:process";
import { execSync } from "node:child_process";
import { createWorktree } from "../pi/extensions/ralplan/worktree.js";

describe("worktree security", () => {
  it("rejects shell metacharacters in baseBranch without executing them", () => {
    const dir = mkdtempSync(join(tmpdir(), "ralplan-inject-"));
    const repo = join(dir, "repo");
    const worktrees = join(dir, "worktrees");
    const marker = join(dir, "marker.txt");
    mkdirSync(repo, { recursive: true });
    const prev = cwd();

    try {
      chdir(repo);
      execSync("git init -b main", { stdio: "pipe" });
      execSync("git config user.email test@example.com", { stdio: "pipe" });
      execSync("git config user.name test", { stdio: "pipe" });
      writeFileSync("README.md", "x\n", "utf-8");
      execSync("git add README.md && git commit -m init", { stdio: "pipe", shell: "/bin/bash" });

      const result = createWorktree(
        {
          baseBranch: `main; touch "${marker}"`,
          worktreeRoot: worktrees,
          createBranch: false,
        },
        "demo",
      );

      expect(result.success).toBe(false);
      expect(existsSync(marker)).toBe(false);
    } finally {
      chdir(prev);
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
