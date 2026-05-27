import path from "node:path";
import type { HarnessConfig } from "../cli/config.js";
import type { ExecutionContext } from "../executor/CommandExecutor.js";
import type { DialogStateReader } from "../executor/DialogExecutor.js";
import type { InteractStateReader } from "../executor/InteractExecutor.js";
import {
  createDialogStateReader,
  createInteractStateReader,
  createNavigateMapSource,
  createNavigateWorldReader,
  createUnifiedController,
  type RamReader,
  toCommandGameMode,
  type UnifiedController,
} from "../executor/MgbaAdapters.js";
import type {
  NavigateMapSource,
  NavigateWorldReader,
} from "../executor/NavigateExecutor.js";
import type { DetectorStatus, ProgressDetector } from "../game/Detector.js";
import {
  FullGameDetector,
  type FullGameObservableState,
} from "../game/FullGameDetector.js";
import { type GameWorldSnapshot, readGameWorld } from "../game/GameWorld.js";
import { MapGraph, type MapGraphInput } from "../game/MapGraph.js";
import { MapMemory } from "../game/MapMemory.js";
import {
  fromPersistedMap,
  type MapMemoryFile,
  MapMemoryStore,
  type PersistedMapRecord,
  toPersistedMap,
} from "../game/MapMemoryStore.js";
import { mapName } from "../game/PokemonCatalog.js";
import { PokemonStateReader } from "../game/PokemonStateReader.js";
import type { WarpEntry } from "../game/WarpReader.js";
import { MgbaHttpClient } from "../mgba/MgbaHttpClient.js";
import type { MgbaButton } from "../mgba/MgbaTypes.js";
import { InputGate } from "../session/input-gate.js";
import { MiniStateReader } from "../session/mini-state-reader.js";
import type { SessionEvent } from "../session/types.js";

interface CommandAgentWarps {
  readonly x: number;
  readonly y: number;
}

interface CommandAgentWarpInfo extends CommandAgentWarps {
  readonly destMapId: number;
  readonly destMapName: string;
  readonly destWarpId: number;
}

interface CommandAgentNpcInfo {
  readonly facing: string;
  readonly mapX: number;
  readonly mapY: number;
  readonly movementType: string;
  readonly pictureId: number;
  readonly slot: number;
}

export interface CommandAgentGameState {
  readonly facing: string;
  readonly fullState: ExecutionContext["fullState"];
  readonly mapHeight: number;
  readonly mapId: number;
  readonly mapWidth: number;
  readonly mode: ExecutionContext["mode"];
  readonly npcs: readonly CommandAgentNpcInfo[];
  readonly playerX: number;
  readonly playerY: number;
  readonly warps: readonly CommandAgentWarpInfo[];
}

interface CommandAgentMapMemoryStore {
  flush(memory: MapMemory): Promise<void>;
  loadInto(memory: MapMemory): Promise<void>;
  onUpdate(memory: MapMemory): void;
}

type CommandAgentDetector = ProgressDetector<
  FullGameObservableState,
  DetectorStatus
>;

export interface CommandAgentContext {
  readonly client: MgbaHttpClient;
  readonly config: HarnessConfig;
  readonly controller: UnifiedController;
  readonly currentWarps: readonly CommandAgentWarps[];
  readonly detector: CommandAgentDetector;
  readonly dialogStateReader: DialogStateReader;
  readonly drainSessionEvents: () => readonly SessionEvent[];
  readonly executionContext: ExecutionContext;
  readonly getLastGameState: () => CommandAgentGameState | undefined;
  readonly getLastWorld: () => GameWorldSnapshot | undefined;
  readonly interactStateReader: InteractStateReader;
  readonly mapGraph: MapGraph;
  readonly mapMemory: MapMemory;
  readonly mapMemoryStore: CommandAgentMapMemoryStore;
  readonly navigateMapSource: NavigateMapSource;
  readonly navigateWorldReader: NavigateWorldReader;
  readonly readGameState: () => Promise<CommandAgentGameState>;
  readonly stateReader: PokemonStateReader;
  readonly updateMapGraph: () => void;
  readonly updateMapMemory: () => Promise<void>;
}

export function createCommandAgentContext(
  config: HarnessConfig
): CommandAgentContext {
  const client = new MgbaHttpClient({ baseUrl: config.mgbaHttpBaseUrl });
  const stateReader = new PokemonStateReader({
    client,
    version: config.pokemonVersion,
  });
  const mapMemory = new MapMemory();
  const mapGraph = new MapGraph();
  const mapStore = new MapMemoryStore(
    path.resolve(
      config.evidenceDir,
      config.harnessRunId,
      "global",
      "map-memory.json"
    )
  );
  let mapStoreData: MapMemoryFile = {
    version: 1,
    updatedAt: new Date().toISOString(),
    maps: {},
  };
  const detector = createDetector(config);

  const ram: RamReader = {
    read8: (address) => client.read8(address),
    readRange: (address, length) => client.readRange(address, length),
    holdButton: (button: MgbaButton, frames: number) =>
      client.holdButton(button, frames),
  };

  const controller = createUnifiedController(ram);
  const sessionEvents: SessionEvent[] = [];
  const inputGate = new InputGate({
    controller,
    reader: new MiniStateReader(client),
    options: {
      onResult(result) {
        if (result.event !== undefined) {
          sessionEvents.push(result.event);
        }
      },
    },
  });
  const navigateWorldReader = createNavigateWorldReader(ram);
  const currentWarps: CommandAgentWarps[] = [];
  let lastWorld: GameWorldSnapshot | undefined;
  let lastGameState: CommandAgentGameState | undefined;
  const navigateMapSource = createNavigateMapSource(
    mapMemory,
    {
      warpPositions() {
        return currentWarps;
      },
    },
    {
      npcAt(mapId, y, x) {
        const knownNpcs = mapMemory.getKnownNpcs(mapId);
        return knownNpcs.find(
          (npc) => npc.mapY === y && npc.mapX === x && npc.onScreen
        );
      },
      async refreshObstacles(_mapId) {
        const world = await readGameWorld(client);
        lastWorld = world;
        mapMemory.update(world, world.tileMapBytes);
      },
    },
    {
      mapConnections(_mapId) {
        const conn = lastWorld?.warps?.connections;
        if (conn === undefined) {
          return {};
        }
        const result: Partial<
          Record<"north" | "south" | "east" | "west", number>
        > = {};
        if (conn.north) {
          result.north = conn.north.mapId;
        }
        if (conn.south) {
          result.south = conn.south.mapId;
        }
        if (conn.west) {
          result.west = conn.west.mapId;
        }
        if (conn.east) {
          result.east = conn.east.mapId;
        }
        return result;
      },
    }
  );
  const interactStateReader = createInteractStateReader(ram);
  const dialogStateReader = createDialogStateReader(ram);

  const executionContext: ExecutionContext = {
    mode: "overworld",
    fullState: undefined as unknown as ExecutionContext["fullState"],
    mapWidth: 0,
    mapHeight: 0,
    controller,
    inputGate,
    navigateWorldReader,
    navigateMapSource,
    interactStateReader,
    dialogStateReader,
  };

  const readGameState = async (): Promise<CommandAgentGameState> => {
    const world = await readGameWorld(client);
    lastWorld = world;
    currentWarps.splice(
      0,
      currentWarps.length,
      ...world.warps.warps.map((warp) => ({ y: warp.y, x: warp.x }))
    );
    const menuText = await stateReader.readMenuTextState({
      tileMapBytes: world.tileMapBytes,
    });
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
      npcs: world.sprites.npcs
        .filter((npc) => npc.onScreen)
        .map((npc) => ({
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
      const existing = mapStoreData.maps[String(mapId)];
      const { warps, connections } = resolveMapMetadata(
        mapId,
        existing,
        lastWorld,
        lastGameState
      );
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

        const existing = mapStoreData.maps[String(mapId)];
        const { warps, connections, playerPos } = resolveMapMetadata(
          mapId,
          existing,
          lastWorld,
          lastGameState
        );
        mapStoreData.maps[String(mapId)] = toPersistedMap(
          record,
          warps,
          connections,
          playerPos
        );
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
    drainSessionEvents: () => sessionEvents.splice(0, sessionEvents.length),
    executionContext,
    currentWarps,
    readGameState,
    updateMapMemory,
    updateMapGraph,
    getLastWorld: () => lastWorld,
    getLastGameState: () => lastGameState,
  };
}

function createDetector(
  _config: Pick<HarnessConfig, "harnessMode">
): CommandAgentDetector {
  return new FullGameDetector();
}

function resolveMapMetadata(
  mapId: number,
  existing: PersistedMapRecord | undefined,
  world: GameWorldSnapshot | undefined,
  gameState: CommandAgentGameState | undefined
): {
  warps: WarpEntry[];
  connections: Partial<Record<"north" | "south" | "east" | "west", number>>;
  playerPos: { y: number; x: number } | undefined;
} {
  const isCurrentMap = world?.mapLayout.mapId === mapId;

  const warps: WarpEntry[] =
    isCurrentMap && world
      ? [...(world.warps?.warps ?? [])]
      : (existing?.warps?.map((w) => ({
          y: w.y,
          x: w.x,
          destMapId: w.destMapId,
          destWarpId: w.destWarpId,
        })) ?? []);

  const connections: Partial<
    Record<"north" | "south" | "east" | "west", number>
  > = existing?.connections ? { ...existing.connections } : {};

  if (isCurrentMap && world?.warps?.connections) {
    const source = world.warps.connections;
    if (source.north) {
      connections.north = source.north.mapId;
    }
    if (source.south) {
      connections.south = source.south.mapId;
    }
    if (source.west) {
      connections.west = source.west.mapId;
    }
    if (source.east) {
      connections.east = source.east.mapId;
    }
  }

  const playerPos =
    gameState?.mapId === mapId
      ? { y: gameState.playerY, x: gameState.playerX }
      : existing?.playerPosition;

  return { warps, connections, playerPos };
}
