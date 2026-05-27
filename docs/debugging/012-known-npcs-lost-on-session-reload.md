# 012: Known NPCs Lost on Session Reload

## Symptom

After restarting the harness, the agent lost all previously discovered NPC information. NPCs that were found during the previous session (e.g., Mom in Red's House 1F) were no longer shown in the `knownNpcs` observation. The agent had to re-discover every NPC from scratch each session.

## Root Cause

The persistence pipeline correctly saved NPC data to JSON:

```
toPersistedMap() → writes knownNpcs to JSON ✓
fromPersistedMap() → rebuilds knownNpcs Map with onScreen:false ✓
```

But `MapMemory.loadRecord()` discarded the rebuilt data:

```typescript
// MapMemory.ts:407 — BEFORE
loadRecord(record: MapRecord): void {
  this.maps.set(record.mapId, { ...record, knownNpcs: new Map() });
  //                                       ^^^^^^^^^^^^^^^^^^^^^^^^
  //                                       freshly rebuilt knownNpcs thrown away
}
```

Same bug in `importRecords()`:

```typescript
// MapMemory.ts:383 — BEFORE
this.maps.set(incoming.mapId, { ...incoming, tiles, npcPositions: [], knownNpcs: new Map() });
```

## Fix

Both methods now preserve the incoming knownNpcs:

```typescript
// loadRecord — AFTER
loadRecord(record: MapRecord): void {
  this.maps.set(record.mapId, {
    ...record,
    knownNpcs: new Map(record.knownNpcs),
  });
}

// importRecords — AFTER
this.maps.set(incoming.mapId, {
  ...incoming, tiles, npcPositions: [], knownNpcs: new Map(incoming.knownNpcs),
});
```

Using `new Map(record.knownNpcs)` creates a shallow copy to avoid shared references between the store and runtime.

## Tests Added

- `tests/pokemon/MapMemory.test.ts`: "loadRecord preserves knownNpcs from the source record"
- `tests/pokemon/MapMemory.test.ts`: "importRecords preserves knownNpcs for new maps"

## Data Flow

```
Session N: agent discovers Mom at (5,4) on map 37
  → knownNpcs.set(1, {slot:1, mapY:5, mapX:4, ...})
  → mapMemoryStore.onUpdate() → toPersistedMap() → JSON file

Session N+1: harness loads JSON
  → fromPersistedMap() → rebuilds knownNpcs Map (onScreen:false) ✓
  → mapMemory.loadRecord() → was: new Map() (lost) → now: new Map(record.knownNpcs) (preserved) ✓
  → agent sees Mom in knownNpcs observation ✓
```
