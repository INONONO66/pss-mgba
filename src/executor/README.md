# Executor Layer

Translates high-level game commands into mGBA button presses and reads Game Boy RAM to detect state transitions.

## Flow

```
CommandExecutor.ts   ← routes command by type + mode
  ├── NavigateExecutor  ← A* pathfinding + step walk + warp/connection handling
  ├── InteractExecutor  ← face direction + press A
  ├── DialogExecutor    ← advance text, detect choices, collect transcript
  ├── BattleExecutor    ← menu nav + narration for all actions (fight/item/switch/run)
  └── MgbaAdapters      ← RAM readers bridging executors to mGBA-http
```

## Battle Flow

All four battle actions (`fight`, `item`, `switch`, `run`) now advance narration after menu selection via `advanceBattleNarration`. This presses A until either:
- `wIsInBattle` drops to 0 (battle ended)
- Battle menu arrow tile (0xED) reappears (next turn)

**Move cursor correction**: The FIGHT move menu cursor (`wCurrentMenuItem`) persists across turns in Gen 1. `executeFight` reads the current cursor position via `dialogStateReader.readCurrentMenuItem()` and navigates Up/Down from that position to the target move, instead of assuming the cursor starts at index 0.

Post-battle handling in `command-tools.ts` (`handlePostBattleCommand`):
1. If `wIsInBattle` still non-zero after executor returns: `waitForBattleExit` presses A up to 40 times (covers trainer defeat animations where `wIsInBattle` stays set during fadeout)
2. Loops up to 5 rounds of post-battle dialog (EXP gained, level-up, move learning)
3. Stops on interrupts requiring player input: `choice_appeared`, `naming_screen`, `battle_started`

## Navigation

**Pathfinding**: A* on boolean grid from `MapMemory.walkabilityGrid()`. Unknown (unexplored) tiles are treated as walkable so the pathfinder can route through unseen areas after map transitions. Actual walls are learned on collision and recorded for future pathfinding.

**Warps**: door/stair tiles from `wWarpEntries`. When goal is a warp tile, `resolveNavigationGoal` finds an adjacent walkable tile as the pathfinding target, then `tryPushIntoGoal` steps onto the warp.

**Map connections**: outdoor maps connect at edges without warp tiles (e.g., Pallet Town → Route 1). `NavigateMapSource.mapConnections()` provides the connection data. When the player arrives at an edge tile that matches a connection direction, `tryStepOffEdge` walks one step off the edge to trigger the map transition.

**NPC replanning**: if a random-walking NPC blocks the path, the executor waits 500ms, refreshes sprite positions, and replans (up to 3 attempts).

## RAM Signals

| Signal | Address | Detection |
|--------|---------|-----------|
| Dialog active | `rWY` (0xFF4A) | `windowY < 144` |
| In battle | `wIsInBattle` (0xD057) | 0=none, 1=wild, 2=trainer |
| Choice menu | `wTileMap + 154` | tile == 0x79 (box corner) |
| Battle menu | `wTileMap + 289` | tile == 0xED (arrow) |
| Naming screen | `wNamingScreenType` + tilemap text | non-zero + screen contains markers |

## Dialog Detection

`WINDOW_HIDDEN_CONFIRM_COUNT = 2`: requires 2 consecutive `rWY >= 144` reads to confirm dialog end. Prevents false positives from momentary page transitions where `rWY` flickers during text rendering.
