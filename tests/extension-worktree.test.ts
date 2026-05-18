import { describe, it, expect } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  realpathSync,
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
      execSync("git add README.md && git commit -m init", {
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
      execSync("git add README.md && git commit -m init", {
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
});
