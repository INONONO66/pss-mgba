import "dotenv/config";
import { MgbaHttpClient } from "../src/mgba/MgbaHttpClient.js";
import { readGameWorld } from "../src/game/GameWorld.js";
import { MapMemory } from "../src/game/MapMemory.js";
import { mapName } from "../src/game/PokemonCatalog.js";

const DIRECTIONS = ["Up", "Down", "Left", "Right"] as const;

async function main() {
  const client = new MgbaHttpClient({
    baseUrl: process.env.MGBA_HTTP_BASE_URL ?? "http://127.0.0.1:5001",
  });

  const memory = new MapMemory();
  const steps = 20;
  const delayMs = 600;

  console.log("=== Map Accumulation Test ===");
  console.log(`Will take ${steps} random steps, accumulating map data.\n`);

  for (let i = 0; i < steps; i++) {
    const world = await readGameWorld(client);
    const result = memory.update(world, world.tileMapBytes);
    const view = memory.view(world.mapLayout.mapId);

    const dir = DIRECTIONS[Math.floor(Math.random() * 4)];
    console.log(
      `Step ${(i + 1).toString().padStart(2)}: ` +
      `${mapName(world.mapLayout.mapId)} ` +
      `pos=(${world.playerCoords.y},${world.playerCoords.x}) ` +
      `update=${result.status.padEnd(7)} ` +
      `tiles=${(view?.tileCount ?? 0).toString().padStart(3)}/${((view?.width ?? 0) * (view?.height ?? 0)).toString().padStart(3)} ` +
      `→ press ${dir}`
    );

    await client.tapButton(dir as "Up" | "Down" | "Left" | "Right", 5);
    await sleep(delayMs);
  }

  // Final snapshot
  const world = await readGameWorld(client);
  memory.update(world, world.tileMapBytes);

  console.log("\n=== Final Map State ===");
  console.log(`Visited maps: [${memory.visitedMaps().join(", ")}]`);
  console.log(`Total tiles: ${memory.totalTiles()}\n`);

  for (const mapId of memory.visitedMaps()) {
    const view = memory.view(mapId);
    if (!view) continue;
    console.log(memory.renderFullMap(mapId, world.mapLayout.mapId === mapId ? world.playerCoords.y : undefined, world.mapLayout.mapId === mapId ? world.playerCoords.x : undefined, world.mapLayout.mapId === mapId ? world.warps.warps : undefined));
    console.log();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main();
