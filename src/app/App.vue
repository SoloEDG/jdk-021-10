<script setup lang="ts">
import { computed } from "vue";
import { useSession } from "./session";
import { dispatch } from "./commands";
import { OrdersPanel } from "../features/orders";
import { PantryPanel } from "../features/pantry";
import { KitchenPanel } from "../features/kitchen";
import { ServicePanel } from "../features/service";
import { LedgerPanel, ResultOverlay, totals } from "../features/ledger";
import { useTutorial, TutorialPanel } from "../features/tutorial";
import type { Command } from "../shared/types";
const { game, toggle, restart, setFrozen } = useSession();
const tutorial = useTutorial(game, setFrozen);

const view = tutorial.view;
const lessonOpen = tutorial.open;
const lessonTarget = computed(() =>
  lessonOpen.value ? tutorial.lessonOrderId() : null,
);

/**
 * Kitchen commands go to the practice kitchen during a lesson, otherwise to
 * the real shift. After either, the lesson re-reads the business facts.
 */
function onCommand(cmd: Command) {
  if (lessonOpen.value && tutorial.runtime.held) {
    // Pausing the narration freezes kitchen clocks, so it freezes actions too.
    // Otherwise the player could cook while the stove timer stands still.
    tutorial.runtime.message = "讲解暂停中，先点「继续讲解」再操作厨房。";
    return;
  }
  dispatch(view.value, cmd);
  tutorial.refresh();
}

function onRestart() {
  if (lessonOpen.value) tutorial.close();
  restart();
}

function onToggle() {
  if (lessonOpen.value) {
    tutorial.runtime.message = "教学进行中，真实营业计时已冻结。结束教学后即可继续。";
    return;
  }
  toggle();
}
</script>
<template>
  <div class="app-shell">
    <aside class="rail">
      <a class="brand" href="#" aria-label="午市厨房">午<span>市</span></a>
      <div class="rail-line"></div>
      <span class="rail-icon active">♨</span
      ><span class="rail-label">厨房</span>
      <div class="rail-bottom">
        LUNCH<br />RUSH<br /><small>EST. 2026</small>
      </div>
    </aside>
    <main>
      <header>
        <div>
          <div class="eyebrow">LUNCH RUSH / A LITTLE KITCHEN, A BIG DREAM</div>
          <h1>
            午市厨房<span>{{ lessonOpen ? "主厨教学进行中" : "一餐一味，分秒必争。" }}</span>
          </h1>
        </div>
        <div class="header-actions">
          <span class="open-dot" :class="{ frozen: lessonOpen }"></span
          ><span>{{
            lessonOpen
              ? "教学模式"
              : game.running
                ? "正在营业"
                : game.ended
                  ? "今日打烊"
                  : "准备开门"
          }}</span
          ><button class="outline" @click="onRestart">重新开局</button>
        </div>
      </header>
      <div class="hero">
        <div>
          <span class="eyebrow">THE LUNCH SHIFT</span>
          <h2>{{ lessonOpen ? "一步一步，把火候练成手感。" : "把忙碌，做成美味。" }}</h2>
          <p>
            {{
              lessonOpen
                ? "教学只借用练习厨房，不会清掉你这一局的收入和历史最佳。"
                : "备好食材，掌握火候，让每一位客人带着满足离开。"
            }}
          </p>
          <button class="start-button" @click="onToggle" :disabled="game.ended || lessonOpen">
            {{
              game.running
                ? "Ⅱ 暂停营业"
                : game.time
                  ? "▶ 继续营业"
                  : "↗ 开始营业"
            }}
          </button>
        </div>
        <div class="hero-art" aria-hidden="true">
          <div class="herb">✦</div>
          <div class="plate-art"><span>🥩</span><i>🥬</i><b>🍅</b></div>
          <span class="art-tag">FRESHLY MADE<br /><b>WITH LOVE</b></span>
        </div>
        <div class="hero-metrics">
          <div>
            <small>本场净收益</small><strong>¥{{ totals(game).net }}</strong>
          </div>
          <div>
            <small>距打烊还有</small
            ><strong
              >{{
                String(Math.floor((game.duration - game.time) / 60)).padStart(
                  2,
                  "0",
                )
              }}<em>:</em
              >{{
                String(Math.floor((game.duration - game.time) % 60)).padStart(
                  2,
                  "0",
                )
              }}</strong
            >
          </div>
          <span
            >连续交付 <b>{{ game.combo }}</b> 单</span
          >
        </div>
      </div>
      <TutorialPanel :tutorial="tutorial" />
      <OrdersPanel
        :game="view"
        :target-id="lessonTarget"
        :lesson="lessonOpen"
        @command="onCommand"
      />
      <div class="workspace">
        <PantryPanel
          :game="view"
          :prep-target-id="view.selectedOrder"
          @command="onCommand"
        /><KitchenPanel :game="view" :reserved="tutorial.runtime.lockedStoves" @command="onCommand" /><ServicePanel
          :game="view"
          :target-id="lessonTarget"
          @command="onCommand"
        />
      </div>
      <div class="notice" role="status">
        <span>{{ lessonOpen ? "✦ 主厨讲解" : "✦ 主厨提示" }}</span
        >{{ lessonOpen ? tutorial.runtime.message : game.notice }}
      </div>
      <LedgerPanel :game="game" />
      <footer>
        好食材，好火候，好心情。<span
          >午市厨房 / LUNCH RUSH · 180 秒的小小餐厅</span
        >
      </footer>
    </main>
    <ResultOverlay v-if="!lessonOpen" :game="game" @restart="onRestart" />
  </div>
</template>
