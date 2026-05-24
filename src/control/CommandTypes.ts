import type { MgbaButton } from "../mgba/MgbaTypes.js";

/** Directional input used by command actions. */
export type Direction = "up" | "down" | "left" | "right";

/** Dialog-specific actions that can be issued by the command system. */
export type DialogAction =
  | { kind: "advance" }
  | { kind: "choose"; index: number }
  | { kind: "input_name"; name: string };

/** Battle-specific actions that can be issued by the command system. */
export type BattleAction =
  | { kind: "fight"; move: string }
  | { kind: "item"; item: string }
  | { kind: "switch"; pokemon: string }
  | { kind: "run" };

/** Low-level raw controller input with an explicit frame count. */
export interface RawInput {
  button: MgbaButton;
  frames: number;
}

/** Navigate the avatar to a target coordinate. */
export type NavigateCommand = { type: "navigate"; x: number; y: number };

/** Interact with the current tile, optionally facing a direction first. */
export type InteractCommand = { type: "interact"; direction?: Direction };

/** Execute a dialog action. */
export type DialogCommand = { type: "dialog"; action: DialogAction };

/** Execute a battle action. */
export type BattleCommand = { type: "battle"; action: BattleAction };

/** Wait for a fixed number of frames. */
export type WaitCommand = { type: "wait"; frames: number };

/** Send raw controller inputs for a free-form fallback. */
export type RawCommand = { type: "raw"; inputs: RawInput[]; reason: string };

/** Discriminated union of all supported command variants. */
export type Command =
  | NavigateCommand
  | InteractCommand
  | DialogCommand
  | BattleCommand
  | WaitCommand
  | RawCommand;

/** Decision payload produced by the policy layer. */
export interface PolicyDecision {
  command: Command;
  rationale: string;
}

/** Status values reported by command execution. */
export type CommandStatus = "success" | "partial" | "interrupted" | "failed" | "rejected";

/** Result returned after attempting to execute a command. */
export interface CommandResult {
  status: CommandStatus;
  reason: string;
  details?: string;
}

/** History record for a single executed command. */
export interface CommandHistoryEntry {
  command: Command;
  result: CommandResult;
  step: number;
}

/** High-level game mode used by the command system. */
export type GameMode = "overworld" | "battle" | "dialog";
