import type { Ingredient, RecipeId } from "../../../shared/types";

/**
 * A small DSL the kitchen director can edit without touching the engine.
 *
 * A step is "done" when its rule matches the kitchen's business state or event
 * log. A step may declare several prerequisites, which makes parallel branches
 * possible. A failure branch may send the flow back, but always declares a retry
 * limit and an exit.
 *
 * `orderId` may be omitted (or 0) on every order-bound sense: the lesson then
 * judges the order it is currently teaching. Naming a concrete id is useful
 * when the director wants a different order to be the subject of a branch.
 */
export type StepId = string;
export type Sense =
  | { kind: "order-accepted"; orderId?: number }
  | { kind: "portion-prepared"; recipe: RecipeId; orderId?: number }
  | { kind: "cooked"; recipe: RecipeId; orderId?: number }
  | {
      kind: "lifted";
      recipe: RecipeId;
      orderId?: number;
      /**
       * "good" = within ±2s; "early" = before the window; "late" = after the
       * window but not yet burnt; "off" = any miss; "burnt" = well past it.
       */
      window?: "good" | "early" | "late" | "off" | "burnt";
      minQuality?: number;
    }
  | { kind: "plated"; recipe: RecipeId; orderId?: number }
  | {
      kind: "served";
      recipe: RecipeId;
      orderId?: number;
      minQuality?: number;
      maxQuality?: number;
    }
  | {
      kind: "discarded";
      recipe: RecipeId;
      orderId?: number;
      /** Only a dish the kitchen flagged as burnt. */
      burnt?: boolean;
    }
  | { kind: "stock-at-least"; ingredient: Ingredient; count: number }
  | { kind: "stove-free"; stoveId: number }
  | { kind: "equipment-available"; station: "pan" | "pot" };

export interface TutorialStep {
  id: StepId;
  /** Short title shown in the lesson rail. */
  title: string;
  /** One or two sentences of chef narration. */
  body: string;
  /** Business-state rule. Evaluated every tick, so prior work counts too. */
  done: Sense;
  /**
   * Steps that must be done before this step becomes active. Leave empty for a
   * parallel branch that may be completed alongside the opening steps.
   */
  after?: StepId[];
  /**
   * Failure branches, checked in order. Each declares its own retry limit and
   * exit, so no loop can spin.
   */
  fails?: FailBranch[];
  /**
   * Equipment the demonstration would like to use. The director only reserves
   * it as a hint: normal orders are never blocked, and the reservation is
   * released when the step is done or the lesson closes.
   */
  reserve?: "pan" | "pot";
}

export interface FailBranch {
  /** Business fact that triggers the failure, e.g. a burnt lift. */
  when: Sense;
  /** Player-facing explanation of what went wrong and what to do next. */
  message: string;
  /** What the player must demonstrate before the retry begins (e.g. discard). */
  recover?: Sense;
  /** Where a retry jumps back to. Must be this step or an earlier one. */
  retryFrom: StepId;
  /** Hard stop for the loop: retries beyond this exit the branch. */
  maxRetries: number;
  /** Flow after retries are exhausted. Every loop therefore has an exit. */
  onExhausted: "exit" | StepId;
}

export interface TutorialDefinition {
  id: string;
  title: string;
  subtitle: string;
  targetRecipe: RecipeId;
  steps: TutorialStep[];
  /** First step the director wants to show. */
  startAt?: StepId;
  /** Copy shown at the end of the lesson. */
  outro: string;
}
