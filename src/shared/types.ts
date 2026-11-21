export type RecipeId = "steak" | "pasta" | "salad";
export type Ingredient = "beef" | "noodle" | "greens";
export interface Recipe {
  id: RecipeId;
  name: string;
  icon: string;
  ingredient: Ingredient;
  station: "pan" | "pot";
  target: number;
  price: number;
}
export interface Order {
  id: number;
  recipe: RecipeId;
  guest: string;
  arrived: number;
  deadline: number;
  status: "waiting" | "accepted" | "served" | "left";
  servedAt?: number;
  servedQuality?: number;
  /** Orders opened by the tutorial are clearly marked for the player. */
  tutorial?: boolean;
}
export interface Portion {
  id: number;
  recipe: RecipeId;
  preparedAt: number;
  /**
   * The order this portion was prepared for. Set when a matching accepted
   * order is selected on the prep station. The tutorial uses this link so a
   * steak prepared for another guest is never mistaken for the lesson target.
   */
  orderId?: number | null;
  /** True when the portion was created inside a tutorial scene. */
  tutorial?: boolean;
  /** Scenery seeded by the practice kitchen (a neighbouring order cooking). */
  backdrop?: boolean;
}
export interface Stove {
  id: number;
  kind: "pan" | "pot";
  portion: Portion | null;
  started: number;
}
export interface Dish {
  id: number;
  recipe: RecipeId;
  quality: number;
  cookedAt: number;
  stage: "counter" | "plated";
  orderId?: number | null;
  /** True when the dish belongs to a tutorial scene, never to the real shift. */
  tutorial?: boolean;
  /** Set when the dish stayed on the stove past the burn threshold. */
  burnt?: boolean;
}
export interface Entry {
  id: number;
  time: number;
  label: string;
  amount: number;
  kind: "sale" | "waste" | "miss" | "supply";
  orderId?: number | null;
  /** Entries produced by the practice kitchen, never the player's real shift. */
  tutorial?: boolean;
}
/**
 * Append-only business facts. Tutorials are judged against these facts and the
 * live kitchen state, never against the fact that a button was clicked. The log
 * also lets a lesson recognise work the player completed before opening it.
 */
export type GameEventType =
  | "accept"
  | "prepare"
  | "cook"
  | "lift"
  | "plate"
  | "serve"
  | "serve-rejected"
  | "discard"
  | "miss";
export interface GameEvent {
  id: number;
  time: number;
  type: GameEventType;
  orderId?: number | null;
  portionId?: number | null;
  dishId?: number | null;
  stoveId?: number | null;
  recipe?: RecipeId;
  quality?: number;
  elapsed?: number;
  reason?: string;
  guest?: string;
  /** The dish was past the burn threshold when it left the stove. */
  burnt?: boolean;
}
export interface Game {
  time: number;
  duration: number;
  running: boolean;
  ended: boolean;
  nextId: number;
  nextEventId: number;
  selectedOrder: number | null;
  selectedDish: number | null;
  orders: Order[];
  stock: Record<Ingredient, number>;
  portions: Portion[];
  stoves: Stove[];
  dishes: Dish[];
  entries: Entry[];
  events: GameEvent[];
  combo: number;
  served: number;
  missed: number;
  notice: string;
  best: number;
  /**
   * Practice kitchens run a single, authored scene: no timed arrivals, no
   * shift end, and no changes to the player's saved shift or best score.
   */
  tutorial?: boolean;
}
export type Command =
  | { type: "accept"; id: number }
  | { type: "select-order"; id: number }
  | {
      type: "prepare";
      recipe: RecipeId;
      /** Accepted order this portion is being made for, if the player chose one. */
      orderId?: number | null;
    }
  | { type: "cook"; portion: number; stove: number }
  | { type: "lift"; id: number }
  | { type: "plate"; id: number }
  | { type: "select-dish"; id: number }
  | { type: "serve" }
  | { type: "discard"; id: number }
  | { type: "restock"; ingredient: Ingredient };
