import { RED_BLUE_MEMORY_MAP } from "../pokemon/memoryMap.js";
import { RWY_ADDRESS, WINDOW_HIDDEN_Y } from "../pokemon/GameWorld.js";

const map = RED_BLUE_MEMORY_MAP;

/** Polling interval in milliseconds between readiness checks. */
const POLL_INTERVAL_MS = 50;

/** Default timeout in milliseconds before giving up on input readiness. */
const DEFAULT_TIMEOUT_MS = 5000;

/** Minimum consecutive ready readings to confirm stability. */
const STABLE_COUNT = 2;

export interface InputReadinessReader {
  read8(address: number): Promise<number>;
}

export interface InputReadinessResult {
  /** Whether the game reached a confirmed input-ready state. */
  readonly ready: boolean;
  /** Final joyIgnore value observed. */
  readonly joyIgnore: number;
  /** Final walkCounter value observed. */
  readonly walkCounter: number;
  /** Final window Y register value observed. */
  readonly windowY: number;
  /** Number of poll iterations before settling. */
  readonly polls: number;
  /** Whether the wait timed out. */
  readonly timedOut: boolean;
}

export interface WaitForInputReadyOptions {
  /** Timeout in milliseconds. Defaults to 5000. */
  readonly timeoutMs?: number;
  /** Custom sleep function for testing. */
  readonly sleep?: (ms: number) => Promise<void>;
  /**
   * When true, dialog-active state (windowY < 144) is treated as ready.
   * Use this when the caller expects the game to be in dialog mode
   * (e.g. after an interact that triggers dialog).
   */
  readonly allowDialog?: boolean;
}

/**
 * Wait until the game is in an input-ready state before proceeding.
 *
 * Input-ready means:
 * - wJoyIgnore === 0  (no input lockout from scripts)
 * - wWalkCounter === 0 (no movement animation in progress)
 *
 * If `allowDialog` is false (default), also requires:
 * - rWY >= 144 (no dialog window on screen)
 *
 * Polls RAM at POLL_INTERVAL_MS intervals, requiring STABLE_COUNT
 * consecutive ready readings to confirm. Returns immediately if
 * already ready. Returns current state on timeout without throwing.
 */
export async function waitForInputReady(
  reader: InputReadinessReader,
  options: WaitForInputReadyOptions = {},
): Promise<InputReadinessResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const sleepFn =
    options.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const allowDialog = options.allowDialog ?? false;

  let polls = 0;
  let consecutiveReady = 0;
  const deadline = Date.now() + timeoutMs;

  while (true) {
    const [joyIgnore, walkCounter, windowY] = await Promise.all([
      reader.read8(map.wJoyIgnore),
      reader.read8(map.wWalkCounter),
      reader.read8(RWY_ADDRESS),
    ]);

    const dialogActive = windowY < WINDOW_HIDDEN_Y;
    const dialogBlocking = !allowDialog && dialogActive;
    const joyIgnoreBlocking = dialogActive ? false : joyIgnore !== 0;
    const isReady =
      !joyIgnoreBlocking && walkCounter === 0 && !dialogBlocking;

    if (isReady) {
      consecutiveReady += 1;
      if (consecutiveReady >= STABLE_COUNT) {
        return { ready: true, joyIgnore, walkCounter, windowY, polls, timedOut: false };
      }
    } else {
      consecutiveReady = 0;
    }

    if (Date.now() >= deadline) {
      return { ready: false, joyIgnore, walkCounter, windowY, polls, timedOut: true };
    }

    polls += 1;
    await sleepFn(POLL_INTERVAL_MS);
  }
}
