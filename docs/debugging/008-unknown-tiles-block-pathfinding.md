# 008: Unknown Tiles Block Pathfinding After Map Transition

## Symptom

After warping from Red's House 2F to 1F, the agent could not navigate anywhere. Every `navigate()` call returned `no_path` for 7+ turns. The map showed ~47% explored with the left half and bottom as `???` (unknown).

```
   01234567
 0 ???#####
 1 ???#...@   ← player stuck here
 2 ???.....
 3 ???.....
 4 ???##N..
 5 ???##...
 6 ????????   ← all unknown
 7 ??WW????   ← exit warps unreachable
```

## Root Cause

`walkabilityGrid()` in `src/game/MapMemory.ts` treated unknown (unexplored) tiles as `false` (impassable). After a map transition, only tiles visible on screen (~50%) were recorded. The other half was unknown, creating a wall that blocked all paths.

```typescript
// Before: unknown = wall
if (tile === undefined) {
  row.push(false);  // pathfinder cannot route through here
  continue;
}
```

Gen 1 only loads the 20x18 screen tilemap (`wTileMap`) into RAM — not the full map. Tiles outside the camera view are not available until the player walks near them.

## Fix

`src/game/MapMemory.ts:248` — Changed unknown tiles from `false` to `true`. The pathfinder now assumes unexplored tiles are walkable and routes through them. If the actual tile is a wall, the player hits it during movement, the `walkOneStep` retry logic detects the block, and the tile is recorded as wall for future pathfinding.

```typescript
// After: unknown = walkable assumption
if (tile === undefined) {
  row.push(true);  // assume walkable, learn walls on collision
  continue;
}
```

## Trade-offs

- Pathfinder may occasionally route into walls in unexplored areas (1 turn wasted on collision)
- Far better than being completely stuck for 7+ turns after every warp
- Walls are learned permanently once hit, so the same wall is never hit twice

## Tests

- `tests/pokemon/MapMemory.test.ts`: "walkabilityGrid treats unknown tiles as walkable" — verifies `grid[y][x] === true` for tiles not in the record

## References

- `wTileMap` at 0xC3A0 (360 bytes, 20x18 screen only)
- `wOverworldMap` at 0xC6E8 exists in RAM but requires ROM blockdata to decompose metatiles — not used
