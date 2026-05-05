/**
 * Naming utilities for date-based plan filenames.
 */

/** Format date as YYYY-MM-DD (ISO format) */
export function formatDate(date: Date = new Date()): string {
  return date.toISOString().split("T")[0]; // "YYYY-MM-DD"
}

/** Sanitize description for URL-safe filename */
export function sanitizeDescription(desc: string): string {
  return desc
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
}

/** Generate plan filename with date */
export function generatePlanFilename(description: string, date: Date = new Date()): string {
  const dateStr = formatDate(date);
  const slug = sanitizeDescription(description);
  return `plan-${dateStr}-${slug}.md`;
}

/** Generate spec filename with date */
export function generateSpecFilename(description: string, date: Date = new Date()): string {
  const dateStr = formatDate(date);
  const slug = sanitizeDescription(description);
  return `spec-${dateStr}-${slug}.md`;
}

/** Resolve increment for date collision */
export function resolveFilenameIncrement(baseName: string, counter: number): string {
  if (counter === 0) return baseName;
  const ext = baseName.endsWith(".md") ? ".md" : "";
  const base = ext ? baseName.slice(0, -3) : baseName;
  return `${base}-${counter}${ext}`;
}