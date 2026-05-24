import "dotenv/config";
import { MgbaHttpClient } from "../src/mgba/MgbaHttpClient.js";
import { readGameWorld } from "../src/pokemon/GameWorld.js";
import { classifyTile } from "../src/pokemon/TilesetData.js";

async function main() {
  const client = new MgbaHttpClient({ baseUrl: process.env.MGBA_HTTP_BASE_URL ?? "http://127.0.0.1:5001" });
  const world = await readGameWorld(client);

  const W = 20;
  const H = 18;
  const bytes = world.tileMapBytes;
  const coll = world.tileCollision;
  const playerScrY = Math.floor((world.sprites.player!.yScreen + 4) / 8);
  const playerScrX = Math.floor(world.sprites.player!.xScreen / 8);

  console.log("playerScrY:", playerScrY, "playerScrX:", playerScrX);
  console.log("playerCoords:", world.playerCoords);
  console.log("mapLayout:", world.mapLayout);
  console.log();

  // Strip border (0x10) — find the valid region
  // Inner region: cols 2-17 (16 cols), rows 2-17 (16 rows) for this map
  const innerStartX = 2;
  const innerStartY = 2;
  const innerW = 16;
  const innerH = 16;

  console.log("=== Inner screen tiles (16x16, no border) ===");
  for (let y = 0; y < innerH; y++) {
    let row = y.toString().padStart(2) + ": ";
    for (let x = 0; x < innerW; x++) {
      const id = bytes[(innerStartY + y) * W + (innerStartX + x)];
      row += id.toString(16).padStart(2, "0") + " ";
    }
    console.log(row);
  }

  console.log();
  console.log("=== Option A: 16x16 (individual screen tiles) ===");
  for (let y = 0; y < innerH; y++) {
    let row = y.toString().padStart(2) + ": ";
    for (let x = 0; x < innerW; x++) {
      const id = bytes[(innerStartY + y) * W + (innerStartX + x)];
      const type = classifyTile(coll, id);
      row += type === "walkable" ? "." : type === "wall" ? "#" : '"';
    }
    console.log(row);
  }

  console.log();
  console.log("=== Option B: 8x8 (2x2 blocks, ANY walkable = walkable) ===");
  for (let by = 0; by < innerH / 2; by++) {
    let row = by.toString().padStart(2) + ": ";
    for (let bx = 0; bx < innerW / 2; bx++) {
      const sy = innerStartY + by * 2;
      const sx = innerStartX + bx * 2;
      const t0 = bytes[sy * W + sx];
      const t1 = bytes[sy * W + sx + 1];
      const t2 = bytes[(sy + 1) * W + sx];
      const t3 = bytes[(sy + 1) * W + sx + 1];
      const types = [t0, t1, t2, t3].map(t => classifyTile(coll, t));
      if (types.includes("grass")) {
        row += '"';
      } else if (types.some(t => t === "walkable")) {
        row += ".";
      } else {
        row += "#";
      }
    }
    console.log(row);
  }

  console.log();
  console.log("=== Expected ===");
  console.log("########");
  console.log("###....W");
  console.log("........");
  console.log("........");
  console.log("...#....");
  console.log("...#....");
  console.log("#.....#.");
  console.log("#.....#.");
}

main();
