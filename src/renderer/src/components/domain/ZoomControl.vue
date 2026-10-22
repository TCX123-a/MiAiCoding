<script setup lang="ts">
/**
 * 缩放控件：放大镜图标 + `−` / `+` / 可拖动滑块 + 百分比读数。
 *
 * 【它为什么长在 `main.content` 的**外面】**
 * 挂载点是 App.vue 里中间那一栏（`.main-pane`），和 `main.content` 是兄弟。
 * 这是必须的：`main.content` 的孩子整体吃 `zoom`（见 styles/zoom.css），
 * 控件要是落在里面，用户点一下「−」，按钮就会往光标底下缩 —— 越点越难点，
 * 而且百分比读数每次都在跳位置。控件自己必须永远不缩放。
 *
 * 【滚轮：这里唯一一处要拦的地方就是滑块】
 * 红线的原文是「鼠标滚轮绝对不能触发缩放，滚轮只能保持原有的上下滚动」。
 * 所以：
 *   · 整个控件**不监听** wheel —— 不拦、不改、也不响应，滚轮在控件上方
 *     和在任何别的地方一样；
 *   · 只有 `<input type="range">` 上挂了一处 `@wheel`。它是全控件里唯一
 *     一个「浏览器默认就会拿滚轮改它的值」的元素（部分平台上会），
 *     所以这里必须显式 `prevent` 掉，把这条唯一的缝堵死。
 * 两件事合起来的效果是：**没有任何路径能让滚轮改变缩放比例**。
 */
import { useZoomStore } from '../../stores/zoom'
import MiButton from '../base/MiButton.vue'
import { ZOOM } from '../../lib/copy'
import { ZOOM_MAX, ZOOM_MIN, ZOOM_SLIDER_STEP } from '../../../../shared/zoom'

const zoom = useZoomStore()

/**
 * 拖滑块时每一帧都会走到这里。不做防抖是**故意的**：
 * 需求就是「实时调整比例」，拖的过程中正文要跟着变，用户才知道拖到哪一档合适。
 * 落地的开销很小 —— `set()` 里值没变就直接返回，变了才写一次 localStorage。
 */
function onSlide(e: Event) {
  zoom.set(Number((e.target as HTMLInputElement).value))
}

/**
 * 滑块上的滚轮拦截。
 *
 * 【为什么不写成 `@wheel.prevent.stop` 不带值】
 * Vue 3 的模板编译要求 `v-on` 带表达式，空修饰符写法过不了编译。
 * 所以就写成这个空函数 —— 但**它不是占位符**：真正的拦截发生在
 * `.prevent.stop` 两个修饰符上，这个函数体本来就该是空的。
 * 留这个名字和这段注释，是为了让下一个人知道「空的是对的，别顺手删」。
 */
function blockWheel() {
  /* 拦截由 @wheel.prevent.stop 完成，见上面那段说明 */
}
</script>

<template>
  <div class="zoom-ctl">
    <!--
      放大镜用内联 SVG 而不是 🔍 那个 emoji：emoji 是彩色的、随系统字体变样，
      压在这个浅蓝的胶囊上会显得脏。SVG 走 currentColor，跟着文字色一起变。
    -->
    <svg class="zoom-glass" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <circle cx="6.9" cy="6.9" r="4.6" fill="none" stroke="currentColor" stroke-width="1.7" />
      <line
        x1="10.3"
        y1="10.3"
        x2="14"
        y2="14"
        stroke="currentColor"
        stroke-width="1.7"
        stroke-linecap="round"
      />
    </svg>

    <MiButton
      class="zoom-step"
      variant="ghost"
      size="sm"
      :title="ZOOM.OUT"
      :disabled="zoom.atMin"
      @click="zoom.smaller()"
    >
      −
    </MiButton>

    <input
      class="zoom-range"
      type="range"
      :min="ZOOM_MIN"
      :max="ZOOM_MAX"
      :step="ZOOM_SLIDER_STEP"
      :value="zoom.percent"
      :aria-label="ZOOM.SLIDER"
      @input="onSlide"
      @wheel.prevent.stop="blockWheel"
    />

    <MiButton
      class="zoom-step"
      variant="ghost"
      size="sm"
      :title="ZOOM.IN"
      :disabled="zoom.atMax"
      @click="zoom.bigger()"
    >
      +
    </MiButton>

    <!--
      百分比读数同时是「复位」按钮。用 `title` 而不是可见的「重置」两个字：
      这条胶囊里最该省的就是宽度，而「点数字回到 100%」是通用到不用教的。
    -->
    <MiButton class="zoom-pct" variant="ghost" size="sm" :title="ZOOM.RESET" @click="zoom.reset()">
      {{ zoom.percent }}%
    </MiButton>
  </div>
</template>

<style scoped>
.zoom-ctl {
  position: absolute;
  right: 14px;
  bottom: 14px;
  z-index: 50;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 3px 6px 3px 9px;
  border: 1px solid var(--mi-border);
  border-radius: 999px;
  /* 压在正文上面，得有一层底才看得出是「浮着的控件」而不是正文的一部分 */
  background: var(--mi-bg);
  box-shadow: 0 2px 10px color-mix(in srgb, var(--mi-overlay) 10%, transparent);
  /* 控件本身不参与缩放 —— 见文件头。写在这里是双保险：
     styles/zoom.css 选择的是 `main.content > *`，本来就没选到它 */
  user-select: none;
}

.zoom-glass {
  flex-shrink: 0;
  margin-right: 4px;
  color: var(--mi-text-3);
}

/*
 * `−` 和 `+` 要的是**正方形**按钮，而 MiButton 的 sm 尺寸是 `padding: 4px 12px`
 * （给文字按钮用的，横的）。这里把横向内边距收成竖向的量，两个符号就都落在
 * 正方形里了。scoped 样式能改到子组件根元素，靠的是 Vue 会把父组件的
 * scope 属性打在子组件根节点上。
 */
.zoom-step {
  position: relative;
  padding: 4px 7px;
  font-size: 14px;
  line-height: 1;
}
/*
 * 批⑥（2026-10-16）：命中区补强。24px 高的小方钮，用透明 ::after 把纵向热区
 * 撑满**整颗胶囊**（±3px = 胶囊自己的内边距），横向一寸不越 —— 这排控件横向
 * 只隔 2px，横向撑开会把点「−」的落点盖到「+」头上。没硬撑到 40px 是故意的：
 * 再往外就越出胶囊去抢正文的点击了，桌面鼠标够用。
 */
.zoom-step::after,
.zoom-pct::after {
  content: '';
  position: absolute;
  inset: -3px 0;
}

.zoom-pct {
  position: relative;
  min-width: 46px;
  padding: 4px 6px;
  font-variant-numeric: tabular-nums;
  color: var(--mi-text-2);
}

/*
 * 滑块。不挂 `accent-color` 之外的样式：原生 range 在 Chromium 上的
 * 轨道/滑块已经跟着 `accent-color` 走，自己画一套（清掉 appearance 再画轨道）
 * 要写几十行供应商前缀，换来的只是「和别处不太一样的自定义样式」。
 */
.zoom-range {
  width: 92px;
  /* 批⑥（2026-10-16）：18 → 24。Chromium 把轨道画在元素正中、厚度由 UA 定死，
     所以外观一寸不变，上下各多 3px 可以抓。 */
  height: 24px;
  margin: 0 2px;
  accent-color: var(--mi-blue-deep);
  cursor: var(--mi-cursor, pointer);
}

/*
 * 拖到任一端时，那一端的按钮会置灰，但**滑块照旧停在原地**（它本来就在端点）。
 * 光靠一个变淡的按钮，用户不一定看得出「是到头了」还是「按钮坏了」，
 * 所以顺带把轨道也压暗一点，让「已经到头」这件事在滑块本身上也看得见。
 */
.zoom-ctl:has(.zoom-step:disabled) .zoom-range {
  opacity: 0.6;
}
</style>
