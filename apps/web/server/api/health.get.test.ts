import { describe, expect, it } from "vitest";
import type { H3Event } from "h3";
import healthHandler from "./health.get";

describe("GET /api/health", () => {
  it("returns only the public health status", () => {
    expect(healthHandler({} as H3Event)).toEqual({ status: "ok" });
  });
});
