import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { GET as getReleaseRoute } from "@/app/api/releases/[releaseId]/route";
import { GET as getVersionRoute } from "@/app/api/releases/[releaseId]/versions/[versionNumber]/route";
import { POST as validateRoute } from "@/app/api/releases/[releaseId]/versions/[versionNumber]/validate/route";
import { POST as createVersionRoute } from "@/app/api/releases/[releaseId]/versions/route";
import { GET as listRoute, POST as createRoute } from "@/app/api/releases/route";
import { POST as sampleRoute } from "@/app/api/sample-release/route";
import { getDb } from "@/lib/db";
import { validPackage } from "../fixtures/release-package";
import { jsonRequest, params, releaseBody, resetDb } from "./helpers";

beforeEach(resetDb);
afterAll(() => getDb().$disconnect());

async function createViaApi() {
  const res = await createRoute(jsonRequest("/api/releases", releaseBody(validPackage())), params({}));
  expect(res.status).toBe(201);
  return (await res.json()).data.release as { id: string };
}

describe("release routes", () => {
  it("GET /api/releases returns an empty list, then created releases", async () => {
    let res = await listRoute(new Request("http://test/api/releases"), params({}));
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual([]);

    const release = await createViaApi();
    res = await listRoute(new Request("http://test/api/releases"), params({}));
    const list = (await res.json()).data;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: release.id, latestVersion: { versionNumber: 1 } });
  });

  it("POST /api/releases validates the request body (400) and the package (422)", async () => {
    const badBody = await createRoute(
      jsonRequest("/api/releases", { ...releaseBody(validPackage()), name: "", targetDate: "next week" }),
      params({}),
    );
    expect(badBody.status).toBe(400);
    const badBodyJson = await badBody.json();
    expect(badBodyJson.error.code).toBe("VALIDATION_ERROR");
    expect(badBodyJson.error.details.map((d: { path: string }) => d.path).sort()).toEqual(["name", "targetDate"]);

    const badPackage = await createRoute(
      jsonRequest("/api/releases", releaseBody({ ...validPackage(), affectedUserGroups: [] })),
      params({}),
    );
    expect(badPackage.status).toBe(422);
    const badPackageJson = await badPackage.json();
    expect(badPackageJson.error.code).toBe("PACKAGE_INVALID");
    expect(badPackageJson.error.details.errors[0].code).toBe("USER_GROUPS_MISSING");
  });

  it("POST /api/releases rejects malformed JSON with 400", async () => {
    const res = await createRoute(
      new Request("http://test/api/releases", { method: "POST", body: "{" }),
      params({}),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("BAD_REQUEST");
  });

  it("GET /api/releases/:id returns versions, 404 for unknown ids", async () => {
    const release = await createViaApi();
    const res = await getReleaseRoute(new Request("http://test"), params({ releaseId: release.id }));
    expect(res.status).toBe(200);
    expect((await res.json()).data.versions).toHaveLength(1);

    const missing = await getReleaseRoute(new Request("http://test"), params({ releaseId: "nope" }));
    expect(missing.status).toBe(404);
    expect((await missing.json()).error.code).toBe("NOT_FOUND");
  });

  it("POST /api/releases/:id/versions requires a change note and creates the next version", async () => {
    const release = await createViaApi();
    const pkg = validPackage();
    pkg.bugFixes[0].description = "Receipts now use the account timezone, including on emailed copies.";

    const noNote = await createVersionRoute(
      jsonRequest(`/api/releases/${release.id}/versions`, { package: pkg, changeNote: "", baseVersionNumber: 1 }),
      params({ releaseId: release.id }),
    );
    expect(noNote.status).toBe(400);
    expect((await noNote.json()).error.details[0].path).toBe("changeNote");

    const res = await createVersionRoute(
      jsonRequest(`/api/releases/${release.id}/versions`, {
        package: pkg,
        changeNote: "Clarify FIX-1 scope",
        baseVersionNumber: 1,
      }),
      params({ releaseId: release.id }),
    );
    expect(res.status).toBe(201);
    expect((await res.json()).data).toMatchObject({ versionNumber: 2, changeNote: "Clarify FIX-1 scope" });

    const logs = await getDb().appLog.findMany({ where: { releaseId: release.id }, orderBy: { createdAt: "asc" } });
    expect(logs.map((l) => l.event)).toEqual([
      "release.created",
      "api.request.completed",
      "api.request.rejected",
      "release.version.created",
      "api.request.completed",
    ]);
    expect(logs[4].context).toMatchObject({ method: "POST", status: 201, outcome: "success", versionNumber: 2 });
  });

  it("GET /api/releases/:id/versions/:v returns the snapshot; 404 for missing or malformed numbers", async () => {
    const release = await createViaApi();
    const res = await getVersionRoute(new Request("http://test"), params({ releaseId: release.id, versionNumber: "1" }));
    expect(res.status).toBe(200);
    const version = (await res.json()).data;
    expect(version.package).toEqual(validPackage());
    expect(Object.keys(version.itemHashes)).toHaveLength(8);

    for (const versionNumber of ["2", "0", "abc", "1.5"]) {
      const missing = await getVersionRoute(new Request("http://test"), params({ releaseId: release.id, versionNumber }));
      expect(missing.status).toBe(404);
    }
  });

  it("POST /api/releases/:id/versions/:v/validate validates the stored or a candidate package without saving", async () => {
    const release = await createViaApi();
    const route = `/api/releases/${release.id}/versions/1/validate`;
    const p = params({ releaseId: release.id, versionNumber: "1" });

    const stored = await validateRoute(jsonRequest(route), p);
    expect(stored.status).toBe(200);
    expect((await stored.json()).data).toEqual({ valid: true, errors: [], warnings: [] });

    const candidate = await validateRoute(jsonRequest(route, { package: { ...validPackage(), qaSummary: "" } }), p);
    expect(candidate.status).toBe(200);
    const result = (await candidate.json()).data;
    expect(result.valid).toBe(false);
    expect(result.errors[0].code).toBe("QA_SUMMARY_MISSING");
    expect(await getDb().releaseVersion.count()).toBe(1);
  });

  it("POST /api/sample-release creates a release with two versions", async () => {
    const res = await sampleRoute(jsonRequest("/api/sample-release"), params({}));
    expect(res.status).toBe(201);
    const release = (await res.json()).data;
    expect(release.versions.map((v: { versionNumber: number }) => v.versionNumber)).toEqual([2, 1]);
  });
});
