<script setup lang="ts">
/**
 * 「这一趟用你自己装的编译器吗？」的弹窗本体（全应用只挂这一个，在 App.vue 里）。
 *
 * 状态与 Promise 都在 `lib/native-confirm.ts`，这里**只做三件事**：
 * 照着状态显示、把两个按钮的点击（连同「不再提醒」的勾选）翻译成配置写入 + 答案、
 * 把「关掉框」也翻译成一个答案。
 *
 * 【为什么关掉框也要给个答案】不给的话，那个等着答案的 `await` 会永远挂着 ——
 * 界面上表现为运行按钮一直停在「运行中」，而用户觉得自己只是按了个 Esc。
 * 关掉框的答案见 `answerNativeRun` 的注释（= 这一趟不跑）。
 */
import { ref, watch } from 'vue'
import MiModal from '../base/MiModal.vue'
import MiButton from '../base/MiButton.vue'
import { RUNNER_UI } from '../../lib/copy'
import { answerNativeRun, nativeAskVisible } from '../../lib/native-confirm'
import { useSettingsStore } from '../../stores/settings'

const settings = useSettingsStore()

/**
 * 「不再提醒」勾没勾。**每次框重新打开都复位**（见下面的 watch）——
 * 不复位的话，用户上一次勾完选了「用我自己的」，这一次只是想把当前这趟
 * 切回应用自己的编译器，却会**连带把不再提醒也续上**，静默地把总开关关掉。
 * 勾选必须是一次性的、看着这一趟见到的框做的决定。
 */
const quiet = ref(false)
watch(nativeAskVisible, (v) => {
  if (v) quiet.value = false
})

/**
 * 把「点了哪个按钮 + 勾没勾不再提醒」翻译成配置写入，再交答案。
 *
 * 【四种组合的去向，两张都要写死】
 *   · 勾 + 用我自己的 → 记 `nativeRunQuiet = true`：以后每趟静默走原生
 *     （`decideNativeRun` 里那条直接返回 true 的闸）。总开关本来就是开的，
 *     不用动。
 *   · 勾 + 用应用自己的 → **把总开关关掉**（`nativeRunEnabled = false`）：
 *     语义正是「以后都别问、也别用原生」。⚠️ 这里**绝不能**记 quiet = true ——
 *     那个字段的含义是「默认走原生」，记反了下一页点运行会静默换回用户
 *     自己的编译器，方向刚好相反。两个按钮的去向不对称，是因为 quiet
 *     这个字段只表达「不再问，用原生」，不表达「上次选了哪个按钮」。
 *   · 不勾 → 什么都不写，只交答案（老行为不变）。
 *
 * 【顺序：先落内存态、再交答案】`settings.update()` 同步改内存里的 config
 * （await 的只有落盘），而运行那边拿到答案后立刻发请求；先 update 保证
 * 「这一趟之后」读到的一定是新值。落盘失败也只影响下次启动，这趟行为已定。
 */
function choose(useNative: boolean): void {
  if (quiet.value) {
    if (useNative) {
      void settings.update({ nativeRunQuiet: true })
    } else {
      void settings.update({ nativeRunEnabled: false })
    }
  }
  answerNativeRun(useNative)
}

/**
 * `v-model:visible` 那半边被 MiModal 在关闭时回写 false（✕ / Esc / 点旁边都算），
 * 这里立刻把它当成「不用」——**包括我们自己关框那一次**（`answerNativeRun` 里先置 false
 * 再发答案）。重复调用是安全的，理由见 native-confirm.ts。
 */
function onVisible(v: boolean): void {
  if (!v) answerNativeRun(null)
}
</script>

<template>
  <MiModal
    :visible="nativeAskVisible"
    :title="RUNNER_UI.NATIVE_CONFIRM_TITLE"
    :width="440"
    @update:visible="onVisible"
  >
    <p class="ask-text">{{ RUNNER_UI.NATIVE_CONFIRM_BODY }}</p>
    <p class="ask-text">{{ RUNNER_UI.NATIVE_CONFIRM_BODY2 }}</p>
    <p class="ask-note">{{ RUNNER_UI.NATIVE_CONFIRM_DISMISS }}</p>
    <!--
      「不再提醒」勾选框（2026-10-01 主人要求）：勾了之后按这次的选择记住，
      想改回「每次都问」去设置页拨「每次运行前询问」——那是同一个配置字段的
      另一个写入口（nativeRunQuiet），两处含义必须一致。
    -->
    <label class="quiet-row">
      <input v-model="quiet" type="checkbox" />
      <span>{{ RUNNER_UI.NATIVE_CONFIRM_QUIET }}</span>
    </label>
    <template #footer>
      <!--
        两个按钮都不是「取消」：一个是「用我自己的」、一个是「用应用自己的」，
        点哪个都会开跑。而「不跑」这条路只有关窗（✕ / Esc / 点旁边）——
        所以上面那句说明必须留着，否则关窗就成了一个没人告诉过用户的选项。
      -->
      <MiButton variant="ghost" @click="choose(false)">
        {{ RUNNER_UI.NATIVE_CONFIRM_NO }}
      </MiButton>
      <MiButton variant="primary" @click="choose(true)">
        {{ RUNNER_UI.NATIVE_CONFIRM_YES }}
      </MiButton>
    </template>
  </MiModal>
</template>

<style scoped>
.ask-text {
  margin: 0 0 10px;
  line-height: 1.8;
}
.ask-note {
  margin: 4px 0 0;
  color: var(--mi-text-3);
  font-size: 13px;
}
.quiet-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
  font-size: 13px;
  cursor: pointer;
  /* 勾选框本身跟着品牌色走，别用浏览器默认的蓝 */
  accent-color: var(--mi-blue-deep);
}
</style>
