import { describe, expect, it, vi } from "vitest";
import { MgbaHttpClient } from "../src/mgba-http";

function textResponse(body: string, init?: ResponseInit): Response {
  return new Response(body, init);
}

describe("MgbaHttpClient", () => {
  it("sends button taps to the documented mGBA-http endpoint", async () => {
    const fetchMock = vi.fn(async () => textResponse(""));
    const client = new MgbaHttpClient({
      baseUrl: "http://127.0.0.1:5000",
      fetch: fetchMock as unknown as typeof fetch,
    });

    await client.tap("A");

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      URL,
      RequestInit,
    ];
    expect(url.toString()).toBe(
      "http://127.0.0.1:5000/mgba-http/button/tap?button=A"
    );
    expect(init.method).toBe("POST");
  });

  it("encodes repeated query keys for multi-button endpoints", async () => {
    const fetchMock = vi.fn(async () => textResponse(""));
    const client = new MgbaHttpClient({
      baseUrl: "http://127.0.0.1:5000",
      fetch: fetchMock as unknown as typeof fetch,
    });

    await client.holdMany(["Up", "A"], 12);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      URL,
      RequestInit,
    ];
    expect(url.pathname).toBe("/mgba-http/button/holdmany");
    expect(url.searchParams.getAll("buttons")).toEqual(["Up", "A"]);
    expect(url.searchParams.get("duration")).toBe("12");
    expect(init.method).toBe("POST");
  });

  it("saves screenshots through the core screenshot endpoint", async () => {
    const fetchMock = vi.fn(async () => textResponse(""));
    const client = new MgbaHttpClient({
      baseUrl: "http://127.0.0.1:5000",
      fetch: fetchMock as unknown as typeof fetch,
    });

    await client.screenshot("/tmp/mgba-frame.png");

    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      URL,
      RequestInit,
    ];
    expect(url.pathname).toBe("/core/screenshot");
    expect(url.searchParams.get("path")).toBe("/tmp/mgba-frame.png");
    expect(init.method).toBe("POST");
  });

  it("reads RAM bytes through the exact core read8 endpoint", async () => {
    const fetchMock = vi.fn(async () => textResponse("12"));
    const client = new MgbaHttpClient({
      baseUrl: "http://127.0.0.1:5000",
      fetch: fetchMock as unknown as typeof fetch,
    });

    await expect(client.read8(0xd3_5e)).resolves.toBe(12);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      URL,
      RequestInit,
    ];
    expect(url.toString()).toBe(
      "http://127.0.0.1:5000/core/read8?address=0xD35E"
    );
    expect(init.method).toBe("GET");
  });

  it("parses active buttons and ignores unknown values", async () => {
    const fetchMock = vi.fn(async () => textResponse("A,Down,Turbo"));
    const client = new MgbaHttpClient({
      baseUrl: "http://127.0.0.1:5000",
      fetch: fetchMock as unknown as typeof fetch,
    });

    await expect(client.getAllButtons()).resolves.toEqual(["A", "Down"]);
  });

  it("throws a useful error on non-2xx responses", async () => {
    const fetchMock = vi.fn(async () =>
      textResponse("socket down", {
        status: 503,
        statusText: "Service Unavailable",
      })
    );
    const client = new MgbaHttpClient({
      baseUrl: "http://127.0.0.1:5000",
      fetch: fetchMock as unknown as typeof fetch,
    });

    await expect(client.tap("Start")).rejects.toThrow(
      "503 Service Unavailable"
    );
  });

  it("retries transient status endpoint failures once", async () => {
    const fetchMock = vi.fn((input: string | URL | Request) => {
      const url = input instanceof URL ? input : new URL(String(input));
      if (
        url.pathname === "/core/currentframe" &&
        fetchMock.mock.calls.length === 2
      ) {
        return textResponse("temporary", { status: 503 });
      }
      if (url.pathname === "/mgba-http/button/getall") {
        return textResponse("A");
      }
      if (url.pathname === "/core/currentframe") {
        return textResponse("42");
      }
      if (url.pathname === "/core/getgamecode") {
        return textResponse("TEST");
      }
      return textResponse("TEST GAME");
    });
    const client = new MgbaHttpClient({
      baseUrl: "http://127.0.0.1:5000",
      fetch: fetchMock as unknown as typeof fetch,
    });

    await expect(client.status()).resolves.toMatchObject({ frame: 42 });
    expect(
      fetchMock.mock.calls.filter(([input]) => {
        const url = input instanceof URL ? input : new URL(String(input));
        return url.pathname === "/core/currentframe";
      })
    ).toHaveLength(2);
  });

  it("retries transient screenshot failures once", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(textResponse("temporary", { status: 503 }))
      .mockResolvedValueOnce(textResponse("ok"));
    const client = new MgbaHttpClient({
      baseUrl: "http://127.0.0.1:5000",
      fetch: fetchMock as unknown as typeof fetch,
    });

    await expect(client.screenshot("/tmp/mgba-frame.png")).resolves.toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry transient control POST failures", async () => {
    const fetchMock = vi.fn(async () =>
      textResponse("temporary", { status: 503 })
    );
    const client = new MgbaHttpClient({
      baseUrl: "http://127.0.0.1:5000",
      fetch: fetchMock as unknown as typeof fetch,
    });

    await expect(client.tap("A")).rejects.toThrow("503");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("propagates status endpoint failures instead of silently defaulting", async () => {
    const fetchMock = vi.fn((input: string | URL | Request) => {
      const url = input instanceof URL ? input : new URL(String(input));
      if (url.pathname === "/mgba-http/button/getall") {
        return textResponse("");
      }
      return textResponse("core unavailable", { status: 500 });
    });
    const client = new MgbaHttpClient({
      baseUrl: "http://127.0.0.1:5000",
      fetch: fetchMock as unknown as typeof fetch,
    });

    await expect(client.status()).rejects.toThrow("500");
  });
});
