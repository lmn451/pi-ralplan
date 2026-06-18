import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chdir, cwd } from "node:process";
import { execSync } from "node:child_process";
import ralplanExtension from "../pi/extensions/ralplan/index.js";

function createStubPi() {
  const commands = new Map<string, any>();
  const tools = new Map<string, any>();
  const pi = {
    registerFlag() {},
    registerCommand(name: string, def: any) {
      commands.set(name, def);
    },
    registerTool(def: any) {
      tools.set(def.name, def);
    },
    appendEntry() {},
    sendMessage() {},
    sendUserMessage() {},
    on() {},
    getFlag() {
      return undefined;
    },
  };

  return { pi, commands, tools };
}

describe("ralplan extension worktree behavior", () => {
  it("writes submitted artifacts to the active worktree", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ralplan-extension-"));
    const repo = join(dir, "repo");
    mkdirSync(repo, { recursive: true });
    const prev = cwd();

    try {
      chdir(repo);
      execSync("git init -b main", { stdio: "pipe" });
      execSync("git config user.email test@example.com", { stdio: "pipe" });
      execSync("git config user.name test", { stdio: "pipe" });
      writeFileSync("README.md", "x\n", "utf-8");
      execSync("git add -f README.md && git commit -m init", {
        stdio: "pipe",
        shell: "/bin/bash",
      });

      const { pi, commands, tools } = createStubPi();
      ralplanExtension(pi as never);
      const ctx = {
        ui: {
          notify() {},
          setStatus() {},
          setWidget() {},
          theme: { fg: (_: string, text: string) => text },
        },
      };

      await commands.get("ralplan").handler("demo feature", ctx);
      const submit = tools.get("ralplan_submit_artifact");
      const result = await submit.execute(
        "id",
        { type: "spec", content: "# Spec" },
        undefined,
        undefined,
        ctx,
      );

      const { realpathSync } = await import("node:fs");
      const savedPath = realpathSync(result.details.path as string);
      const worktreePath = realpathSync(
        join(dir, "repo-worktrees", "demo-feature"),
      );
      expect(savedPath.startsWith(`${worktreePath}/`)).toBe(true);
    } finally {
      chdir(prev);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("updates UI when brainstorm starts", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ralplan-brainstorm-"));
    const repo = join(dir, "repo");
    mkdirSync(repo, { recursive: true });
    const prev = cwd();

    try {
      chdir(repo);
      execSync("git init -b main", { stdio: "pipe" });
      execSync("git config user.email test@example.com", { stdio: "pipe" });
      execSync("git config user.name test", { stdio: "pipe" });
      writeFileSync("README.md", "x\n", "utf-8");
      execSync("git add -f README.md && git commit -m init", {
        stdio: "pipe",
        shell: "/bin/bash",
      });

      const { pi, commands } = createStubPi();
      ralplanExtension(pi as never);
      let setStatusCalls = 0;
      const ctx = {
        ui: {
          notify() {},
          setStatus() {
            setStatusCalls++;
          },
          setWidget() {},
          theme: { fg: (_: string, text: string) => text },
        },
      };

      await commands.get("brainstorm").handler("demo feature", ctx);

      expect(setStatusCalls).toBeGreaterThan(0);
    } finally {
      chdir(prev);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // T-9: /ralplan:cancel must always preserve the worktree (user might want
  // to resume manually). It must NOT clean up even if autoCleanup is on.
  it("preserves the worktree on /ralplan:cancel even when autoCleanup is true", async () => {
    const { setAutoCleanup, resetAutoCleanupForTests } =
      await import("../pi/extensions/ralplan/worktree.js");
    const { existsSync } = await import("node:fs");
    setAutoCleanup(true);

    const dir = mkdtempSync(join(tmpdir(), "ralplan-cancel-preserves-"));
    const repo = join(dir, "repo");
    mkdirSync(repo, { recursive: true });
    const prev = cwd();

    try {
      chdir(repo);
      execSync("git init -b main", { stdio: "pipe" });
      execSync("git config user.email test@example.com", { stdio: "pipe" });
      execSync("git config user.name test", { stdio: "pipe" });
      writeFileSync("README.md", "x\n", "utf-8");
      execSync("git add -f README.md && git commit -m init", {
        stdio: "pipe",
        shell: "/bin/bash",
      });

      const { pi, commands } = createStubPi();
      ralplanExtension(pi as never);
      const ctx = {
        ui: {
          notify() {},
          setStatus() {},
          setWidget() {},
          theme: { fg: (_: string, text: string) => text },
          // confirm() returns true to proceed with cancel
          async confirm() {
            return true;
          },
        },
      };

      // Start a session
      await commands.get("ralplan").handler("demo feature", ctx);
      const worktreePath = join(dir, "repo-worktrees", "demo-feature");
      expect(existsSync(worktreePath)).toBe(true);

      // Cancel — worktree must survive even though autoCleanup is true
      await commands.get("ralplan:cancel").handler("", ctx);
      expect(existsSync(worktreePath)).toBe(true);
    } finally {
      chdir(prev);
      resetAutoCleanupForTests();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // T-NEW: When a follow-up consensus round launches a new RALPLAN session
  // from inside the existing worktree, createWorktreeForRalplan must REUSE
  // the current worktree instead of creating a sibling. This prevents the
  // per-round worktree accumulation seen in practice (one worktree per
  // planner/architect/critic review session, all stuck at the same commit).
  it("reuses the existing worktree when /ralplan runs from inside one", async () => {
    const { setAutoCleanup, resetAutoCleanupForTests } =
      await import("../pi/extensions/ralplan/worktree.js");
    const { existsSync, readdirSync } = await import("node:fs");
    setAutoCleanup(false); // safety: never delete the worktree under test

    const dir = mkdtempSync(join(tmpdir(), "ralplan-reuse-worktree-"));
    const repo = join(dir, "repo");
    mkdirSync(repo, { recursive: true });
    const prev = cwd();

    try {
      chdir(repo);
      execSync("git init -b main", { stdio: "pipe" });
      execSync("git config user.email test@example.com", { stdio: "pipe" });
      execSync("git config user.name test", { stdio: "pipe" });
      writeFileSync("README.md", "x\n", "utf-8");
      execSync("git add -f README.md && git commit -m init", {
        stdio: "pipe",
        shell: "/bin/bash",
      });

      // Round 1: create the original worktree via /ralplan.
      const { pi, commands } = createStubPi();
      ralplanExtension(pi as never);
      const ctx = {
        ui: {
          notify() {},
          setStatus() {},
          setWidget() {},
          theme: { fg: (_: string, text: string) => text },
        },
      };
      await commands.get("ralplan").handler("demo feature", ctx);
      const worktreesDir = join(dir, "repo-worktrees");
      const originalWorktree = join(worktreesDir, "demo-feature");
      expect(existsSync(originalWorktree)).toBe(true);
      expect(readdirSync(worktreesDir)).toEqual(["demo-feature"]);

      // Round 2: launch another /ralplan session FROM INSIDE the worktree.
      // The reuse rule must return the existing worktree instead of
      // creating "demo-feature-2" or a fresh feature branch.
      chdir(originalWorktree);
      const { pi: pi2, commands: cmds2 } = createStubPi();
      ralplanExtension(pi2 as never);
      await cmds2.get("ralplan").handler("architect review", ctx);

      // The worktree directory must NOT have grown — still one entry.
      expect(readdirSync(worktreesDir)).toEqual(["demo-feature"]);
    } finally {
      chdir(prev);
      resetAutoCleanupForTests();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
