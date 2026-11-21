import type { Game } from "../../../shared/types";
import { recipes } from "../../../shared/catalog";
import { recordEvent } from "../../../shared/events";
import { quality } from "../lib/heat";
export function cook(g: Game, portion: number, stove: number) {
  const p = g.portions.find((p) => p.id === portion),
    s = g.stoves.find((s) => s.id === stove);
  if (!p || !s || s.portion) return;
  if (recipes[p.recipe].station !== s.kind) {
    g.notice = "设备不匹配：意面用汤锅，牛排和沙拉用煎锅";
    return;
  }
  s.portion = p;
  s.started = g.time;
  g.portions = g.portions.filter((x) => x.id !== portion);
  recordEvent(g, "cook", {
    portionId: p.id,
    stoveId: s.id,
    recipe: p.recipe,
    orderId: p.orderId ?? null,
  });
  const guest = g.orders.find((o) => o.id === p.orderId)?.guest;
  g.notice = guest
    ? `已经下锅，为 ${guest} 烹饪，请在最佳火候起锅`
    : "已经下锅，请在最佳火候起锅";
}
export function lift(g: Game, id: number) {
  const s = g.stoves.find((s) => s.id === id);
  if (!s?.portion) return;
  if (g.dishes.length >= 8) {
    g.notice = "出餐台已满，请先上菜或丢弃";
    return;
  }
  const p = s.portion,
    elapsed = g.time - s.started,
    q = quality(p.recipe, elapsed);
  const burnt = elapsed > recipes[p.recipe].target * 1.8;
  g.dishes.push({
    id: p.id,
    recipe: p.recipe,
    quality: q,
    cookedAt: g.time,
    stage: "counter",
    orderId: p.orderId ?? null,
    tutorial: p.tutorial,
    burnt: burnt || undefined,
  });
  s.portion = null;
  recordEvent(g, "lift", {
    dishId: p.id,
    stoveId: s.id,
    recipe: p.recipe,
    orderId: p.orderId ?? null,
    quality: q,
    elapsed,
    burnt: burnt || undefined,
  });
  g.notice = burnt
    ? `起锅太晚，已经烧糊，品质 ${q}，建议丢弃重做`
    : `起锅完成，品质 ${q}，前往装盘`;
}
