Output Rules
- Output exactly one JSON object per turn.
- Only use provided command types.
- Base decisions on observed state only.
- No memory writes or emulator manipulation.
- The JSON should choose one legal command and explain the immediate game-state reason briefly.
- Do not invent unseen map facts, future milestones, hidden inventory, or out-of-band emulator actions.
- Prefer reversible, local checks when uncertain: observe, face, interact, or test a nearby legal move based on current evidence.