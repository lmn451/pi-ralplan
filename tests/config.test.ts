import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../pi/extensions/ralplan/config.js";

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "ralplan-config-test-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("loadConfig", () => {
  it("reads a standard CommonJS module.exports config override", async () => {
    writeFileSync(
      join(tempDir, "ralplan.config.js"),
      `module.exports = { worktree: { baseBranch: "develop" } };\n`,
      "utf-8",
    );

    const config = await loadConfig(tempDir);
    expect(config.worktree.baseBranch).toBe("develop");
  });

  it("reads an ESM default export config override", async () => {
    writeFileSync(
      join(tempDir, "ralplan.config.js"),
      `export default { worktree: { baseBranch: "feature" } };\n`,
      "utf-8",
    );

    const config = await loadConfig(tempDir);
    expect(config.worktree.baseBranch).toBe("feature");
  });

  it("falls back to defaults when no config file exists", async () => {
    const config = await loadConfig(tempDir);
    expect(config.worktree.baseBranch).toBe("main");
    expect(config.worktree.worktreeRoot).toBe("./worktrees");
  });

  it("does not execute arbitrary code from config file", async () => {
    writeFileSync(
      join(tempDir, "ralplan.config.js"),
      `globalThis.__cfgHacked = true; module.exports = { worktree: { baseBranch: "x" } };\n`,
    );
    delete (globalThis as { __cfgHacked?: boolean }).__cfgHacked;
    await loadConfig(tempDir);
    expect((globalThis as { __cfgHacked?: boolean }).__cfgHacked).toBeUndefined();
  });

  it("merges partial config with defaults", async () => {
    writeFileSync(
      join(tempDir, "ralplan.config.js"),
      `module.exports = { worktree: { baseBranch: "test" } };\n`,
      "utf-8",
    );

    const config = await loadConfig(tempDir);
    expect(config.worktree.baseBranch).toBe("test");
    expect(config.worktree.worktreeRoot).toBe("./worktrees"); // from defaults
  });
});