import type { Game, Order, RecipeId } from "../../../shared/types";
import { createGame } from "../../../shared/initial";

/**
 * The practice kitchen is a real Game object, but it is a copy. Its takings are
 * never written to the player's shift ledger, and its cleanup can never touch
 * another round's income or best score.
 *
 * The scene is seeded so that:
 * - a neighbouring salad already occupies pan 1, so equipment contention is
 *   real and the lesson has to explain switching devices,
 * - two steak orders exist, so a steak prepared for the "other" guest can be
 *   shown to not satisfy the lesson target.
 */
export function createPracticeKitchen(real: Game): Game {
  const g = createGame(0);
  g.tutorial = true;
  g.duration = 99_999;
  g.running = true;
  g.ended = false;
  g.time = real.time;
  g.nextId = real.nextId;
  g.nextEventId = real.nextEventId;
  g.selectedOrder = real.selectedOrder;
  g.selectedDish = real.selectedDish;
  g.stock = { ...real.stock };
  g.orders = real.orders.map((o) => ({ ...o }));
  g.portions = real.portions.map((p) => ({ ...p }));
  g.stoves = real.stoves.map((s) => ({
    ...s,
    portion: s.portion ? { ...s.portion } : null,
  }));
  g.dishes = real.dishes.map((d) => ({ ...d }));
  // Real income stays in the real shift. Only the event log is mirrored,
  // because that is what the lesson uses to recognise work already done.
  g.events = real.events.map((e) => ({ ...e }));
  g.entries = [];
  g.combo = 0;
  g.served = 0;
  g.missed = 0;
  g.notice = "教学练习厨房：不会来新客，也不会计入本局收入。";

  // Keep every open order comfortably alive during the lesson.
  for (const o of g.orders) {
    if (o.status === "waiting" || o.status === "accepted")
      o.deadline = g.time + 600;
  }

  const nextOrderId = () =>
    Math.max(0, ...g.orders.map((o) => o.id), g.nextId - 1) + 1;

  // A neighbouring order already cooking on the first pan. If the player's own
  // kitchen already occupies a pan, keep that instead — contention is real
  // either way.
  const panOne = g.stoves.find((s) => s.id === 1 && s.kind === "pan");
  if (panOne && !panOne.portion) {
    // Prefer an existing neighbouring ticket (real work copied from the
    // player's kitchen); only invent scenery when there is none.
    let neighbour = g.orders.find(
      (o) => o.id !== g.selectedOrder && o.recipe === "salad",
    );
    let backdrop = false;
    if (!neighbour) {
      neighbour = {
        id: nextOrderId(),
        recipe: "salad",
        guest: "旁桌客人",
        arrived: g.time,
        deadline: g.time + 600,
        status: "accepted",
      };
      g.orders.push(neighbour);
      g.nextId = Math.max(g.nextId, neighbour.id + 1);
      backdrop = true;
    }
    panOne.portion = {
      id: g.nextId++,
      recipe: "salad",
      preparedAt: g.time,
      orderId: neighbour.id,
      backdrop: backdrop || undefined,
    };
    panOne.started = g.time;
  }

  // A second steak ticket makes "prepare for the target order" a real choice.
  const steaks = g.orders.filter((o) => o.recipe === "steak");
  if (steaks.length < 2) {
    const extra: Order = {
      id: nextOrderId(),
      recipe: "steak",
      guest: "外带客人",
      arrived: g.time,
      deadline: g.time + 600,
      status: "waiting",
    };
    g.orders.push(extra);
    g.nextId = Math.max(g.nextId, extra.id + 1);
  }
  g.nextEventId = Math.max(g.nextEventId, ...g.events.map((e) => e.id + 1), 1);
  g.nextId = Math.max(
    g.nextId,
    ...g.portions.map((p) => p.id + 1),
    ...g.dishes.map((d) => d.id + 1),
  );
  return g;
}

export function resetPractice(g: Game, real: Game) {
  Object.assign(g, createPracticeKitchen(real));
}

/**
 * Keep the neighbouring order's pan busy for the whole lesson without it ever
 * looking "about to burn". A normal order on a shared stove is exactly the
 * contention the lesson wants to explain, so it should look like an ongoing
 * ticket rather than a neglected one. Only scenery is touched.
 */
export function keepNeighbourCooking(g: Game, lessonOrderId: number | null) {
  for (const s of g.stoves) {
    if (!s.portion || s.portion.orderId === lessonOrderId) continue;
    if (s.portion.tutorial || !s.portion.backdrop) continue;
    const dirty = g.time - s.started;
    if (dirty > 4)
      // A fresh tray goes on: the neighbour is still working through service.
      s.started = g.time;
  }
}

function progressScore(g: Game, o: Order): number {
  if (o.status === "served") return 7;
  if (g.dishes.some((d) => d.orderId === o.id && d.stage === "plated")) return 6;
  if (g.dishes.some((d) => d.orderId === o.id)) return 5;
  if (g.stoves.some((s) => s.portion?.orderId === o.id)) return 4;
  if (g.portions.some((p) => p.orderId === o.id)) return 3;
  if (o.status === "accepted") return 2;
  return 1;
}

/**
 * Pick the order the player has actually worked on. This is what lets a lesson
 * opened late recognise work already done, without mistaking another guest's
 * dish for the target.
 *
 * Open tickets are preferred. A ticket the player already served correctly is
 * adopted only when nothing else is live, so its finished work is recognised
 * instead of being lost; because that order becomes the target, its events are
 * legitimately credited to the lesson.
 */
export function pickLessonOrder(g: Game, recipe: RecipeId): Order | undefined {
  return [...g.orders]
    .filter((o) => o.recipe === recipe)
    .sort((a, b) => {
      const diff = progressScore(g, b) - progressScore(g, a);
      if (diff !== 0) return diff;
      // Then prefer a live ticket over a finished one, and the oldest first.
      const liveA = a.status === "served" || a.status === "left" ? 1 : 0;
      const liveB = b.status === "served" || b.status === "left" ? 1 : 0;
      return liveA - liveB || a.id - b.id;
    })[0];
}
