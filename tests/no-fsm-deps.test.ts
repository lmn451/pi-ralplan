import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ============================================================================
// CI GUARD: No state-machine library may be added to package.json
// ============================================================================
//
// This test enforces ADR 0007 (Hand-rolled State Machine). If a contributor
// accidentally adds xstate, robot, robot3, machina, or any of their prefixes
// to dependencies/devDependencies/peerDependencies/optionalDependencies,
// this test fails the build.
//
// See docs/adr/0007-hand-rolled-state-machine.md for the full rationale and
// the T-1..T-5 triggers for revisiting this policy.

// Exact package names that are forbidden.
const FORBIDDEN_EXACT: readonly string[] = [
  "xstate",
  "robot",
  "robot3",
  "machina",
  "fsm",
  "fsm-as2",
  "finale",
  "redux",
  "stately",
];

// Package name prefixes that are forbidden (e.g. "@xstate/" matches "@xstate/store").
const FORBIDDEN_PREFIXES: readonly string[] = ["@xstate/", "@statelyai/"];

type DepsSection = {
  [pkg: string]: unknown;
};

function loadPackageJson(): {
  dependencies: DepsSection;
  devDependencies: DepsSection;
  peerDependencies: DepsSection;
  optionalDependencies: DepsSection;
} {
  const path = join(process.cwd(), "package.json");
  const raw = readFileSync(path, "utf-8");
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  return {
    dependencies: (parsed.dependencies ?? {}) as DepsSection,
    devDependencies: (parsed.devDependencies ?? {}) as DepsSection,
    peerDependencies: (parsed.peerDependencies ?? {}) as DepsSection,
    optionalDependencies: (parsed.optionalDependencies ?? {}) as DepsSection,
  };
}

function isForbidden(pkg: string): string | null {
  if (FORBIDDEN_EXACT.includes(pkg)) {
    return `exact match: ${pkg} is in the FSM-libraries forbid-list`;
  }
  for (const prefix of FORBIDDEN_PREFIXES) {
    if (pkg.startsWith(prefix)) {
      return `prefix match: ${pkg} starts with ${prefix} (forbidden by ADR 0007)`;
    }
  }
  return null;
}

describe("ADR 0007: no state-machine library may be added to package.json", () => {
  const pkg = loadPackageJson();
  const sections: Array<{ name: string; deps: DepsSection }> = [
    { name: "dependencies", deps: pkg.dependencies },
    { name: "devDependencies", deps: pkg.devDependencies },
    { name: "peerDependencies", deps: pkg.peerDependencies },
    { name: "optionalDependencies", deps: pkg.optionalDependencies },
  ];

  for (const section of sections) {
    it(`section "${section.name}" has no forbidden packages`, () => {
      const violations: string[] = [];
      for (const depName of Object.keys(section.deps)) {
        const reason = isForbidden(depName);
        if (reason) {
          violations.push(`${section.name}.${depName} → ${reason}`);
        }
      }
      expect(violations, violations.join("\n")).toEqual([]);
    });
  }
});

describe("ADR 0007: forbid-list is non-empty (sanity)", () => {
  it("FORBIDDEN_EXACT contains at least the canonical FSM libs", () => {
    expect(FORBIDDEN_EXACT).toContain("xstate");
    expect(FORBIDDEN_EXACT).toContain("robot");
    expect(FORBIDDEN_EXACT).toContain("robot3");
    expect(FORBIDDEN_EXACT).toContain("machina");
  });
});
