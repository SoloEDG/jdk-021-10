import type { TutorialDefinition } from "./dsl";

/**
 * The house lesson. It teaches one complete steak ticket:
 * 接单 → 备料 → 合适火候起锅 → 装盘 → 正确上菜.
 *
 * Notes for the director:
 * - `stock` and `heat` both start ready, so they demonstrate parallel steps and
 *   the "learn by doing first" rule: a player who already restocked or who
 *   already has a free pan sees those steps marked done on opening.
 * - `lift` owns the burnt branch: burning then discarding re-runs the lift
 *   demonstration, and the branch exits after two retries.
 */
export const houseLesson: TutorialDefinition = {
  id: "house-steak-service",
  title: "主厨第一课 · 一份香煎牛排",
  subtitle: "从接单到上菜，跟着灶台的火候走完一单。",
  targetRecipe: "steak",
  startAt: "accept",
  outro:
    "一单完整走完：接单、备料、卡住火候、装盘、对上菜。设备已经全部释放，可以继续营业或自由练习。",
  steps: [
    {
      id: "accept",
      title: "接下这单",
      body:
        "客人点的是香煎牛排。先接单，订单会亮起来；选中它，后面的备料和装盘都会挂在这张单上，别的单子不会被误认成目标。",
      done: { kind: "order-accepted" },
    },
    {
      id: "stock",
      title: "清点牛肉",
      body:
        "看一眼食材架：做牛排至少要有 1 份牛肉。缺货就先采购，别等锅热了才发现没料。",
      done: { kind: "stock-at-least", ingredient: "beef", count: 1 },
      // Parallel branch: may be completed at any time, including before the lesson.
    },
    {
      id: "prep",
      title: "为这张单备料",
      body:
        "先在订单区选中教学单，再到备料台点「香煎牛排」。备好的那份会标明是给哪位客人的。",
      done: { kind: "portion-prepared", recipe: "steak" },
      after: ["accept"],
    },
    {
      id: "heat",
      title: "确认煎锅空闲",
      body:
        "牛排用煎锅。学徒台上有两口煎锅，教学会优先占一口；如果另一张单正在用，正常出餐优先，教学会改用另一口或等它空出来。",
      done: { kind: "equipment-available", station: "pan" },
      after: ["accept"],
      // Parallel with prep, and not something the player can "fail".
    },
    {
      id: "cook",
      title: "下锅",
      body:
        "把刚备好的牛排放进煎锅。锅里会显示计时，留意右侧的最佳火候标记。",
      done: { kind: "cooked", recipe: "steak" },
      after: ["prep", "heat"],
      reserve: "pan",
    },
    {
      id: "lift",
      title: "卡住火候起锅",
      body:
        "牛排 12 秒最合适，前后 2 秒都算好火候。起锅太早夹生，太晚就会烧糊。",
      done: { kind: "lifted", recipe: "steak", window: "good" },
      after: ["cook"],
      reserve: "pan",
      fails: [
        {
          when: { kind: "lifted", recipe: "steak", window: "burnt" },
          message:
            "这块牛排烧糊了。先把它从出餐台丢弃，再重新备料；火候只能靠重来一次学会。",
          recover: { kind: "discarded", recipe: "steak", burnt: true },
          // Burned means "throw it away and start over", so the retry begins at
          // preparation, not at lifting.
          retryFrom: "prep",
          maxRetries: 2,
          onExhausted: "exit",
        },
        {
          when: { kind: "lifted", recipe: "steak", window: "late" },
          message:
            "再晚一步就焦了。这份口感已经打折，丢掉重新来，卡在窗口内再起锅。",
          recover: { kind: "discarded", recipe: "steak" },
          retryFrom: "lift",
          maxRetries: 2,
          onExhausted: "exit",
        },
        {
          when: { kind: "lifted", recipe: "steak", window: "early" },
          message:
            "起锅太早了，中间还是生的。在出餐台丢掉它，等火候到点再重来一次。",
          recover: { kind: "discarded", recipe: "steak" },
          retryFrom: "lift",
          maxRetries: 2,
          onExhausted: "exit",
        },
      ],
    },
    {
      id: "plate",
      title: "装盘",
      body:
        "起锅只是半成品。把牛排从出餐台装盘，装盘后才能端给客人。",
      done: { kind: "plated", recipe: "steak" },
      after: ["lift"],
    },
    {
      id: "serve",
      title: "确认菜单再上菜",
      body:
        "选中装好盘的牛排和教学订单，核对客人点的是不是牛排，再点上菜。上错菜会扣客人耐心，菜也会留在台上。",
      done: { kind: "served", recipe: "steak", minQuality: 30 },
      after: ["plate"],
    },
  ],
};
