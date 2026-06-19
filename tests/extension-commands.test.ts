import { describe, it, expect } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chdir, cwd } from "node:process";
import { execSync } from "node:child_process";
import ralplanExtension from "../pi/extensions/ralplan/index.js";
import { resolveStatePath } from "../pi/extensions/ralplan/utils.js";

function createStubPi() {
  const commands = new Map<string, any>();
  const tools = new Map<string, any>();
  const entries: Array<{ type: string; customType?: string; data?: unknown }> =
    [];
  let sessionBranch: typeof entries = [];
  let sessionManager = {
    getEntries: () => entries,
    getBranch: () => sessionBranch,
    addEntry: (entry: (typeof entries)[0]) => {
      entries.push(entry);
      sessionBranch.push(entry);
    },
  };
  const pi = {
    registerFlag() {},
    registerCommand(name: string, def: any) {
      commands.set(name, def);
    },
    registerTool(def: any) {
      tools.set(def.name, def);
    },
    appendEntry() {},
    sendMessage(_msg?: unknown) {},
    sendUserMessage() {},
    on() {},
    getFlag() {
      return undefined;
    },
    sessionManager,
  };

  return { pi, commands, tools };
}

function createTestRepo(dir: string): string {
  const repo = join(dir, "repo");
  mkdirSync(repo, { recursive: true });
  chdir(repo);
  execSync("git init -b main", { stdio: "pipe" });
  execSync("git config user.email test@example.com", { stdio: "pipe" });
  execSync("git config user.name test", { stdio: "pipe" });
  writeFileSync("README.md", "x\n", "utf-8");
  execSync("git add -f README.md && git commit -m init", {
    stdio: "pipe",
    shell: "/bin/bash",
  });
  return repo;
}

describe("ralplan extension command handlers", () => {
  describe("ralplan:cancel", () => {
    it("clears state and cleans up worktree when cancelled", async () => {
      const dir = mkdtempSync(join(tmpdir(), "ralplan-cancel-"));
      const prev = cwd();

      try {
        const repo = createTestRepo(dir);

        const { pi, commands } = createStubPi();
        ralplanExtension(pi as never);

        const ctx = {
          ui: {
            notify() {},
            setStatus() {},
            setWidget() {},
            theme: { fg: (_: string, text: string) => text },
            confirm: async () => true, // Always confirm cancellation
          },
        };

        // Start a ralplan session
        await commands.get("ralplan").handler("cancel test feature", ctx);

        // Get the worktree path from state
        const ralplanEntry = pi.sessionManager
          .getEntries()
          .find(
            (e: any) => e.type === "custom" && e.customType === "ralplan-state",
          );
        const worktreePath = (ralplanEntry?.data as any)?.worktreePath as
          | string
          | undefined;

        // Verify worktree was created
        if (worktreePath) {
          expect(existsSync(worktreePath)).toBe(true);
        }

        // Cancel the session
        await commands.get("ralplan:cancel").handler("", ctx);

        // State file should be cleared
        const statePath = resolveStatePath(repo);
        expect(existsSync(statePath)).toBe(false);

        // Worktree should be cleaned up
        if (worktreePath) {
          expect(existsSync(worktreePath)).toBe(false);
        }

        // No active ralplan-state entry should remain
        const activeEntry = pi.sessionManager
          .getEntries()
          .filter(
            (e: any) =>
              e.type === "custom" &&
              e.customType === "ralplan-state" &&
              e.data?.active === true,
          );
        expect(activeEntry.length).toBe(0);
      } finally {
        chdir(prev);
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("notifies when no active session to cancel", async () => {
      const dir = mkdtempSync(join(tmpdir(), "ralplan-cancel-empty-"));
      const prev = cwd();

      try {
        createTestRepo(dir);
        const { pi, commands } = createStubPi();
        ralplanExtension(pi as never);

        let notifyMessage = "";

        const ctx = {
          ui: {
            notify: (msg: string) => {
              notifyMessage = msg;
            },
            setStatus() {},
            setWidget() {},
            theme: { fg: (_: string, text: string) => text },
            confirm: async () => false,
          },
        };

        await commands.get("ralplan:cancel").handler("", ctx);

        expect(notifyMessage).toContain("No active");
      } finally {
        chdir(prev);
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe("ralplan:skip", () => {
    it("advances to next stage when skipped", async () => {
      const dir = mkdtempSync(join(tmpdir(), "ralplan-skip-"));
      const prev = cwd();

      try {
        createTestRepo(dir);
        const { pi, commands } = createStubPi();
        ralplanExtension(pi as never);

        const sentMessages: Array<{ customType: string; content: string }> = [];
        const ctx = {
          ui: {
            notify() {},
            setStatus() {},
            setWidget() {},
            theme: { fg: (_: string, text: string) => text },
          },
        };

        // Override sendMessage to capture what gets sent
        const originalSendMessage = pi.sendMessage.bind(pi);
        pi.sendMessage = (msg: any) => {
          sentMessages.push(msg);
          originalSendMessage(msg);
        };

        await commands.get("ralplan").handler("skip test feature", ctx);

        // Get initial state
        const initialEntry = pi.sessionManager
          .getEntries()
          .find(
            (e: any) => e.type === "custom" && e.customType === "ralplan-state",
          );
        const initialStageIndex = (initialEntry?.data as any)?.tracking
          ?.currentStageIndex as number;
        const initialStageCount = ((initialEntry?.data as any)?.tracking?.stages
          ?.length ?? 0) as number;

        // Skip the current stage
        await commands.get("ralplan:skip").handler("", ctx);

        // Find the updated entry (last one)
        const allEntries = pi.sessionManager.getEntries();
        const updatedEntry = [...allEntries]
          .reverse()
          .find(
            (e: any) => e.type === "custom" && e.customType === "ralplan-state",
          );
        const newStageIndex = (updatedEntry?.data as any)?.tracking
          ?.currentStageIndex as number;

        // Stage index should have advanced or pipeline complete
        if (initialStageIndex < initialStageCount - 1) {
          expect(newStageIndex).toBeGreaterThan(initialStageIndex);
        }

        // Either stage was skipped or we're at end of pipeline
        const stages = (updatedEntry?.data as any)?.tracking?.stages as Array<{
          id: string;
          status: string;
        }>;
        if (stages && newStageIndex < stages.length) {
          const skippedStage = stages.find((s) => s.status === "skipped");
          expect(skippedStage).toBeDefined();
        }
      } finally {
        chdir(prev);
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("notifies when no active session to skip", async () => {
      const dir = mkdtempSync(join(tmpdir(), "ralplan-skip-empty-"));
      const prev = cwd();

      try {
        createTestRepo(dir);
        const { pi, commands } = createStubPi();
        ralplanExtension(pi as never);

        let notifyMessage = "";

        const ctx = {
          ui: {
            notify: (msg: string) => {
              notifyMessage = msg;
            },
            setStatus() {},
            setWidget() {},
            theme: { fg: (_: string, text: string) => text },
          },
        };

        await commands.get("ralplan:skip").handler("", ctx);

        expect(notifyMessage).toContain("No active");
      } finally {
        chdir(prev);
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("clears the progress widget when /ralplan:skip completes the pipeline", async () => {
      // Regression: previously deactivateState() was called without updateUI(ctx)
      // after the skip-to-complete/failed branches, leaving the HUD widget stale.
      const dir = mkdtempSync(join(tmpdir(), "ralplan-skip-ui-"));
      const prev = cwd();

      try {
        createTestRepo(dir);
        const { pi, commands } = createStubPi();
        ralplanExtension(pi as never);

        const widgetCalls: Array<string | undefined> = [];
        const ctx = {
          ui: {
            notify() {},
            setStatus() {},
            setWidget: (_k: string, v: string | string[] | undefined) =>
              widgetCalls.push(Array.isArray(v) ? v[0] : v),
            theme: { fg: (_: string, text: string) => text },
          },
        };

        await commands.get("ralplan").handler("skip-ui test feature", ctx);
        // Default config has 4 active stages (ralplan, execution, ralph, qa);
        // skipping each one completes the pipeline.
        for (let i = 0; i < 5; i++) {
          await commands.get("ralplan:skip").handler("", ctx);
        }

        // The final setWidget call must clear the widget (undefined), matching
        // the agent_end completion path. A stale HUD would leave a non-undefined
        // string[] (the HUD lines) here.
        const last = widgetCalls[widgetCalls.length - 1];
        expect(last).toBeUndefined();
      } finally {
        chdir(prev);
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe("ralplan:status", () => {
    it("returns valid status info when session is active", async () => {
      const dir = mkdtempSync(join(tmpdir(), "ralplan-status-"));
      const prev = cwd();

      try {
        createTestRepo(dir);
        const { pi, commands } = createStubPi();
        ralplanExtension(pi as never);

        let statusMessages: string[] = [];
        const ctx = {
          ui: {
            notify: (msg: string) => {
              statusMessages.push(msg);
            },
            setStatus() {},
            setWidget() {},
            theme: { fg: (_: string, text: string) => text },
          },
        };

        // Start a session first
        await commands.get("ralplan").handler("status test feature", ctx);

        // Clear messages from start
        statusMessages = [];

        // Call status
        await commands.get("ralplan:status").handler("", ctx);

        // Should have exactly one status message
        expect(statusMessages.length).toBe(1);
        const notifyMessage = statusMessages[0];

        // Verify status message contains expected info
        expect(notifyMessage).toContain("RALPLAN Status");
        expect(notifyMessage).toContain("Progress:");
        // Should contain HUD lines which show stage status (e.g. [>>], [OK], [..], [--])
        expect(notifyMessage).toMatch(/\[.{2,3}\]\s+\w+/);
      } finally {
        chdir(prev);
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("notifies when no active session for status", async () => {
      const dir = mkdtempSync(join(tmpdir(), "ralplan-status-empty-"));
      const prev = cwd();

      try {
        createTestRepo(dir);
        const { pi, commands } = createStubPi();
        ralplanExtension(pi as never);

        let notifyMessage = "";

        const ctx = {
          ui: {
            notify: (msg: string) => {
              notifyMessage = msg;
            },
            setStatus() {},
            setWidget() {},
            theme: { fg: (_: string, text: string) => text },
          },
        };

        await commands.get("ralplan:status").handler("", ctx);

        expect(notifyMessage).toContain("No active");
      } finally {
        chdir(prev);
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("shows brainstorm mode info when in brainstorm", async () => {
      const dir = mkdtempSync(join(tmpdir(), "ralplan-status-brainstorm-"));
      const prev = cwd();

      try {
        createTestRepo(dir);
        const { pi, commands } = createStubPi();
        ralplanExtension(pi as never);

        let statusMessages: string[] = [];
        const ctx = {
          ui: {
            notify: (msg: string) => {
              statusMessages.push(msg);
            },
            setStatus() {},
            setWidget() {},
            theme: { fg: (_: string, text: string) => text },
          },
        };

        // Start a brainstorm session
        await commands
          .get("brainstorm")
          .handler("brainstorm test feature", ctx);

        // Clear messages from start
        statusMessages = [];

        // Call status
        await commands.get("ralplan:status").handler("", ctx);

        // Should have exactly one status message
        expect(statusMessages.length).toBe(1);
        const notifyMessage = statusMessages[0];

        // Verify status message shows brainstorm mode
        expect(notifyMessage).toContain("RALPLAN Status");
        expect(notifyMessage).toContain("Brainstorm");
      } finally {
        chdir(prev);
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe("ralplan_set_config tool", () => {
    it("preserves a custom verification maxIterations when re-enabling verification", async () => {
      // Regression: previously, calling set_config with verification: "ralph"
      // hardcoded maxIterations: 100, discarding any prior custom value.
      const dir = mkdtempSync(join(tmpdir(), "ralplan-setconfig-"));
      const prev = cwd();

      try {
        createTestRepo(dir);
        const { pi, commands, tools } = createStubPi();
        ralplanExtension(pi as never);

        // Override appendEntry to capture persisted state — the shared stub
        // leaves it as a no-op, but we need to seed a custom maxIterations
        // between two set_config calls to exercise the re-enable path.
        const persisted: any[] = [];
        pi.appendEntry = ((_type: string, data: unknown) => {
          persisted.push(data);
        }) as typeof pi.appendEntry;

        const ctx = {
          ui: {
            notify() {},
            setStatus() {},
            setWidget() {},
            theme: { fg: (_: string, text: string) => text },
          },
        };

        await commands.get("ralplan").handler("setconfig test feature", ctx);
        const setConfig = tools.get("ralplan_set_config");
        expect(setConfig).toBeDefined();

        // Step 1: disable verification.
        await setConfig.execute(
          "call-1",
          { verification: "skip" },
          new AbortController().signal,
          () => {},
          ctx,
        );

        // Step 2: seed a custom maxIterations on the live persisted config.
        // The extension reads prevMax from config.verification, so mutating
        // the most recent persisted entry seeds the closure's live config.
        const latest = persisted[persisted.length - 1];
        latest.tracking.pipelineConfig.verification = {
          engine: "ralph",
          maxIterations: 42,
        };

        // Step 3: re-enable verification — should inherit 42.
        const result = await setConfig.execute(
          "call-2",
          { verification: "ralph" },
          new AbortController().signal,
          () => {},
          ctx,
        );

        const verification = (result.details as any)?.config?.verification;
        expect(verification).toEqual({ engine: "ralph", maxIterations: 42 });
      } finally {
        chdir(prev);
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });
});
