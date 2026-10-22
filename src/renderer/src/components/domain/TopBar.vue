<script setup lang="ts">
import { APP_NAME } from '../../../../shared/copy'

/**
 * 顶条 —— Window Controls Overlay 的「网页部分」。
 *
 * 【它为什么存在 —— 2026-10-05 主人工单】
 * 改造前顶上那条是**系统画的标题栏**：原生白/深底，不受「UI 面板不透明度」
 * 控制，拉低透明度时它依旧实色挡着壁纸，极其突兀。现在窗口开了
 * `titleBarStyle: 'hidden'`（见 src/main/index.ts 的 createWindow）——
 * 整窗都是网页内容，系统只把三个窗口按钮以**悬浮层**画在右上角。
 * 于是「顶条长什么样」回到我们手里：一条玻璃条，和卡片/两栏吃**同一个**
 * `--mi-card-glass`（已进 wall-glass.test.ts 的 IN 清单，受「UI 面板不透明度」
 * 统一控制；壁纸关时它恒等实色 `--mi-card`，零残留）。
 *
 * 【三条边界，改这个文件前先读】
 * ① 只让**背景**透。标题文字是实色的（硬底线「字永远实心」对顶条同样成立）；
 *    三个窗口按钮的符号色是原生层画的，由主进程 setTitleBarOverlay 喂
 *    `--mi-text` 同款颜色（shared/theme.ts 的 THEME_TITLE_SYMBOL）。
 * ② **绝不能拦点击**：整条是 `-webkit-app-region: drag` 的拖拽区。Chromium
 *    对 WCO 的处理是「原生按钮永远先命中，其余区域才轮到拖拽/网页」——
 *    所以本组件里**不许放任何按钮/链接**：真放了它会被拖拽区吃掉点击
 *    （表现为「点了没反应、还把窗口拖走了」）。验证这一条只能靠真实输入
 *    注入点「最小化」自证（CDP 的合成事件到不了原生层），别用 DOM click 骗自己。
 * ③ 高度用 `--mi-topbar-h`（tokens.css 定义 = `env(titlebar-area-height, 33px)`，
 *    WCO 活跃时是系统给的真空高、含 DPI 缩放）。**不要在这里另写 env() 兜底**：
 *    `.layout` 的 padding-top 和这里必须吃同一个变量，两边各写一遍迟早对不上。
 */
</script>

<template>
  <!--
    内容只有一枚标题文字，无任何交互元素（边界②）。
    aria-hidden：这行字只是原生窗口标题的替身，读屏用户从窗口标题就能拿到，
    没必要在页面里再念一遍。
  -->
  <div class="topbar" aria-hidden="true">
    <span class="topbar-title">{{ APP_NAME }}</span>
  </div>
</template>

<style scoped>
.topbar {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: var(--mi-topbar-h);
  display: flex;
  align-items: center;
  padding: 0 12px;
  /* 和卡片/侧栏同一枚玻璃令牌：受「UI 面板不透明度」统一控制 */
  background: var(--mi-card-glass);
  /* 整条拖拽区。原生按钮不吃这个（它们在原生层先命中）—— 见头注释边界② */
  -webkit-app-region: drag;
  /*
   * 60：高于分隔条(1)/ZoomControl(50)，低于两侧开合按钮(100)与一切浮层
   * (MiTooltip 8000 / MiModal 9000 / SearchPanel 9500 / MiToast 9999)。
   * 浮层盖住顶条是刻意的（弹窗打开时它就是最上层）；
   * ⚠️ 但拖拽区是**布局命中**、不随绘制被「盖住」—— 弹窗开着时顶条
   * 仍然可拖窗（和原生标题栏的行为一致，勿当 bug 修）。
   */
  z-index: 60;
}

.topbar-title {
  /* 实色文字（硬底线）；和窗口按钮符号色同源 = --mi-text */
  color: var(--mi-text);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.02em;
}
</style>
