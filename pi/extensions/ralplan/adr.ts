/**
 * Architecture Decision Record (ADR) utilities.
 */

import { randomUUID } from "node:crypto";

export type ADREntryType = "open-question" | "decision" | "approval" | "rejection";
export type ADRStatus = "pending" | "approved" | "rejected";

export interface ADREntry {
  id: string;
  type: ADREntryType;
  title: string;
  description: string;
  status: ADRStatus;
  author?: string;
  timestamp: string;
  reason?: string;  // For rejections
}

export interface ADR {
  entries: ADREntry[];
  addEntry(entry: Omit<ADREntry, "id" | "timestamp">): ADREntry;
  approve(id: string, author: string): void;
  reject(id: string, author: string, reason: string): void;
  toMarkdown(): string;
}

function generateId(): string {
  return `ADR-${randomUUID().slice(0, 8)}`;
}

export function createADR(): ADR {
  const entries: ADREntry[] = [];

  return {
    entries,
    addEntry(entry) {
      const newEntry: ADREntry = {
        ...entry,
        id: generateId(),
        timestamp: new Date().toISOString(),
        status: entry.status ?? "pending",
      };
      entries.push(newEntry);
      return newEntry;
    },
    approve(id, author) {
      const entry = entries.find((e) => e.id === id);
      if (entry) {
        entry.status = "approved";
        entry.author = author;
        entry.timestamp = new Date().toISOString();
      }
    },
    reject(id, author, reason) {
      const entry = entries.find((e) => e.id === id);
      if (entry) {
        entry.status = "rejected";
        entry.author = author;
        entry.reason = reason;
        entry.timestamp = new Date().toISOString();
      }
    },
    toMarkdown() {
      const lines = ["## Architecture Decision Record\n"];

      const questions = entries.filter((e) => e.type === "open-question");
      const decisions = entries.filter((e) => e.type === "decision");
      const approvals = entries.filter((e) => e.type === "approval");
      const rejections = entries.filter((e) => e.type === "rejection");

      if (questions.length > 0) {
        lines.push("### Open Questions\n");
        for (const q of questions) {
          const check = q.status === "pending" ? "[ ]" : "[x]";
          lines.push(`- ${check} **${q.title}** — ${q.description}`);
        }
        lines.push("");
      }

      if (decisions.length > 0) {
        lines.push("### Decisions\n");
        for (const d of decisions) {
          lines.push(`- **${d.title}** — ${d.description} [${d.status}]`);
        }
        lines.push("");
      }

      if (approvals.length > 0) {
        lines.push("### Approvals\n");
        for (const a of approvals) {
          lines.push(`- ✓ **${a.title}** by ${a.author} at ${a.timestamp}`);
        }
        lines.push("");
      }

      if (rejections.length > 0) {
        lines.push("### Rejections\n");
        for (const r of rejections) {
          lines.push(`- ✗ **${r.title}** by ${r.author}: ${r.reason}`);
        }
        lines.push("");
      }

      return lines.join("\n");
    },
  };
}