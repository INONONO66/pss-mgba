import "dotenv/config";
import { MgbaHttpClient } from "../src/mgba/MgbaHttpClient.js";
import { readGameWorld } from "../src/pokemon/GameWorld.js";
import { MapMemory } from "../src/pokemon/MapMemory.js";
import { mapName } from "../src/pokemon/PokemonCatalog.js";

async function main() {
  const client = new MgbaHttpClient({
    baseUrl: process.env.MGBA_HTTP_BASE_URL ?? "http://127.0.0.1:5001",
  });

  console.log("=== RAW RAM READS ===");
  const frame = await client.currentFrame();
  console.log(`Frame: ${frame}`);

  const mapId = await client.read8(0xd35e);
  const y = await client.read8(0xd361);
  const x = await client.read8(0xd362);
  const mapH = await client.read8(0xd368);
  const mapW = await client.read8(0xd369);
  const tileset = await client.read8(0xd367);

  console.log(`Map ID: ${mapId} (${mapName(mapId)})`);
  console.log(`Player Position: y=${y}, x=${x}`);
  console.log(`Map Dimensions: ${mapW}x${mapH} (blocks)`);
  console.log(`Tileset: ${tileset}`);
  console.log();

  console.log("=== GAME WORLD SNAPSHOT ===");
  try {
    const world = await readGameWorld(client);
    console.log(`Mode: ${world.mode}`);
    console.log(`Map Layout: id=${world.mapLayout.mapId}, ${world.mapLayout.width}x${world.mapLayout.height}, tileset=${world.mapLayout.tilesetId}`);
    console.log(`Player Coords: y=${world.playerCoords.y}, x=${world.playerCoords.x}`);
    console.log(`Sprites: player=${world.sprites.player ? "found" : "MISSING"}, npcs=${world.sprites.npcs.length}, total=${world.sprites.spriteCount}`);

    if (world.sprites.npcs.length > 0) {
      console.log("=== NPCs ===");
      for (const npc of world.sprites.npcs) {
        console.log(`  NPC #${npc.slot}: pictureId=${npc.pictureId}, pos=(${npc.mapY},${npc.mapX}), facing=${npc.facing}, movement=${npc.movementType}, onScreen=${npc.onScreen}`);
      }
      console.log();
    }

    console.log(`Warps: ${world.warps.warps.length} warps`);
    for (const w of world.warps.warps) {
      console.log(`  Warp at (${w.y},${w.x}) -> ${mapName(w.destMapId)} (map ${w.destMapId}), warp #${w.destWarpId}`);
    }
    console.log(`Tile collision: walkable tiles=${world.tileCollision.walkableTiles.size}, grassTile=${world.tileCollision.grassTile}`);
    console.log(`TileMap bytes length: ${world.tileMapBytes.length}`);
    console.log(`Tile in front: ${world.tileInFront}, standing on: ${world.tileStandingOn}, grass rate: ${world.grassRate}`);
    console.log();

    if (world.sprites.player) {
      console.log("=== PLAYER SPRITE ===");
      const p = world.sprites.player;
      console.log(`  Screen: yScreen=${p.yScreen}, xScreen=${p.xScreen}`);
      console.log(`  Map: mapY=${p.mapY}, mapX=${p.mapX}`);
      console.log(`  Facing: ${p.facing}`);
      console.log(`  On screen: ${p.onScreen}, in grass: ${p.inGrass}`);
      console.log();
    }

    console.log("=== MAP MEMORY (single snapshot) ===");
    const memory = new MapMemory();
    const result = memory.update(world, world.tileMapBytes);
    console.log(`Update result: ${JSON.stringify(result)}`);
    console.log();

    if (result.status === "updated") {
      const view = memory.view(world.mapLayout.mapId);
      console.log(`View: mapId=${view?.mapId}, ${view?.width}x${view?.height}, tiles=${view?.tileCount}, npcs=${view?.npcPositions.length}`);
      console.log();

      console.log("=== RENDER ASCII ===");
      const playerMapY = world.playerCoords.y;
      const playerMapX = world.playerCoords.x;
      console.log(memory.renderAscii(world.mapLayout.mapId, playerMapY, playerMapX));
      console.log();

      console.log("=== RENDER FULL MAP ===");
      console.log(memory.renderFullMap(world.mapLayout.mapId, playerMapY, playerMapX, world.warps.warps));
      console.log();

      console.log("=== MICRO VIEW ===");
      console.log(memory.renderMicro(world.mapLayout.mapId, playerMapY, playerMapX, world.sprites.player?.facing));
      console.log();

      console.log("=== WALKABILITY GRID ===");
      const wg = memory.walkabilityGrid(world.mapLayout.mapId);
      if (wg) {
        console.log(`Grid: ${wg.width}x${wg.height}`);
        for (let row = 0; row < wg.height; row++) {
          console.log(`  ${row.toString().padStart(2)}: ${wg.grid[row].map((v: boolean) => v ? "." : "#").join("")}`);
        }
      } else {
        console.log("(no walkability grid)");
      }
    } else {
      console.log(`Map update was skipped: ${result.reason}`);
    }

    console.log();
    console.log("=== MAP LAYOUT (metadata) ===");
    console.log(`  mapId=${world.mapLayout.mapId}, tileset=${world.mapLayout.tilesetId}, ${world.mapLayout.width}x${world.mapLayout.height}`);

  } catch (err) {
    console.error("ERROR:", err);
  }
}

main();
