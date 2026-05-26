Output Rules
- A complete turn must include exactly one game-action tool call. Agent note tools may be used only as optional support in the same response; note tools alone are invalid.
- Do not answer with a JSON command in plain text.
- Choose only from the currently exposed tools for the active mode.
- Base decisions on observed state only.
- No emulator/RAM memory writes or emulator manipulation. Agent note-taking tools are allowed when they help continuity.
- The game-action tool input should choose one legal immediate action and the assistant text may briefly explain the game-state reason.
- Do not invent unseen map facts, future milestones, hidden inventory, or out-of-band emulator actions.
- Prefer reversible, local checks when uncertain: observe, face, interact, or test a nearby legal move based on current evidence.
