import { MgbaHttpClient } from "../src/mgba/MgbaHttpClient.js";
import { PokemonStateReader } from "../src/game/PokemonStateReader.js";
import { readGameWorld } from "../src/game/GameWorld.js";
import { MapMemory } from "../src/game/MapMemory.js";
import { executeNavigate, type NavigateController, type NavigateWorldReader, type NavigateMapSource } from "../src/executor/NavigateExecutor.js";
import { RED_BLUE_MEMORY_MAP } from "../src/game/memoryMap.js";
import type { NavigateCommand } from "../src/control/CommandTypes.js";
import { mapName } from "../src/game/PokemonCatalog.js";

const client = new MgbaHttpClient({ baseUrl: "http://127.0.0.1:5001" });
const stateReader = new PokemonStateReader({ client, version: "red" });
const ramMap = RED_BLUE_MEMORY_MAP;

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

const controller: NavigateController = {
  async pressButton(button, frames = 5) {
    console.log(`  > ${button} (${frames}f)`);
    await client.holdButton(button, frames);
    await sleep(frames * (1000 / 60) + 100);
  }
};

function createWorldReader(): NavigateWorldReader {
  return {
    async readPosition() {
      const s = await stateReader.readState();
      return { mapId: s.wCurMap, y: s.wYCoord, x: s.wXCoord };
    },
    async readWalkCounter() {
      return client.read8(ramMap.wWalkCounter);
    },
    async isInBattle() {
      return (await client.read8(ramMap.wIsInBattle)) !== 0;
    },
    async isDialogActive() {
      const tb = await client.read8(ramMap.wTextBoxID);
      const ji = await client.read8(ramMap.wJoyIgnore);
      return tb !== 0 && ji !== 0;
    }
  };
}

async function buildMapMemory(): Promise<MapMemory> {
  const memory = new MapMemory();
  const world = await readGameWorld(client);
  const tileMapBytes = await client.readRange(ramMap.wTileMap, ramMap.wTileMapLength);
  memory.update(world, tileMapBytes);
  return memory;
}

async function navigate(x: number, y: number, memory: MapMemory, label: string) {
  const pos = await createWorldReader().readPosition();
  console.log(`\n[${label}] ${mapName(pos.mapId)} (${pos.x},${pos.y}) → (${x},${y})`);

  const mapSource: NavigateMapSource = {
    walkabilityGrid(mapId) { return memory.walkabilityGrid(mapId) ?? undefined; }
  };

  const cmd: NavigateCommand = { type: "navigate", x, y };
  const result = await executeNavigate(cmd, controller, createWorldReader(), mapSource);
  console.log(`  Result: ${result.status} — ${result.reason}${result.details ? " (" + result.details + ")" : ""}`);
  return result;
}

async function refreshMap(memory: MapMemory) {
  const world = await readGameWorld(client);
  const bytes = await client.readRange(ramMap.wTileMap, ramMap.wTileMapLength);
  memory.update(world, bytes);
  return world;
}

async function main() {
  const state = await stateReader.readState();
  console.log(`Start: map=${state.wCurMap} (${mapName(state.wCurMap)}) y=${state.wYCoord} x=${state.wXCoord} battle=${state.wIsInBattle}`);

  if (state.wIsInBattle !== 0) {
    console.log("Still in battle! Finish the battle first.");
    return;
  }

  let memory = await buildMapMemory();
  const currentMap = state.wCurMap;

  // Oak's Lab = map 40. Warp to it from Pallet Town (map 0).
  // If already in Pallet Town, walk to Oak's Lab warp.
  // If on Route 1, walk south to Pallet Town first.

  if (currentMap === 40) {
    console.log("Already in Oak's Lab!");
    return;
  }

  if (currentMap === 12) {
    // Route 1 → walk south toward Pallet Town
    console.log("\nOn Route 1. Walking south to Pallet Town...");

    // Navigate to south exit (bottom of map)
    let world = await readGameWorld(client);
    const mapHeight = world.mapLayout.height * 2;
    console.log(`Route 1 height: ${mapHeight} tiles`);

    // Walk south step by step, refreshing map each time
    let attempts = 0;
    while (attempts < 50) {
      const pos = await createWorldReader().readPosition();
      if (pos.mapId !== 12) {
        console.log(`\nMap changed to ${mapName(pos.mapId)} (${pos.mapId})!`);
        break;
      }

      memory = await buildMapMemory();
      world = await refreshMap(memory);
      
      const ascii = memory.renderAscii(pos.mapId, pos.y, pos.x);
      if (attempts % 5 === 0) {
        console.log(`\n--- Position (${pos.x},${pos.y}) ---`);
        console.log(ascii);
      }

      // Try to go south
      const result = await navigate(pos.x, pos.y + 3, memory, `step ${attempts}`);
      
      if (result.status === "interrupted") {
        if (result.reason === "battle_started") {
          console.log("\nBattle encountered! Run the battle script first, then re-run.");
          return;
        }
        if (result.reason === "map_changed") {
          console.log("\nMap changed!");
          break;
        }
      }

      attempts++;
      await sleep(200);
    }
  }

  // Check if we're now in Pallet Town
  const nowState = await stateReader.readState();
  if (nowState.wCurMap !== 0) {
    console.log(`\nNot in Pallet Town yet (map=${nowState.wCurMap} ${mapName(nowState.wCurMap)}). Manual navigation needed.`);
    return;
  }

  // In Pallet Town → navigate to Oak's Lab warp
  console.log("\nIn Pallet Town! Heading to Oak's Lab...");
  memory = await buildMapMemory();
  
  let world = await refreshMap(memory);
  const ascii = memory.renderAscii(0, nowState.wYCoord, nowState.wXCoord);
  console.log("\n=== Pallet Town ===");
  console.log(ascii);

  // Oak's Lab entrance is typically at (5,3) or similar in Pallet Town
  // Read warps to find it
  const { readWarps } = await import("../src/game/WarpReader.js");
  const warps = await readWarps(client);
  console.log("\nWarps on this map:");
  for (const w of warps.warps) {
    console.log(`  (${w.x},${w.y}) → map ${w.destMapId} (${mapName(w.destMapId)})`);
  }

  const oakLabWarp = warps.warps.find(w => w.destMapId === 40);
  if (!oakLabWarp) {
    console.log("No warp to Oak's Lab found on this map!");
    return;
  }

  console.log(`\nOak's Lab warp at (${oakLabWarp.x},${oakLabWarp.y})`);

  // Navigate to the warp tile — retry on partial (progressive map discovery)
  for (let attempt = 0; attempt < 10; attempt++) {
    memory = await buildMapMemory();
    await refreshMap(memory);

    const navResult = await navigate(oakLabWarp.x, oakLabWarp.y, memory, `attempt ${attempt + 1}`);

    if (navResult.status === "interrupted" && navResult.reason === "map_changed") {
      const final = await stateReader.readState();
      console.log(`\n=== ARRIVED! map=${final.wCurMap} (${mapName(final.wCurMap)}) y=${final.wYCoord} x=${final.wXCoord} ===`);
      return;
    }
    
    if (navResult.status === "interrupted" && navResult.reason === "battle_started") {
      console.log("\nBattle encountered during navigation! Finish battle first.");
      return;
    }

    if (navResult.status === "success") {
      // At warp tile — might auto-warp or need to step
      await sleep(300);
      const check = await stateReader.readState();
      if (check.wCurMap === 40) {
        console.log(`\n=== ARRIVED! Oak's Lab! y=${check.wYCoord} x=${check.wXCoord} ===`);
        return;
      }
      // Try stepping down onto warp
      console.log("At warp tile, stepping down...");
      await controller.pressButton("Down", 5);
      await sleep(500);
      const final = await stateReader.readState();
      console.log(`\n=== RESULT: map=${final.wCurMap} (${mapName(final.wCurMap)}) y=${final.wYCoord} x=${final.wXCoord} ===`);
      return;
    }

    if (navResult.status === "partial") {
      console.log("  Partial — retrying with updated map...");
      await sleep(200);
      continue;
    }

    console.log(`Navigation failed: ${JSON.stringify(navResult)}`);
    return;
  }

  console.log("Exhausted retries.");
}

main().catch(console.error);
