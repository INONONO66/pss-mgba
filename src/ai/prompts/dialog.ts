export function buildDialogContext(): string {
  return `=== AVAILABLE COMMANDS ===

dialog(action)
  Actions:
    choose(index) - Select option by 0-based index.
    input_name(name) - Type name on naming screen.
    advance - Continue pressing A (use if no choice visible).

Strategy:
- Yes/No: choose what progresses the game
- Name entry: use short name (e.g. "RED")
- Move learning: keep high-power damaging moves

Output: {"command": {"type": "...", ...}, "rationale": "..."}`;
}
