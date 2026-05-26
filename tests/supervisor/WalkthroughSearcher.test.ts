import { afterEach, describe, expect, it, vi } from "vitest";
import { WalkthroughSearcher } from "../../src/supervisor/index.js";

describe("WalkthroughSearcher", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("returns empty when no API key", async () => {
    const searcher = new WalkthroughSearcher({ apiKey: undefined });

    const result = await searcher.search("Viridian City", 0);

    expect(result).toEqual({ query: "", sections: [] });
  });

  it("returns empty when API key is empty string", async () => {
    const searcher = new WalkthroughSearcher({ apiKey: "" });

    const result = await searcher.search("Viridian City", 0);

    expect(result).toEqual({ query: "", sections: [] });
  });

  it("enabled returns false without API key", () => {
    const searcher = new WalkthroughSearcher({ apiKey: "" });

    expect(searcher.enabled).toBe(false);
  });

  it("caches search results", async () => {
    const mockFetch = vi.fn(() => Promise.resolve(mockResponse()));
    vi.stubGlobal("fetch", mockFetch);
    const searcher = new WalkthroughSearcher({ apiKey: "test-key" });

    const first = await searcher.search("Viridian City", 0);
    const second = await searcher.search("Viridian City", 0);

    expect(first).toEqual(second);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("handles fetch errors gracefully", async () => {
    const mockFetch = vi.fn(() => Promise.reject(new Error("network down")));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", mockFetch);
    const searcher = new WalkthroughSearcher({ apiKey: "test-key" });

    const result = await searcher.search("Viridian City", 0);

    expect(result).toEqual({
      query: "Pokemon Red walkthrough Viridian City guide what to do",
      sections: [],
    });
    expect(warn).toHaveBeenCalledWith("WalkthroughSearcher failed to search walkthrough", expect.any(Error));
  });

  it("parses Exa response correctly", async () => {
    const mockFetch = vi.fn(() => Promise.resolve(mockResponse()));
    vi.stubGlobal("fetch", mockFetch);
    const searcher = new WalkthroughSearcher({ apiKey: "test-key", maxResults: 3, maxCharsPerResult: 2000 });

    const result = await searcher.search("Viridian City", 0);

    expect(result).toEqual({
      query: "Pokemon Red walkthrough Viridian City guide what to do",
      sections: [{
        title: "Viridian City - Pokemon Red Walkthrough",
        url: "https://gamefaqs.gamespot.com/...",
        text: "Head inside the Poke Mart and the attendant will hand over Oak's Parcel.",
      }],
    });
    expect(mockFetch).toHaveBeenCalledWith("https://api.exa.ai/search", expect.objectContaining({
      method: "POST",
      headers: {
        "x-api-key": "test-key",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: "Pokemon Red walkthrough Viridian City guide what to do",
        numResults: 3,
        type: "auto",
        contents: {
          text: { maxCharacters: 2000 },
        },
      }),
    }));
  });
});

function mockResponse(): Response {
  return {
    ok: true,
    json: async () => ({
      results: [
        {
          title: "Viridian City - Pokemon Red Walkthrough",
          url: "https://gamefaqs.gamespot.com/...",
          text: "Head inside the Poke Mart and the attendant will hand over Oak's Parcel.",
        },
      ],
    }),
  } as Response;
}
