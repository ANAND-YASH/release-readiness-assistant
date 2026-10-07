import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ApiError, ok, readJson, withApiHandler } from "@/lib/api";
import { persistAppLog } from "@/lib/app-log";
import { Prisma } from "@/lib/generated/prisma/client";

vi.mock("@/lib/app-log", () => ({ persistAppLog: vi.fn() }));

const json = (body: unknown) =>
  new Request("http://test/api", { method: "POST", body: JSON.stringify(body) });

const prismaError = (code: string) =>
  new Prisma.PrismaClientKnownRequestError("db failure: postgres://user:secret@host", {
    code,
    clientVersion: "test",
  });

describe("withApiHandler", () => {
  let logLines: string[];

  beforeEach(() => {
    vi.stubEnv("LOG_LEVEL", "info");
    logLines = [];
    const capture = (line: string) => logLines.push(line);
    vi.spyOn(console, "log").mockImplementation(capture);
    vi.spyOn(console, "error").mockImplementation(capture);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.mocked(persistAppLog).mockReset();
  });

  it("wraps success in { data } and sets a request id header", async () => {
    const handler = withApiHandler("test", async () => ok({ hello: "world" }, 201));
    const res = await handler(new Request("http://test/api"), {});

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ data: { hello: "world" } });
    expect(res.headers.get("x-request-id")).toMatch(/^[\w-]+$/);
    expect(JSON.parse(logLines[0])).toMatchObject({
      level: "info",
      event: "api.request.completed",
      status: 201,
      outcome: "success",
    });
  });

  it("propagates a well-formed incoming request id", async () => {
    const handler = withApiHandler("test", async () => ok(null));
    const res = await handler(new Request("http://test/api", { headers: { "x-request-id": "abc-123" } }), {});
    expect(res.headers.get("x-request-id")).toBe("abc-123");
  });

  it("maps ApiError to its status and code", async () => {
    const handler = withApiHandler("test", async () => {
      throw new ApiError(404, "NOT_FOUND", "Release not found");
    });
    const res = await handler(new Request("http://test/api"), {});

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatchObject({ code: "NOT_FOUND", message: "Release not found" });
    expect(body.error.requestId).toBe(res.headers.get("x-request-id"));
  });

  it("hides unexpected error details from the client but logs them", async () => {
    const handler = withApiHandler("test", async () => {
      throw new Error("connection string postgres://secret@host");
    });
    const res = await handler(new Request("http://test/api"), {});
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toMatchObject({ code: "INTERNAL_ERROR", message: "An unexpected error occurred" });
    expect(JSON.stringify(body)).not.toContain("secret");

    const logged = JSON.parse(logLines[0]);
    expect(logged).toMatchObject({ level: "error", event: "api.request.failed", status: 500 });
    expect(logged.error.message).toContain("connection string");
  });

  it.each([
    ["ECONNREFUSED", 503, "SERVICE_UNAVAILABLE"],
    ["P1001", 503, "SERVICE_UNAVAILABLE"],
    ["P2002", 409, "CONFLICT"],
    ["P2025", 404, "NOT_FOUND"],
  ])("maps database error %s to %i %s without leaking details", async (code, status, apiCode) => {
    const handler = withApiHandler("test", async () => {
      throw prismaError(code);
    });
    const res = await handler(new Request("http://test/api"), {});
    const body = await res.json();
    expect(res.status).toBe(status);
    expect(body.error.code).toBe(apiCode);
    expect(JSON.stringify(body)).not.toContain("secret");
  });

  it("maps raw driver connection errors (e.g. pg-pool AggregateError) to 503", async () => {
    const handler = withApiHandler("test", async () => {
      throw Object.assign(new AggregateError([], ""), { code: "ECONNREFUSED" });
    });
    const res = await handler(new Request("http://test/api", { method: "POST" }), {});
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe("SERVICE_UNAVAILABLE");
    expect(vi.mocked(persistAppLog).mock.calls[0][0].context?.error).toEqual({
      name: "AggregateError",
      code: "ECONNREFUSED",
    });
  });

  it("never lets log context overwrite the event name", async () => {
    const { createLogger } = await import("@/lib/log");
    createLogger({ event: "base" }).info("real.event", { event: "ctx", level: "x" });
    expect(JSON.parse(logLines[0])).toMatchObject({ event: "real.event", level: "info" });
  });

  it("returns VALIDATION_ERROR with field paths for invalid bodies", async () => {
    const schema = z.object({ name: z.string().min(1) });
    const handler = withApiHandler("test", async (req) => ok(await readJson(req, schema)));

    const res = await handler(json({ name: "" }), {});
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.details).toEqual([expect.objectContaining({ path: "name" })]);
  });

  it("returns BAD_REQUEST for malformed JSON", async () => {
    const handler = withApiHandler("test", async (req) => ok(await readJson(req, z.object({}))));
    const res = await handler(new Request("http://test/api", { method: "POST", body: "{nope" }), {});
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("BAD_REQUEST");
  });

  describe("AppLog persistence", () => {
    it("persists mutating requests with annotations, duration and outcome", async () => {
      const handler = withApiHandler("releases.create", async (_req, _ctx, hc) => {
        hc.annotate({ releaseId: "rel_1", versionNumber: 1 });
        return ok({}, 201);
      });
      await handler(json({}), {});

      expect(persistAppLog).toHaveBeenCalledTimes(1);
      const [entry] = vi.mocked(persistAppLog).mock.calls[0];
      expect(entry).toMatchObject({
        level: "info",
        event: "api.request.completed",
        releaseId: "rel_1",
        context: { route: "releases.create", method: "POST", status: 201, outcome: "success", versionNumber: 1 },
      });
      expect(entry.requestId).toEqual(expect.any(String));
      expect(entry.context?.durationMs).toEqual(expect.any(Number));
    });

    it("does not persist successful reads", async () => {
      await withApiHandler("test", async () => ok(null))(new Request("http://test/api"), {});
      expect(persistAppLog).not.toHaveBeenCalled();
    });

    it("persists failed reads with a non-sensitive error description", async () => {
      await withApiHandler("test", async () => {
        throw prismaError("ECONNREFUSED");
      })(new Request("http://test/api"), {});

      const [entry] = vi.mocked(persistAppLog).mock.calls[0];
      expect(entry).toMatchObject({ level: "error", event: "api.request.failed" });
      expect(entry.context?.error).toEqual({ name: "PrismaClientKnownRequestError", code: "ECONNREFUSED" });
      expect(JSON.stringify(entry)).not.toContain("secret");
    });

    it("persists rejected mutations as warnings", async () => {
      await withApiHandler("test", async () => {
        throw new ApiError(422, "PACKAGE_INVALID", "invalid");
      })(json({}), {});
      expect(vi.mocked(persistAppLog).mock.calls[0][0]).toMatchObject({
        level: "warn",
        event: "api.request.rejected",
        context: { code: "PACKAGE_INVALID", outcome: "rejected" },
      });
    });
  });
});
