import type { AgentTools } from "@minpeter/pss-runtime";
import { z } from "zod";
import type { GameMode } from "../control/CommandTypes.js";
import type { MgbaHttpClient } from "../mgba/MgbaHttpClient.js";

const LLM_SLOT_MIN = 0;
const LLM_SLOT_MAX = 7;
const AUTO_CHECKPOINT_SLOT = 8;
const ROLLBACK_SLOT = 9;
const ROLLBACK_COOLDOWN_STEPS = 10;
const MAX_CONSECUTIVE_ROLLBACKS_WITHOUT_PROGRESS = 3;

const slotSchema = z
  .number()
  .int()
  .min(LLM_SLOT_MIN)
  .max(LLM_SLOT_MAX)
  .describe("LLM-accessible save-state slot. Slots 0-7 only; slot 8 is auto-checkpoint, slot 9 is rollback-only.");

const saveInputSchema = z.object({
  slot: slotSchema,
  label: z.string().trim().min(1).max(120).optional(),
});

const loadInputSchema = z.object({ slot: slotSchema });
const rollbackInputSchema = z.object({});

export type SaveLoadAction = "pokemon_save" | "pokemon_load" | "pokemon_load_rollback";

export interface SaveLoadJournalEntry {
  schema: "pokemon.saveload.v1";
  sequence: number;
  step: number;
  action: SaveLoadAction;
  mode: GameMode;
  slot: number;
  label?: string;
  rollbackSlot?: typeof ROLLBACK_SLOT;
  autoCheckpointSlot?: typeof AUTO_CHECKPOINT_SLOT;
  consecutiveRollbacksWithoutProgress?: number;
  progressToken?: number;
}

type JournalWriter = (entry: SaveLoadJournalEntry) => void | Promise<void>;

export interface SaveLoadMemoryStore {
  write?: (section: string, content: string) => Promise<unknown>;
  appendJournalEntry?: JournalWriter;
  appendJournal?: JournalWriter;
  recordJournalEntry?: JournalWriter;
  recordSaveLoadAction?: JournalWriter;
  journal?: SaveLoadJournalEntry[] | { append: JournalWriter };
}

export function createSaveLoadTools(
  client: MgbaHttpClient,
  getMode: () => GameMode,
  memoryStore: SaveLoadMemoryStore,
  getProgressToken: () => number = () => 0,
): AgentTools {
  let step = 0;
  let journalSequence = 0;
  let lastRollbackStep = Number.NEGATIVE_INFINITY;
  let consecutiveRollbacksWithoutProgress = 0;
  let lastRollbackProgressToken = getProgressToken();

  const nextStep = (): number => {
    step += 1;
    return step;
  };

  const record = async (entry: Omit<SaveLoadJournalEntry, "schema" | "sequence">): Promise<void> => {
    journalSequence += 1;
    await appendJournal(memoryStore, {
      schema: "pokemon.saveload.v1",
      sequence: journalSequence,
      ...entry,
    });
  };

  const syncProgress = (): number => {
    const progressToken = getProgressToken();
    if (progressToken !== lastRollbackProgressToken) {
      consecutiveRollbacksWithoutProgress = 0;
      lastRollbackProgressToken = progressToken;
    }
    return progressToken;
  };

  return {
    pokemon_save: {
      description:
        "Save the current emulator state to an LLM-accessible slot (0-7 only). Disabled during battle or dialog. Slot 8 is reserved for auto-checkpoints and slot 9 is reserved for rollback scratch space.",
      inputSchema: saveInputSchema,
      execute: async ({ slot, label }) => {
        const currentStep = nextStep();
        const mode = requireOverworld(getMode(), "pokemon_save");
        const progressToken = syncProgress();

        await client.saveStateSlot(slot);
        await record({ action: "pokemon_save", label, mode, progressToken, slot, step: currentStep });

        return { action: "pokemon_save", label: label ?? null, mode, ok: true, slot };
      },
    },

    pokemon_load: {
      description:
        "Load an LLM-accessible emulator save-state slot (0-7 only). Before loading, the current state is saved automatically to rollback slot 9. Disabled during battle or dialog.",
      inputSchema: loadInputSchema,
      execute: async ({ slot }) => {
        const currentStep = nextStep();
        const mode = requireOverworld(getMode(), "pokemon_load");
        const progressToken = syncProgress();

        await client.saveStateSlot(ROLLBACK_SLOT);
        await client.loadStateSlot(slot);
        await record({ action: "pokemon_load", mode, progressToken, rollbackSlot: ROLLBACK_SLOT, slot, step: currentStep });

        return { action: "pokemon_load", mode, ok: true, rollbackSlot: ROLLBACK_SLOT, slot };
      },
    },

    pokemon_load_rollback: {
      description:
        "Rollback to the protected rollback slot 9 created automatically before the last pokemon_load call. Disabled during battle or dialog and guarded by cooldown: max 1 rollback per 10 tool steps, max 3 consecutive rollbacks without save/load progress.",
      inputSchema: rollbackInputSchema,
      execute: async () => {
        const currentStep = nextStep();
        const mode = requireOverworld(getMode(), "pokemon_load_rollback");
        const progressToken = syncProgress();

        enforceRollbackGuard(currentStep, lastRollbackStep, consecutiveRollbacksWithoutProgress);

        await client.loadStateSlot(ROLLBACK_SLOT);
        lastRollbackStep = currentStep;
        consecutiveRollbacksWithoutProgress += 1;
        await record({
          action: "pokemon_load_rollback",
          consecutiveRollbacksWithoutProgress,
          mode,
          progressToken,
          slot: ROLLBACK_SLOT,
          step: currentStep,
        });

        return {
          action: "pokemon_load_rollback",
          consecutiveRollbacksWithoutProgress,
          mode,
          ok: true,
          slot: ROLLBACK_SLOT,
        };
      },
    },
  } satisfies AgentTools;
}

function requireOverworld(mode: GameMode, action: SaveLoadAction): "overworld" {
  if (mode !== "overworld") {
    throw new Error(`${action} is disabled in ${mode} mode; save/load is allowed only in overworld mode.`);
  }

  return mode;
}

function enforceRollbackGuard(
  currentStep: number,
  lastRollbackStep: number,
  consecutiveRollbacksWithoutProgress: number
): void {
  const stepsSinceRollback = currentStep - lastRollbackStep;
  if (stepsSinceRollback < ROLLBACK_COOLDOWN_STEPS) {
    throw new Error(
      `pokemon_load_rollback cooldown active: ${stepsSinceRollback} step(s) since last rollback, ${ROLLBACK_COOLDOWN_STEPS} required.`
    );
  }

  if (consecutiveRollbacksWithoutProgress >= MAX_CONSECUTIVE_ROLLBACKS_WITHOUT_PROGRESS) {
    throw new Error(
      `pokemon_load_rollback blocked: ${MAX_CONSECUTIVE_ROLLBACKS_WITHOUT_PROGRESS} consecutive rollbacks without agent progress.`
    );
  }
}

async function appendJournal(memoryStore: SaveLoadMemoryStore, entry: SaveLoadJournalEntry): Promise<void> {
  const writer =
    memoryStore.recordSaveLoadAction ??
    memoryStore.appendJournalEntry ??
    memoryStore.recordJournalEntry ??
    memoryStore.appendJournal;

  if (writer !== undefined) {
    await writer(entry);
    return;
  }

  if (memoryStore.write !== undefined) {
    await memoryStore.write("journal", formatJournalContent(entry));
    return;
  }

  if (Array.isArray(memoryStore.journal)) {
    memoryStore.journal.push(entry);
    return;
  }

  if (memoryStore.journal !== undefined) {
    await memoryStore.journal.append(entry);
  }
}

function formatJournalContent(entry: SaveLoadJournalEntry): string {
  return JSON.stringify(entry);
}
