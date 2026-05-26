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

if (!record) {
  console.log("No map data");
  process.exit(1);
}

const py = state.wYCoord;
const px = state.wXCoord;

console.log("Map: " + mapName(mapId) + " (id=" + mapId + ")");
console.log("Player: (" + px + ", " + py + ")");
console.log("Size: " + record.width + "x" + record.height);
console.log("Tiles recorded: " + record.tiles.size);

const conns = world.warps?.connections;
if (conns) {
  const dirs: string[] = [];
  if (conns.north) { dirs.push("N->" + mapName(conns.north.mapId)); }
  if (conns.south) { dirs.push("S->" + mapName(conns.south.mapId)); }
  if (conns.east) { dirs.push("E->" + mapName(conns.east.mapId)); }
  if (conns.west) { dirs.push("W->" + mapName(conns.west.mapId)); }
  if (dirs.length > 0) { console.log("Connections: " + dirs.join(", ")); }
}

console.log("\nLegend: @=player .=walkable #=wall ~=water ,=grass C=cuttable L=ledge K=counter D=door W=warp  =unexplored");
console.log("");

for (let y = 0; y < record.height; y++) {
  let row = "";
  for (let x = 0; x < record.width; x++) {
    if (y === py && x === px) {
      row += "@";
      continue;
    }
    const tile = record.tiles.get(y + "," + x);
    if (tile === undefined) {
      row += " ";
      continue;
    }
    const terrain = tile.terrain ?? "wall";
    const features: readonly string[] = tile.features ?? [];

    if (features.includes("door")) { row += "D"; }
    else if (features.includes("warp")) { row += "W"; }
    else if (features.includes("cuttable") && terrain === "wall") { row += "C"; }
    else if (features.includes("cuttable") && terrain === "grass") { row += ","; }
    else if (features.includes("ledge")) { row += "L"; }
    else if (features.includes("counter")) { row += "K"; }
    else if (terrain === "water") { row += "~"; }
    else if (terrain === "grass") { row += ","; }
    else if (terrain === "wall") { row += "#"; }
    else { row += "."; }
  }
  console.log(String(y).padStart(3) + " " + row);
}
