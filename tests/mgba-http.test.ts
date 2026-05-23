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
