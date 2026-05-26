import { generateText } from "ai";
import type { LanguageModel } from "ai";
import type { BagItem, FullGameState, PartyPokemon } from "../game/PokemonTypes.js";

const DEFAULT_COOLDOWN_TURNS = 10;
const DEFAULT_MAX_TOKENS = 300;

const SYSTEM_PROMPT = `You are a Pokemon Red/Blue walkthrough expert. A player is stuck and needs concrete guidance.

Rules:
- Give 1-3 sentences of specific, actionable advice.
- Reference specific map locations, NPCs, or items by name when possible.
- Base advice on the player's current state: map, badges, party, bag, and flags.
- Do not give a full walkthrough — only the immediate next step.
- Do not reference game mechanics the player cannot observe (internal flags, hidden values).
- If the player has a quest item, suggest where to deliver it.
- If the player is in a new area, suggest what to explore first.
- If a reference walkthrough is provided, use it as your primary source of truth for location-specific advice. Do not contradict the walkthrough.

Team and resource awareness:
- If the party has a clear type gap for the next gym, suggest catching a specific Pokemon and where to find it.
- If the bag has zero Poke Balls and uncaught Pokemon are needed, suggest visiting the nearest Poke Mart first.
- If healing items are depleted and the party is hurt, suggest healing at the Pokemon Center and restocking.
- If the party is underleveled for the area, suggest grinding on nearby wild Pokemon or trainer routes.
- If the player lacks an HM user (Cut, Fly, Surf, Strength), suggest catching an appropriate Pokemon.`;

export interface LLMAdviserConfig {
  readonly model: LanguageModel;
  readonly cooldownTurns?: number;
  readonly maxTokens?: number;
  readonly generateTextFn?: typeof generateText;
}

export interface LLMAdviserInput {
  readonly fullState?: FullGameState;
  readonly stuckReasons: readonly string[];
  readonly visitedMapIds: readonly number[];
  readonly recentHistory?: string;
  readonly currentGoal?: string;
  readonly walkthroughContext?: string;
}

export interface LLMAdviserResult {
  readonly advice: string;
  readonly situationKey: string;
}

export class LLMAdviser {
  private readonly config: Required<Pick<LLMAdviserConfig, "cooldownTurns" | "maxTokens" | "generateTextFn">>
    & Pick<LLMAdviserConfig, "model">;
  private lastAdviseStep = Number.NEGATIVE_INFINITY;

  constructor(config: LLMAdviserConfig) {
    this.config = {
      ...config,
      cooldownTurns: config.cooldownTurns ?? DEFAULT_COOLDOWN_TURNS,
      maxTokens: config.maxTokens ?? DEFAULT_MAX_TOKENS,
      generateTextFn: config.generateTextFn ?? generateText,
    };
  }

  canAdvise(step: number): boolean {
    return step - this.lastAdviseStep >= this.config.cooldownTurns;
  }

  async advise(input: LLMAdviserInput, step: number): Promise<LLMAdviserResult | undefined> {
    if (!this.canAdvise(step)) {
      return;
    }

    try {
      const request = {
        model: this.config.model,
        system: SYSTEM_PROMPT,
        prompt: buildUserPrompt(input),
        maxTokens: this.config.maxTokens,
      };
      const { text } = await this.config.generateTextFn(request);

      this.lastAdviseStep = step;

      return {
        advice: text.trim(),
        situationKey: buildSituationKey(input),
      };
    } catch (error) {
      console.warn("LLMAdviser failed to generate advice", error);
      return;
    }
  }
}

function buildUserPrompt(input: LLMAdviserInput): string {
  const state = input.fullState;
  const mapName = state?.map.mapName ?? "unknown";
  const mapId = state?.player.position.mapId ?? "unknown";
  const position = state?.player.position;
  const x = position?.x ?? "unknown";
  const y = position?.y ?? "unknown";
  const badges = state?.player.badges.count ?? 0;
  const flags = state?.flags;

  return `Current state:
- Map: ${mapName} (id ${mapId})
- Position: (${x}, ${y})
- Badges: ${badges}/8
- Party: ${formatParty(state)}
- Bag: ${formatBag(state)}
- Story flags: Pokedex=${flags?.hasPokedex ?? false}, Oak's Parcel=${flags?.hasOaksParcel ?? false}, Delivered=${flags?.deliveredOaksParcel ?? false}

Stuck because: ${formatReasons(input.stuckReasons)}

Maps visited: ${formatVisitedMaps(input)}

Current goal: ${input.currentGoal?.trim() || "unknown"}

 ${formatRecentHistory(input.recentHistory)}${formatWalkthroughContext(input.walkthroughContext)}What should the player do next?`;
}

function formatParty(state: FullGameState | undefined): string {
  const members = state?.party.members ?? [];
  if (members.length === 0) {
    return "none";
  }
  return members.map(formatPokemon).join(", ");
}

function formatPokemon(pokemon: PartyPokemon): string {
  return `${pokemon.species} Lv${pokemon.level} (${pokemon.hp}/${pokemon.maxHp} HP)`;
}

function formatBag(state: FullGameState | undefined): string {
  const items = state?.bag ?? [];
  if (items.length === 0) {
    return "empty";
  }
  return items.map(formatBagItem).join(", ");
}

function formatBagItem(item: BagItem): string {
  return `${item.name} x${item.quantity}`;
}

function formatReasons(reasons: readonly string[]): string {
  return reasons.length === 0 ? "unknown" : reasons.join("; ");
}

function formatVisitedMaps(input: LLMAdviserInput): string {
  if (input.visitedMapIds.length === 0) {
    return "none";
  }

  const currentMapId = input.fullState?.map.mapId;
  const currentMapName = input.fullState?.map.mapName;
  return input.visitedMapIds.map((mapId) => {
    if (mapId === currentMapId && currentMapName !== undefined) {
      return `${currentMapName} (id ${mapId})`;
    }
    return `map ${mapId}`;
  }).join(", ");
}

function formatRecentHistory(recentHistory: string | undefined): string {
  const trimmed = recentHistory?.trim();
  return trimmed === undefined || trimmed.length === 0 ? "" : `Recent history: ${trimmed}\n\n`;
}

function formatWalkthroughContext(context: string | undefined): string {
  const trimmed = context?.trim();
  if (!trimmed || trimmed.length === 0) {
    return "";
  }
  return `\nReference walkthrough for this area:\n${trimmed}\n\n`;
}

function buildSituationKey(input: LLMAdviserInput): string {
  const mapId = input.fullState?.player.position.mapId ?? "unknown";
  const badges = input.fullState?.player.badges.count ?? 0;
  const stuckType = input.stuckReasons[0]?.slice(0, 30) ?? "unknown";
  return `map:${mapId}:badges:${badges}:stuck:${stuckType}`;
}
