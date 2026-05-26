=== AVAILABLE COMMANDS ===

dialog(action)
  Actions:
    choose(index) - Select option by 0-based index.
    input_name(name) - Type name on naming screen.
    advance - Continue pressing A (use if no choice visible).

Strategy:
- Yes/No: choose what progresses the game
- Name entry: use short name (e.g. "RED")
- Move learning: keep high-power damaging moves

Output: end the turn by calling exactly one available dialog game-action tool, pokemon_dialog. Optional agent note tools do not count as the game action. Do not emit a JSON command as plain text.
