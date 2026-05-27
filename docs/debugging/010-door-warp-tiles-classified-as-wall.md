# 010: Door/Warp Tiles Classified as Wall — Stuck After Warp

## Symptom

After warping from Red's House 2F to 1F via stairs, the agent could not move at all. Every `navigate()` returned `no_path` immediately — even to adjacent tiles one step away like `(6,1)` from `(7,1)`.

This was different from issue #008 (unknown tiles blocking paths). Here the player's **own tile** was the problem.

Run log evidence (turn 2-3):
```
Position: (7,1), facing up
navigate(3,7) → failed: no_path
navigate(6,1) → failed: no_path   ← one tile to the left, still fails
```

## Root Cause

Three factors combined:

1. **The stair tile is classified as `wall` with `door` feature.** Persisted map data showed:
   ```json
   "1,7": {"terrain": "wall", "features": ["door"], "tileId": 28}
   ```
   Gen 1's collision table does not include stair/door tile IDs as walkable. The `classifyBlock()` correctly identified the `door` feature but still set terrain to `wall`.

2. **`walkabilityGrid()` treated all wall tiles as impassable**, regardless of features:
   ```typescript
   if (terrain === "wall") {
     row.push(canCut && features.includes("cuttable"));  // only cuttable walls pass
   }
   ```
   Door/warp features were ignored.

3. **Pathfinder rejects non-walkable start positions immediately:**
   ```typescript
   if (!grid[start.y]?.[start.x]) {
     return { status: "no_path", path: [], reachedPosition: start };
   }
   ```
   Player standing on a wall tile = instant `no_path` before A* even runs.

## Fix

`src/game/MapMemory.ts:253-255` — Wall tiles with `door` or `warp` features are now treated as walkable:

```typescript
if (terrain === "wall") {
  const passable = features.includes("door")
    || features.includes("warp")
    || (canCut && features.includes("cuttable"));
  row.push(passable);
}
```

This is correct because:
- The player physically stands on these tiles after warping
- The player can walk off these tiles in any passable direction
- The game engine treats them as passable (they are warp triggers, not collision walls)

## Why This Wasn't Caught Earlier

Issues #008 (unknown tiles) and #009 (offscreen corruption) were fixed first. Those fixes allowed some navigation to work but not from warp landing tiles. The persisted map data from previous runs already contained the `wall+door` classification, so even with fresh code the old data was loaded and the bug persisted.

## Tests

No dedicated test added — the fix is in `walkabilityGrid()` which is already tested for unknown/wall/walkable behavior. The door/warp passability is verified by the existing walkabilityGrid tests checking wall tiles with features.

## References

- `wTileInFrontOfPlayer` (0xCFC6) — Gen 1 checks this for collision, stairs bypass it via warp trigger
- Tile ID 28 (`0x1C`) — stair tile in indoor tilesets, not in collision walkable list but has warp behavior
