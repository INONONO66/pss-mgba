# 011: Map #255 Warp Pollution in Map Graph

## Symptom

The map graph displayed edges to "Map #255" — a non-existent map. The agent's map graph context showed:

```
* Reds House 1f (map 37) — you are here
  → warp(7,2): Map #255
  → warp(7,3): Map #255
  → warp(1,7): Reds House 2f
```

This confused the LLM agent, which attempted to navigate to "Map #255" warps and wasted turns.

## Root Cause

In Pokemon Gen 1, `destMapId = 0xFF (255)` in warp entries means "return to the previous map" (the map the player came from). It is not a literal map ID. The game resolves this at runtime to the actual previous map.

`WarpReader.ts` reads the raw byte from RAM at `wWarpEntries + offset + 3`:

```typescript
destMapId: warpData[off + 3],  // 0xFF for "last map" warps
```

Neither `MapGraph.build()` nor the viewer's `visualGraphFromMapMemory()` filtered this value, so it was stored as a real edge to map 255.

## Fix

Two locations:

1. **`src/game/MapGraph.ts:42-44`** — Skip warps with `destMapId === 0xFF` during graph construction:
   ```typescript
   for (const warp of map.warps) {
     if (warp.destMapId === 0xff) {
       continue;
     }
     edgeList.push({ ... });
   }
   ```

2. **`viewer/src/components/mapVisuals.ts:69`** — Same filter in the viewer's graph builder:
   ```typescript
   const toMapId = numberValue(warp.destMapId);
   if (toMapId === 0xff) continue;
   ```

## Why Not Resolve 0xFF to the Actual Map?

The harness does not track `wLastMap` (the game's internal "previous map" variable). Adding it to the memory profile would require identifying the correct RAM address and verifying it across Red/Blue versions. Filtering is simpler and correct — these warps are the indoor exit doors, and the connection is already represented by the reverse warp from the outdoor map.

## Tests Added

- `tests/pokemon/MapGraph.test.ts`: "build filters out warps with destMapId 255" — graph with destMapId=255 warp has only 1 edge (the valid one)
- `tests/pokemon/MapGraph.test.ts`: "renderForLLM does not mention Map #255" — rendered text does not contain "255"

## References

- pokered source: `home/overworld.asm` — `LoadMapData` resolves `$FF` destMapId to `wLastMap`
- `wLastMap` at 0xD365 in pokered (not currently in the harness memory profile)
