import { MgbaHttpClient } from "../src/mgba/MgbaHttpClient.js";
import { PokemonStateReader } from "../src/game/PokemonStateReader.js";
import { readGameWorld } from "../src/game/GameWorld.js";
import { MapMemory } from "../src/game/MapMemory.js";
import { mapName } from "../src/game/PokemonCatalog.js";

const client = new MgbaHttpClient({ baseUrl: "http://127.0.0.1:5001" });
const stateReader = new PokemonStateReader({ client, version: "red" });
const memory = new MapMemory();

const world = await readGameWorld(client);
memory.update(world, world.tileMapBytes);

const state = await stateReader.readState();
const mapId = state.wCurMap;
const record = memory.get(mapId);
const py = state.wYCoord;
const px = state.wXCoord;

console.log("Map: " + mapName(mapId) + " tileset=" + world.tileCollision.tilesetId);
console.log("Player: (" + px + ", " + py + ")");
console.log("Grass tile: 0x" + (world.tileCollision.grassTile ?? 0).toString(16));
console.log("Walkable tiles: " + [...world.tileCollision.walkableTiles].map(t => "0x" + t.toString(16)).join(", "));
console.log("");

if (record) {
  console.log("Tiles around player (y-2..y+4, x-3..x+3):");
  for (let y = py - 2; y <= py + 4; y++) {
    let line = String(y).padStart(3) + " ";
    for (let x = px - 3; x <= px + 3; x++) {
      const tile = record.tiles.get(y + "," + x);
      if (y === py && x === px) {
        line += " @@ ";
      } else if (tile === undefined) {
        line += " ?? ";
      } else {
        const tid = "0x" + tile.tileId.toString(16).padStart(2, "0");
        const t = (tile.terrain ?? "?")[0];
        const f = (tile.features ?? []).map((feat: string) => feat[0]).join("") || "-";
        line += tid + t + f + " ";
      }
    }
    console.log(line);
  }
}
