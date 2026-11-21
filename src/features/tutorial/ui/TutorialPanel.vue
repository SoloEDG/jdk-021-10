<script setup lang="ts">
import { computed, ref } from "vue";
import type { TutorialApi } from "../useTutorial";
import { describeSense } from "../lib/senses";
import { recipes } from "../../../shared/catalog";

const props = defineProps<{ tutorial: TutorialApi }>();
const t = props.tutorial;
const rt = t.runtime;
const step = t.step;
// `t` is a plain object, so nested refs are not auto-unwrapped in the template.
// Resolve what the template needs to plain computed values here.
const order = computed(() => t.order.value);
const parallel = computed(() => t.parallel.value);

const closed = computed(() => rt.phase === "closed");
const invalid = computed(() => rt.phase === "invalid");
const complete = computed(() => rt.phase === "complete");
const practice = computed(() => rt.phase === "practice");
const running = computed(() => rt.phase === "running");

const statusLabel = (id: string) => {
  if (rt.done[id]) return "已完成";
  if (step.value?.id === id) return "当前";
  return "等待";
};

const guidance = computed(() => {
  if (rt.failure) return rt.failure.message;
  if (!step.value) return "";
  return describeSense(step.value.done);
});

const reservationNote = computed(() => rt.reservation?.note ?? "");
const failureStep = computed(() =>
  rt.failure ? t.definition.steps.find((s) => s.id === rt.failure?.stepId) : null,
);
const failureMax = computed(() => {
  if (!rt.failure || !failureStep.value) return 0;
  return (
    failureStep.value.fails?.[rt.failure.branchIndex]?.maxRetries ?? 0
  );
});

function openLesson() {
  // The editor is a director tool; collapse it so the lesson card is the focus.
  editorOpen.value = false;
  t.openLesson();
}

/* Director tools: edit the lesson as JSON. It is validated before it is
   applied, and nothing changes when dependencies are missing. */
const editorOpen = ref(false);
const draft = ref("");
const editorErrors = ref<string[]>([]);
const editorSaved = ref(false);

function toggleEditor() {
  editorOpen.value = !editorOpen.value;
  if (editorOpen.value) {
    draft.value = t.exportLesson();
    editorErrors.value = [];
    editorSaved.value = false;
  }
}

function applyDraft() {
  editorErrors.value = t.applyLesson(draft.value);
  editorSaved.value = editorErrors.value.length === 0;
}
</script>

<template>
  <section class="tutorial" :class="{ open: !closed, practice, complete }">
    <div class="tutorial-head">
      <div>
        <span class="eyebrow">CHEF'S LESSON / 主厨教学</span>
        <h2>{{ t.definition.title }}<span class="small">TUTORIAL</span></h2>
        <p class="tutorial-sub">{{ t.definition.subtitle }}</p>
      </div>
      <div class="tutorial-controls">
        <button v-if="closed" class="start-button" @click="openLesson">
          开始教学
        </button>
        <template v-else>
          <button class="tiny soft" @click="t.toggleHeld">
            {{ rt.held ? "▶ 继续讲解" : "Ⅱ 暂停讲解" }}
          </button>
          <button class="tiny soft" @click="t.startPractice">
            ☕ 自由练习
          </button>
          <button class="tiny soft" @click="t.close">结束教学</button>
        </template>
        <button class="tiny soft" @click="toggleEditor">
          {{ editorOpen ? "收起教学配置" : "✎ 教学配置" }}
        </button>
      </div>
    </div>

    <div v-if="editorOpen" class="tutorial-editor">
      <p class="muted">
        教学流程以 JSON 编辑。应用前会校验依赖、失败分支与循环出口；缺依赖时不会改动正在进行的厨房。
      </p>
      <textarea v-model="draft" spellcheck="false" aria-label="教学配置 JSON"></textarea>
      <div class="tutorial-editor-actions">
        <button class="tiny" @click="applyDraft">校验并应用</button>
        <span v-if="editorSaved" class="editor-ok">✓ 已校验并应用</span>
      </div>
      <ul v-if="editorErrors.length" class="editor-errors" role="alert">
        <li v-for="e in editorErrors" :key="e">{{ e }}</li>
      </ul>
    </div>

    <p v-if="closed" class="tutorial-copy">
      从一张牛排单开始，按目标完成接单、备料、合适火候起锅、装盘与正确上菜。每一步都以厨房的真实状态为准；先做过也没关系，教学会直接认下你的成果。
    </p>

    <div v-if="invalid" class="tutorial-errors" role="alert">
      <b>教学配置尚未应用</b>
      <ul>
        <li v-for="e in rt.errors" :key="e">{{ e }}</li>
      </ul>
    </div>

    <template v-if="!closed && !invalid">
      <ol class="lesson-steps">
        <li
          v-for="s in t.definition.steps"
          :key="s.id"
          :class="{
            done: rt.done[s.id],
            current: step?.id === s.id && !complete,
            pending: !rt.done[s.id] && step?.id !== s.id,
          }"
        >
          <span class="step-mark">{{ rt.done[s.id] ? "✓" : "" }}</span>
          <div>
            <b>{{ s.title }}</b>
            <small>
              {{ statusLabel(s.id) }}
              <template v-if="!rt.done[s.id] && parallel"> · 可并行</template>
              <template v-if="!rt.done[s.id] && s.after?.length">
                · 需先完成 {{ s.after.join(" / ") }}
              </template>
            </small>
          </div>
          <button
            v-if="complete || rt.done[s.id] || step?.id === s.id"
            class="tiny soft replay"
            @click="t.replay(s.id)"
          >
            重演
          </button>
        </li>
      </ol>

      <div v-if="!complete" class="lesson-focus">
        <div class="lesson-narration">
          <span class="eyebrow">当前目标</span>
          <b>{{ failureStep?.title ?? step?.title }}</b>
          <p>{{ rt.failure ? failureStep?.body : step?.body }}</p>
          <p class="hint">→ {{ guidance }}</p>
          <p v-if="rt.failure" class="failure">
            失败分支 {{ rt.failure.spends }} / {{ failureMax }}：{{ rt.failure.message }}
          </p>
        </div>
        <div class="lesson-side">
          <p v-if="order" class="lesson-order">
            教学目标：#{{ String(order.id).padStart(3, "0") }} ·
            {{ order.guest }} · {{ recipes[order.recipe].name }}
            <span v-if="rt.adoptedOrder" class="adopted">已认领你先前的工作</span>
          </p>
          <p v-if="rt.held" class="held">讲解暂停中，灶台计时冻结。</p>
          <p v-if="reservationNote" class="reservation">⚙ {{ reservationNote }}</p>
          <p v-if="practice" class="practice-note">
            自由练习进行中：不会来新客，也不计入本局收入。
          </p>
          <button
            v-if="practice || (complete && rt.earlyExit)"
            class="tiny soft"
            @click="t.resumeLesson"
          >
            ↺ 回到教学
          </button>
          <button class="tiny soft" @click="t.replayCurrent" :disabled="!step">
            重演当前步骤
          </button>
        </div>
      </div>

      <div v-if="complete" class="lesson-done">
        <b>{{ rt.earlyExit ? "教学提前结束" : "这一单，通关了。" }}</b>
        <p>{{ rt.message }}</p>
        <button class="tiny soft" @click="t.startPractice">☕ 自由练习</button>
        <button class="tiny" @click="t.close">结束教学</button>
      </div>
    </template>
  </section>
</template>
