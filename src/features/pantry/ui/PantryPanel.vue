<script setup lang="ts">
import { computed } from "vue";
import type { Game, Command } from "../../../shared/types";
import { recipeList } from "../../../shared/catalog";
import IngredientShelf from "./IngredientShelf.vue";
import { preparationIssue } from "../lib/availability";

const props = defineProps<{
  game: Game;
  /** The accepted order the next portion is being prepared for, if any. */
  prepTargetId?: number | null;
}>();
defineEmits<{ command: [cmd: Command] }>();

const prepTarget = computed(() =>
  props.game.orders.find(
    (o) => o.id === props.prepTargetId && o.status === "accepted",
  ),
);
</script>
<template>
  <section class="panel pantry-panel">
    <span class="eyebrow">02 / PREP STATION</span>
    <h2>食材准备 <span class="small">PREP</span></h2>
    <IngredientShelf
      :game="game"
      @restock="
        (ingredient) => $emit('command', { type: 'restock', ingredient })
      "
    />
    <p v-if="prepTarget" class="prep-target">
      备料目标：<b>#{{ String(prepTarget.id).padStart(3, "0") }} ·
        {{ prepTarget.guest }}</b>，做好的份量会挂到这张单上。
    </p>
    <div class="prep-actions">
      <button
        v-for="r in recipeList"
        :key="r.id"
        class="recipe-button"
        :disabled="!!preparationIssue(game, r.id)"
        @click="
          $emit('command', {
            type: 'prepare',
            recipe: r.id,
            orderId: prepTargetId ?? null,
          })
        "
      >
        <span>{{ r.icon }}</span
        ><b>{{ r.name }}</b
        ><small>备料 · 消耗1份</small>
      </button>
    </div>
    <p class="muted">
      已备 {{ game.portions.length }} / 6 份 · 在灶台选择空闲设备下锅
    </p>
  </section>
</template>
