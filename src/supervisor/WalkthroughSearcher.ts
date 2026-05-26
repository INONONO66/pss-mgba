const EXA_SEARCH_URL = "https://api.exa.ai/search";
const DEFAULT_MAX_RESULTS = 2;
const DEFAULT_MAX_CHARS_PER_RESULT = 1500;
const DEFAULT_CACHE_TTL_MS = 300_000;

export interface WalkthroughSearcherConfig {
  readonly apiKey?: string;
  readonly maxResults?: number;
  readonly maxCharsPerResult?: number;
  readonly cacheTtlMs?: number;
}

export interface WalkthroughSearchResult {
  readonly query: string;
  readonly sections: readonly WalkthroughSection[];
}

export interface WalkthroughSection {
  readonly title: string;
  readonly url: string;
  readonly text: string;
}

interface ExaSearchResponse {
  readonly results?: readonly ExaSearchItem[];
}

interface ExaSearchItem {
  readonly title?: unknown;
  readonly url?: unknown;
  readonly text?: unknown;
}

export class WalkthroughSearcher {
  private readonly config: Required<WalkthroughSearcherConfig>;
  private readonly cache = new Map<string, { result: WalkthroughSearchResult; timestamp: number }>();

  constructor(config: WalkthroughSearcherConfig = {}) {
    this.config = {
      apiKey: config.apiKey ?? process.env.EXA_API_KEY ?? "",
      maxResults: config.maxResults ?? DEFAULT_MAX_RESULTS,
      maxCharsPerResult: config.maxCharsPerResult ?? DEFAULT_MAX_CHARS_PER_RESULT,
      cacheTtlMs: config.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS,
    };
  }

  get enabled(): boolean {
    return this.config.apiKey.length > 0;
  }

  async search(mapName: string, badges: number, stuckContext?: string): Promise<WalkthroughSearchResult> {
    if (!this.enabled) {
      return emptyResult();
    }

    const query = buildQuery(mapName, badges, stuckContext);
    const cached = this.cache.get(query);
    const now = Date.now();
    if (cached && now - cached.timestamp < this.config.cacheTtlMs) {
      return cached.result;
    }

    try {
      const response = await fetch(EXA_SEARCH_URL, {
        method: "POST",
        headers: {
          "x-api-key": this.config.apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query,
          numResults: this.config.maxResults,
          type: "auto",
          contents: {
            text: { maxCharacters: this.config.maxCharsPerResult },
          },
        }),
      });

      if (!response.ok) {
        console.warn("WalkthroughSearcher failed to search walkthrough", new Error(`Exa search failed: ${response.status}`));
        return emptyResult(query);
      }

      const data = await response.json() as ExaSearchResponse;
      const result: WalkthroughSearchResult = {
        query,
        sections: (data.results ?? []).map(toSection).filter(isCompleteSection),
      };
      this.cache.set(query, { result, timestamp: now });
      return result;
    } catch (error) {
      console.warn("WalkthroughSearcher failed to search walkthrough", error);
      return emptyResult(query);
    }
  }
}

function buildQuery(mapName: string, badges: number, stuckContext: string | undefined): string {
  const parts = ["Pokemon Red walkthrough", mapName, "guide what to do"];
  if (badges > 0) {
    parts.push(`${badges} badges`);
  }
  const trimmedContext = stuckContext?.trim();
  if (trimmedContext) {
    parts.push(trimmedContext);
  }
  return parts.join(" ");
}

function emptyResult(query = ""): WalkthroughSearchResult {
  return { query, sections: [] };
}

function toSection(item: ExaSearchItem): WalkthroughSection {
  return {
    title: typeof item.title === "string" ? item.title : "",
    url: typeof item.url === "string" ? item.url : "",
    text: typeof item.text === "string" ? item.text : "",
  };
}

function isCompleteSection(section: WalkthroughSection): boolean {
  return section.title.length > 0 && section.url.length > 0 && section.text.length > 0;
}
