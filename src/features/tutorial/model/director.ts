import type {
  Game,
  Order,
  Portion,
  RecipeId,
  Stove,
} from "../../../shared/types";
import { recipes } from "../../../shared/catalog";
import type {
  FailBranch,
  Sense,
  StepId,
  TutorialDefinition,
  TutorialStep,
} from "./dsl";
import { senseMet, type SenseContext } from "../lib/senses";

/** How the lesson is currently behaving. */
export type Phase =
  | "closed"
  | "invalid"
  | "running"
  | "practice"
  | "complete";

export interface TutorialRuntime {
  phase: Phase;
  /** Index into definition.steps. */
  step: number;
  /**
   * Event cursor for the current attempt. 0 means "the whole shift", which is
   * what lets a player's earlier work count when the lesson opens.
   */
  since: number;
  /** Which steps already finished during this visit. */
  done: Record<StepId, boolean>;
  /**
   * Event id at the moment the lesson opened. Failure branches judge from here
   * (never from work done before the lesson), so a stale miss cannot fire a
   * "you burnt it" branch the player never caused in this lesson.
   */
  openedAt: number;
  /** Retry counters keyed by step id, so a fail loop can always exit. */
  retries: Record<StepId, number>;
  /** The failure currently being explained, if any. */
  failure: {
    stepId: StepId;
    /** Index into the step's `fails`, since branches can share a retry target. */
    branchIndex: number;
    retryFrom: StepId;
    message: string;
    spends: number;
    /** Practice-kitchen time after which waiting for a fix gives up. */
    expiresAt: number;
  } | null;
  /** The last message shown to the player. */
  message: string;
  /** Set when a fail loop exhausted its retries and the lesson stopped early. */
  earlyExit: boolean;
  /** The player asked the narration to hold; kitchen clocks freeze with it. */
  held: boolean;
  /** Stove the demonstration would like to use, plus why it changed. */
  reservation: { stoveId: number | null; note: string } | null;
  /** Concrete stove ids highlighted as reserved. Never a hard restriction. */
  lockedStoves: number[];
  /** The tutorial's own order. */
  orderId: number | null;
  /** The target order already existed when the lesson opened. */
  adoptedOrder: boolean;
  /** Authoring errors; set when a lesson cannot be applied as-is. */
  errors: string[];
}

export function createRuntime(): TutorialRuntime {
  return {
    phase: "closed",
    step: 0,
    since: 0,
    done: {},
    openedAt: 0,
    retries: {},
    failure: null,
    message: "",
    earlyExit: false,
    held: false,
    reservation: null,
    lockedStoves: [],
    orderId: null,
    adoptedOrder: false,
    errors: [],
  };
}

export function contextFor(rt: TutorialRuntime): SenseContext {
  return { orderId: rt.orderId ?? 0, since: rt.since };
}

/* ------------------------------------------------------------------ */
/* Authoring validation: runs before a lesson is applied to a kitchen. */
/* ------------------------------------------------------------------ */

const SENSE_KINDS = new Set([
  "order-accepted",
  "portion-prepared",
  "cooked",
  "lifted",
  "plated",
  "served",
  "discarded",
  "stock-at-least",
  "stove-free",
  "equipment-available",
]);

function validateSense(sense: unknown, where: string, errors: string[]) {
  if (!sense || typeof sense !== "object") {
    errors.push(`${where}缺少判定规则`);
    return;
  }
  const s = sense as Sense;
  const kind = (s as { kind?: string }).kind ?? "";
  if (!SENSE_KINDS.has(kind)) errors.push(`${where}的判定类型「${kind}」不存在`);
  if ("recipe" in s && !recipes[s.recipe])
    errors.push(`${where}引用了不存在的菜品「${s.recipe}」`);
  if ("orderId" in s && s.orderId !== undefined && typeof s.orderId !== "number")
    errors.push(`${where}的 orderId 必须是数字`);
  if (s.kind === "stock-at-least" && !(s.count >= 1))
    errors.push(`${where}的库存数量必须大于 0`);
}

/**
 * Validate the authoring shape before anything is applied to a live kitchen.
 * Missing dependencies and loops without exits are reported together, so the
 * director can fix the lesson in one pass.
 */
export function validateLesson(def: TutorialDefinition): string[] {
  const errors: string[] = [];
  if (!def || typeof def !== "object") return ["教学配置不是对象"];
  if (!def.id) errors.push("教学缺少 id");
  if (!def.title) errors.push("教学缺少标题");
  if (!def.targetRecipe || !recipes[def.targetRecipe])
    errors.push(`教学目标菜品「${String(def.targetRecipe)}」不存在`);
  if (!def.steps || !Array.isArray(def.steps) || !def.steps.length)
    return [...errors, "教学没有任何步骤"];
  const ids = new Set<string>();
  for (const s of def.steps) {
    if (!s.id) errors.push("有步骤缺少 id");
    else if (ids.has(s.id)) errors.push(`步骤 id「${s.id}」重复`);
    ids.add(s.id);
    if (!s.title) errors.push(`步骤「${s.id}」缺少标题`);
    if (!s.body) errors.push(`步骤「${s.id}」缺少讲解文案`);
    validateSense(s.done, `步骤「${s.id}」的目标`, errors);
    if (s.reserve && s.reserve !== "pan" && s.reserve !== "pot")
      errors.push(`步骤「${s.id}」预留了未知设备「${s.reserve}」`);
  }
  const idx = new Map(def.steps.map((s, i) => [s.id, i]));
  def.steps.forEach((s, i) => {
    if ((s.after ?? []).includes(s.id))
      errors.push(`步骤「${s.id}」不能依赖自己`);
    for (const dep of s.after ?? []) {
      if (!ids.has(dep)) {
        errors.push(`步骤「${s.id}」依赖了不存在的「${dep}」`);
      } else if ((idx.get(dep) ?? 0) > i) {
        errors.push(`步骤「${s.id}」依赖了排在其后的「${dep}」，无法执行`);
      }
    }
    (s.fails ?? []).forEach((f: FailBranch, branchIndex) => {
      const where = `步骤「${s.id}」第 ${branchIndex + 1} 条失败分支`;
      validateSense(f.when, `${where}的判定`, errors);
      if (f.recover) validateSense(f.recover, `${where}的恢复判定`, errors);
      if (!ids.has(f.retryFrom)) {
        errors.push(`${where}指向不存在的「${f.retryFrom}」`);
      } else if ((idx.get(f.retryFrom) ?? 0) > i) {
        errors.push(`${where}不能回到更晚的「${f.retryFrom}」`);
      }
      if (!Number.isFinite(f.maxRetries) || f.maxRetries < 1)
        errors.push(`${where}缺少退出条件（maxRetries >= 1）`);
      if (f.onExhausted !== "exit") {
        if (!ids.has(f.onExhausted)) {
          errors.push(`${where}的出口指向不存在的步骤`);
        } else if ((idx.get(f.onExhausted) ?? 0) <= i) {
          errors.push(`${where}的出口必须继续向后，否则会死循环`);
        }
      }
    });
  });
  if (def.startAt && !ids.has(def.startAt))
    errors.push(`起始步骤「${def.startAt}」不存在`);
  return errors;
}

/* ------------------------------------------------------------------ */
/* Progress judgement.                                                */
/* ------------------------------------------------------------------ */

export function indexOf(def: TutorialDefinition, id: StepId): number {
  return def.steps.findIndex((s) => s.id === id);
}

/** All steps whose prerequisites are met and which are not done yet. */
export function activeSteps(
  def: TutorialDefinition,
  rt: TutorialRuntime,
): TutorialStep[] {
  return def.steps.filter(
    (s) => !rt.done[s.id] && (s.after ?? []).every((d) => rt.done[d]),
  );
}

export function currentStep(
  def: TutorialDefinition,
  rt: TutorialRuntime,
): TutorialStep | null {
  return def.steps[rt.step] ?? null;
}

function allDone(def: TutorialDefinition, rt: TutorialRuntime) {
  return def.steps.every((s) => rt.done[s.id]);
}

/** Mark every ready, satisfiable step. Evaluated against business facts only. */
export function reconcile(
  def: TutorialDefinition,
  g: Game,
  rt: TutorialRuntime,
) {
  if (rt.orderId === null) return;
  const ctx = contextFor(rt);
  let changed = true;
  while (changed) {
    changed = false;
    for (const step of activeSteps(def, rt)) {
      if (senseMet(g, step.done, ctx)) {
        rt.done[step.id] = true;
        changed = true;
        if (rt.failure?.stepId === step.id) rt.failure = null;
      }
    }
  }
}

/** Focus the first ready, unfinished step. */
function focus(def: TutorialDefinition, rt: TutorialRuntime) {
  const ready = def.steps.findIndex(
    (s) => !rt.done[s.id] && (s.after ?? []).every((d) => rt.done[d]),
  );
  if (ready >= 0) rt.step = ready;
}

/**
 * One director tick. Evaluates every ready step against the kitchen's business
 * facts, handles failure branches, and advances the focus. Returns true when the
 * lesson is finished (or stopped early).
 */
export function tick(
  def: TutorialDefinition,
  g: Game,
  rt: TutorialRuntime,
): boolean {
  if (rt.phase !== "running" || rt.orderId === null) return false;
  const ctx = contextFor(rt);
  // Failures are about what the player just did. Judging them from the lesson's
  // opening (or the last retry) stops an old, pre-lesson miss from firing.
  const failCtx: SenseContext = {
    orderId: ctx.orderId,
    since: Math.max(rt.since, rt.openedAt),
  };

  // A failure branch waits for its recovery demonstration, then rewinds.
  if (rt.failure) {
    const failed = def.steps.find((s) => s.id === rt.failure?.stepId);
    const branch = failed?.fails?.[rt.failure?.branchIndex ?? -1];
    if (!failed || !branch) {
      rt.failure = null;
    } else if (
      !branch.recover ||
      senseMet(g, branch.recover, failCtx) ||
      g.time >= rt.failure.expiresAt
    ) {
      // A stuck recovery (e.g. the burnt dish was already thrown away) still
      // rewinds, so a failure can never trap the lesson.
      beginRetry(def, g, rt, failed, branch);
    }
    return false;
  }

  // Good results always win: mark everything satisfiable first, so a later
  // success is not mislabelled by an earlier miss.
  reconcile(def, g, rt);

  // Then look for active failures, in the order the director authored them.
  for (const step of def.steps) {
    if (!step.fails?.length || rt.done[step.id]) continue;
    if (!(step.after ?? []).every((d) => rt.done[d])) continue;
    for (let i = 0; i < step.fails.length; i++) {
      const branch = step.fails[i];
      if (!senseMet(g, branch.when, failCtx)) continue;
      if (branch.recover && senseMet(g, branch.recover, failCtx)) continue;
      enterFailure(def, g, rt, step, branch, i);
      return false;
    }
  }

  focus(def, rt);

  if (allDone(def, rt)) {
    rt.phase = "complete";
    rt.message = def.outro;
    releaseReservation(rt);
    return true;
  }
  // Keep the narration in step with the business state, so the notice strip and
  // the lesson card never disagree about what is being taught.
  const cur = currentStep(def, rt);
  if (cur) {
    const parallel = activeSteps(def, rt).length > 1;
    rt.message = `${cur.title}：${cur.body}${parallel ? "（与其他步骤并行）" : ""}`;
  }
  return false;
}

function enterFailure(
  def: TutorialDefinition,
  g: Game,
  rt: TutorialRuntime,
  step: TutorialStep,
  branch: FailBranch,
  branchIndex: number,
) {
  const spent = (rt.retries[step.id] ?? 0) + 1;
  rt.retries[step.id] = spent;
  if (spent > branch.maxRetries) {
    rt.failure = null;
    if (branch.onExhausted === "exit") {
      rt.earlyExit = true;
      rt.phase = "complete";
      rt.message = `「${step.title}」已经重试 ${branch.maxRetries} 次，先结束本次教学。设备已全部释放，可以自由练习或继续营业。`;
      // Do not re-judge the same failed attempt if the flow is resumed.
      rt.since = g.nextEventId;
      releaseReservation(rt);
      return;
    }
    // The exit always moves forward; this is the loop's guaranteed way out.
    const to = indexOf(def, branch.onExhausted);
    if (to >= 0) {
      for (let i = 0; i < to; i++) rt.done[def.steps[i].id] = true;
      rt.step = to;
      rt.message = `「${step.title}」已达到重试上限，继续「${def.steps[to].title}」。`;
    }
    return;
  }
  rt.failure = {
    stepId: step.id,
    branchIndex,
    retryFrom: branch.retryFrom,
    message: branch.message,
    spends: spent,
    expiresAt: g.time + 45,
  };
  rt.message = branch.message;
}

function beginRetry(
  def: TutorialDefinition,
  g: Game,
  rt: TutorialRuntime,
  step: TutorialStep,
  branch: FailBranch,
) {
  const from = Math.max(0, indexOf(def, branch.retryFrom));
  const to = indexOf(def, step.id);
  for (let i = from; i <= to; i++) rt.done[def.steps[i].id] = false;
  rt.step = from;
  rt.failure = null;
  // Ignore the failed attempt's facts; only the retry's work counts.
  rt.since = g.nextEventId;
  rt.message = `重新演示「${def.steps[from].title}」。按讲解把这一步再做一遍。`;
  // Give the replay a healthy clock: replaying must not punish the practice
  // kitchen's patience while the player re-reads the narration.
  const order = g.orders.find((o) => o.id === rt.orderId);
  if (order) order.deadline = g.time + 600;
  setupRehearsalScene(def, g, rt, from);
}

/* ------------------------------------------------------------------ */
/* Reserved demonstration equipment.                                  */
/* ------------------------------------------------------------------ */

function occupiedLabel(p: Portion): string {
  return p.orderId ? "另一张订单" : "自由练习的菜";
}

export function releaseReservation(rt: TutorialRuntime) {
  rt.reservation = null;
  rt.lockedStoves = [];
}

/**
 * Choose and maintain a demonstration device. Normal orders always win: if the
 * reserved stove is occupied by another order, the lesson switches to a free
 * one or waits and explains why — it never blocks service.
 */
export function syncReservation(
  def: TutorialDefinition,
  g: Game,
  rt: TutorialRuntime,
) {
  // Reservations exist only during the guided lesson. Once the player is in
  // practice or the lesson is complete, nothing stays locked — no invisible
  // restriction survives the lesson.
  if (rt.phase !== "running") {
    releaseReservation(rt);
    return;
  }
  const wanted = activeSteps(def, rt).find((s) => s.reserve);
  if (!wanted?.reserve) {
    releaseReservation(rt);
    return;
  }
  const kind = wanted.reserve;
  const label = kind === "pan" ? "煎锅" : "汤锅";
  const same = g.stoves.filter((s) => s.kind === kind);
  const current = rt.reservation?.stoveId
    ? g.stoves.find((s) => s.id === rt.reservation?.stoveId)
    : undefined;
  const currentUsable =
    !!current &&
    current.kind === kind &&
    (!current.portion || current.portion.orderId === rt.orderId);

  if (currentUsable) {
    rt.lockedStoves = [current!.id];
    if (rt.reservation?.note && current?.portion)
      rt.reservation = { stoveId: current.id, note: rt.reservation.note };
    return;
  }

  const free = same.find(
    (s) => !s.portion || s.portion.orderId === rt.orderId,
  );
  if (free) {
    const previous = current?.id ?? rt.reservation?.stoveId ?? null;
    // Explain any *other* stove of this kind that normal service is using.
    const blocked = same.find(
      (s) => s.id !== free.id && s.portion && s.portion.orderId !== rt.orderId,
    )?.portion;
    rt.reservation = {
      stoveId: free.id,
      note: blocked
        ? `${same
            .filter((s) => s.portion && s.portion.orderId !== rt.orderId)
            .map((s) => `${s.id} 号${label}`)
            .join("、")}被${occupiedLabel(blocked)}占用，教学改用 ${free.id} 号演示，正常出餐不受影响。`
        : previous && previous !== free.id
          ? `教学演示位从 ${previous} 号换到 ${free.id} 号。`
          : "",
    };
    rt.lockedStoves = [free.id];
    return;
  }

  // No free equipment: wait, never take a busy stove from a normal order.
  const blocked = g.stoves.find(
    (s) => s.portion && s.portion.orderId !== rt.orderId,
  )?.portion;
  rt.reservation = {
    stoveId: null,
    note: `${label}都被${blocked ? occupiedLabel(blocked) : "其他菜"}占用，教学先等待空出锅位；不会拦截正常出餐。`,
  };
  rt.lockedStoves = [];
}

/** Is this work owned by the lesson's current scene? */
export function isLessonOwned(
  rt: TutorialRuntime,
  orderId?: number | null,
  tutorial?: boolean,
): boolean {
  return !!tutorial || (orderId != null && orderId === rt.orderId);
}

export function targetOrder(g: Game, rt: TutorialRuntime): Order | undefined {
  return g.orders.find((o) => o.id === rt.orderId);
}

/* ------------------------------------------------------------------ */
/* Opening, replaying and scene preparation.                          */
/* ------------------------------------------------------------------ */

export function createLessonOrder(g: Game, recipe: RecipeId): Order {
  const order: Order = {
    id: Math.max(0, ...g.orders.map((o) => o.id), 0) + 1,
    recipe,
    guest: "教学客人",
    arrived: g.time,
    deadline: g.time + 600,
    status: "waiting",
    tutorial: true,
  };
  g.orders.unshift(order);
  g.nextId = Math.max(g.nextId, order.id + 1);
  return order;
}

/**
 * Reset the runtime and claim the scene's target order.
 *
 * If the player already began a matching ticket in the practice kitchen, that
 * ticket is adopted — their earlier work is what the lesson then builds on.
 */
export function beginLesson(
  def: TutorialDefinition,
  practice: Game,
  rt: TutorialRuntime,
  pickExisting: (g: Game, recipe: RecipeId) => Order | undefined,
): void {
  Object.assign(rt, createRuntime());
  rt.step = Math.max(0, def.startAt ? indexOf(def, def.startAt) : 0);
  // Prior work (before this opening) is recognised by the goal rules, but old
  // misses must not replay as fresh failures.
  rt.openedAt = practice.nextEventId;
  // Start from a deliberately busy pan so the demonstration has to explain why
  // it moved. syncReservation adopts a free pan directly if there is one.
  rt.reservation = { stoveId: 1, note: "" };

  const existing = pickExisting(practice, def.targetRecipe);
  if (existing) {
    existing.tutorial = true;
    rt.orderId = existing.id;
    // Adoption is only worth announcing when the player actually started work.
    rt.adoptedOrder = orderHasWork(practice, existing);
    // Do not accept on the player's behalf: 接单 stays a real, teachable
    // action unless it was already accepted before the lesson opened.
    if (existing.status === "accepted") practice.selectedOrder = existing.id;
  } else {
    rt.orderId = createLessonOrder(practice, def.targetRecipe).id;
    rt.adoptedOrder = false;
  }
  for (const o of practice.orders) {
    if (o.status === "waiting" || o.status === "accepted")
      o.deadline = practice.time + 600;
  }
  rt.phase = "running";
  rt.message = rt.adoptedOrder
    ? "厨房里已经有你做过的工作，教学直接认领了这张牛排单，从你停下的地方继续。"
    : "先接下闪烁的教学订单，再按灶台的真实状态一步步来。";
  practice.notice = rt.message;
  practice.running = true;
  // Judge the whole shift: work done before opening the lesson counts.
  tick(def, practice, rt);
  syncReservation(def, practice, rt);
}

/** Did the player already do kitchen work for this ticket? */
function orderHasWork(g: Game, o: Order): boolean {
  return (
    o.status === "served" ||
    g.stoves.some((s) => s.portion?.orderId === o.id) ||
    g.dishes.some((d) => d.orderId === o.id) ||
    g.portions.some((p) => p.orderId === o.id) ||
    o.status === "accepted"
  );
}

function pickLessonStove(
  g: Game,
  rt: TutorialRuntime,
  station: "pan" | "pot",
): Stove | undefined {
  const reserved = rt.reservation?.stoveId
    ? g.stoves.find((s) => s.id === rt.reservation?.stoveId)
    : undefined;
  if (reserved && reserved.kind === station && !reserved.portion)
    return reserved;
  return g.stoves.find(
    (s) => s.kind === station && (!s.portion || s.portion.orderId === rt.orderId),
  );
}

function acceptTarget(g: Game, rt: TutorialRuntime) {
  const order = g.orders.find((o) => o.id === rt.orderId);
  if (!order) return;
  if (order.status === "waiting" || order.status === "left") {
    order.status = "accepted";
    order.deadline = g.time + 600;
  }
  g.selectedOrder = order.id;
}

function ensurePortionInPrep(g: Game, rt: TutorialRuntime): Portion | null {
  const order = g.orders.find((o) => o.id === rt.orderId);
  if (!order) return null;
  const existing = g.portions.find(
    (p) => p.orderId === order.id && p.recipe === order.recipe,
  );
  if (existing) return existing;
  const portion: Portion = {
    id: g.nextId++,
    recipe: order.recipe,
    preparedAt: g.time,
    orderId: order.id,
    tutorial: true,
  };
  g.portions.push(portion);
  return portion;
}

function ensureDish(
  g: Game,
  rt: TutorialRuntime,
  stage: "counter" | "plated",
): void {
  const order = g.orders.find((o) => o.id === rt.orderId);
  if (!order) return;
  let dish = g.dishes.find(
    (d) => d.orderId === order.id && d.recipe === order.recipe,
  );
  if (!dish) {
    dish = {
      id: g.nextId++,
      recipe: order.recipe,
      quality: 92,
      cookedAt: g.time,
      stage,
      orderId: order.id,
      tutorial: true,
    };
    g.dishes.push(dish);
  }
  dish.stage = stage;
  g.selectedOrder = order.id;
  if (stage === "plated") g.selectedDish = dish.id;
}

/** Remove only lesson-owned portions and dishes attached to the target order. */
function clearLessonScene(g: Game, rt: TutorialRuntime) {
  g.portions = g.portions.filter(
    (p) => !isLessonOwned(rt, p.orderId, p.tutorial),
  );
  g.dishes = g.dishes.filter((d) => !isLessonOwned(rt, d.orderId, d.tutorial));
  for (const s of g.stoves) {
    if (s.portion && isLessonOwned(rt, s.portion.orderId, s.portion.tutorial))
      s.portion = null;
  }
  g.entries = g.entries.filter(
    (e) => !isLessonOwned(rt, e.orderId ?? null, e.tutorial),
  );
  g.selectedDish = null;
}

/**
 * Build the scene the player would be in right before `fromIndex`, so a replayed
 * step can actually be demonstrated. Only lesson-owned objects are created; the
 * player's other orders, dishes and takings are untouched.
 */
export function setupRehearsalScene(
  def: TutorialDefinition,
  g: Game,
  rt: TutorialRuntime,
  fromIndex: number,
) {
  const step = def.steps[fromIndex];
  const order = g.orders.find((o) => o.id === rt.orderId);
  if (!step || !order) return;
  const recipe = recipes[order.recipe];
  const kind = step.done.kind;

  if (kind === "stock-at-least" || kind === "equipment-available") return;
  if (kind === "stove-free") return;

  acceptTarget(g, rt);
  if (kind === "order-accepted" || kind === "portion-prepared") return;

  if (kind === "cooked") {
    ensurePortionInPrep(g, rt);
    return;
  }

  if (kind === "lifted" || kind === "discarded") {
    const portion = ensurePortionInPrep(g, rt);
    const stove = pickLessonStove(g, rt, recipe.station);
    if (!portion) return;
    if (!stove) {
      // No free equipment: leave the portion on the prep bench and let the
      // reservation explanation tell the player to wait.
      rt.message = "演示场景已备好，但灶台都被占用了。等空出锅位后即可继续。";
      return;
    }
    g.portions = g.portions.filter((p) => p.id !== portion.id);
    stove.portion = portion;
    const late = kind === "discarded";
    // A burn demo is past the ideal window; a lift demo sits just before it.
    stove.started = g.time - (late ? recipe.target * 1.9 : recipe.target - 2);
    return;
  }

  if (kind === "plated") {
    ensureDish(g, rt, "counter");
    return;
  }
  if (kind === "served") {
    ensureDish(g, rt, "plated");
  }
}

/**
 * Replay a lesson step. Only the scene the tutorial owns is reset: the target
 * order's progress and lesson-created portions/dishes/takings. Other orders,
 * their dishes and the player's income and best score are never touched.
 */
export function replayFrom(
  def: TutorialDefinition,
  g: Game,
  rt: TutorialRuntime,
  stepId: StepId,
): boolean {
  const from = indexOf(def, stepId);
  if (from < 0) {
    rt.message = `找不到要重演的步骤「${stepId}」`;
    return false;
  }
  if (rt.orderId === null) return false;
  clearLessonScene(g, rt);

  const order = g.orders.find((o) => o.id === rt.orderId);
  if (order) {
    order.servedAt = undefined;
    order.servedQuality = undefined;
    order.deadline = g.time + 600;
    // Replaying from the acceptance step must actually re-open the ticket,
    // otherwise the step would be considered done the moment it is shown.
    if (def.steps[from]?.done.kind === "order-accepted") {
      order.status = "waiting";
      g.selectedOrder = null;
    } else {
      if (order.status === "served" || order.status === "left")
        order.status = "accepted";
      g.selectedOrder = order.id;
    }
  }

  for (let i = from; i < def.steps.length; i++) {
    rt.done[def.steps[i].id] = false;
    rt.retries[def.steps[i].id] = 0;
  }
  rt.step = from;
  rt.failure = null;
  rt.earlyExit = false;
  if (rt.phase === "complete") rt.phase = "running";
  // Fresh cursor: the replay judges only what happens from now on, while the
  // player's earlier achievements stay recognised.
  rt.since = g.nextEventId;
  setupRehearsalScene(def, g, rt, from);
  reconcile(def, g, rt);
  focus(def, rt);
  rt.message = `从「${def.steps[from].title}」重新演示；此前的成果仍然保留。`;
  return true;
}

export type { Sense, SenseContext, TutorialStep };
