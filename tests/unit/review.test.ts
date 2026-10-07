import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ALLOWED_ACTIONS, nextReviewStatus, ReviewRequestSchema, summarizeReview } from "@/lib/domain/review";
import { readinessChecklist } from "@/lib/domain/readiness";
import { validatePackage } from "@/lib/domain/validate-package";
import { validPackage } from "../fixtures/release-package";

describe("ReviewRequestSchema", () => {
  const issues = (body: unknown) => {
    const result = ReviewRequestSchema.safeParse(body);
    return result.success ? [] : result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
  };

  it("accepts the three actions", () => {
    expect(ReviewRequestSchema.parse({ action: "approve", reviewer: " Ada " })).toEqual({ action: "approve", reviewer: "Ada" });
    expect(ReviewRequestSchema.parse({ action: "reject", reviewer: "Ada", note: "Wrong scope" })).toMatchObject({ note: "Wrong scope" });
    expect(ReviewRequestSchema.parse({ action: "edit", reviewer: "Ada", content: " New text " })).toMatchObject({ content: "New text" });
  });

  it("requires a non-blank reviewer for every action", () => {
    for (const action of ["approve", "reject", "edit"]) {
      expect(issues({ action, content: "x" })).toEqual(["reviewer: Reviewer name is required"]);
      expect(issues({ action, reviewer: "   ", content: "x" })).toEqual(["reviewer: Reviewer name is required"]);
    }
  });

  it("rejects empty or missing edited content", () => {
    expect(issues({ action: "edit", reviewer: "Ada", content: "  \n " })).toEqual(["content: Edited content cannot be empty"]);
    expect(issues({ action: "edit", reviewer: "Ada" })).toEqual(["content: Edited content is required"]);
  });

  it("rejects unknown actions", () => {
    expect(issues({ action: "auto-approve", reviewer: "Ada" })).toEqual([
      'action: action must be "approve", "reject" or "edit"',
    ]);
    expect(issues({ reviewer: "Ada" })).toHaveLength(1);
  });

  it("does not accept a status field (status is derived from the action)", () => {
    expect(ReviewRequestSchema.parse({ action: "reject", reviewer: "Ada", reviewStatus: "APPROVED" })).not.toHaveProperty(
      "reviewStatus",
    );
  });
});

describe("review state transitions", () => {
  it.each([
    ["PENDING", "approve", "APPROVED"],
    ["PENDING", "reject", "REJECTED"],
    ["PENDING", "edit", "EDITED"],
    ["APPROVED", "edit", "EDITED"],
    ["APPROVED", "reject", "REJECTED"],
    ["EDITED", "approve", "APPROVED"],
    ["EDITED", "reject", "REJECTED"],
    ["EDITED", "edit", "EDITED"],
    ["REJECTED", "edit", "EDITED"],
    ["REJECTED", "approve", "APPROVED"],
  ] as const)("%s --%s--> %s", (from, action, to) => {
    expect(nextReviewStatus(from, action)).toEqual({ ok: true, status: to });
  });

  it.each([
    ["APPROVED", "approve"],
    ["REJECTED", "reject"],
  ] as const)("refuses the no-op %s --%s", (from, action) => {
    expect(nextReviewStatus(from, action)).toMatchObject({ ok: false });
  });

  it("never offers a transition back to PENDING; every decision can be revised", () => {
    for (const [status, actions] of Object.entries(ALLOWED_ACTIONS)) {
      expect(actions.length).toBeGreaterThanOrEqual(2);
      for (const action of actions) {
        const next = nextReviewStatus(status as keyof typeof ALLOWED_ACTIONS, action);
        expect(next.ok && next.status).not.toBe("PENDING");
      }
    }
  });
});

describe("summarizeReview", () => {
  it("counts statements by review status", () => {
    const summary = summarizeReview(
      ["PENDING", "PENDING", "APPROVED", "EDITED", "REJECTED", "APPROVED"].map((reviewStatus) => ({
        reviewStatus: reviewStatus as "PENDING",
      })),
    );
    expect(summary).toEqual({
      total: 6,
      pending: 2,
      approved: 2,
      edited: 1,
      rejected: 1,
      stale: 0,
      reviewed: 4,
      allReviewed: false,
    });
  });

  it("is only fully reviewed when nothing is pending and there is something to review", () => {
    expect(summarizeReview([]).allReviewed).toBe(false);
    expect(summarizeReview([{ reviewStatus: "REJECTED" }, { reviewStatus: "EDITED" }]).allReviewed).toBe(true);
  });

  it("drives the readiness checklist review item", () => {
    const validation = validatePackage(validPackage());
    const state = (statuses: string[]) =>
      readinessChecklist(validation, "SUCCEEDED", summarizeReview(statuses.map((s) => ({ reviewStatus: s as "PENDING" })))).find(
        (i) => i.key === "review",
      )?.state;
    expect(state([])).toBe("pending");
    expect(state(["PENDING", "APPROVED"])).toBe("attention");
    expect(state(["APPROVED", "REJECTED"])).toBe("done");
  });
});

describe("human-only review guarantee (source scan)", () => {
  // Application code only; the generated Prisma client documents every model method.
  function sources(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) return name === "generated" ? [] : sources(full);
      return /\.tsx?$/.test(full) ? [full] : [];
    });
  }

  it("the AI workflow never sets a reviewed status, updates statements or touches releases", () => {
    const files = sources(path.resolve(__dirname, "../../lib/ai"));
    expect(files.length).toBeGreaterThan(5);
    for (const file of files) {
      const code = readFileSync(file, "utf8");
      expect(code, file).not.toMatch(/["'](APPROVED|EDITED|REJECTED)["']/);
      expect(code, file).not.toMatch(/generatedStatement\.(update|updateMany|upsert)\b/);
      expect(code, file).not.toMatch(/\brelease\.(update|updateMany|upsert)\b/);
    }
  });

  it("only the review service changes reviewStatus", () => {
    const files = sources(path.resolve(__dirname, "../../lib")).concat(sources(path.resolve(__dirname, "../../app")));
    const writers = files.filter((file) => /generatedStatement\.(update|updateMany|upsert)\b/.test(readFileSync(file, "utf8")));
    expect(writers.map((f) => path.relative(path.resolve(__dirname, "../.."), f))).toEqual(["lib/services/review.ts"]);
  });
});
