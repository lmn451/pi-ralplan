import { describe, it, expect } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  realpathSync,
  existsSync,
  readdirSync,
} from "node:fs";
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

  // AC-8: if persistState throws after worktree creation, the worktree
  // directory must be removed to avoid an orphan on disk.
  it("removes the worktree when persistState throws after creation", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ralplan-persist-fail-"));
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

      const pi = {
        registerFlag() {},
        registerCommand() {},
        registerTool() {},
        // Simulate a persistState failure: appendEntry is the only call
        // persistState makes into the host. Throwing here forces the
        // AC-8 cleanup path.
        appendEntry() {
          throw new Error("simulated persistState failure");
        },
        sendMessage() {},
        sendUserMessage() {},
        on() {},
        getFlag() {
          return undefined;
        },
      };

      ralplanExtension(pi as never);
      const ctx = {
        ui: {
          notify() {},
          setStatus() {},
          setWidget() {},
          theme: { fg: (_: string, text: string) => text },
        },
      };

      // Use a side command (ralplan) to trigger startPipelineSession.
      // The handler isn't exposed by our stub here; instead, exercise
      // the leak-window by calling the worktree path directly via
      // an injected appendEntry failure. The pi.on('input') event fires
      // synchronously during extension registration, but the persistState
      // call is in startPipelineSession which is called from a command
      // handler. So we trigger via a directly-registered command by
      // re-running extension registration with the failing pi.
      //
      // Simpler: invoke the leak-window directly. We've added a try/catch
      // around persistState in startPipelineSession. We can't easily
      // reach that without a full handler, so we verify the contract via
      // a focused unit test on cleanupWorktree + the manual code path.
      //
      // Instead, let's directly verify the cleanup runs by checking
      // that after a failed start, no worktree directory exists.
      // Since our stub doesn't return the command handler, we re-
      // register the extension with a stub that captures the handler.
      const captured: { handler?: any } = {};
      const pi2 = {
        ...pi,
        registerCommand(name: string, def: any) {
          if (name === "ralplan") captured.handler = def.handler;
        },
        appendEntry() {
          throw new Error("simulated persistState failure");
        },
      };
      ralplanExtension(pi2 as never);

      await expect(captured.handler("orphan test", ctx)).rejects.toThrow(
        "simulated persistState failure",
      );

      // The worktree directory must NOT exist on disk after the failure.
      const worktreeParent = join(dir, "repo-worktrees");
      const worktreeDir = join(worktreeParent, "orphan-test");
      expect(existsSync(worktreeDir)).toBe(false);
      // And the parent worktree-root should also be empty (no leaked dirs).
      if (existsSync(worktreeParent)) {
        const remaining = readdirSync(worktreeParent);
        expect(remaining).toEqual([]);
      }
    } finally {
      chdir(prev);
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
