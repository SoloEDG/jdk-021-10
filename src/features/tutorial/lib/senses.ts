import type { Game, GameEvent, RecipeId } from "../../../shared/types";
import { recipes } from "../../../shared/catalog";
import type { Sense } from "../model/dsl";

/**
 * Each step judges against both live kitchen state and events after a cursor.
 * The cursor is what lets the lesson recognise work a player did before the
 * narration reached this step, without crediting unrelated orders.
 */
export interface SenseContext {
  /** Runtime id of the tutorial's own order. */
  orderId: number;
  /** Only events with an id >= this cursor belong to the current attempt. */
  since: number;
}

function resolveOrder(sense: Sense, ctx: SenseContext): number {
  return "orderId" in sense && (sense.orderId ?? 0) > 0
    ? (sense.orderId as number)
    : ctx.orderId;
}

function eventsAfter(g: Game, ctx: SenseContext): GameEvent[] {
  return g.events.filter((e) => e.id >= ctx.since);
}

function inWindow(recipe: RecipeId, elapsed: number) {
  const target = recipes[recipe].target;
  return elapsed >= target - 2 && elapsed <= target + 2;
}

function isBurnt(recipe: RecipeId, elapsed: number) {
  return elapsed > recipes[recipe].target * 1.8;
}

/** Business-state judgement for a single tutorial step. */
export function senseMet(g: Game, sense: Sense, ctx: SenseContext): boolean {
  const events = eventsAfter(g, ctx);
  const orderId = resolveOrder(sense, ctx);
  switch (sense.kind) {
    case "order-accepted": {
      const o = g.orders.find((o) => o.id === orderId);
      // A ticket already accepted before the lesson counts (a served ticket was
      // necessarily accepted), and work in the judged window counts too. A
      // *different* order's accept event never satisfies this step.
      return (
        o?.status === "accepted" ||
        o?.status === "served" ||
        events.some((e) => e.type === "accept" && e.orderId === orderId)
      );
    }
    case "portion-prepared": {
      const live = g.portions.some(
        (p) => p.orderId === orderId && p.recipe === sense.recipe,
      );
      // Downstream proof also counts: a dish for this order could not exist
      // without preparation. This is how a player who did the whole flow in one
      // go (without the lesson's linking hints) is still recognised.
      return (
        live ||
        events.some(
          (e) =>
            ((e.type === "prepare" && e.orderId === orderId) ||
              ((e.type === "cook" ||
                e.type === "lift" ||
                e.type === "plate" ||
                e.type === "serve") &&
                e.orderId === orderId)) &&
            e.recipe === sense.recipe,
        )
      );
    }
    case "cooked": {
      const live = g.stoves.some(
        (s) =>
          s.portion?.orderId === orderId && s.portion.recipe === sense.recipe,
      );
      return (
        live ||
        events.some(
          (e) =>
            ((e.type === "cook" && e.orderId === orderId) ||
              ((e.type === "lift" ||
                e.type === "plate" ||
                e.type === "serve") &&
                e.orderId === orderId)) &&
            e.recipe === sense.recipe,
        )
      );
    }
    case "lifted": {
      const lifts = events.filter(
        (e) =>
          e.type === "lift" &&
          e.orderId === orderId &&
          e.recipe === sense.recipe,
      );
      const matched = lifts.some((e) => {
        const elapsed = e.elapsed ?? 0;
        if (sense.window === "good") return inWindow(sense.recipe, elapsed);
        if (sense.window === "burnt") return isBurnt(sense.recipe, elapsed);
        if (sense.window === "early")
          return elapsed < recipes[sense.recipe].target - 2;
        if (sense.window === "late")
          return (
            elapsed > recipes[sense.recipe].target + 2 &&
            !isBurnt(sense.recipe, elapsed)
          );
        if (sense.window === "off") return !inWindow(sense.recipe, elapsed);
        if (sense.minQuality !== undefined)
          return (e.quality ?? 0) >= sense.minQuality;
        return true;
      });
      if (matched) return true;
      // A served dish is downstream proof, but only when its quality shows the
      // heat was actually handled well. A poor serve must not teach "done".
      return (
        sense.window === "good" &&
        events.some(
          (e) =>
            e.type === "serve" &&
            e.orderId === orderId &&
            e.recipe === sense.recipe &&
            (e.quality ?? 0) >= 60,
        )
      );
    }
    case "plated": {
      const live = g.dishes.some(
        (d) =>
          d.orderId === orderId &&
          d.recipe === sense.recipe &&
          d.stage === "plated",
      );
      return (
        live ||
        events.some(
          (e) =>
            (e.type === "plate" || e.type === "serve") &&
            e.orderId === orderId &&
            e.recipe === sense.recipe,
        )
      );
    }
    case "served": {
      const inRange = (q: number) =>
        (sense.minQuality === undefined || q >= sense.minQuality) &&
        (sense.maxQuality === undefined || q <= sense.maxQuality);
      const o = g.orders.find((o) => o.id === orderId);
      if (o?.status === "served" && inRange(o.servedQuality ?? 0)) return true;
      // An event is only proof for *this* order when it is inside the judged
      // window; otherwise a serving for another guest could be credited.
      return events.some(
        (e) =>
          e.type === "serve" &&
          e.orderId === orderId &&
          e.recipe === sense.recipe &&
          inRange(e.quality ?? 0),
      );
    }
    case "discarded":
      return events.some(
        (e) =>
          e.type === "discard" &&
          e.orderId === orderId &&
          e.recipe === sense.recipe &&
          (sense.burnt === undefined || !!e.burnt === sense.burnt),
      );
    case "stock-at-least":
      return g.stock[sense.ingredient] >= sense.count;
    case "stove-free":
      return g.stoves.some((s) => s.id === sense.stoveId && !s.portion);
    case "equipment-available":
      return g.stoves.some((s) => s.kind === sense.station && !s.portion);
  }
}

/** Player-facing instruction, derived from the same rule the engine checks. */
export function describeSense(sense: Sense): string {
  const recipe = "recipe" in sense ? recipes[sense.recipe] : null;
  switch (sense.kind) {
    case "order-accepted":
      return "在「今日订单」里接下标记为「教学」的那张单。";
    case "portion-prepared":
      return `先选中教学订单，再在备料台准备一份${recipe?.name ?? "目标菜"}；备料会自动挂到这张单上。`;
    case "cooked":
      return `把备好的${recipe?.name ?? "食材"}放进匹配的${recipe?.station === "pot" ? "汤锅" : "煎锅"}。`;
    case "lifted":
      return sense.window === "good"
        ? `${recipe?.name ?? "这道菜"}的最佳火候是 ${recipe?.target ?? "?"} 秒，前后 2 秒内起锅。`
        : `留意${recipe?.name ?? "菜"}的火候，在该起锅时起锅。`;
    case "plated":
      return `在「装盘与上菜」里把${recipe?.name ?? "这道菜"}装盘。`;
    case "served":
      return `选中装好盘的${recipe?.name ?? "菜"}和教学订单，菜单一致后上菜。`;
    case "discarded":
      return "把这份菜从出餐台丢弃（× 按钮），再重新备料。";
    case "stock-at-least":
      return `食材架上的${sense.ingredient === "beef" ? "牛肉" : sense.ingredient === "noodle" ? "面条" : "时蔬"}至少要有 ${sense.count} 份。`;
    case "stove-free":
      return `等 ${sense.stoveId} 号灶台空出来。`;
    case "equipment-available":
      return `等一口${sense.station === "pot" ? "汤锅" : "煎锅"}空闲。`;
  }
}
