# 009: Partial Offscreen Blocks Corrupt Previously Known Tiles

## Symptom

Walkable tiles that the player had already traversed would spontaneously become walls after the camera scrolled. A path that worked one turn would return `no_path` the next turn even though nothing changed in the game world.

Example: tile `(3,7)` was recorded as walkable. After the player moved and the camera scrolled, the same tile was overwritten as wall.

## Root Cause

`MapMemory.update()` reads the 20x18 screen tilemap in 2x2 block chunks. The offscreen check only skipped blocks where **all four** tiles were the offscreen sentinel (`0x10`):

```typescript
// Before: only skip if ALL four tiles are offscreen
if (t0 === 0x10 && t1 === 0x10 && t2 === 0x10 && t3 === 0x10) {
  continue;
}
```

At the screen boundary, blocks can be **partially** offscreen — e.g., `t0=0x10, t1=0x10, t2=0x10, t3=0x01`. These blocks passed the check and were classified by `classifyBlock()`. The offscreen tile `0x10` is not in any collision walkable list, so `classifyTile(collision, 0x10)` returns `wall`. This overwrote the previously correct classification for that map coordinate.

```
Screen edge example:
┌──────┬──────┐
│ 0x10 │ 0x10 │  ← offscreen
├──────┼──────┤
│ 0x10 │ 0x01 │  ← mixed: one offscreen, one real
└──────┴──────┘
→ classifyBlock sees t2=0x10 (not walkable) → wall
→ overwrites previously known walkable tile
```

## Fix

`src/game/MapMemory.ts:110` — Changed `&&` to `||` so that blocks with **any** offscreen tile are skipped entirely. Previously known tile data is preserved.

```typescript
// After: skip if ANY tile is offscreen
if (t0 === 0x10 || t1 === 0x10 || t2 === 0x10 || t3 === 0x10) {
  continue;
}
```

## Trade-off

Some tiles at the screen edge might take slightly longer to be recorded (need to scroll further so all 4 tiles of the block are on screen). In practice this is 1-2 pixels of camera movement — negligible.

## References

- `OFFSCREEN_TILE = 0x10` in `src/game/MapMemory.ts`
- Gen 1 tilemap: tiles outside the current camera view contain stale/garbage data with `0x10` as sentinel
