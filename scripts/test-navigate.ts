import { MgbaHttpClient } from "../src/mgba/MgbaHttpClient.js";
import { PokemonStateReader } from "../src/game/PokemonStateReader.js";
import { readGameWorld } from "../src/game/GameWorld.js";
import { MapMemory } from "../src/game/MapMemory.js";
import { executeNavigate, type NavigateController, type NavigateWorldReader, type NavigateMapSource } from "../src/executor/NavigateExecutor.js";
import { RED_BLUE_MEMORY_MAP } from "../src/game/memoryMap.js";
import type { NavigateCommand } from "../src/control/CommandTypes.js";

async function main() {
  const client = new MgbaHttpClient({ baseUrl: "http://127.0.0.1:5001" });
  const stateReader = new PokemonStateReader({ client, version: "red" });
  const map = RED_BLUE_MEMORY_MAP;

  const state = await stateReader.readState();
  console.log(`Current position: map=${state.wCurMap} y=${state.wYCoord} x=${state.wXCoord}`);
  console.log(`Battle: ${state.wIsInBattle}, Party: ${state.wPartyCount}`);

  const world = await readGameWorld(client);
  console.log(`Mode: ${world.mode}`);
  console.log(`Map layout: ${world.mapLayout.width}x${world.mapLayout.height} (mapId=${world.mapLayout.mapId})`);

  const memory = new MapMemory();
  const tileMapBytes = await client.readRange(map.wTileMap, map.wTileMapLength);
  memory.update(world, tileMapBytes);

  const grid = memory.walkabilityGrid(world.mapLayout.mapId);
  if (grid) {
    console.log(`Walkability grid: ${grid.width}x${grid.height}`);
    console.log(`Explored tiles: ${memory.view(world.mapLayout.mapId)?.tileCount}`);
  }

  const ascii = memory.renderAscii(world.mapLayout.mapId, world.playerCoords.y, world.playerCoords.x);
  console.log("\n=== MAP ===");
  console.log(ascii);

  const targetX = 4;
  const targetY = 5;
  console.log(`\nTarget: (${targetX}, ${targetY}) from (${world.playerCoords.x}, ${world.playerCoords.y}) — path around obstacles`);

  const navController: NavigateController = {
    async pressButton(button, frames = 5) {
      console.log(`  > press ${button} (${frames} frames)`);
      await client.holdButton(button, frames);
      await new Promise(r => setTimeout(r, frames * (1000 / 60) + 100));
    }
  };

  const navWorldReader: NavigateWorldReader = {
    async readPosition() {
      const s = await stateReader.readState();
      return { mapId: s.wCurMap, y: s.wYCoord, x: s.wXCoord };
    },
    async readWalkCounter() {
      return client.read8(map.wWalkCounter);
    },
    async isInBattle() {
      const battle = await client.read8(map.wIsInBattle);
      return battle !== 0;
    },
    async isDialogActive() {
      const textBoxId = await client.read8(map.wTextBoxID);
      const joyIgnore = await client.read8(map.wJoyIgnore);
      return textBoxId !== 0 && joyIgnore !== 0;
    }
  };

  const navMapSource: NavigateMapSource = {
    walkabilityGrid(mapId) {
      return memory.walkabilityGrid(mapId) ?? undefined;
    }
  };

  const command: NavigateCommand = { type: "navigate", x: targetX, y: targetY };
  const result = await executeNavigate(command, navController, navWorldReader, navMapSource);

  console.log(`\nResult: ${JSON.stringify(result)}`);

  const finalState = await stateReader.readState();
  console.log(`Final position: map=${finalState.wCurMap} y=${finalState.wYCoord} x=${finalState.wXCoord}`);
}

main().catch(console.error);
