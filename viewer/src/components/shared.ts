import type { Action, Command, GameStateSnapshot } from "../api/types";

export function value(input: unknown, fallback = "?"): string { return input === undefined || input === null || input === "" ? fallback : String(input); }
export function boolText(input: unknown): string { return input ? "예" : "아니오"; }
export function json(input: unknown): string { return JSON.stringify(input ?? {}, null, 2); }

export function unwrapState(snapshot?: GameStateSnapshot): Record<string, unknown> {
  const root = snapshot?.state;
  if (isRecord(root) && isRecord(root.state)) { return root.state; }
  if (isRecord(root)) { return root; }
  return isRecord(snapshot) ? snapshot : {};
}

export function isRecord(input: unknown): input is Record<string, unknown> { return input !== null && typeof input === "object" && !Array.isArray(input); }
function at(record: Record<string, unknown>, path: string[]): unknown { return path.reduce<unknown>((current, key) => isRecord(current) ? current[key] : undefined, record); }

export function dialogText(state: Record<string, unknown>): string {
  return String(at(state, ["menuText", "screenText"]) ?? state.screenText ?? "");
}

export function stateFields(snapshot: GameStateSnapshot) {
  const state = unwrapState(snapshot);
  const mapId = at(state, ["map", "mapId"]) ?? at(state, ["coordinates", "mapId"]) ?? state.wCurMap ?? state.mapId;
  const mapName = at(state, ["map", "mapName"]);
  const y = at(state, ["player", "position", "y"]) ?? at(state, ["coordinates", "y"]) ?? state.wYCoord ?? state.y;
  const x = at(state, ["player", "position", "x"]) ?? at(state, ["coordinates", "x"]) ?? state.wXCoord ?? state.x;
  const facing = at(state, ["player", "facing", "direction"]) ?? at(state, ["playerFacing", "direction"]) ?? state.playerFacingDirection;
  const party = isRecord(state.party) ? state.party : {};
  const members = Array.isArray(party.members) ? party.members : [];
  const lead = isRecord(members[0]) ? members[0] : undefined;
  const hp = isRecord(party.firstPokemonHp) ? party.firstPokemonHp : {};
  const partyCount = party.count ?? state.wPartyCount ?? state.partyCount ?? 0;
  const partyText = lead ? `${value(lead.nickname)} ${value(lead.species)} Lv${value(lead.level)} HP ${value(lead.hp)}/${value(lead.maxHp)}` : `${value(partyCount, "0")}/6 · 선두 HP ${value(hp.current ?? state.wPartyMon1HP)}/${value(hp.max ?? state.wPartyMon1MaxHP)}`;
  const badgeCount = at(state, ["player", "badges", "count"]) ?? at(state, ["badges", "count"]) ?? state.badgeCount ?? 0;
  const battle = at(state, ["battle", "inBattle"]) ?? at(state, ["battle", "kind"]) ?? state.wIsInBattle;
  return { state, mapId, mapName: typeof mapName === "string" ? mapName : undefined, y, x, facing, partyText, badgeCount, battle, dialog: dialogText(state) };
}

export function mapAsciiFromState(state: Record<string, unknown>): string | null {
  const map = isRecord(state.map) ? state.map : {};
  const ascii = state.mapAscii ?? map.ascii ?? state.asciiMap;
  return typeof ascii === "string" ? ascii : null;
}

export function summarizeAction(input: { parsedDecision?: { command?: Command; action?: Action } }): string {
  const cmd = input.parsedDecision?.command;
  const action = input.parsedDecision?.action;
  if (cmd) {
    if (cmd.type === "navigate") { return `navigate(${value(cmd.x)},${value(cmd.y)})`; }
    if (cmd.type === "interact") { return `interact(${value(cmd.direction, "현재")})`; }
    if (cmd.type === "wait") { return `대기 ${value(cmd.frames)}f`; }
    if (cmd.type === "raw") { return `raw [${Array.isArray(cmd.inputs) ? cmd.inputs.join(",") : ""}]`; }
    return cmd.type;
  }
  if (action) {
    if (action.type === "wait") { return `대기 ${value(action.frames)}`; }
    if (action.type === "sequence") {
      const actions = Array.isArray(action.actions) ? action.actions : [];
      return `시퀀스 (${actions.map((entry) => summarizeAction({ parsedDecision: { action: entry } })).join(" → ")})`;
    }
    const record = action as Record<string, unknown>;
    return `${action.type} ${value(record.button)} ${value(record.frames)}`;
  }
  return "대기 중";
}
