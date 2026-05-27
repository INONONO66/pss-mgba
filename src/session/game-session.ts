import {
  createModeMismatchEvent,
  createSessionState,
  type GameMode,
  type MiniState,
  type SessionState,
} from "./types.js";

export interface GameSessionMiniStateReader {
  read(): Promise<MiniState>;
}

export interface GameSessionFullState<TFullState> {
  readonly evidenceMode?: GameMode;
  readonly value: TFullState;
}

export interface GameSessionFullStateReader<TFullState> {
  read(sessionState: SessionState): Promise<GameSessionFullState<TFullState>>;
}

export type GameSessionSyncHook<TFullState> = (
  input: GameSessionSyncResult<TFullState>
) => Promise<void> | void;

export interface GameSessionOptions<TFullState> {
  readonly fullStateReader: GameSessionFullStateReader<TFullState>;
  readonly miniStateReader: GameSessionMiniStateReader;
  readonly onSync?: GameSessionSyncHook<TFullState>;
}

export interface GameSessionSyncResult<TFullState> {
  readonly fullState: TFullState;
  readonly sessionState: SessionState;
}

/**
 * Central sync authority for the staged session rewrite.
 *
 * `SessionState.mode` is derived from MiniState and is authoritative. Any mode
 * exposed by a domain/full-state reader is retained as diagnostic evidence only.
 */
export class GameSession<TFullState> {
  private readonly fullStateReader: GameSessionFullStateReader<TFullState>;
  private readonly miniStateReader: GameSessionMiniStateReader;
  private readonly onSync?: GameSessionSyncHook<TFullState>;
  private state: SessionState | undefined;

  constructor(options: GameSessionOptions<TFullState>) {
    this.fullStateReader = options.fullStateReader;
    this.miniStateReader = options.miniStateReader;
    this.onSync = options.onSync;
  }

  get sessionState(): SessionState | undefined {
    return this.state;
  }

  async syncFullState(): Promise<GameSessionSyncResult<TFullState>> {
    const miniState = await this.miniStateReader.read();
    const previousEvents = this.state?.events ?? [];
    let sessionState = createSessionState(miniState, previousEvents);
    const fullStateEvidence = await this.fullStateReader.read(sessionState);

    if (
      fullStateEvidence.evidenceMode !== undefined &&
      fullStateEvidence.evidenceMode !== sessionState.mode
    ) {
      sessionState = createSessionState(miniState, [
        ...previousEvents,
        createModeMismatchEvent({
          sessionState,
          evidenceMode: fullStateEvidence.evidenceMode,
          evidenceSource: "full-state-reader",
        }),
      ]);
    }

    const result = {
      fullState: fullStateEvidence.value,
      sessionState,
    } satisfies GameSessionSyncResult<TFullState>;
    await this.onSync?.(result);
    this.state = sessionState;
    return result;
  }
}
