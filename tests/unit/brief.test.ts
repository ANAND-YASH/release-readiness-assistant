import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  approvalBlockers,
  assembleBrief,
  briefBlockers,
  selectBriefStatements,
  type BriefInputs,
  type BriefStatement,
} from "@/lib/domain/brief";
import { DecisionRequestSchema } from "@/lib/domain/decision";

const hash = (id: string) => `${id.toLowerCase().replace("-", "")}`.padEnd(64, "0");
const cite = (...ids: string[]) => ids.map((itemId) => ({ itemId, itemHash: hash(itemId) }));

function s(id: string, kind: BriefStatement["kind"], reviewStatus: BriefStatement["reviewStatus"], content: string, citations = cite("FEAT-1"), extra: Partial<BriefStatement> = {}): BriefStatement {
  return { id, kind, reviewStatus, content, citations, stale: false, order: Number(id.replace(/\D/g, "")), ...extra };
}

const items = {
  "FEAT-1": { section: "Feature", label: "Bulk invoice export" },
  "FIX-1": { section: "Bug fix", label: "Receipt timezone" },
  "QA-1": { section: "QA evidence", label: "Export regression suite" },
  "MIG-1": { section: "Migration note", label: "Set SESSION_TIMEOUT_MINUTES" },
  "LIM-1": { section: "Known limitation", label: "Exports above 50k rejected" },
};
const release = { name: "Billing Portal 4.2", product: "Billing Portal", targetDate: "2026-11-03" };

const statements = [
  s("s1", "IMPACT", "APPROVED", "FEAT-1: medium impact for Billing admins."),
  s("s2", "TECH_SUMMARY", "EDITED", "FEAT-1 raises the export limit to 50,000 (edited).", cite("FEAT-1", "QA-1")),
  s("s3", "TECH_SUMMARY", "APPROVED", "Operator action: set SESSION_TIMEOUT_MINUTES.", cite("MIG-1")),
  s("s4", "RISK", "REJECTED", "Rejected risk text.", cite("FIX-1")),
  s("s5", "NONTECH_SUMMARY", "APPROVED", "You can now export more invoices.", cite("FEAT-1")),
  s("s6", "UNSUPPORTED_CLAIM", "APPROVED", 'Unsupported claim in FEAT-1: "No performance impact".', cite("FEAT-1", "QA-1")),
  s("s7", "RISK", "APPROVED", "Known limitation may surprise users.", cite("LIM-1")),
];

describe("selectBriefStatements", () => {
  it("includes only approved and edited, non-stale statements", () => {
    const all = [
      ...statements,
      s("s8", "RISK", "PENDING", "pending"),
      s("s9", "RISK", "APPROVED", "approved but stale", cite("FEAT-1"), { stale: true }),
    ];
    expect(selectBriefStatements(all).map((x) => x.id)).toEqual(["s1", "s2", "s3", "s5", "s6", "s7"]);
  });
});

describe("briefBlockers", () => {
  const base: BriefInputs = { versionNumber: 2, validationErrorCount: 0, hasAnalysis: true, unanalysedItemIds: [], statements };
  const codes = (input: Partial<BriefInputs>) => briefBlockers({ ...base, ...input }).map((b) => b.code);

  it("has no blockers when everything is reviewed", () => {
    expect(codes({})).toEqual([]);
  });

  it.each([
    [{ validationErrorCount: 2 }, ["VALIDATION_ERRORS"]],
    [{ hasAnalysis: false, statements: [] }, ["NO_ANALYSIS"]],
    [{ unanalysedItemIds: ["FIX-3"] }, ["UNANALYSED_ITEMS"]],
    [{ statements: [...statements, s("s8", "RISK", "PENDING", "x")] }, ["PENDING_STATEMENTS"]],
    [{ statements: [...statements, s("s8", "RISK", "APPROVED", "x", cite("FEAT-1"), { stale: true })] }, ["STALE_STATEMENTS"]],
    [{ statements: statements.map((x) => ({ ...x, reviewStatus: "REJECTED" as const })) }, ["NO_USABLE_STATEMENTS"]],
  ])("blocks on %j", (input, expected) => {
    expect(codes(input)).toEqual(expected);
  });

  it("does not block on a stale statement that was rejected", () => {
    expect(codes({ statements: [...statements, s("s8", "RISK", "REJECTED", "x", cite("FEAT-1"), { stale: true })] })).toEqual([]);
  });

  it("a stale pending statement reports both problems", () => {
    expect(codes({ statements: [...statements, s("s8", "RISK", "PENDING", "x", cite("FEAT-1"), { stale: true })] })).toEqual([
      "PENDING_STATEMENTS",
      "STALE_STATEMENTS",
    ]);
  });
});

describe("assembleBrief", () => {
  const brief = assembleBrief(release, 2, statements, items);

  it("is deterministic", () => {
    expect(assembleBrief(release, 2, [...statements].reverse(), items).markdown).toBe(brief.markdown);
  });

  it("includes only approved/edited statements, using the edited text, each exactly once", () => {
    expect(brief.statementIds).toEqual(["s1", "s2", "s3", "s5", "s6", "s7"]);
    expect(brief.markdown).toContain("FEAT-1 raises the export limit to 50,000 (edited).");
    expect(brief.markdown).not.toContain("Rejected risk text");
    for (const id of brief.statementIds) {
      expect(brief.sections.filter((section) => section.statementIds.includes(id))).toHaveLength(1);
    }
  });

  it("organises statements into sections", () => {
    expect(brief.sections).toEqual([
      { title: "What's Changed", statementIds: ["s2"] },
      { title: "User Impact", statementIds: ["s1"] },
      { title: "Risks & Limitations", statementIds: ["s7"] },
      { title: "Technical Summary", statementIds: ["s3"] },
      { title: "For Users / Clients", statementIds: ["s5"] },
      { title: "QA / Validation", statementIds: ["s6"] },
    ]);
    expect(brief.markdown).toMatch(/^# Release Brief: Billing Portal 4\.2\n/);
    expect(brief.markdown).toContain("- **Version:** v2");
    expect(brief.markdown).toContain("- **Target date:** November 3, 2026");
  });

  it("preserves citations on every statement and lists cited sources with hashes", () => {
    expect(brief.markdown).toContain("- FEAT-1 raises the export limit to 50,000 \\(edited\\).".replace("\\(", "(").replace("\\)", ")") + " [FEAT-1, QA-1]");
    const sources = brief.markdown.split("## Sources\n")[1];
    expect(sources).toContain("- **FEAT-1** (Feature): Bulk invoice export · hash `feat10000000`");
    expect(sources).toContain("- **QA-1** (QA evidence): Export regression suite");
    expect(sources).not.toContain("FIX-1"); // only cited by the rejected statement
  });

  it("escapes Markdown in statement text", () => {
    const md = assembleBrief(release, 2, [s("s1", "IMPACT", "APPROVED", "Use *care* with [links] and `code`")], items).markdown;
    expect(md).toContain("- Use \\*care\\* with \\[links\\] and \\`code\\` [FEAT-1]");
  });
});

describe("approvalBlockers", () => {
  const md = assembleBrief(release, 2, statements, items).markdown;

  it("requires a generated brief", () => {
    expect(approvalBlockers([], null, md).map((b) => b.code)).toEqual(["BRIEF_MISSING"]);
  });

  it("requires the brief to match the current review state", () => {
    expect(approvalBlockers([], { markdown: md.replace("medium", "high") }, md).map((b) => b.code)).toEqual(["BRIEF_OUTDATED"]);
    expect(approvalBlockers([], { markdown: md }, md)).toEqual([]);
  });

  it("carries the brief blockers", () => {
    expect(approvalBlockers([{ code: "PENDING_STATEMENTS", message: "x" }], { markdown: md }, null).map((b) => b.code)).toEqual([
      "PENDING_STATEMENTS",
    ]);
  });
});

describe("DecisionRequestSchema", () => {
  const issues = (body: unknown) => {
    const r = DecisionRequestSchema.safeParse(body);
    return r.success ? [] : r.error.issues.map((i) => i.path.join("."));
  };
  it("requires a reviewer and a valid decision", () => {
    expect(issues({ decision: "approve", reviewer: "Ada" })).toEqual([]);
    expect(issues({ decision: "approve" })).toEqual(["reviewer"]);
    expect(issues({ decision: "approve", reviewer: "  " })).toEqual(["reviewer"]);
    expect(issues({ decision: "ship-it", reviewer: "Ada" })).toEqual(["decision"]);
  });
});

describe("only the decision service changes Release.status (source scan)", () => {
  function sources(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) return name === "generated" ? [] : sources(full);
      return /\.tsx?$/.test(full) ? [full] : [];
    });
  }
  it("no other application code updates releases", () => {
    const root = path.resolve(__dirname, "../..");
    const files = [...sources(path.join(root, "lib")), ...sources(path.join(root, "app"))];
    const writers = files.filter((f) => /\brelease\.(update|updateMany|upsert)\b/.test(readFileSync(f, "utf8")));
    expect(writers.map((f) => path.relative(root, f))).toEqual(["lib/services/decision.ts"]);
  });

  it("the AI workflow and brief generation never reference the decision endpoint or service", () => {
    const root = path.resolve(__dirname, "../..");
    const files = [...sources(path.join(root, "lib/ai")), path.join(root, "lib/services/brief.ts")];
    for (const f of files) {
      const code = readFileSync(f, "utf8");
      expect(code, f).not.toMatch(/decideRelease|\/decision\b|services\/decision/);
    }
  });
});
