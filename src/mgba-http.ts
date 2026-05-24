export const MGBA_BUTTONS = [
  "A",
  "B",
  "Select",
  "Start",
  "Right",
  "Left",
  "Up",
  "Down",
  "R",
  "L",
] as const;

export type MgbaButton = (typeof MGBA_BUTTONS)[number];
export type MgbaHttpMethod = "GET" | "POST";

const MGBA_TRANSIENT_RETRY_ATTEMPTS = 2;

export interface MgbaRequestOptions {
  method?: MgbaHttpMethod;
  params?: Record<
    string,
    string | number | boolean | readonly (string | number | boolean)[]
  >;
  signal?: AbortSignal;
}

export interface MgbaClientOptions {
  baseUrl: string;
  fetch?: typeof fetch;
}

export interface MgbaStatus {
  activeButtons: MgbaButton[];
  frame: number | null;
  gameCode: string;
  gameTitle: string;
}

export class MgbaHttpError extends Error {
  readonly status: number;
  readonly statusText: string;
  readonly body: string;

  constructor(response: Response, body: string) {
    super(
      `Emulator request failed: ${response.status} ${response.statusText}${
        body ? ` - ${body}` : ""
      }`
    );
    this.name = "MgbaHttpError";
    this.status = response.status;
    this.statusText = response.statusText;
    this.body = body;
  }
}

export class MgbaHttpClient {
  readonly #baseUrl: URL;
  readonly #fetch: typeof fetch;

  constructor({ baseUrl, fetch: fetchImpl = fetch }: MgbaClientOptions) {
    this.#baseUrl = new URL(baseUrl);
    this.#fetch = fetchImpl;
  }

  async request(
    path: string,
    { method = "GET", params = {}, signal }: MgbaRequestOptions = {}
  ): Promise<string> {
    const url = new URL(path, this.#baseUrl);

    for (const [key, value] of Object.entries(params)) {
      const values = Array.isArray(value) ? value : [value];
      for (const item of values) {
        url.searchParams.append(key, String(item));
      }
    }

    for (
      let attempt = 1;
      attempt <= MGBA_TRANSIENT_RETRY_ATTEMPTS;
      attempt += 1
    ) {
      try {
        const response = await this.#fetch(url, { method, signal });
        const body = await response.text();

        if (!response.ok) {
          const error = new MgbaHttpError(response, body);
          if (
            attempt < MGBA_TRANSIENT_RETRY_ATTEMPTS &&
            isRetryableMgbaRequest(path, method) &&
            isTransientMgbaError(error)
          ) {
            continue;
          }
          throw error;
        }

        return body.trim();
      } catch (error) {
        if (
          attempt >= MGBA_TRANSIENT_RETRY_ATTEMPTS ||
          !isRetryableMgbaRequest(path, method) ||
          !isTransientMgbaError(error)
        ) {
          throw error;
        }
      }
    }

    throw new Error("mGBA retry loop exhausted unexpectedly");
  }

  tap(button: MgbaButton, signal?: AbortSignal): Promise<string> {
    return this.request("/mgba-http/button/tap", {
      method: "POST",
      params: { button },
      signal,
    });
  }

  tapMany(
    buttons: readonly MgbaButton[],
    signal?: AbortSignal
  ): Promise<string> {
    return this.request("/mgba-http/button/tapmany", {
      method: "POST",
      params: { buttons },
      signal,
    });
  }

  hold(
    button: MgbaButton,
    duration: number,
    signal?: AbortSignal
  ): Promise<string> {
    return this.request("/mgba-http/button/hold", {
      method: "POST",
      params: { button, duration },
      signal,
    });
  }

  holdMany(
    buttons: readonly MgbaButton[],
    duration: number,
    signal?: AbortSignal
  ): Promise<string> {
    return this.request("/mgba-http/button/holdmany", {
      method: "POST",
      params: { buttons, duration },
      signal,
    });
  }

  add(button: MgbaButton, signal?: AbortSignal): Promise<string> {
    return this.request("/mgba-http/button/add", {
      method: "POST",
      params: { button },
      signal,
    });
  }

  clear(button: MgbaButton, signal?: AbortSignal): Promise<string> {
    return this.request("/mgba-http/button/clear", {
      method: "POST",
      params: { button },
      signal,
    });
  }

  clearMany(
    buttons: readonly MgbaButton[],
    signal?: AbortSignal
  ): Promise<string> {
    return this.request("/mgba-http/button/clearmany", {
      method: "POST",
      params: { buttons },
      signal,
    });
  }

  getAllButtons(signal?: AbortSignal): Promise<MgbaButton[]> {
    return this.request("/mgba-http/button/getall", { signal }).then((body) =>
      body
        .split(",")
        .map((button) => button.trim())
        .filter(isMgbaButton)
    );
  }

  async status(signal?: AbortSignal): Promise<MgbaStatus> {
    const [activeButtons, frameText, gameCode, gameTitle] = await Promise.all([
      this.getAllButtons(signal),
      this.request("/core/currentframe", { signal }),
      this.request("/core/getgamecode", { signal }),
      this.request("/core/getgametitle", { signal }),
    ]);

    const frame = Number.parseInt(frameText, 10);

    return {
      activeButtons,
      frame: Number.isFinite(frame) ? frame : null,
      gameCode,
      gameTitle,
    };
  }

  loadFile(path: string, signal?: AbortSignal): Promise<string> {
    return this.request("/mgba-http/extension/loadfile", {
      method: "POST",
      params: { path },
      signal,
    });
  }

  reset(signal?: AbortSignal): Promise<string> {
    return this.request("/coreadapter/reset", { method: "POST", signal });
  }

  read8(address: number, signal?: AbortSignal): Promise<number> {
    return this.request("/core/read8", {
      params: { address: `0x${address.toString(16).toUpperCase()}` },
      signal,
    }).then((body) => {
      const value = Number.parseInt(body, 10);
      if (!Number.isInteger(value) || value < 0 || value > 255) {
        throw new Error(
          `Invalid read8 response for address ${address}: ${body}`
        );
      }
      return value;
    });
  }

  screenshot(path: string, signal?: AbortSignal): Promise<string> {
    return this.request("/core/screenshot", {
      method: "POST",
      params: { path },
      signal,
    });
  }
}

export function isTransientMgbaError(error: unknown): boolean {
  if (error instanceof MgbaHttpError) {
    return error.status === 408 || error.status === 429 || error.status >= 500;
  }
  if (error instanceof Error && error.name === "AbortError") {
    return false;
  }
  const code = readStringProperty(error, "code");
  return (
    code === "ECONNRESET" ||
    code === "ECONNREFUSED" ||
    code === "ETIMEDOUT" ||
    code === "EAI_AGAIN" ||
    code === "UND_ERR_CONNECT_TIMEOUT" ||
    code === "UND_ERR_HEADERS_TIMEOUT" ||
    code === "UND_ERR_SOCKET"
  );
}

function isRetryableMgbaRequest(path: string, method: MgbaHttpMethod): boolean {
  return method === "GET" || path === "/core/screenshot";
}

function readStringProperty(error: unknown, key: string): string | undefined {
  if (typeof error !== "object" || error === null || !(key in error)) {
    return;
  }
  const value = error[key as keyof typeof error];
  return typeof value === "string" ? value : undefined;
}

function isMgbaButton(value: string): value is MgbaButton {
  return MGBA_BUTTONS.includes(value as MgbaButton);
}
