import path from "node:path";
import type { HarnessConfig } from "../cli/config.js";
import type { ExecutionContext } from "../executor/CommandExecutor.js";
import {
  createDialogStateReader,
  createInteractStateReader,
  createNavigateMapSource,
  createNavigateWorldReader,
  createUnifiedController,
  toCommandGameMode,
  type RamReader,
  type UnifiedController,
} from "../executor/MgbaAdapters.js";
import type { DialogStateReader } from "../executor/DialogExecutor.js";
import type { InteractStateReader } from "../executor/InteractExecutor.js";
import type { NavigateMapSource, NavigateWorldReader } from "../executor/NavigateExecutor.js";
import { MapGraph, type MapGraphInput } from "../game/MapGraph.js";
import { MapMemory } from "../game/MapMemory.js";
import { MapMemoryStore,
fromPersistedMap,
toPersistedMap,
type MapMemoryFile, } from "../game/MapMemoryStore.js";
import { mapName } from "../game/PokemonCatalog.js";
import { FullGameDetector, type FullGameObservableState } from "../game/FullGameDetector.js";

import type { DetectorStatus, ProgressDetector } from "../game/Detector.js";
import { PokemonStateReader } from "../game/PokemonStateReader.js";
import { readGameWorld, type GameWorldSnapshot } from "../game/GameWorld.js";
import { MgbaHttpClient } from "../mgba/MgbaHttpClient.js";
import type { MgbaButton } from "../mgba/MgbaTypes.js";

export interface CommandAgentWarps {
  readonly y: number;
  readonly x: number;
}

export interface CommandAgentWarpInfo extends CommandAgentWarps {
  readonly destWarpId: number;
  readonly destMapId: number;
  readonly destMapName: string;
}

export interface CommandAgentNpcInfo {
  readonly slot: number;
  readonly pictureId: number;
  readonly mapY: number;
  readonly mapX: number;
  readonly facing: string;
  readonly movementType: string;
}

export interface CommandAgentGameState {
  readonly fullState: ExecutionContext["fullState"];
  readonly mode: ExecutionContext["mode"];
  readonly mapId: number;
  readonly playerY: number;
  readonly playerX: number;
  readonly facing: string;
  readonly mapWidth: number;
  readonly mapHeight: number;
  readonly warps: readonly CommandAgentWarpInfo[];
  readonly npcs: readonly CommandAgentNpcInfo[];
}

export interface CommandAgentMapMemoryStore {
  loadInto(memory: MapMemory): Promise<void>;
  onUpdate(memory: MapMemory): void;
  flush(memory: MapMemory): Promise<void>;
}

export type CommandAgentDetector = ProgressDetector<FullGameObservableState, DetectorStatus>;

export interface CommandAgentContext {
  readonly config: HarnessConfig;
  readonly client: MgbaHttpClient;
  readonly stateReader: PokemonStateReader;
  readonly mapMemory: MapMemory;
  readonly mapGraph: MapGraph;
  readonly mapMemoryStore: CommandAgentMapMemoryStore;
  readonly detector: CommandAgentDetector;
  readonly controller: UnifiedController;
  readonly navigateWorldReader: NavigateWorldReader;
  readonly navigateMapSource: NavigateMapSource;
  readonly interactStateReader: InteractStateReader;
  readonly dialogStateReader: DialogStateReader;
  readonly executionContext: ExecutionContext;
  readonly currentWarps: readonly CommandAgentWarps[];
  readonly readGameState: () => Promise<CommandAgentGameState>;
  readonly updateMapMemory: () => Promise<void>;
  readonly updateMapGraph: () => void;
  readonly getLastWorld: () => GameWorldSnapshot | undefined;
  readonly getLastGameState: () => CommandAgentGameState | undefined;
}

export function createCommandAgentContext(config: HarnessConfig): CommandAgentContext {
  const client = new MgbaHttpClient({ baseUrl: config.mgbaHttpBaseUrl });
  const stateReader = new PokemonStateReader({ client, version: config.pokemonVersion });
  const mapMemory = new MapMemory();
  const mapGraph = new MapGraph();
  const mapStore = new MapMemoryStore(path.resolve(config.evidenceDir, config.harnessRunId, "global", "map-memory.json"));
  let mapStoreData: MapMemoryFile = { version: 1, updatedAt: new Date().toISOString(), maps: {} };
  const detector = createDetector(config);

  const ram: RamReader = {
    read8: (address) => client.read8(address),
    readRange: (address, length) => client.readRange(address, length),
    holdButton: (button: MgbaButton, frames: number) => client.holdButton(button, frames),
  };

  const controller = createUnifiedController(ram);
  const navigateWorldReader = createNavigateWorldReader(ram);
  const currentWarps: CommandAgentWarps[] = [];
  let lastWorld: GameWorldSnapshot | undefined;
  let lastGameState: CommandAgentGameState | undefined;
  const navigateMapSource = createNavigateMapSource(mapMemory, {
    warpPositions() {
      return currentWarps;
    },
  }, {
    npcAt(mapId, y, x) {
      const knownNpcs = mapMemory.getKnownNpcs(mapId);
      return knownNpcs.find((npc) => npc.mapY === y && npc.mapX === x && npc.onScreen);
    },
    async refreshObstacles(_mapId) {
      const world = await readGameWorld(client);
      lastWorld = world;
      mapMemory.update(world, world.tileMapBytes);
    },
  });
  const interactStateReader = createInteractStateReader(ram);
  const dialogStateReader = createDialogStateReader(ram);

  const executionContext: ExecutionContext = {
    mode: "overworld",
    fullState: undefined as unknown as ExecutionContext["fullState"],
    mapWidth: 0,
    mapHeight: 0,
    controller,
    navigateWorldReader,
    navigateMapSource,
    interactStateReader,
    dialogStateReader,
  };

  const readGameState = async (): Promise<CommandAgentGameState> => {
    const world = await readGameWorld(client);
    lastWorld = world;
    currentWarps.splice(0, currentWarps.length, ...world.warps.warps.map((warp) => ({ y: warp.y, x: warp.x })));
    const menuText = await stateReader.readMenuTextState({ tileMapBytes: world.tileMapBytes });
    const fullState = await stateReader.readFullState({ menuText });

    const state: CommandAgentGameState = {
      fullState,
      mode: toCommandGameMode(world.mode),
      mapId: world.mapLayout.mapId,
      playerY: world.playerCoords.y,
      playerX: world.playerCoords.x,
      facing: fullState.player.facing.direction,
      mapWidth: world.mapLayout.width * 2,
      mapHeight: world.mapLayout.height * 2,
      warps: world.warps.warps.map((warp) => ({
        y: warp.y,
        x: warp.x,
        destWarpId: warp.destWarpId,
        destMapId: warp.destMapId,
        destMapName: mapName(warp.destMapId),
      })),
      npcs: world.sprites.npcs.filter((npc) => npc.onScreen).map((npc) => ({
        slot: npc.slot,
        pictureId: npc.pictureId,
        mapY: npc.mapY,
        mapX: npc.mapX,
        facing: npc.facing,
        movementType: npc.movementType,
      })),
    };

    lastGameState = state;
    return state;
  };

  const updateMapMemory = (): Promise<void> => {
    if (lastWorld) {
      mapMemory.update(lastWorld, lastWorld.tileMapBytes);
    }

    return Promise.resolve();
  };

  const updateMapGraph = (): void => {
    const inputs: MapGraphInput[] = mapMemory.visitedMaps().map((mapId) => {
      const warps = lastWorld?.mapLayout.mapId === mapId ? (lastWorld.warps?.warps ?? []) : [];
      const connections: Partial<Record<"north" | "south" | "east" | "west", number>> = {};

      if (lastWorld?.mapLayout.mapId === mapId && lastWorld.warps?.connections) {
        assignConnections(connections, lastWorld.warps.connections);
      }

      return { mapId, warps, connections };
    });

    mapGraph.build(inputs);
  };

  const mapMemoryStore: CommandAgentMapMemoryStore = {
    async loadInto(memory: MapMemory): Promise<void> {
      mapStoreData = await mapStore.load();
      for (const persisted of Object.values(mapStoreData.maps)) {
        const { mapRecord } = fromPersistedMap(persisted);
        memory.loadRecord(mapRecord);
      }
    },
    onUpdate(memory: MapMemory): void {
      for (const mapId of memory.visitedMaps()) {
        const record = memory.get(mapId);
        if (record === undefined) {
          continue;
        }

        const warps = lastWorld?.mapLayout.mapId === mapId ? [...(lastWorld.warps?.warps ?? [])] : [];
        const connections: Partial<Record<"north" | "south" | "east" | "west", number>> = {};

        if (lastWorld?.mapLayout.mapId === mapId && lastWorld.warps?.connections) {
          assignConnections(connections, lastWorld.warps.connections);
        }

        const playerPos = lastGameState?.mapId === mapId
          ? { y: lastGameState.playerY, x: lastGameState.playerX }
          : undefined;
        mapStoreData.maps[String(mapId)] = toPersistedMap(record, warps, connections, playerPos);
      }

      mapStore.markDirty(mapStoreData);
    },
    async flush(memory: MapMemory): Promise<void> {
      this.onUpdate(memory);
      await mapStore.flush(mapStoreData);
    },
  };

  return {
    config,
    client,
    stateReader,
    mapMemory,
    mapGraph,
    mapMemoryStore,
    detector,
    controller,
    navigateWorldReader,
    navigateMapSource,
    interactStateReader,
    dialogStateReader,
    executionContext,
    currentWarps,
    readGameState,
    updateMapMemory,
    updateMapGraph,
    getLastWorld: () => lastWorld,
    getLastGameState: () => lastGameState,
  };
}

function createDetector(_config: Pick<HarnessConfig, "harnessMode">): CommandAgentDetector {
  return new FullGameDetector();
}

function assignConnections(
  target: Partial<Record<"north" | "south" | "east" | "west", number>>,
  source: NonNullable<NonNullable<GameWorldSnapshot["warps"]>["connections"]>,
): void {
  if (source.north) {
    target.north = source.north.mapId;
  }
  if (source.south) {
    target.south = source.south.mapId;
  }
  if (source.west) {
    target.west = source.west.mapId;
  }
  if (source.east) {
    target.east = source.east.mapId;
  }
}
