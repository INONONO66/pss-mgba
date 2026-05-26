import { MgbaHttpClient } from "../src/mgba/MgbaHttpClient.js";
import { PokemonStateReader } from "../src/game/PokemonStateReader.js";
import { readGameWorld } from "../src/game/GameWorld.js";
import { MapMemory, type KnownNpc } from "../src/game/MapMemory.js";
import { mapName } from "../src/game/PokemonCatalog.js";

const client = new MgbaHttpClient({ baseUrl: "http://127.0.0.1:5001" });
const stateReader = new PokemonStateReader({ client, version: "red" });
const memory = new MapMemory();

const world = await readGameWorld(client);
memory.update(world, world.tileMapBytes);

const state = await stateReader.readState();
const currentMapId = state.wCurMap;
const py = state.wYCoord;
const px = state.wXCoord;

function tileChar(
  tile: { terrain?: string; features?: readonly string[] } | undefined,
  npc: KnownNpc | undefined,
): string {
  if (npc) {
    return npc.onScreen ? "N" : "n";
  }
  if (tile === undefined) {
    return " ";
  }
  const terrain = tile.terrain ?? "wall";
  const features = tile.features ?? [];
  if (features.includes("door")) { return "D"; }
  if (features.includes("warp")) { return "W"; }
  if (features.includes("cuttable") && terrain === "wall") { return "C"; }
  if (features.includes("ledge")) { return "L"; }
  if (features.includes("counter")) { return "K"; }
  if (terrain === "water") { return "~"; }
  if (terrain === "grass") { return features.includes("cuttable") ? ";" : ","; }
  if (terrain === "wall") { return "#"; }
  return ".";
}

function renderMap(mapId: number, playerY?: number, playerX?: number): void {
  const record = memory.get(mapId);
  if (!record) {
    return;
  }

  const knownNpcs = memory.getKnownNpcs(mapId);
  const npcMap = new Map<string, KnownNpc>();
  for (const npc of knownNpcs) {
    npcMap.set(npc.mapY + "," + npc.mapX, npc);
  }

  const isCurrentMap = mapId === currentMapId;
  const tag = isCurrentMap ? " *** CURRENT ***" : "";
  console.log("=".repeat(50));
  console.log(mapName(mapId) + " (id=" + mapId + ", " + record.width + "x" + record.height + ", " + record.tiles.size + " tiles)" + tag);

  if (isCurrentMap) {
    const conns = world.warps?.connections;
    if (conns) {
      const dirs: string[] = [];
      if (conns.north) { dirs.push("N->" + mapName(conns.north.mapId)); }
      if (conns.south) { dirs.push("S->" + mapName(conns.south.mapId)); }
      if (conns.east) { dirs.push("E->" + mapName(conns.east.mapId)); }
      if (conns.west) { dirs.push("W->" + mapName(conns.west.mapId)); }
      if (dirs.length > 0) { console.log("Connections: " + dirs.join(", ")); }
    }
  }

  if (knownNpcs.length > 0) {
    console.log("NPCs: " + knownNpcs.map((n) =>
      "slot" + n.slot + "(pic" + n.pictureId + " " + n.movementType + " " + n.mapX + "," + n.mapY + (n.onScreen ? "" : " off") + ")"
    ).join(" "));
  }

  console.log("");
  for (let y = 0; y < record.height; y++) {
    let row = "";
    for (let x = 0; x < record.width; x++) {
      if (y === playerY && x === playerX) {
        row += "@";
        continue;
      }
      const tile = record.tiles.get(y + "," + x);
      const npc = npcMap.get(y + "," + x);
      row += tileChar(tile, npc);
    }
    console.log(String(y).padStart(3) + " " + row);
  }
  console.log("");
}

console.log("Legend: @=player N=NPC(visible) n=NPC(last known) .=walkable #=wall ~=water ,=grass ;=grass(cuttable) C=cuttable L=ledge K=counter D=door W=warp  =unexplored");
console.log("Player: " + mapName(currentMapId) + " (" + px + ", " + py + ")");
console.log("Visited maps: " + memory.visitedMaps().length);
console.log("");

for (const mapId of memory.visitedMaps()) {
  const isCurrentMap = mapId === currentMapId;
  renderMap(mapId, isCurrentMap ? py : undefined, isCurrentMap ? px : undefined);
}
