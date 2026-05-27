# 006: Vision-Based Supervisor Intervention

## Context

Even with the stuck detector fixed (issue 005), the detector only generates a text hint via the LLM adviser. If the agent ignores the hint or keeps making the same mistake, it stays stuck. A more forceful intervention mechanism was needed.

## Design

Added a vision-based intervention pipeline where the supervisor can directly execute raw button presses when stuck is detected, bypassing the agent entirely.

### Flow

```
Turn Loop
  ├─ recordTurnScreenshot() → PNG saved to raw-screenshots/
  ├─ onTurnStart() → orchestrator.setScreenshotPath(path)
  │                 → orchestrator.update() → StuckDetector
  ├─ tryIntervention()
  │   └─ orchestrator.getStuckIntervention()
  │       └─ (if stuck) LLMAdviser.intervene()
  │           ├─ Read screenshot PNG → base64
  │           ├─ Send to vision LLM with game state context
  │           ├─ LLM returns JSON array of button presses
  │           └─ Parse and validate → RawInput[]
  │   └─ (if intervention returned) Execute buttons directly → skip LLM turn
  └─ (if no intervention) Normal LLM agent turn
```

### Components Changed

**`src/supervisor/LLMAdviser.ts`**
- New `intervene()` method: reads screenshot, sends to vision LLM with multimodal content (image + text), parses JSON button sequence response
- New types: `VisionInterventionInput`, `VisionInterventionResult`
- Vision system prompt instructs the LLM to look at the Game Boy screen and output a JSON array like `[{"button":"Right","frames":8}]`
- Response parsing: extracts JSON array from text, validates button names against allowlist, clamps frame counts

**`src/supervisor/SupervisorOrchestrator.ts`**
- New `setScreenshotPath()` method: stores the latest screenshot path per turn
- New `getStuckIntervention()` method: if stuck, calls `LLMAdviser.intervene()` with screenshot + state

**`src/agent/CommandAgentRunner.ts`**
- New `StuckIntervention` interface and `interventionProvider` option
- New `tryIntervention()` method called before each LLM turn
- If intervention is returned, executes raw button presses directly and skips the LLM turn (continues to next iteration)

**`src/cli/index.ts`**
- Wires `orchestrator.setScreenshotPath()` in `onTurnStart`
- Wires `orchestrator.getStuckIntervention()` as `interventionProvider`

## Prerequisites

The vision intervention requires `OrchestratorConfig.adviserModel` to be set to a vision-capable model. Without this, `llmAdviser` is undefined and intervention silently returns undefined (graceful degradation).

## Validation

- Valid buttons: A, B, Up, Down, Left, Right, Start, Select
- Frame count: clamped to 1-60
- Max inputs per intervention: 20
- If LLM response is unparseable: returns undefined, agent continues normally
