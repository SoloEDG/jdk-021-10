import type { Game, RecipeId, Ingredient } from "../../../shared/types";
import { recipes, ingredients } from "../../../shared/catalog";
import { recordEvent } from "../../../shared/events";
import { preparationIssue } from "../lib/availability";
export function prepare(g: Game, r: RecipeId, orderId: number | null = null) {
  const issue = preparationIssue(g, r);
  if (issue) {
    g.notice = issue;
    return;
  }
  g.stock[recipes[r].ingredient]--;
  // A selected accepted order of the same dish becomes the destination of this
  // portion. The link keeps the kitchen honest: a steak prepped for another
  // guest is not silently counted as prep for this guest.
  const target = g.orders.find(
    (o) => o.id === orderId && o.status === "accepted" && o.recipe === r,
  );
  const portion = {
    id: g.nextId++,
    recipe: r,
    preparedAt: g.time,
    orderId: target?.id ?? null,
  };
  g.portions.push(portion);
  recordEvent(g, "prepare", {
    portionId: portion.id,
    recipe: r,
    orderId: portion.orderId,
  });
  g.notice = target
    ? `${recipes[r].name} 备料完成，为 ${target.guest} 准备，可送入灶台`
    : `${recipes[r].name} 备料完成，可送入灶台`;
}
export function restock(g: Game, i: Ingredient) {
  if (g.stock[i] >= 12) {
    g.notice = "库存充足，上限12份";
    return;
  }
  g.stock[i] = Math.min(12, g.stock[i] + 3);
  g.entries.push({
    id: g.nextId++,
    time: g.time,
    label: `采购${ingredients[i].name} ×3`,
    amount: -ingredients[i].cost * 3,
    kind: "supply",
  });
  g.notice = "已购入3份食材，费用计入账本";
}
