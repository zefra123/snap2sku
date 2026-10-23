import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ACCESS_CODE_REQUIRED_EVENT,
  acknowledgeAccessCodeSaved,
  apiFetch,
  apiStream,
  getAccessCode,
  setAccessCode,
} from "./api";

const storage = new Map<string, string>();
const storageMock = {
  getItem: vi.fn((key: string) => storage.get(key) ?? null),
  setItem: vi.fn((key: string, value: string) => storage.set(key, value)),
  removeItem: vi.fn((key: string) => storage.delete(key)),
};

describe("Web API access code", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let streamFetchMock: ReturnType<typeof vi.fn>;
  let dispatchEvent: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    storage.clear();
    storageMock.getItem.mockClear();
    storageMock.setItem.mockClear();
    storageMock.removeItem.mockClear();
    fetchMock = vi.fn().mockResolvedValue({ ok: true });
    streamFetchMock = vi.fn().mockResolvedValue(new Response("ok"));
    dispatchEvent = vi.fn();
    vi.stubGlobal("localStorage", storageMock);
    vi.stubGlobal("$fetch", fetchMock);
    vi.stubGlobal("fetch", streamFetchMock);
    vi.stubGlobal("window", { dispatchEvent });
    acknowledgeAccessCodeSaved();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("trims and stores the access code under the shared key", () => {
    setAccessCode("  tester-code  ");
    expect(getAccessCode()).toBe("tester-code");
    expect(storageMock.setItem).toHaveBeenCalledWith(
      "snap2sku-access-code",
      "tester-code",
    );
  });

  it("adds the code to API requests and omits the header when unset", async () => {
    setAccessCode("tester-code");
    await apiFetch("/api/upload", { method: "POST" });
    const withCode = fetchMock.mock.calls[0]?.[1] as { headers: Headers };
    expect(withCode.headers.get("x-access-code")).toBe("tester-code");

    setAccessCode("");
    await apiFetch("/api/records");
    const withoutCode = fetchMock.mock.calls[1]?.[1] as { headers: Headers };
    expect(withoutCode.headers.has("x-access-code")).toBe(false);
  });

  it("adds the access code to SSE requests", async () => {
    setAccessCode("tester-code");
    await apiStream("/api/records/1/describe", { method: "POST" });
    const init = streamFetchMock.mock.calls[0]?.[1] as { headers: Headers };
    expect(init.headers.get("x-access-code")).toBe("tester-code");
  });

  it("handles the access code error on SSE responses", async () => {
    setAccessCode("wrong-code");
    streamFetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ data: { code: "E_ACCESS_CODE_REQUIRED" } }),
        {
          status: 401,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    await apiStream("/api/records/1/describe", { method: "POST" });

    expect(getAccessCode()).toBe("");
    expect(dispatchEvent).toHaveBeenCalledTimes(1);
  });

  it("does not clear the code for unrelated 401 errors", async () => {
    setAccessCode("tester-code");
    streamFetchMock.mockResolvedValue(
      new Response(JSON.stringify({ data: { code: "E_OTHER" } }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await apiStream("/api/records/1/describe", { method: "POST" });

    expect(getAccessCode()).toBe("tester-code");
    expect(dispatchEvent).not.toHaveBeenCalled();
  });

  it("clears an invalid code and emits one prompt event for repeated failures", async () => {
    setAccessCode("wrong-code");
    fetchMock.mockRejectedValue({ data: { code: "E_ACCESS_CODE_REQUIRED" } });

    await expect(
      apiFetch("/api/records", { method: "POST" }),
    ).rejects.toBeDefined();
    await expect(
      apiFetch("/api/records", { method: "POST" }),
    ).rejects.toBeDefined();

    expect(getAccessCode()).toBe("");
    expect(dispatchEvent).toHaveBeenCalledTimes(1);
    expect(dispatchEvent.mock.calls[0]?.[0]).toMatchObject({
      type: ACCESS_CODE_REQUIRED_EVENT,
    });
  });
});
