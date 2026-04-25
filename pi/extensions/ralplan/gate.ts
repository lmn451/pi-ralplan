// ============================================================================
// PRE-EXECUTION GATE HEURISTICS
// ============================================================================

// Concrete anchors that indicate a well-specified request (passes the gate)
export const CONCRETE_ANCHORS = [
  /[a-zA-Z0-9_\-./]+\.[a-zA-Z]{2,}/, // file paths with extensions
  /#[0-9]+/, // issue/PR numbers
  /[a-z]+[A-Z][a-zA-Z]+/, // camelCase symbols
  /[A-Z][a-z]+[A-Z][a-zA-Z]+/, // PascalCase symbols
  /[a-z]+_[a-z_]+/, // snake_case symbols
  /\d+\.\s+/, // numbered steps
  /```[a-z]*\n/, // code blocks
  /acceptance criteria/i,
  /error[:\s]/i,
  /test\s+(runner|suite|file)/i,
];

// Broad execution keywords that suggest underspecified work
export const BROAD_INDICATORS = [
  "build me",
  "create a",
  "implement",
  "develop",
  "make a",
  "write a",
  "design a",
  "set up",
  "add feature",
  "new feature",
  "improve",
  "optimize",
  "refactor",
  "fix this",
  "update the",
];

export const BYPASS_PREFIXES = ["force:", "! "];

export function hasBypassPrefix(text: string): boolean {
  const trimmed = text.trim().toLowerCase();
  return BYPASS_PREFIXES.some((p) => trimmed.startsWith(p));
}

export function hasConcreteAnchor(text: string): boolean {
  return CONCRETE_ANCHORS.some((re) => re.test(text));
}

export function looksLikeBroadRequest(text: string): boolean {
  const lower = text.toLowerCase();
  // Must have a broad indicator
  const hasBroad = BROAD_INDICATORS.some((ind) => lower.includes(ind));
  // Must lack concrete anchors (file paths, issue numbers, symbols, etc.)
  const hasAnchor = hasConcreteAnchor(text);

  // Gate fires when: broad indicator present AND no concrete anchor
  return hasBroad && !hasAnchor;
}
