<script setup lang="ts">
/**
 * 大肥鱼立绘 —— 全项目**唯一**的形象出口。
 *
 * 【为什么要收口成一个组件】
 * 形象会出现在十几个位置（侧栏、欢迎卡、7 处空状态、答题反馈、里程碑…）。
 * 如果每处各写一个 <img src="...">，等 LoRA 出图到位那天，就得满项目找路径、
 * 一处处改，漏一个就是一个破图。收口到这里之后，**换图只需要把 PNG 丢进
 * assets/mascot/ 目录**，其余一行都不用动：组件自己会从「占位框」切换成「真图」。
 *
 * 【为什么用 import.meta.glob 而不是写死路径】
 * 写死路径就必须先有文件，否则 Vite 构建期直接报「模块找不到」——
 * 而现阶段图片一张都还没有。glob 是「有哪些算哪些」：目录空的就全部走占位框，
 * 丢进去一张就自动生效一张，可以在图片陆续到位的期间分批上线。
 * 它同时也在开发期享受 HMR：图放进去，窗口里立刻变。
 *
 * ⚠️ **glob 是「打包时」算的，不是「运行时」**：所以上面那句「丢进去就生效」
 * 只在开发模式（`npm run dev`）成立。打包成 exe 之后，图已经打进 bundle 了，
 * 再往目录里丢新图不会出现，得重新打包一次。这是**故意**的选择：
 * 运行时读目录要额外开本地文件协议，而图定稿之后基本不会再动。
 *
 * 【占位框为什么是虚线 + 尺寸数字，而不是随便一个灰块】
 * 它要当尺子用 —— docs/13 的尺寸是给 LoRA 出图定的规格，
 * 虚线框精确等于目标边长，出图后可以直接叠上来比。
 * 所以框的宽高必须等于档位值，一个字都不能差。
 */
import { computed } from 'vue'
import { MASCOT } from '../../lib/copy'
import { today } from '../../lib/day-clock'
import {
  MASCOT_POSE_TONE,
  MASCOT_SIZE_PX,
  mascotBaseOf,
  mascotKeysFor,
  pickVariantIndex,
  placeholderFontPx,
  seedFromKey,
  showsPlaceholderText,
  variantsOf,
  type MascotPose,
  type MascotSize
} from '../../lib/mascot'

const props = withDefaults(
  defineProps<{
    /** 姿态：决定将来取哪张图，也决定占位框上标注什么 */
    pose: MascotPose
    /** 档位：xs 32 / s 48 / m 80 / l 112 / xl 160 */
    size?: MascotSize
    /**
     * 图池抽签用的种子。传「第几次运行/第几次出现」这类**每次变化一次**的数即可。
     *
     * 【为什么不在这里调 Math.random()】
     * 这个组件会频繁重渲染，而随机数每求值一次就换一张 —— 用户看到的不是
     * 「每次换一张」，是**图在抖**。种子从外面来，抽签结果就能和重渲染解耦。
     *
     * 【不传时是什么（V1-39 修复，2026-10-15 夜）】原来是恒定用第 1 张 ——
     * 145 张素材里绝大多数永远见不到光，等于白画。现在不传 = 按**当天日键**
     * 抽一张：同一整天内稳定（重渲染不抖，同 pickVariantIndex 的设计前提），
     * 过零点由 day-clock 的 today ref 自动翻新（和挑战奖励图同一套口径）。
     */
    seed?: number
  }>(),
  { size: 'm' }
)

/**
 * 真图登记表：把 assets/mascot/ 下现有的 PNG 全部登记进来。
 * 目录为空时这里是空对象，组件全部走占位框 —— 不是错误路径，是当前正常状态。
 *
 * 文件名约定见 docs/13 §7.1：`<pose>_01.png`、`<pose>_02.png`…
 * （只放一张、懒得编号时 `<pose>.png` 也认）
 */
const IMAGES = import.meta.glob('../../assets/mascot/*.png', {
  eager: true,
  query: '?url',
  import: 'default'
}) as Record<string, string>

/** 目录里现在有哪些文件名主干（不带 `.png`） */
const allBases = computed(() => Object.keys(IMAGES).map(mascotBaseOf))

/**
 * 该按哪个 key 去筛图。小档位先找半身版，没有再退回全身版 —— 见 `mascotKeysFor`。
 * 这一步在**组件里**做而不是让调用方挑 key：调用方只该说「这儿要一张欢迎的鱼」，
 * 「32px 得用半身图」是这个组件自己的知识。
 */
const lookupKeys = computed(() => mascotKeysFor(props.pose, props.size))

/** 图池：按优先级找到的第一个非空池子。全都为空 = 图还没出，走占位框 */
const pool = computed(() => {
  for (const key of lookupKeys.value) {
    const found = variantsOf(key, allBases.value)
    if (found.length) return found
  }
  return []
})

/** 抽中的是第几张（0 基），以及它在池子里的 1 基编号 —— 占位框上要标「2/3」 */
/** 种子：调用方给了就用它的；没给按当天日键算（V1-39，见 props.seed 注释） */
const seedValue = computed(() => props.seed ?? seedFromKey(today.value))
const pickedIndex = computed(() => pickVariantIndex(pool.value.length, seedValue.value))
const pickedBase = computed(() => pool.value[pickedIndex.value] ?? '')

const imageUrl = computed(() => IMAGES[`../../assets/mascot/${pickedBase.value}.png`] ?? '')

const px = computed(() => MASCOT_SIZE_PX[props.size])
const withText = computed(() => showsPlaceholderText(props.size))
const textPx = computed(() => placeholderFontPx(props.size))
/** 小鱼标记：没有文字的小档位要顶上来当主角，所以给小档位更大的比例 */
const markPx = computed(() => Math.round(px.value * (withText.value ? 0.25 : 0.5)))
/** 情绪色调，决定占位框描边的颜色。只有一张图时不显示编号 */
const tone = computed(() => MASCOT_POSE_TONE[props.pose])
const showVariant = computed(() => pool.value.length > 1)

/**
 * 占位框底下那行小字：「80 × 80」或「80 × 80 · 2/3」。
 *
 * 【为什么拼在 script 里而不是模板里写两个插值】
 * Vue 的模板编译器会把「含换行的纯空白文本节点」直接删掉。写成
 * `<span>{{ a }} · {{ b }}</span>` 只要换行，那个分隔空格就没了，
 * 渲染成「80 × 80·2/3」。拼成一个字符串则完全不受模板空白规则影响。
 */
const sizeText = computed(() =>
  showVariant.value
    ? `${MASCOT.sizeLabel(px.value)} · ${MASCOT.variantLabel(pickedIndex.value + 1, pool.value.length)}`
    : MASCOT.sizeLabel(px.value)
)

/**
 * 这一张要不要「蹦一下」。
 *
 * 【判据为什么是情绪色调，而不是在这儿再列一遍姿态名】
 * 会蹦的三张 —— `yay`(答对) / `milestone`(第一次跑通) / `proud`(错题本清空) ——
 * 在 `MASCOT_POSE_TONE` 里本来就都是 `'good'`：那张表已经把「这张图是好事还是坏事」
 * 回答过了。再写一遍 `['yay', 'milestone', 'proud']` 就是同一个事实存两处，
 * 将来加一张「通关」姿态时必然只改一处，症状是「那张图不蹦，但看不出为什么」。
 *
 * 注意它只在有真图时才挂到 class 上（见模板）——占位框是**量尺寸的尺子**，
 * 会动就没法当尺子用了。
 */
const celebrating = computed(() => tone.value === 'good')
</script>

<template>
  <!--
    `data-sfx="quack"` —— 点大肥鱼叫一声小黄鸭。
    声音**不在这里播**，而是由 `lib/sfx-wire.ts` 的全局委托读这个属性去播。
    理由：这个组件有 12 个使用点，把播放写在这里，等于每个使用点都绑死了
    一种声音；写成属性，换声音、关声音都只改这一个词。

    【为什么没做成真正的按钮（没有 role="button"/tabindex）】
    这一下点击**不携带任何信息** —— 不导航、不改变状态、不放行任何操作，
    只是好玩。给它加 role 和 tabindex，等于在 12 个位置各插一个 Tab 停留点，
    键盘用户每路过一次都要 Tab 一下才能过去，换来的是一声鸭叫。
    这个交换不划算，所以它保持 `role="img"`，只接鼠标。
    （对比：首页欢迎卡那只 🐱 同理，见 LearnView.vue。）
  -->
  <span
    class="mi-mascot"
    :class="imageUrl ? ['has-image', { celebrate: celebrating }] : ['is-placeholder', `tone-${tone}`]"
    :style="{ width: px + 'px', height: px + 'px' }"
    :title="imageUrl ? undefined : MASCOT.PLACEHOLDER"
    :aria-label="imageUrl ? MASCOT.ARIA : MASCOT.aria(pose, size)"
    role="img"
    data-sfx="quack"
  >
    <!--
      `:key="pickedBase"` 是入场动画的**开关**，不是给 v-for 用的。
      没有它，姿态变了 Vue 只会改同一个 <img> 的 src，元素没有重建，
      挂在它身上的 CSS 动画就不会重放 —— 表现是「第一张图有入场，之后换图都是硬切」。
      带上 key 之后：换了图（也就是换了姿态，或换了抽签结果）就重建元素、重放动画。
      同一个位置反复重渲染时 key 不变，动画也不会莫名其妙重来一遍。
    -->
    <img v-if="imageUrl" :key="pickedBase" :src="imageUrl" :alt="MASCOT.ARIA" />

    <template v-else>
      <span class="ph-mark" :style="{ fontSize: markPx + 'px', lineHeight: 1 }">🐟</span>
      <!-- 小档位放不下这六个字，塞进去会换行成三四行，比不放更难看 -->
      <template v-if="withText">
        <span class="ph-text" :style="{ fontSize: textPx + 'px' }">{{ MASCOT.PLACEHOLDER }}</span>
        <span class="ph-size">{{ sizeText }}</span>
      </template>
    </template>
  </span>
</template>

<style scoped>
.mi-mascot {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  vertical-align: middle;
  box-sizing: border-box;
  /* 它是可点的（点一下叫一声），手型得对得上。走 tokens 的猫爪变量 */
  cursor: var(--mi-cursor, pointer);
}

.has-image img {
  /*
   * 【尺寸锁三层，少一层都可能把布局顶飞】
   * 原图是 512×512，而这里最小只显示到 32px。哪一条尺寸没生效，浏览器就按
   * **原始尺寸**排版 —— 一个 512px 的方块足够把整个侧栏挤没（这项目刚踩过一次
   * 「内容被悄悄挤掉」的坑，见 Sidebar.vue 里 .side-section.grow 那段）。
   *   width/height 100%      正路
   *   max-width/max-height   兜底：上面那条被谁的规则盖掉时，也涨不过容器
   *   object-fit: contain    将来图不是正方形时按比例缩进去，不裁不拉
   */
  width: 100%;
  height: 100%;
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  display: block;

  /*
   * 【提到合成层 —— 但**实测它在这台机器上没有可测量的收益**，如实记下来】
   *
   * 加它的通行理由是：512×512 的画每帧重新缩到 48px 很贵，而悬浮正好触发这个重绘。
   * 实测结果是**开着和关着一样**：同一台机器、同一段悬浮，逐帧量最长的一帧，
   * 关 8.6ms / 开 8.6ms（各 7 次，8.3→8.6 之间）。而 8.3ms 正好是这块屏的刷新间隔
   * （120Hz），也就是说悬浮缩放**一帧都没多花** —— 被测的这个尺寸上根本没有
   * 需要它去省的重绘。
   *
   * 那为什么还留着：它是零成本的保险。真正会掉帧的场合是**弱核显**或将来把
   * 猫咪放大到 160px 以上铺在结算页上，这台机器复现不出来。留着不亏，
   * 但**别把它当成一个已经兑现的优化**。
   *
   * ⚠️ 反过来，如果哪天发现显存吃紧（`will-change` 会让每个元素**常驻**一块
   * 合成层，不是动画时才提），这里是第一个该删的地方。
   */
  will-change: transform;
  transform-origin: center;
  transition: transform var(--mi-dur-fast) var(--mi-ease);

  /*
   * 入场。
   * 【为什么 fill-mode 是 backwards 不是 forwards】
   * 填 forwards 的话动画结束后 transform 会被**永久钉在最后一帧**上，
   * 下面那条 `:hover` 的放大就再也生效不了了 —— 而且完全不报错，
   * 只是「鼠标移上去没反应」，查起来要命。
   */
  animation: mi-mascot-in var(--mi-dur-enter) var(--mi-ease-out) backwards;
}

/*
 * 悬浮只放大、**不位移**：位移会让并排的东西看起来在晃。这个组件经常紧挨着
 * 文字或图标（首页欢迎卡里就贴着一个 🐱，只隔 6px）。
 * 4% 是「它注意到你了」的最小可见幅度 —— 再小看不出来，再大就开始挤到邻居。
 *
 * 注意缩放是 `transform`，**不参与布局**：视觉上大了一圈，占位一格没变，
 * 所以整页不会因为鼠标划过而重排。这也是不选 width/height 的原因。
 */
.has-image:hover img {
  transform: scale(1.04);
}

/*
 * 被点住时**缩一下** —— 让「点它有反应」这件事在听觉之外也有个视觉落点。
 *
 * ⚠️ 必须写在 `:hover` **后面**。两条选择器的特异度完全一样
 * （都是 类+伪类+标签 = 0,2,1），同分时**后来者胜**。写在前面的话，
 * 鼠标悬停时 `:hover` 那条永远压着它，按住也不会缩 —— 而这一点
 * 从代码上完全看不出来，只有真去点一下才发现。
 *
 * 幅度（0.94）比悬浮的放大（1.04）大一点：按下去是"被捏住"，
 * 该比"被注意到"更明显。
 */
.has-image:active img {
  transform: scale(0.94);
}

/*
 * 庆祝：入场 + 蹦一下。
 *
 * 【为什么必须是**一条**动画，不能写两条用逗号分开】
 * 两条都动 transform，而按规范**后一条会整个盖住前一条** —— 结果是入场那 220ms
 * 的位移被蹦跳吃掉，图「啪」地出现然后才开始蹦。写成一条、用百分比分段，
 * 两段就一定是先后关系。
 *
 * 【为什么蹦跳幅度用百分比，入场的 8px 却写死】
 * 这个组件从 48px（答题内联反馈的 yay）到 160px（挑战结算的 milestone）都在用。
 * 蹦跳写死 6px：在 48px 上是 12%（跳得很欢），在 160px 上只有 3.75%（几乎看不见）。
 * `translateY` 的百分比是**相对元素自身高度**算的，所以 -7% 在每一档看起来一样大。
 * 入场反过来要写死 —— 「刚出现」这件事在哪个档位都是挪同样的一段距离。
 *
 * 【总时长为什么不做成全局令牌】下面那几个百分比断点就是照着 560ms 算出来的，
 * 挪进 tokens.css 等于把两个必须一起改的数拆到两个文件里。
 */
.has-image.celebrate img {
  --mi-mascot-celebrate: 560ms;
  animation: mi-mascot-celebrate var(--mi-mascot-celebrate) backwards;
}

@keyframes mi-mascot-in {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/*
 * 两段合成一条：0 → 39% 是入场（39% × 560ms ≈ 220ms，正好等于 --mi-dur-enter），
 * 39% → 100% 是蹦跳。第二次比第一次矮，然后停住 —— 不循环，蹦完就安静。
 *
 * 【曲线为什么写在关键帧里而不是 animation 简写里】
 * 简写只能给**整条**动画一条曲线，而这里要去程和回程分开：往上要「快起慢收」
 * （到最高点时慢下来，像真的跳起来），往下要「慢起快收」（像被重力拉回来）。
 * 写在某个关键帧里的 timing-function 管的是**从它出发**那一段。
 */
@keyframes mi-mascot-celebrate {
  0% {
    opacity: 0;
    transform: translateY(8px);
    animation-timing-function: var(--mi-ease-out); /* 入场：浮上来，落定时收住 */
  }
  39% {
    opacity: 1;
    transform: translateY(0);
    animation-timing-function: var(--mi-ease-out); /* 起跳：到最高点变慢 */
  }
  56% {
    transform: translateY(-7%);
    animation-timing-function: var(--mi-ease-in); /* 落下：被拉回来 */
  }
  73% {
    transform: translateY(0);
    animation-timing-function: var(--mi-ease-out); /* 第二次，只有一半高 */
  }
  85% {
    transform: translateY(-3%);
    animation-timing-function: var(--mi-ease-in);
  }
  100% {
    transform: translateY(0);
  }
}

/* 占位框：虚线、不填充 —— 填充了会看起来像一张坏掉的图 */
.is-placeholder {
  gap: 3px;
  padding: 6px;
  /*
   * 描边用 --mi-text-3 而不是 --mi-border：后者是 #e3edf7，压在 --mi-card(#f7f9fc)
   * 上几乎看不见 —— 一个「看不见的占位框」等于没有占位框。
   * 全局 box-sizing:border-box 保证框的外沿精确等于档位边长，当尺子量才准。
   */
  border: 1.5px dashed var(--mi-ph-tone, var(--mi-text-3));
  border-radius: var(--mi-radius-sm);
  color: var(--mi-ph-tone, var(--mi-text-3));
  text-align: center;
  overflow: hidden;
}

/*
 * 情绪色调：图还没出的时候，靠描边颜色一眼区分「这是运行中 / 成功 / 报错」。
 * --mi-ph-tone 是个中间变量，让上面两条规则共用同一个色值 ——
 * 不这么做就得把 border-color 和 color 各写四遍，改一次漏一处。
 */
.tone-neutral {
  --mi-ph-tone: var(--mi-text-3);
}
.tone-busy {
  --mi-ph-tone: var(--mi-ph-busy);
}
.tone-good {
  --mi-ph-tone: var(--mi-ph-good);
}
.tone-care {
  --mi-ph-tone: var(--mi-ph-care);
}

.ph-text {
  line-height: 1.15;
  word-break: break-all;
}

.ph-size {
  font-family: var(--mi-code);
  font-size: 9px;
  line-height: 1;
  opacity: 0.75;
}
</style>
