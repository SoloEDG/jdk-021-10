import { computed, reactive } from "vue";
import type { Game } from "../../shared/types";
import type { StepId, TutorialDefinition } from "./model/dsl";
import {
  activeSteps,
  beginLesson,
  createRuntime,
  currentStep,
  replayFrom,
  syncReservation,
  targetOrder,
  tick,
  validateLesson,
  type TutorialRuntime,
} from "./model/director";
import {
  createPracticeKitchen,
  keepNeighbourCooking,
  pickLessonOrder,
  resetPractice,
} from "./model/practice";
import { houseLesson } from "./model/lesson";

export interface TutorialOpenResult {
  ok: boolean;
  errors: string[];
}

/**
 * Runs a lesson inside its own practice kitchen.
 *
 * The player's real shift (`real`) is read once, when the practice kitchen is
 * created. No tutorial action ever writes to it, which is what guarantees a
 * replay or a lesson cleanup cannot clear another round's income or best score.
 */
export function useTutorial(real: Game, setFrozen: (v: boolean) => void) {
  const definition = reactive(houseLesson) as TutorialDefinition;
  const practice = reactive(createPracticeKitchen(real)) as Game;
  const runtime = reactive(createRuntime()) as TutorialRuntime;
  let last = performance.now();

  const open = computed(
    () => !["closed", "invalid"].includes(runtime.phase),
  );
  const view = computed<Game>(() => (open.value ? practice : real));
  const step = computed(() => currentStep(definition, runtime));
  const active = computed(() => activeSteps(definition, runtime));
  const order = computed(() => targetOrder(practice, runtime) ?? null);
  const parallel = computed(() => active.value.length > 1);

  // The practice kitchen only moves while a lesson is running and not held.
  const timer = setInterval(() => {
    const now = performance.now();
    const dt = Math.min(0.5, (now - last) / 1000);
    last = now;
    if (!open.value) return;
    if (runtime.phase !== "running" && runtime.phase !== "practice") return;
    if (runtime.held) return;
    practice.time = Math.round((practice.time + dt) * 10) / 10;
    if (runtime.phase === "running") tick(definition, practice, runtime);
    syncReservation(definition, practice, runtime);
    keepNeighbourCooking(practice, runtime.orderId);
  }, 100);

  if (typeof window !== "undefined")
    window.addEventListener("beforeunload", () => clearInterval(timer));

  /** Called after every kitchen command so the verdict is instant. */
  function refresh() {
    if (runtime.phase === "running" && !runtime.held)
      tick(definition, practice, runtime);
    if (open.value) syncReservation(definition, practice, runtime);
  }

  function openLesson(): TutorialOpenResult {
    const errors = validateLesson(definition);
    if (errors.length) {
      runtime.errors = errors;
      runtime.phase = "invalid";
      runtime.message = "教学配置有误，尚未应用到厨房。请先修正下列依赖。";
      setFrozen(false);
      return { ok: false, errors };
    }
    resetPractice(practice, real);
    beginLesson(definition, practice, runtime, pickLessonOrder);
    runtime.errors = [];
    setFrozen(true);
    last = performance.now();
    return { ok: true, errors: [] };
  }

  function close() {
    practice.running = false;
    if (runtime.phase !== "invalid") runtime.phase = "closed";
    runtime.reservation = null;
    runtime.lockedStoves = [];
    runtime.failure = null;
    runtime.held = false;
    setFrozen(false);
    last = performance.now();
  }

  /** Pause the narration; kitchen clocks freeze with it. */
  function setHeld(held: boolean) {
    if (!open.value) return;
    runtime.held = held;
    runtime.message = held
      ? "讲解已暂停，厨房计时冻结。读完再点继续。"
      : "讲解继续，灶台计时恢复。";
    practice.notice = runtime.message;
    last = performance.now();
  }

  function toggleHeld() {
    setHeld(!runtime.held);
  }

  function startPractice() {
    if (!open.value) return;
    runtime.phase = "practice";
    runtime.held = false;
    runtime.failure = null;
    runtime.reservation = null;
    runtime.lockedStoves = [];
    practice.running = true;
    practice.notice =
      "自由练习：随便备料、试火候。不会来新客，也不计入本局收入。";
    runtime.message = practice.notice;
    last = performance.now();
  }

  function resumeLesson() {
    if (runtime.phase !== "practice" && runtime.phase !== "complete") return;
    if (runtime.phase === "complete" && !runtime.earlyExit) {
      // A completed lesson has no unfinished steps to resume; the player can
      // replay a step or keep practising instead.
      runtime.message = "这一单已经完整走完了，可以从上方任一步骤重新演示。";
      return;
    }
    runtime.phase = "running";
    runtime.held = false;
    runtime.earlyExit = false;
    practice.running = true;
    runtime.message = "回到教学。此前完成的步骤仍然算数。";
    practice.notice = runtime.message;
    last = performance.now();
    tick(definition, practice, runtime);
    syncReservation(definition, practice, runtime);
  }

  function replay(stepId: StepId) {
    if (runtime.phase === "practice" || runtime.phase === "complete")
      runtime.phase = "running";
    runtime.held = false;
    practice.running = true;
    replayFrom(definition, practice, runtime, stepId);
    syncReservation(definition, practice, runtime);
    setFrozen(true);
    last = performance.now();
    practice.notice = runtime.message;
  }

  function replayCurrent() {
    if (step.value) replay(step.value.id);
  }

  /** The lesson authored as JSON, for the director to edit. */
  function exportLesson(): string {
    return JSON.stringify(definition, null, 2);
  }

  /**
   * Validate a director's edited lesson *before* applying it. Nothing changes
   * when there are errors — the missing dependencies are reported instead.
   */
  function applyLesson(json: string): string[] {
    let parsed: TutorialDefinition;
    try {
      parsed = JSON.parse(json) as TutorialDefinition;
    } catch (e) {
      return [`JSON 解析失败：${(e as Error).message}`];
    }
    const errors = validateLesson(parsed);
    if (errors.length) return errors;
    // Close the running lesson first so a half-played scene never mixes with a
    // freshly applied definition.
    if (open.value) close();
    Object.assign(definition, parsed);
    Object.assign(runtime, createRuntime());
    runtime.message = `教学「${definition.title}」已校验并应用，可以开始。`;
    return [];
  }

  function lessonOrderId(): number | null {
    return runtime.orderId;
  }

  return {
    definition,
    practice,
    runtime,
    open,
    view,
    step,
    active,
    order,
    parallel,
    lessonOrderId,
    exportLesson,
    applyLesson,
    openLesson,
    close,
    refresh,
    setHeld,
    toggleHeld,
    startPractice,
    resumeLesson,
    replay,
    replayCurrent,
    resetPractice: () => resetPractice(practice, real),
    validate: () => validateLesson(definition),
  };
}

export type TutorialApi = ReturnType<typeof useTutorial>;
