import { readdirSync, readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { ensureRalplanDir, resolvePlansDir } from "./utils.js";

export interface PlanningArtifacts {
  specPaths: string[];
  planPaths: string[];
  testSpecPaths: string[];
}

export function getDefaultArtifactFilename(type: "spec" | "plan" | "test-spec"): string {
  switch (type) {
    case "spec":
      return "spec.md";
    case "plan":
      return "plan.md";
    case "test-spec":
      return "test-spec.md";
  }
}

function readFileSafe(path: string): string | null {
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return null;
  }
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getSectionContent(markdown: string, heading: string): string | null {
  const headingRe = new RegExp(`^##\\s+${escapeRegex(heading)}[ \\t]*$`, "im");
  const headingMatch = headingRe.exec(markdown);
  if (!headingMatch || headingMatch.index === undefined) return null;

  const bodyStart = headingMatch.index + headingMatch[0].length;
  const rest = markdown.slice(bodyStart).replace(/^\r?\n/, "");
  const nextHeadingMatch = /\r?\n##\s+/.exec(rest);
  const body = (nextHeadingMatch ? rest.slice(0, nextHeadingMatch.index) : rest).trim();
  return body.length > 0 ? body : null;
}

function hasRequiredSections(markdown: string, headings: string[]): boolean {
  return headings.every((heading) => getSectionContent(markdown, heading) !== null);
}

function sortArtifactPathsDescending(paths: string[]): string[] {
  return [...paths].sort((a, b) => {
    const fileCompare = basename(b).localeCompare(basename(a));
    if (fileCompare !== 0) return fileCompare;
    return b.localeCompare(a);
  });
}

/** Read planning artifacts from .pi/ralplan/plans directory */
export function readPlanningArtifacts(cwd: string): PlanningArtifacts {
  const plansDir = resolvePlansDir(cwd);
  const prdPaths: string[] = [];
  const planPaths: string[] = [];
  const testSpecPaths: string[] = [];

  if (!existsSync(plansDir)) {
    return { specPaths: [], planPaths: [], testSpecPaths: [] };
  }

  let entries: string[];
  try {
    entries = readdirSync(plansDir);
  } catch {
    return { specPaths: [], planPaths: [], testSpecPaths: [] };
  }

  for (const entry of entries) {
    if (!entry.endsWith(".md")) continue;
    const fullPath = join(plansDir, entry);
    if (entry.startsWith("spec-") || entry === "spec.md") {
      prdPaths.push(fullPath);
    } else if (entry.startsWith("plan-") || entry === "plan.md") {
      planPaths.push(fullPath);
    } else if (entry.startsWith("test-spec-")) {
      testSpecPaths.push(fullPath);
    }
  }

  return {
    specPaths: sortArtifactPathsDescending(prdPaths),
    planPaths: sortArtifactPathsDescending(planPaths),
    testSpecPaths: sortArtifactPathsDescending(testSpecPaths),
  };
}

/** Returns true when latest spec and plan contain required quality-gate sections */
export function isPlanningComplete(artifacts: PlanningArtifacts): boolean {
  if (artifacts.specPaths.length === 0 || artifacts.planPaths.length === 0) {
    return false;
  }

  const latestSpec = readFileSafe(artifacts.specPaths[0]);
  const latestPlan = readFileSafe(artifacts.planPaths[0]);
  if (!latestSpec || !latestPlan) return false;

  return (
    hasRequiredSections(latestSpec, ["Acceptance criteria", "Requirement coverage map"]) &&
    hasRequiredSections(latestPlan, [
      "Architecture Decision Record (ADR)",
      "Task Breakdown",
      "Dependency Graph",
      "Acceptance Criteria per Task",
      "Risk Register",
    ])
  );
}

/** Write an artifact file to the plans directory */
export function writeArtifact(
  cwd: string,
  filename: string,
  content: string,
): string {
  const dir = ensureRalplanDir(cwd);
  const path = join(dir, filename);
  writeFileSync(path, content, "utf-8");
  return path;
}
