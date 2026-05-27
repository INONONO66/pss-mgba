# 001: Indoor Map Floor Classified as Wall

## Symptom

Agent entered Viridian Mart and got stuck for 2,100+ turns. The entire mart floor showed as `#` (wall) in the map ASCII rendering. Only NPC positions and warp overlays were visible.

```
   01234567
 1 ########
 2 ########
 3 ###3####
 4 ########
 5 1#######
 6 ###@####
 7 ###WW###
```

Pathfinder returned `no_path` for every navigate command because no walkable tiles existed between the player and the exit.

## Root Cause

`classifyBlock()` in `src/game/MapMemory.ts` required **both** bottom tiles (t2 AND t3) of each 2x2 block to be in the walkable tile list. If either was missing, the entire block was classified as `wall`.

```
2x2 block layout:
┌──┬──┐
│t0│t1│  ← ignored
├──┼──┤
│t2│t3│  ← both had to be walkable
└──┴──┘
```

Pokemon Gen 1 collision only checks **one tile** per 2x2 block — the bottom-left tile (t2). The game designers placed walkable tile IDs only in the t2 position. The t3 tile (e.g. `$6c` in the Mart tileset) was never in any collision list because the game never reads it.

Evidence from pokered `_GetTileAndCoordsInFrontOfPlayer`:
```asm
; facing down:  lda_coord 8, 11  → bottom-left of the block below
; facing up:    lda_coord 8, 7   → bottom-left of the block above
; facing left:  lda_coord 6, 9   → bottom-left of the block to the left
; facing right: lda_coord 10, 9  → bottom-left of the block to the right
; standing on:  lda_coord 8, 9   → bottom-left of current block
```

All coordinates resolve to the bottom-left tile within each 2x2 player-step grid.

## Verification

Read actual emulator RAM while in Viridian Mart:

- ROM collision list for Mart: `$01, $1a, $1c, $36, $3c, $5e, $6d, $6f`
- Mart floor blocks: t2=`$6d` (walkable), t3=`$6c` (NOT walkable)
- Old logic: `$6d && $6c` → both must be walkable → `$6c` not in list → wall
- New logic: `$6d` only → walkable

31 blocks changed from wall → walkable after the fix.

## Fix

`src/game/MapMemory.ts` — Changed `classifyBlock()` to use only t2 for terrain classification. t3 is still used for feature detection (door, warp, etc.) but not for walkability.

```typescript
// Before: both t2 and t3 must be walkable
const bothPassable = terrains.every((t) => t === "walkable" || t === "grass");

// After: only t2 (primary) determines terrain
const primary = classifyTile(collision, t2);
return { terrain: primary.terrain, features, tileId: t2 };
```

## Affected Maps

Every indoor map using any tileset. The Mart/Pokecenter blockset was the most visibly broken, but the same issue existed for all tilesets where t3 wasn't in the walkable list.

## References

- pokered source: `engine/overworld/player_state.asm` → `_GetTileAndCoordsInFrontOfPlayer`
- pokered source: `data/tilesets/collision_tile_ids.asm` → per-tileset walkable lists
- pokered source: `home/overworld.asm` → `CheckTilePassable`
