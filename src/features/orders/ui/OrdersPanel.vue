<script setup lang="ts">
import type { Game, Command } from "../../../shared/types";
import { recipes } from "../../../shared/catalog";
import OrderCard from "./OrderCard.vue";
import { activeOrders } from "../lib/patience";

const props = defineProps<{
  game: Game;
  /** Order the lesson is teaching, highlighted as the target. */
  targetId?: number | null;
  /** True while the lesson is open (copy changes, orders stay usable). */
  lesson?: boolean;
}>();
defineEmits<{ command: [cmd: Command] }>();

const isLessonTarget = (id: number) => props.targetId === id;
</script>
<template>
  <section class="orders-section">
    <div class="section-heading">
      <div>
        <span class="eyebrow">01 / FRONT OF HOUSE</span>
        <h2>
          今日订单 <span class="count">{{ activeOrders(game).length }}</span>
        </h2>
      </div>
      <span class="muted">{{
        lesson
          ? "教学单有金色边：选中它，备料和装盘都会挂到这张单上"
          : "接单后开始备餐 · 每 18 秒迎来新客"
      }}</span>
    </div>
    <div class="tickets">
      <OrderCard
        v-for="o in activeOrders(game)"
        :key="o.id"
        :order="o"
        :game="game"
        :lesson-target="isLessonTarget(o.id)"
        @accept="(id) => $emit('command', { type: 'accept', id })"
        @select="(id) => $emit('command', { type: 'select-order', id })"
      />
      <div v-if="!activeOrders(game).length" class="empty">
        餐厅暂时安静，整理一下厨房吧。
      </div>
    </div>
  </section>
</template>
