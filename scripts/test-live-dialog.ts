import "dotenv/config";
import {
  type ExecutionContext,
  executeCommand,
} from "../src/executor/CommandExecutor.js";
import {
  createDialogStateReader,
  createInteractStateReader,
  createNavigateMapSource,
  createNavigateWorldReader,
  createUnifiedController,
  type RamReader,
  toCommandGameMode,
} from "../src/executor/MgbaAdapters.js";
import { MgbaHttpClient } from "../src/mgba/MgbaHttpClient.js";
import { readGameWorld } from "../src/game/GameWorld.js";
import { MapMemory } from "../src/game/MapMemory.js";
import { PokemonStateReader } from "../src/game/PokemonStateReader.js";
import { InputGate } from "../src/session/input-gate.js";
import { MiniStateReader } from "../src/session/mini-state-reader.js";

const baseUrl = process.env.MGBA_HTTP_BASE_URL ?? "http://127.0.0.1:5001";
const settleMs = Number(process.env.LIVE_DIALOG_SETTLE_MS ?? 350);

async function main(): Promise<void> {
  const client = new MgbaHttpClient({ baseUrl });
  const stateReader = new PokemonStateReader({ client, version: "red" });
  const mapMemory = new MapMemory();
  const context = await createLiveContext(client, stateReader, mapMemory);

  const before = await readLiveState(client, stateReader, mapMemory);
  logState("before", before);

  if (before.mode === "dialog") {
    console.log("\n[ACTION] already in dialog; skipping extra A interaction.");
  } else {
    console.log(
      "\n[ACTION] interact(): pressing A against the faced tile/NPC."
    );
    const interactResult = await executeCommand(
      { type: "interact" },
      { ...context, mode: "overworld" }
    );
    console.log(`[RESULT] interact → ${formatResult(interactResult)}`);
    await sleep(settleMs);

    for (let attempt = 0; attempt < 10; attempt++) {
      const poll = await readLiveState(client, stateReader, mapMemory);
      if (poll.mode === "dialog") {
        break;
      }
      await sleep(200);
    }
  }

  const afterInteract = await readLiveState(client, stateReader, mapMemory);
  logState("after-interact", afterInteract);

  if (afterInteract.mode !== "dialog") {
    throw new Error(
      "Expected dialog mode after pressing A, but no active dialog was detected. Check facing/NPC position."
    );
  }

  console.log("\n[CHECK] Dialog opened and was decoded from live RAM/tilemap.");
  console.log(
    `[CHECK] Screen text: ${JSON.stringify(afterInteract.screenText)}`
  );
  console.log(
    `[CHECK] textBoxId=${afterInteract.textBoxId} joyIgnore=${afterInteract.joyIgnore}`
  );

  console.log(
    "\n[ACTION] dialog(advance): auto-advancing until dialog ends or a choice/naming screen appears."
  );
  const dialogResult = await executeCommand(
    { type: "dialog", action: { kind: "advance" } },
    { ...context, mode: "dialog" }
  );
  console.log(`[RESULT] dialog advance → ${formatResult(dialogResult)}`);
  await sleep(settleMs);

  const finalState = await readLiveState(client, stateReader, mapMemory);
  logState("final", finalState);

  if (
    dialogResult.reason === "choice_appeared" ||
    dialogResult.reason === "naming_screen"
  ) {
    console.log("\n[PASS] Dialog stopped at an LLM-relevant prompt.");
    return;
  }

  if (dialogResult.reason === "dialog_ended") {
    console.log("\n[PASS] Dialog opened, text was inspected, and dialog cleared.");
    return;
  }

  if (finalState.mode === "dialog") {
    throw new Error(
      "Dialog advance returned without reaching a choice/naming prompt or clearing dialog."
    );
  }

  console.log(
    "\n[PASS] Dialog opened, text was inspected, and non-choice dialog cleared."
  );
}

async function createLiveContext(
  client: MgbaHttpClient,
  stateReader: PokemonStateReader,
  mapMemory: MapMemory
): Promise<ExecutionContext> {
  const ram: RamReader = {
    holdButton: (button, frames) => client.holdButton(button, frames),
    read8: (address) => client.read8(address),
    readRange: (address, length) => client.readRange(address, length),
  };
  const world = await readGameWorld(client);
  mapMemory.update(world, world.tileMapBytes);
  const menuText = await stateReader.readMenuTextState({
    tileMapBytes: world.tileMapBytes,
  });
  const fullState = await stateReader.readFullState({ menuText });
  const controller = createUnifiedController(ram);
  const inputGate = new InputGate({
    controller,
    reader: new MiniStateReader(client),
  });

  return {
    controller,
    dialogStateReader: createDialogStateReader(ram),
    fullState,
    inputGate,
    interactStateReader: createInteractStateReader(ram),
    mapHeight: world.mapLayout.height * 2,
    mapWidth: world.mapLayout.width * 2,
    mode: toCommandGameMode(world.mode),
    navigateMapSource: createNavigateMapSource(mapMemory),
    navigateWorldReader: createNavigateWorldReader(ram),
  };
}

async function readLiveState(
  client: MgbaHttpClient,
  stateReader: PokemonStateReader,
  mapMemory: MapMemory
): Promise<{
  readonly joyIgnore: number;
  readonly mapId: number;
  readonly mode: string;
  readonly screenText: string;
  readonly textBoxId: number;
  readonly x: number;
  readonly y: number;
}> {
  const world = await readGameWorld(client);
  mapMemory.update(world, world.tileMapBytes);
  const menuText = await stateReader.readMenuTextState({
    tileMapBytes: world.tileMapBytes,
  });
  const fullState = await stateReader.readFullState({ menuText });

  return {
    joyIgnore: fullState.dialog.joyIgnore,
    mapId: fullState.map.mapId,
    mode: toCommandGameMode(world.mode),
    screenText: fullState.menuText.screenText,
    textBoxId: fullState.dialog.textBoxId,
    x: fullState.player.position.x,
    y: fullState.player.position.y,
  };
}

function logState(
  label: string,
  state: Awaited<ReturnType<typeof readLiveState>>
): void {
  console.log(
    `[STATE:${label}] mode=${state.mode} map=${state.mapId} pos=(${state.x},${state.y}) textBoxId=${state.textBoxId} joyIgnore=${state.joyIgnore} text=${JSON.stringify(state.screenText)}`
  );
}

function formatResult(result: {
  readonly details?: string;
  readonly reason: string;
  readonly status: string;
}): string {
  return `${result.status}:${result.reason}${result.details === undefined ? "" : ` (${result.details})`}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
