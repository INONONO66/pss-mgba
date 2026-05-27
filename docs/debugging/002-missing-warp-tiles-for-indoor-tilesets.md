# 002: Missing Warp Tiles for Indoor Tilesets

## Symptom

Even after fixing tile classification (issue 001), some indoor map exits were not recognized as warp tiles. The `walkabilityGrid` treated door/exit tiles as impassable walls because they lacked the `"warp"` feature needed to override wall terrain.

## Root Cause

`WARP_TILES` in `src/game/tilesetSpecialTiles.ts` was missing entries for 7 tilesets. The data was sourced from pokered `data/tilesets/warp_tile_ids.asm`, which uses assembly **fallthrough chains** — multiple tileset labels share the same tile list by falling through to the next label without a terminator.

Example from pokered:
```asm
.MartWarpTileIDs:
.PokecenterWarpTileIDs:
    warp_tiles $5E       ; both Mart and Pokecenter share $5E

.ForestGateWarpTileIDs:
.MuseumWarpTileIDs:
.GateWarpTileIDs:
    db $3B
    ; fallthrough into RedsHouse which adds $1A, $1C
.RedsHouse1WarpTileIDs:
.RedsHouse2WarpTileIDs:
    warp_tiles $1A, $1C
```

The original code only captured tiles from the first label, missing inherited tiles from fallthrough.

## Missing Tilesets

| Tileset | Expected Warp Tiles | Was Missing |
|---------|-------------------|-------------|
| MART (2) | `$5E` | Entirely missing |
| POKECENTER (6) | `$5E` | Entirely missing |
| REDS_HOUSE_1 (1) | `$1A, $1C` | Entirely missing |
| REDS_HOUSE_2 (4) | `$1A, $1C` | Entirely missing |
| FOREST_GATE (9) | `$3B, $1A, $1C` | Entirely missing |
| MUSEUM (10) | `$3B, $1A, $1C` | Entirely missing |
| GATE (12) | `$3B, $1A, $1C` | Entirely missing |
| CEMETERY (15) | `$1B, $13` | Had `$1B`, missing `$13` |
| FACILITY (22) | `$43, $58, $20, $1B, $13` | Had first 3, missing `$1B, $13` |

## Fix

`src/game/tilesetSpecialTiles.ts` — Added all missing tilesets with fully resolved fallthrough tile IDs.

## References

- pokered source: `data/tilesets/warp_tile_ids.asm`
