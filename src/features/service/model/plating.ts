import type { Game } from "../../../shared/types";
import { recordEvent } from "../../../shared/events";

/**
 * The teachable step names used by the tutorial director when deciding whether
 * a dish is ready for the pass.
 */
export type PlatingStage = "counter" | "plated";

export function plate(g: Game, id: number) {
  const d = g.dishes.find((d) => d.id === id);
  if (!d || d.stage !== "counter") return;
  d.stage = "plated";
  g.selectedDish = id;
  recordEvent(g, "plate", {
    dishId: id,
    recipe: d.recipe,
    orderId: d.orderId ?? null,
  });
  g.notice = "装盘完成，请选中订单后上菜";
}
export function discard(g: Game, id: number) {
  const d = g.dishes.find((d) => d.id === id);
  if (!d) return;
  g.dishes = g.dishes.filter((d) => d.id !== id);
  if (g.selectedDish === id) g.selectedDish = null;
  g.entries.push({
    id: g.nextId++,
    time: g.time,
    label: "丢弃菜品",
    amount: -3,
    kind: "waste",
    orderId: d.orderId ?? null,
    tutorial: d.tutorial,
  });
  recordEvent(g, "discard", {
    dishId: id,
    recipe: d.recipe,
    orderId: d.orderId ?? null,
    quality: d.quality,
    burnt: d.burnt,
  });
  g.notice = d.burnt
    ? "已丢弃烧糊的菜品，重新备料吧"
    : "已丢弃，浪费成本 ¥3";
}
