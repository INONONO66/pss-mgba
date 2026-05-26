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

async function main() {
  const state = await stateReader.readState();
  const world = await readGameWorld(client);
  const memory = new MapMemory();
  memory.update(world, world.tileMapBytes);

  const mapId = state.wCurMap;
  const playerY = state.wYCoord;
  const playerX = state.wXCoord;
  const mapW = world.mapLayout.width * 2;
  const mapH = world.mapLayout.height * 2;

  console.log("Map: " + mapName(mapId) + " (id=" + mapId + ")");
  console.log("Player: (" + playerX + ", " + playerY + ")");
  console.log("Map size: " + mapW + "x" + mapH);

  const connections = world.warps?.connections;
  if (connections) {
    const dirs = [];
    if (connections.north) dirs.push("north->" + mapName(connections.north.mapId));
    if (connections.south) dirs.push("south->" + mapName(connections.south.mapId));
    if (connections.east) dirs.push("east->" + mapName(connections.east.mapId));
    if (connections.west) dirs.push("west->" + mapName(connections.west.mapId));
    console.log("Connections: " + dirs.join(", "));
  }

  let targetY = playerY;
  let targetX = playerX;
  let direction = "";

  if (connections?.south) {
    targetY = mapH - 1;
    targetX = playerX;
    direction = "south -> " + mapName(connections.south.mapId);
  } else if (connections?.north) {
    targetY = 0;
    targetX = playerX;
    direction = "north -> " + mapName(connections.north.mapId);
  } else if (connections?.east) {
    targetX = mapW - 1;
    targetY = playerY;
    direction = "east -> " + mapName(connections.east.mapId);
  } else if (connections?.west) {
    targetX = 0;
    targetY = playerY;
    direction = "west -> " + mapName(connections.west.mapId);
  } else {
    console.log("No map connections found. Cannot test map transition.");
    return;
  }

  const isVertical = connections?.south || connections?.north;
  const finalTarget = { x: targetX, y: targetY };

  console.log("\nNavigating " + direction + " using repeated navigate+refresh...\n");

  const startMapId = mapId;

  for (let attempt = 1; attempt <= 30; attempt++) {
    const freshWorld = await readGameWorld(client);
    memory.update(freshWorld, freshWorld.tileMapBytes);

    const pos = await createWorldReader().readPosition();
    if (pos.mapId !== startMapId) {
      console.log("[PASS] Map transitioned to " + mapName(pos.mapId) + " at (" + pos.x + ", " + pos.y + ")");
      return;
    }

    const currentGrid = memory.walkabilityGrid(pos.mapId);
    if (!currentGrid) {
      console.log("No grid available");
      return;
    }

    let stepTarget = { x: finalTarget.x, y: finalTarget.y };
    if (isVertical) {
      const dir = finalTarget.y > pos.y ? 1 : -1;
      let bestY = pos.y;
      for (let y = pos.y + dir; y >= 0 && y < currentGrid.height; y += dir) {
        if (currentGrid.grid[y]?.[pos.x] === true) {
          bestY = y;
        } else {
          break;
        }
      }
      if (bestY === pos.y) {
        for (let x = 0; x < currentGrid.width; x++) {
          const testY = pos.y + dir;
          if (testY >= 0 && testY < currentGrid.height && currentGrid.grid[testY]?.[x] === true) {
            stepTarget = { x, y: testY };
            break;
          }
        }
      } else {
        stepTarget = { x: pos.x, y: bestY };
      }
    }

    console.log("Step " + attempt + ": (" + pos.x + "," + pos.y + ") -> (" + stepTarget.x + "," + stepTarget.y + ")");

    const mapSource: NavigateMapSource = {
      walkabilityGrid(id) { return memory.walkabilityGrid(id) ?? undefined; }
    };
    const cmd: NavigateCommand = { type: "navigate", x: stepTarget.x, y: stepTarget.y };
    const result = await executeNavigate(cmd, controller, createWorldReader(), mapSource);
    console.log("  " + result.status + "/" + result.reason + (result.details ? " " + result.details : ""));

    if (result.reason === "map_transition") {
      const after = await createWorldReader().readPosition();
      console.log("\n[PASS] map_transition! Now at " + mapName(after.mapId) + " (" + after.x + "," + after.y + ")");
      return;
    }
    if (result.reason === "map_changed") {
      const after = await createWorldReader().readPosition();
      console.log("\n[FAIL] map_changed (interrupted). Now at " + mapName(after.mapId) + " (" + after.x + "," + after.y + ")");
      return;
    }
    if (result.reason === "battle_started" || result.reason === "dialog_opened") {
      console.log("[INFO] Interrupted: " + result.reason);
      return;
    }
  }

  console.log("\n[INFO] Did not reach map edge after 30 steps.");
}

main().catch(console.error);
