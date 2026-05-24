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

  console.log("=== Tileset collision info ===");
  console.log("tilesetId:", coll.tilesetId);
  console.log("walkable tiles:", [...coll.walkableTiles].map(t => `0x${t.toString(16).padStart(2, "0")}`).join(", "));
  console.log("grassTile:", coll.grassTile);
  console.log();

  console.log("=== Screen tile IDs (20x18, hex) ===");
  for (let y = 0; y < H; y++) {
    let row = y.toString().padStart(2) + ": ";
    for (let x = 0; x < W; x++) {
      row += bytes[y * W + x].toString(16).padStart(2, "0") + " ";
    }
    console.log(row);
  }
  console.log();

  console.log("=== Classified screen tiles (20x18) ===");
  for (let y = 0; y < H; y++) {
    let row = y.toString().padStart(2) + ": ";
    for (let x = 0; x < W; x++) {
      const id = bytes[y * W + x];
      const type = classifyTile(coll, id);
      row += type === "walkable" ? "." : type === "wall" ? "#" : '"';
    }
    console.log(row);
  }
  console.log();

  console.log("=== Player info ===");
  console.log("playerCoords (block):", world.playerCoords);
  const p = world.sprites.player!;
  console.log("playerScrY:", Math.floor((p.yScreen + 4) / 8));
  console.log("playerScrX:", Math.floor(p.xScreen / 8));
  console.log("mapLayout:", world.mapLayout);

  console.log();
  console.log("=== Expected 8x8 map ===");
  console.log("Your expected:");
  console.log("########");
  console.log("###....W");
  console.log("........");
  console.log("........");
  console.log("...#....");
  console.log("...#....");
  console.log("#.......#");
  console.log("#.....#.");
}

main();
