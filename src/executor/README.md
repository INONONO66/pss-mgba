# Executor Layer

The executor layer translates high-level game commands (navigate, interact, dialog, battle) into mGBA button presses and reads Game Boy RAM to detect state transitions.

## Architecture

```
LLM Agent
    │
    ▼
command-tools.ts          ← Tool wrappers for the AI SDK
    │                        Includes post-command auto-handler
    ▼
CommandExecutor.ts        ← Command router (dispatches by type + mode)
    │
    ├── NavigateExecutor   ← Pathfinding + step-by-step movement
    ├── InteractExecutor   ← Face direction + press A
    ├── DialogExecutor     ← Advance text, detect choices, collect transcript
    ├── BattleExecutor     ← Menu navigation + narration collection
    └── MgbaAdapters       ← RAM readers that bridge executors to mGBA-http
```

## RAM Signal Reference

All detection relies on reading Game Boy memory through mGBA-http's `read8` / `readRange` endpoints.

### Dialog Detection — `rWY` (0xFF4A)

The Game Boy Window Y register controls the text window layer position.

| rWY Value | Meaning |
|-----------|---------|
| `< 144`   | Text window visible on screen — dialog is active |
| `>= 144`  | Text window off-screen — no dialog |

Gen 1 Pokemon sets `rWY` to a low value when opening a text box and resets it to `144` (`$90`) in the `CloseTextDisplay` routine. This is the most reliable lifecycle signal because:

- `wTextBoxID` is **not** cleared when dialog closes (stays non-zero → stale)
- `wJoyIgnore` transitions to 0 before the text engine finishes
- Screen text (`wTileMap` decoded) contains stale overworld tiles after close

The `WINDOW_HIDDEN_CONFIRM_COUNT` of 2 consecutive hidden readings prevents false positives from momentary page transitions where `rWY` flickers to 144 for one frame.

### Choice Detection — Tilemap Sub-Box

YES/NO and other overlay menus (BUY/SELL/QUIT, etc.) render a bordered sub-box above the main dialog area (rows 12–17) in the tilemap.

Detection: read `wTileMap + 154` (row 7, col 14). If the byte equals `0x79` (the `┌` box corner tile), a choice menu is on screen.

Why not RAM flags:
- `wTextBoxID === 0x0D` — unreliable; value is `0x14` (20) during YES/NO in starter selection
- `wMenuWatchedKeys` — always `255` in overworld, `3` during both regular dialog and menus; useless for distinguishing choices from normal text

### Battle Menu Detection — Tilemap Arrow

The battle action menu (FIGHT/ITEM/POKéMON/RUN) is detected by checking for the `▶` arrow tile (`0xED`) at tilemap offset `289` (row 14, col 9). When this tile is present, the game is waiting for the player to select a battle action.

### Battle State — `wIsInBattle` (0xD057)

| Value | Meaning |
|-------|---------|
| `0`   | Not in battle |
| `1`   | Wild battle |
| `2`   | Trainer battle |

## Module Details

### DialogExecutor

Advances dialog by pressing A repeatedly and collecting completed text pages.

**Transcript collection**: Text is recorded only when it matches the previous reading (text stable = page fully rendered). This prevents capturing mid-render typing artifacts like `"OAK Now AAA"` instead of the complete `"OAK Now AAAAAAA which POK MON do"`.

**Terminal conditions** (checked each iteration before pressing A):

| Condition | Result Reason |
|-----------|--------------|
| `isInBattle()` returns true | `battle_started` |
| `isChoiceActive()` returns true (sub-box detected) | `choice_appeared` |
| `isNamingScreenActive()` returns true | `naming_screen` |
| `rWY >= 144` for 2 consecutive reads | `dialog_ended` |
| 120 presses exhausted | `dialog_stuck` (failure) |

**Constants**:
- `PRESS_FRAMES = 16` — A button hold duration; long enough for the game to process input and update RAM
- `MAX_DIALOG_PRESSES = 120` — budget for long scripted dialogs (Oak speeches, trainer post-battle text)
- `WINDOW_HIDDEN_CONFIRM_COUNT = 2` — consecutive hidden reads required to confirm dialog end

### BattleExecutor

Navigates the battle menu to select a move, then collects battle narration text.

**Fight flow**:
1. Navigate to FIGHT in the top menu (`Up + Left + A`)
2. Select the move by index (`Down` × N + `A`)
3. Call `advanceBattleNarration` — press A repeatedly while reading screen text
4. Stop when: battle menu arrow (`0xED`) reappears, or `wIsInBattle` becomes 0

**Narration collection** uses the same stability logic as DialogExecutor — only records text pages that match the previous reading.

Returns `battle_ended` when `wIsInBattle` drops to 0 after narration, or `move_used` if the battle continues to the next turn menu.

### MgbaAdapters

Creates concrete implementations of the executor interfaces by reading mGBA RAM:

| Factory Function | Produces | Used By |
|-----------------|----------|---------|
| `createDialogStateReader` | `DialogStateReader` | DialogExecutor, BattleExecutor |
| `createInteractStateReader` | `InteractStateReader` | InteractExecutor |
| `createNavigateWorldReader` | `NavigateWorldReader` | NavigateExecutor |
| `createNavigateMapSource` | `NavigateMapSource` | NavigateExecutor |
| `createUnifiedController` | All controllers | All executors |
| `toCommandGameMode` | `GameMode` | Mode classification |

Key adapter methods:
- `isDialogActive()` — reads `rWY`, returns `windowY < 144`
- `isWindowVisible()` — same as above, used by DialogExecutor
- `isChoiceActive()` — reads tilemap byte at sub-box corner offset
- `isInBattle()` — reads `wIsInBattle`
- `readTileAt(offset)` — reads single byte from `wTileMap + offset`
- `readScreenText()` — decodes entire `wTileMap` (360 bytes) via `decodeGen1Text`

### Post-Command Auto-Handler (command-tools.ts)

`handlePostCommand` runs after every command execution in `runCommandTool`. It handles state transitions that occur as a side effect of the command:

**After navigate/interact/wait**:
- If game entered dialog → auto-advance, collect transcript, return with `choice_appeared` or transcript
- If game entered battle → return battle state

**After battle command**:
- Advance battle narration text (attack results, level ups, etc.)
- Detect battle end → return `battle_ended`

This means the LLM agent never needs to manually handle unexpected dialogs or transitions — the tool layer handles them transparently and includes the context in the result.

## Tilemap Layout Reference

Gen 1 Pokemon Red/Blue uses a 20×18 tile map at `wTileMap` (0xC3A0, 360 bytes).

```
Row  0-6:   Game area (overworld/battle sprites)
Row  7-11:  Overlay menu area (YES/NO box when present)
Row 12-17:  Main text/dialog box
```

Key tile values:
- `0x79` = `┌` (box top-left corner)
- `0x7A` = `─` (horizontal border)
- `0x7B` = `┐` (box top-right corner)
- `0x7C` = `│` (vertical border)
- `0x7D` = `└` (box bottom-left corner)
- `0x7E` = `┘` (box bottom-right corner)
- `0x7F` = space
- `0x80-0x99` = A-Z
- `0xA0-0xB9` = a-z
- `0xED` = `▶` (menu cursor arrow)
