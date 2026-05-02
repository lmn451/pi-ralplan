import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getDefaultArtifactFilename,
  readPlanningArtifacts,
  isPlanningComplete,
  writeArtifact,
} from "../pi/extensions/ralplan/artifacts.js";

let tempDir: string;
let plansDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "ralplan-artifacts-test-"));
  plansDir = join(tempDir, "plans");
  mkdirSync(plansDir, { recursive: true });
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("readPlanningArtifacts", () => {
  it("returns empty arrays when no plans dir exists", () => {
    const emptyDir = mkdtempSync(join(tmpdir(), "ralplan-empty-"));
    const artifacts = readPlanningArtifacts(emptyDir);
    expect(artifacts.specPaths).toEqual([]);
    expect(artifacts.planPaths).toEqual([]);
    expect(artifacts.testSpecPaths).toEqual([]);
    rmSync(emptyDir, { recursive: true, force: true });
  });

  it("finds spec and plan files", () => {
    writeFileSync(join(plansDir, "spec.md"), "# Spec", "utf-8");
    writeFileSync(join(plansDir, "plan.md"), "# Plan", "utf-8");
    const artifacts = readPlanningArtifacts(tempDir);
    expect(artifacts.specPaths).toHaveLength(1);
    expect(artifacts.planPaths).toHaveLength(1);
    expect(artifacts.testSpecPaths).toHaveLength(0);
  });

  it("finds timestamped files", () => {
    writeFileSync(join(plansDir, "spec-2024-01-01.md"), "# Spec", "utf-8");
    writeFileSync(join(plansDir, "plan-2024-01-01.md"), "# Plan", "utf-8");
    writeFileSync(join(plansDir, "test-spec-2024-01-01.md"), "# Tests", "utf-8");
    const artifacts = readPlanningArtifacts(tempDir);
    expect(artifacts.specPaths).toHaveLength(1);
    expect(artifacts.planPaths).toHaveLength(1);
    expect(artifacts.testSpecPaths).toHaveLength(1);
  });

  it("finds canonical test-spec.md", () => {
    writeFileSync(join(plansDir, "test-spec.md"), "# Tests", "utf-8");
    const artifacts = readPlanningArtifacts(tempDir);
    expect(artifacts.testSpecPaths).toHaveLength(1);
    expect(artifacts.testSpecPaths[0]).toContain("test-spec.md");
  });

  it("sorts files descending by name", () => {
    writeFileSync(join(plansDir, "spec-2024-01-01.md"), "# Old", "utf-8");
    writeFileSync(join(plansDir, "spec-2024-12-31.md"), "# New", "utf-8");
    const artifacts = readPlanningArtifacts(tempDir);
    expect(artifacts.specPaths[0]).toContain("2024-12-31");
  });
});

describe("isPlanningComplete", () => {
  it("returns false when no artifacts", () => {
    const artifacts = { specPaths: [], planPaths: [], testSpecPaths: [] };
    expect(isPlanningComplete(artifacts)).toBe(false);
  });

  it("returns false when spec is missing required sections", () => {
    writeFileSync(join(plansDir, "spec.md"), "# Spec\n\nNo sections here.", "utf-8");
    writeFileSync(
      join(plansDir, "plan.md"),
      "# Plan\n\n## Architecture Decision Record (ADR)\nDecision details\n\n## Task Breakdown\n- task\n\n## Dependency Graph\n- dep\n\n## Acceptance Criteria per Task\n- criterion\n\n## Risk Register\n- risk\n",
      "utf-8",
    );
    const artifacts = readPlanningArtifacts(tempDir);
    expect(isPlanningComplete(artifacts)).toBe(false);
  });

  it("returns true when both spec and plan have required sections", () => {
    writeFileSync(
      join(plansDir, "spec.md"),
      "# Spec\n\n## Acceptance criteria\n- Must do X\n- Must do Y\n\n## Requirement coverage map\n- Req 1 covered by task A\n",
      "utf-8",
    );
    writeFileSync(
      join(plansDir, "plan.md"),
      "# Plan\n\n## Architecture Decision Record (ADR)\nDecision details\n\n## Task Breakdown\n- task\n\n## Dependency Graph\n- dep\n\n## Acceptance Criteria per Task\n- criterion\n\n## Risk Register\n- risk\n",
      "utf-8",
    );
    const artifacts = readPlanningArtifacts(tempDir);
    expect(isPlanningComplete(artifacts)).toBe(true);
  });
});

describe("getDefaultArtifactFilename", () => {
  it("uses canonical filenames for stage artifacts", () => {
    expect(getDefaultArtifactFilename("spec")).toBe("spec.md");
    expect(getDefaultArtifactFilename("plan")).toBe("plan.md");
    expect(getDefaultArtifactFilename("test-spec")).toBe("test-spec.md");
  });
});

describe("writeArtifact", () => {
  it("writes artifact to plans directory", () => {
    const path = writeArtifact(tempDir, "my-spec.md", "# My Spec");
    expect(path).toContain("my-spec.md");
    const content = readFileSync(path, "utf-8");
    expect(content).toBe("# My Spec");
  });
});
